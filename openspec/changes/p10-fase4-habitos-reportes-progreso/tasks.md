# Tasks — p10-fase4-habitos-reportes-progreso

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | S1 ~150–250 · S2 ~300–400 · S3 ~250–350 · S4 ~250–350 · Total ~950–1350 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 (S1 historial-BE) → PR2 (S2 historial-FE) → PR3 (S3 reportes) → PR4 (S4 progreso+score), stacked-to-main |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

```text
Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
```

> Total supera 400 líneas; cada slice individual cabe en budget (S2 al límite, con plan de partición S2a/S2b si excede). TDD estricto ACTIVO en los 4 slices. JD 2 jueces ciegos antes de cada merge. `delivery_strategy: auto-chain`, `chain_strategy: stacked-to-main`.

## Slice S1 — Historial-BE `GET /habits/logs?from&to` (base: `main`)

Objetivo: un solo endpoint multi-hábito en 1 round-trip + tests puros sin DB. Sin agregados, sin migración, sin ensanchar `HabitRow` (15 cols, cap 16 sqlx).

### S1 — RED (tests primero, deben fallar)

- [x] 1.1 RED: agregar tests puros `parse_logs_range` en `backend/src/routes/habits.rs` — acepta rango válido, rechaza formato (`2026-13-40`, `not-a-date`), rechaza `from > to`, rechaza >366 días (366 ok / 367 err); verificar que fallan sin la fn. <!-- sdd-owner: implementation -->
- [x] 1.2 RED: agregar test SQL-string `logs_range_sql_filtra_por_usuario_y_rango_y_ordena` en `backend/src/routes/habits.rs` — asserts contiene `user_id = $1`, `log_date >= $2`, `log_date <= $3`, `ORDER BY habit_id`, y NO contiene `SELECT *` ni `HabitRow`; verificar que falla. <!-- sdd-owner: implementation -->

### S1 — GREEN (implementación mínima)

- [x] 1.3 GREEN: implementar `pub fn parse_logs_range(from: &str, to: &str) -> Result<(NaiveDate, NaiveDate), HabitApiError>` en `backend/src/routes/habits.rs` (`%Y-%m-%d`, `from_after_to` → 422, `(to-from).num_days() > 365` → 422 `range_too_wide`), sin I/O ni `PgPool`. <!-- sdd-owner: implementation -->
- [x] 1.4 GREEN: agregar `LOGS_RANGE_SQL` dedicada en `backend/src/routes/habits.rs` (`SELECT habit_id, log_date, status::text FROM habit_logs WHERE user_id = $1 AND log_date >= $2 AND log_date <= $3 ORDER BY habit_id ASC, log_date ASC`), struct `HabitLogsRangeQuery { from, to }` con `deny_unknown_fields`, handler `GET /habits/logs` + wiring en `backend/src/main.rs` antes de `/:id`; `cargo test -p backend habits` verde. <!-- sdd-owner: implementation -->

### S1 — TRIANGULATE + REFACTOR + verify

- [x] 1.5 TRIANGULATE: agregar casos borde en `backend/src/routes/habits.rs` — rango de 1 día, año bisiesto, `unknown field` → 422, `status not_done` legacy se devuelve tal cual; test integración PG con skip-guard `DATABASE_URL` (seed 2 hábitos + logs dentro/fuera de rango + log de otro usuario → solo propios ordenados); `cargo clippy --all-targets --locked -- -D warnings` limpio. <!-- sdd-owner: implementation -->
- [x] 1.6 REFACTOR + verify: reutilizar `require_user_id` / mapeo de errores (`23503/23514/22P02 → 422`) existentes sin duplicar; correr `EXPLAIN SELECT ... WHERE user_id=$1 AND log_date BETWEEN $2 AND $3` y confirmar `Index Scan using idx_habit_logs_user_date`; verificar `cargo test` (skips offline documentados) y que `HabitRow` no cambia; rollback = revert commit (sin migración). <!-- sdd-owner: implementation -->

### S1 — Gate (post-apply)

- [ ] 1.7 Start o reuse bounded review JD 2 jueces ciegos sobre PR1 antes de merge (contrato HTTP, 401/404/422, cap 366, orden, EXPLAIN, ≤400 líneas). <!-- sdd-owner: parent -->

## Slice S2 — Historial-FE calendario + heatmap real + stats + evolución + comparar (base: S1)

Objetivo: fetcher rango + transforms puros + calendario 4-estados + heatmap real (elimina falso) + evolución S/M/A + comparar + i18n ES. Si excede 400 líneas, partir S2a (transforms+fetcher) / S2b (UI).

### S2 — RED

