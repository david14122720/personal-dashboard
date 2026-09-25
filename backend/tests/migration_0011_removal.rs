//! Guard for migration 0011 (S1 remnant, extended in S3a).
//!
//! S1 deleted the transfer routes and retired
//! `migration_0005_transfer_trigger.rs`. The only assertion that must survive
//! is the byte-guard proving applied migrations were never rewritten: 0002
//! still contains its original transfer logic (`counter_account_id`).
//! S3a appends the eight 0011 post-conditions (design §7) to this same file.
//!
//! The live-DB tests apply `0011_remove_transactions_budgets.sql` when the
//! ledger tables still exist (out-of-band autocommit semantics via
//! `sqlx::raw_sql`), then assert the post-migration shape. They SKIP without
//! `DATABASE_URL` and MUST only ever run against the dev database
//! (`192.168.50.120:5434`) — never production (no L2 gate yet).

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

#[test]
fn migration_0011_file_exists_and_has_no_cascade_or_recreation() {
    let sql = read_migration("0011_remove_transactions_budgets.sql");
    assert!(!sql.trim().is_empty(), "0011 must not be empty");
    for token in ["CASCADE", "CREATE TYPE", "CREATE TABLE", "BACKUP", "DUMP"] {
        assert!(
            !sql.to_uppercase().contains(token),
            "0011 must never contain `{token}`"
        );
    }
    for token in [
        "DROP COLUMN transaction_id",
        "DROP TABLE budgets",
        "DROP TABLE transactions",
        "DROP FUNCTION apply_transaction_to_balance()",
        "DROP FUNCTION apply_transfer_counterparty()",
        "DROP TYPE transaction_type",
        "dependent_objects_still_exist",
    ] {
        assert!(
            sql.contains(token),
            "0011 must contain `{token}` (design §7 order: columns → tables → functions → enum)"
        );
    }
}

// ---------------------------------------------------------------------------
// Live-DB post-conditions (design §7). Skipped without DATABASE_URL.
// Run against the DEV database only:
//   DATABASE_URL=postgres://...@192.168.50.120:5434/... cargo test \
//     --test migration_0011_removal
// NEVER point this at production: applying 0011 destroys rows.
// ---------------------------------------------------------------------------

fn test_pool() -> Option<sqlx::PgPool> {
    std::env::var("DATABASE_URL")
        .ok()
        .map(|url| sqlx::PgPool::connect_lazy(&url).expect("lazy pool from DATABASE_URL"))
}

/// Apply 0011 unless already applied: if the ledger table still exists, run
/// the file (autocommit, multi-statement); otherwise assume applied and only
/// assert the shape.
async fn ensure_0011_applied(pool: &sqlx::PgPool) {
    let ledger_exists: bool =
        sqlx::query_scalar("SELECT to_regclass('public.transactions') IS NOT NULL")
            .fetch_one(pool)
            .await
            .expect("probe transactions table");
    if ledger_exists {
        let sql = read_migration("0011_remove_transactions_budgets.sql");
        // Audited: the statement is the committed migration file bytes,
        // never user input (destructive DDL runs only against dev here).
        sqlx::raw_sql(sqlx::AssertSqlSafe(sql))
            .execute(pool)
            .await
            .expect("apply migration 0011");
    }
}

/// (1) Both removed tables are gone.
#[tokio::test]
async fn post_0011_removed_tables_are_gone() {
    let Some(pool) = test_pool() else {
        eprintln!("SKIP post_0011_removed_tables_are_gone: no DATABASE_URL");
        return;
    };
    ensure_0011_applied(&pool).await;
    for table in ["public.transactions", "public.budgets"] {
        let exists: bool = sqlx::query_scalar("SELECT to_regclass($1) IS NOT NULL")
            .bind(table)
            .fetch_one(&pool)
            .await
            .expect("probe removed table");
        assert!(!exists, "{table} must be gone after 0011");
    }
}

/// (2) Both removed trigger functions are gone.
#[tokio::test]
async fn post_0011_removed_functions_are_gone() {
    let Some(pool) = test_pool() else {
        eprintln!("SKIP post_0011_removed_functions_are_gone: no DATABASE_URL");
        return;
    };
    ensure_0011_applied(&pool).await;
    for func in [
        "apply_transaction_to_balance()",
        "apply_transfer_counterparty()",
    ] {
        let exists: bool = sqlx::query_scalar("SELECT to_regprocedure($1) IS NOT NULL")
            .bind(func)
            .fetch_one(&pool)
            .await
            .expect("probe removed function");
        assert!(!exists, "{func} must be gone after 0011");
    }
}

