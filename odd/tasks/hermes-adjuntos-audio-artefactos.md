# Hermes: archivos múltiples, nota de voz, artefactos y proxy multipart

Backend Rust (Axum) + frontend Next.js static export · Sin commits ni push (orden del dueño) · DB de PRODUCCIÓN · Runner: `cargo test` (backend), `vitest` (frontend), Playwright para validación visual.

## Specs

- **S1** Proxy `POST /api/hermes` en Rust que "procese solicitudes tipo `multipart/form-data` y JSON", inyectando `Authorization: Bearer ${HERMES_API_KEY}` y propagando `X-Hermes-Session-Id` sin alteraciones. Config desde `.env` (`HERMES_API_URL`, `HERMES_API_KEY`, `HERMES_TIMEOUT`); `.env` en `.gitignore`; la clave nunca llega al navegador ni a logs.
- **S2** Cliente HTTP async con `HERMES_TIMEOUT` ≥ 180 s (ya vigente: piso 180000 ms); timeout → 504.
- **S3** Subida de archivos múltiples en el frontend: "Botón de adjuntar archivos y área de arrastrar/soltar (drag & drop)", varios archivos a la vez (imágenes, documentos, audios, ZIPs), chips de previsualización antes de enviar y borrado individual.
- **S4** Nota de voz con `MediaRecorder` (`getUserMedia`), indicador de grabación y tiempo, y al detener se adjunta el audio al mensaje listo para enviar.
- **S5** Renderizado seguro de Markdown (ya existe: react-markdown + rehype-sanitize, sin HTML crudo) y artefactos de Hermes: tarjeta/previsualizador en la burbuja y "botón claro de descarga directa".
- **S6** Gestión de sesión: `X-Hermes-Session-Id` en `localStorage` y botón "➕ Nueva conversación" que reinicia el UUID y limpia la vista (ya existe; ahora también limpia adjuntos).
- **S7** Validación visual desktop y móvil del chat, grabación, adjuntos y previsualizaciones con Playwright.
- **S8** Verificación final tipo Judgment Day / verify al cerrar.
- **S9** Sin `git commit` ni `git push`; sin crear ni migrar bases locales (solo la de producción).
- **S10** Criterios de aceptación del dueño, verbatim:
  1. "El backend en Rust procesa ágilmente peticiones de texto, notas de voz y múltiples archivos hacia Hermes sin exponer credenciales en el cliente."
  2. "El frontend permite grabar notas de voz desde el micrófono del navegador y enviarlas como adjunto."
  3. "Se pueden adjuntar y enviar múltiples archivos en un solo mensaje."
  4. "Los archivos entregados por Hermes muestran previsualización (cuando aplique) y botón de descarga directa en la conversación."
  5. "El proceso de verificación (\"Judgment Day\") concluye con éxito confirmando que el módulo funciona sin degradar la memoria ni el rendimiento del servidor."

## Contrato acordado (derivado de sonda real al upstream, 2026-10-27)

Upstream `http://192.168.50.120:8642` = `hermes-agent 0.22.5`, OpenAI-compatible (`/v1/models`, `/health`). Evidencia de sonda:

- `POST /v1/chat/completions` con `content: [{type:"text"}, {type:"image_url", image_url:{url:"data:image/png;base64,…"}}]` → **200**. Las imágenes inline sí se aceptan.
- `input_audio` → **400** `unsupported_content_type`: "Only text and image_url/input_image parts are supported."
- parte `file` (documento) → **400** `unsupported_content_type`: "uploaded files and document inputs are not supported on this endpoint."
- `multipart/form-data` directo al upstream → **400** `Invalid JSON in request body`.
- Adjuntar el contenido de un archivo de texto como parte `text` → **200**.

Por eso el backend **convierte** el multipart del navegador a JSON de partes para el upstream:

