# Handoff — Production-SaaS Repositioning + Open-Source Gating Purge

**Date**: 2026-07-19 · **Branch**: `ak/elevate-video-and-tasks`
**Commits**: `7c0dde75b` (feat(landing): repositioning, TASK_2026_162) · `c00ed38` (refactor!: gating purge B1–B2, TASK_2026_163)
**Task folders** (gitignored, local): `.ptah/specs/TASK_2026_162/`, `.ptah/specs/TASK_2026_163/`

## Strategic context (why these tasks exist)

BD research (2026-07-18) concluded the horizontal "AI employee" pitch is contested by free OSS
(Hermes Agent ~110k stars, OpenClaw ~375k stars — both match memory/skills/subagents/cron/messaging).
The validated wedge: **the prototype-to-production gap for SaaS** — vibe-coded apps (Lovable/Bolt/Replit)
demo well, then fail on multi-tenancy/billing/security (65% of live vibe-coded apps have security issues,
per escape.tech; buyers pay $199–599 boilerplates + $500–3k audits + $5k–25k/mo rescue retainers).

Approved decisions:

1. **Positioning**: "The AI dev team that ships production-grade SaaS" — target solo technical founders
   and 2–10-person agencies. Hero headline A: _"It Knows Your Architecture. It Ships the SaaS."_
   Headline B (_"Vibe Coding Gets You a Demo. Ptah Ships the SaaS."_) is the Comparison section H2.
2. **Business model**: app goes fully open source; ALL local single-user features free forever
   (one-way door, user-approved). Monetization = **Ptah Builders** membership ($29–49/mo anchor:
   live training, PRD-to-production curriculum, member skill packs, priority support) + future
   hosted/team layer (shared memory/skill sync, hosted gateways, cloud runs — the reserved never-free-to-build layer).
   License server + WorkOS + Paddle KEPT as membership identity. Community: Discord free (via Ptah's own
   gateway) + Circle for paid (has API/SSO to integrate with existing WorkOS/Paddle portal; Skool rejected — closed API).

## TASK_2026_162 — Landing repositioning: ✅ DONE (committed `7c0dde75b`)

Content spec approved by user; implementation visual-reviewed **APPROVED** (2 blocking layout fixes applied).
Artifacts: `content-spec.md`, `implementation-report.md`, `visual-review.md` + `screenshots/` in the task folder.

Deferred to 163 (recorded in `.ptah/specs/TASK_2026_163/context.md` "Handoffs" section):

- Pricing Builders card CTA still fires Paddle checkout and reads "Start 100-Day Free Trial"
  (`pages/pricing/utils/plan-card-state.utils.ts:141,159`; stale `ctaText` at `pricing-grid.component.ts:447,473`).
- Yearly SKU (`proYearlyPlan`) + billing toggle still show stale `$50/year` — drop both.
- Legal pages (`terms-page`, `refund-page`) still say "100-day free trial" — needs business/legal sign-off.
- `environments/environment*.ts` comments reference old $5/$50 pricing next to live Paddle price IDs.
- Legacy `plan-card.component.ts` (unused by grid) still renders a trial badge — deletion candidate.
- Builders waitlist CTA is `href="#waitlist"` placeholder — no waitlist backend exists yet.

## TASK_2026_163 — Premium-gate purge: 🟡 Batches 1–2 DONE (committed `c00ed38`), Batches 3–5 REMAIN

Plan: `.ptah/specs/TASK_2026_163/implementation-plan.md` (user-APPROVED; blast-radius map with file:line
rulings, batch definitions, 9-item risk register). Decomposition: `tasks.md` in the same folder.

**Done (B1, team-leader verified + B2):** RPC license middleware, `FeatureGateService`, `McpLicenseGate`,
activation lockouts (VS Code + Electron incl. Electron `bootstrap.ts` welcome-lockout), license-reactivity →
unconditional `subsystem-bringup.ts`; `isPremium` removed end-to-end across shared types, agent-sdk,
rpc-handlers (`ChatPremiumContextService` → `ChatSdkContextService`, token `PREMIUM_CONTEXT` → `SDK_CONTEXT`),
agent-generation, gateway-chat-bridge, cli-agent-runtime, skill-synthesis, cron-scheduler, harness AI services;
premium checks + "upgrade to Pro" errors deleted from enhanced-prompts/setup/wizard handlers.
`ALLOWED_METHOD_PREFIXES` (rpc-handler.ts) verified byte-identical (injection guard — NEVER remove).
di-lint green; electron validate-deps (full backend lib builds) green.

