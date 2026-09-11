# Apply progress — S2 historial-FE (slice S2a entregado, S2b pendiente)

Rama: `p10-s1-historial-be` (S1 commiteado). S2 apilado SIN commitear; parent orquesta PR2.
TDD estricto ACTIVO (runner `pnpm vitest run` + `tsc --noEmit`). RDD off. JD diferido a cadena.

## Partición S2a/S2b (decisión de budget)

S2 completo estimado >400 líneas dif (transforms+tests+fetcher+i18n ≈ 300; sección UI + charts + calendario + edición heatmap ≈ +200).
Se entrega **S2a** (capa pura + fetcher + i18n + tests, ~300 líneas, dentro de budget) y queda **S2b** pendiente explícito
(`HabitHistorySection`, slot `#calendario-habitos`, evolución/comparar Recharts, eliminar `heatmapCells` falso).

## Completado S2a

- [x] 2.1 RED: `frontend/lib/productivity/habitStats.test.ts` creado (8 tests) — corrido sin `habitStats.ts`: falla (módulo inexistente, error de resolve). Evidencia RED.
- [x] 2.2 RED: mismo archivo — 4 estados, 42 celdas, `calendarStateToHeat` real-vs-racha. Incluido en el fallo RED inicial.
- [x] 2.3 GREEN: `frontend/lib/productivity/habitStats.ts` — `HabitLogEntry/HabitStats/CalendarCell/CalendarState/EvolutionGranularity/EvolutionSeries`,
  `habitStats`, `complianceRate`, `logsToCalendarCells`, `calendarStateToHeat`, `aggregateEvolution`. `vitest run habitStats`: 9/9 verde.
- [x] 2.4 GREEN: `HabitLogWire`, `HABITS_HISTORY_KEY="habits-history"`, `habitsHistoryKey` (null-key si rango inválido),
  `useHabitsHistory` (`revalidateOnFocus:false` vía `config` compartido, bearer + single-flight 401 vía `apiGet`) en `lib/api/productivity.ts`;
  nota anti-duplicación en `lib/api/dashboard.ts`; claves `habits.history/stats/compare/evolution` en `lib/i18n/es.ts` (tipadas vía `EsKey`, cero literales).

## TDD Cycle Evidence

| Ciclo | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|
| habitStats core | test sin módulo → error resolve (12:31) | 8/8 verde tras implementar (12:32) | puente skipped, corte missed/not_done, denom 0→0, máscara DOW, best 3 vs current 2 en `[done×3, missed, done×2]` | racha actual reescrita a doble pasada limpia (sufijo sin-registro + puente skipped); O(n) sin `scheduledDays` en bucle |
| calendario/heatmap | 42 celdas + 4 estados fallan sin módulo | verde | mes vacío → 42 `sin-registro`; anual 365 días; `calendarStateToHeat` mapea real, nunca racha | `stateFor` único para calendario y conteos |
| evolución/comparar | series S/M/A fallan sin módulo | verde | 2 hábitos por nombre, buckets semana(lunes)/mes/año, suma b=2 | `bucketFor` compartido, sin duplicar lógica de racha |
| fetcher key | — (contrato nuevo) | test null-key agregado → 9/9 verde | from>to→null, null→null, key exacta | reutiliza `config` + `apiGet`, cero cliente nuevo |

## Verificación

- `pnpm vitest run habitStats`: 9/9 verde.
- `npx tsc --noEmit`: limpio (exit 0).
- `pnpm vitest run` completo: 24 archivos / 243 tests verde (una corrida intermedia mostró 2 fallos flake en tests MSW de finanzas sin tocarlos; re-corrida en verde).
- `grep -rn heatmapCells frontend/lib frontend/components`: AÚN PRESENTE (falso) — eliminación reservada a S2b (requiere calendario real que lo reemplace).

## Desviaciones de diseño

- Ninguna en S2a. `daysOfWeek` usa 0=Sun..6=Sat (= `EXTRACT(DOW)` BE). `not_done` cuenta en `missed` y rompe racha. Racha actual ignora sufijo sin-registro (hoy aún no marcado) pero corta en `missed`/`not_done` explícitos — consistente con streak BE basado en logs.
- `frontend/lib/dashboard/dashboard.ts` no existe; la nota anti-duplicación se puso en `frontend/lib/api/dashboard.ts` (hook real).

## Pendiente S2b (tasks 2.5–2.7 `[ ]`)

- [ ] 2.5 GREEN: `<HabitHistorySection>` en slot `#calendario-habitos` (selector por nombre, calendario 42 celdas, stats, evolución S/M/A + comparar máx 4 Recharts `next/dynamic(ssr:false)`, reduced-motion, EmptyState+retry, tokens, aria ES); extender `HabitsHeatmap` a real y eliminar `heatmapCells` + actualizar `productivity.test.ts`.
- [ ] 2.6 TRIANGULATE: EmptyState UI mes vacío, `tsc` + suite verde.
- [ ] 2.7 REFACTOR: `grep heatmapCells` vacío, `ssr:false`, `revalidateOnFocus:false` verificados.
- [ ] 2.8 JD 2 jueces (parent).

## Archivos (S2a)

- Nuevo: `frontend/lib/productivity/habitStats.ts` (128 lín), `frontend/lib/productivity/habitStats.test.ts` (120 lín).
- Edit: `frontend/lib/api/productivity.ts` (+22), `frontend/lib/i18n/es.ts` (+30), `frontend/lib/api/dashboard.ts` (+2).
- Meta: `openspec/changes/p10-fase4-habitos-reportes-progreso/tasks.md` (2.1–2.4 `[x]` + nota S2a/S2b), este archivo.
- Total dif propio ≈ 300 líneas (dentro de budget 400). NO commiteado. S3/S4 no tocados.
