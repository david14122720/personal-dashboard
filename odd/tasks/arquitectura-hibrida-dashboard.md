# ODD feature: arquitectura-hibrida-dashboard

Rebalance every dashboard data flow to a security-first hybrid split: the Rust/Axum server owns
validation, business rules, sanitization and response shaping; the browser keeps reactivity, local UI
state and interactions. Owner session 2026-10-18. Specs S1-S11, tasks T1-T10, log L1-.

## Specs

**S1 — methodology (owner, verbatim, L1).** "Metodología: Organic-Driven Development (ODD)."

**S2 — database (owner, verbatim, L1).** "Base de Datos: Conexión y consultas EXCLUSIVAS a la base de
datos de PRODUCCIÓN. Prohibido crear o migrar bases de datos locales."

**S3 — version control (owner, verbatim, L1).** "Control de Versiones: Prohibido realizar `git commit` o
`git push`." This overrides ODD's work-unit commit rule for this feature: the delivery is a working-tree
delta, reviewed as a diff (precedent: `odd/tasks/money-path-fix-delta-final.patch`, sha256-frozen with no
commit). The feature document is the only tracked-artifact convention that still applies.

**S4 — visual validation (owner, verbatim, L1).** "Validación Visual: Usa la skill `playwright-cli` para
verificar el correcto renderizado de la página en versión escritorio y móvil." **Resolved**: `playwright-cli`
is the installed agent CLI (`@playwright/cli` 0.1.22 → `/home/david/.local/bin/playwright-cli`; chromium
channel pinned in `~/.playwright/cli.config.json`; verified 2026-10-11 in `odd/tasks/playwright-toolchain.md`),
used with `resize` + `screenshot` for desktop and mobile rendering evidence on the real app. The repository's
own suite (`frontend/e2e`, `@playwright/test` 1.63, live mode `E2E_SMOKE_LIVE=1`) is the functional
regression surface and complements it, never replaces it.

**S5 — closing verification (owner, verbatim, L1).** "Validación de Integridad: Ejecuta obligatoriamente tu
proceso de verificación interno ("Judgment Day" / verify) al finalizar las optimizaciones para garantizar la
estabilidad."

**S6 — hybrid split with server priority (owner, verbatim, L1).** "Aplica un modelo híbrido equilibrado
(aproximadamente **60% de carga en el Servidor** y **40% de carga en el Cliente**), permitiendo ajustes
dinámicos según el criterio técnico para maximizar la seguridad." · "Todo el procesamiento de datos sensibles,
reglas de negocio críticas, validaciones de permisos y sanitización previa a consultas de base de datos DEBEN
ejecutarse del lado del servidor." · "No expongas lógica de negocio ni filtros de seguridad críticos en el
cliente." · "El servidor debe entregar únicamente las respuestas recortadas y datos finales estrictamente
necesarios para la vista (evitando *over-fetching* de campos sensibles)."

**S6a — measurable form of S6 (derived, declared).** The 60/40 ratio is a heuristic, not a metric; it is
applied as four checkable rules, in priority order: **(1)** every mutation performs authorization, validation,
integrity and normalization on the server before touching the database; **(2)** no response field that no
browser code reads (no dead payload) and no field a view does not need (no over-fetch); **(3)** no authoritative
money/date/permission value computed or trusted from the client; **(4)** aggregations the browser performs over
unbounded row sets move to a server response in the shape the view renders. Anything that is not one of these
rules is not in scope, and the client keeps every bit of reactivity, local UI state and interaction logic
(S7). Two items of the 2026-10-18 security audit fall under rule (1) and are in scope: `pay` ignoring currency
and the valuation-ordering race.

**S7 — client load (owner, verbatim, L1).** "Delega en el navegador la reactividad visual, manejo de estados
locales de la interfaz, componentes interactivos y transiciones de usuario para mantener una experiencia ágil
y sin latencia percibida."

**S8 — execution directives (owner, verbatim, L1).** "**Auditoría de Seguridad y Datos:** Revisa los flujos de
la página para asegurar que las consultas y mutaciones de datos pasen por capas de validación en el servidor
antes de tocar la base de datos de producción." · "**Optimización de Respuestas:** Asegura que los payloads
enviados desde el servidor al cliente sean ligeros, seguros y con el formato exacto requerido por la interfaz."
· "**Equilibrio de UI:** Mantén la reactividad del frontend fina y liviana, dejando que los cálculos o
transformaciones pesadas de datos se resuelvan antes de enviar la respuesta al navegador."

