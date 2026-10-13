# ODD feature: cierre-pendientes-dashboard

Closes the three items `solidificacion-dashboard` left open (measured, never applied) and rotates the
production DB credential. Owner session 2026-10-13. Specs S1-S7, tasks T1-T7, log L1-.

## Specs

**S1 — authorization (owner, verbatim, L1).** "si arranca con odd para terminar lo pendienete, y comitea
todo main dale amigo". Every pending item below is authorized to implement; delivery is one Conventional
Commit per work unit, pushed to `main`.

**S2 — session lifetime (owner, verbatim, L1).** "y otra cosa quiero que la sesion dure activa 24 horas
unicamente por favor si ya es asi has caso imiso a esta orden dale". **Resolved with no change**: production
already runs `SESSION_TTL_HOURS=24` (Dokploy app `fhhbVxFYT1qyQEeh90sOo`, env line 3; `backend/src/config.rs:127`
requires it, `docker-compose.yml:13` carries 24, every local recipe uses 24). The owner's own condition
("si ya es así") is met, so no code, env or doc is touched for this item.

**S3 — `GET /movements` gains an additive range (owner decision, L2, option "Backend + paneles por período").**
The endpoint accepts optional `from`/`to` (`YYYY-MM-DD`, inclusive on both edges over `occurred_on`, the same
semantics `GET /habits/logs` and the client's `w.from <= occurred_on <= w.to` already use). With neither
parameter the response is byte-identical to today's: same 11 columns in the same order, same
`ORDER BY occurred_on DESC, created_at DESC, id DESC`, same rows. Unknown query fields and malformed dates are
rejected — never silently ignored — with the repo's existing strict-read contract (422 `VALIDATION_ERROR`,
mirroring `EventRangeQuery` in `backend/src/routes/events.rs` and `parse_logs_range` in `habits.rs`).

**S3a — narrowing vs. the option's preview, declared (L3).** `limit` is **not** implemented. No consumer in
this delivery needs it and this repo's own discipline rejects capability nobody uses (`optimizePackageImports`
was measured and reverted for exactly that reason — L11 of `solidificacion-dashboard.md`). The documented
trigger for the pagination primitive ("cuando haya paginación") has not fired. Re-adding it later is additive.

**S4 — the four period-window consumers pass their own window (owner decision, L2, same option).** The
approved criterion is "los paneles que YA filtran por período piden su rango". Applied exactly:

| Consumer | Window it already renders | Passes |
|---|---|---|
| `components/dashboard/ExpensePieSection.tsx` | `currentPeriodRange(period)` | that range |
| `components/dashboard/TotalTrendSection.tsx` | `trendBuckets(period)` — 14 d / 8 w / 12 m / 5 y | `trendRange(period)` |
| `components/finance/CategoryCharts.tsx` | `trendBuckets(period)` (same shape, category-scoped) | `trendRange(period)` |
| `app/dashboard/finance/compare/page.tsx` | `trendBuckets(period)` × 2 categories | `trendRange(period)` |

Unchanged (they do not render one bounded window): `components/dashboard/widgets/MovementsSnapshot.tsx`
(its counter declares the real record count, JD item 3), `components/containers/FinanceScreens.tsx` (ledger)
and `components/finance/MovementHistory.tsx` (client-side filters + `visibleCount` paging). They keep calling
`useMovements()` with the existing `"finance/movements"` key.

**S5 — `api_tokens.last_used_at` is no longer written on every request (pending item (b)).** The touch in
`backend/src/auth/middleware.rs:30-31` becomes conditional: at most one write per token per 5 minutes. The
column's meaning becomes "last use, 5-minute granularity"; the **first** use still stamps, and a stale stamp is
refreshed. Nothing reads `last_used_at` for a security decision — it is display-only in the tokens UI
(`LIST_TOKENS_SQL`) — so the throttle removes the only avoidable write on the authenticated hot path without
changing an authorization outcome.

**S6 — production credential rotation (owner decision, L2, option "Rotar ahora y limpiar los .md").** The
production password is rotated, the app's `DATABASE_URL` is updated, and the literal is replaced by
`<DB_PASSWORD>` in tracked `.md` files. **Frozen review patches (`odd/tasks/*-delta.patch`) are NOT rewritten**:
they are review evidence whose sha256 was recorded at judgment time, and the value they carry is dead once the
password rotates (L4). The new secret never enters the repository, a commit, a log or a response.

**S7 — delivery.** Each task closes with its checks observed and one Conventional Commit on `main`; `main`
local equals `origin/main`; the working tree ends clean. Deploy stays the owner's action (`autoDeploy: false`).

