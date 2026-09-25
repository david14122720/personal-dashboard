# MCP Dashboard Specification

## Purpose

Public tool surface of the `mcp-dashboard` server: a curated set of tools that proxy the personal dashboard API with a bearer token, kept in step with the backend so no client ever calls a removed capability.

## Scope

- In: the tool registry in `mcp-dashboard/src/tools.ts` and its catalog in `mcp-dashboard/README.md`, for the removals performed by this change (transaction tools, budget tool) and the account tool's new manual balance field.
- Out: the MCP transport, authentication and token scopes, tools for surviving capabilities other than the account balance field, and any new tool.
- Slice: S3, in the same slice as the endpoint removals.

## Requirements

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
### Requirement: Pinned MCP Toolchain and Reproducible Install

`mcp-dashboard/package.json` MUST pin `@modelcontextprotocol/sdk` to `1.30.1`, `zod` to `4.6.5`, `typescript` to `7.0.2` and `@types/node` to `26.6.2`, and MUST declare a `packageManager` field. `express` and `@types/express` MUST be probed to latest and recorded. A `package-lock.json` MUST be committed for `mcp-dashboard` with a `.gitignore` negation (`!mcp-dashboard/package-lock.json`) placed next to the repo-wide `package-lock.json` ignore, so a clean install is reproducible with `npm ci`.

#### Scenario: Clean install is reproducible

- GIVEN a clean checkout of `mcp-dashboard`
- WHEN `npm ci` runs
- THEN it installs exactly the committed tree with no resolution step

#### Scenario: Lockfile is tracked

- GIVEN the negation is in place
- WHEN `git check-ignore mcp-dashboard/package-lock.json` is run
- THEN the file is not ignored and is tracked

#### Scenario: Pins and probed versions are visible

- GIVEN `mcp-dashboard/package.json`
- WHEN inspected
- THEN the four pins and `packageManager` are present and the probed `express` / `@types/express` versions are recorded

#### Scenario: Permissive peer range cannot silently mix resolutions

- GIVEN the MCP SDK × zod peer range (`^3.25 || ^4.0`)
- WHEN a fresh install runs
- THEN the committed lock fixes a single zod resolution

### Requirement: Zod 4 Classic Surface Without Deprecated Forms

`mcp-dashboard/src/tools.ts` MUST use the zod 4 classic API only and MUST NOT use the deprecated chained forms: `z.string().uuid()` MUST become `z.uuid()` and `.email()` MUST become `z.email()`. Every other construct in use (`z.object`, `.min/.max/.optional`, `z.enum`, `z.number().int()`, `z.array`, `z.ZodTypeAny`, `.parse()`) MUST keep its current behaviour, and tool input schemas MUST remain behaviourally identical.

#### Scenario: No deprecated chained validators

- GIVEN `src/tools.ts`
- WHEN the zod surface is inspected
- THEN `z.string().uuid()` and `.email()` do not appear and `z.uuid()` / `z.email()` are used

#### Scenario: Typecheck and build are clean

- GIVEN zod 4.6.5 with TypeScript 7.0.2
- WHEN `npm run typecheck` and `npm run build` run
- THEN both exit 0 with no zod deprecation warning from `src/tools.ts`

#### Scenario: Rejection path unchanged

- GIVEN the built server
- WHEN a tool is dispatched with input that must be rejected
- THEN it returns the same generic validation-failure path (`ZodError.issues`-derived rejection) instead of throwing through the transport

#### Scenario: Server boots and serves

- GIVEN the built `dist/`
- WHEN `node dist/index.js` starts
- THEN `curl :3101/healthz` answers and one read tool returns its previous response shape

### Requirement: Toolchain Bump Does Not Change the Transport Contract

The bump MUST NOT change `src/index.ts` host/origin allow-list behaviour, MUST NOT add or remove tools, and MUST NOT change the express JSON body limit.

#### Scenario: Transport untouched

- GIVEN the diff
- WHEN `src/index.ts` is inspected
- THEN host/origin allow-listing and the default 100 kB body limit are unchanged

#### Scenario: Tool registry is identical

- GIVEN the tool registry before and after the bump
- WHEN the names are compared
- THEN the two sets are identical

## Edge cases

- A client with a cached tool list will receive an unknown-tool error for removed names; this is accepted (single-user deployment) and MUST be documented rather than worked around with a stub.
- `list_budgets` is the only budget tool that exists; there are no budget write tools to remove and none MAY be added as a replacement.
- No transfer tool ever existed, so the transfers removal changes nothing in the MCP surface.

## Non-goals

- No MCP tool for transfers, transactions, budgets, analytics or balance history.
- No versioned or deprecated tool aliases.
- No change to the MCP transport, authentication flow or token model.
- No new tool for the productivity layout change.
