# T7 — Audit log simple (2026-10-05, opcional, decisión pendiente del dueño)

## Diseño mínimo

Tabla aditiva propuesta (NO aplicada a prod, ver
`backend/migrations/0017_mcp_audit_log.sql`):

`mcp_audit_log(id, occurred_at, user_id, token_id NULL, token_prefix,
tool, success, error_code NULL, request_id)` — `CREATE TABLE IF NOT
EXISTS`, sin tocar tablas existentes. `token_id` es NULL cuando el
caller usa sesión en vez de API token; `user_id` es NULL si el auth
falló antes de resolver usuario.

## Implementado (demo mostrable, sin migración)

Vía `mcp-dashboard` en memoria (elegida por no obligar a migración
prod inmediata):

- `src/tools.ts`: `AuditEntry` + ring buffer (últimas 200 llamadas) +
  `tokenPrefixForLog` (solo prefijo display de 8 chars para `pd_...`,
  etiqueta `session` para sesiones opacas, `none` sin token) +
  `readAuditLog` + tool read-only `list_audit_log` (límite 1–200,
  default 50, validado con Zod).
- `src/index.ts`: el handler de `tools/call` registra cada llamada
  (éxito + error) con `request_id` UUID propio. `tools/list` no se
  loguea.
- Regla de privacidad (ambas versiones): NUNCA raw, hash, args, bodies
  ni headers de autorización. Solo prefijo enmascarado + qué/cuándo/
  con-qué-token/resultado.

## Cómo verlo

1. Arrancar el MCP (`npm start`, puerto 3101) y llamar cualquier tool.
2. Llamar `list_audit_log` (opcional `{"limit": 10}`) — devuelve las
   entradas newest-first.
3. Fila de ejemplo (prefijo enmascarado, sin secretos):
   `{"occurred_at":"2026-10-05T...Z","tool":"list_accounts",
   "success":true,"error_code":null,"token_prefix":"pd_a1b2c",
   "request_id":"..."}`.
4. Diseño durable + query de ejemplo en `0017_mcp_audit_log.sql`.

## Decisión pendiente del dueño

- ¿Se queda el buffer en memoria (efímero, se resetea al reiniciar) o
  se aplica la migración 0017 para log durable en Postgres?
- Nota: el buffer se resetea con cada restart; si se quiere historia
  entre reinicios, hace falta la tabla.

Sin commits (prohibido en esta tarea). Sin nuevas deps. Sin tocar
backend compilado (solo el `.sql` propuesta, inerte para `cargo`).
