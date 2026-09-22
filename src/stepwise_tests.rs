// [INPUT]: 三种方向模式、合成 TypeSafe/生成 HTTP 服务和临时配置目录。
// [OUTPUT]: 请求次数、上下文一致、方向约束、取消、失败和迁移隔离的行为证据。
// [POS]: Stepwise 流水线集成测试，不调用真实模型或读取聊天。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。

use crate::{
    config::{Config, Paths},
    directions::{DirectionSource, Exchange},
    model::Model,
    state::App,
};
use axum::{Json, Router, extract::State, http::StatusCode, routing::post};
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Default)]
struct Fixture {
    calls: Vec<Value>,
    mode: &'static str,
}
type Shared = Arc<Mutex<Fixture>>;
async fn judge(State(state): State<Shared>, Json(body): Json<Value>) -> (StatusCode, Json<Value>) {
    let mut state = state.lock().await;
    state.calls.push(json!({"stage":"judge","body":body}));
    if state.mode == "failure" {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({"error":"secret payload must not leak"})),
        );
    }
    let mode = state.mode;
    drop(state);
    if mode == "slow" {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
    let answers: serde_json::Map<String, Value> = body["questions"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(id, _)| {
            (
                id.clone(),
                json!({"type":"noul","noul":if mode == "empty" {0.1} else {0.9}}),
            )
        })
        .collect();
    (StatusCode::OK, Json(json!({"answers":answers})))
}
async fn generate(State(state): State<Shared>, Json(body): Json<Value>) -> Json<Value> {
    let mut state = state.lock().await;
    state.calls.push(json!({"stage":"generate","body":body}));
    let input: Value = serde_json::from_str(body["input"].as_str().unwrap()).unwrap();
    let directions = input["suppliedDirections"].as_array().unwrap();
    let suggestions = if directions.is_empty() {
        vec![
            json!({"title":"整体推进","detail":"保留完整目标","prompt":"按已确认范围推进共同待办。"}),
        ]
    } else {
        let mut values = directions.iter().take(2).enumerate().map(|(i, d)| json!({"title":d["name"],"detail":"具体价值","prompt":format!("基于原始上下文继续探讨方向 {}", i),"directionId":d["id"]})).collect::<Vec<_>>();
        values.reverse();
        if state.mode == "unknown" {
            values[0]["directionId"] = json!("invented");
        }
        if state.mode == "duplicate" && values.len() > 1 {
            values[0]["directionId"] = values[1]["directionId"].clone();
        }
        values
    };
    Json(
        json!({"output":[{"content":[{"type":"output_text","text":json!({"suggestions":suggestions}).to_string()}]}]}),
    )
}
async fn setup(mode: &'static str) -> (Model, Shared, tokio::task::JoinHandle<()>) {
    let state = Arc::new(Mutex::new(Fixture {
        mode,
        ..Default::default()
    }));
    let router = Router::new()
        .route("/v1/systemone", post(judge))
        .route("/v1/responses", post(generate))
        .with_state(state.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let config = Config {
        provider: Some("api".into()),
        model: Some("fixture".into()),
        base_url: Some(base.clone()),
        ..Default::default()
    };
    let mut model = Model::load(&config)
        .with_key(Some("fixture-key".into()))
        .with_jev_key(Some("judge-key".into()));
    model.options.jev.endpoint = format!("{base}/v1/systemone");
    model.options.jev.consent = true;
    (model, state, task)
}
fn exchange() -> Exchange {
    Exchange::new(
        "先讨论，不执行、不发布",
        "共同计划：实现、验证、文档。请确认。",
        0,
    )
}

#[tokio::test]
async fn auto_and_manual_make_one_call_manual_uses_slots_and_preserves_order() {
    let (mut model, state, task) = setup("").await;
    model.options.jev.consent = false;
    model.generate_exchange(&exchange()).await.unwrap();
    assert_eq!(state.lock().await.calls.len(), 1);
    model.options.direction_source = DirectionSource::Manual;
    model.options.max_items = 1; // Saved automatic count must not truncate manual slots.
    model.options.selected_directions = vec!["gaps".into(), "advance".into()];
    let suggestions = model.generate_exchange(&exchange()).await.unwrap();
    assert_eq!(suggestions.len(), 2);
    assert_eq!(suggestions[0].direction_id.as_deref(), Some("gaps"));
    assert_eq!(state.lock().await.calls.len(), 2);
    assert!(
        state
            .lock()
            .await
            .calls
            .iter()
            .all(|call| call["stage"] == "generate")
    );
    task.abort();
}

#[tokio::test]
async fn smart_shares_snapshot_and_does_not_mechanically_rank_top_n() {
    let (mut model, state, task) = setup("").await;
    model.options.direction_source = DirectionSource::Smart;
    model.options.max_items = 2;
    model.options.direction_library[0].enabled = false;
    model.generate_exchange(&exchange()).await.unwrap();
    let calls = &state.lock().await.calls;
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0]["stage"], "judge");
    assert_eq!(calls[0]["body"]["questions"].as_object().unwrap().len(), 5);
    let input: Value = serde_json::from_str(calls[1]["body"]["input"].as_str().unwrap()).unwrap();
    assert_eq!(input["exchange"], calls[0]["body"]["state"]);
    assert_eq!(input["suppliedDirections"].as_array().unwrap().len(), 5);
    task.abort();
}

