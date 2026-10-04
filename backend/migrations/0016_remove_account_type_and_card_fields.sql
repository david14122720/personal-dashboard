BEGIN;

-- Migration 0016: the account type and the whole credit-card semantic layer
-- leave the product (slice W1 of 2026-10-04-accounts-transfers-login-calendar;
-- owner decision 2026-10-04 confirmed twice, recorded as an accepted loss —
-- net worth becomes assets-only and the credit-card-summary capability is
-- retired).
--
-- This is a destructive block, not a rename: no replacement classifier, no
-- data migration, no backup. Nothing real is lost: production holds 0
-- credit-card accounts, so every removed column is NULL there.
--
-- Every drop is IF EXISTS-tolerant on purpose: production never received the
-- 0008 card CHECKs nor idx_accounts_user_card, while a fresh CI database did
-- (0013 and later landed without them in production). The same file must
-- apply cleanly against both states.
--
-- Order: objects that depend on `type` go before `type`; objects that depend
-- on `credit_limit` go before that column; `DROP TYPE account_type` runs last,
-- when its only owning column is gone. No CASCADE anywhere, and never a
-- reference to the transfer objects 0014/0015 add.
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS chk_card_limit_presence;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS chk_card_limit_pos;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS chk_card_days_presence;
DROP INDEX IF EXISTS idx_accounts_user_card;
ALTER TABLE accounts
    DROP COLUMN IF EXISTS credit_limit,
    DROP COLUMN IF EXISTS statement_day,
    DROP COLUMN IF EXISTS payment_due_day;
ALTER TABLE accounts DROP COLUMN IF EXISTS type;
DROP TYPE IF EXISTS account_type;

COMMIT;
