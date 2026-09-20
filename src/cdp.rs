// [INPUT]: 本机 CDP 端点、WebSocket、assets 胶囊脚本与受限 binding。
// [OUTPUT]: 目标发现、Client 请求/事件/注入及开发实例归属检查；独立模型适配器的文档生命周期与有界执行。
// [POS]: 宿主连接基础层，被 state.rs 和 requests.rs 使用。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。

use anyhow::{Context, Result, anyhow, bail};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::sync::{Mutex, mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message;

pub const PANEL_SCRIPT: &str = include_str!(concat!(env!("OUT_DIR"), "/panel.js"));

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub id: String,
    pub title: String,
    pub url: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing)]
    pub web_socket_debugger_url: String,
}

pub async fn discover(endpoint: &str, allow_fixture: bool) -> Result<Vec<Target>> {
    let endpoint = crate::config::local_endpoint(endpoint)?;
    let response = crate::config::local_client()
        .get(format!("{endpoint}/json/list"))
        .send()
        .await
        .context("无法连接调试端点，请确认 Codex 已通过调试入口启动")?
        .error_for_status()?;
    let targets: Vec<Target> = response
        .json()
        .await
        .context("该端口没有返回 CDP 窗口列表")?;
    Ok(targets
        .into_iter()
        .filter(|t| is_codex_target(t, allow_fixture))
        .collect())
}

fn is_codex_target(target: &Target, allow_fixture: bool) -> bool {
    if target.kind != "page" {
        return false;
    }
    if let Ok(url) = reqwest::Url::parse(&target.url) {
        if url.scheme() == "app" && url.host_str() == Some("-") && url.path() == "/index.html" {
            return !url.query_pairs().any(|(key, value)| {
                key == "initialRoute" && (value.contains("overlay") || value.contains("settings"))
            });
        }
        return allow_fixture
            && url.scheme() == "http"
            && url.host_str() == Some("127.0.0.1")
            && url.path() == "/fixture";
    }
    false
}

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;
enum Outbound {
    Request(Value),
    Close,
}

pub struct Client {
    sender: mpsc::Sender<Outbound>,
    pending: Pending,
    sequence: AtomicU64,
    closed: Arc<AtomicBool>,
    events: Mutex<Option<mpsc::Receiver<Value>>>,
    script_id: Mutex<Option<String>>,
    model_control_script_id: Mutex<Option<String>>,
    dev_revision: Mutex<String>,
    desktop_installed: AtomicBool,
}

