# Hermes: Runs API asíncrona, aprobaciones de seguridad, proxy en Rust y gestor de medios

Branch: `main` (sin commits ni push por orden explícita del dueño, S15.7). Runner: `cargo test` (backend) + `pnpm test` / `tsc` (frontend) + Playwright (e2e/visual) + Judgment Day. DB: producción, cero migraciones.

## Specs

- **S1 — Blindaje de credenciales.** La clave `API_SERVER_KEY` vive exclusivamente en el `.env` del backend Rust y nunca aparece en el bundle del cliente, en el HTML público ni en el panel de red del navegador. El navegador sólo habla con el proxy.
- **S2 — Proxy autenticado.** Toda petición del frontend pasa por el backend Rust con sesión autenticada del usuario; el proxy inyecta `Authorization: Bearer ${API_SERVER_KEY}` y propaga la clave de sesión de Hermes (`session_id` en el cuerpo; `X-Hermes-Session-Key` para memoria de largo plazo).
- **S3 — Runs API.** `POST /api/hermes/runs` invoca `POST /v1/runs` y devuelve de inmediato `{run_id, session_id, created_at}`. La suscripción `GET /api/hermes/runs/{run_id}/events` reemite el SSE de Hermes al navegador.
- **S4 — Keepalive.** El parser del navegador ignora silenciosamente las líneas de comentario (`: keepalive`, `: open`, `: stream closed`) y los frames `id:`.
- **S5 — Resiliencia ante recargas.** Si el usuario refresca mientras Hermes trabaja, la UI recupera el `run_id` activo, consulta `GET /api/hermes/runs/{run_id}` y se re-engancha al SSE sin perder la conversación ni interrumpir el proceso.
- **S6 — Cronómetro.** Mientras el run está activo la UI muestra `Hermes está trabajando... ⏱️ MM:SS` contando en vivo desde el `created_at` del run, y sobrevive al refresh.
- **S7 — Tarjeta de aprobación.** Ante `approval.request` se muestra `<ApprovalRequestCard>` con icono de candado, nombre de la herramienta, el comando/parámetro exacto y los botones **"Aprobar"** y **"Denegar"**.
- **S8 — Resolución de aprobación.** "Aprobar" envía `POST /api/hermes/runs/{id}/approval` con `{"request_id": "<prompt_id>", "execution_generation": N, "choice": "once"}`; "Denegar" envía `{"choice": "deny"}`. Tras la respuesta el run reanuda solo.
- **S9 — Accordion de pensamiento.** Los eventos `reasoning.available`, `tool.started`, `tool.completed` y `<thinking>` alimentan un botón colapsado por defecto: `Pensamiento ▸` o `Llamando a [herramienta] ▸`.
- **S10 — Cuestionarios interactivos.** Las preguntas con alternativas se muestran en `<InteractiveQuestionCard>` con paginación `< 1 de 2 >` e input "Otra cosa"; la respuesta reanuda el hilo.
- **S11 — Rutas de medios.** Cualquier `/opt/data/...`, `/tmp/...` o `MEDIA:...` de la respuesta se convierte en tarjeta de descarga o reproductor nativo.
- **S12 — Cola.** Si se envía un mensaje mientras hay un run activo en la sesión, la UI lo muestra como **"En cola ⏳"** y lo envía cuando el run actual termina.
- **S13 — Layout.** Sin barras de scroll internas en las burbujas; `overflow-y: auto` sólo en el contenedor padre de la conversación, con auto-scroll suave.
- **S14 — Endpoint de medios.** `GET /api/hermes/media?path=...` con lectura segura, `Accept-Ranges: bytes`, streaming de video/audio y `Content-Disposition: attachment; filename="..."` para documentos.
- **S15 — Criterios de aceptación (verbatim del dueño).**
  1. La autenticación de Hermes (`API_SERVER_KEY`) vive exclusivamente en el proxy en Rust y el servidor API escucha únicamente en `127.0.0.1`.
  2. Las ejecuciones largas se gestionan mediante la API de Runs (`POST /v1/runs`), sobreviviendo a recargas de la página gracias a los eventos SSE (`/v1/runs/{id}/events`).
  3. El cronómetro en vivo marca el tiempo transcurrido (`⏱️ MM:SS`) omitiendo silenciosamente las líneas `: keepalive`.
  4. Al requerir permisos de terminal o herramientas, la interfaz despliega una tarjeta de aprobación permitiendo confirmar o rechazar la acción con un clic (`/v1/runs/{id}/approval`).
  5. Las preguntas con opciones se presentan mediante tarjetas interactivas estilo Claude UI.
  6. Las rutas `/opt/data/...` se transforman automáticamente en tarjetas de descarga o reproductores de video/audio en la web.
  7. Si se envía un mensaje mientras Hermes está ocupado, la UI lo muestra en estado "En cola ⏳".
  8. El proceso del "Día del Juicio" concluye con éxito garantizando un chat estable, seguro y completamente responsivo.

