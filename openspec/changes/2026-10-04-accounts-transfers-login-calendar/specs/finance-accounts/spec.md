# Delta for Finance Accounts

**Scope.** Accounts lose their `type` and every credit-card-specific field, end to end: the database drops `accounts.type`, `credit_limit`, `statement_day`, `payment_due_day`, the three `chk_card_*` CHECKs, the partial index `idx_accounts_user_card` and the `account_type` enum (migration 0016, owner-authorized 2026-10-04); the API accepts and returns no such field; Finance renders a row without a type chip; Settings lists and creates every account by name; MCP's create-account schema follows. Balance, ownership and patch behaviour are untouched; the delete guard gains the transfer-destination count described by `finance-movements` (the new `ON DELETE RESTRICT` FK).

**Edge cases.** Because `PatchAccountRequest` already had no type/card field, `PATCH` with `type` or `credit_limit` keeps returning 422 — now as unknown fields rather than structural rejects. Accounts created before the change keep their name, currency, balance, notes, color, icon, archive flag and movements; only the removed metadata disappears. No account-row consumer other than the Finance chip and the Settings filter read `type` (verified in `explore.md` §1), and no frontend consumer read any card metric outside tests.

**Non-goals.** No replacement classifier, tag or label column for the removed type; no migration of the old type values anywhere; no data backup or dual read; no change to the balance write paths, ownership returns, duplicate-name 409, the delete guard's 409 contract, archiving or the inline balance edit.

## MODIFIED Requirements

### Requirement: Account Creation

The system MUST allow users to create financial accounts. The create request allowlist MUST be exactly `name` (required, unique per user) plus the optional `currency`, `notes`, `color` and `icon`. With `deny_unknown_fields`, `type`, `credit_limit`, `statement_day` and `payment_due_day` MUST be rejected with 422 and no account MAY be created. A new account MUST be persisted with a default balance of `0.00`; duplicate names MUST still return 409.
(Previously: creation required a `type` from the seven-value `account_type` enum and required `credit_limit`/`statement_day`/`payment_due_day` when the type was `credit_card`.)

#### Scenario: Successfully create account
- GIVEN an authenticated user
- WHEN they create an account with `{"name": "Cuenta principal"}`
- THEN the system returns 201 and the account is persisted with balance `"0.00"`
- AND the response contains no `type`, `credit_limit`, `statement_day` or `payment_due_day`

#### Scenario: Removed fields are rejected as unknown
- GIVEN an authenticated user
- WHEN they create an account with `{"name": "Cuenta", "type": "bank"}`, or with `credit_limit`, `statement_day` or `payment_due_day`
- THEN the system returns 422 with a Spanish message and creates nothing

#### Scenario: Duplicate account name
- GIVEN an authenticated user who already has an account named "Ahorros"
- WHEN they attempt to create another account named "Ahorros"
- THEN the system returns 409 and no new account is created

### Requirement: Manual Balance As Single Source Of Truth

The account balance MUST be treated as a value the user asserts or the movement transaction adjusts. Exactly two write paths MUST exist and no others: the manual `PATCH /api/accounts/{id}` correction and the movement transaction (`finance-movements`). Every dependent figure — net worth, total assets and total balance — MUST read the stored `balance`; no card-derived figure (used, available, usage percent, alert level, statement balance) exists any more and none MAY be reintroduced.
(Previously: the dependent list named "net worth, total assets, card metrics, total balance", and card metrics were derived in Rust from `credit_limit` + `balance`.)

#### Scenario: Dependents follow the stored balance
- GIVEN an account whose balance was updated manually
- WHEN net worth and total balance are read
- THEN both reflect the new stored balance and no card metric is computed or exposed

#### Scenario: No third writer exists
- GIVEN the final codebase after the change
- WHEN writes to `accounts.balance` are searched
- THEN only the manual `PATCH /api/accounts/{id}` and the movement transaction write it, and no trigger does

## ADDED Requirements

### Requirement: Account Type Surface Retired

No account type MAY exist anywhere: the database MUST NOT contain the `accounts.type` column or the `account_type` enum (dropped by 0016), the API MUST NOT accept, store or return a type or any card field, the Finance account row MUST render name, balance and the inline balance edit without a type chip or type label, Settings MUST list every non-archived account (no `type === "bank"` filter) and create with the name only, and the MCP `create_account` schema MUST NOT expose type or card fields. Any type selector, badge, chip, filter or enum value is forbidden. This requirement explicitly supersedes the `2026-10-03-finance-ui-fixes` delta clause "the row MUST keep the information the cards carried and that is not covered elsewhere — the account type": that single clause is withdrawn; the single-row composition, the no-duplicate-card rule and the inline balance edit of that delta remain binding.

#### Scenario: Finance renders no type chip
- GIVEN a user with accounts created before the change
- WHEN the Finance Cuentas section renders
- THEN each account appears exactly once with its name and formatted balance and no type text, chip or `finance.accountTypeLabel` appears

#### Scenario: Settings manages every account
- GIVEN accounts `A` (created with a type historically) and `B`
- WHEN the Settings accounts section renders
- THEN both are listed and the create action posts `{"name": "…"}` only

#### Scenario: Superseded clause is withdrawn
- GIVEN a reader of the `2026-10-03-finance-ui-fixes` delta and of this delta
- WHEN they look for the account-row type requirement
- THEN this delta states that the type clause is superseded while the single-row composition and inline balance edit stay in force

#### Scenario: Database no longer carries the type
- GIVEN a database with migration 0016 applied
- WHEN the `accounts` catalog is inspected
- THEN `type`, `credit_limit`, `statement_day`, `payment_due_day`, the three `chk_card_*` constraints, `idx_accounts_user_card` and the `account_type` enum are all absent

## REMOVED Requirements

### Requirement: Credit Card Account Constraints

(Removed behaviour: creating accounts of type `credit_card` required a positive `credit_limit` and both cycle days; non-card accounts were forbidden from carrying a limit; `statement_day`/`payment_due_day` were range-checked and month-end clamped.)
(Reason: the owner removed the credit-card semantic layer on 2026-10-04 because it was never used — production holds 0 card accounts, so the constraints guarded nothing and forced a type/card contract through every account write, the wire and the UI.)
(Migration: 0016 drops the three `chk_card_*` constraints, `idx_accounts_user_card`, the card columns, the `type` column and the `account_type` enum, in that order, with no CASCADE and no backup. **No real data is lost: all card columns are NULL in production (5 accounts, 0 cards).** No replacement constraint or column is created; any card-specific validation is gone with the fields.)
