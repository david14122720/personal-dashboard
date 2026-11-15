# security-audit-fixes

Cierre de los 12 hallazgos de `odd/security-audit/2026-11-14/REPORT.md` (auditoría 2 sobre `84a155f`), con reverificación independiente y Judgment Day antes de publicar en `main`.
Alcance: `mcp-dashboard/`, `backend/`, `.github/`, `docker-compose.yml`, `Dockerfile`, dependencias y el propio informe de auditoría. Sin migraciones destructivas ni cambios de contrato público fuera de los listados.

## Specs

- **S1** (F-09, ALTO). «Validar antes de despachar: un `GET /api/me` por token con caché corta (≤60 s) y 401 si falla; atribuir la auditoría al `user_id` resuelto.» Un bearer inventado no puede obtener sesión MCP ni despachar `tools/call`.
- **S2** (F-10, ALTO). «Borrar el fallback. Si hace falta credencial de servicio, exigirla en un header explícito en rutas server-to-server; nunca tratar la ausencia como autenticación.» Sin `Authorization` → 401, aunque `PERSONAL_DASHBOARD_TOKEN` esté definida.
- **S3** (F-17, BAJO). «`ENV NODE_ENV=production`, `app.disable("x-powered-by")`, montar el guard antes del parser, handler JSON 4xx.»
- **S4** (F-18, BAJO). «`127.0.0.1:3000:3000`, `${POSTGRES_PASSWORD:?}` y `${DATABASE_URL:?}`.»
- **S5** (F-14, MEDIO). «Pinear cada `uses:` a SHA completo, `permissions: contents: read` a nivel de workflow y `persist-credentials: false` en el checkout.»
- **S6** (dependencias). «`@modelcontextprotocol/sdk` ≥1.32.0, `rustls` 0.23.46, `rustls-webpki` 0.103.16, `ctutils` 0.4.4, `source-map-js` 1.2.2.»
- **S7** (F-16, BAJO). «Enmascarar el literal en `auditoria.md` y activar secret scanning + push protection.»
- **S8** (F-12, MEDIO). «No bloquear por el bucket de cuenta solo: verificar credenciales y devolver 429 únicamente cuando fallan (el bucket de IP sigue acotando Argon2) […] Setear `TRUSTED_PROXIES` si hay proxy.» Una password correcta entra aunque el bucket de cuenta esté lleno.
- **S9** (F-13, MEDIO). «Quitar el control del llamador o bajarlo a ≤90 días […] agregar «revocar todos los tokens»; y caducar los `expires_at IS NULL` heredados.»
- **S10** (F-11, MEDIO). «Rechazar ventanas anchas por grupo (p. ej. `day` ≤ 400 días, span total ≤ 5 años) con 422 en `parse_summary_window`.»
- **S11** (F-15, BAJO). «`AND NOT is_archived` en el lock y 422 en el miss.»
- **S12** (F-19, BAJO). «Return the same 404 for foreign and nonexistent ids (or 422 for both) on these probes.»
- **S13** (F-20, BAJO). «Persist the paid cycle (`last_paid_on` month comparison) instead of deriving it from a client-writable due date, **or reject backwards `next_billing_on` moves**.» Regla adoptada (la segunda opción, tras medir que la primera rompe el flujo mensual): el ciclo se considera pagado cuando `last_paid_on` existe y `next_billing_on > today` — es decir, «la próxima fecha de cobro sigue en el futuro», que es cierto justo después de pagar y deja de serlo cuando la fecha llega. El reabuso se cierra en la escritura: `PATCH` que fije `next_billing_on <= last_paid_on` responde 422 y no modifica la fila. Pagar en la fecha de vencimiento sigue devolviendo 200; el doble pago inmediato sigue devolviendo 409.
- **S14**. Cada spec se re-verifica con test propio antes del cierre; el núcleo ya verificado (cero IDOR, SQL paramétrico, dinero íntegro) no puede regresar.
- **S15**. Judgment Day (dual review ciego) al final, sobre el diff completo, antes de publicar.
- **S16**. Commit y push a `main` una vez verificado.
- **S17**. Guardar en Engram el resumen de la sesión y los hallazgos.
- **S18**. Buscar oportunidades de optimización con evidencia medida (no intuición), elegir las de mejor relación impacto/riesgo y aplicarlas en un commit propio, sin degradar los fixes de seguridad ni el comportamiento observable. Criterio de rechazo: si la medición no muestra una ganancia real, no se toca el código y se reporta por qué.

