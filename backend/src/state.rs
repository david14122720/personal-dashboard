use std::sync::Arc;

use sqlx::PgPool;

use crate::{auth::rate_limit::LoginRateLimiter, config::HermesConfig};

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub session_ttl_hours: u64,
    pub rate_limiter: Arc<LoginRateLimiter>,
    /// Outbound Hermes proxy credentials/timeout; `None` means unconfigured.
    pub hermes: Option<HermesConfig>,
}
