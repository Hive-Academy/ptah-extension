# Batch 35c report — Task 35.4 (+ F6-m1, F6-m2)

## Backend implementation — `TASK_2026_597`, batch 35c

**Tasks completed**: 35.4 (the manager hooks the guard and refuses blocked models), F6-m1, F6-m2

**Files**:

- MODIFIED D:/projects/ptah-extension/.claude-worktrees/task-597-s4/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts
  - New `LaneModelBlockedError` (exported beside `AgentContinueError`). Message: "Model \`<id>\` is blocked for lanes because it is known to loop. Choose another model."
  - `doSpawnSdk` calls `findBlockedLaneModel(resolvedModel)` right after the model resolves and throws before the record, the log lines, `runSdk` or any event.
  - Private `laneGuards: Map<agentId, LaneBudgetGuard>`. `trackSdkHandle` creates one guard per lane when the handle has `onSegment`, using `spawnEnvironment.resolveLaneGuardThresholds()`. The segment subscription calls the new `applyLaneGuard`.
  - `steerLane` delivers the steer through `sendToAgent`. An `unsupported` result or a thrown error is logged at warn. The guard keeps counting, so the stop threshold still applies.
  - `stopLaneForBudget` sets `stopReason` on `tracked.info`, discards any queued steer, then calls the existing `stop(agentId)`. `stopReason` therefore shows up in `getStatus`, in `agent:exited` and in the completion signal.
  - `releaseLaneGuard` (an idempotent delete) runs on every path that ends a lane: `stop` (running branch), `handleTimeout` (the PR #642 behaviour is kept unchanged), `handleExit`, `releaseSubprocess` and `disposeAll` (which clears the map).
  - F6-m1: chose to document the existing behaviour rather than move the log. A comment above `lanePolicy` says the line is logged before `runSdk` on purpose, so a failed spawn still records its policy. `prefixKeys: 'applied'` means the keys were passed to the adapter. A rejection is reported later by the `dropped (config rejected)` line.
  - F6-m2: each `ignoredEfforts` entry now uses `String(entry.value).slice(0, 32)`.
- CREATED D:/projects/ptah-extension/.claude-worktrees/task-597-s4/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.guard.spec.ts — 7 tests:
  - the steer is sent once, at the threshold;
  - the stop threshold produces `stopped` plus `stopReason: 'tool-call-budget'`, in status and in `agent:exited`;
  - a repeated identical call produces `repeat-call`;
  - an `unsupported` steer (real router) is logged and the lane is still stopped;
  - the guard is released on exit and later segments are ignored;
  - the guard is released on a budget stop;
  - a blocked model (provider-prefixed, mixed case) is refused before `runSdk`, with nothing tracked, no `agent:spawned` and no guard.

**Stack observed**:

- tsyringe constructor injection. No new collaborator was added: the guard is a plain class built per lane, as the header of `lane-budget-guard.ts` says.
- Error convention: every error in this lib extends `Error` directly (`AgentContinueError`, `AgentMessageError`, `AgentRoleError`, …). There is no lib error base class.
- Messaging outcome type is `AgentMessageOutcome.mode` (`libs/shared/src/lib/types/agent-process.types.ts:310`).
- Tested with Jest, using the same constructor harness as `agent-process-manager.wait.spec.ts`.

**Verification**:

- `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts …agent-process-manager.guard.spec.ts`: 7/7 passed.
- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime --parallel=2`: exit 0, "Successfully ran targets test, lint, typecheck".
- Typecheck of the affected set for `libs/backend/cli-agent-runtime/src/index.ts`: exit 0, "Successfully ran target typecheck for 11 projects". No `api-*`, `ptah-license-server` or `ptah-landing-page-e2e` project was in the affected set.
- `npx nx run degradation-audit:lint`: exit 0.
- `npx nx run di-lint:lint`: **exit 1. The failure is not caused by this batch.** The error is "libs/backend/agent-sdk/src/lib/helpers/compaction/tool-output-capper.ts:93 injects SDK_TOKENS.SDK_CODE_OUTLINER but no register*.ts registers it". That file is in the untracked `libs/backend/agent-sdk/src/lib/helpers/compaction/` folder, which is a concurrent agent-sdk sub-batch's work in progress. This batch adds no `@inject` token.
- No `*.png` was rewritten.

**Plan deviations**:

1. "Extend the lib's error base": this lib has no error base, so `LaneModelBlockedError extends Error`, following the lib's convention.
2. Guard lifetime on continuation-capable handles. A steer delivered as `interrupt-resume` or `queue-next-turn` starts another turn on the same record. If `handleExit` released the guard, that turn would run unguarded. So for handles where `supportsContinuation()` is true, `handleExit` keeps the guard. It is released when the subprocess is released (idle, expiry, stop of a completed lane, dispose), or by `stop` or `handleTimeout`. For every other handle the guard is released at exit, as specified. The "one steer per lane" and "stop is final" rules still hold, because the guard's flags carry across turns.
3. The guard is attached in `trackSdkHandle`, so lanes created with `spawnFromSdkHandle` (Ptah CLI or custom agents) are guarded too, not only `doSpawnSdk` lanes.

**Out-of-scope observations**:

- `LaneModelBlockedError` is not re-exported from `libs/backend/cli-agent-runtime/src/lib/cli-agents/index.ts`, which is outside this batch's files. Add it there if an RPC or MCP caller needs `instanceof`. The message reaches callers through the thrown error either way.
- The di-lint failure above belongs to the agent-sdk compaction sub-batch.
