# Auditoría de seguridad — personal-dashboard

**Fecha:** 2026-10-18 · **Alcance:** repositorio completo (`backend/`, `frontend/`, `mcp-dashboard/`, `docker/`, CI, dependencias) y despliegue medido en Dokploy · **Artefacto auditado:** `main` en `7147707` (= `origin/main`) · **Modo:** read-only, cero cambios en el repo · **Artefacto previo:** no había corridas de la skill `security-audit`; sí existe una auditoría previa del repo (2026-10-04, ver "Prior art").

Método: skill `.agents/skills/security-audit/` (6 fases: recon → caza → validación adversarial → reporte → salida estructurada → verificación independiente). 6 cazadores read-only por dominio, 2 validadores adversariales que intentaron refutar cada hallazgo, 1 verificador independiente sobre los hallazgos finales, y confirmación dinámica ejecutada por el orquestador sobre un stack local descartable.

## Resumen ejecutivo

**8 hallazgos: 0 críticos, 3 medios, 5 bajos.** El núcleo de la aplicación resistió tanto la lectura adversarial como las sondas en vivo: aislamiento entre usuarios, SQL, integridad del dinero, ciclo de vida de credenciales, XSS/CSRF y dependencias. Lo flojo está concentrado en dos zonas: **la superficie MCP** (todas sus entradas funcionan sin credencial) y **la postura de red** (HTTP en claro en la LAN). Más dos bugs de corrección de datos (moneda en el pago de suscripciones y carrera de valuaciones), ambos reproducidos.

## Hallazgos

| # | Hallazgo | Severidad | Estado de evidencia |
|---|---|---|---|
| F-01 | Transporte HTTP en claro en la LAN: expone la password de login, el bearer de sesión y los datos financieros; la sesión robada puede mintear un token API sin expiración | **MEDIO** | Verificado en fuente + despliegue medido |
| F-02 | MCP: `initialize` sin autenticación y sin tope ni TTL de sesiones → agotamiento de memoria del contenedor que también sirve API y SPA | **MEDIO** | Mecanismo confirmado; cifras de RSS no reproducidas |
| F-03 | MCP: `tools/call` sin autenticación escribe el log de auditoría — forja, desaloja y su texto vuelve como salida de tool | **MEDIO** | Confirmado (validado por tercero) |
| F-04 | MCP: `list_audit_log` legible sin credencial, mezclando callers | BAJO | Confirmado |
| F-05 | `pay` de suscripción ignora la moneda que sí exige `transfer` | BAJO-MEDIO | **Reproducido en vivo** |
| F-06 | Carrera de valuaciones fuera de orden: guard check-then-act + trigger que sobrescribe `current_value` | BAJO-MEDIO | **Reproducido 3/12 rondas** |
| F-07 | `--create-user` recibe la password por argumento de línea de comandos | BAJO | Verificado (carry-over A9) |
| F-08 | Password histórica de producción en un archivo trackeado + historia, en repositorio público, sin secret scanning | BAJO | Verificado (credencial muerta) |

---

## F-01 · Transporte en claro en la LAN — MEDIO

**Qué pasa.** No hay TLS en ninguna parte del árbol: el backend es `TcpListener::bind` + `axum::serve` (`backend/src/main.rs:394-399`), la etapa final del `Dockerfile` expone `80` y `3002` (`Dockerfile:52-64`) y el entrypoint levanta ambos procesos sin terminación TLS (`docker/entrypoint.sh:27-31`). Medido contra la API de Dokploy: puertos publicados `8055→80` y `8056→3002`, **sin dominios**, `autoDeploy: false`. El frontend manda la password cruda a `/api/login` (`frontend/lib/api/client.ts:111-121`), guarda el bearer en `localStorage["dashboard-token"]` (`client.ts:9,42-58`) y lo adjunta a cada llamada (`client.ts:185-193`). Un `HEAD` contra `http://192.168.50.120:8055` no devolvió `strict-transport-security`.

