# Judgment Day — mcp-review-tokens (2026-10-05)

## Target
- HEAD `e583d42add8119a687ea011140f996ce44945608` + diff en: `backend/src/auth/rate_limit.rs`, `backend/src/routes/tokens.rs`, `mcp-dashboard/src/tools.ts`, `mcp-dashboard/src/index.ts`, `mcp-dashboard/README.md`, más `backend/migrations/0017_mcp_audit_log.sql` (nueva, NO aplicada) y notas en `openspec/changes/2026-10-05-mcp-review-tokens/` + `odd/tasks/mcp-review-tokens.md`.
- ODD claims al juzgar: 50 MCP tools; hábitos read-only; finanzas full salvo categorías-write y agregados; config tokens (list metadata-only, create raw-once session-only, revoke inmediato); mint rate-limit 10/hora/usuario; audit log en memoria + `list_audit_log`; e2e 43/43 y UI 18/18, residuo cero.

## Round 1 (blind, parallel, identical scope)
- Judge A: 2 findings — J-01 (MAJOR, introduced, deterministic): mint-budget TOCTOU race; I-01 (MINOR, introduced): MCP schema acepta montos cero/fechas imposibles, backend responde 422.
- Judge B: 4 findings — J-01 (MAJOR, introduced, deterministic): misma race (CORROBORA a A); S-01 (MAJOR, pre-existing): transporte MCP (hostGuard solo valida Host spoofeable, bind 0.0.0.0, fallback a token env de operador); I-02 (MINOR, introduced): `list_audit_log` sin autenticación; I-03 (MINOR, introduced): README header aún dice CRUD de hábitos.
- Ledger: confirmed-severe [J-01]; suspect [S-01]; info [I-01, I-02, I-03].

## Correction (round 1, bounded, jd-fix-agent)
- J-01 FIXED: `reserve_token_mint` atómica bajo un solo guard + `TokenMintReservation` con rollback por `Drop` (commit solo tras INSERT ok). Orden 401→422→429→409/201 intacto; list/revoke sin budget; single-replica.
- Tests nuevos: `concurrent_reservations_never_exceed_the_cap` (24 hilos vs cap 3, admite 3), `held/committed_reservation_*`, `tokens_create_concurrent_burst_never_exceeds_budget` (12 concurrentes vs cap 3, created ≤ 3, filas == 201s).
- Suite: 417 unit + 43 integration, 0 failed. Rollback: hunks en `rate_limit.rs` (~241–301, ~354–382, ~689–838) y `tokens.rs` (166–194, 918–995); NO `git checkout` (convive con T6).
- Higiene: solo usuarios efímeros, `leftover_*=0`; sin migraciones, deps, commits.

## Scoped re-judgment (ledger + fix delta only)
- Judge A: 1 finding fix-caused (MAJOR, deterministic): con el mapa en el cap de 4096 keys, un usuario nuevo puede desalojar el bucket de un usuario bajo presupuesto y su conteo reempieza (puede exceder 10/hora). Refiere `reserve_token_mint` → `bound_keys` (424–435) + cap 4096 (línea 25).
- Judge B: clean (`findings: []`): J-01 verificado cerrado (reserva atómica, orden, rollback, sin bypass, tests existen); la evicción 4096 es residual PRE-EXISTENTE (tradeoff DD5 compartido con buckets de login, sin cambio por el delta).
- Estado: CONTRADICCIÓN en clasificación del hallazgo de evicción (fix-caused vs pre-existing tradeoff) → se escala al dueño (regla: judges contradict → explicit human decision). Ronda 2 disponible (1 de 2 usada) solo con autorización.

## Counts
- confirmed: [J-01] (fixed, re-judgment: 1 clean / 1 fix-caused-claim → contradicción escalada)
- suspect: [S-01 transporte/hostGuard/fallback-token (pre-existing, sin fix; decisión de arquitectura del dueño)]
- contradictions: [evicción-4096: fix-caused (A) vs pre-existing-tradeoff (B)]
- info: [I-01 schemas permisivos con backstop 422; I-02 list_audit_log sin auth; I-03 README header hábitos]
- fix_work_units: [J-01 reserva atómica + 4 tests]
- scoped_rejudgment: escalated (punto único)
- terminal_state: approved (residual aceptado por el dueño, opción A 2026-10-05)
- skill_resolution: paths-injected

## Gaps ya documentados (no juzgados como defectos, decisión del dueño)
- G1/G6: sin POST/DELETE `/api/categories` (backend solo GET) — crear/eliminar categorías imposible.
- G2/G4: sin endpoint agregado de gráficas/dashboard server-side — composición client-side.
- G3: `get_preferences` lee vía GET /api/me (sin GET dedicado).
- Anthropic SDK: diferido, no instalado (servidor no lo necesita; schemas válidos vía conector MCP).
- Cosmético: badge "N activos" cuenta revocadas; audit durable 0017 sin aplicar (buffer en memoria, `list_audit_log`).

## Verdict
- Decisión del dueño 2026-10-05 (opción A): **residual de evicción-4096 ACEPTADO** como tradeoff DD5 documentado (requiere flood de 4096 usuarios distintos; mismo tradeoff del login limiter). Sin round-2.
- `JUDGMENT: APPROVED ✅` (riesgo aceptado explícitamente por el dueño; sin rounds restantes necesarios).
