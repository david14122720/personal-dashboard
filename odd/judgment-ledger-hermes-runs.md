# Judgment Day — hermes-runs-aprobaciones

Target frozen 2026-10-28 (uncommitted working tree, no commits by owner rule): `backend/src/routes/hermes.rs`, `backend/src/main.rs`, `frontend/lib/api/hermes.ts(+test)`, `frontend/lib/hermes/session.ts(+test)`, `frontend/components/hermes/{HermesChat,ApprovalRequestCard}(+tests)`, `frontend/lib/i18n/es.ts`, `frontend/e2e/hermes-{streaming,artifacts,live}.spec.ts`.

Judges: `jd-judge-a` (2 attempts), `jd-judge-b` (2 attempts; the first run died on a provider error). Both read-only, blind, identical scope.

## Ledger

| ID | Sev | Class | Confirmado por | Hallazgo |
|---|---|---|---|---|
| JD-B-001 | **HIGH** | determinístico (mecanismo) / inferido (consecuencia) | solo B | Un fallo de transporte del SSE limpia `activeRunRef`/`live` y llama `pumpQueue()`: con un turno en cola (o un Retry inmediato) arranca un **segundo** run en la misma sesión mientras el primero sigue vivo en el gateway, y `saveActiveRun` pisa el puntero → se pierde la respuesta del primero y pueden ejecutarse dos veces herramientas sensibles. El invariante "un run a la vez" solo se sostiene con la suscripción sana. |
| JD-B-002 | MEDIUM | inferido | solo B | Un refresh mientras el run está parkeado en aprobación no restaura la tarjeta: `resumeStoredRun` decide con una lista de estados adivinada e ignora `pendingControls` (que el proxy devuelve y el cliente parsea sin usarlo). Si el estado no coincide o el backlog no reemite `approval.request`, el puntero se borra y el gate expira por silencio. Es la combinación S5+S7 del spec. |
| JD-B-003 | MEDIUM | determinístico | solo B | `toStoredBubble` fuerza `queued: false`: tras un refresh, un mensaje que estaba en cola se restaura como enviado y nunca se envía. Sin badge, sin error, sin retry. |
| JD-B-004 | MEDIUM | inferido | solo B | `approval.request` se ignora si falta `command`: la tarjeta exige `prompt_id` y `command`. Los gates medidos (terminal) traen `command`; un gate con solo parámetros/preview quedaría invisible y el run parkeado 60 s. |
| JD-B-005 | MEDIUM | determinístico | solo B | El transcript se guarda en la clave global `pd-hermes-messages`, sin namespace por usuario, y `clearToken()` no la borra: en un navegador compartido, el usuario B ve la conversación de A. El backend es multi-usuario. |
| JD-B-006 | MEDIUM | determinístico | **A (JD-A-003) + B** | No hay test de handler que pruebe 404 para un run ajeno en `events`/`approval` con llamador autenticado: borrar la verificación de pertenencia deja la suite verde. La propiedad está implementada pero no clavada. |
| JD-A-001 = JD-B-011b | MEDIUM | inferido | **A + B** | El parser SSE corta solo con `\n\n` y no normaliza CRLF; un upstream o intermediario CRLF bufferiza el stream entero. |
| JD-B-011a | LOW | determinístico | solo B | No hay test a nivel router de que `/events` no se comprima/bufferice (quitar `NotForContentType("text/event-stream")` deja todo verde). |
| JD-B-007 | LOW | determinístico | solo B | `codeForStatus` mapea por HTTP status: el 502+`HERMES_UNAUTHORIZED` del proxy cae en "unavailable"; el test de 401+HERMES_UNAUTHORIZED afirma una respuesta que el backend no puede producir. |
| JD-B-008 | LOW | inferido | solo B | `run.completed` se toma siempre como éxito y usa `output` aunque venga vacío/parcial: se descarta el borrador que el usuario estaba leyendo, sin aviso. |
| JD-A-002 | LOW | determinístico | solo B/A parcial | `loadActiveRun` no valida shape y el mount ignora `stored.sessionId`: un puntero viejo de otra conversación se reanuda en el hilo equivocado. |
| JD-B-009 | LOW | determinístico | solo B | `createHermesRun` no tiene timeout ni señal, y `startingRef` es un ref: en un multipart grande no hay indicador y un create colgado bloquea todo en "En cola ⏳" sin salida. Contradice D9. |
| JD-B-010 | LOW | determinístico | solo B | Código muerto del cambio de transporte: `warningsOf` sin llamadas, canal de `warnings` (y su i18n) inalcanzable aunque el backend viejo sí avisaba degradaciones. |
| JD-B-012 | INFO | determinístico | solo B | Heredado, no regresión: las imágenes usan `keep_limit = usize::MAX` y los comentarios afirmaban "constant RAM". |

## Triage del orquestador

