-- Ephemeral verification seed for the solidificacion-dashboard feature (2026-10-12).
--
-- WHY THIS FILE EXISTS
-- The owner authorised working directly against the production database, so the
-- local backend in front of the static export points at prod. Every row below
-- belongs to one throwaway user (`e2e-solid@example.com`) created with
-- `--create-user`, and is deleted at the end: everything cascades from
-- users(id) ON DELETE CASCADE.
--
-- WHAT THE DATA IS FOR (verification, not demo art)
--   * spans the four finance trend periods so the charts have points;
--   * one active + one cancelled subscription, so the finance page renders both
--     the `Cancelar/Reactivar` and `Pagar` affordances the live smoke asserts;
--   * tasks in all three dashboard views (today / upcoming / done);
--   * habits with a log history, so the streak and today widgets are non-trivial;
--   * assets, goals and events so the home widgets are not empty shells.
--
-- Distribution state this seed divides: prod has one pre-existing user and no
-- tasks. Every statement is idempotent-by-construction: it only inserts for the
-- throwaway user's id and is run exactly once against a freshly created user.

BEGIN;

-- accounts -----------------------------------------------------------------
INSERT INTO accounts (user_id, name, currency, balance, color)
SELECT u.id, v.name, 'COP', v.balance, v.color
FROM users u
CROSS JOIN (VALUES
    ('Cuenta Solid',   4200000.00, '#38bdf8'),
    ('Efectivo Solid',  350000.00, '#22c55e')
) AS v(name, balance, color)
WHERE u.email = 'e2e-solid@example.com';

-- categories ---------------------------------------------------------------
INSERT INTO categories (user_id, kind, name, color)
SELECT u.id, v.kind::category_kind, v.name, v.color
FROM users u
CROSS JOIN (VALUES
    ('finance',      'Alimentación Solid', '#f97316'),
    ('finance',      'Transporte Solid',   '#38bdf8'),
    ('finance',      'Salario Solid',      '#22c55e'),
    ('task',         'Trabajo Solid',      '#a855f7'),
    ('habit',        'Salud Solid',        '#ef4444'),
    ('goal',         'Ahorro Solid',       '#eab308'),
    ('subscription', 'Servicios Solid',    '#06b6d4')
) AS v(kind, name, color)
WHERE u.email = 'e2e-solid@example.com';

-- movements: four trend periods (día / semana / mes / año) -----------------
INSERT INTO movements (user_id, account_id, category_id, direction, amount, occurred_on, description)
SELECT u.id,
       CASE v.account WHEN 'bank' THEN a_bank.id ELSE a_cash.id END,
       c.id,
       v.direction::movement_direction,
       v.amount,
       (now()::date - v.days)::date,
       v.description
FROM users u
JOIN accounts a_bank ON a_bank.user_id = u.id AND a_bank.name = 'Cuenta Solid'
JOIN accounts a_cash ON a_cash.user_id = u.id AND a_cash.name = 'Efectivo Solid'
JOIN categories c ON c.user_id = u.id
CROSS JOIN (VALUES
    ('bank', 'Alimentación Solid', 'expense',  45000.00,   0, 'Mercado de hoy'),
    ('cash', 'Alimentación Solid', 'expense',  18000.00,   3, 'Almuerzo de la semana'),
    ('bank', 'Alimentación Solid', 'expense',  62000.00,  12, 'Mercado de la quincena'),
    ('bank', 'Transporte Solid',   'expense',  47000.00,  34, 'Gasolina del mes pasado'),
    ('cash', 'Transporte Solid',   'expense',  12000.00,   1, 'Bus'),
    ('bank', 'Salario Solid',      'income',  3500000.00, 75, 'Salario de hace tres meses'),
    ('bank', 'Salario Solid',      'income',  4100000.00, 600, 'Salario del año pasado')
) AS v(account, category, direction, amount, days, description)
WHERE u.email = 'e2e-solid@example.com' AND c.name = v.category;

-- subscriptions: one active (with a pending payment) + one cancelled -------
INSERT INTO subscriptions (user_id, name, price, currency, frequency, next_billing_on, category_id, payment_method, is_active, cancelled_at)
SELECT u.id, v.name, v.price, 'COP', v.frequency::subscription_frequency, (now()::date + v.next_in)::date,
       c.id, v.method, v.is_active, CASE WHEN v.is_active THEN NULL ELSE now() - interval '10 days' END
FROM users u
JOIN categories c ON c.user_id = u.id AND c.name = 'Servicios Solid'
CROSS JOIN (VALUES
    ('Streaming Solid', 45000.00, 'monthly', 3, 'Tarjeta Solid', true),
    ('Gimnasio Solid',  120000.00, 'monthly', 9, 'Débito Solid', false)
) AS v(name, price, frequency, next_in, method, is_active)
WHERE u.email = 'e2e-solid@example.com';

