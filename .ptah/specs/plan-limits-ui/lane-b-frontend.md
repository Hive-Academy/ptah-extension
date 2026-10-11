# Lane B — frontend plan limits

## Files changed

- `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts`
- `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.spec.ts`
- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tile.component.ts`
- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tile.component.spec.ts`
- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tiles.ts`
- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-window-detail.component.ts`
- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-window-detail.component.spec.ts`
- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-usage-tile.component.ts`
- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-usage-tile.component.spec.ts`
- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/stats-limit-view-model.types.ts`
- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/stats-limit-view-model.spec.ts`

## Layout summary

Dashboard cards now use the 21rem responsive grid, a two-column header with refresh at top right and status below the title, and compact horizontal window rows. Shared source provenance appears once per card; mixed sources remain per window with titles. Empty and unknown-owner states have explicit copy. Session limit faces use fixed label/percent/chevron columns, a thin meter and a short relative reset. The expanded panel has labeled account, used, reset, observed, source and status rows. Lane subgroup detail uses the same row grid. Existing refresh, activity, evidence, cooldown, reset facts, lane subtotal, and expansion state remain.

## Verification

- `npx jest -c libs/frontend/dashboard/jest.config.ts libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.spec.ts --coverage=false --maxWorkers=1`: `Test Suites: 1 passed, 1 total`; `Tests: 36 passed, 36 total`.
- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tile.component.spec.ts libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-window-detail.component.spec.ts libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/stats-limit-view-model.spec.ts libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-usage-tile.component.spec.ts --coverage=false --maxWorkers=1`: `Test Suites: 4 passed, 4 total`; `Tests: 56 passed, 56 total`.
- `npx nx typecheck chat-ui --parallel=1`: `Successfully ran target typecheck for project @ptah-extension/chat-ui`.
- `npx nx typecheck dashboard --parallel=1`: `Successfully ran target typecheck for project @ptah-extension/dashboard`.
- `git diff --check` on lane B paths: no whitespace errors.
- Nx printed its Cloud free-plan-disabled warning after successful local typechecks.

## Decisions

- Reused existing Angular standalone, OnPush, signals, Tailwind and DaisyUI patterns. No new service or host access.
- Kept unknown usage as an em dash and omitted its meter.
- Read `unknownReason` through a property guard because the frontend typecheck currently resolves a shared declaration without that new field, although the backend lane has added it in source.
- Kept lane tiles as separate persisted disclosures; their expanded subgroup detail uses the same labeled row grid as the plan panel.

## Proposed Removals

None.
