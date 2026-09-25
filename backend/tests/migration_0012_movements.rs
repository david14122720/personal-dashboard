//! Guard for migration 0012 (S-A: finance-simplify-movements).
//!
//! 0012 is ADDITIVE: it creates the `movement_direction` enum, the
//! `movements` table with its three indexes, and the
//! `subscriptions.last_paid_on` column — and MUST NOT modify or drop any
//! pre-existing object (finance-core-invariants "Migration Discipline").
//!
//! The file-content guards below run everywhere (never SKIP). The live-DB
//! tests apply `0012_movements.sql` when the ledger table is still absent
//! (out-of-band autocommit semantics via `sqlx::raw_sql`, same convention
//! as the 0011 guard), then assert the post-migration shape. They SKIP
//! without `DATABASE_URL` and MUST only ever run against the dev database
//! — never production.
//!
//! NOTE on the CASCADE token: the spec REQUIRES `user_id ... ON DELETE
//! CASCADE` on `movements`, so a naive "no CASCADE anywhere" check would
//! contradict the Movement Record Model. The guard strips the FK-clause
//! spellings (`ON DELETE CASCADE` / `ON UPDATE CASCADE`) first and then
//! forbids every remaining `CASCADE` — i.e. no `DROP ... CASCADE`, no
//! destructive cascade of any kind.

use std::path::PathBuf;

fn migrations_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("migrations")
}

fn read_migration(name: &str) -> String {
    let path = migrations_dir().join(name);
    std::fs::read_to_string(&path)
        .unwrap_or_else(|_| panic!("migration file must exist: {}", path.display()))
}

/// Uppercase the SQL with every legitimate FK-cascade clause blanked, so
/// the only `CASCADE` that can remain is a destructive one.
fn sql_without_fk_cascades(sql: &str) -> String {
    sql.to_uppercase()
        .replace("ON DELETE CASCADE", "")
        .replace("ON UPDATE CASCADE", "")
}

#[test]
fn migration_0012_file_exists_and_is_additive_only() {
    let sql = read_migration("0012_movements.sql");
    assert!(!sql.trim().is_empty(), "0012 must not be empty");
    // Required additive statements (design §Interfaces).
    for token in [
        "CREATE TYPE movement_direction",
        "CREATE TABLE movements",
        "idx_movements_user_date",
        "idx_movements_user_account",
        "idx_movements_user_category",
        "ADD COLUMN last_paid_on",
    ] {
        assert!(
            sql.contains(token),
            "0012 must contain `{token}` (design §Interfaces)"
        );
    }
    // No modification or deletion of pre-existing objects.
    for token in ["DROP", "BACKUP", "DUMP"] {
        assert!(
            !sql.to_uppercase().contains(token),
            "0012 must never contain `{token}` (additive only)"
        );
    }
    let without_fk = sql_without_fk_cascades(&sql);
    assert!(
        !without_fk.contains("CASCADE"),
        "0012 must never contain a destructive CASCADE (ON DELETE CASCADE FK clauses excepted)"
    );
}

