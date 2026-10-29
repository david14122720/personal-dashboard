# Judgment Day — `hermes-rutas-crudas`

Dos jueces ciegos, read-only, sobre el árbol de trabajo contra `HEAD` (`208bc62`). Cada fila se
congela con lo que el juez observó antes de cualquier arreglo; la columna de resolución se agrega
después, con la evidencia de la corrección.

Ámbito revisado: `backend/src/main.rs`, `backend/src/routes/hermes_media.rs`,
`frontend/components/hermes/{HermesChat,HermesMarkdown,ArtifactCard}.tsx` y sus tests,
`frontend/lib/hermes/{artifacts,paths}.ts` y sus tests, `frontend/e2e/hermes-files.spec.ts`.

## Juez A (`jd-judge-a`, task `mvu3vne1-9-odjm`) — `CHANGES_REQUESTED`

| ID | Severidad | Ubicación | Hallazgo congelado | Resolución |
|---|---|---|---|---|
| JD-A-001 | BLOCKER | `frontend/components/hermes/HermesChat.test.tsx:809` | La suite del propio entregable queda roja: la expectativa `["/files/tmp/render.png", "/files/tmp/render.png"]` no contempla el `?download=render.png` que agrega `downloadUrl`. `vitest run` termina `1 failed / 118 passed`. | **Corregido.** La expectativa ahora es `["/files/tmp/render.png", "/files/tmp/render.png?download=render.png"]`, con el motivo escrito al lado. Evidencia: 4 archivos, **111/111**. |
| JD-A-002 | LOW | `frontend/components/hermes/HermesChat.test.tsx:428` | Comentario NOTE obsoleto: afirma que `rehype-sanitize` descarta el HTML, cuando `htmlAsText` lo convierte en texto antes de rehype y el test hermano lo verifica en verde. | **Corregido.** NOTE eliminado; el test ahora afirma lo contrario y correcto: el tag se ve escapado (`toHaveTextContent('<img src=x onerror="alert(1)">')`) y no existe nodo `[onerror]`. |
| JD-A-003 | LOW | `backend/src/main.rs:323` | La propiedad «un archivo faltante responde 404 real, nunca el `index.html` de la SPA» solo se probaba sobre un router sin `ServeDir`, así que un cambio en `assemble` no la rompía. | **Corregido.** Nuevo test `files_route_answers_a_real_404_instead_of_the_spa_shell` monta el `assemble` real con `index.html`: 404, sin `text/html`, sin `spa-shell` en el cuerpo, y además el shell y los assets siguen sirviéndose (para no pasar rompiendo `ServeDir`). Verde en la suite completa. |
| JD-A-004 | LOW | `backend/src/routes/hermes_media.rs:1058` | `X-Content-Type-Options: nosniff` no lo afirmaba ningún test. | **Corregido.** Aserción agregada en `files_route_serves_bytes_with_the_real_mime`. |

Verificado limpio por el juez A, sin hallazgo: el pre-chequeo de `..`/`%2e%2e` antes de tocar disco;
`resolve` con canonicalización y allowlist por componentes (symlink incluido); 404 real para
directorios y ausentes; parser de rangos (200/206/416, sufijo, multi-rango); `disposition()` sanea
comillas, barras y caracteres de control; `serve_resolved` preserva el comportamiento de
`/api/hermes/media` (`download=1`, `download=<name>`, inline vs attachment); `htmlAsText` nunca crea
elemento ni atributo; `isFilesUrl` no acepta origen remoto; la ruta escaneada no puede inyectar
`%2e%2e`; `useMemo` en vivo y guarda de duplicados coherentes.

Evidencia de la ronda: frontend **111/111** en los cuatro archivos afectados; backend
**548 passed / 0 failed / 2 ignored** + 8 binarios de integración en verde.

## Juez B (`jd-judge-b`, task `mvu3vtzq-a-ch3h`) — `CHANGES_REQUESTED`

Nueve filas, la más alta MEDIUM. Las que describen un escenario reproducible se corrigen; las que
describen un modelo de amenaza que la decisión del dueño ya aceptó se documentan como riesgo
residual, con el motivo.

