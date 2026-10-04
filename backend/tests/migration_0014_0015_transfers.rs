//! Guard for migrations 0014 (movement transfer enum) and 0015 (transfer
//! account column, CHECKs, index) — slice S1 / W2a of
//! `2026-10-04-accounts-transfers-login-calendar`.
//!
//! Post-condition guards only: 0014 MUST be exactly the enum
//! `ADD VALUE IF NOT EXISTS 'transfer'` statement with NO explicit
//! transaction block (a value added by `ALTER TYPE ... ADD VALUE` cannot be
//! used in the transaction that added it — Postgres `55P04`, the same reason
//! 0006 stays outside a transaction), and 0015 MUST add the nullable
//! transfer column with its `ON DELETE RESTRICT` FK, the three CHECKs and
//! the partial index inside its own `BEGIN; … COMMIT;`, safe only because
//! 0014 committed earlier.
//!
//! The file-content guards run everywhere. The live catalog probes SKIP
//! without `DATABASE_URL` and only assert objects these two migrations
//! create — never that an object from an earlier migration exists, because
//! not every environment received every earlier migration (production never
//! received the 0008 card CHECKs or `idx_accounts_user_card`). The CHECK
//! enforcement probes run inside transactions that roll back and leave no
//! rows behind.
//!
//! `0014` is additive and is applied out of band, one file at a time with
//! per-file autocommit (owner-authorized 2026-10-04). `ensure_0014_0015_applied`
//! only fills a fresh-dev gap; it never folds 0014 and 0015 into one
//! transaction.

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
fn migration_0014_is_the_single_enum_value_outside_a_transaction() {
    let sql = read_migration("0014_movement_transfer_enum.sql");
    let statements = statements_only(&sql);
    // No explicit transaction block: the value must commit before 0015 may
    // reference it. Checked on the statements, never on the comment text.
    let upper = statements.to_uppercase();
    assert!(
        !upper.contains("BEGIN") && !upper.contains("COMMIT"),
        "0014 must not open/close a transaction, got: {statements}"
    );
    // Exactly one statement, and it is the enum value (IF NOT EXISTS keeps a
    // replay idempotent).
    assert_eq!(
        statements,
        "ALTER TYPE movement_direction ADD VALUE IF NOT EXISTS 'transfer';",
        "0014 must contain exactly the enum ADD VALUE statement"
    );
    assert!(
        sql.contains("55P04"),
        "0014's comment must name the 55P04 reason for staying outside a transaction"
    );
}

#[test]
fn migration_0015_wraps_the_transfer_objects_in_its_own_transaction() {
    let sql = read_migration("0015_movement_transfer_account.sql");
    let statements = statements_only(&sql);
    let upper = statements.to_uppercase();
    assert!(
        upper.starts_with("BEGIN;"),
        "0015 must open its own transaction, got: {statements}"
    );
    assert!(
        upper.ends_with("COMMIT;"),
        "0015 must close its own transaction, got: {statements}"
    );
    for token in [
        "transfer_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT",
        "chk_transfer_account_presence",
        "chk_transfer_not_self",
        "chk_transfer_no_category",
        "idx_movements_transfer_account",
        "WHERE transfer_account_id IS NOT NULL",
    ] {
        assert!(sql.contains(token), "0015 must contain `{token}`");
    }
    // The three CHECK semantics pinned by the finance-movements spec.
    for condition in [
        "(direction = 'transfer') = (transfer_account_id IS NOT NULL)",
        "transfer_account_id IS NULL OR transfer_account_id <> account_id",
        "(direction <> 'transfer') OR (category_id IS NULL)",
    ] {
        assert!(sql.contains(condition), "0015 must contain `{condition}`");
    }
    // Additive-only and no destructive or re-creative statement.
    for forbidden in [
        "CASCADE",
        "DROP",
        "CREATE TYPE",
        "CREATE TABLE",
        "BACKUP",
        "DUMP",
        "transactions",
    ] {
        assert!(
            !upper.contains(forbidden),
            "0015 must never contain `{forbidden}`"
        );
    }
}

