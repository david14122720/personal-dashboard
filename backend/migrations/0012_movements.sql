-- Migration 0012: movements ledger + subscription last_paid_on.
--
-- Additive ONLY (finance-core-invariants "Migration Discipline"): creates the
-- `movement_direction` enum, the `movements` table with its three indexes,
-- and the `subscriptions.last_paid_on` column. It MUST NOT modify or remove
-- any pre-existing table, trigger, column or enum.
--
-- The balance effect is applied by an application-level sqlx transaction
-- inside the movement request handler (finance-simplify-movements D4) —
-- deliberately NO trigger writes `accounts.balance`, so this migration
-- creates no trigger at all. `UPDATE ... SET updated_at = now()` is issued
-- explicitly by the movement statements instead.
--
-- Reference integrity (finance-movements "Movement Record Model"):
--   user_id         -> users(id)         ON DELETE CASCADE  (scope cleanup)
--   account_id      -> accounts(id)      ON DELETE RESTRICT (delete guard:
--                                        an account with movements is 409)
--   category_id     -> categories(id)    ON DELETE SET NULL (audit survives)
--   subscription_id -> subscriptions(id) ON DELETE SET NULL (audit survives;
--                                        only the subscription Pay action
--                                        writes this column, never the API)
--
-- Applied like every migration here: CI loops `migrations/*.sql` with
-- autocommit psql, and the compose DB mounts this folder as
-- `docker-entrypoint-initdb.d`.

BEGIN;

CREATE TYPE movement_direction AS ENUM ('expense', 'income');

CREATE TABLE movements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    category_id     UUID REFERENCES categories(id) ON DELETE SET NULL,
    direction       movement_direction NOT NULL,
    amount          NUMERIC(18,2) NOT NULL CHECK (amount > 0),
    occurred_on     DATE NOT NULL,
    description     TEXT,
    subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- First index carries the full list ORDER BY
-- (occurred_on DESC, created_at DESC, id DESC); the two purpose-built
-- indexes cover the history per-account filter and the chart scan.
CREATE INDEX idx_movements_user_date
    ON movements (user_id, occurred_on DESC, created_at DESC, id DESC);
CREATE INDEX idx_movements_user_account
    ON movements (user_id, account_id);
CREATE INDEX idx_movements_user_category
    ON movements (user_id, category_id);

-- Cycle state for the subscription Pay action (S-B): the date the
-- subscription was last paid, in America/Bogota. NULL means never paid.
ALTER TABLE subscriptions ADD COLUMN last_paid_on DATE;

COMMIT;
