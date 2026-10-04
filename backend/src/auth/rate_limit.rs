use std::{
    collections::HashMap,
    hash::Hash,
    net::IpAddr,
    sync::Mutex,
    time::{Duration, Instant},
};

use crate::config::{trusted_proxies_from_env, TrustedProxy};

/// Failure budget per client IP: 10 failures / `WINDOW`.
const MAX_REQUESTS: usize = 10;
/// Failure budget per normalized account email: 5 failures / `WINDOW`.
///
/// Residual self-lockout tradeoff (accepted, design decision 5): an attacker
/// who knows an email can delay that account's next successful login for at
/// most `WINDOW` (15 min) by burning this budget. The delay is bounded by
/// the window and never extends past the last recorded failure; a successful
/// login clears the bucket immediately.
const MAX_ACCOUNT_FAILURES: usize = 5;
const WINDOW: Duration = Duration::from_secs(15 * 60);
/// Hard ceiling for distinct keys retained by [`LoginRateLimiter`] (DD5),
/// applied independently to the IP map and the account map.
const MAX_KEYS: usize = 4096;

/// In-process fixed-window rate limiter for `POST /login`.
/// Single-replica assumption documented in design decision 5.
///
/// Failure-only (A2): successful logins consume no quota and clear the
/// account bucket; only the IP bucket bounds a client that rotates emails.
/// Account keys are edge-trimmed and lowercased so `CITEXT` casing cannot
/// split one account across two buckets.
pub struct LoginRateLimiter {
    inner: Mutex<LimiterState>,
    max_requests: usize,
    max_account_failures: usize,
    window: Duration,
    max_keys: usize,
    trusted_proxies: Vec<TrustedProxy>,
}

/// The two bounded maps share one mutex: every request either inspects or
/// updates both, so a single critical section keeps them consistent.
#[derive(Default)]
struct LimiterState {
    by_ip: HashMap<IpAddr, Vec<Instant>>,
    by_account: HashMap<String, Vec<Instant>>,
}

impl Default for LoginRateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

impl LoginRateLimiter {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(LimiterState::default()),
            max_requests: MAX_REQUESTS,
            max_account_failures: MAX_ACCOUNT_FAILURES,
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
            inner: Mutex::new(LimiterState::default()),
            max_requests: MAX_REQUESTS,
            max_account_failures: MAX_ACCOUNT_FAILURES,
            window,
            max_keys: MAX_KEYS,
            trusted_proxies: Vec::new(),
        }
    }

    /// Test helper with custom window and key cap.
    #[cfg(test)]
    fn with_limits(window: Duration, max_keys: usize) -> Self {
        Self {
            inner: Mutex::new(LimiterState::default()),
            max_requests: MAX_REQUESTS,
            max_account_failures: MAX_ACCOUNT_FAILURES,
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
            inner: Mutex::new(LimiterState::default()),
            max_requests: MAX_REQUESTS,
            max_account_failures: MAX_ACCOUNT_FAILURES,
            window: WINDOW,
            max_keys: MAX_KEYS,
            trusted_proxies: trusted,
        }
    }

    /// Normalized account key: trimmed and lowercased, matching the `CITEXT`
    /// lookup semantics of `users.email`.
    pub fn normalize_account(email: &str) -> String {
        email.trim().to_lowercase()
    }

    /// Gate `POST /login` before any DB or Argon2 work. Returns `None` when
    /// both buckets allow the attempt, or `Some(retry_after)` with the larger
    /// remaining window when either bucket is full. Never records anything.
    pub fn check_login(&self, ip: IpAddr, account: &str) -> Option<Duration> {
        // SEC-005: a poisoned lock must not panic inside the request path;
        // recover the guard and keep serving.
        let mut state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        prune(&mut state.by_ip, self.window, now);
        prune(&mut state.by_account, self.window, now);

        let account = Self::normalize_account(account);
        let ip_retry = blocked_for(
            state.by_ip.get(&ip),
            self.max_requests,
            self.window,
            now,
        );
        let account_retry = blocked_for(
            state.by_account.get(&account),
            self.max_account_failures,
            self.window,
            now,
        );
        match (ip_retry, account_retry) {
            (None, None) => None,
            (Some(ip_window), None) => Some(ip_window),
            (None, Some(account_window)) => Some(account_window),
            (Some(ip_window), Some(account_window)) => Some(ip_window.max(account_window)),
        }
    }

    /// Record one failed authentication against both buckets. Called only
    /// after Argon2 verification returned false (or the row was missing /
    /// inactive, which also verifies against the dummy hash).
    pub fn record_failure(&self, ip: IpAddr, account: &str) {
        let mut state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        prune(&mut state.by_ip, self.window, now);
        prune(&mut state.by_account, self.window, now);

        let account = Self::normalize_account(account);
        bound_keys(
            &mut state.by_ip,
            &ip,
            self.max_requests,
            self.max_keys,
        );
        bound_keys(
            &mut state.by_account,
            &account,
            self.max_account_failures,
            self.max_keys,
        );
        state.by_ip.entry(ip).or_default().push(now);
        state.by_account.entry(account).or_default().push(now);
    }

    /// Clear the account bucket after a successful login. The IP bucket is
    /// deliberately untouched: failures from an IP stay visible even when a
    /// later account on it succeeds.
    pub fn record_success(&self, account: &str) {
        let mut state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        prune(&mut state.by_account, self.window, now);
        state.by_account.remove(&Self::normalize_account(account));
    }

    #[allow(dead_code)]
    #[cfg(test)]
    pub(crate) fn count_ip(&self, ip: IpAddr) -> usize {
        let state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        state.by_ip.get(&ip).map_or(0, |v| v.len())
    }

    #[allow(dead_code)]
    #[cfg(test)]
    pub(crate) fn count_account(&self, account: &str) -> usize {
        let state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        state
            .by_account
            .get(&Self::normalize_account(account))
            .map_or(0, |v| v.len())
    }

    #[allow(dead_code)]
    #[cfg(test)]
    fn key_count_ip(&self) -> usize {
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).by_ip.len()
    }

    #[allow(dead_code)]
    #[cfg(test)]
    fn key_count_account(&self) -> usize {
        self.inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .by_account
            .len()
    }
}

