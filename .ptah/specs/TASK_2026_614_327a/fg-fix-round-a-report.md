# Fix round A — `TASK_2026_614_327a`, Stage F + G

Scope: S1 and M5 from `reviews/fg-code-logic-review-a.md`. Nothing else in that review was touched.

## Files changed

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\vscode-core\src\services\subagent-registry\subagent-state-store.ts`: new `HeldUnboundStart` type and `heldUnboundStarts` map keyed by agentId. Adds hold, get, discard and `hasHeldUnboundStarts`. Held starts are cleared in `clear()` and expired by TTL in `cleanupExpired()`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\vscode-core\src\services\subagent-registry.service.ts`: new `holdUnboundStart`, `hasHeldUnboundStarts`, `bindHeldStartToToolCall` (returns `bound` / `already-registered` / `ambiguous` / `no-held-start`) and `discardHeldUnboundStarts`.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\message-transform\task-result-agent-binding.ts`: `readTaskResultAgentIds(content)` reads the `agentId:` lines, and `bindTaskResultToHeldStart(toolCallId, content, helpers)` is the seam.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\message-transform\background-started-event.ts`: now uses the shared `readTaskResultAgentIds`, so the `agentId:` regex exists in one place only. Behaviour is unchanged (first id).
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\message-transform\user-message.transformer.ts` and `...\assistant-message.transformer.ts`: both tool_result sites call `bindTaskResultToHeldStart`. In the assistant site it runs before `buildBackgroundAgentStartedEvent`, so a background placeholder sees the bound record. The order of the two event pushes is unchanged.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\helpers\subagent-hook-handler.ts`: in `bindStartByAgentId`, 0 matches now holds the start (INFO) instead of dropping it with a WARN. Several matches, or a vanished single match, still WARN and stay unbound. `handleSubagentStop` discards a held start for the agent when no record resolved.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-registry.service.ts`: the M5 guard (see below).
- Specs: CREATED `...\message-transform\task-result-agent-binding.spec.ts`. MODIFIED `...\helpers\subagent-hook-handler.spec.ts`, `...\session-lifecycle\session-registry.service.spec.ts`, and the mocks in `user-message.transformer.spec.ts`, `assistant-message.transformer.spec.ts` and `artifact-parity.spec.ts`. The mocks only gained the two new registry methods.

## S1: how it is fixed

The second half of F-F is now built:

1. SubagentStart arrives without a `toolUseId`, and no record in that parent session names the agentId. The start is held as `(agentId, agentType, parentSessionId, startedAt)`.
2. Any tool_result (user or assistant message) runs `bindTaskResultToHeldStart`. It does nothing when no start is held, so ordinary results are never scanned. Otherwise it reads the `agentId:` lines. The `agentId:` regex is the one from `background-started-event.ts:56`, now shared.
3. Exactly one id, and exactly one held start with that id: the start is registered under the Task's toolCallId through `register()`. That means a `markPendingBackground` or teammate name already set for that toolCallId is applied, and the status is `running` or `background`. The registry logs an INFO.
4. When the start cannot be bound, it stays unbound and is logged:
   - The result names two different ids: WARN.
   - Two held starts share the id (different parent sessions): WARN with `candidateCount`.
   - The id matches no held start, and the toolCallId has no record: WARN.
   - The toolCallId already has a record: `already-registered`, no WARN. This is the normal path for starts that did carry a `toolUseId`.
5. SubagentStop for an agent with no record discards its held start. A result that arrives later must not create a `running` record for an agent that has finished.

Residual, stated plainly: for a synchronous foreground Task, the SDK delivers the tool_result after the subagent finishes, so after SubagentStop. In that case the start is discarded at stop, and the agent was not reachable during its run. The seam closes the gap whenever the Task result comes before the stop: background placeholders, and any start whose result arrives first. Under F-F (exact `agentId:` match only) the SDK gives no earlier exact link for a foreground run whose SubagentStart lacks `toolUseId`. Closing that remaining window needs a different signal than F-F allows, so it is not claimed fixed here.

## M5: how it is fixed

`session-registry.service.ts`:
- `notifyEvicted` passes `realSessionId` to eviction listeners (the budget release) only when `isSessionIdHeldByAnotherRecord(realSessionId, rec)` is false. That function returns true when `bySessionId` maps the id to a different record, or when any remaining `byTabId` record has the same `realSessionId`. When the id is kept, an INFO line says so.
- `evictStale` deletes the `bySessionId` entry only if it points at the evicted record. This is the same identity guard `remove()` uses at `:408`. Before, evicting a stale record also removed the live record's index entry.

## Specs added

- `task-result-agent-binding.spec.ts` runs the real `SubagentHookHandler` and the real `SubagentRegistryService`:
  - A start without `toolUseId`, then a Task result naming the id: the start is bound, the record is `running`, and `getToolCallIdByAgentId` and `getRunningBySession` return it. This is the lookup stop and budget stop use.
  - A result naming an id no held start matches: WARN, unbound.
  - Two held starts with the same id: WARN, unbound.
  - A result naming two ids: WARN, unbound.
  - SubagentStop before the result: the held start is dropped and nothing binds.
  - With no held starts, nothing is scanned.
  - `readTaskResultAgentIds` parsing, on both string and block-array content.
- `subagent-hook-handler.spec.ts`: the old "0 matches → WARN" case now asserts that the start is held and that no WARN is logged.
- `session-registry.service.spec.ts`, two M5 cases:
  - A stale query-less record shares its real id with a live one: the listener receives only `['tab_stale']`, and `find('real-shared')` is still the live record.
  - The same, but the stale record owns the `bySessionId` index: the real id is still kept.

## Checks (exit codes)

- `npx nx run-many -t typecheck,lint -p agent-sdk vscode-core --parallel=2`: exit 0. Lint shows 0 errors. All of its warnings were there before this round.
- `npx nx run-many -t typecheck,test -p agent-sdk vscode-core --parallel=2 -- --maxWorkers=2`: both test targets passed. Typecheck failed only because the forwarded `--maxWorkers` flag was handed to `tsc` (TS5023). Typecheck was then re-run clean in the command above.
- `npx jest -c libs/backend/agent-sdk/jest.config.ts task-result-agent-binding subagent-hook-handler.spec session-registry.service.spec`: 3 suites, 101 tests passed, exit 0.
- `npx jest -c libs/backend/vscode-core/jest.config.ts subagent`: 7 suites, 119 tests passed, exit 0.
- `npx eslint` on every changed source file and the new spec: exit 0.
- `npx nx run di-lint:lint`: exit 0. `npx nx run degradation-audit:lint`: exit 0.

Not touched: `apps/ptah-extension-vscode/src/main.ts`, `run-check.tool.ts`, `libs/frontend/**`, `sdk-query-options-builder.ts`, `batches.md`. No git operations.
