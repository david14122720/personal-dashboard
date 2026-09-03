use std::{
    collections::HashMap,
    net::IpAddr,
    sync::Mutex,
    time::{Duration, Instant},
};

const MAX_REQUESTS: usize = 10;
const WINDOW: Duration = Duration::from_secs(15 * 60);

/// In-process fixed-window rate limiter for `POST /login`.
/// Single-replica assumption documented in design decision 5.
/// Thread-safe via `Mutex<HashMap>`.
pub struct LoginRateLimiter {
    inner: Mutex<HashMap<IpAddr, Vec<Instant>>>,
    max_requests: usize,
    window: Duration,
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
        }
    }

    /// Test helper with custom window.
    #[cfg(test)]
    fn with_window(window: Duration) -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            max_requests: MAX_REQUESTS,
            window,
        }
    }

    /// Check if `ip` is rate-limited.
    /// Returns `None` if allowed (and records the attempt), or `Some(retry_after)` if blocked.
    pub fn check(&self, ip: IpAddr) -> Option<Duration> {
        let mut map = self.inner.lock().expect("rate limiter mutex poisoned");
        let now = Instant::now();
        let entries = map.entry(ip).or_default();

        // Evict expired entries
        entries.retain(|t| now.duration_since(*t) < self.window);

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

    /// Current count for `ip` within window (for testing).
    #[cfg(test)]
    fn count(&self, ip: IpAddr) -> usize {
        let map = self.inner.lock().unwrap();
        map.get(&ip).map_or(0, |v| v.len())
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
}
