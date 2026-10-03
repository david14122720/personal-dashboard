# Delta for Frontend I18n

**Scope.** The removals of this change take four keys with them, and one key that looks removable MUST survive.

**Non-goals.** No new copy is introduced by this change, so no new key is added. The dictionary stays a single Spanish map consumed through typed `t(key)`.

## MODIFIED Requirements

### Requirement: Removed Feature Key Hygiene

The dictionary MUST NOT retain keys whose only consumers were removed. The transfer, transaction/ledger, budget, flow-chart and analysis key families MUST be deleted together with their consumers, and this change MUST also delete the savings/debts families — `finance.debts*`, `finance.savings*`, `finance.manageDebts*`, `finance.manageSavings*`, `finance.deposit*`, `finance.withdraw*`, `finance.overWithdrawal*`, `finance.overPayment*`, `finance.paymentHistory*`, `finance.creditor*`, `dashboard.pendingDebts*` and `dashboard.savingsSegment*` — along with their components. In addition, the keys whose only consumer this change removes MUST be deleted with it: `nav.live` (the header live pill), `finance.addMovementTitle` and `finance.addMovementHint` (the separate add-movement card, now merged into the movements panel) and `dashboard.activeSubs`/`dashboard.activeSubsHint` (the removed widget and its toggle row). Conversely, `dashboard.netWorth`/`dashboard.netWorthHint` MUST be preserved: two of their consumers disappear here, but Reports and Progress still render them. The dictionary MUST NOT gain placeholder keys for removed features. Any new user-visible string introduced by this change MUST be added as a typed key consumed through `t(key)`: at minimum the movement families (`finance.movements*`, `finance.addExpense*`, `finance.addIncome*`), the pay flow (`finance.subscriptionPay*`, `finance.paidThisCycle`, `finance.subscriptionPaidThisCycle`), the Settings subscription manager (`finance.subscriptionSettings*`), the account-delete block (`finance.accountDeleteBlocked`) and the Resumen section labels (`dashboard.latestMovements*`, `dashboard.upcomingSubscriptions*`). `finance.paymentTransfer` MUST be preserved because it names a payment method, not the removed transfers feature.
(Previously: the hygiene list covered the removed savings/debts families and the movement/pay keys; it named no keys for the removals of this change and gave no explicit protection for `dashboard.netWorth`.)

#### Scenario: Removed keys are gone

- GIVEN the dictionary after the change
- WHEN it is searched for the removed key families (transfers, ledger, budget, flow, analysis, savings, debts)
- THEN none of them is present

#### Scenario: Keys orphaned by this change are gone

- GIVEN the dictionary after the change
- WHEN it is searched for `nav.live`, `finance.addMovementTitle`, `finance.addMovementHint`, `dashboard.activeSubs` and `dashboard.activeSubsHint`
- THEN none of them is present, and no `t(...)` call references them

#### Scenario: The patrimonio key survives

- GIVEN the dictionary after the change
- WHEN the keys of the strip removal are reviewed
- THEN `dashboard.netWorth` and `dashboard.netWorthHint` are still present because Reports and Progress consume them

#### Scenario: Payment method label preserved

- GIVEN the subscription payment-method selector
- WHEN it renders its options
- THEN the "Transferencia" option still resolves through its existing key

#### Scenario: Unknown key still fails the build

- GIVEN code calling `t("removed.key")` or a key deleted by this change
- WHEN type-checking runs
- THEN the build fails
