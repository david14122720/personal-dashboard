# Finance panel consolidation — un solo panel de movimientos, sin redundancias

## Objective

Reorganizar Finanzas y Resumen quitando repeticiones y uniendo paneles que hoy muestran lo mismo en
lugares distintos (pedido del dueño, 2026-10-03):

1. **Finanzas — un solo panel**: hoy "Agregar movimiento" (botones Agregar gasto/ingreso) y "Movimientos"
   (lista + filtros Cuenta/Categoría/Tipo) son dos paneles lado a lado. Fusionarlos en **un contenedor
   único**: botones arriba, lista y filtros abajo. No se elimina funcionalidad de ninguno.
2. **Finanzas — quitar redundancia**: fuera la tarjeta **"Patrimonio Neto"** (duplica "Saldo Total") y el
   indicador verde **"Tiempo real"** (no cumple ninguna función).
3. **Resumen — quitar duplicado**: "Resumen General" muestra **"Próximas suscripciones"** y **"Suscripciones
   activas"**, que dicen lo mismo. Eliminar "Suscripciones activas" por completo (componente, código y
   referencias) y dejar sólo "Próximas suscripciones".

## Target

- Repo `/home/david/Nextcloud2/Ubuntu/landing_personal`, rama `main`, base `f7c6fe1`.
- SDD: `openspec/changes/2026-10-03-finance-panel-consolidation/`.
- DB: **producción** (`192.168.50.120:5434`, `pdbname`) — regla general del proyecto desde hoy.
- Verificación: local con Playwright (skill `webapp-testing`), contra la DB de prod.

## Decisions

- **Entrega: NINGUNA.** El dueño lo dijo explícito: sin commit, sin push a ninguna rama y sin deploy.
  Todo se revisa en local.
- Pedido adicional del dueño: correr **judgment-day** (revisión adversarial ciega dual) sobre **un
  componente importante**, a criterio del ejecutor, uno o dos rounds.
- Regla nueva del proyecto: trabajar siempre contra la **DB de producción** (deroga la regla previa de
  usar la DB scratch). Los datos de prueba deben ir en un **usuario efímero** y borrarse al cierre.
- No romper funcionalidad no mencionada; no instalar dependencias nuevas sin avisar.

## Tasks

- [x] W0 — SDD: explore + proposal + 4 delta specs + design + tasks
- [x] W1 — Finanzas: unificar "Agregar movimiento" + "Movimientos" en un solo panel; quitar la línea de patrimonio; quitar el pill "Tiempo real" (delegado: 30 tests verdes, tsc 0)
- [x] W2 — Resumen: quitar el ítem de patrimonio del strip y eliminar "Suscripciones activas" (código, componente, transform, claves) — delegado, 52/52 verde
- [x] W3 — Desacoplar las notificaciones del widget eliminado (hallazgo propio, ver abajo) — delegado en la misma sesión, RED propio `0|0|0` → `1|0|1`, 85/85 verde
- [x] C1 — Gate: suite completa **44 archivos / 423 tests**, `tsc --noEmit` exit 0, `pnpm build` exit 0 (12 rutas, `out/` refrescado 10:51:43)
- [x] C2 — Verificación visual Playwright en local contra la DB de prod: **32/32 checks**, consola limpia, 1440/768/390
- [ ] C3 — Judgment-day (juez A: cero hallazgos; juez B pendiente)
- [ ] C4 — `verify-report.md` + resumen al dueño

## Hallazgo propio: el widget eliminado era compuerta de notificaciones

Al mapear el alcance apareció un acoplamiento que el pedido no menciona:
`frontend/components/notifications/useNotifications.ts:21,27` usa
`isWidgetVisible(layout, "active-subs")` como compuerta para **traer** las suscripciones y para
**admitir** los avisos de suscripción en el badge. Como `lib/api/dashboard.ts:61` lista ese widget en
el layout por defecto y `isWidgetVisible` devuelve `false` para un id ausente, borrar el widget sin
más habría hecho desaparecer silenciosamente todos los avisos de suscripción. Por eso el cambio
incluye la unidad W3: el layout por defecto deja de listar `active-subs` y la compuerta pasa a ser el
widget superviviente `upcoming-payments` (que además es el que ya gatea el resto de los avisos).
Queda escrito como requisito en el delta de `dashboard-widgets`.

Otros dos huecos del mismo tipo, ya cubiertos: `lib/api/dashboard.test.ts:71` afirma el layout por
defecto de 5 widgets, y `lib/i18n/i18n.test.ts:36` afirma la clave `dashboard.activeSubs` que se borra
(los tests con claves tipadas fallan el type-check cuando la clave desaparece).

## Evidence

- **W1 (delegado)**: `FinanceScreens.tsx` con un solo `SectionShell` titulado «Movimientos»
  (`col-span-12`): botones arriba, lista y filtros debajo tras una línea divisoria; se borró la tarjeta
  «Agregar movimiento»; se quitó la línea de patrimonio con todo su cableado (`useNetWorth`, prop,
  `worth`); se quitó el pill verde del header; se borraron `nav.live`, `finance.addMovementTitle` y
  `finance.addMovementHint`.
