# Judgment Day — accounts, transfers, login and calendar (2026-10-04)

- change: `2026-10-04-accounts-transfers-login-calendar`
- target: the frozen working tree at `main` HEAD `cf50ddc` — 51 modified files + 27 new files; 4689 insertions / 1218 deletions (the reviewable delta exported to `odd/tasks/accounts-transfers-login-calendar-delta.patch`, 12890 lines)
- method: two blind adversarial judges, independent, one exhaustive sweep each; neither judge read the other's notes first; zero refuters
- scope: the five workstreams — W1 account type/card removal, W2 transfers as one ledger row, W3 login/session hardening, W4 productivity calendar, W5 movement row copy

## Result

Both final verdicts were:

**`JUDGMENT: APPROVED`** — no BLOCKER and no CRITICAL row ever existed.

Requirement verdicts:

| # | Requirement | Verdict |
| --- | --- | --- |
| 1 | W1 — account type and the credit-card layer leave the product | satisfied |
| 2 | W2 — transfers recorded as one ledger row with the two-leg atomic effect | satisfied |
| 3 | W3 — login/session findings A1–A5 and A7 fixed | satisfied |
| 4 | W4 — productivity calendar | **partially satisfied** — calendar boundary bug (JD-A-006 / JD-B-001) |
| 5 | W5 — payment-method label and transfer distinction | satisfied |

### Correction dispatch — recorded honestly

The native correction path accepts only BLOCKER/CRITICAL rows; there were none, so **no severity was inflated to force a batch**. The fixes below were applied under the owner's explicit authorization through the ordinary bounded-writer route, and the closing live re-verification was run after them.

## Judge A ledger

