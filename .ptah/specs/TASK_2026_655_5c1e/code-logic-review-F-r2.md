# Code logic review — Batch F fixes (round 2)

Review family: grok (reviewer) / codex (implementer)

## Verdict

REVISE. Score 4/10.

The filed ordering and fail-open fixes are present and, where named below, pinned by tests that would fail on the old control flow. They are not enough. The new subagent repair writes the seed into a frozen history message and leaves every later subagent event in a streaming state the transcript does not render, so the live tail disappears after a successful resync. A resync that overflows before `session:load` returns also releases that seed onto the unrestored tab. That is streamed content lost or shown twice, which is the bar for this batch. I did not re-run Jest; the orchestrator’s pass of `@ptah-extension/chat` (199 suites, 3,688 passed, 2 skipped) is noted and does not exercise the transcript.

Why not 3: claim release order, waiter resolution, reset-before-release on the throw path, the gauge marker, and filter fail-open all match the decisions and I could not break those paths. Why not 5: the subagent tail is the workspace-switch stream itself, and the new test locks in the split that hides it.

## Per-item verification

| Item | Fixed? | Evidence file:line | Test pins it? |
| --- | --- | --- | --- |
| A1 absent viewport reply | yes | `stream-viewport-controller.service.ts:111-120` (`result?.success`, catch sets `v2Accepted` false) | yes — `keeps focused scheduling when the declaration resolves without a reply` (`stream-viewport-controller.service.spec.ts:80`). An undefined reply used to reject `declare()` via `void`; Jest surfaces that as a failure. |
| A2 missing RPC reply / CLI injector | yes | `session-liveness-reconciler.service.ts:66`; `session-loader.service.ts:1574-1575` | yes for production (`result?.success`). CLI spec diff only adds `SessionLivenessReconcilerService` and `StreamViewportController` providers. No assertion was removed or weakened. |
| A3 filter throw must not block delivery | yes | `session-history-replayer.service.ts:879-886` | yes — `fails open for buffered and after-close filter errors` (`session-history-replayer.service.spec.ts:1233`). `session-loader.service.spec.ts:2499` pins history → seed → buffer order only; it does not throw. |
| F3-1 registry before release (non-resync) | yes | `session-loader.service.ts:1146-1154` (delete, then `release`, then resync delete and `resolve` in the nested `finally`) | yes — `starts a second compaction reload drained by release after a failed load` (`session-loader.service.spec.ts:2526`) expects a second `session:load`. |
| F3-2 gauge marker at apply time | yes | `session-loader.service.ts:1057-1065` (read and delete only when stats are applied); re-add `1166-1168` | yes — `preserves the compaction gauge…` (`:2575`) and `carries the compaction gauge seed…` (`:2604`). |
| F3-3 malformed seed element | yes | `chat-message-handler.service.ts:594-597`; `session-loader.service.ts:1174` (`event?.eventType`) | yes — `rejects a resync snapshot with a malformed seed element` (`chat-message-handler.service.spec.ts:1098`). |
| F3-4 reset before release on early `session:load` failure | yes on the throw path only | `session-loader.service.ts:1125-1132` runs before `release` at `1149` when `!loadCompleted` | yes — `resets a resync tab before applying the seed after session:load fails` (`session-loader.service.spec.ts:2553`) expects `reset`, `seed`, `live`. The overflow return at `926-929` is not this path. See defect 2. |
| F2 D1 fence close on registration throw | yes | `session-history-replayer.service.ts:717-725` and `finally` `763-766`; `release` `225-235` | yes — `closes the fence and delivers buffered events when filter registration throws` (`session-history-replayer.service.spec.ts:1203`). |
| F2 D2 decide throw fails open | yes | seed `747-754`; live `879-886` | yes — `fails open when a filter throws while deciding a seed event` (`:1217`) and `:1233`. |
| F2 D3 retire closed tabs and idle filters | partial | binding effect `session-loader.service.ts:399-410`; empty-seed skip `session-history-replayer.service.ts:781-783`; terminal seed skip `:784-785` | closed tab: yes — `retires a persisted filter as soon as its tab is closed` (`session-loader.service.spec.ts:2641`). Idle: only the empty index — `retires an idle empty-seed filter at fence close` (`session-history-replayer.service.spec.ts:1254`). A non-empty history with no seed `turn_state` still registers. |
| F2 D4 overflow drain session key | yes for the buffered drain | `session-history-replayer.service.ts:647`, `841`, `851-853` pass the held session | yes — `uses the held session key when an overflow drains a mismatched event` (`:1284`). The single event that trips the bound still uses the caller session (`648`). See decisions. |
| F2 D5 unchanged tool node is reconciled | yes | `session-history-replayer.service.ts:814-818` | yes — `accepts an unchanged matching history tool node as reconciled` (`:1262`) expects the second identical result excluded and no warning. |
| Subagent seed nesting | no (new loss) | `session-history-replayer.service.ts:332-370` | no — `A-2 nests a seeded subagent anchor…` (`session-loader.resync-live-seed.spec.ts:276`) asserts the split and never renders the transcript. |

