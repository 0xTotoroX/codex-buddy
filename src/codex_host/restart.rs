// [INPUT]: 已关闭的 CodexHost 配置、当前宿主身份与 Dev 会话记录。
// [OUTPUT]: 显式重启停用的私有进度；独立协调进程跨越 Dev 的退出清理。
// [POS]: 只协调 Buddy 现有退出/启动入口，不修改上游代码或执行热卸载。
// [PROTOCOL]: 变更时同步 codex_host/AGENTS.md、src/AGENTS.md 与共享状态类型。
use crate::{
    config::{HostRestartPolicy, Paths, write_private},
    host, lifecycle,
    state::App,
};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    process::{Command, Stdio},
    time::Duration,
};

#[derive(Serialize, Deserialize)]
struct Job {
    lease: String,
    worker: u32,
    state: String,
    message: String,
    revision: u64,
    policy: HostRestartPolicy,
    desktop: PathBuf,
    pid: i32,
    identity: String,
    host: super::Running,
    dev: Option<Dev>,
}
#[derive(Serialize, Deserialize)]
struct Dev {
    node: PathBuf,
    controller: PathBuf,
    supervisor: u32,
    source_epoch: String,
}
fn read(paths: &Paths) -> Option<Job> {
    serde_json::from_slice(&std::fs::read(paths.root.join("codex-host-restart.json")).ok()?).ok()
}
fn save(paths: &Paths, job: &Job) -> Result<()> {
    write_private(
        &paths.root.join("codex-host-restart.json"),
        &serde_json::to_vec(job)?,
    )
}
fn ps(pid: u32, format: &str) -> Result<String> {
    let output = Command::new("/bin/ps")
        .args(["-p", &pid.to_string(), "-o", format])
        .output()?;
    ensure!(output.status.success(), "进程已退出");
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}
fn active(job: &Job) -> bool {
    ["queued", "confirming", "restarting"].contains(&job.state.as_str())
        && ps(job.worker, "args=")
            .is_ok_and(|args| args.contains(&format!("codex-host-restart --lease {}", job.lease)))
}
pub fn busy(paths: &Paths) -> bool {
    read(paths).is_some_and(|job| active(&job))
}
pub fn clear(paths: &Paths) -> Result<()> {
    match std::fs::remove_file(paths.root.join("codex-host-restart.json")) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}