| ID | Severidad | Ubicación | Hallazgo congelado | Resolución |
|---|---|---|---|---|
| JD-B-001 | MEDIUM | `hermes_media.rs:947` | `/files` no mira `Host` ni `Origin`; con DNS rebinding una página del atacante lee archivos del allowlist sin sesión. | **Mitigado y declarado.** `host_is_expected` rechaza con 403 cuando `HERMES_PUBLIC_BASE_URL` está configurado y el `Host` no coincide; sin configurar se mantiene abierto, como declara D-A2. Test puro con el caso de rebinding (`evil.test` → false). |
| JD-B-002 | MEDIUM | `hermes_media.rs:159` | (a) un root que es symlink se canonicaliza a su destino (`/opt/data`) y el allowlist nombra un directorio que no posee; (b) un hardlink dentro de un root publica un archivo de fuera. | **(a) corregido:** `canonical_roots` resuelve cada root una vez al arrancar y rechaza los que son symlink; `resolve` compara contra esos roots ya canónicos. Test `a_symlinked_root_is_refused_instead_of_resolved_to_its_target`. **(b) residual declarado:** el agente tiene escritura en esos roots y podría copiar el mismo archivo, así que ninguna defensa basada en ruta lo detiene; el límite real es qué publica el agente, y así queda escrito en D-A2. |
| JD-B-003 | MEDIUM | `HermesChat.tsx:605` | `pathArtifacts` tarjetea rutas sin verificar existencia y luego las borra de la prosa: una ruta del contenedor de Hermes (`/tmp/clip.mp4`) o inventada deja una tarjeta que da 404 y texto perdido. | **Corregido.** `fileExists` + `verifiedPathArtifacts` en `HermesChat.tsx`: al asentar, cada ruta escaneada se prueba con `HEAD filesUrl(path)` y `AbortSignal.timeout(2000)`; solo se tarjetea lo que responde 2xx y, si falla o error de red, la ruta cruda se queda en la prosa. La burbuja en vivo sigue optimista. RED medido desactivando el arreglo: 3 fallos (tarjeta construida para ruta inexistente); GREEN 71/71. |
| JD-B-004 | MEDIUM | `e2e/hermes-artifacts.spec.ts:188` | El spec vivo sigue esperando reproductores con `/api/hermes/media`; tras el cambio todo lo escaneado es `/files`. | **Corregido y ejecutado.** `hermes-artifacts.spec.ts` stubbea `**/files/**` (bytes reales, MIME, `Content-Disposition` con `download=`, solo cabeceras para `HEAD`) y afirma URLs `/files`. Verde en navegador: **5/5** entre `hermes-files` y `hermes-artifacts`. |
| JD-B-005 | MEDIUM | `hermes_media.rs:1495` | Los dos inputs de traversal canonicalizan fuera del root, así que el test seguiría verde sin la guarda explícita de `..`. | **Corregido.** Se agregaron `sub/../ok.png` y `sub/%2e%2e/ok.png`, que permanecen dentro del root: solo la guarda explica el 404. |
| JD-B-006 | LOW | `artifacts.ts:60` | `isFilesUrl` rechaza cualquier cadena con `..`, incluso un nombre legítimo `v1..png`. | **Corregido.** `isFilesUrl` decodifica el pathname y rechaza solo un segmento `..` completo: `v1..png` pasa; `..`, `/files//etc/passwd` y `..%2F..` siguen rechazados. RED 1 fallo → GREEN. |
| JD-B-007 | LOW | `paths.ts:40` | `filesUrl` no codifica la ruta: `a#b.png` y `a?b.png` se truncan en el navegador. | **Corregido.** `filesUrl` codifica cada segmento con `encodeURIComponent` conservando `/`; el nombre de la tarjeta sale de la ruta cruda (`informe#1.pdf`, `a?b.png`). RED 3 fallos → GREEN. |
| JD-B-008 | LOW | `artifacts.ts:240` | `stripPathsFromLine` usa `split/join` y borra prefijos de tokens más largos; corrompe la referencia que la propia app inserta (`…?path=]`). | **Corregido.** `stripPathsFromLine` usa `removeWholePath` con los mismos límites que el escáner (`TOKEN_LEFT`/`TOKEN_RIGHT`: no precedido de `[\w./=&?%#-]`, y el resto empieza por fin de cadena, espacio, `) ] } " ' \` < > , ; : ! ?` o puntos que no continúan el token). Ahora `/tmp/render.png.bak` sobrevive y la referencia `[archivo adjunto: …?path=/opt/data/uploads/informe.pdf]` ya no queda como `…?path=]`. RED 6 fallos → GREEN 42/42. |
| JD-B-009 | LOW | `e2e/hermes-files.spec.ts:16` | Cobertura faltante: symlink, directorio, 304, `download=1`, MIME de PDF/zip, 100 MB, duplicados, reanudación, code spans; y S12.1/S12.2 sin verificar. | **Parcial.** Se agregaron symlink-root y directorio en Rust y el caso de traversal interno (JD-B-005). Los hashes siguen bloqueados por el bind mount (T10/T11). El resto queda como cobertura conocida, no como propiedad probada. |

## Ronda 2 — evidencia y veredicto

Ambos jueces pidieron cambios; ninguno reportó CRITICAL. Total: **13 filas** (4 del juez A, 9 del juez B),
**11 corregidas con evidencia**, 1 mitigada y declarada (JD-B-001), 1 residual declarada (JD-B-002b) y
cobertura conocida en JD-B-009.

Gates después de las correcciones:

- `tsc --noEmit`: exit 0.
- Backend: **550 passed / 0 failed / 2 ignored** en el bin + 8 binarios de integración en verde.
- Frontend: vitest con los cinco archivos del cambio **135/135**; suite completa **953/953** en 74 archivos.
- e2e en navegador real (export estático + backend en `:3100` + DB de producción + usuario descartable
  borrado después): **5/5** entre `hermes-files.spec.ts` (imagen incrustada, tarjeta Word descargable) y
  `hermes-artifacts.spec.ts` (retargeteado a `/files`, reproductores, descarga de xlsx).
- Sin commit ni push, según S1.

No verificado, y no se declara como verificado: los tamaños y SHA-256 de `prueba_hermes.png` y
`prueba_hermes.docx` (S12.1/S12.2), que dependen del bind mount `/opt/data` en Dokploy (T10/T11).
