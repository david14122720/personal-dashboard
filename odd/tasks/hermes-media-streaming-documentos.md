# Hermes: media streaming, tarjetas de documento y audio

Objetivo: que Hermes pueda entregar video/audio/imágenes/documentos de cualquier peso
desde `/opt/data` y que el chat los reproduzca o descargue, sin límites de tamaño en el
envío. Rama `main` (sin commit ni push: S9). Runner: `cargo test` + `pnpm test` + Playwright.

## Specs

- **S1 (audio)** — «P purge/elimina cualquier validación o mensaje de error que diga
  `"este servidor de Hermes no procesa audio todavía"`. Asegura que los archivos de audio
  grabados (`.webm`, `.wav`, `.mp3`) o adjuntados por el usuario se envíen a la API de
  Hermes como archivos adjuntos/multimodal en el payload de la petición, exactamente igual
  a como opera la integración de Telegram.»
  *Bloqueo verificado (L2):* el gateway 0.22.5 responde 400 a `input_audio`
  (`Unsupported content part type 'input_audio'. Only text and image_url/input_image parts
  are supported.`) y a `file` (`uploaded files and document inputs are not supported on
  this endpoint`); no existe `/v1/audio/transcriptions` (404). Decisión pendiente del dueño (L2).

- **S2 (límites)** — «Elimina cualquier restricción de peso (como límites de 5 MB) en el
  frontend y en el proxy backend.» Sin tope de bytes por adjunto ni total; sin
  `DefaultBodyLimit` en `/api/hermes`. El costo real es disco (spool temporal) y, solo
  para imágenes, RAM (el upstream exige base64 inline).

- **S3 (endpoint)** — «Crea un endpoint en Rust (`GET /api/hermes/media?path=<RUTA_EN_DISCO>`)
  encargado de servir archivos almacenados en el disco del servidor. Debe incluir soporte
  para **Range Requests** (`Accept-Ranges: bytes`) y cabeceras `Content-Type` correctas
  (`video/mp4`, `image/png`, `audio/mpeg`, etc.) para permitir la reproducción fluida de
  videos de cualquier peso (incluso >40 MB) sin saturar la memoria RAM.»
  *Desvío de seguridad (L3):* `path` arbitrario es LFI. El endpoint exige raíces
  permitidas (`HERMES_MEDIA_ROOTS`, default `/opt/data`) y un **token firmado** de vida
  corta que emite el proxy al normalizar la respuesta; `<video src>` no puede mandar el
  `Authorization: Bearer`.

- **S4 (descarga forzada)** — «`Content-Disposition: attachment; filename="ensayo-celula.docx"`,
  `Content-Type` correspondiente según el MIME Type … Si el archivo existe en el disco del
  servidor, debe servirse en modo streaming de forma inmediata sin corromper el binario.»

- **S5 (parser)** — «Configura el renderizador de Markdown/Mensajes para interceptar
  cadenas con el formato `MEDIA:/ruta/al/archivo` o rutas absolutas (`/opt/data/...`,
  `/tmp/...`) que terminen en extensiones de documento: `.docx`, `.doc`, `.xlsx`, `.xls`,
  `.pptx`, `.ppt`, `.pdf`, `.txt`, `.zip`, `.tar.gz`, `.csv`, `.json`.» También video
  (`.mp4`, `.webm`), audio (`.mp3`, `.wav`, `.ogg`) e imagen (`.png`, `.jpg`, `.webp`).

- **S6 (tarjeta)** — «Reemplaza la cadena de texto plano `MEDIA:...` por una tarjeta UI
  estilizada» con icono por tipo (Word/Excel/PowerPoint/PDF/genérico), nombre, badge de
  extensión/peso y botón «Descargar documento»/«Guardar».

- **S7 (formato real del gateway, medido)** — las imágenes vuelven inline
  (`![image](data:image/png;base64,...)`); los videos con `MEDIA:/opt/data/x.mp4`; los
  documentos **no** llevan prefijo: ruta plana `/opt/data/x.pdf` (L2).

