# Proposal — p10-fase4-habitos-reportes-progreso

## 1. Intent

Fase 4 cierra el loop de hábitos (hoy solo `today` + `streak` + check diario) y entrega las
vistas de seguimiento que pide `objetivo.md` (§ Hábitos, Metas, Estadísticas): historial por
rango, calendario 4-estados, heatmap mensual real, stats base, evolución S/M/A, comparar
hábitos, reportes por período solo-pantalla, dashboard de progreso personal y puntuación
visual por área con disclaimer.

Decisión central (recomendación del explore, se fija aquí): **un solo endpoint nuevo
multi-hábito `GET /habits/logs?from&to` en 1 round-trip**, cómputo de stats en FE sobre el
rango (FE-only primero). Todo lo demás (reportes / progreso / score) es **composición
FE-only** desde endpoints existentes, siguiendo el precedente `dashboard-widgets`.

## 2. Proposal question round (delegado auto — sin re-preguntar)

Preflight indica ejecución `auto` sin ronda interactiva. Se fijan las decisiones con
explore + `objetivo.md`; las preguntas quedan registradas como supuestos revisables:

1. **¿Multi-hábito vs por-hábito?** Supuesto fijado: multi-hábito `GET /habits/logs?from&to`
   (1 round-trip para calendario + heatmap + evolución + comparar). Si anual excede
   presupuesto de bytes, se evalúa endpoint de stats dedicado (no en S1).
2. **¿Stats en BE o FE?** Supuesto fijado: FE-only primero (`habitStats`, `complianceRate`
   en `lib/dashboard/transforms.ts`-style). Endpoint `stats` solo si la vista anual lo exige.
3. **¿Reportes con PDF/Excel?** Supuesto fijado: NO — solo pantalla con `PeriodSelector`.
   PDF/Excel es non-goal explícito.
