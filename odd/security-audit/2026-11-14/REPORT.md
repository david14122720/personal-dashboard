# Auditoría de seguridad — personal-dashboard (corrida 2)

**Fecha:** 2026-11-14 · **Artefacto auditado:** `main` en `84a155f` (árbol limpio, `main == origin/main`) · **Modo:** read-only, cero cambios en el código · **Método:** 4 cazadores read-only por dominio (auth, MCP, datos/lógica, frontend+infra), validación del orquestador sobre cada hallazgo de severidad alta o media, y reutilización de la corrida previa (`auditoria.md`, 2026-10-18, `7147707`) como baseline de remediación.

**Diferencia con la corrida 1:** 47 commits entre ambas. Cuatro de ellos declaran arreglos de seguridad (`74eb8f2` MCP, `b2fbef6` expiración y moneda, `1417706` serialización de valuaciones, `c09dd0c` hardening y CSP), y una purga masiva (`f33ba99`, módulo Hermes). Por eso esta corrida es mitad verificación de remediación, mitad caza nueva sobre el código que cambió.

## Resumen ejecutivo

**12 hallazgos: 2 altos (uno condicional), 4 medios, 6 bajos.** Más 1 advisory de dependencia con impacto probable.

La corrida 1 dejó 8 hallazgos; **5 están genuinamente cerrados** (F-02, F-03, F-04, F-05, F-06) y **3 siguen abiertos o parciales** (F-01 transporte, F-07 residual, F-08 residual reabierto en el propio informe). El núcleo de datos aguanta: cero IDOR, SQL paramétrico en todo el backend, dinero íntegro bajo concurrencia.

Lo flojo se movió de lugar: ahora está en **la superficie MCP**, que implementó autenticación de *presencia* en vez de *validación*, en **la ergonomía del rate limit de login** (bloqueo de cuenta global y previo a la verificación), y en **la cadena de suministro de CI** (actions por tag mutable contra `main`, que es lo que se despliega).

## Hallazgos

| # | Hallazgo | Sev | Origen | Evidencia |
|---|---|---|---|---|
| F-09 | MCP: la puerta acepta **cualquier** bearer no vacío — no valida credencial | **ALTO** | nuevo | `mcp-dashboard/src/index.ts:57-66`, `:224-232` |
| F-10 | MCP: el fallback a `PERSONAL_DASHBOARD_TOKEN` convierte la *ausencia* de cabecera en autenticación de dueño | **ALTO (condicional)** | nuevo | `index.ts:64-65`, `:224` |
| F-11 | `/api/movements/summary` sin tope de amplitud: 3.652.059 buckets en una petición | MEDIO | nuevo | `backend/src/routes/movements.rs:415-437`, `:278-296`, `:341-345` |
| F-12 | Bloqueo de login por cuenta, global y previo a Argon2: 5 fallos dejan fuera al dueño, renovable sin límite | MEDIO | residual A2 | `backend/src/auth/rate_limit.rs:21-22,176-206`, `routes/login.rs:154-159` |
| F-13 | Una sesión puede acuñar un token de 3650 días que logout y revocación de sesiones no revocan | MEDIO | residual A6/F-01 | `routes/tokens.rs:36,142-146`, `routes/logout.rs:14-19`, `routes/sessions.rs:30` |
| F-14 | CI: cuatro actions por tag mutable, sin `permissions:` ni `persist-credentials: false`, contra `main` desplegado | MEDIO | nuevo | `.github/workflows/ci.yml:35,36,53,54,57` |
| F-15 | `pay` debita cuentas archivadas (invariante rota en el cuarto camino de dinero) | BAJO | nuevo | `routes/subscriptions.rs:91-92,97` vs `routes/movements.rs:749` |
| F-16 | El literal de la password vieja sigue en `HEAD`, dentro de `auditoria.md` (el propio informe de la corrida 1) | BAJO | residual F-08 | `auditoria.md` en `84a155f` |
| F-17 | MCP: páginas de error de desarrollo y `X-Powered-By` alcanzables **antes** de `hostGuard` y de auth | BAJO | nuevo | `mcp-dashboard/src/index.ts:196` vs `:210`; sin `NODE_ENV` en la imagen |
| F-18 | `docker-compose.yml` de desarrollo publica `3000` en todas las interfaces con credenciales literales | BAJO | residual | `docker-compose.yml:7,11,41-42` |
| F-19 | Oráculo de existencia entre usuarios (422 vs 404) en tareas, eventos y valuaciones | BAJO | conocido | `routes/tasks.rs:406-431`, `routes/events.rs:395-421`, `routes/assets.rs:97` |
| F-20 | La guarda anti doble-pago se reabre con `PATCH next_billing_on` al pasado | BAJO | conocido | `routes/subscriptions.rs:441-443,534-574` |

