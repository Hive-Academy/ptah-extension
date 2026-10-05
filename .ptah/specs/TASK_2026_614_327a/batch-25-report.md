# Batch 25 report: Resume decision in the RPC reply; setConfig, default model, barrels (G.6, G.8)

All four tasks are done. No commit was made.

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\shared\src\lib\types\rpc.types.ts`: the `agent:resumeCliSession` result gains an optional `resumeDecision?: AgentResumeOutcome` (25.1).
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.ts` (25.1, 25.2).
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.spec.ts`: new file (25.1, 25.2).
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts` (25.3, 25.4).
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.spec.ts` (25.3).
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\cli-agent-runtime\src\lib\cli-agents\index.ts` (25.4).
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\agent-wait.tool.spec.ts`: this is an `AgentWaitResult` construction site that 25.4 requires. 7 fixtures gained `cancelled: false`. This is the only file outside the batch's own list. Batch 29's files in vscode-lm-tools (`src/index.ts` and the run-check JSDoc) were not touched.

## Tasks

### 25.1: `resumeDecision` in the result and the log (G-D option a)

- Both paths go through one point after the spawn:
  - The system-CLI path uses `agentProcessManager.spawn`.
  - The Ptah CLI path uses `resumePtahCliSession`. That path already passes `prepared.resumeDecision` to `spawnFromSdkHandle`, which puts it on its result.
- The handler reads `result.resumeDecision` and adds it, when present, to two places:
  - the `RPC: agent:resumeCliSession success` info log, through the injected Logger;
  - the reply.
- When the spawn reports no decision, neither place gets the key.
- The handler's inline result type also gains `resumeDecision?: AgentResumeOutcome`. The type is imported from `@ptah-extension/shared`.
- No UI change was made, per G-D.

### 25.2: Serialise `agent:setConfig` writes

- The handler body moved, unchanged, into `private applySetConfig(params)`. This method never rejects: every failure becomes `{ success: false, error }`.
- The registered method chains each call on `private setConfigQueue: Promise<void>`. The tail of the chain settles whether the call succeeded or failed, so one failed call does not block the queue.
- Validation (`invalidLaneGuard`, which reads stored values) and the ordered writes of one call finish before the next call starts reading. Two overlapping calls can therefore no longer both validate against the same stored pair and leave stop ≤ steer.

### 25.3: Blocked-model check on the default model

- `prepareSdkHandleSpawn` now resolves the model first with `this.spawnEnvironment.resolveModel(cli, model).model`, then calls `assertLaneModelAllowed`. This is the same order the `doSpawnSdk` path uses.
- The model comes from, in order: an explicit `model`; the `agentOrchestration.<cli>Model` setting; the Codex Ptah default.
- The JSDoc is updated. A Ptah CLI agent's own provider model or tier is still resolved inside the registry and stays unchecked. `resolveModel` has no setting key for `ptah-cli`, so it returns `undefined` there.

### 25.4: Barrel exports and a required `cancelled`

- `GatedResume` and `PreparedSdkHandleSpawn` are now type-exported from `cli-agents/index.ts`. The package index re-exports them through `export * from './lib/cli-agents'`.
- `AgentWaitResult.cancelled` is now `readonly cancelled: boolean`, and its JSDoc no longer says "absent means false".
- Construction sites:
  - **Production:** `waitForAgents` in `agent-process-manager.service.ts`, which already sets the field in both of its returns. No change was needed.
  - **Spec fixtures:** `agent-wait.tool.spec.ts`, updated, 7 sites.
  - **Spec fixture left alone:** `http-server.handler.spec.ts:815`. It builds the object `as unknown as AgentWaitResult`, so the type change does not reach it.
  - **Other fixtures:** the remaining ones (`agent-namespace.builder.spec.ts`, `stdio-mcp-server.service.spec.ts`, `agent-spawn-surface-parity.spec.ts`, `mcp-contract.sweep.spec.ts`) are untyped mock values and needed no change. `tsc -p libs/backend/vscode-lm-tools/tsconfig.spec.json --noEmit` showed errors only in `agent-wait.tool.spec.ts`, and those are fixed.

## Specs added

- `agent-rpc.handlers.spec.ts` (new):
  - G.6: the decision is returned and logged on the system-CLI path and on the Ptah CLI path.
  - G.6: the key is left out when there is no decision.
  - setConfig, two overlapping calls: steer 55 and stop 50, each valid against the stored 40/60. The second call is now rejected with `Unsupported laneToolCallStopAt value` and stop is not written. The store's writes yield through `setImmediate`, so without the queue both calls would pass.
  - setConfig, write order: the writes of one call all finish before the next call starts.
  - setConfig, a failed write: it returns the fixed error and the next call still succeeds.
- `agent-process-manager.service.spec.ts`, 3 new tests:
  - A blocked `opencodeModel` setting with no model given throws `LaneModelBlockedError`. The resume gate is not consulted.
  - An explicit allowed model overrides a blocked default.
  - An explicit blocked model is still refused.

## Checks

| Command | Exit | Result |
| --- | --- | --- |
| `npx nx run-many -t typecheck -p cli-agent-runtime vscode-lm-tools rpc-handlers shared` | 0 | 4 projects |
| `npx tsc -p libs/backend/{vscode-lm-tools,cli-agent-runtime,rpc-handlers}/tsconfig.spec.json --noEmit` | — | spec type errors only in `agent-wait.tool.spec.ts`, then fixed |
| `npx jest -c libs/backend/rpc-handlers/jest.config.ts …/agent-rpc.handlers` | 0 | 5 suites, 131 tests pass |
| `npx nx run-many -t typecheck,lint,test -p rpc-handlers shared cli-agent-runtime vscode-lm-tools --parallel=2` | 1 | All typecheck and lint tasks pass. Every cli-agent-runtime and vscode-lm-tools test passes. One rpc-handlers failure: `voice-rpc.handlers.spec.ts › leaves no input temp file behind after a successful transcription`. This is not in Batch 25's code (see notes). |
| `npx jest … voice-rpc.handlers.spec.ts` (alone) | 0 | 58/58 pass |
| `npx nx run rpc-handlers:test` (re-run) | 0 | Nx reports the same voice test failing in the log, yet the target exits 0, and it marked the task flaky. |
| `npx nx run di-lint:lint` | 0 | |
| `npx nx run degradation-audit:lint` | 0 | |
| `npx nx affected -t typecheck --exclude='api-*,ptah-license-server,ptah-landing-page-e2e' --parallel=2` | 0 | 63 projects |

## Open notes

- **Flaky voice test.** `voice-rpc.handlers.spec.ts` "leaves no input temp file behind" fails only under load. Several agents are running on this machine and likely share the OS temp directory. The test passes alone (58/58). This is not Batch 25 code and was not changed.
- **Ptah CLI model still unchecked.** The RPC resume path (`agent:resumeCliSession`, `cli: 'ptah-cli'`) passes no model. The Ptah CLI agent's own configured model is resolved inside `PtahCliRegistry` and is still not checked before the handle is built. Checking it would need the registry to expose the agent's resolved model ahead of `spawnAgent`. That change is outside this batch.
