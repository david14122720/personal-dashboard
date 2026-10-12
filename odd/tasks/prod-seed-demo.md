# Seed demo en prod (dashboard lleno)

## Objective
Llenar DB prod `pdbname` con datos inventados para ver dashboard lleno, con vaciado posterior. Autorizado por dueño 2026-10-03 (prod no pública).

## Decisions
- Vía SQL directa con prefijo `zzseed_` (categories sin POST, API no crea categorías).
- Una sola transacción: categories + accounts con balance explícito + movements con `occurred_on` variado + `UPDATE balance` firmado (sin trigger desde 0012).
- Backup `pg_dump` antes de tocar nada. No se tocan users/sessions/tokens.
- Alcance inicial: cuentas + movimientos + categorías + subs básicas para Resumen/Finanzas. No savings/debts/transactions/budgets (retirados 0011/0013).

## Tasks
- [x] Mapear acceso prod y schema (scout + Dokploy MCP)
- [ ] Backup pg_dump + relevar user_id y volumen actual (read-only counts)
- [ ] Seed SQL `zzseed_` en una transacción (3 cuentas, ~30 movimientos 6 meses, categorías)
- [ ] Verificar API/dashboard lleno (counts + GET /api/movements + /api/accounts)
- [ ] Dejar script de vaciado `zzseed_` (movements -> accounts -> categories)

## Evidence
- backup: /tmp/prod-backup-20261003.json (accounts 1, habits 1, resto 0)
- owner: b99ef7bc-594e-45e6-8001-010de36d2981 (david.alejandro.araujo93@gmail.com) — el otro usuario no tiene filas
- seed 2026-10-03: 7 categorías finance, 3 cuentas (Bancolombia/Efectivo/Nu, nequi intacta), 34 movimientos abr-oct 2026 (income 23.37M / expense 2.20M), 4 subs mensuales próximas oct-06..15
- balances con delta aplicado en la misma transacción (réplica API, sin trigger): Bancolombia 21.992.900, Nu 3.119.200, Efectivo 107.000
- seed IDs: /tmp/seed-ids-20261003.json
- wipe script (NO ejecutado): odd/tasks/wipe-prod-seed-demo.sql — movements -> subs -> accounts -> categories por IDs exactos
