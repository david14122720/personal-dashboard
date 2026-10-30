//! Uploads for the Hermes chat input and read-back of the user's own files.
//!
//! Owner spec S4 (`odd/tasks/hermes-entrada-multimodal.md`): the browser posts
//! one file per request, the server validates the extension **and** the real
//! content, stores the bytes under `<HERMES_UPLOAD_DIR>/<uuid>.<ext>` and
//! answers exactly `{ id, name, mime_type, size, url, local_path }`.
//!
//! `GET /api/uploads/{id}` is the read side declared as deviating D-B2: it
//! serves a stored attachment back so the transcript can repaint an
//! image or a video after a reload. It is authenticated input, never Hermes
//! output — S2 forbids serving deliverables, not the files the user attached.
//!
//! Validation never trusts the client's part header. The magic bytes decide
//! the real type (`sniff`), the extension decides the policy (limit, MIME and
//! family), and a mismatch is a 400. `.exe`, `.sh` and every extension outside
//! the allowlist never reach disk.
//!
//! Bytes stream chunk by chunk into a `.partial-<uuid>.<ext>` file; the final
//! name only appears after the last chunk has been validated and renamed. A
//! partial file left by a dropped connection is removed by
//! [`sweep_partial_uploads`] on the next start.

use std::{
    path::{Path, PathBuf},
    sync::OnceLock,
};

use axum::{
    body::Body,
    extract::{
        multipart::{Field, Multipart},
        Extension, Path as AxumPath, State,
    },
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio_util::io::ReaderStream;
use uuid::Uuid;

/// `POST /api/uploads` — one file per request (declared deviation D-B1).
pub const UPLOAD_ROUTE: &str = "/api/uploads";
/// `GET /api/uploads/{id}` — serves a stored attachment to an authenticated
/// session (JD-B-003: the upload is not bound to its owner; this is a
/// single-owner deployment concern, recorded in the feature document).
pub const SERVE_ROUTE: &str = "/api/uploads/{id}";

/// Persistent volume the agent can read (`HERMES_UPLOAD_DIR` overrides it).
const DEFAULT_UPLOAD_DIR: &str = "/opt/data/uploads";
/// Same bound the old upload used, and the value S4 asks for: a long name is
/// truncated (extension kept) so the receipt and the stored path stay sane.
const MAX_NAME_LEN: usize = 80;
/// Prefix of an in-flight upload. `sanitize_name` strips leading dots, so no
/// real upload can match it and the startup sweep can never delete one.
const LEFTOVER_PREFIX: &str = ".partial-";
/// Enough bytes for every magic number in `sniff` (ftyp brands end at byte 12).
const SNIFF_LEN: usize = 16;

const MB: u64 = 1024 * 1024;
const IMAGE_LIMIT: u64 = 5 * MB;
const VIDEO_LIMIT: u64 = 100 * MB;
const AUDIO_LIMIT: u64 = 20 * MB;
const DOCUMENT_LIMIT: u64 = 50 * MB;

/// Backstop for one multipart body: S3's 100 MB video plus room for the part
/// headers. The per-type budget is still enforced while streaming; this only
/// stops a pure garbage body before it reaches the network stack.
pub const fn upload_body_limit() -> usize {
    (105 * 1024 + 1024) * 1024
}

/// Where uploads land.
#[derive(Clone, Debug)]
pub struct UploadConfig {
    pub dir: PathBuf,
}

impl UploadConfig {
    pub fn from_env() -> Self {
        let dir = std::env::var("HERMES_UPLOAD_DIR")
            .ok()
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(DEFAULT_UPLOAD_DIR));
        Self { dir }
    }

    /// Process-wide config from the environment. The route mounts it once at
    /// startup, so the handlers and the sweep read the same directory.
    pub fn current() -> &'static UploadConfig {
        static CONFIG: OnceLock<UploadConfig> = OnceLock::new();
        CONFIG.get_or_init(UploadConfig::from_env)
    }
}

// ---------------------------------------------------------------------------
// Type policy: extension -> kind, limit and MIME
// ---------------------------------------------------------------------------

/// The real type, as decided by the bytes (never by the client header).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Png,
    Jpeg,
    Gif,
    Webp,
    Mp4,
    Webm,
    Mp3,
    Wav,
    Ogg,
    M4a,
    Pdf,
    Zip,
    Text,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Family {
    Image,
    Video,
    Audio,
    Document,
}

impl Family {
    fn noun(self) -> &'static str {
        match self {
            Family::Image => "images",
            Family::Video => "videos",
            Family::Audio => "audio files",
            Family::Document => "documents",
        }
    }
}

/// What the allowlist says about one extension: the real type it must carry,
/// its per-file budget and the MIME the client receives.
#[derive(Debug, Clone, Copy)]
struct Policy {
    kind: Kind,
    limit: u64,
    limit_label: &'static str,
    mime: &'static str,
    family: Family,
}

const fn image_policy(kind: Kind, mime: &'static str) -> Policy {
    Policy {
        kind,
        limit: IMAGE_LIMIT,
        limit_label: "5 MB",
        mime,
        family: Family::Image,
    }
}

const fn video_policy(kind: Kind, mime: &'static str) -> Policy {
    Policy {
        kind,
        limit: VIDEO_LIMIT,
        limit_label: "100 MB",
        mime,
        family: Family::Video,
    }
}

const fn audio_policy(kind: Kind, mime: &'static str) -> Policy {
    Policy {
        kind,
        limit: AUDIO_LIMIT,
        limit_label: "20 MB",
        mime,
        family: Family::Audio,
    }
}

