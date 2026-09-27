// [INPUT]: 正式内嵌资源；debug 程序可显式读取开发资源快照。
// [OUTPUT]: panel_script、development、页面与引导资源的开发替换，以及受限的 Dev 设置地址。
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

pub fn settings_url() -> Option<String> {
    #[cfg(debug_assertions)]
    {
        development()?;
        let value = std::env::var("CODEX_BUDDY_DEV_SETTINGS").ok()?;
        validate_settings_url(&value).then_some(value)
    }
    #[cfg(not(debug_assertions))]
    None
}

#[cfg(any(debug_assertions, test))]
fn validate_settings_url(value: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(value) else {
        return false;
    };
    url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == "/"
        && url.query().is_none()
        && url
            .fragment()
            .is_some_and(|fragment| fragment.starts_with("token=") && fragment.len() > 6)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_destination_requires_local_session_url() {
        assert!(validate_settings_url("http://127.0.0.1:12345/#token=test"));
        for invalid in [
            "https://example.com/#token=test",
            "http://127.0.0.1:12345/",
            "http://127.0.0.1:12345/#token=",
            "http://127.0.0.1:12345/?token=test",
            "http://user:password@127.0.0.1:12345/#token=test",
            "http://127.0.0.1:12345/other#token=test",
        ] {
            assert!(!validate_settings_url(invalid), "{invalid}");
        }
    }
}

pub fn panel_script() -> String {
    development().map_or_else(|| crate::cdp::PANEL_SCRIPT.to_owned(), |dev| dev.script)
}
