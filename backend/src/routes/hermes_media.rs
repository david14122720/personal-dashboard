//! Media streaming and uploads for the files Hermes exchanges with the chat.
//!
//! Hermes mentions absolute paths in its replies;
//! `/opt/data/documentos_generados/entrega.pdf` and
//! `/opt/data/cache/scratch/render.png` are the measured cases. Those paths
//! live in the Hermes container, so the dashboard mounts the same directories
//! (read-only for the stream) and serves them here. The `MEDIA:` prefix
//! Telegram uses is not part of this contract: the reply text carries the path
//! and the chat proxy turns it into a signed card URL.
//!
//! `path` alone would be an arbitrary-file-read (`.env`, credentials, the DB
//! dump). Every URL therefore carries a short-lived HMAC signature minted by
//! the chat proxy: `<video src>`/`<audio src>`/`<img src>` cannot send the
//! session bearer, so the signature is the credential for this route. The path
//! must also resolve inside one of `HERMES_MEDIA_ROOTS` after canonicalization,
//! which blocks `..` and symlink escapes.
//!
//! Responses stream from disk (`ReaderStream`) and support `Range`, so a
//! multi-gigabyte video seeks without buffering it in RAM.
//!
//! The same module stores inbound documents (`UPLOAD_ROUTE`): a browser cannot
//! put bytes in the Runs API, so they land in `HERMES_UPLOAD_DIR` and the turn
//! text names their signed URL instead.

use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        OnceLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    body::Body,
    extract::{Extension, Multipart, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio_util::io::ReaderStream;

pub const MEDIA_ROUTE: &str = "/api/hermes/media";

/// Stable, signature-free download route for the files the chat mentions.
///
/// The signed URL above is what `<img>`/`<video>` consume inside the dashboard;
/// this route is the plain, pasteable address (`/files/opt/data/...`) the spec
/// asks for, so a card link survives a reload and an agent can fetch it with
/// its own tools. The allowlist and canonicalization are the same ones.
pub const FILES_ROUTE: &str = "/files/{*path}";

/// Resolve each configured root once, refusing the ones we cannot trust.
///
/// A root that is itself a symlink defeats the allowlist: `canonicalize` would
/// resolve it to its target — the shared volume, or even `/opt/data` — and
/// every file under that target would then pass the `starts_with` check. A
/// missing root serves nothing, so it is dropped instead of kept as a promise.
fn canonical_roots(roots: Vec<PathBuf>) -> Vec<PathBuf> {
    roots
        .into_iter()
        .filter_map(|root| match std::fs::symlink_metadata(&root) {
            Ok(meta) if meta.file_type().is_symlink() => None,
            Ok(_) => std::fs::canonicalize(&root).ok(),
            Err(_) => None,
        })
        .collect()
}

/// Allowlisted directories (owner spec S6 + measured reality).
///
/// `/opt/data` itself is deliberately **not** a root: the agent's home holds
/// `.env`, `auth.json` and `config.yaml`, so a signed link for any file there
/// would be a credential leak. `documentos_generados` was measured on the real
/// gateway (2026-10-29) as the directory where Hermes writes the Word/Excel/PDF
/// deliverables; without it the download cards would never resolve.
/// `/tmp` is named by the spec and used for scratch renders.
const DEFAULT_ROOTS: &[&str] = &[
    "/opt/data/cache/scratch",
    "/opt/data/cache/documents",
    "/opt/data/entregables",
    "/opt/data/uploads",
    "/opt/data/documentos_generados",
    "/tmp",
];
/// One sign request may carry the paths of a single reply.
const MAX_SIGN_PATHS: usize = 32;
// Cards live in the transcript: a page open for a day must still play its
// video. The signature is scoped to one path, so a week is the comfort zone.
const DEFAULT_TTL_SECS: i64 = 604_800;
const MAX_TTL_SECS: i64 = 2_592_000;

/// Extensions the chat is allowed to turn into a media card.
pub const MEDIA_EXTENSIONS: &[&str] = &[
    // video
    "mp4", "webm", "mov", "mkv", "m4v",
    // audio
    "mp3", "wav", "ogg", "oga", "m4a", "flac", "aac", "opus",
    // images
    "png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico",
    // documents and archives
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
    "txt", "csv", "json", "md", "log", "tsv", "yaml", "yml",
    "zip", "tar", "gz", "tgz", "bz2", "rar", "7z",
];

#[derive(Clone, Debug)]
pub struct MediaConfig {
    roots: Vec<PathBuf>,
    secret: Vec<u8>,
    ttl_secs: i64,
}

impl MediaConfig {
    pub fn new(roots: Vec<PathBuf>, secret: Vec<u8>, ttl_secs: i64) -> Self {
        let ttl_secs = ttl_secs.clamp(30, MAX_TTL_SECS);
        Self {
            roots: canonical_roots(roots),
            secret,
            ttl_secs,
        }
    }

    /// Process-wide config from the environment. Cached on first use: the
    /// chat handler signs URLs and the media handler verifies them, so both
    /// must read the same secret.
    pub fn current() -> &'static MediaConfig {
        static CONFIG: OnceLock<MediaConfig> = OnceLock::new();
        CONFIG.get_or_init(MediaConfig::from_env)
    }

    pub fn from_env() -> Self {
        let roots = std::env::var("HERMES_MEDIA_ROOTS")
            .ok()
            .map(|raw| {
                raw.split(':')
                    .map(str::trim)
                    .filter(|part| !part.is_empty())
                    .map(PathBuf::from)
                    .collect::<Vec<_>>()
            })
            .filter(|roots| !roots.is_empty())
            .unwrap_or_else(|| DEFAULT_ROOTS.iter().map(PathBuf::from).collect());
        let secret = std::env::var("HERMES_MEDIA_SECRET")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .map(|value| value.into_bytes())
            // Deriving from the upstream key keeps links valid across restarts
            // without introducing another required variable.
            .unwrap_or_else(|| {
                let key = std::env::var("HERMES_API_KEY").unwrap_or_default();
                if key.trim().is_empty() {
                    // No configured key: a public constant would let anyone forge
                    // a signature for /opt/data. A random per-boot secret keeps
                    // the route closed instead of open.
                    return random_secret();
                }
                let mut hasher = Sha256::new();
                hasher.update(b"personal-dashboard:hermes-media\0");
                hasher.update(key.as_bytes());
                hasher.finalize().to_vec()
            });
        let ttl_secs = std::env::var("HERMES_MEDIA_TTL_SECS")
            .ok()
            .and_then(|raw| raw.trim().parse::<i64>().ok())
            .unwrap_or(DEFAULT_TTL_SECS);
        Self::new(roots, secret, ttl_secs)
    }

    /// `Some(path)` only when `path` resolves inside an allowed root.
    pub fn resolve(&self, path: &str) -> Option<PathBuf> {
        if path.contains('\0') || !path.starts_with('/') {
            return None;
        }
        let canonical = std::fs::canonicalize(path).ok()?;
        let allowed = self.roots.iter().any(|root| canonical.starts_with(root));
        allowed.then_some(canonical)
    }

    fn signature(&self, path: &str, exp: i64) -> String {
        let mut message = Vec::with_capacity(path.len() + 24);
        message.extend_from_slice(path.as_bytes());
        message.push(b'\n');
        message.extend_from_slice(exp.to_string().as_bytes());
        hex::encode(hmac_sha256(&self.secret, &message))
    }

    /// Relative URL the browser can use directly (same origin, no bearer).
    pub fn signed_url(&self, path: &str, now: i64) -> String {
        let exp = now + self.ttl_secs;
        format!(
            "{MEDIA_ROUTE}?path={}&exp={exp}&sig={}",
            percent_encode(path),
            self.signature(path, exp)
        )
    }

    fn verify(&self, path: &str, exp: i64, sig: &str, now: i64) -> bool {
        if exp < now {
            return false;
        }
        let expected = self.signature(path, exp);
        expected
            .as_bytes()
            .ct_eq(sig.as_bytes())
            .into()
    }
}