#[test]
fn migration_0012_does_not_touch_previously_applied_migrations() {
    // S-A changes no applied migration: 0001–0011 must not reference the
    // new objects, proving they were left byte-untouched by this slice.
    for name in [
        "0001_init_auth_and_categories.sql",
        "0002_finance.sql",
        "0003_savings_debts_subs_assets.sql",
        "0004_habits_goals_tasks_calendar_notes.sql",
        "0005_fix_transfer_trigger.sql",
        "0006_habit_log_missed.sql",
        "0007_goal_progress_trigger.sql",
        "0008_credit_cards.sql",
        "0009_api_tokens.sql",
        "0010_habit_category_short_label.sql",
        "0011_remove_transactions_budgets.sql",
    ] {
        let sql = read_migration(name);
        // NOTE: plain "movements" is NOT asserted: `savings_goal_movements`
        // (0003, 0011) contains it as a substring. The tokens below are
        // unique to the new objects, so a hit always means S-A edited an
        // applied migration.
        for token in [
            "movement_direction",
            "last_paid_on",
            "CREATE TABLE movements",
            "idx_movements_",
        ] {
            assert!(
                !sql.contains(token),
                "{name} must not reference `{token}` (applied migrations are never edited)"
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Live-DB post-conditions. Skipped without DATABASE_URL.
// Run against the DEV database only:
//   DATABASE_URL=postgres://...  cargo test --test migration_0012_movements
// ---------------------------------------------------------------------------

fn test_pool() -> Option<sqlx::PgPool> {
    std::env::var("DATABASE_URL")
        .ok()
        .map(|url| sqlx::PgPool::connect_lazy(&url).expect("lazy pool from DATABASE_URL"))
}

/// Apply 0012 unless already applied: if the ledger table is absent, run
/// the file (autocommit, multi-statement); otherwise assume applied and
/// only assert the shape.
async fn ensure_0012_applied(pool: &sqlx::PgPool) {
    let ledger_exists: bool =
        sqlx::query_scalar("SELECT to_regclass('public.movements') IS NOT NULL")
            .fetch_one(pool)
            .await
            .expect("probe movements table");
    if !ledger_exists {
        let sql = read_migration("0012_movements.sql");
        // Audited: the statement is the committed migration file bytes,
        // never user input (additive DDL runs only against dev here).
        sqlx::raw_sql(sqlx::AssertSqlSafe(sql))
            .execute(pool)
            .await
            .expect("apply migration 0012");
    }
}

/// (1) `movements` exists with the specified columns, checks, FKs and the
/// three indexes; `subscriptions.last_paid_on` exists.
#[tokio::test]
async fn post_0012_movements_shape_and_indexes() {
    let Some(pool) = test_pool() else {
        eprintln!("SKIP post_0012_movements_shape_and_indexes: no DATABASE_URL");
        return;
    };
    ensure_0012_applied(&pool).await;
    let cols: Vec<String> = sqlx::query_scalar(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='movements' ORDER BY ordinal_position",
    )
    .fetch_all(&pool)
    .await
    .expect("list movements columns");
    for col in [
        "id",
        "user_id",
        "account_id",
        "category_id",
        "direction",
        "amount",
        "occurred_on",
        "description",
        "subscription_id",
        "created_at",
        "updated_at",
    ] {
        assert!(
            cols.iter().any(|c| c == col),
            "movements must have column {col}, got: {cols:?}"
        );
    }
    // Positive-amount check constraint.
    let checks: Vec<String> = sqlx::query_scalar(
        "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.movements'::regclass AND contype='c'",
    )
    .fetch_all(&pool)
    .await
    .expect("list movements checks");
    assert!(
        checks.iter().any(|c| c.contains("amount > 0") || c.contains("amount > (0)::numeric")),
        "movements must carry CHECK (amount > 0), got: {checks:?}"
    );
    // FK actions: users CASCADE, accounts RESTRICT, categories + subscriptions SET NULL.
    let fks: Vec<(String, String)> = sqlx::query_as(
        "SELECT ccu.table_name, rc.delete_rule FROM information_schema.referential_constraints rc JOIN information_schema.constraint_column_usage ccu ON rc.constraint_name = ccu.constraint_name WHERE rc.constraint_schema='public' AND ccu.table_name IN ('users','accounts','categories','subscriptions') AND rc.constraint_name IN (SELECT conname FROM pg_constraint WHERE conrelid='public.movements'::regclass AND contype='f')",
    )
    .fetch_all(&pool)
    .await
    .expect("list movements FK rules");
    for (target, rule) in [
        ("users", "CASCADE"),
        ("accounts", "RESTRICT"),
        ("categories", "SET NULL"),
        ("subscriptions", "SET NULL"),
    ] {
        assert!(
            fks.iter().any(|(t, r)| t == target && r == rule),
            "movements FK to {target} must be ON DELETE {rule}, got: {fks:?}"
        );
    }
    for index in [
        "idx_movements_user_date",
        "idx_movements_user_account",
        "idx_movements_user_category",
    ] {
        let exists: bool = sqlx::query_scalar("SELECT to_regclass($1) IS NOT NULL")
            .bind(format!("public.{index}"))
            .fetch_one(&pool)
            .await
            .expect("probe movement index");
        assert!(exists, "index {index} must exist after 0012");
    }
    let last_paid_on: bool = sqlx::query_scalar(
        "SELECT count(*) = 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='subscriptions' AND column_name='last_paid_on'",
    )
    .fetch_one(&pool)
    .await
    .expect("probe subscriptions.last_paid_on");
    assert!(last_paid_on, "subscriptions.last_paid_on must exist after 0012");
}

/// (2) 0012 created no trigger: no trigger writes `accounts.balance`
/// (finance-core-invariants "Movement Balance Write Discipline"), and the
/// only trigger on `accounts` is still `trg_accounts_updated_at`.
#[tokio::test]
async fn post_0012_no_trigger_writes_balance() {
    let Some(pool) = test_pool() else {
        eprintln!("SKIP post_0012_no_trigger_writes_balance: no DATABASE_URL");
        return;
    };
    ensure_0012_applied(&pool).await;
    let triggers: Vec<String> = sqlx::query_scalar(
        "SELECT tgname FROM pg_trigger WHERE tgrelid='public.accounts'::regclass AND NOT tgisinternal ORDER BY tgname",
    )
    .fetch_all(&pool)
    .await
    .expect("list accounts triggers");
    assert_eq!(
        triggers,
        vec!["trg_accounts_updated_at".to_string()],
        "accounts must keep only trg_accounts_updated_at after 0012, got: {triggers:?}"
    );
    let movement_triggers: Vec<String> = sqlx::query_scalar(
        "SELECT tgname FROM pg_trigger WHERE tgrelid='public.movements'::regclass AND NOT tgisinternal ORDER BY tgname",
    )
    .fetch_all(&pool)
    .await
    .expect("list movements triggers");
    assert!(
        movement_triggers.is_empty(),
        "movements must carry no trigger (balance is app-written), got: {movement_triggers:?}"
    );
}

/// (3) The `movement_direction` enum holds exactly `expense` + `income`.
#[tokio::test]
async fn post_0012_direction_enum_values() {
    let Some(pool) = test_pool() else {
        eprintln!("SKIP post_0012_direction_enum_values: no DATABASE_URL");
        return;
    };
    ensure_0012_applied(&pool).await;
    let values: Vec<String> = sqlx::query_scalar(
        "SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_enum.enumtypid = pg_type.oid WHERE pg_type.typname='movement_direction' ORDER BY enumsortorder",
    )
    .fetch_all(&pool)
    .await
    .expect("list movement_direction values");
    assert_eq!(
        values,
        vec!["expense".to_string(), "income".to_string()],
        "movement_direction must hold exactly expense + income, got: {values:?}"
    );
}
