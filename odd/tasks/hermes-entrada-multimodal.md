# Hermes: entrada multimodal y salida simplificada

Reemplaza el renderizado de archivos de salida por Markdown limpio y mueve la
entrega de binarios de Hermes a Telegram. La entrada del chat gana textarea
autoexpandible, arrastre, pegado y tarjetas con estado de subida. Git habilitado
en esta spec, con el mensaje exacto de §6.

## Specs

### S1 — Entorno, control de versiones y validación

> - **Metodología:** Organic-Driven Development (ODD).
> - **Stack Técnico:** Backend en **Rust** (Axum/Actix-web) y Frontend **React/JS** de Control Deck.
> - **Base de Datos:** Mantén la conexión exclusiva a la base de datos de PRODUCCIÓN.
> - **Control de Versiones (HABILITADO EN ESTA SPEC):** Al completar y verificar todos los criterios de aceptación, ejecuta obligatoriamente los comandos de Git para persistir los cambios:
>   `git add . && git commit -m "feat(hermes): entrada multimodal completa, simplificacion de salida y limpieza de proxy de archivos" && git push origin main`
> - **Validación Visual:** Usa la skill `playwright-cli` para verificar la caja de entrada multilínea, el arrastre de archivos, la captura del portapapeles y el envío de adjuntos.
> - **Validación de Integridad:** Ejecuta obligatoriamente tu proceso de verificación interno ("Judgment Day" / verify) al finalizar.

### S2 — Limpieza de salida

> - **Eliminación de Código Lógico Antiguo:**
>   - Elimina del frontend y backend la lógica compleja de parsing de respuestas para rutas `/opt/data/...`, prefijos `MEDIA:` o conversión de streaming a Base64.
>   - Elimina los endpoints o proxies de lectura/descarga de archivos de salida que se intentaron construir (`/api/hermes/media` o `/files/*`).
> - **Comportamiento Simplificado de Respuestas:**
>   - Hermes responderá en el chat web **únicamente en texto y Markdown limpio sanitizado** (**negritas**, listas, código, etc.).
>   - Si Hermes genera entregables pesados (Word, PDF, Video, ZIP), los enviará directamente por su canal de **Telegram** (sin intentar servirlos por el chat web).

### S3 — Entrada multimodal

> - **Caja de Texto Expandible:**
>   - Campo `<textarea>` multilínea de crecimiento automático. `Enter` envía el mensaje y `Shift + Enter` inserta un salto de línea.
> - **Soporte de Captura Múltiple de Adjuntos:**
>   - **Botonera de Clip (📎):** Selector de archivos del sistema operativo.
>   - **Drag & Drop (Arrastrar y Soltar):** Zona interactiva sobre la caja de entrada para soltar múltiples archivos simultáneamente.
>   - **Pegado desde Portapapeles (`Ctrl + V` / `Cmd + V`):** Intercepta eventos `onPaste` para adjuntar capturas de pantalla tomadas con el portapapeles.
> - **Gestión Visual de Adjuntos Previos al Envío:**
>   - Muestra tarjetas/miniaturas con: vista previa (imágenes), icono por tipo (documento/video/audio), nombre del archivo, peso en KB/MB, barra de estado de subida y botón de eliminación (`✕`).
>   - **Permitir Mensaje Vacío con Adjuntos:** Si el usuario no escribe texto pero adjunta archivos, el botón "Enviar" se mantiene activo.
> - **Tipos de Archivo Permitidos y Validación:**
>   - **Imágenes:** `png`, `jpg`, `jpeg`, `webp`, `gif` (Límite: ≤ 5 MB).
>   - **Video:** `mp4`, `webm`, `mov` (Límite: ≤ 100 MB).
>   - **Audio:** `mp3`, `wav`, `m4a`, `ogg` (Límite: ≤ 20 MB).
>   - **Documentos/Otros:** `pdf`, `docx`, `xlsx`, `pptx`, `txt`, `md`, `csv`, `zip` (Límite: ≤ 50 MB).

### S4 — Backend `/api/uploads` y payload multimodal

