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
// Live-DB enforcement (tasks 1.2.1-1.2.3, 1.3). Skipped without DATABASE_URL.
// Run against the ephemeral verifier:
//   DATABASE_URL=postgres://verify:verify@localhost:5439/verify cargo test \
//     --test migration_0008_credit_cards
// ---------------------------------------------------------------------------

fn test_pool() -> Option<sqlx::PgPool> {
    std::env::var("DATABASE_URL")
        .ok()
        .map(|url| sqlx::PgPool::connect_lazy(&url).expect("lazy pool from DATABASE_URL"))
}

async fn seed_user(pool: &sqlx::PgPool) -> uuid::Uuid {
    let email = format!("cardmig-{}@example.com", uuid::Uuid::new_v4());
    sqlx::query_scalar(
        "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
    )
    .bind(&email)
    .bind("not-a-real-hash")
    .bind("card migration test")
    .fetch_one(pool)
    .await
    .expect("seed user")
}

async fn cleanup_user(pool: &sqlx::PgPool, user_id: uuid::Uuid) {
    sqlx::query("DELETE FROM users WHERE id=$1")
        .bind(user_id)
        .execute(pool)
        .await
        .expect("cleanup user");
}

fn pg_code(err: &sqlx::Error) -> Option<String> {
    if let sqlx::Error::Database(db) = err {
        db.code().map(|c| c.to_string())
    } else {
        None
    }
}

/// Task 1.2.1 RED: a non-card account carrying `credit_limit` must be
/// rejected by `chk_card_limit_presence` (23514).
#[tokio::test]
async fn non_card_account_with_limit_is_rejected() {
    let Some(pool) = test_pool() else {
        eprintln!("SKIP non_card_account_with_limit_is_rejected: no DATABASE_URL");
        return;
    };
    let user_id = seed_user(&pool).await;
    let err = sqlx::query(
        "INSERT INTO accounts (user_id, name, type, credit_limit) VALUES ($1,'Savings','savings',1000)",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .expect_err("non-card with limit must violate chk_card_limit_presence");
    assert_eq!(pg_code(&err).as_deref(), Some("23514"));
    cleanup_user(&pool, user_id).await;
}

/// Task 1.2.2 RED: a card account without `credit_limit` must be rejected
/// by `chk_card_limit_presence` (23514).
#[tokio::test]
async fn card_account_without_limit_is_rejected() {
    let Some(pool) = test_pool() else {
        eprintln!("SKIP card_account_without_limit_is_rejected: no DATABASE_URL");
        return;
    };
    let user_id = seed_user(&pool).await;
    let err = sqlx::query(
        "INSERT INTO accounts (user_id, name, type) VALUES ($1,'Visa','credit_card')",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .expect_err("card without limit must violate chk_card_limit_presence");
    assert_eq!(pg_code(&err).as_deref(), Some("23514"));
    cleanup_user(&pool, user_id).await;
}

/// Task 1.2.3 GREEN: a card account with `credit_limit > 0` and both cycle
/// days is accepted.
#[tokio::test]
async fn card_account_with_limit_and_days_is_accepted() {
    let Some(pool) = test_pool() else {
        eprintln!("SKIP card_account_with_limit_and_days_is_accepted: no DATABASE_URL");
        return;
    };
    let user_id = seed_user(&pool).await;
    let id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO accounts (user_id, name, type, credit_limit, statement_day, payment_due_day) VALUES ($1,'Visa','credit_card',5000,15,25) RETURNING id",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .expect("valid card insert is accepted");
    sqlx::query("DELETE FROM accounts WHERE id=$1")
        .bind(id)
        .execute(&pool)
        .await
        .expect("cleanup card");
    cleanup_user(&pool, user_id).await;
}

/// Task 1.3 GREEN: card queries must be index-backed (no Seq Scan on
/// `accounts` or `transactions`). `enable_seqscan=off` forces the planner
/// to prove the partial indexes can serve these shapes.
#[tokio::test]
async fn card_queries_use_indexes_no_seq_scan() {
    let Some(pool) = test_pool() else {
        eprintln!("SKIP card_queries_use_indexes_no_seq_scan: no DATABASE_URL");
        return;
    };
    sqlx::query("SET enable_seqscan = off")
        .execute(&pool)
        .await
        .expect("disable seqscan for probe");
    let user_id = seed_user(&pool).await;
    let card_id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO accounts (user_id, name, type, credit_limit, statement_day, payment_due_day) VALUES ($1,'Visa','credit_card',5000,15,25) RETURNING id",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .expect("seed card");
    let account_plan: String = {
        let rows: Vec<(String,)> = sqlx::query_as(
            "EXPLAIN SELECT id FROM accounts WHERE user_id=$1 AND type='credit_card'",
        )
        .bind(user_id)
        .fetch_all(&pool)
        .await
        .expect("explain card lookup");
        rows.into_iter().map(|(line,)| line).collect::<Vec<_>>().join("\n")
    };
    assert!(
        !account_plan.contains("Seq Scan"),
        "card lookup must not seq-scan accounts, got: {account_plan}"
    );
    assert!(
        account_plan.contains("idx_accounts_user_card"),
        "card lookup must use idx_accounts_user_card, got: {account_plan}"
    );
    let tx_plan: String = {
        let rows: Vec<(String,)> = sqlx::query_as(
            "EXPLAIN SELECT COALESCE(SUM(amount),0) FROM transactions WHERE credit_card_account_id=$1 AND user_id=$2 AND type='expense' AND occurred_on <= $3",
        )
        .bind(card_id)
        .bind(user_id)
        .bind(chrono::NaiveDate::from_ymd_opt(2026, 9, 15).unwrap())
        .fetch_all(&pool)
        .await
        .expect("explain statement aggregate");
        rows.into_iter().map(|(line,)| line).collect::<Vec<_>>().join("\n")
    };
    assert!(
        !tx_plan.contains("Seq Scan"),
        "statement aggregate must not seq-scan transactions, got: {tx_plan}"
    );
    assert!(
        tx_plan.contains("idx_tx_card_user_date"),
        "statement aggregate must use idx_tx_card_user_date, got: {tx_plan}"
    );
    sqlx::query("SET enable_seqscan = on")
        .execute(&pool)
        .await
        .expect("restore seqscan");
    cleanup_user(&pool, user_id).await;
}
