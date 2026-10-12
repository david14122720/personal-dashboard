# MCP Dashboard — CRUD completo + TS SDK stdio

## Objetivo
Exponer el backend personal-dashboard (Axum `/api`) como MCP server para que un agente pueda leer/crear/actualizar/borrar.

## Decisiones dueño
- Alcance: CRUD completo
- Stack: TypeScript SDK stdio (local, Pi/Claude)

## Auth (verificado en código)
- `POST /api/login {email,password} -> {token, expires_at}`
- Resto: `Authorization: Bearer <token>`
- Base URL: `PERSONAL_DASHBOARD_API_URL` (default `http://localhost:3001/api`), token en `PERSONAL_DASHBOARD_TOKEN` o login tool.

## Catálogo API a cubrir (desde backend/src/main.rs api_routes)
- accounts, transactions (+stats), transfers, categories(list), budgets(+status), savings-goals(+movements), debts(+payments), habits(+today,logs,streak), goals, tasks, events, notes(+search), subscriptions, assets(+valuations, net-worth), me/preferences

## Tasks
- [ ] 1. Definir catálogo MCP y auth Bearer (en curso)
- [ ] 2. Scaffold TS MCP server stdio (`mcp-dashboard/` package, SDK, zod, config)
- [ ] 3. Implementar tools CRUD completos (por dominio, ~40 tools, paginación y filtros)
- [ ] 4. Verificar build + smoke test (tsc + list_tools + 1 read real)
- [ ] 5. Docs y ejemplo config Pi/Claude

## Evidencia
- (commits por task)

## Next
- Verificar deploy Dokploy Fase 4 sigue pendiente, no bloquea MCP.

## Evidencia (2026-09-17)
- Worker gentle-ai-worker: mcp-dashboard/package.json, tsconfig.json, src/client.ts, src/tools.ts (47 tools), src/index.ts, README.md. npm install 97 pkgs 6s.
- Padre: creado mcp-dashboard/.env.example verbatim (3 líneas), tsc --noEmit EXIT:0.
- .gitignore: + mcp-dashboard/node_modules/, mcp-dashboard/dist/.
- Sin commits (regla: solo con pedido explícito).
