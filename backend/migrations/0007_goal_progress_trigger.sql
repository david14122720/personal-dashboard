-- Migration 0007: goal progress trigger + task completed_at on INSERT.
--
-- `goals.progress` is trigger-owned (read-only at the API boundary): any
-- INSERT, UPDATE, or DELETE on `tasks` recomputes the progress of the
-- affected goal ids. The shared function reads both NEW and OLD goal ids
-- (inside the function body OLD.* is NULL on INSERT and NEW.* is NULL on
-- DELETE, which the UNION + NOT NULL filter absorb), but the WHEN
-- optimization lives ONLY on the UPDATE trigger: PostgreSQL rejects OLD
-- references in an INSERT trigger's WHEN clause (and NEW references in a
-- DELETE trigger's WHEN), so a single trigger with the combined WHEN clause
-- fails at CREATE TRIGGER time. Three narrow triggers share one function
-- instead -- same recompute semantics, no wasted goal rewrites on unrelated
-- task updates.
--
-- Also extends the 0004 `set_task_completed_at()` behavior to INSERTs by
-- adding a BEFORE INSERT trigger reusing the same function (OLD.* is NULL on
-- INSERT, so `OLD.status IS DISTINCT FROM 'completed'` is true and a task
-- created as 'completed' is stamped immediately). The existing BEFORE UPDATE
-- trigger is untouched. Bare statements with no BEGIN/COMMIT, following the
-- 0005 precedent. Ends with a backfill so pre-existing goals reflect their
-- current tasks.

CREATE OR REPLACE FUNCTION recalc_goal_progress() RETURNS TRIGGER AS $$
DECLARE g UUID; BEGIN
  FOR g IN SELECT DISTINCT x FROM (SELECT NEW.goal_id UNION SELECT OLD.goal_id) s(x) WHERE x IS NOT NULL LOOP
    UPDATE goals SET progress = (SELECT CASE WHEN COUNT(*)=0 THEN 0
      ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE status='completed') / COUNT(*)) END
      FROM tasks WHERE goal_id = g) WHERE id = g;
  END LOOP; RETURN COALESCE(NEW, OLD);
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tasks_goal_progress_insert ON tasks;
CREATE TRIGGER trg_tasks_goal_progress_insert
    AFTER INSERT ON tasks
    FOR EACH ROW EXECUTE FUNCTION recalc_goal_progress();

DROP TRIGGER IF EXISTS trg_tasks_goal_progress_update ON tasks;
CREATE TRIGGER trg_tasks_goal_progress_update
    AFTER UPDATE ON tasks
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.goal_id IS DISTINCT FROM NEW.goal_id)
    EXECUTE FUNCTION recalc_goal_progress();

DROP TRIGGER IF EXISTS trg_tasks_goal_progress_delete ON tasks;
CREATE TRIGGER trg_tasks_goal_progress_delete
    AFTER DELETE ON tasks
    FOR EACH ROW EXECUTE FUNCTION recalc_goal_progress();

DROP TRIGGER IF EXISTS trg_tasks_completed_at_insert ON tasks;
CREATE TRIGGER trg_tasks_completed_at_insert
    BEFORE INSERT ON tasks
    FOR EACH ROW EXECUTE FUNCTION set_task_completed_at();

-- Backfill: recompute progress for every goal from its current tasks.
UPDATE goals g SET progress = (SELECT CASE WHEN COUNT(*)=0 THEN 0
  ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE t.status='completed') / COUNT(*)) END
  FROM tasks t WHERE t.goal_id = g.id);
