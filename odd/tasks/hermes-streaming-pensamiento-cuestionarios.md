# Hermes: streaming, cronómetro, accordion de pensamiento y cuestionarios interactivos

Branch: `main` (sin commits, S9). Runner: `cargo test` (backend) + `pnpm test` / `tsc` / Playwright (frontend). Delivery: single-pr.

## Specs

- **S1 — Timeout extendido.** `HERMES_TIMEOUT=600000` en `.env` y como valor por defecto (600.000 ms = 10 minutos). Backend: cliente `reqwest` con ese presupuesto; el stream no debe cortarse mientras Hermes ejecuta herramientas pesadas. Frontend: sin aborts automáticos por defecto, `AbortController` alineado con los 10 minutos.
- **S2 — Estado + cronómetro.** Mientras se espera: widget animado activo y contador `MM:SS` ("Hermes está trabajando... ⏱️ 02:15"). Arranca en `00:00` al enviar, actualiza segundo a segundo y se detiene cuando la respuesta empieza a renderizarse.
- **S3 — Límite alcanzado.** Al llegar al máximo ("10 min") aparece un banner amistoso con exactamente las opciones **"Seguir esperando"** o **"Reintentar"**.
- **S4 — Captura de razonamiento.** Capturar `<thinking>`, `reasoning_content` y eventos de herramienta (`event: hermes.tool.progress`).
- **S5 — `<ThoughtAccordion>`.** Encabezado colapsable discreto: `Pensamiento ▸` o `Llamando a [herramienta] ▸`. Por defecto colapsado/oculto; al abrir muestra el análisis interno o los parámetros de las herramientas.
- **S6 — `<InteractiveQuestionCard>`.** Cuando Hermes consulta opciones: no renderizar la lista numerada plana; mostrar tarjeta estilo Claude con paginación `< 1 de 2 >`, opciones como botones con título y descripción, opción **"Otra cosa"** con campo libre, botón **"Omitir"** y botón de envío **`↑`**. Al elegir una opción la respuesta se envía sola.
- **S7 — Layout/scroll.** Sin scrollbars internos en burbujas; `overflow-y: auto` sólo en el contenedor padre de la lista; auto-scroll suave tras cada actualización.
- **S8 — Criterios de aceptación (verbatim).**
  1. El chat permite a Hermes trabajar durante varios minutos en tareas pesadas sin lanzar errores de tiempo agotado.
  2. La interfaz muestra claramente el estado "Hermes está trabajando... ⏱️ MM:SS" contando los segundos en vivo.
  3. El pensamiento de Hermes se muestra agrupado y oculto por defecto bajo un botón desplegable.
  4. Las preguntas con alternativas se presentan en una tarjeta interactiva estilo Claude.
  5. Las burbujas de chat no contienen doble scrollbar y la pantalla se desplaza de forma fluida.
  6. El proceso de verificación ("Judgment Day") concluye con éxito validando la reactividad y estabilidad del sistema.

### Desvíos y decisiones (declarados)

- **Streaming obligatorio (S4/S5).** Medido contra el gateway real 0.22.5: `stream: true` devuelve SSE OpenAI (`data: {choices:[{delta:{reasoning_content|content}}]}`) más `event: hermes.tool.progress` con `{tool,emoji,label,toolCallId,status}` y termina en `data: [DONE]`. Sin streaming el pensamiento sólo podría mostrarse al final, así que el proxy re-emite SSE propio al navegador y el JSON queda como transporte por defecto (compatibilidad y tests).
- **Contrato SSE del proxy:** `start` (con `timeoutMs`), `thinking` ({text}), `tool` (objeto del gateway), `delta` ({text}), `done` (envelope `{reply,artifacts,warnings}` ya enriquecido) y `error` ({code,message}). Un error HTTP previo al stream sigue devolviendo JSON con su status.
- **Timeout como silencio, no como reloj total (S1/S3).** El cliente sin stream conserva `.timeout(HERMES_TIMEOUT)`; el cliente de stream usa `read_timeout(HERMES_TIMEOUT)` (sin deadline total), de modo que "Seguir esperando" es honesto: mientras el gateway siga emitiendo, la conexión vive.
- **Extracción de `<thinking>` en el servidor**, con buffer para tags partidos entre deltas; el cliente sólo pinta eventos.
- **Detección de cuestionarios conservadora** (frontend): bloque final de 2–8 líneas `N. opción`, precedido por una pregunta (`?`/`¿`), con instrucción de respuesta opcional ("Respondé con…"); se recorta del texto y se convierte en tarjeta. Si no cumple todo, se deja el texto intacto.
- **"Omitir" envía la palabra `Omitir`** como turno del usuario (deja el hilo cerrado y trazable); la tarjeta queda marcada como respondida.
- `HERMES_TIMEOUT` mantiene un piso de 60 s (antes 180 s) para no aceptar valores absurdos; el default pasa a 600000.

