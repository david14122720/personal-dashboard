# Tasks — 2026-10-03-finance-ui-fixes

- change: `2026-10-03-finance-ui-fixes`
- phase: tasks
- date: 2026-10-03
- artifact_store: `both` (this file is authoritative; Engram mirror `sdd/2026-10-03-finance-ui-fixes/tasks`)
- delivery_strategy: `none` — **owner decision: no commit, no push, no deploy**; local-only review, delta preserved as a patch with sha256
- review_budget: 400 changed lines (`additions + deletions`) — forecast below exceeds it, so if the owner later authorizes delivery the change MUST be split into two review slices (W1+W2 / W3+W4)
- strict_tdd: `false` (`openspec/config.yaml`); every work unit still requires its focused test evidence plus the full-suite gate
- status: `done` (`verify-report.md`)
- Binding order: **W1 → W2 → W3 → W4** (each independent, sequential writes; W4 consumes W3's components)

## Inputs read

`explore.md`, `proposal.md`, `design.md`, delta specs under `specs/{finance-accounts,finance-movements,frontend-dashboard}/spec.md`, `openspec/config.yaml`, the canonical specs `frontend-dashboard`/`finance-movements`/`finance-accounts`/`frontend-i18n`, and direct inspection of the files listed in `design.md` §inputs.

## Review Workload Forecast

| Work unit | Est. changed lines | Surfaces | Budget risk |
|---|---|---|---|
| W1 — Cuentas sin redundancia | ~90 add / ~130 del | 2 components + 2 tests | Low (deletion-dominant) |
| W2 — Paginación de movimientos | ~70 add / ~20 del | 1 component + 1 test + i18n | Low |
| W3 — Núcleo de tendencia | ~300 add | 1 helper + 2 new components + 3 tests + i18n | Medium |
| W4 — Wire-up + baja de `CategoryBars` | ~150 add / ~120 del | 2 components + 2 tests + i18n | Medium |
| **Total** | **~610 add / ~270 del** | | Over the 400 budget → 2 slices if delivered |

## Work units

### W1 — Cuentas: una sola representación, con tipo

- [x] W1.1 — `FinanceScreens.tsx`: quitar el render de `AccountsList` y el contenedor `mt-4 … border-t …` del `SectionShell` de Cuentas; dejar sólo el `map` de `AccountBalanceEdit`.
- [x] W1.2 — `FinanceScreens.tsx`: `AccountBalanceEdit` muestra la etiqueta de tipo junto al nombre (valor crudo, `aria-label` desde `finance.accountTypeLabel`), sin tocar la interacción de edición de saldo.
- [x] W1.3 — `FinanceSections.tsx`: eliminar `AccountsList` y, tras grep de referencias, los helpers que queden muertos (`LedDot`, `ProgressBar`); no tocar `toAccountCards` si conserva consumidores.
- [x] W1.4 — Reescribir las aserciones de doble render: `finance.test.tsx` (LED, progressbar de uso, "Visa" ×2) y `s1-capture.test.tsx` si el tipo perturbó algún selector; conservar verdes las de edición de saldo.
- [x] W1.5 — Evidencia: `pnpm test components/finance/finance.test.tsx components/finance/s1-capture.test.tsx` + `tsc --noEmit`, más grep que pruebe que no quedan referencias a `AccountsList`.
- **Allowed edit surfaces**: `frontend/components/containers/FinanceScreens.tsx`, `frontend/components/finance/FinanceSections.tsx`, `frontend/components/finance/finance.test.tsx`, `frontend/components/finance/s1-capture.test.tsx`, `frontend/lib/i18n/es.ts`

### W2 — Movimientos: 5 + 10 acumulativo con reset por filtro

- [x] W2.1 — `MovementHistory.tsx`: reemplazar `HISTORY_LIMIT = 50` por `INITIAL_VISIBLE = 5` + `PAGE_STEP = 10` y un estado `visibleCount`; `visible` sale del array **filtrado** (`slice(0, visibleCount)`), no del crudo.
- [x] W2.2 — Reset explícito: `useEffect` sobre `[activeAccountId, categoryId, direction]` que devuelve `visibleCount` a `INITIAL_VISIBLE` (cubre el filtro que vive en el padre).
- [x] W2.3 — Botón "Ver más" (`finance.movementShowMore`) al final de la lista, `+= PAGE_STEP`, oculto cuando `filtered.length <= visibleCount`; ≥44×44, foco visible, estilo de los botones existentes.
- [x] W2.4 — Tests: ventana inicial de 5 con 34 fixtures; 5→15→agotar (23) y botón ausente; 3 fixtures sin botón; cambio de filtro vuelve a 5 sin alterar el filtro; filtros y mutaciones existentes siguen verdes.
- [x] W2.5 — Evidencia: `pnpm test components/finance/MovementHistory.test.tsx`.
- **Allowed edit surfaces**: `frontend/components/finance/MovementHistory.tsx`, `frontend/components/finance/MovementHistory.test.tsx`, `frontend/lib/i18n/es.ts`

### W3 — Núcleo de tendencia (helper + selector + gráfica)

- [x] W3.1 — `lib/finance/finance.ts`: `TrendPeriod`, `TREND_PERIODS`, `TREND_BUCKETS = {day:14, week:8, month:12, year:5}`, `trendBuckets(period, now?, buckets?)` (claves `YYYY-MM-DD`/`YYYY-Www`/`YYYY-MM`/`YYYY` + etiqueta corta es-CO + `from`/`to` como `YYYY-MM-DD`, semana desde lunes, última unidad = en curso) y `toCategoryTrend(...)` (moneda única, sin neteo, N buckets siempre, ceros incluidos).
- [x] W3.2 — Tests del helper: conteo y orden por periodo; fronteras exactas de día/semana/mes/año; bucket vacío en 0; gasto e ingreso separados en el mismo bucket; exclusión de moneda extranjera; `now` inyectado para determinismo (sin depender del reloj real).
- [x] W3.3 — Componente nuevo `TrendPeriodSelector.tsx` (fieldset + 4 radio-pills Día/Semana/Mes/Año, ≥44px, foco visible, claves `finance.trendPeriod*`) sin tocar `PeriodSelector.tsx`.
- [x] W3.4 — Componente nuevo `CategoryTrendChart.tsx` (recharts `LineChart` 560×260, `role="img"` + `aria-label`, `chartTick()`/`chartTooltipStyle()`/`EVOLUTION_SERIES_TOKENS`, `dot={false}`, eje Y compacto, tooltip `formatMoney`, `Legend` con más de una serie, `dashed` por serie, `EmptyState` sin datos).
- [x] W3.5 — Tests de componentes: el selector emite el periodo y marca el activo; la gráfica pinta una línea por serie (o su leyenda) y no revienta con datos vacíos.
- [x] W3.6 — Evidencia: `pnpm test lib/finance/finance.test.ts components/finance/TrendPeriodSelector.test.tsx components/finance/CategoryTrendChart.test.tsx` + `tsc --noEmit`.
- **Allowed edit surfaces**: `frontend/lib/finance/finance.ts`, `frontend/lib/finance/finance.test.ts`, `frontend/components/finance/TrendPeriodSelector.tsx`, `frontend/components/finance/TrendPeriodSelector.test.tsx`, `frontend/components/finance/CategoryTrendChart.tsx`, `frontend/components/finance/CategoryTrendChart.test.tsx`, `frontend/lib/i18n/es.ts`

### W4 — Wire-up de la sección y de Comparar, baja de `CategoryBars`

- [x] W4.1 — `CategoryCharts.tsx`: `CategoryChartSection` suma estado `period` (default `month`), renderiza `TrendPeriodSelector` + `CategoryTrendChart` con series Gastos/Ingresos, conserva el selector de categoría, el `EmptyState` sin categoría, la nota `finance.trendNoDataInRange` cuando todo es 0 y el botón "Comparar categorías".
- [x] W4.2 — Borrar `CategoryBars` y las claves i18n que queden sin consumidor (`finance.chartExpenses`/`chartIncome` se conservan: las series las usan).
- [x] W4.3 — `compare/page.tsx`: estado `period`, dos `toCategoryTrend` mergeados por índice de bucket en 4 series (`a_expense`, `a_income`, `b_expense`, `b_income`), una sola gráfica con categoría A sólida y B punteada, conservando los dos selects y `compare.sameHint`.
- [x] W4.4 — Reescribir `CategoryCharts.test.tsx` (fuera de las aserciones de progressbar) y `compare/page.test.tsx:85-131` (progressbar `aria-valuenow` → líneas/leyenda), agregando el caso de cambio de periodo.
- [x] W4.5 — Evidencia: `pnpm test components/finance/CategoryCharts.test.tsx app/dashboard/finance/compare/page.test.tsx` + grep de `CategoryBars` sin referencias.
- **Allowed edit surfaces**: `frontend/components/finance/CategoryCharts.tsx`, `frontend/components/finance/CategoryCharts.test.tsx`, `frontend/app/dashboard/finance/compare/page.tsx`, `frontend/app/dashboard/finance/compare/page.test.tsx`, `frontend/lib/i18n/es.ts`

## Close (parent-owned, not delegated)

- [x] C1 — Suite completa: `pnpm test` + `node node_modules/typescript/bin/tsc --noEmit` + `pnpm build`.
- [x] C2 — Verificación visual Playwright en local contra la DB de prod (usuario efímero, borrado al cierre) en 1440/768/390, con captura de `console`/`pageerror`: Cuentas sin redundancia, Movimientos 5→+10 sin romper filtros, gráfica con los 4 periodos, Comparar con 4 líneas.
- [x] C3 — Escribir `verify-report.md` con evidencia y desvíos; preservar el delta como patch `odd/tasks/finance-ui-fixes-delta.patch` + sha256; cerrar `odd/tasks/finance-ui-fixes.md`.
- [x] C4 — Reportar al dueño: valores de N usados (14/8/12/5), claves i18n nuevas, superficies tocadas, información perdida (LED de alerta y uso de tarjeta) y follow-ups (etiqueta de tipo cruda en inglés, paginación backend si el histórico crece, vista `compare` sin cobertura e2e).