**S9 — acceptance criteria (owner, verbatim, L1).** "1. La lógica crítica y el acceso a datos sensibles quedan
totalmente blindados del lado del servidor. 2. La interfaz de usuario responde de forma fluida y reactiva en el
navegador (validado con Playwright en escritorio y móvil). 3. No hay filtrado de campos innecesarios o datos
expuestos en las peticiones de red. 4. El proceso del "Día del Juicio" finaliza en verde, confirmando que la
seguridad aumentó y que toda la funcionalidad original de la página se mantiene 100% operativa."

**S10 — production safety inside S2 (derived, declared; refined after measurement).** Production is the only
database target (S2), and certification of criterion 4 needs the app running: the backend runs locally against
the production database, with a throwaway user created by `--create-user` and deleted at the end (every row
cascades from `users(id)`); reads are unrestricted, writes are limited to that user's own rows, and **no
migration is applied**. Measured, not inferred: the crate has no library target, `backend/tests/` holds exactly
seven targets and all of them are migrations, and twelve files under `backend/migrations/` carry DDL that alters
or drops schema objects — so plain `cargo test` would be the destructive schema migration the standing project
rule requires explicit owner approval for (`CLAUDE.md`). **Out of scope**: those seven DDL targets. **Authorized
by the owner and in scope**: the DB-backed unit tests of `cargo test --bin personal-dashboard-backend` (owner
answer, L11) — they create and remove their own fixtures and run no DDL, and table counts are compared before
and after (L12). Also in scope: the frontend unit suite (`vitest run`, `msw`-mocked), `tsc`, the production
build, live API probes with the throwaway user, and the Playwright surfaces.

**S11 — functional preservation (owner, verbatim, L1).** "confirmando que la seguridad aumentó y que toda la
funcionalidad original de la página se mantiene 100% operativa" (S9.4). Every task that removes a response
field or moves a computation must state, in the task line, which view it serves; a field or transform whose
consumers cannot be enumerated is left untouched and recorded as a deviation in the Log.

**S12 — brief shapes (derived from S6a(2) + the T1b field verdict; the contract T3 implements).** `?shape=brief`
returns exactly the fields with a frontend read site; absent, the response is byte-identical to today's, which
is what the MCP keeps using (L9/L10). Any other `shape` value is a strict-read 422 (`shape must be one of:
brief`). Per endpoint, brief = the listed fields:

| Endpoint | `?shape=brief` returns | Dropped for the browser (the MCP still gets them) |
|---|---|---|
| `GET /accounts` | id, name, currency, balance | notes, color, icon, is_archived, created_at, updated_at |
| `GET /categories` | id, name, kind | color, icon, is_archived, created_at |
| `GET /movements` | id, account_id, transfer_account_id, category_id, direction, amount, occurred_on, description | subscription_id, created_at, updated_at |
| `GET /subscriptions` | id, name, price, currency, frequency, next_billing_on, is_active, last_paid_on | category_id, payment_method, url, notes, cancelled_at, created_at, updated_at |
| `GET /assets` | id, name, category, account_id, currency, acquired_on, notes | current_value, is_archived, created_at, updated_at |
| `GET /tasks` | id, title, priority, status, due_date, completed_at, goal_id | description, reminder_id, category_id, sort_order, created_at, updated_at |
| `GET /events` | id, title, kind, starts_at, ends_at, all_day, location | description, habit_id, goal_id, task_id, subscription_id, category_id, reminder_id, created_at, updated_at |
| `GET /goals` | id, name, description, area, due_date, progress, status, color | start_date, category_id, reminder_id, created_at, updated_at |
| `GET /habits` | id, name, direction, frequency, days_of_week, start_date, end_date, category, color, icon, is_archived, short_label | description, target_per_period, category_id, created_at, updated_at |
| `GET /notes/search` | id, title, body, is_pinned, updated_at | is_markdown, category_id, created_at |

Not briefed, deliberately: `GET /tokens` (`scopes` is its single browser-invisible field) and `GET /net-worth`
(`assets` duplicates `net_worth` per currency); a whole read shape for one field is surface without a
measurable win, and both are recorded in the Log instead. Dropped globally because no consumer anywhere reads
them (L9): `GET /me → id`, `GET /sessions → revoked_at`. The mutation echo bodies are left alone: nothing reads
them, but turning them into 204 would touch the shared API client for no security gain (S11).

## Tasks