4. **¿Score con conclusiones?** Supuesto fijado: solo indicador visual por área + disclaimer
   fijo estilo `AnalysisSection` ("orientativo, sin conclusiones
   médicas/psicológicas/financieras"). Sin diagnósticos ni recomendaciones sensibles.
5. **¿Primer slice útil?** Supuesto fijado: S1 historial-BE solo (endpoint rango + tests
   puros sin DB) desbloquea todo el FE posterior; cada slice ≤ 400 líneas, stacked-to-main.

Si el usuario quiere corregir framing o pedir segunda ronda, se reabre antes del spec.

## 3. Scope

### In scope

- **S1 — historial-BE:** `GET /habits/logs?from&to` multi-hábito.
  - Query: `from`, `to` requeridos, formato `YYYY-MM-DD`, `from ≤ to`, cap rango ≤ 366 días.
  - Respuesta: logs del usuario en rango `[{ habit_id, log_date, status }]` donde
    `status ∈ done|missed|skipped|not_done(legacy solo lectura)`, ordenados por
    `(habit_id, log_date)`. Sin agregados en S1.
  - Convenciones heredadas: `require_user_id` (401), `deny_unknown_fields` en query (422),
    `user_id`-scoped SQL (foráneo → 404 sin filtrar existencia), `23503/23514/22P02 → 422`.
  - Query nueva dedicada (NO ensanchar `HabitRow` de 15 cols — cap 16 sqlx). Reutiliza
    índices existentes `idx_habit_logs_user_date` / `idx_habit_logs_habit_date`; verificar
    con `EXPLAIN` (precedente task 2.4 habits).
  - Tests puros sin DB (validación de rango, asserts de SQL-string), separados de
    integración PG — CI offline + argon2 lo exige.
- **S2 — historial-FE:** calendario por hábito 4-estados
  (cumplido / no cumplido / omitido / sin-registro) + heatmap mensual real sobre
  `HabitsHeatmap` existente (reemplaza `heatmapCells` falso de 14 celdas) + stats base
  (racha actual existente, mejor racha, % cumplimiento, conteos done/missed/skipped/sin-registro)
  + evolución S/M/A (Recharts code-split `next/dynamic ssr:false`) + comparar hábitos
  multi-serie + copy ES sin culpa. Ancla `#calendario-habitos` ya reservada.
  - Keys SWR nuevas: `habits-history`; `revalidateOnFocus: false`.
- **S3 — reportes pantalla por período:** vista solo-pantalla con `PeriodSelector`
  (semana/mes/año o `from/to`) para finanzas (ingreso/gasto/ahorro vía `monthly-flow`,
  top categorías vía `by-category`), hábitos (cumplimiento período vía S1+S2 transforms),
  metas (avance vía `GET /goals`), actividad (tareas completadas vía `tasks?view=`,
  eventos vía `GET /events?from&to`). **SIN PDF/Excel.**
- **S4 — progreso + score:** dashboard progreso personal (ahorro mensual + gastos +
  patrimonio simple numérico existente + progreso objetivos + hábitos + productividad)
  + puntuación visual por área (finanzas/hábitos/metas/productividad) + disclaimer fijo
  siempre visible. Sin conclusiones sensibles.

### Non-goals explícitos

- Búsqueda global: NO.
- PDF / Excel: NO (reportes solo pantalla).
- Push / email: NO (recordatorios siguen in-app; campanita intacta).
- Evolución del patrimonio (gráfico): NO — valuaciones INSERT-only, fuera de Fase 4.
- Intereses compuestos / proyecciones de deudas: NO.
- UUIDs / IDs técnicos visibles: NO (selectores por nombre).
- Floats en el wire: NO (decimales como string `NUMERIC(8,2)`, `scale ≤ 2`, `< 10^6`).

### Contratos heredados (de explore §1+§5, vinculantes en todos los slices)

- COP manual es-CO (`toNumber` solo en boundary, `formatMoney` es-CO).
- i18n ES tipado `t(key, vars)` — cero literales hardcodeados, copy sin culpa.
- `output: export` + `STATIC_DIR` + SPA fallback → todo client-side; charts con
  `next/dynamic(ssr:false)` (Recharts 3).
- Tokens `--color-*`, sin hex; `prefers-reduced-motion`; foco visible teclado.
- Bearer localStorage + single-flight 401.
- `deny_unknown_fields` (422); `direction/frequency/days/start_date` inmutables;
  `not_done` legacy solo lectura (rompe racha, no escribible).
- Composición FE-only + `EmptyState` ES + retry por widget (precedente dashboard-widgets).

## 4. Slices stacked-to-main (cada uno ≤ 400 líneas, review_budget 400)

| Slice | Contenido | Base |
|---|---|---|
| S1 historial-BE | endpoint rango + tests puros sin DB | `main` |
| S2 historial-FE | calendario + heatmap real + stats + evolución + comparar | S1 |
| S3 reportes | pantalla por período (4 bloques), `PeriodSelector`, sin PDF/Excel | S2 |
| S4 progreso+score | dashboard combinado + indicador visual + disclaimer | S3 |

Cada slice: TDD RED/GREEN/TRIANGULATE/REFACTOR + Judgment Day 2 jueces ciegos antes de merge.
Budget: `delivery_strategy: auto-chain, chain_strategy: stacked-to-main`.

## 5. Affected areas

- Backend: `backend/src/routes/habits.rs` (query nueva + handler + wiring `main.rs`);
  ninguna migración (tabla `habit_logs` + índices existentes soportan el rango).
- Frontend API: `frontend/lib/api/productivity.ts` (fetcher rango), `frontend/lib/dashboard/dashboard.ts`
  (keys `habits-history`, `reports-*`, `progress-*`).
- Frontend transforms: nuevo `habitStats` / `complianceRate` / `scoreByArea` junto a
  `frontend/lib/dashboard/transforms.ts` (patrón frontera pura).
- Frontend UI: `ProductivityScreens.tsx` (ancla `#calendario-habitos`), `HabitsHeatmap.tsx`
  (datos reales), nuevas rutas `/reportes`, `/progreso` (+ score dentro de progreso);
  `frontend/components/dashboard/widgets/*` como plantilla; `PeriodSelector` reutilizado.
- i18n: `frontend/lib/i18n.ts` (claves ES nuevas); formato `lib/i18n.ts formatMonth`.
- Specs: `habits-management` (historial/stats/evolución/comparar), `dashboard-widgets`
  (precedente composición), `frontend-dashboard` + `frontend-i18n` (constraints).
- Sin tocar: campanita/notificaciones, valuaciones INSERT-only, triggers
  (`set_task_completed_at`, goal-progress 0007), DELETEs de habits, `HabitRow`.

## 6. Risks & mitigations

| Riesgo | Mitigación |
|---|---|
| CI offline + argon2 pesado | tests puros sin DB en S1 (validación + SQL-string asserts, como `today_sql_resolves_status_and_streak_in_one_statement`); integración PG con skip-guard |
| Cap 16 cols sqlx (`HabitRow` 15) | query nueva dedicada para el rango, jamás `SELECT *` ampliado ni join que ensanche la fila |
| Streak SQL frágil (`date - bigint`, cast `::int`, puente `skipped_after`) | reutilizar forma probada de `streak`/`today`; mejor-racha/evolución copian el patrón, no lo reinventan |
| Triggers que revierten DELETEs / cleanup `DELETE FROM users CASCADE` | no tocar DELETEs en Fase 4; probar cleanup contra triggers vivos |
| Valuaciones INSERT-only | S4 no escribe valuaciones; patrimonio solo lectura del número existente |
| Vista anual pesada (bytes) | FE-only primero; endpoint `stats` dedicado solo si anual excede presupuesto (decisión diferida, no S1) |
| Tamaño Fase 4 > 400 líneas | 4 slices stacked-to-main, cada uno ≤ 400 líneas dentro de review_budget |
| Charts en `output: export` | `next/dynamic(ssr:false)` obligatorio; sin SSR de Recharts |
| Lenguaje con culpa / conclusiones sensibles | copy ES sin culpa + disclaimer fijo siempre visible en score |

## 7. Rollback

- S1: revert del commit del endpoint (sin migración → rollback limpio, cero datos afectados).
- S2–S4: FE-only → revert por slice; `heatmapCells` falso queda reemplazado solo tras S2
  verde (no mantener doble implementación). Flags/toggles no requeridos por ser vistas nuevas
  en rutas nuevas (`/reportes`, `/progreso`).

## 8. Success criteria

- `GET /habits/logs?from=YYYY-MM-DD&to=YYYY-MM-DD` devuelve multi-hábito user-scoped en
  1 round-trip; 401 sin bearer; 404 foráneo sin filtrar; 422 en formato inválido,
  `from > to`, rango > 366 días, unknown fields; `EXPLAIN` usa índice existente.
- Calendario 4-estados + heatmap mensual con datos reales (heatmap falso eliminado);
  stats base visibles (mejor racha, % cumplimiento, conteos); evolución S/M/A renderiza;
  comparar multi-serie funciona; copy ES sin culpa.
- `/reportes` por período (finanzas/hábitos/metas/actividad) solo pantalla, sin PDF/Excel.
- `/progreso` combina ahorro/gastos/patrimonio-número/objetivos/hábitos/productividad;
  score visual por área + disclaimer siempre visible, sin conclusiones sensibles.
- Contratos: COP es-CO, i18n tipado, tokens `--color-*`, `ssr:false` charts,
  `reducer-motion`, bearer single-flight 401, decimales string, inmutables respetados.
- Cada slice ≤ 400 líneas, CI verde, Judgment Day pasado antes de cada merge.

## 9. Next recommended

`spec` por slice (S1 primero: contrato `GET /habits/logs` + casos 401/404/422 + cap 366 +
orden + `EXPLAIN`), luego `tasks` + implementación stacked-to-main S1→S4.
