//! Authenticated proxy for the Hermes chat agent.
//!
//! The browser never sees `HERMES_API_KEY`: it posts the current user message
//! to `/api/hermes`, this handler authenticates the dashboard session, attaches
//! the upstream Bearer credential and forwards the opaque
//! `X-Hermes-Session-Id` header unchanged. Conversation memory lives on the
//! Hermes server, so only the current message travels in the body.
//!
//! The route is mounted at the root router (not inside the 15 s `/api`
//! timeout budget) because Hermes answers may legitimately take minutes; the
//! outbound client enforces `HERMES_TIMEOUT` (>= 180 s).

use axum::{
    extract::State,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{config::HermesConfig, state::AppState};

/// Opaque session identifier minted by the UI; forwarded byte-for-byte.
pub const SESSION_HEADER: &str = "x-hermes-session-id";

/// The UI sends exactly one user turn; history is Hermes' server-side memory.
const MAX_MESSAGES: usize = 1;
const MAX_CONTENT_BYTES: usize = 32_000;

#[derive(Debug, Deserialize)]
pub struct ChatRequest {
    pub messages: Vec<ChatMessage>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

fn error_response(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        Json(json!({"error": {"code": code, "message": message}})),
    )
        .into_response()
}

fn validate(body: &ChatRequest) -> Result<(), String> {
    if body.messages.is_empty() {
        return Err("messages must contain the current user message".to_string());
    }
    if body.messages.len() > MAX_MESSAGES {
        return Err("only the current user message is accepted; history lives on the server".to_string());
    }
    let msg = &body.messages[0];
    if msg.role != "user" {
        return Err("the message role must be user".to_string());
    }
    if msg.content.trim().is_empty() {
        return Err("the message content must not be empty".to_string());
    }
    if msg.content.len() > MAX_CONTENT_BYTES {
        return Err(format!("the message content must be at most {MAX_CONTENT_BYTES} bytes"));
    }
    Ok(())
}

/// Forward one user turn to Hermes. Split from the handler so tests can point
/// it at a local fake upstream without a database.
async fn send_to_hermes(
    cfg: &HermesConfig,
    session: Option<&HeaderValue>,
    messages: &[ChatMessage],
) -> Result<Response, Response> {
    let payload = json!({ "messages": messages });
    let mut request = cfg
        .http
        .post(&cfg.api_url)
        .bearer_auth(&cfg.api_key)
        .json(&payload);
    if let Some(value) = session {
        // HeaderValue is already validated by the HTTP layer: copy it as-is
        // instead of re-parsing and risking a normalized/mangled identifier.
        request = request.header(
            header::HeaderName::from_static(SESSION_HEADER),
            value.clone(),
        );
    }

    let upstream = match request.send().await {
        Ok(resp) => resp,
        Err(err) if err.is_timeout() => {
            tracing::warn!("hermes upstream timed out");
            return Err(error_response(
                StatusCode::GATEWAY_TIMEOUT,
                "HERMES_TIMEOUT",
                "Hermes did not answer in time",
            ));
        }
        Err(_) => {
            tracing::warn!("hermes upstream is unreachable");
            return Err(error_response(
                StatusCode::BAD_GATEWAY,
                "HERMES_UNAVAILABLE",
                "Hermes is unreachable",
            ));
        }
    };

    let status = upstream.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        tracing::warn!("hermes rejected the configured credentials");
        return Err(error_response(
            StatusCode::UNAUTHORIZED,
            "HERMES_UNAUTHORIZED",
            "Hermes rejected the configured credentials",
        ));
    }
    if !status.is_success() {
        tracing::warn!(status = status.as_u16(), "hermes returned an error");
        return Err(error_response(
            StatusCode::BAD_GATEWAY,
            "HERMES_UPSTREAM_ERROR",
            "Hermes returned an error",
        ));
    }

    match upstream.bytes().await {
        Ok(body) => Ok((
            StatusCode::OK,
            [(header::CONTENT_TYPE, HeaderValue::from_static("application/json"))],
            body,
        )
            .into_response()),
        // The client timeout also covers the body: an upstream that sends 200
        // headers and then stalls must answer 504, not a generic 502.
        Err(err) if err.is_timeout() => {
            tracing::warn!("hermes upstream timed out while reading the body");
            Err(error_response(
                StatusCode::GATEWAY_TIMEOUT,
                "HERMES_TIMEOUT",
                "Hermes did not answer in time",
            ))
        }
        Err(_) => Err(error_response(
            StatusCode::BAD_GATEWAY,
            "HERMES_UPSTREAM_ERROR",
            "Hermes returned an unreadable response",
        )),
    }
}

