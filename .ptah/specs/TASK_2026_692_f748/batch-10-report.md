# Batch 10 implementation report

## Task 10.1 — pump veto

`session-stream-pump.service.ts:206,245-249` adds the optional `beforeEnqueue` callback and invokes it only inside the `require-idle` block, after the second admission check and synchronously before `markActive` and queue push. A throw propagates from the async send and leaves the queue untouched. `session-stream-pump.service.spec.ts:222` proves a claim released while message construction is pending causes rejection and no enqueue; `:239` proves ordinary admission ignores the callback.

## Task 10.2 — token and facade

`di/tokens.ts:75` adds `SDK_IDLE_COMPACTION`. `session-lifecycle-manager.ts:420-421` adds optional injection as the final constructor argument; `:480` disposes the service; `:718` forwards ordinary input using the current real id; `:728-741` sends idle `/compact` with coordinator origin, require-idle admission and the callback, without an input signal, and exposes the boundary notice; `:819` forwards model prefix changes.

`session-lifecycle-manager.idle.spec.ts:33` proves AC 2.1 and no input; `:43` proves F3 pump rejection settles the sender promise; `:49` verifies ordinary input and model delegates; `:58` checks the current id is passed through; `:64` checks notice and disposal. The integration spec at `:72,111,118` rekeys before fire and proves F2: the facade/pump receives the new id. It also emits PreCompact before the send promise resolves, covering F7. The observed outcome is a later `claim-timeout` WARN (`:125`); track this as L3. The pump veto spec at `session-stream-pump.service.spec.ts:222` and facade rejection spec at `session-lifecycle-manager.idle.spec.ts:43` cover the 8I released-claim/no-enqueue/rejected-promise path.

## Task 10.3 — DI

`di/register.ts:499-540` registers a cached service factory after the coordinator. Optional workspace and adapter events resolve only when registered (`:501-511`), with one DEBUG log if either is absent. The sender closure resolves `SDK_SESSION_LIFECYCLE_MANAGER` at call time (`:525-531`), avoiding the construction cycle. Timing uses `createUnrefScheduler()` and `Date.now()` (`:538`).

## Checks

- Gate: `research-report.md:25-26` records live probe P1 A2 PASS and A3 PASS.
- `NX_NO_CLOUD=true npx nx test @ptah-extension/agent-sdk --parallel=1 -- --maxWorkers=2`: 171 passed suites, 2 skipped; 3,613 passed tests, 3 skipped; exit 0. Jest emitted a worker graceful-exit warning after the pass.
- `NX_NO_CLOUD=true npx nx typecheck @ptah-extension/agent-sdk --parallel=1`: successful, exit 0. Scoped `ptah_get_diagnostics` after the final source edits: 0 errors, 0 warnings.
- `NX_NO_CLOUD=true npx nx lint @ptah-extension/agent-sdk --parallel=1`: successful, 0 errors, 77 warnings, exit 0. New spec is under 500 lines.

## Decisions

- Followed the plan's cached factory and lazy sender design. The optional host signals degrade with one DEBUG event. Reversible by changing the factory registration.
- Recorded the observed F7 timeout WARN as L3 instead of changing the idle reducer outside this batch. Reversible in a later service change.

## Files written

- D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-stream-pump.service.ts
- D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-stream-pump.service.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\di\tokens.ts
- D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts
- D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.idle.spec.ts (created)
- D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\di\register.ts
- D:\projects\ptah-extension\.claude-worktrees\idle-compaction\.ptah\specs\TASK_2026_692_f748\batch-10-report.md

## Fix round

- Passed `this.idleCompaction` as the final `SessionQueryExecutor` constructor argument. The optional injection supplies `null` when `SDK_IDLE_COMPACTION` is unregistered.
- Added two container-based regression cases in `session-lifecycle-manager.idle.spec.ts`: registered service is passed through by identity; unregistered token yields `null` in the executor.
- Ran `npx prettier --write` on `di/register.ts`, `session-lifecycle-manager.ts`, `session-lifecycle-manager.idle.spec.ts`, and `session-stream-pump.service.spec.ts`.
- Verification (`NX_NO_CLOUD=true`, sequential): targeted Jest 2 suites passed, 26/26 tests; agent-sdk typecheck passed; ESLint on the four changed files exited 0 with 0 errors and 1 existing max-lines warning in `di/register.ts`; Prettier check passed on all four files. Scoped Ptah diagnostics: 0 errors, 0 warnings.
- Re-encoded this report from Windows-1252 to UTF-8 while preserving its preceding content.