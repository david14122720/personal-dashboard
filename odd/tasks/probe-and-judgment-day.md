# Probes + Judgment Day (money path & auth)

## Objective
Find real defects in error-prone surfaces (money, dates, money forms, sessions) and run a blind
dual Judgment Day over the critical money/auth path before it is trusted further. Fix only
severe findings, with tests.

## Target
- Judgment Day target: git commit `20b2806` (clean tree), scope = money path + auth.
  - backend: routes/movements.rs, routes/subscriptions.rs, routes/accounts.rs,
    finance/{money,dates,validation}.rs, auth/{helper,middleware}.rs
  - frontend: lib/api/client.ts, lib/finance/finance.ts, components/finance/MovementForms.tsx

## Decisions
- Probe tests run against scratch DB `pdb_probe_scratch` (created 2026-10-03, 13/13 migrations).
  Prod `pdbname` is never a test target.
- Two blind judges (`jd-judge-a`, `jd-judge-b`) read-only in parallel; only parent merges findings.
- Fix only severe findings confirmed by both judges; probe-found real defects are separate work units.
- No commit/push in this phase without explicit owner instruction.

## Tasks
- [x] Preparar scratch DB con 13 migraciones
- [x] Probes de borde (worker) + baseline de suites contra scratch
- [x] Judgment Day round 1 (jueces A+B ciegos)
- [x] Round de fixes F1-F7 con test-first
- [x] Correcciones R2-1/R2-2/R2-3 (F8/F9/F10)
- [x] Re-juicio final del delta: Judge A limpio, Judge B 1 WARNING + 1 SUGGESTION
- [x] F11 autorizado por el dueño: helper compartido + mensajes accionables en suscripciones
- [ ] Decisión del dueño sobre commit/push (el delta sigue sin commitear)

## Evidence
- scratch DB: pdb_probe_scratch (13 migraciones; reseteada a cero al final; prod `pdbname` nunca usado como target de tests)
- Ledger congelado: odd/judgment-ledger-money-path.md
- Round 1: 0 CRITICAL, 4 confirmados por ambos jueces (J-1..J-4), 1 sospechoso (J-5)
- Probes: 21 casos, 9 FAIL; CRITICAL P-1 (coma decimal = corrupción 100×) que los jueces no vieron
- Fix rounds: F1-F7, F8-F10, F11 (post-veredicto, autorizado por el dueño)
- Verificación final: backend 368 unit + integración (3/10/10/5/7) verde; frontend 42 files / 395 tests verde; tsc exit 0
- Verificación live del parent (backend local vs scratch): movimiento 3.500.000 → 201; PATCH balance 3.500.000 → 200 (antes 422); PATCH balance 1e9 → 422; descripción 2000 acentos → 201; precio sub 2e9 → 422
- Veredicto terminal: **JUDGMENT: APPROVED ✅** (0 CRITICAL en las 3 rondas; WARNING/SUGGESTION como info)
- Delta final: 17 archivos, +461/−66, sha256 `3c270a1d5f74b1dc9487d4150a6886686f4fafb927b83524713c829fe7902285`, patch en `odd/tasks/money-path-fix-delta-final.patch`
- **Sin commit ni push**: el delta vive en el working tree a la espera de autorización del dueño
