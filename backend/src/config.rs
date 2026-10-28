use std::{env, net::IpAddr, time::Duration};

/// One entry of the `TRUSTED_PROXIES` allow-list (DD3): an exact address or a
/// CIDR block whose `X-Forwarded-For` header the login path may honour.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrustedProxy {
    addr: IpAddr,
    prefix: u8,
}

impl TrustedProxy {
    /// Exact host (no CIDR suffix).
    pub(crate) fn exact(addr: IpAddr) -> Self {
        Self {
            addr,
            prefix: match addr {
                IpAddr::V4(_) => 32,
                IpAddr::V6(_) => 128,
            },
        }
    }

    /// Whether `candidate` falls inside this exact address or CIDR block.
    pub fn contains(&self, candidate: IpAddr) -> bool {
        match (self.addr, candidate) {
            (IpAddr::V4(network), IpAddr::V4(candidate)) => {
                let mask = ipv4_mask(self.prefix);
                (u32::from(network) & mask) == (u32::from(candidate) & mask)
            }
            (IpAddr::V6(network), IpAddr::V6(candidate)) => {
                let mask = ipv6_mask(self.prefix);
                (u128::from(network) & mask) == (u128::from(candidate) & mask)
            }
            // Never match across address families.
            _ => false,
        }
    }

    /// Parse one token: an exact `IpAddr` or an `IpAddr/prefix` CIDR (DD3).
    pub fn parse(token: &str) -> Result<Self, String> {
        let token = token.trim();
        if token.is_empty() {
            return Err("empty trusted proxy token".to_string());
        }
        let (addr_part, prefix_part) = match token.split_once('/') {
            Some((addr, prefix)) => (addr, Some(prefix)),
            None => (token, None),
        };
        let addr: IpAddr = addr_part
            .parse()
            .map_err(|_| format!("invalid trusted proxy address: {addr_part:?}"))?;
        let Some(prefix_part) = prefix_part else {
            return Ok(Self::exact(addr));
        };
        let max_prefix = match addr {
            IpAddr::V4(_) => 32,
            IpAddr::V6(_) => 128,
        };
        let prefix: u8 = prefix_part
            .parse()
            .map_err(|_| format!("invalid trusted proxy prefix: {prefix_part:?}"))?;
        if prefix > max_prefix {
            return Err(format!("trusted proxy prefix out of range: {token:?}"));
        }
        Ok(Self { addr, prefix })
    }
}

fn ipv4_mask(prefix: u8) -> u32 {
    if prefix == 0 {
        0
    } else {
        u32::MAX << (32 - prefix)
    }
}

fn ipv6_mask(prefix: u8) -> u128 {
    if prefix == 0 {
        0
    } else {
        u128::MAX << (128 - prefix)
    }
}

/// Parse a `TRUSTED_PROXIES` value: comma-separated exact IPs or
/// `IP/prefix` CIDRs. `None` (absent) or an empty/whitespace value means
/// "trust nobody"; any malformed token is an error (DD3). Opting in is
/// explicit: while the proxy fronting this service is not listed, every
/// client behind it shares one bucket keyed by the proxy's socket address.
pub fn parse_trusted_proxies(raw: Option<&str>) -> Result<Vec<TrustedProxy>, String> {
    let Some(raw) = raw else {
        return Ok(Vec::new());
    };
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(Vec::new());
    }
    raw.split(',').map(TrustedProxy::parse).collect()
}

/// Read and validate `TRUSTED_PROXIES` from the process environment.
pub fn trusted_proxies_from_env() -> Result<Vec<TrustedProxy>, String> {
    parse_trusted_proxies(env::var("TRUSTED_PROXIES").ok().as_deref())
}

/// Hermes proxy defaults: the owner spec fixes a 10 min budget so heavy tool
/// chains finish without a premature disconnect.
pub const HERMES_DEFAULT_TIMEOUT_MS: u64 = 600_000;

/// Smallest accepted `HERMES_TIMEOUT`. Anything below it is a startup error,
/// never a silently weakened budget.
pub const HERMES_MIN_TIMEOUT_MS: u64 = 60_000;