#[test]
fn applied_migrations_are_untouched_by_this_change() {
    // Byte-identity proxy for 0008 (design D1.2): the card CHECKs it shipped
    // with must still be there.
    let card = read_migration("0008_credit_cards.sql");
    assert!(
        card.contains("chk_card_limit_presence"),
        "0008 must stay byte-identical (chk_card_limit_presence)"
    );
    // 0001–0013 never reference the new transfer object and never add a
    // movement_direction value: a hit would mean an applied migration was
    // edited. (0006 legitimately adds a *habit_log_status* value, so the
    // enum-specific token is asserted instead of a bare `ADD VALUE`.)
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
    ] {
        let sql = read_migration(name);
        for token in ["transfer_account_id", "movement_direction ADD VALUE"] {
            assert!(
                !sql.contains(token),
                "{name} must not reference `{token}` (applied migrations are never edited)"
            );
        }
    }
    // 0012 still declares exactly the two original directions.
    let movements = read_migration("0012_movements.sql");
    assert!(
        movements.contains("CREATE TYPE movement_direction AS ENUM ('expense', 'income')"),
        "0012 must keep its original enum declaration"
    );
}

// ---------------------------------------------------------------------------
// Live-DB post-conditions. Skipped without DATABASE_URL. These only probe
// the objects 0014/0015 create (IF EXISTS semantics); production never
// received the 0008 card objects, so no earlier-migration object is asserted.
// ---------------------------------------------------------------------------

fn test_pool() -> Option<sqlx::PgPool> {
    std::env::var("DATABASE_URL")
        .ok()
        .map(|url| sqlx::PgPool::connect_lazy(&url).expect("lazy pool from DATABASE_URL"))
}

/// Apply 0014 then 0015 only when the transfer column is absent (fresh dev
/// database). Production already received them out of band; the probe is a
/// no-op there. Each file runs on its own connection/autocommit round:
/// `BEGIN`-less 0014 first, then 0015's own transaction.
async fn ensure_0014_0015_applied(pool: &sqlx::PgPool) {
    let column_exists: bool = sqlx::query_scalar(
        "SELECT count(*) = 1 FROM information_schema.columns \
         WHERE table_schema='public' AND table_name='movements' AND column_name='transfer_account_id'",
    )
    .fetch_one(pool)
    .await
    .expect("probe transfer_account_id");
    if column_exists {
        return;
    }
    let enum_0014 = read_migration("0014_movement_transfer_enum.sql");
    // Audited: the statement is the committed migration file bytes, never
    // user input (additive DDL; runs only against a fresh dev DB).
    sqlx::raw_sql(sqlx::AssertSqlSafe(enum_0014))
        .execute(pool)
        .await
        .expect("apply migration 0014");
    let account_0015 = read_migration("0015_movement_transfer_account.sql");
    sqlx::raw_sql(sqlx::AssertSqlSafe(account_0015))
        .execute(pool)
        .await
        .expect("apply migration 0015");
}

#[tokio::test]
async fn post_0014_0015_transfer_objects_exist() {
    let Some(pool) = test_pool() else {
        eprintln!("SKIP post_0014_0015_transfer_objects_exist: no DATABASE_URL");
        return;
    };
    ensure_0014_0015_applied(&pool).await;

    // (1) The enum holds the transfer value next to the two originals.
    let labels: Vec<String> = sqlx::query_scalar(
        "SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_enum.enumtypid = pg_type.oid \
         WHERE pg_type.typname='movement_direction' ORDER BY enumsortorder",
    )
    .fetch_all(&pool)
    .await
    .expect("list movement_direction values");
    for label in ["expense", "income", "transfer"] {
        assert!(
            labels.iter().any(|l| l == label),
            "movement_direction must hold `{label}`, got: {labels:?}"
        );
    }

    // (2) The nullable UUID column exists.
    let column: Option<(String, String)> = sqlx::query_as(
        "SELECT data_type, is_nullable FROM information_schema.columns \
         WHERE table_schema='public' AND table_name='movements' AND column_name='transfer_account_id'",
    )
    .fetch_optional(&pool)
    .await
    .expect("probe transfer_account_id column");
    assert_eq!(
        column,
        Some(("uuid".to_string(), "YES".to_string())),
        "movements.transfer_account_id must be a nullable UUID column"
    );

    // (3) The FK on the new column is ON DELETE RESTRICT (identified by the
    // column it covers, not just by its target table).
    let fk_defs: Vec<String> = sqlx::query_scalar(
        "SELECT pg_get_constraintdef(oid) FROM pg_constraint \
         WHERE conrelid='public.movements'::regclass AND contype='f' \
           AND pg_get_constraintdef(oid) LIKE '%transfer_account_id%'",
    )
    .fetch_all(&pool)
    .await
    .expect("probe transfer_account_id FK");
    assert!(
        fk_defs.iter().any(|def| def.contains("REFERENCES accounts(id)")
            && def.contains("ON DELETE RESTRICT")),
        "transfer_account_id must reference accounts(id) ON DELETE RESTRICT, got: {fk_defs:?}"
    );

    // (4) Exactly the three CHECKs exist and carry their pinned semantics.
    let checks: Vec<(String, String)> = sqlx::query_as(
        "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint \
         WHERE conrelid='public.movements'::regclass AND contype='c' \
           AND conname IN ('chk_transfer_account_presence','chk_transfer_not_self','chk_transfer_no_category')",
    )
    .fetch_all(&pool)
    .await
    .expect("probe transfer CHECKs");
    assert_eq!(checks.len(), 3, "all three transfer CHECKs must exist: {checks:?}");
    let def_of = |name: &str| {
        checks
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, def)| def.as_str())
            .unwrap_or_else(|| panic!("missing CHECK `{name}` in {checks:?}"))
    };
    assert!(
        def_of("chk_transfer_account_presence").contains("transfer_account_id IS NOT NULL"),
        "chk_transfer_account_presence must pin direction/column presence"
    );
    assert!(
        def_of("chk_transfer_not_self").contains("transfer_account_id <> account_id"),
        "chk_transfer_not_self must pin destination != origin"
    );
    assert!(
        def_of("chk_transfer_no_category").contains("category_id IS NULL"),
        "chk_transfer_no_category must pin categoryless transfers"
    );

    // (5) The partial destination index exists on the new column.
    let indexdef: Option<String> = sqlx::query_scalar(
        "SELECT indexdef FROM pg_indexes \
         WHERE schemaname='public' AND tablename='movements' AND indexname='idx_movements_transfer_account'",
    )
    .fetch_optional(&pool)
    .await
    .expect("probe transfer index");
    let indexdef = indexdef.expect("idx_movements_transfer_account must exist");
    assert!(
        indexdef.contains("transfer_account_id") && indexdef.contains("WHERE"),
        "idx_movements_transfer_account must be the partial destination index, got: {indexdef}"
    );
}

