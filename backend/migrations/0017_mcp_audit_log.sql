-- Migration 0017 (T7 audit log — PENDING OWNER DECISION, NOT applied to prod).
--
-- Minimal additive design for a durable MCP audit log. This file is the
-- proposal only: it has NOT been applied to production and must not be
-- applied without the owner's explicit approval (destructive migrations
-- need approval; this one is additive but still gated by the T7 decision).
--
-- What the live T7 demo stores instead: an in-memory ring buffer in
-- `mcp-dashboard` (`recordAudit` in `src/tools.ts`, hooked in
-- `src/index.ts`), readable via the `list_audit_log` tool. Same columns
-- minus the DB-owned ones (`user_id`, `token_id`), same no-secrets rule.
--
-- Privacy rule (both versions): NEVER store raw tokens, token hashes,
-- tool arguments, request bodies, or Authorization headers. Only the
-- masked display prefix (`token_prefix`, e.g. first 8 chars of `pd_...`),
-- the tool name, the outcome, and a request id.

CREATE TABLE IF NOT EXISTS mcp_audit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id     UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    token_id    UUID NULL REFERENCES api_tokens(id) ON DELETE SET NULL,
    token_prefix TEXT NOT NULL,
    tool        TEXT NOT NULL,
    success     BOOLEAN NOT NULL,
    error_code  TEXT NULL,
    request_id  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_audit_log_occurred_at
    ON mcp_audit_log(occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_audit_log_tool
    ON mcp_audit_log(tool);

-- Example query (newest first, no secrets involved):
--   SELECT occurred_at, tool, success, error_code, token_prefix, request_id
--     FROM mcp_audit_log ORDER BY occurred_at DESC LIMIT 50;