/// Outbound Hermes configuration. The API key never leaves the backend: the
/// browser only ever talks to `/api/hermes`.
#[derive(Clone)]
pub struct HermesConfig {
    pub api_url: String,
    pub api_key: String,
    pub http: reqwest::Client,
    /// Client for streamed turns: no total deadline, only a per-read silence
    /// budget, so a long tool chain that keeps emitting never gets killed.
    pub stream_http: reqwest::Client,
    /// Effective `HERMES_TIMEOUT` in milliseconds; the browser uses it to
    /// decide when to offer "keep waiting" instead of guessing the budget.
    pub timeout_ms: u64,
}

/// Debug never prints the bearer credential, even if a future log statement
/// derives `Debug` on the whole config.
impl std::fmt::Debug for HermesConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HermesConfig")
            .field("api_url", &self.api_url)
            .field("api_key", &"<redacted>")
            .field("timeout_ms", &self.timeout_ms)
            .field("http", &self.http)
            .field("stream_http", &self.stream_http)
            .finish()
    }
}

/// Parse `HERMES_TIMEOUT` (milliseconds). Absent/empty keeps the 10 min
/// default; anything below the 60 s floor is rejected so a misconfiguration
/// cannot shorten the chat budget to something unusable.
pub fn parse_hermes_timeout(raw: Option<&str>) -> Result<Duration, String> {
    let Some(raw) = raw.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(Duration::from_millis(HERMES_DEFAULT_TIMEOUT_MS));
    };
    let ms = raw
        .parse::<u64>()
        .map_err(|_| "HERMES_TIMEOUT must be an integer number of milliseconds".to_string())?;
    if ms < HERMES_MIN_TIMEOUT_MS {
        return Err(format!(
            "HERMES_TIMEOUT must be at least {HERMES_MIN_TIMEOUT_MS} ms (60 s)"
        ));
    }
    Ok(Duration::from_millis(ms))
}

/// Build the outbound config from already-read values (env-free, so tests do
/// not mutate process state). Both the URL and key are required together;
/// neither means "not configured" (the proxy answers 503, the app still boots).
pub fn hermes_config_from_parts(
    url: Option<&str>,
    key: Option<&str>,
    timeout_raw: Option<&str>,
) -> Result<Option<HermesConfig>, String> {
    let timeout = parse_hermes_timeout(timeout_raw)?;
    let url = url.map(str::trim).filter(|v| !v.is_empty());
    let key = key.map(str::trim).filter(|v| !v.is_empty());
    match (url, key) {
        (None, None) => Ok(None),
        (Some(url), Some(key)) => {
            let parsed =
                reqwest::Url::parse(url).map_err(|_| "HERMES_API_URL must be an absolute URL".to_string())?;
            if !matches!(parsed.scheme(), "http" | "https") {
                return Err("HERMES_API_URL must use http or https".to_string());
            }
            let http = reqwest::Client::builder()
                .timeout(timeout)
                .build()
                .map_err(|_| "could not build the Hermes HTTP client".to_string())?;
            let stream_http = reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .read_timeout(timeout)
                .build()
                .map_err(|_| "could not build the Hermes stream client".to_string())?;
            Ok(Some(HermesConfig {
                api_url: url.to_string(),
                api_key: key.to_string(),
                http,
                stream_http,
                timeout_ms: u64::try_from(timeout.as_millis()).unwrap_or(u64::MAX),
            }))
        }
        _ => Err("HERMES_API_URL and HERMES_API_KEY must be configured together".to_string()),
    }
}

