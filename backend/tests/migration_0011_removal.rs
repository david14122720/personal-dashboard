//! Guard for migration 0011 (S1 remnant, extended in S3a).
//!
//! S1 deleted the transfer routes and retired
//! `migration_0005_transfer_trigger.rs`. The only assertion that must survive
//! is the byte-guard proving applied migrations were never rewritten: 0002
//! still contains its original transfer logic (`counter_account_id`).
//! S3a appends the eight 0011 post-conditions to this same file.

use std::path::PathBuf;

fn migrations_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("migrations")
}

fn read_migration(name: &str) -> String {
    let path = migrations_dir().join(name);
    std::fs::read_to_string(&path)
        .unwrap_or_else(|_| panic!("migration file must exist: {}", path.display()))
}

#[test]
fn migration_is_function_only_and_0002_untouched() {
    let sql = read_migration("0005_fix_transfer_trigger.sql");
    assert!(
        !sql.contains("CREATE TRIGGER"),
        "0005 must only replace the function body, not recreate triggers"
    );
    // 0002 keeps its original (buggy) transfer logic — proof we never edited it.
    let original = read_migration("0002_finance.sql");
    assert!(
        original.contains("counter_account_id"),
        "0002 must still contain its original transfer logic (never edit applied migrations)"
    );
}
