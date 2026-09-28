// [INPUT]: 已连接的 CDP Client、宿主模型适配器及独立业务偏好。
// [OUTPUT]: 模型状态、串行切换、常用与顺序/预设保存与私有末次操作诊断；呈现交给 features。
// [POS]: 宿主模型控制服务；不读写建议生成配置或工作台的来源/布局。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。

use crate::{
    config::{Paths, write_private},
    state::App,
};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::Duration;
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
    pub model_column_width: f64,
    pub pinned: Vec<String>,
    pub model_order: Option<Vec<String>>,
    pub presets: Vec<Preset>,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            enabled: false,
            model_column_width: 140.,
            pinned: vec![],
            model_order: None,
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
        if !(100. ..=280.).contains(&self.model_column_width) {
            bail!("模型列宽无效");
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
        for (models, message) in [
            (self.pinned.as_slice(), "常用模型无效"),
            (
                self.model_order.as_deref().unwrap_or_default(),
                "模型顺序无效",
            ),
        ] {
            let mut ids = std::collections::HashSet::new();
            if models
                .iter()
                .any(|id| id.is_empty() || id.len() > 256 || !ids.insert(id))
            {
                bail!(message);
            }
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
    pub operation: std::sync::Arc<Mutex<()>>,
    snapshot: Value,
}

impl Control {
    pub fn load(paths: &Paths) -> Self {
        let preferences = std::fs::read(paths.root.join("model-control.json"))
            .ok()
            .and_then(|bytes| {
                let mut value: Value = serde_json::from_slice(&bytes).ok()?;
                for key in [
                    "edge",
                    "position",
                    "screen",
                    "keepOpen",
                    "theme",
                    "liquidVariant",
                ] {
                    value.as_object_mut()?.remove(key);
                }
                serde_json::from_value::<Preferences>(value).ok()
            })
            .filter(|prefs| prefs.validate().is_ok())
            .unwrap_or_default();
        Self {
            preferences,
            revision: 1,
            operation: std::sync::Arc::new(Mutex::new(())),
            snapshot: unavailable("尚未连接可操作的聊天"),
        }
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

    pub async fn validate_model_edge(&self, _lease: &str) -> Result<()> {
        bail!("旧模型窗口已停用，请从设置重新打开模型快切")
    }
    pub async fn model_control_apply(&self, command: Value) -> Result<Value> {
        let operation = self.model_control.lock().await.operation.clone();
        let _guard = operation
            .try_lock()
            .map_err(|_| anyhow::anyhow!("已有模型操作正在进行"))?;
        anyhow::ensure!(
            self.model_control.lock().await.preferences.enabled,
            "模型快切已停用"
        );
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
        let operation = self.model_control.lock().await.operation.clone();
        let _guard = operation.lock().await;
        let mut control = self.model_control.lock().await;
        if let Some(revision) = request.get("revision") {
            if revision.as_u64() != Some(control.revision) {
                bail!("model_control_conflict");
            }
        } else {
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
        {
            let mut control = self.model_control.lock().await;
            let previous = control.preferences.enabled;
            control.preferences.enabled = true;
            if let Err(error) = control.save(&self.paths) {
                control.preferences.enabled = previous;
                return Err(error);
            }
            control.revision += 1;
        }
        self.feature_request(json!({"op":"reveal","id":"model"}))
            .await
    }
    pub async fn close_model_control(&self) -> Result<Value> {
        let operation = self.model_control.lock().await.operation.clone();
        let _guard = operation.lock().await;
        {
            let mut control = self.model_control.lock().await;
            let previous = control.preferences.enabled;
            control.preferences.enabled = false;
            if let Err(error) = control.save(&self.paths) {
                control.preferences.enabled = previous;
                return Err(error);
            }
            control.revision += 1;
        }
        drop(_guard);
        self.close_feature("model").await?;
        Ok(json!({"ok":true}))
    }
    pub async fn model_control_window(&self, _lease: &str) -> Value {
        json!({"valid":false})
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
        let next = prefs.patched(&json!({"pinned":["a"]})).unwrap();
        assert_eq!(next.presets, prefs.presets);
        assert_eq!(next.pinned, vec!["a"]);
        let reordered = next.patched(&json!({"modelOrder":["b","a"]})).unwrap();
        assert_eq!(reordered.pinned, next.pinned);
        assert_eq!(reordered.presets, next.presets);
        for patch in [
            json!({"edge":"free"}),
            json!({"position":1.5}),
            json!({"body":"chat"}),
            json!({"pinned":["a","a"]}),
            json!({"modelOrder":["a","a"]}),
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
        let result = app.model_control_preferences(json!({"revision":1,"patch":{"modelOrder":["b","a"],"presets":[{"id":"p","name":"日常","selection":{"model":"a","reasoning":"high","speed":"standard"}}]}})).await.unwrap();
        assert_eq!(result["revision"], 2);
        assert!(
            app.model_control_preferences(json!({"revision":1,"patch":{"presets":[]}}))
                .await
                .is_err()
        );
        let loaded = Control::load(&paths);
        assert_eq!(loaded.preferences.presets.len(), 1);
        assert_eq!(
            loaded.preferences.model_order,
            Some(vec!["b".into(), "a".into()])
        );
        assert_eq!(before, app.appearance().await);
        assert!(!paths.config().exists());
        assert!(app.model_control_apply(json!({"target":{"id":"a"},"expectedRevision":"old","selection":{"model":"a","reasoning":"high","speed":"fast"}})).await.is_err());
    }
    #[test]
    fn defaults_do_not_open_windows_or_change_workbench() {
        let prefs: Preferences = serde_json::from_value(json!({})).unwrap();
        assert!(!prefs.enabled);
        prefs.validate().unwrap();
    }
}