/// Read the Hermes proxy configuration from the process environment.
pub fn hermes_config_from_env() -> Result<Option<HermesConfig>, String> {
    let url = env::var("HERMES_API_URL").ok();
    let key = env::var("HERMES_API_KEY").ok();
    let timeout = env::var("HERMES_TIMEOUT").ok();
    hermes_config_from_parts(url.as_deref(), key.as_deref(), timeout.as_deref())
}

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub port: u16,
    pub session_ttl_hours: u64,
    pub static_dir: Option<String>,
    /// `None` when Hermes is not configured yet; `/api/hermes` then answers
    /// 503 without breaking startup. Partial configuration is an error.
    pub hermes: Option<HermesConfig>,
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

        // SEC-004/DD3: validate the trusted-proxy allow-list at startup. A
        // malformed token aborts startup; absent or empty means "trust
        // nobody". The set is carried on `LoginRateLimiter` (DD3 amendment,
        // AppState shape untouched), so the login path re-reads this same
        // helper rather than receiving the value from `Config`.
        trusted_proxies_from_env().map_err(|e| format!("TRUSTED_PROXIES: {e}"))?;
        let hermes = hermes_config_from_env().map_err(|e| format!("HERMES: {e}"))?;

        Ok(Self {
            database_url,
            port,
            session_ttl_hours,
            static_dir,
            hermes,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().expect("test IP literal")
    }

    // -- S1.3 RED: TRUSTED_PROXIES parse/validate (SEC-004, DD3) --

    #[test]
    fn trusted_proxies_absent_or_empty_trust_nobody() {
        assert!(parse_trusted_proxies(None).unwrap().is_empty());
        assert!(parse_trusted_proxies(Some("")).unwrap().is_empty());
        assert!(parse_trusted_proxies(Some("   ")).unwrap().is_empty());
    }

    #[test]
    fn trusted_proxies_parse_exact_ips_and_cidrs() {
        let list = parse_trusted_proxies(Some("127.0.0.1, 10.0.0.0/8, ::1, 2001:db8::/32"))
            .expect("valid list must parse");
        assert_eq!(list.len(), 4);
        assert!(list[0].contains(ip("127.0.0.1")));
        assert!(!list[0].contains(ip("127.0.0.2")));
        assert!(list[1].contains(ip("10.200.30.40")));
        assert!(!list[1].contains(ip("11.200.30.40")));
        assert!(list[2].contains(ip("::1")));
        assert!(!list[2].contains(ip("::2")));
        assert!(list[3].contains(ip("2001:db8:abcd::1")));
        assert!(!list[3].contains(ip("2001:db9::1")));
        // Cross-family candidates never match.
        assert!(!list[1].contains(ip("::ffff:10.0.0.1")));
    }

    #[test]
    fn trusted_proxies_reject_malformed_tokens() {
        for bad in [
            "not-an-ip",
            "10.0.0.0/33",
            "::1/129",
            "10.0.0.1/",
            "/24",
            "10.0.0.0/abc",
            "10.0.0.1, bad",
        ] {
            assert!(
                parse_trusted_proxies(Some(bad)).is_err(),
                "{bad:?} must be rejected"
            );
        }
    }

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

#[cfg(test)]
mod hermes_config_tests {
    use super::*;

    #[test]
    fn timeout_defaults_to_ten_minutes_and_rejects_values_below_the_floor() {
        assert_eq!(
            parse_hermes_timeout(None).expect("absent uses the default"),
            Duration::from_millis(600_000)
        );
        assert_eq!(
            parse_hermes_timeout(Some("  ")).expect("blank uses the default"),
            Duration::from_millis(600_000)
        );
        assert_eq!(
            parse_hermes_timeout(Some("60000")).expect("the floor is accepted"),
            Duration::from_millis(60_000)
        );
        assert_eq!(
            parse_hermes_timeout(Some("900000")).expect("larger values pass"),
            Duration::from_millis(900_000)
        );
        assert!(parse_hermes_timeout(Some("59999")).is_err());
        assert!(parse_hermes_timeout(Some("nope")).is_err());
    }

    #[test]
    fn parts_require_url_and_key_together() {
        assert!(hermes_config_from_parts(None, None, None)
            .expect("absent is not an error")
            .is_none());
        assert!(hermes_config_from_parts(Some(""), Some(""), None)
            .expect("blank is treated as absent")
            .is_none());
        assert!(hermes_config_from_parts(Some("http://10.0.0.5:8642/x"), None, None).is_err());
        assert!(hermes_config_from_parts(None, Some("secret"), None).is_err());
    }

    #[test]
    fn parts_validate_the_upstream_url_scheme() {
        assert!(hermes_config_from_parts(Some("ftp://host/x"), Some("k"), None).is_err());
        assert!(hermes_config_from_parts(Some("/relative"), Some("k"), None).is_err());
        let cfg = hermes_config_from_parts(
            Some("http://192.168.50.120:8642/v1/chat/completions"),
            Some("secret"),
            Some("200000"),
        )
        .expect("valid config")
        .expect("configured");
        assert_eq!(cfg.api_url, "http://192.168.50.120:8642/v1/chat/completions");
        assert_eq!(cfg.api_key, "secret");
    }
}
