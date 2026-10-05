# Batch 6 report — TASK_2026_614 (Tasks 6.1, 6.2, 6.3 + extra 6.4)

All paths are under `D:/projects/ptah-extension/.claude-worktrees/task-614-d-e/`.

## Changed files

### Task 6.1 — D.6: rotation never reuses a stale handoff copy
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.ts`
  - `BudgetEntry` gains `usageSeq` (bumped when a different snapshot is stored, and on "Allow 20% more")
    and `handoffCopySeq` (the `usageSeq` the kept copy was built at).
  - New `storeSnapshot(entry, snapshot)` replaces the three `entry.snapshot = snapshot` writes
    (disabled path, accepted live/loaded path, `installFigure`); it bumps `usageSeq` only when the snapshot changes.
  - `writeHandoff` stamps `usageSeq` before the build (usage seen while it builds makes it stale).
  - `previewHandoff` (the rotation and handoff-stage preview) returns the kept copy only when
    `handoffCopySeq === usageSeq`; otherwise it builds a new copy and does not write it.
- MODIFIED `.../session-budget/session-budget.service.spec.ts` — 3 tests: kept copy reused with no new snapshot;
  rebuilt (path null, no extra write) after a newer snapshot; rebuilt after an extend.

### Task 6.2 — B-m3: "advice: fresh" instruction only when an agent is advised fresh
- Confirmed the defect: `advice` is set for every agent whenever the monitor is registered, so
  `some(a => a.advice !== undefined)` was true for all-resume lists.
- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/session/chat-subagent-context-injector.service.ts` —
  `hasFreshAdvice = agents.some(a => a.advice?.advice === 'fresh')` gates the instruction.
- MODIFIED `.../chat-subagent-context-injector.service.spec.ts` — "no fresh agent → no instruction" test
  (the existing fresh-agent test still pins that the instruction is present).

### Task 6.3 — B-m6: steer/stop pair written without an invalid in-between state
- `IWorkspaceProvider.setConfiguration` writes one key at a time (no multi-key write), so the order is used instead.
- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts` — new `laneGuardWriteOrder(params, readStored)`:
  stop first when the new stop exceeds the stored steer (raising), else steer first (lowering). Since both the stored
  and the requested pair are valid, one of the two orders always keeps `stop > steer`. The guard write loop uses it.
- MODIFIED `.../handlers/agent-rpc.handlers.set-config.spec.ts` — `it.each` raising (40/60 → 70/90) and lowering
  (40/60 → 5/10): after each of the two writes the stored stop exceeds the stored steer.

### Task 6.4 — resume gate and blocked-model check on the `agent:resumeCliSession` Ptah CLI path
- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts` (`resumePtahCliSession`) — calls
  `agentProcessManager.prepareSdkHandleSpawn({ cli: 'ptah-cli', task, resumeSessionId: cliSessionId })` before the
  id reservation and the handle build, then hands `prepared.task` / `prepared.resumeSessionId` to
  `ptahCliRegistry.spawnAgent`, and `prepared.resumeSessionId`, `resumeDecision`, `originalTask` to
  `spawnFromSdkHandle` (the record keeps the caller's task), the same way `agent-namespace.builder.ts:268-335` does.
  A refusal (blocked model) throws before any handle is built and returns `{ success: false, error }` through the
  existing catch. Only SDK-handle spawns are gated (user decision 4); live continuation is untouched.
- MODIFIED `.../handlers/agent-rpc.handlers.resume-parent-session.spec.ts` — harness mocks `prepareSdkHandleSpawn`
  (pass-through); new describe with 3 tests: gate called with the resume id before `spawnAgent`; fresh decision gives
  the lane the handoff and no resume id while the record keeps the caller's task plus `resumeDecision`/`originalTask`;
  a refused spawn builds no handle and reports the error.

## Checks

| Command | Exit |
| --- | --- |
| `npx nx run-many -t typecheck,lint,test -p agent-sdk,rpc-handlers --parallel=2` | 1 — only `rpc-handlers:test` failed: `voice-rpc.handlers.spec.ts` "leaves no input temp file behind" (22.8 s under load; file not touched by this batch). The other 5 tasks passed. |
| `npx nx run rpc-handlers:test --skip-nx-cache` (rerun) | 0 — 140/140 suites, 4179 passed, 7 skipped |
| `npx nx run-many -t typecheck -p ptah-extension-vscode,ptah-electron,ptah-cli --parallel=2` | 0 |
| `npx nx run di-lint:lint` | 0 |
| `npx nx run degradation-audit:lint` | 0 |

## Notes
- No edits to cli-agent-runtime, vscode-lm-tools, batches.md or task.md. No git run.
- Out of scope: `voice-rpc.handlers.spec.ts` temp-file test fails under parallel load (passes on rerun). This is a second flake beside the known `session-handoff-writer.spec.ts` one.
