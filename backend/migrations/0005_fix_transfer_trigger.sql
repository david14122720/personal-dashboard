-- Migration 0005: Neutralize the transfer branch of apply_transaction_to_balance.
--
-- Regression context: the 0002 trigger applied transfer deltas per-row without
-- seeing both legs atomically. The first-leg insert found no counterparty and
-- skipped, while later inserts applied deltas depending on row order — a
-- recipe for skipped or double-applied balance moves. Transfers are now
-- applied explicitly by application code in a single transaction (insert both
-- legs with one transfer_group_id, then UPDATE both balances), so the trigger
-- MUST ignore transfer rows.
--
-- This migration only replaces the function body. The income / expense /
-- credit-card paths below preserve the exact 0002 behavior. Never edit 0002;
-- deployed databases already applied it.

CREATE OR REPLACE FUNCTION apply_transaction_to_balance() RETURNS TRIGGER AS $$
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
            -- No-op: transfer balances are applied explicitly by the
            -- application transfer transaction. The trigger must not move
            -- money for either leg, or balances would double-apply.
            RETURN NEW;
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
            -- No-op: transfer deletes are handled explicitly by application
            -- code (delete both legs as a unit), never by the trigger.
            RETURN OLD;
        END IF;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
