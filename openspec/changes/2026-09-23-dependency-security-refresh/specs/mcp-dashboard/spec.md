# Delta for MCP Dashboard

## ADDED Requirements

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

- The zod 4 error path is asserted by dispatching a rejecting tool, not by typecheck alone.
- `package-lock.json` is generated, review-exempt and MUST NOT be hand-edited.
- If TypeScript 7 surfaces errors in `mcp-dashboard`, the fix stays inside this unit and is not folded into the frontend bump.

## Non-goals

- No new tool, no scope migration, no token-model change.
- No `npm audit` CI job in this change.
- No MCP SDK host/origin policy redesign.