### Contrato medido contra el gateway real (hermes-agent 0.22.5, 2026-10-28)

- `POST /v1/runs` `{input, session_id?}` → `202 {run_id: "run_<hex>", status: "started", replayed}`. `input` acepta string o lista de mensajes; una lista con `content` en partes (`{type:"image_url", image_url:{url:"data:image/png;base64,..."}}`) conserva la visión (probado: respondió "Rojo 🔴").
- `GET /v1/runs/{id}` → `{status, session_id, execution_generation, pending_controls, output, usage, created_at, ...}`.
- `GET /v1/runs/{id}/events` → SSE con líneas `id: N` + `data: {event, run_id, timestamp, seq, ...}`; NO usa `event:`; comentarios `: open`, `: keepalive`, `: stream closed`.
- Eventos observados: `message.delta {delta}`, `tool.started {tool, preview, tool_call_id}`, `tool.completed {tool, duration, error, preview, tool_call_id}`, `approval.request {kind, prompt_id, execution_generation, command, description, choices}`, `approval.settled {prompt_id, execution_generation}`, `run.completed {output, usage, completed, partial, interrupted}`. Fuente 0.22.5: también `reasoning.available {text}`, `message.interim`, `run.queued`, `run.stopped`, `run.failed/cancelled/interrupted`.
- `approval.request` real medido: `{"kind":"approval","prompt_id":"9f8920…","execution_generation":1,"command":"rm -rf …","description":"delete in root path","choices":["once","deny","session","always"]}`. El gate expira a los 60 s sin respuesta (silencio ≠ consentimiento) y emite `approval.settled`.
- `POST /v1/runs/{id}/approval` con `{request_id, execution_generation, choice}` → `200 {run_id, status:"resolved", prompt_id}` (no devuelve `choice`); repetirlo → `409 approval_not_pending`. Tras resolver, el run sigue y termina solo.
- `/v1/runs/{id}/clarify` **no está registrado** en 0.22.5 (no figura en `/v1/capabilities` ni en la tabla de rutas del tag `v0.22.5`), aunque existe un delegate muerto en el código.
- `/v1/chat/completions` rechaza `input_audio` (400 `unsupported_content_type`): la nota de voz sigue viajando como nota degradada.
- `GET /health` → `{status:"ok", platform:"hermes-agent", version:"0.22.5"}` en `http://192.168.50.120:8642` (LAN, no loopback: ver D3).

### Desvíos y decisiones (declarados)

- **D1 — Clarificación sin endpoint.** 0.22.5 no expone `/v1/runs/{id}/clarify`; S10 se cumple enviando la respuesta elegida como el siguiente run de la misma sesión (comportamiento actual del chat), no por un canal `answer` inexistente.
- **D2 — `request_id` = `prompt_id`.** El cuerpo del POST usa `request_id` con el valor del `prompt_id` del evento y `execution_generation` copiado del mismo evento; `choice` se limita a `once`/`deny` desde la tarjeta (la UI no ofrece `session`/`always` en esta entrega).
- **D3 — Binding en loopback es del host de Hermes.** El gateway responde hoy en `192.168.50.120:8642` (LAN) y el backend corre en otro host/contenedor; forzar `127.0.0.1` allí rompe la topología y no se puede aplicar desde este repo. Se cumple y verifica la mitad del criterio que sí es nuestra (la clave nunca sale del `.env` del backend ni viaja al navegador) y se reporta el binding como acción del dueño en el host de Hermes.
- **D4 — El run sobrevive al navegador.** Al migrar a Runs, cerrar la pestaña ya no cancela al agente: el run sigue en el gateway (eso es lo que habilita S5). Consecuencia aceptada: un run abandonado consume hasta terminar.
- **D5 — Sesión de Hermes por usuario.** El proxy deriva `session_id = "pd-<user_id>-<uuid-del-cliente>"`; el navegador nunca elige el id real de Hermes y un usuario no puede dirigir la sesión, el stream ni las aprobaciones de otro. La pertenencia de un run se verifica contra el `session_id` que reporta `GET /v1/runs/{id}` (sin estado en memoria ni DB). Efecto declarado: la continuidad del hilo server-side de Hermes arranca de cero una vez (el transcript visible del cliente no se pierde).
- **D6 — Adjuntos.** El navegador sigue enviando `multipart` al proxy; el proxy compone `input` con partes de contenido (texto inline, imagen `data:`), reutilizando el constructor actual. La nota de voz sigue degradada a nota de texto (el gateway no acepta `input_audio`).
- **D7 — Transporte del navegador.** El proxy reemite los eventos de Hermes tal cual (`data:` + `id:`, comentarios incluidos) en lugar de traducirlos a un vocabulario propio: el contrato del run es el del gateway y la UI lo consume directo.
- **D9 — Ventana de refresh sin puntero.** El id del run sólo se conoce cuando `POST /api/hermes/runs` responde; el reloj ya está visible antes. Un refresh dentro de esa ventana (~200-500 ms) deja el turno sin puntero: el run sigue en el gateway pero su salida no vuelve a la UI. Es el único hueco que queda de S5, medido con el e2e live, y no tiene arreglo cliente sin una clave de idempotencia servidor-side.
- **D8 — Sin `git commit`/`git push`.** El dueño lo prohíbe explícitamente en esta entrega; los cambios quedan en el árbol de `main`.

