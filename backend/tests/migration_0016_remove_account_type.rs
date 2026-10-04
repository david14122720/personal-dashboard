//! Guard for migration 0016 (slice W1 of
//! `2026-10-04-accounts-transfers-login-calendar`): the account type and the
//! whole credit-card semantic layer leave the schema.
//!
//! File-content guards run everywhere: 0016 MUST be the ordered destructive
//! block (the three `chk_card_*` constraint drops, `DROP INDEX
//! idx_accounts_user_card`, the four column drops, then `DROP TYPE
//! account_type`) inside its own `BEGIN; … COMMIT;`, with every drop
//! `IF EXISTS`-tolerant and no `CASCADE`. Tolerance is not cosmetic:
//! production never received the 0008 card CHECKs nor `idx_accounts_user_card`,
//! while a fresh CI database did — the same file must run against both.
//! `0001`–`0013` stay byte-identical (`0008` keeps `chk_card_limit_presence`);
//! only 0016 drops the type, and 0016 never mentions the transfer objects
//! 0014/0015 create.
//!
//! The live post-condition probes SKIP without `DATABASE_URL`. They assert
//! only what must hold AFTER 0016 (columns, enum, constraints and index gone;
//! surviving columns intact; money invariants hold) and never that an object
//! from an earlier migration exists. `ensure_0016_applied` fills a fresh-dev
//! gap by replaying the committed file bytes only when `accounts.type` still
//! exists, and the preservation probe then proves the seeded rows and their
//! balances survive the destructive block. The destructive file is never
//! edited here; the live section only replays it, exactly like
//! `migration_0011_removal.rs` does for 0011.

use std::path::PathBuf;

fn migrations_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("migrations")
}

fn read_migration(name: &str) -> String {
    let path = migrations_dir().join(name);
    std::fs::read_to_string(&path)
        .unwrap_or_else(|_| panic!("migration file must exist: {}", path.display()))
}

/// Strip `--` comment lines (documentation, not statements) and collapse
/// whitespace so the remaining text is exactly the executable statements.
fn statements_only(sql: &str) -> String {
    sql.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with("--"))
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[test]
fn migration_0016_is_the_ordered_destructive_block() {
    let sql = read_migration("0016_remove_account_type_and_card_fields.sql");
    let statements = statements_only(&sql);
    let upper = statements.to_uppercase();
    assert!(
        upper.starts_with("BEGIN;"),
        "0016 must open its own transaction, got: {statements}"
    );
    assert!(
        upper.ends_with("COMMIT;"),
        "0016 must close its own transaction, got: {statements}"
    );

    // The three CHECKs dropped by name, in the order they can be dropped.
    for constraint in [
        "ALTER TABLE accounts DROP CONSTRAINT IF EXISTS chk_card_limit_presence;",
        "ALTER TABLE accounts DROP CONSTRAINT IF EXISTS chk_card_limit_pos;",
        "ALTER TABLE accounts DROP CONSTRAINT IF EXISTS chk_card_days_presence;",
    ] {
        assert!(
            statements.contains(constraint),
            "0016 must contain `{constraint}`"
        );
    }
    assert!(
        statements.contains("DROP INDEX IF EXISTS idx_accounts_user_card;"),
        "0016 must drop idx_accounts_user_card"
    );
    for column in [
        "DROP COLUMN IF EXISTS credit_limit",
        "DROP COLUMN IF EXISTS statement_day",
        "DROP COLUMN IF EXISTS payment_due_day",
        "DROP COLUMN IF EXISTS type",
    ] {
        assert!(
            statements.contains(column),
            "0016 must drop the column with `{column}`"
        );
    }
    assert!(
        statements.contains("DROP TYPE IF EXISTS account_type;"),
        "0016 must drop the account_type enum"
    );

    // Ordering: every object that depends on a dropped column goes before the
    // column drops, and the enum goes last (its only owning column is gone).
    let at = |needle: &str| {
        statements
            .find(needle)
            .unwrap_or_else(|| panic!("0016 must contain `{needle}`, got: {statements}"))
    };
    let first_column_drop = at("DROP COLUMN");
    for dependent in [
        "chk_card_limit_presence",
        "chk_card_limit_pos",
        "chk_card_days_presence",
        "idx_accounts_user_card",
    ] {
        assert!(
            at(dependent) < first_column_drop,
            "`{dependent}` must be dropped before any column drop"
        );
    }
    let last_column_drop = statements.rfind("DROP COLUMN").expect("column drops exist");
    let drop_type = at("DROP TYPE IF EXISTS account_type;");
    assert!(
        drop_type > last_column_drop,
        "DROP TYPE account_type must run after every column drop"
    );
}