/// 32 bytes from the OS CSPRNG; a timestamp/PID hash is not a signing key.
fn random_secret() -> Vec<u8> {
    use std::io::Read as _;
    if let Ok(mut file) = std::fs::File::open("/dev/urandom") {
        let mut bytes = [0u8; 32];
        if file.read_exact(&mut bytes).is_ok() {
            return bytes.to_vec();
        }
    }
    let mut hasher = Sha256::new();
    hasher.update(format!("{:?}-{}", std::time::SystemTime::now(), std::process::id()));
    hasher.finalize().to_vec()
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Minimal RFC 2104 HMAC over SHA-256. `sha2` and `subtle` are already
/// dependencies; a full `hmac` crate is not needed for one keyed digest.
fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    const BLOCK: usize = 64;
    let mut block = [0u8; BLOCK];
    if key.len() > BLOCK {
        block[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        block[..key.len()].copy_from_slice(key);
    }
    let mut inner = Sha256::new();
    let mut outer = Sha256::new();
    let mut ipad = [0x36u8; BLOCK];
    let mut opad = [0x5cu8; BLOCK];
    for index in 0..BLOCK {
        ipad[index] ^= block[index];
        opad[index] ^= block[index];
    }
    inner.update(ipad);
    inner.update(message);
    outer.update(opad);
    outer.update(inner.finalize());
    outer.finalize().into()
}

/// Percent-encode everything but unreserved characters and `/`, so a path with
/// spaces or non-ASCII bytes survives the query string.
pub fn percent_encode(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for byte in raw.bytes() {
        let keep = byte.is_ascii_alphanumeric()
            || matches!(byte, b'-' | b'.' | b'_' | b'~' | b'/');
        if keep {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

#[derive(Debug, Deserialize)]
pub struct MediaQuery {
    pub path: Option<String>,
    pub exp: Option<i64>,
    pub sig: Option<String>,
    /// Force `Content-Disposition: attachment` with this file name.
    pub download: Option<String>,
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

/// Parse a single-range `bytes=` header. Multi-range requests are ignored
/// (the caller answers with the full body), which is legal for a server that
/// advertises `Accept-Ranges: bytes`.
fn parse_range(raw: &str, len: u64) -> Option<ByteRange> {
    let spec = raw.trim().strip_prefix("bytes=")?;
    if spec.contains(',') || spec.is_empty() || len == 0 {
        return None;
    }
    let (start_raw, end_raw) = spec.split_once('-')?;
    if start_raw.is_empty() {
        // suffix: the last N bytes
        let suffix: u64 = end_raw.trim().parse().ok()?;
        if suffix == 0 {
            return None;
        }
        let start = len.saturating_sub(suffix);
        return Some(ByteRange {
            start,
            end: len - 1,
        });
    }
    let start: u64 = start_raw.trim().parse().ok()?;
    if start >= len {
        return Some(ByteRange {
            start: len,
            end: len, // sentinel: unsatisfiable, caller answers 416
        });
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

pub fn mime_for(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match ext.as_str() {
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "oga" => "audio/ogg",
        "m4a" => "audio/mp4",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        "opus" => "audio/opus",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "pdf" => "application/pdf",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "odt" => "application/vnd.oasis.opendocument.text",
        "ods" => "application/vnd.oasis.opendocument.spreadsheet",
        "odp" => "application/vnd.oasis.opendocument.presentation",
        "txt" | "log" => "text/plain; charset=utf-8",
        "csv" => "text/csv; charset=utf-8",
        "json" => "application/json",
        "md" => "text/markdown; charset=utf-8",
        "zip" => "application/zip",
        "tar" => "application/x-tar",
        "gz" => "application/gzip",
        "rar" => "application/vnd.rar",
        "7z" => "application/x-7z-compressed",
        _ => "application/octet-stream",
    }
}

/// Inline is only for bytes a browser renders passively. `image/svg+xml` is a
/// document that runs script in this origin (and the bearer lives in
/// localStorage), so it is always served as a download.
fn streamable(mime: &str) -> bool {
    if mime == "image/svg+xml" {
        return false;
    }
    mime.starts_with("image/") || mime.starts_with("audio/") || mime.starts_with("video/")
}

/// `attachment; filename="..."` for documents, `inline` for media that the
/// chat reproduces with native controls.
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
    let encoded = percent_encode(&safe).replace("%2F", "_");
    let header = format!("{kind}; filename=\"{safe}\"; filename*=UTF-8''{encoded}");
    HeaderValue::from_str(&header).unwrap_or_else(|_| HeaderValue::from_static("attachment"))
}

fn plain_error(status: StatusCode, message: &str) -> Response {
    (status, message.to_string()).into_response()
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("archivo")
        .to_string()
}

fn http_date(modified: SystemTime) -> String {
    let stamp: chrono::DateTime<chrono::Utc> = modified.into();
    stamp.format("%a, %d %b %Y %H:%M:%S GMT").to_string()
}

/// `GET|HEAD /api/hermes/media` — signed, ranged, streamed file delivery.
/// One file the UI may offer as a card: name, mime, size and a signed URL.
#[derive(Debug, Serialize)]
pub struct MediaLink {
    pub path: String,
    pub name: String,
    pub mime: String,
    pub size: u64,
    pub url: String,
}

/// Resolve one mentioned path into a card, or `None` when it does not exist,
/// is not a regular file, or escapes the allowed roots.
pub fn link_for(cfg: &MediaConfig, path: &str, now: i64) -> Option<MediaLink> {
    let resolved = cfg.resolve(path)?;
    let meta = std::fs::metadata(&resolved).ok()?;
    if !meta.is_file() || !has_media_extension(&resolved) {
        return None;
    }
    let name = resolved.file_name()?.to_string_lossy().into_owned();
    Some(MediaLink {
        path: path.to_string(),
        name,
        mime: mime_for(&resolved).to_string(),
        size: meta.len(),
        url: cfg.signed_url(path, now),
    })
}

/// Same allowlist the chat proxy uses for artifact detection: the sign route
/// must not become a generic "read any file in the roots" oracle.
fn has_media_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| MEDIA_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

#[derive(Debug, Deserialize)]
pub struct SignRequest {
    #[serde(default)]
    pub paths: Vec<String>,
}

/// `POST /api/hermes/media/sign` — authenticated. The reply text may mention a
/// path the proxy did not pre-sign (a `/tmp` render, a path inside a code
/// block); the UI asks for a URL here before drawing the download card.
/// Paths that do not resolve to a real file inside the roots are dropped
/// silently: a dead card is worse than plain text.
pub async fn sign_handler(
    State(state): State<crate::state::AppState>,
    headers: HeaderMap,
    request: axum::extract::Request,
) -> Response {
    // Auth runs before the body is read: an unauthenticated caller gets 401,
    // never a parse error that reveals request-shape details.
    if let Err(err) = crate::auth::helper::require_user_id(&headers, &state.pool).await {
        return err.into_response();
    }
    let bytes = match axum::body::to_bytes(request.into_body(), 64 * 1024).await {
        Ok(bytes) => bytes,
        Err(_) => {
            return (
                StatusCode::PAYLOAD_TOO_LARGE,
                Json(serde_json::json!({"error": {"code": "PAYLOAD_TOO_LARGE"}})),
            )
                .into_response()
        }
    };
    let body: SignRequest = match serde_json::from_slice(&bytes) {
        Ok(body) => body,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": {"code": "INVALID_JSON"}})),
            )
                .into_response()
        }
    };
    let cfg = MediaConfig::current();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0);
    let mut items: Vec<MediaLink> = Vec::new();
    for path in body.paths.iter().take(MAX_SIGN_PATHS) {
        if let Some(link) = link_for(cfg, path, now) {
            if items.iter().any(|seen| seen.path == link.path) {
                continue;
            }
            items.push(link);
        }
    }
    Json(serde_json::json!({ "items": items })).into_response()
}


// --- Uploads (owner spec S8) ----------------------------------------------

/// Authenticated endpoint that stores a user document for the agent.
pub const UPLOAD_ROUTE: &str = "/api/hermes/upload";

/// The directory the agent can read, created on the first upload.
const DEFAULT_UPLOAD_DIR: &str = "/opt/data/uploads";
/// One request may carry this many files; the runs endpoint uses the same cap.
const MAX_UPLOAD_FILES: usize = 20;
/// Per-file ceiling. The body itself is streamed, so this bounds disk, not RAM.
const MAX_UPLOAD_BYTES: u64 = 25 * 1024 * 1024;
/// Long names are truncated (extension kept) so the path stays predictable.
const MAX_UPLOAD_NAME: usize = 80;
/// Prefix of an in-flight upload. `sanitize_upload_name` strips leading dots,
/// so no real upload can match it and the startup sweep cannot delete one.
const LEFTOVER_PREFIX: &str = ".partial-";

static UPLOAD_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Where uploads land, and the base the agent-facing URL is built from.
#[derive(Clone, Debug)]
pub struct UploadConfig {
    pub dir: PathBuf,
    /// `HERMES_PUBLIC_BASE_URL` when the owner sets it; otherwise the request's
    /// own scheme/host (the LAN address the browser used) is the fallback.
    pub public_base: Option<String>,
}

impl UploadConfig {
    pub fn from_env() -> Self {
        let dir = std::env::var("HERMES_UPLOAD_DIR")
            .ok()
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(DEFAULT_UPLOAD_DIR));
        let public_base = std::env::var("HERMES_PUBLIC_BASE_URL")
            .ok()
            .map(|raw| raw.trim().trim_end_matches('/').to_string())
            .filter(|raw| !raw.is_empty());
        Self { dir, public_base }
    }

    pub fn current() -> &'static UploadConfig {
        static CONFIG: OnceLock<UploadConfig> = OnceLock::new();
        CONFIG.get_or_init(UploadConfig::from_env)
    }
}

#[derive(Debug, Serialize)]
pub struct UploadedFile {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub mime: String,
    pub url: String,
}

/// Last path segment only, restricted to `[A-Za-z0-9._-]`, no leading dots.
///
/// This is what stops `../../etc/passwd` and Windows-style separators from
/// choosing the destination, and it keeps the agent-facing URL guessable.
pub fn sanitize_upload_name(raw: &str) -> Option<String> {
    let last = raw
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .trim();
    if last.is_empty() || last == "." || last == ".." {
        return None;
    }
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
    while clean.starts_with('.') {
        clean.remove(0);
    }
    if clean.is_empty() {
        return None;
    }
    if clean.len() > MAX_UPLOAD_NAME {
        let extension = clean
            .rsplit_once('.')
            .map(|(_, ext)| ext.to_string())
            .filter(|ext| !ext.is_empty() && ext.len() <= 16);
        let budget = MAX_UPLOAD_NAME - extension.as_ref().map(|ext| ext.len() + 1).unwrap_or(0);
        let stem: String = clean.chars().take(budget).collect();
        clean = match extension {
            Some(ext) => format!("{stem}.{ext}"),
            None => stem,
        };
    }
    Some(clean)
}

/// Collision-free stored name: a monotonic suffix keeps two uploads of the same
/// document from overwriting each other (`create_new` would otherwise fail).
pub fn unique_upload_name(name: &str) -> String {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0);
    let seq = UPLOAD_COUNTER.fetch_add(1, Ordering::Relaxed);
    let raw = format!("{stamp:x}{seq:x}");
    let tail = &raw[raw.len().saturating_sub(12)..];
    format!("{tail}-{name}")
}

