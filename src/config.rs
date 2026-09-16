// [INPUT]: 环境变量、命令参数与独立私有数据目录。
// [OUTPUT]: Config、Paths、默认参数及私有文件读写。
// [POS]: Rust 配置基础层，管理独立的应用数据目录。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

pub const DEFAULT_PORT: u16 = 47831;
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub cdp_endpoint: Option<String>,
    pub target_id: Option<String>,
    pub model: Option<String>,
    pub provider: Option<String>,
    pub base_url: Option<String>,
    pub codex_bin: Option<PathBuf>,
    pub stepwise: crate::settings::Options,
    #[serde(flatten)]
    pub extra: std::collections::BTreeMap<String, serde_json::Value>,
}

#[derive(Clone)]
pub struct Paths {
    pub root: PathBuf,
}

impl Paths {
    pub fn new(root: Option<PathBuf>) -> Result<Self> {
        let root = root
            .or_else(|| std::env::var_os("CODEX_BUDDY_HOME").map(PathBuf::from))
            .unwrap_or(
                dirs::data_local_dir()
                    .context("无法找到用户数据目录")?
                    .join("codex-buddy"),
            );
        let existed = root.exists();
        std::fs::create_dir_all(&root)?;
        {
            use std::os::unix::fs::PermissionsExt;
            if !existed {
                std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))?;
            }
        }
        Ok(Self {
            root: std::fs::canonicalize(root)?,
        })
    }

    pub fn runtime(&self) -> PathBuf {
        self.root.join("runtime.json")
    }
    pub fn config(&self) -> PathBuf {
        self.root.join("config.json")
    }
    pub fn load(&self) -> Result<Config> {
        if !self.config().exists() {
            return Ok(Config::default());
        }
        serde_json::from_slice(&std::fs::read(self.config())?).context("config.json 格式错误")
    }
    pub fn save(&self, config: &Config) -> Result<()> {
        write_private(&self.config(), &serde_json::to_vec_pretty(config)?)
    }
    pub fn load_key(&self) -> Result<Option<String>> {
        let path = self.root.join("secrets.json");
        if !path.exists() {
            return Ok(None);
        }
        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(path)?).context("secrets.json 格式错误")?;
        Ok(value["apiKey"]
            .as_str()
            .filter(|key| !key.is_empty())
            .map(str::to_owned))
    }
    pub fn save_key(&self, key: Option<&str>) -> Result<()> {
        write_private(
            &self.root.join("secrets.json"),
            &serde_json::to_vec(&serde_json::json!({"apiKey":key}))?,
        )
    }
}

pub fn write_private(path: &Path, data: &[u8]) -> Result<()> {
    use std::io::Write;
    let parent = path.parent().context("文件缺少父目录")?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    temp.write_all(data)?;
    temp.as_file().sync_all()?;
    temp.persist(path).map_err(|e| e.error)?;
    Ok(())
}

pub fn local_endpoint(value: &str) -> Result<String> {
    let value = value.trim();
    let raw = if value.bytes().all(|b| b.is_ascii_digit()) {
        format!("http://127.0.0.1:{value}")
    } else {
        value.to_owned()
    };
    let url = reqwest::Url::parse(&raw).context("请输入本机调试端口或 HTTP 地址")?;
    if url.scheme() != "http"
        || !matches!(
            url.host_str(),
            Some("127.0.0.1" | "localhost" | "[::1]" | "::1")
        )
        || url.port().is_none()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        bail!("调试端点必须是带端口的本机 HTTP 地址，例如 http://127.0.0.1:9229");
    }
    Ok(url.as_str().trim_end_matches('/').to_owned())
}

pub fn local_client() -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()
        .expect("local HTTP client")
}

pub fn find_codex() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("CODEX_BUDDY_CODEX_BIN") {
        return Some(PathBuf::from(path));
    }
    for path in [
        "/Applications/ChatGPT.app/Contents/Resources/codex",
        "/Applications/Codex.app/Contents/Resources/codex",
    ] {
        if Path::new(path).is_file() {
            return Some(PathBuf::from(path));
        }
    }
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|dir| dir.join("codex"))
        .find(|path| path.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_accepts_local_debug_endpoints() {
        assert_eq!(local_endpoint("9229").unwrap(), "http://127.0.0.1:9229");
        for value in [
            "https://localhost:9229",
            "http://example.com:9229",
            "http://127.0.0.1:2/x",
            "http://u:p@localhost:3",
            "http://localhost:3/?x=1",
        ] {
            assert!(local_endpoint(value).is_err(), "{value}");
        }
    }
}