---

## Detalle

### F-09 · MCP: autenticación de presencia, no de credencial — ALTO

**Qué pasa.** `extractRequestToken` (`index.ts:57-66`) devuelve el bearer si el header matchea `^Bearer\s+(.+)$` y no está vacío, o el valor de `PERSONAL_DASHBOARD_TOKEN` si no hay header válido. La única puerta es `if (token === undefined) → 401` (`index.ts:224-232`). Nunca se valida contra la base ni contra la API.

**Escenario.** Cualquier host de la LAN (o del network del compose/Dokploy) alcanza `:3002`, envía `POST /mcp` con `Authorization: Bearer x` y un `initialize` bien formado → 200 y sesión. A partir de ahí, `tools/call` despacha sin credencial real:

1. **Integridad de auditoría.** 200 llamadas con nombre de tool inexistente llenan el buffer global de 200 filas (`tools.ts:1281-1332`) y desalojan el historial real del dueño. La sanitización del nombre (F-03) sigue vigente: no hay inyección de texto arbitrario, pero sí evicción.
2. **Proxy de fuerza bruta.** La tool `login` (`tools.ts:418-436`) llama a `/api/login` con `auth:false`. El atacante obtiene un relay sin credencial MCP. El rate limit del backend (10/IP + 5/cuenta por 15 min) acota el volumen y todas las peticiones salen de la IP del contenedor, así que el techo práctico es bajo — pero el puerto MCP no debería ser una superficie de login.
3. **Habilitador de F-10 y del lockout de sesiones.** Sin validación no hay forma de distinguir un cliente legítimo de uno hostil antes de asignar recursos (64 sesiones → `503` para todos).

**Qué NO pasa.** No hay lectura de datos: cada llamada a la API reenvía el token presentado y el backend responde 401. La filtración de datos financieros de la corrida 1 (F-04) no se reabre por esta vía, porque `readAuditLog` filtra por principal y el principal es el hash del token presentado.

**Fix mínimo.** Validar antes de despachar: un `GET /api/me` por token con caché corta (≤60 s) y 401 si falla; atribuir la auditoría al `user_id` resuelto. Con eso, F-09, F-10 y el lockout sin credencial caen juntos.

### F-10 · MCP: el fallback de entorno autentica la ausencia de credencial — ALTO condicional

**Qué pasa.** `index.ts:64-65`: si no hay header válido, se usa `process.env.PERSONAL_DASHBOARD_TOKEN`. El `Dockerfile:72` documenta la variable como «intentionally unset», y en el código actual no está seteada. Pero si Dokploy la define — es una configuración explícitamente soportada — cualquiera que mande **sin** `Authorization`, o con `Authorization: Basic ...`, o con un `Bearer` malformado, opera como el dueño: `list_accounts`, `list_notes`, `get_preferences`, `list_audit_log`.

**Estado.** **No confirmado**: no tengo acceso a las variables de Dokploy. Verificación exacta: revisar el env de `application_one` (`fhhbVxFYT1qyQEeh90sOo`) y confirmar que `PERSONAL_DASHBOARD_TOKEN` no existe. Si no existe, el hallazgo es dormido; si existe, es CRÍTICO (exfiltración de datos privados con una petición sin credencial).

