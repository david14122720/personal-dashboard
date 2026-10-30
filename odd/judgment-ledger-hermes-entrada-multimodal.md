# Judgment Day — Entrada multimodal y salida simplificada

Alcance: el árbol de trabajo sin commitear sobre `85c96d6`, que implementa
`odd/tasks/hermes-entrada-multimodal.md` (S1–S13, desviaciones D-B1–D-B6).
Dos jueces ciegos, sin conocimiento del otro ni de esta mesa.

## Gates medidos antes del juicio

| Gate | Resultado |
|---|---|
| `cargo test --locked` (binario) | 524 passed / 0 failed / 2 ignored |
| `cargo test --locked` (8 binarios de integración) | 43 passed / 0 failed |
| `vitest run` suite completa | 892 passed / 0 failed, 70 archivos |
| `tsc --noEmit` | exit 0 |
| Playwright en navegador real | 10/10 (`hermes-composer`, `hermes-markdown`) |
| Capturas revisadas por el padre | composer con dos chips y Enviar activo sin texto; burbuja con imagen decodificada (`naturalWidth > 0`) y tarjeta de PDF |

## Filas del juez A — veredicto APPROVED

| ID | Sev | Ubicación | Hallazgo | Resolución |
|---|---|---|---|---|
| JD-A-001 | MEDIUM | `hermes_uploads.rs:922` | Los adjuntos no tienen ciclo de vida: los que nunca llegan a un run quedan huérfanos, y cada reintento suma otro. | **Declarado.** Sin tabla de referencias el servidor no puede saber qué está vivo; un TTL automático borraría archivos que el agente todavía puede leer, y eso es destructivo. Se documenta la limpieza manual en la acción del dueño. |
| JD-A-002 | LOW | `hermes_uploads.rs:699` | `GET /api/uploads/{id}` sirve cualquier adjunto a cualquier sesión autenticada, no solo al que lo subió. | **Declarado.** Despliegue de un solo dueño e ids UUIDv4. Arreglarlo pide tabla `uploads(user_id, path)`; fuera de esta spec. Corregí el comentario del handler, que afirmaba propiedad. |
| JD-A-003 | LOW | `HermesChat.tsx:1208` | Una subida rechazada no aborta a sus hermanas; una subida colgada deja el chip en "subiendo". | **Corregido.** Un `AbortController` por lote aborta el resto al primer rechazo, y el plazo se escala con el tamaño (ver B-009). Test: `signal.aborted === true` en la hermana. |
| JD-A-004 | LOW | `hermes_uploads.rs:463` | La rama de autenticación de producción no la ejecuta ningún test (los tests usan el stub de bearer). | **Declarado.** Deuda heredada de `routes::hermes`; un test contra Postgres real excede esta spec. |

## Filas del juez B — veredicto CHANGES_REQUESTED

| ID | Sev | Ubicación | Hallazgo | Resolución |
|---|---|---|---|---|
| JD-B-001 | HIGH | `HermesChat.tsx:1435` | Los chips de un turno fallido sobreviven en el compositor y el mensaje siguiente los vuelve a subir y a referenciar. | **Corregido.** Verificado: `submit()` tomaba `attachmentsRef.current` y los chips solo se limpiaban en `run.completed`. Ahora todo turno fallido (evento terminal, rechazo de subida y fallo de creación) limpia sus chips; el `Retry` usa `retryFiles` del globo de error. Tests: "no arrastra los archivos del turno fallido" y el de rechazo, reescritos. |
| JD-B-002 | HIGH | `hermes_uploads.rs:49` | `local_path` es `/opt/data/uploads` del contenedor del dashboard; Dokploy no tiene ese montaje, así que el agente no podría leer lo que se le referencia. | **Verificado y declarado.** `application_one` devuelve `mounts: []`. Sin volumen compartido, S4 no puede cumplirse en producción por más que el código sea correcto. Se documenta como **D-B7** con el montaje exacto y un comando de verificación; no se declara cumplido. |
| JD-B-003 | MEDIUM | `hermes_uploads.rs:705` | `GET` autentica pero no autoriza por dueño; el comentario decía "el adjunto propio". | **Declarado**, igual que JD-A-002, con el comentario corregido para no afirmar propiedad. |
| JD-B-004 | MEDIUM | `attachments.ts:64` | Una nota de voz (`audio/webm`) se clasificaba como video: burbuja de video y referencia `video/webm`. | **Corregido.** Para contenedores ambiguos (`webm`, `mp4`, `ogg`) decide el MIME declarado; la nota de voz queda audio con su tope de 20 MB. Test con `audio/webm`, `audio/mp4` y sus equivalentes de video. |
| JD-B-005 | MEDIUM | `HermesChat.tsx:132` | Cada imagen, video o audio enviado se relee completo desde `/api/uploads` aunque el blob local esté vivo; un video de 100 MB se descarga dos veces y se bufferiza. | **Corregido.** La burbuja no pide nada mientras exista `previewUrl`; la URL guardada se usa al remontar (recarga). El test del turno recién enviado ahora exige cero lecturas. |
| JD-B-006 | MEDIUM | `attachments.ts:101` | Una imagen con MIME ausente o ajeno no se inlinea: el proxy decide por el MIME de la parte y degrada la imagen a descriptor de texto. | **Corregido.** Las imágenes inline se reetiquetan con el `mime_type` que devolvió el servidor (olfateado), no con el del navegador. Test con un `.png` sin `type`. |
| JD-B-007 | LOW | `hermes-composer.spec.ts:179` | El único spec contra el contrato real se salta sin `E2E_HERMES_LIVE=1`, y la evidencia unitaria usa un stub. | **Aceptado y registrado.** El e2e se corrió de verdad contra el backend Rust y quedó en el Log con el comando; el skip por defecto se conserva para no exigir stack en cada corrida. |
| JD-B-008 | LOW | `hermes_uploads.rs:721` | Sin GC y con `read_dir` por cada `GET`: huérfanos permanentes y lectura O(n). | **Declarado**, mismo criterio que JD-A-001. |
| JD-B-009 | LOW | `HermesChat.tsx:1215` | El plazo fijo de 120 s falla un video de 100 MB en enlaces lentos (~6.7 Mbit/s). | **Corregido.** El plazo sigue al archivo mayor con presupuesto de 4 s/MB y piso de 120 s: 100 MB → 400 s. |

## Veredicto de la mesa

Ambos jueces revisaron el mismo árbol y ninguno encontró un CRITICAL. Total: **13 filas** (4 de A, 9 de B).
**6 corregidas con test** (A-003, B-001, B-004, B-005, B-006, B-009), **6 declaradas** con su razón
(A-001, A-002, A-004, B-003, B-008 y B-002) y **1 registrada como evidencia** (B-007). Las dos HIGH se
resolvieron de forma distinta a propósito: B-001 era un defecto de código y se arregló; B-002 es un
montaje que falta en Dokploy, y fingir que el código lo resuelve habría sido la peor salida.


## Filas del juez B

_(se completan al recibir el veredicto)_
