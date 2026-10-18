# Batch 8G report

## Task 8G.1 — sending and boundary deadlines

- `idle-session.reducer.ts:25-45` now schedules deadline timers for `sending` and `boundary`; the boundary timer uses `dwellAt`.
- `idle-session.reducer.ts:371-407` closes either phase on a matching deadline, releases its claim and emits one warning. `idle-compaction.types.ts:147-153` adds `send-timeout` as the sending warning reason.
- `idle-session.reducer.spec.ts:326-371` covers both expiries, claim release, one warning, a later turn re-arming, and a stale attempt deadline. Existing timer expectations at lines 220 and 311 were updated.
- `idle-compaction.service.spec.ts:379-403` verifies an unresolved send releases its real coordinator claim at the deadline and permits a later turn to arm.

## Task 8G.2 — alias normalisation and containment

- `idle-compaction.helpers.ts:26-50` resolves each signal against the group's current session ID. For `rekey`, it passes the prior current ID to the reducer before storing the new ID. `idle-compaction.service.ts:407-413` uses this resolution. The reducer's session ID guard remains unchanged.
- `idle-compaction.service.ts:143-163` catches settings or reducer failures inside `scan`, preserves the previous state, and emits only a `signal-failed` warning effect for the dropped signal. `idle-compaction.service.ts:251-285` catches each effect separately so following effects still run. `idle-compaction.types.ts:149` adds the warning reason.
- `idle-compaction.service.ts:235` retains the unchanged coalesce spec's `group-failed` warning when a group closes with an unrecovered failed signal. A successful later signal clears that condition. The pipeline remains live until release.
- `idle-compaction.helpers.ts:8-24,52-86` holds the settings reader and existing timer/state utilities so every changed file remains below 500 lines.
- `idle-compaction.service.spec.ts:405-473` covers old-alias activity, turn and boundary signals; recovery after one settings failure; and continuation of later effects when one warning log throws.

## Findings and decisions

| Finding | Resolution |
| --- | --- |
| F1 | Per-signal and per-effect containment in the service; the config provider's throw-on-read is assigned to Batch 8H. |
| F2 | Alias normalization in the resolve step; the reducer guard is unchanged. |
| F3 | `sending` deadline, claim release, closure and `send-timeout` warning. |
| F4 | `boundary` dwell deadline, claim release, closure and `dwell-timeout` warning. |

### Decisions

- Chose `send-timeout` over reusing `claim-timeout`, because an unresolved sender is distinguishable from an enqueued request waiting for PreCompact. This is reversible by changing the reason mapping and expectations.
- Kept the existing coalesce spec unchanged. Its failed-group expectation is met on release when no successful signal followed the failure; the service also gives the required immediate `signal-failed` warning. This is reversible if the coalesce contract is updated later.

## Verification

The first Jest run failed during implementation; after fixing rekey ordering and preserving the coalesce warning, the final sequential checks passed. `NX_NO_CLOUD=true` was set for Jest and Nx. No workspace-wide checks or git commands ran.

`npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/compaction/idle --coverage=false --maxWorkers=2 2>&1 | tail -20` (final tail; exit 0):

```text
(Use `node --trace-warnings ...` to show where the warning was created)
Test Suites: 6 passed, 6 total
Tests:       78 passed, 78 total
Snapshots:   0 total
Time:        5.907 s
Ran all test suites matching libs/backend/agent-sdk/src/lib/helpers/compaction/idle.
EXIT: 0
```

Jest also emitted a Node warning about loading `jest.config.ts` as an ES module; the suite passed. The existing `idle-compaction.service.coalesce.spec.ts` passed unchanged.

`npx nx typecheck @ptah-extension/agent-sdk --parallel=1 2>&1 | tail -15` (exit 0):

```text
> nx run @ptah-extension/agent-sdk:typecheck
> tsc --noEmit --project libs/backend/agent-sdk/tsconfig.lib.json
NX   Successfully ran target typecheck for project @ptah-extension/agent-sdk
Run duration:      6.9s
Cache:             0/1 hit (0%)
Critical path:     6.8s (1 task)
Recoverable time:  <1ms
EXIT: 0
```

`npx prettier --check libs/backend/agent-sdk/src/lib/helpers/compaction/idle 2>&1 | tail -3` (exit 0):

```text
Checking formatting...
All matched files use Prettier code style!
EXIT: 0
```

Scoped `ptah_get_diagnostics`: 0 errors, 0 warnings, clean coverage. All six changed source/spec files have LF endings and are under 500 lines.

## Files created or modified

- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-session.reducer.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-session.reducer.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-compaction.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-compaction.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-compaction.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-compaction.helpers.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\.ptah\specs\TASK_2026_692_f748\batch-8G-report.md`
