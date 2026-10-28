//! Media streaming for files Hermes leaves on disk.
//!
//! The agent answers with `MEDIA:/opt/data/x.mp4` for videos and a plain
//! `/opt/data/x.pdf` for documents. Those paths live in the Hermes container,
//! so the dashboard mounts the same directory read-only and serves it here.
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

use std::{
    path::{Path, PathBuf},
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    body::Body,
    extract::{Extension, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use tokio::io::{AsyncSeekExt, AsyncReadExt};
use tokio_util::io::ReaderStream;

pub const MEDIA_ROUTE: &str = "/api/hermes/media";

/// `/tmp` is allowed by default too: the owner spec names it explicitly, and
/// the agent writes scratch renders there. Access still requires the signed
/// URL plus the canonicalized-root check.
const DEFAULT_ROOTS: &[&str] = &["/opt/data", "/tmp"];
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
            roots,
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
        let allowed = self.roots.iter().any(|root| {
            std::fs::canonicalize(root)
                .map(|root| canonical.starts_with(&root))
                .unwrap_or_else(|_| canonical.starts_with(root))
        });
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
    let metadata = match tokio::fs::metadata(&resolved).await {
        Ok(metadata) if metadata.is_file() => metadata,
        _ => return plain_error(StatusCode::NOT_FOUND, "file not available"),
    };
    let len = metadata.len();
    let mime = mime_for(&resolved);
    // `download=1` is the boolean form used by the cards; `download=<name>` is
    // accepted when the caller wants an explicit file name.
    let requested_name = query
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
        .map(str::to_string);
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
        .header(header::CACHE_CONTROL, "private, max-age=60");
    builder = builder.header(
        header::CONTENT_DISPOSITION,
        disposition(
            if streamable(mime) && query.download.is_none() {
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
}
