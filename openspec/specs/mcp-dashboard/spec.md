# MCP Dashboard Specification

## Purpose

Public tool surface of the `mcp-dashboard` server: a curated set of tools that proxy the personal dashboard API with a bearer token, kept in step with the backend so no client ever calls a removed capability.

## Scope

- In: the tool registry in `mcp-dashboard/src/tools.ts` and its catalog in `mcp-dashboard/README.md`, for the removals performed by this change (transaction tools, budget tool) and the account tool's new manual balance field.
- Out: the MCP transport, authentication and token scopes, tools for surviving capabilities other than the account balance field, and any new tool.
- Slice: S3, in the same slice as the endpoint removals.

## Requirements

### Requirement: Removed Financial Tools Are Gone

The MCP server MUST NOT expose the tools whose endpoints this change removes: `list_transactions`, `create_transaction`, `update_transaction`, `delete_transaction`, `stats_transactions_by_category`, `stats_transactions_monthly_flow` and `list_budgets`. No replacement, alias or deprecated variant of those names MAY be registered.

#### Scenario: Removed tools are not advertised

- GIVEN the running MCP server
- WHEN a client lists its tools
- THEN none of the seven removed names appears

#### Scenario: Calling a removed tool fails as unknown

- GIVEN a client that cached an old tool list
- WHEN it invokes `list_transactions` or `list_budgets`
- THEN the server reports an unknown tool and performs no API request

#### Scenario: No request to a removed endpoint

- GIVEN the tool implementations
- WHEN their paths are inspected
- THEN none targets a removed route

### Requirement: Account Tool Reflects The Manual Balance

The `update_account` tool MUST accept the manual `balance` field as a decimal string, matching the backend allowlist, and MUST reject non-allowlisted fields before the request. Its description MUST state the accepted fields and MUST NOT claim that the balance is immutable.

#### Scenario: Balance update through MCP

- GIVEN a valid token and an owned account
- WHEN `update_account` is called with `{"balance": "980000.00"}`
- THEN the request is sent to the account patch path and the response shows the new balance as a string

#### Scenario: Description matches the contract

- GIVEN the tool catalog
- WHEN the `update_account` entry is read
- THEN it lists `balance` among the accepted fields and mentions no immutability rule

### Requirement: Surviving Tool Surface Unchanged

Tools for accounts, categories, debts, savings, subscriptions, assets, habits, goals, tasks, events and notes MUST keep their names, input schemas and response formatting. Authentication MUST keep using the bearer token per call, and `api_tokens` scopes MUST remain free-form JSON — no scope migration or allowlist change MAY be introduced.

#### Scenario: No scope migration

- GIVEN the token storage
- WHEN the change is applied
- THEN no token row or scope value is rewritten

#### Scenario: Surviving tools still work

- GIVEN a valid token
- WHEN a surviving tool such as `list_accounts` is invoked
- THEN it returns the same shape as before the change

### Requirement: Catalog Documentation Matches The Surface

`mcp-dashboard/README.md` MUST list only the surviving tools and MUST note that the transaction and budget tools were removed by this change, so a reader cannot be misled into expecting them.

#### Scenario: README lists the surviving surface

- GIVEN the README
- WHEN its tool list is compared with the registry
- THEN every listed tool exists and no removed tool is listed

## Edge cases

- A client with a cached tool list will receive an unknown-tool error for removed names; this is accepted (single-user deployment) and MUST be documented rather than worked around with a stub.
- `list_budgets` is the only budget tool that exists; there are no budget write tools to remove and none MAY be added as a replacement.
- No transfer tool ever existed, so the transfers removal changes nothing in the MCP surface.

## Non-goals

- No MCP tool for transfers, transactions, budgets, analytics or balance history.
- No versioned or deprecated tool aliases.
- No change to the MCP transport, authentication flow or token model.
- No new tool for the productivity layout change.
