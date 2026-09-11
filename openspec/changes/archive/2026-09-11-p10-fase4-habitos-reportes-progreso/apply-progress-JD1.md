# Apply progress — JD round 1 fixes (cadena Fase 4, rama `p10-s4-progreso-score`, SIN commitear)

Scope: solo los IDs autorizados (C-01, C-02, H-01, H-02, H-03, W-01..W-08). Sin commits, sin
tocar gates parent (4.4/5.2 quedan `[ ]`), sin tocar campanita/valuaciones/triggers/`HabitRow`.
Store: openspec (`openspec/changes/p10-fase4-habitos-reportes-progreso/`). RDD: la ejecución se
hizo vía la cadena JD del change (no se habilitó/deshabilitó nada).

## Tabla fix → test → evidencia

| # | Fix | Archivo(s) | Test que lo prueba | Evidencia RED → GREEN |
|---|-----|-----------|--------------------|-----------------------|
| C-01 | `/events` recibe RFC 3339 en vez de `YYYY-MM-DD` (backend `validate_event_datetime` rechaza fecha desnuda con 422) | `lib/finance/finance.ts` (`toEventRange`), `containers/ReportsScreens.tsx`, `containers/ProgressScreens.tsx` | `ReportsScreens.test.tsx` › `C-01: pide /events con RFC 3339`; `ProgressScreens.test.tsx` › `C-01` | RED: URL con `from=2026-09-01` (sin `T00:00:00`) → assert regex falla. GREEN verde |
| C-02 | Agenda de próximos 14 días con lectura propia `[hoy, hoy+14]` RFC 3339; el período `[hoy-29, hoy]` queda para el score | `containers/ProgressScreens.tsx` (`upcomingWindow`) | `ProgressScreens.test.tsx` › `C-02: lee los próximos 14 días en su propia ventana y los muestra` (handler MSW ramifica por `from=2026-08*` vs `from=2026-09-15*`) | RED: `Evento próximo` no aparece (ventana del período no contiene `+5d`). GREEN: aparece y `Evento del período` no se lista |
| H-01 | `compareIds`/`selectedId` quedaban vacíos cuando `habits` llega después del primer render (SWR) | `productivity/HabitHistorySection.tsx` (efecto one-shot con `useRef`) | `HabitHistorySection.test.tsx` › `H-01: siembra el comparador…` (`habits=[]` → rerender con hábitos) | RED: sin `list[Comparar]` (timeout 1s). GREEN: leyenda con `Correr` |
| H-02 | `monthKey` por defecto usaba `toISOString()` (UTC) → mes equivocado en husos negativos | `productivity/HabitHistorySection.tsx` (`defaultMonthKey` + prop `now`) | `HabitHistorySection.test.tsx` › `H-02: deriva el mes por defecto del reloj local…` (runner `America/Bogota`, `new Date(2029,11,31,23,0)`) | RED verificado: con el fallback UTC la URL pedía el mes real `…?from=2026-09-01&to=2026-09-30` vs `Expected "from=2029-12-01"`. GREEN: `from=2029-12-01&to=2029-12-31` |
| H-03 | El filtro cliente por `starts_at` descartaba eventos multi-día que solapan el rango (el server ya los devuelve por solape) | `containers/ReportsScreens.tsx` (`overlapsRange`) | `ReportsScreens.test.tsx` › `H-03: un evento multi-día que solapa el período…` (evento 08-30→09-02 + evento de julio fuera) | RED: `Viaje` filtrado. GREEN: `Viaje` visible y `Julio` no |
| W-01/B-002 | `onRetry` de hábitos solo mutaba `habitsHistoryKey`; si el error venía de `/habits/today` el bloque nunca se recuperaba | `containers/ReportsScreens.tsx`, `containers/ProgressScreens.tsx` | `ReportsScreens.test.tsx` / `ProgressScreens.test.tsx` › `W-01: el retry de hábitos revalida también /habits/today` (500 en ambos endpoints → `resetHandlers()` → click retry) | RED: bloque sigue en error (no aparece `Leer`). GREEN: `Leer` visible tras el retry |
| W-02 | `HabitEvolutionChart` compartía `productivity.history.empty` con el calendario → `getByText` con 2 nodos (flake) | `ui/HabitEvolutionChart.tsx`, `lib/i18n/es.ts` (`productivity.evolution.empty/emptyHint`) | `HabitHistorySection.test.tsx` › `shows a Spanish EmptyState…` (unicidad de ambas copys con `getByText`/`findByText`) | RED verificado revirtiendo la key: `Unable to find … broken up by multiple elements`. GREEN: ambas copys únicas |
| W-03 | `aria-label`/`title` del heatmap en inglés hardcodeado (`recent completions`, `day N: cell`) | `ui/HabitsHeatmap.tsx` + claves `productivity.heatmap.*` | `HabitHistorySection.test.tsx` › `W-03: etiqueta el heatmap en español…` | RED: `img[name="Correr recent completions"]` falla. GREEN: `Correr: cumplimientos recientes`, `title` `2026-09-01: cumplido` |
| W-04 | `role="grid"` sin filas y 42 `tabIndex=0` (42 tab stops) | `productivity/HabitHistorySection.tsx` (6 `role="row"` con `display:contents`, grid único tab stop) | `HabitHistorySection.test.tsx` › `W-04: grid con 6 filas y un solo tab stop…` | RED: 0 rows y celdas con `tabindex`. GREEN: 6 rows, 42 gridcells sin `tabindex`, grid con `tabindex=0` |
| W-05 | Copy obsoleta "El calendario mensual llega en S7." junto al calendario real | `lib/i18n/es.ts` (`habitsCalendarHint`) | Verificación por grep (sin test propio: es copy, la key sigue tipada) | `grep -rn "llega en S7" frontend` → vacío |
| W-06 | Disclaimer fuera de la sección del score | `containers/ProgressScreens.tsx` (dentro de la `<section>` del score, bajo las barras) | `ProgressScreens.test.tsx` › `W-06: el disclaimer vive dentro de la sección del score` | RED: `within(score).getByText` falla. GREEN: visible dentro de la región |
| W-07 | `HabitHistorySection` mostraba `stats.currentStreak` del mes en vez de `current_streak` del API | `productivity/HabitHistorySection.tsx` (`HistoryHabit.current_streak`) | `HabitHistorySection.test.tsx` › `W-07: muestra la racha actual del API y no la del mes` (`current_streak: 7` vs mejor racha del mes 3) | RED: sin `7 días`. GREEN: `7 días` (API) y `3 días` (mejor racha del mes) |
| W-08 | Spec exige 422 en query desconocida pero axum 0.8 devuelve 400 | `backend/src/routes/habits.rs` (`ValidatedQuery`) | `logs_range_tests`: `validated_query_acepta_from_y_to`, `validated_query_mapea_unknown_field_a_422` (+ `code = VALIDATION_ERROR`), `validated_query_mapea_falta_de_parametros_a_422`, `router_rechaza_unknown_query_field_con_422` | RED verificado (impl temporal con `Rejection = QueryRejection`): 400 en los 3 asserts de remapeo (incluido el test de router). GREEN: 422 |