## Tasks

- T1 · S1-S3 · WS-A, `mcp-dashboard/src/index.ts` + tests + `Dockerfile` · commit 1
- T2 · S4 · WS-A, `docker-compose.yml` · commit 1
- T3 · S5 · WS-B, `.github/workflows/ci.yml` · commit 2
- T4 · S6 · WS-B, `frontend/pnpm-lock.yaml`, `mcp-dashboard/package{,-lock}.json`, `backend/Cargo.{toml,lock}` · commit 2
- T5 · S7 · WS-B, `auditoria.md` + workflow de secret scanning · commit 2
- T6 · S8 · inline, `backend/src/auth/rate_limit.rs`, `backend/src/routes/login.rs` + tests · commit 3
- T7 · S9 · inline, `backend/src/routes/{tokens,logout,sessions}.rs` + tests · commit 4
- T8 · S10 · inline, `backend/src/routes/movements.rs` + tests · commit 5
- T9 · S11 · inline, `backend/src/routes/subscriptions.rs` + tests · commit 5
- T10 · S12 · inline, `backend/src/routes/{tasks,events,assets}.rs` + tests · commit 5
- T11 · S13 · inline, `backend/src/routes/subscriptions.rs` + tests · commit 5
- T12 · S14 · verify independiente del diff completo · sin commit
- T13 · S15 · Judgment Day (2 jueces ciegos + rondas acotadas) · sin commit
- T14 · S16 · commit final y push a `main` · último
- T15 · S18 · optimización medida: reconocimiento read-only, selección y aplicación · commit 6 (previo a T12)

## Log

- L1 (2026-11-14, petición del dueño, verbatim): «bien amigo arregla todos esos ayasgos reveficalos bien y luego has un dia del juicio al final, y has comit y push a main vale dale recurda guarda todo lo que hagas en engram el resumen y usar odd dale con todo amigo»
- L2: Baseline auditado `84a155f`; informe en `odd/security-audit/2026-11-14/REPORT.md` con F-09..F-20. Cinco fixes de la corrida 1 (F-02..F-07) ya verificados como cerrados.
- L3: F-01 (transporte en claro) queda fuera de este alcance: exige TLS en el borde (Dokploy/Traefik), no se resuelve en el repositorio. Sigue abierto por diseño con el aviso ya corregido en el login.
- L4 (2026-11-14, petición del dueño, verbatim): «tambien busca oportunidades de optimizar algo y haslo vale» → nueva S18 y T15: medir primero, aplicar solo lo que muestre ganancia real, en commit aparte.
- L5: decisión sobre el cuarto caso del oráculo (`habits.rs`, no nombrado por F-19 pero misma clase): se equaliza **solo la existencia** (404 uniforme para ajeno e inexistente, con la sonda ya acotada por `user_id`). Las cuentas archivadas de hábitos siguen escribibles porque en hábitos `is_archived` no significa borrado: siguen listándose, editándose y desarchivándose. Se descarta aplicar la regla de activos al pie de la letra porque cambiaría un camino de éxito que el defecto no toca. Decisión del orquestador dentro del alcance autorizado; queda registrada aquí porque cambia el contrato de un endpoint.
- L6: S13 se reescribió tras medir que la primera opción de la spec rompía el flujo mensual (pagar en la fecha de vencimiento devolvía 409). Regla final: pagado = `next_billing_on > today`, y el reabuso se cierra en la escritura rechazando con 422 un `next_billing_on <= last_paid_on`.
