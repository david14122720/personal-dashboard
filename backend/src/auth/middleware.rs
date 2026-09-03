use axum::http::HeaderMap;

use crate::auth::tokens::hash_token;

/// Extract Bearer token from `Authorization` header.
/// Returns `None` if missing or not `Bearer <token>` (case-sensitive prefix).
pub fn extract_bearer(headers: &HeaderMap) -> Option<String> {
    let value = headers.get(axum::http::header::AUTHORIZATION)?.to_str().ok()?;
    let token = value.strip_prefix("Bearer ")?;
    if token.trim().is_empty() {
        return None;
    }
    Some(token.to_string())
}

/// Hash a bearer token for DB lookup: `hex(SHA-256(token))`.
pub fn bearer_hash(token: &str) -> String {
    hash_token(token)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, HeaderValue};

    fn headers_with(auth: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(
            axum::http::header::AUTHORIZATION,
            HeaderValue::from_str(auth).unwrap(),
        );
        h
    }

    #[test]
    fn extract_valid_bearer() {
        let h = headers_with("Bearer abc123");
        assert_eq!(extract_bearer(&h).as_deref(), Some("abc123"));
    }

    #[test]
    fn missing_header_returns_none() {
        let h = HeaderMap::new();
        assert!(extract_bearer(&h).is_none());
    }

    #[test]
    fn wrong_scheme_returns_none() {
        let h = headers_with("Basic abc123");
        assert!(extract_bearer(&h).is_none());
    }

    #[test]
    fn bearer_lowercase_returns_none() {
        let h = headers_with("bearer abc123");
        assert!(extract_bearer(&h).is_none());
    }

    #[test]
    fn empty_token_returns_none() {
        let h = headers_with("Bearer ");
        assert!(extract_bearer(&h).is_none());
        let h2 = headers_with("Bearer    ");
        assert!(extract_bearer(&h2).is_none());
    }

    #[test]
    fn bearer_hash_is_sha256_hex() {
        let h = bearer_hash("abc");
        assert_eq!(h, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(h.len(), 64);
    }
}