fn upload_error(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        Json(serde_json::json!({"error": {"code": code, "message": message}})),
    )
        .into_response()
}

fn upload_unavailable() -> Response {
    upload_error(
        StatusCode::SERVICE_UNAVAILABLE,
        "HERMES_UPLOAD_UNAVAILABLE",
        "the upload directory is not writable",
    )
}

/// Scheme + host for the URL the agent will fetch. Reverse proxies set
/// `X-Forwarded-*`; direct LAN access keeps `Host`.
fn public_base(headers: &HeaderMap, configured: Option<&str>, trust_forwarded: bool) -> String {
    if let Some(base) = configured {
        return base.to_string();
    }
    // Forwarded headers are a hint from a *trusted* proxy only. Honouring them
    // unconditionally lets an authenticated caller mint the agent-facing URL as
    // `http://attacker/...` with a valid signature for the real file, and the
    // agent would then fetch the bait host. Off unless `HERMES_TRUST_FORWARDED=1`
    // declares that the dashboard sits behind Dokploy's Traefik.
    let trusted_proxy = trust_forwarded;
    let host = if trusted_proxy {
        headers.get("x-forwarded-host")
    } else {
        None
    }
    .or_else(|| headers.get(header::HOST))
    .and_then(|value| value.to_str().ok())
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .unwrap_or("localhost");
    let proto = if trusted_proxy {
        headers.get("x-forwarded-proto")
    } else {
        None
    }
    .and_then(|value| value.to_str().ok())
    .map(str::trim)
    .filter(|value| matches!(*value, "http" | "https"))
    .unwrap_or("http");
    format!("{proto}://{host}")
}

/// Backstop for one multipart body: the per-file budget times the file cap plus
/// room for part headers, so a rejected batch is cut off before it can stream
/// unbounded bytes into the container's network stack.
pub const fn upload_body_limit() -> usize {
    (MAX_UPLOAD_FILES as u64 * MAX_UPLOAD_BYTES + 1024 * 1024) as usize
}

/// Whether proxy headers may set the agent-facing URL (`HERMES_TRUST_FORWARDED=1`).
fn trust_forwarded_env() -> bool {
    matches!(std::env::var("HERMES_TRUST_FORWARDED").as_deref(), Ok("1"))
}

/// Store every `files` field of one multipart body.
///
/// Each field is written chunk by chunk (`field.chunk()`), so a 25 MB document
/// costs disk and network time but never 25 MB of RAM; exceeding `limit` aborts
/// that file and removes the partial byte stream from disk.
///
/// A rejected batch leaves **nothing** behind: a file that was already written
/// when a later field fails would be an orphan on the Hermes volume that no URL
/// ever points to, so every path recorded in `written` is removed on error.
pub async fn store_uploads(
    config: &UploadConfig,
    media: &MediaConfig,
    base: &str,
    limit: u64,
    multipart: Multipart,
) -> Result<Vec<UploadedFile>, Response> {
    let mut written: Vec<PathBuf> = Vec::new();
    let result = collect_uploads(config, media, base, limit, multipart, &mut written).await;
    if result.is_err() {
        for path in &written {
            let _ = tokio::fs::remove_file(path).await;
        }
    }
    result
}

pub async fn collect_uploads(
    config: &UploadConfig,
    media: &MediaConfig,
    base: &str,
    limit: u64,
    mut multipart: Multipart,
    written: &mut Vec<PathBuf>,
) -> Result<Vec<UploadedFile>, Response> {
    if tokio::fs::create_dir_all(&config.dir).await.is_err() {
        return Err(upload_unavailable());
    }
    let mut stored: Vec<UploadedFile> = Vec::new();
    loop {
        let field = match multipart.next_field().await {
            Ok(Some(field)) => field,
            Ok(None) => break,
            Err(err) => {
                return Err(multipart_failure(
                    err.status(),
                    "the multipart body could not be parsed",
                ))
            }
        };
        if field.name() != Some("files") {
            continue;
        }
        if stored.len() >= MAX_UPLOAD_FILES {
            return Err(upload_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "TOO_MANY_FILES",
                "too many files in one upload",
            ));
        }
        let raw_name = field.file_name().unwrap_or_default().to_string();
        let Some(name) = sanitize_upload_name(&raw_name) else {
            return Err(upload_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "VALIDATION_ERROR",
                "the uploaded file has no usable name",
            ));
        };
        let stored_name = unique_upload_name(&name);
        let final_path = config.dir.join(&stored_name);
        // `.partial-<unique>` until the last chunk arrives. An aborted connection
        // drops this future without running any cleanup code, so bytes written
        // straight to the final name would survive as a file no URL points at
        // and nothing deletes; the rename below is what publishes the file.
        // The leading dot matters: `sanitize_upload_name` strips those, so a user
        // file can never be named like a partial and the startup sweep can never
        // delete a real upload.
        let part_path = config.dir.join(format!("{LEFTOVER_PREFIX}{stored_name}"));
        let mut file = match tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&part_path)
            .await
        {
            Ok(file) => file,
            Err(_) => return Err(upload_unavailable()),
        };
        let mut size: u64 = 0;
        let mut too_large = false;
        let mut field = field;
        loop {
            match field.chunk().await {
                Ok(Some(chunk)) => {
                    size += chunk.len() as u64;
                    if size > limit {
                        too_large = true;
                        break;
                    }
                    if file.write_all(&chunk).await.is_err() {
                        drop(file);
                        let _ = tokio::fs::remove_file(&part_path).await;
                        return Err(upload_unavailable());
                    }
                }
                Ok(None) => break,
                Err(err) => {
                    drop(file);
                    let _ = tokio::fs::remove_file(&part_path).await;
                    return Err(multipart_failure(
                        err.status(),
                        "the multipart body could not be read",
                    ));
                }
            }
        }
        drop(file);
        if too_large {
            let _ = tokio::fs::remove_file(&part_path).await;
            return Err(upload_error(
                StatusCode::PAYLOAD_TOO_LARGE,
                "PAYLOAD_TOO_LARGE",
                "the file is larger than the upload budget",
            ));
        }
        if tokio::fs::rename(&part_path, &final_path).await.is_err() {
            let _ = tokio::fs::remove_file(&part_path).await;
            return Err(upload_unavailable());
        }
        // Record it before building the entry: from here on, a failure in a
        // later field must delete this file along with the ones already stored.
        written.push(final_path.clone());
        let mime = mime_for(&final_path).to_string();
        let path_string = final_path.to_string_lossy().to_string();
        let url = format!("{base}{}", media.signed_url(&path_string, unix_now()));
        stored.push(UploadedFile {
            path: path_string,
            name: stored_name,
            size,
            mime,
            url,
        });
    }
    if stored.is_empty() {
        return Err(upload_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_ERROR",
            "no files were uploaded",
        ));
    }
    Ok(stored)
}

/// Translate a multipart failure into the response the client sees.
///
/// The status comes from the error itself: a body past the route's
/// `DefaultBodyLimit` is a 413, and reporting it as the 400 a malformed body
/// gets would tell the user their request was invalid instead of too large.
fn multipart_failure(status: StatusCode, message: &str) -> Response {
    if status == StatusCode::PAYLOAD_TOO_LARGE {
        upload_error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "PAYLOAD_TOO_LARGE",
            "the upload body is larger than the configured limit",
        )
    } else {
        upload_error(StatusCode::BAD_REQUEST, "INVALID_MULTIPART", message)
    }
}

