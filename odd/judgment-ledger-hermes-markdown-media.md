# Judgment Day — Hermes Markdown/Base64, servidor de archivos y uploads

Target: el árbol de trabajo sin commitear sobre `208bc62` (feature 1 de la entrega del 2026-10-29).
Spec: `odd/tasks/hermes-markdown-media-uploads.md` (S1–S10, D-A1…D-A6, Log L1–L10).
Activación: pedida por el dueño en S10.7 ("Ejecuta obligatoriamente tu proceso de verificación interno").
Jueces: `jd-judge-a` y `jd-judge-b`, ciegos entre sí, una pasada read-only cada uno.

## Ronda 0 — veredictos

- **JUDGE-A: CHANGES_REQUESTED** — 1 MEDIUM, 3 LOW, 2 INFO. Confirmó localmente 127/127 en los 7 archivos hermes tocados y `tsc` exit 0.
- **JUDGE-B: CHANGES_REQUESTED** — 4 MEDIUM, 6 LOW, 3 INFO, más 8 observaciones de honestidad de tests. Re-midió el costo del parser (2 MB → 3.8 ms; 8 MB → 19.3 ms por flush de 60 ms).

Sin CRITICAL ni BLOCKER en ninguna de las dos pasadas. Ninguno de los dos jueces encontró violación real de S2 (XSS) ni de S6 (path traversal), y ambos aceptaron D-A1…D-A6 como decisiones declaradas; B marcó además que el hotfix del padre (rollback de lote, `trust_forwarded`, `upload_body_limit`) ya estaba aplicado cuando él leyó el árbol.

## Filas congeladas y resolución

| ID | Sev | Hallazgo | Resolución |
|---|---|---|---|
| JD-A-001 | MEDIUM | Un lote rechazado deja en disco todos los archivos ya escritos (huérfanos que ninguna URL referencia). | **Corregido** en el padre: `store_uploads` envuelve a `collect_uploads`, registra cada ruta al abrir el archivo y borra todas en cualquier `Err`. RED observado (test sin el rollback: `orphan left on disk: […-primero.txt]`), GREEN: `a_rejected_batch_leaves_no_orphan_behind`. |
| JD-A-002 | LOW | `DefaultBodyLimit::disable()` en `/api/hermes/upload`: presupuesto por archivo, ninguno por cuerpo. | **Corregido**: `DefaultBodyLimit::max(upload_body_limit())` = 20 × 25 MB + 1 MB de framing. |
| JD-A-003 | LOW | `public_base` confiaba en `X-Forwarded-*` sin validar: un caller autenticado podía elegir el host que Hermes descarga. | **Corregido**: los headers de proxy solo se honran con `HERMES_TRUST_FORWARDED=1`; el test cubre ambos modos. |
| JD-A-004 | LOW | El split del mensaje acumulado se re-ejecuta completo en cada flush. | **Fusionado con JD-B-004** (que lo midió y encontró el hueco real). |
| JD-A-005 | INFO | El `img` inválido devolvía `null` y se tragaba el `alt` (prosa perdida). | **Corregido**: cae a un `span` con el `alt` como texto escapado; los hosts remotos siguen sin cargarse (D-A6). |
| JD-A-006 | INFO | `the_allowlist_excludes_the_hermes_home` solo afirmaba un `const`. | **Corregido**: se agregó `resolving_refuses_a_file_beside_an_allowed_root`, que resuelve un archivo real al lado de una raíz permitida y exige `None`. |
| JD-B-001 | MEDIUM | Ningún test ejecuta la ruta `/api/hermes/upload` ensamblada: orden de capas, body limit y sesión sin cubrir. | Ronda 1 (delegada). |
| JD-B-002 | MEDIUM | Si el cliente corta la conexión, la futura se descarta y queda un archivo parcial en una raíz permitida. | Ronda 1: `.part` + `rename` al cerrar + barrido al arrancar. |
| JD-B-003 | MEDIUM | Regresión no declarada: `text` también va al upload, así que `.md/.csv/.json/.txt` dejaron de llegar inline (antes el proxy los truncaba a 16 000 bytes). | Ronda 1: solo binarios (`kind === "other"`) se suben. |
| JD-B-004 | MEDIUM | El payload **en vuelo** no tiene tope: `pending` retorna antes del chequeo de tamaño, así que el costo crece sin límite mientras se streamea. | Ronda 1: cap in-flight → `oversized`. |
| JD-B-005 | LOW | Sin retención ni GC: cada reintento deja otra copia. | **Declarado** como limitación (no se corrige en esta entrega). |
| JD-B-006 | LOW | Sin pre-chequeo de tamaño en el cliente: 25 MB viajan para recibir 413 con mensaje engañoso. | Ronda 1. |
| JD-B-007 | LOW | `absoluteMediaUrl` ignoraba `NEXT_PUBLIC_API_URL` (URL del agente apuntando al host estático). | Ronda 1. |
| JD-B-008 | LOW | Esquema `http` detrás de Traefik y knobs `HERMES_TRUST_FORWARDED` / `HERMES_PUBLIC_BASE_URL` sin documentar. | Ronda 1 (documentación). |
| JD-B-009 | LOW | D-A1 no declara la pérdida funcional: lo que el agente escribe directo en `/opt/data` ya no se carda. | Ronda 1 (documentación + header del módulo). |
| JD-B-010 | LOW | El splitter no salta código inline entre backticks: un payload ahí se dibuja y el código desaparece. | **Declarado** como limitación. |
| JD-B-011 | LOW | Partir la respuesta en varios `<HermesMarkdown>` reinicia el parseo: una lista/tabla interrumpida por una imagen se fragmenta. | **Declarado** como limitación. |
| JD-B-012 | INFO | Detalles: `.env` subido se guarda como `env` (inocuo); payload truncado al asentar deja un `<img>` roto. | **Aceptado**. |
| JD-B-T1 | INFO | `hermes.test.ts` no verificaba la cabecera de auth del upload: borrar `authHeaders()` quedaba verde. | Ronda 1. |
| JD-B-T2 | INFO | Mismo caso que JD-B-001. | Ronda 1. |
| JD-B-T3 | INFO | Mismo caso que JD-A-006 (ya corregido). | Cerrado. |
| JD-B-T4 | INFO | El e2e stubbea `/api/hermes/upload`, así que S10.4 no está cubierto end-to-end por Playwright (sí por unit backend). | **Declarado** en el Log: el e2e prueba el contrato del cliente, no el endpoint Rust. |
| JD-B-T5 | INFO | El test de XSS no puede probar por sí solo que no hay pipeline de HTML crudo. | **Aceptado**: se apoya en que `rehype-raw` no está instalado. |
| JD-B-T6 | INFO | `stores_each_file…` usaba prefijo de string (`starts_with`). | Ronda 1 (comparación de rutas canónicas). |
| JD-B-T7/T8 | — | Sin defensas falsas; los tests load-bearing quedan nombrados. | Sin acción. |