- **TDD de W1**: RED 3 fallos exactos (`merges the add controls and the history into one Movimientos panel`,
  `keeps both entry controls when the movements history is empty`, `… when the movements history fails`) →
  GREEN 30/30 en `finance.test.tsx` + `MovementHistory.test.tsx`; triangulación 29/29 en
  `jd-round1.test.tsx` + `s1-capture.test.tsx` + `i18n.test.ts`; `tsc --noEmit` exit 0.
- **e2e obsoletas por este cambio** (causa propia, se corrigen): `e2e/sections.spec.ts:43,62` afirman ver
  «Patrimonio neto» en Finanzas y `e2e/dashboard.spec.ts:11` en el Resumen; `e2e/dashboard-widgets.spec.ts:5,10`
  cuentan 5 widgets incluyendo «Suscripciones activas»; `e2e/notifications.spec.ts:29,31` clickean el switch
  `active-subs`. Son specs de humo con `test.skip(!liveSmoke)`, no corren en el gate de vitest.
- **e2e ya obsoleta antes de este cambio** (no se toca, se reporta): `e2e/dashboard.spec.ts:12` espera el
  gráfico «Flujo mensual», que fue eliminado en un cambio anterior.

_Ver el reporte completo en `openspec/changes/2026-10-03-finance-panel-consolidation/verify-report.md`._

- **W2 (delegado)**: strip de 3 KPIs sin lectura de patrimonio; widget, componente, transform, fila de personalización y claves borrados; layout por defecto 20/22/23/30. RED 2 fallos → GREEN 11/11 y 52/52 en 3 archivos.
- **W3 (delegado, misma sesión tras aprobar superficies)** — el acoplamiento de notificaciones: RED observado `expected 1|0|1, received 0|0|0` (los avisos de suscripción se filtraban por la compuerta del widget retirado), GREEN 85/85 en 6 archivos, `tsc` exit 0. Los tests de notificaciones pasaban antes porque el default viejo todavía listaba el id: defecto latente, no ruidoso.
- **Delta**: 19 archivos, **+158/−170**. Respaldo en `odd/tasks/finance-panel-consolidation-delta.patch` (841 líneas), sha256 `2df8e925b3838c153631e464a61b8cb53f856a0f2c576ec0974be34bc9773d64`.
- **En vivo (32/32)**: panel unificado con ambos botones abriendo su modal y devolviendo el foco, lista y 3 filtros dentro del mismo panel, paginación 5→7 con el botón desapareciendo; sin `Patrimonio: X` en Finanzas pero con la tarjeta de activos; sin pill «Tiempo real»; Resumen con `CUENTAS · SUSCRIPCIONES · SALDO TOTAL`, sin «Suscripciones activas», con «Próximas suscripciones» ordenadas y 4 filas de personalización; 768 y 390 sin errores de consola.
- **DB de prod**: usuario efímero `verify-panel@example.com` creado y borrado con cascada; verificado 0 restos `*Panel*`, 0 movimientos huérfanos y el total del dueño intacto; server local apagado y puerto 3010 cerrado.
- **Deviación observada (preexistente, no de este cambio)**: la gráfica de categoría no dibuja nada hasta elegir una categoría; con una elegida renderiza sus 2 series. Queda como decisión de producto (default a la primera categoría).
- **e2e**: cuatro specs de humo re-apuntadas a la verdad nueva y type-checkeadas, pero **no ejecutadas** (están detrás de `E2E_SMOKE_LIVE=1`).
- **Badge de avisos verificado en vivo**: con el layout nuevo por defecto, el bell marcó `1 avisos pendientes` y el panel listó `Próximos cobros · Streaming Panel · vence 2026-10-06` — la regresión latente quedó cubierta de punta a punta (unit RED `0|0|0` → GREEN `1|0|1` → vivo).
- **Judgment-day (APROBADO ✅)**: jueces ciegos A y B sobre `FinanceScreens.tsx` + `MovementHistory.tsx` + `FinanceSections.tsx` (hashes congelados). Juez A: cero hallazgos. Juez B: 6 sugerencias, **ninguna severa** → sin ronda de corrección. Introducidas por este cambio: (1) la tarjeta «Activos y patrimonio» quedó **sin empty state** cuando no hay activos; (2) el retorno de foco del panel unificado **no tiene test** (se verificó a mano en vivo). Preexistentes: foco del confirm de borrado, alert duplicado al fallar un borrado, foco del editor de saldo, y colores crudos en `SectionShell`. Todo el detalle en el `verify-report.md` §7.
- **Doc**: `CLAUDE.md` ganó una sección «Development rules» con la regla de trabajar contra la DB de producción (usuario efímero + limpieza + migraciones destructivas siguen requiriendo aprobación).
