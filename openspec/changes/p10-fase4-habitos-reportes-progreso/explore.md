# Explore — Fase 4: hábitos historia, reportes pantalla, progreso/puntuación

## 1. Estado real de habits (backend + frontend)

### Backend — `backend/src/routes/habits.rs` (~1800 líneas, el módulo más grande)
Endpoints vivos (wiring en `main.rs`):
- `POST /habits` / `GET /habits` / `GET /habits/:id` / `PATCH /habits/:id` / `DELETE /habits/:id`
- `POST /habits/:id/logs` (create, 409 si ya existe log esa fecha)
- `PATCH /habits/:id/logs/:date` (update)
- `GET /habits/:id/streak` → `{ habit_id, current_streak }` (gaps-and-islands SQL con puente `skipped`, respeta máscara `days_of_week`)
- `GET /habits/today` → `[{ habit_id, name, habit_frequency, days_of_week, current_streak, today_status }]` donde `today_status ∈ done|missed|skipped|pending` (una sola sentencia con `CROSS JOIN LATERAL`, sin N+1)

Convenciones (heredar en Fase 4): `require_user_id` (401), `deny_unknown_fields` (422), `user_id`-scoped SQL (foráneo → 404 sin filtrar existencia, inexistente → 422 guarda orfandad), `23505 → 409`, `23503/23514/22P02 → 422`, decimales como **strings** (`NUMERIC(8,2)`, `scale ≤ 2`, `< 10^6`), `direction/frequency/days/start_date` inmutables post-creación, `not_done` legacy solo lectura (rompe racha, no escribible).

Lo que **NO existe**: ningún endpoint de historial por rango (`GET /habits/:id/logs?from&to`), ningún agregado de stats (mejor racha, % cumplimiento, conteos done/missed/skipped/sin-registro), ninguna evolución semanal/mensual/anual, ninguna comparación entre hábitos, ningún endpoint de reportes, score o progreso.

### Frontend habits hoy
- `frontend/lib/api/productivity.ts`: `useHabitsToday` (`GET /habits/today`), `logHabitToday` (POST hoy + fallback PATCH en 409), CRUD goals/tasks/events/notes. No hay fetcher de logs por rango.
- `frontend/lib/productivity/productivity.ts`: `heatmapCells(streak, todayStatus)` — **heatmap FALSO de 14 celdas derivado de la racha**, no de logs reales (documentado: "backend exposes no per-day log history on this read"). `habitStatusLed`, `groupTasksByStatus`, `goalProgressFraction`, vistas fecha/tiempo tasks/events. Punto de partida para transforms reales.
- `frontend/components/productivity/ProductivitySections.tsx`: `HabitsList` (check diario done/missed/skipped + `HabitsHeatmap` + racha), `GoalsList`, `TasksList`, `EventsList`, `NotesResults`. Todo presentacional puro; contenedor posee SWR.
- `frontend/components/containers/ProductivityScreens.tsx`: 5 lecturas SWR en paralelo + mutaciones; ancla reservada `#calendario-habitos` (link + hint, sin calendario real — S7 reservó el slot).
- `frontend/components/ui/HabitsHeatmap.tsx`: grid CSS 7 columnas, `HeatCell = done|missed|pending|empty`, sin librería de charts. Reutilizable para heatmap mensual real.
- `frontend/app/dashboard/productivity/page.tsx`: solo shell + redirect login. No hay rutas `/reportes`, `/progreso`, `/score`.

## 2. Specs existentes (qué cubren / qué falta)

