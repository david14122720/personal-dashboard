# Delta for Frontend i18n

**Scope.** Key hygiene is extended to the savings/debts families retired by this change, and the movement/pay/Settings-subscription/account-delete/Resumen strings introduced by it MUST land as typed keys through the single ES dictionary. No other i18n mechanism changes.

**Edge cases.** `dashboard.savingsSegment` and the goal-vs-savings copy MUST be updated or removed with the goal-progress segment they label, not left dangling. A stale test importing a removed key token MUST fail the type check, not compile silently.

**Non-goals.** No second locale, no runtime translation loading, no placeholder keys for removed features, no renaming of surviving keys beyond the copy updates the deltas name.

## MODIFIED Requirements

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
