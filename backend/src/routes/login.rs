use std::{
    convert::Infallible,
    net::{IpAddr, Ipv4Addr, SocketAddr},
};

use axum::{
    extract::{ConnectInfo, FromRequestParts, State},
    http::{request::Parts, HeaderMap},
    Json,
};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    auth::{password::verify_password, tokens},
    config::TrustedProxy,
    error::AppError,
    state::AppState,
};

/// Look up a user by email. `$1` is cast to `citext` so the comparison is
/// case-insensitive, matching the `CITEXT` column type (a plain `text` bind
/// would otherwise resolve `citext = text` case-sensitively).
const LOGIN_LOOKUP_SQL: &str =
    "SELECT id, password_hash, is_active FROM users WHERE email = $1::citext";

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub token: String,
    pub expires_at: chrono::DateTime<Utc>,
}

/// Infallible peer-address extractor (DD1): reads the
/// `ConnectInfo<SocketAddr>` extension installed by
/// `into_make_service_with_connect_info::<SocketAddr>()` and yields `None`
/// when it is absent (for example in the `oneshot` harness) instead of
/// rejecting, so a missing peer can never turn into a 500.
#[derive(Debug, Clone, Copy)]
pub struct PeerAddr(pub Option<SocketAddr>);

impl<S> FromRequestParts<S> for PeerAddr
where
    S: Send + Sync,
{
    type Rejection = Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        Ok(Self(
            parts
                .extensions
                .get::<ConnectInfo<SocketAddr>>()
                .map(|info| info.0),
        ))
    }
}

/// Fixed, non-spoofable key for a request whose peer address is unknown
/// (DD2): never a header-derived value.
pub const LOCAL_PEER_FALLBACK: IpAddr = IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1));

/// Single key-derivation path (DD2): the peer socket address; the first
/// parseable `X-Forwarded-For` element only when that peer is trusted;
/// otherwise the peer. `X-Real-Ip` is never consulted.
pub fn rate_limit_key(
    peer: Option<SocketAddr>,
    headers: &HeaderMap,
    trusted: &[TrustedProxy],
) -> IpAddr {
    let Some(peer_ip) = peer.map(|addr| addr.ip()) else {
        return LOCAL_PEER_FALLBACK;
    };
    if !trusted.iter().any(|proxy| proxy.contains(peer_ip)) {
        return peer_ip;
    }
    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value
                .split(',')
                .find_map(|element| element.trim().parse::<IpAddr>().ok())
        })
        .unwrap_or(peer_ip)
}