| Spec | Cubre | Falta para Fase 4 |
|---|---|---|
| `habits-management` | CRUD, log done/missed/skipped, 409 duplicado, streak on-demand (healthy=2, broken=1, mask), `GET /habits/today` (mixed statuses, empty, 401) | historial por rango, calendario 4-estados (cumplido/no/omitido/sin-registro), heatmap mensual, stats base (racha actual/mejor/%/conteos), evolución S/M/A, comparar, lenguaje sin culpa |
| `goal-tracking` | CRUD + `progress` por trigger (0/50/100%) | nada nuevo (progreso metas se lee de `GET /goals`; ahorro de `GET /savings-goals`) |
| `task-management` (inferido de `tasks.rs`) | CRUD + vistas today/upcoming/overdue/done + `completed_at` por trigger | nada nuevo (reporte productividad lee vistas existentes) |
| `calendar-events` | CRUD eventos + `from/to` overlap | nada nuevo (próximos eventos para progreso lee `GET /events?from&to`) |
| `dashboard-widgets` | 9 widgets FE-only, `month-income/expense/savings`, upcoming-payments 7d, pending-debts/subs/tasks, upcoming-events 14d, goal-progress (Metas+Ahorro), toggles persistidos en `PATCH /me/preferences` | precedente clave: **composición FE-only sin backend nuevo**; reportes/progreso/score pueden seguir el mismo patrón salvo historial hábitos |
| `notifications` | campanita header + badge + mute localStorage `p8-notif-muted`, sin push/email | nada nuevo (recordatorios siguen in-app; Fase 4 no toca campanita) |
| `frontend-dashboard`, `frontend-i18n` | bento rail→tabs, tokens `--color-*` sin hex, ES tipado `t(key, vars)`, `output: export` + Axum `STATIC_DIR` + SPA fallback, bearer localStorage + single-flight 401 | constraints heredados para toda vista nueva |

## 3. Archivos Fase 2+3 para reutilizar (no reinventar)

- `frontend/lib/dashboard/transforms.ts`: frontera pura de transforms — coerción string-money (`toNumber` solo en boundary), `toMonthIncome/Expense/Savings`, `toUpcomingPayments` (ventana 7d `[hoy00:00, hoy+7 23:59]` + desempate deudas>events>subs), `toOverdueItems`, `toPendingDebts/ActiveSubs/PendingTasks`, `toUpcomingEvents` (14d), `toGoalProgress` (Metas+Ahorro), `toNotificationCount`, `longestStreak`, `currentMonthKey/monthsAgoStart/toISODate`. **Patrón a copiar** para `habitStats`, `complianceRate`, `scoreByArea`.
- `frontend/lib/dashboard/dashboard.ts`: hooks SWR `dashboard/*` (habits-today, tasks?view=, goals, events, monthly-flow, by-category). Agregar keys `habits-history`, `reports-*`, `progress-*` con `revalidateOnFocus: false`.
- `frontend/components/dashboard/widgets/*`: `GoalProgress`, `UpcomingPayments`, `PendingTasks`, etc. — composición FE-only + `next/dynamic(ssr:false)` para Recharts 3 + `EmptyState` ES + retry por widget. Plantilla para widgets de progreso/score.
- `frontend/lib/finance/finance.ts` (`toInsights`) + `AnalysisSection.tsx`: insights con plantillas ES `analysis.tpl*` + disclaimer fijo siempre visible. Precedente directo para "puntuación solo visual + disclaimer sin conclusiones médicas/psicológicas/financieras".
- `frontend/components/finance/*`: `PeriodSelector` (selector período para reportes), `FinanceSections`, `TransactionsLedger`, `AnalysisSection`. Charts Recharts ya code-splitteados.
- `frontend/lib/api/money.ts` (`toNumber`, `formatMoney` es-CO/COP) + `lib/i18n.ts` (diccionario ES único, `formatMonth`).

## 4. Gaps concretos para Fase 4

### Backend (único gap que probablemente exige endpoint nuevo)
1. **Historial de logs por rango**: `GET /habits/:id/logs?from&to` (o `GET /habits/logs?from&to` multi-hábito en 1 round-trip). Sin esto el calendario/heatmap/evolución/comparar son imposibles (hoy solo hay today+streak). Validar `YYYY-MM-DD`, `from ≤ to`, cap de rango (p.ej. ≤ 366 días), scoping `user_id`, 401/404/422 existentes.
2. **Stats agregadas** (decisión proposal: ¿endpoint `GET /habits/:id/stats?from&to` con `current_streak/best_streak/compliance_pct/done/missed/skipped/unlogged` o cómputo FE sobre el rango? El cómputo FE es viable si el rango trae todos los logs; endpoint dedicado ahorra bytes en vista anual. Recomendación: empezar FE-only sobre el rango; agregar endpoint solo si anual > presupuesto).
3. **Reportes / progreso / score**: **cero endpoints nuevos** — componer FE-only desde `monthly-flow`, `by-category`, `budgets`, `savings-goals`, `debts`, `habits/today` (+nuevo rango), `goals`, `tasks?view=`, `events?from&to`, igual que `dashboard-widgets` (constraint "zero new backend endpoints" como precedente).

