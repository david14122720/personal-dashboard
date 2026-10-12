# Judgment Ledger — money path & auth (2026-10-03)

Target identity: git commit `20b2806` at `/home/david/Nextcloud2/Ubuntu/landing_personal`
Scope: backend routes/{movements,subscriptions,accounts}.rs, finance/{money,dates,validation}.rs,
auth/{helper,middleware}.rs; frontend lib/api/client.ts, lib/finance/finance.ts,
components/finance/MovementForms.tsx
Judges: `jd-judge-a` (murqx80l-3-70aw), `jd-judge-b` (murqx80l-4-3cgi) — blind, read-only, identical scope.
Skills resolved: project `.agents/skills/{rust-best-practices,supabase-postgres-best-practices,next-best-practices,vercel-react-best-practices}/SKILL.md`

## Round 1 — merged findings

### confirmed (both judges, same claim)
| ID | Location | Severity (A/B) | Claim | Disposition |
|---|---|---|---|---|
| J-1 | frontend/components/finance/MovementForms.tsx:109-112 | WARNING / WARNING | `serverMessage()` surfaces ANY ApiError message, so 404 "Not found", 500 "Internal server error", 401 "Session expired…" and non-JSON "Request failed with status N" render English text in a Spanish-only UI and make the Spanish i18n fallback unreachable | introduced (20b2806) |
| J-2 | backend/src/finance/money.rs:73 (+ movements.rs:52) | WARNING / WARNING | Movement cap 1e9 vs manual balance cap 1e6: a recorded 3.500.000 salary leaves `accounts.balance = 3500000` that `PATCH /accounts/{id}` rejects with 422 — the app creates a state its own editor cannot correct | A: introduced / B: pre-existing (split pre-existed; 20b2806 made the >1e6 state reachable with one documented row) |
| J-3 | backend/src/routes/movements.rs:191-192 | SUGGESTION / SUGGESTION | `validate_movement_amount` rustdoc still documents the cap as `10^6` while the constant and message are `10^9` | introduced (20b2806) |
| J-4 | backend/src/routes/subscriptions.rs:61,530 | WARNING / SUGGESTION | Subscription `validate_price` caps at 1e16 while the identical row via `POST /movements` is rejected at 1e9; a pay can insert a ledger row the movement API refuses, and editing that movement re-sends the stored amount → permanent 422 | pre-existing (S-B) |

### suspect (one judge; parent-verified deterministically, not both-judge corroborated)
| ID | Location | Severity | Claim | Disposition |
|---|---|---|---|---|
| J-5 | frontend/lib/finance/finance.ts:147-152 | SUGGESTION (B) | Docstring claims COP thousand dots are stripped; code only removes commas, so `"3.500.000"` is rejected client-side as "not a positive amount" | pre-existing |

### parent live evidence (independent of judges)
- `POST /api/movements` amount `3500000.00` → **201** (20b2806 cap fix works end-to-end).
- `PATCH /api/accounts/{id}` `{"balance":"3500000.00"}` → **422** on the account the movement itself set to `3500000.00` → corroborates J-2 with runtime proof.
- Subscription due 2026-01-31 paid → `next_billing_on` advances to **2026-10-31** (clamp, no February drift); second pay same cycle → **409** Spanish. Pay flow healthy.
- Local backend ran against scratch DB `pdb_probe_scratch`; prod `pdbname` never used as a test target.

## Round 1 counts
confirmed: 4 (J-1..J-4) · suspect: 1 (J-5) · contradictions: 0 claims (J-4 severity split A=WARNING/B=SUGGESTION, recorded at the higher) · CRITICAL: 0

## Probe round (gentle-ai-worker, task murqwyr9-2-nncg) — merged into the ledger
Baseline at 20b2806: backend 364 passed / 1 failed (`routes::notes::tests::search_query_avoids_sequential_scans`,
known parallel flake per prior sessions); frontend 42 files / 372 tests passed.

