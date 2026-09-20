-- Migration 0010: habit display metadata (`category`, `short_label`).
--
-- Additive only, no data loss: both columns are nullable TEXT and existing
-- rows honestly keep NULL ("no category yet") instead of invented values.
-- `category` is a free-form display label (max 64 chars, enforced at the API
-- boundary) and is distinct from `category_id` (FK to `categories`);
-- `short_label` (max 32 chars) is the compact form for dense widgets. Both
-- are mutable display metadata like `color`/`icon`: writable on create and
-- PATCH, blank input normalizes to NULL.
--
-- Plain DDL, no enum change, applied out-of-band with autocommit like the
-- other migrations in this project (there is no _sqlx_migrations tracking
-- table); `IF NOT EXISTS` keeps re-application idempotent.

ALTER TABLE habits ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE habits ADD COLUMN IF NOT EXISTS short_label TEXT;
