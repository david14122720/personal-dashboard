//! Authenticated proxy for the Hermes Runs API.
//!
//! The browser never sees `HERMES_API_KEY`: it posts a user turn to
//! `POST /api/hermes/runs` (JSON or `multipart/form-data`), this handler
//! authenticates the dashboard session, injects the upstream Bearer credential
//! and a per-user session namespace, and returns a `run_id` the UI polls and
//! streams. Conversation memory lives on the Hermes server, so only the
//! current turn travels in the create body.
//!
//! Session namespacing (D5): the browser sends its own client UUID as
//! `sessionId`; the proxy forwards `session_id = "pd-<user_id>-<uuid>"`
//! towards Hermes and `X-Hermes-Session-Key: pd-<user_id>` for long-term
//! memory. Run ownership is verified by asking `GET /v1/runs/{id}` and
//! requiring its `session_id` to start with `pd-<user_id>-`: no in-memory or
//! DB state, and a user can never steer another user's session, stream or
//! approvals.
//!
//! Event transport (D7): `GET /api/hermes/runs/{id}/events` re-emits the
//! upstream SSE frames verbatim (`id:`, `data:`, `: keepalive` comments
//! included). The gateway vocabulary is the contract; the proxy translates
//! nothing.
//!
//! The routes are mounted at the root router (not inside the 15 s `/api`
//! timeout budget) because runs may legitimately take minutes; the outbound
//! client enforces `HERMES_TIMEOUT` (10 min by default) and the events stream
//! only a per-read silence budget.

