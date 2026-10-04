# Delta for Frontend I18n

**Scope.** The rename changes the values of three home identity keys (one of them currently unconsumed) and this feature adds typed copy for the two Dashboard chart disclosures. The dictionary stays a single Spanish map consumed through typed `t(key)`. No new locale mechanism and no hardcoded UI literal is introduced.

**Non-goals.** No resurrection of the removed flow-chart/analysis key families, no placeholder keys, no new locale, no change to the existing period labels or money formatters.

## MODIFIED Requirements

### Requirement: Typed ES Dictionary and Coverage

All user-visible strings — labels, aria-labels, placeholders, errors, page titles — MUST live in one type-checked ES dictionary consumed via `t(key)`; unknown keys MUST fail the build and hardcoded English UI literals MUST NOT remain. No other locale mechanism SHALL exist. This change additionally requires the home identity values to resolve to «Dashboard»: `nav.overview` (sidebar, mobile tab and breadcrumb), `dashboard.overview` (currently unconsumed) and `dashboard.overviewTitle` (home `h1`) MUST all return «Dashboard» while keeping their key names, and no home identity value MAY resolve to «Resumen»/«Resumen General». This is a copy-only key-value change: no key is deleted and no route changes. The new chart copy MUST be typed: at minimum the totals-trend family (`dashboard.totalTrend*`) and the expense-pie family (`dashboard.expensePie*`) covering titles, hints, chart/aria labels and empty states. Series legends MAY reuse the existing `finance.chartExpenses`/`finance.chartIncome` keys and the period pill labels the existing `finance.trendPeriod*` keys.
(Previously: the requirement asserted the single typed dictionary and build failure on unknown keys, without naming the renamed identity values or any chart key families.)

#### Scenario: Identity copy resolves to «Dashboard»

- GIVEN the dictionary after the change
- WHEN `nav.overview`, `dashboard.overview` and `dashboard.overviewTitle` are resolved
- THEN each returns «Dashboard» and none of the key names was changed

#### Scenario: Chart copy is typed and Spanish

- GIVEN the two Dashboard chart disclosures
- WHEN their titles, hints, aria-labels and empty states render
- THEN every string comes from the typed ES dictionary through `t(key)` with no hardcoded literal

#### Scenario: Unknown key fails at build

- GIVEN code calling `t("missing.key")` or a key deleted by this change
- WHEN type-checking runs
- THEN the build fails

#### Scenario: Sweep complete

- GIVEN the login, overview, finance, and productivity pages
- WHEN rendered
- THEN only Spanish copy is visible

### Requirement: Removed Feature Key Hygiene

The dictionary MUST NOT retain keys whose only consumers were removed. The transfer, transaction/ledger, budget, flow-chart and analysis key families MUST be deleted together with their consumers, and this change MUST also keep deleted the savings/debts families — `finance.debts*`, `finance.savings*`, `finance.manageDebts*`, `finance.manageSavings*`, `finance.deposit*`, `finance.withdraw*`, `finance.overWithdrawal*`, `finance.overPayment*`, `finance.paymentHistory*`, `finance.creditor*`, `dashboard.pendingDebts*` and `dashboard.savingsSegment*` — along with their components. The dictionary MUST NOT gain placeholder keys for removed features, and the new charts MUST NOT reintroduce any key of the retired flow-chart/donut families or resurrect their names. Any new user-visible string introduced by this change MUST be added as a typed key consumed through `t(key)`: at minimum the totals-trend family (`dashboard.totalTrend*`) and the expense-pie family (`dashboard.expensePie*`), alongside the still-binding movement families (`finance.movements*`, `finance.addExpense*`, `finance.addIncome*`), the pay flow (`finance.subscriptionPay*`, `finance.paidThisCycle`, `finance.subscriptionPaidThisCycle`), the Settings subscription manager (`finance.subscriptionSettings*`), the account-delete block (`finance.accountDeleteBlocked`) and the Resumen section labels (`dashboard.latestMovements*`, `dashboard.upcomingSubscriptions*`). `finance.paymentTransfer` MUST be preserved because it names a payment method, not the removed transfers feature.
(Previously: the hygiene list covered the removed savings/debts and movement/pay families; the Dashboard chart key families did not exist and the retired flow/donut key families were not explicitly named for this change.)

#### Scenario: Removed keys are gone

- GIVEN the dictionary after the change
- WHEN it is searched for the removed key families (transfers, ledger, budget, flow, analysis, savings, debts)
- THEN none of them is present

#### Scenario: New chart keys are typed

- GIVEN the two Dashboard chart disclosures
- WHEN their copy is resolved
- THEN every new string lives under `dashboard.totalTrend*` or `dashboard.expensePie*` (or an existing period/finance key) and no literal is embedded in a component

#### Scenario: New pie does not resurrect the old donut keys

- GIVEN the dictionary after the change
- WHEN it is searched for the retired flow-chart and donut key names
- THEN none of them is present

#### Scenario: Payment method label preserved

- GIVEN the subscription payment-method selector
- WHEN it renders its options
- THEN the "Transferencia" option still resolves through its existing key

#### Scenario: Unknown key still fails the build

- GIVEN code calling `t("removed.key")` or a key deleted by this change
- WHEN type-checking runs
- THEN the build fails
