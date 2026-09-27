// [INPUT]: Presentation preferences, native window leases and existing host appearance.
// [OUTPUT]: Independent per-surface themes and one shared edge/notch container.
// [POS]: Presentation only; owns no task, model or outline business state.
// [PROTOCOL]: Keep src/AGENTS.md in sync.
use crate::{
    config::{Paths, write_private},
    state::App,
};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    process::{Child, Command, Stdio},
};

pub const PLACEMENTS: [&str; 4] = ["sidebar", "overlay", "desktop", "edge"];
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Theme {
    pub theme: String,
    pub liquid_variant: String,
}
impl Default for Theme {
    fn default() -> Self {
        Self {
            theme: "matte".into(),
            liquid_variant: "regular".into(),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Edge {
    pub edge: String,
    pub screen: String,
    pub position: f64,
    pub keep_open: bool,
}
impl Default for Edge {
    fn default() -> Self {
        Self {
            edge: "right".into(),
            screen: String::new(),
            position: 0.5,
            keep_open: false,
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Preferences {
    pub themes: BTreeMap<String, Theme>,
    pub edge: Edge,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            themes: PLACEMENTS
                .into_iter()
                .map(|p| {
                    (
                        p.into(),
                        Theme {
                            theme: if p == "edge" { "black" } else { "matte" }.into(),
                            ..Default::default()
                        },
                    )
                })
                .collect(),
            edge: Edge::default(),
        }
    }
}
impl Preferences {
    fn validate(&self) -> Result<()> {
        ensure!(
            self.themes.len() == 4 && PLACEMENTS.iter().all(|p| self.themes.contains_key(*p)),
            "呈现形式无效"
        );
        for theme in self.themes.values() {
            ensure!(
                ["black", "matte", "frosted", "native-glass"].contains(&theme.theme.as_str())
                    && ["regular", "clear"].contains(&theme.liquid_variant.as_str()),
                "主题无效"
            );
        }
        ensure!(
            ["left", "right", "top"].contains(&self.edge.edge.as_str())
                && (0.0..=1.0).contains(&self.edge.position)
                && self.edge.screen.len() <= 256,
            "贴边位置无效"
        );
        Ok(())
    }
}
pub struct Surfaces {
    pub preferences: Preferences,
    pub revision: u64,
    child: Option<Child>,
    lease: String,
    reveal: u64,
    error: Option<String>,
    last_start: Option<std::time::Instant>,
}
impl Surfaces {
    pub fn load(paths: &Paths) -> Self {
        let file = paths.root.join("surfaces.json");
        let loaded = std::fs::read(&file);
        let mut error = None;
        let preferences = match loaded {
            Ok(bytes) => serde_json::from_slice::<Preferences>(&bytes)
                .and_then(|p| {
                    p.validate().map_err(serde::de::Error::custom)?;
                    Ok(p)
                })
                .unwrap_or_else(|e| {
                    error = Some(format!("呈现设置损坏，已停止写入：{e}"));
                    Preferences::default()
                }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let mut p = Preferences::default();
                // Import visual preferences once; the old model file remains untouched.
                if let Ok(bytes) = std::fs::read(paths.root.join("model-control.json"))
                    && let Ok(old) = serde_json::from_slice::<Value>(&bytes)
                {
                    let mut edge = serde_json::to_value(&p.edge).unwrap();
                    for key in ["edge", "screen", "position", "keepOpen"] {
                        if let Some(value) = old.get(key) {
                            edge[key] = value.clone();
                        }
                    }
                    if let Ok(value) = serde_json::from_value(edge) {
                        p.edge = value;
                    }
                    let mut theme = serde_json::to_value(p.themes.get("edge").unwrap()).unwrap();
                    for key in ["theme", "liquidVariant"] {
                        if let Some(value) = old.get(key) {
                            theme[key] = value.clone();
                        }
                    }
                    if let Ok(value) = serde_json::from_value(theme) {
                        p.themes.insert("edge".into(), value);
                    }
                    if p.validate().is_err() {
                        p = Preferences::default();
                    }
                }
                if let Err(e) = write_private(&file, &serde_json::to_vec_pretty(&p).unwrap()) {
                    error = Some(e.to_string());
                }
                p
            }
            Err(e) => {
                error = Some(e.to_string());
                Preferences::default()
            }
        };
        Self {
            preferences,
            revision: 1,
            child: None,
            lease: String::new(),
            reveal: 0,
            error,
            last_start: None,
        }
    }
    fn state(&self) -> Value {
        json!({"revision":self.revision,"preferences":self.preferences,"error":self.error})
    }
    pub fn theme(&self, placement: &str) -> Theme {
        self.preferences
            .themes
            .get(placement)
            .cloned()
            .unwrap_or_default()
    }
    pub fn stop(&mut self) {
        self.lease.clear();
        self.last_start = None;
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    pub fn open(&mut self, paths: &Paths, reveal: bool) -> Result<()> {
        if self
            .child
            .as_mut()
            .is_none_or(|c| !matches!(c.try_wait(), Ok(None)))
        {
            if !reveal
                && self
                    .last_start
                    .is_some_and(|at| at.elapsed() < std::time::Duration::from_secs(30))
            {
                return Ok(());
            }
            self.last_start = Some(std::time::Instant::now());
            let lease = uuid::Uuid::new_v4().to_string();
            let child = Command::new(std::env::current_exe()?)
                .arg("--data-dir")
                .arg(&paths.root)
                .args(["edge-window", "--lease", &lease])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()?;
            self.child = Some(child);
            self.lease = lease;
        }
        if reveal {
            self.reveal += 1;
        }
        Ok(())
    }
}
impl App {
    pub async fn surface_appearance(&self, placement: &str) -> Value {
        let theme = self.surfaces.lock().await.theme(placement);
        let view = self.view();
        json!({"theme":view.panel_theme,"fontSize":view.panel_font_base,"surface":theme})
    }
    pub async fn surface_request(&self, input: Value) -> Result<Value> {
        let op = input["op"].as_str().unwrap_or("state");
        if op == "window" {
            let active = self.edge_features_active().await;
            let appearance = self.surface_appearance("edge").await;
            let s = self.surfaces.lock().await;
            let mut preferences = serde_json::to_value(&s.preferences.edge)?;
            preferences.as_object_mut().unwrap().extend(
                serde_json::to_value(s.theme("edge"))?
                    .as_object()
                    .unwrap()
                    .clone(),
            );
            return Ok(
                json!({"valid":active && !s.lease.is_empty() && input["lease"]==s.lease,"preferences":preferences,"reveal":s.reveal,"pid":s.child.as_ref().map(|c|c.id()),"appearance":{"hostTheme":{"theme":appearance["theme"]},"fontOffset":appearance["fontSize"].as_f64().unwrap_or(13.)-13.}}),
            );
        }
        let mut s = self.surfaces.lock().await;
        if op == "state" {
            return Ok(s.state());
        }
        ensure!(op == "save", "未知呈现设置操作");
        ensure!(s.error.is_none(), "{}", s.error.as_deref().unwrap_or(""));
        if input.get("lease").is_some() {
            ensure!(
                !s.lease.is_empty() && input["lease"] == s.lease,
                "贴边窗口已失效"
            );
        } else {
            ensure!(
                input["revision"].as_u64() == Some(s.revision),
                "呈现设置已更新，请刷新后再试"
            );
        }
        let mut next = s.preferences.clone();
        if let Some(placement) = input["placement"].as_str() {
            ensure!(PLACEMENTS.contains(&placement), "呈现形式无效");
            next.themes.insert(
                placement.into(),
                serde_json::from_value(input["theme"].clone())?,
            );
        }
        if let Some(patch) = input.get("edge") {
            let mut value = serde_json::to_value(&next.edge)?;
            value
                .as_object_mut()
                .unwrap()
                .extend(patch.as_object().context("位置设置无效")?.clone());
            next.edge = serde_json::from_value(value)?;
        }
        next.validate()?;
        write_private(
            &self.paths.root.join("surfaces.json"),
            &serde_json::to_vec_pretty(&next)?,
        )?;
        s.preferences = next;
        s.revision += 1;
        Ok(s.state())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn legacy_model_migrates_visual_fields_once_and_preserves_business() {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::new(Some(temp.path().into())).unwrap();
        let legacy = json!({"enabled":true,"edge":"top","screen":"saved-screen","position":0.3,"theme":"frosted","pinned":["a"],"presets":[{"id":"p","name":"日常","selection":{"model":"a","reasoning":"high","speed":"standard"}}]});
        write_private(
            &paths.root.join("model-control.json"),
            &serde_json::to_vec(&legacy).unwrap(),
        )
        .unwrap();
        let app = App::new(paths.clone(), Default::default(), None, false);
        let state = app.surface_request(json!({"op":"state"})).await.unwrap();
        assert_eq!(state["preferences"]["edge"]["screen"], "saved-screen");
        assert_eq!(state["preferences"]["themes"]["edge"]["theme"], "frosted");
        let features = app.feature_state().await;
        assert_eq!(features["features"][0]["placement"], "edge");
        assert_eq!(features["features"][0]["open"], true);
        let model = app.model_control_state(false).await.unwrap();
        assert_eq!(model["preferences"]["presets"], legacy["presets"]);
        app.model_control_preferences(json!({"revision":1,"patch":{"pinned":["a","b"]}}))
            .await
            .unwrap();
        app.surface_request(json!({"op":"save","revision":1,"placement":"sidebar","theme":{"theme":"black","liquidVariant":"regular"}})).await.unwrap();
        assert!(
            app.surface_request(json!({"op":"save","revision":1,"edge":{"position":0.9}}))
                .await
                .is_err()
        );
        let cold = Surfaces::load(&paths);
        assert_eq!(cold.theme("edge").theme, "frosted");
        assert_eq!(cold.theme("sidebar").theme, "black");
        assert_eq!(cold.preferences.edge.position, 0.3);
        assert_eq!(
            crate::model_control::Control::load(&paths)
                .preferences
                .presets
                .len(),
            1
        );
    }
}