| ID | Location | Severity | Claim | Evidence |
|---|---|---|---|---|
| P-1 | frontend/lib/finance/finance.ts:144-153 | **CRITICAL** | Comma decimal is stripped as a thousands separator: `"25000,50"` → `"2500050"` and `"0,01"` → `"001"`, POSTed silently — 100× money corruption with no error shown. Reproduced at component level (FM1/FM2) and unit level (F2/F3) | deterministic (probe suite + code read) |
| P-2 | frontend/lib/finance/finance.ts:147-152 | SUGGESTION (= J-5) | Thousand-dot COP input rejected (`"3.500.000"`, `"25.000"`, `"1.234,56"` → null) while the docstring promises support | deterministic |
| P-3 | backend/src/routes/movements.rs:55,210-215 | WARNING | `validate_description` counts UTF-8 bytes but the 422 says "maximo 2000 caracteres": 1001 accented chars (2002 bytes) wrongly rejected | deterministic |
| P-4 | backend/src/routes/subscriptions.rs:59-65,530-540 | WARNING (= J-4) | Pay inserts the subscription price straight into `movements` with no `MAX_MONEY_AMOUNT` check (price cap 1e16) | deterministic (validator + static read) |
| P-5 | backend/src/finance/money.rs:23 | SUGGESTION | `Decimal::from_str` accepts `1e5`, `+25000`, `25000.` and `25_000` — numerically correct, but the accepted wire contract is laxer than the documented "decimal string" | deterministic |
| P-6 | frontend/lib/finance/finance.ts:152 | SUGGESTION | Trailing-dot parity gap: backend accepts `"25000."`, frontend rejects (harmless, UI blocks) | deterministic |
| P-7 | backend/src/finance/dates.rs:65-77 | INFO | Sequential month-end cycles drift to the clamped day (01-31 → 02-28 → 03-28, never back to 31) because the anchor is the stored due date (design D2) — product wrinkle, not a defect | deterministic |
| P-8 | backend/src/finance/money.rs:73 | WARNING (= J-2) | Balance cap 1e6 vs movement cap 1e9 (dead-end confirmed live by the parent) | deterministic + live HTTP |

### F11 delivered after the terminal verdict (owner-authorised, outside the exhausted round budget)
The owner approved closing R3-1/R3-2. F11 hoisted the Spanish-message gate to a single shared helper next to `ApiError`
(`frontend/lib/api/client.ts`: `SPANISH_SERVER_CODES` + `serverMessage`) and wired it into the three consumers:
`MovementForms.tsx` (local copy removed, behavior unchanged), the subscription edit form (`SubscriptionEditForm` catch)
and the pay modal (409 branch preserved verbatim). New tests cover the helper contract, the legacy oversized-price 422
surfacing on a name-only edit, the non-JSON 500 fallback, and the F8 pay-guard message.
- Verification: `pnpm vitest run` → **42 files / 395 tests passed**; `tsc --noEmit` exit 0; focused re-run of the four touched suites by the parent → 46 passed.
- Not re-judged: the Judgment Day round budget was exhausted before F11, so this unit rests on parent review + tests, not on a third judge round.
- Post-F11 frozen delta: **17 files, +461/−66**, sha256 `3c270a1d5f74b1dc9487d4150a6886686f4fafb927b83524713c829fe7902285`; complete patch at `odd/tasks/money-path-fix-delta-final.patch` (948 lines). Uncommitted.

## Terminal verdict
Rounds run: round 1 judgment (`20b2806`) + 2 scoped re-judgments (`03a2d276`, `71a54eca`).

- CRITICAL found in any round: **0**.
- Round 3 result: Judge A clean (0 findings; re-executed the F9 regexes, checked the F8 guard order before any ledger write, the `MAX_MONEY_AMOUNT` consistency across the four call sites, the chars-vs-bytes description bound, and swept the whole movement-modal error surface for residual English leaks under `VALIDATION_ERROR`). Judge B returned 1 WARNING (R3-1) + 1 SUGGESTION (R3-2), both verified by the parent directly in the code.
- No contradiction between judges: Judge A did not inspect the two consumer files (`SubscriptionsSection.tsx`, `SubscriptionForms.tsx`), which sit outside the delta and consume the tightened validation.
- Counts: confirmed by both judges **4** (J-1..J-4, round 1) · parent-verified single-judge **6** (J-5, R2-1, R2-2, R2-3, R3-1, R3-2) · contradictions **0** · CRITICAL **0**.
- Fix work units delivered: F1..F7 (round 1) + F8..F10 (round 2); proposed F11 (R3-1/R3-2) awaiting the owner.
- Scoped re-judgment: round 2 clean after F8..F10 per Judge A; round 3 flagged the two consumer-surface items above.
- Evidence: 368 backend unit + integration bins 0 failed, 42 files / 384 frontend tests passed, `tsc --noEmit` exit 0, five live end-to-end checks against the scratch DB, scratch reset to empty, prod `pdbname` never used as a test target.

