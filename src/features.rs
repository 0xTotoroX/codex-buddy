// [INPUT]: Fixed feature identities, authenticated UI requests and existing business services.
// [OUTPUT]: One main placement, independent edge membership, checked per-surface layouts and view handoff.
// [POS]: Presentation lifecycle only; business validation remains in tasks/codex/model_control.
// [PROTOCOL]: Keep src/AGENTS.md in sync.
use crate::{
    config::{Paths, write_private},
    state::App,
};
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

#[path = "features/main_surface.rs"]
mod main_surface;
use main_surface::{FeatureLayout, MainSurface, SavedFeatures};

pub const IDS: [&str; 4] = ["outline", "board", "next", "model"];
#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Preference {
    pub placement: String,
    pub return_placement: String,
    pub open: bool,
    pub size: [u32; 2],
}
impl Default for Preference {
    fn default() -> Self {
        Self {
            placement: "sidebar".into(),
            return_placement: "overlay".into(),
            open: false,
            size: [840, 620],
        }
    }
}
struct Pending {
    placement: String,
    owner: String,
    started: Instant,
    source_ready: bool,
    target_ready: bool,
    grouped: bool,
}
struct Entry {
    pref: Preference,
    owner: String,
    view: Value,
    pending: Option<Pending>,
    reveal: u64,
}
pub struct Features {
    entries: BTreeMap<String, Entry>,
    main: MainSurface,
}
impl Features {
    pub fn load(paths: &Paths) -> Self {
        let saved = std::fs::read(paths.root.join("features.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<SavedFeatures>(&b).ok());
        let (mut main, mut prefs) = saved.map(SavedFeatures::parts).unwrap_or_default();
        if !["sidebar", "overlay", "desktop"].contains(&main.placement.as_str()) {
            main.placement = "sidebar".into();
        }
        main.layouts.retain(|placement, layout| {
            ["sidebar", "overlay", "desktop"].contains(&placement.as_str()) && layout.valid()
        });
        // Old mixed placements become one main surface; task data and open state stay intact.
        for pref in prefs.values_mut() {
            if pref.placement != "edge" {
                pref.placement = main.placement.clone();
            }
        }
        if !prefs.contains_key("model")
            && std::fs::read(paths.root.join("model-control.json"))
                .ok()
                .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
                .is_some_and(|v| v["enabled"] == true)
        {
            prefs.insert(
                "model".into(),
                Preference {
                    placement: "edge".into(),
                    open: true,
                    ..Default::default()
                },
            );
        }
        Self {
            main: MainSurface::new(main),
            entries: IDS
                .into_iter()
                .filter_map(|id| {
                    prefs
                        .get(id)
                        .filter(|p| {
                            valid_placement(id, &p.placement)
                                && p.size[0] >= 320
                                && p.size[1] >= 280
                                && p.size[0] <= 20000
                                && p.size[1] <= 20000
                        })
                        .map(|p| {
                            (
                                id.into(),
                                Entry {
                                    pref: p.clone(),
                                    owner: uuid::Uuid::new_v4().to_string(),
                                    view: json!({}),
                                    pending: None,
                                    reveal: 1,
                                },
                            )
                        })
                })
                .collect(),
        }
    }
    fn save(&self, paths: &Paths) -> Result<()> {
        let prefs: BTreeMap<_, _> = self.entries.iter().map(|(id, e)| (id, &e.pref)).collect();
        write_private(
            &paths.root.join("features.json"),
            &serde_json::to_vec_pretty(&json!({"main":self.main.pref,"features":prefs}))?,
        )
    }
    fn snapshot(&self) -> Value {
        json!({"layouts":self.main.pref.layouts,"activeFeature":self.main.active,"mainPlacement":self.main.pref.placement,"returnPlacement":self.main.pref.return_placement,"pendingPlacement":self.main.target,"mainWindow":{"lease":self.main.lease,"pid":self.main.child.as_ref().map(|c|c.id()),"size":self.main.pref.size},"features":self.entries.iter().map(|(id,e)|json!({"id":id,"desktopSupported":crate::panel::popout_supported(),"placement":e.pref.placement,"returnPlacement":e.pref.return_placement,"open":e.pref.open,"size":e.pref.size,"owner":e.owner,"view":e.view,"reveal":e.reveal,"pending":e.pending.as_ref().map(|p|json!({"placement":p.placement,"owner":p.owner,"ready":p.source_ready}))})).collect::<Vec<_>>()})
    }
    fn validate(&self, id: &str, owner: &str) -> Result<()> {
        let e = self.entries.get(id).context("功能尚未打开")?;
        ensure!(
            e.pref.open && !owner.is_empty() && e.owner == owner && e.pending.is_none(),
            "功能已移动或正在交接，请刷新后重试"
        );
        Ok(())
    }
}
fn valid_placement(_id: &str, p: &str) -> bool {
    crate::surfaces::PLACEMENTS.contains(&p)
}
fn spawn(paths: &Paths, id: &str, owner: &str) -> Result<Child> {
    Command::new(std::env::current_exe()?)
        .arg("--data-dir")
        .arg(&paths.root)
        .args(["feature-window", "--feature", id, "--lease", owner])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .context("无法打开功能窗口")
}
impl App {
    pub(crate) async fn reset_feature_layouts(&self, dock: bool, desktop: bool) -> Result<()> {
        let mut f = self.features.lock().await;
        let mut changed = false;
        for surface in ["sidebar", "overlay", "desktop"] {
            if if surface == "desktop" { desktop } else { dock } {
                changed |= f.main.pref.layouts.remove(surface).is_some();
            }
        }
        if changed {
            f.save(&self.paths)?;
        }
        Ok(())
    }
    pub async fn feature_state(&self) -> Value {
        let mut state = self.features.lock().await.snapshot();
        let view = self.view();
        state["legacyLayouts"] = json!({"sidebar":view.panel_preferences.ui.dock_layout,"overlay":view.panel_preferences.ui.dock_layout,"desktop":view.panel_preferences.ui.popout_layout});
        state["appearance"] = json!({"theme":view.panel_theme,"fontSize":view.panel_font_base,"colors":view.panel_colors,"themes":self.surfaces.lock().await.preferences.themes});
        state
    }
    pub async fn edge_features_active(&self) -> bool {
        self.features.lock().await.entries.values().any(|e| {
            e.pref.open && e.pref.placement == "edge"
                || e.pending.as_ref().is_some_and(|p| p.placement == "edge")
        })
    }
    pub async fn close_feature(&self, id: &str) -> Result<()> {
        let _operation = self.feature_operation.lock().await;
        let mut f = self.features.lock().await;
        f.cancel_group();
        if let Some(e) = f.entries.get_mut(id) {
            e.pref.open = false;
            e.pending = None;
        }
        f.save(&self.paths)?;
        f.retire_desktop();
        Ok(())
    }
    pub async fn features_active(&self) -> bool {
        !self.features.lock().await.entries.is_empty()
    }
    pub async fn feature_managed(&self, id: &str) -> bool {
        self.features.lock().await.entries.contains_key(id)
    }
    pub async fn feature_request(&self, input: Value) -> Result<Value> {
        let op = input["op"].as_str().unwrap_or("state");
        if op == "state" {
            return Ok(self.feature_state().await);
        }
        if op == "main-placement" {
            ensure!(!self.appearance().await.detached, "请先收回旧工作台");
            let _operation = self.feature_operation.lock().await;
            let mut f = self.features.lock().await;
            let placement = input["placement"].as_str().context("缺少主界面位置")?;
            f.begin_main(&self.paths, placement, None)?;
            return Ok(f.snapshot());
        }
        if op == "main-layout" {
            let _operation = self.feature_operation.lock().await;
            let mut f = self.features.lock().await;
            ensure!(f.main.target.is_none(), "功能正在交接");
            let placement = input["placement"].as_str().context("缺少布局位置")?;
            ensure!(
                ["sidebar", "overlay", "desktop"].contains(&placement),
                "布局位置无效"
            );
            let previous = f.main.pref.layouts.get(placement).cloned();
            let expected: Option<FeatureLayout> =
                serde_json::from_value(input.get("expectedLayout").context("缺少原布局")?.clone())?;
            ensure!(expected == previous, "布局已在其他窗口更新，请重新调整");
            let layout: FeatureLayout = serde_json::from_value(input["layout"].clone())?;
            ensure!(layout.valid(), "分栏布局无效");
            f.main.pref.layouts.insert(placement.into(), layout);
            if let Err(error) = f.save(&self.paths) {
                if let Some(previous) = previous {
                    f.main.pref.layouts.insert(placement.into(), previous);
                } else {
                    f.main.pref.layouts.remove(placement);
                }
                return Err(error);
            }
            return Ok(f.snapshot());
        }
        if op.starts_with("main-") {
            return self.main_surface_request(&input).await;
        }
        let id = input["id"].as_str().context("缺少功能")?;
        ensure!(IDS.contains(&id), "未知功能");
        let owner = input["owner"].as_str().unwrap_or("");
        if op == "layout" {
            let _operation = self.feature_operation.lock().await;
            let mut f = self.features.lock().await;
            f.validate(id, owner)?;
            let placement = input["placement"].as_str().context("缺少布局位置")?;
            ensure!(
                ["sidebar", "overlay", "desktop"].contains(&placement),
                "布局位置无效"
            );
            ensure!(
                f.entries[id].pref.placement == placement && f.main.target.is_none(),
                "功能正在交接"
            );
            // Older window bundles omit this field; current surfaces always send it.
            if let Some(expected) = input.get("expectedLayout") {
                let expected: Option<FeatureLayout> = serde_json::from_value(expected.clone())?;
                ensure!(
                    expected.as_ref() == f.main.pref.layouts.get(placement),
                    "布局已在其他窗口更新，请重新调整"
                );
            }
            let layout: FeatureLayout = serde_json::from_value(input["layout"].clone())?;
            ensure!(layout.valid(), "分栏布局无效");
            let previous = f.main.pref.layouts.insert(placement.into(), layout);
            if let Err(error) = f.save(&self.paths) {
                if let Some(previous) = previous {
                    f.main.pref.layouts.insert(placement.into(), previous);
                } else {
                    f.main.pref.layouts.remove(placement);
                }
                return Err(error);
            }
            return Ok(f.snapshot());
        }
        if op == "anchor" || op == "settings" {
            let f = self.features.lock().await;
            let e = f.entries.get(id).context("功能已关闭")?;
            ensure!(
                e.owner == owner || e.pending.as_ref().is_some_and(|p| p.owner == owner),
                "功能归属已变化"
            );
            drop(f);
            if op == "settings" {
                let runtime = crate::lifecycle::Runtime::read(&self.paths)?;
                webbrowser::open(&runtime.url()).context("无法打开设置")?;
                return Ok(json!({"ok":true}));
            }
            let anchor = if let Some(client) = self.desktop_client().await {
                client
                    .evaluate("window.__companionFloatingPanel?.panelWindowAnchor() ?? null".into())
                    .await
                    .unwrap_or(Value::Null)
            } else {
                Value::Null
            };
            return Ok(json!({"anchor":anchor}));
        }
        if op == "window" {
            let f = self.features.lock().await;
            let e = f.entries.get(id).context("功能已关闭")?;
            let valid = e.pref.open && e.owner == owner && e.pref.placement == "desktop"
                || e.pending
                    .as_ref()
                    .is_some_and(|p| p.owner == owner && p.placement == "desktop");
            let mut result = json!({"valid":valid,"active":e.owner==owner,"pid":f.main.child.as_ref().map(|c|c.id()),"reveal":e.reveal,"size":e.pref.size});
            drop(f);
            result["appearance"] = self.surface_appearance("desktop").await;
            return Ok(result);
        }
        if op == "read" {
            let f = self.features.lock().await;
            let e = f.entries.get(id).context("功能已关闭")?;
            ensure!(
                e.owner == owner || e.pending.as_ref().is_some_and(|p| p.owner == owner),
                "功能归属已变化"
            );
            let placement = e
                .pending
                .as_ref()
                .filter(|p| p.owner == owner)
                .map(|p| p.placement.clone())
                .unwrap_or_else(|| e.pref.placement.clone());
            drop(f);
            let mut result = match id {
                "board" => Ok(self.tasks.state().await),
                "model" => self.model_control_state(false).await,
                _ => {
                    let snapshot = if let Some(c) = self.desktop_client().await {
                        let result = c
                            .evaluate(
                                "window.__companionFloatingPanel?.exportPanelState() ?? null"
                                    .into(),
                            )
                            .await
                            .unwrap_or(Value::Null);
                        if self
                            .desktop_client()
                            .await
                            .is_some_and(|now| std::sync::Arc::ptr_eq(&now, &c))
                        {
                            result
                        } else {
                            Value::Null
                        }
                    } else {
                        Value::Null
                    };
                    Ok(json!({"snapshot":snapshot}))
                }
            }?;
            result["appearance"] = self.surface_appearance(&placement).await;
            return Ok(result);
        }
        // Moving and writing share a gate. State polling remains available during business operations.
        let _operation = if op == "action" {
            self.feature_operation
                .try_lock()
                .map_err(|_| anyhow::anyhow!("已有功能操作正在进行"))?
        } else {
            self.feature_operation.lock().await
        };
        if ["move", "reveal"].contains(&op) {
            ensure!(
                !self.appearance().await.detached,
                "请先双击表情收回旧工作台，再选择独立功能位置；阅读状态会保留"
            );
            let (saved, primary) = {
                let f = self.features.lock().await;
                (
                    f.entries.get(id).map(|e| e.pref.placement.clone()),
                    f.main.pref.placement.clone(),
                )
            };
            let placement = input["placement"].as_str().unwrap_or(
                saved
                    .as_deref()
                    .unwrap_or(if id == "model" { "edge" } else { &primary }),
            );
            ensure!(valid_placement(id, placement), "该功能不支持此位置");
            if placement == "desktop" {
                ensure!(crate::panel::popout_supported(), "当前系统不支持桌面窗口");
            }
            if id == "model" {
                ensure!(
                    self.model_control.lock().await.preferences.enabled,
                    "请先在设置页开启模型快切"
                );
            }
            if id == "board" {
                ensure!(
                    self.feature_managed("board").await || !self.tasks.window_open().await,
                    "请先保存草稿并关闭旧独立看板，再选择新位置；原窗口不会自动关闭"
                );
                ensure!(self.tasks.board_enabled().await, "请先在设置页开启任务看板");
            }
            let mut f = self.features.lock().await;
            ensure!(f.main.target.is_none(), "主界面正在切换，请稍后重试");
            if placement != "edge" {
                f.main.active = id.into();
            }
            let e = f.entries.entry(id.into()).or_insert_with(|| Entry {
                pref: Preference {
                    placement: if id == "model" {
                        "edge".into()
                    } else {
                        primary.clone()
                    },
                    ..Preference::default()
                },
                owner: uuid::Uuid::new_v4().to_string(),
                view: json!({}),
                pending: None,
                reveal: 0,
            });
            ensure!(e.pending.is_none(), "功能正在交接");
            if !owner.is_empty() {
                ensure!(owner == e.owner, "功能归属已变化");
            }
            if placement != "edge" && placement != primary {
                if let Some(view) = input.get("view") {
                    ensure!(view.to_string().len() < 128 * 1024, "阅读状态过大");
                    e.view = view.clone();
                }
                f.begin_main(&self.paths, placement, Some((id, owner)))?;
                return Ok(f.snapshot());
            }
            if e.pref.open && (op == "reveal" || placement == e.pref.placement) {
                e.reveal += 1;
                let edge = e.pref.placement == "edge";
                let result = f.snapshot();
                drop(f);
                if edge {
                    self.surfaces.lock().await.open(&self.paths, true)?;
                }
                return Ok(result);
            }
            if let Some(view) = input.get("view") {
                ensure!(view.to_string().len() < 128 * 1024, "阅读状态过大");
                e.view = view.clone();
            }
            let lease = uuid::Uuid::new_v4().to_string();
            e.pending = Some(Pending {
                placement: placement.into(),
                owner: lease,
                started: Instant::now(),
                source_ready: !e.pref.open || owner == e.owner,
                target_ready: false,
                grouped: false,
            });
            if placement == "desktop"
                && let Err(error) = f.ensure_desktop(&self.paths)
            {
                f.entries.get_mut(id).unwrap().pending = None;
                return Err(error);
            }
            let result = f.snapshot();
            drop(f);
            if placement == "edge"
                && let Err(error) = self.surfaces.lock().await.open(&self.paths, true)
            {
                self.features
                    .lock()
                    .await
                    .entries
                    .get_mut(id)
                    .unwrap()
                    .pending = None;
                return Err(error);
            }
            return Ok(result);
        }
        if op == "cancel-move" {
            let mut f = self.features.lock().await;
            let e = f.entries.get_mut(id).context("功能已关闭")?;
            let pending = e.pending.as_ref().context("交接已取消")?;
            ensure!(e.owner == owner || pending.owner == owner, "功能归属已变化");
            ensure!(input["pendingOwner"] == pending.owner, "交接已变化");
            if pending.grouped {
                f.cancel_group();
            } else {
                e.pending = None;
            }
            f.retire_desktop();
            return Ok(f.snapshot());
        }
        if op == "handoff" {
            let mut f = self.features.lock().await;
            let e = f.entries.get_mut(id).context("功能已关闭")?;
            ensure!(e.owner == owner, "功能归属已变化");
            let p = e.pending.as_mut().context("交接已取消")?;
            ensure!(input["pendingOwner"] == p.owner, "交接已变化");
            let view = input.get("view").context("缺少阅读状态")?;
            ensure!(view.to_string().len() < 128 * 1024, "阅读状态过大");
            e.view = view.clone();
            p.source_ready = true;
            let result = f.snapshot();
            drop(f);
            return Ok(result);
        }
        if op == "ready" {
            return self.finish_feature(id, owner).await;
        }
        {
            let mut f = self.features.lock().await;
            f.validate(id, owner)?;
            let e = f.entries.get_mut(id).unwrap();
            if let Some(view) = input.get("view") {
                ensure!(view.to_string().len() < 128 * 1024, "阅读状态过大");
                e.view = view.clone();
            }
            if op == "save" || op == "close" {
                if let Some(size) = input.get("size") {
                    let s: [u32; 2] = serde_json::from_value(size.clone())?;
                    ensure!(
                        s[0] >= 320 && s[1] >= 280 && s[0] <= 20000 && s[1] <= 20000,
                        "窗口尺寸无效"
                    );
                    e.pref.size = s;
                }
                if op == "close" {
                    e.pref.open = false;
                }
                if op == "close" || input.get("size").is_some() {
                    f.save(&self.paths)?;
                }
                f.retire_desktop();
                return Ok(f.snapshot());
            }
        }
        ensure!(op == "action", "未知功能操作");
        let data = input["data"].clone();
        match id {
            "board" => self.tasks.view_command(data).await,
            "model" => match input["action"].as_str().unwrap_or("") {
                "refresh" => {
                    ensure!(
                        self.model_control.lock().await.preferences.enabled,
                        "模型快切已停用"
                    );
                    self.model_control_state(true).await
                }
                "apply" => self.model_control_apply(data).await,
                "preferences" => {
                    ensure!(
                        data["patch"].as_object().is_some_and(|p| p.keys().all(|k| [
                            "pinned",
                            "presets",
                            "modelColumnWidth"
                        ]
                        .contains(&k.as_str()))),
                        "此视图只能调整模型预设"
                    );
                    self.model_control_preferences(data).await
                }
                _ => bail!("未知模型操作"),
            },
            _ => {
                let enabled = {
                    let model = self.model.read().await;
                    if id == "outline" {
                        model.options.answer_outline_enabled
                    } else {
                        model.options.enabled
                    }
                };
                ensure!(enabled, "功能已停用，请先在设置中开启");
                let kind = data["kind"].as_str().unwrap_or("");
                ensure!(
                    if id == "outline" {
                        kind.starts_with("outline-")
                    } else {
                        ["generate", "fill", "quick-fill"].contains(&kind)
                    },
                    "该操作不属于此功能"
                );
                self.execute_panel_command(&data).await
            }
        }
    }
    async fn finish_feature(&self, id: &str, owner: &str) -> Result<Value> {
        let mut f = self.features.lock().await;
        let e = f.entries.get_mut(id).context("功能已关闭")?;
        if e.owner == owner && e.pending.is_none() {
            return Ok(f.snapshot());
        }
        let p = e.pending.as_mut().context("交接已取消")?;
        ensure!(p.owner == owner && p.source_ready, "交接尚未就绪或已过期");
        if p.grouped {
            p.target_ready = true;
            f.finish_main(&self.paths)?;
            return Ok(f.snapshot());
        }
        let previous = e.pref.clone();
        if p.placement == "desktop" && e.pref.placement != "desktop" {
            e.pref.return_placement = e.pref.placement.clone();
        }
        e.pref.placement = p.placement.clone();
        e.pref.open = true;
        if let Err(error) = f.save(&self.paths) {
            f.entries.get_mut(id).unwrap().pref = previous;
            return Err(error);
        }
        let e = f.entries.get_mut(id).unwrap();
        e.owner = e.pending.take().unwrap().owner;
        e.reveal += 1;
        f.retire_desktop();
        let result = f.snapshot();
        drop(f);
        if id == "board" {
            self.tasks.close_window().await;
        }
        Ok(result)
    }
    pub async fn supervise_features(&self) {
        let Ok(_operation) = self.feature_operation.try_lock() else {
            return;
        };
        let mut f = self.features.lock().await;
        if f.entries.values().any(|e| {
            e.pending
                .as_ref()
                .is_some_and(|p| p.grouped && p.started.elapsed() > Duration::from_secs(15))
        }) {
            f.cancel_group();
        }
        for e in f.entries.values_mut() {
            if e.pending
                .as_ref()
                .is_some_and(|p| p.started.elapsed() > Duration::from_secs(15))
            {
                e.pending = None;
            }
        }
        if f.main
            .child
            .as_mut()
            .is_some_and(|c| c.try_wait().ok().flatten().is_some())
        {
            f.main.child = None;
            f.cancel_group();
            for e in f.entries.values_mut() {
                if e.pref.placement == "desktop" {
                    e.pref.open = false;
                }
                if e.pending.as_ref().is_some_and(|p| p.placement == "desktop") {
                    e.pending = None;
                }
            }
            let _ = f.save(&self.paths);
        }
        if f.desktop_active() {
            let _ = f.ensure_desktop(&self.paths);
        } else {
            f.main.stop();
        }
        drop(f);
        let active = self.edge_features_active().await;
        let mut surfaces = self.surfaces.lock().await;
        if active {
            if let Err(error) = surfaces.open(&self.paths, false) {
                tracing::warn!(%error,"无法恢复贴边窗口");
            }
        } else {
            surfaces.stop();
        }
    }
    pub async fn stop_features(&self) {
        self.surfaces.lock().await.stop();
        self.features.lock().await.main.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn app() -> (tempfile::TempDir, std::sync::Arc<App>) {
        let dir = tempfile::tempdir().unwrap();
        let app = App::new(
            Paths::new(Some(dir.path().into())).unwrap(),
            Default::default(),
            None,
            false,
        );
        (dir, app)
    }
    async fn open(app: &App, id: &str) -> String {
        let state = app
            .feature_request(json!({"op":"move","id":id,"placement":"sidebar"}))
            .await
            .unwrap();
        let owner = state["features"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["id"] == id)
            .unwrap()["pending"]["owner"]
            .as_str()
            .unwrap()
            .to_owned();
        app.feature_request(json!({"op":"ready","id":id,"owner":owner}))
            .await
            .unwrap();
        owner
    }
    #[tokio::test]
    async fn layout_survives_reload_rejects_stale_owner_and_resets_from_settings() {
        let (_dir, app) = app().await;
        let owner = open(&app, "outline").await;
        let layout = json!({"axis":"vertical","groups":[{"ids":["outline","board"],"active":"outline","weight":1.0}]});
        app.feature_request(json!({"op":"layout","id":"outline","owner":owner,"placement":"sidebar","layout":layout})).await.unwrap();
        assert_eq!(
            Features::load(&app.paths).snapshot()["layouts"]["sidebar"],
            layout
        );
        assert!(app.feature_request(json!({"op":"layout","id":"outline","owner":"old","placement":"sidebar","layout":layout})).await.is_err());
        let prefs = app.appearance().await;
        app.save_appearance(json!({"expectedRevision":prefs.revision,"ui":{"dockLayout":{"group":"tabs","active":"outline","mode":"auto","first":"outline","verticalRatio":0.45,"horizontalRatio":0.4}}})).await.unwrap();
        assert!(app.feature_state().await["layouts"]["sidebar"].is_null());
        assert!(Features::load(&app.paths).snapshot()["layouts"]["sidebar"].is_null());
    }

    #[tokio::test]
    async fn settings_layout_preserves_four_features_and_rejects_concurrent_changes() {
        let (_dir, app) = app().await;
        let before = app.appearance().await;
        let layout = json!({"axis":"horizontal","groups":[{"ids":["outline","board"],"active":"board","weight":0.6},{"ids":["next","model"],"active":"model","weight":0.4}]});
        app.feature_request(
            json!({"op":"main-layout","placement":"sidebar","expectedLayout":null,"layout":layout}),
        )
        .await
        .unwrap();
        assert_eq!(
            Features::load(&app.paths).snapshot()["layouts"]["sidebar"],
            layout
        );
        assert_eq!(
            serde_json::to_value(app.appearance().await).unwrap(),
            serde_json::to_value(before).unwrap()
        );
        assert!(
            app.feature_state().await["features"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        assert!(app.feature_request(json!({"op":"main-layout","placement":"sidebar","expectedLayout":null,"layout":layout})).await.is_err());
        assert!(app.feature_request(json!({"op":"main-layout","placement":"sidebar","expectedLayout":layout,"layout":{"axis":"vertical","groups":[]}})).await.is_err());
        app.feature_request(
            json!({"op":"main-layout","placement":"desktop","expectedLayout":null,"layout":layout}),
        )
        .await
        .unwrap();
        assert_eq!(
            Features::load(&app.paths).snapshot()["layouts"]["sidebar"],
            layout
        );
        // JavaScript serializes integral weights as 1, while Rust writes f64 as 1.0.
        let tabs = json!({"axis":"auto","groups":[{"ids":["outline","next","board","model"],"active":"board","weight":1}]});
        app.feature_request(
            json!({"op":"main-layout","placement":"sidebar","expectedLayout":layout,"layout":tabs}),
        )
        .await
        .unwrap();
        app.feature_request(
            json!({"op":"main-layout","placement":"sidebar","expectedLayout":tabs,"layout":layout}),
        )
        .await
        .unwrap();
        let owner = open(&app, "outline").await;
        assert!(app.feature_request(json!({"op":"layout","id":"outline","owner":owner,"placement":"sidebar","expectedLayout":tabs,"layout":tabs})).await.is_err());
        app.feature_request(json!({"op":"layout","id":"outline","owner":owner,"placement":"sidebar","expectedLayout":layout,"layout":tabs})).await.unwrap();
    }

    #[tokio::test]
    async fn independent_owners_reject_late_actions_and_preserve_transient_drafts() {
        let (_dir, app) = app().await;
        let owner = open(&app, "outline").await;
        let next = open(&app, "next").await;
        let view = json!({"top":143,"draft":"private transient text"});
        let state = app
            .feature_request(
                json!({"op":"move","id":"outline","placement":"overlay","owner":owner,"view":view}),
            )
            .await
            .unwrap();
        let pending = state["features"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["id"] == "outline")
            .unwrap()["pending"]["owner"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(app.feature_request(json!({"op":"action","id":"outline","owner":owner,"data":{"kind":"outline-refresh"}})).await.is_err());
        assert!(
            app.feature_request(json!({"op":"ready","id":"outline","owner":"stale"}))
                .await
                .is_err()
        );
        app.feature_request(json!({"op":"ready","id":"outline","owner":pending}))
            .await
            .unwrap();
        let pending_next = state["features"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["id"] == "next")
            .unwrap()["pending"]["owner"]
            .as_str()
            .unwrap()
            .to_owned();
        assert_eq!(
            app.features.lock().await.entries["outline"].owner,
            owner,
            "one ready target cannot commit a partial move"
        );
        app.feature_request(json!({"op":"handoff","id":"next","owner":next,"pendingOwner":pending_next,"view":{"top":25}})).await.unwrap();
        app.feature_request(json!({"op":"ready","id":"next","owner":pending_next}))
            .await
            .unwrap();
        let next = pending_next;
        assert!(
            app.feature_request(json!({"op":"save","id":"outline","owner":owner,"view":{}}))
                .await
                .is_err()
        );
        app.feature_request(json!({"op":"close","id":"outline","owner":pending}))
            .await
            .unwrap();
        app.feature_request(json!({"op":"save","id":"next","owner":next,"view":{"top":25}}))
            .await
            .unwrap();
        let state = app.feature_state().await;
        let outline = state["features"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["id"] == "outline")
            .unwrap();
        assert_eq!(outline["view"], view);
        let saved = std::fs::read_to_string(app.paths.root.join("features.json")).unwrap();
        assert!(!saved.contains("private transient text"));
        let cold = Features::load(&app.paths).snapshot();
        assert_eq!(cold["features"][0]["view"], json!({}));
    }
    #[tokio::test]
    async fn external_move_waits_for_source_and_timeout_retains_original_owner() {
        let (_dir, app) = app().await;
        let owner = open(&app, "outline").await;
        let state = app
            .feature_request(json!({"op":"move","id":"outline","placement":"overlay"}))
            .await
            .unwrap();
        let dest = state["features"][0]["pending"]["owner"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(
            app.feature_request(json!({"op":"ready","id":"outline","owner":dest}))
                .await
                .is_err()
        );
        app.feature_request(json!({"op":"handoff","id":"outline","owner":owner,"pendingOwner":dest,"view":{"top":72}}))
            .await
            .unwrap();
        app.features
            .lock()
            .await
            .entries
            .get_mut("outline")
            .unwrap()
            .pending
            .as_mut()
            .unwrap()
            .started = Instant::now() - Duration::from_secs(20);
        app.supervise_features().await;
        let state = app.feature_state().await;
        assert_eq!(state["features"][0]["owner"], owner);
        assert_eq!(state["features"][0]["view"]["top"], 72);
        assert!(state["features"][0]["pending"].is_null());
        assert!(
            app.feature_request(json!({"op":"ready","id":"outline","owner":dest}))
                .await
                .is_err()
        );
    }
    #[tokio::test]
    async fn first_board_migration_keeps_existing_window_until_user_handles_draft() {
        let (_dir, app) = app().await;
        {
            let mut tasks = app.tasks.inner.lock().await;
            tasks.store.board_enabled = true;
            tasks.window = Some(
                std::process::Command::new("/bin/sleep")
                    .arg("60")
                    .spawn()
                    .unwrap(),
            );
        }
        let result = app
            .feature_request(json!({"op":"move","id":"board","placement":"sidebar"}))
            .await;
        assert!(result.unwrap_err().to_string().contains("保存草稿"));
        assert!(app.tasks.window_open().await);
        assert!(!app.feature_managed("board").await);
        app.tasks.close_window().await;
        open(&app, "board").await;
    }
    #[tokio::test]
    async fn disabled_features_reject_actions_and_keep_view_state() {
        let (_dir, app) = app().await;
        app.model_control.lock().await.preferences.enabled = true;
        let model_owner = open(&app, "model").await;
        app.model_control.lock().await.preferences.enabled = false;
        assert!(
            app.feature_request(
                json!({"op":"action","id":"model","owner":model_owner,"action":"refresh"})
            )
            .await
            .unwrap_err()
            .to_string()
            .contains("停用")
        );
        for (id, kind) in [("next", "quick-fill"), ("outline", "outline-refresh")] {
            let owner = open(&app, id).await;
            {
                let mut model = app.model.write().await;
                model.options.enabled = false;
                model.options.answer_outline_enabled = false;
            }
            let result = app
                .feature_request(json!({
                    "op":"action", "id":id, "owner":owner, "data":{"kind":kind,"index":0}
                }))
                .await;
            assert!(result.unwrap_err().to_string().contains("功能已停用"));
            app.feature_request(json!({"op":"save","id":id,"owner":owner,"view":{"top":42}}))
                .await
                .unwrap();
            assert_eq!(app.features.lock().await.entries[id].view["top"], 42);
        }
    }
    #[tokio::test]
    async fn placement_validation_and_feature_scopes_do_not_enable_business() {
        let (_dir, app) = app().await;
        for (id, placement) in [
            ("outline", "invalid"),
            ("unknown", "sidebar"),
            ("board", "sidebar"),
            ("model", "sidebar"),
        ] {
            assert!(
                app.feature_request(json!({"op":"move","id":id,"placement":placement}))
                    .await
                    .is_err()
            );
        }
        let owner = open(&app, "outline").await;
        assert!(
            app.feature_request(
                json!({"op":"action","id":"outline","owner":owner,"data":{"kind":"fill"}})
            )
            .await
            .is_err()
        );
        assert!(
            app.model_control_apply(json!({}))
                .await
                .unwrap_err()
                .to_string()
                .contains("停用")
        );
        assert!(!app.tasks.board_enabled().await);
    }
    #[tokio::test]
    async fn main_group_cancel_is_atomic_and_leaves_edge_and_closed_features_alone() {
        let (dir, app) = app().await;
        let a = open(&app, "outline").await;
        let b = open(&app, "next").await;
        {
            let mut f = app.features.lock().await;
            f.entries.insert(
                "model".into(),
                Entry {
                    pref: Preference {
                        placement: "edge".into(),
                        open: true,
                        ..Default::default()
                    },
                    owner: "edge-owner".into(),
                    view: json!({"modelSearch":"kept"}),
                    pending: None,
                    reveal: 1,
                },
            );
            f.entries.insert(
                "board".into(),
                Entry {
                    pref: Preference::default(),
                    owner: "closed-owner".into(),
                    view: json!({"draft":"kept"}),
                    pending: None,
                    reveal: 1,
                },
            );
        }
        app.feature_request(json!({"op":"main-placement","placement":"overlay"}))
            .await
            .unwrap();
        let state = app.feature_state().await;
        let pending = |id: &str| {
            state["features"]
                .as_array()
                .unwrap()
                .iter()
                .find(|e| e["id"] == id)
                .unwrap()["pending"]["owner"]
                .as_str()
                .unwrap()
                .to_owned()
        };
        let pa = pending("outline");
        let pb = pending("next");
        app.feature_request(
            json!({"op":"handoff","id":"outline","owner":a,"pendingOwner":pa,"view":{"top":42}}),
        )
        .await
        .unwrap();
        app.feature_request(json!({"op":"ready","id":"outline","owner":pa}))
            .await
            .unwrap();
        assert_eq!(app.features.lock().await.main.pref.placement, "sidebar");
        app.feature_request(json!({"op":"cancel-move","id":"next","owner":b,"pendingOwner":pb}))
            .await
            .unwrap();
        assert!(
            app.feature_request(json!({"op":"ready","id":"outline","owner":pa}))
                .await
                .is_err()
        );
        app.feature_request(json!({"op":"main-placement","placement":"overlay"}))
            .await
            .unwrap();
        assert!(
            app.feature_request(
                json!({"op":"cancel-move","id":"next","owner":b,"pendingOwner":pb})
            )
            .await
            .is_err(),
            "late cancel cannot cancel retry"
        );
        let mut f = app.features.lock().await;
        for id in ["outline", "next"] {
            let p = f.entries.get_mut(id).unwrap().pending.as_mut().unwrap();
            p.source_ready = true;
            p.target_ready = true;
        }
        f.finish_main(&app.paths).unwrap();
        assert_eq!(f.main.pref.placement, "overlay");
        assert_eq!(f.entries["model"].owner, "edge-owner");
        assert_eq!(f.entries["model"].view["modelSearch"], "kept");
        assert!(!f.entries["board"].pref.open);
        assert!(f.entries["board"].pending.is_none());
        assert_eq!(f.entries["board"].pref.placement, "overlay");
        assert_eq!(f.entries["board"].view["draft"], "kept");
        let cold = Features::load(&Paths::new(Some(dir.path().into())).unwrap());
        assert_eq!(cold.main.pref.placement, "overlay");
        assert!(!cold.entries["board"].pref.open);
    }
    #[tokio::test]
    async fn legacy_mixed_forms_load_as_one_main_without_changing_open_states_or_edge() {
        let (_dir, app) = app().await;
        std::fs::write(
            app.paths.root.join("features.json"),
            serde_json::to_vec(&json!({
                "outline":{"placement":"sidebar","open":true},
                "board":{"placement":"overlay","open":true},
                "next":{"placement":"desktop","open":false},
                "model":{"placement":"edge","open":true}
            }))
            .unwrap(),
        )
        .unwrap();
        let f = Features::load(&app.paths);
        assert_eq!(f.main.pref.placement, "sidebar");
        for id in ["outline", "board", "next"] {
            assert_eq!(f.entries[id].pref.placement, "sidebar");
        }
        assert!(f.entries["board"].pref.open);
        assert!(!f.entries["next"].pref.open);
        assert_eq!(f.entries["model"].pref.placement, "edge");
    }
}
