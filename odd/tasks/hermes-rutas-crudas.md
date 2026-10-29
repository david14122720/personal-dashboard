# Hermes: rutas crudas `/opt/data` en streaming, file server y transformer

Feature autorizada 2026-10-29. Continúa `hermes-rutas-descargas` y `hermes-markdown-media-uploads`:
el pipeline de tarjetas ya existía; esta entrega cierra la diferencia entre ese pipeline y el spec
del dueño (reemplazo en prosa a mitad de frase), y lo prueba con los fixtures del spec.

## Specs

**S1** Reglas de entorno, verbatim: «Mantén la conexión exclusiva a la base de datos de PRODUCCIÓN.
Queda estrictamente prohibido crear o migrar bases de datos locales.» y «Queda estrictamente
PROHIBIDO ejecutar `git commit` o `git push`.»

**S2** Causa raíz, verbatim: «En streaming SSE, Hermes emite rutas crudas de sistema (ej.
`/opt/data/cache/scratch/prueba_hermes.png`) en lugar de Base64 inline.» y «La interfaz del cliente
no transformaba las rutas absolutas de Linux (`/opt/data/...`) cuando no venían precedidas
explícitamente por la cadena `MEDIA:`.»

**S3** Backend, verbatim: «Implementa el endpoint `GET /api/hermes/media?path=<RUTA_EN_DISCO>`.
Debe poder leer los volúmenes o directorios compartidos del contenedor de Hermes
(`/opt/data/cache/scratch`, `/opt/data/cache/documents`, `/opt/data/entregables`,
`/opt/data/uploads`, `/tmp`).» Con «Protección Anti Path-Traversal: Sanitiza y normaliza el
parámetro `path` para evitar accesos fuera de los directorios autorizados (rechazar `..`).»,
«Utiliza detección de tipo MIME (`mime_guess`) para enviar el `Content-Type` adecuado
(`image/png`, `application/pdf`,
`application/vnd.openxmlformats-officedocument.wordprocessingml.document`, etc.)» y «Inyecta
`Accept-Ranges: bytes` para la reproducción fluida de medios y
`Content-Disposition: attachment; filename="..."` para forzar la descarga de documentos.»

**S4** Frontend, verbatim: «Aplica un interceptor/regex **sobre el texto acumulado completo del
mensaje** (no sobre deltas fragmentados) antes de renderizar el Markdown.» Patrón pedido:
`/(?:MEDIA:)?(\/opt\/data\/[^\s)]+?\.(png|jpe?g|gif|webp|svg|docx?|pdf|xlsx?|pptx?|zip|mp4|mp3|webm))/gi`.
Reemplazos pedidos: imágenes → «Reemplaza la ruta por un tag de imagen HTML o Markdown»;
documentos y binarios → «Sustituye la ruta por el componente `<FileDownloadCard>` que incluye el
nombre del archivo, su icono y un botón directo»; audio/video → «reproductores nativos `<video
controls src="...">` o `<audio controls src="...">`».

**S5** Subida, verbatim: «Al adjuntar documentos (`.docx`, `.pdf`, etc.) desde el chat, el frontend
los sube primero a este endpoint en Rust, el cual guarda el archivo en `/opt/data/uploads/` y
retorna la URL local.» y «El mensaje inserta la referencia: `[archivo adjunto:
http://<IP_LAN>:<PUERTO>/api/hermes/media?path=/opt/data/uploads/archivo.docx]` para que Hermes lo
descargue y analice mediante sus herramientas.»

**S6** Criterios de aceptación, verbatim: «1. La ruta `/opt/data/cache/scratch/prueba_hermes.png` de
la prueba se renderiza como una imagen visible e incrustada en la conversación. 2. La ruta
`/opt/data/cache/scratch/prueba_hermes.docx` de la prueba se transforma en una tarjeta con botón
funcional para descargar el archivo `.docx`. 3. El endpoint `/api/hermes/media?path=...` en Rust
sirve los archivos en disco de forma segura y sin vulnerabilidades de path-traversal. 4. Las pruebas
de streaming y renderizado Markdown funcionan sin romper la estructura de las burbujas de chat.
5. El proceso de verificación ("Judgment Day") concluye con éxito garantizando la paridad funcional
completa.»