pub fn status(paths: &Paths) -> Value {
    read(paths).map_or(Value::Null, |job| {
        if ["queued", "confirming", "restarting"].contains(&job.state.as_str()) && !active(&job) {
            json!({"state":"failed","message":"重启协调进程已退出，请重试；可从 Buddy 重新打开 Codex。"})
        } else {
            json!({"state":job.state,"message":job.message})
        }
    })
}
fn check_config(paths: &Paths, revision: u64) -> Result<()> {
    let config = paths.load()?;
    ensure!(!config.codex_host.enabled, "请先关闭 CodexHost，再重启停用");
    ensure!(
        config.codex_host.revision == revision,
        "CodexHost 设置已更新，请刷新后重试"
    );
    Ok(())
}
fn dev_context(paths: &Paths) -> Result<Option<Dev>> {
    if crate::assets::development().is_none() {
        return Ok(None);
    }
    let record: Value = serde_json::from_slice(&std::fs::read(
        paths
            .root
            .parent()
            .context("Dev 路径无效")?
            .join("session.json"),
    )?)?;
    ensure!(
        record["runtime"].as_str().map(PathBuf::from) == Some(paths.root.clone()),
        "Dev 会话来源不一致"
    );
    let controller = PathBuf::from(record["controller"].as_str().context("缺少 Dev 控制来源")?);
    let owner: Value =
        serde_json::from_slice(&std::fs::read(controller.join("target/dev/owner.json"))?)?;
    let supervisor_id = record["supervisorPid"]
        .as_u64()
        .or_else(|| owner["pid"].as_u64())
        .context("缺少 Dev 进程身份")?;
    ensure!(
        owner["pid"].as_u64() == Some(supervisor_id),
        "Dev 监督进程归属已变化"
    );
    let supervisor = u32::try_from(supervisor_id)?;
    let node = PathBuf::from(ps(supervisor, "comm=")?);
    let args = ps(supervisor, "args=")?;
    let expected = format!(
        "{} {} --no-open --restart-running",
        node.display(),
        controller.join("scripts/dev.mjs").display()
    );
    ensure!(
        [expected.clone(), format!("{expected} --exit-with-host")].contains(&args),
        "此操作需要由 CodexBuddy Dev.app 启动的会话；终端 Dev 请先退出后重新打开"
    );
    ensure!(
        controller.join("scripts/dev-launcher.mjs").is_file(),
        "找不到 Dev 启动入口"
    );
    Ok(Some(Dev {
        node,
        controller,
        supervisor,
        source_epoch: record["sourceEpoch"]
            .as_str()
            .context("缺少 Dev 来源身份")?
            .into(),
    }))
}
pub async fn schedule(app: &App, input: &Value) -> Result<()> {
    let revision = input["expectedRevision"]
        .as_u64()
        .context("缺少 CodexHost 设置版本")?;
    check_config(&app.paths, revision)?;
    let running = super::running()
        .await?
        .context("CodexHost 已停用，无需重启")?;
    let desktop = host::find_desktop().context("找不到 Codex 程序")?;
    let pid = host::desktop_process(&desktop)?.context("Codex 已退出，请从 Buddy 重新打开")?;
    let view = app.view();
    let endpoint = view
        .connection
        .endpoint
        .as_deref()
        .context("Codex 尚未连接")?;
    ensure!(
        host::process_debug_endpoint(pid)?.as_deref() == Some(endpoint),
        "当前连接不属于此 Codex 进程；未退出其他实例"
    );
    // macOS LaunchServices reparents Desktop; PPID cannot identify its launcher.
    let target = crate::cdp::discover(endpoint, false)
        .await?
        .into_iter()
        .find(|target| Some(&target.id) == view.connection.target_id.as_ref())
        .context("当前 Codex 窗口已变化")?;
    let client = crate::cdp::Client::connect(&target.web_socket_debugger_url).await?;
    let injected = client
        .evaluate("Boolean(window.__codexhostRendererBindingProbeV1)".into())
        .await;
    client.close().await;
    ensure!(
        injected? == true,
        "当前 Codex 窗口没有 CodexHost；未退出其他实例"
    );
    let mut job = Job {
        lease: uuid::Uuid::new_v4().to_string(),
        worker: 0,
        state: "queued".into(),
        message: "正在准备重启…".into(),
        revision,
        policy: app.paths.load()?.host_restart_policy,
        identity: ps(pid as u32, "lstart=,comm=")?,
        desktop,
        pid,
        host: running,
        dev: dev_context(&app.paths)?,
    };
    let log = paths_log(&app.paths)?;
    let mut command = Command::new(std::env::current_exe()?);
    command
        .arg("--data-dir")
        .arg(&app.paths.root)
        .arg("codex-host-restart")
        .arg("--lease")
        .arg(&job.lease)
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log);
    lifecycle::detach(&mut command);
    save(&app.paths, &job)?;
    match command.spawn() {
        Ok(mut child) => {
            job.worker = child.id();
            let saved = save(&app.paths, &job);
            // A detached worker survives the backend; reap it when the parent survives.
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            saved?;
        }
        Err(error) => {
            job.state = "failed".into();
            job.message = format!("无法启动重启操作：{error}");
            save(&app.paths, &job)?;
            return Err(error.into());
        }
    }
    Ok(())
}
fn paths_log(paths: &Paths) -> Result<std::fs::File> {
    let path = paths.root.join("codex-host-restart.log");
    if !path.exists() {
        write_private(&path, b"")?;
    }
    Ok(std::fs::OpenOptions::new().append(true).open(path)?)
}
async fn dev_command(dev: &Dev, mode: &str) -> Result<()> {
    let result = tokio::time::timeout(
        Duration::from_secs(150),
        tokio::process::Command::new(&dev.node)
            .arg(dev.controller.join("scripts/dev-launcher.mjs"))
            .arg(mode)
            .current_dir(&dev.controller)
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .context("Dev 启动入口超时")??;
    ensure!(
        result.status.success(),
        "Dev 操作失败：{}",
        String::from_utf8_lossy(&result.stderr).trim()
    );
    Ok(())
}
async fn execute(
    paths: &Paths,
    job: &mut Job,
    confirm: impl FnOnce() -> Result<bool>,
) -> Result<()> {
    job.state = "confirming".into();
    job.message = "等待重启确认…".into();
    save(paths, job)?;
    if !confirm()? {
        job.state = "cancelled".into();
        job.message = "已取消重启，当前会话继续运行。".into();
        return Ok(());
    }
    check_config(paths, job.revision)?;
    ensure!(
        ps(job.pid as u32, "lstart=,comm=")? == job.identity,
        "Codex 进程已变化，请重试；未退出其他实例"
    );
    let running = super::running()
        .await?
        .context("CodexHost 运行身份已变化")?;
    ensure!(
        running.pid == job.host.pid && running.executable == job.host.executable,
        "CodexHost 运行实例已变化"
    );
    job.state = "restarting".into();
    job.message = "正在重启 Codex 并停用…".into();
    save(paths, job)?;
    if let Some(dev) = &job.dev {
        let record: Value = serde_json::from_slice(&std::fs::read(
            dev.controller.join("target/dev/session.json"),
        )?)?;
        ensure!(
            record["supervisorPid"]
                .as_u64()
                .unwrap_or(dev.supervisor as u64)
                == dev.supervisor as u64
                && serde_json::from_slice::<Value>(&std::fs::read(
                    dev.controller.join("target/dev/owner.json")
                )?)?["pid"]
                    .as_u64()
                    == Some(dev.supervisor as u64)
                && record["sourceEpoch"] == dev.source_epoch
                && record["runtime"].as_str().map(PathBuf::from) == Some(paths.root.clone()),
            "Dev 会话或开发来源已变化，请重试"
        );
        if let Err(error) = dev_command(dev, "--stop").await {
            let _ = dev_command(dev, "--open").await;
            let _ = dev_command(dev, "--settings").await;
            return Err(error);
        }
    }
    let result = async {
        check_config(paths, job.revision)?;
        ensure!(
            ps(job.pid as u32, "lstart=,comm=")? == job.identity,
            "Codex 进程已变化，请重试"
        );
        lifecycle::quit_desktop(
            &job.desktop,
            job.pid,
            job.policy == HostRestartPolicy::Force,
            Duration::from_secs(30),
        )
        .await?;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        loop {
            match super::running().await {
                Ok(None) => break,
                Ok(Some(current)) => ensure!(
                    current.pid == job.host.pid && current.executable == job.host.executable,
                    "CodexHost 实例已变化，未重开其他实例"
                ),
                // Controller closes before its launcher removes the descriptor.
                Err(error) => {
                    if ps(job.host.pid, "comm=").ok().map(PathBuf::from)
                        != Some(job.host.executable.clone())
                    {
                        return Err(error);
                    }
                }
            }
            ensure!(
                tokio::time::Instant::now() < deadline,
                "CodexHost 仍在退出，请稍后从 Buddy 重新打开"
            );
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        check_config(paths, job.revision)?;
        // Do not reuse the old injection or invoke the upstream launcher.
        if let Some(dev) = &job.dev {
            dev_command(dev, "--open").await?;
        } else {
            lifecycle::launch(paths, Some(job.desktop.clone()), false, true, false, false).await?;
        }
        ensure!(
            super::running().await?.is_none(),
            "Codex 已重开，但 CodexHost 仍在运行，请检查运行状态"
        );
        Ok::<_, anyhow::Error>(())
    }
    .await;
    // Restore Dev access if quitting was refused or reopening failed.
    if result.is_err()
        && let Some(dev) = &job.dev
    {
        let _ = dev_command(dev, "--open").await;
    }
    if let Some(dev) = &job.dev {
        let _ = dev_command(dev, "--settings").await;
    }
    result?;
    job.state = "completed".into();
    job.message = "Codex 已重启，CodexHost 已停用。".into();
    Ok(())
}
pub async fn run(paths: &Paths, lease: &str) -> Result<()> {
    // Allow the parent to record this worker and return the authenticated API response.
    tokio::time::sleep(Duration::from_millis(300)).await;
    let mut job = read(paths).context("重启记录不存在")?;
    ensure!(
        job.lease == lease && job.worker == std::process::id(),
        "重启操作身份已变化"
    );
    let policy = job.policy;
    if let Err(error) = execute(paths, &mut job, || {
        lifecycle::approve_codex_host_disable(policy)
    })
    .await
    {
        job.state = "failed".into();
        job.message = format!("重启停用失败：{error}");
        eprintln!("{}", job.message);
    }
    save(paths, &job)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn rejects_enabled_or_stale_requests_before_inspecting_processes() {
        let directory = tempfile::tempdir().unwrap();
        let paths = Paths::new(Some(directory.path().into())).unwrap();
        let mut config = crate::config::Config::default();
        config.codex_host.enabled = true;
        paths.save(&config).unwrap();
        let app = App::new(paths.clone(), config.clone(), None, true);
        assert!(
            schedule(&app, &json!({"expectedRevision":0}))
                .await
                .unwrap_err()
                .to_string()
                .contains("先关闭")
        );
        config.codex_host.enabled = false;
        config.codex_host.revision = 1;
        paths.save(&config).unwrap();
        assert!(
            schedule(&app, &json!({"expectedRevision":0}))
                .await
                .unwrap_err()
                .to_string()
                .contains("已更新")
        );
        assert!(!paths.root.join("codex-host-restart.json").exists());
    }
    #[tokio::test]
    async fn cancellation_never_inspects_or_quits_the_host_and_is_reported() {
        let directory = tempfile::tempdir().unwrap();
        let paths = Paths::new(Some(directory.path().into())).unwrap();
        let mut job = Job {
            lease: "fixture".into(),
            worker: std::process::id(),
            state: "queued".into(),
            message: String::new(),
            revision: 0,
            policy: HostRestartPolicy::Ask,
            desktop: PathBuf::from("missing"),
            pid: -1,
            identity: String::new(),
            host: super::super::Running {
                pid: 0,
                executable: PathBuf::from("missing"),
            },
            dev: None,
        };
        execute(&paths, &mut job, || Ok(false)).await.unwrap();
        save(&paths, &job).unwrap();
        assert_eq!(status(&paths)["state"], "cancelled");
        assert!(!busy(&paths));
        assert!(
            execute(&paths, &mut job, || anyhow::bail!("no GUI"))
                .await
                .is_err()
        );
    }
}
