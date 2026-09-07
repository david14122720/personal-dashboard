-- Migration 0008: credit card CHECKs + partial indexes.
--
-- Activates the dormant card columns created in 0002 (`credit_limit`,
-- `statement_day`, `payment_due_day`) without touching any existing table
-- shape or trigger: ADD CONSTRAINT / CREATE INDEX only, so existing non-card
-- rows (all card columns NULL) are unaffected.
--
-- No transaction block needed (plain DDL, no enum change); applied
-- out-of-band with autocommit like the other migrations in this project
-- (there is no _sqlx_migrations tracking table).
--
-- NOTE on numbering: the design doc proposed `0006_credit_cards.sql`, but
-- 0006 (habit missed status) and 0007 (goal progress trigger) already exist,
-- so this migration lands as 0008 with identical content.

-- A card account MUST carry a limit; a non-card account MUST NOT.
ALTER TABLE accounts ADD CONSTRAINT chk_card_limit_presence CHECK (
  (type = 'credit_card') = (credit_limit IS NOT NULL)
);

-- A present limit MUST be positive (NUMERIC(18,2) codebase standard).
ALTER TABLE accounts ADD CONSTRAINT chk_card_limit_pos CHECK (
  credit_limit IS NULL OR credit_limit > 0
);

-- A card account MUST carry both cycle days; a non-card account MUST NOT.
-- (Range 1-31 is already enforced by the 0002 column CHECKs.)
ALTER TABLE accounts ADD CONSTRAINT chk_card_days_presence CHECK (
  (type = 'credit_card') = (statement_day IS NOT NULL AND payment_due_day IS NOT NULL)
);

-- Card lookups per user (dashboard card list, over-limit guard).
CREATE INDEX idx_accounts_user_card ON accounts(user_id) WHERE type = 'credit_card';

-- Statement-balance aggregate: linked expenses per card, newest first.
CREATE INDEX idx_tx_card_user_date
  ON transactions(credit_card_account_id, user_id, occurred_on DESC)
  WHERE credit_card_account_id IS NOT NULL;