**Remaining — Batch 3 (frontend purge, 3 parallel lanes per tasks.md):**

- 3a (frontend-developer): delete `trial-ended-modal`, `trial-banner`, `community-upgrade-banner` (chat-ui),
  purge app-shell/electron-shell trial UI + `isPremium` computeds, DELETE license-blocked `welcome` view +
  all `'welcome'`/`isLicensed` routing (webview app.ts, webview-html-generator, angular-webview.provider,
  electron preload), settings upsell blocks, REPOINT `license-status-card` → Builders membership card,
  chat-empty-state upgrade badge.
- 3b (CLI agent): setup-wizard `premium-upsell` + `'premium-check'` step + wizard-view licenseState gating;
  marketplace hub pro gate.
- 3c (CLI agent): CLI/TUI copy repoint (router.ts "premium-gated" wording, doctor hint, TUI LicenseSection).

**Remaining — Batch 4:** 4a Builders dashboard card (spec in implementation-plan §3: dismissible,
localStorage `ptah.builders-card.dismissed`, clone `AnalyticsCardComponent` pattern, link-out via existing
external-open mechanism, no modals/nags); 4b landing-page guard removal (`TrialStatusGuard`, `/trial-ended`
route + page + profile modal) + the 162 handoff items above (CTA rewire, yearly SKU drop).

**Remaining — Batch 5 (senior-tester gate):** spec/e2e sweep — the full list of gating-assertion tests is in
implementation-plan §4 Batch 5 (mcp-license-gate.spec DELETE, container smoke FEATURE_GATE assertions,
license-watcher/wizard-dom e2e, showcase scenes, etc.). Also `isPremiumTier()` + export still exist in
`vscode-core/src/services/license.service.ts:50` and `src/index.ts:73` — spec files still consume them;
remove with the test sweep. Final gate: `npm run typecheck:all`, `npm run lint:all`, `npm run test`,
manual smoke = Electron with NO license → full chat/wizard/marketplace/dashboard.

## Incident log (matters for the next session)

- A concurrent session ("vertical marketing video", left `stash@{0}` created on `ak/quick-fix-discord`)
  ran stash/checkout cycles on this worktree mid-task, reverting files under edit. All work was recovered
  and is now committed. Recovery artifacts in `.ptah/specs/TASK_2026_163/`: `wip-staged.patch`,
  `wip-unstaged.patch`, `wip-untracked-backup/` — safe to delete once the commits are confirmed pushed.
  If parallel sessions must share this repo again, give the other session its own `git worktree`.
- Pre-commit gates that bit us: lint-staged runs `nx affected --target=lint` (incl. **di-lint** — every
  `@inject` token must have a `register*()`), then `nx run ptah-electron:validate-deps` which **fully
  builds all backend libs (with typecheck)**. Commitlint: scopes limited to
  [webview, vscode, vscode-lm-tools, deps, release, ci, docs, hooks, scripts, landing, license-server, electron, cli],
  body lines ≤100 chars.

## Deliberately NOT committed (pre-existing, unrelated)

`.codex/agents/*.toml` (15 files) and `libs/frontend/chat/src/lib/services/chat-store/
{compaction-lifecycle,session-loader}.service.ts` — modified before this work began; left in the working tree.

## How to continue in a new session

1. Read this doc, then `.ptah/specs/TASK_2026_163/implementation-plan.md` + `tasks.md`.
2. `/orchestrate TASK_2026_163` (continuation mode) — next step is team-leader verification that B2 residue
   is really gone (acceptance greps in tasks.md), then Batch 3 lanes in parallel.
3. After Batch 5 green: decide license (MIT/Apache-2.0 lean), make the repo public, rewire pricing CTA to a
   real Builders waitlist, and stand up Discord (via Ptah gateway) + Circle.

## Open business decisions (not code)

- Final Builders price point ($29 vs $49 vs tiered) and whether an annual SKU returns.
- OSS license choice (MIT/Apache vs AGPL) — affects nothing in the purge, blocks the public-repo step.
- Next.js/Supabase skill pack vs owning the opinionated Nx/NestJS/Angular stack (the biggest open
  positioning risk: indie-founder market skews Next.js).
- Legal-page rewording (trial removal) alongside Paddle terms.