| Tipo de archivo | Parte enviada a Hermes | Qué ve el modelo |
|---|---|---|
| `image/*` (≤ 10 MiB) | `image_url` con `data:` URL | la imagen |
| texto (`text/*`, json, csv, md, xml, yaml, código) ≤ 16 KB por archivo | `text` con nombre + contenido cercado | el contenido (truncado con marca si excede) |
| `audio/*` | `input_audio` (`webm`/`wav`/`mp3`/`ogg`/`m4a`) | el audio, si el upstream lo soporta |
| resto (pdf, zip, binarios) | `text` descriptivo: nombre, MIME y tamaño | solo metadatos |

Degradación declarada: si el upstream responde `400 unsupported_content_type`, el proxy **reintenta una vez** reemplazando las partes no soportadas por una nota de texto honesta y devuelve `warnings` que la UI muestra como chip en la burbuja. Nunca se descarta un adjunto en silencio.

Respuesta normalizada del proxy:

```json
{ "reply": "…", "artifacts": [{"name":"…","url":"https://…","mime":"image/png","size":123}], "warnings": ["…"] }
```

El frontend acepta además el formato antiguo (`choices[0].message.content`) para no romper mocks ni clientes viejos.

Límites del servidor (no arbitrarios por tipo, sí de memoria): 20 adjuntos, 10 MiB por archivo, 40 MiB totales, cuerpo HTTP ≤ 42 MiB; excederlos devuelve 413/422 con mensaje claro.

## Tasks

| ID | Specs | Route | Estado |
|----|-------|-------|--------|
| T1 | S1, S2, contrato | inline (una sola unidad de comportamiento, contrato compartido) | ✅ 498 tests backend |
| T2 | S3, S4 | inline | ✅ adjuntos + voz |
| T3 | S5, S6 | inline | ✅ artefactos + sesión |
| T4 | S7 | inline | ✅ visual 28/28 |
| T5 | S8 | jueces ciegos (JD) | ✅ ronda 1 corregida + ronda 2 APPROVED |

## Log

**L1** (orden del dueño, verbatim): el spec "# ODD Spec: Módulo Hermes en Rust (Archivos Múltiples, Nota de Voz, Artefactos y Proxy)" completo — reglas estrictas de entorno (ODD, Rust + dashboard, DB de producción, prohibido commit/push, Playwright, Judgment Day), proxy multipart con Bearer y `X-Hermes-Session-Id` + timeout ≥ 180 s, frontend con adjuntos múltiples/drag&drop/chips, nota de voz con `MediaRecorder`, Markdown sanitizado, artefactos con previsualización y descarga, sesión en `localStorage` y "➕ Nueva conversación", y los 5 criterios de aceptación transcriptos en S10.

**L2** Exploración: el proxy actual (`backend/src/routes/hermes.rs`) solo acepta JSON `{messages:[{role:"user",content}]}`, valida un turno ≤ 32 KB y reenvía; timeout ya fuera del presupuesto de 15 s y con piso de 180 s (`config.rs`). `axum 0.8.9` sin `multipart`; `reqwest` sin multipart. El frontend ya tiene `HermesChat` (burbujas, markdown sanitizado, sesión UUID, nueva conversación) y `HermesMarkdown` con imágenes inline deshabilitadas por tracking. `.env` ya está en `.gitignore` y la clave no se expone. No existía `odd/tasks` para esta feature; sí la anterior `hermes-chat-integration.md` (S1-S10), cuyas decisiones se conservan.

**L3** Sonda al upstream real (sin imprimir la clave) — resultado en "Contrato acordado": multipart directo y `input_audio`/`file` son rechazados por `hermes-agent 0.22.5`; `image_url` y partes `text` funcionan. Esto fija la conversión del proxy y la degradación con `warnings`.

**L4** Decisión de ruta: T1-T3 son una sola unidad de comportamiento (el contrato HTTP condiciona los tests del frontend); no hay dos unidades independientes, así que el writer trigger no se cumple y se implementa inline. Sin commits (S9), así que la evidencia por task va en este log.

