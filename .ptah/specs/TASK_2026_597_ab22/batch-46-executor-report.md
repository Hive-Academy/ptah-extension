# Batch 46 executor report — N6 per-agent usage, context and cache data

Executor: frontend-developer. Worktree `D:/projects/ptah-extension/.claude-worktrees/task-597-followups`, HEAD `5c560c54c`
(Batch 41). Nothing committed; the working tree is dirty.

## Tasks

- 46.1 `estimateUsageCost` parity spec: COMPLETE (spec only, no production edit in `libs/shared`).
- 46.2 `MonitoredAgent` / subagent usage, context and cache state: COMPLETE.

## Files

- MODIFIED `libs/shared/src/lib/utils/pricing.utils.spec.ts`: new `describe('calculateMessageCost parity with the agent-usage tool (M)')`.
  It reads M's sanitized Claude subagent fixture
  (`scripts/agent-usage/__fixtures__/claude-session/subagents/agent-code-logic-reviewer.jsonl`), sums the four usage
  fields per `message.id` with the last line winning (M's rule, `claude-transcript.reader.ts:223-230`), and asserts that
  (1) the sums equal M's totals for the fixture (cacheRead 2,918,449, cacheCreation 353,847, output 41,714, the values
  in `subagent-metrics.spec.ts:76-86`), (2) `calculateMessageCost` on the sums equals the four-field price formula, and
  (3) it equals the sum of the per-response estimates. Explicit `ModelPricing` keeps the test independent of the
  bundled table.
- MODIFIED `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts`:
  - New exported types `AgentCacheState` (`'warm' | 'cold' | 'unknown'`), `SubagentUsageTotals` and `AgentUsageView`.
    The new pure export `subagentUsageView(record, now)` returns `contextTokens`, `cacheState`, `cacheReported`,
    `effectiveTtl`, `idleMs`, `usage { cacheRead, cacheWrite, output }` and `estimatedCostUsd`
    (`calculateMessageCost`; `null` when the model has no price, `undefined` when no usage or model is known).
  - `MonitoredAgent` gains the optional `contextTokens`, `cacheState` and `cacheReported` fields. Every CLI lane card
    (fresh spawn, replacement, `loadCliSessions`) gets `cacheState: 'unknown'` and `cacheReported: false`.
    `contextTokens` is not set. The cost the lane reports stays in its segments, unchanged.
  - The store's `SubagentRecord` gains the optional `lastEventAt`, `usage` and `cacheTtl` fields. All four lifecycle
    reducers carry them forward through `carriedUsageFields` and move `lastEventAt` forward to `event.timestamp`.
  - New reducer `onSubagentMessageComplete(event)`. It keeps per-message usage in a private
    `Map<parentToolUseId, Map<messageId, usage>>`, so a repeated or replayed report replaces the earlier one and is not
    counted twice. It sums the usage into `record.usage` and stamps the activity time. Usage reported before the record
    exists is applied when the record is created. The map is cleared in `ngOnDestroy`.
  - New `loadSubagentCacheInfo(parentToolUseId)`: one `chat:subagent-query { toolCallId }` call, made when a row is
    opened, never on a timer. It stores `cacheInfo.effectiveTtl` (validated `'5m' | '1h'`) and moves `lastEventAt`
    forward to the host's `lastActivityAt` (finite values only). A failure, a miss or a missing `cacheInfo` leaves the
    state `'unknown'`.
- MODIFIED `libs/frontend/chat-streaming/src/lib/agent-monitor.store.spec.ts`: new `describe('N6 per-agent usage, context
and cache data')` with 15 tests: lane "not reported" fields; per-message sums and last-request context; no double
  count on a repeated message; cache and context left `undefined` (never 0) when not reported; no usage before any
  report; `null` estimate for an unpriced model; malformed host numbers ignored; usage that arrives before the record;
  main-session message ignored; `'unknown'` until a TTL is known; one query then warm/cold against the 5 m TTL; host
  `lastActivityAt` adopted; no activity gives cold with an unknown idle time; failure, miss, no `cacheInfo` or an invalid
  TTL all stay `'unknown'`; fields kept across progress, status and completed events.
- MODIFIED `libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts`: the `message_complete` case calls
  `agentMonitorStore.onSubagentMessageComplete(event)` when `event.parentToolUseId` is set (4 lines).
- MODIFIED `libs/frontend/chat-streaming/src/lib/accumulator-core.service.spec.ts`: mock gains
  `onSubagentMessageComplete`; 2 tests check that a subagent message is forwarded and a main-session message is not.
- MODIFIED `libs/frontend/chat-streaming/src/index.ts`: exports `subagentUsageView`, `AgentCacheState`, `AgentUsageView`
  and `SubagentUsageTotals` for Batch 47.

