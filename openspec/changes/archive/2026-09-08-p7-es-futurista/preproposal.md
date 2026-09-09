<!-- schema: gentle-ai.sdd-preproposal/v1 -->
# Pre-proposal state: p7-es-futurista

schema: gentle-ai.sdd-preproposal/v1
revision: 2
change: p7-es-futurista
project: personal-dashboard
date: 2026-09-08
pace: auto
artifact_store_mode: hybrid
delivery_strategy: auto-chain

## Exploration

- outcome: done — recommendation A+A+A+A (typed dictionary i18n; prune edge header; CSS-token theme; keep recharts), "Ready for Proposal: Yes".
- references: `openspec/changes/p7-es-futurista/exploration.md` · Engram topic `sdd/p7-es-futurista/explore` (obs 670, 672).

## Research

- selected: yes (`con_research`, single lane, completion mandatory before propose).
- request: minimal safe Permissions-Policy allowlist for a private dashboard in 2026 + Dokploy/Traefik headers middleware prune procedure (Q1 ad-tech token statuses; Q2 minimal allowlist + Traefik header syntax; Q3 locate/prune/verify procedure).
- requested classes: `documentation`, `open-web`.
- admission (attempt 1): denied — runtime grants `documentation = []`, `open-web = []`; no sources collected (revision 1, blocked; archived byte-copy at Engram obs 681, never mutated in place).
- admission (attempt 2): **granted** — dispatch re-declared evidence channels: `documentation` = Context7 (MDN, Traefik, Dokploy), `open-web` = live remote search executed via GitHub code/content REST APIs against `mdn/content` and `w3c/webappsec-permissions-policy` (no generic HTTP-fetch tool exists in the runtime; `mdn/browser-compat-data` unreachable and excluded — recorded as uncertainty U1 in the evidence artifact).
- outcome: **done** (revision 2) — all three questions answered with 10 admitted sources; validated claims C1–C10; per-token statuses: `attribution-reporting` Chrome-only/deprecated, `browsing-topics` deprecated+non-standard/opposed, `private-state-token-issuance`/`-redemption` experimental Chrome-only (default `*`), `join-ad-interest-group`/`run-ad-auction` flag-gated/zero MDN coverage (removed from web-exposed status), `private-aggregation` unrecognized everywhere. Recommended minimal header + Traefik YAML/label syntax + Dokploy locate/prune/verify procedure included.
- evidence references: `openspec/changes/p7-es-futurista/research.md` (revision 2, done) · Engram topic `sdd/p7-es-futurista/research` (obs 677, identical bytes) · archive obs 681 (rev 1 blocked).
- persistence: hybrid readback verified — OpenSpec file and Engram observation 677 both carry revision 2 with matching artifact bytes.

## Product decisions

- `con_research` — research selected: **confirmed** (orchestrator handoff).
- `url_ip` — browsed URL / edge to fix `http://192.168.50.120:8055/`: **confirmed**.
- `wealth_quitar` — remove dead `/dashboard/wealth/` nav item in i18n sweep: **confirmed**.

## proposal_ready

**true** — readiness matrix row `hybrid | done | valid | OpenSpec and Engram success; same revision and bytes on readback | confirmed → ready`. Evidence artifact `gentle-ai.sdd-research/v1` revision 2 (outcome `done`, 10 sources, all claims source-mapped) is identical in both hybrid stores with verified readback; all three product decisions are confirmed. `sdd-propose` may run; handoff carries state revision 2, the confirmed decisions above, and the research evidence references. The proposed minimal `Permissions-Policy` value and the "keep pruned header vs remove entirely" refinement flagged in research.md (Product choices section) are orchestrator-owned confirmations at propose time, not blockers.
