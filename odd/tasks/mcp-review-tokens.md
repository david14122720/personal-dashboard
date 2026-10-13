# MCP Review + Tokens Security — ODD

## Objetivo
Revisar y testear completamente el servidor MCP (`mcp-dashboard/`), dejarlo usable al 100% por agentes externos (Hermes/OpenCode/otro cliente MCP + Claude via Anthropic), y auditar/mejorar la seguridad del sistema de tokens. Decisión: se hace, sin commit/push/deploy.

## Problema / Por qué
Mapa inicial (2026-10-05, explorer read-only): MCP vive en `mcp-dashboard/src/` (Express + `@modelcontextprotocol/sdk@1.30.1`), 39 tools; hábitos expone escritura (debe ser solo lectura); faltan Finanzas pedidas (movements/transfers); sin tools de Config/Dashboard; sin Anthropic SDK; tokens bien en entropía/hash/listado parcial/revoke pero sin rate-limit en `/api/tokens` ni en MCP; sin audit log; MCP sin tests.

## Alcance autorizado (dueño 2026-10-05)
- Finanzas FULL: añadir gasto/ingreso, editar/eliminar movimiento, editar saldo, mover dinero entre cuentas, crear/eliminar cuentas, crear/eliminar categorías. Consultar todo (cuentas, movimientos, gráficas, suscripciones).
- Productividad FULL: CRUD tareas y eventos. Consultar calendario y listas.
- Configuración FULL, incluyendo gestión de tokens y ajustes de seguridad.
- Hábitos SOLO LECTURA: consultar/ver + progreso. Cero tools de escritura (crear/editar/eliminar/marcar).
- Dashboard solo lectura.
- SDKs: oficial MCP (discovery/schemas/respuestas) + compat Anthropic (descripciones claras para cualquier agente). No instalar deps nuevas sin avisar.
- Tokens: entropía segura, hash en DB, revocación inmediata, listado parcial, rate-limit. Proponer audit log simple y mostrarlo al final para decidir.
- SDD + DB producción con usuario efímero borrado al final. Todo en local.

## Restricciones duras
- No romper funcionalidad existente fuera del alcance.
- No nuevas dependencias sin aviso previo al dueño.
- NUNCA escribir valor real de tokens en repo/commits/logs/respuesta — solo nombre de var env (`PERSONAL_DASHBOARD_TOKEN`, etc.).
- NO commit, NO push (ninguna rama), NO deploy. Revisión en local.
- Migraciones destructivas: siguen necesitando aprobación explícita (regla base del proyecto).

