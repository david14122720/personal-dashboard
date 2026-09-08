use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::Rng;
use sha2::{Digest, Sha256};

/// Generate a 256-bit (32-byte) random token encoded as base64url (no padding).
/// Raw token is returned to the caller once; only its SHA-256 hash is stored.
pub fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Compute `hex(SHA-256(token))` for storage in `sessions.token_hash`.
/// Uses constant-time SHA-256; caller must store only the hash.
pub fn hash_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    hex::encode(digest)
}

#[allow(dead_code)]
/// Constant-time comparison of two hex-encoded hashes.
/// Returns `true` iff they are equal length and equal bytes.
pub fn hashes_equal(a: &str, b: &str) -> bool {
    use subtle::ConstantTimeEq;
    if a.len() != b.len() {
        return false;
    }
    a.as_bytes().ct_eq(b.as_bytes()).unwrap_u8() == 1
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn generate_token_is_base64url_no_pad() {
        let t = generate_token();
        // 32 bytes -> ceil(32*8/6)=43 chars base64url no pad
        assert_eq!(t.len(), 43);
        assert!(!t.contains('='));
        assert!(!t.contains('+'));
        assert!(!t.contains('/'));
    }

    #[test]
    fn generate_token_unique() {
        let tokens: HashSet<_> = (0..100).map(|_| generate_token()).collect();
        assert_eq!(tokens.len(), 100);
    }

    #[test]
    fn hash_token_deterministic() {
        let tok = "hello-world-token";
        assert_eq!(hash_token(tok), hash_token(tok));
    }

    #[test]
    fn hash_token_length_is_sha256_hex() {
        let h = hash_token(&generate_token());
        assert_eq!(h.len(), 64);
        assert!(h.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn hash_token_known_vector() {
        // SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
        assert_eq!(
            hash_token("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn round_trip_generate_then_hash() {
        let tok = generate_token();
        let h = hash_token(&tok);
        assert_eq!(h.len(), 64);
        // Re-hashing same token yields same hash
        assert_eq!(hash_token(&tok), h);
    }

    #[test]
    fn hashes_equal_true_and_false() {
        let h = hash_token("abc");
        assert!(hashes_equal(&h, &h));
        assert!(!hashes_equal(&h, &hash_token("abcd")));
        assert!(!hashes_equal(&h, "short"));
    }
}
