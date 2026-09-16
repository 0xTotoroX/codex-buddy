// [INPUT]: Paths、私有 runtime 信息、系统进程与本地产物。
// [OUTPUT]: start/stop/status/doctor/launch/update 与 Runtime；launch 复用连接或安全启动宿主。
// [POS]: CLI 进程管理层，负责复用服务和本地更新回滚。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。

use crate::config::{self, Paths, VERSION, write_private};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

#[derive(Serialize, Deserialize)]
pub struct Runtime {
    pub pid: u32,
    pub port: u16,
    pub token: String,
    pub version: String,
    pub executable: PathBuf,
}

impl Runtime {
    pub fn read(paths: &Paths) -> Result<Self> {
        serde_json::from_slice(&std::fs::read(paths.runtime())?).context("运行信息无效")
    }
    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}/#token={}", self.port, self.token)
    }
    pub async fn request(&self, path: &str, body: Option<Value>) -> Result<Value> {
        let client = config::local_client();
        let url = format!("http://127.0.0.1:{}/api/{path}", self.port);
        let request = if let Some(body) = body {
            client.post(url).json(&body)
        } else {
            client.get(url)
        };
        let response = request.bearer_auth(&self.token).send().await?;
        let status = response.status();
        let value: Value = response.json().await?;
        if !status.is_success() {
            bail!(
                "{}",
                value["message"].as_str().unwrap_or("本地服务请求失败")
            );
        }
        Ok(value)
    }
    pub async fn alive(&self) -> bool {
        self.request("state", None).await.is_ok()
    }
}

pub async fn start(
    paths: &Paths,
    port: u16,
    endpoint: Option<&str>,
    no_open: bool,
    allow_fixture: bool,
) -> Result<()> {
    start_binary(
        paths,
        port,
        endpoint,
        no_open,
        allow_fixture,
        &std::env::current_exe()?,
    )
    .await
}

async fn start_binary(
    paths: &Paths,
    port: u16,
    endpoint: Option<&str>,
    no_open: bool,
    allow_fixture: bool,
    executable: &Path,
) -> Result<()> {
    if let Ok(runtime) = Runtime::read(paths)
        && runtime.alive().await
    {
        if let Some(endpoint) = endpoint {
            runtime
                .request("connect", Some(json!({"endpoint":endpoint})))
                .await?;
        }
        if !no_open {
            webbrowser::open(&runtime.url()).context("无法自动打开浏览器")?;
        }
        println!("CodexBuddy 已在运行：http://127.0.0.1:{}", runtime.port);
        return Ok(());
    }
    let log_path = paths.root.join("service.log");
    if !log_path.exists() {
        write_private(&log_path, b"")?;
    }
    let log = std::fs::OpenOptions::new().append(true).open(log_path)?;
    let mut command = Command::new(executable);
    command
        .arg("--data-dir")
        .arg(&paths.root)
        .arg("serve")
        .arg("--port")
        .arg(port.to_string());
    if let Some(endpoint) = endpoint {
        command.arg("--cdp").arg(endpoint);
    }
    if allow_fixture {
        command.arg("--allow-fixture");
    }
    command
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log);
    detach(&mut command);
    let mut child = command.spawn().context("无法启动后台服务")?;
    for _ in 0..80 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        if let Ok(runtime) = Runtime::read(paths)
            && runtime.alive().await
        {
            if !no_open {
                webbrowser::open(&runtime.url()).context("服务已启动，但无法自动打开浏览器")?;
            }
            println!("CodexBuddy 已启动：http://127.0.0.1:{}", runtime.port);
            return Ok(());
        }
        if let Some(status) = child.try_wait()? {
            bail!(
                "后台启动失败（{status}），请查看 {}",
                paths.root.join("service.log").display()
            );
        }
    }
    bail!("后台启动超时，请运行 doctor 检查")
}