use std::{
    fmt::Write as _,
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    body::Body,
    extract::{multipart::Field, FromRequest, Multipart, Path, Request, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use futures_util::StreamExt as _;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{config::HermesConfig, state::AppState};

/// Header the proxy sends upstream so Hermes can scope long-term memory per
/// dashboard user. Never accepted from the browser.
const SESSION_KEY_HEADER: &str = "x-hermes-session-key";

/// The UI sends exactly one user turn per run; history is Hermes's
/// server-side memory.
const MAX_CONTENT_BYTES: usize = 32_000;

/// Server-side memory guardrails. They bound RAM, not file *types*: any number
/// of images, documents, audios and archives is accepted while it fits.
pub const MAX_ATTACHMENTS: usize = 20;

/// JSON runs are a message plus metadata; only the multipart path is unbounded
/// (owner spec S2), and it is read chunk by chunk.
const MAX_JSON_BYTES: usize = 8 * 1024 * 1024;

/// How much of a text-like file is inlined into the prompt.
const MAX_INLINE_TEXT_BYTES: usize = 16_000;

/// Audio is base64-encoded into one JSON part; beyond this the proxy degrades
/// the note to text instead of buffering an unbounded recording.
const MAX_AUDIO_BYTES: usize = 25 * 1024 * 1024;

const TEXT_EXTENSIONS: &[&str] = &[
    "txt", "md", "markdown", "json", "csv", "tsv", "xml", "yaml", "yml", "log", "rs", "ts", "tsx",
    "js", "jsx", "mjs", "cjs", "py", "go", "java", "kt", "rb", "php", "sh", "bash", "toml", "ini",
    "cfg", "conf", "sql", "html", "htm", "css", "scss", "svelte", "vue", "patch", "diff", "env",
];

/// One uploaded file, already read from the multipart stream.
#[derive(Debug, Clone)]
pub struct Attachment {
    pub filename: String,
    pub mime: String,
    /// Kept only when the upstream needs the bytes (image, audio, text);
    /// everything else is counted and discarded to bound memory.
    pub bytes: Vec<u8>,
    pub size: u64,
    /// The kept prefix is shorter than the file: text inlines with a marker,
    /// audio degrades to a note instead of sending a truncated recording.
    pub truncated: bool,
}

/// The current user turn: text and/or uploads, plus the browser's client
/// session UUID (raw; the proxy scopes it via [`scoped_session_id`]).
#[derive(Debug, Clone, Default)]
pub struct Turn {
    pub text: String,
    pub attachments: Vec<Attachment>,
    pub session_id: String,
}

fn error_response(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        Json(json!({"error": {"code": code, "message": message}})),
    )
        .into_response()
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

/// One attachment as the content part the upstream can read. Images travel
/// inline as `data:` URLs, text-like files are inlined, and anything else —
/// including voice notes, which the gateway cannot hear (D6) — becomes an
/// honest text descriptor so nothing disappears silently.
fn part_for(attachment: &Attachment) -> Value {
    let mime = base_mime(&attachment.mime);
    if is_image(mime) {
        return json!({
            "type": "image_url",
            "image_url": { "url": format!("data:{mime};base64,{}", BASE64.encode(&attachment.bytes)) }
        });
    }
    if let Some(text) = inline_text(attachment) {
        return json!({ "type": "text", "text": text });
    }
    if is_audio(mime) {
        return json!({
            "type": "text",
            "text": format!(
                "Nota de voz adjunta como referencia: {} ({}, {} bytes). Este endpoint de Hermes sólo acepta texto e imágenes, así que no pudo escucharla.",
                attachment.filename,
                mime,
                attachment.size
            )
        });
    }
    json!({
        "type": "text",
        "text": format!(
            "Archivo adjunto: {} ({}, {} bytes). El servidor de Hermes no puede leer el contenido binario de este archivo.",
            attachment.filename,
            mime,
            attachment.size
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
    let (shown, truncated) = if attachment.truncated || body.len() > MAX_INLINE_TEXT_BYTES {
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

/// Consume one multipart field chunk by chunk. Bytes beyond `keep_limit` are
/// counted and dropped, so a multi-gigabyte upload costs disk/network time and
/// constant RAM. `truncated` tells the caller the kept prefix is incomplete.
async fn read_field(
    field: Field<'_>,
    keep_limit: usize,
) -> Result<(Vec<u8>, u64, bool), Response> {
    let mut out: Vec<u8> = Vec::new();
    let mut size: u64 = 0;
    let mut truncated = false;
    let mut field = field;
    loop {
        match field.chunk().await {
            Ok(Some(chunk)) => {
                size += chunk.len() as u64;
                if out.len() < keep_limit {
                    let room = keep_limit - out.len();
                    let take = room.min(chunk.len());
                    out.extend_from_slice(&chunk[..take]);
                    if take < chunk.len() {
                        truncated = true;
                    }
                } else if keep_limit > 0 {
                    truncated = true;
                }
            }
            Ok(None) => return Ok((out, size, truncated)),
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

/// Read `message` + `sessionId` + repeated `files` parts. Unknown fields are
/// ignored so a future UI can send extra metadata without breaking the proxy.
async fn parse_multipart(mut multipart: Multipart) -> Result<Turn, Response> {
    let mut turn = Turn::default();
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
            "sessionId" | "session_id" => {
                turn.session_id = read_text_field(field).await?;
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
                let base = base_mime(&mime).to_string();
                let keep_limit = if is_image(&base) {
                    usize::MAX
                } else if is_audio(&base) {
                    MAX_AUDIO_BYTES
                } else if is_text_like(&base, &filename) {
                    MAX_INLINE_TEXT_BYTES
                } else {
                    0
                };
                let (bytes, size, truncated) = read_field(field, keep_limit).await?;
                turn.attachments.push(Attachment {
                    filename,
                    mime,
                    bytes,
                    size,
                    truncated,
                });
            }
            _ => {
                // Drain unknown fields so the stream keeps moving.
                let _ = read_field(field, 0).await?;
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

// ---------------------------------------------------------------------------
// Runs addressing: base URL, session namespacing, run ids
// ---------------------------------------------------------------------------

/// Base URL for `/v1/runs*` derived from `HERMES_API_URL`, which may point at
/// the gateway root (`http://host:8642`) or at the legacy chat endpoint
/// (`http://host:8642/v1/chat/completions`). A trailing `/v1...` gateway path
/// is stripped; any other base path (e.g. a reverse-proxy prefix) is
/// preserved verbatim.
fn api_base(url: &str) -> String {
    let trimmed = url.trim_end_matches('/');
    if let Some(prefix) = trimmed.strip_suffix("/v1/chat/completions") {
        return prefix.to_string();
    }
    if let Some(index) = trimmed.rfind("/v1/") {
        return trimmed[..index].to_string();
    }
    if let Some(prefix) = trimmed.strip_suffix("/v1") {
        return prefix.to_string();
    }
    trimmed.to_string()
}

/// Scope the browser's client session UUID into this user's Hermes namespace.
/// Returns `None` for anything that is not a UUID: no length games, no free
/// text — a forged or missing id can never address another session.
pub fn scoped_session_id(user_id: Uuid, client_session: &str) -> Option<String> {
    let uuid = Uuid::parse_str(client_session.trim()).ok()?;
    Some(format!("pd-{user_id}-{uuid}"))
}

/// True only when `session_id` lives in this user's namespace. Run ownership
/// is decided with this predicate against the `session_id` reported by
/// `GET /v1/runs/{id}`: no proxy-side state, no database.
pub fn session_owned(session_id: &str, user_id: Uuid) -> bool {
    let prefix = format!("pd-{user_id}-");
    session_id.len() > prefix.len() && session_id.starts_with(&prefix)
}

/// Gateway run ids look like `run_<alphanumerics>` (measured 0.22.5). The
/// shape is validated before the id ever reaches a URL.
fn valid_run_id(id: &str) -> bool {
    let Some(rest) = id.strip_prefix("run_") else {
        return false;
    };
    !rest.is_empty() && rest.len() <= 60 && rest.bytes().all(|b| b.is_ascii_alphanumeric())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Runs request bodies and whitelisted responses
// ---------------------------------------------------------------------------

/// The `content` parts of the single user message: the text first, then one
/// part per attachment. Voice notes arrive as degraded text notes (D6): the
/// gateway has no audio input.
fn runs_content(turn: &Turn) -> Value {
    let mut parts: Vec<Value> = Vec::with_capacity(turn.attachments.len() + 1);
    if !turn.text.trim().is_empty() {
        parts.push(json!({ "type": "text", "text": turn.text.trim() }));
    }
    for attachment in &turn.attachments {
        parts.push(part_for(attachment));
    }
    if parts.is_empty() {
        parts.push(json!({ "type": "text", "text": "Revisá los archivos adjuntos." }));
    }
    Value::Array(parts)
}

/// `POST /v1/runs` body: exactly the current turn plus this user's scoped
/// session. History stays server-side on Hermes.
fn runs_body(turn: &Turn, scoped_session: &str) -> Value {
    json!({
        "input": [{ "role": "user", "content": runs_content(turn) }],
        "session_id": scoped_session,
    })
}

/// Pick a whitelisted field from either the gateway's snake_case or a
/// camelCase alias; missing stays `null` instead of failing the envelope.
fn runs_field(status: &Value, snake: &str, camel: &str) -> Value {
    status
        .get(snake)
        .or_else(|| status.get(camel))
        .cloned()
        .unwrap_or(Value::Null)
}

/// The exact `GET /api/hermes/runs/{runId}` envelope (camelCase whitelist).
fn status_envelope(run_id: &str, status: &Value) -> Value {
    let session_id = status
        .get("session_id")
        .or_else(|| status.get("sessionId"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let upstream_run = status
        .get("run_id")
        .or_else(|| status.get("runId"))
        .and_then(Value::as_str)
        .unwrap_or(run_id);
    json!({
        "runId": upstream_run,
        "status": runs_field(status, "status", "status"),
        "sessionId": session_id,
        "createdAt": runs_field(status, "created_at", "createdAt"),
        "updatedAt": runs_field(status, "updated_at", "updatedAt"),
        "executionGeneration": runs_field(status, "execution_generation", "executionGeneration"),
        "output": runs_field(status, "output", "output"),
        "usage": runs_field(status, "usage", "usage"),
        "completed": runs_field(status, "completed", "completed"),
        "partial": runs_field(status, "partial", "partial"),
        "interrupted": runs_field(status, "interrupted", "interrupted"),
        "error": runs_field(status, "error", "error"),
        "pendingControls": runs_field(status, "pending_controls", "pendingControls"),
    })
}

/// Reject a run whose reported session is outside this user's namespace. A
/// foreign or missing session is indistinguishable from "no such run".
fn ensure_owned(status: &Value, user_id: Uuid) -> Result<(), Response> {
    let session_id = status
        .get("session_id")
        .or_else(|| status.get("sessionId"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if session_owned(session_id, user_id) {
        Ok(())
    } else {
        Err(error_response(
            StatusCode::NOT_FOUND,
            "HERMES_RUN_NOT_FOUND",
            "run not found",
        ))
    }
}

/// The `POST /api/hermes/runs/{runId}/approval` envelope: the run, the choice
/// the proxy forwarded, and whether the gate settled.
fn approval_envelope(run_id: &str, choice: &str, answered: &Value) -> Value {
    let resolved = answered
        .get("resolved")
        .and_then(Value::as_bool)
        .or_else(|| answered.get("settled").and_then(Value::as_bool))
        .unwrap_or(true);
    json!({ "runId": run_id, "choice": choice, "resolved": resolved })
}

/// The body forwarded to `POST /v1/runs/{id}/approval`: the validated choice
/// plus `request_id`/`execution_generation` copied from the `approval.request`
/// event when the UI saw them (S8).
fn approval_forward(body: &Value, choice: &str) -> Value {
    let mut forward = serde_json::Map::new();
    if let Some(value) = body.get("request_id").or_else(|| body.get("requestId")) {
        forward.insert("request_id".to_string(), value.clone());
    }
    if let Some(value) = body
        .get("execution_generation")
        .or_else(|| body.get("executionGeneration"))
    {
        forward.insert("execution_generation".to_string(), value.clone());
    }
    forward.insert("choice".to_string(), Value::String(choice.to_string()));
    Value::Object(forward)
}

// ---------------------------------------------------------------------------
// Upstream error mapping
// ---------------------------------------------------------------------------

fn upstream_code(body: &Value) -> Option<&str> {
    body.pointer("/code")
        .and_then(Value::as_str)
        .or_else(|| body.pointer("/error/code").and_then(Value::as_str))
}

fn upstream_message<'a>(body: &'a Value) -> Option<&'a str> {
    body.pointer("/message")
        .and_then(Value::as_str)
        .or_else(|| body.pointer("/error/message").and_then(Value::as_str))
        .or_else(|| body.pointer("/error").and_then(Value::as_str))
}

/// Map a non-2xx upstream answer to the proxy envelope, preserving the
/// upstream message when it has one: 401 means our key is wrong (502, the
/// browser cannot fix it), 404/`run_not_found` and 409 keep their meaning so
/// the UI can tell "no such run" from "approval already settled".
fn map_runs_status(status: reqwest::StatusCode, body: &Value) -> Response {
    if status == reqwest::StatusCode::UNAUTHORIZED {
        tracing::warn!("hermes rejected the configured credentials");
        return error_response(
            StatusCode::BAD_GATEWAY,
            "HERMES_UNAUTHORIZED",
            upstream_message(body).unwrap_or("Hermes rejected the configured credentials"),
        );
    }
    if status == reqwest::StatusCode::NOT_FOUND || upstream_code(body) == Some("run_not_found") {
        return error_response(
            StatusCode::NOT_FOUND,
            "HERMES_RUN_NOT_FOUND",
            upstream_message(body).unwrap_or("run not found"),
        );
    }
    if status == reqwest::StatusCode::CONFLICT {
        return error_response(
            StatusCode::CONFLICT,
            "HERMES_APPROVAL_CONFLICT",
            upstream_message(body).unwrap_or("the approval is no longer pending"),
        );
    }
    tracing::warn!(status = status.as_u16(), "hermes returned an error");
    error_response(
        StatusCode::BAD_GATEWAY,
        "HERMES_UPSTREAM_ERROR",
        upstream_message(body).unwrap_or("Hermes returned an error"),
    )
}

/// A request that never got an answer: silence past the budget is 504, a
/// refused/dropped connection is 503.
fn send_error(err: reqwest::Error) -> Response {
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
            StatusCode::SERVICE_UNAVAILABLE,
            "HERMES_UNAVAILABLE",
            "Hermes is unreachable",
        )
    }
}

/// Read an upstream JSON answer, mapping transport failures (but not HTTP
/// statuses: the caller decides those from `status`, with the body kept for
/// the error mapper).
async fn read_json_body(upstream: reqwest::Response) -> Result<Value, Response> {
    let status = upstream.status();
    match upstream.bytes().await {
        Ok(bytes) => {
            if bytes.is_empty() {
                return if status.is_success() {
                    Ok(Value::Null)
                } else {
                    Err(map_runs_status(status, &Value::Null))
                };
            }
            match serde_json::from_slice::<Value>(&bytes) {
                Ok(value) => Ok(value),
                Err(_) => Err(error_response(
                    StatusCode::BAD_GATEWAY,
                    "HERMES_UPSTREAM_ERROR",
                    "Hermes returned an unreadable response",
                )),
            }
        }
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

// ---------------------------------------------------------------------------
// Upstream Runs calls (thin: handlers add auth + ownership, tests fake the
// gateway with an in-process axum router)
// ---------------------------------------------------------------------------

/// `POST {base}/v1/runs` with the Bearer credential, the per-user session key
/// and the scoped session in the body. A 202 becomes the browser envelope
/// `{runId, sessionId, createdAt}` (ms); anything else goes through the
/// error mapper.
pub async fn create_run_upstream(
    cfg: &HermesConfig,
    user_id: Uuid,
    turn: &Turn,
) -> Result<Value, Response> {
    let scoped = scoped_session_id(user_id, &turn.session_id).ok_or_else(|| {
        error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_ERROR",
            "sessionId must be a UUID",
        )
    })?;
    let url = format!("{}/v1/runs", api_base(&cfg.api_url));
    let upstream = cfg
        .http
        .post(url)
        .bearer_auth(&cfg.api_key)
        .header(SESSION_KEY_HEADER, format!("pd-{user_id}"))
        .json(&runs_body(turn, &scoped))
        .send()
        .await
        .map_err(send_error)?;
    let status = upstream.status();
    let value = read_json_body(upstream).await?;
    if !status.is_success() {
        return Err(map_runs_status(status, &value));
    }
    let run_id = value
        .get("run_id")
        .or_else(|| value.get("runId"))
        .and_then(Value::as_str)
        .ok_or_else(|| {
            error_response(
                StatusCode::BAD_GATEWAY,
                "HERMES_UPSTREAM_ERROR",
                "Hermes returned an unreadable response",
            )
        })?;
    let session_id = value
        .get("session_id")
        .or_else(|| value.get("sessionId"))
        .and_then(Value::as_str)
        .unwrap_or(&scoped);
    Ok(json!({ "runId": run_id, "sessionId": session_id, "createdAt": now_ms() }))
}

/// `GET {base}/v1/runs/{run_id}`. The id shape is validated before it reaches
/// a URL; a malformed id is "no such run".
pub async fn run_status_upstream(
    cfg: &HermesConfig,
    run_id: &str,
) -> Result<Value, Response> {
    if !valid_run_id(run_id) {
        return Err(error_response(
            StatusCode::NOT_FOUND,
            "HERMES_RUN_NOT_FOUND",
            "run not found",
        ));
    }
    let url = format!("{}/v1/runs/{run_id}", api_base(&cfg.api_url));
    let upstream = cfg
        .http
        .get(url)
        .bearer_auth(&cfg.api_key)
        .send()
        .await
        .map_err(send_error)?;
    let status = upstream.status();
    let value = read_json_body(upstream).await?;
    if status.is_success() {
        Ok(value)
    } else {
        Err(map_runs_status(status, &value))
    }
}

/// `GET {base}/v1/runs/{run_id}/events` over the stream client (per-read
/// silence budget, no total deadline) with `Accept: text/event-stream`. The
/// handler re-emits the body verbatim.
pub async fn run_events_upstream(
    cfg: &HermesConfig,
    run_id: &str,
) -> Result<reqwest::Response, Response> {
    if !valid_run_id(run_id) {
        return Err(error_response(
            StatusCode::NOT_FOUND,
            "HERMES_RUN_NOT_FOUND",
            "run not found",
        ));
    }
    let url = format!("{}/v1/runs/{run_id}/events", api_base(&cfg.api_url));
    let upstream = cfg
        .stream_http
        .get(url)
        .bearer_auth(&cfg.api_key)
        .header(header::ACCEPT, "text/event-stream")
        .send()
        .await
        .map_err(send_error)?;
    let status = upstream.status();
    if status.is_success() {
        Ok(upstream)
    } else {
        let value = read_json_body(upstream).await?;
        Err(map_runs_status(status, &value))
    }
}

/// `POST {base}/v1/runs/{run_id}/approval` with the already-shaped forward
/// body (`choice` plus `request_id`/`execution_generation` when present).
pub async fn run_approval_upstream(
    cfg: &HermesConfig,
    run_id: &str,
    body: &Value,
) -> Result<Value, Response> {
    if !valid_run_id(run_id) {
        return Err(error_response(
            StatusCode::NOT_FOUND,
            "HERMES_RUN_NOT_FOUND",
            "run not found",
        ));
    }
    let url = format!("{}/v1/runs/{run_id}/approval", api_base(&cfg.api_url));
    let upstream = cfg
        .http
        .post(url)
        .bearer_auth(&cfg.api_key)
        .json(body)
        .send()
        .await
        .map_err(send_error)?;
    let status = upstream.status();
    let value = read_json_body(upstream).await?;
    if status.is_success() {
        Ok(value)
    } else {
        Err(map_runs_status(status, &value))
    }
}

// ---------------------------------------------------------------------------
// Handlers: session auth only (`require_session_user_id`, never API tokens),
// 503 when Hermes is not configured
// ---------------------------------------------------------------------------

/// Resolve the dashboard caller. Production delegates to
/// `require_session_user_id` (Postgres session lookup); the test build
/// accepts `Authorization: Bearer <user-uuid>` without touching a database
/// so handler-level ownership tests can run with a stubbed caller.
#[cfg(not(test))]
async fn authenticate(headers: &HeaderMap, pool: &sqlx::PgPool) -> Result<Uuid, Response> {
    crate::auth::helper::require_session_user_id(headers, pool)
        .await
        .map_err(|err| {
            use axum::response::IntoResponse as _;
            err.into_response()
        })
}

#[cfg(test)]
async fn authenticate(headers: &HeaderMap, _pool: &sqlx::PgPool) -> Result<Uuid, Response> {
    let token = crate::auth::middleware::extract_bearer(headers).ok_or_else(|| {
        error_response(
            StatusCode::UNAUTHORIZED,
            "UNAUTHORIZED",
            "authentication required",
        )
    })?;
    Uuid::parse_str(token.trim()).map_err(|_| {
        error_response(
            StatusCode::UNAUTHORIZED,
            "UNAUTHORIZED",
            "authentication required",
        )
    })
}

#[derive(Debug, Deserialize)]
struct CreateRunJson {
    #[serde(default, rename = "sessionId", alias = "session_id")]
    session_id: Option<String>,
    #[serde(default, alias = "content")]
    message: Option<String>,
}

/// `POST /api/hermes/runs` — start a run from one user turn (JSON
/// `{sessionId, message}` or multipart `sessionId` + `message` + `files`).
/// Answers `202 {runId, sessionId, createdAt}`.
pub async fn create_run_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    request: Request,
) -> Response {
    let user_id = match authenticate(&headers, &state.pool).await {
        Ok(user_id) => user_id,
        Err(err) => return err.into_response(),
    };
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
        let bytes = match axum::body::to_bytes(request.into_body(), MAX_JSON_BYTES).await {
            Ok(bytes) => bytes,
            Err(_) => {
                return error_response(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "PAYLOAD_TOO_LARGE",
                    "the request body exceeds the upload limit",
                )
            }
        };
        let body: CreateRunJson = match serde_json::from_slice(&bytes) {
            Ok(body) => body,
            Err(_) => {
                return error_response(
                    StatusCode::BAD_REQUEST,
                    "INVALID_JSON",
                    "the request body is not valid JSON",
                )
            }
        };
        let message = body.message.unwrap_or_default();
        if message.trim().is_empty() {
            return error_response(
                StatusCode::UNPROCESSABLE_ENTITY,
                "VALIDATION_ERROR",
                "a message is required",
            );
        }
        if message.len() > MAX_CONTENT_BYTES {
            return error_response(
                StatusCode::UNPROCESSABLE_ENTITY,
                "VALIDATION_ERROR",
                "the message content is too long",
            );
        }
        Turn {
            text: message,
            attachments: Vec::new(),
            session_id: body.session_id.unwrap_or_default(),
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

    match create_run_upstream(cfg, user_id, &turn).await {
        Ok(value) => (StatusCode::ACCEPTED, Json(value)).into_response(),
        Err(response) => response,
    }
}

/// `GET /api/hermes/runs/{runId}` — the whitelisted envelope, but only when
/// the run's session belongs to the caller. Foreign or missing runs are 404.
pub async fn run_status_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(run_id): Path<String>,
) -> Response {
    let user_id = match authenticate(&headers, &state.pool).await {
        Ok(user_id) => user_id,
        Err(err) => return err.into_response(),
    };
    let Some(cfg) = state.hermes.as_ref() else {
        return error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "HERMES_NOT_CONFIGURED",
            "Hermes is not configured",
        );
    };
    if !valid_run_id(&run_id) {
        return error_response(
            StatusCode::NOT_FOUND,
            "HERMES_RUN_NOT_FOUND",
            "run not found",
        );
    }
    let status = match run_status_upstream(cfg, &run_id).await {
        Ok(status) => status,
        Err(response) => return response,
    };
    if let Err(response) = ensure_owned(&status, user_id) {
        return response;
    }
    Json(status_envelope(&run_id, &status)).into_response()
}

/// `GET /api/hermes/runs/{runId}/events` — ownership is verified first, then
/// the upstream SSE body streams through byte-for-byte (`id:` lines and `:`
/// comments untouched, never re-framed) with the no-buffering headers.
pub async fn run_events_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(run_id): Path<String>,
) -> Response {
    let user_id = match authenticate(&headers, &state.pool).await {
        Ok(user_id) => user_id,
        Err(err) => return err.into_response(),
    };
    let Some(cfg) = state.hermes.as_ref() else {
        return error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "HERMES_NOT_CONFIGURED",
            "Hermes is not configured",
        );
    };
    if !valid_run_id(&run_id) {
        return error_response(
            StatusCode::NOT_FOUND,
            "HERMES_RUN_NOT_FOUND",
            "run not found",
        );
    }
    // Ownership before opening the stream: a foreign run never reaches the
    // gateway's event endpoint through this proxy.
    let status = match run_status_upstream(cfg, &run_id).await {
        Ok(status) => status,
        Err(response) => return response,
    };
    if let Err(response) = ensure_owned(&status, user_id) {
        return response;
    }
    let upstream = match run_events_upstream(cfg, &run_id).await {
        Ok(upstream) => upstream,
        Err(response) => return response,
    };
    // Verbatim passthrough: dropping the browser body drops `upstream`, so
    // closing the tab cancels the gateway request without a second run.
    let stream = upstream
        .bytes_stream()
        .map(|result| result.map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err)));
    let body = Body::from_stream(stream);
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-store")
        .header("x-accel-buffering", "no")
        .body(body)
        .unwrap_or_else(|_| {
            error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "INTERNAL_ERROR",
                "could not build the response",
            )
        })
}

/// `POST /api/hermes/runs/{runId}/approval` — `{requestId?,
/// executionGeneration?, choice}` with `choice` in
/// `once|deny|session|always`; answers `{runId, choice, resolved}`. Foreign
/// runs are 404, a settled gate is 409.
pub async fn run_approval_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(run_id): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    let user_id = match authenticate(&headers, &state.pool).await {
        Ok(user_id) => user_id,
        Err(err) => return err.into_response(),
    };
    let Some(cfg) = state.hermes.as_ref() else {
        return error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "HERMES_NOT_CONFIGURED",
            "Hermes is not configured",
        );
    };
    if !valid_run_id(&run_id) {
        return error_response(
            StatusCode::NOT_FOUND,
            "HERMES_RUN_NOT_FOUND",
            "run not found",
        );
    }
    let status = match run_status_upstream(cfg, &run_id).await {
        Ok(status) => status,
        Err(response) => return response,
    };
    if let Err(response) = ensure_owned(&status, user_id) {
        return response;
    }
    let choice = body.get("choice").and_then(Value::as_str).unwrap_or("");
    if !matches!(choice, "once" | "deny" | "session" | "always") {
        return error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_ERROR",
            "choice must be one of once, deny, session, always",
        );
    }
    let answered = match run_approval_upstream(cfg, &run_id, &approval_forward(&body, choice)).await
    {
        Ok(answered) => answered,
        Err(response) => return response,
    };
    Json(approval_envelope(&run_id, choice, &answered)).into_response()
}

#[cfg(test)]
mod tests {
    use std::{
        net::{Ipv4Addr, SocketAddr},
        sync::{Arc, Mutex},
        time::Duration,
    };

    use axum::{
        extract::{DefaultBodyLimit, State},
        routing::{get, post},
        Router,
    };
    use serde_json::Value;

    use super::*;

    fn cfg(api_url: String, timeout_ms: u64) -> HermesConfig {
        HermesConfig {
            api_url,
            api_key: "upstream-secret".into(),
            timeout_ms,
            http: reqwest::Client::builder()
                .timeout(Duration::from_millis(timeout_ms))
                .build()
                .expect("test client"),
            stream_http: reqwest::Client::builder()
                .read_timeout(Duration::from_millis(timeout_ms))
                .build()
                .expect("test stream client"),
        }
    }

    /// Spawn a fake Hermes gateway; returns its root URL (the proxy derives
    /// `/v1/*` paths from it via [`api_base`]).
    async fn spawn(app: Router) -> String {
        let listener = tokio::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
            .await
            .expect("bind fake upstream");
        let addr = listener.local_addr().expect("fake upstream addr");
        tokio::spawn(async move {
            axum::serve(listener, app).await.expect("serve fake upstream");
        });
        format!("http://{addr}")
    }

    fn user_id(seed: u8) -> Uuid {
        Uuid::parse_str(&format!("11111111-2222-4333-8444-5555555555{seed:02x}"))
            .expect("fixed test uuid")
    }

    fn client_session() -> String {
        "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee".to_string()
    }

    fn turn(text: &str) -> Turn {
        Turn {
            text: text.into(),
            attachments: Vec::new(),
            session_id: client_session(),
        }
    }

    fn attachment(filename: &str, mime: &str, bytes: &[u8]) -> Attachment {
        Attachment {
            filename: filename.into(),
            mime: mime.into(),
            bytes: bytes.to_vec(),
            size: bytes.len() as u64,
            truncated: false,
        }
    }

    // -----------------------------------------------------------------
    // Addressing
    // -----------------------------------------------------------------

    #[test]
    fn api_base_accepts_a_bare_host_and_a_chat_completions_url() {
        assert_eq!(api_base("http://host:8642"), "http://host:8642");
        assert_eq!(
            api_base("http://host:8642/v1/chat/completions"),
            "http://host:8642"
        );
    }

    #[test]
    fn api_base_strips_other_v1_paths_and_keeps_prefixes() {
        assert_eq!(api_base("http://host:8642/"), "http://host:8642");
        assert_eq!(
            api_base("http://host:8642/v1/chat/completions/"),
            "http://host:8642"
        );
        assert_eq!(api_base("http://host:8642/v1"), "http://host:8642");
        assert_eq!(
            api_base("http://host:8642/v1/runs"),
            "http://host:8642"
        );
        // A reverse-proxy prefix without a /v1 segment survives verbatim.
        assert_eq!(
            api_base("http://host:8642/prefix"),
            "http://host:8642/prefix"
        );
    }

    #[test]
    fn scoped_session_id_accepts_only_uuids() {
        let user = user_id(0x01);
        assert_eq!(
            scoped_session_id(user, &client_session()),
            Some(format!("pd-{user}-{}", client_session()))
        );
        for bad in ["", "not-a-uuid", "pd-1-2", "12345", &"x".repeat(200)] {
            assert_eq!(scoped_session_id(user, bad), None, "reject {bad:?}");
        }
    }

    #[test]
    fn session_owned_matches_the_user_namespace() {
        let user = user_id(0x02);
        let other = user_id(0x03);
        let own = format!("pd-{user}-{}", client_session());
        assert!(session_owned(&own, user));
        assert!(!session_owned(&format!("pd-{other}-{}", client_session()), user));
        assert!(!session_owned("", user));
        assert!(!session_owned(&format!("pd-{user}-"), user));
        assert!(!session_owned("pd-", user));
    }

    #[test]
    fn valid_run_id_checks_the_gateway_shape() {
        assert!(valid_run_id("run_abc123"));
        assert!(valid_run_id("run_AZ09"));
        assert!(valid_run_id(&format!("run_{}", "a".repeat(60))));
        assert!(!valid_run_id("run_"));
        assert!(!valid_run_id("run_a b"));
        assert!(!valid_run_id("run_a-b"));
        assert!(!valid_run_id("foo"));
        assert!(!valid_run_id(""));
        assert!(!valid_run_id(&format!("run_{}", "a".repeat(61))));
    }

    // -----------------------------------------------------------------
    // Attachment parts and the runs body
    // -----------------------------------------------------------------

    #[test]
    fn runs_content_carries_text_first_then_attachment_parts() {
        let mut t = turn("mirá esto");
        t.attachments
            .push(attachment("foto.png", "image/png", &[0x89, 0x50, 0x4e, 0x47]));
        t.attachments
            .push(attachment("notas.md", "text/markdown", b"# hola"));
        let parts = runs_content(&t).as_array().expect("parts").clone();
        assert_eq!(parts[0], json!({"type": "text", "text": "mirá esto"}));
        assert_eq!(parts[1]["type"], "image_url");
        assert!(parts[1]["image_url"]["url"]
            .as_str()
            .expect("data url")
            .starts_with("data:image/png;base64,"));
        assert!(parts[2]["text"].as_str().expect("inline").contains("--- inicio ---"));

        let body = runs_body(&t, "pd-user-session");
        assert_eq!(
            body["input"][0],
            json!({"role": "user", "content": parts})
        );
        assert_eq!(body["session_id"], "pd-user-session");
    }

    #[test]
    fn audio_is_degraded_to_a_note_never_to_an_audio_part() {
        let mut t = turn("escuchá");
        t.attachments
            .push(attachment("nota.webm", "audio/webm", b"webm-bytes"));
        let body = runs_body(&t, "pd-user-session");
        let serialized = body.to_string();
        assert!(!serialized.contains("input_audio"), "{serialized}");
        assert!(serialized.contains("Nota de voz adjunta"), "{serialized}");
        assert!(serialized.contains("nota.webm"), "{serialized}");
    }

    #[test]
    fn text_files_are_inlined_and_truncated() {
        let big = "a".repeat(MAX_INLINE_TEXT_BYTES + 10);
        let part = inline_text(&attachment("notas.md", "text/markdown", big.as_bytes()))
            .expect("text inline");
        assert!(part.contains("Archivo adjunto: notas.md (text/markdown) [truncado]"));
        assert!(part.contains("--- inicio ---"));
        assert!(part.len() < big.len() + 200);
    }

    #[test]
    fn binary_attachments_become_an_honest_descriptor() {
        let part = part_for(&attachment("datos.zip", "application/zip", &[1, 2, 3]));
        assert_eq!(part["type"], "text");
        let text = part["text"].as_str().expect("text");
        assert!(text.contains("datos.zip"));
        assert!(text.contains("no puede leer el contenido binario"));
    }

    #[test]
    fn content_type_and_limits_are_wired() {
        assert_eq!(MAX_ATTACHMENTS, 20);
        assert!(is_text_like("text/plain", "nota.weird"));
        assert!(is_text_like("application/octet-stream", "main.rs"));
        assert!(!is_text_like("application/zip", "datos.zip"));
    }

    // -----------------------------------------------------------------
    // Multipart parsing (sessionId is a field; unknown fields stay ignored)
    // -----------------------------------------------------------------

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
    async fn multipart_message_session_and_files_are_parsed() {
        let session = client_session();
        let turn = parse_body(vec![
            part_text("sessionId", &session),
            part_text("message", "mirá estos archivos"),
            part_file("files", "foto.png", "image/png", &[0x89, 0x50]),
            part_file("files", "nota.md", "text/markdown", b"# hola"),
        ])
        .await
        .expect("parsed turn");

        assert_eq!(turn.text, "mirá estos archivos");
        assert_eq!(turn.session_id, session);
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

    /// Owner spec S2: no byte ceiling. A 12 MiB non-image attachment is
    /// accepted, counted and discarded without ever being buffered, and the
    /// turn still carries only its descriptor.
    #[tokio::test]
    async fn multipart_accepts_an_attachment_over_the_old_limit() {
        use tower::ServiceExt;

        let app = Router::new()
            .route(
                "/",
                post(|multipart: Multipart| async {
                    match parse_multipart(multipart).await {
                        Ok(turn) => {
                            let attachment = &turn.attachments[0];
                            assert_eq!(attachment.size, 12 * 1024 * 1024);
                            assert!(attachment.bytes.is_empty(), "bytes must not be buffered");
                            StatusCode::OK
                        }
                        Err(response) => response.status(),
                    }
                }),
            )
            .layer(DefaultBodyLimit::disable());

        let big = vec![0u8; 12 * 1024 * 1024];
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
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn a_huge_text_file_is_truncated_not_buffered() {
        use tower::ServiceExt;

        let app = Router::new()
            .route(
                "/",
                post(|multipart: Multipart| async {
                    match parse_multipart(multipart).await {
                        Ok(turn) => {
                            let attachment = &turn.attachments[0];
                            assert_eq!(attachment.size, 12 * 1024 * 1024);
                            assert!(attachment.bytes.len() <= MAX_INLINE_TEXT_BYTES);
                            assert!(attachment.truncated);
                            StatusCode::OK
                        }
                        Err(response) => response.status(),
                    }
                }),
            )
            .layer(DefaultBodyLimit::disable());

        let big = vec![b'x'; 12 * 1024 * 1024];
        let mut body = part_file("files", "grande.log", "text/plain", &big);
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
        assert_eq!(response.status(), StatusCode::OK);
    }

    // -----------------------------------------------------------------
    // Fake-upstream integration: create / status / approval / events
    // -----------------------------------------------------------------

    #[derive(Clone, Default)]
    struct Seen(Arc<Mutex<Vec<SeenRequest>>>);

    struct SeenRequest {
        authorization: Option<String>,
        session_key: Option<String>,
        body: Value,
    }

    async fn runs_create(
        State(seen): State<Seen>,
        headers: HeaderMap,
        Json(body): Json<Value>,
    ) -> Response {
        seen.0.lock().expect("seen lock").push(SeenRequest {
            authorization: headers
                .get(header::AUTHORIZATION)
                .and_then(|v| v.to_str().ok())
                .map(str::to_string),
            session_key: headers
                .get(SESSION_KEY_HEADER)
                .and_then(|v| v.to_str().ok())
                .map(str::to_string),
            body,
        });
        (
            StatusCode::ACCEPTED,
            Json(json!({"run_id": "run_abc123", "status": "started", "replayed": false})),
        )
            .into_response()
    }

    #[tokio::test]
    async fn create_maps_202_and_sends_bearer_session_key_and_scoped_session() {
        let seen = Seen::default();
        let app = Router::new()
            .route("/v1/runs", post(runs_create))
            .with_state(seen.clone());
        let base = spawn(app).await;
        // The configured URL may still be the legacy chat endpoint: the
        // proxy must derive the runs path from it.
        let url = format!("{base}/v1/chat/completions");

        let user = user_id(0x10);
        let value = create_run_upstream(&cfg(url, 5_000), user, &turn("¿qué tal?"))
            .await
            .expect("upstream success");
        let scoped = format!("pd-{user}-{}", client_session());
        assert_eq!(value["runId"], "run_abc123");
        assert_eq!(value["sessionId"], scoped);
        assert!(value["createdAt"].as_u64().expect("createdAt ms") > 0);

        let calls = seen.0.lock().expect("seen lock");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].authorization.as_deref(), Some("Bearer upstream-secret"));
        assert_eq!(calls[0].session_key.as_deref(), Some(format!("pd-{user}").as_str()));
        assert_eq!(calls[0].body["session_id"], scoped);
        assert_eq!(
            calls[0].body["input"][0]["content"][0],
            json!({"type": "text", "text": "¿qué tal?"}),
            "the proxy forwards exactly the current user turn"
        );
    }

    #[tokio::test]
    async fn create_rejects_a_non_uuid_session_before_touching_the_network() {
        let user = user_id(0x11);
        let mut bad = turn("hola");
        bad.session_id = "free-text-session".into();
        let response = create_run_upstream(
            &cfg("http://127.0.0.1:1".into(), 300),
            user,
            &bad,
        )
        .await
        .expect_err("non-UUID session is a 422");
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn status_rejects_a_foreign_session_as_404() {
        let user = user_id(0x20);
        let other = user_id(0x21);
        let app = Router::new().route(
            "/v1/runs/run_foreign1",
            get(move || async move {
                Json(json!({
                    "run_id": "run_foreign1",
                    "status": "running",
                    "session_id": format!("pd-{other}-{}", client_session()),
                    "created_at": 1,
                }))
            }),
        );
        let base = spawn(app).await;

        let value = run_status_upstream(&cfg(base, 5_000), "run_foreign1")
            .await
            .expect("the gateway answers");
        let response = ensure_owned(&value, user).expect_err("foreign session is 404");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let body = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .expect("error body");
        assert!(String::from_utf8_lossy(&body).contains("HERMES_RUN_NOT_FOUND"));

        // The caller's own session passes and yields exactly the whitelist.
        let own = json!({
            "run_id": "run_mine1",
            "status": "running",
            "session_id": format!("pd-{user}-{}", client_session()),
            "created_at": 10,
            "updated_at": 11,
            "execution_generation": 2,
            "output": "hola",
            "usage": {"tokens": 3},
            "completed": false,
            "partial": true,
            "interrupted": false,
            "error": null,
            "pending_controls": [{"kind": "approval"}],
            "replayed": true,
            "internal_debug": "must not leak",
        });
        ensure_owned(&own, user).expect("own session passes");
        let envelope = status_envelope("run_mine1", &own);
        let mut keys: Vec<&str> = envelope
            .as_object()
            .expect("object")
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "completed",
                "createdAt",
                "error",
                "executionGeneration",
                "interrupted",
                "output",
                "partial",
                "pendingControls",
                "runId",
                "sessionId",
                "status",
                "updatedAt",
                "usage",
            ]
        );
        assert_eq!(envelope["runId"], "run_mine1");
        assert_eq!(envelope["executionGeneration"], 2);
        assert_eq!(envelope["pendingControls"], json!([{"kind": "approval"}]));
        assert!(envelope.get("replayed").is_none());
        assert!(envelope.get("internal_debug").is_none());
    }

    #[derive(Clone, Default)]
    struct ApprovalSeen(Arc<Mutex<Vec<Value>>>);

    #[tokio::test]
    async fn approval_forwards_ids_and_maps_conflict_to_409() {
        let seen = ApprovalSeen::default();
        let app = Router::new()
            .route(
                "/v1/runs/{id}/approval",
                post(|State(seen): State<ApprovalSeen>, Json(body): Json<Value>| async move {
                    seen.0.lock().expect("calls").push(body);
                    (
                        StatusCode::CONFLICT,
                        Json(json!({"code": "approval_conflict", "message": "already settled"})),
                    )
                        .into_response()
                }),
            )
            .route(
                "/v1/runs/run_ok1",
                get(|| async {
                    Json(json!({
                        "run_id": "run_ok1",
                        "status": "waiting",
                        "session_id": "SESSION",
                    }))
                }),
            )
            .with_state(seen.clone());
        let base = spawn(app).await;

        let user = user_id(0x30);
        let forward = approval_forward(
            &json!({"requestId": "9f82", "executionGeneration": 1, "choice": "once", "extra": true}),
            "once",
        );
        assert_eq!(
            forward,
            json!({"request_id": "9f82", "execution_generation": 1, "choice": "once"}),
            "only the gateway fields travel, renamed to snake_case"
        );
        let response = run_approval_upstream(&cfg(base.clone(), 5_000), "run_bad1", &forward)
            .await
            .expect_err("settled gate is a 409");
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let body = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .expect("error body");
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("HERMES_APPROVAL_CONFLICT"), "{text}");

        let calls = seen.0.lock().expect("seen lock");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0], forward);

        // A settled answer maps to the browser envelope.
        let envelope = approval_envelope("run_ok1", "deny", &json!({"resolved": false}));
        assert_eq!(envelope, json!({"runId": "run_ok1", "choice": "deny", "resolved": false}));
        let _ = (user, base);
    }

    #[tokio::test]
    async fn events_stream_passes_frames_through_verbatim() {
        const FRAMES: &str = concat!(
            ": open\n",
            "\n",
            "id: 1\n",
            "data: {\"event\":\"message.delta\",\"run_id\":\"run_ev1\",\"delta\":\"hola\"}\n",
            "\n",
            ": keepalive\n",
            "\n",
            "id: 2\n",
            "data: {\"event\":\"run.completed\",\"run_id\":\"run_ev1\"}\n",
            "\n",
        );
        let app = Router::new().route(
            "/v1/runs/run_ev1/events",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "text/event-stream")],
                    FRAMES,
                )
                    .into_response()
            }),
        );
        let base = spawn(app).await;

        let upstream = run_events_upstream(&cfg(base, 5_000), "run_ev1")
            .await
            .expect("events open");
        assert_eq!(upstream.status(), reqwest::StatusCode::OK);
        let bytes = upstream
            .bytes()
            .await
            .expect("event bytes")
            .to_vec();
        assert_eq!(
            bytes, FRAMES.as_bytes(),
            "comments, id: lines and framing pass through untouched"
        );
    }

    // -----------------------------------------------------------------
    // Error mapping
    // -----------------------------------------------------------------

    #[tokio::test]
    async fn maps_upstream_unauthorized_to_502_without_leaking_the_key() {
        let app = Router::new().route(
            "/v1/runs",
            post(|| async { StatusCode::UNAUTHORIZED }),
        );
        let base = spawn(app).await;
        let response = create_run_upstream(&cfg(base, 5_000), user_id(0x40), &turn("hola"))
            .await
            .expect_err("401 maps to an error response");
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        let body = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .expect("error body");
        let text = String::from_utf8(body.to_vec()).expect("utf8");
        assert!(text.contains("HERMES_UNAUTHORIZED"));
        assert!(!text.contains("upstream-secret"));
    }

    #[tokio::test]
    async fn maps_upstream_error_shapes() {
        // 404 with a run_not_found code.
        let app = Router::new().route(
            "/v1/runs/{id}",
            get(|| async {
                (
                    StatusCode::NOT_FOUND,
                    Json(json!({"code": "run_not_found", "message": "no such run"})),
                )
                    .into_response()
            }),
        );
        let base = spawn(app).await;
        let response = run_status_upstream(&cfg(base, 5_000), "run_missing1")
            .await
            .expect_err("404 maps to HERMES_RUN_NOT_FOUND");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);

        // Plain 500.
        let app = Router::new().route(
            "/v1/runs/{id}",
            get(|| async { StatusCode::INTERNAL_SERVER_ERROR }),
        );
        let base = spawn(app).await;
        let response = run_status_upstream(&cfg(base, 5_000), "run_err1")
            .await
            .expect_err("5xx maps to an error response");
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        let body = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .expect("error body");
        assert!(String::from_utf8_lossy(&body).contains("HERMES_UPSTREAM_ERROR"));
    }

    #[tokio::test]
    async fn maps_the_outbound_timeout_to_504() {
        let app = Router::new().route(
            "/v1/runs",
            post(|| async {
                tokio::time::sleep(Duration::from_millis(400)).await;
                Json(json!({"run_id": "run_late"}))
            }),
        );
        let base = spawn(app).await;
        let response = create_run_upstream(&cfg(base, 80), user_id(0x41), &turn("hola"))
            .await
            .expect_err("timeout maps to an error response");
        assert_eq!(response.status(), StatusCode::GATEWAY_TIMEOUT);
        let body = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .expect("error body");
        assert!(String::from_utf8_lossy(&body).contains("HERMES_TIMEOUT"));
    }

    #[tokio::test]
    async fn unreachable_upstream_maps_to_503() {
        let response = create_run_upstream(
            &cfg("http://127.0.0.1:1".into(), 300),
            user_id(0x42),
            &turn("hola"),
        )
        .await
        .expect_err("connection failure maps to an error response");
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .expect("error body");
        assert!(String::from_utf8_lossy(&body).contains("HERMES_UNAVAILABLE"));
    }

    // -----------------------------------------------------------------
    // Handler auth (no session header: 401 before any I/O, no DB touched)
    // -----------------------------------------------------------------

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
    async fn handlers_require_an_authenticated_dashboard_session() {
        let response = create_run_handler(
            State(lazy_state()),
            HeaderMap::new(),
            json_request(r#"{"sessionId":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee","message":"hola"}"#),
        )
        .await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

        let response = run_status_handler(
            State(lazy_state()),
            HeaderMap::new(),
            Path("run_abc123".to_string()),
        )
        .await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

        let response = run_events_handler(
            State(lazy_state()),
            HeaderMap::new(),
            Path("run_abc123".to_string()),
        )
        .await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

        let response = run_approval_handler(
            State(lazy_state()),
            HeaderMap::new(),
            Path("run_abc123".to_string()),
            Json(json!({"choice": "once"})),
        )
        .await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn auth_runs_before_content_type_checks() {
        let mut state = lazy_state();
        state.hermes = Some(cfg("http://127.0.0.1:1".into(), 300));
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_TYPE,
            "text/plain".parse().expect("content type"),
        );
        let response = create_run_handler(
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

    // -----------------------------------------------------------------
    // Handler ownership (JD-B-006): a foreign run is 404 before the
    // upstream stream/approval endpoint is ever opened. Each test pins
    // the handler itself (stubbed `Bearer <user-uuid>` caller, reachable
    // fake upstream) and asserts the endpoint counter, not just the
    // status, so deleting `ensure_owned` from the handler fails the suite.
    // -----------------------------------------------------------------

    fn bearer_headers(user: Uuid) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            format!("Bearer {user}").parse().expect("bearer header"),
        );
        headers
    }

    fn handler_state(base: &str) -> AppState {
        let mut state = lazy_state();
        state.hermes = Some(cfg(base.to_string(), 5_000));
        state
    }

    #[tokio::test]
    async fn events_handler_rejects_foreign_run_without_opening_the_stream() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let owner = user_id(0x50);
        let caller = user_id(0x51);
        let foreign_session = format!("pd-{owner}-{}", client_session());
        let events_hits = Arc::new(AtomicUsize::new(0));
        let events_hits_route = events_hits.clone();
        let app = Router::new()
            .route(
                "/v1/runs/{id}",
                get(move || {
                    let foreign_session = foreign_session.clone();
                    async move {
                        Json(json!({
                            "run_id": "run_foreignA",
                            "status": "running",
                            "session_id": foreign_session,
                        }))
                    }
                }),
            )
            .route(
                "/v1/runs/{id}/events",
                get(move || {
                    let events_hits_route = events_hits_route.clone();
                    async move {
                        events_hits_route.fetch_add(1, Ordering::SeqCst);
                        "data: {\"event\":\"message.delta\"}\n\n"
                    }
                }),
            );
        let base = spawn(app).await;

        let response = run_events_handler(
            State(handler_state(&base)),
            bearer_headers(caller),
            Path("run_foreignA".to_string()),
        )
        .await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let body = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .expect("error body");
        assert!(
            String::from_utf8_lossy(&body).contains("HERMES_RUN_NOT_FOUND"),
            "foreign run must be indistinguishable from missing"
        );
        assert_eq!(
            events_hits.load(Ordering::SeqCst),
            0,
            "the upstream event stream must never be opened for a foreign run"
        );
    }

    #[tokio::test]
    async fn events_handler_reaches_upstream_for_owner_run() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let caller = user_id(0x52);
        let own_session = format!("pd-{caller}-{}", client_session());
        let events_hits = Arc::new(AtomicUsize::new(0));
        let events_hits_route = events_hits.clone();
        let app = Router::new()
            .route(
                "/v1/runs/{id}",
                get(move || {
                    let own_session = own_session.clone();
                    async move {
                        Json(json!({
                            "run_id": "run_ownedA",
                            "status": "running",
                            "session_id": own_session,
                        }))
                    }
                }),
            )
            .route(
                "/v1/runs/{id}/events",
                get(move || {
                    let events_hits_route = events_hits_route.clone();
                    async move {
                        events_hits_route.fetch_add(1, Ordering::SeqCst);
                        (
                            [(header::CONTENT_TYPE, "text/event-stream")],
                            "data: {\"event\":\"message.delta\"}\n\n",
                        )
                            .into_response()
                    }
                }),
            );
        let base = spawn(app).await;

        let response = run_events_handler(
            State(handler_state(&base)),
            bearer_headers(caller),
            Path("run_ownedA".to_string()),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            events_hits.load(Ordering::SeqCst),
            1,
            "the owner's stream must reach the upstream exactly once"
        );
    }

    #[tokio::test]
    async fn approval_handler_rejects_foreign_run_without_calling_upstream() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let owner = user_id(0x53);
        let caller = user_id(0x54);
        let foreign_session = format!("pd-{owner}-{}", client_session());
        let approval_hits = Arc::new(AtomicUsize::new(0));
        let approval_hits_route = approval_hits.clone();
        let app = Router::new()
            .route(
                "/v1/runs/{id}",
                get(move || {
                    let foreign_session = foreign_session.clone();
                    async move {
                        Json(json!({
                            "run_id": "run_foreignB",
                            "status": "waiting",
                            "session_id": foreign_session,
                        }))
                    }
                }),
            )
            .route(
                "/v1/runs/{id}/approval",
                post(move |Json(_): Json<Value>| {
                    let approval_hits_route = approval_hits_route.clone();
                    async move {
                        approval_hits_route.fetch_add(1, Ordering::SeqCst);
                        Json(json!({"resolved": true})).into_response()
                    }
                }),
            );
        let base = spawn(app).await;

        let response = run_approval_handler(
            State(handler_state(&base)),
            bearer_headers(caller),
            Path("run_foreignB".to_string()),
            Json(json!({"choice": "once"})),
        )
        .await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let body = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .expect("error body");
        assert!(
            String::from_utf8_lossy(&body).contains("HERMES_RUN_NOT_FOUND"),
            "foreign run must be indistinguishable from missing"
        );
        assert_eq!(
            approval_hits.load(Ordering::SeqCst),
            0,
            "the upstream approval endpoint must never be called for a foreign run"
        );
    }

    #[tokio::test]
    async fn approval_handler_reaches_upstream_for_owner_run() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let caller = user_id(0x55);
        let own_session = format!("pd-{caller}-{}", client_session());
        let approval_hits = Arc::new(AtomicUsize::new(0));
        let approval_hits_route = approval_hits.clone();
        let app = Router::new()
            .route(
                "/v1/runs/{id}",
                get(move || {
                    let own_session = own_session.clone();
                    async move {
                        Json(json!({
                            "run_id": "run_ownedB",
                            "status": "waiting",
                            "session_id": own_session,
                        }))
                    }
                }),
            )
            .route(
                "/v1/runs/{id}/approval",
                post(move |Json(_): Json<Value>| {
                    let approval_hits_route = approval_hits_route.clone();
                    async move {
                        approval_hits_route.fetch_add(1, Ordering::SeqCst);
                        Json(json!({"resolved": true})).into_response()
                    }
                }),
            );
        let base = spawn(app).await;

        let response = run_approval_handler(
            State(handler_state(&base)),
            bearer_headers(caller),
            Path("run_ownedB".to_string()),
            Json(json!({"choice": "once"})),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .expect("response body");
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("\"resolved\":true"), "{text}");
        assert_eq!(
            approval_hits.load(Ordering::SeqCst),
            1,
            "the owner's approval must reach the upstream exactly once"
        );
    }

    /// Live contract check against the real gateway. Outside the CI suite on
    /// purpose: it needs the production credential and starts a real run.
    ///
    /// ```text
    /// cd backend && set -a && . ../.env && set +a && \
    ///   cargo test --bin personal-dashboard-backend live_runs_gateway \
    ///   -- --ignored --nocapture
    /// ```
    #[tokio::test]
    #[ignore = "requires the real Hermes gateway"]
    async fn live_runs_gateway_round_trip() {
        let endpoint = std::env::var("HERMES_API_URL").expect("HERMES_API_URL");
        let credential = std::env::var("HERMES_API_KEY").expect("HERMES_API_KEY");
        let gateway = HermesConfig {
            api_url: endpoint,
            api_key: credential,
            timeout_ms: 120_000,
            http: reqwest::Client::builder()
                .timeout(Duration::from_millis(120_000))
                .build()
                .expect("live client"),
            stream_http: reqwest::Client::builder()
                .read_timeout(Duration::from_millis(120_000))
                .build()
                .expect("live stream client"),
        };
        let user = Uuid::new_v4();
        let turn = Turn {
            text: "Responde unicamente: ok".into(),
            attachments: Vec::new(),
            session_id: Uuid::new_v4().to_string(),
        };

        let created = create_run_upstream(&gateway, user, &turn)
            .await
            .expect("create run");
        let run_id = created["runId"].as_str().expect("runId").to_string();
        assert!(valid_run_id(&run_id), "gateway run id shape: {run_id}");
        let session = created["sessionId"].as_str().expect("sessionId").to_string();
        assert!(
            session_owned(&session, user),
            "the proxy must scope the session: {session}"
        );

        // The ownership guard is only sound if the gateway echoes that session
        // back on the run status; otherwise every run would 404.
        let status = run_status_upstream(&gateway, &run_id)
            .await
            .expect("status");
        assert_eq!(
            status.get("session_id").and_then(Value::as_str),
            Some(session.as_str()),
            "GET /v1/runs must report the scoped session: {status}"
        );

        // Subscribe late on purpose: the gateway replays the run backlog, which
        // is exactly what a page refresh relies on (S5).
        let upstream = run_events_upstream(&gateway, &run_id)
            .await
            .expect("events");
        let mut stream = upstream.bytes_stream();
        let mut raw = String::new();
        while let Some(chunk) = stream.next().await {
            raw.push_str(&String::from_utf8_lossy(&chunk.expect("stream chunk")));
            if raw.contains("run.completed") || raw.contains("run.failed") {
                break;
            }
        }
        assert!(raw.contains("id: "), "SSE ids must reach the browser: {raw}");
        assert!(raw.contains("data: "), "SSE data must reach the browser: {raw}");
        assert!(
            raw.contains("\"event\": \"message.delta\""),
            "live deltas expected: {raw}"
        );
        assert!(raw.contains("run.completed"), "live terminal event: {raw}");
    }

    /// Live approval round-trip (S7/S8): a dangerous command parks the run, the
    /// proxy answers `deny` with the event's own identity, and the run resumes.
    /// Denying keeps the probe harmless: the command never executes.
    #[tokio::test]
    #[ignore = "requires the real Hermes gateway"]
    async fn live_runs_approval_round_trip() {
        let endpoint = std::env::var("HERMES_API_URL").expect("HERMES_API_URL");
        let credential = std::env::var("HERMES_API_KEY").expect("HERMES_API_KEY");
        let gateway = HermesConfig {
            api_url: endpoint,
            api_key: credential,
            timeout_ms: 120_000,
            http: reqwest::Client::builder()
                .timeout(Duration::from_millis(120_000))
                .build()
                .expect("live client"),
            stream_http: reqwest::Client::builder()
                .read_timeout(Duration::from_millis(120_000))
                .build()
                .expect("live stream client"),
        };
        let user = Uuid::new_v4();
        let turn = Turn {
            text: "Ejecuta exactamente: rm -rf /tmp/hermes-approval-probe-dir".into(),
            attachments: Vec::new(),
            session_id: Uuid::new_v4().to_string(),
        };
        let created = create_run_upstream(&gateway, user, &turn)
            .await
            .expect("create run");
        let run_id = created["runId"].as_str().expect("runId").to_string();

        let upstream = run_events_upstream(&gateway, &run_id)
            .await
            .expect("events");
        let mut stream = upstream.bytes_stream();
        let mut buffer = String::new();
        let mut approval: Option<Value> = None;
        while let Some(chunk) = stream.next().await {
            buffer.push_str(&String::from_utf8_lossy(&chunk.expect("stream chunk")));
            for line in buffer.lines() {
                let Some(payload) = line.strip_prefix("data: ") else {
                    continue;
                };
                let Ok(event) = serde_json::from_str::<Value>(payload) else {
                    continue;
                };
                if event.get("event").and_then(Value::as_str) == Some("approval.request") {
                    approval = Some(event);
                }
            }
            if approval.is_some() {
                break;
            }
        }
        drop(stream);
        let approval = approval.expect("a dangerous command must park the run");
        assert!(
            approval.get("command").and_then(Value::as_str).is_some(),
            "the card needs the exact command: {approval}"
        );
        let prompt_id = approval["prompt_id"].as_str().expect("prompt_id");
        let generation = approval["execution_generation"].clone();

        let forward = approval_forward(
            &json!({"requestId": prompt_id, "executionGeneration": generation}),
            "deny",
        );
        let answered = run_approval_upstream(&gateway, &run_id, &forward)
            .await
            .expect("the proxy must resolve the pending approval");
        // 0.22.5 answers `{run_id, status: "resolved", prompt_id}`: a 2xx is the
        // decision, so the envelope reports `resolved: true` locally.
        assert_eq!(answered["status"].as_str(), Some("resolved"), "{answered}");
        assert_eq!(answered["prompt_id"].as_str(), Some(prompt_id));

        // The run resumes on its own after the decision (S8).
        let resumed = run_events_upstream(&gateway, &run_id)
            .await
            .expect("resumed events");
        let mut stream = resumed.bytes_stream();
        let mut tail = String::new();
        while let Some(chunk) = stream.next().await {
            tail.push_str(&String::from_utf8_lossy(&chunk.expect("stream chunk")));
            if tail.contains("run.completed") || tail.contains("run.failed") {
                break;
            }
        }
        assert!(
            tail.contains("approval.responded") || tail.contains("run.completed"),
            "the run must resume after the decision: {tail}"
        );
    }
}