| ID | Task | Specs | Route | Commit |
|---|---|---|---|---|
| T1 | Exploration maps: response-vs-consumption matrix, validation placement, client-side transforms | S6a, S8 | 3 × `gentle-ai-explore` (read-only) | none (S3) |
| T2 | Baseline before changes: production build, `tsc`, live Playwright surfaces, captured network payloads | S9.2, S9.4 | inline | none (S3) |
| T3 | Server: response shaping per the T1 matrix (`?shape=brief`, S12) | S6a(2), S8, S12 | parent (foundation + `/accounts`) + 2 × `gentle-ai-worker` (finance routes, productivity routes) | none (S3) |
| T4 | Server: move client-only rules and the two audit items (currency on `pay`, valuation ordering) into the server | S6a(1), S6a(3) | to confirm | none (S3) |
| T5 | Server: aggregations the browser computes over unbounded rows | S6a(4), S8 | to confirm | none (S3) |
| T6 | Client: consume the new shapes, keep reactivity and optimistic UI, delete duplicated client rules | S7, S11 | to confirm | none (S3) |
| T7 | Verification: unit + `tsc` + build, live API probes (throwaway user), network audit (no extra fields), functional regression | S9.1, S9.3, S10 | `gentle-ai-verify` | none (S3) |
| T8 | Judgment Day: two blind judges + bounded fix rounds + terminal verdict | S5, S9.4 | `jd-judge-a`, `jd-judge-b`, `jd-fix-agent` | none (S3) |
| T9 | Round-trip evidence: desktop + mobile rendering of every touched view | S4, S9.2 | `playwright-cli` + repo suite | none (S3) |
| T10 | Closeout: cleanup (throwaway user deleted, temp env file removed, servers stopped), report, deviations | S3, S10 | inline | none (S3) |

## Log

**L1 — owner request (verbatim, 2026-10-18).**

```
# ODD Spec: Arquitectura Híbrida Equilibrada (Enfoque en Seguridad y Control)

## 1. Reglas Estrictas de Entorno (Globales)
- **Metodología:** Organic-Driven Development (ODD).
- **Base de Datos:** Conexión y consultas EXCLUSIVAS a la base de datos de PRODUCCIÓN. Prohibido crear o migrar bases de datos locales.
- **Control de Versiones:** Prohibido realizar `git commit` o `git push`.
- **Validación Visual:** Usa la skill `playwright-cli` para verificar el correcto renderizado de la página en versión escritorio y móvil.
- **Validación de Integridad:** Ejecuta obligatoriamente tu proceso de verificación interno ("Judgment Day" / verify) al finalizar las optimizaciones para garantizar la estabilidad.

## 2. Filosofía de Arquitectura Híbrida (Servidor vs. Cliente)
- **Distribución de Carga:** Aplica un modelo híbrido equilibrado (aproximadamente **60% de carga en el Servidor** y **40% de carga en el Cliente**), permitiendo ajustes dinámicos según el criterio técnico para maximizar la seguridad.
- **Prioridad de Seguridad en Servidor (~60%):**
  - Todo el procesamiento de datos sensibles, reglas de negocio críticas, validaciones de permisos y sanitización previa a consultas de base de datos DEBEN ejecutarse del lado del servidor.
  - No expongas lógica de negocio ni filtros de seguridad críticos en el cliente.
  - El servidor debe entregar únicamente las respuestas recortadas y datos finales estrictamente necesarios para la vista (evitando *over-fetching* de campos sensibles).
- **Carga Fluida en Cliente (~40%):**
  - Delega en el navegador la reactividad visual, manejo de estados locales de la interfaz, componentes interactivos y transiciones de usuario para mantener una experiencia ágil y sin latencia percibida.

## 3. Directivas de Ejecución
1. **Auditoría de Seguridad y Datos:** Revisa los flujos de la página para asegurar que las consultas y mutaciones de datos pasen por capas de validación en el servidor antes de tocar la base de datos de producción.
2. **Optimización de Respuestas:** Asegura que los payloads enviados desde el servidor al cliente sean ligeros, seguros y con el formato exacto requerido por la interfaz.
3. **Equilibrio de UI:** Mantén la reactividad del frontend fina y liviana, dejando que los cálculos o transformaciones pesadas de datos se resuelvan antes de enviar la respuesta al navegador.

## 4. Criterios de Aceptación
1. La lógica crítica y el acceso a datos sensibles quedan totalmente blindados del lado del servidor.
2. La interfaz de usuario responde de forma fluida y reactiva en el navegador (validado con Playwright en escritorio y móvil).
3. No hay filtrado de campos innecesarios o datos expuestos en las peticiones de red.
4. El proceso del "Día del Juicio" finaliza en verde, confirmando que la seguridad aumentó y que toda la funcionalidad original de la página se mantiene 100% operativa.
```

**L2 — scope resolution (agent, 2026-10-18).** "la página" is the whole dashboard app: the frontend is a
single Next.js static export (`frontend/next.config.ts:4` `output: "export"`) whose panels all read one API, so
the four acceptance criteria are app-wide. Scope is every panel, not one route.

