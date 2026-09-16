// [INPUT]: 正式内嵌资源；debug 程序可显式读取开发资源快照。
// [OUTPUT]: panel_script、development、页面与引导资源的开发替换。
// [POS]: 开发/正式资源边界，release 不读取开发环境变量或磁盘快照。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。

use serde::Deserialize;

#[derive(Deserialize)]
pub struct Development {
    pub revision: String,
    pub page: String,
    pub script: String,
    pub html: String,
    pub boot: String,
    pub client: String,
    #[serde(default = "empty_probe")]
    pub probe: String,
}

fn empty_probe() -> String {
    "null".into()
}

pub fn development() -> Option<Development> {
    #[cfg(debug_assertions)]
    {
        let file = std::env::var_os("CODEX_BUDDY_DEV_ASSETS")?;
        let bytes = std::fs::read(file).ok()?;
        serde_json::from_slice(&bytes).ok()
    }
    #[cfg(not(debug_assertions))]
    None
}

pub fn panel_script() -> String {
    development().map_or_else(|| crate::cdp::PANEL_SCRIPT.to_owned(), |dev| dev.script)
}
