# TASK_2026_163 Batch 4 — Lane 4b Report

Scope: remove trial-lockout guards/routes from `apps/ptah-landing-page` and apply the deferred TASK_2026_162 pricing cleanups. No commit was made (per instructions).

## Part 1 — Trial lockout removal

| Item | Action  | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a    | Deleted | `apps/ptah-landing-page/src/app/guards/trial-status.guard.ts` (`TrialStatusGuard`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| b    | Edited  | `app.routes.ts` — removed the `TrialStatusGuard` import, both `canActivate` usages (`/pricing`, `/profile`), the `/trial-ended` route, and the guard's JSDoc line                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| c    | Edited  | `app.routes.server.ts` — dropped `trial-ended` from the "stays client-rendered" doc comment (route never existed in `serverRoutes`, so no array entry to remove)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| d    | Deleted | `apps/ptah-landing-page/src/app/pages/trial-ended/` (directory + `trial-ended-page.component.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| e    | Deleted | `pages/profile/components/trial-ended-modal.component.ts` + its export in `pages/profile/components/index.ts`. Grepped `ptah-trial-ended-modal` / `TrialEndedModal` under `pages/profile` — the component was **never mounted** in `profile-page.component.ts`'s template (no `<ptah-trial-ended-modal>` tag, no `(downgradeToCommunity)` binding). Its only live remnant was the orphaned handler `handleDowngradeToCommunity()` + `isDowngrading` signal on `ProfilePageComponent`, which existed solely to receive the modal's `downgradeToCommunity` output and had zero callers once the modal never mounted. Removed both as part of "removal means removal" — verified zero references to `handleDowngradeToCommunity`/`isDowngrading`/`downgrade-to-community` elsewhere in `profile-page.component.ts` before deleting (the identically-named signal/endpoint on `trial-ended-page.component.ts` was already gone with that file's deletion in item d). |

## Part 2 — Deferred TASK_2026_162 pricing cleanups

- **(f)** `pages/pricing/utils/plan-card-state.utils.ts` — `computeCtaText`'s `'start-trial'` case and `default` fallback now return `'Join the Builders Waitlist'` instead of `'Start 100-Day Free Trial'`.
  - Read the full plan-card state model first (`computeBadgeVariant`, `computeCtaVariant`, `isPortalAction`, etc.) to scope the rewire correctly: `ctaVariant() === 'start-trial'` is exactly the default state shown to unauthenticated visitors / non-subscribers — the one that used to read "Start 100-Day Free Trial".
  - `pro-plan-card.component.ts`: for that variant, the CTA now renders as a plain `<a href="#waitlist">` (same button styling via `ctaButtonClass()`) instead of a `<button (click)="handleClick()">` that emitted `ctaClick` into the Paddle checkout flow. All other CTA variants (`current-plan`, `reactivate`, `update-payment`, `resume`, `upgrade`, `upgrade-now`) are untouched — those are existing-subscriber portal/upgrade paths, not the trial/checkout entry point named in the task, and Paddle checkout machinery in `pricing-grid.component.ts` (`handleCtaClick`, `proceedWithCheckout`, `configError`, etc.) still serves them. `isCtaDisabled()`'s price-ID-placeholder gate no longer checks `'start-trial'` since that state is a link, not a disablable checkout button.
- **(g)** `pricing-grid.component.ts` — `proMonthlyPlan.ctaText` (was `'Start 100-Day Free Trial'`) and the duplicate on the now-deleted `proYearlyPlan` both resolved to `'Join the Builders Waitlist'` on the surviving single plan object (see h). Class-level doc comment updated to drop the stale "$5/month, $50/year (100-day trial)" line.
- **(h)** Dropped the yearly SKU, scoped to `pages/pricing` per the task's grep instruction:
  - `pricing-grid.component.ts`: removed `proYearlyPlan` entirely; renamed `proMonthlyPlan` → `proPlan` (no more "monthly" distinction once yearly is gone) and dropped its stale `trialDays: 100` field; updated the `<ptah-pro-plan-card>` binding to `[plan]="proPlan"`; simplified `triggerAutoCheckout` (single `'pro-monthly'` valid key, no more monthly/yearly `switch`); removed the now-single-branch `getPlanKey()` helper and inlined `'pro-monthly'` at its two call sites in `handleCtaClick`.
  - `pro-plan-card.component.ts`: removed the inline Monthly/Yearly billing-toggle UI block, the `monthlyPlan`/`yearlyPlan` inputs, `_billingPeriod` signal, `setBillingPeriod()`, and the `activePlan` computed — replaced with a single `plan = input.required<PricingPlan>()` and all `activePlan()` reads updated to `plan()`. Dropped the now-unused `signal` import.
  - Deleted `pages/pricing/components/billing-toggle.component.ts` (`BillingToggleComponent`, selector `ptah-billing-toggle`) — verified zero references anywhere in the app (it was never wired into `pro-plan-card.component.ts`, which had its own inline toggle markup instead); it was pure dead code and squarely "the monthly/yearly billing toggle" the task asked to remove.
