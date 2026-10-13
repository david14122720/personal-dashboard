# Solidificación, optimización y limpieza del Dashboard

Feature branch-less by owner order: **no git operations** (no commit, no push) — the
work-unit-commit rule of ODD is explicitly suspended for this feature (L2), until the owner
lifted it at the end (L14, which maps every task to its commit). Every task
closes with its own runtime evidence instead of a commit sha.

Working database: **production** (`192.168.50.120:5434/pdbname`), throwaway user only.

## Specs

**S1 — Entorno (verbatim, L2).** "Metodología: Organic-Driven Development (ODD). Analiza,
optimiza y aplica." / "Base de Datos: Mantén la conexión exclusiva con la base de datos de
PRODUCCIÓN." / "Control de Versiones: ESTRICTAMENTE PROHIBIDO realizar operaciones de git
(ni commit, ni push)." / "Usa el MCP de `context7` como tu fuente de verdad para actualizar
el código a las últimas versiones y aplicar las mejores prácticas actuales del framework." /
"Usa `playwright-cli` para verificar visualmente y funcionalmente que la página carga
correctamente tras las optimizaciones."

**S2 — Limpieza.** "Busca y elimina proactivamente todo el código muerto, variables sin usar,
importaciones huérfanas y componentes obsoletos."

**S3 — Peso y carga.** "Optimiza el peso de la página y los tiempos de carga (carga diferida
de assets, optimización de bundles, etc.) siguiendo las directrices de `context7`."

**S4 — Consola.** "Corrige cualquier bug silencioso o advertencia (warning) en la consola."

**S5 — Auditoría de queries.** "Audita las consultas (queries) que esta vista realiza a la
base de datos de producción."

**S6 — Optimización de queries.** "Optimiza la estructura de las consultas para evitar
cuellos de botella y reducir la sobrecarga del servidor (ej. evitar over-fetching, asegurar
el uso correcto de índices o joins)."

**S7 — Autonomía.** "Si encuentras código ineficiente, muerto o con errores, arréglalo,
mejóralo o bórralo automáticamente."

**S8 — Día del Juicio.** "Después de cada bloque de optimización (especialmente al borrar
código o modificar consultas a la DB), DEBES ejecutar tu proceso de verificación interno
("Judgment Day" / verify)." / "Si no estás 100% seguro de un borrado o cambio profundo,
confía en el resultado del Día del Juicio para confirmar si la funcionalidad se rompió antes
de dar el cambio por definitivo."

**S9 — Criterios de aceptación.** "1. El código del dashboard está limpio de código muerto y
cumple con las mejores prácticas dictadas por `context7`. 2. Las consultas a la base de datos
de producción han sido auditadas y optimizadas para máximo rendimiento. 3. El proceso de
verificación ("Judgment Day") se ejecutó exitosamente, confirmando que la página carga más
rápido, sin errores en consola, y que ninguna funcionalidad original se vio afectada."

**S10 — Bugs residuales autorizados.** L1 autoriza "soluciona todo los bugs que faltaban",
i.e. los residuales declarados en `odd/tasks/rediseno-integral-responsivo.md`: (a)
`/habits/today` deriva el día de `CURRENT_DATE` en UTC (DB en `Etc/UTC`) en vez del día de
Bogotá; (b) `e2e/notifications.spec.ts` depende del estado dejado por otra corrida; (c) el
helper del día de Bogotá está duplicado; (d) el bug de la misma clase en `/tasks?view=`
(`today`/`upcoming`/`overdue` usan `CURRENT_DATE`, `backend/src/routes/tasks.rs:59-61`).

**Fuera de alcance.** Cambios de comportamiento funcional pedidos como decisión del dueño
(loguear días pasados; rotación de la contraseña de la DB) y la migración `0017` (gated por
decisión del dueño; ver Hallazgos). No se agregan dependencias nuevas sin avisar.

## Hallazgos de la exploración (evidencia)

- **Código muerto real** (grafo de imports resuelto, raíces = las 13 rutas de `app/`):
  `components/ui/MetricCard.tsx` (nada lo alcanza), `components/ui/FlowChart.tsx`,
  `components/ui/TelemetryStrip.tsx` (+test), `components/productivity/HabitHistorySection.tsx`
  (+test) y — solo alcanzables desde ese árbol muerto — `components/ui/HabitsHeatmap.tsx` y
  `components/ui/HabitEvolutionChart.tsx`. Más `useHabitDayLogs` (`lib/api/dashboard.ts:115`) y
  `filterEventsByTimeView`/`countEventsByTimeView` (`lib/productivity/productivity.ts:192,203`),
  vivos solo por sus propios tests.
