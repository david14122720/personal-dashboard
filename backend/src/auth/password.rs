use argon2::{
    password_hash::{phc::PasswordHash, PasswordHasher, PasswordVerifier},
    Argon2, Params, Algorithm, Version,
};

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
pub fn verify_password(password: &str, hash: &str) -> bool {
    let parsed = match PasswordHash::new(hash) {
        Ok(p) => p,
        Err(_) => return false,
    };
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
}