- **Confirmados por ambos jueces (2):** JD-B-006 (MEDIUM) y JD-A-001/JD-B-011b (MEDIUM). Ninguno severo.
- **Severo de un solo juez (1):** JD-B-001 (HIGH). El mecanismo es verificable en código (el `catch` de `attachStream` llama `clearRunState(runId, true)` y después `pumpQueue()`); la consecuencia depende de la concurrencia por sesión del gateway, que **no está medida**. Por protocolo queda *suspect*: no se corrige sin confirmación.
- **Ningún hallazgo CRITICAL.** No hay bypass de autorización, no hay filtración del secreto, no hay corrupción de datos del servidor.

## Veredicto

`JUDGMENT: ESCALATED ⚠️` — el presupuesto de corrección no se gastó: no hay hallazgo severo confirmado por ambos jueces, y aplicarlo sin confirmación violaría el contrato del método. El ledger queda arriba, con severidad y evidencia, para que el dueño decida si abre una ronda acotada.

## Ronda 1 (autorizada por el dueño)

Se corrigieron los cuatro que el orquestador propuso:

- **JD-B-001** — el fallo de transporte ya no cierra el run: se reintenta el SSE con backoff acotado (1 s y 3 s, reconstruyendo el borrador desde el backlog), se conserva `activeRunRef` y el puntero, y **nunca** se libera la cola por un stream caído. Solo un evento terminal, el desmontaje o el re-montaje liberan el turno siguiente.
- **JD-B-002** — `resumeStoredRun` trata un `pendingControls` no vacío como run activo y reconstruye la tarjeta de aprobación con `prompt_id`/`execution_generation`/`command`/`description` del control; un status fuera del set activo con `pendingControls: []` sigue limpiando el puntero.
- **JD-B-006 + JD-A-003** (confirmado por ambos) — tests a nivel handler con upstream falso y llamador autenticado: run ajeno en `events`/`approval` → 404 y **cero** peticiones al endpoint upstream, más un control positivo por endpoint. Evidencia RED/GREEN: con `ensure_owned` comentado falla (`50 passed; 1 failed`); restaurado pasa (`51 passed; 2 ignored`).
- **JD-A-001 + JD-B-011b** (confirmado por ambos) — el parser normaliza `\r\n` antes de cortar frames; test con frames CRLF, `: keepalive` e `id:` que verifica dispatch y silencio de comentarios/cursores.

Quedan abiertos, sin corregir: JD-B-003, JD-B-004, JD-B-005, JD-B-007, JD-B-008, JD-B-009, JD-B-010, JD-B-011a, JD-B-012 y JD-A-002.

Gates de la ronda 1: `tsc` limpio; frontend **865/865**; backend `51 passed / 2 ignored` (los dos live contra el gateway real).

## Medición de la ronda 2 (cierra la duda de MEDIUM-2)

`GET /v1/runs/{id}` mientras el run está parkeado devuelve `pending_controls[0]` con **la misma forma que el evento `approval.request`**:

```json
{"kind":"approval","prompt_id":"8a10d838…","execution_generation":1,
 "command":"rm -rf /tmp/hermes-pending-probe && echo \"done (exit $?)\"",
 "description":"delete in root path","choices":["once","deny","session","always"]}
```

Consecuencias verificadas en la misma sonda:
- La tarjeta reanudada puede construirse con el mismo mapper que el evento (sin alias adivinados).
- El POST de aprobación espera `request_id` (renombrado desde `requestId` por el proxy); mandar `prompt_id` devuelve **400**. El cliente ya lo hace bien.

## Ronda 2 (autorizada por el dueño, tras el re-juicio de la ronda 1)

El re-juicio de la ronda 1 marcó **JD-B-001 FIXED**, **JD-B-006/003 FIXED** y **CRLF FIXED**, y destapó un defecto **introducido por la propia corrección**:

- **HIGH-1 (regresión de la ronda 1)** — al agotarse los reintentos, el chat quedaba en un callejón sin salida: el guard del run se mantenía con `live = null`, la cola nunca se bombeaba, `retry()` borraba la burbuja de error antes de encolar (perdiendo el texto del usuario) y "Nueva conversación" era no-op. Salida única: recargar la página.
- **MEDIUM-2** — la tarjeta de aprobación reanudada exigía un shape de `pending_controls` que nadie había medido, y si no coincidía fallaba en silencio (volvía el gate que expira por silencio).

Correcciones de la ronda 2:

1. **HIGH-1** — estado `streamLost` visible (nunca `live === null` con el guard tomado), reintentos solo para errores transitorios (`network`/`unavailable`/`timeout`; un 4xx se muestra al instante), `retry()` re-engancha **el mismo run** conservando el texto, y "Nueva conversación" funciona como escape declarado cuando el stream se perdió.
2. **HIGH-1, parte final (hallazgo del juez A en el juicio de la ronda 2)** — faltaba un **token de generación de suscripción**: el terminal tardío del stream viejo pasaba el chequeo por `runId`, settleaba el run y bombeaba la cola con el stream nuevo vivo. Ahora cada `attachStream` toma una generación monotónica y `onEvent`/`onTerminal`/el `catch`/el timer de reintento actúan solo si su generación sigue siendo la actual. Evidencia RED/GREEN: con los guards desactivados fallan los dos tests nuevos; restaurados, **873/873**.
3. **MEDIUM-2** — un único mapper (`approvalFromGate`) para el evento vivo y `pending_controls`, con guard `kind === "approval"` / `choices` no vacío, y aviso visible si un control no vacío no se puede mapear.

