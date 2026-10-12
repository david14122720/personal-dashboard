# MCP HTTP + Tokens UI

## Objetivo
1. Pasar `mcp-dashboard/` de stdio a HTTP (para usar remoto/desde cualquier cliente).
2. Nueva sección en la página para generar/borrar tokens/API keys de la página.

## Decisiones dueño
- Transporte: HTTP (reemplaza stdio).
- Tokens gestionables por el usuario desde la UI.

## Diseño
- Backend: nueva tabla `api_tokens` (id, user_id, name, token_hash UNIQUE, prefix, scopes jsonb default '[]', expires_at NULL, last_used_at NULL, revoked_at NULL, created_at). Migración `0009_api_tokens.sql`.
  - `POST /api/tokens {name, expires_in_days?}` → crea, devuelve raw UNA vez (`pd_...` + 32B base64url), guarda solo hash SHA256.
  - `GET /api/tokens` → lista sin hash (id, name, prefix, created, expires, last_used, revoked).
  - `DELETE /api/tokens/{id}` → revoca (soft, revoked_at=now()).
  - Auth de estos 3 con sesión Bearer existente.
  - Middleware: si Bearer no matchea sessions activas, probar api_tokens activas (no revocadas, no expiradas); si matchea, user_id del token + update last_used_at.
- MCP HTTP: endpoint `POST /mcp` (+ GET/DELETE para SSE/streamable según SDK), transport StreamableHTTPServerTransport, auth stateless: usa `Authorization` entrante como Bearer backend; fallback a `PERSONAL_DASHBOARD_TOKEN` env. `MCP_PORT` default 3101. Mantener las 47 tools pasando token por-request (cambiar client.ts a token explícito, no global).
- Frontend: nueva página `/dashboard/ajustes/tokens` (o `/dashboard/configuracion` si existe convención) + link en AppShell nav + `lib/api/tokens.ts` (list/create/revoke) + i18n es (mostrar raw una vez con copiar, confirmar antes de borrar). Vitest para lib + render básico.
- Seguridad: raw solo en respuesta de creación; lista nunca expone hash; revoke inmediato; tokens con expiración opcional; no loguear raws.

## Tasks
- [ ] 1. Backend api_tokens (en curso)
- [ ] 2. MCP stdio → HTTP
- [ ] 3. Frontend sección Tokens
- [ ] 4. Verificación
- [ ] 5. Docs

## Evidencia
- (commits por task, sin push sin pedido)

## Evidencia (2026-09-18)
- Backend api_tokens: migración 0009 + routes/tokens.rs (POST/GET/DELETE) + middleware resolve_token_user_id + helper delega (sesiones primero, luego api_tokens). cargo: 22 tokens tests + 30 auth tests verdes en DB efímera. 2 fallos transfers preexistentes, ajenos.
- MCP HTTP: express + StreamableHTTPServerTransport, POST/GET/DELETE /mcp + GET /healthz, puerto MCP_PORT default 3101, auth por-request (header o env), 47 tools, tsc OK, smoke /healthz 200 verificado por padre.
- Frontend: /dashboard/ajustes/tokens (lista, crear con raw una vez + copiar, borrar con confirm), lib/api/tokens.ts, nav + i18n es, 12 tests verdes + i18n 14 verdes.
- Sin commits (regla: solo con pedido explícito).
