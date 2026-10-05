# Batch 4 + Batch 12 report — TASK_2026_614_327a

Executor: backend-developer. No git was run. `batches.md` and `task.md` were not edited.

## Tasks completed

- 4.1 The handoff carries the subagent's task text. A failed stop is retried, with a bound. Added `rekey`. (D.8, A-m6 on the monitor side)
- 4.2 The parent push goes through the dispatcher's ordering lock and uses its `origin`. (D.8, A-m2)
- 4.3 A coordinator listener error goes to a callback and is never rethrown. (D.8, A-m9)
- 12.1 (D.3, Decision 2a) `compaction.enabled = false` makes the monitor observe-only. It keeps counting but never stops a subagent. No new setting key.

## Changed files

- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.ts`
  - Task text. `observe` reads `tool_use` blocks named `Agent` (or `Task`, the SDK's earlier name) from any assistant message. It records `readSubagentTaskText(input)` per tool_use id: `description: <first 300 chars of prompt>...`. The field names were checked against `AgentInput` in `node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:750-762`. `handoffMessage` adds `Its task was: …` when the task text is known.
  - Bounded retry. `MAX_STOP_ATTEMPTS = 3` (one attempt plus 2 retries). A rejected `stopSubagent` leaves `stopFired` false and increments `stopFailures`. The next subagent message retries. On the 3rd failure the stop is marked done and one warn is logged ("giving up"). While a stop is running, `stopInFlight` stops an overlapping message from starting a second one (R7).
  - After `release`, a stop that was in flight does not retry, does not update the registry and does not push a handoff. The check is `isCurrent(session)`, which compares session identity in the map.
  - `rekey(from, to)` moves the session state to the new id. The session now carries a mutable `sessionId`, so a stop in flight hands off to the new id. Subagents already seen under `to` are merged in, and `from` wins on a clash. This is ready for Batch 5 to call.
  - D.3: when a stop reason exists and `config.enabled` is false, the monitor logs one info line per session and returns. The snapshot still reports `budgetReached`.
  - The private `streamParentMessage` was deleted. The handoff now goes through `dispatcher.pushParentMessage`. The constructor drops the `SessionLifecycleManager` port. The dispatcher port is the exported `SubagentStopPort` (`stopSubagent` | `pushParentMessage`).
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/subagent-message-dispatcher.ts`
  - New `pushParentMessage(sessionId, content)`. It throws `SESSION_NOT_FOUND`, `SEND_TIMEOUT` or `SESSION_ENDED`.
  - The `serialisedPush`, `origin: { kind: 'human' }` and 10 s race code moved into a private `pushUserMessage`, which `sendToSubagent` and `pushParentMessage` both use. `sendToSubagent` behaves exactly as before.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/compaction/compaction-coordinator.ts`
  - Constructor is now `(timers?, onListenerError?: CompactionListenerErrorHandler)`. A listener that throws is reported to the handler, and the `queueMicrotask` rethrow is gone. A handler that throws is caught too, so the transition loop always finishes.
- MODIFIED `libs/backend/agent-sdk/src/lib/di/register.ts`
  - The coordinator factory passes a handler that writes a warn through the SDK logger, with session, from/to, trigger and error.
  - The monitor factory now hands in a lazily resolved dispatcher port with `stopSubagent` and `pushParentMessage`. It no longer resolves `SessionLifecycleManager`. The dispatcher is still resolved on first use; there is no constructor injection, so the DI cycle is not reintroduced.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts` (small change; see Plan deviations)
  - The compaction tap now also forwards a main-loop `assistant` message that has a `tool_use` block to `monitor.observe`, so the monitor can see the spawning `Agent` input. Before this, parent messages never reached the monitor. Main-loop messages without a `tool_use` are still not forwarded.
- Specs:
  - `compaction/subagent-budget-monitor.spec.ts`. The harness uses the 4-argument constructor, `enabled`, and a `pushParentMessage` mock. The old test "failed stop … is not retried" is replaced. New tests cover:
    - retry up to the cap, then give up with one warn
    - a retry that succeeds hands off once
    - no second stop while one is in flight
    - a stop that rejects after release is not retried, updates nothing and sends no handoff
    - the handoff includes the description and the capped prompt
    - the `Task` name works and a non-agent tool is ignored
    - `enabled=false` never stops, still reports `budgetReached`, and logs once
    - `rekey` moves state and later stops and handoffs use the new id
    - `rekey` merges and treats no-op calls as no-ops
    - `readSubagentTaskText` unit tests
  - `subagent-message-dispatcher.spec.ts`. New tests: a steer and a handoff pushed in the same tick reach `streamInput` in call order with the same `origin`; `SESSION_NOT_FOUND`; the send timeout leaves no timer behind.
  - `compaction/compaction-coordinator.spec.ts`. The microtask test now checks that the error reaches the handler with the change, the later listener still runs, nothing goes to `queueMicrotask`, and there is no `uncaughtException`. A second test covers a handler that throws and the default with no handler.
  - `session-lifecycle/session-query-executor.service.spec.ts`. The `realMonitor()` constructor call was updated to the 4 arguments. New test: a main-loop `Agent` tool_use message is forwarded to `observe`.

## Checks (run from the worktree)

| Command | Exit | Result |
| --- | --- | --- |
| `npx nx test agent-sdk --testPathPatterns="subagent-budget-monitor\|compaction-coordinator\|subagent-message-dispatcher\|session-query-executor"` | 0 | 7 suites, 145 tests passed |
| `npx nx run-many -t typecheck,lint,test -p agent-sdk --parallel=2` | 0 | all 3 targets ran, cache 0/3 |
| `npx nx run-many -t typecheck -p ptah-electron,ptah-cli,ptah-extension-vscode --parallel=2` | 0 | cache 0/3 |
| `npx nx test ptah-electron --testPathPatterns="wire-runtime\|container.smoke"` | 0 | 3 suites, 56 tests passed (no DI cycle) |
| `npx nx run di-lint:lint` | 0 | — |
| `npx nx run degradation-audit:lint` | 0 | — |

## Plan deviations

- Task text source. Batch 4 names only the monitor (and its spec) as files. But the executor's compaction tap forwarded only messages with a `parent_tool_use_id`, so the parent `Agent` tool_use could never reach the monitor. I added a 4-line branch in `session-query-executor.service.ts` `handle()` plus a `hasToolUse` helper, and one spec test. I also updated the existing `realMonitor()` constructor call in that spec, which the signature change required. Batches 3 and 15 also own this file; whoever commits must check that my hunks (the `hasToolUse` helper near line 163, the `else if` in `handle`, spec lines ~1303-1335 and the `realMonitor` call) sit cleanly with theirs.
- Task text content. The plan says "description, else the first 300 chars of prompt". `description` is only 3-5 words, so I record both: `description: <prompt excerpt>`. Each part also works alone.
- `pushParentMessage` stays in `SubagentMessageDispatcher`, which the barrel already exports, so no barrel change was needed. It is a new public method, flagged for the style review as the batch asked.
- `CompactionCoordinator` without a handler drops listener errors. Production always passes the logger handler, and specs pass their own.

## Out-of-scope observations

- Batch 5 still has to call `monitor.rekey(from, to)` on PostCompact. The method exists, but nothing calls it yet.
- The R9 flaky dispatcher spec did not flake in these runs.
