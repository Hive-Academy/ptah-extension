# B19c lane report

## Files changed

- `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts`: exposes `analysisStartedAt` as a root-owned computed timestamp from the first analysis event; `reset()` clears the underlying stream and therefore the timestamp.
- `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.spec.ts`: verifies first-event ownership, reset, and a new run.
- `libs/frontend/setup-wizard/src/lib/components/analysis-stats-dashboard.component.ts`: derives elapsed time from `analysisStartedAt` and `injectWallClock('second', active)`; removes its component interval and timer state. Missing metrics display `—`.
- `libs/frontend/setup-wizard/src/lib/components/analysis-stats-dashboard.component.spec.ts`: verifies missing data, clock activation, remount elapsed time, and reset cleanup.
- `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.ts`: replaces the 250 ms interval with the shared second clock while handoff is pending.
- `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.spec.ts`: verifies the handoff label moves from 5 to 4 whole seconds on a one-second clock tick.

## Lane check

- `npm run verify -- -t test -p @ptah-extension/setup-wizard -- --testPathPatterns="setup-wizard-state|analysis-stats-dashboard|generation-workflow-shell" | Select-Object -Last 60`: passed, 1 Nx task succeeded (final rerun).
- `npx nx typecheck @ptah-extension/setup-wizard --parallel=1`: passed, 1 Nx task succeeded before the final missing-phase-label adjustment.
- Scoped `git diff --check`: passed.

## Decisions

- The first analysis stream event is the absolute start timestamp. The root store already owns that stream and clears it in `reset()`.
- An absent start or phase datum renders `—`, following the task acceptance over the older plan's `0:00` fallback. Known zero counts remain valid once events exist.
- The shell's existing `Math.ceil` countdown receives a second-cadence timestamp; its whole-second calculation remains unchanged.
- Setup-wizard and core have compatible `scope:webview` tags (`type:feature` to `type:core`). Ptah dependency indexing returned an incomplete result, so project tags and the existing core import were used to confirm the boundary.

## Anything not done

- Ptah diagnostics remained unavailable after two attempts (TypeScript check timed out); the targeted Nx typecheck passed as fallback.
- The broader batch gate was not run; the requested lane check passed.