#[test]
fn migration_0016_is_if_exists_tolerant_for_every_drop() {
    let sql = read_migration("0016_remove_account_type_and_card_fields.sql");
    let statements = statements_only(&sql);
    // Production never received the 0008 objects while CI did: every single
    // drop in this file MUST be replayable against both states.
    let drops = statements.matches("DROP ").count();
    let guarded = statements.matches("DROP CONSTRAINT IF EXISTS").count()
        + statements.matches("DROP INDEX IF EXISTS").count()
        + statements.matches("DROP COLUMN IF EXISTS").count()
        + statements.matches("DROP TYPE IF EXISTS").count();
    assert!(drops > 0, "0016 must contain drops, got: {statements}");
    assert_eq!(
        drops, guarded,
        "every DROP in 0016 must be IF EXISTS-tolerant, got: {statements}"
    );
}

#[test]
fn migration_0016_never_cascades_recreates_or_touches_the_transfer_layer() {
    let sql = read_migration("0016_remove_account_type_and_card_fields.sql");
    let upper = statements_only(&sql).to_uppercase();
    for forbidden in [
        "CASCADE",
        "CREATE TYPE",
        "CREATE TABLE",
        "CREATE INDEX",
        "BACKUP",
        "DUMP",
        "TRANSACTIONS",
        "MOVEMENT_DIRECTION",
        "TRANSFER_ACCOUNT_ID",
    ] {
        assert!(
            !upper.contains(forbidden),
            "0016 must never contain `{forbidden}`"
        );
    }
}

#[test]
fn applied_migrations_are_untouched_by_0016() {
    // Byte-identity proxy for 0008 (design D1.2): the card CHECKs and the
    // partial index it shipped with must still be there — 0016 is the
    // historical record of the layer this migration removes.
    let card = read_migration("0008_credit_cards.sql");
    for token in [
        "chk_card_limit_presence",
        "chk_card_limit_pos",
        "chk_card_days_presence",
        "idx_accounts_user_card",
    ] {
        assert!(
            card.contains(token),
            "0008 must stay byte-identical, missing `{token}`"
        );
    }
    // 0016 is the only migration that drops the type: no applied file may
    // contain a destructive statement for the type or its enum.
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
        "0012_movements.sql",
        "0013_remove_savings_debts.sql",
        "0014_movement_transfer_enum.sql",
        "0015_movement_transfer_account.sql",
    ] {
        let sql = read_migration(name);
        for token in ["DROP COLUMN type", "DROP TYPE account_type"] {
            assert!(
                !sql.contains(token),
                "{name} must not contain `{token}` (applied migrations are never edited)"
            );
        }
    }
    // The transfer objects exist before the destructive block: 0014 declares
    // the value, 0015 wears it, 0016 removes only the account layer.
    assert!(
        read_migration("0014_movement_transfer_enum.sql").contains("'transfer'"),
        "0014 must declare the transfer value"
    );
    assert!(
        read_migration("0015_movement_transfer_account.sql").contains("transfer_account_id"),
        "0015 must add the transfer column"
    );
}

// ---------------------------------------------------------------------------
// Live-DB post-conditions. Skipped without DATABASE_URL. These probe only the
// objects 0016 removes (all `IF EXISTS`) plus the surviving account shape.
// ---------------------------------------------------------------------------

fn test_pool() -> Option<sqlx::PgPool> {
    std::env::var("DATABASE_URL")
        .ok()
        .map(|url| sqlx::PgPool::connect_lazy(&url).expect("lazy pool from DATABASE_URL"))
}