/// Drop attempts outside the window and any key left empty, so neither map
/// can accrete stale keys.
fn prune<K>(map: &mut HashMap<K, Vec<Instant>>, window: Duration, now: Instant) {
    map.retain(|_, entries| {
        entries.retain(|t| now.duration_since(*t) < window);
        !entries.is_empty()
    });
}

/// Remaining lockout for one bucket, or `None` when it still has room.
/// The value is the true remaining window (at most `WINDOW`); the handler
/// rounds it up to at least one second for the `Retry-After` header.
fn blocked_for(
    entries: Option<&Vec<Instant>>,
    limit: usize,
    window: Duration,
    now: Instant,
) -> Option<Duration> {
    let entries = entries?;
    if entries.len() < limit {
        return None;
    }
    let oldest = entries.iter().min().copied().unwrap_or(now);
    Some((oldest + window).saturating_duration_since(now))
}

/// Bound the number of distinct keys in one map. Prefer evicting the least
/// recently active key that is not currently blocked. When every tracked key
/// is blocked there is no safe victim left, so the least recently active key
/// is evicted anyway: the map must never exceed `max_keys`, otherwise unique
/// sources could grow it (and the per-request prune cost) without bound.
fn bound_keys<K: Eq + Hash + Clone>(
    map: &mut HashMap<K, Vec<Instant>>,
    incoming: &K,
    key_limit: usize,
    max_keys: usize,
) {
    if map.contains_key(incoming) || map.len() < max_keys {
        return;
    }
    let unblocked = map
        .iter()
        .filter(|(_, entries)| entries.len() < key_limit)
        .min_by_key(|(_, entries)| entries.last().copied())
        .map(|(key, _)| key.clone());
    let victim = unblocked.or_else(|| {
        map.iter()
            .min_by_key(|(_, entries)| entries.last().copied())
            .map(|(key, _)| key.clone())
    });
    if let Some(victim) = victim {
        map.remove(&victim);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    fn ip() -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))
    }

    fn ip_n(n: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(10, 0, 0, n))
    }

    // -- A2: failure-only counting --

    #[test]
    fn checks_do_not_consume_quota() {
        // The old limiter recorded every `check`; the new one only inspects.
        let limiter = LoginRateLimiter::new();
        for _ in 0..(MAX_REQUESTS + 5) {
            assert!(limiter.check_login(ip(), "user@example.com").is_none());
        }
        assert_eq!(limiter.count_ip(ip()), 0);
        assert_eq!(limiter.count_account("user@example.com"), 0);
    }

    #[test]
    fn successful_login_does_not_consume_quota() {
        // A successful login clears only the account bucket and never blocks
        // the IP: repeated successes must keep succeeding.
        let limiter = LoginRateLimiter::new();
        for _ in 0..15 {
            assert!(limiter.check_login(ip(), "user@example.com").is_none());
            limiter.record_success("user@example.com");
        }
        assert_eq!(limiter.count_ip(ip()), 0);
        assert_eq!(limiter.count_account("user@example.com"), 0);
    }

    #[test]
    fn blocks_the_11th_failure_from_one_ip() {
        let limiter = LoginRateLimiter::new();
        for i in 0..MAX_REQUESTS {
            // Distinct accounts keep the account bucket out of this assertion.
            limiter.record_failure(ip(), &format!("victim-{i}@example.com"));
        }
        let retry = limiter.check_login(ip(), "victim-9@example.com").unwrap();
        assert!(retry > Duration::from_secs(0));
        assert!(retry <= WINDOW);
    }

    #[test]
    fn blocks_the_6th_failure_for_one_account_independent_of_the_ip_bucket() {
        let limiter = LoginRateLimiter::new();
        for _ in 0..MAX_ACCOUNT_FAILURES {
            limiter.record_failure(ip(), "owner@example.com");
        }
        assert_eq!(limiter.count_ip(ip()), MAX_ACCOUNT_FAILURES);
        assert!(
            limiter.check_login(ip(), "owner@example.com").is_some(),
            "the 6th attempt for a 5-failure account must be blocked"
        );
        assert!(
            limiter.check_login(ip(), "other@example.com").is_none(),
            "another account from the same IP must still be served"
        );
    }

    #[test]
    fn different_ips_are_independent() {
        let limiter = LoginRateLimiter::new();
        let blocked = ip_n(1);
        let other = ip_n(2);
        for i in 0..MAX_REQUESTS {
            limiter.record_failure(blocked, &format!("blocked-{i}@example.com"));
        }
        assert!(limiter.check_login(blocked, "blocked-0@example.com").is_some());
        assert!(limiter.check_login(other, "elsewhere@example.com").is_none());
    }

    #[test]
    fn retry_after_is_positive_and_within_the_window() {
        let limiter = LoginRateLimiter::new();
        for _ in 0..MAX_REQUESTS {
            limiter.record_failure(ip(), "user@example.com");
        }
        let retry = limiter.check_login(ip(), "user@example.com").unwrap();
        assert!(retry > Duration::from_secs(0));
        assert!(retry <= WINDOW);
    }

    #[test]
    fn self_lockout_expires_no_later_than_the_window() {
        let limiter = LoginRateLimiter::with_window(Duration::from_millis(50));
        for _ in 0..MAX_ACCOUNT_FAILURES {
            limiter.record_failure(ip(), "owner@example.com");
        }
        let retry = limiter.check_login(ip(), "owner@example.com").unwrap();
        assert!(retry <= Duration::from_millis(50));
        std::thread::sleep(Duration::from_millis(60));
        assert!(
            limiter.check_login(ip(), "owner@example.com").is_none(),
            "the bucket must drain within the window"
        );
    }

    #[test]
    fn success_clears_only_the_account_bucket() {
        let limiter = LoginRateLimiter::new();
        for _ in 0..3 {
            limiter.record_failure(ip(), "owner@example.com");
        }
        limiter.record_success(" Owner@Example.com ");
        assert_eq!(limiter.count_account("owner@example.com"), 0);
        assert_eq!(
            limiter.count_ip(ip()),
            3,
            "a success must never clear the IP bucket"
        );
    }

    #[test]
    fn account_key_is_trimmed_and_lowercased() {
        let limiter = LoginRateLimiter::new();
        for _ in 0..MAX_ACCOUNT_FAILURES {
            limiter.record_failure(ip(), " Owner@Example.com ");
        }
        assert_eq!(limiter.count_account("owner@example.com"), MAX_ACCOUNT_FAILURES);
        assert!(
            limiter.check_login(ip(), "OWNER@example.com").is_some(),
            "CITEXT-style normalization must key the same bucket"
        );
        limiter.record_success("owner@EXAMPLE.com");
        assert!(limiter.check_login(ip(), " Owner@example.com ").is_none());
    }

    // -- A2: bound discipline survives per map --

    #[test]
    fn key_count_stays_bounded_per_map() {
        // SEC-005: many distinct keys must not grow either map without bound.
        let limiter = LoginRateLimiter::with_limits(Duration::from_secs(60), 4);
        for i in 0..10u8 {
            limiter.record_failure(ip_n(i), &format!("acct-{i}@example.com"));
        }
        assert!(
            limiter.key_count_ip() <= 4,
            "IP map retained {} keys with cap 4",
            limiter.key_count_ip()
        );
        assert!(
            limiter.key_count_account() <= 4,
            "account map retained {} keys with cap 4",
            limiter.key_count_account()
        );
    }

    #[test]
    fn expired_keys_are_removed_from_both_maps() {
        let limiter = LoginRateLimiter::with_limits(Duration::from_millis(50), 4096);
        let stale_ip = ip_n(1);
        limiter.record_failure(stale_ip, "stale@example.com");
        std::thread::sleep(Duration::from_millis(60));
        // Any limiter call prunes expired attempts (and emptied keys).
        assert!(limiter.check_login(ip_n(2), "fresh@example.com").is_none());
        assert_eq!(limiter.count_ip(stale_ip), 0, "expired IP key must be removed");
        assert_eq!(
            limiter.count_account("stale@example.com"),
            0,
            "expired account key must be removed"
        );
        assert_eq!(limiter.key_count_ip(), 0);
        assert_eq!(limiter.key_count_account(), 0);
    }

    #[test]
    fn blocked_ip_survives_eviction_pressure() {
        let limiter = LoginRateLimiter::with_limits(Duration::from_secs(60), 2);
        let blocked = ip_n(1);
        for i in 0..MAX_REQUESTS {
            limiter.record_failure(blocked, &format!("blocked-{i}@example.com"));
        }
        // Two more distinct IPs force eviction under the cap; the blocked IP
        // must never be chosen as the victim.
        limiter.record_failure(ip_n(2), "second@example.com");
        limiter.record_failure(ip_n(3), "third@example.com");
        assert!(
            limiter.check_login(blocked, "blocked-0@example.com").is_some(),
            "a currently blocked IP key must never be evicted"
        );
        assert!(limiter.key_count_ip() <= 2);
    }

    #[test]
    fn blocked_account_survives_eviction_pressure() {
        let limiter = LoginRateLimiter::with_limits(Duration::from_secs(60), 2);
        for i in 0..MAX_ACCOUNT_FAILURES {
            limiter.record_failure(ip_n(i as u8), "blocked@example.com");
        }
        limiter.record_failure(ip_n(100), "second@example.com");
        limiter.record_failure(ip_n(101), "third@example.com");
        assert!(
            limiter.check_login(ip_n(200), "blocked@example.com").is_some(),
            "a currently blocked account key must never be evicted"
        );
        assert!(limiter.key_count_account() <= 2);
    }

    #[test]
    fn saturated_maps_stay_at_the_cap_and_admit_a_legit_login() {
        // SEC-005 review fix: when every tracked key is already blocked and
        // new sources keep arriving, the eviction fallback must still retire
        // the least recently active key so neither map can grow past its cap.
        let cap = 4;
        let limiter = LoginRateLimiter::with_limits(Duration::from_secs(60), cap);
        // Saturate both maps: each (ip, account) pair burns its full failure
        // budget, so no tracked key is evictable as "unblocked".
        for k in 0..cap as u8 {
            for _ in 0..MAX_REQUESTS {
                limiter.record_failure(ip_n(k), &format!("blocked-{k}@example.com"));
            }
        }
        assert_eq!(limiter.key_count_ip(), cap);
        assert_eq!(limiter.key_count_account(), cap);
        // Thousands of distinct sources: before the fix every one of them
        // added a key while no victim could be found, growing both maps
        // without bound (and making every request prune the growing map).
        for i in 0..2000usize {
            let ip = IpAddr::V4(Ipv4Addr::new(10, ((i >> 8) & 0xff) as u8, (i & 0xff) as u8, 7));
            limiter.record_failure(ip, &format!("flood-{i}@example.com"));
            assert!(
                limiter.key_count_ip() <= cap,
                "IP map grew to {} keys with cap {cap} at source {i}",
                limiter.key_count_ip()
            );
            assert!(
                limiter.key_count_account() <= cap,
                "account map grew to {} keys with cap {cap} at source {i}",
                limiter.key_count_account()
            );
        }
        // The limiter is still usable for a legitimate login afterwards.
        assert!(
            limiter.check_login(ip_n(200), "owner@example.com").is_none(),
            "a legitimate login must still pass after the flood"
        );
    }

    #[test]
    fn poisoned_mutex_does_not_panic() {
        let limiter = LoginRateLimiter::new();
        let poisoned = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = limiter.inner.lock().unwrap();
            panic!("poison the limiter lock on purpose");
        }));
        assert!(poisoned.is_err(), "the lock must have been poisoned");
        // The request paths recover the guard instead of panicking.
        assert!(limiter.check_login(ip(), "user@example.com").is_none());
        limiter.record_failure(ip(), "user@example.com");
        assert!(limiter.check_login(ip(), "user@example.com").is_none());
        limiter.record_success("user@example.com");
        assert_eq!(limiter.count_account("user@example.com"), 0);
    }
}
