# Batch 2 report

## Completed tasks

- **2.1 — Idle contracts:** Created readonly constants, SDK coordinator origin, request snapshot, external and internal signal union, attempt/state/timer/effect contracts, reason unions, and producer/sender/timing ports in `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-compaction.types.ts`. Every signal carries `sessionId`; every internal attempt signal carries `attemptId`. Scoped TypeScript diagnostics and agent SDK typecheck passed.
- **2.2 — Unref scheduler:** Created `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\unref-scheduler.ts` and `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\unref-scheduler.spec.ts`. The action replaces and clears its single timeout, unrefs each handle, and clears the handle on unsubscribe. The real RxJS `timer(1000, createUnrefScheduler())` spec passes under fake timers and asserts `unref` was called.
- **2.3 — RxJS dependency:** Added `"rxjs": "7.8.2"` to `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\package.json` and `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\apps\ptah-cli\package.json`. No install or lockfile change was made; Electron and VS Code manifests were untouched.

## Risks handled

- **Node process lifetime / timer leaks:** The scheduler uses `setTimeout`, calls `unref` on the returned handle, permits one live handle per action, and clears it on reschedule or unsubscribe. Tests cover timer firing, reschedule, unsubscribe, and zero pending timers afterward.
- **Dependency checks:** Both direct runtime dependencies were declared in the same batch as the first RxJS imports. Agent SDK and CLI lint targets passed.

## Verification

- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/compaction/idle/unref-scheduler.spec.ts --coverage=false --maxWorkers=2`: 1 suite, 3 tests passed.
- `npx nx typecheck @ptah-extension/agent-sdk --parallel=1`: passed.
- `npx nx lint @ptah-extension/agent-sdk --parallel=1`: passed, 0 errors and 55 warnings.
- `npx nx lint ptah-cli --parallel=1`: passed, 0 errors and 136 warnings.
- Scoped `ptah_get_diagnostics` after edits: 0 errors, 0 warnings.

The four prescribed checks ran sequentially. PowerShell's `Select-Object -Last` provided the requested tailed output, and Nx commands included `--parallel=1` per the run rules. Nx Cloud reported a disabled organization (401) after each successful local Nx target; it did not fail the targets.

## Decisions

- Used `SDKRateLimitInfo['status']` for rate-limit signals rather than repeating the SDK literal union; source: `claude-sdk.types.ts` re-export and installed SDK declaration. Reversible.
- Modeled the scheduler action as an RxJS `Subscription` implementing public `SchedulerAction<T>`; source: installed RxJS 7.8 public type declarations and the real `timer` spec. Reversible.
- Represented the plan's reducer state and effects in this shared contract so later batches can use one vocabulary. The plan names these fields but leaves the declaration shape open; this is additive and reversible.