**Escenario de ataque.** Un vecino de red (Wi-Fi con PSK compartido, IoT, invitados, o cualquier host comprometido en el segmento) captura una petición: obtiene la **password** en el login, o el bearer (TTL de sesión configurable) en cualquier llamada posterior, además de los cuerpos completos con datos financieros. Con el bearer puede mintear un token API **sin expiración**, porque `expires_in_days` es opcional (`backend/src/routes/tokens.rs:125-130,179`) → acceso persistente hasta que el dueño lo note y revoque.

**Fix mínimo.** Terminar TLS en el borde (agregar dominio + Traefik/Let's Encrypt en Dokploy) o exponer solo por túnel (WireGuard/Tailscale). Complementario: expiración por defecto en `POST /api/tokens` y revisar el copy del login, que afirma "Conexión segura cifrada de extremo a extremo" sobre HTTP (`frontend/lib/i18n/es.ts:48`, `frontend/app/login/page.tsx:253`).

**Prior art.** Ya registrado como A8 (LOW, deployment) en `openspec/changes/2026-10-04-accounts-transfers-login-calendar/security-audit.md` y aceptado como riesgo de infra. La novedad de esta corrida es la cadena con A6 (token sin expiración) y la medición exacta del despliegue.

---

## F-02 · MCP: sesiones sin límite y sin autenticación → OOM — MEDIO

**Qué pasa.** `POST /mcp` solo pasa por `hostGuard` antes del despacho (`mcp-dashboard/src/index.ts:180`). Cada `initialize` crea y **guarda** un transporte + `Server` (`:200-206`, guardado vía `onsessioninitialized` en `:187-190`) en el mapa `transports` (`:174`), que no tiene tope, TTL ni evicción: solo se limpia al cerrar el transporte o con un `DELETE /mcp` explícito (`:242-259`). El contenedor supervisa ambos procesos y mata al hermano si alguno muere (`docker/entrypoint.sh:27-43`).

**Escenario de ataque.** Un cliente sin credenciales, alcanzando el puerto 8056, lanza N `initialize` en paralelo. El cazador midió ~43 KB por sesión sin recuperación por GC (9.000 sesiones ≈ 482 MB RSS; 40.000 ≈ 2 GB). Al morir el proceso MCP, el entrypoint termina el backend: caída total del sitio (API + SPA). Las cifras exactas de RSS **no** fueron reproducidas por el validador; el mecanismo (retención ilimitada en un mapa global) sí está confirmado en código.

**Fix mínimo.** Exigir bearer válido para `initialize` (y para `tools/call`), y poner tope + TTL al mapa de sesiones. Alternativa estructural: separar MCP en su propio contenedor con límite de memoria, para que su falla no arrastre la API.

---

## F-03 · MCP: `tools/call` sin autenticación escribe el log de auditoría — MEDIO

**Qué pasa.** El despacho no tiene ningún control de credencial (`mcp-dashboard/src/index.ts:116-150`). El handler registra en auditoría `request.params.name` **tal cual** (`index.ts:141-150`), sin límite de longitud ni juego de caracteres, incluso para tools inexistentes. El buffer es global y de 200 entradas: cada llamada desaloja la más vieja (`mcp-dashboard/src/tools.ts:1190-1195`). `readAuditLog` devuelve esos campos como texto de resultado (`tools.ts:1137-1150`).

**Escenario de ataque.** 200 llamadas sin credencial con nombres de tool arbitrarios (por ejemplo una frase de instrucción dirigida a un agente) destruyen la auditoría real y dejan ese texto como contenido que el agente del dueño leerá la próxima vez que consulte `list_audit_log` — precisamente la tool cuyo propósito es auditar.

**Precisión del validador.** El defecto de código determinista es la ausencia de gate antes de `tools/call` (forja + evicción + entrega de texto no confiable). La "inyección de prompt" es una consecuencia operativa dependiente del consumidor, no un resultado determinista; se reporta como superficie, no como exploit garantizado.

**Fix mínimo.** Bearer obligatorio para `tools/call`; sanear y acotar el nombre registrado; no devolver nombres desconocidos verbatim.

---

## F-04 · MCP: `list_audit_log` sin credencial y mezclando callers — BAJO

`list_audit_log` no usa el token y lee el buffer global (`mcp-dashboard/src/tools.ts:1137-1148,1173`), que guarda el prefijo de 8 caracteres del token usado (`:1178-1188`). Cualquier cliente de la LAN obtiene los metadatos de actividad de todos los llamadores (tool, hora, éxito) y el prefijo de tokens `pd_…`. El validador corrigió al cazador: el prefijo de 8 caracteres **no** sirve como credencial (token de 256 bits), así que el impacto es confidencialidad de metadatos, no de secretos. **Fix:** exigir auth y scopear el buffer por principal.

---

## F-05 · `pay` de suscripción ignora la moneda — BAJO-MEDIO

**Qué pasa.** `PAY_LOCK_ACCOUNT_SQL` / `PAY_DEBIT_ACCOUNT_SQL` bloquean y debitan la cuenta seleccionando solo por `id` (`backend/src/routes/subscriptions.rs:80-85`) y el handler nunca compara la moneda de la suscripción con la de la cuenta (`:493-563`), mientras que las transferencias sí rechazan monedas distintas (`backend/src/routes/movements.rs:470-474`). El modal de pago lista todas las cuentas sin filtrar (`frontend/components/finance/SubscriptionForms.tsx:162-165`).

**Reproducido en vivo** (stack local descartable): cuenta en `USD` creada (201), suscripción con `currency: "USD"` registrada como USD (201), y `POST /api/subscriptions/{id}/pay` desde una cuenta **COP** → **200**, con el saldo en `0 → -9.99`. El ledger queda con un débito expresado en la escala de la moneda equivocada y el saldo deja de representar lo que el usuario ve.

**Fix mínimo.** Cargar y comparar ambas monedas antes de insertar el movimiento y debitar (422 en caso de discrepancia), como ya hace `transfer`; filtrar la lista de cuentas del modal por moneda.

---

## F-06 · Carrera de valuaciones fuera de orden — BAJO-MEDIO

**Qué pasa.** El guard de orden es check-then-act sin bloqueo: se lee el máximo `recorded_on` (`MAX_VALUATION_SQL`, `backend/src/routes/assets.rs:92`) y se valida `<= latest` (`:591`) para después insertar (`:578-611`); el trigger `AFTER INSERT` de la migración `0003_savings_debts_subs_assets.sql:212-216` escribe `assets.current_value = NEW.value` sin condición. Dos peticiones concurrentes con fechas `D_old < D_new` pueden pasar ambas el guard, y la fila vieja que commitea última sobrescribe el valor nuevo.

**Reproducido en vivo, 3 de 12 rondas:** con una valuación base `2026-01-01`, disparando en paralelo `2026-03-01 (300.00)` y `2026-02-01 (200.00)`, la respuesta de la segunda fue **201** y `current_value` quedó en **200.00** aunque la fila del `2026-03-01` ya existía. En 8 rondas la respuesta también fue 201 pero el valor final quedó correcto (300) y en 1 ronda el guard rechazó (422); no hubo 500. El mismo camino puede producir deadlock (40P01) entre el `KEY SHARE` de la FK y el `FOR UPDATE` del trigger.

**Impacto.** `current_value` del activo y `GET /api/net-worth` (que suma `current_value`, `assets.rs:631-660`) quedan subvaluados o sobrevaluados de forma persistente: no hay endpoint de edición ni borrado de valuaciones, solo insertar otra.

**Fix mínimo.** Bloquear el activo (`SELECT … FOR UPDATE`) antes de leer el máximo, o mover el guard dentro del `INSERT` (`… WHERE recorded_on >= (SELECT max(recorded_on) …)`) y hacer que el trigger solo escriba cuando la fecha entrante sea la mayor (`GREATEST`/condición por fecha).

---

## F-07 · `--create-user` con la password por argv — BAJO

`backend/src/main.rs:337-380` toma la password de `std::env::args()` (`let password = args[3]`), sin alternativa por stdin o entorno: queda visible en `ps`, en el historial del shell y en los logs del sistema mientras corre. Carry-over del A9 del audit previo (aceptado). **Fix:** leerla de stdin o de una variable de entorno.

---

## F-08 · Credencial histórica de producción en repositorio público — BAJO

**Estado actual (medido por el orquestador).** El literal `pdbpass123` está en **el árbol del HEAD**, en `odd/tasks/finance-panel-consolidation-delta.patch:11`. Ese patch existe desde `f962654` y por lo tanto está presente en el árbol de los 20 commits desde `f962654` hasta `main`; `git log -S` muestra 4 commits que cambian el número de ocurrencias (5d92b66 la agrega en `CLAUDE.md`, f962654 agrega el patch, 8f2cbda, cbc3ad8 la quita de los docs). `CLAUDE.md` y `odd/tasks/solidificacion-dashboard.md` ya usan `<DB_PASSWORD>` desde `cbc3ad8`. **El repositorio de GitHub es público** (`api.github.com/repos/david14122720/personal-dashboard` → `private: false`) y `.github/` contiene solo `ci.yml`: **no hay secret scanning ni push protection**.

**Por qué es BAJO.** La credencial fue rotada el 2026-10-13 y el valor viejo ya no autentica (verificado en esa sesión por fallo de conexión). La imagen desplegada nunca la contuvo (`.dockerignore` excluye `.git/` y `odd/`). Residual real: backups/dumps/restauraciones que no siguieron la rotación, reutilización de la password en otro servicio, forks o clones públicos del repo.

**Fix mínimo.** Reemplazar el literal dentro del patch y sumar una guarda que impida que vuelva a entrar; activar **secret scanning + push protection** en GitHub (o el plugin `advanced-security`, la skill `secret-scanning` del propio repo cubre el flujo); decidir aparte si se reescribe la historia, sabiendo que eso cambia SHAs ya publicados.

---

## Notas de hardening (no son hallazgos)

- **MCP · fallback al token de entorno.** `extractRequestToken` cae al valor de `PERSONAL_DASHBOARD_TOKEN` no solo cuando falta la cabecera, sino siempre que no matchea `^Bearer\s+(.+)$` (`Basic`, `Token`, `Bearer` vacío, solo espacios) — `mcp-dashboard/src/index.ts:45-59` y otra vez en `client.ts:30-39`. En la imagen documentada la variable está deliberadamente sin setear, así que hoy no es explotable; es un riesgo de integración para cualquier deploy que la configure.
- **MCP · páginas de error en modo desarrollo.** No hay `NODE_ENV=production` en la imagen ni en el entrypoint, ni handler de errores propio: un JSON malformado devuelve 400/413 con stack trace y `X-Powered-By: Express`, y el parser (`index.ts:171`) corre **antes** del hostGuard (`:180`). Es reconocimiento (framework + rutas del contenedor, ya públicas en el Dockerfile). Fix barato: `ENV NODE_ENV=production`, `app.disable("x-powered-by")`, handler JSON 4xx.
- **Compose local.** `docker-compose.yml:11,41-43` usa `user:password` y publica `3000:3000` en todas las interfaces. Verificado que **no** es el camino de despliegue (Dokploy construye el `Dockerfile` raíz) y que no arranca sin un `.env` hecho a mano; el spec `build-reproducibility` ya lo tenía como "confirmar o borrar".
- **Build.** `Dockerfile:10,12`: `pnpm fetch --lockfile-only || true` y `pnpm install --frozen-lockfile --offline || pnpm install --frozen-lockfile`. El validador probó que el fallback online es *el* camino normal (el fetch con `--lockfile-only` no llena el store: `ERR_PNPM_NO_OFFLINE_TARBALL`), pero que la integridad de los lockfiles (380/380 `sha512`) impide sustituir contenido: apuntando el install a un registro falso con un tarball modificado, pnpm cortó con `ERR_PNPM_TARBALL_INTEGRITY`. Lo genuinamente sin pin: `corepack prepare pnpm@11.23.0`, los tags `node:22-slim` / `rust:1-slim-bookworm` y `next/font/google` (assets de fuente en build).
- **CSP.** Solo `frame-ancestors 'none'` (`backend/src/main.rs:304`); no hay `script-src` (diferido por diseño) y el FOUC guard es un `<script>` inline sin hash: cualquier futura inyección ejecuta sin mitigación, y un `script-src` futuro rompería el guard.
- **Resolución de entorno en runtime.** `process.env.NEXT_PUBLIC_API_URL` no queda fijado en build: el chunk lee `globalThis.process.env`, de modo que un script ya presente en la página puede redirigir todo el tráfico con `Authorization` a otro origen. Requiere ejecución previa (XSS/extensión): amplificador post-explotación, no hallazgo.
- **Oráculo de existencia.** Links a recursos ajenos responden 422 con mensaje ("belongs to another user") mientras los inexistentes dan 404 (y en hábitos/tareas/assets el patrón se invierte). Con UUIDv4 la enumeración es inviable: informativo.
- **Dinero.** Se acepta `1e3` como monto (parsea correctamente: 1000) y se permite sobregirar una cuenta; ambos son decisiones de formato/producto, no vulnerabilidades. `-10`, `0`, `0.001`, 20 dígitos, 10 decimales y `1,000` se rechazan con 422.
- **Guard de pago reabrible.** `PATCH /api/subscriptions/{id}` con `next_billing_on` en el pasado rehabilita el pago del mismo ciclo (`subscriptions.rs:78,346-348,530-543`) — reproducido: segundo `pay` inmediato 409, tras el `PATCH` 200, saldo −19.98. Es la plata del propio dueño y no cruza privilegios: es una guarda anti-doble-submit, no una frontera de seguridad.
- **Logout silencioso.** El resultado de la revocación se calcula y se descarta (`frontend/lib/api/client.ts:143-164` vs `AppShell.tsx:372,448`): si el servidor no responde en 3 s, el usuario queda deslogueado localmente pero la sesión sigue viva hasta el TTL, sin aviso.
- **Dependencias.** 9 advisories en 4 paquetes sobre 767 escaneados contra OSV. `next` 16.3.6: 6 advisories **estructuralmente inalcanzables** (no existe servidor Next en runtime: `output: "export"`, solo se copia `frontend/out` a estáticos, sin `route.ts` ni `middleware.ts`; *image optimization* no está en el bundle). `@modelcontextprotocol/sdk` 1.30.1: CVE-2026-104850 del lado cliente OAuth (no se usa). `source-map-js` 1.2.1 y `sharp` 0.35.4: cadena de build. Igual conviene subir `next`→16.3.8 y el SDK→≥1.31.0.

## Lo que está bien (calibra la confianza en lo demás)

SQL 100% parametrizado (`bind`/`push_bind` en todo; sin identificadores ni `ORDER BY` dinámicos, sin `unsafe`, sin `Command`, sin `eval`), con FTS por `plainto_tsquery` ligado · auth por handler con `user_id` en cada consulta — **verificado en vivo**: 10 tipos de recurso × GET/PATCH/DELETE con credencial ajena → todo 404, datos de la víctima intactos, referencias cruzadas en body → 422/404 sin escritura · Argon2id `m=19456,t=2,p=1` con hash dummy (una verificación por intento sintácticamente válido: sin enumeración por tiempo) · sesiones y tokens de 256 bits CSPRNG, solo el hash en base, mint solo-sesión con presupuesto atómico, revocación inmediata · **sin cookies y sin CORS** → CSRF inviable y sin fuga cross-origin · `X-Frame-Options: DENY` + `frame-ancestors 'none'` sobre API y SPA · `Referrer-Policy: no-referrer` y `Cache-Control: no-store` donde viajan tokens · validación estricta (`deny_unknown_fields`) y límites de cuerpo (notas 1 MiB, layout acotado) · caminos de dinero con `FOR UPDATE` consistentes: 8 transferencias paralelas exactas, pago concurrente 200+409, log de hábito concurrente 201+409 · **433 unit + 43 tests de integración en verde** contra base local · **0 advisories en ~200 crates** · **0 sinks XSS en todo el frontend** (el único `dangerouslySetInnerHTML` es una constante de compilación), sin scripts de terceros ni service worker, lockfiles con integridad `sha512`.

## Evidencia dinámica ejecutada (stack local descartable, nunca producción)

| Sonda | Resultado observado |
|---|---|
| Suite del repo contra Postgres local | 433 unit + 43 integración, **0 fallos** |
| Aislamiento cruzado (10 recursos × GET/PATCH/DELETE) | todo **404**; listas ajenas no aparecen; recurso propio intacto |
| Referencias cruzadas en body (cuenta/categoría/meta ajena) | **422 / 404**, sin escritura |
| Montos `-10`, `0`, `0.001`, `1e3`, 20 dígitos, 10 decimales, `1,000` | 422 salvo `1e3` → 201 (parsea 1000) |
| 8 transferencias concurrentes | 8×201, saldos exactos (−2018 / +8), sin lost update |
| 2 pagos concurrentes de la misma suscripción | **200 + 409** |
| 2 logs de hábito concurrentes, misma fecha | **201 + 409** |
| Ciclo de vida | logout→401; token API funciona en `/accounts` y **rechazado** en `/me`, `/sessions`, `POST /tokens`; revocado → 401 |
| Pago con moneda cruzada (F-05) | **200** y débito 9.99 en cuenta COP con suscripción USD |
| Carrera de valuaciones (F-06) | **3/12** rondas con `current_value` regresado pese a existir la valuación nueva |
| Limpieza | 0 usuarios, 0 filas huérfanas, contenedor borrado, puertos libres |

## Límites de esta corrida

- **Cobertura parcial por diseño:** la metodología estima que la mejor corrida individual encuentra ~la mitad del total de vulnerabilidades. Conviene repetirla, y volver a correrla después de aplicar los fixes.
- **No verificado:** valor real de `SESSION_TTL_HOURS` en producción, si `DATABASE_URL` exige `sslmode`, si la LAN/Wi-Fi comparte segmento con invitados o IoT, si `8056` se publica más allá de la LAN, el límite de memoria del contenedor y el RSS exacto por sesión MCP (F-02), si algún consumidor quedó con la password vieja (F-08), y si el dueño usa `list_audit_log` (que activa el impacto de F-03).
- **Incidentes de proceso declarados:** el subagente delegado para la confirmación dinámica falló por una falla de harness (sin dejar contenedores ni puertos), así que esa fase la ejecutó el orquestador; y el primer script de sondas de dinero quedó colgado por un bug propio (`wait` sin argumentos que esperaba también al servidor), por lo que esa parte se relanzó corregida.
- **Verificación aplicada:** validación adversarial por superficie (MCP e infraestructura) + verificación independiente de los 7 hallazgos finales. Correcciones incorporadas de esa instancia: F-02 baja de "DoS barato" a mecanismo confirmado sin cifras reproducidas; F-03 pasa de "prompt injection" a defecto de integridad de auditoría con superficie de inyección; F-04 baja su impacto (el prefijo no es credencial); F-08 corrige el conteo de commits (4 con `-S`, 20 con el patch en el árbol); F-01 incorpora que el login expone la **password** (peor que el bearer) y el matiz de WPA2-PSK/WPA3.

## Prioridad sugerida

1. **F-02 + F-03** — exigir bearer en `initialize` y en `tools/call` cierra los dos, es el cambio más chico y protege la integridad de la auditoría y el contenedor.
2. **F-01** — TLS en el borde o túnel, y expiración por defecto en `POST /api/tokens`.
3. **F-05 + F-06** — corrección de datos con fix acotado (comparar monedas; bloquear el activo o mover el guard al `INSERT`).
4. **F-08 + F-07** — secret scanning/push protection, reemplazar el literal del patch y sacar la password de argv.
5. **F-04** — auth y scope del buffer de auditoría.

## Prior art (auditoría previa del repo, 2026-10-04)

`openspec/changes/2026-10-04-accounts-transfers-login-calendar/security-audit.md` registró A1–A10 con decisión del dueño de arreglar A1–A5 y A7. Esta corrida **verificó que esos cinco ya están remediados**: A1 (XFF se recorre de derecha a izquierda y `TRUSTED_PROXIES` decide), A2 (límite por IP **y** por cuenta, solo fallos), A3 (hash dummy: una verificación Argon2 por intento), A4 (`users.is_active` se exige en cada resolución, sesiones y tokens incluidos), A5 (listado y revocación de sesiones + acción en Ajustes), A7 (`no-store` en login y tokens). Siguen abiertos por decisión: **A6** (scopes sin uso y expiración opcional de tokens — se encadena con F-01), **A8** (= F-01), **A9** (= F-07) y **A10** (token en `localStorage`; hoy sin sink XSS que lo alcance).
