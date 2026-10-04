# Delta for Frontend I18n

**Scope.** The dictionary gains the typed copy for transfers (`finance.transfer*` / `finance.movement*`), the productivity calendar (`productivity.calendar*`), the Settings sessions section (`settings.sessions*`) and the movement-row labels; it retires `finance.accountTypeLabel` together with the account type chip; and it keeps the account-settings copy truthful after the type filter removal (value-only edits to `settings.accountsTitle`/`settings.accountsHint`). `finance.paymentTransfer` MUST survive untouched.

**Edge cases.** `finance.paymentTransfer` names a subscription payment method and MUST NOT be reused as the transfer-row label; the transfer row uses its own key, `finance.movementTransferRoute`. New keys live in new names and MUST NOT restore the pre-2026-09-23 transfer page/ledger key family. `finance.movementPaymentLabel` keeps meaning the direction control of the expense/income modal («Tipo de movimiento»), while the transfer modal uses its own title and field keys. `tsc`/`next build` fails on any unknown or deleted `t(key)`, so a key lands in the same unit as its consumer.

**Non-goals.** No second locale, no runtime translation mechanism, no placeholder or „coming soon" key, no card/limit/alert copy, no type-label map, no re-add of the removed savings/debts/flow/analysis families, no hardcoded Spanish literal in a component.

## MODIFIED Requirements

### Requirement: Typed ES Dictionary and Coverage

All user-visible strings — labels, aria-labels, placeholders, errors, page titles — MUST live in one type-checked ES dictionary consumed via `t(key)`; unknown keys MUST fail the build and hardcoded English UI literals MUST NOT remain. No other locale mechanism SHALL exist. This change additionally requires the new copy to be typed at minimum as: the transfer feature (`finance.addTransfer`, `finance.transferModalTitle`, `finance.transferFrom`, `finance.transferTo`, `finance.transferSaved`, `finance.transferSameAccountError`, `finance.transferCurrencyError`), the three movement-row labels (`finance.movementDirectionTransfer`, `finance.movementTransferRoute`, `finance.movementAccountLabel`, plus the expense-row reuse of `finance.paymentMethod`), the calendar block (`productivity.calendar*`: title, hint, grid/aria labels, prev/next/today, task and event counts, empty day) and the sessions section (`settings.sessions*`: title, hint, current, expires, revoke action and confirmation, success, empty, load failure). `finance.accountTypeLabel` MUST be deleted. `finance.paymentTransfer` MUST be preserved as the subscription payment method label and MUST NOT be the transfer-row copy.
(Previously: the requirement asserted the single typed dictionary and build failure on unknown keys, without naming the accounts/transfer/calendar/sessions key families or the retired type key.)

#### Scenario: New copy is typed and Spanish
- GIVEN the transfer modal, the history rows, the calendar block and the Settings sessions section
- WHEN their labels, aria-labels, errors and empty states render
- THEN every string comes from the typed ES dictionary through `t(key)` with no hardcoded literal

#### Scenario: Unknown or removed key fails at build
- GIVEN code calling `t("missing.key")` or `t("finance.accountTypeLabel")` after the deletion
- WHEN type-checking runs
- THEN the build fails

#### Scenario: Payment method label preserved
- GIVEN the subscription payment-method selector and the transfer row
- WHEN both render
- THEN the selector still resolves «Transferencia» from `finance.paymentTransfer`, and the transfer row resolves its own `finance.movementTransferRoute` copy

#### Scenario: Sweep complete
- GIVEN the login, dashboard, finance, productivity and settings pages
- WHEN rendered
- THEN only Spanish copy is visible

### Requirement: Removed Feature Key Hygiene

The dictionary MUST NOT retain keys whose only consumers were removed. The transfer feature keys of this change MUST be new names and MUST NOT restore the pre-2026-09-23 transfer page/ledger key family; `finance.paymentTransfer` MUST be preserved because it names a payment method, not the removed transfers feature. The account type key `finance.accountTypeLabel` MUST be deleted together with the Finance type chip, and no card key (limit, statement, usage, alert) MAY be added. The retired savings/debts, flow-chart, analysis, transaction/ledger and budget families MUST stay deleted. Every new user-visible string introduced by this change MUST be a typed key consumed through `t(key)`: at minimum the transfer family, the movement-row labels (`finance.movementDirectionTransfer`, `finance.movementTransferRoute`, `finance.movementAccountLabel`), the calendar family (`productivity.calendar*`) and the sessions family (`settings.sessions*`). Value-only edits to `settings.accountsTitle` and `settings.accountsHint` MUST keep their key names.
(Previously: the hygiene list covered the removed savings/debts and movement/pay families and the Dashboard chart key families; the account type key and the new transfer/calendar/sessions families did not exist.)

#### Scenario: Removed keys are gone
- GIVEN the dictionary after the change
- WHEN it is searched for the removed key families (transfers page/ledger, transaction, budget, flow, analysis, savings, debts, account type, card metrics)
- THEN none of them is present

#### Scenario: Transfer copy does not resurrect the old family
- GIVEN the dictionary after the change
- WHEN its transfer-related keys are compared with the pre-removal revision
- THEN every transfer key is a new name and none of the deleted historical keys has returned

#### Scenario: Account type copy is gone with its consumer
- GIVEN the Finance account row and the dictionary
- WHEN the row renders and the dictionary is searched
- THEN no type label is rendered and `finance.accountTypeLabel` does not exist

#### Scenario: New families are typed
- GIVEN the calendar block and the sessions section
- WHEN their copy is resolved
- THEN every new string lives under `productivity.calendar*` or `settings.sessions*` (or an existing key) and no literal is embedded in a component

#### Scenario: Account settings copy stays truthful
- GIVEN the Settings accounts section
- WHEN it renders
- THEN its title and hint resolve from the same keys and describe all accounts, not only bank accounts
