-- Migration 0019: legacy API tokens get an expiry (audit F-13).
--
-- `api_tokens.expires_at` was nullable, and the lookup accepted
-- `expires_at IS NULL` as "valid forever". A token minted before the 90-day
-- ceiling existed therefore survived logout, `DELETE /sessions` and any later
-- session revoke. This file closes the legacy rows: every token without an
-- expiry is stamped at `created_at + 90 days`, the same ceiling
-- `MAX_EXPIRES_IN_DAYS` now enforces on new mints.
--
-- Never extends: `created_at + 90 days` is in the past for a token older than
-- 90 days, so those rows become dead on their next lookup instead of gaining
-- lifetime. Already-expired and revoked rows are untouched (`revoked_at` stays
-- the authority for them), and the `IS NULL` guard makes a re-run a no-op.
--
-- The read-time half of the fix lives in `auth/middleware.rs`
-- (`API_TOKEN_LOOKUP_SQL`): the `expires_at IS NULL` branch is gone, so expiry
-- is mandatory at authentication time whether or not this backfill has run.
--
-- Scope: `api_tokens` is a management table, not a hot path, and the
-- statement only touches rows that are already legacy (`expires_at IS NULL`),
-- so it is `WHERE`-guarded and idempotent. Applied out of band like every other
-- file in this directory (no `_sqlx_migrations` bookkeeping).

UPDATE api_tokens
   SET expires_at = created_at + interval '90 days'
 WHERE expires_at IS NULL;
