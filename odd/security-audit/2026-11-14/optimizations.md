# Oportunidades de optimización — medición y decisión (2026-11-14)

Reconocimiento read-only sobre `84a155f` + edits en curso. Criterio (S18): solo se toca código cuando la medición justifica la ganancia. Cada candidato trae su evidencia y su veredicto.

## Medición de base

- **Sin N+1.** Los listados son una sola sentencia (`tasks.rs:522`, `habits.rs:1061`, `notes.rs:301`) y `/habits/today` es un `CROSS JOIN LATERAL` (`habits.rs:1038`). No hay `SELECT *` en SQL de producción.
- **`/movements/summary` = 7 sentencias**: auth + 6 consultas secuenciales (`movements.rs:1002-1098`).
- **Payload del dashboard**: el ledger completo fueron 69 KB de 81 KB del brief (`odd/tasks/cierre-pendientes-hibrida.md:10`); medido en su momento, 43.92 ms / 60k filas vs 1.067 ms / 995 filas con rango (`odd/tasks/solidificacion-dashboard.md:184`).
- **CI**: las últimas corridas de `ci.yml` tardan **~2m08s** de punta a punta (dos jobs en paralelo), medido con `gh run list` (runs 43437541811, 43324229212, 41318594014).

## Candidatos

| # | Candidato | Ganancia medida | Riesgo | Veredicto |
|---|---|---|---|---|
| 1 | El widget de movimientos descarga el ledger entero para pintar 5 filas (`MovementsSnapshot.tsx:45,56`; `movements.rs:107` sin `LIMIT`) | 41× en consulta con 60k filas; 69/81 KB del payload | **Alto**: `movements.rs:1937` fija por test que el rango no lleva `LIMIT` (S3a) y la spec S1 exige el contrato actual | **Rechazado en este ciclo** — exige enmienda de contrato del dueño, no un cambio silencioso |
| 2 | Las notas viajan con el cuerpo completo en modo brief (`notes.rs:56,58`; cuerpo máximo 1 MiB en `:50`) y la UI pinta 2 líneas (`ProductivitySections.tsx:674`) | Payload N × hasta 1 MiB, sin cota por número de notas; bytes reales no medidos | Medio: el formulario se siembra del cuerpo (`ProductivityForms.tsx:516`) y necesita un fetch de detalle | **Rechazado en este ciclo** — el mayor problema de payload a futuro; va como recomendación con su propio cambio |
| 3 | Job de backend sin caché de cargo (`ci.yml:53`) | **Medido: 2m08s por corrida**; un caché ahorraría a lo sumo ~1 min | Añade una action de terceros justo después de pinchar toda la cadena de suministro | **Rechazado** — la ganancia absoluta no paga una nueva dependencia de CI |
| 4 | `/movements/summary` ejecuta 5 consultas independientes en serie (`movements.rs:1012-1097`) | 4 round-trips menos por request (contado) | El pool tiene `max_connections(5)` (`db.rs:6`): paralelizar 5 consultas consume el pool entero por request | **Rechazado** — mejora la latencia de una request a costa de la contención del pool; el dashboard ya pide una sola |
| 5 | La pantalla de productividad pide `/events` **dos veces** (`ProductivityScreens.tsx:538` y `:615`; `:567` ya deriva `todaySectionEvents` de `allEvents`) | 1 request y 2 sentencias SQL menos por carga (contado) | Bajo: paridad de límites de fecha, tests pueden mockear la segunda clave | **ACEPTADO** |
| 6 | `ORDER BY is_pinned DESC, updated_at DESC` sin índice que lo cubra (`notes.rs:56`; `0004…sql:162-163`) | No medido; con el volumen actual el planner probablemente ignore el índice | Bajo, pero exige migración manual en producción | **Rechazado en este ciclo** — sin medición, no se justifica una migración |

## Rechazados por medición previa del repo

Recharts ya es lazy y `optimizePackageImports` se midió byte-idéntico (`solidificacion-dashboard.md:330-336`); una sola fuente de i18n y dos SVG en `public/`; agrupar las 11 búsquedas de sesión del dashboard retrasaría la revocación (regresión de seguridad); en MCP, `list_movements` hace accounts→movements en serie a propósito (fail-before-fetch, `tools.ts:578-590`), `get_dashboard_summary` ya usa `Promise.all` (`tools.ts:1229`) y la validación del bearer ya está cacheada con TTL acotado (`auth.ts:57`); el `last_used_at` ya está limitado a una escritura cada 5 min (`middleware.rs:30-31`); el índice de cobertura de `habit_logs` se midió como pérdida neta (`0018_tasks_read_model_indexes.sql:29-37`).

## Decisión de este ciclo

Se aplica **#5** (una request menos por carga de productividad, sin cambio de contrato). #1 y #2 quedan documentados como las dos mejoras que sí importan a futuro, con la condición explícita de #1: requiere que el dueño amplíe el contrato del snapshot; no se toca por iniciativa propia. #3, #4 y #6 se descartan con el número en la mano.
