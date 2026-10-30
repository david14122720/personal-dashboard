use std::sync::Arc;

use sqlx::PgPool;

use crate::auth::rate_limit::LoginRateLimiter;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub session_ttl_hours: u64,
    pub rate_limiter: Arc<LoginRateLimiter>,
}