fn detach(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

pub async fn stop(paths: &Paths) -> Result<()> {
    let Ok(runtime) = Runtime::read(paths) else {
        println!("CodexBuddy 未运行");
        return Ok(());
    };
    if !runtime.alive().await {
        println!("CodexBuddy 未运行（发现旧运行信息）");
        return Ok(());
    }
    runtime.request("shutdown", Some(json!({}))).await?;
    for _ in 0..70 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        if !runtime.alive().await && service_unlocked(paths) {
            println!("CodexBuddy 已停止");
            return Ok(());
        }
    }
    bail!("服务尚未完全停止，请检查 service.log")
}

fn service_unlocked(paths: &Paths) -> bool {
    use fs2::FileExt;
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(paths.root.join("service.lock"))
        .is_ok_and(|file| file.try_lock_exclusive().is_ok())
}

pub async fn status(paths: &Paths) -> Result<()> {
    if let Ok(runtime) = Runtime::read(paths)
        && let Ok(view) = runtime.request("state", None).await
    {
        println!(
            "{}",
            serde_json::to_string_pretty(
                &json!({"running":true,"pid":runtime.pid,"port":runtime.port,"version":runtime.version,"connection":view["connection"],"hasAnswer":view["desktop"]["hasAnswer"],"headings":view["desktop"]["headings"],"model":view["model"]})
            )?
        );
    } else {
        println!("{{\"running\":false}}");
    }
    Ok(())
}

pub async fn doctor(paths: &Paths, endpoint: Option<String>) -> Result<()> {
    let config = paths.load()?;
    let model = crate::model::Model::load(&config).with_key(paths.load_key()?);
    let candidates = endpoint
        .or(config.cdp_endpoint)
        .map(|e| vec![e])
        .unwrap_or_else(|| [9229, 9231, 9329].iter().map(|p| p.to_string()).collect());
    let mut checks = Vec::new();
    for endpoint in candidates {
        let result = crate::cdp::discover(&endpoint, false).await;
        checks.push(json!({"endpoint":endpoint,"reachable":result.is_ok(),"windows":result.as_ref().map(Vec::len).unwrap_or(0)}));
    }
    println!(
        "{}",
        serde_json::to_string_pretty(
            &json!({"version":VERSION,"platform":std::env::consts::OS,"architecture":std::env::consts::ARCH,"dataDirectory":paths.root,"codexBinary":model.binary,"model":model.info(),"desktop":find_desktop(),"cdp":checks})
        )?
    );
    Ok(())
}

fn find_desktop() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("CODEX_BUDDY_DESKTOP_BIN") {
        return Some(PathBuf::from(path));
    }
    for app in [
        "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
        "/Applications/Codex.app/Contents/MacOS/Codex",
    ] {
        if Path::new(app).is_file() {
            return Some(app.into());
        }
    }
    None
}