## Checklist (IDs estables)
- [ ] T1 SDD spec del alcance por área + criterios hábitos-read-only (route: delegated direct explorer ya hecho; trigger: mapping)
- [x] T2 Finanzas: completar tools faltantes (movements CRUD, transfer/mover, saldo, categorías CRUD, consultas) (route: delegated direct writer; trigger: writer 2+ files) — DONE 2026-10-05: 8 tools nuevas en `mcp-dashboard/src/tools.ts` (Zod runtime + inputSchema manual + dispatch juntos): `add_expense`, `add_income` (POST /api/movements con direction fija), `list_movements`, `get_movement`, `update_movement` (PATCH; transfers 422 backend → documentado borrar+recrear), `delete_movement` (también borra transfers), `transfer_money` (POST /api/movements/transfer), `get_subscription` (lectura suscripciones); saldo/cuentas ya existían (`update_account` balance, `create/delete_account`) verificados contra `backend/src/routes/accounts.rs`; 35→43 tools; `typecheck`+`build` limpios; `tools/list` en vivo confirma schemas claros. README finanzas actualizado. Gaps backend (NO implementados, requieren cambio backend/migración fuera de alcance): G1 categorías CRUD sin endpoint (backend solo GET /api/categories, `categories.rs` read-only) → `list_categories` queda read-only; G2 gráficas/resúmenes sin endpoint agregado (sin /stats en `main.rs`; solo strings legacy en allowlist de tests) → construir client-side desde `list_movements`. Sin commits (prohibido en esta tarea).
- [x] T3 Productividad FULL + Config FULL + Dashboard read (route: delegated direct writer) — DONE 2026-10-05: productividad ya completa sin cambios (tasks 5: `list/get/create/update/delete_task`; events 5: `list/get/create/update/delete_event`, verificados contra `backend/src/main.rs:149-168`); Config 5 tools nuevas en `mcp-dashboard/src/tools.ts` (triple Zod + inputSchema + dispatch): `list_tokens` (GET /api/tokens, solo metadata id/name/prefix/scopes/timestamps, sin secreto ni hash), `create_token` (POST /api/tokens solo-sesión, raw `pd_...` una vez con no-store, aviso SENSITIVE), `revoke_token` (DELETE /api/tokens/{id}, inmediato e idempotente), `get_preferences` (lee `GET /api/me` y devuelve `preferences`; sin GET dedicado en backend), `update_preferences` (PATCH /api/me/preferences, parcial validado, 422 no escribe); Dashboard `get_dashboard_summary` como composición client-side (accounts+movements+tasks?view=today+habits/today, sin endpoint agregado); 43→49 tools; `typecheck`+`build` limpios; `tools/list` en vivo confirma las 6 nuevas con schemas requeridos visibles y sin `token_hash`/secreto en lista. Gaps (NO implementados, requieren backend nuevo fuera de alcance): G3 sin `GET /api/me/preferences` dedicado → `get_preferences` compone desde `/me`; G4 sin endpoint agregado `/stats` ni `/dashboard` en `main.rs` (layout frontend-only) → composición client-side sin totales server-side. Sin commits (prohibido en esta tarea).
- [x] T4 Hábitos a solo lectura: quitar `create_habit/update_habit/delete_habit/create_habit_log`, verificar rechazo (route: delegated direct writer) — DONE 2026-10-05: removidos los 4 entries + schemas Zod (`CreateHabitSchema`, `UpdateHabitSchema`, `CreateHabitLogSchema`) y el helper `dateString` (quedó sin uso) en `mcp-dashboard/src/tools.ts`; README hábitos pasa a read-only (`list_habits`, `get_habit`, `habits_today`, `get_habit_streak`); 39→35 tools; `typecheck`+`build` limpios; `tools/list` en vivo confirma solo lectura y `tools/call create_habit` responde `isError:true` con `unknown tool: create_habit` (manejo existente en `src/index.ts`, sin 500).
- [x] T5 SDKs: discovery/schemas claros, compat Claude sin fricción, sin instalar nada sin aviso (route: delegated direct writer; si pide SDK nuevo → preguntar antes) — DONE 2026-10-05: discovery verificado sin cambios (`mcp-dashboard/src/index.ts`: `tools/list`+`tools/call` vía SDK 1.30.1, `isError:true` en errores incl. `unknown tool`, sesiones UUID `randomUUID`+`UUID_RE`, `GET /healthz` 200 `{ok:true}`; `client.ts` per-request sin estado global); schemas mejorados en `mcp-dashboard/src/tools.ts` (helper `enumProp` + `minProperties:1` en `update_preferences`; `enum` en `list_tasks.view`, `create/update_task.priority|status`, `create/update_goal.status` alineando Zod→inputSchema; descripciones EN claras con endpoint+requeridos+formatos UUID/YYYY-MM-DD/RFC3339+ejemplos mínimos en `login`, tasks×5, goals×5, events×5; T2/T3 ya claras sin tocar; hábitos/notes/catálogos/cuentas intactos como referencia); 49 tools intactos; `typecheck`+`build` limpios; `tools/list` en vivo confirma 49 y descripciones+required claros en gasto/tarea/transfer/token/dashboard. Anthropic: schemas actuales son JSON-Schema válido para Claude tool-use vía conector MCP (type object + properties + required/enum) → sin SDK necesario en servidor; NO instalado `@anthropic-ai/sdk` (prohibido sin aviso). Propuesta diferida (no instalar): paquete `@anthropic-ai/sdk`, versión ninguna (pinear última estable solo si el dueño aprueba un futuro cliente de ejemplo Claude directo), para: ejemplo de cliente directo Claude tool-use únicamente. Sin commits (prohibido en esta tarea).
- [x] T6 Seguridad tokens: auditar + implementar faltantes (rate-limit tokens/MCP, revoke inmediato verificado, listado parcial ya OK) (route: delegated direct writer) — DONE 2026-10-05: auditoría confirma entropía CSPRNG 256-bit (`rand 0.10 ThreadRng` ChaCha12), hash SHA-256 solo-hash-en-DB, prefijo 8 display-only, creación solo-sesión, listado sin secreto, revoke inmediato sin caché (lookup fresco a DB por request); implementado rate-limit `POST /api/tokens`: 10 mints exitosos/usuario/hora rodante (in-process single-replica, DD5; `GET`/`DELETE` sin presupuesto para no throttlear revokes; sin rate-limit al uso: 256-bit no adivinable + DoS legítimo); `GET last_used_at` se deja (solo escribe con uso real de API token, con sesión no hay write); sin migraciones, sin deps nuevas, sin tocar `mcp-dashboard/` (revoke aplica vía backend). Evidencia: `cd backend && cargo test` 413+3+6+10+5+7+5+7 pass (incl. nuevos `tokens_revoked_token_fails_closed_immediately_via_handlers` crear→revocar→usar=401 y `tokens_create_is_rate_limited_per_user` 3er mint=429 `RATE_LIMITED`+`Retry-After` sin `pd_` en body + nada escrito; 4 unit tests limiter). Nota: `openspec/changes/2026-10-05-mcp-review-tokens/t6-token-security.md`. Sin commits (prohibido en esta tarea).
- [x] T7 Audit log simple (opcional): proponer + implementar mínimo mostrable (route: delegated direct writer, solo si no ensancha scope sin aval) — DONE 2026-10-05: diseño tabla aditiva `mcp_audit_log(id, occurred_at, user_id, token_id NULL, token_prefix, tool, success, error_code NULL, request_id)` en `backend/migrations/0017_mcp_audit_log.sql` (solo `CREATE TABLE IF NOT EXISTS` + índices, NO aplicada a prod, con query de ejemplo); implementado vía MCP en memoria (sin migración prod): `recordAudit`+ring buffer 200+`tokenPrefixForLog`+tool read-only `list_audit_log` en `mcp-dashboard/src/tools.ts`, hook en cada `tools/call` en `src/index.ts`; NUNCA raw/hash/args/bodies; 49→50 tools; `typecheck`+`build` limpios; en vivo: `tools/call create_habit` → `isError:true` + queda logueado (`UNKNOWN_TOOL`), `list_audit_log` devuelve la fila. Cómo verlo: arrancar MCP, llamar cualquier tool, luego `list_audit_log` (ej. `{"limit":10}`). Fila ejemplo: `{"occurred_at":"2026-10-05T17:20:04.083Z","tool":"create_habit","success":false,"error_code":"UNKNOWN_TOOL","token_prefix":"none","request_id":"dd97410c-..."}` (prefijo enmascarado, sin secretos). Nota: `openspec/changes/2026-10-05-mcp-review-tokens/t7-audit-log.md`. **Decisión pendiente del dueño**: ¿se queda el buffer efímero (se resetea al reiniciar) o se aplica la migración 0017 para log durable? Sin commits (prohibido en esta tarea).
- [x] T8 Testing e2e real con SDK (cada tool, casos: gasto, tarea, mover dinero, intento hábito que debe fallar, errores claros) (route: delegated direct per-action workers) — DONE 2026-10-05: rerun verde tras fix G5 + fixture G6. SUMMARY total=43 ok=43 fail=0 (0 FAIL, tabla real sin secretos abajo). Fix G5: `fmt` en `mcp-dashboard/src/tools.ts` mapea `undefined` (204/vacío de `apiDelete`) a `{"ok": true}` — 1 punto central, cubre todos los DELETE con 204 por simetría (task/account/movement/goal/event/note) sin tocar backend ni el resto de tools; `typecheck`+`build` limpios. Fixture G6: 2 categorías kind=finance por SQL directa SOLO para el usuario efímero (sin POST /api/categories, decisión del dueño pendiente — G1 sigue vigente como gap backend); teardown en cascada al borrar el usuario. Tabla real del rerun (sin secretos):
  - IN PROGRESS 2026-10-05 (worker, opción A dueño): primer run real con env efímero (backend PORT 3399 + MCP 3398, usuario efímero vía `--create-user`, token de prueba vía `POST /api/tokens`, sin token del dueño). Base verde (`typecheck`+`build` limpios, 50 tools); script en `/tmp/t8-mcp-e2e.mjs` (conservado para rerun, borrar tras run verde). RESULTADO: SUMMARY total=38 ok=30 fail=8 → NO DONE. Tabla real de fallos (sin secretos):
    | tool/caso | status | nota exacta |
    |---|---|---|
    | list_categories/expense-category | FAIL | no seed categories (usuario nuevo, 0 categorías) → add_income/add_expense SKIPPED en cascada |
    | delete_task/cleanup-task | FAIL | MCP -32602 `Invalid tools/call result: invalid_union` (tarea SÍ borrada server-side: get_task posterior confirma gone) |
    | transfer_money/mover-dinero | FAIL | `A=-5.00 B=5.00` (transfer OK pero sin fondeo previo por falta de categorías; aserción 32.5/5 no aplicable) |
    | delete_movement/transfer-reverts | FAIL | -32602 en respuesta pero reversión SÍ aplicada (`A -5->0 B 5->0`) |
    | delete_account/cleanup-A y cleanup-B | FAIL | -32602 en respuesta (misma causa) |
    | Resto (30) | OK | incl. login, tasks CRUD, hábitos-deben-fallar (isError+unknown tool), dashboard, tokens+revoke-401, audit (UNKNOWN_TOOL logueado, prefijos enmascarados), negativos |
    | teardown/delete-user-cascade | OK | usuario efímero borrado; verificado 0 users/cuentas/movimientos `t8e2e%` en prod; puertos 3399/3398 libres; logs /tmp sin secretos eliminados |
  - G5 (bug mínimo real, documentado, fix FUERA de scope): backend DELETE responde 204 → `apiDelete` retorna `undefined` → `fmt(undefined)` = `undefined` (no string) → el MCP envía `{content:[{type:"text"}]}` sin `text` → cliente SDK estricto 1.30.1 rechaza con -32602. Operación OK, forma de respuesta rota. Afecta a todo DELETE con 204 (task/account/movement; presumiblemente goal/event/note). Fix candidato (NO aplicado): `fmt` debe mapear `undefined` a texto explícito (ej. `"ok"`/`"deleted"`).
  - G6 (setup gap, no bug): usuarios efímeros nacen con 0 categorías y no hay `POST /api/categories` (G1 vigente) → el e2e no puede fondear cuentas vía MCP puro; rerun verde requiere fixture de categoría por SQL directa (usuario efímero) o relajar aserciones de saldo.
  - DONE 2026-10-05 (rerun verde, 0 FAIL):
    | tool/caso | status | nota exacta |
    |---|---|---|
    | setup/create-user + seed-categories | OK | usuario efímero + 2 categorías finance por SQL directa |
    | healthz/tools-list/login | OK | mcp alive; 50 tools sin habit-write; token+expires_at sin echo |
    | accounts+categories+funding | OK | A+B creadas; kind=finance; income 50.00 + expense 12.50 |
    | movements read | OK | get_movement + list_movements contienen el gasto |
    | tasks CRUD | OK | create/get/update-complete/list-done/delete/gone-after-delete |
    | delete_task/cleanup-task | OK | G5 cerrado: `{"ok": true}` válido, sin -32602 |
    | transfer_money/mover-dinero | OK | A=32.50 B=5.00 (fondeo real vía fixture G6) |
    | update_movement/transfer-422 | OK | transfers create/delete only |
    | delete_movement/transfer-reverts | OK | G5 cerrado: A 32.5->37.5 B 5->0 |
    | delete_movement expense/income-gone | OK | balance reversed, ledger vacío |
    | create/update_habit | OK | isError + unknown tool (read-only verificado) |
    | dashboard/negativos/auth/tokens/audit | OK | snapshot 4-way; 4 negativos claros; bad-bearer 401; token raw-once→revoke→401; UNKNOWN_TOOL logueado, prefijos enmascarados |
    | delete_account cleanup-A/B | OK | G5 cerrado: removed sin -32602 |
    | teardown/delete-user-cascade | OK | user row gone; ephemeral_users_left=0, cuentas/movs/cats de prueba=0; puertos 3399/3398 libres; /tmp limpio |
  - Nota histórica: primer run 2026-10-05 quedó total=38 ok=30 fail=8 (G5/G6 documentados abajo); este rerun lo sustituye como evidencia de DONE. Sin commits.
