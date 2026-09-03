use sqlx::PgPool;

#[derive(Clone)]
#[allow(dead_code)]
pub struct AppState {
    pub pool: PgPool,
    pub session_ttl_hours: u64,
}