/// Process-wide guard for the live probes: the destructive replay must run
/// once, before any probe seeds a row against the surviving shape, so the
/// three live tests cannot observe a half-applied schema (the seed probe
/// would otherwise read `accounts.type` in one test while another test drops
/// it). Every live test takes this lock first and holds it to the end.
static LIVE_DB_GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn live_db_guard() -> std::sync::MutexGuard<'static, ()> {
    LIVE_DB_GUARD.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Apply 0016 when `accounts.type` still exists (fresh dev DB / checkout that
/// predates this slice). Returns true when this call applied it, so the
/// caller can tell whether the preservation probe ran against a live
/// destructive replay. Production already received the file out of band, so
/// the probe is a no-op there.
async fn ensure_0016_applied(pool: &sqlx::PgPool) -> bool {
    let type_exists: bool = sqlx::query_scalar(
        "SELECT count(*) = 1 FROM information_schema.columns \
         WHERE table_schema='public' AND table_name='accounts' AND column_name='type'",
    )
    .fetch_one(pool)
    .await
    .expect("probe accounts.type");
    if !type_exists {
        return false;
    }
    let sql = read_migration("0016_remove_account_type_and_card_fields.sql");
    // Audited: the statements are the committed migration file bytes, never
    // user input (owner-authorized destructive DDL; only a pre-0016 DB takes
    // this branch, and production already has 0016 applied).
    sqlx::raw_sql(sqlx::AssertSqlSafe(sql))
        .execute(pool)
        .await
        .expect("apply migration 0016");
    true
}

/// The four removed columns are gone, and only then is the enum dropped.
#[tokio::test]
async fn post_0016_type_and_card_columns_are_gone() {
    let Some(pool) = test_pool() else {
        eprintln!("SKIP post_0016_type_and_card_columns_are_gone: no DATABASE_URL");
        return;
    };
    let _live = live_db_guard();
    ensure_0016_applied(&pool).await;

    let columns: Vec<String> = sqlx::query_scalar(
        "SELECT column_name FROM information_schema.columns \
         WHERE table_schema='public' AND table_name='accounts' ORDER BY ordinal_position",
    )
    .fetch_all(&pool)
    .await
    .expect("list accounts columns");
    for removed in ["type", "credit_limit", "statement_day", "payment_due_day"] {
        assert!(
            !columns.iter().any(|c| c == removed),
            "accounts.{removed} must be gone after 0016, got: {columns:?}"
        );
    }

    // The enum is gone: its only owning column was `accounts.type`.
    let enum_present: bool = sqlx::query_scalar("SELECT to_regtype('public.account_type') IS NOT NULL")
        .fetch_one(&pool)
        .await
        .expect("probe account_type enum");
    assert!(!enum_present, "account_type must be dropped by 0016");
}

/// The three `chk_card_*` CHECKs and the partial card index are gone, while
/// the surviving account indexes are untouched.
#[tokio::test]
async fn post_0016_card_constraints_and_index_are_gone() {
    let Some(pool) = test_pool() else {
        eprintln!("SKIP post_0016_card_constraints_and_index_are_gone: no DATABASE_URL");
        return;
    };
    let _live = live_db_guard();
    ensure_0016_applied(&pool).await;

    let constraints: Vec<String> = sqlx::query_scalar(
        "SELECT conname FROM pg_constraint WHERE conrelid='public.accounts'::regclass",
    )
    .fetch_all(&pool)
    .await
    .expect("list accounts constraints");
    for removed in [
        "chk_card_limit_presence",
        "chk_card_limit_pos",
        "chk_card_days_presence",
    ] {
        assert!(
            !constraints.iter().any(|c| c == removed),
            "{removed} must be gone after 0016, got: {constraints:?}"
        );
    }
    // The surviving key/unique contract is intact.
    for kept in ["accounts_pkey", "accounts_user_id_name_key"] {
        assert!(
            constraints.iter().any(|c| c == kept),
            "{kept} must survive 0016, got: {constraints:?}"
        );
    }

    let indexes: Vec<String> = sqlx::query_scalar(
        "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='accounts'",
    )
    .fetch_all(&pool)
    .await
    .expect("list accounts indexes");
    assert!(
        !indexes.iter().any(|i| i == "idx_accounts_user_card"),
        "idx_accounts_user_card must be gone after 0016, got: {indexes:?}"
    );
    assert!(
        indexes.iter().any(|i| i == "idx_accounts_user_active"),
        "idx_accounts_user_active must survive 0016, got: {indexes:?}"
    );
}

/// The surviving columns and the stored money invariants hold after 0016: a
/// probe account carrying every removed column keeps its balance and its
/// name, no account ends up with a NULL balance, and the `NOT NULL`
/// invariants of the surviving shape are still in force.
#[tokio::test]
async fn post_0016_surviving_columns_rows_and_money_invariants_hold() {
    let Some(pool) = test_pool() else {
        eprintln!(
            "SKIP post_0016_surviving_columns_rows_and_money_invariants_hold: no DATABASE_URL"
        );
        return;
    };
    // Held for the whole test: probe → seed → replay → assert.
    let _live = live_db_guard();

    // Seed only while the removed columns still exist, so the destructive
    // replay has a real row (with a real balance) to preserve. The throwaway
    // user cascades both the account and any companion rows.
    let type_exists: bool = sqlx::query_scalar(
        "SELECT count(*) = 1 FROM information_schema.columns \
         WHERE table_schema='public' AND table_name='accounts' AND column_name='type'",
    )
    .fetch_one(&pool)
    .await
    .expect("probe accounts.type");
    let mut probe: Option<(uuid::Uuid, uuid::Uuid)> = None;
    if type_exists {
        let email = format!("mig0016-{}@example.com", uuid::Uuid::new_v4());
        let user_id: uuid::Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind("not-a-real-hash")
        .bind("migration 0016 test")
        .fetch_one(&pool)
        .await
        .expect("seed probe user");
        let account_id: uuid::Uuid = sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name, type, balance, credit_limit, statement_day, payment_due_day) \
             VALUES ($1,'0016 Probe','credit_card',-1234.56,5000,15,25) RETURNING id",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("seed probe account");
        probe = Some((user_id, account_id));
    }

    ensure_0016_applied(&pool).await;

    if let Some((user_id, account_id)) = probe {
        let (name, balance): (String, rust_decimal::Decimal) =
            sqlx::query_as("SELECT name, balance FROM accounts WHERE id=$1")
                .bind(account_id)
                .fetch_one(&pool)
                .await
                .expect("probe account survives the destructive block");
        assert_eq!(name, "0016 Probe", "the row must survive 0016");
        assert_eq!(
            balance,
            rust_decimal::Decimal::new(-123456, 2),
            "accounts.balance must be untouched by 0016"
        );
        sqlx::query("DELETE FROM users WHERE id=$1")
            .bind(user_id)
            .execute(&pool)
            .await
            .expect("cleanup probe user");
    }

    let columns: Vec<String> = sqlx::query_scalar(
        "SELECT column_name FROM information_schema.columns \
         WHERE table_schema='public' AND table_name='accounts' ORDER BY ordinal_position",
    )
    .fetch_all(&pool)
    .await
    .expect("list accounts columns");
    for kept in [
        "id",
        "user_id",
        "name",
        "currency",
        "balance",
        "notes",
        "color",
        "icon",
        "is_archived",
        "asset_id",
        "created_at",
        "updated_at",
    ] {
        assert!(
            columns.iter().any(|c| c == kept),
            "accounts.{kept} must survive 0016, got: {columns:?}"
        );
    }

    // Money invariant: dropping columns never nulls a stored balance and
    // never leaves the column type-less.
    let null_balances: i64 =
        sqlx::query_scalar("SELECT count(*) FROM accounts WHERE balance IS NULL")
            .fetch_one(&pool)
            .await
            .expect("count NULL balances");
    assert_eq!(null_balances, 0, "every surviving account keeps a balance");
    let balance_udt: Option<String> = sqlx::query_scalar(
        "SELECT udt_name FROM information_schema.columns \
         WHERE table_schema='public' AND table_name='accounts' AND column_name='balance'",
    )
    .fetch_optional(&pool)
    .await
    .expect("probe balance column type");
    assert_eq!(
        balance_udt.as_deref(),
        Some("numeric"),
        "accounts.balance must stay NUMERIC after 0016"
    );
}
