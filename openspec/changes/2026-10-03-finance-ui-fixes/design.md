# Design — 2026-10-03-finance-ui-fixes

- change: `2026-10-03-finance-ui-fixes`
- phase: design
- date: 2026-10-03
- artifact_store: `both`
- status: `ready_for_tasks`
- inputs read: `explore.md`, `proposal.md`, canonical specs `frontend-dashboard`, `finance-movements`, `finance-accounts`, `frontend-i18n`, plus direct inspection of `frontend/components/finance/{CategoryCharts,MovementHistory,FinanceSections}.tsx`, `frontend/components/containers/FinanceScreens.tsx`, `frontend/app/dashboard/finance/compare/page.tsx`, `frontend/components/ui/{HabitEvolutionChart,chartTheme}.tsx`, `frontend/lib/finance/finance.ts`, `frontend/lib/productivity/habitStats.ts`, `frontend/lib/i18n/es.ts`, `frontend/package.json`.

---

## 1. Executive summary

Cuatro cambios independientes entre sí, ordenados de menor a mayor riesgo: **W1 Cuentas** (borrado + traslado de una etiqueta), **W2 Movimientos** (estado de paginación + reset), **W3 núcleo de tendencia** (helper puro + 2 componentes nuevos), **W4 wire-up** (sección de categoría y vista Comparar, baja de `CategoryBars`). No hay trabajo de backend, ni migraciones, ni dependencias.

La única pieza con superficie propia es W3: un helper puro `toCategoryTrend` (N buckets con ceros), un componente presentacional `CategoryTrendChart` (1..4 series sobre `recharts`) y un selector `TrendPeriodSelector` (Día/Semana/Mes/Año). W4 sólo consume esas tres piezas.

---

## 2. Decisions

### D1 — La paginación es de presentación, no del contrato

`GET /api/movements` (`backend/src/routes/movements.rs:296-312`) no tiene `Query`, no acepta `limit`/`offset` y devuelve todas las filas del usuario ordenadas por `occurred_on DESC`. La spec canónica lo dice explícitamente (`finance-movements/spec.md:41`: *no pagination in v1*).

**Decisión:** la paginación pedida se implementa en el cliente sobre el array ya obtenido. Motivo: el pedido es sobre longitud de scroll, no sobre tamaño de payload; tocar el endpoint obliga a cambiar DTO/contrato, tests de integración Rust y posiblemente el MCP, para un beneficio nulo con el volumen real (decenas de movimientos). **Consecuencia declarada:** si el histórico llegara a miles de filas, la paginación tendría que migrar a keyset/offset en backend.

### D2 — Cuentas: una sola representación, el tipo se muda a la fila

- Se elimina el render `<AccountsList …/>` de `FinanceScreens.tsx:284-289` y el contenedor `mt-4 … border-t …` (`:290`) que existía sólo para separar tarjetas de lista.
- `AccountBalanceEdit` (`FinanceScreens.tsx:78-190`) pasa a ser la única representación: su fila de vista (`:122-145`) suma la etiqueta de tipo junto al nombre.
- La etiqueta se renderiza **cruda** (`account.type`), exactamente como la tarjeta hoy (`FinanceSections.tsx:117`) y como el enum del backend (`0001_init_auth_and_categories.sql:16-17`). No se inventa un mapa i18n nuevo: cambiar el valor mostrado sería un cambio de producto no pedido. *Reportar al cierre como follow-up opcional (los valores `digital_wallet`/`credit_card` se leen en inglés).*
- Se elimina `AccountsList` (`FinanceSections.tsx:63-148`) y, **sólo si el grep de referencias lo confirma muerto**, `LedDot` (`:37-46`) y `ProgressBar` (`:48-61`) de ese mismo archivo. `toAccountCards` se conserva si sigue teniendo consumidores (el worker lo verifica con grep antes de tocar).
- **Información que se pierde con las tarjetas:** el LED de alerta y el uso de tarjeta de crédito (`ProgressBar`). Nadie pidió conservarlos y la fila útil ya muestra saldo y edición; se reporta al cierre.
- El filtro de cuenta del historial **sigue funcionando**: su `<select>` (`MovementHistory.tsx:124-136`) escribe `activeAccountId` en el padre. Lo que desaparece es el atajo "click en la tarjeta" (y con él esa cláusula de la spec canónica, ver delta de `finance-movements`).

