# P1-16b renderer route and entry link

## Files changed

- `apps/ptah-extension-webview/src/app/app.routes.ts`: lazy `/review-runs` route, Electron `canMatch` guard, surface provider.
- `apps/ptah-extension-webview/src/app/review-only-surface.guard.ts`: review-specific guard using shared availability check.
- `apps/ptah-extension-webview/src/app/app.routes.spec.ts`: route export and guard checks.
- `apps/ptah-extension-webview/src/app/webview-routing.spec.ts`: actual host redirect/lazy navigation checks and updated route invariants.
- `libs/frontend/cron-scheduler-ui/src/lib/components/cron-scheduler-tab.component.ts`: accessible review runs link in Schedules header, visible on Electron.
- `libs/frontend/cron-scheduler-ui/src/lib/components/cron-scheduler-tab.component.spec.ts`: visibility and navigation checks.
- `libs/frontend/core/src/lib/routing/review-surface-availability.ts` and `index.ts`: single review availability check shared by guard and link.
- `libs/shared/src/lib/types/webview-surface.types.ts` and `.spec.ts`: register the route in the canonical surface ID contract.

## AC to spec

| Acceptance criterion | Spec evidence |
| --- | --- |
| Route resolves to page when enabled | `app.routes.spec.ts` lazy export assertion; `webview-routing.spec.ts` Electron navigation and lazy load assertion |
| Route redirects when disabled | `app.routes.spec.ts` guard assertion; `webview-routing.spec.ts` VS Code navigation to chat without lazy load |
| Link visible only when enabled | `cron-scheduler-tab.component.spec.ts` Electron/VS Code visibility assertion |
| Link navigates to route | `cron-scheduler-tab.component.spec.ts` click and Router URL assertion |

## Decisions

- Used `isReviewSurfaceAvailable(VSCodeService)` as the single review UI capability check, called by the review route guard and Schedules link. It reads `isElectron` in P1. Options: use existing Electron signal; add a new renderer capability transport. Evidence: `apps/ptah-electron/src/rpc-host-profile.ts` enables `review` only for Electron; `VSCodeService` exposes host identity but no RPC host-profile capability field; the spawner confirmed this is equivalent in P1. Reversible: yes, a future renderer capability bridge can replace the helper implementation in one place.
- Added `review-runs` to the shared surface IDs because `surfaceActiveFor`, route restoration, and navigation use the canonical `ViewType` list. Reversible: yes.

## Verification and limits

- `ptah_get_diagnostics` reports no errors in changed files. It reports unrelated errors in unchanged sibling files (including contrast specs, zone config spec, and core test mocks).
- Nx/npm checks and Electron screenshots were not run, per D26 and D33. The orchestrator owns those checks.
- No skill-loading tool or skill catalogue was exposed to this lane, so `angular-frontend-patterns` could not be loaded. Existing repository patterns and the supplied Angular guidance were followed.