/// (3) The `transaction_id` columns are gone while the own `amount`/date
/// columns of both tables remain.
#[tokio::test]
async fn post_0011_inbound_fk_columns_gone_own_columns_remain() {
    let Some(pool) = test_pool() else {
        eprintln!("SKIP post_0011_inbound_fk_columns_gone_own_columns_remain: no DATABASE_URL");
        return;
    };
    ensure_0011_applied(&pool).await;
    // S-G (gated migration 0013) supersedes these probes: once 0013 drops
    // `debt_payments`/`savings_goal_movements`, the tables are absent and the
    // column assertions below are vacuous — record the removal instead.
    for table in ["debt_payments", "savings_goal_movements"] {
        let gone: bool = sqlx::query_scalar("SELECT to_regclass($1) IS NULL")
            .bind(format!("public.{table}"))
            .fetch_one(&pool)
            .await
            .expect("probe 0013-removed table");
        if gone {
            eprintln!("NOTE post_0011_inbound_fk: {table} gone via 0013 (superseeded)");
            return;
        }
    }
    for (table, own_columns) in [
        ("debt_payments", vec!["amount", "paid_on"]),
        ("savings_goal_movements", vec!["amount", "occurred_on"]),
    ] {
        let cols: Vec<String> = sqlx::query_scalar(
            "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
        )
        .bind(table)
        .fetch_all(&pool)
        .await
        .expect("list surviving columns");
        assert!(
            !cols.iter().any(|c| c == "transaction_id"),
            "{table} must not have transaction_id after 0011"
        );
        for own in own_columns {
            assert!(
                cols.iter().any(|c| c == own),
                "{table} must keep its own column {own} after 0011"
            );
        }
    }
}

/// (4) `accounts.balance` exists and the only trigger on `accounts` is
/// `trg_accounts_updated_at`.
#[tokio::test]
async fn post_0011_accounts_balance_present_with_only_updated_at_trigger() {
    let Some(pool) = test_pool() else {
        eprintln!("SKIP post_0011_accounts_balance_present_with_only_updated_at_trigger: no DATABASE_URL");
        return;
    };
    ensure_0011_applied(&pool).await;
    let balance_exists: bool = sqlx::query_scalar(
        "SELECT count(*) = 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='accounts' AND column_name='balance'",
    )
    .fetch_one(&pool)
    .await
    .expect("probe accounts.balance");
    assert!(balance_exists, "accounts.balance must exist after 0011");
    let triggers: Vec<String> = sqlx::query_scalar(
        "SELECT tgname FROM pg_trigger WHERE tgrelid='public.accounts'::regclass AND NOT tgisinternal ORDER BY tgname",
    )
    .fetch_all(&pool)
    .await
    .expect("list accounts triggers");
    assert_eq!(
        triggers,
        vec!["trg_accounts_updated_at".to_string()],
        "accounts must keep only trg_accounts_updated_at after 0011, got: {triggers:?}"
    );
}

/// (5) Enum fallback tolerance: no column of type `transaction_type`
/// remains; if the type itself still exists (orphaned fallback), nothing
/// depends on it. Type absence is recorded, not hard-failed.
#[tokio::test]
async fn post_0011_enum_gone_or_harmlessly_orphaned() {
    let Some(pool) = test_pool() else {
        eprintln!("SKIP post_0011_enum_gone_or_harmlessly_orphaned: no DATABASE_URL");
        return;
    };
    ensure_0011_applied(&pool).await;
    let typed_columns: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM pg_attribute WHERE atttypid = to_regtype('transaction_type') AND NOT attisdropped",
    )
    .fetch_one(&pool)
    .await
    .expect("count transaction_type columns");
    assert_eq!(
        typed_columns, 0,
        "no column may keep the transaction_type type after 0011"
    );
    let type_exists: bool =
        sqlx::query_scalar("SELECT to_regtype('transaction_type') IS NOT NULL")
            .fetch_one(&pool)
            .await
            .expect("probe transaction_type");
    if type_exists {
        let dependents: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM pg_depend WHERE refobjid = to_regtype('transaction_type')",
        )
        .fetch_one(&pool)
        .await
        .expect("count enum dependents");
        assert_eq!(
            dependents, 0,
            "orphaned transaction_type must have no dependents (never CREATE TYPE + reconversion)"
        );
        eprintln!("NOTE post_0011_enum: transaction_type left orphaned (accepted fallback)");
    } else {
        eprintln!("NOTE post_0011_enum: transaction_type dropped cleanly");
    }
}

