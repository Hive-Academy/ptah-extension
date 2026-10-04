# Backend implementation — TASK_2026_597_ab22, sub-batch 28b (Task 28.3)

**Tasks completed**: 28.3 (executor feed, token, registration). Forwarded subagent messages reach `SubagentBudgetMonitor.observe`. The monitor is released on session end.

## Files (all under `libs/backend/agent-sdk/src/lib/`)
- MODIFIED `helpers/session-lifecycle/session-query-executor.service.ts`:
  - New exported type `SubagentBudgetSink` (`Pick<SubagentBudgetMonitor,'observe'|'release'>`).
  - `CompactionSessionTap` takes the sink as an optional last constructor argument. `handle` now checks `parent_tool_use_id` first. A subagent message goes to `feedSubagentMonitor`, keyed on the message's `session_id` (falling back to the tap's id). A main-loop message never reaches the monitor.
  - `feedSubagentMonitor` guards both a sync throw and a rejection. Each failure writes one warn line, "Subagent budget monitor failed; the turn continues".
  - `release()` (the abort path that already releases the coordinator and port) also calls `monitor.release(id)` for every subagent session id seen. It is idempotent.
  - The executor takes a third optional trailing constructor argument, `subagentBudgetMonitor`.
- MODIFIED `helpers/session-lifecycle/session-query-executor.service.spec.ts`: `makeHarness` takes `subagentMonitor`. A new describe has 3 cases: subagent forwarded and main ignored; release once on abort; a throwing or rejecting monitor gives 2 warn lines, no error, no throw.
- MODIFIED `di/tokens.ts`: `SDK_SUBAGENT_BUDGET_MONITOR = Symbol.for('SdkSubagentBudgetMonitor')`.
- MODIFIED `di/register.ts`: `useClass: SubagentBudgetMonitor`, Singleton, next to `SDK_CONTEXT_USAGE_PORT`.
- MODIFIED, outside the listed files (same deviation as 26b and 27b): `helpers/session-lifecycle-manager.ts`. It adds an optional `@inject(SDK_SUBAGENT_BUDGET_MONITOR, {isOptional:true})` and passes it to `new SessionQueryExecutor(...)`. The executor is not in the container, so without this the wiring would be dead in production.

## Checks
- `session-query-executor.service` spec: 30/30 passed.
- `nx run-many -t test,lint,typecheck -p @ptah-extension/agent-sdk`: the first run failed in the test target (the output showed no failing suite). Re-running `nx run @ptah-extension/agent-sdk:test --skip-nx-cache` passed: 141 suites, 2936 tests. I counted the first failure as a load flake. Lint and typecheck: exit 0.
- Importer typecheck (affected set for `src/index.ts`, minus `api-*`, `ptah-license-server`, `ptah-landing-page-e2e`): exit 0, 18 projects.
- `nx run di-lint:lint`: exit 0.
- `nx run degradation-audit:lint`: `libs/backend/agent-sdk: 4 ok (baseline 4)`. The ptah-cli lines in the output are other projects' known entries.
- Prettier was applied. No `*.png` was rewritten.

## Deviations
1. The TTL argument is omitted. The effective subagent prompt-cache TTL is resolved inside `SdkQueryOptionsBuilder.build()` (`sdk-query-options-builder.ts:1166`) and is not returned to the executor or stored on the session record. The monitor defaults to `'5m'`, and real messages carry the `cache_creation` split, so the default only matters for a message without it. To pass the TTL through, `build()`'s result or the session record would need to carry `subagentTtl.effective`. That is a separate change.
2. The facade edit above.
3. The monitor id is the subagent message's `session_id`, the real SDK id. This is the id the dispatcher and registry use, per 28a.

## For 28c (assumption A-W1): the existing event
- The event is `MessageCompleteEvent` with a `parentToolUseId`, handled by `onSubagentMessageComplete(event)` in `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts` (about line 1863).
- It already carries `tokenUsage`, which the store reads structurally in `readRequestUsage` (about line 150). The fields are `{input, output, cacheRead?, cacheCreation?}`, along with `messageId` and `model`.
- The store keys per-request usage by `messageId` and derives `lastRequestContextTokens` (line 113/204). `MonitoredAgent` and `subagentUsageView` (`contextTokens`, line 260) read it.
- So A-W1 holds. One optional field, for example `contextTokens`, on `tokenUsage` (or on the event) can carry the backend figure.
- The emit point is the backend assistant-message transformer, which adds `cacheRead` and `cacheCreation` to `tokenUsage`. 28c should locate it. The monitor's `getSnapshot(sessionId, toolCallId)` is the source of the figure.
- I did not edit this file.
