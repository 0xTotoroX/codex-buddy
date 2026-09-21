// [INPUT]: 已连接的 CDP Client、宿主模型适配器、独立偏好及原生窗口租约。
// [OUTPUT]: 模型控制条状态、串行切换、偏好保存、私有末次操作诊断与单实例窗口生命周期。
// [POS]: 宿主模型控制服务；不读写建议生成配置或工作台的来源/布局。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。

use crate::{
    config::{Paths, write_private},
    state::App,
};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Selection {
    pub model: String,
    pub reasoning: String,
    pub speed: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub selection: Selection,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Preferences {
    pub enabled: bool,
    pub edge: String,
    pub position: f64,
    pub screen: String,
    pub keep_open: bool,
    pub theme: String,
    pub liquid_variant: String,
    pub model_column_width: f64,
    pub pinned: Vec<String>,
    pub presets: Vec<Preset>,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            enabled: false,
            edge: "right".into(),
            position: 0.5,
            screen: String::new(),
            keep_open: false,
            theme: "black".into(),
            liquid_variant: "regular".into(),
            model_column_width: 140.,
            pinned: vec![],
            presets: vec![],
        }
    }
}

impl Selection {
    fn validate(&self) -> Result<()> {
        if self.model.is_empty()
            || self.model.len() > 256
            || self.reasoning.len() > 64
            || !["standard", "fast"].contains(&self.speed.as_str())
        {
            bail!("模型配置无效");
        }
        Ok(())
    }
}

impl Preferences {
    fn validate(&self) -> Result<()> {
        if !["right", "left", "top"].contains(&self.edge.as_str())
            || !(0. ..=1.).contains(&self.position)
            || !(100. ..=280.).contains(&self.model_column_width)
            || self.screen.len() > 256
        {
            bail!("控制条位置或列宽无效");
        }
        if !["black", "matte", "frosted", "native-glass"].contains(&self.theme.as_str())
            || !["regular", "clear"].contains(&self.liquid_variant.as_str())
        {
            bail!("模型控制主题无效");
        }
        let mut ids = std::collections::HashSet::new();
        for preset in &self.presets {
            if preset.id.is_empty()
                || preset.id.len() > 128
                || !ids.insert(&preset.id)
                || preset.name.trim().is_empty()
                || preset.name.len() > 256
            {
                bail!("预设名称或标识无效");
            }
            preset.selection.validate()?;
        }
        let mut pins = std::collections::HashSet::new();
        if self
            .pinned
            .iter()
            .any(|id| id.is_empty() || id.len() > 256 || !pins.insert(id))
        {
            bail!("置顶模型无效");
        }
        Ok(())
    }

    fn patched(&self, patch: &Value) -> Result<Self> {
        let patch = patch.as_object().context("设置必须为对象")?;
        let mut value = serde_json::to_value(self)?;
        for (key, item) in patch {
            value[key] = item.clone();
        }
        let result: Self = serde_json::from_value(value).context("未知模型控制设置")?;
        result.validate()?;
        Ok(result)
    }
}

pub struct Control {
    pub preferences: Preferences,
    pub revision: u64,
    child: Option<Child>,
    lease: String,
    reveal: u64,
    last_start: Option<Instant>,
    pub operation: std::sync::Arc<Mutex<()>>,
    snapshot: Value,
}

