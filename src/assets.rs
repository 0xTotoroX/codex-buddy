// [INPUT]: 正式内嵌资源；debug 程序可显式读取开发资源快照。
// [OUTPUT]: 按路径/inode/大小/修改时间缓存的共享开发快照，panel_script、页面/引导替换与受限设置地址。
// [POS]: 开发/正式资源边界，release 不读取开发环境变量或磁盘快照。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。

use serde::Deserialize;
use std::sync::Arc;

#[derive(Deserialize)]
pub struct Development {
    pub revision: String,
    #[serde(default, rename = "featureRevision")]
    pub feature_revision: String,
    #[serde(default, rename = "featureScript")]
    pub feature_script: String,
    #[serde(default, rename = "featureHtml")]
    pub feature_html: String,
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

pub fn development() -> Option<Arc<Development>> {
    #[cfg(debug_assertions)]
    {
        let file = std::env::var_os("CODEX_BUDDY_DEV_ASSETS")?;
        static CACHE: std::sync::OnceLock<std::sync::Mutex<DevelopmentCache>> =
            std::sync::OnceLock::new();
        CACHE
            .get_or_init(Default::default)
            .lock()
            .ok()?
            .read(file.into())
    }
    #[cfg(not(debug_assertions))]
    None
}

#[cfg(any(debug_assertions, test))]
#[derive(Default)]
struct DevelopmentCache {
    entry: Option<(std::path::PathBuf, std::fs::Metadata, Arc<Development>)>,
}

#[cfg(any(debug_assertions, test))]
impl DevelopmentCache {
    fn read(&mut self, path: std::path::PathBuf) -> Option<Arc<Development>> {
        use std::os::unix::fs::MetadataExt;
        let metadata = std::fs::metadata(&path).ok()?;
        if let Some((previous, stamp, value)) = &self.entry
            && previous == &path
            && stamp.ino() == metadata.ino()
            && stamp.len() == metadata.len()
            && stamp.mtime() == metadata.mtime()
            && stamp.mtime_nsec() == metadata.mtime_nsec()
        {
            return Some(value.clone());
        }
        let bytes = std::fs::read(&path).ok()?;
        let value: Arc<Development> = Arc::new(serde_json::from_slice(&bytes).ok()?);
        self.entry = Some((path, metadata, value.clone()));
        Some(value)
    }
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
    fn development_cache_reuses_bytes_but_reloads_replacements_and_rejects_invalid_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("panel.json");
        let source = |revision| {
            serde_json::json!({"revision":revision,"page":"","script":"script","html":"","boot":"","client":""}).to_string()
        };
        std::fs::write(&path, source("one")).unwrap();
        let mut cache = DevelopmentCache::default();
        let first = cache.read(path.clone()).unwrap();
        assert!(Arc::ptr_eq(&first, &cache.read(path.clone()).unwrap()));
        // The builder publishes atomically; equal byte length must still invalidate the cache.
        let replacement = dir.path().join("next.json");
        std::fs::write(&replacement, source("two")).unwrap();
        std::fs::rename(&replacement, &path).unwrap();
        let second = cache.read(path.clone()).unwrap();
        assert_eq!(second.revision, "two");
        assert!(!Arc::ptr_eq(&first, &second));
        std::fs::write(&path, "incomplete").unwrap();
        assert!(cache.read(path.clone()).is_none());
        std::fs::write(&path, source("new")).unwrap();
        assert_eq!(cache.read(path.clone()).unwrap().revision, "new");
        std::fs::remove_file(&path).unwrap();
        assert!(cache.read(path).is_none());
        std::fs::write(&replacement, source("new")).unwrap();
        assert_eq!(cache.read(replacement).unwrap().revision, "new");
    }

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
    development().map_or_else(
        || crate::cdp::PANEL_SCRIPT.to_owned(),
        |dev| dev.script.clone(),
    )
}
