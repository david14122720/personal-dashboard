# Design — p10-fase4-habitos-reportes-progreso

## 1. Overview

Fase 4 = 1 endpoint BE nuevo + 3 entregas FE-only. Decisión fijada en proposal:
`GET /habits/logs?from&to` multi-hábito en 1 round-trip; stats en FE sobre el rango;
reportes/progreso/score por composición FE-only (precedente `dashboard-widgets`).
4 slices stacked-to-main, ≤400 líneas c/u, TDD estricto, JD 2 jueces por slice.
Sin migraciones, sin tocar campanita/triggers/valuaciones/`HabitRow`.

## 2. S1 — BE: `GET /habits/logs?from&to`

### 2.1 Contrato HTTP

- Ruta: `GET /habits/logs` (colectivo, antes de `/:id` en el router para evitar
  captura por segmento dinámico).
- Query (nuevo struct, `deny_unknown_fields`):
  ```rust
  #[derive(Debug, Deserialize)]
  #[serde(deny_unknown_fields)]
  pub struct HabitLogsRangeQuery { pub from: String, pub to: String }
  ```
- Respuesta `200`: `[{ habit_id: Uuid, log_date: NaiveDate, status: String }]`
  ordenado por `(habit_id, log_date)` ASC. `status ∈ done|missed|skipped|not_done`
  (legacy solo lectura, se devuelve tal cual).
- Errores: `401` sin bearer (`require_user_id`, forma existente); `404` nunca
  filtra existencia — el scope `user_id` hace foráneo invisible (lista vacía si
  nada propio en rango; `GET /habits/:id`-style solo aplica si se pidiera por id,
  aquí no hay `:id`); `422` en: formato no `YYYY-MM-DD` (`22P02`-style),
  `from > to`, rango > 366 días, unknown fields. `23503/23514/22P02 → 422`
  según convención del módulo.

### 2.2 Validación pura (testeable sin DB)

Nueva fn pura en `habits.rs` (junto a validadores de fecha existentes):

```rust
pub fn parse_logs_range(from: &str, to: &str) -> Result<(NaiveDate, NaiveDate), HabitApiError>
```

- Parsea con `%Y-%m-%d` (rechaza `2026-13-40`, `not-a-date` → 422).
- `from > to` → 422 (`"from_after_to"`).
- `(to - from).num_days() > 365` (i.e. > 366 días inclusivos) → 422 (`"range_too_wide"`).
- Retorna tupla para bindear `$2,$3`. Sin I/O, sin `PgPool` → tests puros.

### 2.3 SQL dedicada (NO ensanchar `HabitRow`)

Nueva constante, fila nueva de 3 columnas (lejos del cap 16 de sqlx):

```sql
-- LOGS_RANGE_SQL
SELECT habit_id, log_date, status::text
FROM habit_logs
WHERE user_id = $1 AND log_date >= $2 AND log_date <= $3
ORDER BY habit_id ASC, log_date ASC
```

- Índices existentes cubren ambos accesos: `idx_habit_logs_user_date (user_id, log_date)`
  para este filtro; `idx_habit_logs_habit_date` queda para streak/today.
- Verificar con `EXPLAIN` en S1 (precedente task 2.4 habits): `EXPLAIN ...`
  debe mostrar `Index Scan using idx_habit_logs_user_date`.
- Reutilizar forma probada streak/today solo donde aplique: el cast
  `EXTRACT(DOW ...)::int` y el puente `skipped` pertenecen a `STREAK_SQL`; el
  rango NO los necesita (devuelve logs crudos; el puente lo aplica el transform
  FE `habitStats`). No copiar el CTE gaps-and-islands al rango.
- Handler: `require_user_id` → `parse_logs_range` → `query_as::<_, (Uuid, NaiveDate, String)>`
  → mapear a `HabitLogEntry { habit_id, log_date, status }`. Wiring en `main.rs`
  junto a `GET /habits/today` y `GET /habits/:id/streak`.

### 2.4 Tests S1 (puros, sin DB — CI offline + argon2)

- `parse_logs_range_acepta_rango_valido` / `rechaza_formato` /
  `rechaza_from_after_to` / `rechaza_mas_de_366_dias` (límite: 366 ok, 367 err).
- `logs_range_sql_filtra_por_usuario_y_rango_y_ordena` — assert sobre el string
  SQL (contiene `user_id = $1`, `log_date >= $2`, `ORDER BY habit_id`, no menciona
  `HabitRow` ni `SELECT *`), mismo estilo que
  `today_sql_resolves_status_and_streak_in_one_statement`.
- Integración PG (con skip-guard `DATABASE_URL` como el resto del módulo):
  seed 2 hábitos + logs dentro/fuera de rango + log de otro usuario →
  solo propios en rango, ordenados. Cleanup `DELETE FROM users ... CASCADE`
  sin tocar (triggers vivos).

### 2.5 Límites S1

