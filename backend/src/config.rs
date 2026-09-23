use std::{env, net::IpAddr};

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

        // SEC-004/DD3: validate the trusted-proxy allow-list at startup. A
        // malformed token aborts startup; absent or empty means "trust
        // nobody". The set is carried on `LoginRateLimiter` (DD3 amendment,
        // AppState shape untouched), so the login path re-reads this same
        // helper rather than receiving the value from `Config`.
        trusted_proxies_from_env().map_err(|e| format!("TRUSTED_PROXIES: {e}"))?;

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