const fn document_policy(kind: Kind, mime: &'static str) -> Policy {
    Policy {
        kind,
        limit: DOCUMENT_LIMIT,
        limit_label: "50 MB",
        mime,
        family: Family::Document,
    }
}

/// S3's allowlist, one arm per accepted extension.
fn policy_for(ext: &str) -> Option<Policy> {
    match ext {
        "png" => Some(image_policy(Kind::Png, "image/png")),
        "jpg" | "jpeg" => Some(image_policy(Kind::Jpeg, "image/jpeg")),
        "gif" => Some(image_policy(Kind::Gif, "image/gif")),
        "webp" => Some(image_policy(Kind::Webp, "image/webp")),
        "mp4" => Some(video_policy(Kind::Mp4, "video/mp4")),
        "webm" => Some(video_policy(Kind::Webm, "video/webm")),
        "mov" => Some(video_policy(Kind::Mp4, "video/quicktime")),
        "mp3" => Some(audio_policy(Kind::Mp3, "audio/mpeg")),
        "wav" => Some(audio_policy(Kind::Wav, "audio/wav")),
        "m4a" => Some(audio_policy(Kind::M4a, "audio/mp4")),
        "ogg" => Some(audio_policy(Kind::Ogg, "audio/ogg")),
        "pdf" => Some(document_policy(Kind::Pdf, "application/pdf")),
        "docx" => Some(document_policy(
            Kind::Zip,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )),
        "xlsx" => Some(document_policy(
            Kind::Zip,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )),
        "pptx" => Some(document_policy(
            Kind::Zip,
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        )),
        "zip" => Some(document_policy(Kind::Zip, "application/zip")),
        "txt" => Some(document_policy(Kind::Text, "text/plain; charset=utf-8")),
        "md" => Some(document_policy(
            Kind::Text,
            "text/markdown; charset=utf-8",
        )),
        "csv" => Some(document_policy(Kind::Text, "text/csv; charset=utf-8")),
        _ => None,
    }
}

/// Real type from the first bytes. `None` means "nothing we accept": the
/// caller turns that into a 400 mismatch.
fn sniff(head: &[u8]) -> Option<Kind> {
    if head.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some(Kind::Png);
    }
    if head.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some(Kind::Jpeg);
    }
    if head.starts_with(b"GIF87a") || head.starts_with(b"GIF89a") {
        return Some(Kind::Gif);
    }
    if head.len() >= 12 && &head[0..4] == b"RIFF" && &head[8..12] == b"WEBP" {
        return Some(Kind::Webp);
    }
    if head.len() >= 12 && &head[4..8] == b"ftyp" {
        // M4A is an ftyp container too: its brand is what keeps a `.m4a`
        // distinct from an `.mp4`, and the family check rejects a swap.
        let brand = &head[8..12];
        return Some(if matches!(brand, b"M4A " | b"M4B " | b"M4P ") {
            Kind::M4a
        } else {
            Kind::Mp4
        });
    }
    if head.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
        return Some(Kind::Webm);
    }
    if head.starts_with(b"ID3") {
        return Some(Kind::Mp3);
    }
    // Bare MPEG audio frame sync (11 set bits), no ID3 tag.
    if head.len() >= 2 && head[0] == 0xFF && (head[1] & 0xE0) == 0xE0 {
        return Some(Kind::Mp3);
    }
    if head.len() >= 12 && &head[0..4] == b"RIFF" && &head[8..12] == b"WAVE" {
        return Some(Kind::Wav);
    }
    if head.starts_with(b"OggS") {
        return Some(Kind::Ogg);
    }
    if head.starts_with(b"%PDF") {
        return Some(Kind::Pdf);
    }
    if head.starts_with(b"PK\x03\x04") {
        return Some(Kind::Zip);
    }
    None
}

fn kind_mime(kind: Kind) -> &'static str {
    match kind {
        Kind::Png => "image/png",
        Kind::Jpeg => "image/jpeg",
        Kind::Gif => "image/gif",
        Kind::Webp => "image/webp",
        Kind::Mp4 => "video/mp4",
        Kind::Webm => "video/webm",
        Kind::Mp3 => "audio/mpeg",
        Kind::Wav => "audio/wav",
        Kind::Ogg => "audio/ogg",
        Kind::M4a => "audio/mp4",
        Kind::Pdf => "application/pdf",
        Kind::Zip => "application/zip",
        Kind::Text => "text/plain; charset=utf-8",
    }
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/// Lowercase extension of the last path segment, or `None` when there is none.
fn extension_of(raw_name: &str) -> Option<String> {
    let last = raw_name.rsplit(['/', '\\']).next().unwrap_or_default().trim();
    let (_, ext) = last.rsplit_once('.')?;
    let ext = ext.trim().to_ascii_lowercase();
    if ext.is_empty() || ext.len() > 16 || !ext.chars().all(|ch| ch.is_ascii_alphanumeric()) {
        return None;
    }
    Some(ext)
}

/// Strip directories, keep `[A-Za-z0-9._-]`, truncate to 80 chars keeping the
/// extension, fall back to `archivo.<ext>` (owner spec S4).
fn sanitize_name(raw_name: &str, ext: &str) -> String {
    let last = raw_name.rsplit(['/', '\\']).next().unwrap_or("");
    let mut clean: String = last
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '_'
            }
        })
        .collect();
    // Leading dots would name the file like a partial upload (and hide it on
    // every Unix listing), exactly like the old upload guardrail.
    while clean.starts_with('.') {
        clean.remove(0);
    }
    let clean = truncate_name(&clean);
    if clean.trim_matches('.').is_empty() {
        return format!("archivo.{ext}");
    }
    clean
}

