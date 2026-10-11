// [INPUT]: 官方 GitHub Release 元数据、npm 已校验完整性的原生分发包和独立版本目录。
// [OUTPUT]: 检查更新、准备与验证固定版本；成功后由调用者切换配置，失败保留旧路径。
// [POS]: 复用上游包，不调用会全局覆盖并重启 Codex 的上游 updater。
// [PROTOCOL]: 变更时同步 codex_host/AGENTS.md。
use super::{find_node, find_tool, output, version};
use crate::config::Paths;
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::{path::PathBuf, time::Duration};
pub const BASELINE: &str = "0.10.2";
pub fn version_tuple(value: &str) -> Result<(u64, u64, u64)> {
    let parts: Vec<_> = value.split('.').collect();
    ensure!(
        parts.len() == 3
            && parts
                .iter()
                .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit())),
        "版本号无效"
    );
    Ok((parts[0].parse()?, parts[1].parse()?, parts[2].parse()?))
}
pub async fn check() -> Result<Value> {
    let release: Value = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("CodexBuddy")
        .build()?
        .get("https://api.github.com/repos/BytePioneer-AI/codex-host/releases/latest")
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let version = release["tag_name"]
        .as_str()
        .context("官方版本信息无效")?
        .trim_start_matches('v');
    version_tuple(version)?;
    Ok(
        json!({"version":version,"url":format!("https://github.com/BytePioneer-AI/codex-host/releases/tag/v{version}")}),
    )
}
pub async fn install(paths: &Paths, requested: &str) -> Result<PathBuf> {
    ensure!(
        version_tuple(requested)? >= version_tuple(BASELINE)?,
        "安装版本不能低于 {BASELINE}"
    );
    let node = find_node().context("安装 CodexHost 需要 Node.js 22 或更新版本")?;
    let node_version = output(&node, &["--version"], Duration::from_secs(5)).await?;
    ensure!(
        version_tuple(node_version.trim_start_matches('v'))?.0 >= 22,
        "需要 Node.js 22 或更新版本"
    );
    let root = paths.root.join("codex-host-versions");
    std::fs::create_dir_all(&root)?;
    let target = root.join(requested);
    let relative = "node_modules/@codexhost/cli-darwin-arm64/bin/codexhost";
    if target.exists() {
        let path = target.join(relative);
        ensure!(
            version(&path).await? == requested,
            "已下载版本校验失败，原安装保持不变"
        );
        output(&path, &["inspect"], Duration::from_secs(10)).await?;
        return Ok(path);
    }
    let stage = tempfile::Builder::new()
        .prefix("install-")
        .tempdir_in(&root)?;
    let npm = find_tool("npm").context("未找到 npm，请先安装 Node.js")?;
    let npm = std::fs::canonicalize(npm)?;
    output(
        &node,
        &[
            npm.to_str().context("npm 路径无效")?,
            "install",
            "--prefix",
            stage.path().to_str().context("安装路径无效")?,
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
            "--registry=https://registry.npmjs.org",
            &format!("@codexhost/cli-darwin-arm64@{requested}"),
        ],
        Duration::from_secs(180),
    )
    .await?;
    let path = stage.path().join(relative);
    ensure!(
        version(&path).await? == requested,
        "下载版本不一致，原安装保持不变"
    );
    output(&path, &["inspect"], Duration::from_secs(10))
        .await
        .context("新版本无法识别当前 Codex，原安装保持不变")?;
    std::fs::rename(stage.path(), &target).context("无法保存下载版本，原安装保持不变")?;
    Ok(target.join(relative))
}