- [x] T9 UI tokens en Configuración con playwright-cli + 0 errores consola/logs MCP (route: delegated direct verifier) — DONE 2026-10-05: rerun completo desde cero (verificador previo vacío). Playwright real (chromium headless vía `@playwright/test` del repo, sin nuevas deps) en 1440×900 + spot 390×844: 18/18 pasos OK, overall PASS. Setup: backend efímero `target/debug` en puerto libre 3419 (≠3101) con `STATIC_DIR=frontend/out` (export vigente, sin rebuild) + `SESSION_TTL_HOURS=24` + `DATABASE_URL` prod (nunca impresa); 5 usuarios efímeros vía `--create-user` (los 5 borrados en cascada al final). Sin cambios de código de producto (2 expectativas iniciales del script eran erróneas y se corrigieron contra fuente backend, no al revés). Tabla real (sin secretos):
  | paso | status | nota exacta |
  |---|---|---|
  | login-ui-1440 | OK | login por UI → /dashboard, bearer en localStorage |
  | tokens-page-empty | OK | estado inicial "Sin tokens aún" |
  | create-raw-once | OK | raw `pd_…` 46 chars visible UNA vez + aviso "No se mostrará más" |
  | copy-button-present / copy-clipboard-matches | OK | "Copiar" → "¡Copiado!", clipboard idéntico al raw |
  | list-metadata-only | OK | 8 keys `{id,name,prefix,scopes,expires_at,last_used_at,revoked_at,created_at}`, sin `token`/`token_hash`, raw ausente del body |
  | list-prefix-matches-raw | OK | prefijo display contenido en el raw |
  | raw-gone-from-dom-after-dismiss | OK | tras "Ocultar", raw ausente del DOM |
  | raw-usable-pre-revoke | OK | `GET /api/tokens` con raw = 200 |
  | delete-button-present / delete-api-status | OK | `Eliminar: <nombre>` + `DELETE /api/tokens/{id}` = 200 tras confirm |
  | delete-ui-revoked-row | OK | fila queda con Estado "Revocado", botón deshabilitado, 0 "Activo", sin raw en DOM |
  | raw-401-post-revoke | OK | `GET /api/tokens` con raw = 401 en el primer uso posterior |
  | console-zero-errors-1440 / 390 | OK | 0 errores en rutas de tokens (ambos viewports) |
  | no-secret-in-console-1440 | OK | consola/DOM/list sin secreto (solo conteos/nombres) |
  | spot390-form-visible | OK | formulario crear visible en 390 |
  - Correcciones de expectativa (no bugs, verificadas en fuente): (a) la sonda inicial usó `GET /api/me` (401) — es session-only por diseño (`ME_LOOKUP_SQL` contra `sessions` en `backend/src/routes/me.rs`); la ruta válida para API tokens es `GET /api/tokens` (`resolve_token_user_id` en `backend/src/auth/middleware.rs`); (b) tras revocar, la UI NO vuelve a vacío por diseño: la fila revocada permanece visible como "Revocado" (auditable, `LIST_TOKENS_SQL` sin filtro de revocados). Observación cosmética fuera de scope (NO implementada): el badge "N activos" cuenta filas incluyendo revocadas. Cleanup: usuarios efímeros 5/5 borrados (`ephemeral_users_left=0`, `ephemeral_tokens_left=0`), backend apagado, puerto 3419 libre, `/tmp` sin restos t9, sin commits (prohibido en esta tarea).
