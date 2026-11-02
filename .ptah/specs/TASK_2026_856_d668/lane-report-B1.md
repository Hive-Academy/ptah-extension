# Batch B1 lane report

## Files changed

- Created `D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics\libs\frontend\core\src\lib\services\wall-clock.service.ts`.
- Created `D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics\libs\frontend\core\src\lib\services\wall-clock.service.spec.ts`.
- Modified `D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics\libs\frontend\core\src\lib\services\index.ts`.
- Wrote this report at `D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics\.ptah\specs\TASK_2026_856_d668\lane-report-B1.md`.

## Acceptance

- `WallClockService` is root provided. `index.ts` exports it, `injectWallClock`, `WALL_CLOCK_COARSE_MS`, and `WallClockCadence` through the existing core public index.
- Separate second and coarse signals have separate reference counts and at most one interval each. Intervals start with `NgZone.runOutsideAngular`; the visibility listener is shared while either cadence has subscribers.
- Every acquire refreshes its cadence signal. Hiding stops all intervals; showing refreshes acquired cadences immediately and restarts them. A missing `document.hidden` is treated as visible.
- Release closures are idempotent. The final release for a cadence stops its interval; the final release overall removes the listener.
- `injectWallClock` returns the same read-only signal exposed by `now`. Without `active`, its `DestroyRef` releases the acquisition. With `active`, an effect acquires under `untracked` only while the predicate is true and releases on cleanup and context destruction.
- Tests cover reference counts through timer counts, both cadences, refreshes, visibility, idempotence, zone entry, inactive gating, and both destruction paths.

## Lane check

Ran once: `npm run verify -- -t test -p @ptah-extension/core -- --testPathPatterns="wall-clock"` (PowerShell `Select-Object -Last 60` provided the requested tail equivalent). Exit code 0. Relevant tail:

```text
[verify 2026-10-30T17:00:12.734Z] lock slot 1 acquired after 453s: verify test (@ptah-extension/core)

 NX   1 task: 1 succeeded

Re-run with --output-style=static to inline logs.

  Run duration:      13.2s
  Cache:             0/1 hit (0%)
  Critical path:     13.1s (1 task)
  Recoverable time:  <1ms
[verify 2026-10-30T17:00:49.151Z] lock released after 36.4s, exit code 0
```

The dynamic Nx output did not print the requested `Running target ... for 1 project` header; it reported one task succeeded for the explicit `@ptah-extension/core` selection. Scoped Ptah diagnostics reported no errors in the three changed source files. They also listed existing errors in unrelated sibling specs; those files were left alone.

## Decisions

- Kept one visibility listener across both cadences, with one timer per acquired cadence.
- Cached read-only signal views so `now(cadence)` and `injectWallClock(cadence)` return the same signal identity.
- Read `.claude/skills/angular-frontend-patterns/SKILL.md` directly after finding it with Ptah file search; a dedicated skill invocation tool was unavailable in this lane.

## Not done

- Project-wide lint/typecheck and host checks were reserved for the batch gate under the run rules.