**L3 — tooling resolution (agent, 2026-10-18).** `playwright-cli` exists as the agent CLI, not as a repository
skill; the repo also carries its own Playwright suite and the live recipe is documented in
`frontend/playwright.config.ts` (`E2E_SMOKE_LIVE=1`, backend serving `frontend/out` with the API under `/api`).

**L4 — open dependency (agent, 2026-10-18).** Live verification needs the production `DATABASE_URL`. It is not
in the environment and must not enter the repository, a commit, a log or this document; the owner places it in
a local file outside the repository and it is deleted at closeout (S10, T10).

**L5 — test surface (agent, 2026-10-18).** Measured, not inferred: `cargo test --lib` fails instantly (`no
library targets`), so the unit target is `cargo test --bin personal-dashboard-backend`; `backend/tests/` holds the
seven `migration_*` targets and twelve migrations carry DDL. Baseline before any source change: `tsc --noEmit`
exit 0, `next build` exit 0 (11 static routes, `out` 3.0 MB); `.gitignore` covers `backend/target/`,
`frontend/.next/`, `frontend/out/`, `frontend/test-results/`, `frontend/playwright-report/`.

**L6 — live environment (agent, 2026-10-18).** DSN captured from the Dokploy API into `/tmp/pd-prod.env`
(mode 600) and never printed; local backend on :3000 serving `frontend/out` against the production database; no
migration applied. Throwaway user `hybrid-audit@audit.test` (`2b9b0b90-…`) owns every probe row. Known side
effect: `frontend/e2e/productivity-layout.spec.ts:321,371` rewrites tracked evidence files under
`openspec/changes/2026-09-23-simplify-finance-productivity/evidence/`; each live suite run restores them.

**L7 — T4 RED, measured on production (agent, 2026-10-18).** `pay` of a USD subscription from a COP account →
**200**, debiting COP (ledger row written, balance −9.99 on top of the seeded −12.50). Valuation race with a
fresh asset per round → **4 of 10 rounds inverted** (`current_value` left at `200.00` while the `2026-03-01` row
was already stored). Both through the real API against the production database.

**L8 — T4 GREEN, measured on production (agent, 2026-10-18).** Same probes after the fix: `pay`(USD sub, COP
account) → **422**, account untouched and no ledger row; `pay`(USD sub, USD account) → 200 with the cycle
advanced; race → **0 inversions in 10 rounds** (3 rounds rejected by the guard, 7 accepted with the correct
final value). The fix: the pay lock now carries both currencies and compares them, and a valuation write locks
the owned asset row before the check-then-act ordering guard (`LOCK_ASSET_SQL`).

**L9 — field-consumer verdict (T1b, agent, 2026-10-18).** Exactly four things have no consumer anywhere:
`GET /sessions → revoked_at`, `GET /me → id`, and the response bodies of subscription POST/PATCH/pay and the
asset-valuation POST. Everything else the browser does not read — `accounts.notes/color/icon/is_archived/
created_at/updated_at`, `events` link ids, `tasks.description/sort_order`, `categories.color/icon/is_archived`,
`assets.current_value`, `tokens.scopes`, `net-worth.assets`, `login.expires_at`, and the mutation echoes of
movements/tasks/events/notes/goals/accounts — **is** consumed by the MCP, which passes each API response through
to the agent (`mcp-dashboard/src/tools.ts`, `fmt(await apiGet(...))`). A global trim would shrink the owner's
agent surface, which no spec asks for.

**L10 — response-shaping decision (derived from S6 + S11, agent, 2026-10-18).** Additive and opt-in per request:
the browser asks for the shape its view needs (`?shape=brief`) and the MCP keeps today's full response, because S6
asks for what is "necesario para la vista" and criterion 3 measures "las peticiones de red" of the page.
Rejected with reasons: a global trim (breaks the agent surface nobody asked to change), new `/views/*` routes
(doubles the route surface and the review delta), and dynamic field lists (this repo has no dynamic SQL
identifiers, and S8 asks for sanitization, not interpolation).

**L11 — owner decision, verbatim (2026-10-18).** Asked whether the DB-backed Rust unit tests may run against
production under S2, the owner answered: "Sí, los 433 contra producción".

**L12 — deferred, with reasons (agent, 2026-10-18).** The validation map found seven rules that live only in the
browser; the two money ones are fixed (L8). Deferred to a follow-up, because each changes accepted inputs without
a security gain and adds regression surface to working views (S11): habit `log_date` bounds, goal `area`
vocabulary, habit `category`/`icon`/`short_label` vocabulary, task `sort_order` derivation, and the browser-local
"today" used by the habit toggle.