**Fix.** Borrar el fallback. Si hace falta credencial de servicio, exigirla en un header explícito en rutas server-to-server; nunca tratar la ausencia como autenticación.

### F-11 · `/api/movements/summary` sin tope — MEDIO

**Qué pasa.** `summary_bucket_windows` (`movements.rs:415-437`) recorre `from..to` empujando un bucket por unidad, con su `String` de clave, sin cota. La validación de ventana (`parse_movement_range:278-296`, delegada por `parse_summary_window:341-345`) solo exige formato `YYYY-MM-DD` y `from <= to`.

**Escenario.** Cualquier usuario autenticado (sesión o token API): `GET /api/movements/summary?from=0001-01-01&to=9999-12-31&group=day`. Son **3.652.059** iteraciones con 3.652.059 `String` y sus structs, más el cuerpo JSON bufferizado completo, en el proceso compartido con pool de 5 conexiones y sin rate limit global. Una sola petición; no requiere datos.

**Impacto.** Pico de RSS de cientos de MB; si el contenedor tiene límite, OOM-kill y caída del API para todos. La misma clase que F-02 en la corrida 1, con el mismo techo de severidad: mecanismo determinista, magnitud dependiente del límite del contenedor (no verificado).

**Fix.** Rechazar ventanas anchas por grupo (p. ej. `day` ≤ 400 días, span total ≤ 5 años) con 422 en `parse_summary_window`; opcionalmente cortar `buckets.len()`.

### F-12 · Bloqueo de login por cuenta, global y previo a la verificación — MEDIO

**Qué pasa.** `check_login(ip, account)` corre antes de la consulta a la base y antes de Argon2 (`login.rs:154-159`) y rechaza si **cualquiera** de los dos buckets está lleno (`rate_limit.rs:176-206`): 5 fallos por cuenta / 15 min, 10 fallos por IP / 15 min. El registro es solo por fallo, y el éxito limpia solo el bucket de cuenta.

**Escenario.** Quien conozca el email del dueño (aplicación de un solo usuario) envía 5 intentos con password falsa → el bucket de cuenta queda lleno y **el login correcto del dueño también recibe 429** antes de tocar Argon2. Repetir 5 peticiones cada 15 minutos mantiene el bloqueo indefinidamente. Las sesiones existentes siguen funcionando; el login muere. El limitador es in-process: solo esperar o reiniciar lo limpia.

**Agravante condicional.** `rate_limit_key` usa el peer socket salvo que sea proxy confiable (`config.rs:96-109`, default = no confiar en nadie). Si hay un reverse proxy delante y `TRUSTED_PROXIES` no está seteado, los 10 fallos por IP son **globales**: cualquiera bloquea a todas las cuentas.

**Fix.** No bloquear por el bucket de cuenta solo: verificar credenciales y devolver 429 únicamente cuando fallan (el bucket de IP sigue acotando Argon2), o llavear por `(cuenta, IP)` con presupuesto mayor. Setear `TRUSTED_PROXIES` si hay proxy.

### F-13 · Token de 10 años que sobrevive a logout y revocación — MEDIO

**Qué pasa.** `MAX_EXPIRES_IN_DAYS = 3650` (`tokens.rs:36`) y el llamador decide (`:142-146`; el default de 90 días aplica solo si se omite). La acuñación no pide step-up, solo una sesión viva (`auth/helper.rs:28-49`). `logout` (`logout.rs:14-19`) y `DELETE /sessions` (`sessions.rs:30`) actualizan **solo** `sessions`.

**Escenario.** Víctima de F-01 (sniffing LAN, HTTP plano) o de A10 (token en `localStorage` + cualquier XSS): `POST /api/tokens {"name":"sync","expires_in_days":3650}` → 201 con `pd_…` válido diez años. El dueño hace logout y revoca todas las sesiones: el token sigue autenticando en toda ruta `require_user_id`. Una sesión a segundos de expirar alcanza para acuñarlo.

