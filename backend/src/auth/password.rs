use argon2::{
    password_hash::{phc::PasswordHash, PasswordHasher, PasswordVerifier},
    Argon2, Params, Algorithm, Version,
};

/// Fixed dummy PHC hash used when the login row is missing or inactive (A3).
/// It carries the exact production parameters (`m=19456, t=2, p=1`) so an
/// unknown or deactivated account pays the same Argon2 cost as a real
/// password check before the identical generic 401. The salt/value are
/// constant on purpose: the hash is never stored and never matches a real
/// password, it only needs to parse and verify.
pub const DUMMY_PASSWORD_HASH: &str =
    "$argon2id$v=19$m=19456,t=2,p=1$dzMtZHVtbXktc2FsdC0wMQ$WlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlo";

#[cfg(test)]
thread_local! {
    /// Per-thread count of Argon2 verifications, so login tests can prove
    /// exactly one verification per syntactically valid attempt without
    /// racing parallel tests.
    static VERIFY_CALLS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
pub(crate) fn reset_verify_count() {
    VERIFY_CALLS.with(|calls| calls.set(0));
}

#[cfg(test)]
pub(crate) fn verify_count() -> usize {
    VERIFY_CALLS.with(|calls| calls.get())
}

/// Argon2id parameters per design decision 4: m=19456, t=2, p=1
fn argon2_instance() -> Argon2<'static> {
    let params = Params::new(19456, 2, 1, None).expect("valid argon2 params");
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
}

/// Hash a plaintext password with Argon2id.
/// Returns PHC-encoded string suitable for storage in `users.password_hash`.
pub fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    let argon2 = argon2_instance();
    let hash = argon2.hash_password(password.as_bytes())?;
    Ok(hash.to_string())
}

/// Verify a plaintext password against a stored PHC hash.
/// Returns `true` if valid, `false` otherwise (including parse errors).
/// Uses constant-time verification internally via `argon2` crate.
///
/// An unparseable stored hash falls back to [`DUMMY_PASSWORD_HASH`] instead
/// of returning early, so this path still pays exactly one Argon2
/// verification and cannot be told apart from the unknown-user path (A3
/// timing equivalence).
pub fn verify_password(password: &str, hash: &str) -> bool {
    let parsed = match PasswordHash::new(hash) {
        Ok(p) => p,
        Err(_) => match PasswordHash::new(DUMMY_PASSWORD_HASH) {
            Ok(dummy) => dummy,
            Err(_) => return false,
        },
    };
    #[cfg(test)]
    VERIFY_CALLS.with(|calls| calls.set(calls.get() + 1));
    argon2_instance()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_and_verify_round_trip() {
        let pw = "correct-horse-battery-staple";
        let hash = hash_password(pw).expect("hash ok");
        assert!(verify_password(pw, &hash));
    }

    #[test]
    fn wrong_password_fails() {
        let hash = hash_password("secret123").unwrap();
        assert!(!verify_password("wrong", &hash));
    }

    #[test]
    fn invalid_hash_returns_false() {
        assert!(!verify_password("anything", "not-a-valid-hash"));
    }

    #[test]
    fn empty_password_round_trips() {
        let hash = hash_password("").unwrap();
        assert!(verify_password("", &hash));
        assert!(!verify_password(" ", &hash));
    }

    #[test]
    fn hash_contains_argon2id_identifier() {
        let hash = hash_password("test").unwrap();
        assert!(hash.starts_with("$argon2id$"), "hash should be argon2id: {hash}");
    }

    #[test]
    fn dummy_hash_parses_with_production_parameters_and_never_matches() {
        assert!(
            PasswordHash::new(DUMMY_PASSWORD_HASH).is_ok(),
            "the dummy PHC hash must parse"
        );
        assert!(DUMMY_PASSWORD_HASH.contains("m=19456,t=2,p=1"));
        assert!(!verify_password("anything", DUMMY_PASSWORD_HASH));
        assert!(!verify_password("", DUMMY_PASSWORD_HASH));
    }

    #[test]
    fn verify_counter_counts_exactly_one_verification_on_every_path() {
        reset_verify_count();
        assert!(!verify_password("x", "not-a-valid-hash"));
        assert_eq!(
            verify_count(),
            1,
            "an unparseable stored hash must still pay one dummy Argon2 verification"
        );
        let hash = hash_password("secret").unwrap();
        assert!(verify_password("secret", &hash));
        assert_eq!(verify_count(), 2, "a correct password verifies exactly once");
        assert!(!verify_password("wrong", &hash));
        assert_eq!(verify_count(), 3, "a wrong password verifies exactly once");
        assert!(!verify_password("anything", DUMMY_PASSWORD_HASH));
        assert_eq!(verify_count(), 4, "the dummy hash verifies exactly once");
    }
}