## Tasks

- [x] T1 backend/config: default 600000, piso 60 s, `.env`, tests. — inline
- [x] T2 backend/proxy: SSE (`Accept: text/event-stream`), retry degradado, extracción de thinking, `done` enriquecido, tests con upstream fake SSE. — inline
- [x] T3 frontend/api: `sendHermesTurnStream` con parser SSE y `AbortController` de 10 min. — inline
- [x] T4 frontend/estado: cronómetro `MM:SS`, widget y banner "Seguir esperando"/"Reintentar". — inline
- [x] T5 frontend/pensamiento: `ThoughtAccordion` + cableado de eventos. — inline
- [x] T6 frontend/cuestionarios: parser + `InteractiveQuestionCard` (paginación, "Otra cosa", "Omitir", `↑`). — inline
- [x] T7 frontend/chat: streaming en `HermesChat`, scroll único, envío automático de respuestas. — inline
- [x] T8 i18n + tests de componentes/página. — inline
- [x] T9 e2e + arnés visual (cronómetro real, accordion, tarjeta) + Judgment Day. — inline

## Log

**L1** (verbatim) "bien amigo vamos a iniciar un nuevo cambio : # ODD Spec: Cuestionarios Interactivos, Accordion de Pensamiento, Timeout Extendido y Cronómetro Visual en Hermes …" (spec completo en S1–S8).

**L2** Sondas contra el gateway real (2026-10-28): `reasoning_content` presente en la respuesta no-stream; `stream:true` emite `delta.reasoning_content`, `event: hermes.tool.progress` (con `label` = comando real) y `data: [DONE]`; la pregunta con opciones llega como lista numerada plana (1..3) cerrada con "Respondé con el número".

**L3** Implementación (2026-10-28):
- Backend: `HERMES_DEFAULT_TIMEOUT_MS = 600_000` con piso de 60 s; `HermesConfig` gana `timeout_ms` y un cliente `stream_http` con `read_timeout` (sin deadline total). `hermes.rs` acepta `Accept: text/event-stream`, reintenta degradado ante 400 también en modo stream (el 400 real viene como `{"error":{"code":"unsupported_content_type"}}`), re-emite `start/thinking/tool/delta/done/error`, extrae `<thinking>` con un splitter tolerante a tags partidos y enriquece artefactos antes del `done`. Compresión excluye `text/event-stream`. Tests: 524 + 3 ignorados; el ignorado real contra el gateway pasó en 8 s con thinking, tool y done.
- Frontend: `sendHermesTurnStream` (parser SSE, `AbortController` del llamador, sin timeout propio), `formatElapsed` MM:SS, `splitQuestion` conservador (bloque final 2–8 numerado + pregunta + instrucción o verbo de elección), `ThoughtAccordion` colapsado con "Llamando a [herramienta]", `InteractiveQuestionCard` (3 por página con `‹ 1 de 2 ›`, "Otra cosa" + `↑`, "Omitir", bloqueo al responder). `HermesChat` transmite en vivo, detiene el reloj al primer delta, banner "Seguir esperando"/"Reintentar" al alcanzar `timeoutMs`, y responde la tarjeta como un turno normal.
- Evidencia: frontend 807 pasar (62→67 archivos, `habitos` flaky sólo bajo el suite completo), `tsc` limpio; e2e `hermes-streaming` 3/3 y `hermes-artifacts` 2/2 (actualizado a SSE); arnés Playwright externo 22/22 con capturas (reloj 00:02 real, accordion cerrado/abierto, tarjeta, móvil 390×844).

**L4** Decisiones de UI verificadas visualmente: el encabezado de pensamiento flota sin burbuja mientras no hay contenido; la tarjeta muestra paginación sólo si hay más de una página; "Respondido: …" reemplaza las opciones y bloquea el resto.

**L5** (verbatim, corrección del dueño) "perdona te interrumpi sin querere continua y ten o aumenta estos cambior por favor : # ODD Spec: Conversión Automática de Rutas del Servidor (/opt/data/...) a Descargas Directas, Cuestionarios Claude UI y Timeout Extendido (Hermes) …" (spec completo en S9–S15).

### Specs ampliadas