## Decisión W-08 (reportada)

Se eligió **la opción (a): extractor local**, no corregir el spec a 400:

- `pub struct ValidatedQuery<T>(pub T)` con `impl FromRequestParts` cuyo `Rejection = AppError`;
  mapea cualquier rechazo de `Query` a `AppError::Validation` → **422 `VALIDATION_ERROR`**.
- Alcance: 1 struct + 1 impl (~22 líneas) aplicado **solo** a `GET /habits/logs`; el extractor
  global `Query` y el resto de rutas quedan intactos (no es cambio global, <60 líneas).
- El spec (`habits-management/spec.md` › `Range Logs Read`) ya exigía 422: **no se modificó spec
  ni contrato**; el cambio alinea la implementación con el contrato existente.
- `deny_unknown_fields` sí rechaza campos desconocidos en `serde_urlencoded` (verificado: el
  baseline devuelve 400 de deserialización, no 401), así que el remapeo es suficiente.

## TDD evidence (resumen)

- RED frontend: `pnpm vitest run HabitHistorySection ProgressScreens ReportsScreens` → **12 failed / 14 passed** (los 12 nuevos casos, cada uno por la razón del finding).
- RED puntual re-verificado por test (revirtiendo la impl a la versión previa, sin tocar el resto):
  `H-02` → `Expected "from=2029-12-01"` / `Received "…?from=2026-09-01&to=2026-09-30"`;
  `W-02` → `Unable to find an element with the text: Sin datos de evolución en este período … broken up by multiple elements`.
