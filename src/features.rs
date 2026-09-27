// [INPUT]: Fixed feature identities, authenticated UI requests and existing business services.
// [OUTPUT]: Per-feature placement, single-owner leases and transient view handoff.
// [POS]: Presentation lifecycle only; business validation remains in tasks/host/model_control.
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

pub const IDS: [&str; 4] = ["outline", "board", "next", "model"];
#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Preference {
    pub placement: String,
    pub open: bool,
    pub size: [u32; 2],
}
impl Default for Preference {
    fn default() -> Self {
        Self {
            placement: "sidebar".into(),
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
}
struct Entry {
    pref: Preference,
    owner: String,
    view: Value,
    pending: Option<Pending>,
    child: Option<Child>,
    reveal: u64,
}
pub struct Features {
    entries: BTreeMap<String, Entry>,
}
impl Features {
    pub fn load(paths: &Paths) -> Self {
        let mut prefs: BTreeMap<String, Preference> =
            std::fs::read(paths.root.join("features.json"))
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok())
                .unwrap_or_default();
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
                                    child: None,
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
            &serde_json::to_vec_pretty(&prefs)?,
        )
    }
    fn snapshot(&self) -> Value {
        json!({"features":self.entries.iter().map(|(id,e)|json!({"id":id,"desktopSupported":crate::panel::popout_supported(),"placement":e.pref.placement,"open":e.pref.open,"size":e.pref.size,"owner":e.owner,"view":e.view,"reveal":e.reveal,"pending":e.pending.as_ref().map(|p|json!({"placement":p.placement,"owner":p.owner,"ready":p.source_ready}))})).collect::<Vec<_>>()})
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
    pub async fn feature_state(&self) -> Value {
        let mut state = self.features.lock().await.snapshot();
        let view = self.view();
        state["appearance"] = json!({"theme":view.panel_theme,"fontSize":view.panel_font_base,"themes":self.surfaces.lock().await.preferences.themes});
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
        if let Some(e) = f.entries.get_mut(id) {
            e.pref.open = false;
            e.pending = None;
        }
        f.save(&self.paths)
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
        let id = input["id"].as_str().context("缺少功能")?;
        ensure!(IDS.contains(&id), "未知功能");
        let owner = input["owner"].as_str().unwrap_or("");
        if op == "window" {
            let f = self.features.lock().await;
            let e = f.entries.get(id).context("功能已关闭")?;
            let valid = e.pref.open && e.owner == owner && e.pref.placement == "desktop"
                || e.pending
                    .as_ref()
                    .is_some_and(|p| p.owner == owner && p.placement == "desktop");
            let mut result = json!({"valid":valid,"active":e.owner==owner,"pid":e.child.as_ref().map(|c|c.id()),"reveal":e.reveal,"size":e.pref.size});
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
            let saved = self
                .features
                .lock()
                .await
                .entries
                .get(id)
                .map(|e| e.pref.placement.clone());
            let placement = input["placement"]
                .as_str()
                .unwrap_or(saved.as_deref().unwrap_or(if id == "model" {
                    "edge"
                } else if id == "board" {
                    "desktop"
                } else {
                    "sidebar"
                }));
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
            let e = f.entries.entry(id.into()).or_insert_with(|| Entry {
                pref: Preference {
                    placement: if id == "model" {
                        "edge".into()
                    } else {
                        placement.into()
                    },
                    ..Preference::default()
                },
                owner: uuid::Uuid::new_v4().to_string(),
                view: json!({}),
                pending: None,
                child: None,
                reveal: 0,
            });
            ensure!(e.pending.is_none(), "功能正在交接");
            if !owner.is_empty() {
                ensure!(owner == e.owner, "功能归属已变化");
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
            // Spawn before mutating ownership. Existing views remain alive until ready.
            if placement == "desktop" {
                let child = spawn(&self.paths, id, &lease)?;
                if let Some(mut old) = e.child.replace(child) {
                    let _ = old.kill();
                    let _ = old.wait();
                }
            }
            e.pending = Some(Pending {
                placement: placement.into(),
                owner: lease,
                started: Instant::now(),
                source_ready: !e.pref.open || owner == e.owner,
            });
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
        if op == "handoff" {
            let mut f = self.features.lock().await;
            let e = f.entries.get_mut(id).context("功能已关闭")?;
            ensure!(e.owner == owner, "功能归属已变化");
            let p = e.pending.as_mut().context("交接已取消")?;
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
        let p = e.pending.as_ref().context("交接已取消")?;
        ensure!(p.owner == owner && p.source_ready, "交接尚未就绪或已过期");
        let previous = e.pref.clone();
        e.pref.placement = p.placement.clone();
        e.pref.open = true;
        if let Err(error) = f.save(&self.paths) {
            f.entries.get_mut(id).unwrap().pref = previous;
            return Err(error);
        }
        let e = f.entries.get_mut(id).unwrap();
        e.owner = e.pending.take().unwrap().owner;
        e.reveal += 1;
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
        for (id, e) in &mut f.entries {
            if e.pending
                .as_ref()
                .is_some_and(|p| p.started.elapsed() > Duration::from_secs(15))
            {
                e.pending = None;
            }
            if e.child
                .as_mut()
                .is_some_and(|c| c.try_wait().ok().flatten().is_some())
            {
                e.child = None;
                if e.pref.placement == "desktop" {
                    e.pref.open = false;
                }
            }
            if e.pref.open
                && e.pref.placement == "desktop"
                && e.child.is_none()
                && e.pending.is_none()
            {
                e.child = spawn(&self.paths, id, &e.owner).ok();
            }
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
        for e in self.features.lock().await.entries.values_mut() {
            if let Some(mut c) = e.child.take() {
                let _ = c.kill();
                let _ = c.wait();
            }
        }
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
        app.feature_request(json!({"op":"handoff","id":"outline","owner":owner,"view":{"top":72}}))
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
}
