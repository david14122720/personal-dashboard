# Playwright toolchain: browsers and the agent CLI

**Status**: done (2026-10-11)
**Owner**: David · **Agent**: el Gentleman (Pi)
**Branch**: `feat/2026-10-11-categories-finance-only`, sharing the uncommitted C4 tree. This workstream changes
three spec files plus this document; the rest is machine state. Nothing is committed.

**Owner decisions (2026-10-11)**: the two data-dependent `sections.spec.ts` tests keep the documented
precondition (no data-presence gate, no in-spec seeding), and everything stays **uncommitted** for the owner's
review.

## Goal

Make every Playwright surface on this machine work with no workarounds:

1. the repository's own suite (`frontend/`, `@playwright/test` 1.63) launches its browsers without any
   `PW_EXECUTABLE` override;
2. the official agent CLI is installed and drives a real browser;
3. both are verified by real runs, never by inspection.

## Context / problem

- `frontend/node_modules/@playwright/test` is **1.63.0**, so it expects `chromium-1243` and
  `chromium_headless_shell-1243` (Chrome for Testing 153.0.8010.12), plus `firefox-1543` and `webkit-2359`.
- `~/.cache/ms-playwright` only had the **1208** generation: `chromium-1208` (incomplete — no full `chrome`
  binary), `chromium_headless_shell-1208`, `firefox-1509`, `webkit-2248`, `ffmpeg-1011`.
- Consequence before this task: `pnpm test:e2e` could not launch any browser, and the C4 browser
  verification had to pin `PW_EXECUTABLE` to the 1208 headless shell.
- The npm name `playwright-cli` is **deprecated** ("Deprecated package, use @playwright/cli instead"). The
  live package is `@playwright/cli` **0.1.22**, bin `playwright-cli`, depending on `playwright` /
  `playwright-core` `1.64.0-alpha-1790635538000` → its browser revision is independent from the repo's.
- npm prefix is `~/.local`, so global installs need no sudo.
- `playwright-cli` installs as `~/.local/bin/playwright-cli` (deps: `playwright` 1.64.0-alpha). Out of the box
  it tried the **system `chrome` channel** (`/opt/google/chrome/chrome`, absent on this machine) and failed with
  `Chromium distribution 'chrome' is not found`. Its own `install` command writes
  `{"browser":{"browserName":"chromium","launchOptions":{"channel":"chromium"}}}`; placed at the documented
  global path `~/.playwright/cli.config.json` it fixes the default everywhere (resolution lives in
  `playwright-core/lib/coreBundle.js:74268`).
- `playwright-cli install-browser --list` proved the stale 1208 browsers are **not** orphans: they belong to
  `/home/david/Nextcloud2/Ubuntu/proyecto_Davefit` (Playwright 1.58.2). Deleting them would break that project.
- The CLI blocks `file:` URLs by security default, so its smoke needed a local HTTP server.
- `--create-user` still parses the server config first, so it needs `PORT` (and `DATABASE_URL`) in the
  environment or it fails with `config error: PORT is required`.
- Found by T3: `e2e/productivity-layout.spec.ts` ran without `E2E_SMOKE_LIVE` (by design, it stubs the API)
  but still needed a server at `baseURL`; with nothing listening it failed on `net::ERR_CONNECTION_REFUSED`,
  contradicting the suite contract stated in `playwright.config.ts` (`pnpm test:e2e` exited 1).

## Tasks

- [x] T1 Install the browsers the repo driver needs (`npx playwright install chromium` inside `frontend/`).
- [x] T2 Install `@playwright/cli` globally plus the browsers it wants, and smoke it with a real command.
- [x] T3 Verify the repository suite both ways. Skip mode: exit 0, 15 skipped. Live mode: 12 passed / 3 failed in
      run 1; after isolating the two non-code causes the four affected tests pass (diagnostic scenarios A and B).
      Both runs delegated to an independent verifier.
- [x] T5 Fix the suite-contract defect T3 exposed: the layout-evidence spec now probes `baseURL` and skips instead
      of failing when nothing answers.
- [x] T6 Fix the second spec defect T3 exposed: the notification empty-state assertions were not scoped to the
      dialog, so they hit a strict-mode violation whenever the user has no upcoming payments.
- [x] T4 Record the evidence, clean the environment, report.

## Acceptance criteria

1. `cd frontend && npx playwright install --dry-run` shows nothing missing for chromium.
2. `pnpm test:e2e` without `E2E_SMOKE_LIVE=1` exits 0 with all specs skipped, with no browser-launch failure.
3. Live mode with the throwaway user passes the full suite with no `PW_EXECUTABLE` override.
4. Global `playwright-cli` reports a version and completes a real headless navigation plus screenshot.
5. Environment restored afterwards: throwaway user deleted (cascade), backend stopped, build caches removed,
   no credentials written to memory.

## Evidence

