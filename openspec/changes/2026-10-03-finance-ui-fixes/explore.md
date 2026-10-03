# Explore — 2026-10-03-finance-ui-fixes

- change: `2026-10-03-finance-ui-fixes`
- phase: explore
- date: 2026-10-03
- artifact_store: `both` (openspec + engram, topic `sdd/2026-10-03-finance-ui-fixes/explore`)
- scope: frontend-only (Next.js App Router static export + Tailwind; `frontend/`)
- explorer: `gentle-ai-explore` (read-only), harness ran the SDD phases in the parent (SDD delegation is retired in this runtime)

## Request original (ES, condensed)

1. Cuentas: quitar la redundancia (hoy cada cuenta se dibuja como tarjeta **y** como fila con saldo + "Editar saldo"). Dejar solo la lista inferior y conservar la etiqueta del tipo (`bank`, `cash`, `digital_wallet`) junto al nombre.
2. Movimientos: paginar la vista — 5 visibles primero, botón "Ver más" que **suma** 10 cada vez hasta agotar; al cambiar un filtro (Cuenta, Categoría, Tipo) la lista vuelve a 5. Los filtros no se tocan.
3. Gastos e ingresos por categoría: reemplazar la barra por una **gráfica de líneas** con series Gastos/Ingresos + 4 botones de periodo **Día/Semana/Mes/Año**; cada punto = total agregado de una unidad de tiempo, N puntos consecutivos como tendencia. El selector de categoría queda igual.
4. Comparar categorías (vista aparte): mismo tratamiento de periodo y gráfica de líneas con gasto e ingreso de las dos categorías (4 líneas).

Constraints: no romper nada no mencionado; sin dependencias nuevas; **sin commit/push/deploy** (decisión del dueño: todo local, delta como patch de respaldo).

## Findings with evidence

### A. Cuentas — doble render confirmado

- Tarjetas: `frontend/components/finance/FinanceSections.tsx:63-106` (`AccountsList`), cuerpo `:109-148`. Renderiza `account.name` `:116`, **`account.type` crudo** `:117`, saldo `:119-121`, LED `:112` (`LedDot` `:37-46`), uso de tarjeta `:124-144` (`ProgressBar` `:48-61`).
- Filas con "Editar saldo": `frontend/components/containers/FinanceScreens.tsx:78-190` (`AccountBalanceEdit`); vista no-edición `:122-145` (nombre `:125`, saldo `:126`, botón `:133-143`). **No muestra el tipo.**
- Ambos renders: `FinanceScreens.tsx:284-289` (tarjetas) y `:291-294` (filas). La segunda está envuelta en `mt-4 flex flex-col gap-2 border-t border-hull pt-4` (`:290`).
- Datos: `toAccountCards(accounts.data)` `FinanceScreens.tsx:241`; `useAccounts` `frontend/lib/api/dashboard.ts:103-109` (key `dashboard/accounts`).
- Enum de tipos: `backend/migrations/0001_init_auth_and_categories.sql:16-17`. Se renderiza **crudo**, sin mapa i18n.
- `AccountsList` es el único consumidor externo de sí mismo (`FinanceScreens.tsx:8,284`): al quitarlo queda muerto con `LedDot`/`ProgressBar` de `FinanceSections.tsx`.
- Tests que asertan el render duplicado: `frontend/components/finance/finance.test.tsx:129-132` (LED), `:134-142` (progressbar de uso + "Visa" duplicada), `:179-182` ("Editar saldo"); `frontend/components/finance/s1-capture.test.tsx:175-235`; `frontend/e2e/sections.spec.ts:51,61`.

### B. Movimientos — todo client-side

