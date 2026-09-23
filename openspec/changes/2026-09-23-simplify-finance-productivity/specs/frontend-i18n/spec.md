# Delta for Frontend i18n

**Scope.** Keep the single typed ES dictionary honest after the removals: delete the keys that served the removed transfer, transaction and budget surfaces, keep the payment-method key that merely shares the word "transferencia", and add any new key (for example the productivity «Nuevo» control) as a typed entry. Slices S2, S3 and S4.

**Edge cases.** `finance.paymentTransfer` is a payment-method label used by subscription and debt forms, semantically unrelated to the removed transfers feature — a keyword sweep MUST NOT delete it. Keys removed while still referenced MUST fail the build (the typed dictionary guarantees this). No key MAY remain whose only consumer was removed code.

**Non-goals.** No new locale, no runtime translation loading, no restructuring of the dictionary, no copy rewrite of surviving sections.

## ADDED Requirements

### Requirement: Removed Feature Key Hygiene

The dictionary MUST NOT retain keys whose only consumers were removed. At minimum the transfer, transaction/ledger, budget, flow-chart and analysis key families MUST be deleted together with their consumers, and the dictionary MUST NOT gain placeholder keys for removed features. Any new user-visible string introduced by this change (such as the «Nuevo» control label) MUST be added as a typed key consumed through `t(key)`. `finance.paymentTransfer` MUST be preserved because it names a payment method, not the removed transfers feature.

#### Scenario: Removed keys are gone

- GIVEN the dictionary after the change
- WHEN it is searched for the removed key families
- THEN none of them is present

#### Scenario: Payment method label preserved

- GIVEN the subscription and debt payment-method selectors
- WHEN they render their options
- THEN the "Transferencia" option still resolves through its existing key

#### Scenario: Unknown key still fails the build

- GIVEN code calling `t("removed.key")`
- WHEN type-checking runs
- THEN the build fails

#### Scenario: New control copy is typed

- GIVEN the productivity «Nuevo» control
- WHEN its label is resolved
- THEN it comes from the typed ES dictionary with no hardcoded literal