~150–250 líneas (struct + const SQL + fn pura + handler + wiring + tests).
Sin agregados (`current_streak/best_streak/compliance` van en FE S2).
Sin endpoint `stats` (diferido: solo si anual excede presupuesto de bytes).

## 3. S2 — FE historial hábitos

### 3.1 Transforms puros (nuevo `frontend/lib/productivity/habitStats.ts`)

Patrón frontera pura copiado de `lib/dashboard/transforms.ts`; `toNumber` solo
en boundary (aquí casi no hay money: conteos enteros + `%` con 1 decimal):

```ts
export interface HabitLogEntry { habit_id: string; log_date: string; status: string; }
export interface HabitStats {
  total: number; done: number; missed: number; skipped: number; unlogged: number;
  complianceRate: number; // done / (total - skipped), 0..100, 1 decimal
  bestStreak: number;     // gaps-and-islands, skipped puentea, missed/not_done corta
  currentStreak: number;  // trailing run desde el día más reciente (misma regla)
}
export function habitStats(logs: HabitLogEntry[], from: string, to: string, daysOfWeek?: number[]): HabitStats
export function complianceRate(done: number, denom: number): number
export function logsToCalendarCells(logs, habitId, monthKey): CalendarCell[42] // 4-estados
```

- Reglas: `skipped` puentea racha (copia semántica `STREAK_SQL`: `status <> 'skipped'`
  + `skipped_after`), `missed` y `not_done` rompen, `sin-registro` rompe racha
  pero cuenta como `unlogged` (no como missed) en conteos y calendario.
- Máscara `days_of_week`: días fuera de máscara se excluyen del denominador
  (como `CARDINALITY($3)=0 OR DOW = ANY($3)`).
- `daysOfWeek` usa `0=Sun..6=Sat` (igual que BE `EXTRACT(DOW)`).
- Calendario 4-estados: `cumplido(done) / no-cumplido(missed+not_done) /
  omitido(skipped) / sin-registro(ausente)`. Copy ES sin culpa
  (p.ej. "días sin registro", nunca "fallaste").
- Tests: RED/GREEN/TRIANGULATE puros (vitest), sin fetch: racha con puente
  skipped, corte en missed, `complianceRate` excluye skipped, denominador 0 → 0,
  máscara excluye días, `not_done` cuenta como no-cumplido.

### 3.2 Fetcher + keys SWR

- `frontend/lib/api/productivity.ts`: agregar
  ```ts
  export interface HabitLogWire { habit_id: string; log_date: string; status: string; }
  export const HABITS_HISTORY_KEY = "habits-history";
  export function habitsHistoryKey(from: string, to: string) { return `${HABITS_HISTORY_KEY}:${from}:${to}`; }
  export function useHabitsHistory(from: string|null, to: string|null, config?) // SWR, null-key cuando rango inválido, revalidateOnFocus:false
  ```
  Bearer + single-flight 401 vía `apiGet` existente (no reinventar cliente).
- `lib/dashboard/dashboard.ts`: no duplicar hook; documentar que `habits-history`
  vive en `api/productivity.ts` (evita doble fuente).

### 3.3 UI

- `ProductivityScreens.tsx`: el slot `#calendario-habitos` (línea ~269) se llena
  con `<HabitHistorySection habitId from to>` — selector de hábito por nombre
  (sin UUID visible), calendario mensual (grid 7 col, reutiliza estilos de
  `HabitsHeatmap`), stats base (mejor racha, %, conteos), evolución S/M/A y
  comparar multi-serie.
- `HabitsHeatmap.tsx`: extender props a `cells: HeatCell[] | CalendarCell[]`
  reales desde `logsToCalendarCells`; **eliminar `heatmapCells` falso** en S2
  (no mantener doble implementación; actualizar `productivity.test.ts`).
  `HeatCell = done|missed|pending|empty` se mapea: cumplido→done,
  no-cumplido→missed, sin-registro→pending, omitido→empty + leyenda ES.
- Evolución + comparar: Recharts vía `next/dynamic(ssr:false)` (obligatorio por
  `output: export`), code-split por widget como `dashboard/widgets/*`;
  multi-serie = una serie por hábito (máx 4, leyenda por nombre).
  `prefers-reduced-motion`: desactivar animación Recharts (`isAnimationActive={!reduced}`).
- i18n: claves nuevas en `lib/i18n.ts` (`habits.history.*`, `habits.stats.*`,
  `habits.compare.*`), ES tipado, cero literales.
- Estilos: tokens `--color-*`, sin hex; foco visible teclado en celdas
  interactivas; `EmptyState` ES + retry por widget.

### 3.4 Límites S2

~300–400 líneas (transforms + tests + fetcher + sección + heatmap real).
Si excede, partir: S2a transforms+fetcher, S2b UI.

## 4. S3 — FE `/reportes` (solo pantalla)