fn truncate_name(clean: &str) -> String {
    if clean.len() <= MAX_NAME_LEN {
        return clean.to_string();
    }
    let extension = clean
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_string())
        .filter(|ext| !ext.is_empty() && ext.len() <= 16);
    let budget = MAX_NAME_LEN - extension.as_ref().map(|ext| ext.len() + 1).unwrap_or(0);
    let stem: String = clean.chars().take(budget).collect();
    match extension {
        Some(ext) => format!("{stem}.{ext}"),
        None => stem,
    }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

fn error_response(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        Json(serde_json::json!({"error": {"code": code, "message": message}})),
    )
        .into_response()
}

fn not_found() -> Response {
    error_response(StatusCode::NOT_FOUND, "NOT_FOUND", "Not found")
}

fn unavailable() -> Response {
    error_response(
        StatusCode::SERVICE_UNAVAILABLE,
        "HERMES_UPLOAD_UNAVAILABLE",
        "the upload directory is not writable",
    )
}

/// Map a multipart failure to the client's status. A body past the route's
/// `DefaultBodyLimit` is already a 413; turning it into 400 would tell the
/// user their request was malformed instead of too large.
fn multipart_failure(status: StatusCode) -> Response {
    if status == StatusCode::PAYLOAD_TOO_LARGE {
        error_response(
            StatusCode::PAYLOAD_TOO_LARGE,
            "PAYLOAD_TOO_LARGE",
            "the upload body is larger than the configured limit",
        )
    } else {
        error_response(
            StatusCode::BAD_REQUEST,
            "INVALID_MULTIPART",
            "the multipart body could not be read",
        )
    }
}

fn rejected_type(raw_name: &str, ext: Option<&str>) -> Response {
    let detail = match ext {
        Some(ext) => format!(".{ext} is not an accepted file type"),
        None => "it has no accepted file extension".to_string(),
    };
    error_response(
        StatusCode::BAD_REQUEST,
        "FILE_TYPE_NOT_ALLOWED",
        &format!("the file {raw_name} is not allowed: {detail}"),
    )
}

fn mismatch(raw_name: &str, ext: &str) -> Response {
    error_response(
        StatusCode::BAD_REQUEST,
        "CONTENT_TYPE_MISMATCH",
        &format!("the content of {raw_name} does not match the extension .{ext}"),
    )
}

fn too_large(raw_name: &str, policy: &Policy) -> Response {
    error_response(
        StatusCode::PAYLOAD_TOO_LARGE,
        "PAYLOAD_TOO_LARGE",
        &format!(
            "the file {raw_name} exceeds the {} limit for {}",
            policy.limit_label,
            policy.family.noun()
        ),
    )
}

// ---------------------------------------------------------------------------
// Auth (session only, like the rest of `/api/hermes`)
// ---------------------------------------------------------------------------

/// Production: a real Postgres session lookup. API tokens are refused, the
/// same way `/api/hermes` refuses them.
#[cfg(not(test))]
async fn authenticate(headers: &HeaderMap, pool: &sqlx::PgPool) -> Result<Uuid, Response> {
    crate::auth::helper::require_session_user_id(headers, pool)
        .await
        .map_err(|err| {
            use axum::response::IntoResponse as _;
            err.into_response()
        })
}

/// Test build: accept `Authorization: Bearer <user-uuid>` so handler tests run
/// without a database, mirroring `routes::hermes`. A missing or malformed
/// credential is still the same 401.
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

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/// One file written to its partial name and waiting for the rename.
struct Pending {
    partial: PathBuf,
    final_path: PathBuf,
    id: String,
    name: String,
    mime_type: &'static str,
    size: u64,
}

impl Pending {
    fn into_receipt(self) -> UploadReceipt {
        UploadReceipt {
            url: format!("{UPLOAD_ROUTE}/{}", self.id),
            local_path: self.final_path.to_string_lossy().to_string(),
            id: self.id,
            name: self.name,
            mime_type: self.mime_type,
            size: self.size,
        }
    }
}

/// Exact response shape of S4 (snake_case, no envelope, no extra keys).
#[derive(Debug, Serialize)]
pub struct UploadReceipt {
    pub id: String,
    pub name: String,
    pub mime_type: &'static str,
    pub size: u64,
    pub url: String,
    pub local_path: String,
}

async fn discard(path: &Path) {
    let _ = tokio::fs::remove_file(path).await;
}

/// `POST /api/uploads` — session-only, multipart, one file per request.
pub async fn upload_handler(
    State(state): State<crate::state::AppState>,
    Extension(config): Extension<UploadConfig>,
    headers: HeaderMap,
    multipart: Multipart,
) -> Response {
    // Auth before the body is read: an anonymous caller never gets a parse
    // error that describes the request.
    if let Err(err) = authenticate(&headers, &state.pool).await {
        return err;
    }
    match receive_one(&config, multipart).await {
        Ok(receipt) => (StatusCode::CREATED, Json(receipt)).into_response(),
        Err(response) => response,
    }
}