**L13 — the compiler confirmed the field verdict (agent, 2026-10-18).** Narrowing the frontend wire types to the
S12 brief sets produced 44 object-literal errors and **all of them were in `*.test.ts(x)` fixtures, none in view
code**; after removing the 44 fixture properties, `tsc --noEmit` is clean. This is the mechanical evidence for
S11 and criterion 4: no view reads a field the brief shape stops sending. It also corrected the hand-rolled
verdict in the right direction — the wire types *declared* more fields than the verdict had called dead (e.g.
`CategoryWire.color`, `MovementWire.subscription_id`, `SubscriptionWire.payment_method`), so the declared set was
checked instead of trusted, and the compiler proved which of those declarations are never read.

**L14 — network audit against production data (agent, 2026-10-18).** Realistic dataset (3 accounts, 6
categories, 247 movements over 12 months, 4 transfers, 2 subscriptions, 3 assets with 9 valuations, 5 habits
with 300 logs, 4 goals, 6 tasks, 6 events, 6 notes). Ten list endpoints, both shapes, measured in bytes:
full **118,129 B** → brief **81,542 B** (−31%). Per endpoint: accounts −57%, categories −52%, movements −28%,
subscriptions −46%, assets −44%, tasks −47%, events −55%, goals −44%, habits −37%, notes −21%. Page profiles:
dashboard 106,341 → 74,844 B (−30%), finance 108,394 → 75,858 B (−30%). The brief body is a strict subset of the
full one for all ten (0 subset risks). Absent `shape`, the full field set is still served, and that guarantee is
structural, not sampled: `git diff` shows no existing full-shape SQL const or DTO modified. Strict-read contract:
`/accounts?shape=bogus`, `/movements?shape=x` and `/tasks?shape=` answer 422 `shape must be one of: brief (got …)`.

**L15 — the suite caught two bad assertions the workers wrote (agent, 2026-10-18).** First full run after the
workers: `441 passed; 2 failed`. Both failures were the new brief tests in `movements.rs` and `subscriptions.rs`,
asserting that the dropped column names are absent from the whole SQL string while the verbatim `ORDER BY`
legitimately still names `created_at`. Fixed by asserting on the SELECT list only (`sql.split(" FROM ").next()`),
the same discipline the categories/assets tests already used.

**L16 — final Rust suite (agent, 2026-10-18).** After the assertion fix: `443 passed; 0 failed` in 33.15 s
against the production database. The table-count comparison came back identical except `sessions 16 → 17`, which
is the parent's own UI login from the visual-evidence run and not a fixture leak; a direct read confirms it (2
users total, the owner and the throwaway; the throwaway owns its 247 movements and 6 sessions, the owner's 9
accounts are untouched).

**L17 — T5, declared deviation with a measured follow-up (agent, 2026-10-18).** Directive 3 (heavy transforms
resolved before the response) is only partly delivered, and on purpose: the measured criterion-3 gap is closed
(−31% bytes, L14) and the views keep working unchanged (L13, L16, L18), while the remaining optimisation is a new
read contract. `/movements` is still 69 KB of the 81 KB brief total (85%) because five dashboard and finance
sections fetch the whole ledger to aggregate it in the browser. A `GET /movements/summary?period=&group=`
returning final buckets/totals would cut that to a few KB and delete the duplicated client blocks in
`lib/finance/finance.ts`, `components/containers/DashboardHome.tsx` and `FinanceScreens.tsx`. Deferred because it
is a new contract plus rewiring of five sections and their tests, on top of an existing 29-file / ~1.5k-line
delta — the review-workload rule wins here. It is the first item for the next work unit.

**L18 — live e2e suite (agent, 2026-10-18).** `E2E_SMOKE_LIVE=1` against the same local stack serving
`frontend/out` over production data: **15 passed, 0 failed** (37.6 s), including the layout-evidence spec at
390/768/1440 and the finance shells (subscriptions with Pay, movements, chart, assets), the route guards and the
notifications spec. The tracked evidence files that spec rewrites were restored with `git checkout --`
immediately afterwards.

**L19 — visual evidence, desktop and mobile (agent, 2026-10-18).** `playwright-cli` (the agent CLI, chromium)
logged in through the real UI and captured all seven views at 1440×900 and 390×844 into `/tmp/pd-shots/after/`:
home, finance, hábitos, productividad, progreso, reportes and ajustes. All seven render with the seeded production
data on both viewports — KPIs, the expenses-vs-income chart with month buckets, the category pie with its legend,
the account cards (where the money fix is visible: the COP account stayed untouched by the USD payment), the habit
heatmap and monthly compliance block, the calendar and goals lists, the area scores and the net worth — and the
browser console carried **no JS errors**, only the app's own five font-preload warnings. One pre-existing mobile
observation, not caused by this delta (the delta touches no CSS and no component): at 390 px the "Gasto del ciclo"
KPI value is clipped by its card edge. Recorded for the visual backlog, not fixed here.