/// `POST /api/hermes` — authenticated chat turn.
pub async fn hermes_chat_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ChatRequest>,
) -> Response {
    if let Err(err) = crate::auth::helper::require_user_id(&headers, &state.pool).await {
        return err.into_response();
    }
    let Some(cfg) = state.hermes.as_ref() else {
        return error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "HERMES_NOT_CONFIGURED",
            "Hermes is not configured",
        );
    };
    if let Err(message) = validate(&body) {
        return error_response(StatusCode::UNPROCESSABLE_ENTITY, "VALIDATION_ERROR", &message);
    }
    let session = headers.get(SESSION_HEADER);
    match send_to_hermes(cfg, session, &body.messages).await {
        Ok(response) => response,
        Err(response) => response,
    }
}

#[cfg(test)]
mod tests {
    use std::{
        net::{Ipv4Addr, SocketAddr},
        sync::{Arc, Mutex},
    };

    use std::time::Duration;

    use axum::{extract::State, routing::post, Router};
    use serde_json::Value;

    use super::*;

    fn message(content: &str) -> ChatMessage {
        ChatMessage {
            role: "user".into(),
            content: content.into(),
        }
    }

    fn cfg(api_url: String, timeout_ms: u64) -> HermesConfig {
        HermesConfig {
            api_url,
            api_key: "upstream-secret".into(),
            http: reqwest::Client::builder()
                .timeout(Duration::from_millis(timeout_ms))
                .build()
                .expect("test client"),
        }
    }

    async fn spawn(app: Router) -> String {
        let listener = tokio::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
            .await
            .expect("bind fake upstream");
        let addr = listener.local_addr().expect("fake upstream addr");
        tokio::spawn(async move {
            axum::serve(listener, app).await.expect("serve fake upstream");
        });
        format!("http://{addr}/v1/chat/completions")
    }

    #[derive(Clone, Default)]
    struct Seen(Arc<Mutex<Option<SeenRequest>>>);

    struct SeenRequest {
        authorization: Option<String>,
        session: Option<String>,
        body: Value,
    }

    async fn capture(
        State(seen): State<Seen>,
        headers: HeaderMap,
        Json(body): Json<Value>,
    ) -> Json<Value> {
        *seen.0.lock().expect("seen lock") = Some(SeenRequest {
            authorization: headers
                .get(header::AUTHORIZATION)
                .and_then(|v| v.to_str().ok())
                .map(str::to_string),
            session: headers
                .get(SESSION_HEADER)
                .and_then(|v| v.to_str().ok())
                .map(str::to_string),
            body,
        });
        Json(json!({"choices": [{"message": {"content": "hola"}}]}))
    }

    #[tokio::test]
    async fn forwards_bearer_session_and_only_the_current_message() {
        let seen = Seen::default();
        let app = Router::new()
            .route("/v1/chat/completions", post(capture))
            .with_state(seen.clone());
        let url = spawn(app).await;

        let session = HeaderValue::from_static("sess-abc-123");
        let response = send_to_hermes(&cfg(url, 2_000), Some(&session), &[message("¿qué tal?")])
            .await
            .expect("upstream success");
        assert_eq!(response.status(), StatusCode::OK);

        let seen = seen.0.lock().expect("seen lock").take().expect("upstream called");
        assert_eq!(seen.authorization.as_deref(), Some("Bearer upstream-secret"));
        assert_eq!(seen.session.as_deref(), Some("sess-abc-123"));
        assert_eq!(
            seen.body,
            json!({"messages": [{"role": "user", "content": "¿qué tal?"}]}),
            "the proxy must forward exactly the current user message"
        );
    }

