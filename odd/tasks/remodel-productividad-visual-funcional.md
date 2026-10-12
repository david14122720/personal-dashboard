# Remodelación Productividad — visual + funcional

## Objetivo
Remodelar casi toda la página con foco funcional primero en Productividad (hábitos, tareas, metas, calendario, reportes, progreso), manteniendo datos reales del backend.

## Problema / por qué
Dueño pidió remodelación casi total, alcance visual + funcional, con foco en Productividad. Base actual: shells delgados (`ProductivityScreensShell`, `DashboardHomeShell`) + rutas separadas (productivity, progreso, reportes). Falta afilar dolores concretos de uso diario.

## Alcance autorizado
- Visual + funcional, foco Productividad. Backend solo si un flujo lo exige (sin migraciones por defecto).
- Fuente de verdad funcional: `objetivo.md` (check diario cumplido/no/omitido, racha actual/mejor racha/% cumplimiento, heatmap mensual, stats base, reportes solo en pantalla por período, sin PDF/Excel, sin culpa/verguenza, recordatorios solo in-app).
- No incluye por ahora: Dashboard principal, Finanzas, navegación global (siguientes slices si se aprueban).

## Slice hoy (2026-09-20) — decisión del dueño
- HOY solo tracker gráfico de hábitos: grilla con hábitos a seguir y cuadrito por día (color si se hizo, sin color si no). No lista de seguimiento.
- Finanzas y dashboard quedan para otra sesión. Lo demás de Productividad (tareas/metas/calendario/reportes) solo se toca si el tracker lo exige.

## Checklist (IDs estables)
- [x] P1 — Auditoría Hábitos actual DONE (worker read-only): lista vertical por fila hoy (`HabitsList`, `useHabitsToday` → `GET /habits/today`); marcar = `POST /habits/{id}/logs` + fallback 409→PATCH; heatmap actual single-hábito (42 celdas + `HabitsHeatmap`); fuente multi-hábito `GET /habits/logs?from&to` (máx 366d); transforms puros `habitStats`/`logsToCalendarCells` listos; NO hay grilla hábitos×días (hay que construirla). Riesgos: `days_of_week` (no programados ≠ sin-registro), timezone UTC vs pared local, 409 en POST duplicado.
- [ ] H1 — Diseño tracker gráfico DONE (decisión dueño): grilla del MES completo, filas = hábitos a seguir, columnas = días del mes, cuadrito con color si se hizo / sin color si no. Nombre: rastreador de hábitos. Interacción default: pasado solo visual, se marca hoy (extender a clic en pasado solo si el dueño lo pide).
- [x] H2 — Implementar tracker gráfico DONE (`156498d feat(productivity): rastreador de habitos month grid`, 4 archivos +451/-0, sin push): `HabitsTrackerGrid.tsx` (grilla mes, filas hábitos, columnas días, paleta existente, pasado visual + hoy clicable con POST→PATCH fallback, `#rastreador-habitos`, a11y grid, i18n `productivity.tracker.*` 11 claves) + test (5 tests) + wiring + i18n.
- [x] H3 — Verificación tracker DONE: writer `vitest run` 14/14 exit 0 + `tsc --noEmit` exit 0 + vecinas 32/32 exit 0; padre spot-check `tsc --noEmit` exit 0. RDD off (clone-local) → sin ceremonia nativa; assess worktree (untracked excluidos) = medium por `skills-lock.json` preexistente, `review_due: false`. Commit supera heurística 400 (~451, natural por componente+tests+i18n, no es cap).
- [x] H4 — Apartado único DONE (`32dbc66 feat(habits): standalone habitos section with month-grid tracker`, 7 archivos +160/-5, sin push): ruta `/dashboard/habitos/` con guard login + "Hábitos" en nav + `HabitsSection` (cablea `useHabitsToday` → grid existente, sin duplicar); grilla sacada de ProductivityScreens (`HabitsList` intacta); i18n `nav.habits`; e2e guards extendido. Verificación: writer 8/8 + vecinas 70/70 exit 0, tsc real (node typescript/bin/tsc) exit 0; padre spot-check 8/8 exit 0. Gotcha: `npx tsc` es señuelo en este repo, usar el binario de typescript.
- [ ] P2 — Propuesta resto Productividad (pendiente otra sesión si se aprueba).
- [ ] P3 — Remodel visual resto (pendiente).
- [ ] P4 — Mejoras funcionales resto (pendiente).
- [ ] P5 — Verificación + slice delivery (forecast vs 400 líneas, commits por unidad, push/PR según estrategia). Route: inline.

## Restricciones
- Stack: Next.js static export + Tailwind, español, COP solo para montos si aparecen, responsive (PC/tablet/móvil), tema claro/oscuro existente (`dashboard-theme`).
- Sin UUIDs/IDs técnicos visibles. Acciones cotidianas rápidas y simples.
- Tests y docs junto a cada comportamiento. Conventional Commits. Branch primero (estamos en `main`).

## Criterios de aceptación
- Hábitos: check diario en 1-2 toques, racha actual/mejor racha/% visibles, heatmap mensual legible, lenguaje sin culpa.
- Tareas/metas/calendario: flujos simples (hoy/próximas/vencidas/completadas), progreso visual por meta, compromisos visibles.
- Reportes/progreso: solo pantalla por período, sin exportación.
- Visual: premium minimalista, claro/oscuro sin FOUC, mobile funcional, sin regresiones de login/token.

## Checks aplicables
- Frontend: `pnpm --dir frontend test` (`vitest run`), `tsc --noEmit`, build static si se toca layout.
- Backend solo si se toca: `cargo test` desde `backend/`.
- TDD: modo sin resolver explícito en esta sesión (tests existen pero eso no lo activa). Fuente: package.json `test: vitest run`. Se registra como `unknown` hasta que el dueño lo defina; mientras tanto, checks funcionales ordinarios, sin inventar RED/GREEN.
- Delivery: forecast >400 líneas (remodel slice). Estrategia: `ask-on-risk` (default). Budget ~400 líneas authored por slice; si se supera, preguntar una vez chain strategy antes del próximo commit. Conteo acumulado desde work-unit commits.

## Progreso
- 2026-09-20: doc creado tras grilléo (alcance visual+funcional, foco Productividad). Slice hoy: solo tracker gráfico de hábitos; finanzas/dashboard otra sesión. Engram MCP bloqueado por 16 sesiones activas → dueño eligió manual-save CLI; espejo pendiente de reintento. Rama feature pendiente (crear desde `main` antes del primer write).

## Evidencia verificación
- (commits work-unit con identidad + `command: result` por task — pendiente)

## Siguiente paso
- Dueño decide push de `feat/habits-tracker-grid` (commit `156498d`) y apertura del PR contra `main`. Opcional después: toggle desmarcar hoy, clic en pasado, resto de Productividad.

## Rationale cambios aceptados
- Foco Productividad sale de grilléo explícito del dueño (visual+funcional → Productividad). Slice hoy narrowed a tracker gráfico (grilla con color, no lista); finanzas/dashboard otra sesión. Resto de Productividad queda pendiente.