### D3 — Selector de periodo nuevo; el de Reportes no se toca

`PeriodSelector.tsx` modela **rangos** (`week|month|quarter|year|custom` + 2 date inputs) y su único consumidor es Reportes (`ReportsScreens.tsx:295`), con test propio. El pedido necesita **buckets** (`Día|Semana|Mes|Año` → N puntos). Son semánticas distintas.

**Decisión:** componente nuevo `frontend/components/finance/TrendPeriodSelector.tsx`, cuatro radio-pills accesibles (`fieldset`/`legend`, `name="trend-period"`, hit area ≥44px), sin date inputs. `PeriodSelector.tsx` y su test quedan intactos.

### D4 — N por periodo (valores por defecto, ajustables por el dueño)

| Periodo | N | Unidad | Etiqueta de punto |
|---|---|---|---|
| Día | **14** | día calendario | `3 oct` |
| Semana | **8** | semana que **arranca lunes** (convención de `habitStats.ts:105-110`) | `sem 28 sep` |
| Mes | **12** | mes calendario | `oct 26` |
| Año | **5** | año calendario | `2026` |

Reglas del eje temporal, todas verificables en tests:

- El último bucket es la **unidad en curso** (incluye hoy); los N−1 anteriores son consecutivos hacia atrás.
- Los buckets se emiten **de más viejo a más nuevo**.
- Un bucket **sin movimientos vale 0** (la tendencia no debe tener huecos).
- Fronteras por **fecha local del navegador** (`occurred_on` es `YYYY-MM-DD` NaiveDate): se compara por string `YYYY-MM-DD` contra el `from`/`to` de cada bucket, sin `Date`-parsing del wire ni zonas horarias.
- El filtro de moneda se hereda de `toCategoryMovementTotals`: sólo participan movimientos cuya cuenta está en la moneda del usuario; nunca se convierte ni se netea.

N elegido para legibilidad: 14 puntos en un ancho de 560px dan ~40px por punto (un tick de cada 2); 8 y 12 entran con etiqueta rotada a 0°; 5 años es el mínimo con tendencia visible. Todos quedan expuestos en una constante única `TREND_BUCKETS` para que el dueño los cambie en un solo lugar.

### D5 — Gráfica: `recharts` con 1..4 series, cero dependencias nuevas

- `recharts ^3.10.1` ya está en `frontend/package.json:14`.
- Nuevo `frontend/components/finance/CategoryTrendChart.tsx`, presentacional, calcado de `HabitEvolutionChart.tsx:34-57`: `LineChart` de 560×260 dentro de un contenedor `overflow-x-auto` con `role="img"` y `aria-label`, `CartesianGrid` con `--color-hull`, `XAxis`/`YAxis` con `chartTick()`, `Tooltip` con `chartTooltipStyle()`, `dot={false}`, `type="monotone"`.
- API: `data: TrendRow[]`, `series: { key, label, token, dashed? }[]` (máximo 4). El componente no calcula nada: recibe filas ya armadas.
- **Eje Y**: `tickFormatter` con `Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 })` (con COP en millones, el número completo no entra).
- **Tooltip**: `formatMoney` completo por serie.
- **Leyenda**: `<Legend />` de `recharts` con `wrapperStyle` en `chartTick()`; con 3-4 líneas es necesaria para saber qué es cada color.
- **Paleta**: los 4 tokens existentes `EVOLUTION_SERIES_TOKENS` (`chartTheme.ts:30`) — alcanzan exactamente para las 4 series de Comparar.
- **Agrupamiento visual en Comparar**: categoría A **sólida**, categoría B **punteada** (`strokeDasharray="5 3"`), y cada serie se llama `Gastos · <cat>` / `Ingresos · <cat>`. Además de color, la forma distingue la categoría (no depende de percibir color).
- Estados: sin categoría seleccionada → `EmptyState` actual; categoría seleccionada con todos los buckets en 0 → se dibuja la gráfica (línea plana en 0, prueba que el periodo funciona) con una nota `finance.trendNoDataInRange`, porque un `EmptyState` haría pensar que el filtro de periodo está roto.