    #[tokio::test]
    async fn maps_upstream_unauthorized_to_401_without_leaking_the_key() {
        let app = Router::new().route(
            "/v1/chat/completions",
            post(|| async { StatusCode::UNAUTHORIZED }),
        );
        let url = spawn(app).await;
        let response = send_to_hermes(&cfg(url, 2_000), None, &[message("hola")])
            .await
            .expect_err("401 maps to an error response");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        let body = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .expect("error body");
        let text = String::from_utf8(body.to_vec()).expect("utf8");
        assert!(text.contains("HERMES_UNAUTHORIZED"));
        assert!(!text.contains("upstream-secret"));
    }

    #[tokio::test]
    async fn maps_upstream_error_to_502() {
        let app = Router::new().route(
            "/v1/chat/completions",
            post(|| async { StatusCode::INTERNAL_SERVER_ERROR }),
        );
        let url = spawn(app).await;
        let response = send_to_hermes(&cfg(url, 2_000), None, &[message("hola")])
            .await
            .expect_err("5xx maps to an error response");
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    }

    #[tokio::test]
    async fn maps_the_outbound_timeout_to_504() {
        let app = Router::new().route(
            "/v1/chat/completions",
            post(|| async {
                tokio::time::sleep(Duration::from_millis(400)).await;
                Json(json!({"choices": []}))
            }),
        );
        let url = spawn(app).await;
        let response = send_to_hermes(&cfg(url, 80), None, &[message("hola")])
            .await
            .expect_err("timeout maps to an error response");
        assert_eq!(response.status(), StatusCode::GATEWAY_TIMEOUT);
        let body = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .expect("error body");
        assert!(String::from_utf8_lossy(&body).contains("HERMES_TIMEOUT"));
    }

    #[tokio::test]
    async fn a_stalled_body_after_headers_maps_to_504() {
        use tokio::io::AsyncWriteExt;

        // Raw socket: send a complete header block, then stall, so the error
        // happens inside `upstream.bytes()` rather than in `send()`.
        let listener = tokio::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
            .await
            .expect("bind stalling upstream");
        let addr = listener.local_addr().expect("addr");
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.expect("accept");
            socket
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 64\r\n\r\n{",
                )
                .await
                .expect("write headers");
            tokio::time::sleep(Duration::from_millis(500)).await;
        });

        let response = send_to_hermes(
            &cfg(format!("http://{addr}/v1/chat/completions"), 100),
            None,
            &[message("hola")],
        )
        .await
        .expect_err("body timeout maps to an error response");
        assert_eq!(response.status(), StatusCode::GATEWAY_TIMEOUT);
    }

    #[tokio::test]
    async fn unreachable_upstream_maps_to_502() {
        let response = send_to_hermes(
            &cfg("http://127.0.0.1:1/v1/chat/completions".into(), 300),
            None,
            &[message("hola")],
        )
        .await
        .expect_err("connection failure maps to an error response");
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    }

    #[test]
    fn validation_accepts_one_user_turn_and_rejects_history_or_empty_text() {
        assert!(validate(&ChatRequest {
            messages: vec![message("hola")]
        })
        .is_ok());
        assert!(validate(&ChatRequest { messages: vec![] }).is_err());
        assert!(validate(&ChatRequest {
            messages: vec![message("uno"), message("dos")]
        })
        .is_err());
        assert!(validate(&ChatRequest {
            messages: vec![ChatMessage {
                role: "assistant".into(),
                content: "eco".into()
            }]
        })
        .is_err());
        assert!(validate(&ChatRequest {
            messages: vec![message("   ")]
        })
        .is_err());
    }

    fn lazy_state() -> AppState {
        AppState {
            pool: sqlx::PgPool::connect_lazy("postgres://localhost:1/unused")
                .expect("lazy pool"),
            session_ttl_hours: 24,
            rate_limiter: Arc::new(crate::auth::rate_limit::LoginRateLimiter::new()),
            hermes: None,
        }
    }

    #[tokio::test]
    async fn requires_an_authenticated_dashboard_session() {
        let response = hermes_chat_handler(
            State(lazy_state()),
            HeaderMap::new(),
            Json(ChatRequest {
                messages: vec![message("hola")],
            }),
        )
        .await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

}
