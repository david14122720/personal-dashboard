use std::{
    convert::Infallible,
    net::{IpAddr, Ipv4Addr, SocketAddr},
};

use axum::{
    extract::{ConnectInfo, FromRequestParts, State},
    http::{header, request::Parts, HeaderMap, HeaderValue},
    Json,
};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    auth::{password::verify_password, rate_limit::LoginRateLimiter, tokens},
    config::TrustedProxy,
    error::AppError,
    state::AppState,
};

/// Look up a user by email. `$1` is cast to `citext` so the comparison is
/// case-insensitive, matching the `CITEXT` column type (a plain `text` bind
/// would otherwise resolve `citext = text` case-sensitively).
const LOGIN_LOOKUP_SQL: &str =
    "SELECT id, password_hash, is_active FROM users WHERE email = $1::citext";

#[derive(Debug, Clone, Deserialize)]
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

/// Single key-derivation path (DD2): the peer socket address; the
/// right-most `X-Forwarded-For` element that parses as an IP and is not in
/// the trusted set, walking right to left, only when that peer is trusted;
/// otherwise the peer. The right-most element must parse: an unparseable
/// right-most element falls back to the peer instead of falling through to
/// an older, client-controlled element. `X-Real-Ip` is never consulted.
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
    let Some(value) = headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
    else {
        return peer_ip;
    };
    let elements: Vec<&str> = value.split(',').map(str::trim).collect();
    // A.1 fail-closed rule: the element the trusted proxy itself appended
    // (the right-most one) must parse; otherwise the whole header is
    // untrustworthy and the peer address is the key.
    if elements.last().is_none_or(|element| element.parse::<IpAddr>().is_err()) {
        return peer_ip;
    }
    for element in elements.iter().rev() {
        if let Ok(candidate) = element.parse::<IpAddr>() {
            if !trusted.iter().any(|proxy| proxy.contains(candidate)) {
                return candidate;
            }
        }
    }
    peer_ip
}

/// Decide whether the login attempt is authenticated (A3).
///
/// A syntactically valid attempt must always execute exactly one Argon2
/// verification — against the stored hash, or against the fixed dummy PHC
/// hash when the row is missing or inactive — before the identical generic
/// 401 is returned. `is_active` is evaluated only after that verification.
fn verify_credentials(password: &str, row: Option<(&str, bool)>) -> bool {
    let (hash, is_active) = match row {
        Some((hash, is_active)) => (hash, is_active),
        None => (crate::auth::password::DUMMY_PASSWORD_HASH, false),
    };
    let verified = verify_password(password, hash);
    verified && is_active
}

