-- Migration 0018: dashboard index alignment (task read model).
--
-- ADDITIVE ONLY: three `CREATE INDEX` statements. No data change, no column or
-- constraint change, no behavior change; every statement is idempotent
-- (`IF NOT EXISTS`) so a re-run is a no-op.
--
-- WHY
-- ---
-- The dashboard's task read model is `WHERE user_id=$1 ... ORDER BY sort_order,
-- created_at` and, per view, `AND due_date = $2 AND completed_at IS NULL`
-- (today/upcoming/overdue) or `AND completed_at IS NOT NULL` (done). The
-- pre-existing indexes cannot serve those shapes:
--   * `idx_tasks_user_due` is partial on `status IN ('pending','in_progress')`,
--     a predicate those queries do not carry, so the planner can never use it;
--   * `idx_tasks_user_status (user_id, status)` gives no ordering, so the
--     unfiltered list sorted the whole table with a quicksort.
--
-- MEASURED (synthetic scale database: postgres:18-alpine, all migrations, 3
-- users with 30.000 tasks / 60.000 movements / 9.000 habit_logs, `ANALYZE`d;
-- `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF)`, single run each):
--
--   unfiltered list  (LIST_TASKS, what the dashboard widget calls)
--     before: Sort 3672 kB + Seq Scan 30.000 rows .......... 17.46 ms
--     after : Index Scan using idx_tasks_user_order .........  6.48 ms  (-63%)
--   view=today  (due_date = $2 AND completed_at IS NULL)
--     before: Sort + Seq Scan ................................  2.18 ms
--     after : Index Scan using idx_tasks_open_due ............  0.96 ms  (-56%)
--   view=done   (completed_at IS NOT NULL, same ORDER BY)
--     before: Sort 1228 kB + Seq Scan 12.000 rows ............  6.32 ms
--     after : Index Scan using idx_tasks_done_order ..........  4.39 ms  (-31%)
--
-- REJECTED on the same evidence (kept out on purpose — an index that does not
-- pay for its write cost is a regression):
--   * covering index on habit_logs `(habit_id, log_date DESC) INCLUDE (status,
--     user_id)`: it IS picked (Index Only Scan) and still measured 9.008 ms
--     against 7.846 ms without it — the streak CTE re-sorts ~1558 rows per
--     habit, so the cost is the sort, not the heap fetches. Fixing that needs a
--     semantic change (a bounded streak window), not an index.
--   * `(user_id, due_date) WHERE completed_at IS NULL` for `view=upcoming`:
--     measured 5.415 ms against 5.197 ms before; the 8850-row sort dominates.
--
-- SCOPE NOTE (honest): production holds 1 user and 0 tasks today, so the win
-- above is scale insurance, not a number the owner can see on the live app.
-- The statements are additive, so the cost of applying them is index
-- maintenance on a table with 0 rows.
--
-- APPLY PATH NOTE: production never applies a new migration automatically. The
-- compose `docker-entrypoint-initdb.d` mount only runs on an EMPTY data volume
-- and the backend does not call `sqlx::migrate!`, so this file keeps CI and
-- fresh volumes in sync while the production apply stays a manual, explicitly
-- owner-authorized step (`psql -f`, no `_sqlx_migrations` bookkeeping exists).

CREATE INDEX IF NOT EXISTS idx_tasks_user_order
    ON tasks (user_id, sort_order, created_at);

CREATE INDEX IF NOT EXISTS idx_tasks_open_due
    ON tasks (user_id, due_date)
    WHERE completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_done_order
    ON tasks (user_id, sort_order, created_at)
    WHERE completed_at IS NOT NULL;
