-- Migration 0003: Savings goals, debts, subscriptions, net worth
-- Independent finance-related domains. Each has its own primary table and
-- supporting history where the user wants progression over time.

BEGIN;

-- ============================================================================
-- Savings goals
-- ============================================================================
CREATE TABLE savings_goals (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    description   TEXT,
    target_amount NUMERIC(18,2) NOT NULL CHECK (target_amount > 0),
    saved_amount  NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (saved_amount >= 0),
    currency      CHAR(3) NOT NULL DEFAULT 'COP',
    target_date   DATE,
    -- Optional FK to a category (kind='finance') for grouping.
    category_id   UUID REFERENCES categories(id) ON DELETE SET NULL,
    color         TEXT,
    is_completed  BOOLEAN NOT NULL DEFAULT FALSE,
    completed_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
);

CREATE INDEX idx_savings_goals_user_active
    ON savings_goals(user_id)
    WHERE NOT is_completed;

-- Append-only ledger of deposits/withdrawals against a savings goal.
CREATE TABLE savings_goal_movements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    savings_goal_id UUID NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
    -- positive=deposit, negative=withdrawal
    amount          NUMERIC(18,2) NOT NULL CHECK (amount <> 0),
    occurred_on     DATE NOT NULL,
    -- Optional link to the funding transaction (deposit) or expense (withdrawal).
    transaction_id  UUID REFERENCES transactions(id) ON DELETE SET NULL,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_savings_movements_goal ON savings_goal_movements(savings_goal_id, occurred_on DESC);

CREATE OR REPLACE FUNCTION update_savings_goal_saved() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE savings_goals
        SET saved_amount = saved_amount + NEW.amount,
            is_completed = (saved_amount + NEW.amount) >= target_amount,
            completed_at = CASE
                WHEN (saved_amount + NEW.amount) >= target_amount AND completed_at IS NULL
                THEN now()
                ELSE completed_at
            END
        WHERE id = NEW.savings_goal_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE savings_goals
        SET saved_amount = saved_amount - OLD.amount,
            is_completed = FALSE,
            completed_at = NULL
        WHERE id = OLD.savings_goal_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_savings_movements_apply
    AFTER INSERT OR DELETE ON savings_goal_movements
    FOR EACH ROW EXECUTE FUNCTION update_savings_goal_saved();

-- ============================================================================
-- Debts
-- ============================================================================
CREATE TABLE debts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    creditor        TEXT NOT NULL,
    original_amount NUMERIC(18,2) NOT NULL CHECK (original_amount > 0),
    pending_amount  NUMERIC(18,2) NOT NULL CHECK (pending_amount >= 0),
    currency        CHAR(3) NOT NULL DEFAULT 'COP',
    start_date      DATE NOT NULL,
    due_date        DATE,
    installment     NUMERIC(18,2),            -- monthly/periodic installment
    interest_rate   NUMERIC(6,3),              -- e.g. 19.99 for 19.99%
    status          debt_status NOT NULL DEFAULT 'active',
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_debts_user_status ON debts(user_id, status);

-- Debt payments (abonos).
CREATE TABLE debt_payments (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    debt_id        UUID NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
    amount         NUMERIC(18,2) NOT NULL CHECK (amount > 0),
    paid_on        DATE NOT NULL,
    payment_method TEXT,
    -- Optional link to the actual bank transaction that funded this payment.
    transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
    notes          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_debt_payments_debt ON debt_payments(debt_id, paid_on DESC);

CREATE OR REPLACE FUNCTION update_debt_pending() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE debts
        SET pending_amount = GREATEST(pending_amount - NEW.amount, 0),
            status = CASE
                WHEN pending_amount - NEW.amount <= 0 THEN 'paid_off'::debt_status
                ELSE status
            END
        WHERE id = NEW.debt_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE debts
        SET pending_amount = pending_amount + OLD.amount,
            status = CASE
                WHEN status = 'paid_off' THEN 'active'::debt_status
                ELSE status
            END
        WHERE id = OLD.debt_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_debt_payments_apply
    AFTER INSERT OR DELETE ON debt_payments
    FOR EACH ROW EXECUTE FUNCTION update_debt_pending();

-- ============================================================================
-- Subscriptions
-- ============================================================================
CREATE TABLE subscriptions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    price          NUMERIC(18,2) NOT NULL CHECK (price >= 0),
    currency       CHAR(3) NOT NULL DEFAULT 'COP',
    frequency      subscription_frequency NOT NULL,
    next_billing_on DATE,
    category_id    UUID REFERENCES categories(id) ON DELETE SET NULL,
    payment_method TEXT,
    url            TEXT,
    notes          TEXT,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    cancelled_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_user_active ON subscriptions(user_id) WHERE is_active;
CREATE INDEX idx_subscriptions_user_next ON subscriptions(user_id, next_billing_on) WHERE is_active;

-- ============================================================================
-- Net worth: assets and liabilities snapshot.
-- `assets.kind` overlaps with `asset_category` but kept as its own enum so we
-- can extend (crypto, art, etc.) without churning the enum.
-- ============================================================================
CREATE TABLE assets (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    category     asset_category NOT NULL,
    -- Optional FK back to accounts so a bank account's value is auto-counted.
    account_id   UUID REFERENCES accounts(id) ON DELETE SET NULL,
    current_value NUMERIC(18,2) NOT NULL DEFAULT 0,
    currency      CHAR(3) NOT NULL DEFAULT 'COP',
    acquired_on   DATE,
    notes         TEXT,
    is_archived   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_assets_user_active ON assets(user_id) WHERE NOT is_archived;

-- Now wire the accounts.asset_id FK introduced in migration 0002.
ALTER TABLE accounts
    ADD CONSTRAINT fk_accounts_asset
    FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL;

-- Append-only history of asset valuations — drives the net-worth chart.
CREATE TABLE asset_valuations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asset_id    UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    value       NUMERIC(18,2) NOT NULL CHECK (value >= 0),
    recorded_on DATE NOT NULL,
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (asset_id, recorded_on)
);

CREATE INDEX idx_asset_valuations_asset ON asset_valuations(asset_id, recorded_on DESC);

CREATE OR REPLACE FUNCTION sync_asset_current_value() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE assets SET current_value = NEW.value WHERE id = NEW.asset_id;
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_asset_valuations_sync
    AFTER INSERT ON asset_valuations
    FOR EACH ROW EXECUTE FUNCTION sync_asset_current_value();

-- ============================================================================
-- updated_at
-- ============================================================================
CREATE TRIGGER trg_savings_goals_updated_at
    BEFORE UPDATE ON savings_goals
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_debts_updated_at
    BEFORE UPDATE ON debts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_assets_updated_at
    BEFORE UPDATE ON assets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
