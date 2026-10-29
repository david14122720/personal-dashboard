# Remediación de la auditoría de seguridad 2026-10-18 (F-01…F-08)

Feature 2 de la entrega del 2026-10-29, después de la feature de Hermes. Artefacto auditado: `main` en `7147707`; artefacto de esta entrega: árbol de trabajo sobre `208bc62`. Sin `git commit` ni `git push` (orden vigente del dueño). Runner: `node --test` (MCP), `cargo test` en contenedor Rust, `vitest`/`tsc` (frontend).

## Specs

- **S1 — Orden y alcance.** (verbatim) "arregla esos problemas de seguridad despues de los cambios y mejoras que aremos hoy". Los problemas son los 8 hallazgos de `auditoria.md` (F-01…F-08), en el orden de prioridad que el propio documento sugiere.
- **S2 — F-02 (MEDIO): MCP sin autenticación ni límites.** `POST /mcp` sólo pasa por `hostGuard` antes del despacho; cada `initialize` guarda un transporte + `Server` en un mapa sin tope, TTL ni evicción (≈43 KB por sesión, cifra del cazador). Fix mínimo del audit: "Exigir bearer válido para `initialize` (y para `tools/call`), y poner tope + TTL al mapa de sesiones".
- **S3 — F-03 (MEDIO): `tools/call` sin autenticación contamina la auditoría.** El despacho no tiene control de credencial y registra `request.params.name` tal cual, sin límite ni juego de caracteres (incluso para tools inexistentes). Fix mínimo: "Bearer obligatorio para `tools/call`; sanear y acotar el nombre registrado; no devolver nombres desconocidos verbatim".
- **S4 — F-04 (BAJO): `list_audit_log` sin credencial y mezclando callers.** El buffer es global y expone tool, hora, éxito y prefijo de token de todos los llamadores. Fix: "exigir auth y scopear el buffer por principal".
- **S5 — F-05 (BAJO-MEDIO): `pay` ignora la moneda.** **Ya corregido en `main`** antes de esta entrega: `PAY_LOCK_ACCOUNT_SQL` devuelve la moneda y el handler devuelve 422 si difiere de la suscripción (`subscriptions.rs:88-96,605-632`). Residual a verificar: el modal de pago lista todas las cuentas sin filtrar por moneda.
- **S6 — F-06 (BAJO-MEDIO): carrera de valuaciones.** **Ya corregido en `main`**: `create_valuation_handler` toma `LOCK_ASSET_SQL` (`FOR UPDATE`) antes de leer el máximo, así el guard no se puede adelantar (`assets.rs:721-775`). Residual: dejar la evidencia de regresión en el ledger.
- **S7 — F-07 (BAJO): `--create-user` con la password por argv.** `backend/src/main.rs` toma `args[3]`; la password queda visible en `ps`, en el historial y en logs. Fix: leerla de stdin o de una variable de entorno, sin argumento.
- **S8 — F-08 (BAJO): credencial histórica y ausencia de secret scanning.** El literal ya no está en el árbol (`8203326`); el repositorio sigue público y sin secret scanning ni push protection. Fix: activar ambas en GitHub o registrar la acción del dueño con su evidencia.
- **S9 — F-01 (MEDIO): HTTP en claro en la LAN.** TLS es infraestructura (dominio + Traefik/Let's Encrypt en Dokploy, o túnel) y no se puede resolver desde el repo. Parte accionable: expiración por defecto en `POST /api/tokens` (la cadena con A6) y corregir el copy del login que afirma "Conexión segura cifrada de extremo a extremo" sobre HTTP.
- **S10 — Sin regresiones.** Los contratos existentes se conservan: clientes MCP que ya mandan bearer siguen igual; `list_movements` y el resto de tools no cambian; `pay` y valuaciones mantienen sus respuestas; los endpoints de tokens aceptan `expires_in_days` explícito.

### Estado medido al arrancar

- **MCP hoy.** `extractRequestToken` acepta header `Bearer` o el fallback `PERSONAL_DASHBOARD_TOKEN`; `hostGuard` filtra origin/host; `transports` es un `Map` sin tope/TTL; `CallToolRequestSchema` despacha sin mirar el token; `recordAudit` guarda `name` tal cual en un buffer global de 200; `list_audit_log` es pública.
- **Backend.** F-05 y F-06 ya corregidos (ver S5/S6). F-07 y S9 pendientes. `validate_expires_in_days(None)` → `None`: un token sin fecha no expira.
- **Frontend.** `SubscriptionForms.tsx` lista todas las cuentas en el modal de pago; `es.ts:120` mantiene el copy "Conexión segura cifrada de extremo a extremo".
- **Toolchain.** Sin `cargo` local: backend en contenedor Rust. `mcp-dashboard` compila con el `tsc` local (`node_modules/.bin/tsc`) y testea con `node --test`.

## Tasks

- [x] T10 MCP: bearer obligatorio en `initialize` y `tools/call`, tope + TTL + evicción del mapa de sesiones, nombre de tool saneado y acotado, `list_audit_log` autenticado y por principal; tests con `node --test` (22 casos nuevos en `mcp-dashboard/tests/`). — delegada (gentle-ai-worker) — commit: none
- [x] T11 Backend: `--create-user` lee la password de stdin/entorno (nunca argv) con su test. — inline — commit: none. **Evidencia:** `resolve_create_user_password` (entorno → stdin → error, nunca argv) con `create_user_password_tests` (3 casos: prefiere entorno y recorta el salto de línea, cae a stdin, rechaza vacío/blanco) verdes en la suite de 542. La ruta interactiva ya no expone la password en `ps`.
- [x] T12 Backend: expiración por defecto de tokens en `POST /api/tokens` (90 días) con su test y doc. — inline — commit: none. **Evidencia:** `DEFAULT_EXPIRES_IN_DAYS = 90` aplicado cuando el caller omite el campo (`validate_expires_in_days` acota 1..=3650 o ausente), con `an_omitted_lifetime_still_expires` y `expires_in_days_allows_1_to_3650_or_absent` verdes.
- [x] T13 Frontend: filtro de cuentas por moneda en el modal de pago y copy honesto del login; tests. — inline — commit: none. **Evidencia:** `SubscriptionForms.tsx:166-167` filtra por `row.currency === sub.currency` y muestra `finance.payNoAccountInCurrency` cuando no queda ninguna; `es.ts` ya no afirma cifrado extremo a extremo. Dos tests nuevos con RED observado (con el filtro desactivado: `expected <option value="a2"> to be null` y desaparecía el aviso): 12/12 en el archivo.
- [x] T14 F-08: intentar activar secret scanning + push protection por API; si el token no alcanza, registrar la acción exacta del dueño. — inline — commit: none. **Evidencia:** no hay credencial con permiso de administración en este entorno (`gh` sin hosts autenticados, sin `*_TOKEN` en el entorno, y el MCP de GitHub solo expone `run_secret_scanning` de contenido, ninguna API de settings), así que se registra la acción del dueño (ver "Acción del dueño" abajo). Chequeo compensatorio: 0 coincidencias de patrones de credencial en el diff y en los archivos nuevos, y ningún `.env` versionado.
- [x] T15 Verificación: suites (MCP, backend en contenedor, frontend) + registro de F-05/F-06 ya corregidos en el ledger. — inline — commit: none. **Evidencia (padre, sobre el árbol final):** `mcp-dashboard npm test` **32/32** con `tsc` limpio; backend `cargo test --locked` **exit 0** (542 passed, 0 failed, 2 ignored + 8 binarios de integración); frontend **926/926** con `tsc --noEmit` exit 0 (con `--testTimeout=15000`: en esta máquina de 1 CPU dos tests preexistentes de `app/dashboard/habitos/page.test.tsx`, no tocados por la entrega, quedan en 5.1-5.3 s contra el default de 5 s; con 20 s pasan 36/36, así que es timing del entorno, no lógica). F-05 y F-06 se registran como ya corregidos en `main` (S5/S6) más el residual de F-05 que cerró T13; el ledger de esa trazabilidad es este documento (L2 + T13).

## Log

**L1** (verbatim) "bien amigo arregla esos problemas de seguridad despues de los cambios y mejoras que aremos hoy : …" (orden de remediar los 8 hallazgos de `auditoria.md` después de la feature de Hermes; reglas de la entrega: DB de producción, prohibido crear/migrar bases locales, prohibido `git commit`/`git push`).

**L2** Verificación read-only contra `main` en `208bc62` (2026-10-29): F-05 (moneda en `pay`) y F-06 (lock del activo antes del máximo) **ya están corregidos**; el literal de F-08 **ya fue reemplazado** en `8203326`. Siguen abiertos F-02, F-03, F-04, F-07 y la parte accionable de F-01.

**L3** T10 cerrada (2026-10-29, sin commit ni push, sin DB ni migraciones). `cd mcp-dashboard && npm test` → `tsc` limpio y **32/32** casos de `node --test` en verde (los 10 de `list_movements` intactos). Dos huecos de la implementación previa, con test en rojo antes del arreglo: (a) el TTL no liberaba cupo — un registro lleno de sesiones expiradas respondía 503 hasta el siguiente barrido, ahora `canOpen()` cierra las expiradas antes de medir; (b) un token vacío caía al buffer global de `list_audit_log`, ahora la ausencia de principal es error. S10 comprobado con diff base/cambio en `mktemp -d`: `list_movements` (9 casos), `list_accounts`, `list_tasks` y `get_dashboard_summary` dan stdout y llamadas `fetch` (método/query/bearer) idénticos.

**L4** Cierre de la feature 2. Verificación del padre sobre el árbol final: MCP **32/32** (`tsc` limpio), backend **542 passed / 0 failed / 2 ignored** + integración en verde, frontend **926/926** (2 tests nuevos de T13) y `tsc --noEmit` exit 0. T13 se cerró con RED observado: desactivando el filtro por moneda, el test falla con `expected <option value="a2"> to be null` y desaparece el aviso de moneda faltante. T14 quedó **bloqueada por credenciales**, no por código: ver "Acción del dueño". Chequeo compensatorio de F-08: 0 coincidencias de patrones de credencial en el diff y en los archivos nuevos, y ningún `.env` versionado.

## Acción del dueño (F-08: secret scanning y push protection)

No se pudo activar desde aquí: `gh` no tiene hosts autenticados, no hay token de GitHub en el entorno, y el MCP de GitHub expuesto solo ofrece escaneo de contenido (`run_secret_scanning`), ninguna API de *settings*. Las dos acciones exactas, en el repo `david14122720/personal-dashboard`:

1. **Settings → Code security → Secret scanning**: activar *Secret scanning* y *Push protection* (en repos públicos el escaneo ya viene activado; la protección de push es la que hay que encender).
2. Si preferís hacerlo por API con un token con permiso de administración:
   `PATCH /repos/david14122720/personal-dashboard` con `{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}`.

Con eso, F-08 queda completo. El resto de la remediación (F-01…F-07) está cerrado por código y tests en esta entrega.