**L5** Backend (T1): `axum` gana el feature `multipart`; `/api/hermes` acepta `application/json` (mismo body `{messages:[...]}` de siempre) y `multipart/form-data` (`message` + `files[]`). Conversión: imagen → `image_url` data URL; texto → parte `text` (corte a 16 KB con marca `[truncado]`); audio → `input_audio`; binarios → nota descriptiva. Un `400 unsupported_content_type` dispara **un** reintento sin las partes no soportadas + `warnings`; cualquier otro error conserva 401/502/504. Respuesta normalizada `{reply, artifacts, warnings}` con artefactos saneados (solo http/https/data). Límites: 20 adjuntos, 10 MiB/archivo, 40 MiB totales, cuerpo ≤ 41 MiB (`DefaultBodyLimit` solo en esa ruta). Mensaje > 32 KB → 422 `VALIDATION_ERROR` (no 413). Tests: 12 nuevos incluyendo `parse_multipart` con cuerpos multipart reales (mensaje + 2 archivos, solo adjuntos, campos desconocidos, turno vacío, 21 archivos, archivo > 10 MiB a través del router con el body limit real, mensaje largo) y 2 ignorados contra el upstream real. Evidencia: `cargo test` **498 passed / 2 ignored**; `cargo clippy --bin` sin hallazgos en los archivos tocados (el único error del repo sigue siendo preexistente en `routes/accounts.rs:35`).

**L6** Frontend (T2-T3): `lib/hermes/attachments.ts` (clasificación, límites espejo, object URLs, `formatBytes`, nombre de nota de voz), `lib/hermes/artifacts.ts` (colección desde `artifacts` del proxy + enlaces Markdown, dedupe, allowlist de esquemas sin `data:text/html`), `lib/api/hermes.ts` (JSON sin archivos / multipart con archivos, envelope con fallback legacy, códigos `too_large`/`too_many_attachments`, respuesta solo-artefactos válida), `AttachmentBar` (miniatura solo para imágenes), `MicButton` (MediaRecorder real + guardas de arranque/montaje) y `ArtifactCard`. `HermesChat` suma drag&drop, input múltiple, chips borrables, nota de voz, burbujas con adjuntos, artefactos, avisos de degradación y limpieza de **solo** los adjuntos enviados. Privacidad de artefactos: **ningún URL remoto se auto-carga**; solo los `data:` embebidos previsualizan y todo lo demás expone "Ver" + "Descargar". El Markdown sigue con react-markdown + rehype-sanitize e imágenes inline deshabilitadas. Evidencia: `tsc --noEmit` limpio, `pnpm test` **62 archivos / 768 tests**.

**L7** Validación visual (T4, Chromium real + `--use-fake-device-for-media-stream`): **28/28 checks**, desktop 1440×900 y móvil 390×844. Se levantó `next dev` contra un stub de API (la orden prohíbe DB local y `.env` no trae `DATABASE_URL`), así que el seam navegador→Rust no se ejerció acá; sí los unit tests del parser y dos pruebas contra el upstream real (L8). Verificado en navegador: 2 archivos elegidos → 2 chips; drop suma el tercero; `MediaRecorder` real graba y adjunta `nota-de-voz-*.webm`; el POST sale multipart con 4 archivos + texto + audio; la respuesta renderiza Markdown, 2 tarjetas, "Ver"/"Descargar" y el aviso de audio; sin overflow ni errores de consola. Capturas: `/tmp/opencode/hermes-visual/{desktop,mobile}-{empty,chips,ready,conversation}.png`.

**L8** Medición real (S10.5) y verificación del contrato del upstream, con `HERMES_API_URL/KEY` del `.env` (sin imprimir la clave):
- Turno con imagen inline contra `hermes-agent 0.22.5`: **6,4 s**, pico **19,5 MB RSS** del binario de test, sin warnings.
- Turno con nota de voz: el upstream responde 400 `{"error":{"code":"unsupported_content_type"}}`, el proxy reintenta degradado → **20,5 s** totales y reply con warning `No se pudo enviar la nota de voz «nota.webm»…`. Eso confirma el shape real del error que dispara la degradación.
- Memoria acotada por diseño: buffers por request liberados al responder, sin estado global nuevo; techo duro 41 MiB de cuerpo y 40 MiB de adjuntos.