### API del proxy (contrato navegador ↔ backend, camelCase)

1. `POST /api/hermes/runs` — sesión del dashboard obligatoria (`require_session_user_id`, **no** API tokens). Acepta `application/json` `{sessionId, message}` o `multipart/form-data` con `sessionId`, `message` y `files` repetidos (mismo parseo de adjuntos que ya existe). Responde `202 {runId, sessionId, createdAt}` (`createdAt` en ms). Errores: `{error:{code,message}}`; 401 `UNAUTHORIZED`, 422 `VALIDATION_ERROR`, 503 `HERMES_NOT_CONFIGURED`, 502 `HERMES_UPSTREAM_ERROR`, 503 `HERMES_UNAVAILABLE`.
2. `GET /api/hermes/runs/{runId}` — 200 `{runId, status, sessionId, createdAt, updatedAt, executionGeneration, output, usage, completed, partial, interrupted, error, pendingControls}` (whitelist). Run ajeno o inexistente → 404 `HERMES_RUN_NOT_FOUND`.
3. `GET /api/hermes/runs/{runId}/events` — `text/event-stream` con los frames de Hermes **verbatim** (`id:`, `data:`, comentarios `: keepalive` incluidos), `Cache-Control: no-store`, `X-Accel-Buffering: no`. Verifica pertenencia antes de abrir el upstream.
4. `POST /api/hermes/runs/{runId}/approval` — cuerpo `{requestId?, executionGeneration?, choice}` (`choice` ∈ `once|deny|session|always`); 200 `{runId, choice, resolved}`; conflicto upstream → 409 `HERMES_APPROVAL_CONFLICT`.
5. `GET /api/hermes/media` y `POST /api/hermes/media/sign` — sin cambios (S14).

Se **retira** `POST /api/hermes` (chat completions) junto con la traducción SSE propia, el splitter de `<thinking>`, `normalize` y la firma de artefactos del lado servidor: el navegador consume el vocabulario de runs y firma las rutas con `/media/sign`.

`sessionId` del navegador = UUID cliente; el proxy usa `pd-<user_id>-<uuid>` hacia Hermes. La pertenencia de un run se resuelve pidiendo `GET /v1/runs/{id}` y exigiendo que su `session_id` empiece con `pd-<user_id>-` (sin estado ni DB). `run_id` se valida con `^run_[A-Za-z0-9]{1,60}$` antes de tocar la URL.

## Tasks

- [ ] T1 backend/runs: módulo `hermes_runs` (config del gateway, cliente `POST /v1/runs`, `GET /v1/runs/{id}`, `GET .../events`, `POST .../approval`), namespacing de sesión por usuario, verificación de pertenencia. Tests unitarios. — inline
- [ ] T2 backend/rutas: montar `/api/hermes/runs`, `/api/hermes/runs/{id}`, `/api/hermes/runs/{id}/events`, `/api/hermes/runs/{id}/approval` autenticadas; retirar el camino `chat/completions` del proxy. Test de integración con upstream falso (SSE real, aprobación, 404 ajeno, 401 sin sesión). — inline
- [ ] T3 frontend/api: `createHermesRun`, `streamHermesRun` (parser SSE con comentarios e `id:`), `getHermesRun`, `resolveHermesApproval`. Tests. — inline
- [ ] T4 frontend/ui: `ApprovalRequestCard`, cronómetro desde `created_at`, estado "En cola ⏳", re-enganche al refrescar, accordion con `reasoning.available`. Tests. — inline
- [ ] T5 frontend/chat: cableado completo en `HermesChat` (envío, stream, aprobación, cola, reanudación, scroll único). Tests de página. — inline
- [ ] T6 i18n: strings nuevos. — inline
- [ ] T7 e2e + validación visual (Playwright): run largo con cronómetro, refresh y re-enganche, aprobación real (aprobar y denegar), cola, medios, móvil. — inline
- [ ] T8 Judgment Day + cierre con evidencia. — inline

## Log

