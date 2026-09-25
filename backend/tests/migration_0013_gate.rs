//! Guard for migration 0013 (finance-simplify-movements S-G, GATED).
//!
//! OWNER AUTHORIZATION (X-4 paperwork, recorded at apply time):
//! - Gate question answered by the owner on 2026-09-24: "Worktree + dev DB".
//! - Authorized: (1) implement S-G fully in the worktree, uncommitted — NO
//!   commit, NO push, NO PR; (2) APPLY 0013 to the LOCAL DEV DB at
//!   192.168.50.120:5434 out-of-band (autocommit psql, 0011 convention) for
//!   verification — accepted data loss: `savings_goals`,
//!   `savings_goal_movements`, `debts`, `debt_payments` rows on the DEV DB
//!   are destroyed, no backup (standing no-backup decision); (3) production
//!   apply is explicitly NOT authorized — no production contact, no deploy.
//! - Gate execution copies 0013 into `backend/migrations/` ONLY as part of
//!   this authorized step, so CI and fresh compose volumes apply it going
//!   forward; `backend/migrations/0013_remove_savings_debts.sql` now exists
//!   locally by owner decision.
//!
//! PRE-GATE form was a RED guard: 0013 exists in the change folder AND NOT
//! in `backend/migrations/`, removal-only tokens, gate order recorded. While
//! gated, CI (`migrations/*.sql` glob) and the compose initdb mount never
//! saw this file (guard proven green pre-gate on 2026-09-24).
//!
//! POST-GATE form (this file, flipped at the authorized gate): the copy
//! assertion now requires the byte-identical `backend/migrations/` copy,
//! and the live shape tests below assert the catalog (SKIP without
//! `DATABASE_URL`; run only against the DEV database,
//! 192.168.50.120:5434 — NEVER production).

use std::path::PathBuf;

fn change_migration_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../openspec/changes/archive/2026-09-24-finance-simplify-movements/migrations/0013_remove_savings_debts.sql")
}

fn backend_migration_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("migrations/0013_remove_savings_debts.sql")
}

fn read_change_migration() -> String {
    let path = change_migration_path();
    std::fs::read_to_string(&path)
        .unwrap_or_else(|_| panic!("0013 must be staged in the change folder: {}", path.display()))
}

// -- POST-GATE form (flipped at the authorized 2026-09-24 gate) --

#[test]
fn migration_0013_staged_in_change_folder_and_copied_at_gate() {
    // Pre-gate this asserted absence from `backend/migrations/` (RED guard);
    // post-gate it asserts the authorized copy exists and is byte-identical.
    assert!(
        change_migration_path().exists(),
        "0013 must exist in the change folder"
    );
    assert!(
        backend_migration_path().exists(),
        "0013 must have been copied into backend/migrations/ at the authorized gate"
    );
    let staged = read_change_migration();
    let applied = std::fs::read_to_string(backend_migration_path())
        .expect("backend copy of 0013 must be readable");
    assert_eq!(
        staged, applied,
        "backend copy of 0013 must be byte-identical to the staged file"
    );
}

