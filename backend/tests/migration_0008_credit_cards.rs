//! Regression test for migration 0008: credit-card CHECKs + partial indexes.
//!
//! File-content test (no live DB needed): it inspects the migration SQL text.
//! Live-DB CHECK enforcement and EXPLAIN index-usage tests live in the
//! accounts work unit (`backend/src/routes/accounts.rs`).

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
fn migration_0008_file_exists_and_is_additive() {
    let sql = read_migration("0008_credit_cards.sql");
    assert!(!sql.trim().is_empty(), "0008 must not be empty");
    assert!(
        !sql.contains("CREATE TABLE"),
        "0008 must not create tables (columns already exist from 0002)"
    );
    assert!(
        !sql.contains("CREATE TRIGGER") && !sql.contains("CREATE OR REPLACE FUNCTION"),
        "0008 must not change triggers (P5 owns no trigger change)"
    );
}

#[test]
fn card_limit_presence_check_exists() {
    let sql = read_migration("0008_credit_cards.sql");
    assert!(
        sql.contains("chk_card_limit_presence"),
        "0008 must add the chk_card_limit_presence constraint"
    );
    assert!(
        sql.contains("credit_limit IS NOT NULL"),
        "presence check must key on credit_limit nullability"
    );
}

#[test]
fn card_limit_positivity_check_exists() {
    let sql = read_migration("0008_credit_cards.sql");
    assert!(
        sql.contains("chk_card_limit_pos"),
        "0008 must add the chk_card_limit_pos constraint"
    );
    assert!(
        sql.contains("credit_limit > 0"),
        "positivity check must require credit_limit > 0"
    );
}

#[test]
fn card_days_presence_check_exists() {
    let sql = read_migration("0008_credit_cards.sql");
    assert!(
        sql.contains("chk_card_days_presence"),
        "0008 must add the chk_card_days_presence constraint"
    );
    assert!(
        sql.contains("statement_day IS NOT NULL")
            && sql.contains("payment_due_day IS NOT NULL"),
        "days check must require both cycle days for cards"
    );
}

#[test]
fn partial_index_on_user_cards_exists() {
    let sql = read_migration("0008_credit_cards.sql");
    assert!(
        sql.contains("idx_accounts_user_card"),
        "0008 must add the idx_accounts_user_card partial index"
    );
    assert!(
        sql.contains("WHERE type='credit_card'") || sql.contains("WHERE type = 'credit_card'"),
        "card index must be partial on credit_card rows"
    );
}

#[test]
fn covering_index_on_card_transactions_exists() {
    let sql = read_migration("0008_credit_cards.sql");
    assert!(
        sql.contains("idx_tx_card_user_date"),
        "0008 must add the idx_tx_card_user_date covering index"
    );
    assert!(
        sql.contains("credit_card_account_id"),
        "card transaction index must lead on credit_card_account_id"
    );
    assert!(
        sql.contains("WHERE credit_card_account_id IS NOT NULL"),
        "card transaction index must be partial on linked rows"
    );
}

// ---------------------------------------------------------------------------
// Live-DB probes retired by W1 (change 2026-10-04-accounts-transfers-login-calendar).
//
// This file used to carry four live tests: `non_card_account_with_limit_is_rejected`,
// `card_account_without_limit_is_rejected`, `card_account_with_limit_and_days_is_accepted`
// and `card_queries_use_indexes_no_seq_scan`. They seeded `accounts` rows carrying
// `type`/`credit_limit`/`statement_day`/`payment_due_day` and asserted the 0008
// CHECKs (23514) and the `idx_accounts_user_card` EXPLAIN plan.
//
// Migration 0016 (owner-authorized 2026-10-04, an accepted product loss) drops all
// four columns, the three `chk_card_*` CHECKs and `idx_accounts_user_card`, so no
// live probe of the card contract can hold any more: the columns the probes seed do
// not exist after 0016, and the objects they assert are gone by design.
//
// The retirement is explicit, not a silent deletion. Three of those probes were
// already failing before this change in any database that never received 0008 —
// production never got the three CHECKs (so both rejection probes failed on the
// absent constraint) and never got `idx_accounts_user_card` (so the EXPLAIN probe
// failed on the missing index); those are the pre-existing environmental failures.
// The fourth probe (`card_account_with_limit_and_days_is_accepted`) passed only
// because production had the card columns, which 0016 removes.
//
// The file-content guards above stay binding: 0008 remains the historical record of
// the layer 0016 removes, and the post-0016 live post-conditions live in
// `backend/tests/migration_0016_remove_account_type.rs` (columns gone, enum gone,
// surviving shape and money invariants intact).
