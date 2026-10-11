// [INPUT]: CodexHost 独立安装、上游 runtime descriptor、Buddy 配置和只读宿主发现。
// [OUTPUT]: 安装与实际运行身份（版本及解析后的路径）、启停意图、冷启动、显式重启停用及更新接入。
// [POS]: 独立后台功能适配；开关不退出当前会话，显式重启由独立协调进程接续；不复制上游业务或进入面板布局。
// [PROTOCOL]: 变更时同步 codex_host/AGENTS.md。
pub(crate) mod restart;
mod update;
use crate::{
    config::{Paths, write_private},
    state::App,
};
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::process::Command;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Options {
    pub enabled: bool,
    pub executable: Option<PathBuf>,
    pub revision: u64,
    pub previous_executable: Option<PathBuf>,
}
#[derive(Deserialize)]
struct Descriptor {
    schema_version: u32,
    launcher_pid: u32,
    control_port: u16,
    nonce: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Running {
    pub pid: u32,
    pub executable: PathBuf,
}

pub fn executable(options: &Options) -> Option<PathBuf> {
    options.executable.clone().or_else(|| {
        let path = PathBuf::from("/Applications/codexhost.app/Contents/MacOS/codexhost");
        path.is_file().then_some(path)
    })
}
pub async fn output(program: &Path, args: &[&str], timeout: Duration) -> Result<String> {
    let mut cmd = Command::new(program);
    cmd.args(args).stdin(Stdio::null()).kill_on_drop(true);
    let out = tokio::time::timeout(timeout, cmd.output())
        .await
        .context("CodexHost 操作超时")??;
    ensure!(
        out.status.success(),
        "CodexHost 操作失败：{}",
        String::from_utf8_lossy(&out.stderr).trim()
    );
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_owned())
}
fn resource_root(path: &Path) -> Result<PathBuf> {
    let path = std::fs::canonicalize(path).context("CodexHost 安装路径无效")?;
    let directory = path.parent().context("CodexHost 安装路径无效")?;
    let root = directory.parent().context("CodexHost 安装路径无效")?;
    Ok(if directory.file_name().is_some_and(|v| v == "MacOS") {
        root.join("Resources")
    } else {
        root.to_path_buf()
    })
}
pub async fn version(path: &Path) -> Result<String> {
    ensure!(path.is_file(), "CodexHost 程序不存在");
    let metadata: Value = serde_json::from_slice(&std::fs::read(
        resource_root(path)?.join("app/codexhost-distribution.json"),
    )?)
    .context("无法读取 CodexHost 版本")?;
    ensure!(
        metadata["schemaVersion"] == 1,
        "CodexHost 安装元数据版本不支持"
    );
    let version = metadata["version"]
        .as_str()
        .context("CodexHost 版本信息无效")?;
    update::version_tuple(version)?;
    Ok(version.into())
}
pub async fn running() -> Result<Option<Running>> {
    let root = dirs::data_local_dir()
        .context("无法找到应用数据目录")?
        .join("codexhost");
    let bytes = match std::fs::read(root.join("desktop-runtime-v1.json")) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let record: Descriptor = serde_json::from_slice(&bytes).context("CodexHost 运行记录无效")?;
    ensure!(
        record.schema_version == 1
            && record.launcher_pid > 0
            && record.control_port > 0
            && record.nonce.len() == 32
            && record.nonce.bytes().all(|b| b.is_ascii_hexdigit()),
        "CodexHost 运行身份无法确认"
    );
    let out = Command::new("/bin/ps")
        .args(["-p", &record.launcher_pid.to_string(), "-o", "comm="])
        .output()
        .await?;
    if !out.status.success() {
        return Ok(None);
    }
    let path = PathBuf::from(String::from_utf8_lossy(&out.stdout).trim());
    ensure!(
        path.file_name().and_then(|v| v.to_str()) == Some("codexhost") && path.is_file(),
        "CodexHost 进程身份无法确认"
    );
    version(&path).await?;
    let listening = Command::new("/usr/sbin/lsof")
        .args([
            "-nP",
            &format!("-iTCP:{}", record.control_port),
            "-sTCP:LISTEN",
            "-t",
        ])
        .output()
        .await?;
    let controller = resource_root(&path)?.join("app/desktop-controller.mjs");
    let mut verified = false;
    for pid in String::from_utf8_lossy(&listening.stdout).lines() {
        if pid.parse::<u32>().is_err() {
            continue;
        }
        let details = output(
            Path::new("/bin/ps"),
            &["-p", pid, "-o", "ppid=,args="],
            Duration::from_secs(3),
        )
        .await?;
        if let Some((parent, args)) = details.split_once(char::is_whitespace)
            && parent.parse::<u32>().ok() == Some(record.launcher_pid)
            && args.contains(controller.to_string_lossy().as_ref())
        {
            verified = true;
        }
    }
    ensure!(verified, "CodexHost 控制端口未就绪或身份不符");
    Ok(Some(Running {
        pid: record.launcher_pid,
        executable: path,
    }))
}
pub async fn status(paths: &Paths, options: &Options) -> Result<Value> {
    status_with_running(paths, options, running().await).await
}
async fn status_with_running(
    paths: &Paths,
    options: &Options,
    running: Result<Option<Running>>,
) -> Result<Value> {
    let executable = executable(options);
    let mut error = None;
    let installed = if let Some(path) = &executable {
        match version(path).await {
            Ok(v) => Some(v),
            Err(e) => {
                error = Some(e.to_string());
                None
            }
        }
    } else {
        None
    };
    let running = match running {
        Ok(v) => v,
        Err(e) => {
            error = Some(e.to_string());
            None
        }
    };
    let running_version = if let Some(record) = &running {
        match version(&record.executable).await {
            Ok(v) => Some(v),
            Err(e) => {
                error = Some(e.to_string());
                None
            }
        }
    } else {
        None
    };
    let owned: Option<Running> = std::fs::read(paths.root.join("codex-host-owned.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok());
    let owned = running.as_ref().is_some_and(|r| {
        owned
            .as_ref()
            .is_some_and(|o| o.pid == r.pid && o.executable == r.executable)
    });
    let same_installation = running.as_ref().is_some_and(|record| {
        executable.as_ref().is_some_and(|selected| {
            std::fs::canonicalize(selected).is_ok_and(|selected| {
                std::fs::canonicalize(&record.executable).is_ok_and(|actual| selected == actual)
            })
        })
    });
    let state = if error.is_some() {
        "error"
    } else if running.is_some() {
        if !options.enabled {
            "pendingDisable"
        } else if running_version != installed || !same_installation {
            "pendingUpdate"
        } else {
            "running"
        }
    } else if !options.enabled {
        "disabled"
    } else if executable.is_none() {
        "notInstalled"
    } else {
        "pendingEnable"
    };
    let can_restore = if let Some(previous) = &options.previous_executable {
        version(previous)
            .await
            .and_then(|v| update::version_tuple(&v))
            .is_ok_and(|v| v >= update::version_tuple(update::BASELINE).unwrap())
    } else {
        false
    };
    Ok(
        json!({"enabled":options.enabled,"revision":options.revision,"state":state,"executable":executable,
        "version":installed,"runningVersion":running_version,"runningExecutable":running.map(|v|v.executable),"managed":owned,"error":error,"baseline":update::BASELINE,"canRestore":can_restore,"restart":restart::status(paths)}),
    )
}

// This function never asks the upstream launcher to take over a live ordinary Desktop.
// lifecycle performs any explicitly requested restart using Buddy's existing policy first.
pub async fn prepare(options: &Options, app: Option<&Path>) -> Result<(PathBuf, PathBuf, PathBuf)> {
    let executable = executable(options).context("未安装 CodexHost，请在设置中安装")?;
    ensure!(
        update::version_tuple(&version(&executable).await?)?
            >= update::version_tuple(update::BASELINE)?,
        "请先将 CodexHost 更新到 {} 或更新版本",
        update::BASELINE
    );
    let inspected = output(&executable, &["inspect"], Duration::from_secs(10)).await?;
    let desktop = inspected
        .lines()
        .find_map(|line| line.strip_prefix("desktop_executable="))
        .map(PathBuf::from)
        .context("无法识别 CodexHost 目标程序")?;
    if let Some(app) = app {
        ensure!(
            std::fs::canonicalize(app)? == std::fs::canonicalize(&desktop)?,
            "CodexHost 不支持此自定义 Codex 路径"
        );
    }
    let node = find_node().context("CodexHost 需要 Node.js 22 或更新版本")?;
    let node_version = output(&node, &["--version"], Duration::from_secs(5)).await?;
    ensure!(
        update::version_tuple(node_version.trim_start_matches('v'))?.0 >= 22,
        "需要 Node.js 22 或更新版本"
    );
    Ok((executable, desktop, node))
}

pub async fn launch(paths: &Paths, options: &Options, app: Option<&Path>) -> Result<String> {
    ensure!(options.enabled, "CodexHost 尚未启用");
    let (executable, desktop, node) = prepare(options, app).await?;
    let lock_root = dirs::data_local_dir()
        .context("无法找到应用数据目录")?
        .join("codex-buddy");
    std::fs::create_dir_all(&lock_root)?;
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(lock_root.join("codex-host-launch.lock"))?;
    fs2::FileExt::try_lock_exclusive(&lock)
        .context("另一个 Buddy 正在启动 CodexHost，请稍后重试")?;
    if crate::host::desktop_process(&desktop)?.is_some() {
        ensure!(
            running().await?.is_some(),
            "启用 CodexHost 需要重开 Codex；开关已保存，请结束当前任务后重新打开 Buddy"
        );
        return ready_endpoint(&desktop).await;
    }
    // Refuse to start a second controller if a previous one is still shutting down.
    ensure!(
        running().await?.is_none(),
        "CodexHost 控制器仍在退出，请稍后重试"
    );
    let log_path = paths.root.join("codex-host.log");
    if !log_path.exists() {
        write_private(&log_path, b"")?;
    }
    let log = std::fs::OpenOptions::new().append(true).open(log_path)?;
    let mut command = std::process::Command::new(&executable);
    command
        .args(["launch", "--node"])
        .arg(node)
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log);
    use std::os::unix::process::CommandExt;
    command.process_group(0);
    let mut child = command.spawn().context("无法启动 CodexHost")?;
    for _ in 0..120 {
        tokio::time::sleep(Duration::from_millis(250)).await;
        if let Some(code) = child.try_wait()? {
            bail!("CodexHost 启动失败（{code}），请查看 codex-host.log");
        }
        if let Ok(Some(record)) = running().await
            && record.pid == child.id()
            && let Ok(endpoint) = ready_endpoint(&desktop).await
        {
            write_private(
                &paths.root.join("codex-host-owned.json"),
                &serde_json::to_vec(&record)?,
            )?;
            return Ok(endpoint);
        }
    }
    bail!("CodexHost 尚未就绪，请检查 codex-host.log；未结束正在启动的会话")
}
pub async fn ready_endpoint(desktop: &Path) -> Result<String> {
    let pid = crate::host::desktop_process(desktop)?.context("Codex 尚未启动")?;
    let endpoint = crate::host::process_debug_endpoint(pid)?.context("Codex 调试端口尚未就绪")?;
    ensure!(
        !crate::cdp::discover(&endpoint, false).await?.is_empty(),
        "Codex 页面尚未就绪"
    );
    Ok(endpoint)
}
pub fn find_node() -> Option<PathBuf> {
    find_tool("node")
}
pub fn find_tool(name: &str) -> Option<PathBuf> {
    let mut paths: Vec<PathBuf> =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    paths.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    paths
        .into_iter()
        .map(|p| p.join(name))
        .find(|p| p.is_file())
}
impl App {
    pub(crate) async fn codex_host_status(&self) -> Result<Value> {
        let options = self.config.lock().await.codex_host.clone();
        status(&self.paths, &options).await
    }

    pub(crate) async fn codex_host_command(
        self: &std::sync::Arc<Self>,
        input: Value,
    ) -> Result<Value> {
        let _guard = self.codex_host_operation.lock().await;
        let options = self.config.lock().await.codex_host.clone();
        ensure!(!restart::busy(&self.paths), "Codex 正在重启，请稍后再操作");
        match input["op"].as_str() {
            Some("restart-disabled") => {
                restart::schedule(self, &input).await?;
            }
            Some("check-update") => return update::check().await,
            Some("set-enabled") => {
                let enabled = input["enabled"].as_bool().context("缺少开关状态")?;
                self.save_codex_host(&input, |o| {
                    o.enabled = enabled;
                })
                .await?;
            }
            Some("install") => {
                ensure!(
                    input["expectedRevision"].as_u64() == Some(options.revision),
                    "CodexHost 设置已更新，请刷新后重试"
                );
                let version = input["version"].as_str().context("缺少安装版本")?;
                let path = update::install(&self.paths, version).await?;
                self.save_codex_host(&input, |o| {
                    o.previous_executable = executable(o);
                    o.executable = Some(path);
                })
                .await?;
            }
            Some("restore") => {
                let previous = options
                    .previous_executable
                    .clone()
                    .context("没有可恢复的版本")?;
                let mut restored = options.clone();
                restored.executable = Some(previous.clone());
                prepare(&restored, None).await?;
                self.save_codex_host(&input, |o| {
                    o.previous_executable = o.executable.clone();
                    o.executable = Some(previous);
                })
                .await?;
            }
            Some("start") => {
                ensure!(
                    input["expectedRevision"].as_u64() == Some(options.revision),
                    "CodexHost 设置已更新，请刷新后重试"
                );
                ensure!(
                    crate::assets::development().is_none(),
                    "Dev 已绑定当前 Codex；请结束任务后通过 Dev 启动入口应用更改"
                );
                let endpoint = launch(&self.paths, &options, None).await?;
                self.connect(Some(endpoint), None).await?;
            }
            _ => bail!("未知 CodexHost 操作"),
        }
        if input["op"] != "restart-disabled" {
            restart::clear(&self.paths)?;
        }
        let options = self.config.lock().await.codex_host.clone();
        status(&self.paths, &options).await
    }
    async fn save_codex_host(
        &self,
        input: &Value,
        change: impl FnOnce(&mut Options),
    ) -> Result<()> {
        let mut config = self.config.lock().await;
        ensure!(
            input["expectedRevision"].as_u64() == Some(config.codex_host.revision),
            "CodexHost 设置已更新，请刷新后重试"
        );
        let mut next = config.clone();
        change(&mut next.codex_host);
        next.codex_host.revision += 1;
        self.paths.save(&next)?;
        *config = next;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn switches_preserve_legacy_config_and_do_not_launch_or_change_other_features() {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::new(Some(temp.path().into())).unwrap();
        std::fs::write(paths.config(), br#"{"codexHost":{"enabled":false,"revision":7,"executable":"/tmp/retained-codexhost"},"stepwise":{"enabled":true,"maxItems":2},"customRetained":{"value":42}}"#).unwrap();
        let config = paths.load().unwrap();
        assert_eq!(config.codex_host.revision, 7);
        let app = App::new(paths.clone(), config, None, true);
        let before = app.settings().await;
        app.codex_host_command(json!({"op":"set-enabled","enabled":true,"expectedRevision":7}))
            .await
            .unwrap();
        let saved = paths.load().unwrap();
        assert!(saved.codex_host.enabled);
        assert_eq!(saved.codex_host.revision, 8);
        assert_eq!(
            saved.codex_host.executable.unwrap(),
            PathBuf::from("/tmp/retained-codexhost")
        );
        assert_eq!(saved.extra["customRetained"]["value"], 42);
        assert_eq!(app.settings().await, before);
        assert!(!paths.root.join("codex-host.log").exists());
        assert!(!paths.root.join("codex-host-restart.json").exists());
        assert!(
            app.codex_host_command(
                json!({"op":"set-enabled","enabled":false,"expectedRevision":7})
            )
            .await
            .is_err()
        );
        app.codex_host_command(json!({"op":"set-enabled","enabled":false,"expectedRevision":8}))
            .await
            .unwrap();
        assert!(!paths.load().unwrap().codex_host.enabled);
    }

    #[tokio::test]
    async fn status_distinguishes_selected_installation_from_running_process() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(Some(dir.path().join("buddy"))).unwrap();
        let mut installs = Vec::new();
        for name in ["original", "selected"] {
            let root = dir.path().join(name);
            std::fs::create_dir_all(root.join("bin")).unwrap();
            std::fs::create_dir_all(root.join("app")).unwrap();
            let executable = root.join("bin/codexhost");
            std::fs::write(&executable, b"not executable").unwrap();
            std::fs::write(
                root.join("app/codexhost-distribution.json"),
                br#"{"schemaVersion":1,"version":"0.10.2"}"#,
            )
            .unwrap();
            installs.push(executable);
        }
        let running = Running {
            pid: 1,
            executable: installs[0].clone(),
        };
        let mut options = Options {
            enabled: true,
            executable: Some(installs[1].clone()),
            ..Options::default()
        };
        let snapshot = status_with_running(&paths, &options, Ok(Some(running.clone())))
            .await
            .unwrap();
        assert_eq!(snapshot["version"], snapshot["runningVersion"]);
        assert_eq!(snapshot["state"], "pendingUpdate");
        assert_ne!(snapshot["executable"], snapshot["runningExecutable"]);

        let alias = dir.path().join("codexhost-link");
        std::os::unix::fs::symlink(&installs[0], &alias).unwrap();
        options.executable = Some(alias);
        let snapshot = status_with_running(&paths, &options, Ok(Some(running.clone())))
            .await
            .unwrap();
        assert_eq!(snapshot["state"], "running");
        assert_eq!(snapshot["version"], "0.10.2");

        options.enabled = false;
        assert_eq!(
            status_with_running(&paths, &options, Ok(Some(running.clone())))
                .await
                .unwrap()["state"],
            "pendingDisable"
        );
        assert_eq!(
            status_with_running(&paths, &options, Ok(None))
                .await
                .unwrap()["state"],
            "disabled"
        );
        let unknown =
            status_with_running(&paths, &options, Err(anyhow::anyhow!("unknown protocol")))
                .await
                .unwrap();
        assert_eq!(unknown["state"], "error");
        assert_eq!(unknown["error"], "unknown protocol");

        // A process can outlive its installation; a failed metadata read is not a disabled state.
        options.executable = Some(installs[1].clone());
        std::fs::remove_file(dir.path().join("original/app/codexhost-distribution.json")).unwrap();
        let missing = status_with_running(&paths, &options, Ok(Some(running)))
            .await
            .unwrap();
        assert_eq!(missing["state"], "error");
        assert!(!missing["error"].is_null());
    }

    #[tokio::test]
    async fn reads_native_distribution_without_executing_the_launcher() {
        let dir = tempfile::tempdir().unwrap();
        for layout in ["npm", "codexhost.app/Contents"] {
            let root = dir.path().join(layout);
            let bin = root.join(if layout == "npm" { "bin" } else { "MacOS" });
            let resources = if layout == "npm" {
                root.clone()
            } else {
                root.join("Resources")
            };
            std::fs::create_dir_all(&bin).unwrap();
            std::fs::create_dir_all(resources.join("app")).unwrap();
            // Deliberately not executable: version reads cannot start or restart the host.
            let executable = bin.join("codexhost");
            std::fs::write(&executable, b"not executable").unwrap();
            let metadata = resources.join("app/codexhost-distribution.json");
            std::fs::write(&metadata, br#"{"schemaVersion":1,"version":"0.10.2"}"#).unwrap();
            assert_eq!(version(&executable).await.unwrap(), "0.10.2");
            std::fs::write(&metadata, br#"{"schemaVersion":2,"version":"0.10.2"}"#).unwrap();
            assert!(version(&executable).await.is_err());
        }
    }
}
