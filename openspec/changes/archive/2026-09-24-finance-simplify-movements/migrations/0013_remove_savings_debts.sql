-- Migration 0013: remove savings goals and debts.
--
-- GATED destructive migration (finance-simplify-movements S-G,
-- `finance-core-invariants` "Gated Destructive Migration 0013"): staged at
-- `openspec/changes/finance-simplify-movements/migrations/`, copied into
-- `backend/migrations/` ONLY at the authorized gate step. CI applies every
-- `backend/migrations/*.sql` automatically and the compose DB mounts that
-- folder as `docker-entrypoint-initdb.d`, so staging here is the structural
-- gate — placing this file in `backend/migrations/` pre-gate would silently
-- destroy rows.
--
-- Destructive by explicit decision: no data migration, no compatibility
-- views, no dual read (data loss explicitly accepted). Applied out-of-band
-- with autocommit (this project has no _sqlx_migrations table). Standing
-- no-backup decision, same posture as 0011. Owner authorization recorded at
-- apply time; deploy gate re-confirms the intentional data loss (savings
-- goals, goal movements, debts, debt payments) before any production apply.
-- Post-0013 there is NO data rollback by design.
--
-- Order matters (0011 order, adapted): inbound FK column on a surviving
-- table → child tables → parent tables → trigger functions. Plain drops
-- only: an unforeseen dependent must fail loudly instead of being silently
-- removed. `events.debt_id` is the one inbound FK to `debts` on a surviving
-- table; `savings_goals`/`debts` have no other surviving referents.

-- (a) Inbound foreign key on a surviving table.
ALTER TABLE events DROP COLUMN debt_id;

-- (b) Child tables first (they own the inbound FKs to the parents).
DROP TABLE debt_payments;
DROP TABLE savings_goal_movements;

-- (c) Parent tables.
DROP TABLE debts;
DROP TABLE savings_goals;

-- (d) Trigger functions are unreferenced once their tables are gone.
DROP FUNCTION update_debt_pending();
DROP FUNCTION update_savings_goal_saved();
