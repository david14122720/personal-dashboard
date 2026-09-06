//! Regression test for migration 0007: `goals.progress` is trigger-owned and
//! `tasks.completed_at` is stamped on INSERT as well as UPDATE.
//!
//! File-content tests (no live DB needed) pin the migration shape in the
//! 0005 style; the behavioral test is DB-gated and drives raw SQL through
//! the trigger: progress 0 → 50 → 100 on task completion, back toward 0 on
//! delete, plus the INSERT-time `completed_at` stamp.

use std::path::PathBuf;
use uuid::Uuid;

fn migrations_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("migrations")
}

fn read_migration(name: &str) -> String {
    let path = migrations_dir().join(name);
    std::fs::read_to_string(&path)
        .unwrap_or_else(|_| panic!("migration file must exist: {}", path.display()))
}

#[test]
fn migration_0007_file_exists_and_defines_recalc() {
    let sql = read_migration("0007_goal_progress_trigger.sql");
    assert!(!sql.trim().is_empty(), "0007 must not be empty");
    assert!(
        sql.contains("CREATE OR REPLACE FUNCTION recalc_goal_progress()"),
        "0007 must define the recalc function"
    );
    assert!(
        sql.contains("COUNT(*) FILTER (WHERE status='completed')"),
        "0007 must count completed tasks for the progress formula"
    );
}

#[test]
fn migration_0007_covers_insert_update_delete_without_old_in_insert_when() {
    // PostgreSQL rejects OLD references in an INSERT trigger's WHEN clause
    // (and NEW references in a DELETE trigger's WHEN), so the design sketch
    // of one trigger with a combined WHEN cannot exist: three narrow
    // triggers share the function, and only the UPDATE trigger carries WHEN.
    let sql = read_migration("0007_goal_progress_trigger.sql");
    for trigger in [
        "trg_tasks_goal_progress_insert",
        "trg_tasks_goal_progress_update",
        "trg_tasks_goal_progress_delete",
        "trg_tasks_completed_at_insert",
    ] {
        assert!(sql.contains(trigger), "0007 must define trigger {trigger}");
    }
    assert!(
        sql.contains("WHEN (OLD.status IS DISTINCT FROM NEW.status"),
        "the UPDATE trigger must skip unrelated task writes"
    );
    assert!(
        sql.contains("UPDATE goals g SET progress"),
        "0007 must backfill pre-existing goals"
    );
}

fn test_pool() -> Option<sqlx::PgPool> {
    std::env::var("DATABASE_URL")
        .ok()
        .map(|url| sqlx::PgPool::connect_lazy(&url).expect("lazy pool from DATABASE_URL"))
}

#[tokio::test]
async fn goal_progress_follows_task_completion_live() {
    let Some(pool) = test_pool() else {
        eprintln!("SKIP goal_progress_follows_task_completion_live: no DATABASE_URL");
        return;
    };
    let user_id: Uuid = sqlx::query_scalar(
        "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
    )
    .bind(format!("mig7-{}@example.com", Uuid::new_v4()))
    .bind("not-a-real-hash")
    .bind("mig7 test")
    .fetch_one(&pool)
    .await
    .expect("seed user");
    let goal_id: Uuid = sqlx::query_scalar(
        "INSERT INTO goals (user_id, name, area) VALUES ($1,'Ship It','work') RETURNING id",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .expect("seed goal");

    async fn progress(pool: &sqlx::PgPool, goal_id: Uuid) -> i16 {
        sqlx::query_scalar("SELECT progress FROM goals WHERE id=$1")
            .bind(goal_id)
            .fetch_one(pool)
            .await
            .expect("read progress")
    }

    assert_eq!(progress(&pool, goal_id).await, 0);
    let t1: Uuid = sqlx::query_scalar(
        "INSERT INTO tasks (user_id, title, goal_id) VALUES ($1,'one',$2) RETURNING id",
    )
    .bind(user_id)
    .bind(goal_id)
    .fetch_one(&pool)
    .await
    .expect("seed pending task");
    assert_eq!(progress(&pool, goal_id).await, 0);
    // INSERT-time completed_at stamp (0007 BEFORE INSERT trigger).
    let stamped: bool = sqlx::query_scalar(
        "INSERT INTO tasks (user_id, title, goal_id, status) VALUES ($1,'two',$2,'completed') RETURNING completed_at IS NOT NULL",
    )
    .bind(user_id)
    .bind(goal_id)
    .fetch_one(&pool)
    .await
    .expect("seed completed task");
    assert!(stamped, "completed-at-insert must stamp completed_at");
    assert_eq!(progress(&pool, goal_id).await, 50);
    sqlx::query("UPDATE tasks SET status='completed' WHERE id=$1")
        .bind(t1)
        .execute(&pool)
        .await
        .expect("complete task");
    assert_eq!(progress(&pool, goal_id).await, 100);
    // Reopening one task drops progress back to 50 (UPDATE path).
    sqlx::query("UPDATE tasks SET status='pending' WHERE id=$1")
        .bind(t1)
        .execute(&pool)
        .await
        .expect("reopen task");
    assert_eq!(progress(&pool, goal_id).await, 50);
    // Deleting the remaining completed task leaves one pending task → 0
    // (DELETE path recomputes instead of going stale).
    sqlx::query("DELETE FROM tasks WHERE status='completed' AND goal_id=$1")
        .bind(goal_id)
        .execute(&pool)
        .await
        .expect("delete the completed task");
    assert_eq!(progress(&pool, goal_id).await, 0);

    sqlx::query("DELETE FROM users WHERE id=$1")
        .bind(user_id)
        .execute(&pool)
        .await
        .expect("cleanup user");
}