**Medición que cerró el debate de MEDIUM-2:** con el run parkeado, `GET /v1/runs/{id}` devuelve `pending_controls[0]` con la forma exacta del evento `approval.request` (`kind`, `prompt_id`, `execution_generation`, `command`, `description`, `choices`); el POST espera `request_id` (el proxy renombra `requestId`), y mandar `prompt_id` da 400. El mapper primario ya coincidía con la realidad.

Gates de la ronda 2: `tsc` limpio; frontend **873/873**; backend **522 + 2 ignored**; e2e stub **12/12**; e2e live contra el gateway real **3/3**.

## Veredicto final

`JUDGMENT: ESCALATED ⚠️`

Presupuesto del método agotado (2 rondas de corrección, 2 re-juicios). El juicio final volvió a marcar ESCALATED por un HIGH que **el propio juicio destapó después de la ronda 2**: un SSE que termina limpio sin evento terminal dejaba el chat girando para siempre, con el escape deshabilitado. Ese HIGH se corrigió **después del veredicto** (T20), junto con dos MEDIUM y dos LOW, y quedó cubierto por tests y por la e2e live; el veredicto no se re-escribe porque no hay ronda de jueces disponible para certificarlo.

### Cerrado a lo largo de las rondas

| Hallazgo | Estado |
|---|---|
| JD-B-001 (doble run con stream muerto) | cerrado en ronda 1 + guard de generación en ronda 2 |
| JD-B-002 (tarjeta perdida al refrescar) | cerrado; shape de `pending_controls` medido contra el gateway real |
| JD-B-006 / JD-A-003 (404 ajeno sin test) | cerrado con RED/GREEN demostrado |
| JD-A-001 / JD-B-011b (CRLF) | cerrado |
| HIGH-1 (callejón sin salida tras reintentos) | cerrado en ronda 2 (ronda 2a: estado recuperable; ronda 2b: generación de suscripción) |
| HIGH del juicio final (EOF limpio sin terminal) | cerrado en T20, verificado por tests y e2e |
| MEDIUM del juicio final (`retry()` muerto en run reanudado) | cerrado en T20 |
| MEDIUM del juicio final (aviso de gate no-mapeable) | cerrado en T20 |

### Abierto al entregar (documentado, no corregido)

| Hallazgo | Sev | Por qué queda |
|---|---|---|
| **JD-B-005** — el transcript se guarda en `pd-hermes-messages`, sin namespace por usuario, y el logout no lo borra | MEDIUM | Privacidad en navegador compartido; el arreglo pide decidir el namespace (por usuario o limpieza en login/logout) |
| **JD-B-003** — un turno en cola se persiste como enviado tras un refresh y nunca se manda | MEDIUM | Su exposición subió con la cola visible durante `streamLost` |
| **JD-B-004** — un gate sin `command` quedaba invisible | MEDIUM | Mitigado por el mapper compartido y el aviso; el caso no está medido |
| **JD-B-007** — `codeForStatus` mapea por HTTP: un 502 `HERMES_UNAUTHORIZED` se muestra como "no se pudo conectar" | LOW | Copy operativo, no comportamiento |
| **JD-B-008** — `run.completed` con `output` vacío/parcial descarta el borrador | LOW | Requiere decidir el fallback de `partial`/`interrupted` |
| **JD-B-009** — `createHermesRun` sin timeout ni abort | LOW | Mejorado (estado `starting` visible), falta el budget |
| **JD-B-010** — `warningsOf` y el canal de `warnings` quedaron muertos | LOW | Deuda de limpieza |
| **JD-B-011a** — sin test a nivel router de que `/events` no se comprime | LOW | Requiere un test con el router ensamblado |
| **JD-B-012** — imágenes con `keep_limit = usize::MAX` (heredado) | INFO | Pre-existente, no es regresión de este cambio |
| **JD-A-002 / LOW-4** — el puntero guarda y no compara `sessionId` | LOW | Integridad de estado del cliente, sin bypass (el proxy verifica pertenencia) |
| i18n | LOW | Dos strings nuevos en español fijo (`STREAM_LOST`, aviso de gate) |

### Lo que el método sí certifica

Ningún **CRITICAL** en ninguna ronda: sin bypass de autorización, sin filtración de la credencial (el navegador nunca ve la key, los 4 endpoints exigen sesión y la pertenencia del run se verifica antes de abrir el upstream, con test que falla si se quita), sin corrupción de datos del servidor. La feature funciona completa contra el gateway real: **873→881 unit frontend**, **522 + 2 ignored backend**, **12/12 e2e stub**, **3/3 e2e live** (run real con cronómetro y re-enganche tras refresh, `rm -rf` parkeado y denegado desde la tarjeta, y cola real).