- `frontend/components/finance/MovementHistory.tsx`: `HISTORY_LIMIT = 50` `:27`, `wires.slice(0, HISTORY_LIMIT)` `:55`, filtros `:56-62`, `hasFilters` `:63`, `clearFilters` `:65-69`.
- Los tres filtros son estado de React, sin query params: cuenta `:124-136` (el `<select>` llama `onSelectAccount`, el estado vive en el padre), categoría `:138-150`, tipo `:152-166`. El filtro de cuenta **sigue funcionando sin tarjetas** porque el select propio lo escribe.
- Fetch: `useMovements()` `MovementHistory.tsx:47` → `frontend/lib/api/finance.ts:142-148` (SWR `finance/movements`, `apiGet("/movements")`). Sin parámetros.
- Filas: `ul` `:197-268`; cada `<li>` `:203-264` con `content-visibility: auto` `:206`; `EmptyState` `:191-194`; sin contador de resultados.
- **No existe ningún patrón "load more"/acumulativo en el frontend** (`MovementsSnapshot.tsx:53`, `UpcomingSubs.tsx:44` y este archivo sólo hacen slices fijos). Se implementa de cero.

### C. Contrato de la API — devuelve TODO, sin paginación

- `backend/src/routes/movements.rs:296-312` (`list_movements_handler`): extractores `State`/`HeaderMap` `:296-299`; **sin `Query`**, sin `limit`/`offset`/`page`/`cursor`.
- SQL `:59`: `WHERE user_id=$1 ORDER BY occurred_on DESC, created_at DESC, id DESC`, `fetch_all` `:303`; sin tope.
- DTO `MovementResponse` `:117-133`: `id`, `direction`, `amount` (Decimal→string), `occurred_on` (`YYYY-MM-DD`), `description`, `account_id`, `category_id: Option`, `subscription_id`, `created_at`, `updated_at`. Espejo FE `frontend/lib/api/finance.ts:104-116`.
- **Consecuencia de diseño**: la paginación pedida es de presentación; no hace falta tocar backend (ver design D1).

### D. Gráfica de categoría hoy

- `frontend/components/finance/CategoryCharts.tsx:77-141` (`CategoryChartSection`); barras `CategoryBars` `:21-67` con `role="progressbar"` `:52-62`; render `:128`; estados vacíos `:124,126`; totales `:92-98` desde `useMovements()` `:87` + `useAccounts()` `:88`.
- Helper `frontend/lib/finance/finance.ts:311-329` `toCategoryMovementTotals(movements, currencyByAccountId, userCurrency, categoryId) → {expense, income}`: filtra por categoría y **por cuenta de la misma moneda**, nunca netea, e **ignora las fechas** (agrega todo el histórico).
- El payload ya trae ambas direcciones (`finance.test.tsx:89-118`: m1 gasto, m2 ingreso, misma categoría) → **la gráfica de dos series no necesita endpoint nuevo**.

### E. Vista Comparar

- `frontend/app/dashboard/finance/compare/page.tsx:25-145`: estado `first`/`second` `:28-29`; `useCategories` `:38`, `useMovements` `:39`, `useAccounts` `:40`; opciones `:50-53`; `totalsA/B` `:57-62`; selects `:72-104`; dos bloques `CategoryBars` `:117-125,130-138`; sin `PeriodSelector`; ruta fuera del nav (comentario `:19-23`).
- Sólo test unitario `frontend/app/dashboard/finance/compare/page.test.tsx:85-131` (aserta `aria-valuenow` de progressbar); sin cobertura e2e.

### F. Capacidad de gráficas — recharts ya está

- `recharts ^3.10.1` en `frontend/package.json:14`: **única dependencia de charts, ya instalada** → cero dependencias nuevas.
- Plantilla multi-serie: `frontend/components/ui/HabitEvolutionChart.tsx:34-57` (`<Line>` por serie `:49-57`, `accessibilityLayer`, `role="img"`).
- Tema: `frontend/components/ui/chartTheme.ts:4-27` (`chartTok`, `chartTick`, `chartTooltipStyle`) y paleta `:30` `EVOLUTION_SERIES_TOKENS = ["--color-flow","--color-signal","--color-alert","--color-violet"]` (**exactamente 4 tokens**, justo lo que pide el punto 4).
- `frontend/components/ui/FlowChart.tsx:34-79` (AreaChart 2 series) sólo lo usa `charts.test.tsx:4`: no es dependencia de producto, pero sirve de referencia de tooltip/formato.

### G. Periodo — semántica distinta, no se reutiliza tal cual