- **S8 (verificación)** — «El proceso de verificación ("Judgment Day") concluye con éxito
  garantizando que la reproducción de medios y el proxy en Rust funcionan de manera fluida
  y estable.» Playwright obligatorio para tarjetas de `.docx/.xlsx/.pptx/.pdf/.zip`.

- **S9 (entorno)** — DB de producción, prohibido crear/migrar DB local, prohibido
  `git commit`/`git push`.

## Tasks

| ID | Specs | Ruta | Estado |
|----|-------|------|--------|
| T1 | S3, S4 | inline: endpoint `/api/hermes/media` (allowlist + firma + Range + streaming) y tests | ⬜ |
| T2 | S2 | inline: quitar caps de peso en backend y frontend (spool/descarte por chunks) | ⬜ |
| T3 | S7, S5 | inline: el proxy detecta `MEDIA:` y rutas bajo las raíces, firma y devuelve `artifacts` con `path`/`size`/`mime` | ⬜ |
| T4 | S5, S6 | inline: parser del frontend, tarjetas con icono por tipo y botón de descarga `download=1` | ⬜ |
| T5 | S8 | Playwright con stub + Judgment Day | ⬜ |
| T6 | S1 | audio: bloqueado por el gateway; requiere decisión del dueño | ⛔ |

## Log

**L1** Pedido del dueño (2026-10-27), textual: «P purge/elimina cualquier validación o
mensaje de error que diga "este servidor de Hermes no procesa audio todavía" … Queda
estrictamente PROHIBIDO ejecutar git commit o git push … Usa la skill playwright-cli …
Ejecuta obligatoriamente tu proceso de verificación interno ("Judgment Day" / verify) al
finalizar.» Segundo mensaje: «Configura el renderizador de Markdown/Mensajes para
interceptar cadenas con el formato MEDIA:/ruta/al/archivo o rutas absolutas (/opt/data/...,
/tmp/...) … Reemplaza la cadena de texto plano MEDIA:... por una tarjeta UI estilizada …
Asegura que al solicitar la descarga … responda con Content-Disposition: attachment;
filename="ensayo-celula.docx" …».

**L2** Sondas reales contra `hermes-agent 0.22.5` (2026-10-27):
- `input_audio` → `400 {"message":"Unsupported content part type 'input_audio'. Only text and image_url/input_image parts are supported.","code":"unsupported_content_type"}`.
- parte `file` con `data:audio/wav;base64,…` → `400 "Inline image inputs are supported, but uploaded files and document inputs are not supported on this endpoint."`.
- `/v1/audio/transcriptions` → 404; `/v1/files`, `/files`, `/media` → 404.
- Imagen pedida: el gateway devuelve `![image](data:image/png;base64,…)`, no `MEDIA:`.
- Video: `MEDIA:/opt/data/probe-video.mp4`. Documento: `/opt/data/probe-doc.pdf` sin prefijo.
- El agente dice tener `ffmpeg` pero **ningún** ASR (ofrece instalar `faster-whisper`).
- `/health` → `{"platform":"hermes-agent","version":"0.22.5"}`; `HERMES_HOME=/opt/data` (bind mount del contenedor de Hermes).
Conclusión: el audio no se puede enviar por este endpoint. Enviarlo igual convierte cada
nota de voz en un 400 y pierde el turno.

**L3** Seguridad: `/api/hermes/media?path=` sin restricción es lectura arbitraria del disco
(`.env`, claves, DB). Se implementa allowlist de raíces + URL firmada (HMAC-SHA256,
`exp`) emitida por el proxy, porque `<video>`/`<audio>`/`<img>` no pueden llevar el header
de sesión. Desvío declarado respecto de la letra de S3 (que no pedía autenticación).

**L4** Prerrequisito de despliegue: la app `personal-dashboard` **no tiene mounts**
(`mounts: []` en Dokploy) y Hermes guarda en su propio `/opt/data`; sin montar ese
directorio en el contenedor del backend el endpoint no tiene qué servir. Acción del dueño
en Dokploy (volume host→`/opt/data:ro`).

