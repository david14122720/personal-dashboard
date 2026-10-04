# Proposal — 2026-10-03-dashboard-rename-and-charts

## Why

The home surface is named «Resumen» in the sidebar and breadcrumb and «Resumen General» in its heading, while the route and the product vocabulary call it Dashboard. The mismatch makes the user translate names between navigation and content. Separately, the home shows movements only as a five-row snapshot: the user cannot see the expense/income shape over time or where the current period's spending goes, even though the movement ledger already holds both answers.

## What changes

1. **Visible identity becomes «Dashboard».** The sidebar rail item, the mobile tab, the breadcrumb section and the home `h1` all read «Dashboard». The dictionary values behind them — `nav.overview`, `dashboard.overview` and `dashboard.overviewTitle` — all become «Dashboard», including `dashboard.overview`, which currently has no consumer but would otherwise retain the old copy. This is a copy-only key-value change: key names stay, nothing is deleted, and the `/dashboard/` route, its `href` and the static-export path stay exactly as they are (no redirect, no renamed file, no new route).

2. **Two independent, initially collapsed chart disclosures on the home.**

   - **Totals trend (line).** Total expense vs total income per bucket, no category grouping, no netting, over N consecutive buckets oldest→newest reusing the existing counts — Día 14, Semana 8, Mes 12, Año 5 — with the existing Día/Semana/Mes/Año period control.
   - **Expense-by-category pie.** Expenses only, grouped by persisted backend `category_id`, scoped to the current local period selected by its own Día/Semana/Mes/Año control (default Mes): Día = today, Semana = trailing seven days ending today, Mes = current calendar month, Año = current calendar year. No date navigator.

   Each disclosure toggles on its own; opening one never opens, closes or changes the period of the other. Both read `GET /movements` (plus the already-existing accounts, categories and preferences reads) and no new endpoint.

3. **Currency contract unchanged and explicit.** Both charts use the existing Dashboard/preference currency; movements whose account currency differs are excluded from the aggregates, never converted and never summed together. Rows with a null `category_id` participate in the totals (not a category aggregate) but are excluded from the pie; local-only custom categories stay out of the pie because they have no backend id to join.

## Decisions taken before implementation

- **Supersede, narrowly.** The canonical `frontend-dashboard` spec forbids the old flow chart and category donut on the home because their data sources were removed. This change re-enables equivalent insight only through the surviving movement ledger, with new component names and no call to any removed aggregate path. All other retired-visual prohibitions stay in force.
- **Copy-only rename.** `nav.overview`, `dashboard.overview` and `dashboard.overviewTitle` are the three home identity values; renaming the shared `nav` key updates sidebar, mobile tab and breadcrumb at once. Key names stay unchanged, `dashboard.overview` has no consumer today and is renamed only so no stale identity copy survives, and no route or `href` changes.
- **Reuse over invention.** The totals trend reuses the existing bucket builder and line renderer; the period control is the existing pill component; the pie adds one small presentational Recharts component and one token palette. No new dependency, no migration, no backend change.
- **Owner delivery boundary.** No commit, push or deploy. Verification is local against the production DB with a disposable user that is deleted (rows cascade) afterwards; no destructive schema operation.

## Impact

- Surfaces: the Dashboard home (heading, two new chart sections) and the shell navigation/breadcrumb copy.
- Data: client-side aggregation over the existing `GET /movements`; no endpoint, DTO, response shape or SWR key change.
- Tests: old-copy assertions in unit and e2e specs are re-pointed; new unit tests cover the two transforms and the disclosure behavior; the live smoke is re-run locally for verification.
- Sequencing: `frontend/lib/i18n/es.ts` is touched by the rename and by the new chart copy, so those units run sequentially.

## Non-goals

- No change to the strip, the home widgets, the Finance category chart or its compare view.
- No date navigation (previous/next period), no new period kinds, no top-N/«Otras» bucketing in the pie.
- No `GET /movements/stats`, no server-side aggregation, no schema migration, no new dependency.
- No currency conversion, no per-movement currency field, no local-only category promotion into the API-backed set.
- No unrelated behavior change, no cleanup of the pre-existing stale `Flujo mensual` e2e assertion.

## Verification

1. Focused unit tests first (transforms, then components), then the full frontend suite, `tsc --noEmit` and the static-export build.
2. Local Playwright run against the live local stack pointed at the production DB, authenticated with a throwaway `--create-user` account: heading reads «Dashboard» at `<html lang="es">`, `/dashboard/` still resolves, both disclosures are collapsed on load, each expands/collapses independently, the trend shows the fixed bucket count and two non-netted series, the pie shows only expenses grouped by category for the selected current period, and the console stays clean at 1440/768/390.
3. The throwaway user is deleted at the end of the session; every row cascades. No commit, push or deploy is produced.