> - **Endpoint de Subida (`POST /api/uploads`):**
>   - Procesa peticiones `multipart/form-data` para recibir los archivos del usuario.
>   - **Validación Estricta:** Verifica tanto la extensión como el MIME Type real del archivo en el servidor. Rechaza binarios ejecutables o sospechosos (`.exe`, `.sh`, MIME alterado) devuelviendo un código HTTP 400 claro.
>   - Sanitiza el nombre original, asigna un UUID único y guarda el archivo en el volumen persistente de uploads del servidor (`/opt/data/uploads/<uuid>.<ext>`).
>   - Devuelve un JSON con `{ id, name, mime_type, size, url, local_path }`.
> - **Construcción del Payload para Hermes (`POST /v1/chat/completions`):**
>   - **Para Imágenes (≤ 5 MB):** Inserta en el array `content` del mensaje `user` el objeto con formato OpenAI:
>     `{"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}`
>   - **Para Documentos, Audios, Videos y ZIPs:** Sube el archivo primero a `/opt/data/uploads/` y añade al texto del prompt del usuario la referencia estructurada:
>     `[archivo adjunto: nombre.ext (tipo_mime, tamaño), ruta: /opt/data/uploads/<uuid>.<ext>]`
>     para que Hermes acceda al archivo directamente mediante sus herramientas locales.

### S5 — Burbujas del usuario

> - En el historial del chat, los mensajes enviados por el usuario muestran sus adjuntos de forma limpia:
>   - Imágenes con `<img src="..." />`.
>   - Videos con `<video controls src="..."></video>`.
>   - Audios con `<audio controls src="..."></audio>`.
>   - Documentos como tarjetas estilizadas con nombre, peso e icono descriptivo.

### S6 — Cierre y push

> Al verificar que todos los tests funcionan, ejecuta:
> ```bash
> git add .
> git commit -m "feat(hermes): entrada multimodal completa, simplificacion de salida y limpieza de proxy de archivos"
> git push origin main
> ```

### S7–S13 — Criterios de aceptación

> - Se limpia toda la lógica antigua de renderizado de archivos de salida en el chat web; las respuestas de Hermes se despliegan en Markdown limpio.
> - La caja de entrada permite enviar texto multilínea (Shift+Enter), adjuntar mediante clip, arrastrar y soltar archivos, y pegar capturas directamente con Ctrl+V.
> - Es posible adjuntar múltiples archivos simultáneamente y eliminarlos individualmente con el botón ✕ antes de enviar.
> - Las imágenes (≤ 5 MB) se envían a Hermes codificadas en Base64 en el payload de la API.
> - Los documentos, audios y videos se suben a /opt/data/uploads/ vía Rust y se referencian en el texto del prompt para que Hermes los lea con sus herramientas.
> - Archivos ejecutables o con MIME alterado son rechazados por el backend en Rust con mensaje de error explicativo.
> - Los cambios quedan validados, confirmados e impulsados a la rama principal mediante git commit y git push origin main.

## Desviaciones declaradas

- **D-B1 — Una petición por archivo.** S4 nombra un objeto (`{ id, name, … }`), no
  un arreglo. `POST /api/uploads` acepta `multipart/form-data` con un archivo por
  petición y responde exactamente ese objeto; el cliente sube en paralelo. Un
  sobre con `items[]` habría inventado un contrato que la spec no pide.
- **D-B2 — `url` sirve el adjunto propio.** `GET /api/uploads/{id}` (autenticado)
  existe solo para que el historial repinte imágenes, video y audio tras
  recargar. Es **entrada** del usuario, no salida de Hermes: S2 prohíbe servir
  entregables, no los archivos que el usuario adjuntó. La ruta valida el UUID,
  resuelve dentro de `/opt/data/uploads` y exige sesión.
- **D-B3 — La imagen se persiste además de viajar inline.** S4 exige base64 en el
  payload; el historial (S5) exige un `src` estable. La misma imagen ≤ 5 MB viaja
  dos veces: inline al modelo y una vez a `/opt/data/uploads` para el `<img>`
  del historial. Sin eso, recargar la página dejaría la burbuja sin imagen.
- **D-B4 — Barra de estado, no porcentaje.** `fetch` no expone progreso de subida
  y `XMLHttpRequest` habría duplicado el cliente HTTP. Cada tarjeta muestra su
  estado real (`en cola`, `subiendo`, `listo`, `error`), no bytes transferidos.
- **D-B5 — Límites duplicados a propósito.** El cliente rechaza antes de gastar
  red; el servidor vuelve a validar extensión, MIME real y tamaño. El límite de
  cuerpo del endpoint sube a ~105 MB para admitir el video de 100 MB de S3.