- [x] T10 Día del Juicio + resumen (route: 2 jueces ciegos jd-judge-a/b + fix jd-fix-agent) — CLOSED 2026-10-05 con veredicto `APPROVED (residual aceptado, opción A del dueño)`: round-1 confirma 1 severo (J-01 race mint-budget, ambos jueces MAJOR determinista) + 1 suspect pre-existing (S-01 transporte hostGuard/fallback-token, solo juez B) + 3 info MINOR (I-01 schemas permisivos con backstop 422; I-02 `list_audit_log` sin auth; I-03 README header hábitos). Fix J-01 aplicado (reserva atómica + rollback por Drop + 4 tests burst; `cargo test` 417+43 verde). Re-juicio dividido: juez A halla fix-caused (evicción-4096 resetea budget, MAJOR) vs juez B clean (J-01 cerrado; evicción = tradeoff DD5 pre-existing compartido con login). CONTRADICCIÓN resuelta por el dueño 2026-10-05 (opción A): residual documentado ACEPTADO, sin round-2. Resto APROBADO. Sin commits.

Total tasks: 10.

## Criterios de aceptación
- Cada tool listada responde OK con params correctos y falla con mensaje claro si faltan datos.
- Intento de escritura en hábitos es rechazado (sin tool expuesta o error explícito).
- Crear/revocar token funciona; revocado deja de funcionar de inmediato; listado no muestra valor completo.
- Rate-limit en uso de token evaluado/implementado o justificado si no aplica.
- Descripciones/schemas claros para agente genérico + Claude.
- Playwright confirma crear/ver/eliminar token en UI sin errores.
- Resumen final entrega lo pedido en Definición de terminado. Sin commits/push/deploy.

