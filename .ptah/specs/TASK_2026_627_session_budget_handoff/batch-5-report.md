# Batch 5 report — TASK_2026_627 (Lane work provider + D4 tightening)

Executor: backend-developer. Worktree: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff`. No git write commands run.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-handoff\session-handover-coordinator.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-stream-pump.service.spec.ts`

## Task 5.1 — `AgentProcessManager` registers the lane work provider

- Import: `SessionHandoverCoordinator` now comes from `@ptah-extension/agent-sdk`, in the same import as `claudeModelFamily`. cli-agent-runtime already depends on agent-sdk (the precedent `session-spawner.service.ts:24-42` imports the same class), so this adds no new module-boundary edge.
- Constructor: new trailing argument `@inject(SessionHandoverCoordinator, { isOptional: true }) handoverCoordinator: SessionHandoverCoordinator | null = null`. This copies `session-spawner.service.ts:231-253`. If a coordinator is present, the constructor calls `setLaneWorkProvider(({ sessionId, tabId }) => this.countRunningLanes(sessionId, tabId))` and stores the disposer in `releaseLaneWorkProvider`.
- `countRunningLanes(sessionId, tabId)` counts the tracked agents whose `info.status === 'running'` and whose `info.parentSessionId` is not empty and equals either the real session id or the tab id.
- `disposeAll()` runs the disposer first and sets it to null, so a second `disposeAll` does nothing.
- The registration needs no change. `AgentProcessManager` is a class registration (`di/register.ts:123`), so tsyringe reads the decorator metadata. An unregistered optional token resolves to `undefined`, and the `= null` default takes over.
- Spec: `createManager` takes an optional `handoverCoordinator` stub and passes it as `ManagerArgs[11]`. New `describe('lane work provider (TASK_2026_627)')` with 4 tests:
  - Without a coordinator, nothing is registered.
  - The count includes only running lanes whose parent is the session id or the tab id. A completed lane with the same parent is excluded, and so are lanes of another parent and lanes with no parent. Expected counts: 2, 1 for the other parent, 0 for an unknown session.
  - An empty tab id does not match lanes whose parent is `''` or undefined.
  - The disposer runs once on `disposeAll`.

## Task 5.2 — `SessionHandoverRuntime.subagentsInFlight` required (decisions.md D4)

- Interface: `subagentsInFlight(sourceSessionId: string): number;`. The `?` is dropped, along with the sentence "Optional so test runtimes…". The doc comment keeps "Running plus background subagents of the source."
- `workInFlight` now calls `this.runtime?.subagentsInFlight(sourceSessionId) ?? 0`. The runtime itself can still be null.
- The stream-pump spec's `coordinator.attachRuntime({...})` literal gains `subagentsInFlight: jest.fn().mockReturnValue(0)`.
- `session-lifecycle-manager.spec.ts` (lines 897, 909) and the coordinator spec are unchanged. Typecheck accepts `runtime.subagentsInFlight?.(...)` on a required method, and the batch says to edit them only if typecheck requires it.
- No behaviour change. The production lifecycle runtime already supplies the method (`session-lifecycle-manager.ts:502-503`).

## Risks / edge cases handled

- **No coordinator** (validation note): nothing is registered and nothing is disposed. The plan's "fail-open" behaviour is kept. Covered by a test.
- **`'running'` is the only non-terminal `AgentStatus`** (validation A-list, `agent-process.types.ts:43-44`): the count filters on `'running'` alone. A completed lane is excluded in the test.
- **Lane spawned before the SDK id bound** (parent is still the tab id; re-parenting happens in `resolveParentSessionId`): both ids are matched. Covered by a test.
- **Empty or blank parent ids** (same hazard as TASK_2026_295): `parentSessionId` must be non-empty. An empty tab id therefore cannot match orphan lanes. Covered by a test.
- **Lane provider throws** (edge case in the validation section, Task 4.2): this is the coordinator's job. Batch 4 catches the error, counts 0 lanes and logs one WARN. The provider in this batch does not throw: it is a synchronous loop over an in-memory map.
- **Provider lifetime**: the disposer is released in `disposeAll`. It only clears the coordinator's slot if the slot still holds this provider (`setLaneWorkProvider` identity check). No timer, listener or poll is added.

## Verification

1. Task 5.1 jest. I also ran the DI smoke spec from the same project to check the new optional constructor argument.
   - With the documented command line, both suites failed with `Configuration error: Could not locate module marked mapped as: ...\session-budget-handoff\node_modules\marked\lib\marked.umd.js`. The cause is the root `jest.preset.js:31-34`, which resolves `marked` against `__dirname`, and the worktree has no `node_modules`. This is an environment problem, unrelated to this change.
   - I re-ran with the same two mapper entries passed on the command line: the project's own `^vscode$` mock and `marked` from the main checkout's `node_modules`:
     `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts libs/backend/cli-agent-runtime/src/lib/di/register.agent-process-manager.smoke.spec.ts --coverage=false --maxWorkers=2 --moduleNameMapper='{"^marked$":"D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js","^vscode$":"D:/projects/ptah-extension/.claude-worktrees/session-budget-handoff/__mocks__/vscode.ts"}'`
     → `Test Suites: 2 passed, 2 total` / `Tests: 186 passed, 186 total`. PASS
2. `npx nx typecheck @ptah-extension/cli-agent-runtime --parallel=1` → `Successfully ran target typecheck`. PASS
3. `npx nx lint @ptah-extension/cli-agent-runtime --parallel=1` → `0 errors, 45 warnings`, `Successfully ran target lint`. PASS. The two warnings in `agent-process-manager.service.ts` (451, 506, `preserve-caught-error`) were already there and are not on lines I changed.
4. Task 5.2 jest:
   `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.spec.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.spec.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.spec.ts --coverage=false --maxWorkers=2`
   → `Test Suites: 3 passed, 3 total` / `Tests: 97 passed, 97 total`. PASS
5. `npx nx typecheck @ptah-extension/agent-sdk --parallel=1` → `Successfully ran target typecheck`. PASS
6. `npx nx lint @ptah-extension/agent-sdk --parallel=1` → `0 errors, 52 warnings`, `Successfully ran target lint`. PASS. The only warning in the coordinator file is at line 696 (`no-useless-assignment`, `delivered`), which was already there and is not mine.

All checks ran one at a time, with output filtered.

## Deviations

- The plan's one-line provider is `listTrackedAgents().filter(...).length`. I used a private `countRunningLanes` that loops over `this.agents` directly instead. The result is the same, but it avoids copying every `AgentProcessInfo` each time the coordinator asks. I also added the non-empty `parentSessionId` guard so an empty id never matches (see risks above).
- Verification step 1 needed a command-line `--moduleNameMapper` override because of the worktree `marked` path problem described above. No config file was changed. The team-leader should use the same override, or run from a checkout that has its own `node_modules`.

## Out-of-scope observations

- `jest.preset.js:31-34` (repository root) resolves `marked` with `path.resolve(__dirname, 'node_modules/...')`. Any worktree without its own `node_modules` will therefore fail every jest project whose graph reaches `marked`, including cli-agent-runtime through tool-output-reducers. `require.resolve('marked/lib/marked.umd.js')` would walk up the tree the way Node does. Not touched.
- `session-lifecycle-manager.spec.ts:897, 909` still use `subagentsInFlight?.(`. This is harmless now that the method is required, and could be tidied in a later batch.
