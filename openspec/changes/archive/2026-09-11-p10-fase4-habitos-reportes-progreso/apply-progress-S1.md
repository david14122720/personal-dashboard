# Apply Progress — S1 Historial-BE `GET /habits/logs?from&to` (PR1 sobre `main`)

Slice S1 únicamente. S2/S3/S4 intactos. Sin commit/push (parent orquesta PRs).
TDD estricto ACTIVO — runner `cargo test` en `backend/` (filtro `habits`).

## TDD Cycle Evidence

| Fase | Qué | Evidencia |
|------|-----|-----------|
| RED 1.1 | Tests puros `parse_logs_range` (válido, formato, `from>to`, >366d con 366-ok/367-err) en `mod logs_range_tests` | `cargo test habits::logs_range_tests` → **falla**: 8× `E0425 cannot find function parse_logs_range` + `LOGS_RANGE_SQL` (sin implementación) |
| RED 1.2 | Test SQL-string `logs_range_sql_filtra_por_usuario_y_rango_y_ordena` (`user_id=$1`, `log_date≥$2/≤$3`, `ORDER BY habit_id`, NO `SELECT *`, NO `HabitRow`) | Mismo fallo de compilación RED (constante inexistente) |
| GREEN 1.3 | `pub fn parse_logs_range` (`%Y-%m-%d` vía `validate_calendar_date`, `from_after_to`→422, `(to-from).num_days()>365`→422 `range_too_wide`), sin I/O ni `PgPool` | 5/5 tests RED pasan |
| GREEN 1.4 | `LOGS_RANGE_SQL` dedicada + `HabitLogsRangeQuery {from,to}` (`deny_unknown_fields`) + `HabitLogRangeEntry` + `list_logs_range_handler` + wiring `GET /habits/logs` en `main.rs` **antes de `/:id`** + test wiring `habits_logs_range_route_is_wired_before_id_capture` (401, no 404/422) | `cargo test habits` → 37/37 verde |
| TRIANGULATE 1.5 | Bordes: rango 1 día, bisiesto (`2024-02-29` ok / `2023-02-29` err), unknown field→422, `not_done` legacy tal cual; integración PG con skip-guard `DATABASE_URL` (2 hábitos + logs dentro/fuera + otro usuario → 4 propios ordenados); 401 sin sesión | `cargo test habits` offline 10/10 `logs_range_tests`; **contra PG vivo 42/42** (cero skips en habits) |
| REFACTOR 1.6 | Reutiliza `require_user_id` + `map_habit_db_err` (`23503/23514/22P02→422`) sin duplicar; `HabitRow` intacto (15 cols); sin migración → rollback = revert | `EXPLAIN (ANALYZE, BUFFERS)` → `Bitmap Index Scan on idx_habit_logs_user_date`, sin `Seq Scan` |

## Verificación

- `cargo test habits` (offline): 37 passed + nuevos → verde; final offline 42 passed en módulos habits.
- `DATABASE_URL=postgres://pgtest:pgtest@localhost:55434/pgtest cargo test habits`: **42 passed, 0 failed** (incl. `range_devuelve_solo_propios_en_rango_ordenados_y_not_done_tal_cual` contra PG 16 + migraciones 0001–0008). PG efímero propio (`p10-s1-pg`, puerto 55434) destruido tras la evidencia; el contenedor ajeno `sede10-scratch` no se tocó.
- `cargo test` completo (offline): **426 passed (408+5+3+10), 0 failed** (tests PG con skip-guard documentado).
- `cargo clippy --all-targets --locked -- -D warnings`: **cero warnings en `habits.rs`/`main.rs`**; único error preexistente en `routes/transfers.rs:1040` (`unused_must_use`, archivo no tocado por S1, falla a HEAD con este toolchain).
- `cargo fmt --check`: regiones S1 limpias (un nit propio corregido); diffs restantes preexistentes repo-wide (no se corre `cargo fmt` global para no inflar el diff).
- EXPLAIN (volumen: 200 hábitos + 10k logs propios + 50 usuarios/250 hábitos/12.5k logs decoy + `ANALYZE`):
  `Bitmap Index Scan on idx_habit_logs_user_date` (Index Cond `user_id + log_date` rango), `Sort Key: habit_id, log_date`, sin `Seq Scan on habit_logs`.

## Desviaciones del diseño

- Nombre de error: tasks/design decían `HabitApiError`; el módulo usa `AppError` — se implementó `parse_logs_range(...) -> Result<..., AppError>` (reutilización existente, 422 idéntico). Solo naming, sin cambio de contrato.
- Test extra no pedido explícito: `habits_logs_range_route_is_wired_before_id_capture` en `main.rs` (prueba que `/habits/logs` gana a `/:id` con 401). Justificado en 1.4 (wiring antes de `/:id`).

## Archivos cambiados (337 ins / 1 del — dentro del budget 400)

- `backend/src/routes/habits.rs` (+316/−1): import `Query`, `parse_logs_range`, `LOGS_RANGE_SQL` + `HabitLogRangeRow` + `HabitLogsRangeQuery` + `HabitLogRangeEntry` + `list_logs_range_handler`, `mod logs_range_tests` (11 tests).
- `backend/src/main.rs` (+21): ruta `GET /habits/logs` antes de `/habits/{id}` + wiring test.
- No se toca: `HabitRow`, migraciones, triggers, valuaciones, campanita, S2/S3/S4, frontend.

## Tareas restantes

Ninguna de S1 (1.1–1.6 completadas y marcadas `[x]` en `tasks.md`). Gate post-apply:

```text
- [ ] 1.7 Start o reuse bounded review JD 2 jueces ciegos sobre PR1 antes de merge (contrato HTTP, 401/404/422, cap 366, orden, EXPLAIN, ≤400 líneas). <!-- sdd-owner: parent -->
```

## Status consumido/producido

- Preflight parent: `execution auto`, `store openspec`, `delivery auto-chain`, `chain stacked-to-main`, `budget 400`, TDD estricto ACTIVO, JD 2 jueces, RDD off. Workload: `Decision needed: No`, `Chained PRs: Yes`, `Chain: stacked-to-main`, `400-line budget risk: High` → delivery path resuelto por parent (`auto-chain`/`stacked-to-main`); implementado solo el slice asignado S1 (337 líneas, `size: within-budget`).
- `actionContext`: sin `workspace-planning`; edición dentro de `Allowed edit surfaces`. Sin bloqueos.