**L20 — browser-side network audit (agent, 2026-10-18).** Read from the page itself
(`performance.getEntriesByType("resource")`) after a real UI login, route by route: every list request the
browser makes carries the shape — `/accounts?shape=brief`, `/categories?shape=brief`, `/movements?shape=brief`
and `/movements?from=…&to=…&shape=brief`, `/subscriptions?shape=brief`, `/assets?shape=brief`, `/tasks?shape=brief`
and `/tasks?view=overdue&shape=brief`, `/events?shape=brief` plus its day-range variant, `/goals?shape=brief`,
`/notes/search?shape=brief` — while the three endpoints S12 deliberately left full (`/me`, `/habits/today`,
`/habits/logs?from&to`) are requested without it. The dashboard asks for a twelve-month movement range, which is
exactly the remaining unbounded read L17 defers. Measured transfer for the productivity view: 10 API requests,
5,892 bytes.

**L21 — Judgment Day round 1 (agent, 2026-10-18).** Target frozen at `5113bdde…` (30 files, +1504/−159), HEAD
`7147707`. Two blind judges, identical scope, criteria and resolved skill paths. **Judge A: `{"findings":[]}`** —
its evidence records verification of the five questions (brief projections against view reads, the currency
comparison under both locks, the valuation transaction/lock/commit order, the untouched full SQL and DTOs,
additivity for MCP callers, and no secret/PII/cross-user leak in the delta). **Judge B: 4 rows, none CRITICAL** —
1 WARNING and 3 SUGGESTIONs. Ledger: **B-1 WARNING** the target leaves one frontend unit test red (the ranged GET
now carries `&shape=brief` while `MovementForms.test.tsx:229` still asserted the old query string); **B-2
SUGGESTION** `ShapeQuery`'s `deny_unknown_fields` plus the one newly added to `ListCategoriesQuery` turned unknown
query parameters into 400 on six endpoints that answered 200 at HEAD; **B-3 SUGGESTION** the pay picker offers
accounts in the wrong currency, so the new rule lands as a guaranteed 422 instead of a blocked choice; **B-4
SUGGESTION** neither money fix has a behavioral regression test, because the static “SQL contains currency /
FOR UPDATE” assertions survive deleting the comparison. All four were verified empirically by the parent before
being touched (B-1: `vitest run components/finance/MovementForms.test.tsx` → 1 failed / 21 passed; B-2: live
probes → 400 on `/accounts`, `/categories`, `/goals`, `/habits`, `/subscriptions`, `/assets` with a stray
parameter). They are recorded as suspect rows and were fixed as the parent's own verified defects and coverage
gaps, never on a single judge's authority.