**S7** Reglas del segundo spec, verbatim: «Backend en **Rust** (Axum/Actix-web), Frontend **Next.js/React** en Dokploy.» y «Usa la skill `playwright-cli` para verificar la previsualización de imágenes incrustadas y la descarga directa de archivos Word/PDF.»

**S8** Infraestructura, verbatim: «Mapea el volumen bind-montado del Host Dokploy `/opt/data` hacia el contenedor del backend en Rust: `MONTAJE: /opt/data (Host) -> /opt/data (Contenedor Backend)`» y «Asegura que el backend en Rust tenga permisos de lectura sobre `/opt/data/cache/scratch`, `/opt/data/cache/documents` y `/opt/data/uploads`.»

**S9** Endpoint `/files`, verbatim: «Crea la ruta `GET /files/*path` (o proxy equivalente en Next.js hacia el backend en Rust) para entregar archivos físicos desde `/opt/data/`.» Con «RESTRICCIÓN DE SEGURIDAD: Normaliza la ruta y aplica validación estricta anti *path-traversal* (rechazar peticiones con `..` o fuera de `/opt/data`)» y «Si la ruta solicitada no existe en el disco real, debe responder con un **HTTP 404 Not Found real** en lugar del HTML de la SPA.»

**S10** Headers y streaming, verbatim: «Utiliza `mime_guess` para enviar el MIME Type real», «Inyecta `Content-Disposition: attachment; filename="..."` para forzar la descarga de documentos» y «Sirve los archivos en streaming asíncrono desde el disco (soporte para archivos de hasta 100 MB).»

**S11** Transformer en vivo y sanitización, verbatim: «Aplica las transformaciones Regex sobre el **texto acumulado completo del mensaje** (re-evaluando en cada delta del stream SSE)» con los tres casos: base64 inline («Reemplaza `!\[[^\]]*\]\((data:image\/[a-z+]+;base64,[A-Za-z0-9+\/=]+)\)` por un `<img>` nativo»), rutas de imagen («Detecta extensiones `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` en `/opt/data/...` y sustitúyelas por `<img src="/files/$1">`») y documentos («conviértelas en una tarjeta interactiva con `<a href="/files/$1" download>` y botón de descarga»), más «Escapa todo código HTML previo a la inyección de etiquetas `<img>` o `<a>` para prevenir vulnerabilidades XSS.»

**S12** Aceptación con los fixtures reales, verbatim: «1. `GET /files/opt/data/cache/scratch/prueba_hermes.png` devuelve la imagen real de 6,113 bytes (SHA-256: `92dcbb36cbb1b26b70222c27feaba9049c0ba273f9ce9bd270f0f5f9c1912787`). 2. `GET /files/opt/data/cache/scratch/prueba_hermes.docx` descarga el archivo de 38,103 bytes (SHA-256: `9a08ec112c0bddef6479b4612d9d1a709fc2d05492b8e0c341796f61183afff5`) de forma limpia. 3. Al pedir a Hermes "genera una imagen de prueba" en el chat web, la imagen se renderiza e incrusta de forma fluida durante el streaming. 4. Al pedir "genera un Word de prueba", aparece la tarjeta interactiva y permite la descarga del documento `.docx`. 5. El proceso de verificación ("Judgment Day") concluye con éxito garantizando la entrega de medios sin regresiones.»

## Tasks