### Frontend (vistas faltantes)
1. **Historial hábitos**: calendario por hábito con 4 estados (cumplido/no/omitido/sin-registro) + heatmap mensual real (reemplazar `heatmapCells` falso) + stats base (racha actual ya existe, falta mejor racha, % cumplimiento, días cumplidos/no) + evolución semanal/mensual/anual (Recharts code-split) + comparar hábitos (multi-serie) + copy ES sin culpa. Ancla `#calendario-habitos` ya reservada en `ProductivityScreens`.
2. **Reportes por período**: vista solo-pantalla con `PeriodSelector` (semana/mes/año o `from/to`) para finanzas (ingreso/gasto/ahorro, top categorías), hábitos (cumplimiento período), metas (avance), actividad (tareas completadas, eventos). Sin PDF/Excel (explícito NO).
3. **Dashboard progreso personal**: combina ahorro mensual + gastos + patrimonio simple (número ya existe) + progreso objetivos + hábitos (cumplimiento general, mejores rachas, pendientes, evolución semanal) + productividad (completadas, metas avanzadas, próximos eventos).
4. **Puntuación personal**: indicador visual por área (finanzas/hábitos/metas/productividad), solo visual, con disclaimer estilo `AnalysisSection` ("orientativo, sin conclusiones médicas/psicológicas/financieras").

### Migraciones
**Ninguna requerida**: `habit_logs(user_id, habit_id, log_date, status)` + índices `idx_habit_logs_user_date` e `idx_habit_logs_habit_date` ya soportan rangos por hábito y por usuario/fecha. Verificar con `EXPLAIN` en proposal (precedente: task 2.4 de habits probó índice con EXPLAIN). Solo si el rango multi-hábito es lento se consideraría índice compuesto adicional (aditivo, nunca reescribir 0004).

## 5. Riesgos (memoria sesiones anteriores + constraints)

1. **Backend CI rojo offline + argon2**: tests con `DATABASE_URL` hacen skip sin PG (`eprintln!("SKIP ...")`); hashing argon2 pesado — mantener tests unitarios puros (validación, SQL-string asserts) separados de integración PG, como hace `habits.rs` (`today_sql_resolves_status_and_streak_in_one_statement` corre sin DB).
2. **Valuaciones INSERT-only**: si Fase 4 toca ahorros/activos, respetar que las valuaciones son append-only (no UPDATE de historia financiera).
3. **Cap 16 columnas sqlx**: las filas `HabitRow` (15 cols) están al límite; un `SELECT *` ampliado o un join con más columnas rompe la tupla — agregar queries nuevas en lugar de ensanchar filas.
4. **Triggers que revierten DELETEs**: precedente de triggers que restauran filas (p.ej. `set_task_completed_at`, goal-progress 0007); los DELETE de habits deben probarse contra triggers vivos y el cleanup de tests (`DELETE FROM users ... CASCADE`) debe seguir funcionando.
5. **Streak SQL frágil**: el query de diseño original fallaba (`date - bigint` sin operador) y el actual lleva cast `::int` + puente `skipped_after`; cualquier endpoint de mejor-racha/evolución debe reutilizar esa forma probada, no reinventarla.
6. **Contratos FE**: decimales string en el wire (nunca floats), `deny_unknown_fields`, COP manual es-CO, sin UUIDs visibles (selects por nombre como `GOAL_AREA_OPTIONS`), i18n ES tipado sin literales hardcodeados, `output: export` (todo client-side, `next/dynamic ssr:false` para charts), `prefers-reduced-motion`, foco visible teclado.
7. **Tamaño Fase 4 > 400 líneas**: delivery `stacked-to-main` con PRs ≤ review_budget; partir en slices (historial backend → historial FE → reportes → progreso+score) con TDD RED/GREEN/TRIANGULATE/REFACTOR y Judgment Day 2 jueces ciegos antes de cada merge.