pub async fn launch(
    paths: &Paths,
    executable: Option<PathBuf>,
    isolated: bool,
    no_open: bool,
) -> Result<()> {
    if let Some(endpoint) = paths.load()?.cdp_endpoint
        && desktop_ready(&endpoint).await
    {
        start(paths, config::DEFAULT_PORT, Some(&endpoint), no_open, false).await?;
        println!("已复用可连接的桌面 Codex");
        return Ok(());
    }
    let executable = executable
        .or_else(find_desktop)
        .context("未找到桌面 Codex，请使用 --app 指定可执行文件")?;
    if !isolated && desktop_running(&executable)? {
        bail!(
            "ChatGPT / Codex 已经打开，但当前未找到可用连接。请在任务结束后用 ⌘Q 退出它，再次打开 CodexBuddy。以后直接从 CodexBuddy 启动即可；当前对话和窗口已保留。"
        )
    }
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    drop(listener);
    let mut command = Command::new(executable);
    command.args([
        "--remote-debugging-address=127.0.0.1",
        &format!("--remote-debugging-port={port}"),
    ]);
    if isolated {
        let profile = paths.root.join("desktop-profile");
        std::fs::create_dir_all(&profile)?;
        command.arg(format!("--user-data-dir={}", profile.display()));
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    detach(&mut command);
    let _child = command.spawn().context("无法启动桌面 Codex")?;
    let endpoint = format!("http://127.0.0.1:{port}");
    for _ in 0..60 {
        tokio::time::sleep(Duration::from_millis(250)).await;
        if desktop_ready(&endpoint).await {
            let mut config = paths.load()?;
            config.cdp_endpoint = Some(endpoint.clone());
            config.target_id = None;
            paths.save(&config)?;
            start(paths, config::DEFAULT_PORT, Some(&endpoint), no_open, false).await?;
            println!("桌面 Codex 调试连接已就绪");
            return Ok(());
        }
    }
    bail!(
        "未能连接新启动的 Codex。请检查应用是否已打开，并稍后再次打开 CodexBuddy。程序没有结束已有 Codex。"
    )
}

fn desktop_running(executable: &Path) -> Result<bool> {
    let executable = std::fs::canonicalize(executable).context("桌面程序路径无效")?;
    let output = Command::new("/bin/ps").args(["-axo", "comm="]).output()?;
    if !output.status.success() {
        bail!("无法检查已打开的桌面程序；未启动新的实例")
    }
    Ok(String::from_utf8_lossy(&output.stdout).lines().any(|line| {
        let path = Path::new(line.trim());
        path == executable || path.canonicalize().is_ok_and(|path| path == executable)
    }))
}

async fn desktop_ready(endpoint: &str) -> bool {
    let Ok(targets) = crate::cdp::discover(endpoint, false).await else {
        return false;
    };
    let Some(target) = targets.first() else {
        return false;
    };
    let Ok(client) = crate::cdp::Client::connect(&target.web_socket_debugger_url).await else {
        return false;
    };
    let ready = client
        .evaluate("!!document.body && document.readyState !== 'loading'".into())
        .await
        .is_ok_and(|value| value == true);
    // Drop this read-only probe without touching the injected capsule owned by a service.
    drop(client);
    ready
}

pub async fn update(paths: &Paths, from: &Path, expected_hash: &str) -> Result<()> {
    let bytes = std::fs::read(from).context("无法读取升级文件")?;
    let actual = format!("{:x}", Sha256::digest(&bytes));
    if actual != expected_hash.to_lowercase() {
        bail!("SHA-256 不匹配，原程序保持不变");
    }
    let result = Command::new(from)
        .arg("--version")
        .output()
        .context("升级文件无法在此平台运行")?;
    if !result.status.success()
        || !String::from_utf8_lossy(&result.stdout).starts_with("codex-buddy ")
    {
        bail!("升级文件不是可运行的 CodexBuddy");
    }
    let current = std::env::current_exe()?;
    let previous = paths.root.join("previous-binary");
    std::fs::copy(&current, &previous).context("无法保留上一版本")?;
    let runtime = Runtime::read(paths).ok();
    let was_running = if let Some(runtime) = &runtime {
        runtime.alive().await
    } else {
        false
    };
    if was_running {
        stop(paths).await?;
    }
    if let Err(error) = replace_binary(&current, &bytes) {
        if was_running {
            let _ = start_binary(
                paths,
                runtime.as_ref().unwrap().port,
                None,
                true,
                false,
                &current,
            )
            .await;
        }
        return Err(error);
    }
    if was_running
        && let Err(error) = start_binary(
            paths,
            runtime.as_ref().unwrap().port,
            None,
            true,
            false,
            &current,
        )
        .await
    {
        replace_binary(&current, &std::fs::read(&previous)?)?;
        let _ = start_binary(
            paths,
            runtime.as_ref().unwrap().port,
            None,
            true,
            false,
            &current,
        )
        .await;
        bail!("新版未能启动，已恢复上一版本：{error}");
    }
    println!(
        "CodexBuddy 已升级，配置已保留。上一版本：{}",
        previous.display()
    );
    Ok(())
}

fn replace_binary(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;
    let mut staging = tempfile::NamedTempFile::new_in(path.parent().context("程序路径错误")?)?;
    staging.write_all(bytes)?;
    staging
        .as_file()
        .set_permissions(std::fs::Permissions::from_mode(0o755))?;
    staging.as_file().sync_all()?;
    staging.persist(path).map_err(|e| e.error)?;
    Ok(())
}