- **(i)** `src/environments/environment.ts` / `environment.production.ts` — reworded the stale `$5/month, $50/year (100-day trial)` comments to describe the Builders monthly membership; **Paddle price IDs themselves were not changed**, including `proPriceIdYearly` (left in place, now commented `// Legacy yearly price ID, no longer offered`, since removing/renaming the ID constant was out of scope — nothing under `pages/pricing` references it anymore per the acceptance grep). Caught and fixed a comment-label transposition I introduced mid-edit on `environment.production.ts` before finalizing (verified by re-reading the file).
- **(j)** `pages/pricing/components/plan-card.component.ts` (`PlanCardComponent`, selector `ptah-plan-card`) — grepped `\bPlanCardComponent\b` and `ptah-plan-card` app-wide (word-boundary, to avoid false positives from `CommunityPlanCardComponent`/`ProPlanCardComponent` which contain the substring). **Zero references anywhere outside its own file** — deleted.

### Other stale "100-day"/"free trial" text found and fixed (outside the task's explicit line list, but required by the acceptance grep)

- `pages/pricing/models/pricing-plan.interface.ts` — top doc comment ("Pro: $5/month, $50/year (100-day trial...)") and a `PlanBadgeVariant` JSDoc example ("30-Day Free Trial") reworded.
- `pages/profile/models/license-data.interface.ts` — `'trial_pro'` plan-value comment reworded to drop "100-day" (the `'trial_pro'` union member and its handling were **not** changed — that's the backend API contract, out of scope for a landing-page-only lane).

### Explicitly left untouched (per instructions)

- `terms-page.component.ts`, `refund-page.component.ts` — legal copy, pending business sign-off.
- `CommunityPlanCardComponent`'s "Trial Ended Alert" block and `profile-details.component.ts`/`profile-header.component.ts`'s `isTrialEnded()` methods — these key off `license().status`/`licenseReason === 'trial_ended'` (snake_case API values, not the guard/route/modal machinery named in Part 1) and are unrelated to the acceptance grep, which is case-sensitive on `trialEnded`/`trial-ended`/`TrialStatusGuard`.
- `apps/ptah-landing-page/CLAUDE.md` — still documents `TrialStatusGuard` on `/pricing` and `/profile`; not edited since only `src/` files were in scope for this lane, flagging as a docs follow-up.

## Acceptance

```
$ grep -rn "TrialStatusGuard|trial-ended|trialEnded" apps/ptah-landing-page/src | grep -v '\.spec\.ts'
(no output — zero hits)

$ grep -rn "proYearlyPlan" apps/ptah-landing-page/src
(no output — zero hits)

$ grep -rniE "100-day|free trial" apps/ptah-landing-page/src --include=*.ts --include=*.html \
    | grep -v '\.spec\.ts' | grep -v "pages/legal/terms-page.component.ts" | grep -v "pages/legal/refund-page.component.ts"
(no output — zero hits)
```

Typecheck (project has no wired `typecheck` Nx target — the `typecheck` block in `apps/ptah-landing-page/project.json` is nested inside `serve-static`'s options rather than being a sibling target, a pre-existing config bug unrelated to this lane; ran the underlying command directly instead):

```
$ npx tsc --noEmit --project apps/ptah-landing-page/tsconfig.app.json
EXIT CODE: 0
```

Also ran `eslint` on all touched files — clean, no unused-import/unused-var findings.

## Files touched

**Deleted:**

- `src/app/guards/trial-status.guard.ts`
- `src/app/pages/trial-ended/` (dir + `trial-ended-page.component.ts`)
- `src/app/pages/profile/components/trial-ended-modal.component.ts`
- `src/app/pages/pricing/components/billing-toggle.component.ts`
- `src/app/pages/pricing/components/plan-card.component.ts`

**Modified:**

- `src/app/app.routes.ts`
- `src/app/app.routes.server.ts`
- `src/app/pages/profile/components/index.ts`
- `src/app/pages/profile/profile-page.component.ts`
- `src/app/pages/profile/models/license-data.interface.ts`
- `src/app/pages/pricing/components/pricing-grid.component.ts`
- `src/app/pages/pricing/components/pro-plan-card.component.ts`
- `src/app/pages/pricing/utils/plan-card-state.utils.ts`
- `src/app/pages/pricing/models/pricing-plan.interface.ts`
- `src/environments/environment.ts`
- `src/environments/environment.production.ts`

No `*.spec.ts` files were touched. No commit was made.

LANE 4B DONE