- **TS6133 con `--noUnusedLocals --noUnusedParameters`**: 5 hits reales en
  `app/dashboard/habitos/page.test.tsx:32`, `components/containers/DashboardHome.tsx:20,73`,
  `lib/api/dashboard.ts:213`, `lib/productivity/habitStats.ts:26`.
- **Drift de esquema prod vs migraciones**: el esquema de producción es idéntico al de
  `backend/migrations/0001..0016`; lo único ausente es `mcp_audit_log` (0017) y **es
  intencional**: el propio archivo declara que está gated por decisión del dueño y que el
  runtime usa un ring buffer en memoria. No se aplica.
- **Riesgo de test destructivo**: `cargo test` con `DATABASE_URL` apunta a prod y
  `backend/tests/migration_0011_removal.rs` / `migration_0013_gate.rs` ejecutan DDL destructivo
  (DROP TABLE de las tablas retiradas). **Nunca correr el suite completo contra prod**; los
  tests DB-gated se corren con filtro explícito por nombre.
- **Índices**: 41 índices en las migraciones, todos presentes en prod. Cobertura a revisar
  contra los predicados reales: `tasks` (`today`/`upcoming`/`overdue`/`done` filtran por
  `completed_at IS NULL` / `IS NOT NULL`, que ningún índice parcial cubre),
  `subscriptions` (listado sin filtro de `is_active`, el índice es parcial),
  `movements` (listado sin `LIMIT`).
- **Sin linter**: el repo no tiene ESLint (Next 16 ya no provee `next lint`); el guard de
  código muerto que se agrega es `noUnusedLocals`/`noUnusedParameters` en `tsconfig.json`.

## Tasks