fn statements_only(sql: &str) -> String {
    // Header prose documents the no-backup posture in words; the token guard
    // applies to executable statements, so strip `--` comments first.
    sql.lines()
        .map(|line| match line.find("--") {
            Some(idx) => &line[..idx],
            None => line,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn migration_0013_is_removal_only() {
    let sql = read_change_migration();
    assert!(!sql.trim().is_empty(), "0013 must not be empty");
    let stmts = statements_only(&sql);
    for token in ["CASCADE", "CREATE", "BACKUP", "DUMP"] {
        assert!(
            !stmts.to_uppercase().contains(token),
            "0013 must never contain `{token}`"
        );
    }
    for token in [
        "ALTER TABLE events DROP COLUMN debt_id",
        "DROP TABLE debt_payments",
        "DROP TABLE savings_goal_movements",
        "DROP TABLE debts",
        "DROP TABLE savings_goals",
        "DROP FUNCTION update_debt_pending()",
        "DROP FUNCTION update_savings_goal_saved()",
    ] {
        assert!(
            sql.contains(token),
            "0013 must contain `{token}` (0011 order: inbound column → children → parents → functions)"
        );
    }
}

#[test]
fn migration_0013_gate_order_is_recorded() {
    // The gate order lives in the staged file header: authorization at apply
    // time, deploy re-confirmation before any production apply, copy into
    // backend/migrations/ only at the gate.
    let sql = read_change_migration().to_lowercase();
    for token in ["gated", "authorization", "re-confirm", "no-backup"] {
        assert!(
            sql.contains(token),
            "0013 header must record the gate order (`{token}`)"
        );
    }
}

fn test_pool() -> Option<sqlx::PgPool> {
    std::env::var("DATABASE_URL")
        .ok()
        .map(|url| sqlx::PgPool::connect_lazy(&url).expect("lazy pool from DATABASE_URL"))
}

/// Post-gate catalog asserts: the four tables are absent.
/// Skipped without `DATABASE_URL`; run only against the DEV database
/// (192.168.50.120:5434) — NEVER production.
#[tokio::test]
async fn post_0013_removed_tables_are_gone() {
    let Some(pool) = test_pool() else {
        eprintln!("SKIP post_0013_removed_tables_are_gone: no DATABASE_URL");
        return;
    };
    for table in [
        "public.debts",
        "public.debt_payments",
        "public.savings_goals",
        "public.savings_goal_movements",
    ] {
        let exists: bool = sqlx::query_scalar("SELECT to_regclass($1) IS NOT NULL")
            .bind(table)
            .fetch_one(&pool)
            .await
            .expect("probe removed table");
        assert!(!exists, "{table} must be gone after 0013");
    }
}

/// Post-gate catalog asserts: both trigger functions are absent.
#[tokio::test]
async fn post_0013_removed_functions_are_gone() {
    let Some(pool) = test_pool() else {
        eprintln!("SKIP post_0013_removed_functions_are_gone: no DATABASE_URL");
        return;
    };
    for func in [
        "update_debt_pending()",
        "update_savings_goal_saved()",
    ] {
        let exists: bool = sqlx::query_scalar("SELECT to_regprocedure($1) IS NOT NULL")
            .bind(func)
            .fetch_one(&pool)
            .await
            .expect("probe removed function");
        assert!(!exists, "{func} must be gone after 0013");
    }
}

/// Post-gate catalog asserts: `events.debt_id` is absent while the surviving
/// event columns are untouched.
#[tokio::test]
async fn post_0013_events_debt_id_gone_surviving_columns_intact() {
    let Some(pool) = test_pool() else {
        eprintln!("SKIP post_0013_events_debt_id_gone_surviving_columns_intact: no DATABASE_URL");
        return;
    };
    let cols: Vec<String> = sqlx::query_scalar(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='events'",
    )
    .fetch_all(&pool)
    .await
    .expect("list event columns");
    assert!(
        !cols.iter().any(|c| c == "debt_id"),
        "events.debt_id must be gone after 0013"
    );
    for own in [
        "id",
        "user_id",
        "title",
        "starts_at",
        "habit_id",
        "goal_id",
        "task_id",
        "subscription_id",
        "category_id",
    ] {
        assert!(
            cols.iter().any(|c| c == own),
            "events must keep its surviving column {own} after 0013"
        );
    }
}

/// Post-gate catalog asserts: surviving tables/columns/triggers untouched
/// (`accounts.balance` + its sole trigger, `subscriptions`, `events`).
#[tokio::test]
async fn post_0013_survivors_untouched() {
    let Some(pool) = test_pool() else {
        eprintln!("SKIP post_0013_survivors_untouched: no DATABASE_URL");
        return;
    };
    let balance_exists: bool = sqlx::query_scalar(
        "SELECT count(*) = 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='accounts' AND column_name='balance'",
    )
    .fetch_one(&pool)
    .await
    .expect("probe accounts.balance");
    assert!(balance_exists, "accounts.balance must exist after 0013");
    let triggers: Vec<String> = sqlx::query_scalar(
        "SELECT tgname FROM pg_trigger WHERE tgrelid='public.accounts'::regclass AND NOT tgisinternal ORDER BY tgname",
    )
    .fetch_all(&pool)
    .await
    .expect("list accounts triggers");
    assert_eq!(
        triggers,
        vec!["trg_accounts_updated_at".to_string()],
        "accounts must keep only trg_accounts_updated_at after 0013, got: {triggers:?}"
    );
    for table in ["public.subscriptions", "public.events", "public.accounts"] {
        let exists: bool = sqlx::query_scalar("SELECT to_regclass($1) IS NOT NULL")
            .bind(table)
            .fetch_one(&pool)
            .await
            .expect("probe surviving table");
        assert!(exists, "{table} must survive 0013");
    }
}
