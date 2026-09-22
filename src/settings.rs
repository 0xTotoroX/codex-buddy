// [INPUT]: App、有效模型配置与私有配置/密钥文件。
// [OUTPUT]: 三种方向来源/库/位置/Jev 设置与独立密钥保存、并发保存版本与有效生成版本。
// [POS]: 设置事务边界；无关大纲开关与常用提示词修改不取消生成；maxInputChars=0 表示完整最近一问一答，旧正数上限保留。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。

use crate::{model::Model, state::App};
use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuickPrompt {
    pub label: String,
    pub prompt: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Options {
    pub enabled: bool,
    pub answer_outline_enabled: bool,
    pub generation_mode: String,
    pub protocol: String,
    pub api_key_env: String,
    pub max_items: usize,
    pub direction_source: crate::directions::DirectionSource,
    pub direction_library: Vec<crate::directions::Direction>,
    pub selected_directions: Vec<String>,
    pub jev: crate::jev::Options,
    pub quick_prompts: Vec<QuickPrompt>,
    pub max_input_chars: usize,
    pub max_output_tokens: usize,
    pub timeout_ms: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Config, Paths};

    #[tokio::test]
    async fn quick_prompts_persist_without_invalidating_suggestions() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(Some(dir.path().into())).unwrap();
        let app = App::new(paths.clone(), Config::default(), None, false);
        let before = app.settings().await;
        assert_eq!(before["quickPrompts"][0]["prompt"], "继续");
        let saved = app
            .save_settings(
                serde_json::from_value(
                    json!({"quickPrompts":[{"label":"解释", "prompt":"解释刚才的概念"}]}),
                )
                .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(before["generationRevision"], saved["generationRevision"]);
        assert_eq!(
            paths.load().unwrap().stepwise.quick_prompts[0].prompt,
            "解释刚才的概念"
        );
        assert!(
            app.save_settings(
                serde_json::from_value(json!({"quickPrompts":[{"label":"", "prompt":"x"}]}))
                    .unwrap()
            )
            .await
            .is_err()
        );
        app.save_settings(serde_json::from_value(json!({"quickPrompts":[]})).unwrap())
            .await
            .unwrap();
        assert!(paths.load().unwrap().stepwise.quick_prompts.is_empty());
    }

    #[tokio::test]
    async fn complete_context_setting_persists_and_invalidates_generation() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(Some(dir.path().into())).unwrap();
        let old: Config = serde_json::from_str(r#"{"stepwise":{"maxInputChars":12000}}"#).unwrap();
        assert_eq!(Options::default().max_input_chars, 0);
        assert_eq!(old.stepwise.max_input_chars, 12000);
        let app = App::new(paths.clone(), old, None, false);
        let before = app.settings().await;
        let saved = app
            .save_settings(serde_json::from_value(json!({"maxInputChars":0})).unwrap())
            .await
            .unwrap();
        assert_eq!(saved["maxInputChars"], 0);
        assert_ne!(saved["generationRevision"], before["generationRevision"]);
        assert_eq!(paths.load().unwrap().stepwise.max_input_chars, 0);
        assert!(
            app.save_settings(serde_json::from_value(json!({"maxInputChars":100})).unwrap())
                .await
                .is_err()
        );
        assert_eq!(paths.load().unwrap().stepwise.max_input_chars, 0);
    }

    #[tokio::test]
    async fn restart_policy_is_persisted_without_changing_generation() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(Some(dir.path().into())).unwrap();
        let old: Config = serde_json::from_str(r#"{"model":"fixture"}"#).unwrap();
        let app = App::new(paths.clone(), old, None, false);
        let initial = app.settings().await;
        assert_eq!(initial["hostRestartPolicy"], "ask");
        let saved = app.save_settings(serde_json::from_value(json!({
            "hostRestartPolicy":"force", "expectedRevision": initial["configurationRevision"]
        })).unwrap()).await.unwrap();
        assert_eq!(saved["hostRestartPolicy"], "force");
        assert_eq!(saved["generationRevision"], initial["generationRevision"]);
        assert_eq!(
            paths.load().unwrap().host_restart_policy,
            crate::config::HostRestartPolicy::Force
        );
        assert!(serde_json::from_value::<Update>(json!({"hostRestartPolicy":"kill-all"})).is_err());
        assert!(
            app.save_settings(
                serde_json::from_value(json!({
                    "hostRestartPolicy":"ask", "expectedRevision":initial["configurationRevision"]
                }))
                .unwrap()
            )
            .await
            .is_err()
        );
        app.save_settings(serde_json::from_value(json!({"hostRestartPolicy":"ask"})).unwrap())
            .await
            .unwrap();
        assert_eq!(
            paths.load().unwrap().host_restart_policy,
            crate::config::HostRestartPolicy::Ask
        );
    }

    #[tokio::test]
    async fn outline_and_noop_saves_do_not_cancel_generation() {
        let dir = tempfile::tempdir().unwrap();
        let app = App::new(
            Paths::new(Some(dir.path().into())).unwrap(),
            Config::default(),
            None,
            false,
        );
        let initial = app.settings().await;
        let outline = app
            .save_settings(Update {
                answer_outline_enabled: Some(false),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_ne!(
            outline["configurationRevision"],
            initial["configurationRevision"]
        );
        assert_eq!(outline["generationRevision"], initial["generationRevision"]);
        let noop = app.save_settings(Update::default()).await.unwrap();
        assert_eq!(noop["generationRevision"], initial["generationRevision"]);
        let generation = app
            .save_settings(Update {
                max_items: Some(2),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_ne!(
            generation["generationRevision"],
            initial["generationRevision"]
        );
        assert_eq!(generation["answerOutlineEnabled"], false);
        let disabled = app
            .save_settings(Update {
                enabled: Some(false),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_ne!(
            disabled["generationRevision"],
            generation["generationRevision"]
        );
        assert_eq!(disabled["answerOutlineEnabled"], false);
    }

    #[tokio::test]
    async fn preserves_keys_unrelated_fields_and_rejects_stale_updates() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(Some(dir.path().into())).unwrap();
        let mut config = Config {
            provider: Some("api".into()),
            model: Some("example-model".into()),
            cdp_endpoint: Some("http://127.0.0.1:9229".into()),
            ..Default::default()
        };
        config
            .extra
            .insert("futureOption".into(), json!({"keep":true}));
        let app = App::new(paths.clone(), config, None, false);
        let saved = app
            .save_settings(Update {
                api_key: Some("fixture-secret".into()),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(saved["storedApiKey"], true);
        assert!(!saved.to_string().contains("fixture-secret"));
        app.save_settings(Update {
            api_key: Some(String::new()),
            max_items: Some(2),
            ..Default::default()
        })
        .await
        .unwrap();
        assert_eq!(paths.load_key().unwrap().as_deref(), Some("fixture-secret"));
        assert_eq!(paths.load().unwrap().extra["futureOption"]["keep"], true);
        assert_eq!(
            paths.load().unwrap().cdp_endpoint.as_deref(),
            Some("http://127.0.0.1:9229")
        );
        assert!(
            app.save_settings(Update {
                expected_revision: Some(1),
                model: Some("stale".into()),
                ..Default::default()
            })
            .await
            .is_err()
        );
        assert!(
            app.save_settings(Update {
                max_items: Some(99),
                api_key: Some("must-not-save".into()),
                ..Default::default()
            })
            .await
            .is_err()
        );
        assert_eq!(paths.load_key().unwrap().as_deref(), Some("fixture-secret"));
        assert_eq!(
            paths.load().unwrap().model.as_deref(),
            Some("example-model")
        );
        app.save_settings(Update {
            clear_api_key: true,
            ..Default::default()
        })
        .await
        .unwrap();
        assert!(paths.load_key().unwrap().is_none());
    }
}

impl Default for Options {
    fn default() -> Self {
        Self {
            enabled: true,
            answer_outline_enabled: true,
            generation_mode: "manual".into(),
            protocol: "responses".into(),
            api_key_env: "CODEX_BUDDY_API_KEY".into(),
            max_items: 3,
            direction_source: Default::default(),
            direction_library: crate::directions::defaults(),
            selected_directions: vec![],
            jev: Default::default(),
            quick_prompts: ["继续", "执行"]
                .into_iter()
                .map(|text| QuickPrompt {
                    label: text.into(),
                    prompt: text.into(),
                })
                .collect(),
            max_input_chars: 0,
            max_output_tokens: 2000,
            timeout_ms: 120000,
        }
    }
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Update {
    pub host_restart_policy: Option<crate::config::HostRestartPolicy>,
    pub expected_revision: Option<u64>,
    pub enabled: Option<bool>,
    pub answer_outline_enabled: Option<bool>,
    pub generation_mode: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub base_url: Option<String>,
    pub protocol: Option<String>,
    pub api_key: Option<String>,
    pub clear_api_key: bool,
    pub api_key_env: Option<String>,
    pub max_items: Option<usize>,
    pub direction_source: Option<crate::directions::DirectionSource>,
    pub direction_library: Option<Vec<crate::directions::Direction>>,
    pub selected_directions: Option<Vec<String>>,
    pub jev: Option<crate::jev::Options>,
    pub jev_consent: Option<bool>,
    pub jev_api_key: Option<String>,
    pub clear_jev_api_key: bool,
    pub quick_prompts: Option<Vec<QuickPrompt>>,
    pub max_input_chars: Option<usize>,
    pub max_output_tokens: Option<usize>,
    pub timeout_ms: Option<u64>,
}

impl App {
    pub async fn settings(&self) -> Value {
        let config = self.config.lock().await;
        let model = self.model.read().await;
        let info = model.info();
        let mut value = serde_json::to_value(&config.stepwise).expect("settings serialize");
        let fields = value.as_object_mut().expect("settings object");
        fields.extend(json!({
            "hostRestartPolicy": config.host_restart_policy,
            "popoutSupported": self.panel.lock().await.popout_supported,
            "provider": model.provider, "model": model.name,
            "baseUrl": model.base_url, "available": info.available, "reason": info.reason,
            "apiKeyConfigured": model.has_key() || model.provider == "codex" && info.available,
            "storedApiKey": self.paths.load_key().ok().flatten().is_some(),
            "jevKeyConfigured": model.has_jev_key(),
            "storedJevApiKey": self.paths.load_named_key("jevApiKey").ok().flatten().is_some(),
            "baseUrlConfigured": model.provider == "codex" || !model.base_url.is_empty(),
            "configurationRevision": self.settings_revision.load(std::sync::atomic::Ordering::SeqCst),
            "generationRevision": self.generation_revision.load(std::sync::atomic::Ordering::SeqCst),
            "environmentOverrides": model.environment_overrides(),
        }).as_object().unwrap().clone());
        value
    }

    pub async fn save_settings(&self, patch: Update) -> Result<Value> {
        let _guard = self.transition.lock().await;
        let mut config = self.config.lock().await;
        if patch.expected_revision.is_some_and(|revision| {
            revision
                != self
                    .settings_revision
                    .load(std::sync::atomic::Ordering::SeqCst)
        }) {
            bail!("设置已在其他窗口更新，请重新载入后再保存");
        }
        let mut next = config.clone();
        if let Some(value) = patch.host_restart_policy {
            next.host_restart_policy = value;
        }
        if let Some(value) = patch.provider {
            if !["codex", "api"].contains(&value.as_str()) {
                bail!("不支持的模型来源");
            }
            next.provider = Some(value);
        }
        if let Some(value) = patch.model {
            next.model = Some(value.trim().to_owned());
        }
        if let Some(value) = patch.base_url {
            let value = value.trim();
            if !value.is_empty() {
                crate::model::api_base(value)?;
            }
            next.base_url = Some(value.trim_end_matches('/').to_owned());
        }
        let options = &mut next.stepwise;
        if let Some(value) = patch.enabled {
            options.enabled = value;
        }
        if let Some(value) = patch.answer_outline_enabled {
            options.answer_outline_enabled = value;
        }
        if let Some(value) = patch.generation_mode {
            if !["manual", "auto"].contains(&value.as_str()) {
                bail!("生成模式无效");
            }
            options.generation_mode = value;
        }
        if let Some(value) = patch.protocol {
            if ![
                "responses",
                "chat_completions",
                "anthropic_messages",
                "auto",
            ]
            .contains(&value.as_str())
            {
                bail!("API 协议无效");
            }
            options.protocol = value;
        }
        if let Some(value) = patch.api_key_env {
            let value = value.trim();
            if !value.is_empty()
                && (!value.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
                    || value.starts_with(|c: char| c.is_ascii_digit()))
            {
                bail!("密钥环境变量名无效");
            }
            options.api_key_env = value.to_owned();
        }
        if let Some(mut value) = patch.quick_prompts {
            if value.len() > 8 {
                bail!("常用提示词最多 8 个");
            }
            for item in &mut value {
                item.label = item.label.trim().to_owned();
                item.prompt = item.prompt.trim().to_owned();
                if item.label.is_empty()
                    || item.label.chars().count() > 20
                    || item.prompt.is_empty()
                    || item.prompt.chars().count() > 4000
                {
                    bail!("常用提示词需要 1–20 字的名称和 1–4000 字的内容");
                }
            }
            options.quick_prompts = value;
        }
        if let Some(value) = patch.max_items {
            if !(1..=6).contains(&value) {
                bail!("建议数量应为 1–6");
            }
            options.max_items = value;
        }
        if let Some(value) = patch.max_input_chars {
            if value != 0 && !(500..=32000).contains(&value) {
                bail!("请选择完整最近一次聊天，或将输入字符上限设为 500–32000");
            }
            options.max_input_chars = value;
        }
        if let Some(value) = patch.max_output_tokens {
            if !(128..=16000).contains(&value) {
                bail!("输出 token 上限应为 128–16000");
            }
            options.max_output_tokens = value;
        }
        if let Some(value) = patch.timeout_ms {
            if !(1000..=300000).contains(&value) {
                bail!("超时应为 1–300 秒");
            }
            options.timeout_ms = value;
        }
        if let Some(value) = patch.direction_source {
            options.direction_source = value;
        }
        if let Some(value) = patch.direction_library {
            options.direction_library = value;
        }
        if let Some(value) = patch.selected_directions {
            options.selected_directions = value;
        }
        if let Some(value) = patch.jev {
            options.jev = value;
        }
        if let Some(value) = patch.jev_consent {
            options.jev.consent = value;
        }
        crate::directions::validate(&mut options.direction_library, &options.selected_directions)?;
        options.jev.validate()?;
        let old_jev_key = self.paths.load_named_key("jevApiKey")?;
        let jev_key = if patch.clear_jev_api_key {
            None
        } else {
            patch
                .jev_api_key
                .filter(|key| !key.trim().is_empty())
                .or(old_jev_key.clone())
        };
        if jev_key
            .as_ref()
            .is_some_and(|key| key.len() > 8192 || key.contains(['\r', '\n']))
        {
            bail!("Jev 密钥格式无效");
        }
        let old_key = self.paths.load_key()?;
        let key = if patch.clear_api_key {
            None
        } else {
            patch
                .api_key
                .filter(|key| !key.trim().is_empty())
                .or(old_key.clone())
        };
        if key
            .as_ref()
            .is_some_and(|key| key.len() > 8192 || key.contains(['\r', '\n']))
        {
            bail!("API 密钥格式无效");
        }
        self.paths.save_keys(key.as_deref(), jev_key.as_deref())?;
        if let Err(error) = self.paths.save(&next) {
            self.paths
                .save_keys(old_key.as_deref(), old_jev_key.as_deref())?;
            return Err(error);
        }
        let model = Model::load(&next).with_key(key).with_jev_key(jev_key);
        {
            let mut current = self.model.write().await;
            if !current.same_generation_config(&model) {
                self.generation_revision
                    .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            }
            *current = model.clone();
        }
        *config = next;
        self.settings_revision
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        self.views.send_modify(|view| {
            view.model = model.info();
            view.configuration_revision = self
                .settings_revision
                .load(std::sync::atomic::Ordering::SeqCst);
        });
        drop(config);
        let settings = self.settings().await;
        self.sync_desktop_settings(&settings).await;
        Ok(settings)
    }

    pub async fn test_settings(&self) -> Result<Value> {
        let guard = self.model.read().await;
        let revision = self
            .generation_revision
            .load(std::sync::atomic::Ordering::SeqCst);
        let model = guard.clone();
        drop(guard);
        let input = crate::directions::Exchange::new(
            "只讨论可验证的后续提问，不执行或发布",
            "一个本机 Codex 工具将回答大纲和下一步建议显示在桌面浮窗，用户通过浏览器配置模型。首版待办包括桌面显示、模型连接和草稿保护。",
            model.options.max_input_chars,
        );
        let result = self
            .until_shutdown(model.generate_exchange_checked(&input, || async {
                if self
                    .generation_revision
                    .load(std::sync::atomic::Ordering::SeqCst)
                    != revision
                {
                    bail!("配置已变化，连接测试已取消");
                }
                Ok(())
            }))
            .await?;
        Ok(
            json!({"ok":true,"status":"ok","generationAttempted":result.generation_attempted,"items":crate::requests::items(result.suggestions)}),
        )
    }

    pub async fn list_models(&self) -> Result<Value> {
        let model = self.model.read().await.clone();
        Ok(json!({"models":self.until_shutdown(model.list_models()).await?}))
    }
}