| ID | Severity | Finding (evidence) | Disposition |
| --- | --- | --- | --- |
| JD-A-001 | MAJOR | The login rate-limiter map can grow without bound under saturation (`backend/src/auth/rate_limit.rs`). | Fixed — fix 1 |
| JD-A-002 | MAJOR | Logout was fire-and-forget, leaving the session valid server-side after signing out (`frontend/components/layout/AppShell.tsx`, `frontend/lib/api/client.ts`). | Fixed — fix 7; residual: `AppShell` does not surface a failed revoke |
| JD-A-003 | MAJOR | An unparseable stored hash returned before Argon2, reintroducing a timing distinction between account states (`backend/src/auth/password.rs`). | Fixed — fix 2 |
| JD-A-004 | MAJOR | Lock-order inversion between PATCH and DELETE of a movement → deadlock / 500 (`backend/src/routes/movements.rs`). | Fixed — fix 3 |
| JD-A-005 | MAJOR | The account filter hid transfers from the destination's history (`frontend/components/finance/MovementHistory.tsx`). | Fixed — fix 5 (duplicate JD-B-002) |
| JD-A-006 | MAJOR | Calendar query bounds were fixed UTC midnights while bucketing is local → boundary events dropped (`frontend/components/productivity/ProductivityCalendar.tsx`). | Fixed — fix 6 (duplicate JD-B-001) |
| JD-A-007 | WARNING | The MCP `create_account` schema was non-strict and silently stripped the removed fields (`mcp-dashboard/src/tools.ts`). | Fixed — fix 4 |
| JD-A-008 | WARNING | The artifact said the history renders 50 movements with no pagination while the component paginates (the delta text's 50/no-pagination wording vs `INITIAL_VISIBLE = 5` + «Ver más»). | Recorded — artifact wording vs implementation; no code change |

## Judge B ledger

| ID | Severity | Finding (evidence) | Disposition |
| --- | --- | --- | --- |
| JD-B-001 | MAJOR | Same calendar boundary bug as JD-A-006. | **Duplicate of JD-A-006** — fixed (fix 6) |
| JD-B-002 | WARNING | Same account-filter bug as JD-A-005. | **Duplicate of JD-A-005** — fixed (fix 5) |
| JD-B-003 | WARNING | The per-IP limiter collapses to one global bucket behind a proxy when `TRUSTED_PROXIES` is unset — pre-existing, deployment-conditional. | Left as an owner action (see Open items) |
| JD-B-004 | WARNING | «Editar saldo» left the displayed balance stale (`frontend/components/containers/FinanceScreens.tsx`). | Fixed — fix 8 |
| JD-B-005 | SUGGESTION | An archived transfer destination rendered a raw UUID. | Fixed — fix 9 |
| JD-B-006 | SUGGESTION | `aria-modal="true"` without focus containment. | Fixed — fix 10 |
| JD-B-007 | SUGGESTION | The destination selector did not react to an origin change. | Fixed — fix 11 |

Ledger counts: 15 rows total, 13 unique (Judge A 8 + Judge B 7, minus the two agreed duplicates JD-B-001 = JD-A-006 and JD-B-002 = JD-A-005); unique severities: 6 MAJOR, 4 WARNING, 3 SUGGESTION; BLOCKER 0, CRITICAL 0.

## Fixes applied (owner-authorized)

| # | Finding(s) | Change | Evidence |
| --- | --- | --- | --- |
| 1 | JD-A-001 | The rate limiter now evicts under saturation down to a hard cap (`MAX_KEYS = 4096`) while a blocked key stays put. | RED: the IP map grew to 5 keys with cap 4; GREEN after. |
| 2 | JD-A-003 | An unparseable stored hash now pays exactly one dummy Argon2 verification against the fixed PHC hash. | RED: 0 verifications on that path; GREEN after. |
| 3 | JD-A-004 | DELETE now locks the touched accounts in ascending UUID order before the movement row, matching PATCH and transfer create. | RED: a real `40P01` abort surfaced as a 500; GREEN after. |
| 4 | JD-A-007 | The MCP `create_account` schema is strict (`z.strictObject`). | RED: probe reached the network layer; GREEN: probe returns a ZodError. |
| 5 | JD-A-005 / JD-B-002 | The account filter matches origin **or** destination. | RED: destination filter showed an empty state; GREEN after. |
| 6 | JD-A-006 / JD-B-001 | The calendar fetch carries a one-day margin on both edges for local-day bucketing. | RED: last-local-day event missing; GREEN after. |
| 7 | JD-A-002 | Logout awaits a bounded revoke (AbortController + timeout) and reports `{ revoked }`. | RED: no result; GREEN after. |
| 8 | JD-B-004 | Balance edits revalidate the `dashboard/accounts` key (and the `finance/` scope); the row no longer shows a stale amount. | Test `revalidates dashboard/accounts after an inline balance edit` (`frontend/components/finance/finance.test.tsx:221`). |
| 9 | JD-B-005 | An unresolvable destination renders «Cuenta no disponible» from the typed key `finance.movementTransferUnknownDestination` instead of a raw id. | `frontend/lib/i18n/es.ts:208`; `MovementHistory.test.tsx:352`. |
| 10 | JD-B-006 | Both movement dialogs contain Tab/Shift+Tab focus (`trapTabKey`). | `MovementForms.tsx:34-66`; tests at `MovementForms.test.tsx:220,439`. |
| 11 | JD-B-007 | The destination selection clears live when it becomes the origin. | Tests `clears the destination when the origin switches…` / `clears a destination that becomes the origin…` (`MovementForms.test.tsx:377,390`). |

## Surviving residuals

- `AppShell` does not yet surface a failed logout revocation (the returned `revoked: false` is ignored there; the Settings sessions page is the mitigation).
- Chart-number verification gap: the rendered chart numbers were not visually verified (transfers are proven excluded at code, SQL and list level).
- JD-B-003 (owner/deployment action): with `TRUSTED_PROXIES` unset every client shares the proxy socket IP, so a 10-failure burst locks the owner out for 15 minutes.
- JD-A-008 (recorded): the artifact's 50/no-pagination wording does not describe the shipped presentation pagination.

## Closing live re-verification (after the fixes)

- Account filter — PASS on origin/destination and absent for an unrelated account.
- Boundary events — PASS on the first (28 Sept) and last (8 Nov) visible cells, including the true margin regression case.
- Row copy — PASS: «Cuenta no disponible» renders only for the archived destination and no raw UUID appears anywhere.
- Logout — PASS: the logged-out token is 401 and the other session keeps working.
- Zero console and page errors.

Final suites after the fixes: backend `cargo test --locked --no-fail-fast` with `DATABASE_URL` → 450 passed / 0 failed; frontend `pnpm test` → 568 passed (50 files); `pnpm exec tsc --noEmit` → exit 0; `pnpm run build` → 14 static routes; `mcp-dashboard` typecheck + build → exit 0; nothing staged and `HEAD` unchanged at `cf50ddc` on `main`.

## Verdict

**`JUDGMENT: APPROVED`** — both judges approved with no BLOCKER/CRITICAL row; the calendar boundary defect was the single partially-satisfied requirement and it was fixed and re-verified; the remaining WARNING/SUGGESTION rows are recorded above (one owner deployment action, one artifact-wording observation and the two known residuals).