impl Control {
    pub fn load(paths: &Paths) -> Self {
        let preferences = std::fs::read(paths.root.join("model-control.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Preferences>(&bytes).ok())
            .filter(|prefs| prefs.validate().is_ok())
            .unwrap_or_default();
        Self {
            preferences,
            revision: 1,
            child: None,
            lease: String::new(),
            reveal: 0,
            last_start: None,
            operation: std::sync::Arc::new(Mutex::new(())),
            snapshot: unavailable("尚未连接可操作的聊天"),
        }
    }

    fn alive(&mut self) -> bool {
        if let Some(child) = &mut self.child {
            if matches!(child.try_wait(), Ok(None)) {
                return true;
            }
            self.child = None;
            self.lease.clear();
        }
        false
    }

    fn start(&mut self, paths: &Paths) -> Result<()> {
        if self.alive() {
            return Ok(());
        }
        self.last_start = Some(Instant::now());
        let lease = uuid::Uuid::new_v4().to_string();
        let child = Command::new(std::env::current_exe()?)
            .arg("--data-dir")
            .arg(&paths.root)
            .arg("model-control-window")
            .arg("--lease")
            .arg(&lease)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;
        self.child = Some(child);
        self.lease = lease;
        Ok(())
    }

    fn save(&self, paths: &Paths) -> Result<()> {
        write_private(
            &paths.root.join("model-control.json"),
            &serde_json::to_vec_pretty(&self.preferences)?,
        )
    }

    fn envelope(&self, snapshot: Value) -> Value {
        json!({"snapshot":snapshot,"preferences":self.preferences,"revision":self.revision})
    }
}

fn unavailable(message: &str) -> Value {
    json!({"target":null,"revision":"","status":"unavailable","message":message,"current":null,"models":[],"generating":false})
}

impl App {
    // Last explicit user operation only: no chat text, identifiers, DOM dump or credentials.
    fn record_model_control_diagnostic(&self, kind: &str, value: &Value) {
        let record = json!({"kind":kind,"time":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs()),
            "status":value["status"],"message":value["message"],"diagnostic":value["diagnostic"]});
        if let Err(error) = write_private(
            &self.paths.root.join("model-control-diagnostic.json"),
            &serde_json::to_vec_pretty(&record).unwrap_or_default(),
        ) {
            tracing::warn!(%error, "无法保存模型切换诊断");
        }
    }

    pub async fn model_control_state(&self, refresh: bool) -> Result<Value> {
        let operation = self.model_control.lock().await.operation.clone();
        let Ok(_guard) = operation.try_lock() else {
            let control = self.model_control.lock().await;
            let mut snapshot = control.snapshot.clone();
            snapshot["status"] = json!("busy");
            snapshot["message"] = json!("正在核对并切换模型…");
            return Ok(control.envelope(snapshot));
        };
        let snapshot = match self.desktop_client().await {
            Some(client) => {
                let result = client
                    .evaluate_with_timeout(
                        format!("window.__codexBuddyModelControl?.snapshot({refresh}) ?? null"),
                        Duration::from_secs(20),
                    )
                    .await;
                if !self
                    .desktop_client()
                    .await
                    .is_some_and(|now| std::sync::Arc::ptr_eq(&client, &now))
                {
                    unavailable("连接已变化，请重新核对当前聊天")
                } else {
                    match result {
                        Ok(value) if !value.is_null() => value,
                        _ => unavailable("宿主模型连接暂不可用，请稍后刷新"),
                    }
                }
            }
            None => unavailable("尚未连接 Codex；请先在设置中连接宿主"),
        };
        if refresh {
            self.record_model_control_diagnostic("refresh", &snapshot);
        }
        let mut control = self.model_control.lock().await;
        control.snapshot = snapshot.clone();
        Ok(control.envelope(snapshot))
    }

    pub async fn model_control_apply(&self, command: Value) -> Result<Value> {
        let operation = self.model_control.lock().await.operation.clone();
        let _guard = operation
            .try_lock()
            .map_err(|_| anyhow::anyhow!("已有模型操作正在进行"))?;
        let selection: Selection =
            serde_json::from_value(command["selection"].clone()).context("请选择完整模型配置")?;
        selection.validate()?;
        if command["target"]["id"].as_str().is_none_or(str::is_empty)
            || command["expectedRevision"]
                .as_str()
                .is_none_or(str::is_empty)
        {
            bail!("聊天来源已过期，请刷新后重试");
        }
        let client = self.desktop_client().await.context("尚未连接 Codex")?;
        let payload = json!({"target":command["target"],"expectedRevision":command["expectedRevision"],"selection":selection,"preserveSpeed":command["preserveSpeed"] == true});
        let response = client
            .evaluate_with_timeout(
                format!("window.__codexBuddyModelControl.apply({payload})"),
                Duration::from_secs(20),
            )
            .await;
        let result = match response {
            Ok(value) => value,
            Err(_) => {
                let _ = client
                    .evaluate("window.__codexBuddyModelControl?.cancel(); true".into())
                    .await;
                json!({"status":"failed","message":"连接中断或操作超时，实际配置尚未确认，请刷新核对","snapshot":unavailable("实际配置尚未确认")})
            }
        };
        self.record_model_control_diagnostic("apply", &result);
        let same = self
            .desktop_client()
            .await
            .is_some_and(|now| std::sync::Arc::ptr_eq(&client, &now));
        let snapshot = if same {
            result
                .get("snapshot")
                .cloned()
                .unwrap_or_else(|| unavailable("请刷新核对实际配置"))
        } else {
            unavailable("连接已变化，旧操作结果不再适用于当前聊天")
        };
        let mut control = self.model_control.lock().await;
        control.snapshot = snapshot.clone();
        let mut envelope = control.envelope(snapshot);
        envelope["result"] = if same {
            result
        } else {
            json!({"status":"failed","message":"连接已变化，操作已停止"})
        };
        Ok(envelope)
    }

    pub async fn model_control_preferences(&self, request: Value) -> Result<Value> {
        let mut control = self.model_control.lock().await;
        if let Some(revision) = request.get("revision") {
            if revision.as_u64() != Some(control.revision) {
                bail!("model_control_conflict");
            }
        } else if request["patch"].as_object().is_none_or(|patch| {
            patch
                .keys()
                .any(|key| !["edge", "position", "screen", "keepOpen"].contains(&key.as_str()))
        }) {
            bail!("保存预设必须提供当前版本");
        }
        let next = control.preferences.patched(&request["patch"])?;
        write_private(
            &self.paths.root.join("model-control.json"),
            &serde_json::to_vec_pretty(&next)?,
        )?;
        control.preferences = next;
        control.revision += 1;
        Ok(control.envelope(control.snapshot.clone()))
    }

    pub async fn open_model_control(&self) -> Result<Value> {
        let mut control = self.model_control.lock().await;
        let previous = control.preferences.enabled;
        control.preferences.enabled = true;
        if let Err(error) = control.save(&self.paths) {
            control.preferences.enabled = previous;
            return Err(error);
        }
        if let Err(error) = control.start(&self.paths) {
            control.preferences.enabled = previous;
            control.save(&self.paths)?;
            return Err(error);
        }
        control.revision += 1;
        control.reveal += 1;
        Ok(json!({"ok":true}))
    }

    pub async fn close_model_control(&self) -> Result<Value> {
        let mut control = self.model_control.lock().await;
        let previous = control.preferences.enabled;
        control.preferences.enabled = false;
        if let Err(error) = control.save(&self.paths) {
            control.preferences.enabled = previous;
            return Err(error);
        }
        control.revision += 1;
        control.lease.clear();
        // 只回收本服务创建的控制条进程，不影响官方宿主或工作台。
        if let Some(mut child) = control.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        Ok(json!({"ok":true}))
    }

    pub async fn model_control_window(&self, lease: &str) -> Value {
        let host = if let Some(client) = self.desktop_client().await {
            let presence = client
                .evaluate_with_timeout(
                    "window.__codexBuddyModelControl?.presence?.() ?? null".into(),
                    Duration::from_millis(600),
                )
                .await
                .unwrap_or(Value::Null);
            if self
                .desktop_client()
                .await
                .is_some_and(|now| std::sync::Arc::ptr_eq(&client, &now))
            {
                presence
            } else {
                Value::Null
            }
        } else {
            Value::Null
        };
        let ui = self.appearance().await.ui;
        let appearance = json!({"material":ui.material,"liquidVariant":ui.liquid_variant,"fontOffset":ui.font_offset});
        let mut control = self.model_control.lock().await;
        let valid = !lease.is_empty()
            && control.lease == lease
            && control.preferences.enabled
            && control.alive();
        json!({"valid":valid,"preferences":control.preferences,"reveal":control.reveal,"appearance":appearance,"host":host})
    }

    pub async fn supervise_model_control(&self) {
        let mut control = self.model_control.lock().await;
        if control.preferences.enabled
            && !control.alive()
            && control
                .last_start
                .is_none_or(|last| last.elapsed() > Duration::from_secs(30))
            && let Err(error) = control.start(&self.paths)
        {
            tracing::warn!(%error, "无法恢复模型控制条");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preference_patches_preserve_unrelated_fields_and_validate() {
        let prefs = Preferences {
            presets: vec![Preset {
                id: "a".into(),
                name: "日常".into(),
                selection: Selection {
                    model: "a".into(),
                    reasoning: "high".into(),
                    speed: "standard".into(),
                },
            }],
            ..Default::default()
        };
        let next = prefs
            .patched(&json!({"edge":"top","position":0.2}))
            .unwrap();
        assert_eq!(next.presets, prefs.presets);
        assert_eq!(next.edge, "top");
        for patch in [
            json!({"edge":"free"}),
            json!({"position":1.5}),
            json!({"body":"chat"}),
            json!({"pinned":["a","a"]}),
            json!({"modelColumnWidth":0}),
        ] {
            assert!(prefs.patched(&patch).is_err());
        }
    }
    #[tokio::test]
    async fn preferences_conflict_cold_restore_and_model_settings_are_independent() {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::new(Some(temp.path().into())).unwrap();
        let app = App::new(paths.clone(), Default::default(), None, false);
        let before = app.appearance().await;
        let initial = app.model_control_state(false).await.unwrap();
        assert_eq!(initial["snapshot"]["status"], "unavailable");
        assert!(
            !app.model_control_window("invalid").await["valid"]
                .as_bool()
                .unwrap()
        );
        let result = app.model_control_preferences(json!({"revision":1,"patch":{"edge":"top","theme":"native-glass","liquidVariant":"clear","screen":"fixture-screen","presets":[{"id":"p","name":"日常","selection":{"model":"a","reasoning":"high","speed":"standard"}}]}})).await.unwrap();
        assert_eq!(result["revision"], 2);
        assert!(
            app.model_control_preferences(json!({"revision":1,"patch":{"presets":[]}}))
                .await
                .is_err()
        );
        app.model_control_preferences(json!({"patch":{"position":0.7}}))
            .await
            .unwrap();
        let loaded = Control::load(&paths);
        assert_eq!(loaded.preferences.presets.len(), 1);
        assert_eq!(loaded.preferences.edge, "top");
        assert_eq!(loaded.preferences.position, 0.7);
        assert_eq!(loaded.preferences.theme, "native-glass");
        assert_eq!(loaded.preferences.liquid_variant, "clear");
        assert_eq!(loaded.preferences.screen, "fixture-screen");
        assert_eq!(before, app.appearance().await);
        let appearance = app.model_control_window("invalid").await["appearance"].clone();
        assert_eq!(appearance["material"], before.ui.material);
        let changed = app.save_appearance(json!({"expectedRevision":before.revision,"ui":{"material":"native-glass","liquidVariant":"clear","fontOffset":2}})).await.unwrap();
        let inherited = app.model_control_window("invalid").await["appearance"].clone();
        assert_eq!(inherited["material"], "native-glass");
        assert_eq!(inherited["liquidVariant"], "clear");
        assert_eq!(inherited["fontOffset"], 2.);
        assert_eq!(changed, app.appearance().await);
        assert!(!paths.config().exists());
        assert!(app.model_control_apply(json!({"target":{"id":"a"},"expectedRevision":"old","selection":{"model":"a","reasoning":"high","speed":"fast"}})).await.is_err());
    }
    #[test]
    fn defaults_do_not_open_windows_or_change_workbench() {
        let prefs: Preferences = serde_json::from_value(json!({})).unwrap();
        assert!(!prefs.enabled);
        assert_eq!(prefs.edge, "right");
        assert_eq!(prefs.theme, "black");
        for theme in ["black", "matte", "frosted", "native-glass"] {
            let next = prefs
                .patched(&json!({"theme":theme,"liquidVariant":"clear"}))
                .unwrap();
            assert_eq!(next.theme, theme);
        }
        assert!(prefs.patched(&json!({"theme":"neon"})).is_err());
        prefs.validate().unwrap();
    }
}
