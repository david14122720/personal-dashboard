-- Migration 0014: add the transfer direction to the movement enum.
--
-- This file MUST stay outside any explicit transaction block: Postgres raises
-- 55P04 ("unsafe use of new value ... of enum type") when a value added by
-- ALTER TYPE ... ADD VALUE is used in the same transaction, and every other
-- migration in this project wraps its body in BEGIN; ... COMMIT;. Applied with
-- autocommit (CI loops psql over migrations/*.sql one file at a time), the
-- value is committed here so 0015 is free to reference 'transfer'.
ALTER TYPE movement_direction ADD VALUE IF NOT EXISTS 'transfer';
