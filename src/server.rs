// [INPUT]: App、Runtime、本机认证令牌、target/web 与 ui/panel/popout 资源。
// [OUTPUT]: serve、HTTP/SSE API、设置页和弹出页资源；含原生呈现确认的窗口协议及受鉴权的无正文开发状态与仅开发模式开放的工作台唤起接口。
// [POS]: 仅监听 loopback 的服务入口，公开状态剔除聊天正文；独立模型控制 API、页面与窗口租约共用鉴权。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。

use crate::{
    config::{Paths, VERSION, write_private},
    lifecycle::Runtime,
    state::App,
};
use anyhow::{Context, Result};
use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Path, Query, Request, State},
    http::{HeaderMap, StatusCode, header},
    middleware::{self, Next},
    response::{
        IntoResponse, Response, Sse,
        sse::{Event, KeepAlive},
    },
    routing::{get, post},
};
use fs2::FileExt;
use futures_util::StreamExt;
use rust_embed::RustEmbed;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{convert::Infallible, sync::Arc, time::Duration};
use tokio_stream::wrappers::WatchStream;

#[derive(RustEmbed)]
#[folder = "target/web/"]
struct Assets;

#[derive(Clone)]
struct Service {
    app: Arc<App>,
    token: String,
    port: u16,
}

struct ApiError(String);
impl From<anyhow::Error> for ApiError {
    fn from(value: anyhow::Error) -> Self {
        Self(value.to_string())
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"ok":false,"code":"request_failed","message":self.0})),
        )
            .into_response()
    }
}

pub async fn serve(
    paths: Paths,
    port: u16,
    endpoint: Option<String>,
    allow_fixture: bool,
) -> Result<()> {
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(paths.root.join("service.lock"))?;
    lock.try_lock_exclusive()
        .context("CodexBuddy 已在运行，请使用 start 打开已有面板")?;
    let config = paths.load()?;
    paths.load_key()?;
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .context("面板端口被占用，可以使用 --port 0 自动分配")?;
    let port = listener.local_addr()?.port();
    let runtime = Runtime {
        pid: std::process::id(),
        port,
        token: uuid::Uuid::new_v4().simple().to_string(),
        version: VERSION.into(),
        executable: std::env::current_exe()?,
    };
    write_private(&paths.runtime(), &serde_json::to_vec_pretty(&runtime)?)?;
    let app = App::new(paths.clone(), config, endpoint, allow_fixture);
    let state = Service {
        app: app.clone(),
        token: runtime.token.clone(),
        port,
    };
    let router = router(state);
    let watcher = app.clone().supervise();
    tracing::info!(port, "CodexBuddy 本地服务启动");
    let shutdown_app = app.clone();
    let result = axum::serve(listener, router)
        .with_graceful_shutdown(async move {
            tokio::select! { _ = shutdown_app.shutdown.notified() => {}, _ = termination() => {} }
            shutdown_app.closing.send_replace(true);
        })
        .await;
    watcher.abort();
    app.disconnect().await;
    if let Ok(current) = Runtime::read(&paths)
        && current.token == runtime.token
    {
        let _ = std::fs::remove_file(paths.runtime());
    }
    result.context("CodexBuddy 服务异常退出")
}

async fn termination() {
    let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .expect("signal handler");
    tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = sigterm.recv() => {} }
}

fn router(service: Service) -> Router {
    let api = Router::new()
        .route("/state", get(state))
        .route(
            "/development",
            get(development_status).post(development_report),
        )
        .route("/events", get(events))
        .route("/development/reveal", post(development_reveal))
        .route("/connect", post(connect))
        .route("/disconnect", post(disconnect))
        .route("/settings", get(settings).post(save_settings))
        .route("/settings/test", post(test_settings))
        .route("/settings/models", get(list_models))
        .route("/panel/state", post(panel_state))
        .route("/panel/open", post(panel_open))
        .route("/panel/close", post(close_panel))
        .route("/appearance", get(appearance).post(save_appearance))
        .route("/panel/ready", post(panel_ready))
        .route("/panel/anchor", post(panel_anchor))
        .route("/panel/presented", post(panel_presented))
        .route("/panel/dock", post(panel_dock))
        .route("/panel/preferences", post(panel_preferences))
        .route("/panel/command", post(panel_command))
        .route("/panel/request", post(panel_request))
        .route("/model-control/state", get(model_control_state))
        .route("/model-control/refresh", post(model_control_refresh))
        .route("/model-control/apply", post(model_control_apply))
        .route(
            "/model-control/preferences",
            post(model_control_preferences),
        )
        .route("/model-control/open", post(model_control_open))
        .route("/model-control/close", post(model_control_close))
        .route("/model-control/window", get(model_control_window))
        .route("/model-control/displays", get(model_control_displays))
        .route("/shutdown", post(shutdown))
        .route_layer(middleware::from_fn_with_state(service.clone(), authorize));
    Router::new()
        .nest("/api", api)
        .route("/", get(index))
        .route("/{*path}", get(asset))
        .layer(DefaultBodyLimit::max(64 * 1024))
        .layer(middleware::from_fn_with_state(
            service.clone(),
            validate_host,
        ))
        .with_state(service)
}