**JUDGMENT: APPROVED ✅** (no confirmed severe finding; remaining WARNING/SUGGESTION recorded as info and escalated to the owner as a human decision)

## Round 3 — final scoped re-judgment of the frozen delta `71a54eca…` (11 files, +343/−57)
Judge A (`mursder2-9-n2st`): pending. Judge B (`mursder2-a-yx6u`): returned 1 WARNING + 1 SUGGESTION.

| ID | Location | Severity | Claim | Parent verification | Disposition |
|---|---|---|---|---|---|
| R3-1 | frontend/components/settings/SubscriptionsSection.tsx:242-274 | WARNING | A pre-existing subscription with a stored price `>= 1e9` can no longer be edited from the UI: `SubscriptionEditForm` initialises `price` from the stored value and always re-sends it, the tightened `validate_price` rejects it with a Spanish 422, and the `catch` replaces the reason with the generic `t('finance.saveFailed')`. Name/date-only edits fail with no visible reason, where the same PATCH succeeded before the delta under the 1e16 cap | CONFIRMED by reading the component: `useState(String(sub.price))`, `price: wirePrice` sent unconditionally, `catch { setError(t("finance.saveFailed")) }` | introduced (F4) |
| R3-2 | frontend/components/finance/SubscriptionForms.tsx:197-201 | SUGGESTION | The F8 pay guard's actionable Spanish 422 ("editalo antes de pagar") is unreachable: `SubscriptionPayModal` shows a specific message only for `err.status === 409` and otherwise falls back to the generic `t('finance.saveFailed')` | CONFIRMED by reading the component: only the 409 branch has a specific message | introduced (F8) |

**Common root cause**: the subscription UI swallows actionable server messages — the same class F7 fixed, but only inside the movements modal.

**Proposed correction F11 (NOT applied — owner chose to wait for Judge A and batch)**: hoist the Spanish-code gate to a shared helper in `frontend/lib/api/client.ts`, use it in the subscription edit form and the pay modal, and have `MovementForms.tsx` import the shared helper instead of its local copy; plus tests for both surfaces.

**Process note**: the Judgment Day round budget is exhausted (2 fix rounds + 2 scoped re-judgments). The judgment itself stays APPROVED (no CRITICAL was ever found); the remaining WARNING is a human decision, not something the ceremony authorises further iteration on.

## Round 2 — scoped re-judgment of the fix delta (frozen `03a2d276…`, 10 files, +247/−52)
Judge A: pending. Judge B: returned 1 WARNING + 2 SUGGESTION.

| ID | Location | Severity | Claim | Parent verification | Disposition |
|---|---|---|---|---|---|
| R2-1 | backend/src/routes/subscriptions.rs:536-543 | WARNING | `validate_price` is called only on create (353) and patch (436); `pay_subscription_handler` binds the locked stored price straight into `PAY_INSERT_MOVEMENT_SQL` with no `MAX_MONEY_AMOUNT` check. A row with price in `[1e9, 1e16)` written under the old cap can still be paid, inserting a movement the movements API rejects, and the edit form re-sends the stored price → permanent 422. The F4 rustdoc claim that Pay "can never bypass" the cap is therefore false for pre-existing rows | CONFIRMED: grep shows `validate_price` only at 353/436; pay binds `price` unchecked | pre-existing (claim about the fix is wrong) |
| R2-2 | frontend/lib/finance/finance.ts:153-156 | SUGGESTION | The COP/US grouping branches accept a leading-zero first group, so `"0.500"` → `"0500"` (500 COP), `"0.001"` → `"0001"` (1 COP), `"0,500"` → `"0500"` — out-of-contract 3-decimal input silently reinterpreted 1000× instead of rejected (the pre-fix code returned null). Same ambiguity class F1 documented for `"10.005"`, extended to a grouping COP never produces | CONFIRMED by re-running the exact branch logic: 0.500→0500, 0.001→0001, 0.501→0501. Stricter first group `[1-9]\d{0,2}` returns null for those three and leaves every legitimate case unchanged (1.000, 25.000, 3.500.000, 10.005, 1,500, 25,50, 0,01) | introduced (F1) |
| R2-3 | backend/src/finance/validation.rs:29,33 | SUGGESTION | `validate_occurred_on` returns the English `"occurred_on must be a calendar date YYYY-MM-DD"` under code `VALIDATION_ERROR`, which the F7 gate lets through, so a rejected date still renders English in the Spanish-only modal (J-1 not fully closed for the date path). Reachability limited by `<input type="date">` | CONFIRMED: message strings at validation.rs:29 and :33 are English; error.rs maps `AppError::Validation` → `VALIDATION_ERROR` | pre-existing |

