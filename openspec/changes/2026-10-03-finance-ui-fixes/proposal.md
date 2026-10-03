# Proposal — 2026-10-03-finance-ui-fixes

- change: `2026-10-03-finance-ui-fixes`
- phase: propose
- date: 2026-10-03
- preflight: `execution: local-only` · `artifact_store: both` · `delivery_strategy: none` · `review_budget: 400`
- request original (ES): corregir Cuentas (quitar redundancia), paginar Movimientos, y mejorar la gráfica de Gastos e ingresos por categoría con selector de periodo (+ la misma mejora en la vista Comparar categorías)
- owner decision recorded this session: **sin commit, sin push, sin deploy**; todo se revisa en local y el delta se preserva como patch de respaldo

## status

`ready_for_spec` — exploración cerrada (`explore.md`), sin decisiones de producto bloqueantes. Las tres decisiones que el pedido delega al ejecutor (N por periodo, destino de la barra vieja, alcance del borrado de las tarjetas) quedan resueltas en `design.md` §D4/D6/D2 y se reportan al dueño al cierre.

## executive_summary

**Qué se hace.** Cuatro correcciones de UI en Finanzas, todas frontend, sin backend y sin dependencias nuevas:

1. **Cuentas sin redundancia** — hoy cada cuenta se dibuja dos veces (tarjeta en `FinanceSections.tsx:63-148` + fila con "Editar saldo" en `FinanceScreens.tsx:78-190`). Se elimina el bloque de tarjetas y queda una sola lista donde cada fila muestra nombre + **tipo** + saldo + "Editar saldo".
2. **Movimientos paginados** — la lista pasa de "todo de una" (`HISTORY_LIMIT = 50`, `MovementHistory.tsx:27,55`) a **5 visibles + "Ver más" que suma 10**. Los filtros Cuenta/Categoría/Tipo no cambian; cambiar cualquiera reinicia la paginación a 5.
3. **Gastos e ingresos por categoría** — la barra de progreso (`CategoryBars`) se reemplaza por una **gráfica de líneas** con series Gastos/Ingresos y un selector **Día/Semana/Mes/Año**; cada punto es el total agregado de una unidad de tiempo y la gráfica muestra N puntos consecutivos como tendencia.
4. **Comparar categorías** — la vista aparte recibe el mismo selector y una gráfica de **4 líneas** (gasto e ingreso de cada categoría), con el mismo estilo de tema.

**Por qué es coherente ahora.** El punto 3 y 4 ya tienen la materia prima en el cliente: `toCategoryMovementTotals` (`finance.ts:311-329`) probó que el payload de `GET /movements` trae ambas direcciones y que la regla de moneda única funciona; sólo falta agregar por tiempo y dibujar líneas. `recharts ^3.10.1` ya es dependencia (`frontend/package.json:14`) y `HabitEvolutionChart.tsx:34-57` es una plantilla multi-serie probada con exactamente la paleta de 4 tokens que necesita el punto 4 (`chartTheme.ts:30`).

**Lo que deliberadamente NO se toca.** El endpoint `GET /api/movements` (sigue devolviendo todas las filas; la paginación es de presentación, igual que el contrato canónico "no pagination in v1" de `finance-movements`), el `PeriodSelector` existente de Reportes (`PeriodSelector.tsx`, semántica de rango, no de buckets), los tres filtros de movimientos, el formulario de alta/edición/borrado de movimientos, y el resto de las secciones de Finanzas.

## 1. Intent / business problem

- **Cuentas duplicadas**: el bloque de Cuentas ocupa el doble de alto con la misma información; el ojo tiene que decidir cuál de las dos representaciones es "la cuenta real", y la lista útil (la que edita) queda visualmente subordinada.
- **Scroll largo en Movimientos**: con el seed demo de prod (34 movimientos) la lista ya obliga a scrollear; sin tope crece sin fin y empuja la gráfica de categoría fuera de la pantalla.
- **Gráfica muda**: la barra actual comunica "cuánto gasté en esta categoría, en total y desde siempre". No comunica **cuándo**, no muestra ingresos cuando existen, y no permite preguntar "¿cómo viene este mes contra el anterior?".
- **Comparar categorías quedó a medias**: es la misma barra, dos veces, sin dimensión temporal.

## 2. Scope

**In scope (frontend only).**

