# TASK_2026_163 — Context

**Type**: REFACTORING · **Workflow**: Partial (software-architect → team-leader → developers → QA)
**Created**: 2026-07-18 · **cli_delegation**: auto (available: ptah-cli "ollama cloud", ptah-cli "claude cli"; max 3 concurrent)

## User Intent

From /orchestrate: elevate all areas from the 2026-07-18 BD/repositioning session. User approved Task B: purge premium gating for the open-source move + in-app community promotion.

## Strategic Decisions (user-approved in discussion)

- Full open source, MIT/Apache direction; the code is not the moat — skills/community/training are.
- **Open-core boundary**: ALL local, single-user features become free forever. The reserved future-paid layer is hosted/team (shared memory/skill sync, hosted gateways, cloud runs) — not implemented here, just not contradicted.
- License server + WorkOS + Paddle stack is KEPT and repurposed as membership identity for "Ptah Builders" (training + community + priority support). Do not delete licensing infrastructure; disconnect it from feature enforcement.
- One-way door acknowledged: once gates are purged and shipped, features are never re-gated.
- In-app promotion must be tasteful: a dashboard card / post-task attribution style, never modal upsells or nags (OSS-audience goodwill).

## Known Gating Surfaces (starting points for blast-radius mapping — architect must verify and complete)

- `libs/backend/vscode-core` — FeatureGate + License services (see lib CLAUDE.md).
- Setup wizard: "7-step premium-gated onboarding" (libs/frontend/setup-wizard).
- Landing page: TrialStatusGuard, /trial-ended route (apps/ptah-landing-page) — portal stays, but in-app trial lockout flows go.
- Search terms: isPremium, FeatureGate, featureGate, premium, trial, license check call sites across apps/ptah-extension-vscode, apps/ptah-electron, apps/ptah-cli.

## Checkpoint 2 — APPROVED (user, 2026-07-18)

implementation-plan.md approved as written. Proceed: team-leader MODE 1 decomposition → batched execution per plan (B1 backend-dev → B2 backend-dev → B3 three lanes → B4 two lanes → B5 test gate).

## Handoffs from TASK_2026_162 (implementation-report.md deviations 4–5 + leftovers)

Add to Batch 4b/5 scope (landing page):

1. Pricing Builders card CTA: rewire `ctaAction` from Paddle checkout to waitlist link; `computeCtaText` in `pages/pricing/utils/plan-card-state.utils.ts:141,159` still returns "Start 100-Day Free Trial"; stale `ctaText` fields at `pricing-grid.component.ts:447,473` + docblock l.49.
2. Drop the yearly SKU (`proYearlyPlan`) + monthly/yearly toggle + "-17%" badge (currently shows stale "$50 / per year" against the new $29-49 monthly copy).
3. Legal pages (`terms-page`, `refund-page`) still state "100-day free trial" — business/legal owner must approve new wording alongside the Paddle terms change; do not silently reword.
4. `environments/environment*.ts` comments reference old $5/$50 trial pricing next to live Paddle price IDs — update when pricing wiring changes.
5. Legacy `plan-card.component.ts:61` trial badge (component appears unused by the grid — candidate for deletion).

## Constraints

- App must be fully functional with no account/sign-in (signed-out = full local functionality).
- Keep licensing RPC/types compiling where still used by the portal; delete dead code completely (no `_var` renames or `// removed` comments).
- VS Code marketplace trademark rules unchanged (CLAUDE.md "VS Code Marketplace (BLOCKING)").
- Related messaging changes on the landing page are TASK_2026_162's scope; avoid file conflicts with it (landing hero/sections/pricing copy belong to 162; guards/lockout logic belong to 163).