async fn receive_one(config: &UploadConfig, mut multipart: Multipart) -> Result<UploadReceipt, Response> {
    if tokio::fs::create_dir_all(&config.dir).await.is_err() {
        return Err(unavailable());
    }
    let dir = match tokio::fs::canonicalize(&config.dir).await {
        Ok(dir) => dir,
        Err(_) => return Err(unavailable()),
    };

    let mut pending: Option<Pending> = None;
    loop {
        let field = match multipart.next_field().await {
            Ok(Some(field)) => field,
            Ok(None) => break,
            Err(err) => {
                if let Some(pending) = pending.take() {
                    discard(&pending.partial).await;
                }
                return Err(multipart_failure(err.status()));
            }
        };
        // Only parts that carry a file name are files; plain form fields are
        // ignored so the client may send `message` alongside the attachment.
        let Some(raw_name) = field.file_name().map(str::to_string) else {
            continue;
        };
        if pending.is_some() {
            if let Some(pending) = pending.take() {
                discard(&pending.partial).await;
            }
            return Err(error_response(
                StatusCode::BAD_REQUEST,
                "MULTIPLE_FILES",
                &format!(
                    "only one file per request is allowed (a second file, {raw_name}, arrived)"
                ),
            ));
        }
        pending = Some(store_field(&dir, &raw_name, field).await?);
    }

    let Some(pending) = pending else {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "NO_FILE",
            "no file was uploaded; send one part named `file` or `files`",
        ));
    };
    if tokio::fs::rename(&pending.partial, &pending.final_path)
        .await
        .is_err()
    {
        discard(&pending.partial).await;
        return Err(unavailable());
    }
    Ok(pending.into_receipt())
}

/// Validate the extension, stream the bytes to a partial file, validate the
/// real content and hand back the pending upload. Every error path removes
/// the partial file.
async fn store_field(dir: &Path, raw_name: &str, mut field: Field<'_>) -> Result<Pending, Response> {
    let ext = match extension_of(raw_name) {
        Some(ext) => ext,
        None => return Err(rejected_type(raw_name, None)),
    };
    let Some(policy) = policy_for(&ext) else {
        return Err(rejected_type(raw_name, Some(&ext)));
    };
    let name = sanitize_name(raw_name, &ext);
    let id = Uuid::new_v4().to_string();
    let final_path = dir.join(format!("{id}.{ext}"));
    let partial = dir.join(format!("{LEFTOVER_PREFIX}{id}.{ext}"));

    let mut file = match tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&partial)
        .await
    {
        Ok(file) => file,
        Err(_) => return Err(unavailable()),
    };

    let mut size: u64 = 0;
    let mut head: Vec<u8> = Vec::with_capacity(SNIFF_LEN);
    // Trailing bytes of an unfinished UTF-8 sequence (text types only).
    let mut text_tail: Vec<u8> = Vec::new();
    let mut text_valid = true;

    loop {
        let chunk = match field.chunk().await {
            Ok(Some(chunk)) => chunk,
            Ok(None) => break,
            Err(err) => {
                drop(file);
                discard(&partial).await;
                return Err(multipart_failure(err.status()));
            }
        };
        size += chunk.len() as u64;
        if size > policy.limit {
            drop(file);
            discard(&partial).await;
            return Err(too_large(raw_name, &policy));
        }
        if head.len() < SNIFF_LEN {
            let take = (SNIFF_LEN - head.len()).min(chunk.len());
            head.extend_from_slice(&chunk[..take]);
        }
        if policy.kind == Kind::Text {
            text_valid = text_valid && validate_text_chunk(&mut text_tail, &chunk);
        }
        if file.write_all(&chunk).await.is_err() {
            drop(file);
            discard(&partial).await;
            return Err(unavailable());
        }
    }
    drop(file);

    if size == 0 {
        discard(&partial).await;
        return Err(mismatch(raw_name, &ext));
    }

    if policy.kind == Kind::Text {
        // A valid UTF-8 document cannot end mid-sequence.
        if !text_valid || !text_tail.is_empty() {
            discard(&partial).await;
            return Err(mismatch(raw_name, &ext));
        }
    } else if sniff(&head) != Some(policy.kind) {
        discard(&partial).await;
        return Err(mismatch(raw_name, &ext));
    }

    Ok(Pending {
        partial,
        final_path,
        id,
        name,
        // The family was proven by the magic bytes above; the extension names
        // the concrete container (`.mov` vs `.mp4`, `.docx` vs `.zip`).
        mime_type: policy.mime,
        size,
    })
}

/// Validate a chunk of text incrementally, keeping only an unfinished UTF-8
/// sequence (at most 3 bytes) between chunks. NUL bytes are refused outright:
/// a text attachment that carries them is a renamed binary.
fn validate_text_chunk(tail: &mut Vec<u8>, chunk: &[u8]) -> bool {
    if chunk.contains(&0) {
        return false;
    }
    let mut buffer = std::mem::take(tail);
    buffer.extend_from_slice(chunk);
    match std::str::from_utf8(&buffer) {
        Ok(_) => true,
        Err(err) => match err.error_len() {
            Some(_) => false,
            None => {
                *tail = buffer[err.valid_up_to()..].to_vec();
                true
            }
        },
    }
}

// ---------------------------------------------------------------------------
// Read-back (D-B2)
// ---------------------------------------------------------------------------

/// `GET /api/uploads/{id}` — the caller's own attachment, ranged and streamed.
pub async fn serve_upload_handler(
    State(state): State<crate::state::AppState>,
    Extension(config): Extension<UploadConfig>,
    headers: HeaderMap,
    AxumPath(raw_id): AxumPath<String>,
) -> Response {
    if let Err(err) = authenticate(&headers, &state.pool).await {
        return err;
    }
    // Anything that is not a UUID is a miss, never a filesystem lookup.
    let Ok(id) = Uuid::parse_str(raw_id.trim()) else {
        return not_found();
    };
    let Some(path) = find_stored_file(&config.dir, &id.to_string()).await else {
        return not_found();
    };
    serve_stored(path, headers).await
}