#[tokio::test]
async fn smart_failures_and_no_candidates_never_fall_back_or_generate() {
    for mode in ["failure", "empty"] {
        let (mut model, state, task) = setup(mode).await;
        model.options.direction_source = DirectionSource::Smart;
        let result = model.generate_exchange(&exchange()).await;
        if mode == "empty" {
            assert!(result.unwrap().is_empty());
        } else {
            let error = result.unwrap_err().to_string();
            assert!(error.contains("429"));
            assert!(!error.contains("secret"));
        }
        assert_eq!(state.lock().await.calls.len(), 1);
        task.abort();
    }
}

#[tokio::test]
async fn unknown_and_duplicate_direction_ids_are_rejected() {
    for mode in ["unknown", "duplicate"] {
        let (mut model, _, task) = setup(mode).await;
        model.options.direction_source = DirectionSource::Manual;
        model.options.selected_directions = vec!["advance".into(), "gaps".into()];
        assert!(model.generate_exchange(&exchange()).await.is_err());
        task.abort();
    }
}

#[tokio::test]
async fn smart_requires_consent_and_key_and_can_be_cancelled_between_stages() {
    let (mut model, state, task) = setup("slow").await;
    model.options.direction_source = DirectionSource::Smart;
    model.options.jev.consent = false;
    assert!(
        model
            .generate_exchange(&exchange())
            .await
            .unwrap_err()
            .to_string()
            .contains("同意")
    );
    assert!(state.lock().await.calls.is_empty());
    model.options.jev.consent = true;
    let input = exchange();
    let future = model.generate_exchange(&input);
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(80), future)
            .await
            .is_err()
    );
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert_eq!(state.lock().await.calls.len(), 1);
    task.abort();
}

