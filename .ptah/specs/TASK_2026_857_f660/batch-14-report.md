# Batch 14 report

## Tasks and evidence

- **14.1 — DI, barrel and roles:** Added `SCOPE_CHECK_SERVICE`, `PREFLIGHT_REUSE_CACHE` and `HOST_ROUTING_SETTING` tokens and cached factories. The route service receives the shared cache. Exported the B13 scope classes, scope contracts, summary builder and `BUILTIN_SUBAGENT_ROLES` from the lane-routing barrel. `phase-plan.ts` uses the exported role set. The existing task-kind classifier registration remains present.
- **14.2 — pre-flight reuse:** `RouteDecideService.decide` accepts an optional session key. On a pre-flight cache hit it returns a schema-validated copy with zero usage and the required reuse reason, without opening or dispatching a model caller. Misses use the existing pre-flight path. The gate-0.1 branch was not changed. `route-decide.preflight.spec.ts` covers a confirmed hit and misses for fingerprint, missing key, pending or unknown continuity, disabled setting and invalidation. Final lane-routing tests passed. The first run had one assertion error in the new spec, corrected before the passing rerun.

## Absolute paths touched

- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-routing\src\lib\di\tokens.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-routing\src\lib\di\register.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-routing\src\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-routing\src\lib\pipeline\phase-plan.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-routing\src\lib\route-decide.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-routing\src\lib\route-decide.preflight.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\.ptah\specs\TASK_2026_857_f660\batch-14-report.md`

## Risks handled

- **R1/R7:** Used the committed B13 scope implementations and kept edits within the six B14-owned source/spec files. No concurrent batch files were edited; final scoped checks passed.
- **R9:** Required Electron, VS Code and CLI host typechecks all passed after the shared DI and barrel changes.
- **R12/privacy:** Added no swallow, log content, persisted request text, or new cross-library dependency. Cache validity remains inside the B13 cache.
- **Gate-0.1:** The cache lookup is inside the parsed `pre-flight` branch only; existing route-decide tests passed.

## Verify tails

`ptah_get_diagnostics` scoped to all six changed files: `Errors: 0 | Warnings: 0` (clean coverage). Rechecked the spec after its assertion correction: same result.

`npm run verify -- -p @ptah-extension/lane-routing,@ptah-extension/agent-sdk 2>&1 | Select-Object -Last 40` (final run, exit 0):

```text
NX   6 tasks: 6 succeeded, 1 cached
Run duration:      1m 20s
Cache:             1/6 hit (17%)
[verify 2026-10-30T19:16:37.654Z] lock released after 85.9s, exit code 0
```

`npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli 2>&1 | Select-Object -Last 40` (exit 0):

```text
NX   3 tasks: 3 succeeded
Run duration:      1m 22s
Cache:             0/3 hit (0%)
[verify 2026-10-30T19:21:28.960Z] lock released after 87.6s, exit code 0
```

## Decisions

- **Reuse lookup location:** Chose the parsed pre-flight branch before `openCaller`, over checking inside the model dispatch method. Evidence: Component 14 requires zero model requests on a hit and leaves gate-0.1 untouched; `decide` already separates those branches. Reversible.
- **Cache ownership:** Injected one `PreflightReuseCache` through a cached DI factory, over constructing a cache per service call. Evidence: Component 13 specifies in-memory state per session and the repository's `instanceCachingFactory` pattern in `di/register.ts`. Reversible.
- **Role source:** Exported the existing phase-plan role set as `ReadonlySet<string>`, over duplicating values in the barrel. Evidence: Component 13/F7 and D-19 name `phase-plan.ts` as the public available-role source. Reversible.

## Issues outside scope

None observed in the final required checks.
