# Apply progress — S4 `/progreso` + score visual (slice S4 únicamente)

Branch: `p10-s3-reportes` (S1+S2a+S2b+S3 committed). S4 stacked UNCOMMITTED.
Strict TDD ACTIVE (`pnpm vitest run` + `tsc --noEmit`). RDD off. JD deferred to chain (parent-owned 4.4/5.2).

## TDD Cycle Evidence

| Cycle | Phase | Evidence |
|---|---|---|
| scoreByArea + ProgressScreens | RED | `scoreByArea.test.ts` (3 tests) + `ProgressScreens.test.tsx` (4 tests) failed pre-implementation: `Failed to resolve import ./scoreByArea` / `@/components/containers/ProgressScreens` |
| scoreByArea + ProgressScreens | GREEN | Implemented `scoreByArea.ts` + `ProgressScreens.tsx` + `progreso/page.tsx` + `progress.*` i18n; 7/7 pass (1 test bug fixed: `within().container` → element `innerHTML`); `tsc --noEmit` clean first pass |
| scoreByArea + ProgressScreens | TRIANGULATE | Full suite 257/257 green; `cargo test --bins` 408/408 green; greps: `heatmapCells` en `lib` vacío, `pdf\|excel\|xlsx` en reportes/progreso vacío, `#calendario-habitos` resuelve; cero escrituras a valuaciones en S4 |
| scoreByArea + ProgressScreens | REFACTOR | Diet rewrite `ProgressScreens.tsx` 344→223 líneas (impl slice 452→331, dentro de ≤400): `Block` único (loading/error/empty/retry), `statsOf` helper, imports densos; re-verificado 7/7 + `tsc` + suite 257/257 |

## Completed (persisted checkboxes flipped in `tasks.md`)

- [x] 4.1 RED — `scoreByArea.test.ts` (4 áreas etiquetadas, sin-datos→neutro, clamp 0–100 sin nota única) + `ProgressScreens.test.tsx` (4 indicadores + progressbars, neutro `Sin datos` con `aria-valuenow 0`, disclaimer poblado+vacío, patrimonio sin textbox/spinbutton/button/combobox ni texto valuar).
- [x] 4.2 GREEN — `scoreByArea.ts` puro junto a `habitStats.ts` (inputs 0–100 normalizados, pesos documentados solo como referencia sin agregado, `null`=sin datos); `progreso/page.tsx` (shell + redirect login) + `ProgressScreens.tsx` (ventana fija 30 días; monthly-flow ahorro+gastos + chart; patrimonio número solo lectura; goals+savings; hábitos global/mejores/pendientes `today_status=pending`/evolución semanal vía `aggregateEvolution`; productividad completadas + `advancedGoals` + próximos 14d vía `toUpcomingEvents`); disclaimer fijo siempre visible + copy ES sin culpa, i18n tipado.
- [x] 4.3 TRIANGULATE + REFACTOR — loading/error/empty ES + retry por sección (revalida solo sus keys), `formatMoney` es-CO/COP con `toNumber` solo en boundary, `--color-*` sin hex, `prefers-reduced-motion` (`animate={!reduced}`), foco visible, chart `next/dynamic(ssr:false)`, bearer single-flight vía hooks existentes (`revalidateOnFocus:false`); valuaciones intactas (cero POST/PATCH/DELETE en S4).
- [x] 5.1 Verificación cadena — `cargo test --bins` 408 passed/0 failed; `pnpm test` 257/257; `tsc --noEmit` limpio; ancla `#calendario-habitos` resuelve (ProductivityScreens.tsx:270); `/reportes` y `/progreso` renderizan ES sin literales (tests MSW); greps vacíos arriba.

## Files changed (new, uncommitted)

- `frontend/components/containers/ProgressScreens.tsx` (223 líneas)
- `frontend/components/containers/ProgressScreens.test.tsx` (111 líneas)
- `frontend/lib/productivity/scoreByArea.ts` (44 líneas)
- `frontend/lib/productivity/scoreByArea.test.ts` (28 líneas)
- `frontend/app/dashboard/progreso/page.tsx` (18 líneas)
- `frontend/lib/i18n/es.ts` (+46 líneas, sección `progress` + `score`)
- `openspec/changes/p10-fase4-habitos-reportes-progreso/tasks.md` (4.1–4.3, 5.1 → [x])
- `openspec/changes/p10-fase4-habitos-reportes-progreso/apply-progress-S4.md` (este archivo)

Budget: impl 331 líneas (dentro de ≤400 y del forecast S4 250–350); con tests 470. NO commiteado (instrucción explícita).

## Deviations from design

- Ventana fija últimos 30 días (`range30`, determinista vía prop `now`) en vez de `PeriodSelector`: S4 no pide selector de período y el diseño fija evolución semanal + próximos 14d; menos código, mismo `monthly-flow`/`habits-logs`/`events` en paralelo.
- Score productividad con escala visual documentada (5+ completadas ≈ 100) en vez de % sobre total: solo se lee `tasks?view=done` (contrato heredado S3); documentado en código como solo-visual, nunca fabricado cuando no hay datos (`null`→neutro).
- `advancedGoals` = `progress > 0` (incluye completadas): lectura directa del trigger-owned `progress`, sin filtro extra.

## Flake note (pre-existing, fuera de S4)

- `HabitHistorySection.test.tsx` (S2b, commiteado) falló 1/3 corridas de suite completa bajo carga y pasa aislado (4/4) y en re-corridas verdes 257/257; S4 no toca módulos compartidos salvo keys i18n aditivas. Misma clase que el flake `finance.test.tsx` documentado en S3.

## Remaining (not touched)

- [ ] 4.4 JD 2 jueces PR4 <!-- sdd-owner: parent -->
- [ ] 5.2 JD final de cadena <!-- sdd-owner: parent -->

## Status consumed

No structured SDD status block in parent prompt; store=openspec authoritative (`artifactStore: openspec` asumido por rutas `openspec/changes/...`; status nativo con `nextRecommended: resolve-via-engram` no aplica — hay directorio openspec). Tasks/design/specs leídos del change. `actionContext`/edit-roots respetados (solo superficies permitidas). No commits.