## Evidencia de los gates que respaldan estas filas

- Frontend: `tsc --noEmit` exit 0; `vitest run` **921/921** en 74 archivos (corrida aislada; una corrida concurrente con el backend produjo 4 falsos rojos de finanzas por timeouts de 5 s — no son regresiones).
- Backend: `cargo test --locked` en `rust:1-slim-bookworm` **exit 0**, 536 passed / 0 failed / 2 ignored + 8 binarios de integración en verde.
- e2e: 17/17 contra el stack real (export estático + backend en `:3100` + DB de producción + usuario descartable borrado después).

## Ronda 1 — re-juicio y cierre

`jd-judge-a` re-juicio acotado (solo IDs congelados + diff, sin hallazgos nuevos): **15 verified, 1 corroborated, 0 regression**.

El corroborado era **JD-B-002**, en un borde que el fix no cubría: el barrido borraba cualquier archivo con extensión `.part`, y un upload legítimo llamado `informe.part` se guarda como `<hex>-informe.part`, así que el próximo arranque lo habría eliminado. Cerrado después del re-juicio: el marcador pasó a `.partial-<único>`, y como `sanitize_upload_name` recorta los puntos iniciales, ningún archivo real puede llevar ese prefijo. El test del barrido ahora incluye el caso de regresión (un `*.part` real sobrevive) además del caso normal.

Verificación posterior: `cargo test --locked` **exit 0** — 542 passed, 0 failed, 2 ignored + 7 binarios de integración en verde, `the_startup_sweep_removes_stale_parts_and_keeps_real_files` verde; `tsc --noEmit` exit 0; frontend **924/924** en 74 archivos; e2e **17/17**.

## Veredicto

`JUDGMENT: APPROVED`

Sin CRITICAL en ninguna ronda. Dos rondas de revisión (máximo del protocolo), una ronda de corrección, cero regresiones en el re-juicio, y los bordes residuales declarados como limitación en el feature doc: sin retención/GC de uploads, copia extra por reintento, Markdown partido en varios roots alrededor de una imagen, y un payload dentro de código inline no se salta.
