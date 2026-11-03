# Batch 1 report — TASK_LANE_BUDGET_WRAP_UP

## Behaviour change

- Lanes have no tool-call budget and no steer. `agentOrchestration.laneToolCallSteerAt` and
  `laneToolCallStopAt` are removed from settings keys, the settings export, RPC get/set config,
  shared types and the lane-guards settings UI. Old persisted values are ignored.
- The lane guard only counts calls and stops a repeat loop (`laneRepeatCallStopAt`, default 20).
  `LaneStopReason` is now `'repeat-call'` only.
- The lane completion signal carries `stopReason`, `toolCalls`, `queuedMessagesDropped` and
  `repeatedCalls`. The envelope names a host stop ("Stopped by Ptah: ...").
- A host-stopped lane is judged by its deliverables (`verdictOf`). `failed` stays for a crash, a
  timeout or a caller stop. For a host-stopped `delivered` lane the next-action text warns that
  the files may be only a skeleton (review finding S1).
- `continueConversation` clears `stopReason` and the saved guard counters for the new turn
  (review finding M1).
- `RESUME_GATE_MAX_CONTEXT_TOKENS` is 150k (was 60k).
- Skill text (agent-lanes SKILL.md §8, lane-assignment.md) states no call ceiling and a
  skeleton-first deliverable. Both copies are identical.
- Not touched: the subagent context-budget code and the Codex adapter.

## Review

`code-logic-review.md`: 0 blocking, 1 serious (fixed), 4 moderate (1 fixed, 3 need no change:
`LaneStopReason` has one value, `toolCalls` is documented as optional, and the ignored
`discardPending` count is after the signal went out).

## Verification

1. `npm run verify -- -p shared,platform-core,agent-sdk,cli-agent-runtime,rpc-handlers,
   vscode-lm-tools,chat,chat-streaming,ptah-electron,ptah-extension-vscode,ptah-tui`:
   77 tasks, 76 succeeded, 1 failed (`cli-agent-runtime:test`, 2 tests, both caused by this
   change):
   - `account-binding.spec.ts`: used 100k tokens to force `fresh`; raised to 200k for the 150k
     limit.
   - `guard.spec.ts`: expected one notifier call; `stop` and `handleExit` both call the
     notifier for one ending and the real notifier collapses them on agentId + completedAt.
     The test now asserts one ending.
2. `npm run verify -- -p @ptah-extension/cli-agent-runtime`: 3 tasks succeeded.

The earlier `WorkspaceCoordinatorService` git test failures did not occur in these runs.