- **D-B7 — El montaje `/opt/data` no existe todavía (bloqueante de S4 en producción).**
  `application_one` en Dokploy devuelve `mounts: []`: el backend escribe en
  `/opt/data/uploads` **de su propio contenedor** y Hermes no puede leer esa ruta.
  El código cumple el contrato (ruta, UUID, JSON) y los e2e lo prueban con el
  backend real, pero la promesa de S4 ("que Hermes acceda al archivo con sus
  herramientas locales") no está cumplida hasta que exista el volumen
  compartido. Acción del dueño: montar el host `/opt/data` en el contenedor del
  backend en `/opt/data` (lectura-escritura), y verificar con
  `docker exec <contenedor-backend> test -r /opt/data/uploads` más una subida
  real seguida de `docker exec <contenedor-hermes> cat <local_path>`.
- **D-B8 — Sin ciclo de vida de los adjuntos (JD-A-001 / JD-B-008).** No hay
  tabla de referencias ni GC: un adjunto que nunca llegó a un run queda en el
  volumen, y los reintentos agregan copias. Se decide **no** borrar
  automáticamente porque el agente puede estar leyendo esos archivos y el
  borrado es irreversible; queda la limpieza manual:
  `docker exec <backend> find /opt/data/uploads -maxdepth 1 -type f -name '????????-????-????-????-????????????.*' -mtime +30 -print`
  (primero en seco, `-delete` recién después de revisar). `GET` además resuelve
  con `read_dir`, aceptable para el volumen de un dueño.
- **D-B9 — El adjunto no está atado a su dueño (JD-A-002 / JD-B-003).**
  `GET /api/uploads/{id}` exige sesión pero no comprueba propiedad; con UUIDv4 y
  un despliegue de un solo dueño el riesgo es de defensa en profundidad.
  Arreglarlo pide tabla `uploads(user_id, path)`, fuera de esta spec. El
  comentario del handler se corrigió para no afirmar lo que no hace.

- **D-B6 — HTML crudo del modelo** se muestra como texto escapado (plugin
  `htmlAsText` ya existente) en vez de descartarse; sigue siendo "Markdown limpio
  sanitizado" y no se habilita `rehype-raw` ni HTML crudo.

## Tasks

- [x] T1 Documento ODD con la spec verbatim, desviaciones y medición. — inline — commit: none.
- [x] T2 Backend: `POST /api/uploads` con validación de extensión + MIME real, UUID, `/opt/data/uploads/<uuid>.<ext>`, JSON `{id,name,mime_type,size,url,local_path}` y `GET /api/uploads/{id}`; eliminar `media`, `sign` y `files` con sus tests. — worker — commit: §6.
- [x] T3 Frontend: eliminar el renderizado de salida (`paths`, `artifacts`, `inline-images`, `ArtifactCard`, `MEDIA:`, firmas) y sus tests/e2e; las respuestas quedan en Markdown sanitizado. — inline — commit: §6.
- [x] T4 Frontend: cliente `/api/uploads`, referencia `[archivo adjunto: nombre.ext (mime, tamaño), ruta: …]`, estados por archivo. — worker — commit: §6.
- [x] T5 Frontend: pegado `Ctrl+V`, textarea autoexpandible y arrastre múltiple sobre la caja. — worker — commit: §6.
- [x] T6 Frontend: burbujas del usuario con `<img>`, `<video>`, `<audio>` y tarjetas. — worker — commit: §6.
- [x] T7 e2e con Playwright y capturas revisadas (multilínea, arrastre, pegado, varios adjuntos, ✕, mensaje vacío con adjuntos). — inline — commit: §6.
- [x] T8 Judgment Day: dos jueces ciegos y ledger con veredicto. — subagentes — commit: §6.
- [x] T9 Commit y push con el mensaje exacto de S6. — inline — commit: §6.

## Log

**L1** (2026-10-29, dueño, verbatim): «bien amigo vamos para atras amigo limpia todo lo que quede por favor:» — y a continuación la especificación completa, citada textualmente en §Specs (S1–S13). Orden explícito: revertir el renderizado de salidas y construir la entrada multimodal descrita, con commit y push habilitados en esta misma spec.

**L2** Medición inicial (2026-10-29): la entrada ya tenía parte del trabajo de la entrega anterior — `AttachmentBar` con miniatura, icono, nombre, peso y ✕; clip con selector múltiple; `onDrop`/`onDragOver` sobre la sección; `Enter`/`Shift+Enter`; `canSend` con adjuntos y sin texto. Faltaban: pegado, crecimiento automático del textarea, estados de subida por archivo, límites por tipo (hoy solo hay tope de 25 MB por documento), `POST /api/uploads` con el contrato de S4 y la referencia con `nombre (mime, tamaño), ruta:`. Sobraba todo el renderizado de salida: `paths.ts`, `artifacts.ts`, `inline-images.ts`, `ArtifactCard.tsx`, `media`/`sign`/`files` en Rust y dos e2e.

**L3** S2 deroga expresamente partes de las specs anteriores: `hermes-rutas-crudas` S5–S12 (rutas `/opt/data` en la prosa, `/files/*path`) y la decisión L2 del dueño ("conservar las URLs firmadas para el visor") quedan sin efecto. `hermes-markdown-media-uploads` conserva su validez solo en la entrada (upload + payload multimodal), que esta spec redefine.

**L4** Backend (T2, 2026-10-29): `hermes_uploads.rs` nuevo con `POST /api/uploads` y `GET /api/uploads/{id}`; borrados `/api/hermes/media`, `/api/hermes/media/sign`, `/files/*path` y el antiguo `/api/hermes/upload`, junto con `hermes_media.rs` (2163 líneas) y sus tests. Evidencia: **524 passed / 0 failed / 2 ignored** en el binario y **43** pruebas de los 8 binarios de integración, todas en verde, sin warnings. El worker declaró una violación de orden test-first (escribió tests e implementación en la misma pasada) y la compensó con una sonda temporal que devolvía 501: **9 fallos** de los casos nuevos, luego retirada. Riesgo que reportó y que el frontend ya absorbió: `GET /api/uploads/{id}` exige sesión, así que `<img>`/`<video>` no pueden usarlo directo.

**L5** Frontend (T4–T6, 2026-10-29): subida por archivo a `/api/uploads`, texto del turno con la referencia de S4 solo para no-imágenes, multipart con únicamente las imágenes, estados por chip, `onPaste`, textarea autoexpandible, y burbujas con `img`/`video`/`audio`/tarjeta mediante blob autenticado con revocación. Evidencia: **131/131** en 6 archivos, `tsc --noEmit` exit 0. El worker encontró una rotura que introduje en la limpieza: `pushAssistant(...).finally()` sobre una función ya síncrona lanzaba `TypeError` en cada `run.completed` y mataba el drenaje de la cola; corregido y cubierto.

**L6** Deuda declarada: cuatro etiquetas de estado y los avisos de rechazo quedaron como literales en español dentro de los componentes porque `frontend/lib/i18n/es.ts` no estaba en las superficies del worker; y un 413 de subida muestra el mensaje en inglés del servidor, no una clave de traducción. No bloquea S3/S4, pero se anota para no perderlo.

**L7** e2e en navegador real (T7, 2026-10-29): export estático reconstruido con el código actual —el anterior era de antes de T6 y hacía pasar los specs contra un build viejo—, backend en `:3100` con la DB de producción y un usuario descartable (borrado al final). Resultado: **10/10** (`hermes-composer` 6, `hermes-markdown` 4), con capturas revisadas por el padre: miniatura real, pesos, `Enviar` activo sin texto, burbuja con la imagen decodificada (`naturalWidth > 0`, incluso tras recargar) y la tarjeta del PDF. El e2e probó lo que el unitario no puede: `onPaste` y `drop` reales, transiciones de estado bajo red real, y que el multipart lleva solo la imagen mientras el PDF viaja como referencia de texto.

**L8** Judgment Day (T8, 2026-10-29): dos jueces ciegos sobre el mismo árbol. A: **APPROVED** con 1 MEDIUM y 3 LOW. B: **CHANGES_REQUESTED** con 2 HIGH, 4 MEDIUM y 3 LOW. Ninguno encontró un CRITICAL. Las dos HIGH se resolvieron por vías distintas a propósito: **B-001** era un defecto real de código —los chips de un turno fallido se reenviaban con el mensaje siguiente— y se corrigió con tests; **B-002** se verificó contra Dokploy (`mounts: []`), no se puede arreglar en código y quedó como **D-B7** con acción del dueño, sin declarar S4 cumplido. Se corrigieron además B-004 (nota de voz como audio), B-005 (relectura innecesaria de medios), B-006 (imagen inline con el MIME del servidor) y B-009 (plazo proporcional al tamaño). Se declararon A-001/B-008 (sin GC), A-002/B-003 (sin dueño por adjunto) y A-004 (rama de auth de producción sin test); B-007 se registró como evidencia en L7. Detalle en `odd/judgment-ledger-hermes-entrada-multimodal.md`.

**L9** Cierre (2026-10-29): gates finales tras las correcciones del juez B — backend **524 + 43** (0 fallos), frontend **896/896** en 70 archivos, `tsc --noEmit` exit 0. Commit único con el mensaje exacto de S6: **`cd47a53`**, `85c96d6..cd47a53` en `main`, árbol limpio y local igual a `origin/main`. El commit incluye 31 archivos (3801 inserciones, 5224 eliminaciones): la limpieza pesa más que lo nuevo.

**L10** Lo que **no** está verificado y no se declara como verificado: (1) que el agente Hermes pueda abrir el `local_path` que se le pasa —Dokploy devuelve `mounts: []`, ver D-B7—; (2) `<video>` y `<audio>` en burbujas de un historial recargado: cubiertos por unitarios, no por e2e; (3) la rama de autenticación de producción de `/api/uploads` contra Postgres real (A-004); (4) la limpieza de huérfanos (D-B8) no existe: es manual.