- [x] 2.1 RED: crear `frontend/lib/productivity/habitStats.test.ts` (vitest) — `habitStats` puente `skipped`, corte en `missed`/`not_done`, `complianceRate` excluye `skipped`, denominador 0 → 0, máscara `days_of_week` (0=Sun..6=Sat) excluye días, `not_done` cuenta como no-cumplido; mejor-racha 3 vs actual 2 con `[done×3, missed, done×2]`; verificar que fallan sin `habitStats.ts`. <!-- sdd-owner: implementation -->
- [x] 2.2 RED: agregar tests de calendario/heatmap en `frontend/lib/productivity/habitStats.test.ts` o `frontend/components/ui/HabitsHeatmap.test.tsx` — 4 estados (done→cumplido, missed+not_done→no-cumplido, skipped→omitido, ausente→sin-registro), `logsToCalendarCells(logs, habitId, monthKey)` 42 celdas, heatmap deriva de logs reales nunca de racha; verificar fallo. <!-- sdd-owner: implementation -->

### S2 — GREEN

- [x] 2.3 GREEN: implementar `frontend/lib/productivity/habitStats.ts` — tipos `HabitLogEntry/HabitStats/CalendarCell`, `habitStats(logs, from, to, daysOfWeek?)`, `complianceRate(done, denom)`, `logsToCalendarCells(logs, habitId, monthKey)`; frontera pura estilo `lib/dashboard/transforms.ts`, copy sin culpa; `pnpm --dir frontend vitest run habitStats` verde. <!-- sdd-owner: implementation -->
- [x] 2.4 GREEN: agregar fetcher en `frontend/lib/api/productivity.ts` — `HabitLogWire`, `HABITS_HISTORY_KEY="habits-history"`, `habitsHistoryKey(from,to)`, `useHabitsHistory(from,to)` (null-key si rango inválido, `revalidateOnFocus:false`, bearer + single-flight 401 vía `apiGet`); documentar en `frontend/lib/dashboard/dashboard.ts` que no se duplica el hook; claves i18n `habits.history.*`, `habits.stats.*`, `habits.compare.*` en `frontend/lib/i18n.ts` (tipado, cero literales). <!-- sdd-owner: implementation -->
- [x] 2.5 GREEN: llenar slot `#calendario-habitos` en `frontend/components/containers/ProductivityScreens.tsx` con `<HabitHistorySection>` (selector por nombre, sin UUID visible, calendario mensual grid 7 col, stats base, evolución S/M/A + comparar multi-serie máx 4 con Recharts `next/dynamic(ssr:false)`, `isAnimationActive` respeta `prefers-reduced-motion`); extender `frontend/components/ui/HabitsHeatmap.tsx` a celdas reales y **eliminar `heatmapCells` falso** actualizando `productivity.test.ts`; `EmptyState` ES + retry por widget, tokens `--color-*`, foco visible + `aria-label` ES. <!-- sdd-owner: implementation -->

> **Partición S2a/S2b (budget 400):** S2a entregado (transforms + fetcher + i18n + tests puros, ~300 líneas). S2b pendiente: 2.5 UI (`HabitHistorySection`, calendario real en slot, evolución/comparar Recharts, eliminar `heatmapCells` falso), 2.6 triangulación UI + suite verde, 2.7 refactor final. 2.5–2.7 quedan `[ ]` para S2b.

### S2 — TRIANGULATE + REFACTOR + verify

- [x] 2.6 TRIANGULATE: casos adicionales vitest — mes vacío → `EmptyState`, rango anual grande, comparar 2 hábitos por nombre, evolución semana/mes/año agrega sin errores; verificar `tsc --noEmit` y `pnpm --dir frontend test` verdes. <!-- sdd-owner: implementation -->
- [x] 2.7 REFACTOR + verify: extraer helpers de agregación S/M/A sin duplicar lógica de racha; confirmar no queda referencia a `heatmapCells` falso (`grep`), charts con `ssr:false`, `revalidateOnFocus:false`, rollback = revert + restaura `heatmapCells` desde git solo si S2 no está verde. <!-- sdd-owner: implementation -->

### S2 — Gate (post-apply)

- [ ] 2.8 Start o reuse bounded review JD 2 jueces ciegos sobre PR2 antes de merge (4-estados, heatmap real, stats, evolución/comparar, i18n ES, ≤400 líneas o partición S2a/S2b). <!-- sdd-owner: parent -->

## Slice S3 — Reportes `/reportes` solo-pantalla (base: S2)

Objetivo: ruta + `PeriodSelector` + 4 bloques FE-only (finanzas/hábitos/metas/actividad), sin PDF/Excel, sin endpoints nuevos.

### S3 — RED

- [x] 3.1 RED: crear `frontend/components/containers/ReportsScreens.test.tsx` (vitest) — período `2026-09` propaga `2026-09-01..30` a los 4 bloques, custom `from/to` exacto, custom inválido bloquea agregados sin romper (precedente `finance.test.tsx:630`), `by-category` caído aísla error solo en bloque finanzas, no existe botón/link/ruta PDF-Excel; verificar que fallan. <!-- sdd-owner: implementation -->

### S3 — GREEN