## Checks aplicables
- `cd mcp-dashboard && npm run typecheck` + `npm run build`
- `cd backend && cargo test` (con `DATABASE_URL` prod para casos DB; usuario efímero, borrar al final)
- `cd frontend && pnpm test` para UI tokens si se toca
- Smoke MCP real: `POST /mcp` + `GET /healthz` con token env (scripts efímeros en `/tmp`, nunca en repo)
- Playwright solo para UI web, no para protocolo MCP.

## Progreso / Evidencia
- 2026-10-05: mapa explorer completo (39 tools, gaps confirmados). Doc creado. Sin writes aún.
- 2026-10-05 T4 DONE: hábitos read-only verificado (35 tools; rechazo `unknown tool` con `isError:true`; `typecheck`+`build` limpios). Sin commits (prohibido en esta tarea).
- 2026-10-05 T2 DONE: finanzas FULL vía MCP (43 tools; movimientos + transfer + get_subscription nuevos; gaps G1/G2 documentados arriba). Verificación solo lectura de código + `typecheck`/`build` + `tools/list` en vivo; e2e con dinero real queda para T8.
- 2026-10-05 T3 DONE: productividad verificada sin cambios + Config FULL (5 tools tokens/preferencias) + Dashboard read por composición client-side (49 tools; gaps G3/G4 documentados arriba). Verificación: `cd mcp-dashboard && npm run typecheck` limpio, `npm run build` limpio, `tools/list` en vivo (49 tools, 6 nuevas visibles con required correctos, sin secreto/hash en lista).
- 2026-10-05 T5 DONE: SDKs/discovery verificados sin cambios + schemas con enum (tasks/goals) y minProperties (preferences) + descripciones EN claras (login/tasks/goals/events); 49 tools intactos; `typecheck`+`build` limpios; `tools/list` confirma descripciones+required; sin `@anthropic-ai/sdk` (propuesta diferida en T5).
- 2026-10-05 T6 DONE: tokens auditados (CSPRNG/hash/prefijo/solo-sesión/listado/revoke-inmediato OK) + rate-limit creación 10/usuario/hora (`backend/src/auth/rate_limit.rs`, `backend/src/routes/tokens.rs`); `cd backend && cargo test` verde (413 bin + 3/6/10/5/7/5/7 integración, 0 fallos, usuarios efímeros con cleanup por test); decisiones `GET last_used_at` sin cambio, sin rate-limit al uso, `GET`/`DELETE` fuera del presupuesto en `openspec/changes/2026-10-05-mcp-review-tokens/t6-token-security.md`.
- 2026-10-05 Fix J-01 (Judgment Day) DONE: race check-then-record del mint de tokens cerrado con reserva atómica (`reserve_token_mint` + `TokenMintReservation::commit`/`Drop`, rollback solo si el insert falla); tests de burst concurrente verdes (unit 24 hilos vs cap 3; handler 12 creates vs cap 3, ≤ cap filas); `cargo test` 417 unit + 43 integración, 0 fallos, usuarios efímeros sin restos. Detalle en `openspec/changes/2026-10-05-mcp-review-tokens/t6-token-security.md`.
- 2026-10-05 T7 DONE: audit log mínimo mostrable sin migración prod (buffer en memoria + `list_audit_log` read-only en MCP; tabla durable solo diseñada en `0017_mcp_audit_log.sql`, NO aplicada). Decisión pendiente del dueño: efímero vs durable.
- Commits: ninguno (prohibido en esta tarea).
- 2026-10-13: **G1 cambió de lado.** El backend YA expone `POST /api/categories` y `DELETE /api/categories/{id}` (`backend/src/main.rs`), así que el gap dejó de ser backend y pasó a ser MCP: ninguna tool los cablea y `list_categories` sigue siendo la única de categorías. Además, auditoría de los campos de Productividad contra sus lectores reales: `debt_id` de eventos era un parámetro imposible (migración 0013 borró la columna → el backend respondía 422 siempre) y se quitaron 9 campos de escritura sin lector en notas/metas/tareas/eventos; `tasks.goal_id` y `tasks.sort_order` se conservan porque sí tienen efecto visible. Detalle en `mcp-dashboard/README.md`.

## Next step
T1 spec → T4/T2 (hábitos-read-only + finanzas) por riesgo, luego T6 tokens, T8 e2e, T9 UI, T10 juicio.