### D6 — `CategoryBars` se elimina

Al reemplazar la barra en la sección de categoría y en Comparar, `CategoryBars` (`CategoryCharts.tsx:21-67`) queda sin consumidores. **Decisión:** se borra junto con sus tests (`CategoryCharts.test.tsx:15-37`) y con las claves i18n que queden huérfanas (`frontend-i18n` "Removed Feature Key Hygiene" exige que el borrado de una visual arrastre sus claves). Las claves `finance.chartExpenses`/`finance.chartIncome` **se conservan** porque las series de la gráfica las siguen usando.

### D7 — i18n

Claves nuevas tipadas (`frontend/lib/i18n/es.ts`, namespace `finance.*` salvo donde se indique):

| Clave | Copy ES |
|---|---|
| `finance.movementShowMore` | `Ver más` |
| `finance.trendPeriodLabel` | `Periodo` |
| `finance.trendPeriodDay` / `Week` / `Month` / `Year` | `Día` / `Semana` / `Mes` / `Año` |
| `finance.trendNoDataInRange` | `Sin movimientos en este periodo` |
| `finance.trendExpensesOf` / `finance.trendIncomeOf` | `Gastos · {name}` / `Ingresos · {name}` |
| `finance.accountTypeLabel` | `Tipo` (aria-label del chip de tipo) |

Sin claves huérfanas al final (verificación: grep de cada clave nueva y de las que quedan sin uso por la baja de `CategoryBars`). No hay test de completitud de claves en el repo (`i18n.test.ts` sólo prueba claves desconocidas y copy puntual), así que la verificación es `tsc` (el tipo `EsKey` se deriva de `typeof es`) + grep.

### D8 — Verificación

1. **Unit/componente**: `pnpm test` (vitest) en `frontend/` — incluye los tests nuevos del helper, del selector, de la gráfica y los reescritos de Cuentas/Movimientos/Comparar.
2. **Tipos**: `node node_modules/typescript/bin/tsc --noEmit` (regla de la casa: `npx tsc` es señuelo).
3. **Build**: `pnpm build` (el repo no tiene script de typecheck; el build estático es el gate real).
4. **En vivo (Playwright, skill `webapp-testing`)**: backend local con `DATABASE_URL` → **DB de producción** (`192.168.50.120:5434`, autorizada por el dueño) y `STATIC_DIR=frontend/out`; navegación a `/dashboard/finance/` y `/dashboard/finance/compare/`; capturas en 1440/768/390; **captura de `console` y `pageerror` en cada paso** (criterio: cero errores); verificación explícita de los 4 puntos (una sola fila por cuenta, "Ver más" 5→15→25…, 4 periodos, 4 líneas en Comparar).
5. Usuario de prueba: se crea uno efímero con `--create-user` y se borra al terminar (regla histórica del repo). **Nunca** correr suites de tests con `DATABASE_URL` apuntando a prod salvo lectura: los tests DB-gated borran usuarios.

---

## 3. Component / data design

### 3.1 Helper de tendencia (puro, en `frontend/lib/finance/finance.ts`)

