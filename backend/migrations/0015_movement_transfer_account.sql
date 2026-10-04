BEGIN;

-- Safe only because 0014 committed earlier: the CHECKs below reference
-- 'transfer', which a transaction that added the value could not do (55P04).
ALTER TABLE movements
    ADD COLUMN transfer_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT;

ALTER TABLE movements
    ADD CONSTRAINT chk_transfer_account_presence
        CHECK ((direction = 'transfer') = (transfer_account_id IS NOT NULL)),
    ADD CONSTRAINT chk_transfer_not_self
        CHECK (transfer_account_id IS NULL OR transfer_account_id <> account_id),
    ADD CONSTRAINT chk_transfer_no_category
        CHECK ((direction <> 'transfer') OR (category_id IS NULL));

-- Destination lookups and the ON DELETE RESTRICT probe on the new FK.
CREATE INDEX idx_movements_transfer_account
    ON movements (transfer_account_id)
    WHERE transfer_account_id IS NOT NULL;

COMMIT;