**Matiz.** El dueño puede revocar por id (`DELETE /tokens/{id}`) y listar tokens, pero después del logout necesita volver a entrar. Y el aviso de F-01 («la sesión robada puede acuñar un token sin expiración») está **medio cerrado**: ya no es sin expiración, pero el techo de 10 años deja el impacto práctico intacto.

**Fix.** Quitar el control del llamador o bajarlo a ≤90 días; exigir re-autenticación para acuñar; revocar en cascada los tokens de una sesión al hacer logout, o agregar «revocar todos los tokens»; y caducar los `expires_at IS NULL` heredados (`middleware.rs:27` todavía los acepta).

### F-14 · CI por tags mutables contra lo que se despliega — MEDIO

**Qué pasa.** `.github/workflows/ci.yml:35,36,53,54,57` usa `actions/checkout@v4`, `dtolnay/rust-toolchain@stable`, `pnpm/action-setup@v4`, `actions/setup-node@v4`. No hay bloque `permissions:` en el archivo, y `checkout` persiste el token en `.git/config` por defecto.

**Escenario.** Quien tome control de un tag (o del repo de una de esas actions) publica un commit que corre en el job con el `GITHUB_TOKEN` por defecto (escritura, salvo restricción del repo), hace `git push origin main`, y Dokploy construye y despliega esa imagen. Control del artefacto de producción sin tocar este repo. No hay `secrets.*` en el workflow, así que no se roban credenciales de larga vida.

**Fix.** Pinear cada `uses:` a SHA completo, `permissions: contents: read` a nivel de workflow y `persist-credentials: false` en el checkout.

### F-15 · `pay` debita cuentas archivadas — BAJO

`PAY_LOCK_ACCOUNT_SQL` (`subscriptions.rs:91-92`) es `SELECT id, currency FROM accounts WHERE id=$1 AND user_id=$2 FOR UPDATE`: sin `is_archived`. `PAY_DEBIT_ACCOUNT_SQL` (`:97`) tampoco. `movements.rs:749` sí rechaza cuentas archivadas en creación, transferencia y re-point. Consecuencia: tras archivar una cuenta (desaparece del listado), `POST /api/subscriptions/{id}/pay` sobre ella responde 200, debita y escribe movimiento. Mismo dueño, sin cruce de privilegios: es integridad de datos y gasto accidental, no escalada. **Fix:** `AND NOT is_archived` en el lock y 422 en el miss.

### F-16 · El literal de la password vieja vive en el informe de la corrida 1 — BAJO

El commit `8203326` limpió el literal de `odd/tasks/finance-panel-consolidation-delta.patch`. Pero `git grep` en `HEAD` (conteo, sin imprimir el valor) lo encuentra en **`auditoria.md`**, que cita la credencial al describir F-08. El repo es público. La credencial fue rotada el 2026-10-13 y ya no autentica, así que el riesgo actual es reutilización/backups, no acceso. **Fix:** enmascarar el literal en `auditoria.md` y activar secret scanning + push protection; el conteo de historia no cambió (6 commits con `-S`).

### F-17 · MCP: error de desarrollo antes del hostGuard — BAJO

`app.use(express.json())` (`index.ts:196`) se monta antes de `app.use("/mcp", hostGuard)` (`:210`), y no hay `app.disable("x-powered-by")` ni `NODE_ENV` en la imagen ni en el entrypoint. Con `Host: evil.example` y body `{`, el parser lanza 400 antes de que corra el guard de Host y el handler por defecto de Express (env=development) devuelve stack HTML con rutas absolutas del contenedor y `X-Powered-By: Express`. Es reconocimiento, y demuestra que el guard de Host es esquivable en el camino del parser. **Fix:** `ENV NODE_ENV=production`, `disable("x-powered-by")`, montar el guard antes del parser, handler JSON 4xx.

### F-18 · compose de desarrollo abierto con credenciales literales — BAJO

