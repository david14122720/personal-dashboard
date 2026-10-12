-- Prod catch-up for migration 0011 (2026-10-03, owner-authorised).
--
-- WHY THIS FILE EXISTS
-- Prod never ran 0011, but it did run 0013 (whose effects are present: savings_goals,
-- savings_goal_movements, debts and debt_payments are absent, events.debt_id is gone).
-- 0011's first two statements alter `debt_payments` and `savings_goal_movements`, which
-- 0013 already dropped, so the canonical 0011 file CANNOT run on prod as-is. The
-- canonical migration is deliberately NOT edited: CI applies it to a fresh DB where
-- those tables still exist at 0011 time.
--
-- This file performs ONLY the remaining 0011 statements, in 0011's own order.
-- Verified pre-state (2026-10-03): transactions 0 rows, budgets 0 rows; no views depend
-- on either table; the only FK is transactions' self-reference; the two triggers live ON
-- transactions and fall with it. DATA LOSS: none (both tables are empty).
--
-- Applied out-of-band with autocommit (this project has no _sqlx_migrations table).

-- (b) Tables. Plain drops only: an unforeseen dependent must fail loudly.
DROP TABLE budgets;
DROP TABLE transactions;

-- (c) Trigger functions are unreferenced once their table is gone.
DROP FUNCTION apply_transaction_to_balance();
DROP FUNCTION apply_transfer_counterparty();

-- (d) The enum was used only by transactions.type (0011 verbatim: an unforeseen
-- dependent leaves the type orphaned instead of being dropped implicitly).
DO $$
BEGIN
    DROP TYPE transaction_type;
EXCEPTION WHEN dependent_objects_still_exist THEN
    RAISE NOTICE 'transaction_type left orphaned: dependent object present';
END
$$;
