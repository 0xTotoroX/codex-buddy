// [INPUT]: scripts/build-panel.mjs、ui/panel ES modules 与 ui/bridge/requests.js。
// [OUTPUT]: 校验 macOS arm64 目标，生成 OUT_DIR/panel.js；模型控制资源变化触发 Cargo 重新内嵌。
// [POS]: Cargo 构建入口，调用项目已安装的 Node/esbuild 解析显式依赖。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。

use std::{env, path::PathBuf, process::Command};

fn main() {
    assert!(
        env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos")
            && env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("aarch64"),
        "CodexBuddy currently supports only macOS 14+ on Apple Silicon"
    );
    for path in [
        "ui/panel",
        "ui/model-control",
        "ui/tokens.css",
        "ui/bridge/requests.js",
        "scripts/build-panel.mjs",
        "package-lock.json",
    ] {
        println!("cargo:rerun-if-changed={path}");
    }
    let output = PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("panel.js");
    let status = Command::new("node")
        .arg("scripts/build-panel.mjs")
        .arg(output)
        .status()
        .expect("Node.js is required; install Node and run npm ci before building");
    assert!(
        status.success(),
        "panel module build failed; run npm ci and check imports"
    );
}