#[tokio::test]
async fn direction_settings_persist_keys_are_private_and_revisions_follow_active_mode() {
    let dir = tempfile::tempdir().unwrap();
    let paths = Paths::new(Some(dir.path().into())).unwrap();
    assert_eq!(paths.load().unwrap().stepwise.max_items, 3);
    std::fs::write(paths.config(), r#"{"stepwise":{"generationMode":"auto"}}"#).unwrap();
    let old = paths.load().unwrap();
    assert_eq!(old.stepwise.max_items, 4);
    assert_eq!(old.stepwise.generation_mode, "auto");
    let app = App::new(paths.clone(), old, None, false);
    let before = app.settings().await;
    let saved = app
        .save_settings(
            serde_json::from_value(
                json!({"selectedDirections":["gaps","advance"],"jevApiKey":"fixture-jev-secret"}),
            )
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(before["generationRevision"], saved["generationRevision"]);
    assert_eq!(saved["storedJevApiKey"], true);
    assert!(!saved.to_string().contains("fixture-jev-secret"));
    let manual = app
        .save_settings(serde_json::from_value(json!({"directionSource":"manual"})).unwrap())
        .await
        .unwrap();
    assert_ne!(saved["generationRevision"], manual["generationRevision"]);
    assert_eq!(
        paths.load().unwrap().stepwise.selected_directions,
        vec!["gaps", "advance"]
    );
    app.save_settings(serde_json::from_value(json!({"apiKey":"fixture-generator"})).unwrap())
        .await
        .unwrap();
    assert_eq!(
        paths.load_named_key("jevApiKey").unwrap().as_deref(),
        Some("fixture-jev-secret")
    );
    app.save_settings(serde_json::from_value(json!({"clearJevApiKey":true})).unwrap())
        .await
        .unwrap();
    assert!(paths.load_named_key("jevApiKey").unwrap().is_none());
    assert_eq!(
        paths.load_key().unwrap().as_deref(),
        Some("fixture-generator")
    );
    assert!(
        app.save_settings(
            serde_json::from_value(json!({"selectedDirections":["unknown"]})).unwrap()
        )
        .await
        .is_err()
    );
}

#[tokio::test]
async fn rechecks_context_after_judgment_before_starting_generation() {
    let (mut model, state, task) = setup("").await;
    model.options.direction_source = DirectionSource::Smart;
    let checks = std::sync::atomic::AtomicUsize::new(0);
    let result = model
        .generate_exchange_checked(&exchange(), || async {
            if checks.fetch_add(1, std::sync::atomic::Ordering::SeqCst) > 0 {
                anyhow::bail!("context changed");
            }
            Ok(())
        })
        .await;
    assert!(result.is_err());
    assert_eq!(state.lock().await.calls.len(), 1);
    assert_eq!(state.lock().await.calls[0]["stage"], "judge");
    task.abort();
}

#[tokio::test]
async fn connection_test_reports_unverified_generation_when_judgment_is_empty() {
    let (model, state, task) = setup("empty").await;
    let dir = tempfile::tempdir().unwrap();
    let paths = Paths::new(Some(dir.path().into())).unwrap();
    paths
        .save_keys(Some("fixture-key"), Some("fixture-judge"))
        .unwrap();
    let mut config = Config {
        provider: Some("api".into()),
        model: Some("fixture".into()),
        base_url: Some("http://127.0.0.1:1".into()),
        ..Default::default()
    };
    config.stepwise.jev = model.options.jev;
    config.stepwise.direction_source = DirectionSource::Smart;
    let app = App::new(paths, config, None, false);
    let result = app.test_settings().await.unwrap();
    assert_eq!(result["generationAttempted"], false);
    assert_eq!(result["items"], json!([]));
    assert_eq!(state.lock().await.calls.len(), 1);
    task.abort();
}

#[tokio::test]
#[ignore = "Uses existing Codex authentication for six synthetic quality examples"]
async fn live_direction_quality_examples() {
    let mut model = Model::load(&Config::default());
    let cases = [
        (
            "development",
            "请完整实现导出、回归验证和说明更新，暂不发布。",
            "方案已确定：实现导出按钮与数据接口、覆盖回归、更新说明。三个部分构成同一项交付。",
            vec![],
        ),
        (
            "learning",
            "我不理解 Rust 的借用，先解释原理。",
            "借用让引用访问值而不取得所有权；共享借用与可变借用有不同限制，生命周期表达引用有效的范围。",
            vec!["understand"],
        ),
        (
            "writing",
            "帮我评估这篇短文的结构，还不要重写。",
            "开头以实例切入，中段解释原因，结尾提出行动建议。中段与结尾存在重复，可以压缩。",
            vec![],
        ),
        (
            "discussion",
            "只讨论两种方案，还没有决定实施哪种。",
            "方案A本地运行，部署简单；方案B云端运行，跨设备方便，但需要服务维护。两者是备选关系。",
            vec!["compare", "gaps"],
        ),
        (
            "missing-history",
            "按前面约定接着讨论。",
            "可以，但当前这条回答没有复述此前的约定。",
            vec![],
        ),
        (
            "inapplicable",
            "谢谢，今天就先聊到这里。",
            "好的，祝你今天愉快。",
            vec!["evidence", "compare"],
        ),
    ];
    let mut results = Vec::new();
    for (name, question, answer, ids) in cases {
        model.options.direction_source = if ids.is_empty() {
            DirectionSource::Auto
        } else {
            DirectionSource::Manual
        };
        model.options.selected_directions = ids.iter().map(|id| (*id).into()).collect();
        let started = std::time::Instant::now();
        let suggestions = model
            .generate_exchange(&Exchange::new(question, answer, 0))
            .await
            .unwrap();
        results.push(json!({"case":name,"directionSource":model.options.direction_source,"latencyMs":started.elapsed().as_millis(),"suggestions":suggestions}));
    }
    let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/reports");
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(
        directory.join("stepwise-quality.json"),
        serde_json::to_vec_pretty(&results).unwrap(),
    )
    .unwrap();
    println!("Six synthetic examples completed; semantic assessment remains a separate review.");
}