## Tasks

| ID | Spec | Route | Task | Commit |
|----|------|-------|------|--------|
| T1 | S3, S3a | delegated writer (`gentle-ai-worker`) | `from`/`to` on `GET /movements`: `MovementRangeQuery` (`deny_unknown_fields`, both `Option<String>`), `parse_movement_range` (422 on malformed), a ranged `const` SQL statement that keeps the shared 11-column projection and the full API order, handler match on "no params → `LIST_MOVEMENTS_SQL` unchanged". Tests: ranged rows inclusive on both edges, unknown field 422, malformed date 422, no-params path unchanged. | `feat(movements)` |
| T2 | S4 | delegated writer (`gentle-ai-worker`) | `trendRange(period, now?, buckets?)` in `frontend/lib/finance/finance.ts` (first bucket `from` … last bucket `to`), `movementsRangeKey` + `useMovementsRange(range)` in `frontend/lib/api/finance.ts` (string key `finance/movements:<from>:<to>`, `encodeURIComponent`, `financeConfig`), and the four S4 consumers switched to it. The two that render a retry button (`ExpensePieSection`, `TotalTrendSection`) revalidate by prefix (`mutate((key) => typeof key === "string" && key.startsWith("finance/movements"))`, the repo's existing idiom); `CategoryCharts` and the compare page render no retry UI at all. Tests: `trendRange` for the 4 periods, key builder, the four panels request their window, and the three unfiltered consumers still call `useMovements()`. | `perf(frontend)` |
| T3 | S5 | parent inline | Conditional touch in `backend/src/auth/middleware.rs` + its tests. | `perf(backend)` |
| T4 | S3, S4, S5 | parent inline | Gates on the working tree: `tsc --noEmit`, `pnpm test`, `pnpm build`, `cargo test --locked` (never with `DATABASE_URL`, L5), live smoke against a throwaway user, and a browser check of the four panels. | — |
| T5 | S3, S4, S5 | independent verifier (`gentle-ai-verify`) | Risk item 2 (auth/tokens) fires the Verification rule: independent read-only verification of the diff after T4. | — |
| T6 | S6 | parent inline | `ALTER USER pdbuser WITH PASSWORD …`, new `DATABASE_URL` in the Dokploy app env, scrub tracked `.md`. Ordered so the owner's redeploy is the only remaining step (L6). | `docs(security)` |
| T7 | S7 | parent inline | Work-unit commits + push to `main`; record commit ids here. | — |

## Log

**L1 — owner request, verbatim (2026-10-13).** "si arranca con odd para terminar lo pendienete, y comitea todo
main dale amigo, y otra cosa quiero que la sesion dure activa 24 horas unicamente por favor si ya es asi has
caso imiso a esta orden dale".

**L2 — the two decisions, from the parent's questionnaire (2026-10-13).** Pending (a): option **"Backend +
paneles por período"** — preview shown to the owner: `GET /movements?from=2026-10-01&to=2026-10-31&limit=500`,
"Sin parámetros = comportamiento actual, byte a byte", "Tocan rango: ExpensePieSection, TotalTrendSection … El
resto sigue pidiendo todo", declared counterpoint "el toggle de período pasa de filtrado instantáneo a un fetch
por clic". Pending (c): option **"Rotar ahora y limpiar los .md"** — preview: ALTER USER, new `DATABASE_URL`,
scrub, commit+push, with the warning that the app is disconnected between the rotation and the owner's redeploy.
Pending (b) was not a question: it was authorized by S1 as documented.

**L3 — narrowing declared to the owner, not silent.** The preview named `limit=500`; S3a drops it. Reason:
zero consumers in this delivery and the repo already rejected unused capability once by measurement. The owner
is told in the closing report, and re-adding it is additive.

**L4 — frozen evidence is not rewritten.** `git grep` finds the production literal in tracked `.md` **and** in
`odd/tasks/accounts-transfers-login-calendar-delta.patch` and
`odd/tasks/finance-panel-consolidation-delta.patch`, both recorded as judgment targets with a sha256. Scrubbing
them would invalidate recorded evidence to remove a value that the rotation has already killed, so they are left
byte-identical and the residual is declared instead.

**L5 — never `cargo test` with `DATABASE_URL` (inherited trap).** `backend/tests/migration_0011_removal.rs` and
`migration_0013_gate.rs` run destructive DDL (DROP TABLE). The full suite runs with `env -u DATABASE_URL`; the
DB-gated cases run with an explicit name filter against a throwaway `@example.com` user that cascades away.

**L6 — rotation order (downtime minimised).** 1. scrub tracked `.md` and commit (no runtime effect);
2. write the new `DATABASE_URL` into the Dokploy app env (no effect until deploy); 3. `ALTER USER … PASSWORD`
(the running app loses its connection here — this is the only unavoidable window); 4. hand the owner the
one-step redeploy. The rotation is therefore the LAST mutating step of the session, after every test that needs
the current password.

**L7 — T1 delivered and reviewed by the parent.** `backend/src/routes/movements.rs` only (+284):
`MovementRangeQuery` (`deny_unknown_fields`), `parse_movement_range` (both-or-neither, `from > to` → 422,
strict `YYYY-MM-DD` through the shared `validate_occurred_on`), `LIST_MOVEMENTS_RANGE_SQL` with the same
11-column projection and the full API order, and a handler that still serves the untouched `LIST_MOVEMENTS_SQL`
when neither bound is present. Reviewed: the SQL-invariant test now asserts `LIST_MOVEMENTS_SQL` **literally**
(byte-identical), which is the strongest available form of "the previous behavior still holds"; `main.rs` is
untouched because the handler stays a valid axum `Handler`. One wart accepted with a trigger: to get 422
instead of axum's 400 for unknown query fields the writer reused `habits::ValidatedQuery`, so a route module now
imports a generic HTTP extractor from a sibling route module. **Trigger to hoist it**: when a third route needs
422 on query parameters, move `ValidatedQuery` to `routes/mod.rs` and have `habits` and `movements` import it
from there. Hoisting today would rewrite imports in a 2.5k-line shared module outside the approved scope.

**L8 — the writer's "flake" was my RED.** T1's report mentions one full-suite failure in
`auth::middleware::tests::api_token_touch_is_throttled_by_a_staleness_window` that passed on rerun and calls it a
parallel-timing flake. It was not a flake: that test was failing **on purpose** at that moment — T3's RED, observed
before the statement gained its window predicate. T3 GREEN afterwards: `cargo test --bin personal-dashboard-backend
api_token_touch` → 3 passed (throttle-inside-window, stale-refresh, and the pre-existing
`tokens_api_token_authenticates_and_touches_last_used`), `auth::middleware` module → 8 passed.

**L9 — T4 gates, including one defect I introduced and fixed myself.** `cargo test --locked` with
`env -u DATABASE_URL` → **433 unit + 43 integration, 0 failed**; `tsc --noEmit` → exit 0; `vitest run` →
**52 files / 665 tests, 0 failed**; `pnpm build` → 14/14 routes. One honest entry for the record: my first fix of
the two `DashboardHome` suites (T2's blast radius) referenced the shared fixture helper as a *value* inside the
`vi.mock` factory, which is hoisted — so the factory hit the TDZ (`Cannot access 'movementsResult' before
initialization`) and `DashboardHome.test.tsx` failed to load at all (51/52 files, 638 tests, one suite dead). The
first full-suite run caught it; the fix defers the call inside each hook (`() => movementsResult()`), and the
re-run is the 52/665 above. A green-looking focused run would not have caught it — the full suite did.

**L10 — browser proof of S4 (not a unit test).** With the export served by the local backend and a throwaway
user, `playwright-cli` read `performance.getEntriesByType("resource")` on three real pages:
`/dashboard/` → `?from=2025-11-01&to=2026-10-31` (trend, 12 monthly buckets), the **unfiltered** `/api/movements`
(«Últimos movimientos», whose counter must stay the real record count) and `?from=2026-10-01&to=2026-10-31`
(the pie's current period); `/dashboard/finance/` → unfiltered (ledger) + `?from=2025-11-01&to=2026-10-31`
(`CategoryCharts`); `/dashboard/finance/compare/` → only `?from=2025-11-01&to=2026-10-31`. That is S4 exactly, in a
browser, on the served export — not inferred from a mock.

**L11 — the live smoke, diagnosed with a controlled experiment instead of a shrug.** The smoke is not green, and the
record says which part of that is this change and which part is not.

*Run 1 — empty throwaway user:* **13/15**. Failures: `sections.spec.ts:25` and `:51`, both needing
`getByRole("button", { name: /Editar saldo/ })` / `/Cancelar|Reactivar/` — buttons that only render on the signed-in
user's own rows. `notifications.spec.ts` **passed**.

*Run 2 — the same code with the documented precondition* (`odd/tasks/prod-seed-solidificacion.sql`: 2 accounts,
7 movements, 2 subscriptions): **14/15**. The two `sections` failures are gone — the data precondition is reproduced,
not assumed — and `notifications.spec.ts:31` now fails. That spec was already diagnosed the same way in
`odd/tasks/playwright-toolchain.md:90-97`.

*The remaining failure, isolated:* `locator.click` times out at `notifications.spec.ts:49`, waiting for
`getByRole('region', { name: 'Próximos pagos' }).getByRole('switch', { name: /upcoming-payments/ })`. The ARIA
snapshot Playwright saved at the timeout (`frontend/test-results/…/error-context.md`) shows **no `Próximos pagos`
region at all**: in «Personalizar» the block reads `Mostrar bloque: upcoming-payments` — hidden. So the widget the
locator needs is unmounted, and the spec's own recovery branch had just enabled it (its `expect(widget).toBeVisible()`
at line 47 passed, or the failure would point there).

*The locator is not the problem:* enabling the block directly in the live DOM makes the region appear with exactly
`switch "Ocultar bloque: upcoming-payments" [checked]` inside it — one match, precisely what line 49 asks for.

*Controlled experiment:* same code, same user, same server, **the only variable changed is the starting layout state**
— the isolated spec then passes **2/2 in 8.4s**, including the test that had burned a 30s timeout.

*Conclusion, with the evidence above:* the failing path is the widget-layout toggle (optimistic update → persisted
preference → refetch) putting the widget back to hidden between the spec's recovery assertion and its click. This
diff does not touch that path, the layout, or the widget; the same code passes the spec with another user; and the
suite's own comment documents that its layout state is shared and persisted server-side across specs. **Pre-existing
spec defect, reported and not fixed here** — fixing a neighbouring spec is outside this change's approved scope, and
the owner decides. Also restored, per the documented convention: the 4 tracked evidence files under
`openspec/changes/2026-09-23-simplify-finance-productivity/evidence/` that the layout spec rewrites on every run.

**L12 — the independent verifier found a real defect, and it was mine.** `gentle-ai-verify` (read-only, `mv6w9xu7-3-70a2`)
returned per-claim verdicts against S3/S3a/S4/S5 plus five findings. Dispositions:

- **F1 (Medium) — fixed here, test-first.** The write paths still revalidated only the exact key `"finance/movements"`,
  which after T2 no longer reaches `finance/movements:<from>:<to>`: `MovementForms.tsx:142` and `:458` (both modals),
  `MovementHistory.tsx:110` (delete) and `SubscriptionForms.tsx:57` (pay mints a movement). Effect: after any movement
  write the four period panels kept showing stale numbers until a period toggle or a navigation. That is a genuine
  regression of T2 — before this change every consumer shared one key, so a single mutate refreshed everything. Fixed
  test-first: four RED tests (one per write path, each mounting a ranged probe and counting the ranged GETs) →
  **4 failed | 49 passed**; then the prefix predicate at the four call sites → GREEN. The verifier's claim that the
  existing `MovementForms` tests “enshrine” the stale behavior was **wrong**: those files contain zero occurrences of
  `mutate` (they use a real `SWRConfig` provider), so nothing pinned the defect and the four tests above are new.
- **F2 (Low) — accepted.** `CategoryCharts` and the compare page render no retry UI at all; the two retries that exist
  for unfiltered reads stay exact-key on purpose, because their own panels read the unfiltered key.
- **F3 (evidence strength) — closed by other evidence.** The DB-gated tests do not execute inside the green
  `env -u DATABASE_URL` run, by design (running `cargo test` with `DATABASE_URL` executes destructive DDL). They were run
  separately with exact-name filters: the T1 writer ran `range_returns_rows_inclusive_on_both_edges` and
  `list_returns_caller_movements_in_api_order` (1 passed each, throwaway user deleted) and T3's own GREEN ran
  `api_token_touch` (3 passed), so the throttle's first-use, inside-window and stale-refresh behaviors are executed
  evidence rather than code reading.
- **F4 (Low) — closed.** The four `openspec/…/evidence/` files it flagged are the known side effect of the
  layout-evidence spec (`odd/tasks/playwright-toolchain.md:90-97`); restored after every run, including this one.
- **F5 (Info).** The frozen review patch keeps one occurrence of the credential that the rotation kills, declared in L4.

The verifier also confirmed, from source, the four claims it could check: the unfiltered statement is byte-identical, the
ranged statement keeps the projection, the API order and the `user_id` scope with no `limit`, the rejection contract
holds for unknown fields, malformed, half-specified and inverted windows, and **no authorization decision reads
`last_used_at`** — so the throttle cannot turn a valid token into a 401.