/// Resolve `<id>.<ext>` inside the upload directory. Exactly one match must
/// exist and its canonical parent must be the directory itself, which also
/// refuses a symlink that points outside.
async fn find_stored_file(dir: &Path, id: &str) -> Option<PathBuf> {
    let canonical_dir = tokio::fs::canonicalize(dir).await.ok()?;
    let mut entries = tokio::fs::read_dir(dir).await.ok()?;
    let mut matches: Vec<PathBuf> = Vec::new();
    while let Some(entry) = entries.next_entry().await.ok()? {
        let path = entry.path();
        if path.file_stem().and_then(|stem| stem.to_str()) != Some(id) {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(str::to_ascii_lowercase)
            .unwrap_or_default();
        if policy_for(&ext).is_none() {
            continue;
        }
        matches.push(path);
    }
    if matches.len() != 1 {
        return None;
    }
    let canonical = tokio::fs::canonicalize(&matches[0]).await.ok()?;
    if canonical.parent() != Some(canonical_dir.as_path()) {
        return None;
    }
    Some(canonical)
}

async fn serve_stored(path: PathBuf, headers: HeaderMap) -> Response {
    let metadata = match tokio::fs::metadata(&path).await {
        Ok(metadata) if metadata.is_file() => metadata,
        _ => return not_found(),
    };
    let len = metadata.len();
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let mime = sniffed_mime(&path, &ext).await;
    let policy = policy_for(&ext);

    let range_header = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok());
    let range = range_header.and_then(|raw| parse_range(raw, len));

    if let Some(range) = range.as_ref().filter(|range| range.start >= len) {
        let _ = range;
        return Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{len}"))
            .header(header::ACCEPT_RANGES, "bytes")
            .body(Body::empty())
            .unwrap_or_else(|_| not_found());
    }

    let (status, start, length) = match range.as_ref() {
        Some(range) => (StatusCode::PARTIAL_CONTENT, range.start, range.len()),
        None => (StatusCode::OK, 0, len),
    };

    let mut file = match tokio::fs::File::open(&path).await {
        Ok(file) => file,
        Err(_) => return not_found(),
    };
    if start > 0 && file.seek(std::io::SeekFrom::Start(start)).await.is_err() {
        return error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "could not read the stored file",
        );
    }
    let body = Body::from_stream(ReaderStream::new(file.take(length)));

    let disposition_kind = match policy.map(|policy| policy.family) {
        Some(Family::Image | Family::Video | Family::Audio) => "inline",
        _ => "attachment",
    };
    let stored_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("archivo")
        .to_string();

    let mut builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, mime)
        .header(header::CONTENT_LENGTH, length.to_string())
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CACHE_CONTROL, "private, max-age=60")
        .header(
            header::CONTENT_DISPOSITION,
            disposition(disposition_kind, &stored_name),
        );
    if let Some(range) = range {
        builder = builder.header(
            header::CONTENT_RANGE,
            format!("bytes {}-{}/{len}", range.start, range.end),
        );
    }
    builder.body(body).unwrap_or_else(|_| {
        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "could not build the response",
        )
    })
}

/// The MIME the bytes really are. The sniff has already agreed with the
/// extension at upload time, so the extension's MIME is the precise one
/// (`.mov` is `video/quicktime`, `.docx` is OOXML, never bare `application/zip`).
async fn sniffed_mime(path: &Path, ext: &str) -> &'static str {
    let Some(policy) = policy_for(ext) else {
        return "application/octet-stream";
    };
    if matches!(policy.kind, Kind::Text | Kind::Zip) {
        return policy.mime;
    }
    let mut head = [0u8; SNIFF_LEN];
    let Ok(mut file) = tokio::fs::File::open(path).await else {
        return policy.mime;
    };
    let read = file.read(&mut head).await.unwrap_or(0);
    match sniff(&head[..read]) {
        Some(kind) if kind == policy.kind => policy.mime,
        Some(kind) => kind_mime(kind),
        None => policy.mime,
    }
}