-- assets (net worth) -------------------------------------------------------
INSERT INTO assets (user_id, name, category, current_value, currency)
SELECT u.id, v.name, v.category::asset_category, v.value, 'COP'
FROM users u
CROSS JOIN (VALUES
    ('Ahorro Solid', 'cash',        2500000.00),
    ('Fondo Solid',  'investment',  8000000.00),
    ('Moto Solid',   'vehicle',     6500000.00)
) AS v(name, category, value)
WHERE u.email = 'e2e-solid@example.com';

-- goals --------------------------------------------------------------------
INSERT INTO goals (user_id, name, area, progress, status, due_date, color)
SELECT u.id, v.name, 'finance', v.progress, v.status::goal_status, (now()::date + v.due_in)::date, v.color
FROM users u
CROSS JOIN (VALUES
    ('Fondo de emergencia Solid', 40, 'active',   120, '#eab308'),
    ('Viaje Solid',               75, 'active',    45, '#a855f7'),
    ('Curso Solid',              100, 'completed', -20, '#22c55e')
) AS v(name, progress, status, due_in, color)
WHERE u.email = 'e2e-solid@example.com';

-- tasks: today / upcoming / done, all three dashboard views ---------------
INSERT INTO tasks (user_id, title, priority, status, due_date, completed_at, sort_order)
SELECT u.id, v.title, v.priority::task_priority, v.status::task_status,
       (now()::date + v.due_in)::date,
       CASE WHEN v.completed_days_ago IS NULL THEN NULL
            ELSE now() - (v.completed_days_ago || ' days')::interval END,
       v.sort_order
FROM users u
CROSS JOIN (VALUES
    ('Pagar servicios Solid',   'high',   'pending',   0, NULL::int,  1),
    ('Revisar presupuesto Solid','medium','pending',   2, NULL,       2),
    ('Llamar al banco Solid',   'urgent', 'pending', 400, NULL,       3),
    ('Comprar mercado Solid',   'medium', 'completed', -2, 2,         4),
    ('Renovar SOAT Solid',      'high',   'completed', -9, 9,         5)
) AS v(title, priority, status, due_in, completed_days_ago, sort_order)
WHERE u.email = 'e2e-solid@example.com';

-- habits + logs (streaks need history) ------------------------------------
INSERT INTO habits (user_id, name, direction, frequency, target_per_period, start_date, color, short_label)
SELECT u.id, v.name, v.direction::habit_direction, 'daily'::habit_frequency, v.target, (now()::date - 30)::date, v.color, v.label
FROM users u
CROSS JOIN (VALUES
    ('Caminar Solid',   'build',    30.0, '#22c55e', 'Caminar'),
    ('Leer Solid',      'build',    20.0, '#38bdf8', 'Leer'),
    ('Cafeína Solid',   'reduce',    2.0, '#f97316', 'Cafeína')
) AS v(name, direction, target, color, label)
WHERE u.email = 'e2e-solid@example.com';

INSERT INTO habit_logs (user_id, habit_id, log_date, status, count_value)
SELECT u.id, h.id, (now()::date - v.days)::date, v.status::habit_log_status, v.count
FROM users u
JOIN habits h ON h.user_id = u.id
CROSS JOIN (VALUES
    (0,  'done',     32.0),
    (1,  'done',     28.0),
    (2,  'skipped',  0.0),
    (3,  'done',     30.0),
    (4,  'not_done', 0.0),
    (5,  'done',     25.0),
    (6,  'done',     31.0),
    (8,  'done',     22.0),
    (12, 'done',     20.0),
    (20, 'done',     18.0)
) AS v(days, status, count)
WHERE u.email = 'e2e-solid@example.com'
  AND h.name = 'Caminar Solid';

INSERT INTO habit_logs (user_id, habit_id, log_date, status, count_value)
SELECT u.id, h.id, (now()::date - v.days)::date, v.status::habit_log_status, v.count
FROM users u
JOIN habits h ON h.user_id = u.id
CROSS JOIN (VALUES
    (0, 'done',    25.0),
    (1, 'done',    22.0),
    (3, 'skipped',  0.0),
    (6, 'done',    19.0),
    (15,'done',    12.0)
) AS v(days, status, count)
WHERE u.email = 'e2e-solid@example.com'
  AND h.name = 'Leer Solid';

-- events (calendar range around today) ------------------------------------
INSERT INTO events (user_id, title, kind, starts_at, ends_at, all_day)
SELECT u.id, v.title, 'event'::event_kind, now() + (v.day_offset || ' days')::interval, NULL, false
FROM users u
CROSS JOIN (VALUES
    ('Reunión Solid',      0),
    ('Cita médica Solid',  2),
    ('Pago tarjeta Solid', 5)
) AS v(title, day_offset)
WHERE u.email = 'e2e-solid@example.com';

COMMIT;
