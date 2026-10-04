# Delta for MCP Dashboard

**Scope.** W1 reaches the MCP account tools: `create_account` loses the `type` enum and the three card fields and gains the type-free backend contract, and the catalog documents the removal. No movement or transfer tool is added (the canonical prohibition stays binding), no other tool changes, and the transport, authentication, token model and scopes are untouched.

**Edge cases.** `list_accounts` and `get_account` proxy the API response, so after W1 they simply no longer carry `type`/`credit_limit`/`statement_day`/`payment_due_day`/card metrics — no formatting code changes. `update_account` keeps its existing allowlist and never accepted type or card fields. A client with a cached `create_account` schema that still sends `type` receives the backend's 422 (the schema rejects it before the request, matching `deny_unknown_fields`).

**Non-goals.** No movement or transfer tool, no `list_movements`, no `create_transfer`, no tool renaming, no deprecated aliases, no scope migration, no transport or host/origin change, no new dependency or package.json change.

## MODIFIED Requirements

### Requirement: Surviving Tool Surface Unchanged

Tools for accounts, categories, subscriptions, assets, habits, goals, tasks, events and notes MUST keep their names, authentication (bearer token per call) and response formatting; the only input-schema change permitted by this change is `create_account`, which MUST drop the account type and card fields (see "Account Tool Reflects The Type-Free Contract"). `api_tokens` scopes MUST remain free-form JSON — no scope migration or allowlist change MAY be introduced. No tool for the movements ledger, expense/income writes, the transfer endpoint or the subscription pay action MAY be registered by this change.
(Previously: the surviving-tools requirement said input schemas stay identical; the account type removal changes exactly one schema.)

#### Scenario: No scope migration
- GIVEN the token storage
- WHEN the change is applied
- THEN no token row or scope value is rewritten

#### Scenario: Surviving tools still work
- GIVEN a valid token
- WHEN a surviving tool such as `list_subscriptions` is invoked
- THEN it returns the same shape as before the change

#### Scenario: No movement or transfer tool appears
- GIVEN the registry after the change
- WHEN its tool names are listed
- THEN no tool targets `/movements`, the transfer endpoint or the pay endpoint

#### Scenario: Only the account schema changed
- GIVEN the registry before and after the change
- WHEN each tool's input schema is compared
- THEN `create_account` is the only one that differs

### Requirement: Catalog Documentation Matches The Surface

`mcp-dashboard/README.md` MUST list only the surviving tools, MUST describe `create_account` with its type-free fields, and MUST note that the account type and credit-card fields were removed by this change (with the 0-card owner decision), so a reader cannot be misled into expecting them. It MUST also keep the earlier removal notes (transaction/budget tools, `list_debts`).
(Previously: the README still described the type/card create-account surface.)

#### Scenario: README lists the surviving surface
- GIVEN the README
- WHEN its tool list is compared with the registry
- THEN every listed tool exists and no removed tool is listed

#### Scenario: Create-account documentation matches the schema
- GIVEN the README's `create_account` entry and the tool's input schema
- WHEN they are compared
- THEN both describe name plus optional currency/notes/color/icon and neither mentions type or card fields

#### Scenario: Removal is documented with its reason
- GIVEN the README's account note
- WHEN it is read
- THEN it names the account type/card removal by this change and the owner decision behind it

## ADDED Requirements

### Requirement: Account Tool Reflects The Type-Free Account Contract

The MCP `create_account` tool MUST accept exactly `name` (required) plus the optional `currency`, `notes`, `color` and `icon`, MUST NOT accept or advertise `type`, `credit_limit`, `statement_day` or `payment_due_day` (rejecting them at the schema before any request), and MUST describe itself without referencing account kinds or cards. `list_accounts` and `get_account` MUST expose whatever the backend returns and MUST NOT synthesize removed fields. No account tool MAY expose a card metric, a limit or a type.

#### Scenario: Type-free creation through MCP
- GIVEN a valid token
- WHEN `create_account` is called with `{"name": "Cuenta principal"}`
- THEN the request is sent to `POST /api/accounts` with exactly that body and the response is formatted as before

#### Scenario: Removed fields rejected before the request
- GIVEN a caller sending `{"name": "X", "type": "bank"}` or any card field
- WHEN the tool dispatches
- THEN the schema rejects the input and no API request is issued

#### Scenario: No type or card field in account reads
- GIVEN `list_accounts` or `get_account`
- WHEN the tool output is inspected
- THEN it contains no `type`, `credit_limit`, `statement_day`, `payment_due_day`, `used_balance`, `available_balance`, `usage_pct`, `alert_level` or `statement_balance` key

#### Scenario: Description matches the contract
- GIVEN the tool catalog
- WHEN the `create_account` entry is read
- THEN it lists name plus optional currency/notes/color/icon and mentions no account type or card field
