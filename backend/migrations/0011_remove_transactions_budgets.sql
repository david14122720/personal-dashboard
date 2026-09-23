-- Migration 0011: remove transfers, transactions and budgets.
--
-- Destructive by explicit decision: no data migration, no
-- compatibility views, no dual read (data loss explicitly accepted). Applied out-of-band with autocommit
-- (this project has no _sqlx_migrations table). Never edit 0002/0005 — the
-- guard test asserts their bytes; 0005 already neutralised the transfer
-- branch, which is why the balance effect dies with the table.
--
-- Order matters: inbound FK columns → tables → functions → enum.

-- (a) Inbound foreign keys must go before their target table.
ALTER TABLE debt_payments DROP COLUMN transaction_id;
ALTER TABLE savings_goal_movements DROP COLUMN transaction_id;

-- (b) Tables. Plain drops only: an unforeseen dependent must fail loudly
-- instead of being silently removed. Indexes and triggers (idx_tx_*, trg_tx_*,
-- idx_budgets_*, trg_budgets_updated_at) fall with their tables.
DROP TABLE budgets;
DROP TABLE transactions;

-- (c) Trigger functions are unreferenced once the table is gone.
DROP FUNCTION apply_transaction_to_balance();
DROP FUNCTION apply_transfer_counterparty();

-- (d) The enum was used only by transactions.type. Drop it; if an unforeseen
-- dependent exists, leaving the type orphaned (no column of that type) is the
-- accepted fallback — never re-create the type plus column re-conversion,
-- never drop dependents implicitly.
DO $$
BEGIN
    DROP TYPE transaction_type;
EXCEPTION WHEN dependent_objects_still_exist THEN
    RAISE NOTICE 'transaction_type left orphaned: dependent object present';
END
$$;