`docker-compose.yml:7,11,41-42` publica `3000:3000` en todas las interfaces y usa `user`/`password` literales para DSN y Postgres. No es el camino de despliegue (Dokploy construye el `Dockerfile` raíz) y Postgres no se publica. **Fix:** `127.0.0.1:3000:3000`, `${POSTGRES_PASSWORD:?}` y `${DATABASE_URL:?}`.

### F-19 / F-20 · Conocidos de la corrida 1, reverificados

- **F-19:** `tasks.rs:406-431`, `events.rs:395-421`, `assets.rs:97` devuelven 422 («es de otro usuario») vs 404 (no existe) → confirma existencia y, en eventos, propiedad ajena. UUIDv4 no enumerable: impacto real ≈ 0, pero rompe el contrato «404 sin filtrar existencia».
- **F-20:** `is_paid_this_cycle` (`subscriptions.rs:441-443`) deriva el ciclo de `next_billing_on`, que el cliente escribe libremente en `PATCH` (`:534-574`). Pagar → PATCH al pasado → pagar otra vez. Es la plata del propio dueño y no cruza privilegios: guarda anti doble-submit, no frontera de seguridad.

---

## Dependencias (OSV, consulta en vivo 2026-11-14)

259 crates y 7 paquetes npm consultados contra OSV.

| Paquete | Versión | Advisory | Severidad | Alcanzabilidad |
|---|---|---|---|---|
| `@modelcontextprotocol/sdk` | 1.30.1 | GHSA-46jr-4wx8-v453 (una petición HTTP agota memoria en validación), GHSA-22jm-h49p-29qw (tareas no ligadas a sesión) | **ALTA** | Probable en el servidor: el SDK valida los cuerpos que recibe. Subir a ≥1.32.0. |
| `@modelcontextprotocol/sdk` | 1.30.1 | GHSA-6prh-2h8m-c8cw (redirects cross-origin en el cliente HTTP), GHSA-rvq5-wwqv-78pq (bearer de otro servicio), GHSA-6qxp-vccf-f47h (credenciales OAuth a un AS elegido por el servidor) | MEDIA/ALTA | **No alcanzable**: no se usa el cliente OAuth ni `requireBearerAuth`; la validación es propia. |
| `rustls` | 0.23.45 | RUSTSEC-2026-0346/0347/0348/0349 (Debug de sesión filtra secretos, ECH, Brotli 1 GiB pre-auth, downgrade de key exchange) | MEDIA/BAJA | Solo handshake TLS **cliente** contra Postgres (`sqlx tls-rustls`); superficie muy estrecha. Subir a 0.23.46 es barato. |
| `rustls-webpki` | 0.103.15 | RUSTSEC-2026-0382 (acepta intermedios no confiables) | — | Mismo camino; subir a 0.103.16. |
| `ctutils` | 0.4.2 | RUSTSEC-2026-0385 (máscaras y comparaciones `u128` no constantes) | — | Cadena de `argon2`/`phc`. Explotabilidad por timing **no demostrada**; subir a 0.4.4. |
| `tokio` | 1.53.1 | RUSTSEC-2026-0386 (`AsyncFd` viola I/O safety) | — | **No alcanzable**: el código no usa `AsyncFd`. |
| `libsqlite3-sys` | 0.37.0 | RUSTSEC-2026-0459 (CVE de SQLite) | — | **No compilado**: Postgres puro, unificación de features. |
| `webpki-roots` | 1.0.9 | RUSTSEC-2026-0381 (intermedios emSign) | — | Solo cadena TLS cliente. |
| `source-map-js` | 1.2.1 | GHSA-68fv-2mgg-jv7q (DoS de event loop) | ALTA | Cadena de build, no runtime. Subir a 1.2.2. |

Base images sin digest: `node:22-slim`, `rust:1-slim-bookworm`, `debian:bookworm-slim`, `postgres:15-alpine`. `corepack prepare pnpm@11.23.0` y `next/font/google` descargan en build con integridad TOFU.

## Verificado como arreglado (corrida 1 → hoy)

