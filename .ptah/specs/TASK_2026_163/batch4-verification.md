# Batch 4 — Verification + Commit Report (team-leader, MODE 2)

**Task**: TASK_2026_163 — premium-gate purge (open-source move)
**Date**: 2026-07-19
**Verdict**: ✅ BATCH 4 COMPLETE — both lanes verified independently and committed.
**Commits**: Lane 4a `a317d5aa3` · Lane 4b `e349b7f2b`.

---

## Step 1 — Independent verification

### Lane 4a — Builders dashboard card (PASS)

| Check                                                            | Result                                                                                                                                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `builders-card.component.ts` + `.html` exist                     | ✅ both present under `libs/frontend/dashboard/src/lib/components/builders-card/`                                                                                                 |
| Standalone + OnPush + signals + `inject()`                       | ✅ `standalone: true`, `ChangeDetectionStrategy.OnPush`, `signal<boolean>`, `inject(ClaudeRpcService)`                                                                            |
| Dismiss wired to localStorage key `ptah.builders-card.dismissed` | ✅ seeded via `getItem(...) === '1'`; `dismiss()` writes `'1'` in try/catch; `@if (!dismissed())` gates the whole card                                                            |
| Link-out is exactly `command:execute` + `ptah.openPricing`       | ✅ `rpcService.call('command:execute', { command: 'ptah.openPricing' })` — no new RPC/command                                                                                     |
| Mounted after analytics card in `dashboard-grid.component.html`  | ✅ `<ptah-builders-card />` immediately follows `<ptah-analytics-card />`                                                                                                         |
| Registered in grid `imports` array                               | ✅ `imports: [LucideAngularModule, AnalyticsCardComponent, BuildersCardComponent]`                                                                                                |
| Exported from `dashboard/src/index.ts`                           | ✅ `export { BuildersCardComponent } ...`                                                                                                                                         |
| No license RPC in the card                                       | ✅ only match for `license` is the JSDoc line "no license RPC is ever called" — zero license calls                                                                                |
| R5 neutral copy (no trademarked AI names in non-JS)              | ✅ "Ptah is open source", "Ptah Builders", "community/training/priority support"; only `Claude*` token is the `ClaudeRpcService` JS identifier (safe — scanner flags non-JS only) |
| No modals / countdowns / "upgrade" verbs                         | ✅ static card, two native `<button>`s (Dismiss ghost + Explore primary), a11y labels + `aria-hidden` icon                                                                        |
| Dashboard typecheck                                              | ✅ `nx run @ptah-extension/dashboard:typecheck` → Successfully ran (exit 0)                                                                                                       |

**Delta accepted** (from 4a report): B4a.2 also required registering `BuildersCardComponent` in the grid's `imports` array (standalone component) beyond the task list's named files — necessary for the mount to compile; lower-risk than a template referencing an unimported component.

### Lane 4b — landing-page trial-guard removal + deferred 162 pricing cleanups (PASS)

Acceptance greps (specs excluded), re-run independently:

```
grep -rn "TrialStatusGuard|trial-ended|trialEnded" apps/ptah-landing-page/src | grep -v '\.spec\.ts'   → ZERO HITS
grep -rn "proYearlyPlan" apps/ptah-landing-page/src                                                      → ZERO HITS
grep -rniE "100-day|free trial" apps/ptah-landing-page/src --include=*.ts --include=*.html \
    | grep -v spec | grep -v legal/terms | grep -v legal/refund                                         → ZERO HITS
```

**R6 (TASK_2026_162 overlap)**: PASS. `git diff --stat` on `apps/ptah-landing-page` shows only guard / route / trial-ended / pricing-cleanup files (app.routes[.server], guards/trial-status.guard, pages/trial-ended, profile trial-ended-modal + orphaned handler cleanup in profile-page, pricing components/models/utils, environments). **No hero/sections copy files touched.**

**Landing typecheck**: `npx tsc --noEmit --project apps/ptah-landing-page/tsconfig.app.json` → exit 0.
(Note: project has no wired `typecheck` Nx target — the block is mis-nested inside `serve-static` options; pre-existing config bug, ran underlying `tsc` directly.)

---

## Step 2 — Commit

Files staged specifically per lane (never `git add -A`). No `.codex/agents/*.toml` or chat-store service files were present in the working tree at commit time (nothing to exclude). Pre-commit hook (lint-staged nx-affected-lint incl. di-lint, then `nx run ptah-electron:validate-deps` full backend build) **passed on both commits**; no `--no-verify`. Commitlint passed (allowed scopes `webview`/`landing`, body lines ≤100 chars).

- **`a317d5aa3`** `feat(webview): add Ptah Builders open-source promotion card` — 5 files, +125/-1 (Lane 4a).
- **`e349b7f2b`** `refactor(landing): remove trial guard and rewire pricing to Builders waitlist` — 16 files, +93/-1065 (Lane 4b).

Working tree clean after both commits (`git status --short` empty).

---

## Step 3 — tasks.md updated

Batch 4 header, Lane 4a, Lane 4b, and tasks B4a.1/B4a.2/B4b.1 marked ✅ COMPLETE with commit hashes; global status → 4/5 complete.

---

## Batch 5 carry-overs (pre-ruled for B5.6 purge-completeness grep)

These were intentionally left by Lane 4b and are **KEEP-scope / docs-pass, not out-of-scope purge misses** — recorded here so B5.6's `trialEnded|trial_ended|Upgrade to Pro|premium` grep has a pre-agreed disposition:

1. **`CommunityPlanCardComponent` "Trial Ended Alert" block** + `profile-details.component.ts` / `profile-header.component.ts` `isTrialEnded()` methods — key off snake_case `trial_ended` license **API status values** (status reporting), not the guard/route/modal machinery removed in Part 1. B5.6 disposition: KEEP (backend API contract) or a separate targeted decision — NOT a Batch 4 miss.
2. **`apps/ptah-landing-page/CLAUDE.md`** — still documents `TrialStatusGuard` on `/pricing` + `/profile`. Only `src/` was in Lane 4b scope. B5.6 disposition: docs-pass follow-up.
3. **`terms-page.component.ts` / `refund-page.component.ts`** — legal "100-day"/"free trial" copy deferred pending business sign-off (allowed by task prompt). B5.6 disposition: KEEP until legal sign-off.

Also noted from Lane 4b report (already handled, no action): `license-data.interface.ts` `'trial_pro'` union member + `environment*.ts` `proPriceIdYearly` constant left in place (backend/Paddle contract, out of landing-page-lane scope; no `pages/pricing` references remain).

---

## Next batch

**Batch 5 — test/e2e sweep + final verification gate** (last batch; no merge to main before it is green, per R4). Recommended executor per tasks.md: sub-agent `senior-tester` (owns the gate) + ≤2 CLI agent lanes for mechanical per-project spec updates.