- [x] T1 Reemplazo de la ruta en cualquier posición de la prosa (no solo línea completa), con test en rojo primero. — inline — commit: none. **Evidencia:** `stripPathsFromLine` en `frontend/lib/hermes/artifacts.ts`; RED 8 fallos con el código anterior, GREEN 43/43 en artifacts+ArtifactCard+HermesMarkdown.
- [x] T6 `GET /files/*path` en Rust: allowlist + canonicalización, 404 real (nunca el HTML de la SPA), streaming con Range, MIME real y attachment para documentos. — inline — commit: none. **Evidencia:** `files_handler` + `FILES_ROUTE` en `backend/src/routes/hermes_media.rs`, registrado en el router externo de `main.rs`; RED E0425 → GREEN 5/5 (`files_route_*`), 549 en el bin.
- [x] T7 Transformer con `/files/<ruta>`: imagen incrustada y tarjeta con `<a download>`, re-evaluado sobre el texto acumulado en cada delta. — inline — commit: none. **Evidencia:** `pathArtifacts()` + `liveCollected` (`useMemo`) en `HermesChat.tsx`; la tarjeta existe con `data-streaming="true"` antes de `run.completed`.
- [x] T8 Sanitización: el HTML del modelo se muestra escapado como texto en vez de desaparecer (sin `dangerouslySetInnerHTML`, `rehype-sanitize` intacto); imagen `/files` incrustada. — inline — commit: none. **Evidencia:** plugin `htmlAsText` en `HermesMarkdown.tsx`, `isFilesUrl` + preview en `ArtifactCard.tsx`; RED 8 fallos → GREEN 43/43.
- [x] T9 e2e + Playwright visual: imagen incrustada y `.docx` descargable, con captura de pantalla. — inline — commit: none. **Evidencia:** `frontend/e2e/hermes-files.spec.ts` **2/2** contra el stack real (export estático + backend en `:3100` + DB de producción + usuario descartable borrado después). Capturas revisadas: `test-results/files-image-embedded.png` (PNG 160×96 incrustado, ruta cruda ausente de la prosa) y `files-word-card.png` (insignia DOCX, Ver/Descargar archivo, descarga con nombre real).
- [ ] T10 Fixtures reales: tamaño y SHA-256 de los dos archivos cuando exista el bind mount; equivalentes sintéticos mientras tanto. — inline — commit: none. **Estado:** bloqueada. Los fixtures del spec viven en el host de Dokploy; aquí `/opt/data` no existe. El contrato de bytes se probó con fixtures sintéticos (69 B y 38 613 B) por HTTP real.
- [ ] T11 Bind mount Dokploy `/opt/data` → backend y permisos de lectura de los tres subdirectorios. — inline — commit: none. **Estado:** bloqueada, acción del dueño (ver "Acción del dueño").
- [x] T12 Desviaciones declaradas (D-A1..D-A4). — inline — commit: none.
- [x] T13 Judgment Day sobre el diff completo y ledger con veredicto. — inline — commit: none. **Evidencia:** `odd/judgment-ledger-hermes-rutas-crudas.md` — dos jueces ciegos, 13 filas, 11 corregidas con RED medido, 1 mitigada (guarda de Host) y 1 residual declarada (hardlink), más cobertura conocida. Gates al cierre: backend 550 passed / 0 failed, frontend 135/135 en los archivos del cambio, e2e 5/5 en navegador real.

## Medición previa (2026-10-29, sobre `b2fbef6`)

Lo que el spec pide y ya estaba implementado, con evidencia:

- **S2/S4 (transformer sobre texto acumulado):** `frontend/lib/hermes/paths.ts` escanea
  `(?:MEDIA:)?` + `/opt/data|/tmp` con la lista de extensiones y `gi`, con lookbehind para no
  capturar rutas embebidas en URLs ni en árboles más profundos (`/var/tmp/...`).
  `HermesChat.pushAssistant` lo aplica al `output` completo del run, firma lo pendiente con
  `signHermesMedia` y construye las tarjetas con `collectArtifacts`.
- **S3 (endpoint):** `backend/src/routes/hermes_media.rs:902` `media_handler` — roots en
  `DEFAULT_ROOTS:57` (los cinco del spec + `documentos_generados`), canonicalización + allowlist
  (rechaza `..`, symlink y `..%2f`), `Accept-Ranges: bytes` (967, 1006), `ETag`,
  `Content-Disposition` attachment para documentos / inline para medios reproducibles (1006-1011),
  y rangos parciales 206.
- **S4 (render):** `frontend/components/hermes/ArtifactCard.tsx` — imagen incrustada con
  `no-referrer` (81), `<audio controls>` (98), `<video controls>` (103), insignia de familia y
  botón de descarga que fuerza attachment.
