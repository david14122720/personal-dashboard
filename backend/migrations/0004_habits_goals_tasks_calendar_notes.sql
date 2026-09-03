-- Migration 0004: Habits, goals, tasks, calendar, notes
-- Productivity + personal tracking. All timestamped so reports can slice by
-- week / month / year without extra plumbing.

BEGIN;

-- ============================================================================
-- Habits
-- ============================================================================
CREATE TABLE habits (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    description  TEXT,
    direction    habit_direction NOT NULL,
    frequency    habit_frequency NOT NULL DEFAULT 'daily',
    -- For non-daily cadences (e.g. "3x/week") we keep days_of_week mask.
    -- 0=Sun .. 6=Sat. Empty array = every day.
    days_of_week SMALLINT[] NOT NULL DEFAULT ARRAY[]::SMALLINT[],
    -- Daily target for "reduce/quit" habits (e.g. max 1 cigarette).
    target_per_period NUMERIC(8,2),
    start_date   DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date     DATE,
    reminder_id  UUID REFERENCES reminders(id) ON DELETE SET NULL,
    category_id  UUID REFERENCES categories(id) ON DELETE SET NULL,
    color        TEXT,
    icon         TEXT,
    is_archived  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
);

CREATE INDEX idx_habits_user_active ON habits(user_id) WHERE NOT is_archived;

-- Daily habit log: one row per habit per day.
-- status only applies to build/maintain. For reduce/quit, status='done'
-- means "I avoided it", and we use count_value to track quantity when needed.
CREATE TABLE habit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    habit_id        UUID NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    log_date        DATE NOT NULL,
    status          habit_log_status NOT NULL,
    count_value     NUMERIC(8,2),            -- for "reduce" habits: actual count
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (habit_id, log_date)
);

CREATE INDEX idx_habit_logs_user_date ON habit_logs(user_id, log_date DESC);
CREATE INDEX idx_habit_logs_habit_date ON habit_logs(habit_id, log_date DESC);

-- ============================================================================
-- Goals
-- ============================================================================
CREATE TABLE goals (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    area        TEXT NOT NULL,                -- free-form area (finances, study, ...)
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    start_date  DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date    DATE,
    progress    SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    status      goal_status NOT NULL DEFAULT 'active',
    reminder_id UUID REFERENCES reminders(id) ON DELETE SET NULL,
    color       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_goals_user_status ON goals(user_id, status);
CREATE INDEX idx_goals_user_due ON goals(user_id, due_date) WHERE status = 'active';

-- ============================================================================
-- Tasks
-- ============================================================================
CREATE TABLE tasks (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT,
    priority     task_priority NOT NULL DEFAULT 'medium',
    status       task_status NOT NULL DEFAULT 'pending',
    due_date     DATE,
    completed_at TIMESTAMPTZ,
    -- Optional link to the goal that owns this task.
    goal_id      UUID REFERENCES goals(id) ON DELETE SET NULL,
    category_id  UUID REFERENCES categories(id) ON DELETE SET NULL,
    reminder_id  UUID REFERENCES reminders(id) ON DELETE SET NULL,
    -- Ordering within user — small integer for "drag and drop" sort.
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_user_status ON tasks(user_id, status);
CREATE INDEX idx_tasks_user_due ON tasks(user_id, due_date) WHERE status IN ('pending','in_progress');

CREATE OR REPLACE FUNCTION set_task_completed_at() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
        NEW.completed_at = now();
    ELSIF NEW.status <> 'completed' THEN
        NEW.completed_at = NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tasks_completed_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION set_task_completed_at();

-- ============================================================================
-- Calendar events
-- ============================================================================
CREATE TABLE events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT,
    kind        event_kind NOT NULL DEFAULT 'event',
    starts_at   TIMESTAMPTZ NOT NULL,
    ends_at     TIMESTAMPTZ,
    all_day     BOOLEAN NOT NULL DEFAULT FALSE,
    location    TEXT,
    -- Cross-domain links. Each is nullable — an event is its own thing.
    habit_id    UUID REFERENCES habits(id) ON DELETE SET NULL,
    goal_id     UUID REFERENCES goals(id) ON DELETE SET NULL,
    task_id     UUID REFERENCES tasks(id) ON DELETE SET NULL,
    debt_id     UUID REFERENCES debts(id) ON DELETE SET NULL,
    subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
    reminder_id UUID REFERENCES reminders(id) ON DELETE SET NULL,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_user_starts ON events(user_id, starts_at);
CREATE INDEX idx_events_user_kind ON events(user_id, kind, starts_at);

-- ============================================================================
-- Notes
-- ============================================================================
CREATE TABLE notes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    -- Markdown / plaintext flag — UI renders accordingly.
    is_markdown BOOLEAN NOT NULL DEFAULT TRUE,
    is_pinned   BOOLEAN NOT NULL DEFAULT FALSE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notes_user_updated ON notes(user_id, updated_at DESC);
CREATE INDEX idx_notes_user_pinned ON notes(user_id) WHERE is_pinned;

-- Full-text search across title + body.
ALTER TABLE notes ADD COLUMN search_tsv TSVECTOR
    GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(body, '')),  'B')
    ) STORED;

CREATE INDEX idx_notes_search ON notes USING GIN(search_tsv);

-- ============================================================================
-- updated_at
-- ============================================================================
CREATE TRIGGER trg_habits_updated_at
    BEFORE UPDATE ON habits
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_habit_logs_updated_at
    BEFORE UPDATE ON habit_logs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_goals_updated_at
    BEFORE UPDATE ON goals
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_events_updated_at
    BEFORE UPDATE ON events
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_notes_updated_at
    BEFORE UPDATE ON notes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