pub async fn login_handler(
    State(state): State<AppState>,
    peer: PeerAddr,
    headers: HeaderMap,
    Json(body): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, AppError> {
    let email = body.email.trim().to_string();
    let password = body.password;

    if email.is_empty() || password.is_empty() {
        return Err(AppError::Validation("email and password required".into()));
    }
    if email.len() > 320 || password.len() > 1024 {
        return Err(AppError::Validation("invalid input".into()));
    }

    // Rate limit before DB work. SEC-004: the key is the peer socket
    // address; `X-Forwarded-For` is honoured only when the peer is in the
    // limiter-owned trusted set (DD2/DD3 amendment), and the fixed local
    // default is used when connect-info is absent.
    let ip = rate_limit_key(peer.0, &headers, state.rate_limiter.trusted_proxies());
    if let Some(retry) = state.rate_limiter.check(ip) {
        let secs = retry.as_secs().max(1);
        return Err(AppError::RateLimited(secs));
    }

    // Fetch user by CITEXT email
    let row = sqlx::query_as::<_, (uuid::Uuid, String, bool)>(LOGIN_LOOKUP_SQL)
    .bind(&email)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| AppError::Internal)?;

    let Some((user_id, hash, is_active)) = row else {
        return Err(AppError::Auth);
    };
    if !is_active || !verify_password(&password, &hash) {
        return Err(AppError::Auth);
    }

    let token = tokens::generate_token();
    let token_hash = tokens::hash_token(&token);
    let expires_at = Utc::now() + Duration::hours(state.session_ttl_hours as i64);

    let ip_str = ip.to_string();
    sqlx::query(
        "INSERT INTO sessions (user_id, token_hash, expires_at, ip_address) VALUES ($1,$2,$3,$4::inet)",
    )
    .bind(user_id)
    .bind(&token_hash)
    .bind(expires_at)
    .bind(&ip_str)
    .execute(&state.pool)
    .await
    .map_err(|_| AppError::Internal)?;

    Ok(Json(LoginResponse { token, expires_at }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::rate_limit::LoginRateLimiter;
    use crate::config::TrustedProxy;
    use crate::state::AppState;
    use axum::extract::FromRequestParts;
    use axum::http::Request;
    use std::net::{IpAddr, SocketAddr};
    use std::sync::Arc;

    fn ip(s: &str) -> IpAddr {
        s.parse().expect("test IP literal")
    }

    fn peer(s: &str) -> SocketAddr {
        SocketAddr::new(ip(s), 443)
    }

    fn xff(value: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", value.parse().unwrap());
        headers
    }

    fn trusted(tokens: &[&str]) -> Vec<TrustedProxy> {
        tokens.iter().map(|t| TrustedProxy::exact(ip(t))).collect()
    }

    fn test_state(limiter: Arc<LoginRateLimiter>) -> AppState {
        AppState {
            // A short acquire timeout keeps the "passes the limiter" path
            // fast: those requests reach the DB (no server is running) and
            // must fail there, not in the limiter.
            pool: sqlx::postgres::PgPoolOptions::new()
                .acquire_timeout(std::time::Duration::from_millis(100))
                .connect_lazy("postgres://localhost:1/unused")
                .expect("lazy pool construction must succeed"),
            session_ttl_hours: 24,
            rate_limiter: limiter,
        }
    }

    fn login_body() -> LoginRequest {
        LoginRequest {
            email: "user@example.com".into(),
            password: "correct horse battery staple".into(),
        }
    }

    #[test]
    fn login_lookup_binds_email_as_citext() {
        // Regression: the email lookup predicate MUST cast `$1` to `citext` so
        // that `citext = citext` comparison is case-insensitive. If it binds a
        // plain `text` value, PG falls back to case-sensitive comparison and
        // login fails for any casing other than the stored one.
        assert!(
            LOGIN_LOOKUP_SQL.contains("WHERE email = $1::citext"),
            "login lookup must use CITEXT-aware comparison, got: {LOGIN_LOOKUP_SQL}"
        );
    }

    // -- S1.3 RED: peer-address key derivation (SEC-004, DD1/DD2) --

    #[test]
    fn rate_limit_key_ignores_headers_for_an_untrusted_peer() {
        let headers = xff("203.0.113.9");
        assert_eq!(
            rate_limit_key(Some(peer("198.51.100.4")), &headers, &[]),
            ip("198.51.100.4"),
            "an untrusted peer must be keyed by its socket address"
        );

        // X-Real-Ip is not consulted at all (DD2 drops it from the key path).
        let mut headers = HeaderMap::new();
        headers.insert("x-real-ip", "203.0.113.9".parse().unwrap());
        assert_eq!(
            rate_limit_key(Some(peer("198.51.100.4")), &headers, &[]),
            ip("198.51.100.4")
        );
    }

    #[test]
    fn rate_limit_key_uses_first_parseable_xff_for_a_trusted_peer() {
        let trusted = trusted(&["198.51.100.4"]);
        let headers = xff("203.0.113.9, 10.0.0.1");
        assert_eq!(
            rate_limit_key(Some(peer("198.51.100.4")), &headers, &trusted),
            ip("203.0.113.9"),
            "a trusted peer must be keyed by the first XFF element"
        );
    }

    #[test]
    fn rate_limit_key_falls_back_to_the_peer_on_malformed_xff() {
        let trusted = trusted(&["198.51.100.4"]);
        for value in ["garbage", "garbage, still-garbage", "300.0.0.1"] {
            let headers = xff(value);
            assert_eq!(
                rate_limit_key(Some(peer("198.51.100.4")), &headers, &trusted),
                ip("198.51.100.4"),
                "malformed XFF {value:?} must fall back to the peer"
            );
        }
        // An absent XFF header falls back to the peer too.
        assert_eq!(
            rate_limit_key(Some(peer("198.51.100.4")), &HeaderMap::new(), &trusted),
            ip("198.51.100.4")
        );
    }

    #[test]
    fn rate_limit_key_without_a_peer_uses_the_local_fallback() {
        assert_eq!(LOCAL_PEER_FALLBACK, ip("127.0.0.1"));
        // Even when the absent peer would be trusted and the header parses,
        // no header value may become the key.
        let trusted = trusted(&["127.0.0.1"]);
        let headers = xff("203.0.113.9");
        assert_eq!(rate_limit_key(None, &headers, &[]), LOCAL_PEER_FALLBACK);
        assert_eq!(rate_limit_key(None, &headers, &trusted), LOCAL_PEER_FALLBACK);
    }

    #[tokio::test]
    async fn peer_addr_extractor_is_infallible_and_reads_connect_info() {
        let (mut parts, _) = Request::builder().body(()).unwrap().into_parts();
        let extracted = PeerAddr::from_request_parts(&mut parts, &()).await.unwrap();
        assert!(extracted.0.is_none(), "absent extension must not reject");

        let (mut parts, _) = Request::builder().body(()).unwrap().into_parts();
        parts.extensions.insert(ConnectInfo(peer("198.51.100.4")));
        let extracted = PeerAddr::from_request_parts(&mut parts, &()).await.unwrap();
        assert_eq!(extracted.0, Some(peer("198.51.100.4")));
    }

    // -- S1.3 RED: handler key derivation (SEC-004, DD2/DD3) --

    #[tokio::test]
    async fn peers_get_independent_buckets_and_rotating_xff_never_creates_one() {
        // Two peers, an empty trusted set: each bucket is keyed by the peer
        // socket address, and a rotating XFF header can never mint a new one.
        let limiter = Arc::new(LoginRateLimiter::with_trusted_proxies(Vec::new()));
        let state = test_state(limiter);
        let peer_a = PeerAddr(Some(peer("198.51.100.1")));
        let peer_b = PeerAddr(Some(peer("198.51.100.2")));

        for i in 0..10u8 {
            let res = login_handler(
                State(state.clone()),
                peer_a,
                xff(&format!("203.0.113.{i}")),
                Json(login_body()),
            )
            .await;
            assert!(
                matches!(res, Err(AppError::Internal)),
                "request {i} from peer A must pass the limiter: {res:?}"
            );
        }
        let res = login_handler(
            State(state.clone()),
            peer_a,
            xff("203.0.113.200"),
            Json(login_body()),
        )
        .await;
        assert!(
            matches!(res, Err(AppError::RateLimited(_))),
            "the 11th request from peer A must be blocked regardless of XFF: {res:?}"
        );

        // Peer B shares one of A's XFF values and is unaffected.
        let res = login_handler(State(state), peer_b, xff("203.0.113.0"), Json(login_body())).await;
        assert!(
            matches!(res, Err(AppError::Internal)),
            "a different peer must have an independent bucket: {res:?}"
        );
    }

    #[tokio::test]
    async fn untrusted_peer_ignores_a_blocked_xff_key() {
        // Pre-block the XFF-derived key: an untrusted peer must not be gated
        // by it (the header cannot influence the bucket at all).
        let limiter = Arc::new(LoginRateLimiter::with_trusted_proxies(Vec::new()));
        for _ in 0..10 {
            assert!(limiter.check(ip("203.0.113.9")).is_none());
        }
        let state = test_state(limiter);
        let res = login_handler(
            State(state),
            PeerAddr(Some(peer("198.51.100.4"))),
            xff("203.0.113.9"),
            Json(login_body()),
        )
        .await;
        assert!(
            matches!(res, Err(AppError::Internal)),
            "an untrusted peer must not be gated by the XFF key: {res:?}"
        );
    }

    #[tokio::test]
    async fn trusted_peer_uses_first_xff_element() {
        let limiter = Arc::new(LoginRateLimiter::with_trusted_proxies(trusted(&[
            "198.51.100.4",
        ])));
        for _ in 0..10 {
            assert!(limiter.check(ip("203.0.113.9")).is_none());
        }
        let state = test_state(limiter);

        // The first XFF element is blocked: the trusted peer is keyed by it.
        let res = login_handler(
            State(state.clone()),
            PeerAddr(Some(peer("198.51.100.4"))),
            xff("203.0.113.9, 10.0.0.1"),
            Json(login_body()),
        )
        .await;
        assert!(
            matches!(res, Err(AppError::RateLimited(_))),
            "a trusted peer must be keyed by XFF[0]: {res:?}"
        );

        // A different first element is a different bucket; the peer address
        // and the second element are not the key.
        let res = login_handler(
            State(state),
            PeerAddr(Some(peer("198.51.100.4"))),
            xff("203.0.113.10"),
            Json(login_body()),
        )
        .await;
        assert!(
            matches!(res, Err(AppError::Internal)),
            "the key must be XFF[0], not the peer or XFF[1]: {res:?}"
        );
    }

    #[tokio::test]
    async fn trusted_peer_with_malformed_xff_falls_back_to_peer() {
        let limiter = Arc::new(LoginRateLimiter::with_trusted_proxies(trusted(&[
            "198.51.100.4",
        ])));
        for _ in 0..10 {
            assert!(limiter.check(ip("198.51.100.4")).is_none());
        }
        let state = test_state(limiter);
        let res = login_handler(
            State(state),
            PeerAddr(Some(peer("198.51.100.4"))),
            xff("not-an-ip"),
            Json(login_body()),
        )
        .await;
        assert!(
            matches!(res, Err(AppError::RateLimited(_))),
            "malformed XFF must fall back to the peer key: {res:?}"
        );
    }

    #[tokio::test]
    async fn absent_connect_info_uses_local_fallback_without_panicking() {
        // `oneshot`-style request: no ConnectInfo extension, so the handler
        // must use the fixed local default (never the spoofed header) and
        // must not panic.
        let limiter = Arc::new(LoginRateLimiter::with_trusted_proxies(Vec::new()));
        for _ in 0..10 {
            assert!(limiter.check(LOCAL_PEER_FALLBACK).is_none());
        }
        let state = test_state(limiter);
        let res = login_handler(
            State(state),
            PeerAddr(None),
            xff("203.0.113.9"),
            Json(login_body()),
        )
        .await;
        assert!(
            matches!(res, Err(AppError::RateLimited(_))),
            "absent connect-info must key the fixed local default: {res:?}"
        );
    }
}
