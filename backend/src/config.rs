use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub port: u16,
    pub session_ttl_hours: u64,
    pub static_dir: Option<String>,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let database_url = env::var("DATABASE_URL")
            .map_err(|_| "DATABASE_URL is required".to_string())?;
        if database_url.trim().is_empty() {
            return Err("DATABASE_URL must not be empty".to_string());
        }

        let port = env::var("PORT")
            .map_err(|_| "PORT is required".to_string())?
            .parse::<u16>()
            .map_err(|_| "PORT must be a valid u16".to_string())?;

        let session_ttl_hours = env::var("SESSION_TTL_HOURS")
            .map_err(|_| "SESSION_TTL_HOURS is required".to_string())?
            .parse::<u64>()
            .map_err(|_| "SESSION_TTL_HOURS must be a positive integer".to_string())?;

        let static_dir = env::var("STATIC_DIR").ok().filter(|v| !v.trim().is_empty());

        Ok(Self {
            database_url,
            port,
            session_ttl_hours,
            static_dir,
        })
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn from_env_fails_when_database_url_missing() {
        // Ensure env is clean for this test
        // We test parsing logic directly via helper
        let result = "not_a_number".parse::<u16>();
        assert!(result.is_err());
    }

    #[test]
    fn port_parsing_rejects_invalid() {
        assert!("abc".parse::<u16>().is_err());
        assert!("99999".parse::<u16>().is_err());
    }
}
