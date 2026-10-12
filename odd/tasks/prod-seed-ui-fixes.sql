-- Ephemeral verification seed for the finance UI change (2026-10-03).
--
-- WHY THIS FILE EXISTS
-- The owner authorised working directly against the production database for this
-- change, so the local backend in front of the static export points at prod.
-- This seed belongs to a throwaway user (verify-uifix@example.com) that is deleted
-- at the end: every row below cascades from users(id) ON DELETE CASCADE.
--
-- Movement dates are spread so that all four trend periods have points:
--   Día   (14) -> days ago 0,1,3,6,12
--   Semana (8) -> days ago 20,34,50
--   Mes   (12) -> days ago 75,110,175,260,330
--   Año    (5) -> days ago 420,600,900,1200,1500
-- Both chart categories carry expenses AND incomes so the compare view renders
-- four distinct lines.

BEGIN;

INSERT INTO accounts (user_id, name, type, currency, balance)
SELECT id, 'Cuenta Verif', 'bank', 'COP', 4200000.00
FROM users WHERE email = 'verify-uifix@example.com';

INSERT INTO accounts (user_id, name, type, currency, balance)
SELECT id, 'Efectivo Verif', 'cash', 'COP', 350000.00
FROM users WHERE email = 'verify-uifix@example.com';

INSERT INTO categories (user_id, kind, name, color)
SELECT id, 'finance', 'Alimentación Verif', '#f97316'
FROM users WHERE email = 'verify-uifix@example.com';

INSERT INTO categories (user_id, kind, name, color)
SELECT id, 'finance', 'Transporte Verif', '#38bdf8'
FROM users WHERE email = 'verify-uifix@example.com';

INSERT INTO categories (user_id, kind, name, color)
SELECT id, 'finance', 'Salario Verif', '#22c55e'
FROM users WHERE email = 'verify-uifix@example.com';

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
    ('Alimentación Verif', 'bank', 'expense',  45000.00,   0, 'Mercado de hoy'),
    ('Alimentación Verif', 'cash', 'expense',  18000.00,   6, 'Almuerzo'),
    ('Alimentación Verif', 'bank', 'expense',  62000.00,  12, 'Mercado de la quincena'),
    ('Alimentación Verif', 'cash', 'expense',  25000.00,  34, 'Mercado del mes pasado'),
    ('Alimentación Verif', 'bank', 'expense',  98000.00, 110, 'Mercado de hace tres meses'),
    ('Alimentación Verif', 'bank', 'expense', 132000.00, 600, 'Mercado del año pasado'),
    ('Alimentación Verif', 'bank', 'income',   30000.00,   3, 'Reintegro del mercado'),
    ('Alimentación Verif', 'cash', 'income',   22000.00,  20, 'Devolución semanal'),
    ('Alimentación Verif', 'bank', 'income',   55000.00, 260, 'Reintegro de hace ocho meses'),
    ('Transporte Verif',   'bank', 'expense',  30000.00,   1, 'Taxi al trabajo'),
    ('Transporte Verif',   'cash', 'expense',  12000.00,   3, 'Bus'),
    ('Transporte Verif',   'bank', 'expense',  47000.00,  34, 'Gasolina'),
    ('Transporte Verif',   'bank', 'expense',  38000.00,  75, 'Taxi de hace dos meses'),
    ('Transporte Verif',   'cash', 'expense',  15000.00, 330, 'Bus de hace once meses'),
    ('Transporte Verif',   'bank', 'expense',  61000.00,1200, 'Gasolina de hace tres años'),
    ('Transporte Verif',   'bank', 'income',   20000.00,   6, 'Reembolso de taxi'),
    ('Transporte Verif',   'cash', 'income',   14000.00,  50, 'Reembolso semanal'),
    ('Transporte Verif',   'bank', 'income',   36000.00, 900, 'Reembolso de hace dos años')
) AS v(cat, acct, dir, amt, days, descr)
JOIN accounts bank ON bank.user_id = u.id AND bank.name = 'Cuenta Verif'
JOIN accounts cash ON cash.user_id = u.id AND cash.name = 'Efectivo Verif'
JOIN categories c ON c.user_id = u.id AND c.name = v.cat
WHERE u.email = 'verify-uifix@example.com';

COMMIT;