**L5** Judgment Day ronda 1 (2 jueces ciegos, target `ca27847…`). Ledger y correcciones:
- **C1 SVG inline → XSS** (ambos, determinístico): `streamable()` excluye `image/svg+xml`; el endpoint lo sirve `attachment`. Test `svg_is_never_inline`.
- **C2 secreto HMAC público con Hermes sin configurar** (ambos): `/dev/urandom`, 32 bytes por arranque. Test `an_unconfigured_secret_is_random_not_a_public_constant`.
- **C3 `tidy()` corrompía toda respuesta** (ambos): se eliminó el colapso de espacios/saltos; ahora se borran las rutas ya cardadas por coincidencia exacta y solo se colapsan líneas vacías fuera de bloques ```.
- **C4 texto/audio bufferizados enteros** (ambos): `read_field(keep_limit)` (16 KB texto, 25 MB audio, 0 binarios); `truncated` degrada el audio y marca el texto. Test `a_huge_text_file_is_truncated_not_buffered`.
- **C5 sin spec Playwright** (ambos): `frontend/e2e/hermes-artifacts.spec.ts` (2/2 con `E2E_HERMES_LIVE=1`).
- WARNING confirmados por ambos: rutas con espacios y links Markdown (scanner + variantes por prefijo), descriptor «0 bytes» (`attachment.size`), TTL 900 s → 7 días (máx. 30), preview de imágenes firmadas, `data:image` clasificada como imagen.
- Un solo juez: `download=1` devolvía `filename="1"` (corregido); `CompressionLayer` gzipaba video (predicado `NotForContentType` para video/audio, corregido); forma real del 400 de audio (`/code` además de `/error/code`, corregido y probado; el gateway sigue sin aceptar audio).

**L6** Re-juzgado ronda 2 (juez A): los fixes introdujeron 2 defectos, corregidos en la ronda final de corrección:
- **F1 (CRÍTICO, introducido por C3)**: el borrado por coincidencia exacta también eliminaba la ruta dentro de bloques ``` (un ejemplo `cp /opt/data/x .` quedaba `cp .`). Ahora `stripDeliveredPaths` parte la respuesta por vallas y solo limpia prosa; el código queda byte a byte.
- **F2 (WARNING, introducido por JD6)**: `[etiqueta](ruta)` dejaba un enlace muerto `[etiqueta]()`. Ahora se elimina el link completo cuando su ruta ya está cardada.
Tests `leaves a delivered path inside a fenced code block untouched` y `removes the whole markdown link when its path is carded`.

**L7** Corrección final (post-ronda 2) y estado de la verificación:
- El re-juzgado de la ronda 2 (juez A) mostró que el split por vallas seguía fallando con ``` inline `~~~`, vallas de 4 backticks, código indentado y links con título/ángulo/imagen. Se reemplazó por una regla más simple y robusta: **solo** se reescriben (a) un link/imagen de Markdown cuyo destino contenga una ruta entregada, y (b) una línea completa que sea exactamente la ruta (con o sin `MEDIA:`). Cualquier mención de la ruta dentro de código queda intacta, sin necesidad de parsear vallas. Tests: `never touches the path inside any code shape` (4 formas) y `drops titled, angle-bracket and image links whose destination is delivered`.
- Presupuesto de Judgment Day agotado (2 rondas de corrección + 2 re-juzgados): el último fix quedó verificado por los suites y pruebas dirigidas, **no** por una nueva ronda de jueces. Veredicto terminal: **ESCALATED** (no APPROVED).
- Evidencia final: backend **518 passed / 2 ignored**; frontend **781 passed** (62 archivos; `app/dashboard/habitos/page.test.tsx` es flaky bajo paralelismo y pasa solo: 36/36); `tsc` limpio; `e2e/hermes-artifacts.spec.ts` **2/2**; arnés visual externo **20/20** (documentos con badges DOCX/XLSX/PPTX/PDF/ZIP, descarga con nombre real, video MP4 con metadata y reproducción, audio, scroll único, auto-scroll, compositor sticky, móvil 390×844).
