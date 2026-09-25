# Delta for MCP Dashboard

**Scope.** The MCP tool surface drops `list_debts`, the only debt/savings-related tool that exists in the registry (verified: no savings tool is registered). No movements tool is added (out of scope). Transport, authentication, token scopes and every other tool keep their behaviour.

**Edge cases.** A client with a cached tool list receives an unknown-tool error for `list_debts`; this is accepted for the single-user deployment and MUST be documented in the README, not worked around with a stub or alias.

**Non-goals.** No MCP tool for movements, subscriptions pay, net worth changes or any new capability; no scope migration; no versioned tool aliases.

## MODIFIED Requirements

### Requirement: Removed Financial Tools Are Gone

The MCP server MUST NOT expose the tools whose endpoints this change removes: `list_transactions`, `create_transaction`, `update_transaction`, `delete_transaction`, `stats_transactions_by_category`, `stats_transactions_monthly_flow` and `list_budgets` (removed by the parent change) and, by this change, `list_debts` (the debts route is removed and no savings tool exists). No replacement, alias or deprecated variant of those names MAY be registered, and no movements tool MAY be added as a substitute.
(Previously: the removed list named the seven transaction/budget tools; `list_debts` was still exposed and catalogued.)

#### Scenario: Removed tools are not advertised

- GIVEN the running MCP server
- WHEN a client lists its tools
- THEN none of the removed names — including `list_debts` — appears

#### Scenario: Calling a removed tool fails as unknown

- GIVEN a client that cached an old tool list
- WHEN it invokes `list_debts` or `list_transactions`
- THEN the server reports an unknown tool and performs no API request

#### Scenario: No request to a removed endpoint

- GIVEN the tool implementations
- WHEN their paths are inspected
- THEN none targets `/debts`, `/savings-goals` or a removed transaction route

### Requirement: Surviving Tool Surface Unchanged

Tools for accounts, categories, subscriptions, assets, habits, goals, tasks, events and notes MUST keep their names, input schemas and response formatting. Authentication MUST keep using the bearer token per call, and `api_tokens` scopes MUST remain free-form JSON — no scope migration or allowlist change MAY be introduced. No tool for the new movements ledger or the subscription pay action MAY be registered by this change.
(Previously: the surviving list included debts and savings, which no longer have endpoints.)

#### Scenario: No scope migration

- GIVEN the token storage
- WHEN the change is applied
- THEN no token row or scope value is rewritten

#### Scenario: Surviving tools still work

- GIVEN a valid token
- WHEN a surviving tool such as `list_subscriptions` is invoked
- THEN it returns the same shape as before the change

#### Scenario: No movements tool appears

- GIVEN the registry after the change
- WHEN its tool names are listed
- THEN no tool targets `/movements` or the pay endpoint

### Requirement: Catalog Documentation Matches The Surface

`mcp-dashboard/README.md` MUST list only the surviving tools and MUST note that the transaction and budget tools were removed by the parent change and that `list_debts` was removed by this change (debts eradicated end to end, migration 0013), so a reader cannot be misled into expecting them.
(Previously: the README already recorded the transaction/budget removals but still listed `list_debts`.)

#### Scenario: README lists the surviving surface

- GIVEN the README
- WHEN its tool list is compared with the registry
- THEN every listed tool exists and no removed tool (including `list_debts`) is listed

#### Scenario: Removal is documented with its reason

- GIVEN the README's removal note
- WHEN it is read
- THEN it names the debts removal by this change and the gated migration that drops the tables