- `frontend/lib/finance/finance.ts:167` `PeriodKind = "week"|"month"|"quarter"|"year"|"custom"`; `:168-172` `PeriodSel`; `:191-238` `toPeriodRange(sel, now) → {from,to}`. Es **rango**, no buckets.
- `frontend/components/finance/PeriodSelector.tsx:14-110` (5 radio-pills + 2 date inputs); su único uso es `frontend/components/containers/ReportsScreens.tsx:295` y tiene test propio `PeriodSelector.test.tsx:5-24`. **No se toca** (design D3).
- Bucketing existente sólo en productividad: `frontend/lib/productivity/habitStats.ts:16` (`EvolutionGranularity`), `:105-110` (`bucketFor`, semana = lunes), `:113-128` (`aggregateEvolution`). No hay helper de bucketing de finanzas: se escribe uno nuevo.
- Moneda/fechas: `frontend/lib/api/money.ts` (`formatMoney`).

### H. i18n

- `frontend/lib/i18n/es.ts`: `finance` `:100-214` (balance `:139-140`, chart `:162-166`, movimientos `:171-198`), `compare` `:747-754`, `charts` `:755-762`.
- `frontend/lib/i18n/index.ts:5` deriva `EsKey` de `typeof es`; `t` `:15-22`. **No hay test de completitud/cantidad de claves**: sólo `i18n.test.ts:27-30` (clave desconocida) y aserciones de copy `:99-121`.

### I. Blast radius / inventario de tests

| Archivo | Qué se rompe |
|---|---|
| `frontend/components/finance/finance.test.tsx:129-142,158-177,179-182,195-209` | LED de tarjeta, progressbar de uso, doble "Visa" |
| `frontend/components/finance/MovementHistory.test.tsx:76-84` | "renders the latest 50 in API order" (60 fixtures → 50) |
| `frontend/components/finance/MovementHistory.test.tsx:86-149` | filtros y mutaciones (deben seguir verdes) |
| `frontend/components/finance/CategoryCharts.test.tsx:15-37,92-115` | `CategoryBars` progressbar |
| `frontend/app/dashboard/finance/compare/page.test.tsx:85-131` | progressbar `aria-valuenow` |
| `frontend/components/finance/s1-capture.test.tsx:175-235` | `AccountBalanceEdit` (debe seguir verde) |
| `frontend/components/finance/PeriodSelector.test.tsx:5-24` | intacto (no se toca el componente) |
| `frontend/e2e/sections.spec.ts:21-63` | regiones Movimientos/chart, "Editar saldo", ausencia de "Balance" |

Comandos: `frontend/package.json:8-12` → `pnpm test` (vitest run), `pnpm run test:e2e` (Playwright, requiere `E2E_SMOKE_LIVE=1` + backend vivo + `E2E_USER`/`E2E_PASSWORD`). No hay script de typecheck: el gate de tipos del repo es `pnpm build`; se usa además `node node_modules/typescript/bin/tsc --noEmit` (regla de la casa: `npx tsc` es señuelo).

## Reuse candidates

- `HabitEvolutionChart.tsx:34-57` + `EVOLUTION_SERIES_TOKENS` → plantilla directa de la gráfica de líneas 1..4 series.
- `chartTheme.ts:4-27` → estilos de ejes/tooltip sin hex duro.
- `habitStats.ts:105-110` → convención de semana que arranca lunes (se replica).
- `toCategoryMovementTotals` (`finance.ts:311-329`) → regla de moneda única y no-neteo (se replica en el helper de tendencia).

## Open decisions carried into design

1. **N por periodo** (`design D4`): 14 días / 8 semanas / 12 meses / 5 años — pendiente de confirmación del dueño al cierre (el pedido lo delega explícitamente).
2. **Destino de `CategoryBars`** (`design D6`): queda muerto al reemplazar ambas barras → se elimina con sus tests.
3. **Pérdida de información de las tarjetas** (`design D2`): además del tipo, las tarjetas mostraban el uso de tarjeta de crédito (`ProgressBar`); al eliminarlas esa vista desaparece (nadie la pidió conservar).

## Uncertainty

- Volumen real de movimientos en la DB de prod (el seed demo de 2026-10-03 tiene 34): la paginación client-side es correcta para este orden de magnitud; con miles de filas habría que paginar en backend.
- `codegraph watch` / frescura del índice no se verificó (no afectó las consultas).