| Previo | Estado | Evidencia |
|---|---|---|
| F-01 transporte claro | **abierto por diseño** | Sin TLS/HSTS en ningún lado; el copy engañoso del login sí se corrigió (`es.ts:51-53`). Encadenado con F-13. |
| F-02 sesiones MCP sin tope | **cerrado** | `SessionRegistry` con cap 64 y TTL 30 min, evicción que cierra transports y sweeper `unref` (`sessions.ts:21-100`). Sin header → 401 antes de crear sesión. Residual: F-09 permite llenar el cap sin credencial. |
| F-03 tools/call sin auth + auditoría forjable | **mitad cerrada** | Nombre de tool acotado a charset/longitud y sustituido por placeholder; desconocidos nunca se reflejan (`tools.ts:1281-1376`). La puerta de credencial sigue siendo de presencia (F-09). |
| F-04 list_audit_log sin scope | **cerrado en código** | `readAuditLog` filtra por principal; sin principal responde error (`tools.ts:1242-1256`). Residual por F-10. |
| F-05 pago cross-currency | **cerrado** | Moneda leída bajo `FOR UPDATE` en cuenta y suscripción y comparada antes de escribir (`subscriptions.rs:91-93,628-632`); re-point de movimientos también compara (`movements.rs:1210-1225`). |
| F-06 carrera de valuaciones | **cerrado** | Lock del activo (`FOR UPDATE`) antes de leer `max(recorded_on)` (`assets.rs:106-108,733-766`); el segundo escritor se serializa y ve la fila nueva. Mismo lock para el relabel de moneda. |
| F-07 password por argv | **cerrado** | Solo `PERSONAL_DASHBOARD_NEW_USER_PASSWORD` o stdin (`main.rs:363-408`); argc ≠ 4 se rechaza. Residual: stdin en TTY y `/proc/<pid>/environ`. |
| F-08 credencial histórica | **parcial** | El parche está limpio; el literal sobrevive en `auditoria.md` (F-16). |

## Notas de hardening (sin exploit demostrado)

- **CSP** completa y correcta desde `c09dd0c` (`main.rs:270-280`, aplicada en `:354`): `object-src`, `base-uri`, `form-action`, `frame-ancestors`, sin `unsafe-eval`, sin orígenes externos. Pero `script-src 'unsafe-inline'` la deja sin valor anti-XSS mientras exista el guard FOUC inline (`layout.tsx:47,56`). Y vive **solo** en el servidor Rust: `next.config.ts` no define headers, así que cualquier otro hosting de `frontend/out` sirve la app sin CSP.
- **Auth por handler, no por capa**: no hay `from_fn` de autenticación en `main.rs`; un handler nuevo que olvide `require_user_id` publica datos sin auth. Considerar un extractor `FromRequestParts` (además arregla que el `Json` se parsee antes del 401).
- **`scopes` decorativos** en `api_tokens`: nunca se seleccionan ni se filtran, y el API no permite setearlos. Enforce o eliminar.
- **`SESSION_TTL_HOURS`** se parsea como `u64` (`config.rs:127-131`): `0` produce sesiones instantáneamente muertas; un valor enorme desborda en `Duration::hours`. Clamp 1..=720.
- **Sin revocación masiva de tokens** ni «token acuñado por esta sesión»; `sessions` no guarda `user_agent`.
- **`/ready`** es una sonda de base de datos sin autenticar contra un pool de 5.
- **`MCP_ALLOWED_HOSTS=192.168.50.120`** hornea una IP privada en la imagen; pásala por entorno.
- **`.dockerignore`/`.gitignore`** no cubren `.env.production` (solo `.local`). Un `frontend/.env.production` futuro entraría al build y se inlinea.
- **`recalc_goal_progress`** (`migrations/0007:17-20`) cuenta tareas por `goal_id` y actualiza `goals` por `id`, sin `user_id`; hoy inalcanzable porque la API bloquea el enlace cruzado.
- **Logout silencioso** (conocido): si el servidor no responde, el cliente se desloguea localmente y la sesión vive hasta el TTL.