/// Remove `.partial-*` files an interrupted upload left behind.
///
/// A dropped handler future cannot run its cleanup, so the partial file stays
/// on the Hermes volume until the next start. It is safe to delete: the final
/// name only exists after a successful rename, so nothing ever pointed at the
/// partial, and no real upload can carry this prefix because
/// `sanitize_upload_name` strips leading dots. Called once at startup, never
/// per request.
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

/// `POST /api/hermes/upload` — session-only, like the rest of `/api/hermes`.
pub async fn upload_handler(
    State(state): State<crate::state::AppState>,
    Extension(config): Extension<UploadConfig>,
    headers: HeaderMap,
    multipart: Multipart,
) -> Response {
    // Auth before the body is read: an anonymous caller never gets a parse
    // error that describes the shape of the request.
    if let Err(err) = crate::auth::helper::require_session_user_id(&headers, &state.pool).await {
        return err.into_response();
    }
    let media = MediaConfig::current();
    let base = public_base(&headers, config.public_base.as_deref(), trust_forwarded_env());
    match store_uploads(&config, media, &base, MAX_UPLOAD_BYTES, multipart).await {
        Ok(items) => (
            StatusCode::CREATED,
            Json(serde_json::json!({ "items": items })),
        )
            .into_response(),
        Err(response) => response,
    }
}

pub async fn media_handler(
    Extension(cfg): Extension<MediaConfig>,
    Query(query): Query<MediaQuery>,
    headers: HeaderMap,
) -> Response {
    let now = unix_now();
    let Some(path) = query.path.as_deref().filter(|path| !path.is_empty()) else {
        return plain_error(StatusCode::BAD_REQUEST, "missing path");
    };
    let Some(exp) = query.exp else {
        return plain_error(StatusCode::BAD_REQUEST, "missing exp");
    };
    let Some(sig) = query.sig.as_deref() else {
        return plain_error(StatusCode::BAD_REQUEST, "missing sig");
    };
    if !cfg.verify(path, exp, sig, now) {
        return plain_error(StatusCode::UNAUTHORIZED, "invalid or expired link");
    }
    let Some(resolved) = cfg.resolve(path) else {
        // Covers missing files, directories, `..` escapes and symlink escapes.
        return plain_error(StatusCode::NOT_FOUND, "file not available");
    };
    let requested_name = requested_download_name(&query);
    serve_resolved(resolved, requested_name, query.download.is_some(), headers).await
}

/// Serve a path-under-a-root endpoint (`GET /files/*path`).
///
/// The links the chat puts in front of a user must survive a page reload and
/// be pasteable into a browser or `curl`, so this route is addressed by path
/// alone. Three guarantees keep that from becoming an arbitrary-file-read:
///
/// * the path is rejected when any component is `..`, before touching disk;
/// * `MediaConfig::resolve` canonicalizes what is left and requires the result
///   to stay inside an allowlisted root, which also stops symlink escapes;
/// * a miss answers a real `404` with a small body, never the static build's
///   `index.html` (that would hand a JSON consumer an HTML page with 200).
pub async fn files_handler(
    Extension(cfg): Extension<MediaConfig>,
    axum::extract::Path(raw): axum::extract::Path<String>,
    Query(query): Query<MediaQuery>,
    headers: HeaderMap,
) -> Response {
    // DNS rebinding points an attacker hostname at this server, so a forged
    // `Host` is the only signal left that the caller is not the dashboard. The
    // guard activates with `HERMES_PUBLIC_BASE_URL`; unset keeps the route as
    // declared in D-A2.
    if !host_is_expected(&headers, std::env::var("HERMES_PUBLIC_BASE_URL").ok().as_deref()) {
        return plain_error(StatusCode::FORBIDDEN, "unexpected host");
    }
    if raw.is_empty() || raw.split(['/', '\\']).any(|segment| segment == "..") {
        return plain_error(StatusCode::NOT_FOUND, "file not available");
    }
    let path = format!("/{}", raw.trim_start_matches('/'));
    let Some(resolved) = cfg.resolve(&path) else {
        return plain_error(StatusCode::NOT_FOUND, "file not available");
    };
    let requested_name = requested_download_name(&query);
    serve_resolved(resolved, requested_name, query.download.is_some(), headers).await
}

/// Does the request target the configured public base?
///
/// `<img src>` and a pasted link cannot carry a bearer, so `/files` is
/// addressed by path alone. When the operator states the public base, a request
/// naming another `Host` is refused: after a DNS rebind the browser still sends
/// the attacker's hostname, which is the one fact the attacker cannot rewrite.
fn host_is_expected(headers: &HeaderMap, configured: Option<&str>) -> bool {
    let Some(configured) = configured.map(str::trim).filter(|value| !value.is_empty()) else {
        return true;
    };
    let Some((_, after_scheme)) = configured.split_once("://") else {
        return true;
    };
    let expected = after_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .trim();
    if expected.is_empty() {
        return true;
    }
    match headers.get(header::HOST).and_then(|value| value.to_str().ok()) {
        Some(host) => host.eq_ignore_ascii_case(expected),
        None => false,
    }
}

/// `download=1` is the boolean form used by the cards; `download=<name>` is
/// accepted when the caller wants an explicit file name.
fn requested_download_name(query: &MediaQuery) -> Option<String> {
    query
        .download
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .filter(|value| {
            !matches!(
                value.to_ascii_lowercase().as_str(),
                "1" | "true" | "yes"
            )
        })
        .map(str::to_string)
}

