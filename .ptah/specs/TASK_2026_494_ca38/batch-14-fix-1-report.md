# Batch 14 fix round 1 report

All four requested fixes are implemented. Required verification passed: lint, typecheck, and test. Test counts: **10 suites passed, 200 tests passed** (including the parallel B13 suites present at verification time). No B13 failures.

## Files written

- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\mcp-apps-page\src\lib\services\apps-session.service.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\mcp-apps-page\src\lib\services\apps-session.service.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\.ptah\specs\TASK_2026_494_ca38\batch-14-fix-1-report.md

## Fixes with file:line

All source references below are relative to D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\mcp-apps-page\src\lib\.

1. `services/apps-session.service.ts:223`: successful chat:start now checks isAppsSliceOf against the original key and routing ID. If ownership was lost, `:497` performs best-effort chat:abort using the returned session ID, or the original routing ID when the start response contains no session ID. The host's session registry supports correlation-ID lookup for interruption. The helper catches transport errors and logs category-only messages for ownership loss, transport failure, and refusal; no payload values are logged. It never patches a slice or current session liveness. Already-released frontend claims are not re-created or double-released.
2. `services/apps-session.service.ts:362`: recordFocusKey returns immediately when the active workspace has no slice, preserving map identity and avoiding phantom state.
3. `services/apps-session.service.ts:113` and `:167`: replaced the permanent boolean latch with previousWorkspaceKey tracking. Every observed implicit-to-real transition drops the implicit slice through the existing teardown path.
4. `services/apps-session.service.ts:348`: discard returns immediately for a missing key, without a signal update.

## New specs

- `a focus record on a never-started workspace leaves the slices map unchanged` (`apps-session.service.spec.ts:443`).
- `drops the implicit slice on two separate implicit-to-real transitions` (`:451`).
- `aborts a successful pending start after %s without recreating state or claims` (`:469`), for implicit drop, discard, and workspace removal. Checks the abort address, unchanged map identity after cleanup, absent implicit entry, released claims/surface, and exactly one frontend teardown.
- `keeps a newer slice unchanged when late-start abort fails by %s` (`:519`), for transport rejection and host refusal. Checks non-throwing completion, preserved newer conversation/claims, and payload-free logs.

Seven new test cases in total. All existing B12 and B14 assertions remain unchanged; none were deleted or weakened. Existing shared fixtures are unchanged. The existing focus-partition spec now starts a real conversation in each workspace before recording focus (and is async), an explicit precondition required by the new no-phantom-slice contract. Its original assertions and focus-restoration intent are preserved. Directive and directive specs were not changed.

## Verification

Ran from the specified worktree root:

`npx nx run-many -t lint,typecheck,test -p @ptah-extension/mcp-apps-page --skip-nx-cache`

Exit code 0. Nx summarized successful tasks without printing their logs; counts were read from its saved terminal output at `C:\Users\abdal\.nx\d66630b900f534d5\cache\terminalOutputs\16024530939720513393`, without rerunning tests. No git commands were run. No other worktree files were edited.

Last 10 lines of verification output:
```text

 NX   Successfully ran targets lint, typecheck, test for project @ptah-extension/mcp-apps-page


Output of 3 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

  Run duration:      13.8s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     12.7s (1 task)
  Recoverable time:  1.1s (8% of the run)
```
