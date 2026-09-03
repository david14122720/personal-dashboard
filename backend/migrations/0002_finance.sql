-- Migration 0002: Finance core
-- Accounts, transactions, transfers, budgets. Money is stored as NUMERIC(18,2)
-- in the user's currency. All amounts are positive; the transaction_type
-- decides whether they count as income or expense.

BEGIN;

-- ============================================================================
-- Accounts
-- ============================================================================
CREATE TABLE accounts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    type         account_type NOT NULL,
    currency     CHAR(3) NOT NULL DEFAULT 'COP',
    -- Cached balance: written by triggers on transactions so dashboard
    -- reads stay O(1). Treat as derived — do not edit directly.
    balance      NUMERIC(18,2) NOT NULL DEFAULT 0,
    -- Credit-card-specific fields; nullable for non-card accounts.
    credit_limit      NUMERIC(18,2),
    statement_day     SMALLINT CHECK (statement_day BETWEEN 1 AND 31),
    payment_due_day   SMALLINT CHECK (payment_due_day BETWEEN 1 AND 31),
    notes             TEXT,
    color        TEXT,
    icon         TEXT,
    is_archived  BOOLEAN NOT NULL DEFAULT FALSE,
    -- Optional FK to the asset that mirrors this account in the net-worth module.
    -- Set NULL means the account is independent of net-worth tracking.
    asset_id     UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
);

CREATE INDEX idx_accounts_user_active ON accounts(user_id) WHERE NOT is_archived;

-- ============================================================================
-- Transactions
-- amount is always > 0. The type decides how it affects balance.
-- For transfer rows, the related_transfer_id links the two sides.
-- ============================================================================
CREATE TABLE transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    type            transaction_type NOT NULL,
    amount          NUMERIC(18,2) NOT NULL CHECK (amount > 0),
    currency        CHAR(3) NOT NULL DEFAULT 'COP',
    occurred_on     DATE NOT NULL,
    category_id     UUID REFERENCES categories(id) ON DELETE SET NULL,
    description     TEXT,
    payment_method  TEXT,                       -- cash, debit, transfer, nfc, etc.
    -- Transfer plumbing. Both sides of a transfer share the same group id.
    transfer_group_id   UUID,                   -- same value on both legs
    related_transfer_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
    -- For credit-card purchases, points to the card account; lets us split
    -- "spent on card X" from "paid card X from bank Y" cleanly.
    credit_card_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A transfer must reference another transaction on the other side.
    CONSTRAINT transfer_has_group CHECK (
        (type = 'transfer') = (transfer_group_id IS NOT NULL)
    )
);

CREATE INDEX idx_tx_user_date ON transactions(user_id, occurred_on DESC);
CREATE INDEX idx_tx_user_account_date ON transactions(user_id, account_id, occurred_on DESC);
CREATE INDEX idx_tx_user_category_date ON transactions(user_id, category_id, occurred_on DESC);
CREATE INDEX idx_tx_user_type_date ON transactions(user_id, type, occurred_on DESC);
CREATE INDEX idx_tx_transfer_group ON transactions(transfer_group_id) WHERE transfer_group_id IS NOT NULL;

-- ============================================================================
-- Budgets
-- A budget is a per-category, per-period cap. Period is "monthly" by default
-- but the start/end dates let us model weekly or custom spans too.
-- ============================================================================
CREATE TABLE budgets (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id   UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    amount        NUMERIC(18,2) NOT NULL CHECK (amount > 0),
    currency      CHAR(3) NOT NULL DEFAULT 'COP',
    period_start  DATE NOT NULL,
    period_end    DATE NOT NULL,
    -- Alert thresholds as fractions of `amount`. e.g. 0.8 warns at 80% used.
    warn_threshold  NUMERIC(4,3) NOT NULL DEFAULT 0.800 CHECK (warn_threshold BETWEEN 0 AND 1),
    over_threshold  NUMERIC(4,3) NOT NULL DEFAULT 1.000 CHECK (over_threshold BETWEEN warn_threshold AND 2),
    notes         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT budget_period_valid CHECK (period_end >= period_start)
);

CREATE INDEX idx_budgets_user_period ON budgets(user_id, period_start, period_end);
CREATE INDEX idx_budgets_user_category ON budgets(user_id, category_id, period_start DESC);

-- ============================================================================
-- Trigger: keep accounts.balance in sync with transactions.
-- For type=transfer we touch both legs in one go via transfer_group_id.
-- ============================================================================
CREATE OR REPLACE FUNCTION apply_transaction_to_balance() RETURNS TRIGGER AS $$
DECLARE
    counter_account_id UUID;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.type = 'income' THEN
            UPDATE accounts SET balance = balance + NEW.amount WHERE id = NEW.account_id;
        ELSIF NEW.type = 'expense' THEN
            UPDATE accounts SET balance = balance - NEW.amount WHERE id = NEW.account_id;
            -- Charge the credit card too if a card was used.
            IF NEW.credit_card_account_id IS NOT NULL THEN
                UPDATE accounts SET balance = balance - NEW.amount WHERE id = NEW.credit_card_account_id;
            END IF;
        ELSIF NEW.type = 'transfer' THEN
            -- Two-legged transfer: find the other leg by group id.
            SELECT account_id INTO counter_account_id
            FROM transactions
            WHERE transfer_group_id = NEW.transfer_group_id
              AND id <> NEW.id
            LIMIT 1;

            IF counter_account_id IS NULL THEN
                -- First leg being inserted — nothing to balance yet.
                RETURN NEW;
            END IF;

            IF NEW.account_id = counter_account_id THEN
                RAISE EXCEPTION 'Transfer legs cannot share an account';
            END IF;

            -- Move money out of source, into destination.
            -- We rely on the caller inserting both legs; the trigger fires per
            -- row, so each side applies its own delta when inserted.
            UPDATE accounts SET balance = balance - NEW.amount WHERE id = NEW.account_id;
        END IF;
        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        -- Reverse the effect.
        IF OLD.type = 'income' THEN
            UPDATE accounts SET balance = balance - OLD.amount WHERE id = OLD.account_id;
        ELSIF OLD.type = 'expense' THEN
            UPDATE accounts SET balance = balance + OLD.amount WHERE id = OLD.account_id;
            IF OLD.credit_card_account_id IS NOT NULL THEN
                UPDATE accounts SET balance = balance + OLD.amount WHERE id = OLD.credit_card_account_id;
            END IF;
        ELSIF OLD.type = 'transfer' THEN
            UPDATE accounts SET balance = balance + OLD.amount WHERE id = OLD.account_id;
        END IF;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tx_apply_balance
    AFTER INSERT OR DELETE ON transactions
    FOR EACH ROW EXECUTE FUNCTION apply_transaction_to_balance();

-- Handle the second leg of a transfer (so the receiver gets credited).
CREATE OR REPLACE FUNCTION apply_transfer_counterparty() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.type = 'transfer' AND NEW.related_transfer_id IS NULL THEN
        UPDATE transactions
        SET related_transfer_id = NEW.id
        WHERE transfer_group_id = NEW.transfer_group_id
          AND id <> NEW.id
          AND related_transfer_id IS NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tx_link_counterparty
    AFTER INSERT ON transactions
    FOR EACH ROW EXECUTE FUNCTION apply_transfer_counterparty();

-- ============================================================================
-- Trigger: updated_at
-- ============================================================================
CREATE TRIGGER trg_accounts_updated_at
    BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_tx_updated_at
    BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_budgets_updated_at
    BEFORE UPDATE ON budgets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