## Defects

### 1. serious — seeded subagent tail is stored and then not shown

`session-history-replayer.service.ts:332-370`. `closeFence`’s `finally` (`763-766`) runs `leaveFence` before `closeFence` returns, so buffered live events are applied to the new streaming state first. The rebuild that follows copies only `appliedSeed` (the seed list, not the buffer) into the historical message and `setMessages` (`369`) does not clear `streamingState`.

Failure: a resync seed contains `agent_start` / `message_start` / `text_delta` whose `parentToolUseId` is a Task tool already in history, and at least one further subagent `text_delta` is buffered or arrives after release. `finalizeSessionHistory` has already frozen history and set `streamingState` to null (`message-finalization.service.ts:300`, `tab-manager.service.ts:2010-2014`). The seed snapshot is nested under the Task node, so the prefix is visible once. The buffer and every later chunk land only on `tab.streamingState` under `subagent-message`. `execution-tree-builder.service.ts:319` skips any `message_start` with `parentToolUseId`, so `buildTree` returns no root. `chat-transcript.component.ts:433-436` then drops nothing further because there is no streaming root, and it will not paint a parented message whose id is absent from `finalizedMessageIds`. The historical Task node stays the seed snapshot. The user sees the prefix and none of the rest. No error is raised.

`session-loader.resync-live-seed.spec.ts:310-323` requires both the live `eventsByMessage` entry and the historical child text, so it passes while the tail is invisible.

Suggested fix: keep one visible owner for the open subagent. Either fold post-seed subagent events into the historical Task node as they arrive, or keep a streaming root the transcript will paint and do not also copy that same text into the frozen message. Extend A-2 to assert the transcript’s `allMessages` contains the seed text once and contains a delta that arrives after release.

### 2. serious — overflow before reset releases the seed onto the old tab, and the repair can no-op

`session-loader.service.ts:926-929` sets `freshResyncNeeded` and returns while `loadCompleted` is still false. The reset in the `catch` (`1125-1132`) does not run. `finally` still calls `release` (`1149`), and `closeFence` applies the seed because the claim is current and the tab binding still matches (`715-756`).

Failure: a resync claim holds a `liveSeed` for text already on the tab; the fence reaches `LIVE_EVENT_FENCE_LIMIT` during `session:load`. Release appends the seed to the existing streaming state and leaves the old messages in place (`setMessages` is not involved; `applyResumingSession` at `968` never ran). The same `finally` calls `requestStreamResync` (`1169`). That call returns immediately when `v2Accepted` is false (`stream-viewport-controller.service.ts:58`), which is the state until `declare` gets `acceptedProtocolVersion === 2` (`117`). A snapshot can be handled before that declaration resolves. The duplicate then stays. When v2 is already accepted, the follow-up resync does clear messages (`tab-manager.service.ts:2543-2546`), so the duplicate lasts until that load finishes.

