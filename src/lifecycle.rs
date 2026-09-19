// [INPUT]: Paths、私有 runtime 信息、系统进程与本地产物。
// [OUTPUT]: start/stop/status/doctor/launch/update 与 Runtime；host-only 仅准备宿主并输出端点，不启后台或写配置；launch 优先复用连接，显式 --restart-running 按 ask/force 策略重开无连接宿主。
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
    restart_running: bool,
    host_only: bool,
) -> Result<()> {
    if let Some(endpoint) = paths.load()?.cdp_endpoint
        && desktop_ready(&endpoint).await
    {
        return finish_launch(paths, &endpoint, no_open, host_only, false).await;
    }
    let executable = executable
        .or_else(find_desktop)
        .context("未找到桌面 Codex，请使用 --app 指定可执行文件")?;
    if !isolated && let Some(pid) = desktop_process(&executable)? {
        // A host update may change the port; discover the existing process before
        // treating a stale saved endpoint as permission to restart it.
        if let Some(endpoint) = process_debug_endpoint(pid)? {
            for _ in 0..20 {
                if desktop_ready(&endpoint).await {
                    return finish_launch(paths, &endpoint, no_open, host_only, true).await;
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            bail!("Codex 已开启调试端口，但页面尚未就绪。请稍后重试；未重启宿主。")
        }
        if !restart_running {
            bail!(
                "ChatGPT / Codex 已打开但没有调试连接。请从 CodexBuddy App 打开，或使用 launch --restart-running 按启动设置重开；当前应用已保留。"
            )
        }
        let policy = paths.load()?.host_restart_policy;
        if !restart_approved(policy, confirm_desktop_restart)? {
            bail!("已取消重开，ChatGPT 保持运行。")
        }
        quit_desktop(
            &executable,
            pid,
            policy == config::HostRestartPolicy::Force,
            Duration::from_secs(30),
        )
        .await?;
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
            return finish_launch(paths, &endpoint, no_open, host_only, true).await;
        }
    }
    bail!(
        "未能连接新启动的 Codex。请检查应用是否已打开，并稍后再次打开 CodexBuddy；不会继续退出或循环重启。"
    )
}

// Dev uses the same host policy without starting or modifying the installed backend.
async fn finish_launch(
    paths: &Paths,
    endpoint: &str,
    no_open: bool,
    host_only: bool,
    update_target: bool,
) -> Result<()> {
    if host_only {
        println!("{endpoint}");
        return Ok(());
    }
    if update_target {
        let mut config = paths.load()?;
        config.cdp_endpoint = Some(endpoint.to_owned());
        config.target_id = None;
        paths.save(&config)?;
    }
    start(paths, config::DEFAULT_PORT, Some(endpoint), no_open, false).await?;
    println!("桌面 Codex 调试连接已就绪");
    Ok(())
}

fn desktop_process(executable: &Path) -> Result<Option<i32>> {
    let executable = std::fs::canonicalize(executable).context("桌面程序路径无效")?;
    let output = Command::new("/bin/ps")
        .args(["-axo", "pid=,comm="])
        .output()?;
    if !output.status.success() {
        bail!("无法检查已打开的桌面程序；未启动新的实例")
    }
    let mut matches = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Some((pid, path)) = line.trim().split_once(char::is_whitespace) else {
            continue;
        };
        if Path::new(path.trim())
            .canonicalize()
            .is_ok_and(|path| path == executable)
        {
            matches.push(pid.parse::<i32>()?);
        }
    }
    if matches.len() > 1 {
        bail!("发现多个同路径宿主实例，无法确定需要重开的应用；未退出任何实例。")
    }
    Ok(matches.first().copied())
}

fn process_debug_endpoint(pid: i32) -> Result<Option<String>> {
    let output = Command::new("/bin/ps")
        .args(["-p", &pid.to_string(), "-o", "args="])
        .output()?;
    if !output.status.success() {
        bail!("读取宿主进程失败，请重试；未退出应用。")
    }
    let args = String::from_utf8_lossy(&output.stdout);
    if args
        .split_whitespace()
        .any(|arg| arg.starts_with("--user-data-dir"))
    {
        bail!("检测到独立 profile 的宿主，请使用其调试连接；不会自动重开独立实例。")
    }
    Ok(debug_endpoint_from_args(&args))
}

