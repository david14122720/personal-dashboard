# Cierre MVP — JD + commits + push main + Dockerfile

## Objetivo
Juicio dual en 2 partes sospechosas, fixes de severos confirmados, commits por unidades
(excluyendo local-only), FF de main, push a main, Dockerfile/.dockerignore para Dokploy.

## Target congelado
- HEAD: 6bcde54
- Worktree diff: 7da808f10ff17798 (8 files, +150/-13 + untracked)

## Rondas JD (máx 2 fix + 2 re-juicio)
- R1: auth tokens backend (middleware.rs, helper.rs, routes/tokens.rs, migración 0009).
  Sospechas: bypass de auth vía path api_tokens, POST /tokens aceptando api token,
  fuga de raw/hash, scope cruzado entre usuarios, last_used rompiendo login.
- R2: MCP HTTP (index.ts, client.ts).
  Sospechas: leakage de token entre requests/clientes vía holders, sesión fija,
  acceso anónimo con fallback env.

## Exclusiones de commit (local-only, no van a Dokploy)
- skills-lock.json (modificado, no commitear)
- .agents/skills/grill-me/, .claude/skills/grill-me
- .codegraph/, odd/, .atl/
- frontend/tsconfig.tsbuildinfo, mcp-dashboard/node_modules+dist (ignorados)
- mcp-dashboard/package-lock.json (ignorado global)

## Unidades de commit (Convencional, en master → FF main → push main)
1. feat(auth): personal API tokens generate/list/revoke
2. feat(web): tokens section generate/revoke + nav + i18n
3. feat(mcp): dashboard API over Streamable HTTP
4. chore(deploy): .dockerignore + Dockerfile Dokploy

## Deploy
- Migraciones en prod son manuales (psql): documentar comando para 0009.
- Dockerfile raíz ya hace FE estático + BE sirviendo STATIC_DIR; falta .dockerignore
  (contexto incluye backend/target 6GB + node_modules + .git).

## Evidencia
- (veredictos JD, commits, push)

## Ledger JD R1 (auth tokens) — CLOSED
- Confirmado x2 (JD-A-001 + JD-B-001, CRITICAL deterministic): POST /tokens aceptaba
  API tokens y acuñaba credenciales (bypass de revocación).
- Fix inline padre (fix-agent exigía hash canónico imposible en 3 intentos; cambio
  mínimo Tier-1 con contexto completo): helper.rs require_session_user_id
  (sessions-only) + create handler lo usa; GET/DELETE intactos.
- Verificado por padre en DB efímera: tokens_create_requires_session_not_api_token ok,
  22 tokens + 7 helper verdes. Re-juicio A+B: CLOSED, sin defectos causados.
- Info (B-002, single-judge): campo scopes[] sin semántica; no se toca.

## Ledger JD R2 (MCP HTTP) — DISPUTADO, escala al dueño
- A-SEVERE-1 (index.ts:67+107): holder.token mutable por sesión; 2 requests
  concurrentes en la misma sesión pueden cruzar credenciales (A pide ALS por-request).
- B-SEVERE-1 (index.ts:110-114): sin chequeo Origin/Host + SDK rebinding guard off;
  página hostil con DNS-rebind puede iniciar sesión y usar el fallback env token.
- B-SUSPECT-1: session id usado como key de objeto plano (__proto__ → 500, sin
  ganancia probada). B-SUSPECT-2: misma race que A-SEVERE-1 pero B la ve no-probada
  (secreto UUID). B-SUSPECT-3: sesiones sin expiración → DoS memoria. B-SUSPECT-4:
  apiFetch sin timeout. A-SUSPECTs: downgrade a env token en GET /mcp, init sin rate limit.
- Estado protocolo: ningún severo confirmado x2 → sin auto-fix; A y B discrepan en
  explotabilidad de la race → contradicción → decisión humana.

## Veredicto JD — APPROVED ✅
- R1 auth: 1 crítico confirmado x2 → fix session-only → re-juicio A+B CLOSED.
- R2 MCP: 2 severos single-judge (race + rebinding) → dueño autorizó fix →
  ALS + hostGuard + UUID sids, probado (30/30, 403, 400) → re-juicio A+B CLOSED.
- Desvíos: fix-agent dispatcher exigió hash canónico indesconocible (3 intentos);
  fixes inline Tier-1 del padre, registrados aquí. Budget: 2 fix + 2 re-judgment exactos.

## Commits + push (2026-09-18)
- 8239e5c feat(auth) / bb0f3f2 feat(web) / 42e349c feat(mcp) / 075ecf6 chore(deploy)
- master → main FF, push origin main 6bcde54..075ecf6 OK.
- Excluido: skills-lock.json (M), grill-me, .codegraph, odd, tsbuildinfo.
- Dockerfile: el raíz ya era correcto (FE estático + BE STATIC_DIR); se creó
  .dockerignore (saca backend/target 6GB, node_modules, .git, local-only).
- Pendiente manual: aplicar 0009 en prod + redeploy Dokploy + verificar.

## Fix prod tokens (2026-09-18)
- Reporte: "No se pudo crear el token" en prod. Causa: api_tokens no existía
  en prod (0009 nunca aplicada; deploy 075ecf6 sí traía el código).
- Aplicada 0009 en prod pdbname + smoke transaccional con ROLLBACK (0 filas
  persistidas). Tabla verificada.

## Fix prod transfers (2026-09-18)
- Reporte: "No se pudieron cargar las transferencias" en prod. Causa raíz:
  LIST_TRANSFERS_SQL usaba MIN(id)/MAX(id) sobre UUID y Postgres no tiene
  min(uuid) → 500 siempre. Preexistente (tests fallaban en árbol prístino),
  no causado por tokens/MCP.
- Fix: (array_agg(account_id ORDER BY id))[1/2], sin JOINs, misma forma.
  20/20 transfers verdes en DB real; suite 427+1 flaky (notes scan, verde aislado).
- Commit bf16376 en main+master, push ambos. Dokploy autoDeploy lo lleva a prod.