fn disposition(kind: &str, name: &str) -> HeaderValue {
    let safe: String = name
        .chars()
        .map(|ch| {
            if ch.is_control() || ch == '"' || ch == '\\' || ch == '/' {
                '_'
            } else {
                ch
            }
        })
        .collect();
    HeaderValue::from_str(&format!("{kind}; filename=\"{safe}\""))
        .unwrap_or_else(|_| HeaderValue::from_static("attachment"))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ByteRange {
    start: u64,
    end: u64,
}

impl ByteRange {
    fn len(&self) -> u64 {
        self.end - self.start + 1
    }
}

/// Single-range `bytes=` only; a multi-range request falls back to the full
/// body, which is legal while `Accept-Ranges: bytes` is advertised.
fn parse_range(raw: &str, len: u64) -> Option<ByteRange> {
    let spec = raw.trim().strip_prefix("bytes=")?;
    if spec.contains(',') || spec.is_empty() || len == 0 {
        return None;
    }
    let (start_raw, end_raw) = spec.split_once('-')?;
    if start_raw.is_empty() {
        let suffix: u64 = end_raw.trim().parse().ok()?;
        if suffix == 0 {
            return None;
        }
        return Some(ByteRange {
            start: len.saturating_sub(suffix),
            end: len - 1,
        });
    }
    let start: u64 = start_raw.trim().parse().ok()?;
    if start >= len {
        // Sentinel: the caller answers 416.
        return Some(ByteRange { start: len, end: len });
    }
    let end = if end_raw.trim().is_empty() {
        len - 1
    } else {
        end_raw.trim().parse::<u64>().ok()?.min(len - 1)
    };
    if end < start {
        return None;
    }
    Some(ByteRange { start, end })
}

/// Remove `.partial-*` files an interrupted upload left behind.
///
/// A dropped handler future cannot run its cleanup, so the partial file stays
/// on the volume until the next start. Deleting it is safe: the final name
/// only exists after a successful rename, and no real upload can carry this
/// prefix. Called once at startup, never per request.
pub fn sweep_partial_uploads(dir: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let is_partial = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with(LEFTOVER_PREFIX));
        if is_partial && std::fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    use axum::{
        body::Body,
        extract::DefaultBodyLimit,
        http::{header, Request, StatusCode},
        routing::{get, post},
        Router,
    };
    use tower::ServiceExt;

    /// Test-build credentials: `authenticate` accepts any UUID bearer without
    /// a database, exactly like `routes::hermes` does in its tests.
    const USER: &str = "11111111-1111-1111-1111-111111111111";
    const BOUNDARY: &str = "TEST-BOUNDARY";

    fn lazy_state() -> crate::state::AppState {
        crate::state::AppState {
            pool: sqlx::PgPool::connect_lazy("postgres://localhost:1/unused")
                .expect("lazy pool construction must succeed"),
            session_ttl_hours: 24,
            rate_limiter: Arc::new(crate::auth::rate_limit::LoginRateLimiter::new()),
            hermes: None,
        }
    }

    fn test_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hermes-uploads-{tag}-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn app(dir: &Path) -> Router {
        let config = UploadConfig {
            dir: dir.to_path_buf(),
        };
        Router::new()
            .route(
                UPLOAD_ROUTE,
                post(upload_handler)
                    .layer::<_, std::convert::Infallible>(DefaultBodyLimit::max(
                        upload_body_limit(),
                    ))
                    .layer(Extension(config.clone())),
            )
            .route(
                SERVE_ROUTE,
                get(serve_upload_handler).layer(Extension(config)),
            )
            .with_state(lazy_state())
    }

    fn png_bytes(extra: usize) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        bytes.extend(std::iter::repeat(b'x').take(extra));
        bytes
    }

    /// Minimal multipart body with one file part.
    fn one_file(field: &str, filename: &str, bytes: &[u8]) -> Vec<u8> {
        let mut body = Vec::new();
        body.extend_from_slice(
            format!(
                "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{filename}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
            )
            .as_bytes(),
        );
        body.extend_from_slice(bytes);
        body.extend_from_slice(format!("\r\n--{BOUNDARY}--\r\n").as_bytes());
        body
    }

    fn upload_request(field: &str, filename: &str, bytes: &[u8]) -> Request<Body> {
        Request::post(UPLOAD_ROUTE)
            .header(header::AUTHORIZATION, format!("Bearer {USER}"))
            .header(
                header::CONTENT_TYPE,
                format!("multipart/form-data; boundary={BOUNDARY}"),
            )
            .body(Body::from(one_file(field, filename, bytes)))
            .unwrap()
    }

    fn get_request(uri: &str) -> Request<Body> {
        Request::get(uri)
            .header(header::AUTHORIZATION, format!("Bearer {USER}"))
            .body(Body::empty())
            .unwrap()
    }

    async fn body_bytes(response: Response) -> Vec<u8> {
        axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec()
    }

    async fn body_text(response: Response) -> String {
        String::from_utf8_lossy(&body_bytes(response).await).to_string()
    }

    fn files_in(dir: &Path) -> usize {
        std::fs::read_dir(dir).unwrap().count()
    }

    // -- 1. PNG upload: 201 and the exact S4 key set -------------------------
    #[tokio::test]
    async fn uploads_a_png_and_answers_the_exact_receipt() {
        let dir = test_dir("png");
        let bytes = png_bytes(64);
        let response = app(&dir)
            .oneshot(upload_request("file", "../../etc/mi informe (1).png", &bytes))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        let value: serde_json::Value = serde_json::from_slice(&body_bytes(response).await).unwrap();

        let mut keys: Vec<&str> = value.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            ["id", "local_path", "mime_type", "name", "size", "url"],
            "the receipt must carry exactly the S4 keys"
        );

        let id = value["id"].as_str().unwrap();
        Uuid::parse_str(id).unwrap();
        assert_eq!(value["name"], "mi_informe__1_.png");
        assert_eq!(value["mime_type"], "image/png");
        assert_eq!(value["size"], bytes.len() as u64);
        assert_eq!(value["url"], format!("/api/uploads/{id}"));

        let local = PathBuf::from(value["local_path"].as_str().unwrap());
        assert!(local.is_absolute(), "{local:?}");
        assert_eq!(
            local.parent().unwrap(),
            std::fs::canonicalize(&dir).unwrap(),
            "the file must live directly under the configured dir"
        );
        assert_eq!(std::fs::read(&local).unwrap(), bytes);
        assert_eq!(files_in(&dir), 1, "no partial file may survive");

        // The `files` field name is accepted too.
        let second = app(&dir)
            .oneshot(upload_request("files", "otra.png", &bytes))
            .await
            .unwrap();
        assert_eq!(second.status(), StatusCode::CREATED);
        std::fs::remove_dir_all(&dir).ok();
    }

    // -- 2. `.exe` / `.sh`: 400 naming the file -------------------------------
    #[tokio::test]
    async fn refuses_executable_extensions_naming_the_file() {
        let dir = test_dir("exe");
        for name in ["setup.exe", "run.sh"] {
            let response = app(&dir)
                .oneshot(upload_request("file", name, b"MZ\x90\x00eval"))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{name}");
            let text = body_text(response).await;
            assert!(text.contains(name), "{name}: {text}");
            assert!(
                text.to_lowercase().contains("not allowed"),
                "{name}: {text}"
            );
        }
        assert_eq!(files_in(&dir), 0, "a refused upload must not reach disk");
        std::fs::remove_dir_all(&dir).ok();
    }

    // -- 3. Altered MIME: a `.pdf` whose bytes are a PNG -----------------------
    #[tokio::test]
    async fn refuses_content_that_does_not_match_the_extension() {
        let dir = test_dir("mismatch");
        let response = app(&dir)
            .oneshot(upload_request("file", "informe.pdf", &png_bytes(32)))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let text = body_text(response).await;
        assert!(
            text.contains("does not match the extension .pdf"),
            "{text}"
        );
        assert_eq!(files_in(&dir), 0, "no orphan may remain");
        std::fs::remove_dir_all(&dir).ok();
    }

    // -- 4. Per-type limits: 413 naming the limit -----------------------------
    #[tokio::test]
    async fn refuses_files_over_the_per_type_limit() {
        let dir = test_dir("limits");

        let image = vec![b'x'; IMAGE_LIMIT as usize + 1];
        let response = app(&dir)
            .oneshot(upload_request("file", "foto.png", &image))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
        let text = body_text(response).await;
        assert!(text.contains("5 MB"), "image: {text}");
        drop(image);

        let document = vec![b'%'; DOCUMENT_LIMIT as usize + 1];
        let response = app(&dir)
            .oneshot(upload_request("file", "informe.pdf", &document))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
        let text = body_text(response).await;
        assert!(text.contains("50 MB"), "document: {text}");
        drop(document);

        assert_eq!(files_in(&dir), 0, "an oversized upload must not reach disk");
        std::fs::remove_dir_all(&dir).ok();
    }

    // -- 5. Aborted body: 400 and no file left behind -------------------------
    #[tokio::test]
    async fn an_aborted_body_leaves_no_file_behind() {
        let dir = test_dir("aborted");
        let mut prefix = Vec::new();
        prefix.extend_from_slice(
            format!(
                "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"roto.png\"\r\nContent-Type: image/png\r\n\r\n"
            )
            .as_bytes(),
        );
        prefix.extend_from_slice(b"\x89PNG\r\n\x1a\npartial-bytes");
        let stream = futures_util::stream::iter(vec![
            Ok::<_, std::io::Error>(axum::body::Bytes::from(prefix)),
            Err(std::io::Error::other("connection dropped")),
        ]);
        let request = Request::post(UPLOAD_ROUTE)
            .header(header::AUTHORIZATION, format!("Bearer {USER}"))
            .header(
                header::CONTENT_TYPE,
                format!("multipart/form-data; boundary={BOUNDARY}"),
            )
            .body(Body::from_stream(stream))
            .unwrap();
        let response = app(&dir).oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(files_in(&dir), 0, "an aborted upload must not reach disk");
        std::fs::remove_dir_all(&dir).ok();
    }

    // -- 6. GET: bytes, sniffed MIME, nosniff, disposition, Range -------------
    #[tokio::test]
    async fn serves_the_stored_attachment_with_mime_disposition_and_ranges() {
        let dir = test_dir("serve");
        let bytes = png_bytes(120);
        let upload = app(&dir)
            .oneshot(upload_request("file", "foto.png", &bytes))
            .await
            .unwrap();
        assert_eq!(upload.status(), StatusCode::CREATED);
        let value: serde_json::Value =
            serde_json::from_slice(&body_bytes(upload).await).unwrap();
        let id = value["id"].as_str().unwrap().to_string();

        let response = app(&dir)
            .oneshot(get_request(&format!("/api/uploads/{id}")))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "image/png");
        assert_eq!(response.headers()[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
        assert_eq!(response.headers()[header::ACCEPT_RANGES], "bytes");
        let disposition = response.headers()[header::CONTENT_DISPOSITION]
            .to_str()
            .unwrap()
            .to_string();
        assert!(
            disposition.starts_with("inline"),
            "an image is served inline: {disposition}"
        );
        assert_eq!(body_bytes(response).await, bytes);

        let ranged = app(&dir)
            .oneshot(
                Request::get(format!("/api/uploads/{id}"))
                    .header(header::AUTHORIZATION, format!("Bearer {USER}"))
                    .header(header::RANGE, "bytes=4-9")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(ranged.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            ranged.headers()[header::CONTENT_RANGE],
            format!("bytes 4-9/{}", bytes.len())
        );
        assert_eq!(body_bytes(ranged).await, bytes[4..=9].to_vec());

        // A document is an attachment, never inline.
        let pdf = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n";
        let upload = app(&dir)
            .oneshot(upload_request("file", "ensayo.pdf", pdf))
            .await
            .unwrap();
        assert_eq!(upload.status(), StatusCode::CREATED);
        let value: serde_json::Value =
            serde_json::from_slice(&body_bytes(upload).await).unwrap();
        let id = value["id"].as_str().unwrap().to_string();
        let response = app(&dir)
            .oneshot(get_request(&format!("/api/uploads/{id}")))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "application/pdf");
        let disposition = response.headers()[header::CONTENT_DISPOSITION]
            .to_str()
            .unwrap()
            .to_string();
        assert!(
            disposition.starts_with("attachment"),
            "a document is an attachment: {disposition}"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    // -- 7. Non-UUID, missing and traversal ids all answer 404 ----------------
    #[tokio::test]
    async fn unknown_ids_and_traversal_answer_404() {
        let dir = test_dir("miss");
        for uri in [
            "/api/uploads/not-a-uuid",
            "/api/uploads/00000000-0000-0000-0000-000000000000",
            "/api/uploads/..%2F..%2Fetc%2Fpasswd",
        ] {
            let response = app(&dir).oneshot(get_request(uri)).await.unwrap();
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{uri}");
            let text = body_text(response).await;
            assert!(!text.contains("root:"), "{uri} leaked a file: {text}");
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    // -- 8. Both routes require a session -------------------------------------
    #[tokio::test]
    async fn both_routes_require_a_session() {
        let dir = test_dir("auth");
        let upload = Request::post(UPLOAD_ROUTE)
            .header(
                header::CONTENT_TYPE,
                format!("multipart/form-data; boundary={BOUNDARY}"),
            )
            .body(Body::from(one_file("file", "foto.png", &png_bytes(8))))
            .unwrap();
        let response = app(&dir).oneshot(upload).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

        let get = Request::get("/api/uploads/00000000-0000-0000-0000-000000000000")
            .body(Body::empty())
            .unwrap();
        let response = app(&dir).oneshot(get).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        std::fs::remove_dir_all(&dir).ok();
    }

    // -- Contract rule: text is UTF-8 without NUL, never a renamed binary -----
    #[tokio::test]
    async fn text_types_must_be_valid_utf8_without_nul() {
        let dir = test_dir("text");
        let markdown = "# Hola\n\n- uno\n- dos\n";
        let upload = app(&dir)
            .oneshot(upload_request("file", "notas.md", markdown.as_bytes()))
            .await
            .unwrap();
        assert_eq!(upload.status(), StatusCode::CREATED);
        let value: serde_json::Value =
            serde_json::from_slice(&body_bytes(upload).await).unwrap();
        assert_eq!(value["mime_type"], "text/markdown; charset=utf-8");

        let invalid_utf8 = b"hola \xff\xfe mundo".to_vec();
        let response = app(&dir)
            .oneshot(upload_request("file", "notas.txt", &invalid_utf8))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        let with_nul = b"hola\0mundo".to_vec();
        let response = app(&dir)
            .oneshot(upload_request("file", "datos.csv", &with_nul))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        assert_eq!(files_in(&dir), 1, "only the valid markdown may stay");
        std::fs::remove_dir_all(&dir).ok();
    }

    // -- Contract rule: more than one file per body is a 400 ------------------
    #[tokio::test]
    async fn refuses_more_than_one_file_and_leaves_nothing_behind() {
        let dir = test_dir("many");
        let mut body = Vec::new();
        for name in ["uno.png", "dos.png"] {
            body.extend_from_slice(
                format!(
                    "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\nContent-Type: image/png\r\n\r\n"
                )
                .as_bytes(),
            );
            body.extend_from_slice(&png_bytes(8));
            body.extend_from_slice(b"\r\n");
        }
        body.extend_from_slice(format!("--{BOUNDARY}--\r\n").as_bytes());
        let request = Request::post(UPLOAD_ROUTE)
            .header(header::AUTHORIZATION, format!("Bearer {USER}"))
            .header(
                header::CONTENT_TYPE,
                format!("multipart/form-data; boundary={BOUNDARY}"),
            )
            .body(Body::from(body))
            .unwrap();
        let response = app(&dir).oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let text = body_text(response).await;
        assert!(text.to_lowercase().contains("one file"), "{text}");
        assert_eq!(files_in(&dir), 0, "the first file must be removed");
        std::fs::remove_dir_all(&dir).ok();
    }

    // -- Shape helpers are unit-tested where they are cheap -------------------
    #[test]
    fn sanitized_names_keep_the_extension_and_drop_directories() {
        assert_eq!(
            sanitize_name("../../etc/Mi Foto (1).PNG", "png"),
            "Mi_Foto__1_.PNG"
        );
        let long = format!("{}.zip", "a".repeat(200));
        let name = sanitize_name(&long, "zip");
        assert_eq!(name.len(), MAX_NAME_LEN);
        assert!(name.ends_with(".zip"));
        assert_eq!(sanitize_name("...", "png"), "archivo.png");
    }

    #[test]
    fn sniffing_recognizes_every_allowed_family() {
        assert_eq!(sniff(b"\x89PNG\r\n\x1a\n"), Some(Kind::Png));
        assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0xE0]), Some(Kind::Jpeg));
        assert_eq!(sniff(b"GIF89a..."), Some(Kind::Gif));
        assert_eq!(sniff(b"RIFF\0\0\0\0WEBPVP8 "), Some(Kind::Webp));
        assert_eq!(sniff(b"\0\0\0\x18ftypisom"), Some(Kind::Mp4));
        assert_eq!(sniff(b"\0\0\0\x18ftypM4A "), Some(Kind::M4a));
        assert_eq!(sniff(b"\x1A\x45\xDF\xA3"), Some(Kind::Webm));
        assert_eq!(sniff(b"ID3\x04"), Some(Kind::Mp3));
        assert_eq!(sniff(&[0xFF, 0xFB, 0x90, 0x00]), Some(Kind::Mp3));
        assert_eq!(sniff(b"RIFF\0\0\0\0WAVEfmt "), Some(Kind::Wav));
        assert_eq!(sniff(b"OggS\0"), Some(Kind::Ogg));
        assert_eq!(sniff(b"%PDF-1.7"), Some(Kind::Pdf));
        assert_eq!(sniff(b"PK\x03\x04"), Some(Kind::Zip));
        assert_eq!(sniff(b"plain text"), None);
    }
}