**L22 — fix round (agent, 2026-10-18).** Six edits, no contract change: (1) the frontend expectation now reads
`?from=2026-10-01&to=2026-10-31&shape=brief`; (2) `ShapeQuery` no longer denies unknown fields, so a stray
parameter is ignored exactly as at HEAD while `shape` itself stays strict (422); (3) `ListCategoriesQuery` lost
the `deny_unknown_fields` the worker had added, restoring HEAD behaviour on `/categories`; (4) the pay picker
offers only accounts whose currency matches the subscription and shows `finance.payNoAccountInCurrency` when none
does (new key; mirrors the transfer modal's client-side block); (5) a DB-backed behavioral test,
`pay_rejects_a_cross_currency_account_and_writes_nothing`, asserts the 422, that the balance and the ledger stay
untouched, and that the same-currency pay still succeeds — the mirror of the transfer cross-currency test that was
missing; (6) nothing else.

**L23 — fix-round verification (agent, 2026-10-18).** After the six edits: `cargo test --bin
personal-dashboard-backend` **444 passed, 0 failed** (23.36 s) against the production database with table counts
identical before and after; `vitest run` **52 files / 669 tests passed**; `tsc --noEmit` clean; `next build` clean;
the repository's live Playwright suite **15/15**; and the contract probes back to HEAD behaviour on unknown
parameters (`/accounts?foo=1` … `/assets?foo=1` → 200) while `?shape=bogus` still answers 422 and `?shape=brief`
200. Two parent mistakes were caught inside this round by running the checks instead of trusting the edits: the
first version of the new behavioral test omitted the NOT NULL `subscriptions.frequency` column, so it panicked at
its own fixture INSERT and — because the suite aborts there — left one seeded test user with two accounts in
production (detected by the before/after count comparison, deleted, counts re-verified at 2 users / 16 accounts);
and the first fix-delta extraction used the current diff instead of the frozen one, producing an empty delta until
the frozen patch was applied with `--exclude='openspec/*'` to a temporary index. The pay-modal currency filter was
also verified in the browser: opening Pay on the COP subscription offers four COP accounts and none of the USD
ones (`/tmp/pd-shots/after/pay-modal-1440.png`).

**L24 — final artifact (agent, 2026-10-18).** The complete work lives in the working tree, uncommitted (S3):
31 files, **+1578/−161**, frozen as `odd/tasks/arquitectura-hibrida-dashboard-delta-final.patch`, sha256
`2bdfcd834fe35e93208446acfad145ded5115333f75221c04e56340d89a4cc59`. Round-1 target
(`odd/tasks/arquitectura-hibrida-dashboard-delta.patch`): `5113bdde…`. Fix delta: `6b6d9326…`, 155 lines, six
files. Every existing full-shape SQL constant and DTO is untouched, so a caller that omits `shape` gets today's
response byte for byte.

**L25 — Judgment Day round 2, scoped re-judgment and terminal verdict (agent, 2026-10-18).** Both judges re-ran over
the frozen ledger plus the immutable fix delta (`/tmp/pd-fix-delta.patch`, `6b6d9326…`, 155 lines, six files) and
both returned `{"findings":[]}`. Judge A confirmed the four rows are addressed (unknown parameters accepted again
while `shape` stays strict, the ranged expectation matches the builder, the picker filters by currency with an
empty state, and the new test pins rejection, no mutation and success). Judge B went further: it verified the fix
delta is exactly what the working tree carries (`git apply --check --reverse`), re-probed all six endpoints live
(200 with a stray parameter, 422 with `shape=bogus`, 200 with `shape=brief`), checked HEAD parity for the three
endpoints that were already strict, and ran a mutant analysis showing that deleting the comparison fails the
test's first assertion while rejecting every pay fails its second — both directions pinned. The verdict:

```yaml
target_identity: 2bdfcd834fe35e93208446acfad145ded5115333f75221c04e56340d89a4cc59
round: 2
confirmed: []          # no CRITICAL finding, in either round
suspect: []            # no open row
contradictions: []     # the two judges never disagreed
info: [B-1 addressed, B-2 addressed, B-3 addressed, B-4 addressed]
fix_work_units: [B-1..B-4 — 6 edits across 6 files, verified]
scoped_rejudgment: approved
terminal_state: approved
skill_resolution: paths-injected (rust-best-practices, supabase-postgres-best-practices, next-best-practices, security-and-hardening)
```

No severity was confirmed by both judges at any point, so no round consumed the budgeted two; the delivery carries
no CRITICAL finding and the ledger is closed.

**L26 — the independent verifier found a third money-integrity path (agent, 2026-10-18).** The harness's risk
plan for the escalated item (money-path behavior change) required a separate independent verifier, and it earned
its keep: reviewing the whole artifact against S1-S12 it confirmed items 1-4 structurally (pay currency enforced
before any write on its only path, lock order deadlock-free, all ten full-shape SQL constants and DTOs byte-identical
to HEAD, no leak, MCP unaffected) and then reported a **HIGH, pre-existing defect the original audit never saw**:
`PATCH /movements` accepts `account_id` and re-points a stored movement — reversing the delta on the old account and
applying it on the new one — with **no currency comparison anywhere**, so moving a COP movement to a USD account
silently re-denominates both balances. That is the same defect class as the pay rule (S6a(1): every mutation
validates integrity server-side before touching the database), on a path neither the audit nor L12/L17 declared.
It also flagged an INFO coverage gap (`accounts.rs` had no brief-shape test) and a LOW borderline item left open for
the owner: `PATCH /assets` allows changing an asset's currency over valuation history, re-labelling
`current_value` across net-worth buckets (a design question, not fixed here).

**Fixed (fix round 2, same authorized scope):** `backend/src/routes/movements.rs` — a new `ACCOUNT_CURRENCY_SQL`
read inside the PATCH transaction compares the movement's current account currency with the destination's when the
account actually changes (the shared `LOCK_ACCOUNT_SQL` keeps its seven call sites untouched, and the currency read
needs no extra lock because `PATCH /accounts` never accepts `currency`), answering 422
`"la cuenta debe usar la misma moneda que la del movimiento"`; the SQL-discipline assertion now pins that read; a
DB-backed behavioral test (`patch_repoint_to_another_currency_is_422_and_moves_nothing`) pins both directions
(cross-currency rejected with both balances and the row untouched; same-currency re-point succeeds with the
reversal credited to the origin and the new debit on the target). `backend/src/routes/accounts.rs` gained the
missing brief-SELECT and full-default test. `frontend/components/containers/FinanceScreens.tsx` mirrors the rule in
the edit modal's account options — a stored movement's amount lives in the currency of the account holding it, so
the form no longer offers a choice that can only fail (the same client-side mirror the pay picker got).

**L27 — the final re-judgment found a regression in my own fix (agent, 2026-10-18).** Both judges re-judged the
fix-2 delta (`e7c03555…`). Judge A returned `{"findings":[]}`. Judge B returned one WARNING and one SUGGESTION,
both deterministic and both *introduced by that delta*: the currency filter had been placed on the **shared**
`movementAccountOptions` memo, which also feeds the movement-history account filter, `assetNameById` (asset account
labels) and `AssetEditForm` — so with the edit modal open on a COP movement every USD account vanished from those
consumers and their labels fell back to raw ids (it reverts when the modal closes). Its SUGGESTION: when the
movement's account is archived it is absent from the brief list, so the currency is unknown, the filter fails open
and the picker can still offer an account the server will reject. The Judgment Day round budget was exhausted at
this point (two fix rounds and two scoped re-judgments).

**L28 — post-budget correction and its verification (agent, 2026-10-18).** The WARNING is a regression the delivery
must not ship, so it was corrected as the parent's own verified defect instead of as a third judging round: the
shared memo is unfiltered again (`movementAccountOptions`, read by the history filter, the asset labels and the
asset form) and a new `movementModalAccountOptions` applies the same-currency filter **only** to the modal's prop,
with the archived-account fail-open written down in the code. Verified live with a fresh throwaway user (deleted
afterwards): `tsc --noEmit` clean, `next build` clean, `vitest run` 52 files / 669 tests green, and the exact
interaction that used to break replayed in the browser — with the edit modal open on a USD movement the page shows
the account names, **zero raw UUIDs**, and both accounts still in the select options
(`/tmp/pd-shots/after/edit-modal-1440.png`). The live e2e suite needed the spec's documented data precondition: a
run whose fixture had no subscription failed precisely the `Cancelar|Reactivar` / `Pagar` assertions, and the same
delta with one account, one subscription and one movement re-seeded runs the suite green. The SUGGESTION stays open
for the owner: an archived-account movement's currency is unknown to the client, so the picker keeps every account
and the server's 422 stays the only enforcement.

**L29 — terminal verdict (agent, 2026-10-18).** The delivered artifact is the working tree, uncommitted per S3: 32
files, **+1726/−162**, frozen as `odd/tasks/arquitectura-hibrida-dashboard-delta-final.patch` with sha256
`6b797543ed9540c7eaaac2da944572e5da714af49260fe7962010a3a6c31fafd`, and that identity is exactly the tree
(`git diff` hashes equal).

```yaml
target_identity: 6b797543ed9540c7eaaac2da944572e5da714af49260fe7962010a3a6c31fafd   # delivered state
round: 2                          # of the two allowed
judged_identities:
  round_1: 5113bdde…              # A: findings:[] ; B: 1 WARNING + 3 SUGGESTIONs
  fix_1: 6b6d9326…                # re-judged: A clean, B clean
  fix_2: e7c03555…                # re-judged: A clean, B: 1 WARNING + 1 SUGGESTION, both introduced
  fix_3: 4c90a205…                # post-budget correction of the WARNING; NOT re-judged (budget spent)
confirmed: []                     # no CRITICAL finding was ever confirmed by both judges
suspect: []
contradictions: []                # the two judges never disagreed
info:
  - round-1 B-1..B-4: addressed, confirmed clean in re-judgment 1
  - verifier HIGH (PATCH re-point money path): fixed in fix_2, confirmed clean by Judge A in re-judgment 2
  - verifier INFO (accounts brief test): fixed in fix_2
  - Judge-B WARNING (shared-memo regression, introduced by fix_2): corrected in fix_3 and verified live —
    tsc, next build, 669 vitest, 15/15 live e2e, and the exact modal-open interaction replayed in the browser
    (account names present, zero raw UUIDs, both accounts still offered)
  - OPEN (Judge-B SUGGESTION): when the edited movement's account is archived the client cannot know its currency,
    so the picker keeps every account and the server's 422 stays the only enforcement
  - OPEN (verifier LOW): `PATCH /assets` can change an asset's currency over its valuation history, re-labelling
    `current_value` across net-worth buckets — a design question for the owner
fix_work_units: [fix_1 (6 files), fix_2 (3 files), fix_3 (1 file, post-budget)]
scoped_rejudgment: fix_1 approved, fix_2 approved-with-row (its WARNING corrected afterwards)
terminal_state: escalated
escalation_reason: the delivered state includes a correction applied after the two-round budget was spent — verified
  by the parent's own means (checks plus the replayed browser interaction) but not re-judged — and two open
  non-severe rows above are the owner's call
skill_resolution: paths-injected (rust-best-practices, supabase-postgres-best-practices, next-best-practices, security-and-hardening)
```
