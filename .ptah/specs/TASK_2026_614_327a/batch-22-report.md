# Batch 22 report: monitor rekey ordering, stop retry gate, executor rekey gaps (G.2, G.8)

Status: all 7 tasks implemented. Scoped checks exit 0. Nothing committed.

## Files changed

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\helpers\compaction\subagent-budget-monitor.ts` (22.1, 22.2, 22.3)
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\helpers\compaction\subagent-budget-monitor.spec.ts` (9 new specs)
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-query-executor.service.ts` (22.4)
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-query-executor.service.spec.ts` (22.4 specs, 22.6 fix, mocks gain `currentSessionId`)
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts` (22.5)
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.spec.ts` (22.5 spec)
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\helpers\post-tool-use-hook-handler.ts` (22.7, comment only)

## Tasks

- **22.1 (FM-2):** The monitor keeps an `aliases` map (old id → new id). `rekey` records `from → to` and drops any alias held by `to`, so no alias loop can form. It records the alias even when `from` has no state yet. `sessionState` resolves the id through the chain, so a subagent message still queued under the old id adds to the same state, and its stop or handoff goes to the new id. `release(id)` removes every alias whose chain passes through `id`, then the state. A new public `currentSessionId(id)` returns the end of the chain. `getSnapshot` still does not resolve, which keeps the existing "rekey moves the state" spec unchanged.
  - Specs:
    - an old-id message after a rekey adds to the same state and stops under the new id;
    - after a release, no state lands on the released ids;
    - a rekey back to an earlier id forms no loop.
- **22.2 (FM-6):** When a stop attempt rejects, the API message id of that attempt is stored (`failedStopMessageId`). `observe` skips the retry while the current message has that same id. A message without an id is not gated, which is the old behaviour.
  - Spec: three content blocks of one request make one attempt, and the next request id retries.
- **22.3 (rereview m1, m3):** `onStopFailed` returns without counting when `liveState.stopInFlight` is true. The four specs rereview m3 lists are added:
  - a stop rejecting across a merge (counted once, then retried on the next request);
  - stops in flight on both records, where the target fails on what would be the last attempt and the source then succeeds: exactly one registry update and one handoff, and no give-up. This spec fails on the pre-fix code.
  - the fired target state is kept over a fresh source state;
  - the handoff task text comes from the merged-away record.
- **22.4 (FM-4, FM-5, FM-9):**
  - The tap now has `currentId(id)`, which resolves the id through the monitor's `currentSessionId`. It is fail-open: without a monitor, or if the call throws, it uses the id unchanged.
  - FM-4: the turn-end `.then` feeds `onContextUsage(currentId(this.sessionId ?? sessionId))`.
  - FM-5: `release()` builds one set of every tracked id and subagent id plus each one's resolved id. It resolves before releasing, because the monitor drops its aliases on release. It then releases each id in the monitor, the coordinator and the port.
  - FM-9: `SessionQueryExecutor` owns a `runOwners` map (session id → run token) that every tap shares. `bind` sets the owner. `release` skips an id that another run owns and deletes its own entries.
  - Specs (real coordinator and real monitor): a reading taken across a PostCompact arms the new id; a stream ending right after a PostCompact releases the new id in the coordinator, the port and the monitor; an older run's `onStreamEnd` leaves the id a newer run bound.
- **22.5:** The adapter keeps a `WeakMap<Query, {onMessage, onStreamEnd}>`, filled by `rememberStreamTap` at the three `transform` call sites. The "already active" path spreads `streamTaps.get(existingSession.query)`. Because the map is keyed weakly by the query, it needs no eviction hook.
  - Spec: a resume that hits an active session passes the same `onMessage` and `onStreamEnd` as the stream that started the run.
- **22.6:** The `StreamTransformer` construction in `session-query-executor.service.spec.ts` now passes the 8th argument, `{ notifyAll: jest.fn() } as unknown as SessionPlanLimitCallbackRegistry`, the same way `stream-transformer.spec.ts` does, and the spec imports that type. The suite compiles and passes.
- **22.7:** The comment at the `capToolOutput` race now says:
  - the capper keeps running after a timeout or abort and is not handed the signal;
  - it may still write a spool file that nothing references;
  - its late result is discarded;
  - this is accepted (G-E, FM-7).
  - The signal is not passed into the capper, and the code is unchanged.

## Checks (run in the worktree)

| Command | Exit | Result |
| --- | --- | --- |
| `npx nx run-many -t typecheck,lint -p agent-sdk --parallel=2` | 0 | Both targets succeeded |
| `npx nx run agent-sdk:test --maxWorkers=2` | 0 | 146 suites passed, 2 skipped; 3131 tests passed, 3 skipped. The TS2554 suite now passes. |
| `npx jest -c libs/backend/agent-sdk/jest.config.ts subagent-budget-monitor.spec session-query-executor.service.spec sdk-agent-adapter.spec` | 0 | 3 suites, 179 tests passed |
| `npx nx run di-lint:lint` | 0 | — |
| `npx nx run degradation-audit:lint` | 0 | — |

## Open notes

- **Interpretation (22.1):** I read "after release no state is created" as: once the new id is released, an old-id message no longer resolves to it. It starts a fresh record under its own id. I did not add a tombstone, because a resumed run may reuse the id. The tap never feeds a message after its own release, so this record cannot come from the run that was released.
- **FM-5 depends on the monitor:** the tap learns the PostCompact id from the monitor's alias map. The batch's file set excludes the hook handler, the coordinator and the port, so the monitor is the only rekey record available. A host without a monitor falls back to the old behaviour. In production the monitor is always registered, and the hook handler always calls `monitor.rekey`.
- **`SubagentBudgetSink` change:** the type now includes `currentSessionId`. Its only other user is `session-lifecycle-manager.ts`, which passes the real monitor, so nothing else changes.
- **Out of scope:** none touched. I made no edits under vscode-lm-tools, apps/ptah-cli, libs/frontend, or the TASK_2026_609 parts of `sdk-query-options-builder.ts`.