#[tokio::test]
async fn post_0015_transfer_row_shape_is_check_enforced() {
    let Some(pool) = test_pool() else {
        eprintln!("SKIP post_0015_transfer_row_shape_is_check_enforced: no DATABASE_URL");
        return;
    };
    ensure_0014_0015_applied(&pool).await;

    // Throwaway fixture; every row cascades from `users(id)`.
    let email = format!("mig-transfer-{}@example.com", uuid::Uuid::new_v4());
    let user_id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
    )
    .bind(&email)
    .bind("not-a-real-hash")
    .bind("migration guard")
    .fetch_one(&pool)
    .await
    .expect("seed user");
    let account_a: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO accounts (user_id, name, balance) VALUES ($1,'Guard A',0) RETURNING id",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .expect("seed account A");
    let account_b: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO accounts (user_id, name, balance) VALUES ($1,'Guard B',0) RETURNING id",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .expect("seed account B");
    let category_id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO categories (user_id, kind, name) VALUES ($1,'finance','Guard') RETURNING id",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .expect("seed category");

    // (label, account, destination, category, direction). Every row violates
    // exactly one consistency CHECK.
    let probes: Vec<(&str, uuid::Uuid, Option<uuid::Uuid>, Option<uuid::Uuid>, &str)> = vec![
        ("expense with a destination", account_a, Some(account_b), Some(category_id), "expense"),
        ("transfer with NULL destination", account_a, None, None, "transfer"),
        ("transfer with self destination", account_a, Some(account_a), None, "transfer"),
        ("transfer carrying a category", account_a, Some(account_b), Some(category_id), "transfer"),
    ];
    let mut rejected: Vec<(&str, bool)> = Vec::with_capacity(probes.len());
    for (label, account, destination, category, direction) in probes {
        let mut tx = pool.begin().await.expect("open probe transaction");
        let result = sqlx::query(
            "INSERT INTO movements (user_id, account_id, transfer_account_id, category_id, direction, amount, occurred_on) \
             VALUES ($1,$2,$3,$4,$5::movement_direction,100.00,'2026-10-04')",
        )
        .bind(user_id)
        .bind(account)
        .bind(destination)
        .bind(category)
        .bind(direction)
        .execute(&mut *tx)
        .await;
        // Roll back first so a failed assertion can never leak a row.
        tx.rollback().await.expect("rollback probe");
        rejected.push((label, result.is_err()));
    }
    // Cleanup before asserting: no movement survived the rollbacks, and the
    // throwaway user cascades its accounts/categories.
    sqlx::query("DELETE FROM users WHERE id=$1")
        .bind(user_id)
        .execute(&pool)
        .await
        .expect("cleanup user");
    for (label, was_rejected) in rejected {
        assert!(was_rejected, "{label} must be rejected by the transfer CHECKs");
    }
}