- **S5 (subida):** `POST /api/hermes/upload` guarda en `HERMES_UPLOAD_DIR` y devuelve la URL; el
  turno lleva `[archivo adjunto: <url>]`.
- Tests existentes en verde: `paths.test.ts`, `artifacts.test.ts`, `ArtifactCard.test.tsx` (34).

Brechas reales: (a) `stripDeliveredPaths` solo borraba la ruta cuando ocupaba la línea entera, así
que a mitad de frase el texto crudo quedaba al lado de la tarjeta (T1); (b) no había e2e con los
fixtures exactos del spec ni captura visual (T2, T3).

## Log

**L1** Pedido del dueño, verbatim (2026-10-29): «bien amigo vamos con otro cambio amigo : # ODD
Spec: Solución Definitiva de Rutas Crudas (/opt/data), File Server en Rust y Transformer Frontend
[…] 1. La ruta `/opt/data/cache/scratch/prueba_hermes.png` de la prueba se renderiza como una imagen
visible e incrustada en la conversación. 2. La ruta `/opt/data/cache/scratch/prueba_hermes.docx` de
la prueba se transforma en una tarjeta con botón funcional para descargar el archivo `.docx`. […]
5. El proceso de verificación ("Judgment Day") concluye con éxito garantizando la paridad funcional
completa.» Texto completo en S1-S6.

**L2** Decisión del dueño sobre el contrato de URL (2026-10-29): se **mantiene la URL firmada**
(`?path=…&exp=…&sig=…`) en lugar del `?path=` crudo del spec. Motivo: `<img>`/`<video>`/`<audio>`
no pueden enviar el bearer de sesión, y sin firma cualquier cliente de la LAN que conozca la ruta
lee los archivos de los roots permitidos. Desviación declarada en D-A1; los criterios S6.1, S6.2 y
S6.4 se cumplen igual.

**L3** Decisión del dueño sobre la prosa (2026-10-29): la ruta se **reemplaza en cualquier
posición**, no solo cuando ocupa la línea completa (T1).

**L4** Segundo spec recibido (2026-10-29), verbatim en S7-S12: añade `GET /files/*path` con 404 real
(no el HTML de la SPA), streaming, `mime_guess`, bind mount de Dokploy y aceptación por tamaño y
SHA-256 de los dos fixtures.

**L5** Superación de L2 para las rutas escaneadas (2026-10-29): el segundo spec pide literalmente
`<img src="/files/$1">` y `<a href="/files/$1" download>`, así que las rutas que el chat detecta
pasan a usar `/files/<ruta>` (estable, sobrevive a un reload y es pegable en un navegador o `curl`).
La ruta firmada `/api/hermes/media?path=…&exp=…&sig=…` se conserva intacta para las URLs que ya
emite el proxy. Ambas comparten allowlist, canonicalización, rangos y disposición.

## Desviaciones declaradas

**D-A1** El visor del dashboard sigue consumiendo URLs firmadas donde el proxy ya las emite; el spec
pedía `?path=` crudo. Decisión del dueño en L2: no se degrada la lectura de archivos de los roots.

**D-A2** `/files/*path` es intencionalmente **sin firma** (spec S9): es una dirección estable que un
humano pega en el navegador y que el propio agente puede descargar. La defensa es el allowlist de
roots más la canonicalización, no un secreto: quien conozca la ruta dentro de
`/opt/data/cache/scratch`, `cache/documents`, `entregables`, `uploads`, `documentos_generados` o
`/tmp` la puede leer desde la LAN. `/opt/data` como raíz queda excluido, así que `.env`,
`auth.json` y `config.yaml` no son alcanzables por ninguna de las dos rutas. Mitigaciones: sin
listado de directorios, `X-Content-Type-Options: nosniff`, descarga forzada para documentos y SVG,
y `..` rechazado antes de tocar disco.

**D-A3** Se mantiene `mime_for` (tabla propia, probada para las extensiones del spec) en lugar de la
crate `mime_guess`: mismo resultado sin sumar una dependencia de entrega. Un cambio de crate es una
línea si el dueño lo prefiere.

