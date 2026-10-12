// [INPUT]: CDP Client、Config、Model 与胶囊状态摘要。
// [OUTPUT]: App、View、连接与无正文胶囊状态与共享字体快照；临时响应超时保留会话并恢复连接状态；退出信号取消模型请求，开发模式锁定启动窗口。
// [POS]: 持有独立 tasks 服务； 后台业务状态层，为 server、requests 与 panel 提供一致状态；独立维护模型控制条服务及窗口监督。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。

use crate::{
    cdp::{Client, Target},
    config::{Config, Paths},
    model::{Model, ModelInfo},
};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::{Mutex, Notify, RwLock, watch};

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopStatus {
    pub has_answer: bool,
    pub headings: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub status: String,
    pub message: String,
    pub endpoint: Option<String>,
    pub target_id: Option<String>,
    pub targets: Vec<Target>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub version: String,
    pub connection: Connection,
    pub desktop: DesktopStatus,
    pub model: ModelInfo,
    pub updated_at: u64,
    pub configuration_revision: u64,
    pub panel_preferences: crate::panel::Preferences,
    pub panel_theme: Option<String>,
    pub panel_font_base: f64,
    pub panel_colors: Value,
    pub panel_typography: Value,
}

#[derive(Clone)]
struct Session {
    client: Arc<Client>,
}

#[derive(Clone)]
struct Desired {
    endpoint: Option<String>,
    target_id: Option<String>,
    enabled: bool,
}

pub struct App {
    pub(crate) surfaces: Mutex<crate::surfaces::Surfaces>,
    pub(crate) features: Mutex<crate::features::Features>,
    pub(crate) feature_operation: Mutex<()>,
    pub(crate) codex_host_operation: Mutex<()>,
    pub(crate) terminology_operation: Mutex<()>,
    pub tasks: Arc<crate::tasks::Service>,
    pub views: watch::Sender<View>,
    pub shutdown: Notify,
    pub closing: watch::Sender<bool>,
    pub paths: Paths,
    pub(crate) panel: Mutex<crate::panel::Panel>,
    pub(crate) model_control: Mutex<crate::model_control::Control>,
    pub(crate) model: RwLock<Model>,
    pub(crate) config: Mutex<Config>,
    pub(crate) settings_revision: std::sync::atomic::AtomicU64,
    pub(crate) generation_revision: std::sync::atomic::AtomicU64,
    session: RwLock<Option<Session>>,
    desired: RwLock<Desired>,
    pub(crate) transition: Mutex<()>,
    allow_fixture: bool,
}

impl App {
    pub fn new(
        paths: Paths,
        config: Config,
        endpoint: Option<String>,
        allow_fixture: bool,
    ) -> Arc<Self> {
        let desired = Desired {
            endpoint: endpoint.clone().or(config.cdp_endpoint.clone()),
            target_id: if endpoint.is_some() {
                None
            } else {
                config.target_id.clone()
            },
            enabled: true,
        };
        let model = Model::load(&config)
            .with_key(paths.load_key().ok().flatten())
            .with_jev_key(paths.load_named_key("jevApiKey").ok().flatten());
        let (views, _) = watch::channel(View {
            version: crate::config::VERSION.into(),
            connection: Connection {
                status: "disconnected".into(),
                message: "正在寻找桌面 Codex…".into(),
                endpoint: desired.endpoint.clone(),
                target_id: None,
                targets: Vec::new(),
            },
            desktop: DesktopStatus::default(),
            model: model.info(),
            updated_at: now(),
            configuration_revision: 1,
            panel_preferences: crate::panel::Preferences::read(&paths),
            panel_theme: None,
            panel_font_base: 13.,
            panel_colors: json!({}),
            panel_typography: Value::Null,
        });
        Arc::new(Self {
            surfaces: Mutex::new(crate::surfaces::Surfaces::load(&paths)),
            features: Mutex::new(crate::features::Features::load(&paths)),
            feature_operation: Mutex::new(()),
            codex_host_operation: Mutex::new(()),
            terminology_operation: Mutex::new(()),
            tasks: crate::tasks::Service::load(&paths),
            views,
            shutdown: Notify::new(),
            closing: watch::channel(false).0,
            panel: Mutex::new(crate::panel::Panel::load(&paths, allow_fixture)),
            model_control: Mutex::new(crate::model_control::Control::load(&paths)),
            paths,
            desired: RwLock::new(desired),
            model: RwLock::new(model),
            settings_revision: std::sync::atomic::AtomicU64::new(1),
            generation_revision: std::sync::atomic::AtomicU64::new(1),
            config: Mutex::new(config),
            session: RwLock::new(None),
            transition: Mutex::new(()),
            allow_fixture,
        })
    }

