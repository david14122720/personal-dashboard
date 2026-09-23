use std::{
    collections::HashMap,
    net::IpAddr,
    sync::Mutex,
    time::{Duration, Instant},
};

use crate::config::{trusted_proxies_from_env, TrustedProxy};

const MAX_REQUESTS: usize = 10;
const WINDOW: Duration = Duration::from_secs(15 * 60);
/// Hard ceiling for distinct keys retained by [`LoginRateLimiter`] (DD5).
const MAX_KEYS: usize = 4096;

/// In-process fixed-window rate limiter for `POST /login`.
/// Single-replica assumption documented in design decision 5.
/// Thread-safe via `Mutex<HashMap>`.
pub struct LoginRateLimiter {
    inner: Mutex<HashMap<IpAddr, Vec<Instant>>>,
    max_requests: usize,
    window: Duration,
    max_keys: usize,
    trusted_proxies: Vec<TrustedProxy>,
}

impl Default for LoginRateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

impl LoginRateLimiter {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            max_requests: MAX_REQUESTS,
            window: WINDOW,
            max_keys: MAX_KEYS,
            // SEC-004/DD3 amendment: the trusted set lives here instead of a
            // new `AppState` field. `Config::from_env` already validated the
            // same variable at startup (a malformed token aborts the
            // process); if this constructor ever sees a malformed value it
            // fails closed to "trust nobody".
            trusted_proxies: trusted_proxies_from_env().unwrap_or_default(),
        }
    }

    /// Trusted proxies whose `X-Forwarded-For` may be honoured when deriving
    /// the login rate-limit key (empty means trust nobody).
    pub fn trusted_proxies(&self) -> &[TrustedProxy] {
        &self.trusted_proxies
    }

    /// Test helper with custom window.
    #[cfg(test)]
    fn with_window(window: Duration) -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            max_requests: MAX_REQUESTS,
            window,
            max_keys: MAX_KEYS,
            trusted_proxies: Vec::new(),
        }
    }

    /// Test helper with custom window and key cap.
    #[cfg(test)]
    fn with_limits(window: Duration, max_keys: usize) -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            max_requests: MAX_REQUESTS,
            window,
            max_keys,
            trusted_proxies: Vec::new(),
        }
    }

    /// Test helper with an explicit trusted-proxy set (used by the login
    /// handler tests, which must not depend on the process environment).
    #[cfg(test)]
    pub(crate) fn with_trusted_proxies(trusted: Vec<TrustedProxy>) -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            max_requests: MAX_REQUESTS,
            window: WINDOW,
            max_keys: MAX_KEYS,
            trusted_proxies: trusted,
        }
    }

    /// Check if `ip` is rate-limited.
    /// Returns `None` if allowed (and records the attempt), or `Some(retry_after)` if blocked.
    pub fn check(&self, ip: IpAddr) -> Option<Duration> {
        // SEC-005: a poisoned lock must not panic inside the request path;
        // recover the guard and keep serving.
        let mut map = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();

        // Drop attempts outside the window and any key left empty, across the
        // whole map, so the table cannot accrete stale keys.
        map.retain(|_, entries| {
            entries.retain(|t| now.duration_since(*t) < self.window);
            !entries.is_empty()
        });

        // Bound the number of distinct keys. Evict the least recently active
        // key that is not currently blocked; if every key is blocked, keep
        // them all (a temporary over-cap is safer than resetting a blocker).
        if !map.contains_key(&ip) && map.len() >= self.max_keys {
            let victim = map
                .iter()
                .filter(|(_, entries)| entries.len() < self.max_requests)
                .min_by_key(|(_, entries)| entries.last().copied())
                .map(|(key, _)| *key);
            if let Some(victim) = victim {
                map.remove(&victim);
            }
        }

        let entries = map.entry(ip).or_default();

        if entries.len() >= self.max_requests {
            // Retry after the oldest entry expires
            let oldest = entries.iter().min().copied().unwrap_or(now);
            let retry_after = (oldest + self.window).saturating_duration_since(now);
            // Return at least 1 second
            Some(retry_after.max(Duration::from_secs(1)))
        } else {
            entries.push(now);
            None
        }
    }

    #[allow(dead_code)]
    #[cfg(test)]
    fn count(&self, ip: IpAddr) -> usize {
        let map = self.inner.lock().unwrap();
        map.get(&ip).map_or(0, |v| v.len())
    }

    #[allow(dead_code)]
    #[cfg(test)]
    fn key_count(&self) -> usize {
        self.inner.lock().unwrap().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    fn ip() -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))
    }

    #[test]
    fn allows_up_to_limit() {
        let limiter = LoginRateLimiter::new();
        for _ in 0..10 {
            assert!(limiter.check(ip()).is_none());
        }
    }

    #[test]
    fn blocks_11th_request() {
        let limiter = LoginRateLimiter::new();
        for _ in 0..10 {
            let _ = limiter.check(ip());
        }
        let retry = limiter.check(ip());
        assert!(retry.is_some());
        assert!(retry.unwrap() <= WINDOW);
    }

    #[test]
    fn different_ips_independent() {
        let limiter = LoginRateLimiter::new();
        let ip2 = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1));
        for _ in 0..10 {
            let _ = limiter.check(ip());
        }
        // ip2 should still be allowed
        assert!(limiter.check(ip2).is_none());
        // ip blocked
        assert!(limiter.check(ip()).is_some());
    }

    #[test]
    fn window_expiry_allows_again() {
        let limiter = LoginRateLimiter::with_window(Duration::from_millis(50));
        for _ in 0..10 {
            let _ = limiter.check(ip());
        }
        assert!(limiter.check(ip()).is_some());
        std::thread::sleep(Duration::from_millis(60));
        assert!(limiter.check(ip()).is_none());
    }

    #[test]
    fn retry_after_positive() {
        let limiter = LoginRateLimiter::new();
        for _ in 0..10 {
            let _ = limiter.check(ip());
        }
        let retry = limiter.check(ip()).unwrap();
        assert!(retry > Duration::from_secs(0));
        assert!(retry <= WINDOW);
    }

    #[test]
    fn key_count_stays_bounded_by_cap() {
        // SEC-005: many distinct keys must not grow the map without bound.
        let limiter = LoginRateLimiter::with_limits(Duration::from_secs(60), 4);
        for i in 0..10u8 {
            let _ = limiter.check(IpAddr::V4(Ipv4Addr::new(10, 0, 0, i)));
        }
        assert!(
            limiter.key_count() <= 4,
            "limiter retained {} keys with cap 4",
            limiter.key_count()
        );
    }

    #[test]
    fn expired_key_is_removed() {
        let limiter = LoginRateLimiter::with_limits(Duration::from_millis(50), 4);
        let stale = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1));
        let other = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 2));
        let _ = limiter.check(stale);
        std::thread::sleep(Duration::from_millis(60));
        // Any request prunes expired attempts (and emptied keys) across the map.
        let _ = limiter.check(other);
        assert_eq!(limiter.count(stale), 0, "expired key must be removed");
        assert_eq!(limiter.key_count(), 1, "only the active key remains");
    }

    #[test]
    fn blocked_key_survives_eviction_pressure() {
        let limiter = LoginRateLimiter::with_limits(Duration::from_secs(60), 2);
        let blocked = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1));
        for _ in 0..10 {
            let _ = limiter.check(blocked);
        }
        assert!(limiter.check(blocked).is_some());
        // Two more distinct keys force eviction under the cap; the blocked
        // key must never be chosen as the victim.
        let _ = limiter.check(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 2)));
        let _ = limiter.check(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 3)));
        assert!(
            limiter.check(blocked).is_some(),
            "a currently blocked key must never be evicted"
        );
        assert!(limiter.key_count() <= 2);
    }

    #[test]
    fn poisoned_mutex_does_not_panic() {
        let limiter = LoginRateLimiter::new();
        let poisoned = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = limiter.inner.lock().unwrap();
            panic!("poison the limiter lock on purpose");
        }));
        assert!(poisoned.is_err(), "the lock must have been poisoned");
        // The request path recovers the guard instead of panicking.
        assert!(limiter.check(ip()).is_none());
    }
}
