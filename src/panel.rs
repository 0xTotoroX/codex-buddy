// [INPUT]: App、宿主投影、窗口租约与私有 panel 偏好。
// [OUTPUT]: macOS 15+ arm64 弹出能力与入口校验、Panel、含 returnOpen 的 Preferences、带呈现确认和阅读位置接续的弹出/收回/受限命令。
// [POS]: 后台系统浮窗管理层，窗口在来源位置原生呈现后隐藏内嵌胶囊；受租约保护的临时坐标不持久化。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。

use crate::{
    config::{Paths, write_private},
    state::App,
};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    process::Stdio,
    time::{Duration, Instant},
};
use tokio::process::{Child, Command};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Ui {
    pub open: bool,
    pub active_tab: String,
    pub width: f64,
    pub height: f64,
    pub material: String,
    pub liquid_variant: String,
    pub font_offset: f64,
    pub label_only: bool,
    pub prompt_click_mode: String,
    pub view_order: Vec<String>,
}
impl Default for Ui {
    fn default() -> Self {
        Self {
            open: true,
            active_tab: "next".into(),
            width: 404.,
            height: 420.,
            material: "frosted".into(),
            liquid_variant: "regular".into(),
            font_offset: 0.,
            label_only: false,
            prompt_click_mode: "fill".into(),
            view_order: vec!["next".into(), "outline".into()],
        }
    }
}
impl Ui {
    fn validate(&self) -> Result<()> {
        if !["next", "outline", "settings"].contains(&self.active_tab.as_str())
            || !["frosted", "matte", "native-glass"].contains(&self.material.as_str())
            || !["regular", "clear"].contains(&self.liquid_variant.as_str())
            || !["fill", "direct", "hybrid"].contains(&self.prompt_click_mode.as_str())
            || !(300. ..=640.).contains(&self.width)
            || !(340. ..=720.).contains(&self.height)
            || !(-14. ..=14.).contains(&self.font_offset)
            || self.view_order.len() != 2
            || !self.view_order.contains(&"next".into())
            || !self.view_order.contains(&"outline".into())
        {
            bail!("浮窗偏好无效");
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, PartialEq, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Preferences {
    pub revision: u64,
    pub web_revision: u64,
    pub detached: bool,
    pub return_open: Option<bool>,
    pub always_on_top: bool,
    pub position: Option<Position>,
    pub ui: Ui,
}
impl Preferences {
    pub fn read(paths: &Paths) -> Self {
        std::fs::read(paths.root.join("panel.json"))
            .ok()
            .and_then(|bytes| {
                let mut value: Value = serde_json::from_slice(&bytes).ok()?;
                if value["ui"]["material"] == "native-glass"
                    && value["ui"]["glassStyle"] == "regular"
                {
                    value["ui"]["material"] = json!("frosted");
                }
                serde_json::from_value::<Self>(value).ok()
            })
            .map(|mut prefs| {
                if prefs.detached {
                    prefs.ui.open = true;
                }
                if ["clear", "liquid", "crystal", "liquid2"].contains(&prefs.ui.material.as_str()) {
                    prefs.ui.material = "frosted".into();
                }
                prefs
            })
            .filter(|prefs| prefs.ui.validate().is_ok())
            .unwrap_or_default()
    }
    fn save(&self, paths: &Paths) -> Result<()> {
        write_private(
            &paths.root.join("panel.json"),
            &serde_json::to_vec_pretty(self)?,
        )
    }
}

pub(crate) const POPOUT_REQUIREMENT: &str = "桌面浮窗仅支持 macOS 15 及以上的 Apple Silicon 设备";

fn platform_supports_popout(os: &str, arch: &str, major: isize) -> bool {
    os == "macos" && arch == "aarch64" && major >= 15
}

pub(crate) fn popout_supported() -> bool {
    let major = objc2_foundation::NSProcessInfo::processInfo()
        .operatingSystemVersion()
        .majorVersion;
    platform_supports_popout(std::env::consts::OS, std::env::consts::ARCH, major)
}

pub(crate) fn require_popout(supported: bool) -> Result<()> {
    if !supported {
        bail!(POPOUT_REQUIREMENT);
    }
    Ok(())
}

pub struct Panel {
    pub popout_supported: bool,
    pub prefs: Preferences,
    pub lease: String,
    pub ready: bool,
    pub presented: bool,
    docking: bool,
    child: Option<Child>,
    restore_attempted: bool,
    heartbeat: Instant,
    test_window: bool,
}
impl Panel {
    pub fn load(paths: &Paths, allow_fixture: bool) -> Self {
        Self {
            popout_supported: popout_supported(),
            prefs: Preferences::read(paths),
            lease: String::new(),
            ready: false,
            presented: false,
            docking: false,
            child: None,
            restore_attempted: false,
            heartbeat: Instant::now(),
            test_window: allow_fixture && std::env::var_os("CODEX_BUDDY_PANEL_TEST").is_some(),
        }
    }
    fn validate_lease(&self, lease: &str) -> Result<()> {
        if self.lease.is_empty() || lease != self.lease {
            bail!("浮窗已关闭或被新窗口替代");
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Input {
    pub lease: String,
    pub expected_revision: Option<u64>,
    pub ui: Option<Ui>,
    pub always_on_top: Option<bool>,
    pub position: Option<Position>,
    pub presentation: Option<ReadingState>,
    #[serde(default)]
    pub command: Value,
    pub request: Option<crate::requests::Request>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingState {
    pub view_token: String,
    pub content_token: String,
    pub active_tab: String,
    pub scroll_top: f64,
    pub prompt_preview_index: usize,
    pub prompt_scroll_top: f64,
}

impl ReadingState {
    fn validate(&self) -> Result<()> {
        if self.view_token.len() > 128
            || self.content_token.len() > 128
            || !["next", "outline", "settings"].contains(&self.active_tab.as_str())
            || !self.scroll_top.is_finite()
            || !(0. ..=1_000_000.).contains(&self.scroll_top)
            || self.prompt_preview_index > 24
            || !self.prompt_scroll_top.is_finite()
            || !(0. ..=1_000_000.).contains(&self.prompt_scroll_top)
        {
            bail!("阅读位置无效");
        }
        Ok(())
    }
}

impl App {
    pub async fn detach_panel(&self, ui: Option<Ui>) -> Result<()> {
        let activate = ui.is_some();
        let mut panel = self.panel.lock().await;
        require_popout(panel.popout_supported)?;
        if panel.ready
            || !panel.lease.is_empty() && panel.heartbeat.elapsed() < Duration::from_secs(12)
        {
            return Ok(());
        }
        if let Some(ui) = ui {
            ui.validate()?;
            panel.prefs.return_open = Some(ui.open);
            panel.prefs.ui = ui;
        }
        panel.prefs.ui.open = true;
        if let Some(child) = panel.child.as_mut() {
            let _ = child.kill().await;
        }
        panel.child = None;
        panel.ready = false;
        panel.presented = false;
        panel.docking = false;
        panel.restore_attempted = true;
        panel.lease = uuid::Uuid::new_v4().simple().to_string();
        panel.heartbeat = Instant::now();
        if !panel.test_window {
            let log = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(self.paths.root.join("panel.log"))?;
            let mut command = Command::new(std::env::current_exe()?);
            command.args(["--data-dir"]).arg(&self.paths.root).args([
                "panel-window",
                "--lease",
                &panel.lease,
            ]);
            if activate {
                command.arg("--activate");
            }
            let child = command
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(log)
                .kill_on_drop(true)
                .spawn()
                .context("无法启动桌面浮窗")?;
            panel.child = Some(child);
        }
        // 网页 ready 只表示内容可用；原生窗口已呈现并确认 presented 后才隐藏宿主。
        Ok(())
    }

    pub async fn open_panel(&self) -> Result<Value> {
        require_popout(self.panel.lock().await.popout_supported)?;
        let ui = if let Some(client) = self.desktop_client().await {
            client
                .evaluate("window.__companionFloatingPanel?.panelPreferences() ?? null".into())
                .await
                .ok()
                .and_then(|value| serde_json::from_value(value).ok())
        } else {
            None
        };
        self.detach_panel(ui).await?;
        Ok(json!({"ok":true,"lease":self.panel.lock().await.lease}))
    }

    pub async fn panel_snapshot(&self, input: &Input) -> Result<Value> {
        let (prefs, ready, presented) = {
            let mut panel = self.panel.lock().await;
            panel.validate_lease(&input.lease)?;
            panel.heartbeat = Instant::now();
            (panel.prefs.clone(), panel.ready, panel.presented)
        };
        let snapshot = if let Some(client) = self.desktop_client().await {
            client
                .evaluate("window.__companionFloatingPanel?.exportPanelState() ?? null".into())
                .await
                .unwrap_or(Value::Null)
        } else {
            Value::Null
        };
        Ok(
            json!({"preferences":prefs,"ready":ready,"presented":presented,"snapshot":snapshot,
            "connection":self.view().connection.status}),
        )
    }

    pub async fn ready_panel(&self, input: &Input) -> Result<Value> {
        {
            let mut panel = self.panel.lock().await;
            panel.validate_lease(&input.lease)?;
            panel.prefs.detached = true;
            panel.prefs.save(&self.paths)?;
            panel.ready = true;
            panel.heartbeat = Instant::now();
        }
        self.panel_anchor(input).await
    }

    pub async fn panel_anchor(&self, input: &Input) -> Result<Value> {
        self.panel.lock().await.validate_lease(&input.lease)?;
        let anchor = if let Some(client) = self.desktop_client().await {
            client
                .evaluate("window.__companionFloatingPanel?.panelWindowAnchor() ?? null".into())
                .await
                .unwrap_or(Value::Null)
        } else {
            Value::Null
        };
        Ok(json!({"ok":true,"anchor":anchor}))
    }

    pub async fn presented_panel(&self, input: &Input) -> Result<Value> {
        {
            let mut panel = self.panel.lock().await;
            panel.validate_lease(&input.lease)?;
            if !panel.ready || panel.docking {
                bail!("浮窗尚未就绪或正在收回");
            }
            panel.presented = true;
            panel.heartbeat = Instant::now();
        }
        self.sync_panel_host(None).await?;
        Ok(json!({"ok":true}))
    }

    pub async fn dock_panel(&self, input: &Input) -> Result<Value> {
        if let Some(presentation) = &input.presentation {
            presentation.validate()?;
        }
        let needs_host = {
            let mut panel = self.panel.lock().await;
            panel.validate_lease(&input.lease)?;
            if panel.docking {
                bail!("窗口正在收回");
            }
            if let Some(ui) = &input.ui {
                ui.validate()?;
                panel.prefs.ui = ui.clone();
            }
            panel.docking = true;
            panel.ready
        };
        let restored = self.sync_panel_host(input.presentation.as_ref()).await;
        let mut panel = self.panel.lock().await;
        panel.validate_lease(&input.lease)?;
        panel.docking = false;
        if needs_host {
            restored.context("内嵌面板尚未恢复，浮窗保持打开，请重试")?;
        }
        let mut prefs = panel.prefs.clone();
        prefs.detached = false;
        prefs.ui.open = prefs.return_open.unwrap_or(true);
        prefs.save(&self.paths)?;
        panel.prefs = prefs;
        panel.ready = false;
        panel.presented = false;
        panel.lease.clear();
        Ok(json!({"ok":true}))
    }

    pub async fn save_panel_preferences(&self, input: &Input) -> Result<Value> {
        let mut panel = self.panel.lock().await;
        panel.validate_lease(&input.lease)?;
        if input
            .expected_revision
            .is_some_and(|revision| revision != panel.prefs.revision)
        {
            bail!("外观已在其他窗口更新，请重试");
        }
        let mut next = panel.prefs.clone();
        if let Some(ui) = &input.ui {
            ui.validate()?;
            next.ui = ui.clone();
        }
        if let Some(pinned) = input.always_on_top {
            next.always_on_top = pinned;
        }
        if let Some(position) = &input.position {
            if !position.x.is_finite() || !position.y.is_finite() {
                bail!("窗口位置无效");
            }
            next.position = Some(position.clone());
        }
        if next.detached {
            next.ui.open = true;
        }
        if next != panel.prefs {
            next.revision = panel.prefs.revision + 1;
            next.save(&self.paths)?;
            panel.prefs = next;
        }
        Ok(json!({"ok":true,"revision":panel.prefs.revision}))
    }

    pub async fn panel_command(&self, input: &Input) -> Result<Value> {
        {
            let panel = self.panel.lock().await;
            panel.validate_lease(&input.lease)?;
            if !panel.ready {
                bail!("浮窗尚未就绪");
            }
        }
        let client = self.desktop_client().await.context("Codex 连接已断开")?;
        let result = client.evaluate(format!(
            "window.__companionFloatingPanel?.panelCommand({}) ?? {{ok:false,message:'Codex 胶囊正在重载'}}", input.command
        )).await?;
        if result["ok"] == true
            && ["fill", "outline-jump", "outline-anchor"]
                .contains(&input.command["kind"].as_str().unwrap_or_default())
        {
            let _ = client.request("Page.bringToFront", json!({})).await;
        }
        Ok(result)
    }

    pub async fn panel_request(self: &std::sync::Arc<Self>, input: &Input) -> Result<Value> {
        self.panel.lock().await.validate_lease(&input.lease)?;
        let request = input.request.as_ref().context("缺少设置请求")?;
        crate::requests::dispatch(self, None, request).await
    }

    pub async fn supervise_panel(&self) {
        let restore = {
            let mut panel = self.panel.lock().await;
            let exited = panel
                .child
                .as_mut()
                .is_some_and(|child| child.try_wait().ok().flatten().is_some());
            let expired =
                !panel.lease.is_empty() && panel.heartbeat.elapsed() > Duration::from_secs(12);
            if exited || expired {
                if let Some(mut child) = panel.child.take() {
                    let _ = child.kill().await;
                }
                panel.ready = false;
                panel.presented = false;
                panel.docking = false;
                panel.lease.clear();
            }
            panel.popout_supported && panel.prefs.detached && !panel.restore_attempted
        };
        if restore && let Err(error) = self.detach_panel(None).await {
            tracing::warn!("桌面浮窗恢复失败：{error}");
        }
    }

    pub async fn appearance(&self) -> Preferences {
        self.panel.lock().await.prefs.clone()
    }

    pub async fn save_appearance(&self, input: Value) -> Result<Preferences> {
        let mut panel = self.panel.lock().await;
        if input["expectedRevision"].as_u64() != Some(panel.prefs.revision) {
            bail!("外观已在其他窗口更新，请重试");
        }
        let mut next = panel.prefs.clone();
        if let Some(patch) = input.get("ui") {
            let mut ui = serde_json::to_value(&next.ui)?;
            for (key, value) in patch.as_object().context("外观参数无效")? {
                if ui.get(key).is_none() {
                    bail!("未知外观选项");
                }
                ui[key] = value.clone();
            }
            next.ui = serde_json::from_value(ui)?;
            next.ui.validate()?;
        }
        if let Some(value) = input.get("alwaysOnTop") {
            next.always_on_top = value.as_bool().context("置顶参数无效")?;
        }
        if let Some(value) = input.get("position") {
            let position: Position = serde_json::from_value(value.clone())?;
            if !position.x.is_finite()
                || !position.y.is_finite()
                || position.x.abs() > 100000.
                || position.y.abs() > 100000.
            {
                bail!("窗口位置无效");
            }
            next.position = Some(position);
        }
        if next.detached {
            next.ui.open = true;
        }
        if next != panel.prefs {
            next.revision += 1;
            next.web_revision += 1;
            next.save(&self.paths)?;
            panel.prefs = next;
        }
        Ok(panel.prefs.clone())
    }

    pub async fn close_panel(&self) -> Result<Value> {
        let lease = self.panel.lock().await.lease.clone();
        if lease.is_empty() {
            let mut panel = self.panel.lock().await;
            panel.prefs.detached = false;
            panel.prefs.save(&self.paths)?;
            return Ok(json!({"ok":true}));
        }
        self.dock_panel(&Input {
            lease,
            expected_revision: None,
            ui: None,
            always_on_top: None,
            position: None,
            presentation: None,
            command: Value::Null,
            request: None,
        })
        .await
    }

    pub async fn set_panel_theme(&self, input: Value) -> Result<Value> {
        let mode = input["mode"].as_str().context("缺少主题")?;
        if !["light", "dark"].contains(&mode) {
            bail!("主题无效");
        }
        let client = self.desktop_client().await.context("请先连接 Codex")?;
        client.evaluate(format!(
            "(async () => {{const p=window.__companionFloatingPanel; if (!p?.setThemeMode) throw new Error('请重新连接 Codex'); await p.setThemeMode({}); return {{ok:true}};}})()",
            json!(mode)
        )).await
    }

    pub(crate) async fn observe_panel_ui(&self, revision: u64, ui: Value) -> Result<()> {
        let mut panel = self.panel.lock().await;
        if panel.ready || panel.prefs.detached || panel.prefs.revision != revision {
            return Ok(());
        }
        let ui: Ui = serde_json::from_value(ui)?;
        ui.validate()?;
        if panel.prefs.ui != ui {
            let mut next = panel.prefs.clone();
            next.ui = ui;
            next.revision += 1;
            next.save(&self.paths)?;
            panel.prefs = next;
        }
        Ok(())
    }

    pub(crate) async fn panel_host_state(&self) -> (bool, Value, u64, u64) {
        let panel = self.panel.lock().await;
        let mut ui = panel.prefs.ui.clone();
        if panel.prefs.detached || panel.ready || !panel.lease.is_empty() {
            ui.open = panel.prefs.return_open.unwrap_or(true);
        }
        (
            panel.presented && !panel.docking,
            json!(ui),
            panel.prefs.revision,
            panel.prefs.web_revision,
        )
    }

    async fn sync_panel_host(&self, presentation: Option<&ReadingState>) -> Result<()> {
        let (hidden, ui, _, _) = self.panel_host_state().await;
        let client = self.desktop_client().await.context("Codex 连接已断开")?;
        let restored = client.evaluate(format!(
            "(async()=>{{const p=window.__companionFloatingPanel; if (!p?.state.runtimeActive || !p.state.root?.isConnected) return false; await p.setDetached({}, {}, {}); return p.state.root?.isConnected && p.state.detached === {};}})()",
            hidden, json!(ui), json!(presentation), hidden
        )).await?;
        anyhow::ensure!(restored == true, "Codex 面板未确认显示状态");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn panel_input(lease: String) -> Input {
        Input {
            lease,
            expected_revision: None,
            ui: None,
            always_on_top: None,
            position: None,
            presentation: None,
            command: Value::Null,
            request: None,
        }
    }

    #[tokio::test]
    async fn host_waits_for_presentation_and_failed_dock_preserves_window() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(Some(dir.path().into())).unwrap();
        let app = App::new(paths, crate::config::Config::default(), None, true);
        {
            let mut panel = app.panel.lock().await;
            panel.popout_supported = true;
            panel.test_window = true;
        }
        app.detach_panel(Some(Ui::default())).await.unwrap();
        let lease = app.panel.lock().await.lease.clone();
        let mut input = panel_input(lease);
        assert!(!app.panel_host_state().await.0);
        app.ready_panel(&input).await.unwrap();
        assert!(app.panel.lock().await.ready);
        assert!(!app.panel_host_state().await.0);
        assert!(app.presented_panel(&input).await.is_err());
        assert!(app.panel_host_state().await.0);
        input.presentation = Some(ReadingState {
            view_token: "view".into(),
            content_token: "content".into(),
            active_tab: "outline".into(),
            scroll_top: 240.,
            prompt_preview_index: 0,
            prompt_scroll_top: 12.,
        });
        assert!(app.dock_panel(&input).await.is_err());
        let panel = app.panel.lock().await;
        assert!(panel.ready && panel.presented && !panel.lease.is_empty());
        assert!(panel.prefs.detached && !panel.docking);
    }

    #[test]
    fn popout_requires_macos_15_and_apple_silicon() {
        for (os, arch, major, expected) in [
            ("macos", "aarch64", 13, false),
            ("macos", "aarch64", 14, false),
            ("macos", "aarch64", 15, true),
            ("macos", "aarch64", 27, true),
            ("macos", "x86_64", 15, false),
            ("windows", "aarch64", 15, false),
            ("linux", "aarch64", 27, false),
        ] {
            let supported = platform_supports_popout(os, arch, major);
            assert_eq!(supported, expected, "{os} {arch} {major}");
            assert_eq!(require_popout(supported).is_ok(), expected);
        }
    }

    #[tokio::test]
    async fn unsupported_popout_rejects_requests_and_skips_saved_restore() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(Some(dir.path().into())).unwrap();
        let mut prefs = Preferences::default();
        prefs.detached = true;
        prefs.save(&paths).unwrap();
        let app = App::new(paths, crate::config::Config::default(), None, true);
        app.panel.lock().await.popout_supported = false;
        assert_eq!(app.settings().await["popoutSupported"], false);
        assert_eq!(
            app.open_panel().await.unwrap_err().to_string(),
            POPOUT_REQUIREMENT
        );
        assert!(app.detach_panel(Some(Ui::default())).await.is_err());
        for _ in 0..2 {
            app.supervise_panel().await;
        }
        let panel = app.panel.lock().await;
        assert!(!panel.ready && !panel.restore_attempted);
        assert!(panel.lease.is_empty() && panel.child.is_none());
        assert_eq!(Preferences::read(&app.paths), prefs);
    }

    #[test]
    fn liquid_variants_validate_and_default_for_existing_preferences() {
        let old: Ui = serde_json::from_value(json!({"material":"native-glass"})).unwrap();
        assert_eq!(old.liquid_variant, "regular");
        let mut clear = old.clone();
        clear.liquid_variant = "clear".into();
        assert!(clear.validate().is_ok());
        assert_eq!(serde_json::from_value::<Ui>(json!(clear)).unwrap(), clear);
        clear.liquid_variant = "unknown".into();
        assert!(clear.validate().is_err());
    }

    #[tokio::test]
    async fn detached_preferences_reopen_and_ignore_host_collapse() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(Some(dir.path().into())).unwrap();
        let mut prefs = Preferences::default();
        prefs.detached = true;
        prefs.ui.open = false;
        prefs.ui.width = 510.;
        prefs.return_open = Some(false);
        prefs.save(&paths).unwrap();
        let app = App::new(paths, crate::config::Config::default(), None, true);
        let before = app.appearance().await;
        assert!(before.ui.open);
        assert_eq!(before.ui.width, 510.);
        assert_eq!(before.return_open, Some(false));
        assert_eq!(app.panel_host_state().await.1["open"], false);
        app.observe_panel_ui(before.revision, json!(Ui::default()))
            .await
            .unwrap();
        assert_eq!(app.appearance().await, before);
        let changed = app
            .save_appearance(json!({"expectedRevision":before.revision,
            "ui":{"open":false,"liquidVariant":"clear"}}))
            .await
            .unwrap();
        assert!(changed.ui.open);
        assert_eq!(changed.ui.liquid_variant, "clear");
        assert_eq!(changed.return_open, Some(false));
        assert_eq!(Preferences::read(&app.paths).return_open, Some(false));
    }

    #[test]
    fn old_glass_styles_migrate_to_materials_without_losing_preferences() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(Some(dir.path().into())).unwrap();
        for (style, expected) in [("regular", "frosted"), ("clear", "native-glass")] {
            let value = json!({"detached":true,"alwaysOnTop":true,
                "ui":{"material":"native-glass","glassStyle":style,"width":510}});
            std::fs::write(paths.root.join("panel.json"), value.to_string()).unwrap();
            let prefs = Preferences::read(&paths);
            assert_eq!(prefs.ui.material, expected);
            assert_eq!(prefs.ui.width, 510.);
            assert!(prefs.detached && prefs.always_on_top);
            assert!(json!(prefs.ui).get("glassStyle").is_none());
        }
    }

    #[test]
    fn old_materials_migrate_without_resetting_window_preferences() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(Some(dir.path().into())).unwrap();
        for old in ["clear", "liquid", "crystal", "liquid2"] {
            let mut prefs = Preferences::default();
            prefs.ui.material = old.into();
            prefs.ui.width = 510.;
            prefs.ui.font_offset = 2.;
            prefs.always_on_top = true;
            prefs.detached = true;
            prefs.position = Some(Position { x: 120., y: 240. });
            prefs.save(&paths).unwrap();
            let migrated = Preferences::read(&paths);
            prefs.ui.material = "frosted".into();
            prefs.ui.open = true;
            assert_eq!(migrated, prefs);
        }
        let mut prefs = Preferences::default();
        prefs.ui.material = "native-glass".into();
        prefs.save(&paths).unwrap();
        assert_eq!(Preferences::read(&paths), prefs);
        for invalid in ["clear", "liquid", "crystal", "unknown"] {
            prefs.ui.material = invalid.into();
            assert!(prefs.ui.validate().is_err());
        }
    }

    #[tokio::test]
    async fn appearance_merges_fields_rejects_stale_writes_and_preserves_other_settings() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(Some(dir.path().into())).unwrap();
        let app = App::new(paths, crate::config::Config::default(), None, true);
        let before = app.appearance().await;
        let changed = app
            .save_appearance(json!({"expectedRevision":before.revision,
            "ui":{"material":"native-glass","fontOffset":2.,"promptClickMode":"hybrid"},
            "alwaysOnTop":true}))
            .await
            .unwrap();
        assert_eq!(changed.ui.width, before.ui.width);
        assert_eq!(changed.ui.material, "native-glass");
        assert!(changed.always_on_top);
        assert!(
            app.save_appearance(
                json!({"expectedRevision":before.revision,"ui":{"material":"frosted"}})
            )
            .await
            .is_err()
        );
        assert!(
            app.save_appearance(json!({"expectedRevision":changed.revision,"ui":{"width":0}}))
                .await
                .is_err()
        );
        assert!(
            app.save_appearance(json!({"expectedRevision":changed.revision,"ui":{"unknown":true}}))
                .await
                .is_err()
        );
        assert_eq!(app.appearance().await, changed);
        assert_eq!(Preferences::read(&app.paths), changed);
        app.observe_panel_ui(before.revision, json!(Ui::default()))
            .await
            .unwrap();
        assert_eq!(app.appearance().await, changed);
        assert!(app.set_panel_theme(json!({"mode":"dark"})).await.is_err());
    }

    #[test]
    fn preferences_round_trip_without_business_content() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(Some(dir.path().into())).unwrap();
        let prefs = Preferences {
            detached: true,
            always_on_top: true,
            position: Some(Position { x: -320., y: 40. }),
            ui: Ui {
                open: true,
                ..Default::default()
            },
            ..Default::default()
        };
        prefs.save(&paths).unwrap();
        assert_eq!(Preferences::read(&paths), prefs);
        let mut invalid = Ui::default();
        invalid.width = 90000.;
        assert!(invalid.validate().is_err());
        let extra: Ui = serde_json::from_value(json!({"chat":"must not persist"})).unwrap();
        assert!(
            !serde_json::to_string(&extra)
                .unwrap()
                .contains("must not persist")
        );
    }
}