- Ruta nueva `frontend/app/dashboard/reportes/page.tsx` (shell + redirect login,
  copia `productivity/page.tsx`); sección en
  `components/containers/ReportsScreens.tsx` (nuevo, FE-only).
- `PeriodSelector` reutilizado de `components/finance/PeriodSelector.tsx`
  (semana/mes/año + custom `from/to`; custom inválido bloquea agregados sin
  romper — precedente `finance.test.tsx:630`).
- 4 bloques, cada uno compone endpoints existentes en paralelo (`Promise.all`,
  `async-parallel`):
  1. **Finanzas**: `monthly-flow` (ingreso/gasto/ahorro) + `by-category` (top
     categorías). Money vía `toNumber` en boundary + `formatMoney` es-CO/COP.
  2. **Hábitos**: `useHabitsHistory(from,to)` + `habitStats` (cumplimiento
     período por hábito + global).
  3. **Metas**: `GET /goals` (avance `progress` trigger-owned, solo lectura).
  4. **Actividad**: `tasks?view=done` (completadas en período, filtro cliente por
     `completed_at`) + `GET /events?from&to`.
- Sin PDF/Excel (non-goal explícito). `EmptyState` + retry por bloque.
- Keys SWR: reutilizar existentes; si se agrega cache local usar prefijo
  `reports-*` con `revalidateOnFocus:false`.
- ~250–350 líneas (ruta + contenedor + 4 bloques + i18n).

## 5. S4 — FE `/progreso` + score visual

- Ruta `frontend/app/dashboard/progreso/page.tsx` + `ProgressScreens.tsx`:
  combina ahorro mensual + gastos (`monthly-flow`), patrimonio = número existente
  solo lectura (NO gráfico evolución — valuaciones INSERT-only, fuera de scope),
  objetivos (`goals` progress), hábitos (cumplimiento global, mejores rachas,
  pendientes `today_status=pending`, evolución semanal), productividad
  (completadas, metas avanzadas, próximos eventos 14d vía `toUpcomingEvents`).
- Score visual por área (nuevo puro `scoreByArea` junto a `habitStats.ts`):
  ```ts
  export function scoreByArea(input: { finance: number; habits: number; goals: number; productivity: number }): AreaScore[]
  ```
  Cada área 0–100 normalizada con pesos documentados en código; **solo visual**
  (barras/LED, sin número único tipo "tu nota"). Inputs ya normalizados 0–100
  por sus transforms (no re-normalizar money aquí).
- Disclaimer fijo siempre visible, estilo `AnalysisSection`:
  clave i18n `progress.score.disclaimer` — "orientativo, sin conclusiones
  médicas, psicológicas ni financieras". Sin diagnósticos ni recomendaciones
  sensibles; copy ES sin culpa en todo S4.
- ~250–350 líneas. Sin tocar valuaciones (solo lectura), sin escribir `progress`.

## 6. Contratos transversales (vinculantes S1→S4)

| Contrato | Regla |
|---|---|
| COP es-CO | `toNumber` solo en boundary, `formatMoney` es-CO; decimales wire = string `NUMERIC(8,2)` |
| i18n ES tipado | `t(key, vars)`, cero literales; copy sin culpa |
| Tokens | `--color-*`, sin hex; `prefers-reduced-motion`; foco visible |
| Charts | `next/dynamic(ssr:false)` siempre (Recharts 3 + `output: export`) |
| Data | `revalidateOnFocus:false`; bearer localStorage + single-flight 401; `deny_unknown_fields` |
| Inmutables | `direction/frequency/days/start_date` no se escriben; `not_done` lectura que rompe racha |
| No tocar | campanita/notif, triggers (`set_task_completed_at`, goal-progress), valuaciones (solo lectura número), `HabitRow` 15 cols, DELETEs habits |

## 7. Orden de implementación + TDD/JD

S1 → S2 → S3 → S4 stacked-to-main. Cada slice: RED → GREEN → TRIANGULATE →
REFACTOR, luego Judgment Day 2 jueces ciegos antes de merge. S1 desbloquea S2
(endpoint real); S3/S4 pueden mockear el rango con MSW hasta S2 verde pero
mergean sobre S2/S3 respectivamente. Budget: cada slice ≤ 400 líneas dif.

## 8. Riesgos residuales

- Anual pesado en bytes → diferir endpoint `stats`; si S2 anual > presupuesto,
  proponer slice S2b con agregación BE (fuera de este diseño).
- `not_done` legacy en rango antiguo → el calendario lo muestra como
  no-cumplido; no escribible (convención heredada).
- Recharts en `output: export` → `ssr:false` + `EmptyState` si el chunk falla.
- Foco/teclado en calendario: celdas `div` con `tabIndex` + `aria-label` ES.

## 9. Rollback

S1: revert commit (sin migración, cero datos). S2: revert + restaura
`heatmapCells` desde git (único punto de no-retorno, solo tras verde).
S3/S4: rutas nuevas → revert limpio, sin flags.