impl Client {
    pub async fn connect(url: &str) -> Result<Arc<Self>> {
        let parsed = reqwest::Url::parse(url)?;
        if parsed.scheme() != "ws"
            || !matches!(
                parsed.host_str(),
                Some("127.0.0.1" | "localhost" | "[::1]" | "::1")
            )
        {
            bail!("拒绝非本机 WebSocket 目标");
        }
        let (socket, _) = tokio::time::timeout(
            Duration::from_secs(4),
            tokio_tungstenite::connect_async(url),
        )
        .await??;
        let (mut write, mut read) = socket.split();
        let (sender, mut receiver) = mpsc::channel(32);
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let closed = Arc::new(AtomicBool::new(false));
        let (events_tx, events_rx) = mpsc::channel(32);
        let client = Arc::new(Self {
            sender,
            pending: pending.clone(),
            sequence: AtomicU64::new(1),
            closed: closed.clone(),
            events: Mutex::new(Some(events_rx)),
            script_id: Mutex::new(None),
            model_control_script_id: Mutex::new(None),
            dev_revision: Mutex::new(String::new()),
            desktop_installed: AtomicBool::new(false),
        });
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    outgoing = receiver.recv() => match outgoing {
                        Some(Outbound::Request(value)) => if write.send(Message::Text(value.to_string().into())).await.is_err() { break; },
                        _ => { let _ = write.close().await; break; }
                    },
                    incoming = read.next() => match incoming {
                        Some(Ok(Message::Text(text))) => {
                            if let Ok(value) = serde_json::from_str::<Value>(&text) {
                                if let Some(id) = value["id"].as_u64()
                                    && let Some(reply) = pending.lock().await.remove(&id) {
                                    let result = if value.get("error").is_some() { Err("Codex 调试命令失败，可能正在刷新页面".to_owned()) } else { Ok(value["result"].clone()) };
                                    let _ = reply.send(result);
                                } else if value["method"] == "Runtime.bindingCalled" && value["params"]["name"] == "__companionHostRequest" {
                                    let _ = events_tx.try_send(value["params"].clone());
                                }
                            }
                        },
                        Some(Ok(Message::Ping(payload))) if write.send(Message::Pong(payload.clone())).await.is_err() => break,
                        Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                        _ => {}
                    }
                }
            }
            closed.store(true, Ordering::SeqCst);
            for (_, reply) in pending.lock().await.drain() {
                let _ = reply.send(Err("Codex 连接已关闭".into()));
            }
        });
        Ok(client)
    }

    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value> {
        self.request_with_timeout(method, params, Duration::from_secs(5))
            .await
    }

    async fn request_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value> {
        if self.is_closed() {
            bail!("Codex 连接已关闭");
        }
        let id = self.sequence.fetch_add(1, Ordering::SeqCst);
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(id, sender);
        if self
            .sender
            .send(Outbound::Request(
                json!({"id":id,"method":method,"params":params}),
            ))
            .await
            .is_err()
        {
            self.pending.lock().await.remove(&id);
            bail!("Codex 连接已关闭");
        }
        let result = tokio::time::timeout(timeout, receiver).await;
        self.pending.lock().await.remove(&id);
        result
            .context("Codex 页面响应超时")?
            .context("Codex 请求已取消")?
            .map_err(|error| anyhow!(error))
    }

    pub async fn evaluate(&self, expression: String) -> Result<Value> {
        self.evaluate_with_timeout(expression, Duration::from_secs(5))
            .await
    }

    pub async fn evaluate_with_timeout(
        &self,
        expression: String,
        timeout: Duration,
    ) -> Result<Value> {
        let result = self
            .request_with_timeout(
                "Runtime.evaluate",
                json!({"expression":expression,"returnByValue":true,"awaitPromise":true}),
                timeout,
            )
            .await?;
        if result.get("exceptionDetails").is_some() {
            bail!("当前 Codex 页面结构不兼容，已停止操作");
        }
        Ok(result["result"]["value"].clone())
    }

    pub async fn desktop_status(&self, detached: bool, ui: Value, revision: u64) -> Result<Value> {
        if let Some(dev) = crate::assets::development() {
            if self.evaluate("Boolean(window.__companionFloatingPanel && !window.__companionFloatingPanel.development)".into()).await? == true {
                bail!("窗口已由其他胶囊接管，开发版停止覆盖");
            }
            let mut revision = self.dev_revision.lock().await;
            if *revision != dev.revision {
                let mut installed = self.script_id.lock().await;
                if let Some(identifier) = installed.take() {
                    self.request(
                        "Page.removeScriptToEvaluateOnNewDocument",
                        json!({"identifier":identifier}),
                    )
                    .await?;
                }
                let result = self
                    .request(
                        "Page.addScriptToEvaluateOnNewDocument",
                        json!({"source":dev.script}),
                    )
                    .await?;
                *installed = result["identifier"].as_str().map(str::to_owned);
                self.evaluate(dev.script).await?;
                *revision = dev.revision;
            }
        }
        let expression = format!(
            "(() => {{const p=window.__companionFloatingPanel; if (!window.__companionDesktop || !p || p.state.destroyed) return null; p.syncPanelPreferences({ui}, {revision}, {detached}); return {{desktop:p.desktopStatus(),ui:p.panelPreferences(),theme:p.state.theme,fontBase:p.state.hostTypography.baseItemFontSize}};}})()"
        );
        let mut value = self.evaluate(expression.clone()).await?;
        if value.is_null() {
            self.evaluate(crate::assets::panel_script()).await?;
            value = self.evaluate(expression).await?;
        }
        Ok(value)
    }

    pub async fn install_desktop(
        self: &Arc<Self>,
        app: std::sync::Weak<crate::state::App>,
    ) -> Result<()> {
        if crate::assets::development().is_some()
            && self
                .evaluate("Boolean(window.__companionDesktop)".into())
                .await?
                == true
        {
            bail!("目标窗口已有胶囊实例，开发版未覆盖它");
        }
        self.request("Runtime.enable", json!({})).await?;
        self.request("Page.enable", json!({})).await?;
        let model_script = include_str!("../ui/model-control/host.js");
        let installed_model = self
            .request(
                "Page.addScriptToEvaluateOnNewDocument",
                json!({"source":model_script}),
            )
            .await?;
        *self.model_control_script_id.lock().await =
            installed_model["identifier"].as_str().map(str::to_owned);
        self.evaluate(model_script.into()).await?;
        self.request(
            "Runtime.addBinding",
            json!({"name":"__companionHostRequest"}),
        )
        .await?;
        self.desktop_installed.store(true, Ordering::SeqCst);
        let events = self
            .events
            .lock()
            .await
            .take()
            .context("桌面连接已经安装")?;
        crate::requests::listen(Arc::downgrade(self), app, events);
        let installed = self
            .request(
                "Page.addScriptToEvaluateOnNewDocument",
                json!({"source":crate::assets::panel_script()}),
            )
            .await?;
        *self.script_id.lock().await = installed["identifier"].as_str().map(str::to_owned);
        self.evaluate(crate::assets::panel_script()).await?;
        Ok(())
    }

    pub async fn close(&self) {
        if !self.is_closed() {
            if let Some(identifier) = self.model_control_script_id.lock().await.take() {
                let _ = self
                    .evaluate("window.__codexBuddyModelControl?.dispose(); true".into())
                    .await;
                let _ = self
                    .request(
                        "Page.removeScriptToEvaluateOnNewDocument",
                        json!({"identifier":identifier}),
                    )
                    .await;
            }
            if let Some(identifier) = self.script_id.lock().await.take() {
                let _ = self
                    .request(
                        "Page.removeScriptToEvaluateOnNewDocument",
                        json!({"identifier":identifier}),
                    )
                    .await;
            }
            let owned = self.desktop_installed.swap(false, Ordering::SeqCst)
                && (crate::assets::development().is_none()
                    || self.evaluate("!window.__companionFloatingPanel || window.__companionFloatingPanel.development === true".into()).await.ok() == Some(json!(true)));
            if owned {
                let _ = self
                    .evaluate("window.__companionDesktop?.destroy(); true".into())
                    .await;
                let _ = self
                    .request(
                        "Runtime.removeBinding",
                        json!({"name":"__companionHostRequest"}),
                    )
                    .await;
            }
        }
        let _ = self.sender.send(Outbound::Close).await;
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        let _ = self.sender.try_send(Outbound::Close);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn excludes_avatar_and_unrelated_pages() {
        let target = |url: &str| Target {
            id: "x".into(),
            title: "Codex".into(),
            url: url.into(),
            kind: "page".into(),
            web_socket_debugger_url: String::new(),
        };
        assert!(is_codex_target(&target("app://-/index.html"), false));
        assert!(!is_codex_target(
            &target("app://-/index.html?initialRoute=%2Favatar-overlay"),
            false
        ));
        assert!(!is_codex_target(&target("https://chatgpt.com"), false));
        assert!(!is_codex_target(
            &target("http://127.0.0.1:8080/fixture"),
            false
        ));
        assert!(is_codex_target(
            &target("http://127.0.0.1:8080/fixture"),
            true
        ));
    }
}
