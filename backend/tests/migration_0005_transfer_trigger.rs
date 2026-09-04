//! Regression test for migration 0005: the `transfer` branch of
//! `apply_transaction_to_balance()` must be a no-op, while the
//! income/expense/credit-card paths keep their 0002 behavior.
//!
//! File-content test (no live DB needed): it inspects the migration SQL text.
//! A live-DB trigger-behavior test belongs to the transfer work unit (PR3).

use std::path::PathBuf;

fn migrations_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("migrations")
}

fn read_migration(name: &str) -> String {
    let path = migrations_dir().join(name);
    std::fs::read_to_string(&path)
        .unwrap_or_else(|_| panic!("migration file must exist: {}", path.display()))
}

/// Slice of `sql` from `start_marker` (inclusive) up to the first
/// `end_marker` after it. Panics if either marker is missing.
fn branch_slice<'a>(sql: &'a str, start_marker: &str, end_marker: &str) -> &'a str {
    let start = sql
        .find(start_marker)
        .unwrap_or_else(|| panic!("missing marker: {start_marker}"));
    let rest = &sql[start..];
    let end = rest.find(end_marker).unwrap_or_else(|| {
        panic!("missing end marker {end_marker} after {start_marker}");
    });
    &rest[..end]
}

#[test]
fn migration_0005_file_exists_and_replaces_trigger_function() {
    let sql = read_migration("0005_fix_transfer_trigger.sql");
    assert!(!sql.trim().is_empty(), "0005 must not be empty");
    assert!(
        sql.contains("CREATE OR REPLACE FUNCTION apply_transaction_to_balance()"),
        "0005 must CREATE OR REPLACE the balance trigger function"
    );
}

#[test]
fn transfer_insert_branch_is_noop() {
    let sql = read_migration("0005_fix_transfer_trigger.sql");
    let branch = branch_slice(&sql, "ELSIF NEW.type = 'transfer'", "RETURN NEW");
    assert!(
        !branch.contains("UPDATE accounts"),
        "transfer INSERT branch must not touch balances, found: {branch}"
    );
}

#[test]
fn transfer_delete_branch_is_noop() {
    let sql = read_migration("0005_fix_transfer_trigger.sql");
    let branch = branch_slice(&sql, "ELSIF OLD.type = 'transfer'", "RETURN OLD");
    assert!(
        !branch.contains("UPDATE accounts"),
        "transfer DELETE branch must not touch balances, found: {branch}"
    );
}

#[test]
fn income_expense_credit_card_paths_preserved() {
    let sql = read_migration("0005_fix_transfer_trigger.sql");
    for marker in [
        "NEW.type = 'income'",
        "NEW.type = 'expense'",
        "OLD.type = 'income'",
        "OLD.type = 'expense'",
        "balance + NEW.amount",
        "balance - NEW.amount",
        "balance + OLD.amount",
        "balance - OLD.amount",
        "credit_card_account_id",
    ] {
        assert!(
            sql.contains(marker),
            "0005 must preserve the income/expense/credit-card path: {marker}"
        );
    }
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