**L9** Hallazgo fuera de alcance (preexistente): en móvil 390 px la barra inferior del `AppShell` se solapa con la tarjeta de usuario flotante y "Dashboard" queda cortado; se reproduce igual en `/dashboard/productivity/` (`nav-productivity.png`). No se toca el shell acá.

**L10** Judgment Day ronda 1 (dos jueces ciegos, read-only, mismo alcance y criterios). Findings confirmados y corregidos:
- **Bloqueante (ambos jueces) — privacidad de artefactos**: `collectArtifacts` convertía imágenes Markdown (`![x](https://…)`) en tarjetas con `<img>` auto-cargado, revirtiendo la decisión de `HermesMarkdown` (`img: () => null`). Corregido: preview solo para `data:` embebidos; remoto → "Ver"/"Descargar". Test nuevo en `ArtifactCard.test.tsx` y allowlist sin `data:text/html`.
- **Bloqueante/major (ambos) — carrera del micrófono**: doble click antes de que resuelva `getUserMedia` dejaba un stream huérfano y un segundo recorder; desmontar durante el prompt dejaba el micrófono vivo. Corregido con guardas `startingRef`/`mountedRef` y parada del stream tardío. Dos tests nuevos.
- **Major (ambos) — multipart sin ejecución**: ningún test llamaba `parse_multipart`; el log anterior sobrestimaba la cobertura. Corregido con 8 tests de parser/cuerpo real y el test de tamaño a través del router con `DefaultBodyLimit`. Log reescrito con números reales.
- **Minors corregidos**: chip de audio mostraba `<img>` roto (miniatura solo imágenes); mensaje > 32 KB devolvía 413 con texto de adjuntos (ahora 422); "Nueva conversación"/éxito limpiaba todos los chips en vez de los enviados (ahora por id, con test); claves duplicadas de React en adjuntos/avisos; respuesta solo-artefactos ya no se rechaza; timer anunciado dos veces por lector de pantalla; `next-env.d.ts` (artefacto de `next dev`) revertido.
- **Aceptados como límites del entorno, documentados**: `download` cross-origin puede abrir pestaña en vez de descargar (sin proxy de artefactos no hay forma de forzarlo); el seam navegador→Rust se cubre con unit tests + upstream real, no con Playwright (sin DB local permitida).

**L11** Judgment Day ronda 2 (re-juzgado acotado al ledger congelado + delta de fixes, mismos dos jueces ciegos): veredicto **APPROVED** en ambos. Ledger: A1, A2, C1, C2, D1-D3, D5, D7, D8, E1, E3, E5 FIXED; 415 sin test y `download` cross-origin aceptados/declarados. Dos defectos **introducidos por los fixes**, ambos menores, corregidos:
- **N1** el `<span role="status">` sólo envolvía el reloj y el label "Grabando" quedaba fuera → ahora una sola región viva anuncia "Grabando m:ss" y el reloj visible queda `aria-hidden`; además se quitó `phase !== "idle"` del guard de arranque, que dejaba el botón muerto tras un permiso denegado.
- **N2** el gate de preview sólo-`data:` había removido también los players remotos de audio/video, que con `preload="none"` no auto-cargan: se restauraron (imágenes remotas siguen sin auto-carga). Test actualizado.

**L12** Evidencia final: backend **498 tests** (+2 ignorados reales), frontend **62 archivos / 768 tests**, `tsc` limpio, Playwright **28/28** re-ejecutado sobre el código final, clippy limpio en lo tocado, `next-env.d.ts` restaurado al baseline. Sin commit ni push (S9). Sin bases locales. Scratch de los jueces (`/tmp/judgeA-hermes-*`, `/tmp/opencode/judgeB.*`) eliminado.