Suggested fix: on this return, use the same reset as `1125-1132` before `release` (empty streaming state, clear messages) so the seed applies once onto an empty tab. Do not rely on `requestStreamResync` as the only cleanup.

### 3. moderate — terminal retirement deletes rule T

`session-history-replayer.service.ts:888-890` removes the filter from `persistedFilters` on `compaction_complete` or a terminal `turn_state`. `decide` has already called `retire()` (`persisted-content-filter.ts:114-117`), which is what arms the retired branch (`108-111`): a later `tool_result` whose id is in `historyToolIds` is kept and reconciled when the output differs. After the map delete, that branch never runs.

Failure: history contains tool `toolu_T` with output `old`. The filter sees a terminal `turn_state` and is deleted. A later `tool_result` for `toolu_T` with output `new` is delivered by the normal path (not dropped) and `patchHistoryToolResult` is not called. The history card stays `old`. A second copy can appear from the live event. The decision for this round was: after retirement, rule T stays active for `historyToolIds` only (keep, reconcile when different, never drop).

`filters a persisted block after close and retires at the terminal` (`session-history-replayer.service.spec.ts:847`) expects a later `text_delta` to return false from `deferLiveEvent`. That still holds if a retired filter ignores non-tool events and does not set `consulted`.

Suggested fix: leave the retired filter in the map. In `exclusions`, if it is retired, consult only `tool_result` events in `historyToolIds`; let every other event fall through with `consulted` false.

## Five logic questions

1. Silent success: defect 1. Resync resolves `{ staleSnapshot: false }`, the Task card shows the seed, and later subagent deltas sit in `streamingState` with no transcript root.
2. User action: switch workspace away and back while a Task subagent is streaming, then let more tokens arrive (defect 1). Separately, a resync whose fence overflows before `session:load` returns (defect 2).
3. Wrong answer without an error: the subagent seed is nested once and the continuation is omitted. A post-terminal history `tool_result` with a new output does not patch the history node (defect 3). Malformed `liveSeed` elements are now rejected rather than thrown (`chat-message-handler.service.ts:594-597`).
4. Dependency failure: a throwing `decide` or filter constructor retires the filter and still delivers (`747-754`, `717-725`, `879-886`). `session:load` rejection resets the resync tab before release (`1125-1132`). `release` throwing still deletes a resync registry entry and resolves waiters (`1150-1154`). An undefined viewport or `session:status` reply no longer throws (`stream-viewport-controller.service.ts:116`, `session-liveness-reconciler.service.ts:66`). `requestStreamResync` failing or no-oping leaves defect 2 in place.
5. Not in the original acceptance list: the transcript’s root filter versus a parented live subagent; rule T after the filter object is removed; a non-empty idle history still registering a filter (`session-history-replayer.service.ts:777-785`).

## Decisions

- Fail-open filter exceptions may deliver one extra copy. That duplicate is the accepted one from this round, not a defect.
- Not reopened: rule R turn boundary, A-B2 failure, page edge, older host without `liveSeedBlocks`.
- D3’s remaining idle filter (non-empty history, empty seed, no seed `turn_state`) does not drop a new `messageId` (`persisted-content-filter.ts:210-212` returns no state, `decide` keeps it). Closed and rebound tabs are retired. Not filed as content loss.
- The event that trips the fence bound is filtered with the caller’s session id (`session-history-replayer.service.ts:648`), not `fence.sessionId`. The buffered drain is fixed and pinned. A mismatched tripper can skip the filter once. That is the same duplicate class as old D4, one event, and only when `findFence` matched the tab’s fence rather than the event’s session. Not scored separately.
- `ptah_agent_report` is not on the connected MCP server (`tasks` only). The review file is the deliverable.