**D-A4** La raíz `/opt/data` completa no se sirve nunca (spec S9 dice «fuera de `/opt/data`», pero
servir esa raíz expondría credenciales del agente). Roots explícitos en `DEFAULT_ROOTS`.

## Acción del dueño (infraestructura, S8)

El backend necesita el bind mount del host de Dokploy en el contenedor de Rust:

```
Host:      /opt/data
Contenedor: /opt/data      (solo lectura)
```

Sin eso, `/files/opt/data/cache/scratch/prueba_hermes.png` responde 404 y los criterios S12.1 y
S12.2 (tamaño y SHA-256 de los dos fixtures) no se pueden verificar: en la máquina de desarrollo
`/opt/data` no existe. Verificación una vez aplicado el mount:

```
curl -sS -o /tmp/prueba.png -w '%{http_code} %{content_type} %{size_download}\n' \
  http://<host>:<puerto>/files/opt/data/cache/scratch/prueba_hermes.png
sha256sum /tmp/prueba.png   # 92dcbb36…2787
curl -sS -D- -o /tmp/prueba.docx http://<host>:<puerto>/files/opt/data/cache/scratch/prueba_hermes.docx
sha256sum /tmp/prueba.docx  # 9a08ec11…fff5  (Content-Disposition: attachment)
```

**L6** T1/T6/T7/T8 cerradas (2026-10-29). Backend: `/files` con RED por compilación (E0425) y GREEN 5/5. Frontend: el worker implementó el interceptor sobre `/files` con 101 tests; el padre cerró los dos huecos que el worker no podía tocar y **midió el rojo de verdad** revirtiendo temporalmente los tres archivos (`git stash push -- …` → 8 fallos → `git stash pop` → 43/43). Sin commit ni push, según S1.

**L7** e2e de aceptación (2026-10-29): `hermes-files.spec.ts` stubea el transporte de Runs pero **no** `/files`, que lo sirve el backend real. Primero falló por no navegar a `/dashboard/hermes/` y por usar la etiqueta de imagen en un documento (`Descargar archivo`); corregido, **2/2** en 8,2 s. La primera captura con un PNG de 1×1 no probaba nada a la vista: se reemplazó por un PNG de 160×96 generado sin dependencias (38 613 B) y la captura muestra la imagen incrustada. Limpieza: 4 usuarios `e2e-files*` borrados (`DELETE 4`, quedan 0), contenedor y `/tmp` eliminados.

**L8** Límite honesto (2026-10-29): los criterios S12.1/S12.2 (6113 B / SHA-256 `92dcbb36…` y 38 103 B / `9a08ec11…`) **no** se verificaron contra los archivos reales, porque no existe `/opt/data` en esta máquina ni forma de crear archivos con esos hashes. Lo que sí quedó probado es el contrato completo de bytes: 200, `Content-Type` correcto, `Content-Length`, `Accept-Ranges`, 206 con `Content-Range`, `Content-Disposition: attachment` y 404 real. Queda como acción del dueño.

**L9** Judgment Day ronda 1-2 (2026-10-29). Juez A: un BLOCKER real (mi cambio en `downloadUrl` dejó roja una expectativa de `HermesChat.test.tsx`: `1 failed / 118 passed`) y tres LOW de cobertura, todos corregidos. Juez B: dos MEDIUM de seguridad — root simbólico que se canonicalizaba a su destino (corregido: `canonical_roots` rechaza roots symlink; el hardlink queda declarado como residual porque el agente ya tiene escritura en esos directorios), y `/files` sin guarda de `Host` (mitigado con `HERMES_PUBLIC_BASE_URL`) —, el defecto que corrompía la referencia `?path=` de los adjuntos (corregido con límites de token completos), la tarjeta para rutas inexistentes (corregido con sonda `HEAD` al asentar) y el spec viejo de artefactos (retargeteado a `/files` y ejecutado).

**L10** Cierre (2026-10-29): gates en verde — `tsc` exit 0, backend **550 passed / 0 failed / 2 ignored**, frontend **135/135** en los cinco archivos del cambio y **953/953** en la suite completa, e2e **5/5**. Sin commit ni push. Sigue bloqueado lo único que no se puede probar desde acá: los hashes de los fixtures reales (T10/T11).