| ID | Spec | Tarea | Ruta | Cierre |
|----|------|-------|------|--------|
| T1 | S10, S5 | Día de Bogotá en el backend: helper inyectable + `/habits/today` y `/tasks?view=` parametrizados por día, con tests RED→GREEN | worker `gentle-ai-worker` (backend/**, tests) | ✅ cerrada (L7 gates + L10 runtime); commit `627a158` (L14) |
| T2 | S2, S9 | Borrado de código muerto del frontend + guard `noUnusedLocals`/`noUnusedParameters` | worker `gentle-ai-worker` (frontend/components/**, frontend/lib/**, tsconfig.json) | ✅ cerrada (0 referencias a cada símbolo borrado, revisión propia en L13); commit `236d168` (L14) |
| T3 | S4, S9 | Medir la consola real en las 13 rutas (playwright-cli, 3 anchos) y corregir lo que aparezca | orquestador (medición) + worker (fix) | ✅ cerrada: 39/39 sin mensajes ni overflow (L6 + L10); commit `46ff3d4 (carga) + 8654f25 (remociones)` (L14) |
| T4 | S3, S9 | Peso y carga: baseline de build, directrices context7, lazy loading/bundles, remedición | orquestador (context7 + medición) + worker | ✅ cerrada (L7 + L10 + L11: `optimizePackageImports` medido y descartado); commit `c2e85cc + 46ff3d4` (L14) |
| T5 | S5, S6, S9 | Auditoría de queries del dashboard contra prod (EXPLAIN), over-fetching y migración de índices | orquestador | ✅ cerrada: 0018 **aplicada en prod** con OK del dueño (L9) y verificada por plan (L12); commit `063e02b` (L14) |
| T6 | S10 | Residuales: `e2e/notifications.spec.ts` habilita su propio widget; unificar el helper del día de Bogotá | worker | ✅ cerrada (L7 + smoke 15/15 en L10); commit `d86e30f + 627a158` (L14) |
| T7 | S8, S9 | Día del Juicio (dual a ciegas) + verificación final: vitest, tsc, build, playwright consola/overflow, e2e live | orquestador + `jd-judge-a` (+ `jd-judge-b` cancelado por el dueño) | ✅ cerrada con salvedad: judge A limpio, sin doble corroboración por orden del dueño (L13); commit `52c07aa (registro) — veredicto propio, sin commit dual: L13` (L14) |

Dependencias: T2 → T4 (mismo árbol del frontend). T1 y T2 son disjuntos y corren en paralelo.
T5 puede pedir una decisión del dueño antes de aplicar DDL.

## Log

**L1 (pedido original, verbatim).** "si solucina todo los bugs que faltaban y : # ODD Spec:
Solidificación, Optimización y Limpieza del Dashboard …" (spec completo transcripto en S1–S9).

**L2 (reglas de entorno, verbatim).** "Control de Versiones: ESTRICTAMENTE PROHIBIDO realizar
operaciones de git (ni commit, ni push)." → suspende el cierre por commit de ODD; cada tarea
cierra con evidencia runtime.

**L3 (hallazgos de exploración, 2026-10-12).** Grafo de imports computado sobre 156 archivos
de `frontend/`; `_sqlx_migrations` no existe en prod (las migraciones sólo se aplican por
`docker-entrypoint-initdb.d`, i.e. únicamente con el volumen vacío), por lo que el esquema de
prod se comparó contra una base scratch `postgres:18-alpine` con las 17 migraciones aplicadas:
diferencia = sólo `mcp_audit_log` (intencional). `SHOW TimeZone` en prod = `Etc/UTC`, que
confirma el bug S10a.

**L4 (auditoría de queries contra producción, 2026-10-12, T5).** EXPLAIN (ANALYZE,
BUFFERS, COSTS OFF, TIMING OFF) sobre las 10 consultas que la vista del dashboard dispara,
ejecutadas con el usuario real de producción (`psycopg2`, sesión `readonly=True`).

| Consulta | Acceso | Filas | Execution Time |
|---|---|---|---|
| `accounts` (listado) | Sort + **Seq Scan** accounts | 10 | 0.062 ms |
| `net_worth` | GroupAggregate + **Seq Scan** assets | 0 | 0.110 ms |
| `movements` (listado completo) | Sort + Bitmap Heap Scan `idx_movements_user_category` | 3 | 0.133 ms |
| `subscriptions` (listado) | Sort + **Seq Scan** subscriptions | 1 | 0.061 ms |
| `events` (rango) | **Index Scan** `idx_events_user_starts` | 0 | 0.030 ms |
| `tasks` today / upcoming / overdue | Sort + **Index Scan** `idx_tasks_user_status` | 0 | 0.086 / 0.045 / 0.037 ms |
| `goals` (listado) | Sort + **Index Scan** `idx_goals_user_status` | 0 | 0.032 ms |

Conclusiones honestas:
1. **La base no es el cuello de botella**: todo el dashboard se resuelve en 0.03–0.13 ms de
   ejecución y <1 ms de planificación. Con 1 usuario y 3 movimientos, el planner elige Seq
   Scan aunque existan índices; **no hay ganancia medible que mostrar hoy**. Lo que sí hay es
   alineación de predicados e higiene estructural.
2. **Over-fetching real (S6)**: `LIST_MOVEMENTS` no tiene `LIMIT` ni rango y el dashboard lo
   pide completo (`useMovements`, "no pagination in v1") para después filtrar en el cliente
   con `currentPeriodRange`. El índice `idx_movements_user_date (user_id, occurred_on DESC,
   created_at DESC, id DESC)` ya cubre exactamente ese ORDER BY, así que un rango
   `from`/`to` opcional es la optimización correcta y no rompe contrato (parámetro aditivo).
3. **Alineación de índices en `tasks`**: los tres views filtran `completed_at IS NULL` y
   `orders` y el índice parcial existente (`idx_tasks_user_due ... WHERE status IN
   ('pending','in_progress')`) **no puede** satisfacer ese predicado; el planner cae a
   `idx_tasks_user_status`. Propuesta aditiva (migración 0018, pendiente de OK del dueño para
   aplicar en prod): índice parcial `(user_id, due_date) WHERE completed_at IS NULL` y el
   equivalente `(user_id, completed_at DESC) WHERE completed_at IS NOT NULL` para el view
   `done`.
4. **Camino de autenticación (fuera de la vista, hallazgo de sobrecarga)**: cada request con
   API token ejecuta `UPDATE api_tokens SET last_used_at = now() WHERE token_hash = $1`
   (`backend/src/auth/middleware.rs:30-31`), i.e. una escritura por request. `sessions.token_hash`
   y `api_tokens.token_hash` son `UNIQUE`, así que las dos búsquedas están indexadas; la
   escritura por request es la única sobrecarga evitable (throttle por minuto). No se toca:
   es superficie de seguridad (riesgo alto) y queda como recomendación.

**L5 (T5b — medición a escala y decisión de índices, 2026-10-12).** Para no decidir
índices "a ojo" con una base de 0 filas, levanté una base scratch `postgres:18-alpine` con las
17 migraciones y datos sintéticos de escala realista (`ANALYZE` corrido): **60.000
movimientos, 30.000 tareas, 9.000 habit_logs, 8.000 eventos, 100 metas, 30 suscripciones**.
Medición `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF)` antes/después de cada índice
candidato.

**Ganadores (los únicos que van a la migración 0018):**

| Query | Antes | Después | Δ | Índice |
|---|---|---|---|---|
| `LIST_TASKS` (lista sin view, la que llama el widget del dashboard) | 17,46 ms (Sort 3672 kB + Seq Scan 30k) | 6,48 ms | **−63%** | `(user_id, sort_order, created_at)` |
| `view=today` | 2,18 ms (Seq Scan) | 0,96 ms | **−56%** | `(user_id, due_date) WHERE completed_at IS NULL` |
| `view=done` | 6,32 ms (Sort 1228 kB) | 4,39 ms | **−31%** | `(user_id, sort_order, created_at) WHERE completed_at IS NOT NULL` |

**Descartados por medición (no pagan su costo de escritura):**
- Índice covering en `habit_logs` `(habit_id, log_date DESC) INCLUDE (status, user_id)`: el
  planner **sí** lo elige (Index Only Scan) y aun así midió **9,008 ms contra 7,846 ms sin
  él**: el costo está en el re-sort de ~1558 filas por hábito dentro del CTE de racha, no en
  los accesos al heap. Arreglarlo requiere un cambio semántico (ventana acotada de racha),
  fuera del alcance de "sin cambio de comportamiento".
- `(user_id, due_date) WHERE completed_at IS NULL` para `view=upcoming`: **5,415 ms contra
  5,197 ms**; domina el sort de 8850 filas. El mismo índice se queda igual porque gana en
  `today`.

**Over-fetching cuantificado (no aplicado, con motivo):** la lista completa de movimientos
cuesta **43,92 ms / 60.000 filas** contra **1,067 ms / 995 filas** con un rango mensual — 41×
menos tiempo y 60× menos filas. Pero el único consumidor es el dashboard, que hoy hace **una
sola** request y filtra los períodos en el cliente de forma instantánea: mover el rango al
servidor cambiaría una request por carga por una request **por cada clic** en las píldoras de
período (Regresión de UX a cambio de trabajo de servidor en una query que tarda 0,13 ms con
los datos reales). Por eso **no se toca el wiring**: queda como recomendación medida, con su
disparador ("cuando haya paginación o el servidor MCP crezca en consultas de movimientos").

**Realidad de producción, para no exagerar el resultado:** con 1 usuario y 0 tareas, los tres
índices son seguro de crecimiento, no una mejora visible en la app viva. Y la migración
**no llega sola a prod**: el `docker-entrypoint-initdb.d` sólo corre con el volumen vacío y el
backend no llama a `sqlx::migrate!`, así que el apply en producción es un paso manual y
explícitamente autorizado por el dueño.

**L6 (T3 consola + T4 hallazgo de peso, 2026-10-12).** Infraestructura de verificación: usuario
descartable `e2e-throwaway@example.com` creado con `--create-user` en prod, backend debug
sirviendo `frontend/out` en `:3000` (`/health` 200), `playwright-cli` con la sesión `-s=pd`
(el token va a `localStorage["dashboard-token"]`, igual que la app).

**T3 — consola (cerrada).** Barrido de las **13 rutas** (`/`, `/login/`, `/dashboard/`, las 4
de finanzas/productividad/hábitos/progreso/reportes, las 3 de ajustes y `/404/`) a 1440 px más
`/dashboard/` a 390 px, con `page.on('console')` + `page.on('pageerror')` y medición de
`scrollWidth - clientWidth`:
- **0 mensajes de consola** (ningún warning, ningún error, ningún pageerror) en 13/13.
- **0 overflow horizontal** en las 13 a 1440 y en el dashboard a 390.
- **Falso verde descartado a mano**: el `body.innerText` muestra la sesión real
  (`ET E2E Throwaway / e2e-throwaway@example.com`) y el shell completo, así que las páginas se
  midieron autenticadas, no redirigidas al login.

**T4 — el hallazgo que sí pesa.** Medición en frío con `performance.getEntriesByType('resource')`
sobre `/dashboard/`: **729,7 KB transferidos en 64 requests, 680,7 KB de eso JavaScript**, y
—la parte importante— `curl -I -H 'Accept-Encoding: gzip, br'` sobre un chunk devuelve
`content-length: 16571` **sin ningún `content-encoding`**: el servidor ignora la negociación y
sirve todo crudo (el HTML son 39.988 B sin comprimir). En caliente la misma página baja a
5,5 KB, o sea que el caché ya funciona y lo que se paga es la primera visita.

Fix aplicado (medido antes/después en el Log L7): `compression-gzip` + `compression-br` en las
features de `tower-http` (**no es una dependencia nueva**, es la misma caja) y
`CompressionLayer::new()` como capa más externa de `assemble`, después de los headers de
seguridad, para que cubra JS/CSS/HTML estáticos, el fallback de la SPA y el JSON de la API.

Segundo lead, todavía sin acción: **6 archivos `woff2` se piden en todas las rutas**, incluidas
las que no usan la tipografía display del deck (`Plus_Jakarta_Sans` se declara en el layout
raíz y sólo la usan login y hábitos).

**T6 (parcial) — huso unificado**: nace `frontend/lib/time/bogota.ts` con la única constante
`BOGOTA_TZ`, y la usan `lib/finance/finance.ts` (`todayInBogota`), `ProductivitySections.tsx`
y `AppShell.tsx`; antes el literal `"America/Bogota"` estaba repetido en tres módulos, que es
exactamente cómo un formateador se desincroniza del resto de la app.

**L7 (T4 cerrado + gates, 2026-10-12).**

**Compresión — medido con GET, en frío, mismo contenido:**

| | Antes (servidor sin comprimir) | Después |
|---|---|---|
| `/dashboard/` carga fría — transferido | ~1546 KB (los mismos bytes que hoy decodifican) | **512 KB** |
| JavaScript | ~1281 KB decodificados | **371 KB** transferidos (−71%) |
| CSS | 91,5 KB decodificados | **14,9 KB** transferidos (−84%) |
| Total del barrido | — | **−67%** |
| Consola / overflow | 0 / 0 | 0 / 0 |

**Trampa de medición que casi me hizo reportar al revés**: `curl -I` (HEAD) **no** comprime —
`SizeAbove` evalúa el `size_hint` del body, que en un HEAD es 0, así que la respuesta pasa sin
`content-encoding` y **con el `content-length` original**. Concluí "no funciona" y estuve a punto
de revertir un cambio correcto: el GET da 200 con 4861 B contra 16571 B crudos. Regla: medir
compresión con GET y mirando status + tamaño, nunca con HEAD.

**Fuentes:** `Plus_Jakarta_Sans` se declaraba en el layout raíz con el `preload: true` por
defecto, así que el `<link rel="preload">` salía en **todas** las rutas y el navegador bajaba
27,6 KB de una tipografía que `font-deck-display` sólo usa en `/login/` y hábitos. Con
`preload: false` el `@font-face` sigue en el CSS y el archivo se busca cuando se usa:
`/dashboard/` pasó de 6 woff2/127 KB a **5 woff2/100,1 KB**, y `/login/` sigue bajando 6/127 KB
— o sea que el diseño de login y hábitos quedó intacto y la mejora sólo toca a quien no la usa.

**Gates de la tanda:** barrido de **13 rutas × 390/768/1440 = 39 corridas, 0 mensajes de consola
y 0 overflow**; `pnpm test` 52 archivos/655 tests verdes; `tsc --noEmit` exit 0; `pnpm build`
14/14 páginas; `env -u DATABASE_URL cargo test --locked` = **426 unit + 43 integración, 0
fallos** (paridad con CI, y el `Cargo.lock` con las features nuevas queda consistente para
`--locked`).

**L8 (smoke live, 2026-10-12).** Con el usuario descartable **sembrado por API** (6 cuentas, 2
suscripciones, 5 movimientos, 3 activos con valuación, 6 categorías, 3 metas, 3 tareas):
**15/15 verdes** (`E2E_SMOKE_LIVE=1 pnpm exec playwright test`, 1,2 min), incluidos los dos que
dependen de mi cambio y los gates que más pesan:
- `notifications.spec.ts` **2/2**, o sea que la precondición nueva del widget pasa en runtime.
- `productivity-layout.spec.ts` @390/768/1440 → gate responsivo del repo (overflow y áreas de
  toque ≥44px) verde.
- `guards.spec.ts` 4/4 (los cuatro guardias de auth), los cuatro widgets del home, y los shells
  de la página de finanzas.

**La primera corrida dio 13/15 y NO era una regresión: era precondición de datos, y se probó.**
Los dos fallos eran de `sections.spec.ts` (página de finanzas) y ambos pedían cosas que un
usuario vacío no puede renderizar — `Editar saldo` existe por cuenta y las filas
`Cancelar/Reactivar`/`Pagar` por suscripción. Verificación: por API el usuario tenía **0 en
todas las colecciones**; la sesión anterior había corrido 15/15 con el descartable *sembrado*
(6 cuentas/5 movimientos/2 suscripciones/3 activos, ver `odd/tasks/rediseno-integral-responsivo.md`),
y la decisión del dueño de mantener esa precondición está registrada desde entonces. Al sembrar
y repetir, 15/15. Conclusión honesta: el suite **no** se auto-siembra; quien lo corra contra un
usuario nuevo va a ver esos dos fallos, que no son defectos del código.

**L9 (T5 cerrado — DDL autorizado y aplicado en producción, 2026-10-12).** El dueño autorizó
el apply ("Aplicar 0018 en prod ahora"). Se ejecutaron exactamente las 3 sentencias
`CREATE INDEX IF NOT EXISTS` de la migración (comentarios `--` filtrados; 3/3 statements, sin
DDL adicional) contra `192.168.50.120:5434/pdbname` en **una única transacción con commit**:

- Antes: `tasks_pkey`, `idx_tasks_user_status`, `idx_tasks_user_due`.
- Después: + `idx_tasks_user_order (user_id, sort_order, created_at)`,
  + `idx_tasks_open_due (user_id, due_date) WHERE completed_at IS NULL`,
  + `idx_tasks_done_order (user_id, sort_order, created_at) WHERE completed_at IS NOT NULL`.

No hubo escrituras de datos, ni `DROP`, ni `ALTER`: sólo los tres índices aditivos. Prod no
tiene `_sqlx_migrations`, así que no hay bookkeeping que actualizar (el archivo completo queda
como fuente para CI y volúmenes nuevos). Rollback si hiciera falta: `DROP INDEX` de los tres
nombres nuevos, sin pérdida de datos.

**L10 (T7 — verificación runtime reproducible, 2026-10-12).** Entorno: usuario descartable
nuevo `e2e-solid@example.com` creado con `--create-user` y sembrado con
`odd/tasks/prod-seed-solidificacion.sql` (2 cuentas, 7 categorías, 7 movimientos, 2
suscripciones —una activa y una cancelada—, 3 activos, 3 metas, 5 tareas en los tres views,
3 hábitos con 15 logs y 3 eventos), backend debug `:3000` sirviendo `frontend/out` contra la
base de PRODUCCIÓN.

1. **Consola y overflow — 39/39 limpio.** Barrido nuevo con `playwright-cli` (sesión `pd`)
   sobre **13 rutas × 390/768/1440** con `console` por página y medición de
   `scrollWidth - clientWidth`: **0 mensajes de consola (0 errores, 0 warnings)** y
   **0 overflow** en las 39 corridas. `/login/` y `/` redirigen a `/dashboard/` estando
   autenticado (esperado); el cuerpo renderizado es el shell real con los datos del usuario
   descartable, no un redirect al login.
2. **Peso en frío, medido de nuevo.** Perfil de navegador nuevo (`--profile`, sin caché):
   `/dashboard/` = **278.140 B transferidos en 64 requests**, de los cuales **243.684 B son
   JS** y 7.142 B el HTML de navegación; el resto son las 9 respuestas de API del dashboard.
   Verificación independiente por `curl` con `Accept-Encoding: br, gzip` sobre los 11 chunks
   iniciales + la hoja de CSS + el HTML: **247.972 B (242 KB)**, contra ~1546 KB de la era
   sin compresión (L7). `content-encoding: br` confirmado en el HTML por GET (no por HEAD).
3. **Smoke e2e live — 15/15 verdes** (`E2E_SMOKE_LIVE=1`, 41,6 s): `notifications.spec.ts`
   2/2 (la precondición nueva de T6 pasa en runtime), `productivity-layout.spec.ts`
   @390/768/1440 (gate responsivo del repo), los 4 guardias de auth, los 4 widgets del home,
   los shells de finanzas y las dos specs que necesitan datos sembrados. **No hubo que
   re-sembrar nada ni hubo fallos de precondición**: el seed propio alcanzó.
4. **Gates de código otra vez, sobre el árbol final**: `tsc --noEmit` exit 0 · `pnpm test`
   **52 archivos / 655 tests verdes** · `pnpm build` **14/14 páginas** ·
   `env -u DATABASE_URL cargo test --locked` exit 0.

**L11 (T4b — `optimizePackageImports`, medido y descartado).** La guía oficial de Next.js
(vía context7, `/vercel/next.js/v16.2.9`) recomienda `experimental.optimizePackageImports`
para librerías grandes con barrel imports, y `recharts` es exactamente eso. Se probó con
evidencia antes/después: se agregó `optimizePackageImports: ["recharts"]`, se reconstruyó y
**el bundle salió byte por byte idéntico** (mismo hash de chunk: `14p6s8spjzy5l.js` 344.181 B;
total inicial crudo 825.345 B, 238.689 B por la red). Motivo: el chunk de recharts **ya está
tree-shakeado** (Sankey/RadialBar/Funnel/Treemap/Sunburst/RadarChart: 0 apariciones) y **ya
vive en un chunk perezoso** (ninguna parte de recharts viaja en el bundle inicial; los dos
consumidores usan `next/dynamic`). Config revertida para no dejar configuración muerta:
`frontend/next.config.ts` vuelve a estar idéntico a HEAD. Conclusión honesta: era una
optimización sin ganancia, y se descarta por medición, no por opinión.

**Fuentes de la misma ronda (context7, verificado contra el repo):** `subsets: ["latin"]` en
las 4 fuentes (`next/font` ya lo hace), `preload: false` sólo en la display font del deck
(coincide con el hallazgo de L7), `output: "export"` (ya está) y perfil de compresión de
tower-http (`gzip`/`br` ya habilitados, `CompressionLayer` como capa más externa). El índice
parcial `WHERE completed_at IS NULL` de 0018 es el patrón que documenta PostgreSQL 18
(«excluir los valores que no le interesan a la carga típica»).

**L12 (T5 post-apply — los índices existen, son válidos y son usables, 2026-10-12).**
Verificación del apply con `EXPLAIN (COSTS OFF)` sobre las cuatro formas que el read model del
dashboard dispara, en sesión `readonly`, con el usuario sembrado (prod tiene 8 tareas en total,
5 de ellas suyas):

| Forma | Plan natural en prod (8 filas) | Con `enable_seqscan = off` |
|---|---|---|
| listado sin view (la del widget) | Seq Scan + Sort | **Index Scan `idx_tasks_user_order`** |
| `view=today` | Seq Scan + Sort | Index Scan `idx_tasks_user_order` (+ filtro) |
| `view=upcoming` | Seq Scan + Sort | Index Scan `idx_tasks_user_order` (+ filtro) |
| `view=done` | Seq Scan + Sort | **Index Scan `idx_tasks_done_order`** |

Lectura honesta, sin inflar el resultado: **con 8 filas el planner elige Seq Scan y está bien**
(ese es el plan correcto a esta escala), así que el apply **no** es una mejora visible en la
app de hoy; lo que se verifica acá es que los tres índices son **válidos y usables** por el
planner para las formas reales, y que el ahorro medido (−63% / −56% / −31% en la base de 30k
tareas de L5) es alcanzable cuando la tabla crezca. Con `seqscan` apagado, `idx_tasks_user_order`
absorbe listado/`today`/`upcoming` (es el que además da el orden) y `idx_tasks_done_order` se
encarga del view `done`; el parcial `idx_tasks_open_due` se vuelve el ganador recién cuando el
filtro por `due_date` deja de ser gratis, que es exactamente el caso que midió L5.

**L13 (cierre, 2026-10-12).** Orden del dueño a mitad de la ronda de juicio, verbatim:
"frena el judge b creo que se quedo en bucle amigo mejor hadlo tu mismo sin dia del juicio
dale". Se canceló `jd-judge-b` (30 turnos / 50 tool calls sin cerrar) y **no se relanzó**:
la ronda de Día del Juicio queda **sin doble corroboración por decisión explícita del dueño**,
y así se declara en vez de maquillarla como juicio completo.

**Lo que sí devolvió el juicio, ronda 1 (juez único).** `jd-judge-a` (ciego, read-only, sobre
el patch congelado `sha256 95337f8d…`) devolvió `{"findings":[]}` — limpio, sin un solo
hallazgo — después de recorrer por su cuenta el grafo de imports desde las 13 rutas, validar
los borrados, la fecha de Bogotá, el orden de las capas de compresión, la migración 0018, y de
correr `tsc --noEmit`, Vitest (52/655) y `cargo test --locked` (426 + 43). El target se
re-verificó al cierre: **sha256 idéntico** al que leyó el juez, o sea que el veredicto cubre
exactamente el árbol que queda.

**Revisión final propia (sustituto acordado del juez B).** Leí el diff completo y verifiqué a
mano lo que un segundo juez habría tenido que corroborar:
- **Borrados**: 0 referencias en todo el repo (fuera de tests, `out/`, `node_modules`) a
  `useHabitDayLogs`, `filterEventsByTimeView`, `countEventsByTimeView`, `EVENT_TIME_VIEWS`,
  `MetricCard`, `TelemetryStrip`, `HabitHistorySection`, `FlowChart`, `HabitsHeatmap`,
  `HabitEvolutionChart`. Único hit de `FlowChart`: un comentario en `charts.test.tsx` que
  dice, correctamente, que se borró en T2.
- **`useHabitDayLogs` era el workaround, no la funcionalidad**: su propio docstring explicaba
  que existía porque `/habits/today` anclaba a UTC; con el backend parametrizado por día de
  Bogotá, borrarlo es el cierre del bug, no la pérdida de una feature.
- **`useUpdateLayout`**: el parámetro `cur` que se eliminó no se usaba en el cuerpo (la
  mutación reconstruye el objeto desde la respuesta); cambio sin efecto de comportamiento.
- **Fecha de Bogotá**: las tres vistas con día toman `$2` y ningún SQL de vista lee
  `CURRENT_DATE`; los dos SQL sin día (listado y `done`) no aceptan `$2` y los tests lo fijan
  en las dos direcciones. El test nuevo `today_status_follows_the_bound_day_not_the_db_clock`
  prueba el contrato con día fijo: `done` en D, `pending` en D+1, mismo reloj de DB.
- **Compresión**: `CompressionLayer::new()` como capa más externa de `assemble`, después de
  los headers de seguridad; `content-encoding: br` verificado por GET en HTML y en chunks.
- **Migración 0018**: sólo 3 `CREATE INDEX IF NOT EXISTS`, sin `DROP`/`ALTER`/DML; aplicada y
  verificada por plan (L12).

**Estado final de producción.** Usuario descartable nuevo (`e2e-solid@example.com`) y el
residual de la sesión anterior (`e2e-throwaway@example.com`) **borrados**; prod queda con
**1 usuario**, 0 tareas, 3 movimientos y 3 hábitos (los del dueño), más los 3 índices nuevos.
Servidor de verificación apagado. **Ninguna operación de git en toda la feature** (L2).

**Veredicto honesto, sin inflarlo.** Defectos confirmados: **0** (0 CRITICAL, 0 WARNING). La
única limitación es de proceso: el juicio no tuvo segunda opinión porque el dueño lo pidió así,
así que lo que hay es *un juez ciego limpio + mi revisión end-to-end + la verificación runtime
medida*, no un juicio dual cerrado. Criterios S9: (1) limpio y conforme a context7 — cumplido
y verificado; (2) queries auditadas y optimizadas — cumplido, con los 3 índices aplicados en
prod y la ganancia declarada como escala, no como milagro de hoy; (3) "carga más rápido, sin
errores de consola, sin funcionalidad rota" — medido: −68% de peso en frío, 0 mensajes de
consola en 39/39 corridas, 15/15 en el smoke live.

**Recomendaciones que quedan abiertas (medidas, NO aplicadas, sin tarea abierta):**
(a) el listado de movimientos sin rango/`LIMIT` cuesta 43,92 ms vs 1,067 ms con rango mensual
en la base de escala, pero el único consumidor filtra los períodos en el cliente: se cambia
"una request por carga" por "una request por clic", así que se deja con su disparador
("cuando haya paginación"); (b) el `UPDATE api_tokens SET last_used_at = now()` por request
(`backend/src/auth/middleware.rs:30-31`) es la única escritura evitable del camino caliente y
es superficie de seguridad: no se toca a las apuradas.

**L14 (commits y push, 2026-10-12).** Cambio de regla del dueño, verbatim: "bien has comit y push a
main y terminamos por ahora gracias". Se levanta la suspensión de L2 y la feature se entrega en
**8 commits por unidad de trabajo**, empujados a `main` (`f962654..8654f25`, fast-forward, sin
divergencia: el remoto estaba exactamente en el HEAD previo).

| Commit | Unidad | Qué entra |
|--------|--------|-----------|
| `627a158` | `fix(time)` | día de Bogotá en `/habits/today` y `/tasks?view=`, `BOGOTA_TZ` compartido, retiro del workaround `useHabitDayLogs` (T1, T6) |
| `236d168` | `refactor(frontend)` | borrado del código muerto + guard `noUnusedLocals`/`noUnusedParameters` (T2) |
| `c2e85cc` | `perf(backend)` | `CompressionLayer` gzip/brotli (T4) |
| `46ff3d4` | `perf(frontend)` | `preload: false` en la fuente del deck (T4) |
| `063e02b` | `perf(db)` | migración 0018: tres índices del read model + el rechazado documentado (T5) |
| `d86e30f` | `test(e2e)` | precondición propia del widget en `notifications.spec.ts` (T6) |
| `52c07aa` | `docs(tasks)` | este registro (doc, seed efímero y target de revisión congelado) |
| `8654f25` | `refactor(ui)` | remoción del buscador inerte y de los chips decorativos (orden posterior del dueño, L13/L14) |

Dos archivos tenían cambios de dos unidades (`AppShell.tsx`: constante de zona + buscador;
`habitos/page.test.tsx`: constante muerta + pill de hábitos) y se repartieron con staging parcial
por hunks (`git apply --cached`), verificado commit por commit con `git show`: cada commit queda
coherente y compila por sí solo.

**Verificación sobre el árbol ya commiteado** (no sobre el de trabajo): `tsc --noEmit` = 0 ·
`pnpm test` = **52 archivos / 654 tests** · `pnpm build` = 14/14 páginas. Working tree limpio,
`main` local y `origin/main` en el mismo commit.

**Nota de seguridad para el dueño (no bloqueante, no actuada).** La credencial de la base de
producción (`postgres://pdbuser:<DB_PASSWORD>@…`) ya está en archivos **trackeados** de este repo
(`CLAUDE.md`, `odd/design/.../DESIGN-SPEC.md`, `odd/design/.../VERIFY-RECIPE.md`,
`odd/tasks/accounts-transfers-login-calendar*.md|patch`, `odd/tasks/finance-panel-consolidation-delta.patch`,
`odd/tasks/rediseno-integral-responsivo.md`), o sea que está en el historial desde antes de esta
feature. Los archivos nuevos de esta entrega **no** la contienen (verificado con grep: 0
apariciones en el doc, el seed y el patch). Rotarla y sacarla del `.md` es una decisión del dueño,
no se tomó acá.
