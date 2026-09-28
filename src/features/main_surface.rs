// [INPUT]: Feature owners and a requested main placement.
// [OUTPUT]: One shared main window and atomic group handoff; edge owners stay independent.
// [POS]: Main-surface lifecycle within features; no task or model business logic.
// [PROTOCOL]: Keep features/AGENTS.md in sync.
use super::*;

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct MainPreference {
    pub placement: String,
    pub return_placement: String,
    pub size: [u32; 2],
}
impl Default for MainPreference {
    fn default() -> Self {
        Self {
            placement: "sidebar".into(),
            return_placement: "sidebar".into(),
            size: [840, 620],
        }
    }
}
#[derive(Deserialize)]
#[serde(untagged)]
pub(super) enum SavedFeatures {
    Shared {
        main: MainPreference,
        features: BTreeMap<String, Preference>,
    },
    Legacy(BTreeMap<String, Preference>),
}
impl SavedFeatures {
    pub fn parts(self) -> (MainPreference, BTreeMap<String, Preference>) {
        match self {
            Self::Shared { main, features } => (main, features),
            Self::Legacy(features) => {
                let first = IDS
                    .iter()
                    .filter_map(|id| features.get(*id))
                    .find(|p| p.placement != "edge");
                let main = first
                    .map(|p| MainPreference {
                        placement: p.placement.clone(),
                        return_placement: p.return_placement.clone(),
                        size: p.size,
                    })
                    .unwrap_or_default();
                (main, features)
            }
        }
    }
}
pub(super) struct MainSurface {
    pub pref: MainPreference,
    pub target: Option<String>,
    pub child: Option<Child>,
    pub lease: String,
    pub active: String,
}
impl MainSurface {
    pub fn new(pref: MainPreference) -> Self {
        Self {
            pref,
            target: None,
            child: None,
            lease: String::new(),
            active: String::new(),
        }
    }
    pub fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.lease.clear();
    }
}
impl Features {
    pub(super) fn desktop_active(&self) -> bool {
        self.entries.values().any(|e| {
            e.pref.open && e.pref.placement == "desktop"
                || e.pending.as_ref().is_some_and(|p| p.placement == "desktop")
        })
    }
    pub(super) fn ensure_desktop(&mut self, paths: &Paths) -> Result<()> {
        if self.main.child.is_none() {
            let lease = uuid::Uuid::new_v4().to_string();
            self.main.child = Some(spawn(paths, "main", &lease)?);
            self.main.lease = lease;
        }
        Ok(())
    }
    pub(super) fn retire_desktop(&mut self) {
        if !self.desktop_active() {
            self.main.stop();
        }
    }
    pub(super) fn cancel_group(&mut self) {
        self.main.target = None;
        for e in self.entries.values_mut() {
            if e.pending.as_ref().is_some_and(|p| p.grouped) {
                e.pending = None;
            }
        }
        self.retire_desktop();
    }
    pub(super) fn begin_main(
        &mut self,
        paths: &Paths,
        target: &str,
        include: Option<(&str, &str)>,
    ) -> Result<()> {
        ensure!(
            ["sidebar", "overlay", "desktop"].contains(&target),
            "主界面位置无效"
        );
        ensure!(
            target != "desktop" || crate::panel::popout_supported(),
            "当前系统不支持桌面窗口"
        );
        ensure!(
            self.entries.values().all(|e| e.pending.is_none()),
            "功能正在交接，请稍后重试"
        );
        if target == self.main.pref.placement {
            return Ok(());
        }
        self.main.target = Some(target.into());
        for (id, e) in &mut self.entries {
            let included = include.is_some_and(|(selected, _)| selected == id);
            if (e.pref.placement != "edge" && e.pref.open) || included {
                e.pending = Some(Pending {
                    placement: target.into(),
                    owner: uuid::Uuid::new_v4().to_string(),
                    started: Instant::now(),
                    source_ready: !e.pref.open
                        || include
                            .is_some_and(|(selected, owner)| selected == id && owner == e.owner),
                    target_ready: false,
                    grouped: true,
                });
            }
        }
        if target == "desktop"
            && self.desktop_active()
            && let Err(error) = self.ensure_desktop(paths)
        {
            self.cancel_group();
            return Err(error);
        }
        self.finish_main(paths)
    }
    pub(super) fn finish_main(&mut self, paths: &Paths) -> Result<()> {
        let Some(target) = self.main.target.clone() else {
            return Ok(());
        };
        if self.entries.values().any(|e| {
            e.pending
                .as_ref()
                .is_some_and(|p| p.grouped && !p.target_ready)
        }) {
            return Ok(());
        }
        let previous = self.main.pref.clone();
        let prefs: BTreeMap<_, _> = self
            .entries
            .iter()
            .map(|(id, e)| (id.clone(), e.pref.clone()))
            .collect();
        if target == "desktop" {
            self.main.pref.return_placement = previous.placement.clone();
        }
        self.main.pref.placement = target.clone();
        for e in self.entries.values_mut() {
            if e.pref.placement != "edge" || e.pending.as_ref().is_some_and(|p| p.grouped) {
                e.pref.placement = target.clone();
                e.pref.return_placement = self.main.pref.return_placement.clone();
                if e.pending.as_ref().is_some_and(|p| p.grouped) {
                    e.pref.open = true;
                }
            }
        }
        if let Err(error) = self.save(paths) {
            self.main.pref = previous;
            for (id, pref) in prefs {
                self.entries.get_mut(&id).unwrap().pref = pref;
            }
            self.cancel_group();
            return Err(error);
        }
        for e in self.entries.values_mut() {
            if e.pending.as_ref().is_some_and(|p| p.grouped) {
                e.owner = e.pending.take().unwrap().owner;
                e.reveal += 1;
            }
        }
        self.main.target = None;
        // Retire the lease before another move can reuse a window already leaving the desktop.
        self.retire_desktop();
        Ok(())
    }
}
impl App {
    pub(super) async fn main_surface_request(&self, input: &Value) -> Result<Value> {
        let op = input["op"].as_str().unwrap_or("");
        let mut f = self.features.lock().await;
        let valid =
            !f.main.lease.is_empty() && input["lease"] == f.main.lease && f.desktop_active();
        if op == "main-window" {
            return Ok(json!({"valid":valid,"pid":f.main.child.as_ref().map(|c|c.id())}));
        }
        ensure!(valid, "主窗口归属已变化");
        if op == "main-size" {
            let size: [u32; 2] = serde_json::from_value(input["size"].clone())?;
            ensure!(
                size.iter().all(|v| (280..=20000).contains(v)) && size[0] >= 320,
                "窗口尺寸无效"
            );
            f.main.pref.size = size;
            f.save(&self.paths)?;
            return Ok(f.snapshot());
        }
        if op == "main-settings" {
            drop(f);
            webbrowser::open(&crate::lifecycle::Runtime::read(&self.paths)?.url())
                .context("无法打开设置")?;
            return Ok(json!({"ok":true}));
        }
        ensure!(op == "main-anchor", "未知主窗口操作");
        drop(f);
        let anchor = if let Some(client) = self.desktop_client().await {
            client
                .evaluate("window.__companionFloatingPanel?.panelWindowAnchor() ?? null".into())
                .await
                .unwrap_or(Value::Null)
        } else {
            Value::Null
        };
        Ok(json!({"anchor":anchor}))
    }
}
