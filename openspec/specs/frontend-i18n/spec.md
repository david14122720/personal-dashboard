# Frontend i18n Specification

## Purpose

Single-locale Spanish layer: typed ES dictionary, `t()`, Intl formatters, Spanish document locale. Dictionary values are Spanish by design; code and comments stay English.

## Requirements

### Requirement: Typed ES Dictionary and Coverage

All user-visible strings — labels, aria-labels, placeholders, errors, page titles — MUST live in one type-checked ES dictionary consumed via `t(key)`; unknown keys MUST fail the build and hardcoded English UI literals MUST NOT remain. No other locale mechanism SHALL exist.

#### Scenario: Unknown key fails at build

- GIVEN code calling `t("missing.key")`
- WHEN type-checking runs
- THEN the build fails

#### Scenario: Sweep complete

- GIVEN the login, overview, finance, and productivity pages
- WHEN rendered
- THEN only Spanish copy is visible

### Requirement: ES Date and Money Formatting

`YYYY-MM` months and dated labels MUST render via Spanish Intl formatters. `formatMoney` MUST keep es-CO/COP defaults and MUST fall back to Spanish — never `en-US` — when Intl throws.

#### Scenario: Chart month label

- GIVEN aggregate month `"2026-09"`
- WHEN a chart axis renders it
- THEN the Spanish month form is shown

#### Scenario: Invalid currency fallback

- GIVEN `formatMoney` with currency `"XX1"`
- WHEN formatted
- THEN grouping is Spanish (`1.500.000`)

### Requirement: Spanish Document Language and Metadata

The root layout MUST declare `lang="es"` and Spanish metadata title/description.

#### Scenario: Language declared

- GIVEN the built HTML document
- WHEN parsed
- THEN `<html lang="es">` and a Spanish `<title>` are present

### Requirement: ES-First Test Acceptance

Spanish assertions MUST be written before each page sweep turns them green; every commit MUST leave the suite green. This slice MUST carry a judgment-day evidence hook: dual review of key naming + missed-locale audit.

#### Scenario: Red before green

- GIVEN new ES assertions for an unswept page
- WHEN the suite runs pre-implementation
- THEN they fail until the sweep lands

### Requirement: Removed Feature Key Hygiene

The dictionary MUST NOT retain keys whose only consumers were removed. The transfer, transaction/ledger, budget, flow-chart and analysis key families MUST be deleted together with their consumers, and this change MUST also delete the savings/debts families — `finance.debts*`, `finance.savings*`, `finance.manageDebts*`, `finance.manageSavings*`, `finance.deposit*`, `finance.withdraw*`, `finance.overWithdrawal*`, `finance.overPayment*`, `finance.paymentHistory*`, `finance.creditor*`, `dashboard.pendingDebts*` and `dashboard.savingsSegment*` — along with their components. The dictionary MUST NOT gain placeholder keys for removed features. Any new user-visible string introduced by this change MUST be added as a typed key consumed through `t(key)`: at minimum the movement families (`finance.movements*`, `finance.addExpense*`, `finance.addIncome*`), the pay flow (`finance.subscriptionPay*`, `finance.paidThisCycle`, `finance.subscriptionPaidThisCycle`), the Settings subscription manager (`finance.subscriptionSettings*`), the account-delete block (`finance.accountDeleteBlocked`) and the Resumen section labels (`dashboard.latestMovements*`, `dashboard.upcomingSubscriptions*`). `finance.paymentTransfer` MUST be preserved because it names a payment method, not the removed transfers feature.
(Previously: the hygiene list covered the parent change's removed families and their S3b copy rewrites; the savings/debts families and the movement/pay keys did not exist.)

#### Scenario: Removed keys are gone

- GIVEN the dictionary after the change
- WHEN it is searched for the removed key families (transfers, ledger, budget, flow, analysis, savings, debts)
- THEN none of them is present

#### Scenario: Payment method label preserved

- GIVEN the subscription payment-method selector
- WHEN it renders its options
- THEN the "Transferencia" option still resolves through its existing key

#### Scenario: Unknown key still fails the build

- GIVEN code calling `t("removed.key")` or a key deleted by this change
- WHEN type-checking runs
- THEN the build fails

#### Scenario: New movement and pay copy is typed

- GIVEN the expense/income modals, the history filters, the pay flow and the Resumen sections
- WHEN their labels and messages are resolved
- THEN every visible string comes from the typed ES dictionary with no hardcoded literal

#### Scenario: S3b copy rewrites and new keys are typed

- GIVEN the dictionary after the change
- WHEN `finance.subtitle`, `dashboard.overviewSubtitle`, `reports.financeCurrent`, `progress.financeHint` and the `finance.balanceEdit*` keys are resolved
- THEN no copy names a removed ledger, budget, flow, savings or debt artefact, and every new user-visible string comes from a typed key