- **T1** `npx playwright install chromium` → exit 0; `chromium-1243/chrome-linux64/chrome` (293 MB) and
  `chromium_headless_shell-1243/…/chrome-headless-shell` (197 MB) present. Real launch with no
  `PW_EXECUTABLE`: `chromium.launch()` → `LAUNCH_OK`, `navigator.userAgent` reports Linux x86_64, injected
  `<h1>` read back correctly.
- **T2** `npm i -g @playwright/cli` → exit 0, `playwright-cli 0.1.22` at `~/.local/bin/playwright-cli`;
  its chromium-1247 installed from its own directory. Smoke against a local fixture served by
  `python3 -m http.server 8099`: `open` (headless default) → snapshot with refs `e1`–`e5` →
  `fill "#name" David` → `click "#go"` → `eval` returned `"Hola David"` → `screenshot` written and visually
  reviewed → `console` listed the fixture log plus the expected `favicon.ico` 404. Session closed cleanly
  (`close` → `(no browsers)`).
- **T5** RED before the gate: `pnpm test:e2e` → exit 1, `1 failed, 14 skipped`, failure
  `page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/dashboard/productivity/`. GREEN after:
  exit 0, **15 skipped**. `npx tsc --noEmit` → exit 0 (the `e2e/` tree is inside `tsconfig.include` via `**/*.ts`).
- **T3 live, run 1** (delegated to an independent verifier; 15 tests, 1 worker, 1.4 m, exit 1): **12 passed,
  3 failed, 0 skipped**. No browser-launch error anywhere in the 127-line log; the retained traces carry a
  single browser string `HeadlessChrome/153.0.8010.12` (the newly installed `chromium-1243` toolchain), launched
  with no overrides at all (`baseURL` fell back to `http://localhost:3000`, no `PW_EXECUTABLE`, no
  `PLAYWRIGHT_BROWSERS_PATH`), and zero console errors. The 3 failures are pre-existing and not caused by this
  branch:
  - `sections.spec.ts:30` (`Cancelar|Reactivar`) and `sections.spec.ts:52` (`Editar saldo`): those buttons only
    render on the signed-in user's own rows. The throwaway user was empty (0 accounts / 0 subscriptions, read
    from the database); the owner's account holds 10 accounts and 1 subscription. Undocumented data
    precondition, now stated in the spec itself.
  - `notifications.spec.ts:26`: `strict mode violation: getByText('Nada por vencer en 7 días', { exact: true })`
    resolved to 2 elements, because the Avisos dialog and the «Próximos pagos» widget render the same empty-state
    copy — a genuine spec defect on the empty path, fixed by scoping both assertions to the dialog.
  - Side effect caught by the verifier: the passing layout-evidence spec rewrote 4 **tracked** files under
    `openspec/changes/2026-09-23-simplify-finance-productivity/evidence/` (`390/768/1440-after.png`,
    `metrics-after.json`). Restored after the run.
- **T3 live, differential diagnosis** (delegated, `--grep` only so the evidence spec never ran again):
  - **Scenario A**, still-empty user (`A_EXIT=1`): `bell badge` **passed** (5.4 s) → T6 confirmed; the two
    `sections` tests still failed with `element(s) not found` for `/Cancelar|Reactivar/` and `/Editar saldo/`.
  - **Scenario B**, after seeding one account and one subscription through the API (`cuenta_http=201`,
    `sub_http=201`, due `2026-10-14`): both `sections` tests **passed** (3.8 s / 3.2 s, `B_EXIT=0`), so the data
    precondition is proven rather than inferred. `npx tsc --noEmit` → exit 0.
- **T4 cleanup**: throwaway user deleted (`DELETE 1`; the database is back to 1 user / 0 e2e / 10 accounts / 1
  subscription / 11 categories / 3 movements), backend stopped (port 3000 free), the 4 evidence files restored
  with `git checkout --`, `frontend/test-results/`, `frontend/.next`, `frontend/out` and `backend/target` removed,
  `/tmp` and the CLI session leftovers (`.playwright-cli/`) removed, no chromium process left behind.

## Changed in the repository

- `frontend/e2e/productivity-layout.spec.ts` — `baseURL` reachability gate (T5).
- `frontend/e2e/notifications.spec.ts` — empty-state assertions scoped to the dialog (T6).
- `frontend/e2e/sections.spec.ts` — comment only, stating the data precondition of the two shells tests.
- `odd/tasks/playwright-toolchain.md` — this document.

Machine state (not repository content): `~/.cache/ms-playwright` now also holds `chromium-1243` +
`chromium_headless_shell-1243` (the repo driver) and `chromium-1247` + shell (the agent CLI);
`~/.local/bin/playwright-cli` (`@playwright/cli` 0.1.22); `~/.playwright/cli.config.json` sets the CLI's default
browser to chromium. The stale 1208 generation stays: it belongs to `proyecto_Davefit`.

## Out of scope

- firefox/webkit for the repository suite: `playwright.config.ts` declares no projects, so chromium is the
  only target.
- Deleting the 1208 browser generation: it belongs to `proyecto_Davefit` (Playwright 1.58.2).
- The layout invariants the evidence spec asserts: T5 changed only *when* that spec runs, never what it checks.