**L1** (verbatim) "bien amigo hoy vamos a implementar estas mejoras al chat dale: Módulo Hermes Agent (Runs API Asíncrona, Aprobaciones de Seguridad, Proxy en Rust y Gestor de Medios) …" (spec completo en S1–S15; reglas: DB de producción, prohibido crear/migrar bases locales, prohibido `git commit`/`git push`).

**L2** Exploración (read-only, 2026-10-28): `backend/src/routes/hermes.rs` (2406 líneas, camino `chat/completions` con SSE propio), `hermes_media.rs` (972 líneas, HMAC + Range + raíces `/opt/data` y `/tmp`), `frontend/components/hermes/*` (HermesChat 31 KB, ThoughtAccordion, InteractiveQuestionCard, ArtifactCard, MicButton) y `frontend/lib/api/hermes.ts` (423 líneas). El proxy ya inyecta la clave y nunca la expone.

**L3** Sondas contra el gateway real (ver "Contrato medido"): `/v1/runs` existe (405 en GET), `{input}` obligatorio, `session_id` va en el cuerpo (el header `X-Hermes-Session-Id` es sólo de chat completions), el stream reemite backlog al suscribirse tarde, la visión funciona con partes `image_url`, el `rm -rf` quedó parkeado 60 s y devolvió `approval.request` con `prompt_id`/`execution_generation`, y luego `approval.settled` + `run.completed`.

**L4** Backend entregado y verificado (2026-10-28): `hermes.rs` reescrito al Runs API (se retiró el transporte `chat/completions` completo) con 47 tests propios; suite del bin `519 passed / 0 failed`; build sin warnings. Los cuatro endpoints quedan montados en el nivel externo, fuera del presupuesto de 15 s, y `/api/hermes/media[/sign]` no cambia.

**L5** Validación real proxy↔gateway (agregada al módulo como `#[ignore]`, sin DB): `cargo test --bin personal-dashboard-backend live_runs_ -- --ignored` → **2/2 en 18.46 s**.
- `live_runs_gateway_round_trip`: crea el run, confirma que el gateway **devuelve el `session_id` namespaceado** en `GET /v1/runs/{id}` (sin eso el guard de pertenencia daría 404 siempre), y que una suscripción tardía reemite el backlog con `id:`/`data:` intactos hasta `run.completed`.
- `live_runs_approval_round_trip`: un `rm -rf` parkea el run, el proxy responde con `prompt_id` + `execution_generation` y `choice: "deny"`, y el run **reanuda y completa solo** (el comando nunca se ejecuta).
- Corrección de contrato medida en el acto: la respuesta de aprobación de 0.22.5 es `{run_id, status:"resolved", prompt_id}` (no devuelve `choice`), y repetirla da `409 approval_not_pending`.

**L6** Frontend entregado y verificado (2026-10-28): transporte de runs (`createHermesRun`/`streamHermesRun`/`getHermesRun`/`resolveHermesApproval`), `ApprovalRequestCard`, `HermesChat` reescrito (eventos vivos, cronómetro desde `createdAt`, cola con marca `data-queued`, re-enganche), i18n y persistencia del transcript. Gates: `tsc` limpio y **860/860 tests** en 70 archivos.

**L7** e2e con el stack real (backend nuevo en `:3100` sirviendo el export, DB de producción, usuario descartable `e2e-throwaway@example.test`, gateway real).
- **Suite stub (12/12)**: cronómetro, pensamiento colapsado, cuestionario con paginación, S4 (comentarios/`id:` ignorados), aprobación aprobar y denegar con el cuerpo exacto, S12 cola, S5 refresh, S6 reloj tras el primer token, tarjetas de medios y reproductores, scroll único.
- **Suite live sin stubs (3/3)**: run real con cronómetro y re-enganche tras refresh, `rm -rf` parkeado y **denegado desde la tarjeta** (el comando nunca se ejecuta), y cola real con el segundo turno disparándose solo.
- Defectos de harness corregidos (no del producto): el token `e2e-stub` pisaba el real (todo rebotaba a `/login/`), conteo de botones del cuestionario sin las flechas, y dos carreras (S5 entregaba el stream completo antes de poder ver el reloj; S12 liberaba el run 1 antes de poder ver el badge).
- **Tres defectos reales de producto que sólo aparecieron con el e2e live**: (a) el refresh perdía la conversación → transcript persistido con topes; (b) un run que terminaba durante el refresh perdía su `output` → recuperación por `GET /runs/{id}`; (c) el abort del stream al recargar se trataba como fallo del run y **borraba el puntero** → un subsistema caído ya no borra el puntero, y el `created_at` del gateway (segundos) se normaliza a ms. Los tres con evidencia RED→GREEN medida con un spec de diagnóstico que se borró después.
