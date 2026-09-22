// [INPUT]: CDP binding 事件、App 设置与模型服务。
// [OUTPUT]: 桌面请求分发、完整最近一问一答或限长输入、建议 items 转换及结果回送；生成请求不套用普通设置的字节上限。
// [POS]: renderer 与独立后台的受限操作边界，生成前后校验上下文。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。

use crate::{cdp::Client, model::Suggestion, settings::Update, state::App};
use anyhow::{Context, Result, bail};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::{Arc, Weak, atomic::Ordering};
use tokio::{
    sync::mpsc,
    task::JoinSet,
    time::{Duration, sleep},
};

#[derive(Deserialize)]
pub(crate) struct Request {
    pub id: String,
    pub path: String,
    #[serde(default)]
    pub payload: Value,
}

pub fn items(suggestions: Vec<Suggestion>) -> Value {
    json!(
        suggestions
            .into_iter()
            .map(|item| json!({"label":item.title,"summary":item.detail,"prompt":item.prompt}))
            .collect::<Vec<_>>()
    )
}

pub fn listen(client: Weak<Client>, app: Weak<App>, mut events: mpsc::Receiver<Value>) {
    tokio::spawn(async move {
        let mut tasks = JoinSet::new();
        loop {
            tokio::select! {
                event = events.recv() => {
                    let Some(event) = event else { break; };
                    let Some(raw) = event["payload"].as_str() else { continue; };
                    let Ok(request) = serde_json::from_str::<Request>(raw) else { continue; };
                    if request.id.len() > 120 { continue; }
                    let Some(client) = client.upgrade() else { break; };
                    let Some(app) = app.upgrade() else { break; };
                    let context_id = event["executionContextId"].clone();
                    if request.path != "/stepwise/generate" && raw.len() > 262144 {
                        let _ = reply(&client, &request.id, context_id, json!({"error":"请求内容过大"})).await;
                        continue;
                    }
                    if tasks.len() >= 8 {
                        let _ = reply(&client, &request.id, context_id, json!({"error":"请求较多，请稍后再试"})).await;
                        continue;
                    }
                    tasks.spawn(async move {
                        let result = dispatch(&app, Some(&client), &request).await;
                        let value = result.unwrap_or_else(|error| json!({"error":error.to_string(),"items":[]}));
                        let _ = reply(&client, &request.id, context_id, value).await;
                    });
                },
                _ = tasks.join_next(), if !tasks.is_empty() => {},
            }
        }
        tasks.abort_all();
    });
}

async fn reply(client: &Client, id: &str, context_id: Value, value: Value) -> Result<()> {
    let expression = format!(
        "window.__companionDesktop?.complete({}, {}); true",
        json!(id),
        value
    );
    client
        .request(
            "Runtime.evaluate",
            json!({"expression":expression,"contextId":context_id,"returnByValue":true}),
        )
        .await?;
    Ok(())
}

pub(crate) async fn dispatch(
    app: &Arc<App>,
    client: Option<&Arc<Client>>,
    request: &Request,
) -> Result<Value> {
    match request.path.as_str() {
        "/stepwise/settings" => Ok(json!({"settings":app.settings().await})),
        "/settings/set" => {
            let value = request.payload["generationMode"]
                .as_str()
                .context("缺少生成模式")?;
            let settings = app
                .save_settings(Update {
                    generation_mode: Some(value.into()),
                    ..Default::default()
                })
                .await?;
            Ok(json!({"status":"ok","settings":settings}))
        }
        "/stepwise/generate" => {
            generate(
                app,
                client.context("只能从关联的 Codex 生成")?,
                &request.payload["request"],
            )
            .await
        }
        "/panel/detach" => {
            let client = client.context("只能从 Codex 弹出胶囊")?;
            let current = app.desktop_client().await.context("Codex 已断开")?;
            if !Arc::ptr_eq(client, &current) {
                bail!("Codex 连接已变化");
            }
            app.detach_panel(Some(serde_json::from_value(request.payload["ui"].clone())?))
                .await?;
            Ok(json!({"ok":true}))
        }
        "/stepwise/test" => app.test_settings().await,
        "/settings/open" => {
            let runtime = crate::lifecycle::Runtime::read(&app.paths)?;
            webbrowser::open(&runtime.url()).context("无法打开浏览器，请运行 codex-buddy start")?;
            Ok(json!({"status":"ok"}))
        }
        _ => bail!("不支持的桌面请求"),
    }
}