/// Serve one resolved file: MIME, ranges, validators and disposition.
async fn serve_resolved(
    resolved: PathBuf,
    requested_name: Option<String>,
    download: bool,
    headers: HeaderMap,
) -> Response {
    let metadata = match tokio::fs::metadata(&resolved).await {
        Ok(metadata) if metadata.is_file() => metadata,
        _ => return plain_error(StatusCode::NOT_FOUND, "file not available"),
    };
    let len = metadata.len();
    let mime = mime_for(&resolved);
    let name = requested_name.unwrap_or_else(|| file_name(&resolved));

    let modified = metadata.modified().ok();
    let etag = modified
        .map(|time| {
            let secs = time
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            format!("\"{len}-{secs}\"")
        })
        .unwrap_or_else(|| format!("\"{len}\""));

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
            .unwrap_or_else(|_| plain_error(StatusCode::INTERNAL_SERVER_ERROR, "range error"));
    }

    if range.is_none() {
        if let Some(inm) = headers
            .get(header::IF_NONE_MATCH)
            .and_then(|value| value.to_str().ok())
        {
            if inm.split(',').any(|candidate| candidate.trim() == etag) {
                return Response::builder()
                    .status(StatusCode::NOT_MODIFIED)
                    .header(header::ETAG, etag)
                    .body(Body::empty())
                    .unwrap_or_else(|_| plain_error(StatusCode::INTERNAL_SERVER_ERROR, "etag"));
            }
        }
    }

    let (status, start, length) = match range.as_ref() {
        Some(range) => (StatusCode::PARTIAL_CONTENT, range.start, range.len()),
        None => (StatusCode::OK, 0, len),
    };

    let mut file = match tokio::fs::File::open(&resolved).await {
        Ok(file) => file,
        Err(_) => return plain_error(StatusCode::NOT_FOUND, "file not available"),
    };
    if start > 0 && file.seek(std::io::SeekFrom::Start(start)).await.is_err() {
        return plain_error(StatusCode::INTERNAL_SERVER_ERROR, "seek failed");
    }
    let stream = ReaderStream::new(file.take(length));
    let body = Body::from_stream(stream);

    let mut builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, mime)
        .header(header::CONTENT_LENGTH, length.to_string())
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::ETAG, etag)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CACHE_CONTROL, "private, max-age=60");
    builder = builder.header(
        header::CONTENT_DISPOSITION,
        disposition(
            if streamable(mime) && !download {
                "inline"
            } else {
                "attachment"
            },
            &name,
        ),
    );
    if let Some(modified) = modified {
        builder = builder.header(header::LAST_MODIFIED, http_date(modified));
    }
    if let Some(range) = range {
        builder = builder.header(
            header::CONTENT_RANGE,
            format!("bytes {}-{}/{len}", range.start, range.end),
        );
    }
    builder.body(body).unwrap_or_else(|_| {
        plain_error(StatusCode::INTERNAL_SERVER_ERROR, "could not build response")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::Request,
        routing::get,
        Router,
    };
    use tower::ServiceExt;

    fn config(root: &Path) -> MediaConfig {
        MediaConfig::new(vec![root.to_path_buf()], b"test-secret".to_vec(), 600)
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "hermes-media-{tag}-{}-{}",
            std::process::id(),
            unix_now()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn app(cfg: MediaConfig) -> Router {
        Router::new()
            .route(MEDIA_ROUTE, get(media_handler))
            .layer(Extension(cfg))
    }

    async fn body_bytes(response: Response) -> Vec<u8> {
        axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec()
    }

    #[test]
    fn hmac_matches_rfc4231_case_2() {
        assert_eq!(
            hex::encode(hmac_sha256(b"Jefe", b"what do ya want for nothing?")),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
    }

    #[test]
    fn an_unconfigured_secret_is_random_not_a_public_constant() {
        let a = random_secret();
        let b = random_secret();
        assert_eq!(a.len(), 32);
        assert_eq!(b.len(), 32);
        assert_ne!(a, b, "a per-boot secret must not be a fixed value");
    }

    #[test]
    fn signature_rejects_tampering_and_expiry() {
        let cfg = MediaConfig::new(vec![PathBuf::from("/opt/data")], b"k".to_vec(), 600);
        let now = 1_000;
        let url = cfg.signed_url("/opt/data/a.mp4", now);
        let path = "/opt/data/a.mp4";
        let exp = now + 600;
        let sig = cfg.signature(path, exp);
        assert!(cfg.verify(path, exp, &sig, now));
        assert!(!cfg.verify("/opt/data/b.mp4", exp, &sig, now));
        assert!(!cfg.verify(path, exp, &sig, exp + 1));
        assert!(!cfg.verify(path, exp, "deadbeef", now));
        assert!(url.contains("exp="));
    }

    #[test]
    fn percent_encode_keeps_slashes_and_escapes_spaces() {
        assert_eq!(
            percent_encode("/opt/data/mi video (1).mp4"),
            "/opt/data/mi%20video%20%281%29.mp4"
        );
        assert_eq!(percent_encode("/opt/data/ñ.pdf"), "/opt/data/%C3%B1.pdf");
    }

    #[test]
    fn range_parser_handles_the_three_forms() {
        assert_eq!(parse_range("bytes=0-9", 100), Some(ByteRange { start: 0, end: 9 }));
        assert_eq!(parse_range("bytes=90-", 100), Some(ByteRange { start: 90, end: 99 }));
        assert_eq!(parse_range("bytes=-10", 100), Some(ByteRange { start: 90, end: 99 }));
        assert_eq!(parse_range("bytes=50-500", 100), Some(ByteRange { start: 50, end: 99 }));
        assert_eq!(parse_range("bytes=0-1,5-6", 100), None);
        assert_eq!(parse_range("items=0-1", 100), None);
        assert_eq!(parse_range("bytes=9-2", 100), None);
    }

    #[test]
    fn mime_table_covers_the_spec_extensions() {
        for (name, expected) in [
            ("a.mp4", "video/mp4"),
            ("a.webm", "video/webm"),
            ("a.mp3", "audio/mpeg"),
            ("a.wav", "audio/wav"),
            ("a.pdf", "application/pdf"),
            ("a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
            ("a.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            ("a.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
            ("a.zip", "application/zip"),
            ("a.bin", "application/octet-stream"),
        ] {
            assert_eq!(mime_for(Path::new(name)), expected, "{name}");
        }
    }

    #[tokio::test]
    async fn serves_a_document_as_an_attachment() {
        let dir = temp_dir("doc");
        let file = dir.join("ensayo-celula.docx");
        std::fs::write(&file, b"PK\x03\x04docx-bytes").unwrap();
        let cfg = config(&dir);
        let url = cfg.signed_url(file.to_str().unwrap(), unix_now());
        let response = app(cfg)
            .oneshot(Request::get(url).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()[header::CONTENT_TYPE],
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
        let disposition = response.headers()[header::CONTENT_DISPOSITION]
            .to_str()
            .unwrap()
            .to_string();
        assert!(disposition.starts_with("attachment;"));
        assert!(disposition.contains("ensayo-celula.docx"));
        assert_eq!(body_bytes(response).await, b"PK\x03\x04docx-bytes");
    }

    #[tokio::test]
    async fn serves_video_inline_with_ranges() {
        let dir = temp_dir("video");
        let file = dir.join("clip.mp4");
        let payload: Vec<u8> = (0..=255u8).collect();
        std::fs::write(&file, &payload).unwrap();
        let cfg = config(&dir);
        let url = cfg.signed_url(file.to_str().unwrap(), unix_now());

        let full = app(cfg.clone())
            .oneshot(Request::get(&url).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(full.status(), StatusCode::OK);
        assert_eq!(full.headers()[header::ACCEPT_RANGES], "bytes");
        assert!(full.headers()[header::CONTENT_DISPOSITION]
            .to_str()
            .unwrap()
            .starts_with("inline"));

        let partial = app(cfg.clone())
            .oneshot(
                Request::get(&url)
                    .header(header::RANGE, "bytes=10-19")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(partial.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(partial.headers()[header::CONTENT_RANGE], "bytes 10-19/256");
        assert_eq!(partial.headers()[header::CONTENT_LENGTH], "10");
        assert_eq!(body_bytes(partial).await, payload[10..=19].to_vec());

        let unsatisfiable = app(cfg)
            .oneshot(
                Request::get(&url)
                    .header(header::RANGE, "bytes=999-")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(unsatisfiable.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(
            unsatisfiable.headers()[header::CONTENT_RANGE],
            "bytes */256"
        );
    }

    #[tokio::test]
    async fn streams_a_large_file_without_buffering_it() {
        let dir = temp_dir("large");
        let file = dir.join("big.mp4");
        let handle = std::fs::File::create(&file).unwrap();
        handle.set_len(41 * 1024 * 1024).unwrap();
        drop(handle);
        let cfg = config(&dir);
        let url = cfg.signed_url(file.to_str().unwrap(), unix_now());
        let response = app(cfg)
            .oneshot(
                Request::get(&url)
                    .header(header::RANGE, "bytes=-24")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.headers()[header::CONTENT_LENGTH], "24");
        assert_eq!(body_bytes(response).await.len(), 24);
    }

    #[tokio::test]
    async fn refuses_paths_outside_the_allowed_roots() {
        let root = temp_dir("root");
        let outside = temp_dir("outside");
        let secret = outside.join("secret.txt");
        std::fs::write(&secret, b"do-not-serve").unwrap();
        let cfg = config(&root);
        let url = cfg.signed_url(secret.to_str().unwrap(), unix_now());
        let response = app(cfg)
            .oneshot(Request::get(url).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn refuses_traversal_symlinks_and_bad_signatures() {
        let root = temp_dir("traversal");
        let outside = temp_dir("traversal-outside");
        let secret = outside.join("secret.txt");
        std::fs::write(&secret, b"nope").unwrap();
        let link = root.join("escape.txt");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&secret, &link).unwrap();

        let cfg = config(&root);
        let now = unix_now();

        let escaped = cfg.signed_url(link.to_str().unwrap(), now);
        let response = app(cfg.clone())
            .oneshot(Request::get(escaped).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);

        let traversal = format!(
            "{MEDIA_ROUTE}?path=/opt/data/../../etc/passwd&exp={}&sig={}",
            now + 60,
            cfg.signature("/opt/data/../../etc/passwd", now + 60)
        );
        let response = app(cfg.clone())
            .oneshot(Request::get(traversal).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);

        let file = root.join("ok.txt");
        std::fs::write(&file, b"ok").unwrap();
        let bad = format!(
            "{MEDIA_ROUTE}?path={}&exp={}&sig=deadbeef",
            percent_encode(file.to_str().unwrap()),
            now + 60
        );
        let response = app(cfg)
            .oneshot(Request::get(bad).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn forced_download_overrides_inline_media() {
        let dir = temp_dir("download");
        let file = dir.join("clip.mp4");
        std::fs::write(&file, b"video").unwrap();
        let cfg = config(&dir);
        let url = format!(
            "{}&download=clip-final.mp4",
            cfg.signed_url(file.to_str().unwrap(), unix_now())
        );
        let response = app(cfg)
            .oneshot(Request::get(url).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let disposition = response.headers()[header::CONTENT_DISPOSITION]
            .to_str()
            .unwrap()
            .to_string();
        assert!(disposition.starts_with("attachment;"));
        assert!(disposition.contains("clip-final.mp4"));
    }

    #[tokio::test]
    async fn svg_is_never_inline() {
        let dir = temp_dir("svg");
        let file = dir.join("evil.svg");
        std::fs::write(&file, b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>").unwrap();
        let cfg = config(&dir);
        let url = cfg.signed_url(file.to_str().unwrap(), unix_now());
        let response = app(cfg)
            .oneshot(Request::get(url).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let disposition = response.headers()[header::CONTENT_DISPOSITION]
            .to_str()
            .unwrap()
            .to_string();
        assert!(
            disposition.starts_with("attachment;"),
            "an SVG must download, never render in this origin: {disposition}"
        );
    }

    #[tokio::test]
    async fn download_one_keeps_the_real_file_name() {
        let dir = temp_dir("download-one");
        let file = dir.join("ensayo-celula.docx");
        std::fs::write(&file, b"PK").unwrap();
        let cfg = config(&dir);
        let url = format!(
            "{}&download=1",
            cfg.signed_url(file.to_str().unwrap(), unix_now())
        );
        let response = app(cfg)
            .oneshot(Request::get(url).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let disposition = response.headers()[header::CONTENT_DISPOSITION]
            .to_str()
            .unwrap()
            .to_string();
        assert!(disposition.starts_with("attachment;"), "{disposition}");
        assert!(disposition.contains("ensayo-celula.docx"), "{disposition}");
        assert!(!disposition.contains("filename=\"1\""), "{disposition}");
    }

    #[tokio::test]
    async fn etag_makes_a_second_get_cheap() {
        let dir = temp_dir("etag");
        let file = dir.join("a.txt");
        std::fs::write(&file, b"hello").unwrap();
        let cfg = config(&dir);
        let url = cfg.signed_url(file.to_str().unwrap(), unix_now());
        let first = app(cfg.clone())
            .oneshot(Request::get(&url).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let etag = first.headers()[header::ETAG].to_str().unwrap().to_string();
        let second = app(cfg)
            .oneshot(
                Request::get(&url)
                    .header(header::IF_NONE_MATCH, etag)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(second.status(), StatusCode::NOT_MODIFIED);
        assert!(body_bytes(second).await.is_empty());
    }

    fn files_app(cfg: MediaConfig) -> Router {
        Router::new()
            .route(FILES_ROUTE, get(files_handler))
            .layer(Extension(cfg))
    }

    fn files_url(dir: &Path, name: &str) -> String {
        // The wildcard arrives without its leading slash; the temp dir is the
        // configured root, so the URL mirrors a real `/opt/data/...` path.
        format!("/files{}/{name}", dir.to_str().unwrap())
    }

    #[tokio::test]
    async fn files_route_serves_bytes_with_the_real_mime() {
        let dir = temp_dir("files-png");
        let file = dir.join("prueba_hermes.png");
        let payload = b"\x89PNG\r\n\x1a\n-fake-png".to_vec();
        std::fs::write(&file, &payload).unwrap();
        let response = files_app(config(&dir))
            .oneshot(Request::get(files_url(&dir, "prueba_hermes.png")).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "image/png");
        assert_eq!(response.headers()[header::ACCEPT_RANGES], "bytes");
        assert_eq!(response.headers()[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
        assert_eq!(
            response.headers()[header::CONTENT_LENGTH].to_str().unwrap(),
            payload.len().to_string()
        );
        assert_eq!(body_bytes(response).await, payload);
    }

    #[tokio::test]
    async fn files_route_answers_a_real_404_without_the_spa_html() {
        let dir = temp_dir("files-404");
        let response = files_app(config(&dir))
            .oneshot(Request::get(files_url(&dir, "no-existe.png")).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_string();
        assert!(!content_type.contains("text/html"), "must not be the SPA: {content_type}");
        let body = String::from_utf8(body_bytes(response).await).unwrap();
        assert!(!body.to_lowercase().contains("<!doctype html"), "SPA html leaked: {body}");
    }

    #[tokio::test]
    async fn files_route_refuses_traversal_and_paths_outside_the_roots() {
        let dir = temp_dir("files-traversal");
        let outside = dir.join("..").join("secreto.txt");
        std::fs::write(&outside, b"do not serve").unwrap();
        let inside = dir.join("ok.png");
        std::fs::write(&inside, b"png").unwrap();
        let app = files_app(config(&dir));
        // A `..` that stays inside the root is served by the filesystem if the
        // explicit segment guard is removed, so this case can only pass for the
        // reason the spec names ("rechazar peticiones con ..").
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("sub").join("nota.txt"), b"sub").unwrap();
        for url in [
            format!("/files{}/../secreto.txt", dir.to_str().unwrap()),
            format!("/files{}/%2e%2e/secreto.txt", dir.to_str().unwrap()),
            format!("/files{}/sub/../ok.png", dir.to_str().unwrap()),
            format!("/files{}/sub/%2e%2e/ok.png", dir.to_str().unwrap()),
            "/files/etc/passwd".to_string(),
            "/files/opt/data/auth.json".to_string(),
        ] {
            let response = app
                .clone()
                .oneshot(Request::get(&url).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{url} must not be served");
        }
        let ok = app
            .oneshot(Request::get(files_url(&dir, "ok.png")).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(ok.status(), StatusCode::OK);
    }

    #[test]
    fn a_symlinked_root_is_refused_instead_of_resolved_to_its_target() {
        let dir = temp_dir("files-symlink-root");
        let target = dir.join("shared");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("auth.json"), b"secret").unwrap();
        let link = dir.join("scratch");
        std::os::unix::fs::symlink(&target, &link).unwrap();

        let cfg = MediaConfig::new(vec![link.clone()], b"k".to_vec(), 600);
        // Without the guard, `canonicalize(link)` is the target and a file under
        // it would pass `starts_with`.
        assert!(
            cfg.resolve(target.join("auth.json").to_str().unwrap()).is_none(),
            "a symlinked root must not become an allowlist entry"
        );
        assert!(cfg.resolve(link.join("auth.json").to_str().unwrap()).is_none());
    }

    #[test]
    fn the_host_guard_activates_only_with_a_configured_public_base() {
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, HeaderValue::from_static("panel.test:8055"));
        assert!(host_is_expected(&headers, None));
        assert!(host_is_expected(&headers, Some("https://panel.test:8055")));
        assert!(!host_is_expected(&headers, Some("https://otro.test")));
        assert!(!host_is_expected(&headers, Some("http://panel.test")));

        let mut rebind = HeaderMap::new();
        rebind.insert(header::HOST, HeaderValue::from_static("evil.test:8055"));
        assert!(!host_is_expected(&rebind, Some("https://panel.test:8055")));

        let empty = HeaderMap::new();
        assert!(!host_is_expected(&empty, Some("https://panel.test")));
        // A malformed configuration must not lock the owner out.
        assert!(host_is_expected(&empty, Some("panel.test")));
    }

    #[tokio::test]
    async fn files_route_forces_attachment_for_documents() {
        let dir = temp_dir("files-docx");
        let payload = b"PK\x03\x04docx-bytes".to_vec();
        std::fs::write(dir.join("prueba_hermes.docx"), &payload).unwrap();
        let response = files_app(config(&dir))
            .oneshot(Request::get(files_url(&dir, "prueba_hermes.docx")).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()[header::CONTENT_TYPE],
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
        let disposition = response.headers()[header::CONTENT_DISPOSITION]
            .to_str()
            .unwrap()
            .to_string();
        assert!(disposition.starts_with("attachment;"), "{disposition}");
        assert!(disposition.contains("prueba_hermes.docx"), "{disposition}");
        assert_eq!(body_bytes(response).await, payload);
    }

    #[tokio::test]
    async fn files_route_streams_partial_content() {
        let dir = temp_dir("files-range");
        let payload: Vec<u8> = (0..64u8).collect();
        std::fs::write(dir.join("clip.mp4"), &payload).unwrap();
        let request = Request::get(files_url(&dir, "clip.mp4"))
            .header(header::RANGE, "bytes=10-19")
            .body(Body::empty())
            .unwrap();
        let response = files_app(config(&dir)).oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            response.headers()[header::CONTENT_RANGE].to_str().unwrap(),
            "bytes 10-19/64"
        );
        assert_eq!(body_bytes(response).await, payload[10..20].to_vec());
    }
}

#[cfg(test)]
mod upload_tests {
    use super::*;
    use axum::{
        body::Body,
        extract::{DefaultBodyLimit, FromRequest},
        http::Request,
        routing::post,
        Router,
    };

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "hermes-upload-{label}-{}-{}",
            std::process::id(),
            unix_now()
        ));
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn stored_names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .map(|entries| {
                entries
                    .flatten()
                    .filter_map(|entry| entry.file_name().into_string().ok())
                    .collect()
            })
            .unwrap_or_default();
        names.sort();
        names
    }

    /// Production-shaped state: the pool never connects, which is exactly what
    /// the "auth runs before the body" path needs.
    fn lazy_state() -> crate::state::AppState {
        use std::sync::Arc;
        crate::state::AppState {
            pool: sqlx::PgPool::connect_lazy("postgres://localhost:1/unused")
                .expect("lazy pool construction must succeed"),
            session_ttl_hours: 24,
            rate_limiter: Arc::new(crate::auth::rate_limit::LoginRateLimiter::new()),
            hermes: None,
        }
    }

    /// The upload route's layer stack, copied from `main.rs::assemble`.
    ///
    /// `assemble` also nests the other ~60 routes and carries the `/api`
    /// timeout, so this copy keeps the test hermetic while preserving the two
    /// things that matter here: the session-only handler and the whole-body
    /// `DefaultBodyLimit` layer in front of it. `limit` is a parameter because
    /// the production cap is ~501 MB (pinned by
    /// `the_upload_body_cap_is_the_production_one`).
    fn upload_app(state: crate::state::AppState, dir: PathBuf, limit: usize) -> Router {
        Router::new()
            .route(
                UPLOAD_ROUTE,
                post(upload_handler)
                    .layer::<_, std::convert::Infallible>(DefaultBodyLimit::max(limit))
                    .layer::<_, std::convert::Infallible>(Extension(UploadConfig {
                        dir,
                        public_base: None,
                    })),
            )
            .with_state(state)
    }

    /// `store_uploads` without the session lookup: reaching `upload_handler`
    /// past auth needs a live `sessions` row (and this suite never touches the
    /// database), and the subject of the test below is the route's body cap,
    /// not auth — which `an_anonymous_upload_never_reaches_the_disk` covers.
    async fn store_without_auth(
        Extension(config): Extension<UploadConfig>,
        Extension(media): Extension<MediaConfig>,
        multipart: Multipart,
    ) -> Response {
        match store_uploads(&config, &media, "http://lan", MAX_UPLOAD_BYTES, multipart).await {
            Ok(items) => (
                StatusCode::CREATED,
                Json(serde_json::json!({ "items": items })),
            )
                .into_response(),
            Err(response) => response,
        }
    }

    fn multipart_body(parts: &[(&str, &str, &[u8])], boundary: &str) -> Vec<u8> {
        let mut out = Vec::new();
        for (field, filename, bytes) in parts {
            out.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
            out.extend_from_slice(
                format!(
                    "Content-Disposition: form-data; name=\"{field}\"; filename=\"{filename}\"\r\n"
                )
                .as_bytes(),
            );
            out.extend_from_slice(b"Content-Type: application/octet-stream\r\n\r\n");
            out.extend_from_slice(bytes);
            out.extend_from_slice(b"\r\n");
        }
        out.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
        out
    }

    async fn multipart_request(parts: &[(&str, &str, &[u8])]) -> Multipart {
        let boundary = "BOUNDARY";
        let body = multipart_body(parts, boundary);
        let request = Request::builder()
            .header(
                "content-type",
                format!("multipart/form-data; boundary={boundary}"),
            )
            .body(Body::from(body))
            .expect("multipart request");
        Multipart::from_request(request, &())
            .await
            .expect("multipart extractor")
    }

    fn query_value(url: &str, key: &str) -> String {
        let query = url.split_once('?').expect("query").1;
        query
            .split('&')
            .find_map(|pair| pair.strip_prefix(&format!("{key}=")))
            .unwrap_or_else(|| panic!("missing {key} in {url}"))
            .to_string()
    }

    #[test]
    fn the_allowlist_excludes_the_hermes_home() {
        // `/opt/data` holds .env, auth.json and config.yaml: a signed link for
        // any file directly under it would be a credential leak.
        assert!(!DEFAULT_ROOTS.contains(&"/opt/data"));
        for root in [
            "/opt/data/cache/scratch",
            "/opt/data/cache/documents",
            "/opt/data/entregables",
            "/opt/data/uploads",
            "/opt/data/documentos_generados",
            "/tmp",
        ] {
            assert!(DEFAULT_ROOTS.contains(&root), "missing root {root}");
        }
    }

    /// The constant alone proves nothing: what matters is that `resolve` refuses
    /// a file that exists *next to* an allowed root (the `/opt/data/.env` case,
    /// reproduced with a temp tree because the real one needs root).
    #[tokio::test]
    async fn resolving_refuses_a_file_beside_an_allowed_root() {
        let base = temp_dir("roots");
        let allowed = base.join("cache").join("scratch");
        tokio::fs::create_dir_all(&allowed).await.expect("allowed root");
        let inside = allowed.join("render.png");
        tokio::fs::write(&inside, b"png").await.expect("inside file");
        let secret = base.join(".env");
        tokio::fs::write(&secret, b"SECRET=1").await.expect("secret file");

        let config = MediaConfig::new(vec![allowed.clone()], b"k".to_vec(), 600);
        assert!(
            config.resolve(inside.to_str().unwrap()).is_some(),
            "a file inside an allowed root must resolve"
        );
        assert!(
            config.resolve(secret.to_str().unwrap()).is_none(),
            "a file beside the root must not resolve"
        );
    }

    #[test]
    fn sanitizes_names_and_rejects_traversal_only_input() {
        assert_eq!(
            sanitize_upload_name("../../etc/passwd").as_deref(),
            Some("passwd")
        );
        assert_eq!(
            sanitize_upload_name("C:\\Users\\ana\\informe.docx").as_deref(),
            Some("informe.docx")
        );
        assert_eq!(sanitize_upload_name("mi informe (1).pdf").as_deref(), Some("mi_informe__1_.pdf"));
        assert_eq!(sanitize_upload_name(".."), None);
        assert_eq!(sanitize_upload_name("."), None);
        assert_eq!(sanitize_upload_name(""), None);
        assert_eq!(sanitize_upload_name("/"), None);
        // A leading dot would create a hidden file; it is stripped.
        assert_eq!(sanitize_upload_name(".env").as_deref(), Some("env"));
    }

    #[test]
    fn truncates_long_names_and_keeps_the_extension() {
        let long = format!("{}.pdf", "a".repeat(200));
        let name = sanitize_upload_name(&long).expect("name");
        assert!(name.len() <= MAX_UPLOAD_NAME);
        assert!(name.ends_with(".pdf"));
    }

    #[test]
    fn unique_names_never_collide() {
        let first = unique_upload_name("informe.pdf");
        let second = unique_upload_name("informe.pdf");
        assert_ne!(first, second);
        assert!(first.ends_with("-informe.pdf"));
    }

    #[test]
    fn the_upload_body_cap_is_the_production_one() {
        // `main.rs::assemble` mounts this exact number on the route. Axum's
        // 2 MiB default would reject a legitimate document and leave the
        // per-file 25 MB budget unreachable.
        assert_eq!(
            upload_body_limit(),
            MAX_UPLOAD_FILES * MAX_UPLOAD_BYTES as usize + 1024 * 1024
        );
        assert!(upload_body_limit() > 2 * 1024 * 1024);
    }

    #[tokio::test]
    async fn the_mounted_router_requires_a_session_for_uploads() {
        use tower::ServiceExt;
        // The real assembler from `main.rs`: proves the route is mounted at
        // `/api/hermes/upload` and that its handler authenticates.
        let app = crate::build_router(lazy_state(), None);
        let body = multipart_body(&[("files", "a.pdf", b"%PDF-1.7")], "BOUNDARY");
        let request = Request::post(UPLOAD_ROUTE)
            .header("content-type", "multipart/form-data; boundary=BOUNDARY")
            .body(Body::from(body))
            .expect("request");
        let response = app.oneshot(request).await.expect("response");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn an_anonymous_upload_never_reaches_the_disk() {
        use tower::ServiceExt;
        let dir = temp_dir("router-anon");
        let app = upload_app(lazy_state(), dir.clone(), upload_body_limit());
        let body = multipart_body(&[("files", "a.pdf", b"%PDF-1.7")], "BOUNDARY");
        let request = Request::post(UPLOAD_ROUTE)
            .header("content-type", "multipart/form-data; boundary=BOUNDARY")
            .body(Body::from(body))
            .expect("request");
        let response = app.oneshot(request).await.expect("response");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        // The handler answers before `next_field()`. A parsed body would have
        // created the directory and written the file.
        let leftover = stored_names(&dir);
        assert!(leftover.is_empty(), "anonymous upload wrote {leftover:?}");
    }

    #[tokio::test]
    async fn a_body_over_the_configured_limit_is_413_not_a_parse_error() {
        use tower::ServiceExt;
        let dir = temp_dir("router-limit");
        let media = MediaConfig::new(vec![dir.clone()], b"k".to_vec(), 600);
        // Same layer stack as `upload_app`, with a 64-byte cap: the production
        // cap is half a gigabyte (see `the_upload_body_cap_is_the_production_one`).
        let app = Router::new().route(
            UPLOAD_ROUTE,
            post(store_without_auth)
                .layer::<_, std::convert::Infallible>(DefaultBodyLimit::max(64))
                .layer::<_, std::convert::Infallible>(Extension(UploadConfig {
                    dir: dir.clone(),
                    public_base: None,
                }))
                .layer::<_, std::convert::Infallible>(Extension(media)),
        );
        let payload = [b'A'; 512];
        let body = multipart_body(&[("files", "grande.zip", &payload[..])], "BOUNDARY");
        let request = Request::post(UPLOAD_ROUTE)
            .header("content-type", "multipart/form-data; boundary=BOUNDARY")
            .body(Body::from(body))
            .expect("request");
        let response = app.oneshot(request).await.expect("response");
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
        let leftover = stored_names(&dir);
        assert!(leftover.is_empty(), "an over-limit body left {leftover:?}");
    }

    #[tokio::test]
    async fn an_unfinished_upload_is_written_under_a_part_name() {
        let dir = temp_dir("inflight");
        let config = UploadConfig {
            dir: dir.clone(),
            public_base: None,
        };
        let media = MediaConfig::new(vec![dir.clone()], b"k".to_vec(), 600);
        let boundary = "BOUNDARY";
        let (mut writer, reader) = tokio::io::duplex(64 * 1024);
        let request = Request::builder()
            .header(
                "content-type",
                format!("multipart/form-data; boundary={boundary}"),
            )
            .body(Body::from_stream(ReaderStream::new(reader)))
            .expect("streaming request");
        let multipart = Multipart::from_request(request, &())
            .await
            .expect("multipart extractor");
        let handle = tokio::spawn(async move {
            store_uploads(&config, &media, "http://lan", MAX_UPLOAD_BYTES, multipart).await
        });

        // Part headers plus the first half of the file, then the connection
        // goes quiet: the state a browser upload leaves when it is aborted.
        writer
            .write_all(
                format!(
                    "--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"informe.pdf\"\r\nContent-Type: application/pdf\r\n\r\n"
                )
                .as_bytes(),
            )
            .await
            .expect("part headers");
        writer
            .write_all(b"%PDF-1.7 primera mitad")
            .await
            .expect("first chunk");
        writer.flush().await.expect("flush");

        let mut seen = Vec::new();
        for _ in 0..400 {
            seen = stored_names(&dir);
            if !seen.is_empty() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        assert_eq!(seen.len(), 1, "expected one in-flight file, saw {seen:?}");
        assert!(
            seen[0].starts_with(".partial-"),
            "an unfinished upload must not carry its final name yet: {seen:?}"
        );

        writer
            .write_all(b" y la segunda\r\n")
            .await
            .expect("second chunk");
        writer
            .write_all(format!("--{boundary}--\r\n").as_bytes())
            .await
            .expect("closing boundary");
        drop(writer);

        let items = tokio::time::timeout(std::time::Duration::from_secs(5), handle)
            .await
            .expect("upload finished")
            .expect("task did not panic")
            .expect("stored");
        assert_eq!(items.len(), 1);
        let final_name = Path::new(&items[0].path)
            .file_name()
            .expect("stored name")
            .to_string_lossy()
            .to_string();
        assert!(dir.join(&final_name).exists(), "the part must be renamed");
        assert_eq!(
            stored_names(&dir),
            vec![final_name],
            "the in-flight file must not survive the completed upload"
        );
    }

    #[tokio::test]
    async fn stores_each_file_with_a_verifiable_signed_url() {
        let dir = temp_dir("store");
        let config = UploadConfig {
            dir: dir.clone(),
            public_base: None,
        };
        let media = MediaConfig::new(vec![dir.clone()], b"test-secret".to_vec(), 600);
        let multipart = multipart_request(&[
            ("files", "../../etc/informe.pdf", b"%PDF-1.7 hola"),
            ("files", "notas.txt", b"contenido"),
        ])
        .await;

        let items = store_uploads(&config, &media, "http://192.168.50.120:8055", MAX_UPLOAD_BYTES, multipart)
            .await
            .expect("stored");

        assert_eq!(items.len(), 2);
        let canonical_dir = std::fs::canonicalize(&dir).expect("canonical dir");
        for item in &items {
            // Canonical parents, not string prefixes: `<dir>/../../x.pdf`
            // also starts with `<dir>`.
            let stored = std::fs::canonicalize(&item.path).expect("stored file");
            assert_eq!(stored.parent(), Some(canonical_dir.as_path()), "{}", item.path);
            assert!(Path::new(&item.path).exists());
            assert!(item.name.ends_with(".pdf") || item.name.ends_with(".txt"));
            assert!(!item.name.contains("etc"));
            assert!(item.url.starts_with("http://192.168.50.120:8055/api/hermes/media?"));
            let exp: i64 = query_value(&item.url, "exp").parse().expect("exp");
            let sig = query_value(&item.url, "sig");
            assert!(media.verify(&item.path, exp, &sig, unix_now()));
        }
        // Control: the prefix assertion this replaced accepted an escaping
        // path that the parent comparison rejects.
        let escaping = format!("{}/../escape.pdf", dir.display());
        assert!(escaping.starts_with(dir.to_str().expect("utf8")));
        assert_ne!(Path::new(&escaping).parent(), Some(canonical_dir.as_path()));
        assert_eq!(items[0].size, 13);
        assert_eq!(items[0].mime, "application/pdf");
        assert_eq!(items[1].mime, "text/plain; charset=utf-8");
    }

    #[tokio::test]
    async fn rejects_a_file_over_the_budget_and_leaves_nothing_behind() {
        let dir = temp_dir("too-big");
        let config = UploadConfig {
            dir: dir.clone(),
            public_base: None,
        };
        let media = MediaConfig::new(vec![dir.clone()], b"k".to_vec(), 600);
        let multipart = multipart_request(&[("files", "grande.zip", b"0123456789")]).await;

        let response = store_uploads(&config, &media, "http://lan", 8, multipart)
            .await
            .expect_err("must be rejected");
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
        let leftover: Vec<_> = std::fs::read_dir(&dir).expect("dir").flatten().collect();
        assert!(leftover.is_empty(), "partial file left on disk");
    }

    #[test]
    fn the_startup_sweep_removes_stale_parts_and_keeps_real_files() {
        let dir = temp_dir("sweep");
        std::fs::write(dir.join(".partial-011114311d41-informe.pdf"), b"half").expect("part");
        std::fs::write(dir.join("011114311d41-informe.pdf"), b"%PDF").expect("final");
        // A user is allowed to upload a file literally called `informe.part`
        // (JD-B-002 edge): it is stored as `<hex>-informe.part` and must survive.
        std::fs::write(dir.join("011114311d41-informe.part"), b"real").expect("real part upload");
        std::fs::write(dir.join("part-not-an-extension.pdf"), b"x").expect("other");

        assert_eq!(sweep_partial_uploads(&dir), 1);
        assert!(!dir.join(".partial-011114311d41-informe.pdf").exists());
        assert!(dir.join("011114311d41-informe.pdf").exists());
        assert!(dir.join("011114311d41-informe.part").exists());
        assert!(dir.join("part-not-an-extension.pdf").exists());
        // Idempotent, and a directory that was never created is not an error.
        assert_eq!(sweep_partial_uploads(&dir), 0);
        assert_eq!(sweep_partial_uploads(&dir.join("missing")), 0);
    }

    #[tokio::test]
    async fn a_rejected_batch_leaves_no_orphan_behind() {
        let dir = temp_dir("multi-orphan");
        let config = UploadConfig {
            dir: dir.clone(),
            public_base: None,
        };
        let media = MediaConfig::new(vec![dir.clone()], b"k".to_vec(), 600);
        // The first file fits, the second one blows the per-file budget. The
        // batch is rejected, so the file that was already written must not
        // survive as an orphan that no URL ever points to (JD-A-001).
        let multipart = multipart_request(&[
            ("files", "primero.txt", b"ok"),
            ("files", "segundo.zip", b"0123456789"),
        ])
        .await;

        let response = store_uploads(&config, &media, "http://lan", 8, multipart)
            .await
            .expect_err("must be rejected");
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
        let leftover = stored_names(&dir);
        assert!(
            leftover.iter().all(|name| !name.ends_with(".part")),
            "a rejected batch left a partial file: {leftover:?}"
        );
        assert!(leftover.is_empty(), "orphan left on disk: {leftover:?}");
    }

    #[tokio::test]
    async fn rejects_a_body_without_files() {
        let dir = temp_dir("empty");
        let config = UploadConfig {
            dir: dir.clone(),
            public_base: None,
        };
        let media = MediaConfig::new(vec![dir], b"k".to_vec(), 600);
        let multipart = multipart_request(&[("message", "", b"hola")]).await;
        let response = store_uploads(&config, &media, "http://lan", MAX_UPLOAD_BYTES, multipart)
            .await
            .expect_err("must be rejected");
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[test]
    fn builds_the_public_base_from_the_request_when_not_configured() {
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, HeaderValue::from_static("192.168.50.120:8055"));
        assert_eq!(public_base(&headers, None, false), "http://192.168.50.120:8055");
        headers.insert("x-forwarded-proto", HeaderValue::from_static("https"));
        headers.insert("x-forwarded-host", HeaderValue::from_static("panel.test"));
        // JD-A-003: without an explicitly trusted proxy the forwarded host is
        // ignored, so a caller cannot choose the URL Hermes will fetch.
        assert_eq!(public_base(&headers, None, false), "http://192.168.50.120:8055");
        assert_eq!(public_base(&headers, None, true), "https://panel.test");
        assert_eq!(
            public_base(&headers, Some("https://fijo.test"), true),
            "https://fijo.test"
        );
    }

}