fn same_origin(headers: &HeaderMap, port: u16) -> bool {
    let Some(origin) = headers.get(header::ORIGIN) else {
        return true;
    };
    origin.to_str().is_ok_and(|origin| {
        [
            format!("http://127.0.0.1:{port}"),
            format!("http://localhost:{port}"),
        ]
        .contains(&origin.to_owned())
    })
}

async fn validate_host(State(service): State<Service>, request: Request, next: Next) -> Response {
    let allowed = [
        format!("127.0.0.1:{}", service.port),
        format!("localhost:{}", service.port),
    ];
    if !request
        .headers()
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .is_some_and(|host| allowed.iter().any(|v| v == host))
    {
        return (StatusCode::FORBIDDEN, "Invalid host").into_response();
    }
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    headers.insert("x-content-type-options", "nosniff".parse().unwrap());
    headers.insert("referrer-policy", "no-referrer".parse().unwrap());
    headers.insert("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'".parse().unwrap());
    response
}

async fn authorize(State(service): State<Service>, request: Request, next: Next) -> Response {
    let auth = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    if !same_origin(request.headers(), service.port) {
        return (StatusCode::FORBIDDEN, Json(json!({"ok":false,"code":"foreign_origin","message":"请求来源不受信任，请从 CodexBuddy 的本机页面操作。"}))).into_response();
    }
    if auth != Some(format!("Bearer {}", service.token).as_str()) {
        return (StatusCode::UNAUTHORIZED, Json(json!({"ok":false,"code":"unauthorized","message":"连接凭据已过期，请运行 codex-buddy start 重新打开面板。"}))).into_response();
    }
    next.run(request).await
}

async fn state(State(service): State<Service>) -> impl IntoResponse {
    Json(public_view(service.app.view()))
}

fn public_view(view: crate::state::View) -> Value {
    json!({"version":view.version,"connection":view.connection,"model":view.model,"updatedAt":view.updated_at,
        "desktop":view.desktop,"configurationRevision":view.configuration_revision,
        "panelPreferences":view.panel_preferences,"panelTheme":view.panel_theme,"panelFontBase":view.panel_font_base})
}

async fn settings(State(service): State<Service>) -> Json<Value> {
    Json(service.app.settings().await)
}
async fn save_settings(
    State(service): State<Service>,
    Json(patch): Json<crate::settings::Update>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(service.app.save_settings(patch).await?))
}
async fn test_settings(State(service): State<Service>) -> Result<Json<Value>, ApiError> {
    Ok(Json(service.app.test_settings().await?))
}
async fn list_models(State(service): State<Service>) -> Result<Json<Value>, ApiError> {
    Ok(Json(service.app.list_models().await?))
}

async fn events(State(service): State<Service>) -> impl IntoResponse {
    let mut closing = service.app.closing.subscribe();
    let stream = WatchStream::new(service.app.views.subscribe())
        .map(|view| {
            Ok::<_, Infallible>(
                Event::default()
                    .event("state")
                    .json_data(public_view(view))
                    .expect("serializable view"),
            )
        })
        .take_until(async move {
            let already_closed = *closing.borrow();
            if !already_closed {
                let _ = closing.changed().await;
            }
        });
    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(10))
            .text("ping"),
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Connect {
    endpoint: Option<String>,
    target_id: Option<String>,
}
async fn connect(
    State(service): State<Service>,
    Json(request): Json<Connect>,
) -> Result<Json<Value>, ApiError> {
    service
        .app
        .connect(request.endpoint, request.target_id)
        .await?;
    Ok(Json(json!({"ok":true})))
}
async fn disconnect(State(service): State<Service>) -> Json<Value> {
    service.app.disconnect().await;
    Json(json!({"ok":true}))
}

