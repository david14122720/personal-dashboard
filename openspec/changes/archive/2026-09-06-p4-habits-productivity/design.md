# Design: p4-habits-productivity

## Technical Approach

Five route modules following the `debts.rs` pattern: `require_user_id` auth, `deny_unknown_fields` DTOs, `user_id`-scoped SQL, `23505→409` / `23503,23514→422`. Migrations `0006` (enum `missed`), `0007` (goal-progress trigger + task `completed_at` on INSERT). Streaks via on-demand SQL; `goals.progress` trigger-owned.

**Spec correction:** specs say `403` for cross-user access — this codebase has no 403. Foreign access → `404`; bad session → `401`. Tasks/verify must assert 401/404.

## Architecture Decisions

| Option | Tradeoff | Decision |
|---|---|---|
| Streak: precomputed column vs on-demand SQL | Write-amplified + needs backfill | On-demand SQL over `idx_habit_logs_habit_date`; `EXPLAIN ANALYZE` in tests |
| `not_done`→`missed`: rename vs additive | Rename breaks deployed rows | `ADD VALUE 'missed'`; streak treats both as breaking |
| Goal progress: app code vs trigger | App code races | `AFTER INSERT OR UPDATE OR DELETE` trigger; `progress` read-only |
| Event links: raw FK vs ownership probes | Raw FK blurs 404/422 on cross-user ids | Per-FK probe: missing → `404`, owned-by-other → `422` |
| Notes search: `LIKE` vs `search_tsv` | `LIKE` ignores existing GIN index | `plainto_tsquery('simple', q) @@ search_tsv`; blank `q` skips predicate |

## Data Flow

```
Bearer → require_user_id (401) → handler (404 foreign / 422 bad link / 409 dup)
habits.rs → habit_logs → streak SQL read model
tasks.rs  → tasks ─trigger→ goals.progress (read-only)
events.rs → 6-FK probes → events · notes.rs → search_tsv (GIN), pinned-first
```

## File Changes

| File | Action | Description |
|---|---|---|
| `backend/migrations/0006_habit_log_missed.sql` | Create | Single-statement `ALTER TYPE … ADD VALUE 'missed'` — **no `BEGIN/COMMIT`** (PG forbids enum alter in txn) |
| `backend/migrations/0007_goal_progress_trigger.sql` | Create | `recalc_goal_progress()` + trigger; `BEFORE INSERT` trigger reusing `set_task_completed_at()` (now UPDATE-only) |
| `backend/src/routes/{habits,goals,tasks,events,notes}.rs` | Create | Domain CRUD + read models below |
| `backend/src/routes/mod.rs`, `main.rs` | Modify | Register modules, wire routes |
| `backend/tests/migration_0007_goal_progress.rs` | Create | Trigger test (`migration_0005_*` style) |

## Interfaces / Contracts

Habits: `POST /habits` (201) · `GET /habits`, `/habits/:id` · `PATCH/DELETE /habits/:id` (204) · `POST /habits/:id/logs` (201, dup → 409) · `PATCH /habits/:id/logs/:date` · `GET /habits/:id/streak`. Goals: CRUD on `/goals`, `/goals/:id`. Tasks: CRUD + `GET /tasks?view=today|upcoming|overdue|done` (today: `due_date=CURRENT_DATE AND completed_at IS NULL`; overdue: `due_date<today …`; done: `completed_at IS NOT NULL`). Events: CRUD + `GET /events?from&to` (`starts_at < :to AND (ends_at IS NULL OR ends_at > :from)`). Notes: CRUD + pin + `GET /notes/search?q=` (blank → all, `is_pinned DESC, updated_at DESC`).

Validation: `custom` requires non-empty `days_of_week`, others empty (422); note body ≤ 1 MiB (422); `completed_at`/`progress` rejected by `deny_unknown_fields`. Goal link: foreign → `404`, nonexistent → `422`.

Goal formula: `total=0 ? 0 : ROUND(100·done/total)`, `done = status='completed'`. One trigger with `WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.goal_id IS DISTINCT FROM NEW.goal_id)` (NULL semantics cover INSERT/DELETE); function recomputes both `NEW` and `OLD` goal ids:

```sql
CREATE OR REPLACE FUNCTION recalc_goal_progress() RETURNS TRIGGER AS $$
DECLARE g UUID; BEGIN
  FOR g IN SELECT DISTINCT x FROM (SELECT NEW.goal_id UNION SELECT OLD.goal_id) s(x) WHERE x IS NOT NULL LOOP
    UPDATE goals SET progress = (SELECT CASE WHEN COUNT(*)=0 THEN 0
      ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE status='completed') / COUNT(*)) END
      FROM tasks WHERE goal_id = g) WHERE id = g;
  END LOOP; RETURN COALESCE(NEW, OLD);
END; $$ LANGUAGE plpgsql;
```

Streak gaps-and-islands (`skipped` neutral, `missed`/`not_done` break, mask honored, anchor = max log; `$3` = mask):

```sql
WITH logs AS (SELECT log_date, status FROM habit_logs WHERE habit_id=$1 AND user_id=$2
  AND status <> 'skipped' AND (COALESCE(CARDINALITY($3),0)=0
  OR EXTRACT(DOW FROM log_date)::int = ANY($3))),
ordered AS (SELECT log_date, status, ROW_NUMBER() OVER (ORDER BY log_date DESC) AS rn,
  (SELECT MAX(log_date) FROM logs) AS anchor FROM logs),
cut AS (SELECT MIN(rn) AS cut_rn FROM ordered
  WHERE status IN ('missed','not_done') OR log_date <> anchor - (rn - 1))
SELECT COALESCE((SELECT cut_rn FROM cut), (SELECT COUNT(*)+1 FROM ordered)) - 1 AS current_streak;
```

Events matrix (6 link FKs): scoped probe, then unscoped exists-probe (foreign → `422`, absent → `404`). **No `events.note_id` in schema** — note-linking out of scope.

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | Validators, `deny_unknown_fields`, code mapping, SQL scope asserts | `cargo test`, no DB |
| Integration | CRUD, streak (healthy/broken/masked), trigger 50%→100%→0-tasks, FTS pin-order + empty-q | DB-gated `#[tokio::test]`, skip w/o `DATABASE_URL` |
| E2E | — | N/A (no frontend) |

RED: `cargo clippy --all-targets -- -D warnings`; `EXPLAIN (ANALYZE,BUFFERS)` on streak + search.

## Threat Matrix

N/A — CRUD-only change; bearer auth + parameterized `sqlx` throughout.

## Migration / Rollout

`0006` additive (no txn block); `0007` additive + backfill `UPDATE goals SET progress=(…)`. Rollback via follow-up migration (enum value retained). Auto-chain: Habits → Goals → Tasks → Events → Notes, ≤400 lines each with tests.

## Open Questions

- [ ] `weekly`/`monthly` streak semantics (v1: mask-only)
- [ ] Add `events.note_id` later? (schema change, out of scope)
