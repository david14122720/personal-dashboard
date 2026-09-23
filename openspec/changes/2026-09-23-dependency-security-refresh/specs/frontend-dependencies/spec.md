# Frontend Dependencies Specification

## Purpose

Pinned, reproducible dependency set for `frontend/` (pnpm workspace) with TypeScript 7 landed as an isolated, revertable step before any runtime package moves.

## Requirements

### Requirement: Pinned Frontend Toolchain

`frontend/package.json` MUST pin `typescript` to `7.0.2`, `next` to `16.3.6`, `react` and `react-dom` to `19.3.0`, `@types/react` and `@types/react-dom` to `19.3.0`, `@types/node` to `26.6.2`, `jsdom` to `30.1.1`, and `vitest` to `5.0.1`. Packages not enumerated here MUST be probed to their latest version during apply and recorded in the verify report; `@testing-library/jest-dom`, `@testing-library/react`, `@vitejs/plugin-react`, `recharts` and `@playwright/test` MUST NOT be left unverified.

#### Scenario: Pins are present in the manifest

- GIVEN `frontend/package.json`
- WHEN its dependency entries are inspected
- THEN every pinned package matches the versions above

#### Scenario: Lockfile records the pins

- GIVEN a fresh `pnpm install`
- WHEN `frontend/pnpm-lock.yaml` is inspected
- THEN the pinned versions are the resolved versions and no range resolves a different TypeScript

#### Scenario: Omitted packages are enumerated, not assumed

- GIVEN the packages the parent list omitted
- WHEN apply probes the registry
- THEN each is either bumped or explicitly recorded as already latest

### Requirement: TypeScript 7 Compatibility Preconditions

`frontend/tsconfig.json` MUST NOT use any option value removed by TypeScript 7 (`module` `umd`/`amd`/`system`/`none`, `moduleResolution` `node`/`classic`/`node10`, `target` `es5`) and MUST keep its current shape (`target ES2022`, `module esnext`, `moduleResolution bundler`, `jsx react-jsx`). If TypeScript 7 surfaces source errors that 5.9.3 tolerated, the fix MUST stay inside the TypeScript step and MUST NOT be folded into the runtime bump.

#### Scenario: No config migration needed

- GIVEN `frontend/tsconfig.json`
- WHEN `pnpm exec tsc --noEmit` runs under TypeScript 7
- THEN it exits 0 without any config-option migration edit

#### Scenario: TypeScript failure is isolated and revertable

- GIVEN TypeScript 7 rejects code that 5.9.3 accepted
- WHEN the failure appears
- THEN it is fixed (or reverted) in the TypeScript step alone before any runtime package moves

#### Scenario: Build typecheck gate

- GIVEN `next build` runs its own typecheck pass
- WHEN the TypeScript step is verified
- THEN the build is green before runtime bumps start

### Requirement: Verification Ladder for the Frontend Bump

Every frontend bump step MUST be verified in this order and MUST stop at the first red step: `pnpm install` → `pnpm test` → `pnpm exec tsc --noEmit` → `pnpm run build` → `pnpm exec playwright test --list`. A red step MUST NOT be followed by claiming a later step as evidence.

#### Scenario: TypeScript step passes its ladder first

- GIVEN the TypeScript 7 change
- WHEN its ladder runs
- THEN all five steps pass before any runtime bump begins

#### Scenario: Runtime step passes its ladder

- GIVEN the runtime package bumps
- WHEN their ladder runs
- THEN all five steps pass

#### Scenario: First red stops the ladder

- GIVEN a failing step
- WHEN the ladder is executed
- THEN execution stops there and the step is fixed or reverted before continuing

### Requirement: Single Source of Build-Script Approval

Build-script approval MUST have exactly one authoritative source. The `pnpm.onlyBuiltDependencies` block in `frontend/package.json` MUST be removed only after an install proves that `frontend/pnpm-workspace.yaml`'s `allowBuilds:` map approves `esbuild`, `msw` and `sharp` for the pnpm version actually in use (`pnpm -v`). If that proof fails, the three entries MUST be migrated into the workspace file instead of deleted, and the commit message MUST state which file became authoritative.

#### Scenario: Workspace map is authoritative

- GIVEN `pnpm -v` reports the pinned pnpm version
- WHEN a clean install runs with the `package.json` block removed
- THEN no `Ignored build scripts` warning names `esbuild`, `msw` or `sharp`

#### Scenario: Single approval source

- GIVEN the block has been removed
- WHEN the workspace file is inspected
- THEN `allowBuilds:` lists exactly those three packages and no other key approves build scripts

#### Scenario: Proof failure falls back to migration

- GIVEN the install proof fails
- WHEN apply proceeds
- THEN the three entries are migrated into the authoritative file and no approval is silently lost

### Requirement: No Runtime or Config Surface Change

The frontend bump MUST NOT change `frontend/next.config.ts`, `frontend/vitest.config.ts`, `frontend/playwright.config.ts`, or any application source; `frontend/tsconfig.json` MUST only change if the isolated TypeScript step requires it.

#### Scenario: Diff is manifest plus lock

- GIVEN the frontend diff
- WHEN reviewed
- THEN it contains `package.json` (plus the pnpm key removal) and the regenerated `pnpm-lock.yaml` only

#### Scenario: Static export config untouched

- GIVEN `frontend/next.config.ts`
- WHEN inspected after the bump
- THEN `output: "export"` and `trailingSlash` are unchanged

## Edge cases

- Caret floaters (`recharts`, `@playwright/test`) change lock content with no manifest edit; any lock churn from a `pnpm update` MUST be attributed to the unit that ran it.
- `pnpm install --frozen-lockfile` (CI and the root `Dockerfile`) fails when manifest and lock diverge, so every manifest edit ships its regenerated lock.
- `frontend/tsconfig.tsbuildinfo` is generated output and MUST NOT be committed.

## Non-goals

- No TypeScript 7 source migration beyond errors it actually surfaces.
- No frontend feature, layout, i18n or finance behaviour change.
- No `package-lock.json` for `frontend/`; pnpm remains the frontend package manager.
