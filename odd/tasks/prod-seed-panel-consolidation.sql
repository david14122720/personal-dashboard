-- Ephemeral verification seed for the panel-consolidation change (2026-10-03).
--
-- WHY THIS FILE EXISTS
-- The owner made "always work against the production database" a project rule, so the
-- local backend in front of the static export points at prod. This seed belongs to a
-- throwaway user (verify-panel@example.com) created with the backend's one-shot
-- `--create-user` flag and deleted at the end: every row below cascades from
-- users(id) ON DELETE CASCADE.
--
-- What the data is for:
--   * 2 accounts              -> the Cuentas card still renders one row per account
--   * 7 movements             -> the merged panel shows 5 rows plus the "Ver más" control
--   * 2 active subscriptions  -> "Próximas suscripciones" renders in the Resumen while the
--                                deleted "Suscripciones activas" widget must render nothing
--   * both directions + two categories -> the history rows and the chart keep their shape

BEGIN;

INSERT INTO accounts (user_id, name, type, currency, balance)
SELECT id, 'Cuenta Panel', 'bank', 'COP', 4200000.00
FROM users WHERE email = 'verify-panel@example.com';

INSERT INTO accounts (user_id, name, type, currency, balance)
SELECT id, 'Efectivo Panel', 'cash', 'COP', 350000.00
FROM users WHERE email = 'verify-panel@example.com';

INSERT INTO categories (user_id, kind, name, color)
SELECT id, 'finance', 'Alimentación Panel', '#f97316'
FROM users WHERE email = 'verify-panel@example.com';

INSERT INTO categories (user_id, kind, name, color)
SELECT id, 'finance', 'Transporte Panel', '#38bdf8'
FROM users WHERE email = 'verify-panel@example.com';

INSERT INTO movements (user_id, account_id, category_id, direction, amount, occurred_on, description)
SELECT u.id,
       CASE v.acct WHEN 'bank' THEN bank.id ELSE cash.id END,
       c.id,
       v.dir::movement_direction,
       v.amt,
       (now()::date - v.days)::date,
       v.descr
FROM users u
CROSS JOIN (VALUES
    ('Alimentación Panel', 'bank', 'expense',  45000.00,  0, 'Mercado de hoy'),
    ('Transporte Panel',   'cash', 'expense',  12000.00,  1, 'Bus'),
    ('Alimentación Panel', 'cash', 'expense',  18000.00,  2, 'Almuerzo'),
    ('Transporte Panel',   'bank', 'expense',  47000.00,  3, 'Gasolina'),
    ('Alimentación Panel', 'bank', 'expense',  62000.00,  4, 'Mercado de la semana'),
    ('Alimentación Panel', 'bank', 'income',   30000.00,  5, 'Reintegro del mercado'),
    ('Transporte Panel',   'cash', 'income',   14000.00,  6, 'Reembolso de bus')
) AS v(cat, acct, dir, amt, days, descr)
JOIN accounts bank ON bank.user_id = u.id AND bank.name = 'Cuenta Panel'
JOIN accounts cash ON cash.user_id = u.id AND cash.name = 'Efectivo Panel'
JOIN categories c ON c.user_id = u.id AND c.name = v.cat
WHERE u.email = 'verify-panel@example.com';

INSERT INTO subscriptions (user_id, name, price, currency, frequency, next_billing_on, payment_method, is_active)
SELECT id, 'Streaming Panel', 35900.00, 'COP', 'monthly', (now()::date + 3)::date, 'Tarjeta', true
FROM users WHERE email = 'verify-panel@example.com';

INSERT INTO subscriptions (user_id, name, price, currency, frequency, next_billing_on, payment_method, is_active)
SELECT id, 'Gimnasio Panel', 120000.00, 'COP', 'monthly', (now()::date + 12)::date, 'Transferencia', true
FROM users WHERE email = 'verify-panel@example.com';

COMMIT;
