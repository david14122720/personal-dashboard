use sqlx::postgres::{PgPool, PgPoolOptions};
use std::time::Duration;

pub fn create_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(5)
        .min_connections(1)
        .acquire_timeout(Duration::from_secs(5))
        .idle_timeout(Duration::from_secs(300))
        .connect_lazy(database_url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn pool_creation_does_not_panic() {
        let pool = create_pool("postgres://user:pass@localhost/db");
        assert!(pool.is_ok());
    }
}