```ts
export type TrendPeriod = "day" | "week" | "month" | "year";
export const TREND_PERIODS: readonly TrendPeriod[];          // orden de los botones
export const TREND_BUCKETS: Record<TrendPeriod, number>;     // 14 / 8 / 12 / 5

export interface TrendBucket {
  bucket: string;   // clave estable, ej. "2026-10-03" | "2026-W40" | "2026-10" | "2026"
  label: string;    // etiqueta corta es-CO para el eje X
  expense: number;
  income: number;
}

export function trendBuckets(period: TrendPeriod, now?: Date, buckets?: number)
  : { key: string; label: string; from: string; to: string }[];

export function toCategoryTrend(
  movements: MovementWire[] | undefined,
  opts: {
    categoryId: string;
    period: TrendPeriod;
    now?: Date;
    buckets?: number;
    currencyByAccountId: Map<string, string>;
    userCurrency: string;
  },
): TrendBucket[];
```

`toCategoryTrend` filtra por `category_id === categoryId`, por cuenta de la misma moneda y por `occurred_on` dentro de `[from, to]` de cada bucket; acumula `expense`/`income` por separado (nunca netea) y devuelve **siempre** N buckets.

### 3.2 `TrendPeriodSelector.tsx` (nuevo)

`{ value: TrendPeriod; onChange: (p: TrendPeriod) => void }`. `fieldset` + `legend` (`finance.trendPeriodLabel`), 4 `label`+`input[type=radio]` con el mismo tratamiento de pill que `PeriodSelector.tsx:8` (clase reutilizada literalmente: borde `hull`, `has-checked:border-signal`, foco visible, ≥44px).

### 3.3 `CategoryTrendChart.tsx` (nuevo)

```tsx
export interface TrendRow { bucket: string; label: string; [series: string]: string | number }
export interface TrendSeries { key: string; label: string; token: `--color-${string}`; dashed?: boolean }
export default function CategoryTrendChart({ data, series, locale, currency, emptyTitle, emptyHint, animate })
```
Sin lógica de negocio. `data.length === 0 || series.length === 0` → `EmptyState`.

### 3.4 `CategoryChartSection` (wire-up en `CategoryCharts.tsx`)

Estado: `selected` (categoría, ya existe) + `period: TrendPeriod` (default `"month"`). Filas: `toCategoryTrend(...)` para la categoría elegida. Series: `Gastos` (`--color-signal`) e `Ingresos` (`--color-flow`). Baja de `CategoryBars`. Selector de categoría intacto (`:110-121`).

### 3.5 Comparar (`compare/page.tsx`)

Estado: `first`, `second`, `period` (default `"month"`). Se calculan **dos** tendencias (`toCategoryTrend` por categoría) y se **mergean por índice de bucket** en filas con 4 claves (`a_expense`, `a_income`, `b_expense`, `b_income`). Una sola gráfica con 4 series; se conservan los dos `<select>` y el aviso `compare.sameHint` cuando las dos categorías son la misma. Los dos bloques `CategoryBars` (`:117-125,130-138`) se reemplazan por la gráfica compartida; los totales siguen disponibles en el tooltip.

---

## 4. Verification plan (por work unit)

| WU | Verificación focal | Gate |
|---|---|---|
| W1 Cuentas | `pnpm test components/finance/finance.test.tsx components/finance/s1-capture.test.tsx` | Una fila por cuenta con tipo + saldo + edición verde |
| W2 Movimientos | `pnpm test components/finance/MovementHistory.test.tsx` | 5 → +10 → agotar; reset por filtro |
| W3 Núcleo tendencia | `pnpm test lib/finance/finance.test.ts components/finance/CategoryTrendChart.test.tsx components/finance/TrendPeriodSelector.test.tsx` | Conteo/orden/buckets vacíos/fronteras |
| W4 Wire-up | `pnpm test components/finance/CategoryCharts.test.tsx app/dashboard/finance/compare/page.test.tsx` | 2 series y 4 series, 4 periodos |
| Cierre | `pnpm test` + `tsc --noEmit` + `pnpm build` + Playwright en vivo | Suite completa verde, bundle estático OK, cero errores de consola |