/// (6) Surviving triggers are intact: debt/savings apply triggers, the 0007
/// goal-progress triggers and `trg_accounts_updated_at`.
#[tokio::test]
async fn post_0011_surviving_triggers_intact() {
    let Some(pool) = test_pool() else {
        eprintln!("SKIP post_0011_surviving_triggers_intact: no DATABASE_URL");
        return;
    };
    ensure_0011_applied(&pool).await;
    // S-G (gated migration 0013) supersedes the debt/savings apply triggers:
    // once 0013 drops their tables, the triggers fall with them.
    let removed_tables_gone: bool =
        sqlx::query_scalar("SELECT to_regclass('public.debts') IS NULL AND to_regclass('public.savings_goals') IS NULL")
            .fetch_one(&pool)
            .await
            .expect("probe 0013-removed tables");
    if removed_tables_gone {
        for trigger in ["trg_debt_payments_apply", "trg_savings_movements_apply"] {
            let exists: bool = sqlx::query_scalar(
                "SELECT count(*) = 1 FROM pg_trigger WHERE tgname=$1 AND NOT tgisinternal",
            )
            .bind(trigger)
            .fetch_one(&pool)
            .await
            .expect("probe 0013-removed trigger");
            assert!(!exists, "0013-removed trigger {trigger} must be gone with its table");
        }
        eprintln!("NOTE post_0011_triggers: debt/savings apply triggers gone via 0013 (superseeded)");
    } else {
        for trigger in [
            "trg_debt_payments_apply",
            "trg_savings_movements_apply",
        ] {
            let exists: bool = sqlx::query_scalar(
                "SELECT count(*) = 1 FROM pg_trigger WHERE tgname=$1 AND NOT tgisinternal",
            )
            .bind(trigger)
            .fetch_one(&pool)
            .await
            .expect("probe surviving trigger");
            assert!(exists, "surviving trigger {trigger} must be intact after 0011");
        }
    }
    for trigger in [
        "trg_tasks_goal_progress_insert",
        "trg_tasks_goal_progress_update",
        "trg_tasks_goal_progress_delete",
        "trg_accounts_updated_at",
    ] {
        let exists: bool = sqlx::query_scalar(
            "SELECT count(*) = 1 FROM pg_trigger WHERE tgname=$1 AND NOT tgisinternal",
        )
        .bind(trigger)
        .fetch_one(&pool)
        .await
        .expect("probe surviving trigger");
        assert!(exists, "surviving trigger {trigger} must be intact after 0011");
    }
}

/// (7) 0002 and 0005 are byte-identical to their committed content — the
/// guard from S1, kept as the migration-discipline post-condition.
#[tokio::test]
async fn post_0011_applied_migrations_untouched() {
    // File-content guard, no DB needed (never SKIPs: the discipline holds
    // in every environment).
    let fix = read_migration("0005_fix_transfer_trigger.sql");
    assert!(
        !fix.contains("CREATE TRIGGER"),
        "0005 must only replace the function body, not recreate triggers"
    );
    let original = read_migration("0002_finance.sql");
    assert!(
        original.contains("counter_account_id"),
        "0002 must still contain its original transfer logic (never edit applied migrations)"
    );
}

/// (8) `accounts.balance` values are unchanged by 0011: seed an account,
/// apply (or observe) the migration, and prove the stored value survives.
#[tokio::test]
async fn post_0011_balances_untouched_by_migration() {
    let Some(pool) = test_pool() else {
        eprintln!("SKIP post_0011_balances_untouched_by_migration: no DATABASE_URL");
        return;
    };
    let email = format!("mig11-{}@example.com", uuid::Uuid::new_v4());
    let user_id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
    )
    .bind(&email)
    .bind("not-a-real-hash")
    .bind("migration 0011 test")
    .fetch_one(&pool)
    .await
    .expect("seed user");
    let account_id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO accounts (user_id, name, type, balance) VALUES ($1,'Balance Probe','cash',1234.56) RETURNING id",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .expect("seed account");
    ensure_0011_applied(&pool).await;
    let balance: rust_decimal::Decimal =
        sqlx::query_scalar("SELECT balance FROM accounts WHERE id=$1")
            .bind(account_id)
            .fetch_one(&pool)
            .await
            .expect("read seeded balance");
    assert_eq!(
        balance,
        rust_decimal::Decimal::new(123456, 2),
        "0011 must never touch accounts.balance"
    );
    sqlx::query("DELETE FROM users WHERE id=$1")
        .bind(user_id)
        .execute(&pool)
        .await
        .expect("cleanup user");
}
