//! Authenticated proxy for the Hermes chat agent.
//!
//! The browser never sees `HERMES_API_KEY`: it posts the current user turn to
//! `/api/hermes` (JSON or `multipart/form-data`), this handler authenticates
//! the dashboard session, attaches the upstream Bearer credential and forwards
//! the opaque `X-Hermes-Session-Id` header unchanged. Conversation memory lives
//! on the Hermes server, so only the current turn travels in the body.
//!
//! Hermes 0.22.5 is OpenAI-compatible but only accepts `text` and `image_url`
//! content parts: it rejects multipart bodies, `input_audio` and document
//! parts. The proxy therefore translates each upload into the closest part the
//! upstream can read (see [`part_for`]) and, when the upstream still rejects an
//! unsupported part, retries once with an honest text note and reports a
//! warning instead of dropping the attachment silently.
//!
//! The route is mounted at the root router (not inside the 15 s `/api`
//! timeout budget) because Hermes answers may legitimately take minutes; the
//! outbound client enforces `HERMES_TIMEOUT` (>= 180 s).

use std::fmt::Write as _;

use axum::{
    body::Body,
    extract::{multipart::Field, FromRequest, Multipart, Request, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{config::HermesConfig, state::AppState};

/// Opaque session identifier minted by the UI; forwarded byte-for-byte.
pub const SESSION_HEADER: &str = "x-hermes-session-id";

/// The UI sends exactly one user turn; history is Hermes' server-side memory.
const MAX_MESSAGES: usize = 1;
const MAX_CONTENT_BYTES: usize = 32_000;

/// Server-side memory guardrails. They bound RAM, not file *types*: any number
/// of images, documents, audios and archives is accepted while it fits.
pub const MAX_ATTACHMENTS: usize = 20;
pub const MAX_FILE_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_TOTAL_ATTACHMENT_BYTES: usize = 40 * 1024 * 1024;
/// Request body ceiling: attachments + text + multipart overhead.
pub const MAX_BODY_BYTES: usize = MAX_TOTAL_ATTACHMENT_BYTES + MAX_CONTENT_BYTES + 1024 * 1024;
/// How much of a text-like file is inlined into the prompt.
const MAX_INLINE_TEXT_BYTES: usize = 16_000;

const TEXT_EXTENSIONS: &[&str] = &[
    "txt", "md", "markdown", "json", "csv", "tsv", "xml", "yaml", "yml", "log", "rs", "ts", "tsx",
    "js", "jsx", "mjs", "cjs", "py", "go", "java", "kt", "rb", "php", "sh", "bash", "toml", "ini",
    "cfg", "conf", "sql", "html", "htm", "css", "scss", "svelte", "vue", "patch", "diff", "env",
];

#[derive(Debug, Deserialize)]
pub struct ChatRequest {
    pub messages: Vec<ChatMessage>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// One uploaded file, already read from the multipart stream.
#[derive(Debug, Clone)]
pub struct Attachment {
    pub filename: String,
    pub mime: String,
    pub bytes: Vec<u8>,
}

/// The current user turn: text and/or uploads.
#[derive(Debug, Clone, Default)]
pub struct Turn {
    pub text: String,
    pub attachments: Vec<Attachment>,
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
        return Err(
            "only the current user message is accepted; history lives on the server".to_string(),
        );
    }
    let msg = &body.messages[0];
    if msg.role != "user" {
        return Err("the message role must be user".to_string());
    }
    if msg.content.trim().is_empty() {
        return Err("the message content must not be empty".to_string());
    }
    if msg.content.len() > MAX_CONTENT_BYTES {
        return Err(format!(
            "the message content must be at most {MAX_CONTENT_BYTES} bytes"
        ));
    }
    Ok(())
}

fn base_mime(raw: &str) -> &str {
    raw.split(';').next().unwrap_or(raw).trim()
}

fn is_image(mime: &str) -> bool {
    mime.starts_with("image/")
}

fn is_audio(mime: &str) -> bool {
    mime.starts_with("audio/")
}

fn is_text_like(mime: &str, filename: &str) -> bool {
    if mime.starts_with("text/") {
        return true;
    }
    if matches!(
        mime,
        "application/json"
            | "application/xml"
            | "application/yaml"
            | "application/x-yaml"
            | "application/toml"
            | "application/javascript"
            | "application/typescript"
    ) {
        return true;
    }
    let ext = filename
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    TEXT_EXTENSIONS.contains(&ext.as_str())
}

/// `input_audio.format` only accepts a handful of names; map MIME first and
/// fall back to the extension so a browser recording always has a valid value.
fn audio_format(mime: &str, filename: &str) -> &'static str {
    let ext = filename
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    match mime {
        "audio/webm" => "webm",
        "audio/wav" | "audio/x-wav" | "audio/wave" => "wav",
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/ogg" => "ogg",
        "audio/mp4" | "audio/m4a" | "audio/x-m4a" => "m4a",
        _ => match ext.as_str() {
            "wav" => "wav",
            "mp3" => "mp3",
            "ogg" | "oga" | "opus" => "ogg",
            "m4a" | "mp4" => "m4a",
            _ => "webm",
        },
    }
}

/// One attachment as the content part the upstream can read. The table is
/// documented in `odd/tasks/hermes-adjuntos-audio-artefactos.md`.
fn part_for(attachment: &Attachment) -> Value {
    let mime = base_mime(&attachment.mime);
    if is_image(mime) {
        return json!({
            "type": "image_url",
            "image_url": { "url": format!("data:{mime};base64,{}", BASE64.encode(&attachment.bytes)) }
        });
    }
    if is_audio(mime) {
        return json!({
            "type": "input_audio",
            "input_audio": {
                "data": BASE64.encode(&attachment.bytes),
                "format": audio_format(mime, &attachment.filename),
            }
        });
    }
    if let Some(text) = inline_text(attachment) {
        return json!({ "type": "text", "text": text });
    }
    json!({
        "type": "text",
        "text": format!(
            "Archivo adjunto: {} ({}, {} bytes). El servidor de Hermes no puede leer el contenido binario de este archivo.",
            attachment.filename,
            mime,
            attachment.bytes.len()
        )
    })
}

/// Text-like files travel inline so the agent can actually read them.
fn inline_text(attachment: &Attachment) -> Option<String> {
    let mime = base_mime(&attachment.mime);
    if !is_text_like(mime, &attachment.filename) {
        return None;
    }
    let lossy = String::from_utf8_lossy(&attachment.bytes);
    let body: &str = &lossy;
    let (shown, truncated) = if body.len() > MAX_INLINE_TEXT_BYTES {
        let mut end = MAX_INLINE_TEXT_BYTES;
        while end > 0 && !body.is_char_boundary(end) {
            end -= 1;
        }
        (&body[..end], true)
    } else {
        (body, false)
    };
    let mut out = String::new();
    let _ = write!(
        out,
        "Archivo adjunto: {} ({}){}\n--- inicio ---\n{}\n--- fin ---",
        attachment.filename,
        mime,
        if truncated { " [truncado]" } else { "" },
        shown
    );
    Some(out)
}

/// Audio note used when the upstream cannot process `input_audio`.
fn degraded_audio_note(attachment: &Attachment) -> Value {
    json!({
        "type": "text",
        "text": format!(
            "Nota de voz adjunta: {} ({}, {} bytes). Este servidor de Hermes todavía no procesa audio, así que no pudo escucharla.",
            attachment.filename,
            base_mime(&attachment.mime),
            attachment.bytes.len()
        )
    })
}

fn build_content(turn: &Turn, degrade_audio: bool) -> Value {
    if turn.attachments.is_empty() {
        return Value::String(turn.text.trim().to_string());
    }
    let mut parts: Vec<Value> = Vec::with_capacity(turn.attachments.len() + 1);
    if !turn.text.trim().is_empty() {
        parts.push(json!({ "type": "text", "text": turn.text.trim() }));
    }
    for attachment in &turn.attachments {
        let mime = base_mime(&attachment.mime);
        if degrade_audio && is_audio(mime) {
            parts.push(degraded_audio_note(attachment));
        } else {
            parts.push(part_for(attachment));
        }
    }
    if parts.is_empty() {
        parts.push(json!({ "type": "text", "text": "Revisá los archivos adjuntos." }));
    }
    Value::Array(parts)
}

fn body_for(turn: &Turn, degrade_audio: bool) -> Value {
    json!({ "messages": [{ "role": "user", "content": build_content(turn, degrade_audio) }] })
}

/// What the user must know after the proxy degraded a part. Audio has its own
/// message; any future unsupported part still gets a generic notice so nothing
/// disappears silently.
fn degradation_warnings(turn: &Turn) -> Vec<String> {
    let mut warnings: Vec<String> = turn
        .attachments
        .iter()
        .filter(|a| is_audio(base_mime(&a.mime)))
        .map(|a| {
            format!(
                "No se pudo enviar la nota de voz «{}»: este servidor de Hermes no procesa audio todavía.",
                a.filename
            )
        })
        .collect();
    if warnings.is_empty() {
        warnings.push(
            "Hermes rechazó parte de los adjuntos; se enviaron como texto para no perder el mensaje."
                .to_string(),
        );
    }
    warnings
}

fn upstream_unsupported(body: &Value) -> bool {
    body.pointer("/error/code")
        .and_then(Value::as_str)
        .map(|code| code == "unsupported_content_type")
        .unwrap_or(false)
}

/// Keep only artifacts a browser may safely load and download.
fn sanitize_artifacts(raw: &[Value]) -> Vec<Value> {
    raw.iter()
        .filter_map(|item| {
            let object = item.as_object()?;
            let url = object.get("url").and_then(Value::as_str)?;
            let safe = url.starts_with("http://")
                || url.starts_with("https://")
                || url.starts_with("data:");
            if !safe {
                return None;
            }
            let name = match object.get("name").and_then(Value::as_str) {
                Some(name) if !name.trim().is_empty() => name.to_string(),
                // A data: URL has no path tail worth showing.
                _ if url.starts_with("data:") => "archivo".to_string(),
                _ => url
                    .rsplit('/')
                    .next()
                    .filter(|tail| !tail.is_empty())
                    .unwrap_or("archivo")
                    .to_string(),
            };
            let mut out = serde_json::Map::new();
            out.insert("url".into(), Value::String(url.to_string()));
            out.insert("name".into(), Value::String(name));
            if let Some(mime) = object.get("mime").and_then(Value::as_str) {
                out.insert("mime".into(), Value::String(mime.to_string()));
            }
            if let Some(size) = object.get("size").and_then(Value::as_u64) {
                out.insert("size".into(), Value::Number(size.into()));
            }
            Some(Value::Object(out))
        })
        .collect()
}

/// Normalized envelope: the UI never has to know the upstream wire format.
fn normalize(upstream: &Value, warnings: Vec<String>) -> Value {
    let message = upstream.pointer("/choices/0/message");
    let reply = message
        .and_then(|m| m.get("content"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let artifacts = message
        .and_then(|m| m.get("artifacts"))
        .and_then(Value::as_array)
        .map(|items| sanitize_artifacts(items))
        .unwrap_or_default();
    json!({ "reply": reply, "artifacts": artifacts, "warnings": warnings })
}

async fn read_text_field(mut field: Field<'_>) -> Result<String, Response> {
    let mut out = Vec::new();
    loop {
        match field.chunk().await {
            Ok(Some(chunk)) => {
                out.extend_from_slice(&chunk);
                if out.len() > MAX_CONTENT_BYTES {
                    return Err(error_response(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "VALIDATION_ERROR",
                        "the message content is too long",
                    ));
                }
            }
            Ok(None) => return Ok(String::from_utf8_lossy(&out).to_string()),
            Err(_) => {
                return Err(error_response(
                    StatusCode::BAD_REQUEST,
                    "INVALID_MULTIPART",
                    "the multipart body could not be read",
                ))
            }
        }
    }
}

async fn read_capped(mut field: Field<'_>, cap: usize, code: &str) -> Result<Vec<u8>, Response> {
    let mut out = Vec::new();
    loop {
        match field.chunk().await {
            Ok(Some(chunk)) => {
                if out.len() + chunk.len() > cap {
                    return Err(error_response(
                        StatusCode::PAYLOAD_TOO_LARGE,
                        code,
                        "the attachment exceeds the upload limit",
                    ));
                }
                out.extend_from_slice(&chunk);
            }
            Ok(None) => return Ok(out),
            Err(_) => {
                return Err(error_response(
                    StatusCode::BAD_REQUEST,
                    "INVALID_MULTIPART",
                    "the multipart body could not be read",
                ))
            }
        }
    }
}

/// Read `message` + repeated `files` parts. Unknown fields are ignored so a
/// future UI can send extra metadata without breaking the proxy.
async fn parse_multipart(mut multipart: Multipart) -> Result<Turn, Response> {
    let mut turn = Turn::default();
    let mut total = 0usize;
    loop {
        let field = match multipart.next_field().await {
            Ok(Some(field)) => field,
            Ok(None) => break,
            Err(_) => {
                return Err(error_response(
                    StatusCode::BAD_REQUEST,
                    "INVALID_MULTIPART",
                    "the multipart body could not be parsed",
                ))
            }
        };
        let name = field.name().unwrap_or_default().to_string();
        match name.as_str() {
            "message" | "content" => {
                turn.text = read_text_field(field).await?;
            }
            "files" | "file" => {
                if turn.attachments.len() >= MAX_ATTACHMENTS {
                    return Err(error_response(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "TOO_MANY_ATTACHMENTS",
                        &format!("at most {MAX_ATTACHMENTS} attachments are accepted per message"),
                    ));
                }
                let filename = field
                    .file_name()
                    .map(str::to_string)
                    .unwrap_or_else(|| "adjunto".to_string());
                let mime = field
                    .content_type()
                    .map(|value| base_mime(value).to_string())
                    .unwrap_or_else(|| "application/octet-stream".to_string());
                let bytes = read_capped(field, MAX_FILE_BYTES, "ATTACHMENT_TOO_LARGE").await?;
                total += bytes.len();
                if total > MAX_TOTAL_ATTACHMENT_BYTES {
                    return Err(error_response(
                        StatusCode::PAYLOAD_TOO_LARGE,
                        "ATTACHMENTS_TOO_LARGE",
                        "the attachments exceed the total upload limit",
                    ));
                }
                turn.attachments.push(Attachment {
                    filename,
                    mime,
                    bytes,
                });
            }
            _ => {
                // Drain unknown fields so the stream keeps moving.
                let _ = read_capped(field, MAX_BODY_BYTES, "INVALID_MULTIPART").await?;
            }
        }
    }
    if turn.text.trim().is_empty() && turn.attachments.is_empty() {
        return Err(error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_ERROR",
            "a message or at least one attachment is required",
        ));
    }
    Ok(turn)
}

async fn post_once(
    cfg: &HermesConfig,
    session: Option<&HeaderValue>,
    body_json: &Value,
) -> Result<reqwest::Response, Response> {
    let mut request = cfg
        .http
        .post(&cfg.api_url)
        .bearer_auth(&cfg.api_key)
        .json(body_json);
    if let Some(value) = session {
        // HeaderValue is already validated by the HTTP layer: copy it as-is
        // instead of re-parsing and risking a normalized/mangled identifier.
        request = request.header(
            header::HeaderName::from_static(SESSION_HEADER),
            value.clone(),
        );
    }
    request.send().await.map_err(|err| {
        if err.is_timeout() {
            tracing::warn!("hermes upstream timed out");
            error_response(
                StatusCode::GATEWAY_TIMEOUT,
                "HERMES_TIMEOUT",
                "Hermes did not answer in time",
            )
        } else {
            tracing::warn!("hermes upstream is unreachable");
            error_response(
                StatusCode::BAD_GATEWAY,
                "HERMES_UNAVAILABLE",
                "Hermes is unreachable",
            )
        }
    })
}

/// Forward one user turn, degrading audio once if the upstream rejects it.
/// Returns the upstream JSON plus any user-facing warnings.
async fn send_to_hermes(
    cfg: &HermesConfig,
    session: Option<&HeaderValue>,
    turn: &Turn,
) -> Result<(Value, Vec<String>), Response> {
    let mut warnings = Vec::new();
    let mut upstream = post_once(cfg, session, &body_for(turn, false)).await?;

    let status = upstream.status();
    if status == reqwest::StatusCode::BAD_REQUEST {
        let body = match upstream.json::<Value>().await {
            Ok(body) => body,
            Err(err) if err.is_timeout() => {
                tracing::warn!("hermes upstream timed out while reading the rejection body");
                return Err(error_response(
                    StatusCode::GATEWAY_TIMEOUT,
                    "HERMES_TIMEOUT",
                    "Hermes did not answer in time",
                ));
            }
            Err(_) => Value::Null,
        };
        if upstream_unsupported(&body) {
            tracing::info!("hermes rejected unsupported content parts; retrying degraded");
            warnings = degradation_warnings(turn);
            upstream = post_once(cfg, session, &body_for(turn, true)).await?;
        } else {
            return Err(map_upstream_status(status));
        }
    } else if !status.is_success() {
        return Err(map_upstream_status(status));
    }

    let status = upstream.status();
    if !status.is_success() {
        return Err(map_upstream_status(status));
    }

    match upstream.bytes().await {
        Ok(body) => match serde_json::from_slice::<Value>(&body) {
            Ok(value) => Ok((value, warnings)),
            Err(_) => Err(error_response(
                StatusCode::BAD_GATEWAY,
                "HERMES_UPSTREAM_ERROR",
                "Hermes returned an unreadable response",
            )),
        },
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

fn map_upstream_status(status: reqwest::StatusCode) -> Response {
    if status == reqwest::StatusCode::UNAUTHORIZED {
        tracing::warn!("hermes rejected the configured credentials");
        return error_response(
            StatusCode::UNAUTHORIZED,
            "HERMES_UNAUTHORIZED",
            "Hermes rejected the configured credentials",
        );
    }
    tracing::warn!(status = status.as_u16(), "hermes returned an error");
    error_response(
        StatusCode::BAD_GATEWAY,
        "HERMES_UPSTREAM_ERROR",
        "Hermes returned an error",
    )
}

/// `POST /api/hermes` — authenticated chat turn (JSON or multipart).
pub async fn hermes_chat_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    request: Request,
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

    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();

    let turn = if content_type.starts_with("application/json") {
        let bytes = match axum::body::to_bytes(request.into_body(), MAX_BODY_BYTES).await {
            Ok(bytes) => bytes,
            Err(_) => {
                return error_response(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "PAYLOAD_TOO_LARGE",
                    "the request body exceeds the upload limit",
                )
            }
        };
        let body: ChatRequest = match serde_json::from_slice(&bytes) {
            Ok(body) => body,
            Err(_) => {
                return error_response(
                    StatusCode::BAD_REQUEST,
                    "INVALID_JSON",
                    "the request body is not valid JSON",
                )
            }
        };
        if let Err(message) = validate(&body) {
            return error_response(StatusCode::UNPROCESSABLE_ENTITY, "VALIDATION_ERROR", &message);
        }
        Turn {
            text: body.messages[0].content.clone(),
            attachments: Vec::new(),
        }
    } else if content_type.starts_with("multipart/form-data") {
        let multipart = match Multipart::from_request(request, &state).await {
            Ok(multipart) => multipart,
            Err(_) => {
                return error_response(
                    StatusCode::BAD_REQUEST,
                    "INVALID_MULTIPART",
                    "the multipart body could not be parsed",
                )
            }
        };
        match parse_multipart(multipart).await {
            Ok(turn) => turn,
            Err(response) => return response,
        }
    } else {
        return error_response(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "UNSUPPORTED_MEDIA_TYPE",
            "use application/json or multipart/form-data",
        );
    };

    let session = headers.get(SESSION_HEADER);
    match send_to_hermes(cfg, session, &turn).await {
        Ok((upstream, warnings)) => {
            let envelope = normalize(&upstream, warnings);
            match serde_json::to_vec(&envelope) {
                Ok(body) => Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body))
                    .unwrap_or_else(|_| error_response(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "INTERNAL_ERROR",
                        "could not build the response",
                    )),
                Err(_) => error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "INTERNAL_ERROR",
                    "could not build the response",
                ),
            }
        }
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

    use axum::{extract::DefaultBodyLimit, extract::State, routing::post, Router};
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
    struct Seen(Arc<Mutex<Vec<SeenRequest>>>);

    struct SeenRequest {
        authorization: Option<String>,
        session: Option<String>,
        body: Value,
    }

    async fn capture(State(seen): State<Seen>, headers: HeaderMap, Json(body): Json<Value>) -> Json<Value> {
        seen.0.lock().expect("seen lock").push(SeenRequest {
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

    fn turn(text: &str) -> Turn {
        Turn {
            text: text.into(),
            attachments: Vec::new(),
        }
    }

    fn attachment(filename: &str, mime: &str, bytes: &[u8]) -> Attachment {
        Attachment {
            filename: filename.into(),
            mime: mime.into(),
            bytes: bytes.to_vec(),
        }
    }

    #[tokio::test]
    async fn forwards_bearer_session_and_only_the_current_message() {
        let seen = Seen::default();
        let app = Router::new()
            .route("/v1/chat/completions", post(capture))
            .with_state(seen.clone());
        let url = spawn(app).await;

        let session = HeaderValue::from_static("sess-abc-123");
        let (value, warnings) = send_to_hermes(&cfg(url, 2_000), Some(&session), &turn("¿qué tal?"))
            .await
            .expect("upstream success");
        assert_eq!(value["choices"][0]["message"]["content"], "hola");
        assert!(warnings.is_empty());

        let calls = seen.0.lock().expect("seen lock");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].authorization.as_deref(), Some("Bearer upstream-secret"));
        assert_eq!(calls[0].session.as_deref(), Some("sess-abc-123"));
        assert_eq!(
            calls[0].body,
            json!({"messages": [{"role": "user", "content": "¿qué tal?"}]}),
            "the proxy must forward exactly the current user message"
        );
    }

    #[tokio::test]
    async fn images_travel_as_inline_image_parts_and_text_as_text_part() {
        let seen = Seen::default();
        let app = Router::new()
            .route("/v1/chat/completions", post(capture))
            .with_state(seen.clone());
        let url = spawn(app).await;

        let mut t = turn("mirá esto");
        t.attachments
            .push(attachment("foto.png", "image/png", &[0x89, 0x50, 0x4e, 0x47]));
        send_to_hermes(&cfg(url, 2_000), None, &t)
            .await
            .expect("upstream success");

        let calls = seen.0.lock().expect("seen lock");
        let parts = calls[0].body["messages"][0]["content"]
            .as_array()
            .expect("content parts");
        assert_eq!(parts[0], json!({"type": "text", "text": "mirá esto"}));
        assert_eq!(parts[1]["type"], "image_url");
        assert!(parts[1]["image_url"]["url"]
            .as_str()
            .expect("data url")
            .starts_with("data:image/png;base64,"));
    }

    #[tokio::test]
    async fn text_files_are_inlined_and_truncated() {
        let big = "a".repeat(MAX_INLINE_TEXT_BYTES + 10);
        let part = inline_text(&attachment("notas.md", "text/markdown", big.as_bytes()))
            .expect("text inline");
        assert!(part.contains("Archivo adjunto: notas.md (text/markdown) [truncado]"));
        assert!(part.contains("--- inicio ---"));
        assert!(part.len() < big.len() + 200);
    }

    #[tokio::test]
    async fn binary_attachments_become_an_honest_descriptor() {
        let part = part_for(&attachment("datos.zip", "application/zip", &[1, 2, 3]));
        assert_eq!(part["type"], "text");
        let text = part["text"].as_str().expect("text");
        assert!(text.contains("datos.zip"));
        assert!(text.contains("no puede leer el contenido binario"));
    }

    #[derive(Clone, Default)]
    struct RejectAudio {
        calls: Arc<Mutex<Vec<Value>>>,
    }

    async fn reject_audio(
        State(state): State<RejectAudio>,
        Json(body): Json<Value>,
    ) -> Response {
        state.calls.lock().expect("calls").push(body.clone());
        if body.to_string().contains("input_audio") {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": {"code": "unsupported_content_type", "message": "no audio"}})),
            )
                .into_response();
        }
        Json(json!({"choices": [{"message": {"content": "ok"}}]})).into_response()
    }

    #[tokio::test]
    async fn audio_is_degraded_once_with_a_warning() {
        let state = RejectAudio::default();
        let app = Router::new()
            .route("/v1/chat/completions", post(reject_audio))
            .with_state(state.clone());
        let url = spawn(app).await;

        let mut t = turn("escuchá");
        t.attachments
            .push(attachment("nota.webm", "audio/webm", b"webm-bytes"));
        let (value, warnings) = send_to_hermes(&cfg(url, 2_000), None, &t)
            .await
            .expect("degraded success");

        assert_eq!(value["choices"][0]["message"]["content"], "ok");
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("nota.webm"));

        let calls = state.calls.lock().expect("calls");
        assert_eq!(calls.len(), 2, "exactly one retry");
        assert!(calls[0].to_string().contains("input_audio"));
        assert!(
            !calls[1].to_string().contains("input_audio"),
            "the retry must replace the unsupported part"
        );
        assert!(calls[1].to_string().contains("Nota de voz adjunta"));
    }

    #[tokio::test]
    async fn maps_upstream_unauthorized_to_401_without_leaking_the_key() {
        let app = Router::new().route(
            "/v1/chat/completions",
            post(|| async { StatusCode::UNAUTHORIZED }),
        );
        let url = spawn(app).await;
        let response = send_to_hermes(&cfg(url, 2_000), None, &turn("hola"))
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
        let response = send_to_hermes(&cfg(url, 2_000), None, &turn("hola"))
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
        let response = send_to_hermes(&cfg(url, 80), None, &turn("hola"))
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

        let response = send_to_hermes(&cfg(format!("http://{addr}/v1/chat/completions"), 100), None, &turn("hola"))
            .await
            .expect_err("body timeout maps to an error response");
        assert_eq!(response.status(), StatusCode::GATEWAY_TIMEOUT);
    }

    #[tokio::test]
    async fn unreachable_upstream_maps_to_502() {
        let response = send_to_hermes(
            &cfg("http://127.0.0.1:1/v1/chat/completions".into(), 300),
            None,
            &turn("hola"),
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

    #[test]
    fn normalize_returns_reply_artifacts_and_warnings() {
        let upstream = json!({
            "choices": [{
                "message": {
                    "content": "listo",
                    "artifacts": [
                        {"name": "grafico.png", "url": "https://example.test/g.png", "mime": "image/png", "size": 12},
                        {"name": "malo", "url": "javascript:alert(1)"},
                        {"url": "data:text/plain;base64,aGk=", "mime": "text/plain"}
                    ]
                }
            }]
        });
        let envelope = normalize(&upstream, vec!["warn".into()]);
        assert_eq!(envelope["reply"], "listo");
        assert_eq!(envelope["warnings"], json!(["warn"]));
        let artifacts = envelope["artifacts"].as_array().expect("artifacts");
        assert_eq!(artifacts.len(), 2, "unsafe urls are dropped");
        assert_eq!(artifacts[0]["name"], "grafico.png");
        assert_eq!(artifacts[1]["name"], "archivo", "data urls have no filename tail");
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

    fn json_request(body: &str) -> Request {
        Request::builder()
            .method("POST")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .expect("request")
    }

    #[tokio::test]
    async fn requires_an_authenticated_dashboard_session() {
        let response = hermes_chat_handler(
            State(lazy_state()),
            HeaderMap::new(),
            json_request(r#"{"messages":[{"role":"user","content":"hola"}]}"#),
        )
        .await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn unauthenticated_multipart_is_rejected_before_parsing() {
        let response = hermes_chat_handler(
            State(lazy_state()),
            HeaderMap::new(),
            Request::builder()
                .method("POST")
                .header(header::CONTENT_TYPE, "multipart/form-data; boundary=x")
                .body(Body::from("--x--"))
                .expect("request"),
        )
        .await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn auth_runs_before_content_type_checks() {
        let mut state = lazy_state();
        state.hermes = Some(cfg("http://127.0.0.1:1/v1/chat/completions".into(), 300));
        let mut headers = HeaderMap::new();
        headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/plain"));
        let response = hermes_chat_handler(
            State(state),
            headers,
            Request::builder()
                .method("POST")
                .body(Body::from("hola"))
                .expect("request"),
        )
        .await;
        // Auth runs first: without a token the handler stops at 401.
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    const B: &str = "X-TEST-BOUNDARY";

    fn part_text(name: &str, value: &str) -> Vec<u8> {
        format!("--{B}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").into_bytes()
    }

    fn part_file(name: &str, filename: &str, mime: &str, bytes: &[u8]) -> Vec<u8> {
        let mut out = format!(
            "--{B}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\nContent-Type: {mime}\r\n\r\n"
        )
        .into_bytes();
        out.extend_from_slice(bytes);
        out.extend_from_slice(b"\r\n");
        out
    }

    async fn parse_body(parts: Vec<Vec<u8>>) -> Result<Turn, Response> {
        let mut body = Vec::new();
        for part in parts {
            body.extend_from_slice(&part);
        }
        body.extend_from_slice(format!("--{B}--\r\n").as_bytes());
        let request = Request::builder()
            .method("POST")
            .header(
                header::CONTENT_TYPE,
                format!("multipart/form-data; boundary={B}"),
            )
            .body(Body::from(body))
            .expect("multipart request");
        let multipart = Multipart::from_request(request, &())
            .await
            .expect("multipart extractor");
        parse_multipart(multipart).await
    }

    #[tokio::test]
    async fn multipart_message_and_files_are_parsed() {
        let turn = parse_body(vec![
            part_text("message", "mirá estos archivos"),
            part_file("files", "foto.png", "image/png", &[0x89, 0x50]),
            part_file("files", "nota.md", "text/markdown", b"# hola"),
        ])
        .await
        .expect("parsed turn");

        assert_eq!(turn.text, "mirá estos archivos");
        assert_eq!(turn.attachments.len(), 2);
        assert_eq!(turn.attachments[0].filename, "foto.png");
        assert_eq!(turn.attachments[0].mime, "image/png");
        assert_eq!(turn.attachments[0].bytes, vec![0x89, 0x50]);
        assert_eq!(turn.attachments[1].filename, "nota.md");
    }

    #[tokio::test]
    async fn multipart_attachments_only_is_a_valid_turn() {
        let turn = parse_body(vec![part_file(
            "files",
            "solo.png",
            "image/png",
            &[1, 2, 3],
        )])
        .await
        .expect("attachments-only turn");
        assert!(turn.text.is_empty());
        assert_eq!(turn.attachments.len(), 1);
    }

    #[tokio::test]
    async fn multipart_ignores_unknown_fields() {
        let turn = parse_body(vec![
            part_text("extra", "ignorame"),
            part_text("message", "hola"),
        ])
        .await
        .expect("parsed turn");
        assert_eq!(turn.text, "hola");
        assert!(turn.attachments.is_empty());
    }

    #[tokio::test]
    async fn multipart_empty_turn_is_422() {
        let response = parse_body(vec![]).await.expect_err("empty turn");
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn multipart_message_over_the_text_limit_is_422_not_413() {
        let long = "a".repeat(MAX_CONTENT_BYTES + 1);
        let response = parse_body(vec![part_text("message", &long), part_file("files", "a.txt", "text/plain", b"x")])
            .await
            .expect_err("long message");
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let body = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .expect("error body");
        assert!(String::from_utf8_lossy(&body).contains("VALIDATION_ERROR"));
    }

    #[tokio::test]
    async fn multipart_rejects_the_21st_attachment() {
        let mut parts: Vec<Vec<u8>> = (0..MAX_ATTACHMENTS)
            .map(|index| part_file("files", &format!("f{index}.txt"), "text/plain", b"x"))
            .collect();
        parts.push(part_file("files", "extra.txt", "text/plain", b"x"));
        let response = parse_body(parts).await.expect_err("too many files");
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let body = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .expect("error body");
        assert!(String::from_utf8_lossy(&body).contains("TOO_MANY_ATTACHMENTS"));
    }

    /// The per-file guardrail only runs under the route's body limit: a bare
    /// `Request` keeps axum's 2 MiB default, which rejects first. This drives
    /// the real router layer instead of the parser in isolation.
    #[tokio::test]
    async fn multipart_rejects_an_attachment_over_the_size_limit() {
        use tower::ServiceExt;

        let app = Router::new()
            .route(
                "/",
                post(|multipart: Multipart| async {
                    match parse_multipart(multipart).await {
                        Ok(_) => StatusCode::OK,
                        Err(response) => response.status(),
                    }
                }),
            )
            .layer(DefaultBodyLimit::max(MAX_BODY_BYTES));

        let big = vec![0u8; MAX_FILE_BYTES + 1];
        let mut body = part_file("files", "grande.zip", "application/zip", &big);
        body.extend_from_slice(format!("--{B}--\r\n").as_bytes());
        let request = Request::builder()
            .method("POST")
            .header(
                header::CONTENT_TYPE,
                format!("multipart/form-data; boundary={B}"),
            )
            .body(Body::from(body))
            .expect("multipart request");

        let response = app.oneshot(request).await.expect("router call");
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[test]
    fn files_only_turns_carry_no_empty_text_part() {
        let mut turn = Turn::default();
        turn.attachments
            .push(attachment("foto.png", "image/png", &[1, 2]));
        let content = build_content(&turn, false);
        let parts = content.as_array().expect("content parts");
        assert_eq!(parts.len(), 1);
        assert_eq!(parts[0]["type"], "image_url");
    }

    /// Real upstream round trip (network + credentials). Ignored by default:
    /// run it with `HERMES_API_URL`/`HERMES_API_KEY` exported to record latency.
    #[tokio::test]
    #[ignore = "hits the real Hermes upstream; run with HERMES_API_URL/KEY exported"]
    async fn real_upstream_roundtrip_with_an_image_reports_latency() {
        let url = std::env::var("HERMES_API_URL").expect("HERMES_API_URL");
        let key = std::env::var("HERMES_API_KEY").expect("HERMES_API_KEY");
        let mut turn = turn("Respondé solo: ok");
        turn.attachments.push(attachment(
            "pixel.png",
            "image/png",
            &[
                0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
                0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
                0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44,
                0x41, 0x54, 0x78, 0xda, 0x63, 0xfc, 0xcf, 0xc0, 0x00, 0x00, 0x03, 0x00, 0x01,
                0xfe, 0x01, 0x64, 0x03, 0x5c, 0x50, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
                0x44, 0xae, 0x42, 0x60, 0x82,
            ],
        ));
        let real = HermesConfig {
            api_url: url,
            api_key: key,
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_millis(
                    crate::config::HERMES_DEFAULT_TIMEOUT_MS,
                ))
                .build()
                .expect("real client"),
        };
        let started = std::time::Instant::now();
        let (value, warnings) = send_to_hermes(&real, None, &turn)
            .await
            .expect("real upstream answered");
        eprintln!("REAL_UPSTREAM_LATENCY_MS={}", started.elapsed().as_millis());
        eprintln!("REAL_UPSTREAM_WARNINGS={warnings:?}");
        assert!(value.pointer("/choices/0/message/content").is_some());
    }

    /// Proves the real upstream's `unsupported_content_type` shape maps to the
    /// graceful retry (the whole reason the degradation exists).
    #[tokio::test]
    #[ignore = "hits the real Hermes upstream; run with HERMES_API_URL/KEY exported"]
    async fn real_upstream_degrades_audio_with_a_warning() {
        let url = std::env::var("HERMES_API_URL").expect("HERMES_API_URL");
        let key = std::env::var("HERMES_API_KEY").expect("HERMES_API_KEY");
        let real = HermesConfig {
            api_url: url,
            api_key: key,
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_millis(
                    crate::config::HERMES_DEFAULT_TIMEOUT_MS,
                ))
                .build()
                .expect("real client"),
        };
        let mut turn = turn("Te mando una nota de voz, respondé solo: recibida");
        turn.attachments.push(attachment(
            "nota.webm",
            "audio/webm",
            b"\x1a\x45\xdf\xa3not-a-real-recording",
        ));
        let started = std::time::Instant::now();
        let (value, warnings) = send_to_hermes(&real, None, &turn)
            .await
            .expect("real upstream answered after degrading");
        eprintln!(
            "REAL_AUDIO_LATENCY_MS={} WARNINGS={warnings:?}",
            started.elapsed().as_millis()
        );
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("nota.webm"));
        assert!(value.pointer("/choices/0/message/content").is_some());
    }

    #[test]
    fn content_type_and_limits_are_wired() {
        assert!(MAX_BODY_BYTES > MAX_TOTAL_ATTACHMENT_BYTES);
        assert_eq!(MAX_ATTACHMENTS, 20);
        assert!(is_text_like("text/plain", "nota.weird"));
        assert!(is_text_like("application/octet-stream", "main.rs"));
        assert!(!is_text_like("application/zip", "datos.zip"));
        assert_eq!(audio_format("audio/webm", "nota.webm"), "webm");
        assert_eq!(audio_format("application/octet-stream", "nota.wav"), "wav");
        assert_eq!(audio_format("audio/mpeg", "nota.mp3"), "mp3");
    }
}