- RED backend W-08: con el extractor devolviendo el rechazo nativo de axum → **400 vs 422** en 3 tests.
- GREEN: frontend **269/269** (28 files) y backend **412/412** (`cargo test --bins`).
- Nota H-02: el runner está en `America/Bogota`, así que el test RED depende del huso (documentado
  en el propio test con el `now` de 2029-12-31T23:00 local = 2030-01-01T04:00Z).

## Verificación ejecutada

| Comando | Resultado |
|---|---|
| `pnpm --dir frontend vitest run` | 28 files / **269 passed** (baseline 257; +12 casos) |
| `pnpm --dir frontend exec tsc --noEmit` | limpio |
| `cargo test --bins` | **412 passed / 0 failed** (baseline 408; +4) |
| `cargo clippy --all-targets --locked -- -D warnings` | **falla por un warning pre-existente** `unused axum::Json` en `backend/src/routes/transfers.rs:1040` (archivo NO tocado; `git diff` vacío) — 0 warnings en `habits.rs`/resto de superficies editadas |
| `grep -rn "llega en S7" frontend` | vacío (W-05) |
| `grep -rn "recent completions\|day \d" frontend --include=*.tsx` | sólo asserts negativos de test |
| `useEvents` con rango | sólo `ReportsScreens`/`ProgressScreens` lo hacen con fechas y ahora van RFC 3339; `ProductivityScreens` ya usaba `toISOString`, notificaciones/widgets pasan `null` |

## Presupuesto de líneas

- Implementación (sin archivos `*.test.*` y sin el módulo de tests de `habits.rs`): **229 líneas**
  (≤400 ✓) — `HabitHistorySection.tsx` 80, `habits.rs` impl 36, `ProgressScreens.tsx` 39,
  `ReportsScreens.tsx` 34, `HabitsHeatmap.tsx` 17, `es.ts` 12, `finance.ts` 9, `HabitEvolutionChart.tsx` 2.
- Tests: **266 líneas** (`ProgressScreens.test.tsx` 62, `ReportsScreens.test.tsx` 50,
  `HabitHistorySection.test.tsx` 85, módulo `logs_range_tests` de `habits.rs` 69).
- Total: **495 líneas** (`git diff --numstat`, sin `skills-lock.json`). Supera el techo de 400
  pedido: los 13 findings exigen 13 tests. Mismo criterio que S4 ("impl 331; con tests 470").
  **Queda a decisión del controller** si aplica `size:exception` o un recorte adicional de tests.

## Decisiones / desvíos (explícitos)

- **C-02**: se mantuvo la lectura de período (`[hoy-29, hoy]`) para el score/no-data y se añadió la
  ventana propia de próximos 14 días para la lista, tal como pedía el finding (2 lecturas SWR de
  `/events`, claves distintas y `revalidateOnFocus:false` heredado).
- **W-08**: el "test de router" se implementó **dentro de `backend/src/routes/habits.rs`** usando
  `crate::build_router` con pool lazy, porque `backend/src/main.rs` está **fuera de las superficies
  permitidas**. Es un test de router real (`/api/habits/logs?…&unknown=1` → 422, no 401/400).
- **W-07**: se eligió propagar `current_streak` (no etiquetar "del mes"); `stats.currentStreak`
  queda como fallback cuando el consumidor no lo aporta (tests S2b existentes).
- **W-02**: el caso de test nuevo se fusionó con el test de `EmptyState` de S2b (misma fixture) para
  no duplicar render/MSW; la aserción de unicidad es la misma.
- `skills-lock.json` aparece modificado en `git status` **antes** de esta sesión: no se tocó.

## Remaining / riesgos

- **Tamaño** (arriba): 495 total vs techo 400 (impl 229 ✓, tests 266) → necesita `size:exception`
  o recorte de tests.
- `cargo clippy --all-targets -D warnings` no está limpio por un warning **pre-existente** en
  `transfers.rs` (fuera de allowlist); las superficies editadas no aportan warnings.
- `toEventRange` usa medianoche/fin de día **UTC** (coherente con `starts_at` UTC y con la cota
  exclusiva del server). Para un usuario en husos negativos, el borde del día del evento se
  interpreta en UTC; no cambia el comportamiento previo (que era 422/roto) y el filtro cliente de
  solape trabaja en fechas UTC recortadas.
- H-02: test sensible al huso del runner (documentado; en `America/Bogota` es RED real).
- Gates parent intactos: 4.4 y 5.2 siguen `[ ]`; no se modificó `tasks.md`.