async fn shutdown(State(service): State<Service>) -> Json<Value> {
    service.app.shutdown.notify_one();
    Json(json!({"ok":true}))
}

async fn panel_state(
    State(service): State<Service>,
    Json(input): Json<crate::panel::Input>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(service.app.panel_snapshot(&input).await?))
}
async fn panel_open(State(service): State<Service>) -> Result<Json<Value>, ApiError> {
    Ok(Json(service.app.open_panel().await?))
}
async fn panel_ready(
    State(service): State<Service>,
    Json(input): Json<crate::panel::Input>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(service.app.ready_panel(&input).await?))
}
async fn panel_anchor(
    State(service): State<Service>,
    Json(input): Json<crate::panel::Input>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(service.app.panel_anchor(&input).await?))
}
async fn panel_presented(
    State(service): State<Service>,
    Json(input): Json<crate::panel::Input>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(service.app.presented_panel(&input).await?))
}
async fn panel_dock(
    State(service): State<Service>,
    Json(input): Json<crate::panel::Input>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(service.app.dock_panel(&input).await?))
}
async fn panel_preferences(
    State(service): State<Service>,
    Json(input): Json<crate::panel::Input>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(service.app.save_panel_preferences(&input).await?))
}
async fn panel_command(
    State(service): State<Service>,
    Json(input): Json<crate::panel::Input>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(service.app.panel_command(&input).await?))
}
async fn panel_request(
    State(service): State<Service>,
    Json(input): Json<crate::panel::Input>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(service.app.panel_request(&input).await?))
}

// Only debug builds with an explicit resource snapshot expose development telemetry.
async fn development_report(State(service): State<Service>, Json(value): Json<Value>) -> Response {
    if crate::assets::development().is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }
    let report = json!({
        "revision": value["revision"].as_str().unwrap_or("").chars().take(64).collect::<String>(),
        "instance": value["instance"].as_str().unwrap_or("").chars().take(128).collect::<String>(),
        "roots": value["roots"].as_u64(), "styles": value["styles"].as_u64(),
        "styleBytes": value["styleBytes"].as_u64(), "native": value["native"].as_bool(),
        "nativeGlass": value["nativeGlass"].as_bool(),
        "material": value["material"].as_str().filter(|s| matches!(*s,"matte"|"frosted"|"native-glass"|"native-frosted")),
        "layout": value["layout"].as_array().map(|rows| rows.iter().take(7).map(|row| row.as_array().map(|values| values.iter().take(6).map(|v| v.as_f64()).collect::<Vec<_>>())).collect::<Vec<_>>()),
    });
    match write_private(
        &service.app.paths.root.join("development.json"),
        &serde_json::to_vec(&report).unwrap(),
    ) {
        Ok(()) => Json(json!({"ok":true})).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}