- **S9 — Interceptor universal de rutas.** El renderizador escanea el texto por rutas absolutas (`/opt/data/...`, `/tmp/...`) y `MEDIA:...`; si la ruta apunta a un archivo con extensión servible se convierte en `<FileDownloadCard>`/reproductor, nunca en texto muerto.
- **S10 — Tarjeta de archivo.** Icono por formato, nombre real, tamaño y botón **"Descargar archivo"**.
- **S11 — Endpoint de firma.** El proxy firma rutas que no pre-detectó: `POST /api/hermes/media/sign` (autenticado) devuelve `{items:[{path,name,mime,size,url}]}`; rutas inexistentes o fuera de las raíces se descartan.
- **S12 — Raíces.** `HERMES_MEDIA_ROOTS` suma `/tmp` por defecto (junto a `/opt/data`), siempre con canonicalización + HMAC.
- **S13 — Descarga directa.** `/api/hermes/media` responde `Content-Disposition: attachment; filename="..."`, `Content-Type` correcto y `Accept-Ranges: bytes` (ya cumple S9–S13 salvo la firma y `/tmp`).
- **S14 — Cuestionarios/accordion/timeout/reloj/scroll.** Sin cambios respecto de S1–S8; la paginación `< 1 de 2 >`, "Otra cosa", "Omitir" y `↑` siguen siendo obligatorios.
- **S15 — Criterios de aceptación 1–6 del dueño**: rutas → tarjeta; descarga inmediata sin Telegram; pensamiento colapsado; tarjetas interactivas; reloj vivo y 10 minutos sin cancelar; Judgment Day exitoso.

**L6** Implementación de S9–S13 + correcciones del Judgment Day ronda 1 (ver L7):
- `scanMediaPaths` (frontend) detecta `/opt/data`, `/tmp` y `MEDIA:` con extensiones servibles; `signHermesMedia` pide URLs al proxy; `HermesChat` fusiona las firmadas con las del envelope antes de recortar el texto y dibujar tarjetas. Si la firma falla, la respuesta se muestra igual.
- `hermes_media.rs`: `DEFAULT_ROOTS = ["/opt/data", "/tmp"]`, `MediaLink`, `link_for` (resolve + is_file + mime + size + URL firmada) y `sign_handler` autenticado (máx. 32 rutas, dedupe, 401 sin sesión).
- i18n: `Descargar archivo`.

**L7** Correcciones de la ronda 1 de Judgment Day (juez A; el juez B no llegó a correr por interrupción):
- CRÍTICO (cancelación): cada emisión SSE pasa por un macro que retorna si el receptor se cerró; al abortar el navegador se dropea el `upstream` y Hermes deja de ejecutar herramientas. Test con upstream contador: el stream se detiene al soltar el body.
- HIGH (falsos negativos de cuestionario): se quitó la exigencia de verbo de elección; una pregunta + bloque numerado final basta. Trade-off documentado: una guía de pasos precedida por una pregunta también se convierte en tarjeta ("Omitir" es la salida).
- MEDIUM: `upsertTool` fusiona frames (conserva label/emoji al completar); `retryLive` conserva los ids de adjuntos; `HermesMarkdown` memoizado y deltas agrupados cada 60 ms.
- LOW: frames CRLF aceptados; un turno sólo-pensamiento ya no se rechaza (`reasoning` en el `done`); `next-env.d.ts` y un PNG de evidencia ajeno revertidos.

**L8** Ronda 2 (re-juzgado acotado). El juez A devolvió una captura vacía (sin JSON) y el juez B trajo 3 defectos causados por los fixes, todos corregidos y con test:
- `stripDeliveredPaths` reducía la valla a su primer carácter: un bloque de 4 backticks con líneas de 3 se cerraba antes y dejaba duplicada la ruta; el código indentado con 4 espacios tampoco se reconocía. Ahora la valla guarda carácter + longitud (cierra sólo con ≥ esa longitud) y las líneas con 4 espacios/tab se preservan.
- `has_media_extension` desincronizaba la lista con el escáner (m4v, tsv, yaml, yml, tgz, bz2): el proxy las descartaba en silencio y no había tarjeta. Lista sincronizada + test del gate.
- El timeout de 5 s en `signHermesMedia` se liberaba al recibir cabeceras, no al consumir el cuerpo: un cuerpo colgado seguía bloqueando el turno. El temporizador ahora cubre también `res.json()`.
- Evidencia final: backend **530 tests + 3 ignorados**; frontend **820/820 en corrida limpia** (68 archivos; `habitos` sigue siendo flaky intermitente y pasa solo 36/36); `tsc` limpio; e2e `hermes-streaming` + `hermes-artifacts` **5/5**; arnés Playwright externo **23/23** (reloj vivo, accordion cerrado/abierto, tarjeta `/tmp` firmada con "Ver/Descargar", cuestionario, móvil, cero scroll anidado, cero errores de consola).
- **Veredicto terminal: JUDGMENT: ESCALATED ⚠️.** El presupuesto de rondas está agotado (2 correcciones + 2 re-juzgados): los tres hallazgos de la ronda 2 quedaron corregidos y verificados por suites, pero no por una tercera ronda de jueces, y la captura del juez A en la ronda 2 llegó vacía. No se certifica APPROVED.
