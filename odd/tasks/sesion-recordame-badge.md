# Feature: sesión 24h/72h con "Recordarme" + limpieza del badge "EN LÍNEA"

- Objective: quitar el badge "EN LÍNEA" del login con toda su lógica, y agregar un checkbox "Recordarme" que alarga la sesión a 72 h (default sin marcar: 24 h), integrado al lenguaje Control Deck.
- Branch: `main` @ `d4388aa`. **El dueño prohibió `git commit`/`git push` en esta sesión**: cero operaciones git de escritura.
- Delivery: sin commits; el árbol queda con los cambios sin commitear para revisión del dueño.
- Runners: `cd frontend && pnpm test` (vitest), `cd backend && cargo test --locked`, Playwright (`webapp-testing`) para lo visual. DB: solo producción (`/tmp/pd-prod.env`, `umask 077`, jamás imprimir la DSN).

## Specs (pedidos del dueño, verbatim)

- S1 (Criterios 1): "La etiqueta 'EN LÍNEA' desaparece limpiamente del encabezado del modal de acceso."
- S2 (Sección 2): "Elimina por completo el componente visual de la etiqueta/badge 'EN LÍNEA' ubicado en la esquina superior derecha del contenedor de login." / "Audita el código fuente para purgar cualquier llamada, intervalo de polling o lógica en segundo plano que estuviera alimentando dicho estado si existiera." (Mapa: no existe polling; el badge es estático — registrar en el log.)
- S3 (Sección 3): "Configura la expiración por defecto de la sesión para que dure estrictamente **24 horas**." (Ya es así vía `SESSION_TTL_HOURS=24` en producción — verificado 2026-10-21; no hay cambio a introducir, solo preservar y pinar con test.)
- S4: "Inserta un checkbox con el texto **'Recordarme'** posicionado exactamente debajo del campo 'Contraseña' y arriba del botón 'Iniciar sesión'." / "Debe integrarse orgánicamente con la línea gráfica y sistema de diseño del panel 'Control Deck'."
- S5: "Si el usuario **NO** marca la casilla al iniciar sesión, la sesión expira en **24 horas**. Si el usuario **SÍ** marca la casilla 'Recordarme', la sesión/token debe extender su vigencia a **3 días (72 horas)**."
- S6 (Criterios 4): "El proceso de verificación ('Judgment Day') concluye con éxito garantizando que el flujo de autenticación no sufre regresiones."
- S7 (Sección 3, supuesto registrado): la auditoría de sesión confirma el modelo actual (bearer token en `localStorage["dashboard-token"]`, sin cookie). El estándar de seguridad vigente lo fija `openspec/changes/2026-10-04-accounts-transfers-login-calendar` ("no HttpOnly-cookie migration" es non-goal declarado): NO migrar a cookies en esta feature; solo documentar y preservar `Cache-Control: no-store`.

## Specs (evidencia de mapa, decisiones técnicas)

- D1: badge = `frontend/app/login/page.tsx:151-157`, key `login.online` (`frontend/lib/i18n/es.ts:41`, única referencia), receta `loginStatusPill` (`deckStyles.ts:433-434`, export `:642`). Borde derecho del header queda vacío al quitarla: dejar el logo tile sin `justify-between` roto (usar `flex items-center` simple).
- D2: TTL = `Utc::now() + Duration::hours(state.session_ttl_hours)` (`backend/src/routes/login.rs:179`), por fila en `sessions.expires_at` (migración `0001:72-81`). Extender `LoginRequest` con `#[serde(default)] remember_me: bool` (no `deny_unknown_fields`, opción segura); `remember_me=true` → constante `REMEMBER_ME_TTL_HOURS = 72`; default → `state.session_ttl_hours` (env `SESSION_TTL_HOURS`, requerido). Sin migración SQL.
- D3: tests de backend que rompen compilación por el campo nuevo: `LoginRequest { … }` en `login.rs:249-254, 541-544, 590-607, 682, 746-749, 838-841, 897-900`; TTLs de `test_state` en `:244, 674, 739, 787, 835, 888`.
- D4: frontend: `client.ts:111-123` `login(email, password, rememberMe)` → body con `remember_me`; `page.tsx:103+` estado `remember`; checkbox entre el cierre del bloque contraseña (`:228`) y el bloque de error (`:238`); comentario `:230-237` ("deliberately NOT rendered") debe reescribirse, no contradecirse en silencio. i18n key nueva `login.remember: "Recordarme"`.
- D5: tests a reescribir: `page.test.tsx:90` (badge), `:95-96` (hoy afirman que NO existe checkbox — pasa a afirmar que SÍ existe y que el body del POST lleva `remember_me` según el estado; el handler MSW `:16-26` no inspecciona campos extra, añadir aserción del body). `client.test.ts:134-149` no aserta el body — agregar caso del body.
- D6: e2e no cambia (flag opcional, default false). Backend sin test de TTL hoy — DB-gated se activan con `DATABASE_URL` (producción OK, usuario desechable `--create-user` borrado al final).

