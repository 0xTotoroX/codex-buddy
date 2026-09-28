// [INPUT]: Runtime lease, current executable and private native request files.
// [OUTPUT]: LaunchServices-managed EventKit helper and serialized DTO requests.
// [POS]: Native transport, isolated from task merge logic and board window.
// [PROTOCOL]: Keep tasks/AGENTS.md and distribution notes in sync.
use crate::{
    config::{Paths, write_private},
    lifecycle::Runtime,
};
use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{path::PathBuf, time::Duration};

pub fn bundle(paths: &Paths) -> Result<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    let folder = paths.root.join("CodexBuddy Reminders.app");
    let contents = folder.join("Contents");
    let binary = contents.join("MacOS/codex-buddy");
    let id = if cfg!(debug_assertions) {
        format!(
            "org.codexbuddy.reminders.dev.{:x}",
            Sha256::digest(paths.root.to_string_lossy().as_bytes())
        )
    } else {
        "org.codexbuddy.reminders".into()
    };
    // UI-only rebuilds must not replace the native permission holder. Its
    // code and dependency inputs define compatibility; default signing stays intact.
    let mut fingerprint = Sha256::new();
    fingerprint.update(id.as_bytes());
    for input in [
        include_str!("native.rs"),
        include_str!("model.rs"),
        include_str!("bridge.rs"),
        include_str!("../main.rs"),
        include_str!("../config.rs"),
        include_str!("../lifecycle.rs"),
        include_str!("../../Cargo.toml"),
        include_str!("../../Cargo.lock"),
        include_str!("../../build.rs"),
        include_str!("../../.cargo/config.toml"),
    ] {
        fingerprint.update(input.as_bytes());
    }
    let native_source = format!("{:x}", fingerprint.finalize());
    let stamp = paths.root.join("reminders-bundle.sha256");
    if let Ok(cache) = std::fs::read(&stamp)
        .and_then(|b| serde_json::from_slice::<Value>(&b).map_err(std::io::Error::other))
        && cache["source"].as_str() == Some(&native_source)
        && cache["bundleId"].as_str() == Some(&id)
        && binary.exists()
    {
        let signed_hash = format!("{:x}", Sha256::digest(std::fs::read(&binary)?));
        if cache["binaryHash"].as_str() == Some(&signed_hash)
            && std::process::Command::new("/usr/bin/codesign")
                .args([
                    "--verify",
                    "--strict",
                    "-R",
                    &format!("=identifier \"{id}\""),
                ])
                .arg(&folder)
                .output()?
                .status
                .success()
        {
            return Ok(folder);
        }
    }
    let bytes = std::fs::read(std::env::current_exe()?)?;
    std::fs::create_dir_all(binary.parent().unwrap())?;
    write_private(&binary, &bytes)?;
    std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755))?;
    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>{id}</string><key>CFBundleExecutable</key><string>codex-buddy</string><key>CFBundleName</key><string>CodexBuddy Reminders</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>LSMinimumSystemVersion</key><string>14.0</string><key>LSUIElement</key><true/><key>NSRemindersFullAccessUsageDescription</key><string>将你选择的提醒事项列表与 CodexBuddy 看板双向同步，任务内容仅在本机处理。</string></dict></plist>"#
    );
    write_private(&contents.join("Info.plist"), plist.as_bytes())?;
    let legacy_stamp = contents.join("source.sha256");
    if legacy_stamp.exists() {
        std::fs::remove_file(legacy_stamp)?;
    }
    let output = std::process::Command::new("/usr/bin/codesign")
        .args(["--force", "--sign", "-", "--identifier", &id])
        .arg(&folder)
        .output()?;
    ensure!(
        output.status.success(),
        "无法签名提醒事项辅助应用：{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let signed_hash = format!("{:x}", Sha256::digest(std::fs::read(&binary)?));
    write_private(
        &stamp,
        &serde_json::to_vec(
            &json!({"source":native_source,"binaryHash":signed_hash,"bundleId":id}),
        )?,
    )?;
    Ok(folder)
}
fn ready(paths: &Paths) -> Option<Value> {
    std::fs::read(paths.root.join("reminders-ready.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
}
fn alive(value: &Value) -> bool {
    value["pid"].as_u64().is_some_and(|pid| {
        std::process::Command::new("/bin/kill")
            .args(["-0", &pid.to_string()])
            .output()
            .is_ok_and(|o| o.status.success())
    })
}
async fn start(paths: &Paths, runtime_token: &str) -> Result<String> {
    let active = std::fs::read_to_string(paths.root.join("reminders-lease")).ok();
    if let Some(current) = ready(paths) {
        if active.as_deref() == current["lease"].as_str()
            && current["runtimeToken"].as_str() == Some(runtime_token)
            && alive(&current)
        {
            return Ok(active.unwrap());
        }
        // The previous instance may be draining an already submitted operation.
        // Never let an old readiness record acknowledge a fresh start.
        for _ in 0..50 {
            if !alive(&current) || ready(paths).is_none() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        ensure!(
            !alive(&current) || ready(paths).is_none(),
            "此前提醒事项操作仍在结束，请稍后重试"
        );
    }
    let paths_copy = paths.clone();
    let app = tokio::task::spawn_blocking(move || bundle(&paths_copy)).await??;
    let lease = uuid::Uuid::new_v4().to_string();
    write_private(&paths.root.join("reminders-lease"), lease.as_bytes())?;
    let output = tokio::process::Command::new("/usr/bin/open")
        .args(["-n", "-g", "-a"])
        .arg(app)
        .args(["--args", "--data-dir"])
        .arg(&paths.root)
        .args([
            "reminders-worker",
            "--lease",
            &lease,
            "--runtime-token",
            runtime_token,
        ])
        .output()
        .await?;
    ensure!(output.status.success(), "无法启动提醒事项辅助应用");
    for _ in 0..100 {
        if ready(paths).is_some_and(|v| v["lease"].as_str() == Some(&lease)) {
            return Ok(lease);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    bail!("提醒事项辅助应用未就绪")
}
pub async fn request(paths: &Paths, mut request: Value) -> Result<Value> {
    let runtime = Runtime::read(paths)?;
    let lease = start(paths, &runtime.token).await?;
    let id = uuid::Uuid::new_v4().to_string();
    request["id"] = json!(id);
    request["lease"] = json!(lease);
    write_private(
        &paths.root.join("reminders-request.json"),
        &serde_json::to_vec(&request)?,
    )?;
    let response_path = paths.root.join("reminders-response.json");
    let until = tokio::time::Instant::now() + Duration::from_secs(130);
    while tokio::time::Instant::now() < until {
        if let Ok(bytes) = std::fs::read(&response_path) {
            let response: Value = serde_json::from_slice(&bytes).context("提醒事项响应无效")?;
            if response["id"] == id {
                std::fs::remove_file(&response_path)?;
                if let Some(error) = response["error"].as_str() {
                    bail!("{error}");
                }
                return Ok(response["value"].clone());
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    bail!("提醒事项未在限时内回应；待确认操作已保留，不能盲目重试创建")
}
pub fn stop(paths: &Paths) {
    let _ = std::fs::remove_file(paths.root.join("reminders-lease"));
}
