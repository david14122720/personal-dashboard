# Visual verification recipe — `rediseno-integral-responsivo`

Every task in this feature is verified the same way. This file is the procedure; do not invent a different one.

## 0. Preconditions

The local app must be running and must contain the change:

```bash
# 1. Rebuild the static export AFTER any code change — the backend serves frontend/out from disk.
cd /home/david/Nextcloud2/Ubuntu/landing_personal/frontend && pnpm build      # ~17 s, must end with the 13-route table

# 2. Backend (already running normally; restart only if it died)
cd ../backend && DATABASE_URL='postgres://pdbuser:<DB_PASSWORD>@192.168.50.120:5434/pdbname' \
  PORT=3000 SESSION_TTL_HOURS=720 STATIC_DIR='/home/david/Nextcloud2/Ubuntu/landing_personal/frontend/out' \
  RUST_LOG=info setsid nohup ./target/debug/personal-dashboard-backend > /tmp/backend.log 2>&1 &

curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/health   # expect 200
```

Rules: PRODUCTION database only (never create, init or migrate a local DB), throwaway user only, never git, never commit.

## 1. Capture (the only supported way)

```bash
cd /tmp
TOKEN=$(curl -s -X POST http://127.0.0.1:3000/api/login -H 'content-type: application/json' \
  -d "{\"email\":\"$(grep -oP 'EMAIL=\K.*' /tmp/e2e-user.env)\",\"password\":\"<E2E_USER_PASSWORD>\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

playwright-cli -s=cd open "http://127.0.0.1:3000/login/"
playwright-cli -s=cd eval "() => { localStorage.setItem('dashboard-token', '$TOKEN'); return 'seeded'; }"

for SIZE in "390 844" "768 1024" "1440 900"; do
  set -- $SIZE
  playwright-cli -s=cd resize "$1" "$2"
  playwright-cli -s=cd goto "http://127.0.0.1:3000/dashboard/<surface>/"
  # MANDATORY wait: without it the panels render as skeletons and every comparison is a false negative
  playwright-cli -s=cd eval "async () => { await new Promise(r => setTimeout(r, 2500)); return 'settled'; }"
  playwright-cli -s=cd screenshot
done
ls -t /tmp/.playwright-cli/*.png | head -3     # newest three = the captures
```

`playwright-cli` is the **official agent CLI** (`@playwright/cli`, config at `~/.playwright/cli.config.json`), NOT the deprecated `playwright-cli` npm package. Screenshots land in `/tmp/.playwright-cli/page-*.png` and are **viewport-sized**, so capture once per breakpoint.

Console errors and horizontal overflow in the same session:

```bash
playwright-cli -s=cd eval "() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, small: Array.from(document.querySelectorAll('button,a[href],input,select')).filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.width < 44 || r.height < 44); }).map(el => (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 24)) })"
```

`overflow` must be `<= 0`. Every entry in `small` must be justified (an icon inside a ≥44px parent is fine; the design's own chips are 24-28px and are not touch targets).

## 2. Data

The throwaway user is seeded with realistic data (6 accounts, 5 movements, 3 goals, 8 tasks, 4 events, 3 notes, 2 subscriptions, 3 assets, 5 habits with 47 logs and streaks of 12/2/6/9/3 days). Credentials: `/tmp/e2e-user.env`. Re-seeding: `python3 /tmp/seed_e2e.py`.

A card may legitimately render an empty state — say so explicitly instead of treating it as a defect.

## 3. Compare against the design

Design truth, in order of authority:
1. The prototype **HTML** — `odd/design/stitch-control-deck/html/<surface>.html` (exact classes, copy and structure). This is the authority; cite `file:line`.
2. The prototype **screenshot** — `odd/design/stitch-control-deck/shots/<surface>.png`. Useful for overall composition, but they are downscaled thumbnails: never read a class, a label or a number out of them, and never conclude that the DOM differs because the thumbnail looks different.
3. `odd/design/stitch-control-deck/DESIGN-SPEC.md` — the decisions (D1-D10) that override the prototypes where they contradict each other (canonical shell, IA that must not be invented, token mapping, no icon-font dependency).

Report each discrepancy as: **surface · breakpoint · what the prototype says (file:line) · what the app renders (screenshot path) · severity (blocks fidelity / cosmetic / intentional deviation)**.

Intentional deviations that must NOT be reported as defects: the shell uses the real app IA (D2), icons are inline SVG (D3), charts are Recharts restyled rather than hand-drawn SVG (D8), light mode is out of scope (D9), empty data renders the prototype's empty state (D10), and the product version/brand strings come from the real app rather than a prototype's invented `v2.4`/`v1.4 Enterprise`.

## 4. Functional gate (a redesign must not break behavior)

```bash
cd /home/david/Nextcloud2/Ubuntu/landing_personal/frontend
node node_modules/typescript/bin/tsc --noEmit        # exit 0  (NEVER bare `npx tsc`)
pnpm test                                            # full vitest suite, report the exact pass count
```

Then smoke the touched surface against the live app: sign in with the throwaway user, and exercise the surface's real operations (open a modal, add and delete a record, toggle a habit, change month/period). A visual pass that leaves a broken button is a failed task.

`frontend/e2e/productivity-layout.spec.ts` additionally asserts, at 390/768/1440, no horizontal overflow, ≥44px hit areas and `xl` column spans — useful, but it rewrites four tracked files under `openspec/changes/2026-09-23-simplify-finance-productivity/evidence/` on every run: restore them with `git checkout -- openspec/changes/2026-09-23-simplify-finance-productivity/evidence/` afterwards (restoring a file you did not mean to change is not a redesign edit, and nothing is ever committed).

## 5. Cleanup after every verification

Stop nothing you did not start; leave no browser processes (`pkill -f '[c]hromium'` only if you started them), delete nothing tracked, and never leave the throwaway user's data in a state that hides a defect from the next verifier.