    pub(crate) async fn until_shutdown<T>(
        &self,
        request: impl std::future::Future<Output = Result<T>>,
    ) -> Result<T> {
        let mut closing = self.closing.subscribe();
        tokio::select! {
            biased;
            _ = closing.wait_for(|value| *value) => anyhow::bail!("服务正在退出，请求已取消"),
            result = request => result,
        }
    }

    pub fn view(&self) -> View {
        self.views.borrow().clone()
    }

    pub fn supervise(self: Arc<Self>) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(750));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let mut attempts = 0;
            loop {
                interval.tick().await;
                self.supervise_features().await;
                self.supervise_panel().await;
                let prefs = self.appearance().await;
                self.views.send_if_modified(|view| {
                    if view.panel_preferences == prefs {
                        return false;
                    }
                    view.panel_preferences = prefs;
                    true
                });
                let session = self.session.read().await.clone();
                if session.is_some() {
                    let guard = self.transition.lock().await;
                    if let Err(error) = self.refresh().await {
                        self.handle_refresh_failure(&error).await;
                    }
                    drop(guard);
                } else {
                    attempts += 1;
                    if attempts % 4 == 1 && self.desired.read().await.enabled {
                        let _guard = self.transition.lock().await;
                        let desired = self.desired.read().await.clone();
                        if let Err(error) = self.establish(&desired).await {
                            tracing::debug!(error = %error, "宿主连接建立失败");
                            self.update_connection(
                                "disconnected",
                                "未发现可连接的 Codex。请通过调试启动入口打开，或指定本机端口。",
                            );
                        }
                    }
                }
            }
        })
    }

    fn update_connection(&self, status: &str, message: &str) {
        self.views.send_if_modified(|view| {
            if view.connection.status == status && view.connection.message == message {
                return false;
            }
            view.connection.status = status.into();
            view.connection.message = message.into();
            view.updated_at = now();
            true
        });
    }

    async fn handle_refresh_failure(&self, error: &anyhow::Error) {
        tracing::debug!(%error, "宿主状态刷新失败");
        if error.is::<tokio::time::error::Elapsed>()
            && self
                .desktop_client()
                .await
                .is_some_and(|client| !client.is_closed())
        {
            self.update_connection(
                "unresponsive",
                "Codex 页面暂未响应，保留当前界面并等待恢复…",
            );
            return;
        }
        self.clear_connection("disconnected", "Codex 连接中断，正在重连…")
            .await;
    }

    async fn establish(self: &Arc<Self>, desired: &Desired) -> Result<()> {
        let pinned = self.allow_fixture
            || crate::assets::development().is_some()
            || desired.target_id.is_some();
        let endpoints = crate::host::endpoints(desired.endpoint.as_deref(), pinned)?;
        let mut found = None;
        for endpoint in endpoints {
            if let Ok(targets) = crate::cdp::discover(&endpoint, self.allow_fixture).await
                && !targets.is_empty()
            {
                found = Some((endpoint, targets));
                break;
            }
        }
        let (endpoint, targets) = found.context("没有发现可连接的 Codex 窗口")?;
        let target = if let Some(id) = &desired.target_id {
            targets
                .iter()
                .find(|target| &target.id == id)
                .context("所选 Codex 窗口已关闭，请重新选择窗口")?
        } else {
            &targets[0]
        };
        let client = Client::connect(&target.web_socket_debugger_url).await?;
        {
            let mut config = self.config.lock().await;
            if config.cdp_endpoint.as_deref() != Some(endpoint.as_str())
                || config.target_id != desired.target_id
            {
                config.cdp_endpoint = Some(endpoint.clone());
                config.target_id = desired.target_id.clone();
                self.paths.save(&config)?;
            }
        }
        let session = Session {
            client: client.clone(),
        };
        *self.session.write().await = Some(session);
        if let Err(error) = client.install_desktop(Arc::downgrade(self)).await {
            self.clear_connection("disconnected", "桌面浮窗安装失败，正在等待重连…")
                .await;
            return Err(error);
        }
        self.views.send_modify(|view| {
            view.connection = Connection {
                status: "connected".into(),
                message: "已连接桌面 Codex".into(),
                endpoint: Some(endpoint),
                target_id: Some(target.id.clone()),
                targets: targets.clone(),
            };
            view.desktop = DesktopStatus::default();
            view.updated_at = now();
        });
        Ok(())
    }

    pub async fn connect(
        self: &Arc<Self>,
        endpoint: Option<String>,
        target_id: Option<String>,
    ) -> Result<()> {
        let endpoint = endpoint
            .filter(|value| !value.trim().is_empty())
            .map(|value| crate::config::local_endpoint(&value))
            .transpose()?;
        if crate::assets::development().is_some() {
            let desired = self.desired.read().await;
            if endpoint != desired.endpoint || target_id != desired.target_id {
                anyhow::bail!("开发模式锁定启动时的真实窗口；切换窗口请退出后用 --target 重启。");
            }
        }
        let _guard = self.transition.lock().await;
        self.clear_connection("connecting", "正在连接桌面 Codex…")
            .await;
        let desired = Desired {
            endpoint,
            target_id,
            enabled: true,
        };
        *self.desired.write().await = desired.clone();
        match self.establish(&desired).await {
            Ok(()) => Ok(()),
            Err(error) => {
                self.update_connection("disconnected", "连接失败，请检查调试端口和 Codex 窗口。");
                Err(error)
            }
        }
    }

    async fn clear_connection(&self, status: &str, message: &str) {
        let old = self.session.write().await.take();
        if let Some(old) = old {
            old.client.close().await;
        }
        self.views.send_modify(|view| {
            view.connection.status = status.into();
            view.connection.message = message.into();
            view.connection.target_id = None;
            view.desktop = DesktopStatus::default();
            view.updated_at = now();
        });
    }

    pub async fn disconnect(&self) {
        let _guard = self.transition.lock().await;
        self.desired.write().await.enabled = false;
        self.clear_connection("disconnected", "已断开连接，点击连接可继续。")
            .await;
    }

    pub(crate) async fn sync_desktop_settings(&self, settings: &Value) {
        let session = self.session.read().await.clone();
        if let Some(session) = session {
            let _ = session
                .client
                .evaluate(format!(
                    "window.__companionFloatingPanel?.syncSettings({settings}); true"
                ))
                .await;
        }
    }

    pub(crate) async fn desktop_client(&self) -> Option<Arc<Client>> {
        self.session
            .read()
            .await
            .as_ref()
            .map(|session| session.client.clone())
    }

    async fn refresh(&self) -> Result<()> {
        let client = self.desktop_client().await.context("尚未连接 Codex")?;
        let (detached, ui, revision, web_revision) = self.panel_host_state().await;
        let launcher_action = json!(self.panel.lock().await.prefs.launcher_action);
        let typography = json!(self.panel.lock().await.prefs.typography);
        let result = client
            .desktop_status(detached, ui, web_revision, launcher_action, typography)
            .await?;
        self.observe_panel_ui(revision, result["ui"].clone())
            .await?;
        let desktop = serde_json::from_value(result["desktop"].clone())?;
        let theme = result["theme"].as_str().map(String::from);
        let colors = result["colors"].clone();
        let font_base = result["fontBase"].as_f64().unwrap_or(13.);
        let typography = result["typography"].clone();
        self.views.send_if_modified(|view| {
            if view.desktop == desktop
                && view.panel_theme == theme
                && view.panel_font_base == font_base
                && view.panel_colors == colors
                && (!typography.is_object() || view.panel_typography == typography)
                && view.connection.status == "connected"
            {
                return false;
            }
            view.desktop = desktop;
            view.panel_theme = theme;
            view.panel_font_base = font_base;
            view.panel_colors = colors;
            if typography.is_object() {
                view.panel_typography = typography;
            }
            view.connection.status = "connected".into();
            view.connection.message = "已连接桌面 Codex".into();
            view.updated_at = now();
            true
        });
        Ok(())
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod connection_tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use tokio::net::TcpListener;
    use tokio_tungstenite::{accept_async, tungstenite::Message};

    #[tokio::test]
    async fn response_timeout_preserves_session_then_fresh_reply_restores_status() {
        let temp = tempfile::tempdir().unwrap();
        let app = App::new(
            Paths::new(Some(temp.path().into())).unwrap(),
            Config::default(),
            None,
            true,
        );
        let ui = json!(app.appearance().await.ui);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("ws://{}", listener.local_addr().unwrap());
        let (close, closed) = tokio::sync::oneshot::channel();
        let peer = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            let first: Value =
                serde_json::from_str(socket.next().await.unwrap().unwrap().to_text().unwrap())
                    .unwrap();
            // The delayed response must be discarded, not mistaken for the next read.
            tokio::time::sleep(Duration::from_millis(100)).await;
            socket
                .send(Message::Text(
                    json!({"id":first["id"],"result":{"result":{"value":"stale"}}})
                        .to_string()
                        .into(),
                ))
                .await
                .unwrap();
            let second: Value =
                serde_json::from_str(socket.next().await.unwrap().unwrap().to_text().unwrap())
                    .unwrap();
            assert_eq!(second["method"], "Runtime.evaluate");
            assert!(
                !second["params"]["expression"]
                    .as_str()
                    .unwrap()
                    .contains("destroy()")
            );
            socket.send(Message::Text(json!({"id":second["id"],"result":{"result":{"value":{
                "desktop":{"hasAnswer":true,"headings":4},"ui":ui,"theme":"dark","fontBase":16.,"colors":{}
            }}}}).to_string().into())).await.unwrap();
            let _ = closed.await;
            socket.close(None).await.unwrap();
        });
        let client = Client::connect(&endpoint).await.unwrap();
        *app.session.write().await = Some(Session {
            client: client.clone(),
        });
        app.views.send_modify(|view| {
            view.connection.status = "connected".into();
            view.connection.target_id = Some("synthetic-target".into());
            view.desktop = DesktopStatus {
                has_answer: true,
                headings: 4,
            };
            view.panel_theme = Some("dark".into());
            view.panel_font_base = 16.;
            view.panel_colors = json!({});
        });
        let failure = client
            .evaluate_with_timeout("synthetic slow read".into(), Duration::from_millis(20))
            .await
            .unwrap_err();
        assert!(failure.is::<tokio::time::error::Elapsed>());
        app.handle_refresh_failure(&failure).await;
        assert!(Arc::ptr_eq(&app.desktop_client().await.unwrap(), &client));
        assert!(!client.is_closed());
        assert_eq!(app.view().connection.status, "unresponsive");
        assert_eq!(
            app.view().connection.target_id.as_deref(),
            Some("synthetic-target")
        );
        assert_eq!(app.view().desktop.headings, 4);
        app.refresh().await.unwrap();
        assert_eq!(app.view().connection.status, "connected");
        assert_eq!(app.view().desktop.headings, 4);
        close.send(()).unwrap();
        peer.await.unwrap();
        tokio::time::timeout(Duration::from_secs(1), async {
            while !client.is_closed() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        app.handle_refresh_failure(&failure).await;
        assert!(app.desktop_client().await.is_none());
        assert_eq!(app.view().connection.status, "disconnected");
        assert!(app.view().connection.target_id.is_none());
    }

    #[tokio::test]
    async fn incompatible_response_still_releases_a_live_session() {
        let temp = tempfile::tempdir().unwrap();
        let app = App::new(
            Paths::new(Some(temp.path().into())).unwrap(),
            Config::default(),
            None,
            true,
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("ws://{}", listener.local_addr().unwrap());
        let peer = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            assert!(matches!(socket.next().await, Some(Ok(Message::Close(_)))));
        });
        let client = Client::connect(&endpoint).await.unwrap();
        *app.session.write().await = Some(Session { client });
        app.handle_refresh_failure(&anyhow::anyhow!("synthetic incompatible page"))
            .await;
        assert!(app.desktop_client().await.is_none());
        tokio::time::timeout(Duration::from_secs(1), peer)
            .await
            .unwrap()
            .unwrap();
    }
}