async fn current(client: &Client, request: &Value) -> Result<bool> {
    let expression = format!(
        "(() => {{const panel=window.__companionFloatingPanel; return Boolean(panel && panel.instanceId === {} && panel.verifyRequest({}, {}));}})()",
        request["instanceId"], request["context"], request["answerHash"]
    );
    Ok(client.evaluate(expression).await? == true)
}

// Zero means the complete latest exchange; positive values preserve the legacy budget.
fn generation_input(user: &str, answer: &str, limit: usize) -> String {
    if limit == 0 {
        return format!("紧邻的用户问题：\n{user}\n\n当前回答：\n{answer}");
    }
    let question = user.chars().take(2400.min(limit / 4)).collect::<String>();
    let prefix = format!("紧邻的用户问题：\n{question}\n\n当前回答：\n");
    let remaining = limit.saturating_sub(prefix.chars().count());
    let suffix = answer
        .chars()
        .rev()
        .take(remaining)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>();
    format!("{prefix}{suffix}")
}

async fn generate(app: &Arc<App>, client: &Client, request: &Value) -> Result<Value> {
    let answer = request["lastAssistantMessage"]
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .context("未找到可用于生成的回答")?;
    if !current(client, request).await? {
        bail!("回答或任务已经变化，请重新生成");
    }
    let model_guard = app.model.read().await;
    let revision = app.generation_revision.load(Ordering::SeqCst);
    let model = model_guard.clone();
    drop(model_guard);
    if !model.options.enabled {
        return Ok(json!({"disabled":true,"items":[]}));
    }
    if request["generationRevision"].as_u64() != Some(revision)
        || request["generationMode"] != model.options.generation_mode
        || model.options.generation_mode == "manual" && request["userInitiated"] != true
    {
        bail!("配置已经变化，请等待浮窗同步后重试");
    }
    let user = request["lastUserMessage"].as_str().unwrap_or_default();
    let input = generation_input(user, answer, model.options.max_input_chars);
    let cancelled = async {
        loop {
            sleep(Duration::from_millis(600)).await;
            if app.generation_revision.load(Ordering::SeqCst) != revision
                || !current(client, request).await.unwrap_or(false)
            {
                return;
            }
        }
    };
    let suggestions = tokio::select! {
        result = app.until_shutdown(model.generate(&input)) => result?,
        _ = cancelled => bail!("回答、模式或模型配置已经变化，旧请求已取消"),
    };
    if app.generation_revision.load(Ordering::SeqCst) != revision
        || !current(client, request).await?
    {
        bail!("回答或配置已经变化，请重新生成");
    }
    Ok(json!({"status":"ok","items":items(suggestions)}))
}

#[cfg(test)]
mod tests {
    use super::generation_input;

    #[test]
    fn complete_exchange_preserves_long_question_and_answer() {
        let question = format!("问题开头{}问题结尾", "问🦀".repeat(40000));
        let answer = format!("先做1，再做2，最后做3。{}回答结尾", "答🦀".repeat(50000));
        assert_eq!(
            generation_input(&question, &answer, 0),
            format!("紧邻的用户问题：\n{question}\n\n当前回答：\n{answer}")
        );
        let limited = generation_input(&question, &answer, 12000);
        assert_eq!(limited.chars().count(), 12000);
        assert!(limited.starts_with("紧邻的用户问题：\n问题开头"));
        assert!(limited.ends_with("回答结尾"));
        assert!(!limited.contains("问题结尾"));
    }
}