## Lo que está bien (calibra la confianza)

- **Cero IDOR.** Toda consulta que devuelve datos filtra por `user_id`; los cross-checks de cuerpo (cuenta, categoría, meta, hábito, tarea, suscripción) existen en create y patch. Verificado por 4.º auditor independiente del backend.
- **SQL paramétrico** en todo: statements constantes con `$n`, `QueryBuilder` + `push_bind`, cero `format!` a SQL, cero identificadores u `ORDER BY` dinámicos.
- **Dinero íntegro:** `NUMERIC(18,2)`/`rust_decimal`, sin floats, `FOR UPDATE` en orden estable de UUID, transacciones únicas, deltas derivados de la fila bloqueada.
- **Credenciales:** Argon2id `m=19456,t=2,p=1`, hash dummy con parámetros de producción (sin enumeración por tiempo), 256 bits CSPRNG, solo SHA-256 en base, prefijo de 8 chars inútil como credencial, presupuesto atómico de acuñación.
- **Sesiones:** sin cookies y sin CORS → CSRF estructuralmente imposible; `is_active` exigido en cada resolución; revocada/expirada/desactivada → 401; tokens API no pueden gestionar sesiones.
- **Frontend:** un solo `dangerouslySetInnerHTML` y es una constante de compilación; cero `innerHTML`/`eval`/`new Function`/`iframe`/`postMessage`; todos los `href` son constantes de módulo; sin scripts de terceros; lockfiles 100% `sha512`.
- **Imagen:** `USER appuser` (uid 10001), `CapEff` = solo `CAP_NET_BIND_SERVICE`, `libcap2-bin` y `curl` ausentes del filesystem final, sin `.env` ni credenciales en ninguna capa, `.dockerignore` excluye `.git/`, `odd/`, `.env`.
- **CI sin secretos:** sin `pull_request_target`, sin `secrets.*`, sin artefactos; los PRs de fork corren sin nada que robar.

## Límites de esta corrida

- **Estático.** No se levantó servidor ni se envió una petición. Los códigos 200/401/429/503 son inferidos de la lógica y de los tests del propio repo; el informe de la corrida 1 sí tuvo reproducción dinámica.
- **No verificado:** si Dokploy publica `:3002`, si hay TLS/proxy delante, el valor de `PERSONAL_DASHBOARD_TOKEN`, `SESSION_TTL_HOURS` y `TRUSTED_PROXIES` en producción, el límite de memoria del contenedor (magnitud de F-11), y si algún consumidor quedó con la password vieja.
- **Cobertura parcial por diseño:** la metodología estima que una corrida encuentra ~la mitad del total. Repetir después de aplicar los fixes.
- **Refutaciones aplicadas:** la pista de XSS almacenado en `dashboard_layout.widgets[].id` (backend acepta caracteres arbitrarios) **no se sostiene**: el frontend solo compara ids (`dashboard.ts:141-148`) y nunca los renderiza como HTML. Y la afirmación de que el literal de la password sobrevivía en `odd/tasks/*.patch` es falsa: el commit `8203326` lo limpió; está en `auditoria.md`.

## Prioridad sugerida

1. **F-09 + F-10** — validar el bearer en MCP y borrar el fallback de entorno. Cierra la puerta falsa, el proxy de login y el lockout de sesiones de una vez.
2. **F-12** — el login es el único camino de entrada; un bloqueo global renovable es el peor intercambio posible por un rate limit.
3. **F-13** — tope de 3650 días + revocación en cascada al hacer logout.
4. **F-11** — cinco líneas de validación de ventana.
5. **F-14** — pin de actions por SHA y `permissions: contents: read`.
6. **F-15, F-16, F-17, F-18** — correcciones pequeñas de invariante y de postura.
7. **Dependencias** — `@modelcontextprotocol/sdk` ≥1.32.0, `rustls` 0.23.46, `rustls-webpki` 0.103.16, `ctutils` 0.4.4, `source-map-js` 1.2.2.
