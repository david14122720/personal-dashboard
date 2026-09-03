-- Migration 0001: Auth + reusable categories + preferences
-- Establishes the user-scoped foundation that every other domain depends on.

BEGIN;

-- ============================================================================
-- Extensions
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive email

-- ============================================================================
-- Enums
-- ============================================================================
-- Account kinds: where money lives.
CREATE TYPE account_type AS ENUM (
    'bank', 'savings', 'cash', 'digital_wallet', 'credit_card', 'investment', 'other'
);

-- Transaction direction: income, expense, or internal transfer (excluded from totals).
CREATE TYPE transaction_type AS ENUM ('income', 'expense', 'transfer');

-- Habit direction: build, maintain, reduce, quit.
CREATE TYPE habit_direction AS ENUM ('build', 'maintain', 'reduce', 'quit');

-- Habit cadence: how often a habit should be tracked.
CREATE TYPE habit_frequency AS ENUM ('daily', 'weekly', 'monthly', 'custom');

-- Daily log status: positive habits only (done / skipped / not done).
CREATE TYPE habit_log_status AS ENUM ('done', 'skipped', 'not_done');

-- Goal status lifecycle.
CREATE TYPE goal_status AS ENUM ('active', 'completed', 'paused', 'cancelled');

-- Task priority.
CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high', 'urgent');

-- Task status.
CREATE TYPE task_status AS ENUM ('pending', 'in_progress', 'completed', 'cancelled');

-- Calendar event kind.
CREATE TYPE event_kind AS ENUM ('event', 'appointment', 'reminder', 'payment_due', 'goal_milestone', 'habit_reminder');

-- Subscription billing cadence.
CREATE TYPE subscription_frequency AS ENUM ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'semiannual', 'annual');

-- Debt status.
CREATE TYPE debt_status AS ENUM ('active', 'paid_off', 'defaulted', 'negotiating');

-- Asset category for net worth.
CREATE TYPE asset_category AS ENUM ('cash', 'account', 'investment', 'equipment', 'vehicle', 'property', 'other');

-- Category kind (polymorphic — used for finance, habit, goal, task, subscription).
CREATE TYPE category_kind AS ENUM ('finance', 'habit', 'goal', 'task', 'subscription');

-- ============================================================================
-- Users (single-user personal app, but designed so multi-user is a future toggle)
-- ============================================================================
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         CITEXT NOT NULL UNIQUE,
    password_hash TEXT   NOT NULL,
    display_name  TEXT   NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- Sessions (token-based auth, JWT-friendly)
-- ============================================================================
CREATE TABLE sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,        -- store hash, never raw token
    user_agent  TEXT,
    ip_address  INET,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_user_active
    ON sessions(user_id)
    WHERE revoked_at IS NULL;

-- ============================================================================
-- User preferences (currency, theme, dashboard layout, etc.)
-- ============================================================================
CREATE TABLE user_preferences (
    user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    currency_code    CHAR(3) NOT NULL DEFAULT 'COP',
    locale           TEXT    NOT NULL DEFAULT 'es-CO',
    timezone         TEXT    NOT NULL DEFAULT 'America/Bogota',
    dashboard_layout JSONB   NOT NULL DEFAULT '{}'::jsonb,  -- toggled sections
    extra            JSONB   NOT NULL DEFAULT '{}'::jsonb,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- Categories (polymorphic, user-scoped, kind-tagged)
-- A user can have many categories per kind; one default row can be the
-- "uncategorized" fallback that the system needs for legacy data.
-- ============================================================================
CREATE TABLE categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        category_kind NOT NULL,
    name        TEXT NOT NULL,
    color       TEXT,             -- hex string for UI; validated at app layer
    icon        TEXT,             -- optional icon key
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, kind, name)
);

CREATE INDEX idx_categories_user_kind ON categories(user_id, kind) WHERE NOT is_archived;

-- ============================================================================
-- Reminders (cross-domain — referenced by events, payments, habits, tasks, goals)
-- A reminder is its own entity because the same reminder can fire once or
-- repeatedly and is decoupled from the entity that owns it.
-- ============================================================================
CREATE TABLE reminders (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    notes          TEXT,
    remind_at      TIMESTAMPTZ NOT NULL,
    recurrence     JSONB,                       -- iCal RRULE or simple {every,count}
    is_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    is_completed   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reminders_user_pending
    ON reminders(user_id, remind_at)
    WHERE is_enabled AND NOT is_completed;

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_user_preferences_updated_at
    BEFORE UPDATE ON user_preferences
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_reminders_updated_at
    BEFORE UPDATE ON reminders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
