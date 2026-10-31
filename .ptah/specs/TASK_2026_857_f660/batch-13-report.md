# Batch 13 report

## Tasks and evidence

- **13.1 Scope check:** Added `ScopeCheckService` and `buildPreflightScopeSummary`. The service uses the existing `DecisionCaller` and `runFixedRequest` for four typed questions, one request at most, the existing 3000 ms timeout, confidence validation, 64 KiB payload check, and no persistence. It caps all five conversation fields, checks effective enablement before and after caller setup, and resolves unavailable on failure. Its spec covers unset/disabled with zero requests, all four answers, low confidence and malformed answers, timeout, field limits, payload size, and omitted sections.
- **13.2 Reuse cache:** Added a 100-session LRU keyed by caller session/tab id, with `beginTurn`, `confirmRevision`, `markUnknown`, `put`, `get`, `invalidate`, and `clear`. Hits require known continuity, matching revision and model fingerprint, and a live enabled setting. Disabled reads and writes clear the cache. Its spec covers all of these conditions, stale writes, malformed revision, and eviction.
- **13.3 Host setting:** Added a live `HostRoutingSetting` reading `ptah.agentOrchestration.hostRouting`; only literal `false` disables a configured model, while an unset model or failed configuration read disables routing. Its spec covers default, explicit, malformed and unset values, plus read failure.

## Files written

- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-routing\src\lib\scope\scope-check.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-routing\src\lib\scope\scope-check.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-routing\src\lib\scope\preflight-reuse-cache.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-routing\src\lib\scope\preflight-reuse-cache.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-routing\src\lib\scope\host-routing-setting.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-routing\src\lib\scope\host-routing-setting.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\.ptah\specs\TASK_2026_857_f660\batch-13-report.md`

## Risks handled

- **R1 concurrent edits:** Only Batch 13 files were edited. The scoped verify passed despite waiting behind concurrent host and agent-sdk checks. No foreign failure appeared.
- **R5 cancellation epoch:** The cache exposes synchronous invalidation, `markUnknown`, and revision-checked `put`/`get`; the coordinator's epoch and identity guards remain Batch 18 ownership. A disabled write cannot restore an old cache entry.
- **R7 shared files:** No DI, barrel, or `route-decide` file was touched; Batch 14 retains ownership of those files.
- **R12 deliberate swallows:** The two fail-open catches carry `degradation-audit: reported` comments. The scope service never logs conversation text.
- **D-7 / F6 continuity:** Cache keys are opaque tab/session keys supplied by the caller. Pending and unknown continuity miss, and a changed revision deletes its old entry; callers supply the model fingerprint without secrets.

## Verification

- `ptah_get_diagnostics` after the final edits: **0 errors, 0 warnings** in all six files.
- First `npm run verify -- -p @ptah-extension/lane-routing 2>&1 | Select-Object -Last 40`: `NX 3 tasks: 3 succeeded`; lock acquired after 84s; released with exit code 0.
- Final same command after the disabled-write and setting recheck changes: `NX 3 tasks: 3 succeeded`; lock acquired after 107s; run duration 25.8s; released with exit code 0. The three tasks were lint, test and typecheck; no extra Batch 13 typecheck was listed.

First verify tail:

```text
[verify 2026-10-30T18:57:14.826Z] lock slot 1 acquired after 84s: verify lint,test,typecheck (@ptah-extension/lane-routing)
 NX   3 tasks: 3 succeeded
  Run duration:      20.5s
  Cache:             0/3 hit (0%)
[verify 2026-10-30T18:57:43.793Z] lock released after 29.0s, exit code 0
```

Final verify tail:

```text
[verify 2026-10-30T19:00:03.681Z] lock slot 0 acquired after 107s: verify lint,test,typecheck (@ptah-extension/lane-routing)
 NX   3 tasks: 3 succeeded
  Run duration:      25.8s
  Cache:             0/3 hit (0%)
[verify 2026-10-30T19:00:36.262Z] lock released after 32.6s, exit code 0
```

## Decisions

- **Assessment usage on both result variants:** Chose a typed usage object on `answered` and `unavailable`, with zero requests when no call is sent. Option: omit usage on unavailable. Evidence: Component 13 asks for usage for logs while its union requires an unavailable result; this keeps the coordinator's usage read straightforward. Reversible within the Batch 14 barrel contract.
- **Disabled cache write clears entries:** Chose to clear on `put` as well as on `get`. Option: clear only on `get`. Evidence: Component 13 requires invalidation on disable, and an old entry could otherwise survive an off→on toggle without an intervening read. Reversible, but clearing is safer.
- **Scope setting rechecked after opening caller:** Chose to check enablement again immediately before dispatch. Option: gate only on entry. Evidence: opening a caller is asynchronous and Component 13 requires zero requests while routing is disabled. Reversible.

## Issues outside scope

- Batch 14 must wire and export the classes; Batch 18 must enforce the per-tab cancellation epoch and in-flight identity guard. Neither file set belongs to Batch 13.
- Skill discovery was unavailable in this lane's tool catalog; no backend skill package was loaded.