## Tasks

- T1 — S2-S5, S7: backend `remember_me` (login.rs: campo, constante 72, branch TTL, literals de tests, 2 tests DB-backed: default 24h y remember 72h con usuario desechable en producción; borrado verificado por `assert_user_fully_deleted` dentro de ambos tests). Route: delegated. Commit: ninguno (prohibido). [x]
- T2 — S1, S4: frontend quita el badge (page.tsx, es.ts `login.online`, deckStyles `loginStatusPill`, `page.test.tsx:90`) y agrega el checkbox "Recordarme" (estado, marcado, i18n, receta deckStyles coherente, client.ts `login(..., rememberMe)`, test del body según estado). Route: delegated. Commit: ninguno. [x]
- T3 — S6: verificación visual Playwright escritorio+móvil (alineación del checkbox, ausencia del badge) + suite completa + Judgment Day. Route: inline (parent). Commit: ninguno.

## Log

- L1 — Pedido del dueño (2026-10-21, verbatim): "si resuelve esos que faltan a tu manera(la que creas que es la mejor) y hoy aremos esto tambien : # ODD Spec: Modificación de UI y Control de Sesión en Control Deck …" (spec completo: reglas estrictas — ODD, DB de producción exclusiva, prohibido commit/push, validación visual, Judgment Day; eliminar badge "EN LÍNEA"; sesión 24h base + checkbox Recordarme 72h; criterios de aceptación 1-4).
- L2 — Mapa (worker, 2026-10-21): badge = key `login.online` estática, sin polling (minuciosamente: ningún setInterval alimenta el login); TTL por fila en `sessions.expires_at`; token bearer en `localStorage["dashboard-token"]`; sin cookie HttpOnly (non-goal vigente, S7).
- L3 — Interrupción del dueño: dos workers cancelados a mitad; reconciliación (2026-10-21) confirmó que el árbol ya contenía todos los cambios D1-D6; el worker agregó `assert_user_fully_deleted` a ambos tests TTL. Otro worker recreó `/tmp/pd-prod.env` (faltaba en /tmp tras la pausa).
- L4 — Evidencia T1 (parent spot-check, 2026-10-21): `cargo test --locked bin -- login::tests` contra producción = 26 passed, 0 failed; tests GREEN observados: `default_login_expires_in_the_configured_ttl`, `remember_me_login_expires_in_72_hours`, `login_request_defaults_remember_me_to_false`. Verificación de borrado del usuario corre dentro de los tests.
- L5 — Evidencia T2 (worker reconciliation + parent): `pnpm test` frontend = 55 files / 687 passed; suite login/client en verde; `grep loginStatusPill|login\.online|EN LÍNEA`: cero referencias en producción source (solo aserciones de ausencia en el test y artefactos stale en `.next`/`out`, que se re-construyen al validar visualmente).
- L6 — Pendiente observado: `frontend/out` stale aún embebe el bundle viejo con el badge; la validación visual (T3) debe correr sobre build fresco. Deploy que sirva `out` sin rebuild seguiría mostrando el badge.
- L7 — Evidencia T3 (2026-10-22): build estático fresco + backend local (:8052, STATIC_DIR=out) + Playwright headless (chromium, vía skill `webapp-testing`; `playwright-cli` no existe en este entorno): desktop 1280×800 y móvil 375×844 — badge ausente, exactamente 1 checkbox "Recordarme" entre el password (y=403/423) y el botón (y=531/551), checkbox/label alineados <20px, toggle funciona; capturas `/tmp/opencode/login-{desktop,mobile}.png`. Server local detenido y scratch eliminado al cierre.
- L8 — **Judgment Day (ronda 1, 2026-10-22)**: veredicto del Joint target `245853a875e5c721` — Judge A (auth, foco de esta feature): **0 hallazgos**; estáticos verificados: TTL branch, `remember_me` default false + tolerancia a extra fields, rate-limit intacto, token y `Cache-Control: no-store` intactos, e2e/MCP sin cambios innecesarios, sin literal de credenciales. Los 3 WARNING del lugar (ownership del summary/assets, ver doc cierre-pendientes-hibrida L9) no afectan el flujo de autenticación. Criterio de aceptación 4: **cumplido** (suite 470+43 backend, 687 frontend, JD sin hallazgos severos). Jueces ejecutados como `gentle-ai-verify` por denegación de runtime a `jd-judge-a/b` (skill_resolution). Terminal: **APPROVED**.