| Punto | Superficies |
|---|---|
| 1 | `FinanceScreens.tsx` (bloque Cuentas), `FinanceSections.tsx` (`AccountsList` + helpers privados), tests de ambas |
| 2 | `MovementHistory.tsx` (slice + "Ver más" + reset por filtro), su test, 1 clave i18n |
| 3 | `lib/finance/finance.ts` (helpers de tendencia), `CategoryTrendChart.tsx` (nuevo), `TrendPeriodSelector.tsx` (nuevo), `CategoryCharts.tsx` (wire-up + baja de `CategoryBars`), tests, claves i18n |
| 4 | `app/dashboard/finance/compare/page.tsx` (+ test) |

**Out of scope (non-goals, explícitos).**

- Backend, migraciones, SQL, endpoints, DTOs. `GET /api/movements` no cambia.
- Dependencias nuevas: `recharts` ya está; no se agrega ninguna librería de charts, fechas ni estado.
- `PeriodSelector.tsx` de Reportes (semántica distinta: rango + custom) y `ReportsScreens`.
- Filtros de movimientos, modal de alta/edición, borrado, pagos de suscripción, saldo manual (más allá de mover su fila).
- `objetivo.md` y las specs canónicas de finanzas: la paginación client-side no altera el contrato del endpoint.
- Commit, push, deploy, PR, Judgment Day (fuera de la autorización de esta sesión). La nueva UI se verifica en local con Playwright.

## 3. Decisions resolved here (detalle en `design.md`)

| Id | Decisión | Valor |
|---|---|---|
| D1 | Naturaleza de la paginación | Presentación client-side sobre el payload completo; backend intacto |
| D2 | Cuentas | Una sola lista (`AccountBalanceEdit`); se elimina `AccountsList` y lo que quede muerto; la etiqueta de tipo (cruda, como hoy) se traslada a la fila |
| D3 | Selector de periodo | Componente nuevo `TrendPeriodSelector` (Día/Semana/Mes/Año); `PeriodSelector` intacto |
| D4 | N por periodo | Día **14**, Semana **8**, Mes **12**, Año **5**, incluida la unidad actual, más viejo→más nuevo, buckets vacíos en 0 |
| D5 | Gráfica | `recharts` con 1..4 series; eje Y compacto, tooltip con `formatMoney`; comparar = sólida (A) y punteada (B) |
| D6 | `CategoryBars` | Queda muerto → se elimina con sus tests |
| D7 | i18n | Claves tipadas nuevas en `finance.*`/`compare.*`; sin claves huérfanas al borrar `CategoryBars` |
| D8 | Verificación | `pnpm test` + `tsc --noEmit` + `pnpm build` + Playwright en local contra la DB de prod con captura de consola |

## 4. Risks

| Riesgo | Mitigación |
|---|---|
| Los tests del render duplicado de Cuentas (LED, progressbar de uso, "Visa" ×2) fallan al borrar las tarjetas | Reescribirlos en el mismo work unit que el borrado; el gate es `pnpm test` verde |
| La paginación rompe los filtros existentes | Reset por `useEffect` sobre los tres filtros + casos de test explícitos (filtrar, paginar, volver a filtrar) |
| Buckets mal alineados (semana que arranca domingo, mes que resta 1) generan puntos corridos | Helper puro con tests de borde: fronteras exactas, día con hora local, semana desde lunes (convención de `habitStats.ts:105-110`) |
| Formato de eje ilegible con COP (millones) | Eje Y compacto (`notation: "compact"`), tooltip con `formatMoney` completo |
| Cuatro líneas ilegibles en Comparar | Sólida vs punteada por categoría + leyenda |
| Se pierde el uso de tarjeta de crédito que mostraba la tarjeta | Aceptado: el pedido elimina las tarjetas; se reporta al cierre |
| Delta > 400 líneas sin commit | Sin entrega no hay candidato de review; se preserva patch con sha256 y se recomienda partir en 2 PRs si el dueño decide commitear |

## 5. Acceptance criteria

1. Cuentas: una sola representación por cuenta, con nombre, **tipo**, saldo y botón "Editar saldo" funcionando como hoy.
2. Movimientos: 5 filas al abrir; "Ver más" suma exactamente 10; el botón desaparece al agotar; cambiar Cuenta/Categoría/Tipo vuelve a 5 **sin** alterar el filtro; "Limpiar filtros" sigue funcionando.
3. Gráfica de categoría: líneas Gastos e Ingresos, 4 botones de periodo operativos, N puntos por periodo (14/8/12/5), selector de categoría intacto.
4. Comparar: misma gráfica con 4 líneas y los mismos 4 periodos.
5. `pnpm test`, `tsc --noEmit` y `pnpm build` verdes; Playwright en local sin errores de consola en 1440/768/390.
6. Ninguna funcionalidad no mencionada rota (filtros, alta/edición/borrado, suscripciones, Reportes).
