-- Migration 0009: personal API tokens (long-lived `pd_` Bearer credentials).
--
-- A user manages named tokens via `POST/GET/DELETE /api/tokens` (creation
-- requires an active session). Day-to-day API use may present either a
-- session token or an API token as `Authorization: Bearer <raw>`; only the
-- SHA-256 hash (`token_hash`) is stored, never the raw value.
--
-- Plain DDL, no enum change: applied out-of-band with autocommit like the
-- other migrations in this project (there is no _sqlx_migrations tracking
-- table).

CREATE TABLE api_tokens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    token_hash   TEXT NOT NULL UNIQUE,
    prefix       TEXT NOT NULL,
    scopes       JSONB NOT NULL DEFAULT '[]'::jsonb,
    expires_at   TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_api_token_name_len CHECK (char_length(name) BETWEEN 1 AND 80),
    CONSTRAINT uq_api_tokens_user_name UNIQUE (user_id, name)
);

-- Per-user token management lookups (list + revoke), active tokens only.
CREATE INDEX idx_api_tokens_user_active
    ON api_tokens(user_id)
    WHERE revoked_at IS NULL;