fn debug_endpoint_from_args(args: &str) -> Option<String> {
    let mut args = args.split_whitespace();
    while let Some(arg) = args.next() {
        let value = if arg == "--remote-debugging-port" {
            args.next()
        } else {
            arg.strip_prefix("--remote-debugging-port=")
        };
        if let Some(port) = value
            .and_then(|value| value.parse::<u16>().ok())
            .filter(|port| *port > 0)
        {
            return Some(format!("http://127.0.0.1:{port}"));
        }
    }
    None
}

fn restart_approved(
    policy: config::HostRestartPolicy,
    confirm: impl FnOnce() -> Result<bool>,
) -> Result<bool> {
    match policy {
        config::HostRestartPolicy::Ask => confirm(),
        config::HostRestartPolicy::Force => Ok(true),
    }
}

fn confirm_desktop_restart() -> Result<bool> {
    let output = Command::new("/usr/bin/osascript").args(["-e", r#"
        tell current application
            activate
            set choice to display dialog "ChatGPT / Codex 已打开，但没有调试连接。是否正常退出后重开，以启用 CodexBuddy？正在执行的任务可能中断。" with title "CodexBuddy" buttons {"取消", "退出并重开"} default button "取消"
            return button returned of choice
        end tell
    "#]).output()?;
    if !output.status.success() {
        // A cancelled dialog or an unavailable GUI must never authorize restart.
        if String::from_utf8_lossy(&output.stderr).contains("(-128)") {
            return Ok(false);
        }
        bail!("无法显示重开确认；ChatGPT 保持运行。")
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim() == "退出并重开")
}

async fn quit_desktop(executable: &Path, pid: i32, force: bool, timeout: Duration) -> Result<()> {
    use objc2_app_kit::NSRunningApplication;
    // Recheck identity after the potentially long confirmation dialog.
    if desktop_process(executable)? != Some(pid) {
        bail!("宿主进程已变化，请重新打开 CodexBuddy；未退出其他进程。")
    }
    let app = NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
        .context("无法识别宿主应用；未退出进程。")?;
    if !(if force {
        app.forceTerminate()
    } else {
        app.terminate()
    }) {
        bail!("宿主退出请求未被接受；未尝试强制退出或打开第二个实例。")
    }
    let deadline = tokio::time::Instant::now() + timeout;
    while tokio::time::Instant::now() < deadline {
        if desktop_process(executable)?.is_none() {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    bail!("宿主尚未退出，重开已停止。请处理应用中的提示后重试；不会自动升级为强制退出。")
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

#[cfg(test)]
mod restart_tests {
    use super::*;

    #[tokio::test]
    async fn quits_only_the_selected_fixture_app_and_never_escalates_a_refusal() {
        struct Fixture(std::process::Child);
        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
        let dir = tempfile::tempdir().unwrap();
        let contents = dir.path().join("Restart Fixture.app/Contents");
        std::fs::create_dir_all(contents.join("MacOS")).unwrap();
        std::fs::write(contents.join("Info.plist"), r#"<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.codex-buddy.restart-fixture</string><key>CFBundleExecutable</key><string>fixture</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>"#).unwrap();
        let source = dir.path().join("fixture.m");
        std::fs::write(&source, r#"
#import <Cocoa/Cocoa.h>
@interface Delegate : NSObject <NSApplicationDelegate>
@end
@implementation Delegate
- (void)applicationDidFinishLaunching:(NSNotification *)note {
    [@"ready" writeToFile:[NSString stringWithUTF8String:getenv("READY_FILE")] atomically:YES encoding:NSUTF8StringEncoding error:nil];
}
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)app {
    [@"requested" writeToFile:[NSString stringWithUTF8String:getenv("QUIT_FILE")] atomically:YES encoding:NSUTF8StringEncoding error:nil];
    return getenv("REFUSE_QUIT") ? NSTerminateCancel : NSTerminateNow;
}
@end
int main(void) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        Delegate *delegate = [Delegate new];
        [app setDelegate:delegate];
        [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
        [app run];
    }
    return 0;
}
"#).unwrap();
        let executable = contents.join("MacOS/fixture");
        let build = Command::new("/usr/bin/clang")
            .args(["-framework", "Cocoa", "-w"])
            .arg(&source)
            .arg("-o")
            .arg(&executable)
            .output()
            .unwrap();
        assert!(
            build.status.success(),
            "{}",
            String::from_utf8_lossy(&build.stderr)
        );
        for (name, force, refuse) in [
            ("normal", false, false),
            ("force", true, false),
            ("refuse", false, true),
        ] {
            let ready = dir.path().join(format!("{name}-ready"));
            let quit = dir.path().join(format!("{name}-quit"));
            let mut cmd = Command::new(&executable);
            cmd.env("READY_FILE", &ready)
                .env("QUIT_FILE", &quit)
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            if refuse {
                cmd.env("REFUSE_QUIT", "1");
            }
            let mut child = Fixture(cmd.spawn().unwrap());
            for _ in 0..100 {
                if ready.exists() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            assert!(ready.exists(), "fixture did not launch");
            let result = quit_desktop(
                &executable,
                child.0.id() as i32,
                force,
                Duration::from_secs(2),
            )
            .await;
            if refuse {
                assert!(result.is_err());
                assert!(
                    child.0.try_wait().unwrap().is_none(),
                    "normal quit must not escalate"
                );
                assert!(quit.exists());
            } else {
                assert!(result.is_ok(), "{name}: {result:?}");
                assert_eq!(
                    quit.exists(),
                    !force,
                    "only normal quit invokes the delegate"
                );
            }
        }
    }

    #[tokio::test]
    async fn host_only_reuses_ready_host_without_backend_or_config_changes() {
        use futures_util::{SinkExt, StreamExt};
        use serde_json::json;
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(Some(dir.path().to_owned())).unwrap();
        let socket = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let websocket = format!("ws://{}", socket.local_addr().unwrap());
        let probe = tokio::spawn(async move {
            let (stream, _) = socket.accept().await.unwrap();
            let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
            let request = ws.next().await.unwrap().unwrap().into_text().unwrap();
            let request: serde_json::Value = serde_json::from_str(&request).unwrap();
            assert_eq!(request["method"], "Runtime.evaluate");
            ws.send(tokio_tungstenite::tungstenite::Message::Text(
                json!({
                    "id": request["id"], "result": {"result": {"value": true}}
                })
                .to_string()
                .into(),
            ))
            .await
            .unwrap();
        });
        let http = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}", http.local_addr().unwrap());
        let router = axum::Router::new().route("/json/list", axum::routing::get(move || async move {
            axum::Json(json!([{"id":"fixture", "title":"Synthetic", "type":"page", "url":"app://-/index.html", "webSocketDebuggerUrl":websocket}]))
        }));
        let http_task = tokio::spawn(async move {
            axum::serve(http, router).await.unwrap();
        });
        let config = config::Config {
            cdp_endpoint: Some(endpoint),
            target_id: Some("original".into()),
            ..Default::default()
        };
        paths.save(&config).unwrap();
        let before = std::fs::read(paths.root.join("config.json")).unwrap();
        let result = launch(
            &paths,
            Some(dir.path().join("must-not-be-started")),
            false,
            true,
            true,
            true,
        )
        .await;
        http_task.abort();
        assert!(result.is_ok(), "{result:?}");
        probe.await.unwrap();
        assert_eq!(
            std::fs::read(paths.root.join("config.json")).unwrap(),
            before
        );
        assert!(!paths.root.join("runtime.json").exists());
    }

    #[test]
    fn cancellation_and_failed_confirmation_never_authorize_restart() {
        assert!(!restart_approved(config::HostRestartPolicy::Ask, || Ok(false)).unwrap());
        assert!(restart_approved(config::HostRestartPolicy::Ask, || bail!("no GUI")).is_err());
        assert!(restart_approved(config::HostRestartPolicy::Ask, || Ok(true)).unwrap());
        assert!(
            restart_approved(config::HostRestartPolicy::Force, || panic!(
                "must not prompt"
            ))
            .unwrap()
        );
    }

    #[test]
    fn discovers_changed_debug_ports_from_process_arguments() {
        assert_eq!(
            debug_endpoint_from_args(
                "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT --remote-debugging-port=51952"
            ),
            Some("http://127.0.0.1:51952".into())
        );
        assert_eq!(
            debug_endpoint_from_args("a path with spaces --remote-debugging-port 9229"),
            Some("http://127.0.0.1:9229".into())
        );
        for args in [
            "--remote-debugging-port=0",
            "--remote-debugging-port=70000",
            "--remote-debugging-port=bad",
            "--fake-remote-debugging-port=9229",
        ] {
            assert!(debug_endpoint_from_args(args).is_none());
        }
    }
}
