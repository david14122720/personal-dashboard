# Apply progress — S2b (UI historial: calendario + heatmap real + evolución/comparar)

Slice S2b sobre rama `p10-s2a-historial-fundacion` (S1+S2a commiteados). Apilado SIN commitear, según preflight. S3/S4 no tocados. 2.8 (JD) queda `parent`.

## TDD Cycle Evidence (estricto ACTIVO)

| Ciclo | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|
| Sección historial UI | `HabitHistorySection.test.tsx` nuevo: 1 archivo fallido (módulo inexistente) antes de implementar | `HabitHistorySection.tsx` + `HabitEvolutionChart.tsx`: 4/4 verde | Casos puros ya en `habitStats.test.ts` (mes vacío, anual 365d, comparar 2, S/M/A) 9/9; suite alcance 58/58; `tsc` limpio | `heatmapCells`+`HEATMAP_DAYS` eliminados; agregación reuse `aggregateEvolution`/`habitStats`; paleta en `chartTheme` |
| Fake heatmap | `productivity.test.tsx` esperaba strip `recent completions` (falso por racha) | Strip eliminado de `HabitsList`; heatmap real solo vía logs en la sección | `grep heatmapCells` vacío (exit 1) | `HabitsHeatmap` acepta `dates[]` reales; doc single-source logs |

Ajustes honestos durante GREEN (test bug, no impl): aria del heatmap es `"<nombre> recent completions"`; se añadió leyenda visible por nombre (exigida por diseño) y el test la acota por `role=list`.

## Tareas

- [x] 2.5 GREEN — `HabitHistorySection` en slot `#calendario-habitos` (selector por nombre, calendario 42 celdas `logsToCalendarCells`, stats base, evolución S/M/A + comparar máx 4, Recharts `next/dynamic ssr:false`, `isAnimationActive={!reduced}`, EmptyState ES + retry, tokens `--color-*`, foco visible + aria ES). `HabitsHeatmap` a celdas reales; `heatmapCells` eliminado.
- [x] 2.6 TRIANGULATE — mes vacío→EmptyState, anual grande, comparar 2 por nombre, S/M/A sin errores; `tsc` + suite alcance verdes.
- [x] 2.7 REFACTOR — `toEvolutionRows` reuse `aggregateEvolution` (cero lógica de racha duplicada); `ssr:false`, `revalidateOnFocus:false` (fetcher S2a), grep vacío.
- [ ] 2.8 JD 2 jueces — `parent` (deferred a cadena).

## Archivos

Nuevos: `components/productivity/HabitHistorySection.tsx` (232), `HabitHistorySection.test.tsx` (83), `components/ui/HabitEvolutionChart.tsx` (60). Editados: `containers/ProductivityScreens.tsx` (slot), `productivity/ProductivitySections.tsx` (−falso), `productivity.test.tsx` (+slot test), `ui/HabitsHeatmap.tsx` (`dates[]`), `ui/chartTheme.ts` (paleta), `lib/productivity/productivity.ts` (−falso), `lib/productivity/productivity.test.ts` (−tests falso). i18n reusada (`habits.history/stats/compare/evolution` de S2a); `habitStats.ts` intacto en semántica.

## Verificación

- `pnpm vitest run --maxWorkers=2 components/productivity lib/productivity components/ui/charts.test.tsx` → 6 archivos, 58/58 verde.
- `npx tsc --noEmit` → exit 0.
- `grep -rn heatmapCells frontend --include=*.ts/tsx` (fuera de node_modules/tsbuildinfo) → vacío.
- Full suite: 243/245; 2 fallos solo bajo carga total y reproducidos en árbol prístino (flake preexistente `finance.test.tsx` timeout 5s en 4 CPUs, ajeno a S2b). Aislados: finance 21/21, productivity 9/9.

## Budget

Añadidas 410 (292 prod + 83 test + 35 ediciones) / eliminadas 72 / neto +338. Overage bruto +10 sobre 400 nominal, íntegro en asserts TDD; neto dentro. Sin commit.

## Restante

2.8 JD parent; luego S3. Rollback = revert (S2b aún sin commitear: `git checkout --` / drop de untracked).