### Proposed corrections (NOT applied — owner said "deja" / do not commit)
- F8 = R2-1: guard the pay path (reject paying a stored price ≥ `MAX_MONEY_AMOUNT` with a Spanish 422) and correct the F4 rustdoc claim.
- F9 = R2-2: tighten the two grouping branches to `^[1-9]\d{0,2}(...)$` + tests pinning `"0.500"`/`"0.001"`/`"0,500"` → null.
- F10 = R2-3: Spanish message for `validate_occurred_on` (+ its unit tests).

### Round 2 corrections applied (F8/F9/F10) — parent-verified
- F8: `pay_subscription_handler` now rejects a locked stored price `>= MAX_MONEY_AMOUNT` with a Spanish 422 **before** any ledger write; the F4 rustdoc claim was corrected to say the cap is enforced on create/patch *and* guarded on pay. Test `pay_pre_existing_oversized_price_is_422_and_persists_nothing` inserts an oversized row via SQL, asserts 422 + zero movements + unchanged balance, and asserts the boundary `999999999.99` still pays exactly once.
- F9: both grouping branches now require a first group without a leading zero (`^[1-9]\d{0,2}(...)$`); `"0.500"`, `"0.001"`, `"0,500"`, `"0.501"` → null again, and every legitimate form is unchanged (`1.000`, `25.000`, `3.500.000`, `10.005`, `1,500`, `1,500,000.50`, `25,50`, `0,01`).
- F10: `validate_occurred_on` shares one Spanish message const (`"la fecha (occurred_on) debe tener el formato YYYY-MM-DD"`) for both branches, with a test asserting the exact text for the shape branch and the parse branch.
- Verification after F8/F9/F10: backend **368 unit + integration bins (3/10/10/5/7) 0 failed** (the notes flake did not fire), frontend **42 files / 384 tests passed**, `tsc --noEmit` exit 0.
- INFO (reviewed, not changed): the oversized-price guard runs *before* the `is_paid_this_cycle` 409 check, so an oversized row that is also already paid returns 422 instead of 409. Both are safe rejections and the 422 message ("editalo antes de pagar") is the more actionable one; left as is.
- Scratch DB reset to empty after the runs (orphan fixtures from the F8 RED panic removed); prod `pdbname` never used.

### Final frozen delta (round 2 re-judgment target)
11 files, +343/−57, sha256 `71a54eca519ebf12e54e5a74d751150cc9f38b67c17ef5a85122e2fb3648871b`; full patch saved at `odd/tasks/money-path-fix-delta-final.patch` (736 lines). Uncommitted.
Judge A's first round-2 run was cancelled because F8/F9/F10 changed three of its target files, which would have made its findings stale against the superseded hash `03a2d276…`; the final pair (`mursder2-9-n2st`, `mursder2-a-yx6u`) re-judges the frozen delta above.

## Fix round (parent-verified work units; JD fix actor scope = J-1..J-4 + P-1/P-3)
- F1 = P-1 CRITICAL comma-decimal corruption + P-2 thousand dots + mixed COP format (rewrite `normalizeManualAmount`, documented change: `"10.005"` → 10005)
- F2 = J-2/P-8 unify money cap at shared `MAX_MONEY_AMOUNT = 1e9` (backend money.rs/movements.rs/accounts tests + frontend guard/tests)
- F3 = J-3 rustdoc 10^6 → 10^9
- F4 = J-4/P-4 align `validate_price` to the shared money cap
- F5 = P-3 description bound in characters, not bytes
- F6 = fold probe coverage into canonical suites and delete the fragile probe files
- F7 = J-1 gate `serverMessage` to the Spanish server codes (VALIDATION_ERROR, CONFLICT)

Deliberately NOT fixed (recorded as info): P-5 lax decimal formats, P-6 trailing-dot parity, P-7 month-end drift.

## Verdict (round 1)
No CRITICAL and no confirmed severe finding → no JD-mandated correction; WARNING/SUGGESTION rows recorded as info and
handled as parent-verified work units above. Scoped re-judgment follows the fix delta.

JUDGMENT: APPROVED ✅ (round 1, no confirmed severe findings)