pub async fn login_handler(
    State(state): State<AppState>,
    peer: PeerAddr,
    headers: HeaderMap,
    Json(body): Json<LoginRequest>,
) -> Result<(HeaderMap, Json<LoginResponse>), AppError> {
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
    // default is used when connect-info is absent. A2: the gate is
    // failure-only and keyed per IP (10/15 min) and per normalized account
    // (5/15 min), so a successful login never consumes quota and an attacker
    // who rotates emails still exhausts the IP budget.
    let ip = rate_limit_key(peer.0, &headers, state.rate_limiter.trusted_proxies());
    let account = LoginRateLimiter::normalize_account(&email);
    if let Some(retry) = state.rate_limiter.check_login(ip, &account) {
        let secs = retry.as_secs().max(1);
        return Err(AppError::RateLimited(secs));
    }

    // Fetch user by CITEXT email
    let row = sqlx::query_as::<_, (uuid::Uuid, String, bool)>(LOGIN_LOOKUP_SQL)
    .bind(&email)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| AppError::Internal)?;

    // A3: every syntactically valid attempt runs exactly one Argon2
    // verification — against the stored hash, or against the fixed dummy
    // hash when the row is missing/inactive — so the timing cannot
    // distinguish account existence. The 401 stays identical and generic.
    let verified_user_id = match &row {
        Some((user_id, hash, is_active)) => {
            verify_credentials(&password, Some((hash.as_str(), *is_active))).then_some(*user_id)
        }
        None => {
            verify_credentials(&password, None);
            None
        }
    };
    let Some(user_id) = verified_user_id else {
        state.rate_limiter.record_failure(ip, &account);
        return Err(AppError::Auth);
    };

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

    // A2: a successful login clears the account bucket and never consumes the
    // IP budget; the residual per-account self-lockout is bounded by WINDOW
    // and documented on the limiter's threshold constants.
    state.rate_limiter.record_success(&account);

    // A7: the response carries a freshly minted session token, so it must
    // never be cached. Set here, on this handler only: a global header layer
    // would blanket-stamp every read route and static asset.
    let mut response_headers = HeaderMap::new();
    response_headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok((response_headers, Json(LoginResponse { token, expires_at })))
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
    fn rate_limit_key_uses_right_most_untrusted_xff_for_a_trusted_peer() {
        let trusted = trusted(&["198.51.100.4"]);
        let headers = xff("203.0.113.9, 10.0.0.1");
        assert_eq!(
            rate_limit_key(Some(peer("198.51.100.4")), &headers, &trusted),
            ip("10.0.0.1"),
            "a trusted peer must be keyed by the right-most untrusted XFF element"
        );
    }

    #[test]
    fn rate_limit_key_walks_past_trusted_hops_right_to_left() {
        let trusted = trusted(&["192.0.2.1", "192.0.2.2"]);
        let headers = xff("203.0.113.5, 192.0.2.1, 192.0.2.2");
        assert_eq!(
            rate_limit_key(Some(peer("192.0.2.1")), &headers, &trusted),
            ip("203.0.113.5"),
            "every trusted hop on the right must be skipped"
        );
    }

    #[test]
    fn rate_limit_key_ignores_a_spoofed_left_element_behind_an_appending_proxy() {
        // Append-style proxy: the client prefix stays left of the real socket
        // address the proxy appended, so rotating it must never mint a bucket.
        let trusted = trusted(&["192.0.2.10"]);
        let headers = xff("10.0.0.99, 192.0.2.7");
        assert_eq!(
            rate_limit_key(Some(peer("192.0.2.10")), &headers, &trusted),
            ip("192.0.2.7")
        );
    }

    #[test]
    fn rate_limit_key_all_trusted_elements_falls_back_to_the_peer() {
        let trusted = trusted(&["192.0.2.1", "198.51.100.4"]);
        let headers = xff("192.0.2.1, 192.0.2.1");
        assert_eq!(
            rate_limit_key(Some(peer("198.51.100.4")), &headers, &trusted),
            ip("198.51.100.4"),
            "a fully trusted chain must key the proxy socket itself"
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
        // A valid element left of an unparseable RIGHT-most element must not
        // become the key: walk right, fail closed.
        let headers = xff("203.0.113.9, garbage");
        assert_eq!(
            rate_limit_key(Some(peer("198.51.100.4")), &headers, &trusted),
            ip("198.51.100.4"),
            "an unparseable right-most element must fall back to the peer"
        );
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

    // -- Handlers: the failure-only limiter gates the key derivation --

    /// Burn `n` IP-bucket failures without touching `user@example.com`'s
    /// account bucket: each blocker email gets a single failure.
    fn block_ip(limiter: &LoginRateLimiter, ip: IpAddr, n: usize) {
        for i in 0..n {
            limiter.record_failure(ip, &format!("blocker-{i}@example.com"));
        }
    }

    fn test_pool() -> Option<sqlx::PgPool> {
        std::env::var("DATABASE_URL")
            .ok()
            .map(|url| sqlx::PgPool::connect_lazy(&url).expect("lazy pool from DATABASE_URL"))
    }

    async fn cleanup_user(pool: &sqlx::PgPool, user_id: uuid::Uuid) {
        sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(user_id)
            .execute(pool)
            .await
            .expect("cleanup user");
    }

    #[tokio::test]
    async fn peers_get_independent_buckets_and_rotating_xff_never_creates_one() {
        // Two peers, an empty trusted set: each bucket is keyed by the peer
        // socket address, and a rotating XFF header can never mint a new one.
        let limiter = Arc::new(LoginRateLimiter::with_trusted_proxies(Vec::new()));
        block_ip(&limiter, ip("198.51.100.1"), 10);
        let state = test_state(limiter);

        let res = login_handler(
            State(state.clone()),
            PeerAddr(Some(peer("198.51.100.1"))),
            xff("203.0.113.200"),
            Json(login_body()),
        )
        .await;
        assert!(
            matches!(res, Err(AppError::RateLimited(_))),
            "a blocked peer must stay blocked regardless of XFF: {res:?}"
        );

        // Peer B shares one of A's XFF values and is unaffected.
        let res = login_handler(State(state), PeerAddr(Some(peer("198.51.100.2"))), xff("203.0.113.0"), Json(login_body())).await;
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
        block_ip(&limiter, ip("203.0.113.9"), 10);
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
    async fn trusted_peer_uses_right_most_untrusted_xff_element() {
        let limiter = Arc::new(LoginRateLimiter::with_trusted_proxies(trusted(&[
            "198.51.100.4",
        ])));
        // Block the right-most element; the spoofable left one stays unblocked.
        block_ip(&limiter, ip("10.0.0.1"), 10);
        let state = test_state(limiter);

        let res = login_handler(
            State(state.clone()),
            PeerAddr(Some(peer("198.51.100.4"))),
            xff("203.0.113.9, 10.0.0.1"),
            Json(login_body()),
        )
        .await;
        assert!(
            matches!(res, Err(AppError::RateLimited(_))),
            "a trusted peer must be keyed by the right-most element: {res:?}"
        );

        // Changing only the left (client-controlled) element never buys a new
        // bucket; the peer address is not the key either.
        let res = login_handler(
            State(state),
            PeerAddr(Some(peer("198.51.100.4"))),
            xff("203.0.113.99, 10.0.0.2"),
            Json(login_body()),
        )
        .await;
        assert!(
            matches!(res, Err(AppError::Internal)),
            "the key must be the right-most element, not XFF[0] or the peer: {res:?}"
        );
    }

    #[tokio::test]
    async fn trusted_peer_with_malformed_xff_falls_back_to_peer() {
        let limiter = Arc::new(LoginRateLimiter::with_trusted_proxies(trusted(&[
            "198.51.100.4",
        ])));
        block_ip(&limiter, ip("198.51.100.4"), 10);
        let state = test_state(limiter);
        for value in ["not-an-ip", "203.0.113.9, garbage"] {
            let res = login_handler(
                State(state.clone()),
                PeerAddr(Some(peer("198.51.100.4"))),
                xff(value),
                Json(login_body()),
            )
            .await;
            assert!(
                matches!(res, Err(AppError::RateLimited(_))),
                "malformed XFF {value:?} must fall back to the peer key: {res:?}"
            );
        }
    }

    #[tokio::test]
    async fn absent_connect_info_uses_local_fallback_without_panicking() {
        // `oneshot`-style request: no ConnectInfo extension, so the handler
        // must use the fixed local default (never the spoofed header) and
        // must not panic.
        let limiter = Arc::new(LoginRateLimiter::with_trusted_proxies(Vec::new()));
        block_ip(&limiter, LOCAL_PEER_FALLBACK, 10);
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

    #[tokio::test]
    async fn validation_short_circuit_does_not_consult_the_limiter() {
        let limiter = Arc::new(LoginRateLimiter::with_trusted_proxies(Vec::new()));
        let state = test_state(limiter.clone());
        let res = login_handler(
            State(state),
            PeerAddr(Some(peer("198.51.100.4"))),
            HeaderMap::new(),
            Json(LoginRequest {
                email: "   ".into(),
                password: "x".into(),
            }),
        )
        .await;
        assert!(matches!(res, Err(AppError::Validation(_))));
        assert_eq!(limiter.count_ip(ip("198.51.100.4")), 0);
        assert_eq!(limiter.count_account(""), 0);
    }

    // -- A3: exactly one Argon2 verification on every valid login path --

    #[test]
    fn verify_credentials_always_runs_exactly_one_argon2_verify() {
        use crate::auth::password::{hash_password, reset_verify_count, verify_count};
        let hash = hash_password("secret").expect("hash");

        reset_verify_count();
        assert!(!verify_credentials("secret", None));
        assert_eq!(verify_count(), 1, "unknown user must verify against the dummy hash");

        reset_verify_count();
        assert!(!verify_credentials("secret", Some((&hash, false))));
        assert_eq!(verify_count(), 1, "inactive user must still verify");

        reset_verify_count();
        assert!(!verify_credentials("wrong", Some((&hash, true))));
        assert_eq!(verify_count(), 1, "wrong password must verify once");

        reset_verify_count();
        assert!(verify_credentials("secret", Some((&hash, true))));
        assert_eq!(verify_count(), 1, "correct password must verify once");
    }

    #[test]
    fn verify_credentials_never_authenticates_a_missing_or_inactive_row() {
        use crate::auth::password::hash_password;
        let hash = hash_password("secret").expect("hash");
        assert!(!verify_credentials("secret", None));
        assert!(!verify_credentials("secret", Some((&hash, false))));
        assert!(verify_credentials("secret", Some((&hash, true))));
    }

    #[tokio::test]
    async fn missing_or_oversized_input_is_422_before_argon2() {
        use crate::auth::password::{reset_verify_count, verify_count};
        let limiter = Arc::new(LoginRateLimiter::with_trusted_proxies(Vec::new()));
        let state = test_state(limiter);
        let cases = [
            LoginRequest {
                email: "".into(),
                password: "x".into(),
            },
            LoginRequest {
                email: "user@example.com".into(),
                password: "".into(),
            },
            LoginRequest {
                email: format!("{}@example.com", "a".repeat(320)),
                password: "x".into(),
            },
            LoginRequest {
                email: "user@example.com".into(),
                password: "p".repeat(1025),
            },
        ];
        for body in cases {
            reset_verify_count();
            let res = login_handler(
                State(state.clone()),
                PeerAddr(Some(peer("198.51.100.4"))),
                HeaderMap::new(),
                Json(body),
            )
            .await;
            assert!(
                matches!(res, Err(AppError::Validation(_))),
                "missing/oversized input must be 422: {res:?}"
            );
            assert_eq!(verify_count(), 0, "the 422 path must short-circuit before Argon2");
        }
    }

    async fn auth_error_parts(err: AppError) -> (axum::http::StatusCode, String) {
        use axum::response::IntoResponse;
        let res = err.into_response();
        let status = res.status();
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .expect("read error body");
        (
            status,
            String::from_utf8(bytes.to_vec()).expect("error body is UTF-8 JSON"),
        )
    }

    #[tokio::test]
    async fn unknown_inactive_and_wrong_password_share_one_verify_and_one_generic_401() {
        use crate::auth::password::{hash_password, reset_verify_count, verify_count};
        let Some(pool) = test_pool() else {
            eprintln!(
                "SKIP unknown_inactive_and_wrong_password_share_one_verify_and_one_generic_401: no DATABASE_URL"
            );
            return;
        };
        let active_email = format!("login-active-{}@example.com", uuid::Uuid::new_v4());
        let inactive_email = format!("login-inactive-{}@example.com", uuid::Uuid::new_v4());
        let unknown_email = format!("login-missing-{}@example.com", uuid::Uuid::new_v4());
        let password = "correct horse battery staple";
        let hash = hash_password(password).expect("hash password");
        let active_id: uuid::Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&active_email)
        .bind(&hash)
        .bind("login active test")
        .fetch_one(&pool)
        .await
        .expect("seed active user");
        let inactive_id: uuid::Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name, is_active) VALUES ($1,$2,$3,false) RETURNING id",
        )
        .bind(&inactive_email)
        .bind(&hash)
        .bind("login inactive test")
        .fetch_one(&pool)
        .await
        .expect("seed inactive user");

        let limiter = Arc::new(LoginRateLimiter::with_trusted_proxies(Vec::new()));
        let state = AppState {
            pool: pool.clone(),
            session_ttl_hours: 24,
            rate_limiter: limiter,
        };
        let attempt = |email: String, password: String| {
            login_handler(
                State(state.clone()),
                PeerAddr(None),
                HeaderMap::new(),
                Json(LoginRequest { email, password }),
            )
        };

        reset_verify_count();
        let unknown_err = attempt(unknown_email.clone(), "whatever".into())
            .await
            .expect_err("unknown email must fail");
        assert_eq!(verify_count(), 1, "unknown email must run one dummy verify");

        reset_verify_count();
        let inactive_err = attempt(inactive_email.clone(), password.into())
            .await
            .expect_err("inactive user must fail");
        assert_eq!(verify_count(), 1, "inactive user must run one verify");

        reset_verify_count();
        let wrong_err = attempt(active_email.clone(), "wrong-password".into())
            .await
            .expect_err("wrong password must fail");
        assert_eq!(verify_count(), 1, "wrong password must run one verify");

        let unknown = auth_error_parts(unknown_err).await;
        let inactive = auth_error_parts(inactive_err).await;
        let wrong = auth_error_parts(wrong_err).await;
        assert_eq!(unknown.0, axum::http::StatusCode::UNAUTHORIZED);
        assert_eq!(inactive, unknown, "inactive must be byte-identical to unknown");
        assert_eq!(wrong, unknown, "wrong password must be byte-identical to unknown");

        cleanup_user(&pool, active_id).await;
        cleanup_user(&pool, inactive_id).await;
    }

    // -- A7: the one-shot session token must not be cached --

    #[tokio::test]
    async fn login_response_sets_cache_control_no_store() {
        use axum::http::header::CACHE_CONTROL;
        use axum::response::IntoResponse;
        let Some(pool) = test_pool() else {
            eprintln!("SKIP login_response_sets_cache_control_no_store: no DATABASE_URL");
            return;
        };
        let email = format!("login-no-store-{}@example.com", uuid::Uuid::new_v4());
        let password = "correct horse battery staple";
        let user_id: uuid::Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind(crate::auth::password::hash_password(password).expect("hash password"))
        .bind("login no-store test")
        .fetch_one(&pool)
        .await
        .expect("seed user");
        let limiter = Arc::new(LoginRateLimiter::with_trusted_proxies(Vec::new()));
        let state = AppState {
            pool: pool.clone(),
            session_ttl_hours: 24,
            rate_limiter: limiter,
        };
        let res = login_handler(
            State(state),
            PeerAddr(None),
            HeaderMap::new(),
            Json(LoginRequest {
                email,
                password: password.into(),
            }),
        )
        .await
        .expect("login succeeds")
        .into_response();
        assert_eq!(res.status(), axum::http::StatusCode::OK);
        assert_eq!(
            res.headers()
                .get(CACHE_CONTROL)
                .and_then(|value| value.to_str().ok()),
            Some("no-store"),
            "the login response carries a fresh session token and must not be cached"
        );
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn correct_login_runs_exactly_one_verify() {
        use crate::auth::password::{hash_password, reset_verify_count, verify_count};
        let Some(pool) = test_pool() else {
            eprintln!("SKIP correct_login_runs_exactly_one_verify: no DATABASE_URL");
            return;
        };
        let email = format!("login-verify-{}@example.com", uuid::Uuid::new_v4());
        let password = "correct horse battery staple";
        let user_id: uuid::Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind(hash_password(password).expect("hash password"))
        .bind("login verify test")
        .fetch_one(&pool)
        .await
        .expect("seed user");

        let limiter = Arc::new(LoginRateLimiter::with_trusted_proxies(Vec::new()));
        let state = AppState {
            pool: pool.clone(),
            session_ttl_hours: 24,
            rate_limiter: limiter,
        };
        reset_verify_count();
        let res = login_handler(
            State(state),
            PeerAddr(None),
            HeaderMap::new(),
            Json(LoginRequest {
                email: email.clone(),
                password: password.into(),
            }),
        )
        .await;
        assert!(res.is_ok(), "correct login must succeed: {res:?}");
        assert_eq!(verify_count(), 1, "correct login must run exactly one verify");
        cleanup_user(&pool, user_id).await;
    }

    // -- DB-backed: failure-only accounting through the handler --

    #[tokio::test]
    async fn successful_login_clears_the_account_bucket_and_consumes_no_quota() {
        let Some(pool) = test_pool() else {
            eprintln!(
                "SKIP successful_login_clears_the_account_bucket_and_consumes_no_quota: no DATABASE_URL"
            );
            return;
        };
        let email = format!("login-limiter-{}@example.com", uuid::Uuid::new_v4());
        let password = "correct horse battery staple";
        let user_id: uuid::Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind(crate::auth::password::hash_password(password).expect("hash password"))
        .bind("login limiter test")
        .fetch_one(&pool)
        .await
        .expect("seed user");

        let limiter = Arc::new(LoginRateLimiter::with_trusted_proxies(Vec::new()));
        let ip_addr = ip("198.51.100.7");
        for _ in 0..3 {
            limiter.record_failure(ip_addr, &email);
        }
        let state = AppState {
            pool: pool.clone(),
            session_ttl_hours: 24,
            rate_limiter: limiter.clone(),
        };
        let body = LoginRequest {
            email: email.clone(),
            password: password.into(),
        };

        for attempt in 0..2 {
            let res = login_handler(
                State(state.clone()),
                PeerAddr(Some(peer("198.51.100.7"))),
                HeaderMap::new(),
                Json(body.clone()),
            )
            .await;
            assert!(res.is_ok(), "attempt {attempt} must succeed: {res:?}");
        }
        assert_eq!(
            limiter.count_account(&email),
            0,
            "a successful login must clear the account bucket"
        );
        assert_eq!(
            limiter.count_ip(ip_addr),
            3,
            "a successful login must not consume the IP budget"
        );
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn failed_login_records_one_failure_in_both_buckets() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP failed_login_records_one_failure_in_both_buckets: no DATABASE_URL");
            return;
        };
        let email = format!("login-fail-{}@example.com", uuid::Uuid::new_v4());
        let user_id: uuid::Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind(
            crate::auth::password::hash_password("right-password").expect("hash password"),
        )
        .bind("login failure test")
        .fetch_one(&pool)
        .await
        .expect("seed user");

        let limiter = Arc::new(LoginRateLimiter::with_trusted_proxies(Vec::new()));
        let state = AppState {
            pool: pool.clone(),
            session_ttl_hours: 24,
            rate_limiter: limiter.clone(),
        };
        let ip_addr = ip("198.51.100.8");

        let res = login_handler(
            State(state.clone()),
            PeerAddr(Some(peer("198.51.100.8"))),
            HeaderMap::new(),
            Json(LoginRequest {
                email: email.clone(),
                password: "wrong-password".into(),
            }),
        )
        .await;
        assert!(matches!(res, Err(AppError::Auth)));

        let unknown = format!("missing-{}@example.com", uuid::Uuid::new_v4());
        let res = login_handler(
            State(state),
            PeerAddr(Some(peer("198.51.100.8"))),
            HeaderMap::new(),
            Json(LoginRequest {
                email: unknown.clone(),
                password: "whatever".into(),
            }),
        )
        .await;
        assert!(matches!(res, Err(AppError::Auth)));

        assert_eq!(limiter.count_account(&email), 1);
        assert_eq!(limiter.count_account(&unknown), 1);
        assert_eq!(limiter.count_ip(ip_addr), 2);
        cleanup_user(&pool, user_id).await;
    }
}