## Data sources (AS-N6a)

AS-N6a is FALSE as written. The execution-tree agent node does not carry cache fields:
`AgentStatsService.aggregateAgentStats` (`libs/frontend/chat-execution-tree/src/lib/agent-stats.service.ts:84-121`)
sums `{ input, output }` only. Batch 46 therefore uses the source one step earlier: the subagent's own live
`message_complete` events, which the backend's assistant-message transformer builds with `cacheRead` / `cacheCreation`
when the SDK reports them (`libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts:363-377`,
`parentToolUseId` at `:407`). The shared `MessageCompleteEvent.tokenUsage` type declares only `{ input, output }`
(`libs/shared/src/lib/types/execution/stream.ts:222`), so the store reads the two cache fields structurally and
validates them (`readRequestUsage`). The shared type is not changed (46.1 forbids production edits in shared).

Gaps, all shown as "not reported", never 0:

- Stream-source `message_complete` (`stream-event.transformer.ts:315-325`) carries no usage. It only stamps the
  activity time.
- History replay of agent messages carries `{ input, output }` only (`session-replay.service.ts:574-575`), so a
  replayed subagent has usage without cache fields: `cacheReported: false` and `contextTokens` undefined.
- The effective TTL is known only after `loadSubagentCacheInfo` runs. Until then `cacheState` is `'unknown'` (no
  badge).

## Stack observed

Angular 22.1.7 (`package.json:95`) signals store (`@Injectable({ providedIn: 'root' })`, `signal`/`computed`, `inject()`) in
`agent-monitor.store.ts`. No component or template changed in this batch. Tests use Jest + TestBed with
`createMockRpcService` from `@ptah-extension/core/testing`, the same as the existing store spec.

## Verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat-streaming @ptah-extension/chat @ptah-extension/canvas
@ptah-extension/tribunal-panel @ptah-extension/shared ptah-extension-webview @ptah-extension/chat-routing`:
  "Successfully ran targets typecheck, lint for 7 projects" (14 tasks, 0 cache hits). The only chat-streaming lint
  output is warnings: `max-lines` on `agent-monitor.store.ts` (the file was already over 700 before this batch) and an
  unused `SeedTextDelta` in another file.
- `npx nx run-many -t test -p @ptah-extension/chat-streaming @ptah-extension/shared @ptah-extension/chat
@ptah-extension/canvas @ptah-extension/tribunal-panel @ptah-extension/chat-routing --maxWorkers=2`:
  "Successfully ran target test for 6 projects".
- Targeted run before that: `npx jest -c libs/frontend/chat-streaming/jest.config.ts agent-monitor accumulator-core`
  gave 4 suites and 164 tests, all passed. The pricing parity block passed 3 of 3.
- `@ptah-extension/chat-routing` was added to both lists, beyond the Batch 46 row. Its `StreamRouter` passes the store
  into `StreamingAccumulatorCore.process`, which now calls a new store method.

## Deviations

1. Files outside the listed ownership, all inside the same `chat-streaming` project: `accumulator-core.service.ts` (+
   spec) and `index.ts`. Without the 4-line wiring the store never receives subagent usage: it was not fed
   `message_complete` before this batch. Without the barrel export Batch 47 cannot use the view. No other project's
   files were touched.
2. Task 46.1 fixture: the spec uses M's Claude subagent fixture (added by Batch 36) instead of the Batch 10 rollout.
   The Batch 10 fixture is a Codex rollout. It has no cache-write field and no Claude model, so it cannot exercise the
   four fields `calculateMessageCost` prices for a Claude subagent. M's totals for the Claude fixture are asserted
   directly.
3. "`MonitoredAgent` gains usage" is split by agent kind, following the plan's own split. Lanes get the three
   constant cache fields on `MonitoredAgent`. Claude subagents are `SubagentRecord`s, so their data lives on the
   record, and `subagentUsageView(record, now)` derives the display shape. The caller supplies `now`, so Batch 47
   decides how often warm/cold is re-evaluated (for example the store's existing `tick`). No new timer was added.

## Out-of-scope observations

- `MessageCompleteEvent.tokenUsage` in `libs/shared/src/lib/types/execution/stream.ts:222` is narrower than what the
  backend sends. Widening it with the optional `cacheRead` / `cacheCreation` fields would let the structural read go.
  That is a shared production edit for a later batch.
- `onTaskToolResult` takes no timestamp, so a foreground subagent's final `tool_result` does not move `lastEventAt`.
  The subagent's last `message_complete` comes just before it, so the effect on warm/cold is seconds.