- [x] 3.2 GREEN: crear ruta `frontend/app/dashboard/reportes/page.tsx` (shell + redirect login, copia `productivity/page.tsx`) + `frontend/components/containers/ReportsScreens.tsx` reutilizando `frontend/components/finance/PeriodSelector.tsx` (semana/mes/año + custom); 4 bloques en paralelo (`Promise.all`): finanzas (`monthly-flow` + `by-category`, `toNumber` en boundary + `formatMoney` es-CO/COP), hábitos (`useHabitsHistory` + `habitStats`), metas (`GET /goals` progress solo lectura), actividad (`tasks?view=done` filtro cliente `completed_at` + `GET /events?from&to`); `EmptyState` + retry por bloque, i18n ES tipado. <!-- sdd-owner: implementation -->

### S3 — TRIANGULATE + REFACTOR + verify

- [x] 3.3 TRIANGULATE + REFACTOR: loading/error/empty independientes por bloque, error panel ES con retry que revalida solo sus keys (`reports-*` o existentes, `revalidateOnFocus:false`); charts `next/dynamic(ssr:false)`, tokens `--color-*`, `prefers-reduced-motion`, foco visible; `pnpm --dir frontend vitest run ReportsScreens`, `tsc --noEmit` y `pnpm --dir frontend test` verdes; rollback = revert (ruta nueva, sin flags). <!-- sdd-owner: implementation -->

### S3 — Gate (post-apply)

- [ ] 3.4 Start o reuse bounded review JD 2 jueces ciegos sobre PR3 antes de merge (4 bloques, período único, cero endpoints nuevos, sin PDF/Excel, ≤400 líneas). <!-- sdd-owner: parent -->

## Slice S4 — Progreso `/progreso` + score visual (base: S3)

Objetivo: dashboard combinado + `scoreByArea` puro + disclaimer fijo siempre visible, FE-only, sin escribir valuaciones.

### S4 — RED

- [x] 4.1 RED: crear `frontend/lib/productivity/scoreByArea.test.ts` + `frontend/components/containers/ProgressScreens.test.tsx` (vitest) — `scoreByArea({finance,habits,goals,productivity})` 4 indicadores etiquetados, área sin datos → visual neutro nunca fabricado, disclaimer `progress.score.disclaimer` visible en estados poblado y vacío, patrimonio sin ningún control de escritura; verificar que fallan. <!-- sdd-owner: implementation -->

### S4 — GREEN

- [x] 4.2 GREEN: implementar `scoreByArea` puro junto a `frontend/lib/productivity/habitStats.ts` (inputs 0–100 ya normalizados, pesos documentados, solo visual barras/LED sin "nota única"); crear `frontend/app/dashboard/progreso/page.tsx` + `frontend/components/containers/ProgressScreens.tsx` combinando `monthly-flow` (ahorro+gastos), patrimonio número solo lectura, `goals`+savings-goals, hábitos (cumplimiento global, mejores rachas, pendientes `today_status=pending`, evolución semanal vía transforms S2), productividad (completadas, metas avanzadas, próximos 14d vía `toUpcomingEvents`); disclaimer fijo siempre visible + copy ES sin culpa, i18n tipado. <!-- sdd-owner: implementation -->

### S4 — TRIANGULATE + REFACTOR + verify

- [x] 4.3 TRIANGULATE + REFACTOR: per-section loading/error/empty ES + retry, `formatMoney` es-CO/COP con coerción solo en boundary, `--color-*` sin hex, `prefers-reduced-motion`, foco visible, charts `next/dynamic(ssr:false)`, bearer single-flight 401; `pnpm --dir frontend vitest run scoreByArea ProgressScreens`, `tsc --noEmit` y `pnpm --dir frontend test` verdes; confirmar valuaciones intactas (INSERT-only) y rollback = revert (ruta nueva). <!-- sdd-owner: implementation -->

### S4 — Gate (post-apply)

- [ ] 4.4 Start o reuse bounded review JD 2 jueces ciegos sobre PR4 antes de merge (combinado 5 áreas, score solo visual, disclaimer fijo, contratos heredados, ≤400 líneas). <!-- sdd-owner: parent -->

## Verificación global (post-cadena)

- [x] 5.1 Verificar cadena completa S1→S4: `cargo test` backend, `pnpm --dir frontend test` + `tsc --noEmit`, ancla `#calendario-habitos` resuelve, `/reportes` y `/progreso` renderizan ES sin literales, `grep -r "heatmapCells" frontend/lib` vacío, `grep -ri "pdf\|excel\|xlsx" frontend/app/dashboard/reportes` vacío. <!-- sdd-owner: implementation -->
- [ ] 5.2 Start o reuse bounded review JD final de cadena (2 jueces, stacked-to-main S1→S2→S3→S4, cada PR ≤400 líneas o `size:exception` justificado en una sola pasada honesta). <!-- sdd-owner: parent -->