async fn development_status(State(service): State<Service>) -> Response {
    let Some(dev) = crate::assets::development() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !service.app.appearance().await.detached {
        let report = if let Some(client) = service.app.desktop_client().await {
            client.evaluate(dev.probe).await.unwrap_or(Value::Null)
        } else {
            Value::Null
        };
        return Json(report).into_response();
    }
    let report = std::fs::read(service.app.paths.root.join("development.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .unwrap_or(Value::Null);
    Json(report).into_response()
}

async fn development_reveal(State(service): State<Service>) -> Result<Response, ApiError> {
    if crate::assets::development().is_none() {
        return Ok(StatusCode::NOT_FOUND.into_response());
    }
    let pid = service.app.reveal_panel().await?;
    Ok(Json(json!({"ok":true,"pid":pid})).into_response())
}

async fn model_control_state(State(service): State<Service>) -> Result<Json<Value>, ApiError> {
    Ok(Json(service.app.model_control_state(false).await?))
}
async fn model_control_refresh(State(service): State<Service>) -> Result<Json<Value>, ApiError> {
    Ok(Json(service.app.model_control_state(true).await?))
}
async fn model_control_apply(
    State(service): State<Service>,
    Json(command): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(service.app.model_control_apply(command).await?))
}
async fn model_control_preferences(
    State(service): State<Service>,
    Json(patch): Json<Value>,
) -> Response {
    match service.app.model_control_preferences(patch).await {
        Ok(value) => Json(value).into_response(),
        Err(error) if error.to_string() == "model_control_conflict" => (
            StatusCode::CONFLICT,
            Json(json!({"ok":false,"message":"模型控制设置已更新，请刷新后重试"})),
        )
            .into_response(),
        Err(error) => ApiError::from(error).into_response(),
    }
}
async fn model_control_open(State(service): State<Service>) -> Result<Json<Value>, ApiError> {
    Ok(Json(service.app.open_model_control().await?))
}
async fn model_control_close(State(service): State<Service>) -> Result<Json<Value>, ApiError> {
    Ok(Json(service.app.close_model_control().await?))
}
async fn model_control_displays() -> Result<Json<Value>, ApiError> {
    Ok(Json(crate::model_control_window::display_options()?))
}
async fn model_control_window(
    State(service): State<Service>,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> Json<Value> {
    Json(
        service
            .app
            .model_control_window(query.get("lease").map(String::as_str).unwrap_or(""))
            .await,
    )
}
async fn index() -> Response {
    static_asset("index.html")
}
async fn asset(Path(path): Path<String>) -> Response {
    if let Some(dev) = crate::assets::development() {
        let resource = match path.as_str() {
            "panel" => Some(("text/html; charset=utf-8", dev.html)),
            "panel.js" => Some(("text/javascript; charset=utf-8", dev.script)),
            "panel-boot.js" => Some(("text/javascript; charset=utf-8", dev.boot)),
            "dev-client.js" => Some(("text/javascript; charset=utf-8", dev.client)),
            "dev-state.json" => Some((
                "application/json",
                json!({"revision":dev.revision,"page":dev.page}).to_string(),
            )),
            _ => None,
        };
        if let Some((kind, body)) = resource {
            return ([(header::CONTENT_TYPE, kind)], body).into_response();
        }
    }
    match path.as_str() {
        "model-control" => {
            return panel_asset(
                "text/html; charset=utf-8",
                include_str!("../ui/model-control/index.html"),
            );
        }
        "model-control/app.js" => {
            return panel_asset(
                "text/javascript; charset=utf-8",
                include_str!("../ui/model-control/app.js"),
            );
        }
        "model-control/icons.js" => {
            return panel_asset(
                "text/javascript; charset=utf-8",
                include_str!("../ui/panel/icons/index.js"),
            );
        }
        "model-control/tokens.css" => {
            return panel_asset("text/css; charset=utf-8", include_str!("../ui/tokens.css"));
        }
        "model-control/view.js" => {
            return panel_asset(
                "text/javascript; charset=utf-8",
                include_str!("../ui/model-control/view.js"),
            );
        }
        "model-control/styles.css" => {
            return panel_asset(
                "text/css; charset=utf-8",
                include_str!("../ui/model-control/styles.css"),
            );
        }
        _ => {}
    }
    if path == "panel" {
        return panel_asset(
            "text/html; charset=utf-8",
            include_str!("../ui/panel/popout/index.html"),
        );
    }
    if path == "panel.js" {
        return panel_asset("text/javascript; charset=utf-8", crate::cdp::PANEL_SCRIPT);
    }
    if path == "panel-boot.js" {
        return panel_asset(
            "text/javascript; charset=utf-8",
            include_str!("../ui/panel/popout/boot.js"),
        );
    }
    static_asset(&path)
}
fn panel_asset(content_type: &str, content: &'static str) -> Response {
    ([(header::CONTENT_TYPE, content_type)], content).into_response()
}
fn static_asset(path: &str) -> Response {
    let Some(file) = Assets::get(path) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let content_type = if path.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if path.ends_with(".js") {
        "text/javascript; charset=utf-8"
    } else if path.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else {
        "application/octet-stream"
    };
    (
        [(header::CONTENT_TYPE, content_type)],
        Body::from(file.data.into_owned()),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tower::ServiceExt;
    #[tokio::test]
    async fn reveal_requires_authentication_and_development_assets() {
        let temp = tempfile::tempdir().unwrap();
        let app = App::new(
            Paths::new(Some(temp.path().into())).unwrap(),
            Default::default(),
            None,
            false,
        );
        let router = router(Service {
            app,
            token: "test-token".into(),
            port: 47831,
        });
        for (token, expected) in [
            ("wrong-token", StatusCode::UNAUTHORIZED),
            ("test-token", StatusCode::NOT_FOUND),
        ] {
            let response = router
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/api/development/reveal")
                        .header("host", "127.0.0.1:47831")
                        .header("authorization", format!("Bearer {token}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), expected);
        }
    }
    #[tokio::test]
    async fn model_control_routes_enforce_auth_and_preference_revision() {
        let temp = tempfile::tempdir().unwrap();
        let app = App::new(
            Paths::new(Some(temp.path().into())).unwrap(),
            Default::default(),
            None,
            false,
        );
        let router = router(Service {
            app,
            token: "test-token".into(),
            port: 47831,
        });
        for route in [
            "state",
            "refresh",
            "apply",
            "preferences",
            "open",
            "close",
            "window",
        ] {
            let response = router
                .clone()
                .oneshot(
                    Request::builder()
                        .method(if ["state", "window"].contains(&route) {
                            "GET"
                        } else {
                            "POST"
                        })
                        .uri(format!("/api/model-control/{route}"))
                        .header("host", "127.0.0.1:47831")
                        .header("content-type", "application/json")
                        .body(Body::from("{}"))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{route}");
        }
        for expected in [StatusCode::OK, StatusCode::CONFLICT] {
            let response = router
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/api/model-control/preferences")
                        .header("host", "127.0.0.1:47831")
                        .header("authorization", "Bearer test-token")
                        .header("content-type", "application/json")
                        .body(Body::from(r#"{"revision":1,"patch":{"edge":"left"}}"#))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), expected);
        }
    }
    #[tokio::test]
    async fn removed_operations_are_not_executable_http_routes() {
        let temp = tempfile::tempdir().unwrap();
        let app = App::new(
            Paths::new(Some(temp.path().into())).unwrap(),
            Default::default(),
            None,
            false,
        );
        let router = router(Service {
            app,
            token: "test-token".into(),
            port: 47831,
        });
        for path in [
            "select-message",
            "navigate",
            "stepwise",
            "cancel",
            "fill",
            "appearance/theme",
        ] {
            let response = router
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(format!("/api/{path}"))
                        .header("host", "127.0.0.1:47831")
                        .header("authorization", "Bearer test-token")
                        .header("content-type", "application/json")
                        .body(Body::from("{}"))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED, "{path}");
        }
    }

    #[tokio::test]
    async fn protects_local_api_against_missing_tokens_foreign_origins_and_hosts() {
        let temp = tempfile::tempdir().unwrap();
        let app = App::new(
            Paths::new(Some(temp.path().into())).unwrap(),
            Default::default(),
            None,
            false,
        );
        let router = router(Service {
            app,
            token: "test-token".into(),
            port: 47831,
        });
        for (host, origin, token, expected) in [
            ("127.0.0.1:47831", None, None, 401),
            (
                "127.0.0.1:47831",
                Some("https://example.com"),
                Some("test-token"),
                403,
            ),
            ("attacker.example:47831", None, Some("test-token"), 403),
            (
                "127.0.0.1:47831",
                Some("http://127.0.0.1:47831"),
                Some("test-token"),
                200,
            ),
        ] {
            let mut request = Request::builder().uri("/api/state").header("host", host);
            if let Some(origin) = origin {
                request = request.header("origin", origin);
            }
            if let Some(token) = token {
                request = request.header("authorization", format!("Bearer {token}"));
            }
            let response = router
                .clone()
                .oneshot(request.body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status().as_u16(), expected);
        }
    }
}

async fn appearance(State(service): State<Service>) -> Json<crate::panel::Preferences> {
    Json(service.app.appearance().await)
}
async fn save_appearance(
    State(service): State<Service>,
    Json(input): Json<Value>,
) -> Result<Json<crate::panel::Preferences>, ApiError> {
    Ok(Json(service.app.save_appearance(input).await?))
}
async fn close_panel(State(service): State<Service>) -> Result<Json<Value>, ApiError> {
    Ok(Json(service.app.close_panel().await?))
}
