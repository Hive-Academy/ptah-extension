# Implementation Plan - TASK_2026_626_7b3e

Show live session stats while a turn runs, on a new throttled `session:stats-live`
channel. `session:stats` (`MESSAGE_TYPES.SESSION_STATS`) stays the single
authoritative end-of-turn signal.

All paths are relative to the worktree
`D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb`.

## Revision 3 changes

Answers `implementation-plan-review.md` (revision 2, round 2). Both findings were
re-checked against source before the change.

| # | Finding | Evidence re-checked | Plan change |
| --- | --- | --- | --- |
| 1 (Serious) | An authoritative settle payload carried `readMainContext()` (stream partials); the floor admits an equal revision (`session-stats-snapshot.ts:81-87`), so a settle arriving after `session:stats` could overwrite the result's context gauge, which the result path derives from `modelUsage` and writes unconditionally (`session-stats-aggregator.service.ts:171-190`, `setLiveModelStats` at `:188`). The same hole exists for an authoritative agent-count publish after a result (cached `publish()` at the result's revision). | Verified. | **Context rides only on provisional snapshots**, enforced at three layers: (a) the publisher attaches `context` only when the emitted snapshot has `provisional: true` (settle, release-settle, dispose and authoritative agent-count publishes never carry it); (b) the shared parser drops `context` from any payload whose snapshot is not `provisional: true`; (c) `installLiveSessionStats` writes context only when the snapshot is `provisional === true` AND admitted. Provisional context stays subject to admission (unchanged). New tests on both arrival orders (settle before / after `session:stats`) with partial context ≠ result context, in Components 1, 3, 4, 7 and 8. Component 4's "same snapshot, arrival order does not matter" claim now holds for context as well. |
| 2 (Serious) | Stop (`chat:abort` → `abortSession` → `interruptSession`, `chat-session.service.ts:1300-1314`) awaits `sessionLifecycle.endSession` and then `releaseStatsOwners` (`sdk-agent-adapter.ts:1593-1599`); the stream's `finally` may run after the release, so `dispose()` found no owner and the tab kept the estimate marker. | Verified; `endSession` (`:923-939`), `endSessionIfTokenMatches` (`:1257-1264`) and workspace teardown (`:761-771`) release the same way. | **Settle at release.** The owner's per-stream watcher set (revision 2's agent watchers) becomes an `OwnerWatcher` set with two signals: `onAgentRecorded()` and `onReleased(settled)`. `release(lease)`, after its existing generation+epoch match and before returning `true`, clears every run's `provisional` (touching when any was set), builds the authoritative snapshot with `publish()`, deletes the state, then calls each watcher's `onReleased(snapshot)`. The publisher emits it through `onLiveStats` (no `context`) when it had shown an estimate, synchronously, then marks itself settled so a later `settle()`/`dispose()` emits nothing. Generation safety is the existing lease rule: a release only fires watchers of the exact state object it deletes; a replacement owner or a newer run's epoch (`release` returns `false`) is untouched, and in that case the stream's own `dispose()` settles as before. Both orders (dispose before release, release before dispose) produce exactly one settle. A5 narrowed to `startNew` replacement and `clearAll` (no display bound to the old owner, see A5). New integration tests: Component 4 (real owner + real publisher, release before stream disposal), Component 5 (`interruptSession` with the stream still open), Component 8 (the resulting payload sequence clears the marker on an open tab with no new turn or resume). `watchAgents` is renamed `watch`. |

## Revision 2 changes

Answers `implementation-plan-review.md` (revision 1, round 1). Each finding was
re-checked against source before the change.

| # | Finding | Plan change |
| --- | --- | --- |
| 1 (Blocking) | A result can leave the provisional figure on screen: `duplicate` is never sent (`stream-transformer.ts:918-921`), a result with no usage is not a stats update (`:922-925`), `validateStats` may drop the payload (`:939-944`), and `replaceRun` returns the unchanged-revision snapshot for every non-accepted outcome (`session-stats-owner.service.ts:500-525`). | New **settle** step. The publisher remembers whether it emitted a `provisional: true` snapshot since the last boundary. At the end of every result branch (after the `onResultStats` block, before `isCompactBoundary` at `stream-transformer.ts:952`) the transformer calls `publisher.settle()`; when the flag is set it emits ONE more `session:stats-live` payload carrying the owner's authoritative snapshot (no `provisional` field) at the revision that `clearProvisional` bumped, so it is strictly greater than every live revision. It travels the live channel only: no footer, no `pendingStats`, no queued dispatch, no budget. `dispose()` settles too (stream ended without a result). A4 is withdrawn. Per-branch tests in Components 2, 3 and 4. A rejected alternative (snapshot-only `SESSION_STATS`) is recorded. |
| 2 (Serious) | `installSessionStats` returns `void` (`tab-manager.service.ts:2252-2262`), so a context reading applied after it bypasses the floor. | New `TabManagerService.installLiveSessionStats(tabId, snapshot, context?)` returns `boolean`: one `acceptSessionStats` call (`:2348-2372`) admits the snapshot, and the context reading is written in the SAME `updateTabInternal` patch only when it was admitted. The public `applyLiveContextTokens` is dropped; the fill is computed by the existing pure private helper `postCompactionContextStats` (`:2159-2196`, prior capacity), so no extraction is needed. The surface path (`surface-session-stats.registry.ts:72-103`) receives no context reading at all (`live: null`), so nothing can bypass its own floor; a test pins that. Tests for an out-of-order live event with a different context after an authoritative install, on both paths. |
| 3 (Serious) | `task_started` may precede the SubagentStart hook's `recordAgent` (`subagent-hook-handler.ts:89-102`, owner `:553-560`), so the immediate flush reads the old count and nothing re-publishes. | The owner gains a per-owner agent watcher set: `watchAgents(sessionKey, generation, watcher)` returns a detach function; `recordAgent` calls every watcher after it changed the count. The publisher attaches one watcher at `setSessionKey` and detaches at `dispose`. A watcher never flushes synchronously; it arms the throttle timer (delay 0 when the window is open, else the trailing slot), so the new count reaches the header within one interval with no usage frame. Watchers live on `OwnerState`, so they follow `rebind` (`:446-453`, state moved, never cloned) and are released with the owner. Tests for hook-then-message and message-then-hook with no usage frame. |
| 4 (Moderate) | Plan said `SESSION_STATS` finalizes streaming. | Corrected everywhere: `turn_state` finalizes through `TurnStateApplier` (`libs/frontend/chat-streaming/src/lib/turn-state-applier.service.ts:65`); `StreamingHandlerService.handleSessionStats` stashes `pendingStats` while streaming or merges the footer onto the last message and returns queued content (`streaming-handler.service.ts:578-595`, `:660-679`); the aggregator's result path then reloads sessions and may send the queued message (`session-stats-aggregator.service.ts:153-202`). The live channel, including the settle payload, never enters that path. Component 8 tests spy on each effect. The stale comment at `chat-message-handler.service.ts:366-373` is noted, not edited (out of scope). |

## Inputs and constraints

- Requirements used: `task.md`, `context.md`, `decisions.md` (D1-D4) in this task
  folder; the architect brief from the orchestrator (design direction "decided").
- Corrections applied: none.
- Design handoff used: none (no UI design documents; the only UI change is an
  estimate marker on an existing chip).
- Repository instructions: root `CLAUDE.md` (scoped verification only) and
  `CONVENTIONS.md` (layer rule section 8, DI tokens section 4, naming section 6,
  disposal section 9). No per-library `CLAUDE.md` exists under `libs/` (Glob for
  `**/{CLAUDE,AGENTS}.md` under `libs` returned nothing); the "agent-sdk/CLAUDE.md
  forbids a MESSAGE_TYPES push for turn state" rule survives only as a comment in
  `libs/shared/src/lib/types/messages/session-mcp-status.ts:22-29`. This plan
  honours it: `session:stats-live` carries no turn state and never drives
  completion (see Decision 2).
- Missing decision-critical input: none. Two points where the brief and the
  evidence pull apart are resolved in the Architecture decision section
  (late-event filtering; how a subagent start triggers a publish).

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| `session:stats` is broadcast only from the `result` branch: `replaceRun` / `markRunIncomplete` then `onResultStats` | `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:655-951` (`replaceRun` at :861, `markRunIncomplete` at :906, `onResultStats` at :945) | Root cause confirmed. Live publication needs its own path that does not go through `onResultStats`. |
| The result branch `await`s `pricingProvider.getPricing` before `replaceRun` | `stream-transformer.ts:742-744` | Any live timer must be cancelled at the TOP of the result branch, before the first await, or a trailing flush could run between the result and its authoritative publish. |
| `onTurnEnd` fires first in the result branch, "nothing below may gate it" | `stream-transformer.ts:655-658` | The live hook goes immediately after `onTurnEnd`, not before it. |
| The transformer forwards `assistant` messages (main loop and subagent) to the flat-event transformer | `stream-transformer.ts:957-981` | The transformer already sees every assistant frame; no new SDK option is needed. |
| `forwardSubagentText` defaults to ON and forwards nested subagent messages carrying `parent_tool_use_id` | `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:811-821`, `:896-903`, `:1318` | Subagent usage arrives on the same stream as `assistant` frames with `parent_tool_use_id` set. |
| `SDKAssistantMessage.message` is a `BetaMessage` with `id`, `model`, `usage`; "When streamed, content typically holds the single block this message delivers" | `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:3405-3413` (repo-root `node_modules`) | One API message arrives as several frames sharing one `message.id`; summing frames double-counts. |
| The transcript ledger dedupes by `message.id`, a later line replacing only the counters it carries | `libs/backend/agent-sdk/src/lib/session-stats/session-usage-ledger.ts:119-133`, `:200-231` | Established per-message-id rule to mirror in the live accumulator. |
| Main-loop `stream_event` partials are main-loop only on the wire (`parent_tool_use_id` is `null`) | `stream-transformer.ts:517-523` | Stream events cannot attribute subagent usage; the accumulator uses `assistant` frames only. |
| `lastTurnContextByModel` + `currentStreamModel` track the main loop's latest request context | `stream-transformer.ts:476-485`, `:523-572`; cleared at `compact_boundary` `:952-955` | Source for a live context-fill reading; no new tracking needed. |
| `isAssistantMessage`, `isTaskStarted` type guards | `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts:384-388`, `:416` | Verified guards for the accumulator and the agent-start trigger. |
| `SDKTaskStartedMessage` (`type:'system'`, `subtype:'task_started'`, `subagent_type`) | `sdk.d.ts:5703-5719` | A subagent start is visible in the stream; usable as a live-publish trigger. |
| Owner state: `RunState`, `OwnerState`, `touch`, `publish` (authoritative, cached in `state.published`) | `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts:336-371`, `:647-701` | Provisional state belongs on `RunState`; the live snapshot must be built separately and never cached in `published`. |
| `replaceRun` touches only on `accepted`; duplicates / rejections publish at the unchanged revision | `session-stats-owner.service.ts:460-526`, `applyResult` `:729-746` | Authoritative-after-live ordering cannot rely on `replaceRun`'s touch; a separate clear step must bump the revision. |
| `recordAgent` mutates `agentIds` and touches; called from the SubagentStart hook | `session-stats-owner.service.ts:553-560`; `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts:89-102` | Agent count is already in owner state; a live flush reads it. The hook has no handle on any stream. |
| `snapshot()` is read by resume and the session budget | `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:1102`; `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.ts:456`, `:796` | `snapshot()` / `publish()` must stay estimate-free; the budget must never see an estimate. |
| `runContribution` turns a `RunUsageResult` into an aggregator contribution; `aggregateSessionUsage` merges contributions | `session-stats-owner.service.ts:816-863`; `session-usage-aggregator.ts:80-85`, `:181-188` | The estimate is one more contribution through the same arithmetic. |
| `RunModelUsage` / `RunUsageResult` shapes | `session-stats-owner.service.ts:125-163` (outline offsets; definitions at the `export interface RunModelUsage` / `RunUsageResult` declarations) | Reused as the estimate row type; no new row type. |
| Owner rebind to the canonical id is synchronous inside the `init` callback | `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1310-1315`; transformer calls `onSessionIdResolved` at `stream-transformer.ts:573-578` | Live publication keyed by `effectiveSessionId` after `init` always finds the owner. |
| `resolveForCost` is synchronous and returns `{ modelId, pricing | null }` | `libs/backend/agent-sdk/src/lib/auth-env.port.ts:53-77` | Live pricing stays synchronous; an unknown rate yields `costUSD: null`. |
| `calculateMessageCost(modelId, tokens, pricing)` | `libs/shared/src/lib/utils/pricing.utils.ts:404-421` | Existing pricing function for the estimate. |
| `resolveContextCapacity` gives a native route capacity only from the SDK's `contextWindow` (result-only) | `libs/shared/src/lib/utils/pricing.utils.ts:514-529` | A live context reading cannot know capacity on native routes; the frontend must reuse the capacity the last result established. |
| `ResultStatsPayload`, `ResultStatsCallback`, `IAgentAdapter` setters | `libs/shared/src/lib/types/agent-adapter.types.ts:46-90`, `:333-337` | Precedent for a new payload type + callback + setter. |
| `SessionStatsEntry` (optional fields at the boundary, "a missing field means unavailable") | `libs/shared/src/lib/types/rpc/rpc-session.types.ts:330-433` | An optional `provisional` field is additive and backward compatible. |
| Adapter wraps results for activity + budget, reads callbacks at `transform()` time | `sdk-agent-adapter.ts:901-920`, `:1785-1801`; other call sites `:1058`, `:1205`, `:1556` | Four `transform()` call sites must pass the live callback; it must NOT go through `wrapResultStatsForActivity`. |
| Callback registry | `libs/backend/agent-sdk/src/lib/helpers/sdk-adapter-callback-registry.ts:9-76` | Add one setter/getter/clear field. |
| Host forwarding: one wiring function for every host | `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts:75-129`; called only from `libs/backend/rpc-handlers/src/lib/host-profile/register-rpc-surface.ts:244` | VS Code, Electron and CLI all get the new broadcast from one change. |
| `session:stats` broadcast uses `retryWithBackoff` | `sdk-callbacks.ts:400-443` | The live broadcast must not retry (a retried estimate arrives stale and out of order). |
| Transports are message-type agnostic | `libs/backend/cli-engine/src/lib/transport/cli-webview-manager-adapter.ts:25-80`; `WebviewManagerLike` `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts:38-40` | No transport changes. |
| Host-source contract only fails for new names matching `/turn|recap|ptah-?ui|change-?set|host-?source|turn-?tests|usage/i` | `libs/shared/src/lib/types/rpc/host-source-registry.contract.spec.ts:17-34`, `:57-62` | `'session:stats-live'` does not match; the baseline (`host-source-registry.baseline.ts`, Gate-2 guarded, header `:1-5`) must NOT be regenerated. The name must not contain `usage` or `turn`. |
| Webview payload parsers are hand-written (no Zod in the initial bundle) | `libs/shared/src/lib/types/messages/session-mcp-status.ts:103-159`; exported via `messages/index.ts:7` | Pattern for `parseSessionStatsLivePayload`. |
| Frontend router: `handledMessageTypes` + `switch` | `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts:138-236`, `handleSessionStats` `:695-705` | Add one type, one case, one handler. |
| `SESSION_STATS` is NOT the turn boundary: `turn_state` finalizes the turn through `TurnStateApplier`; `handleSessionStats` only stashes `pendingStats` on a streaming tab or merges the footer onto the last assistant message and returns queued content | `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:578-595`, `:660-679`; `libs/frontend/chat-streaming/src/lib/turn-state-applier.service.ts:65` | The live channel must never write `pendingStats` or a footer. (The comment at `chat-message-handler.service.ts:366-373` still calls SESSION_STATS the end-of-turn signal; it is stale and out of scope.) |
| The `SESSION_STATS` result path has side effects beyond the snapshot: compaction clear, `deriveLiveModelStats`, `streamingHandler.handleSessionStats`, `sessionLoader.loadSessions()`, `messageDispatch.sendQueuedMessage` | `session-stats-aggregator.service.ts:153-202` | The live path (estimates AND the settle payload) calls none of these. |
| Result-branch exits that send no snapshot: `duplicate` (`:918-921`), no aggregate and no per-model usage (`:922`), `validateStats` returning null (`:939-944`), `stale-owner` (`snapshot: null`, owner `:490-498`) | `stream-transformer.ts:913-950`; `session-stats-owner.service.ts:490-525` | A shown estimate cannot rely on `session:stats` to clear it; a settle step on the live channel is required. |
| `rebind` moves the `OwnerState` object to the canonical key and touches it | `session-stats-owner.service.ts:446-453` | State attached to `OwnerState` (agent watchers) follows the rebind without extra code. |
| Hook callbacks are wrapped with error handling so the SDK is never blocked | `subagent-hook-handler.ts:105-110` (doc), catch sites `:301`, `:567` | A watcher throw inside `recordAgent` cannot break the SDK; the publisher still guards its own watcher. |
| `installSessionStats` returns `void`; admission is the private `acceptSessionStats` | `tab-manager.service.ts:2252-2262`, `:2348-2372` | A context reading applied after `installSessionStats` would bypass the floor; admission and context must be one tab-manager operation. |
| The surface registry has its own per-session floor and keeps `live` when given `null` | `surface-session-stats.registry.ts:40-45`, `:72-103` | Surface live installs pass `live: null`, so only the floored snapshot changes. |
| The `SESSION_STATS` callback is wrapped for activity and the budget | `sdk-agent-adapter.ts:1785-1801` | A settle sent as `SESSION_STATS` would notify activity and feed the budget; it must use the live callback instead. |
| Snapshot-only install path exists and stops after `installSessionStats` | `session-stats-aggregator.service.ts:142-152`; `snapshotFor` `:251-269`; `recordSurfaceStats` `:216-243` | Live install reuses `snapshotFor`, `installSessionStats` and `surfaceStats.record`. |
| `installSessionStats` → `acceptSessionStats` → per-session `SessionStatsRevisionFloor.admit` (`revision < floor` rejected, equal admitted) | `libs/frontend/chat-state/src/lib/tab-manager.service.ts:2252-2262`, `:2348-2372`; `libs/frontend/chat-state/src/lib/session-stats-snapshot.ts:56-89` | Revision ordering is the existing late-event filter; live and authoritative snapshots share it. |
| `budgetPatch(snapshot, undefined)` keeps the last budget | `tab-manager.service.ts:147-155` | Live installs pass no budget. |
| `isValidSessionStatsSnapshot` checks named fields only | `session-stats-snapshot.ts:19-54` | Add `provisional` as an optional boolean check. |
| `postCompactionContextStats` rebuilds `liveModelStats` from new tokens using the PRIOR capacity | `tab-manager.service.ts:2159-2196` | Precedent for applying a live context reading without a capacity. |
| `SurfaceSessionStatsRegistry.record({ live: null, snapshot })` keeps the existing `live` | `libs/frontend/chat-state/src/lib/surface-session-stats.registry.ts:72-90` | Workflow surfaces take the live snapshot with no new API. |
| Header chip reads `snapshot().totalCost`, `knownCost`, `agentSessionCount`, `tokenCount`, `coverage` | `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts:229-305` | Header updates as soon as `tab.sessionStats` changes; only the estimate marker is new. |
| Injectable clock seam with `unref` | `libs/backend/agent-sdk/src/lib/helpers/turn-state-foreground-source.ts:47-64` | Precedent for the throttle timer and its test seam. |
| Stream-transformer feature specs live in sibling files | `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.plan-limits.spec.ts` | New integration spec `stream-transformer.live-stats.spec.ts`; do not grow the 3 000-line main spec. |

## Architecture decision

- Chosen approach: a per-stream `LiveSessionStatsPublisher` (agent-sdk helper,
  constructed inside `StreamTransformer.transform()`, not DI) accumulates usage
  from every `assistant` frame, deduplicated per `message.id`, prices it
  synchronously, and at most once per second pushes the estimate into the
  session's `SessionStatsOwnerService` run as provisional state and emits the
  owner's live snapshot through a new `onLiveStats` stream callback. The adapter
  forwards it through a new `IAgentAdapter.setLiveStatsCallback`; the shared
  wiring broadcasts it as `MESSAGE_TYPES.SESSION_STATS_LIVE`
  (`'session:stats-live'`). The frontend parses it, installs the snapshot on the
  header only, and leaves completion logic untouched. Two more triggers use the
  same channel: an owner agent watcher (a subagent identity was recorded) and a
  settle at every result boundary, at stream end and at owner release (Stop,
  `/clear`, session end), which sends the authoritative snapshot (no
  `provisional` field, no `context`) at a strictly higher revision whenever
  an estimate was shown. A live payload therefore carries either a
  provisional snapshot or an authoritative one; the frontend handles both
  identically (header only, revision-floored).
- Rationale: the owner already owns session arithmetic and identity
  (`session-stats-owner.service.ts:1-34`); keeping the estimate on its run state
  lets one `aggregateSessionUsage` call produce the live figure and lets the
  `result` boundary clear it in the same object (D3). The transformer already
  sees every frame and already owns per-stream state and the turn boundary.
- Rejected alternatives:
  1. Interim `SESSION_STATS` broadcasts: rejected by D2. `SESSION_STATS` is not
     the turn boundary (`turn_state` via `TurnStateApplier` finalizes;
     `streaming-handler.service.ts:578-595`), but its result path writes
     `pendingStats` or the last message's footer (`:660-679`), reloads the
     session list and may send a queued message
     (`session-stats-aggregator.service.ts:193-202`). An interim broadcast would
     put an estimate in the footer and could dispatch a queued message mid-turn.
  1b. Settle through a snapshot-only `SESSION_STATS` (the aggregator already
     installs a payload without `turnCost`/`tokens`/`duration` and stops,
     `session-stats-aggregator.service.ts:77-85`, `:143-152`): rejected because
     it would reach the host through `onResultStats`, which the adapter wraps to
     notify activity and feed the session budget
     (`sdk-agent-adapter.ts:1785-1801`), and through `retryWithBackoff`
     (`sdk-callbacks.ts:400-443`). The settle is header state, not a result;
     the live channel already carries exactly that.
  2. Accumulate from `stream_event` `message_start`/`message_delta`: those are
     main-loop only on the wire (`stream-transformer.ts:517-523`), so subagent
     spend, the whole point of the bug, would stay invisible.
  3. Compute the estimate in the publisher and add it to `owner.snapshot()`
     outside the owner: duplicates aggregation and loses the revision ordering
     the frontend floor depends on.
  4. Agent count from `task_started` alone (revision 1): rejected after review.
     The SubagentStart hook runs `recordAgent` independently of the stream
     (`subagent-hook-handler.ts:89-102`); when `task_started` is read first,
     its flush sees the old count and nothing publishes again until another
     frame arrives. Chosen instead: a per-owner agent watcher set on
     `OwnerState`, notified by `recordAgent` after it changed the count. The
     watcher is the only cross-path signal; the owner still logs nothing and
     still returns outcomes (`session-stats-owner.service.ts:30-34`). It follows
     `rebind` because state is moved, not cloned (`:446-453`).
     - Rejected sub-option: a bounded follow-up flush after `task_started`
       (for example one retry after 1 s). It is a timing guess: a hook later
       than the bound still leaves the old count, and it adds a timer per
       subagent start.
     - Rejected sub-option: a DI-registered publisher registry keyed by session
       that the hook handler calls. It needs a new singleton, its own rebind
       handling (the hook may record under the provisional tab key,
       `subagent-hook-handler.ts:80-101`) and its own release path, all of
       which `OwnerState` already has.
  5. Frontend "ignore live events once the turn completed" by tab status (the
     brief's wording): status gating would also hide genuine background-subagent
     spend that arrives after a result. Resolution: the backend guarantees every
     authoritative snapshot built after a live estimate carries a revision
     strictly greater than that estimate (Component 2), and the settle step
     DELIVERS such a snapshot at every boundary that follows a shown estimate
     (Components 3-4), whether or not `session:stats` is sent. The existing
     per-session `SessionStatsRevisionFloor` (`session-stats-snapshot.ts:77-89`)
     then rejects every live event that was in flight when the turn completed,
     and the frontend applies a live context reading only when its snapshot was
     admitted (Component 7).
  6. Stop with an owner released before the stream's `finally` (revision 3):
     chosen = settle inside `SessionStatsOwnerService.release` through the
     existing per-owner watcher set (Component 2). The owner is the only unit
     that holds both the revision counter and the lease rule, so the settle
     snapshot is built at a strictly higher revision by the same code that
     decides which generation dies; no other path is generation-safe without
     restating that rule. Rejected:
     - Settle from `interruptSession` before `releaseStatsOwners` through an
       adapter-held map of per-session publishers: a new registry with its
       own rebind and release bookkeeping, and it would cover only the
       callers that remember to call it (`endSession`, token-matched end and
       workspace teardown release the same way, `sdk-agent-adapter.ts:761-771`,
       `:923-939`, `:1257-1264`).
     - Carry the last authoritative snapshot inside the publisher and emit it
       at `dispose()` after release: the cached snapshot's revision is below
       the shown estimate's, so the floor would reject it; inventing a higher
       revision outside the owner breaks the single revision source.
     - Defer `release` until the stream's `finally`: changes Stop/`/clear`
       teardown ordering the adapter documents (`sdk-agent-adapter.ts:1585-1592`)
       and the existing release specs (`sdk-agent-adapter.spec.ts:1974-2006`).
- Assumptions (each with the check that resolves it):
  - A1: `assistant` frames carry `message.usage`, and the final frame of an API
    message carries the final counts, as transcript lines do
    (`session-usage-ledger.ts:122-128`). Check: in the integration spec, feed two
    frames with the same id and growing `output_tokens`; in a manual run, compare
    the last live total with the following `session:stats` total (they should be
    within the main loop's final `message_delta` output tokens).
  - A2: on proxied routes (`message_start` with synthetic zeros,
    `stream-transformer.ts:539-547`) assistant frames may also carry zero
    input/cache until late; the estimate then under-counts until the result.
    Accepted: it is labelled an estimate and the result replaces it. No check
    blocks implementation.
  - A3: estimate rows are labelled by the frame's raw `message.model`, while
    accepted run rows use the SDK `modelUsage` key (`stream-transformer.ts:758-766`);
    when those spellings differ (`[1m]` suffix) the per-model breakdown may show
    two rows for one model while the turn runs. Totals are unaffected; cosmetic
    and replaced at the result. Check: none required.
  - A4 (revision 1, "a duplicate leaves the estimate until the next
    `session:stats`"): withdrawn; the settle step clears it.
  - A5 (narrowed in revision 3): every lease-based `release`
    (`session-stats-owner.service.ts:588-597`; callers Stop/`/clear`
    `sdk-agent-adapter.ts:1593-1599`, `endSession` `:923-939`,
    `endSessionIfTokenMatches` `:1257-1264`, workspace teardown `:761-771`)
    now settles through the owner's watchers before the state is dropped, so a
    released owner no longer strands an estimate. The residual is limited to
    owner removal WITHOUT `release`, where no display is bound to the dropped
    owner's live output:
    - `startNew(key)` replacing a state under the same key (`:386-390`). A
      publisher only publishes after `setSessionKey` on `init`, which runs
      after `onSessionIdResolved` rebinds the owner from the tab key to the
      canonical id (`rebind` `:446-453`, call site `sdk-agent-adapter.ts:1314`),
      so an owner still held under a tab key has never had a live publication.
      Verified: the rebind runs synchronously before the wrapper's first
      `await` (`sdk-agent-adapter.ts:1310-1315`), and the transformer calls
      `onSessionIdResolved` before the point where `setSessionKey` is added
      (`stream-transformer.ts:573-578`). When `bindRefused` returns early
      (`:1307-1309`) the owner is never rebound, `setSessionKey(realId)` finds
      no current state, and the publisher stays silent for that stream.
    - `clearAll()` (backend disposal, `:599-602`): the webview host is going
      away with it; no notification.
    Check: owner spec "startNew over an existing key calls no watcher" and
    publisher spec "release notification after dispose emits nothing".
- Effect on existing code: `session:stats`, `replaceRun`, `markRunIncomplete`,
  `snapshot()`, `publish()`, the budget, resume, and every frontend completion
  path are unchanged in behaviour. `recordAgent` gains one notification after
  its existing mutation (no change to its return value or state effect).
  `installSessionStats` is unchanged; the tab manager gains one new public
  method. New code is otherwise additive.

## Component specifications

### 1. Shared contract: message type, payload, parser, snapshot flag

- Purpose: define the `session:stats-live` wire contract once for backend and
  webview.
- Responsibilities:
  - Add `SESSION_STATS_LIVE: 'session:stats-live'` to `MESSAGE_TYPES`, directly
    after `SESSION_STATS` (`libs/shared/src/lib/types/messages/message-constants.ts:133`),
    with a doc comment: provisional, throttled, never a completion signal.
  - Add to `SessionStatsEntry` (`rpc-session.types.ts:343-433`) one optional
    field `readonly provisional?: boolean` documented as "`true` only on a
    `session:stats-live` snapshot that includes an in-turn estimate; a later
    snapshot with a higher revision replaces it. Absent on every authoritative
    snapshot, including authoritative snapshots sent on `session:stats-live`."
  - Add to `agent-adapter.types.ts` (beside `ResultStatsPayload`, `:46-90`):
    ```ts
    export interface SessionStatsLivePayload {
      readonly sessionId: SessionId;
      /**
       * Owner snapshot: `provisional: true` while it includes an estimate;
       * no `provisional` field for an authoritative snapshot (agent-count
       * update with no estimate, or the settle at a boundary).
       */
      readonly sessionStats: SessionStatsEntry;
      /**
       * Main-loop latest request size, when the stream tracked one. Present
       * ONLY when `sessionStats.provisional === true`; an authoritative
       * snapshot (settle, release-settle, agent-count update) never carries
       * it, so it cannot replace the context the result path derived from
       * `modelUsage` (revision 3, finding 1).
       */
      readonly context?: { readonly model: string; readonly contextTokens: number };
    }
    export type LiveStatsCallback = (payload: SessionStatsLivePayload) => void;
    ```
    and `setLiveStatsCallback(cb: LiveStatsCallback): void` on `IAgentAdapter`
    next to `setResultStatsCallback` (`:333-337`).
  - New `libs/shared/src/lib/types/messages/session-stats-live.ts` exporting
    `parseSessionStatsLivePayload(payload: unknown): SessionStatsLiveWire | null`
    where the wire type has `sessionId: string` (webview routing parses it, as
    `SessionStatsResultEvent` does, `session-stats-aggregator.service.ts:38-50`).
    Hand-written, no Zod (`session-mcp-status.ts:103-114` rationale). Checks:
    non-empty string `sessionId`; `sessionStats` is a plain object whose
    `provisional` is `true` or absent (any other value rejects the payload) and
    whose `revision` is a finite number (a live payload without a revision
    could bypass the floor on a tab that shows nothing yet,
    `tab-manager.service.ts:2358-2366`); optional `context` with non-empty string `model` and
    finite non-negative `contextTokens` (an invalid `context` drops only the
    `context`, not the payload); a `context` on a payload whose
    `sessionStats.provisional` is not `true` is dropped (payload kept, no
    `context` key in the result). Deep snapshot validation stays in
    `isValidSessionStatsSnapshot` (chat-state), which `shared` cannot import.
  - Export the parser through `messages/index.ts` (`export * from
    './session-stats-live'`, same as `:7`).
- Verified contracts and entry points: `MESSAGE_TYPES` `message-constants.ts:133`;
  `SessionStatsEntry` `rpc-session.types.ts:343`; `ResultStatsPayload`
  `agent-adapter.types.ts:46`; `IAgentAdapter` `agent-adapter.types.ts:237`,
  setters `:333-337`; parser precedent `session-mcp-status.ts:115`.
- Dependencies: none (L0).
- Integration points: agent-sdk (producer), cli-agent-runtime (broadcast),
  chat / chat-state (consumer).
- Failure behaviour: the parser returns `null` for any malformed payload; the
  caller drops it with one `console.warn` naming only the session.
- Quality requirements: host-source contract spec stays green without touching
  `host-source-registry.baseline.ts`.
- Verification seam: new `session-stats-live.spec.ts` (parser accept/reject
  table: `provisional: true` accepted, `provisional` absent accepted,
  `provisional: false` / `'yes'` rejected, missing or non-finite `revision`
  rejected, bad `context` dropped alone, a valid `context` on a snapshot
  without `provisional` dropped while the payload is accepted); existing
  `host-source-registry.contract.spec.ts` must pass unchanged.
- Files:
  - MODIFY `libs/shared/src/lib/types/messages/message-constants.ts`
  - MODIFY `libs/shared/src/lib/types/rpc/rpc-session.types.ts`
  - MODIFY `libs/shared/src/lib/types/agent-adapter.types.ts`
  - MODIFY `libs/shared/src/lib/types/messages/index.ts`
  - CREATE `libs/shared/src/lib/types/messages/session-stats-live.ts`
  - CREATE `libs/shared/src/lib/types/messages/session-stats-live.spec.ts`
  - Do NOT modify `libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts`.

### 2. SessionStatsOwnerService: provisional run state and live snapshot

- Purpose: hold the in-turn estimate on the run it belongs to and produce a
  live snapshot that the authoritative snapshot always supersedes.
- Responsibilities:
  - `RunState` (`session-stats-owner.service.ts:336-349`) gains
    `provisional: readonly RunModelUsage[] | null` (null = no live publication
    since the last result). `createRun` (`:704-713`) initialises it to `null`.
  - New `publishLive(sessionKey, generation, runToken, estimate:
    readonly RunModelUsage[] | null): SessionStatsEntry | null`:
    - `currentState(sessionKey, generation)`; `null` when stale/absent, and
      `null` while `state.pending !== null` (prefix read in flight; same rule as
      `snapshot()` `:567-572`).
    - Validate rows with the existing `isFiniteNonNegative` rules used by
      `isValidResult` (`:873-888`), dropping an invalid row rather than the
      estimate.
    - Non-empty valid rows: set `runFor(state, runToken).provisional = rows`;
      `touch(state)`; build the provisional snapshot: the same contributions
      `publish()` builds (`:656-674`), plus, for every run whose `provisional`
      is non-empty, one `runContribution(sessionId, { models: provisional,
      totalCost: allPriced ? Σ costUSD : null, costSource: 'unreported' })`.
      Then `aggregateSessionUsage` with `state.agentIds`, the same `incomplete`
      handling and `durationMs` as `publish()`, `revision: state.revision`, and
      `provisional: true`. Frozen. NOT stored in `state.published`.
    - `null` or empty rows (agent-count update, settle): leave
      `provisional` as it is for other runs, and when no run of this owner has
      a non-empty `provisional`, return `this.publish(sessionId, state)` — the
      authoritative, cached snapshot with no `provisional` field and no extra
      touch (`recordAgent` / `clearProvisional` already touched). When another
      run of the same owner still holds an estimate (concurrent runs), return
      the provisional build above without a new touch.
    - Extract the shared contribution-building from `publish()` into one private
      helper used by both, so arithmetic is not duplicated.
  - New `clearProvisional(sessionKey, generation, runToken): void`: when the run
    exists and `provisional !== null`, set it to `null` and `touch(state)`.
    Never creates a run or an owner.
  - New owner watcher set (review round 1 finding 3, extended in revision 3
    for round 2 finding 2): an exported interface
    `OwnerWatcher { onAgentRecorded(): void; onReleased(settled:
    SessionStatsEntry | null): void }`; `OwnerState` gains
    `readonly watchers: Set<OwnerWatcher>` (initialised empty where the state
    is created, `:630-644`). New `watch(sessionKey, generation, watcher:
    OwnerWatcher): (() => void) | null` adds the watcher to the current state
    and returns a detach function that deletes it from THAT state object (so
    it still works after `rebind` moved the state); `null` when stale/absent.
    - `recordAgent` (`:553-560`), after its existing `add` + `touch` and only
      when it returns `true`, calls `onAgentRecorded()` on each watcher of a
      copy of the set.
    - `release(lease)` (`:588-597`), only on the branch that matches
      generation AND epoch (the branch that returns `true` today): when
      `state.pending === null`, set every run's `provisional` to `null`,
      `touch(state)` if any was non-null, and build `settled =
      this.publish(key, state)` (`key` = the map key the state is held under
      now, the canonical id after `rebind`); `settled = null` while a prefix
      read is pending (no live snapshot can exist then, `publishLive` returns
      `null` while pending). Then `this.states.delete(key)` as today, then call
      `onReleased(settled)` on each watcher of a copy of the set, then return
      `true`. The epoch-mismatch branch (`return false`) and a non-matching
      generation notify nobody. Watchers are notified after the delete, so a
      watcher that re-enters the owner sees it gone.
    - Every watcher call is wrapped in `try { } catch { }` that swallows the
      error and continues with the next watcher: `release` sits on the Stop
      path (`sdk-agent-adapter.ts:1596-1598`) and `recordAgent` on the hook
      path, and a watcher must not break either. The owner still logs nothing
      (class contract `:30-34`); the publisher logs its own failure (Component
      3), so nothing is silent.
    - `startNew` replacing an owner and `clearAll` drop the old set WITHOUT
      notification (A5).
  - `publish()` and `snapshot()` ignore `provisional` entirely (resume and the
    budget never see an estimate).
  - `replaceRun`, `markRunIncomplete` unchanged; `recordAgent` changes only by
    the watcher notification; `release` keeps its signature, its boolean
    result and its lease rule, and gains only the settle-and-notify step on
    its success branch.
- Ordering invariant (the frontend late-event filter depends on it): the live
  snapshot's revision is `state.revision` after its own `touch`; the transformer
  calls `clearProvisional` at the result boundary before `replaceRun` /
  `markRunIncomplete`, so any authoritative snapshot built after a live
  publication carries a strictly greater revision, even when `replaceRun`'s
  outcome does not touch (duplicate / rejected / ignored). The settle
  (`publishLive(..., null)` after the result branch) returns exactly that
  snapshot, so its delivery does not depend on `session:stats` being sent.
- Verified contracts and entry points: `currentState` `:603-606`; `runFor`
  `:720-727`; `touch` `:647-650`; `publish` `:652-701`; `rebind` `:446-453`;
  `recordAgent` `:553-560`; `release` `:588-597`; `runContribution`
  `:817-863`; `aggregateSessionUsage` (`session-usage-aggregator.ts:181-188`,
  `SessionContributionsAggregateInput` `:80-85`); `RunModelUsage` /
  `RunUsageResult` exported from this file.
- Dependencies: unchanged (shared, aggregator). No logging, per the class
  contract (`:30-34`).
- Integration points: `LiveSessionStatsPublisher` (Component 3) is the only
  caller of the three new methods; `SubagentHookHandler` keeps calling
  `recordAgent` unchanged.
- Failure behaviour: stale generation, unknown session or pending prefix → `null`
  / no-op; no throw. Detach after release is a harmless delete on an
  unreachable set. A throwing watcher is swallowed per call (see above).
- Quality requirements: `publishLive` is O(runs + models); called at most once
  per second per stream.
- Verification seam: `session-stats-owner.service.spec.ts` (existing file) new
  `describe('live estimate')`:
  - live snapshot = authoritative + estimate; `provisional: true`;
  - `snapshot()` excludes the estimate before and after `publishLive`;
  - multi-turn: accept result 1, estimate E2, accept result 2 (cumulative) →
    authoritative equals result 2 alone (no double count of E2);
  - revision: live revision > previous authoritative; after `clearProvisional`
    + a `replaceRun` with outcome `duplicate`, `rejected-non-monotonic` and
    `accepted`, the returned snapshot revision is strictly greater than the live
    one;
  - unpriced estimate row → `totalCost: null`, `knownCost` = priced part,
    `pricingCoverage: 'partial'`;
  - `agentSessionCount` reflects `recordAgent` made before the flush;
  - stale generation and pending prefix return `null`;
  - settle per outcome: after `publishLive(rows)` at revision L, then
    `clearProvisional`, each of `replaceRun` → `accepted`, `duplicate`,
    `rejected-non-monotonic`, `rejected-invalid`, and `markRunIncomplete`, and
    the no-call path (empty usage), `publishLive(..., null)` returns a snapshot
    with no `provisional` field and revision > L, equal to `snapshot()`;
  - `publishLive(..., null)` with no estimate anywhere returns the cached
    `publish()` object (same reference) without changing the revision;
  - two runs on one owner: clearing run A while run B holds an estimate keeps
    `provisional: true`;
  - watchers: `recordAgent` with a new id calls `onAgentRecorded` once; a
    repeated or alias id does not; a detached watcher is not called; a watcher
    attached under the tab key is still called after `rebind` to the canonical
    id, and its detach still removes it; `watch` on a stale generation returns
    `null`;
  - release settle (revision 3): after `publishLive(rows)` at revision L,
    `release(lease)` returns `true`, calls `onReleased` exactly once with a
    snapshot that has no `provisional` field, revision > L and the same
    figures as `snapshot()` would have returned with the estimate cleared;
    `snapshot()` afterwards is `null` (released as today); after `release`
    neither signal is ever called again;
  - release after `clearProvisional` (Stop during the result branch's pricing
    await): `onReleased` still receives the authoritative snapshot, revision >
    L;
  - release with no estimate: `onReleased` receives the cached `publish()`
    snapshot, revision unchanged;
  - release while the prefix read is pending: `onReleased(null)`;
  - generation safety: a lease whose epoch is stale (a newer `prepareRun` on
    the same owner) returns `false`, calls no watcher and leaves the estimate
    in place; a lease of a replaced generation calls no watcher of the
    replacement; `startNew` over an existing key and `clearAll` call no
    watcher;
  - a throwing watcher does not stop `release` (returns `true`, state
    removed) nor the next watcher, and does not throw from `recordAgent`.
- Files: MODIFY `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts`;
  MODIFY `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.spec.ts`.

### 3. LiveSessionStatsPublisher (new per-stream helper)

- Purpose: turn the stream's assistant frames into a deduplicated, priced,
  throttled estimate and publish the owner's live snapshot.
- Responsibilities:
  - Constructed once per `transform()` call (same per-stream seam as
    `messageTransformer.createIsolated()`, `stream-transformer.ts:446-464`), with:
    `statsOwner`, `modelResolver`, `accountingAuthEnv`, `statsGeneration`,
    `runToken`, `onLiveStats` (optional), `logger`, `readMainContext: () =>
    { model: string; contextTokens: number } | null`, and an optional
    `clock` (`{ now, setTimeout, clearTimeout }`, default real clock with
    `unref`, precedent `turn-state-foreground-source.ts:47-64`).
  - Inert when `onLiveStats` is absent or `statsGeneration === null`
    (no timers, no state).
  - `setSessionKey(id)`: called on `init`; nothing publishes before it. It also
    attaches the owner watcher: `statsOwner.watch(id, statsGeneration,
    { onAgentRecorded: () => this.onAgentRecorded(), onReleased: (s) =>
    this.onOwnerReleased(s) })`, keeping the detach function. A second
    `init` on the same stream (resume rebinding) detaches the old watcher first.
    An identity the hook recorded before `init` (under the tab key,
    `subagent-hook-handler.ts:80-101`) is already in the moved state and is
    read by the first flush.
  - `onAgentRecorded()`: never flushes synchronously (it runs inside
    `recordAgent`'s call stack). It arms the throttle timer: delay 0 when no
    publish happened in the last interval, else the existing trailing slot.
    Ignored while `settling` (below). Body wrapped in try/catch, warn once.
  - `observe(message)`:
    - `assistant` frame (main loop or `parent_tool_use_id` set): parse
      `{ message.id, message.model, message.usage }` with a module-level Zod
      schema (external CLI output; counters `z.number().finite().nonnegative()`,
      each degrading to absent independently, as `session-usage-ledger.ts:55-66`
      does). Skip frames without an id, with a `<...>` model (same filter as
      `stream-transformer.ts:683-686`), or with no counter. Per `message.id` keep
      `{ model, input, output, cacheRead, cacheCreation }`, each counter updated
      to `max(previous, frame)` (equal to the ledger's replace rule for in-order
      frames, and robust to a late frame carrying a partial count). Schedule a
      flush when any counter grew.
    - `task_started` system message, or any frame with `parent_tool_use_id`:
      schedule a flush (agent count is read from the owner at flush time).
      When the hook records the agent AFTER this flush, the watcher schedules
      the next one; when it recorded BEFORE, this flush already carries it.
  - Throttle: `LIVE_STATS_INTERVAL_MS = 1000` (exported const). At most one
    publish per interval per stream: when no publish happened in the last
    interval, flush immediately; otherwise one trailing timer fires at
    `lastPublish + interval` and coalesces every change since. Exactly one timer
    per stream at a time.
  - `flush()`: aggregate the per-id map into one `RunModelUsage` row per raw
    model; price each with `modelResolver.resolveForCost(model,
    accountingAuthEnv)` and `calculateMessageCost(priced.modelId, { input,
    output, cacheHit: cacheRead, cacheCreation }, priced.pricing)`, `null` when
    `priced.pricing` is null (no async `getPricing` round-trip on this path);
    call `statsOwner.publishLive(..., rows.length > 0 ? rows : null)`; on a
    non-null snapshot call `onLiveStats({ sessionId, sessionStats, context })`.
    `context` is attached ONLY when `sessionStats.provisional === true`
    (revision 3, finding 1): it comes from `readMainContext()` with its model
    mapped through `resolveForCost(...).modelId` (the label result rows use,
    `stream-transformer.ts:731`, `:773-775`), omitted when null. An
    authoritative snapshot from a flush (agent-count update with no estimate)
    carries no `context` key. When the emitted snapshot has
    `provisional: true`, set `estimateShown = true`.
  - One private `emitAuthoritative(snapshot)` used by `settle()`,
    `onOwnerReleased()` and `dispose()`: when `estimateShown` is `true` and
    `snapshot` is non-null, call `onLiveStats({ sessionId, sessionStats:
    snapshot })` (never a `context` key); then `estimateShown = false` in
    every case, so exactly one authoritative payload follows a shown estimate
    whichever path delivers it first.
  - `onResult()`: cancel the timer, clear the per-id map, call
    `statsOwner.clearProvisional(...)`, enter `settling` (flush requests and
    watcher signals are ignored until `settle()`). Called at the top of the
    result branch, before any `await`.
  - `settle()` (review round 1 finding 1): leave `settling`; when
    `estimateShown` is `true`, call `statsOwner.publishLive(..., null)` and
    pass the result to `emitAuthoritative` (no `context`, revision 3). When no
    estimate was shown since the last boundary, emit nothing (no extra
    message per turn for sessions with no live activity). Called by the
    transformer at the end of EVERY result branch, whichever exit it took.
  - `onOwnerReleased(settled)` (revision 3, round 2 finding 2; runs inside
    `release`, i.e. on Stop / `/clear` / session end before the stream's
    `finally` may have run): cancel the timer, drop the detach function (the
    state that held the watcher is already gone), clear the per-id map, mark
    the publisher `released` (every later flush request, watcher signal,
    `settle()` and `dispose()` emission becomes a no-op; `dispose()` still
    cancels/clears), then `emitAuthoritative(settled)` synchronously. It is
    honoured even while `settling` (Stop during the result branch's pricing
    await, after `onResult()` already called `clearProvisional`). Body in
    try/catch, warn once; never throws into `release`.
  - `dispose()`: cancel the timer, detach the watcher, clear the map; unless
    `released`, call `clearProvisional` and then `publishLive(..., null)` →
    `emitAuthoritative` exactly as `settle()` does; idempotent
    (CONVENTIONS.md section 9). Called from the transformer's `finally`, before
    `onStreamEnd` (`stream-transformer.ts:1033-1043`), so a stream that ends
    or errors after an estimate without a result still clears it. Ordering
    with a release: dispose first → it settles and detaches, so the later
    `release` finds no watcher of this stream; release first →
    `onOwnerReleased` settles and `dispose()` emits nothing. Exactly one
    authoritative payload either way.
- Verified contracts and entry points: `IModelResolver.resolveForCost`
  `auth-env.port.ts:57`; `calculateMessageCost` `pricing.utils.ts:404`;
  `isAssistantMessage` / `isTaskStarted` `claude-sdk.types.ts:384`, `:416`;
  `SessionStatsLivePayload` / `LiveStatsCallback` (Component 1).
- Dependencies: agent-sdk internal (owner type import), shared, zod (already an
  agent-sdk dependency: `session-stats-owner.service.ts:37`), `Logger` type from
  vscode-core (already imported by `stream-transformer.ts:28`; no NEW
  vscode-core import surface).
- Integration points: `StreamTransformer` only.
- Failure behaviour: a throwing `onLiveStats` (sync or rejected promise) is
  caught and logged once at `warn` with the error name only (same rule as
  `runGuardedCallback`, `stream-transformer.ts:340-374`), and later publishes
  continue. A throwing `resolveForCost` for one model yields `costUSD: null` for
  that model. Nothing thrown reaches the stream.
- Quality requirements: no timer and no owner watcher survives `dispose()`;
  per-id map cleared at every result; one watcher per stream (not per
  subagent); no `info`-level log per publish.
- Verification seam: new unit spec with an injected fake clock:
  - same id across partial and final frames counts once with the final counts;
  - main and subagent frames both counted; different ids summed per model;
  - zero-usage, id-less and `<synthetic>` frames ignored;
  - unknown pricing → row `costUSD: null`;
  - first change publishes immediately; changes within the window coalesce into
    one trailing publish; no publish before `setSessionKey`;
  - `onResult()` cancels the pending timer (no publish afterwards until a new
    usage frame) and calls `clearProvisional`;
  - between `onResult()` and `settle()`, a frame-driven flush request and a
    watcher signal emit nothing;
  - `settle()` after a shown estimate emits exactly one payload whose snapshot
    has no `provisional` field and a revision greater than the last estimate;
    a second `settle()` emits nothing; `settle()` with no estimate shown emits
    nothing;
  - context (revision 3, finding 1), with `readMainContext` returning a
    non-null reading throughout: provisional payloads carry `context`; the
    `settle()` payload, the `onOwnerReleased` payload, the `dispose()` payload
    and an authoritative agent-count payload have no `context` key;
  - release (revision 3, finding 2), real `SessionStatsOwnerService`: after a
    shown estimate at revision L, `owner.release(lease)` makes the publisher
    emit exactly one payload synchronously (no `provisional`, revision > L, no
    `context`); a later `settle()`, `dispose()`, frame flush, timer advance or
    `recordAgent` emits nothing; release during `settling` (after
    `onResult()`, before `settle()`) still emits once; release with no
    estimate shown emits nothing; `dispose()` first then `release` → one
    payload from `dispose()` and none from the release;
  - an `onLiveStats` throwing inside `onOwnerReleased` is caught (warn once)
    and `release` still returns `true`;
  - agent ordering, no usage frames, fake clock: (a) `recordAgent` then
    `task_started` → one payload with the new count within the interval;
    (b) `task_started` (immediate flush, old count) then `recordAgent` → a
    second payload with the new count within one interval, and no third;
  - a watcher signal never calls `onLiveStats` synchronously inside
    `recordAgent`;
  - `dispose()` after a shown estimate emits the settle payload and detaches
    the watcher (a later `recordAgent` triggers nothing);
  - `dispose()` twice is safe and leaves no timer;
  - `onLiveStats` throwing does not stop the next publish;
  - inert when `onLiveStats` is absent.
- Files: CREATE `libs/backend/agent-sdk/src/lib/helpers/live-session-stats-publisher.ts`;
  CREATE `libs/backend/agent-sdk/src/lib/helpers/live-session-stats-publisher.spec.ts`.

### 4. StreamTransformer wiring

- Purpose: feed the publisher and bound it by the turn and the stream lifetime.
- Responsibilities:
  - `StreamTransformConfig` (`stream-transformer.ts:190-261`) gains optional
    `onLiveStats?: LiveStatsCallback` with a doc comment (provisional, throttled,
    never a completion signal; the budget never sees it).
  - In `transform()`: construct the publisher after `messageTransformer`
    (`:464`), passing `readMainContext` as a closure over
    `lastTurnContextByModel` / `currentStreamModel` (returns
    `input + cacheRead + cacheCreation` of `currentStreamModel`, or null).
  - In the loop: on `isSystemInit` after `onSessionIdResolved` (`:573-578`) call
    `setSessionKey(realSessionId)`; call `observe(sdkMessage)` once per message
    (after the context tracking block so the context reading is current);
    in the result branch call `onResult()` immediately after `onTurnEnd?.()`
    (`:658`) and before any `await`; call `settle()` once at the end of the
    result branch, after the `onResultStats` block (`:913-950`) and before the
    `isCompactBoundary` check (`:952`). The rest of the branch (from after
    `onResult()` to the end of the `onResultStats` block) is wrapped in
    `try { ... } finally { publisher.settle(); }` so every exit settles:
    `statsGeneration === null`, `replaceRun` with any outcome,
    `markRunIncomplete`, the empty-usage path, `duplicate`, a `validateStats`
    rejection, a missing `onResultStats`, and a throw (the throw still
    propagates as today; `settle()` itself never throws).
  - Ordering on an accepted result: `onResultStats` (→ `session:stats`, with
    retry) is called before `settle()` (→ `session:stats-live`); both carry
    the same snapshot object and revision, and the floor admits equal
    revisions idempotently (`session-stats-snapshot.ts:81-87`). The settle
    payload carries no `context` (revision 3), so it cannot change the context
    gauge the result path writes from `modelUsage`
    (`session-stats-aggregator.service.ts:171-190`); arrival order at the
    webview therefore changes neither the snapshot nor the context.
  - In `finally` (`:1030-1045`) call `dispose()` next to
    `activityWatchdog?.stop()`, before `onStreamEnd`.
- Verified contracts and entry points: as cited; `isResultMessage` branch
  `:655`.
- Dependencies: Component 3.
- Integration points: `SdkAgentAdapter` (Component 5) supplies `onLiveStats`.
- Failure behaviour: inherited from the publisher; the result path is unchanged.
- Quality requirements: existing `stream-transformer.spec.ts` and
  `stream-transformer.plan-limits.spec.ts` pass untouched (the field is
  optional).
- Verification seam: new `stream-transformer.live-stats.spec.ts` (sibling-spec
  precedent `stream-transformer.plan-limits.spec.ts`), driving a scripted
  `sdkQuery` with jest fake timers:
  - init → assistant frames (main + subagent) → `onLiveStats` called with a
    `provisional: true` snapshot whose `tokenCount` includes both;
  - agent count, no usage frames: `task_started` then `recordAgent` (hook
    late) and `recordAgent` then `task_started` (hook early) → in both, a live
    payload with the incremented `agentSessionCount` arrives within one
    interval and before any result;
  - result → `onResultStats` snapshot revision is strictly greater than the last
    live revision; no `onLiveStats` after the result until a new usage frame
    (advance timers past the interval) other than the one settle payload;
  - settle per result exit, each after a shown estimate at revision L, each
    asserting exactly one settle `onLiveStats` payload with no `provisional`
    field and revision > L, and that `onResultStats` behaviour is unchanged
    from today (same calls, same payloads, no extra call):
    - accepted (settle snapshot equals the `onResultStats` `sessionStats`);
    - duplicate (no `onResultStats`, settle present);
    - rejected-non-monotonic and rejected-invalid;
    - empty usage (no aggregate, no per-model usage: no `onResultStats`);
    - aggregate usage without per-model rows (`markRunIncomplete`);
    - `validateStats` rejection (no `onResultStats`);
  - no estimate shown during the turn → no settle payload (only `session:stats`);
  - stream ends (iterator completes) after an estimate with no result → one
    settle payload from `dispose()`; stream throws after an estimate → same;
  - second turn: live total = result-1 authoritative + turn-2 estimate (no
    double count);
  - `context` present on provisional payloads after a main-loop
    `message_start`, absent after `compact_boundary`; on an accepted result
    whose `modelUsage` context differs from the last partial reading, the
    settle payload has no `context` key (revision 3, finding 1);
  - Stop integration (revision 3, finding 2), real
    `SessionStatsOwnerService` with an owner from `startNew` + `rebind` (as
    the adapter does), a scripted `sdkQuery` held open by a deferred: init →
    assistant frames → advance timers → one provisional payload at revision
    L; capture the lease with `owner.leaseOf(sessionId)` and call
    `owner.release(lease)` — the exact call `interruptSession` makes after
    its teardown await (`sdk-agent-adapter.ts:1596-1598`) — while the stream
    is still open → exactly one `onLiveStats` payload, no `provisional`,
    revision > L, no `context`; THEN end the stream (iterator returns, as an
    aborted query does) → `dispose()` emits nothing more, `onStreamEnd` still
    runs once, no timer pending (`jest.getTimerCount() === 0`), no throw. The
    mirror order (end the stream first, then `release`) yields exactly one
    payload, from `dispose()`.
- Files: MODIFY `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts`;
  CREATE `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.live-stats.spec.ts`.

### 5. SdkAgentAdapter + callback registry

- Purpose: expose the live callback on the adapter contract and thread it into
  every stream.
- Responsibilities:
  - `SdkAdapterCallbackRegistry` (`sdk-adapter-callback-registry.ts:9-76`): add
    `liveStats` field, `setLiveStats`, `getLiveStats`, and clear it in `clear()`.
  - `SdkAgentAdapter.setLiveStatsCallback(cb)` next to `setResultStatsCallback`
    (`sdk-agent-adapter.ts:1431-1433`).
  - Pass `onLiveStats: this.callbacks.getLiveStats()` at all four
    `streamTransformer.transform({...})` call sites (`:901`, `:1058`, `:1205`,
    `:1556`). NOT wrapped by `wrapResultStatsForActivity` (`:1785-1801`): no
    activity notification, no `observeBudget`.
- Verified contracts and entry points: as cited; `IAgentAdapter` (Component 1).
- Dependencies: shared types.
- Integration points: `wireSdkCallbacks` (Component 6).
- Failure behaviour: callback absent → publisher inert.
- Stop / end paths (revision 3): no production change. `interruptSession`
  (`:1593-1599`), `endSession` (`:923-939`), `endSessionIfTokenMatches`
  (`:1257-1264`) and workspace teardown (`:761-771`) keep calling
  `releaseStatsOwners` after their teardown await; the settle now happens
  inside `statsOwner.release` (Component 2), which these already call.
- Verification seam: `sdk-adapter-callback-registry.spec.ts` (set/get/clear);
  `sdk-agent-adapter.spec.ts`: the transform config receives the registered
  live callback, and invoking it never calls the session budget's `observe`.
  New Stop integration case in the existing `interruptSession` describe
  (same shape as "releases the owner when init binds the canonical id while
  the interrupt awaits", spec `:1974-1996`, which uses the real owner and a
  mocked `streamTransformer.transform`): register a spy with
  `setLiveStatsCallback`; `startChatSession({ tabId: 'tab_stop' })`; take the
  captured transform config; call its `onSessionIdResolved('tab_stop',
  SESSION)`; construct a real `LiveSessionStatsPublisher` from that config's
  `onLiveStats`, `statsGeneration`, `runToken` and `h.statsOwner` (fake clock),
  `setSessionKey(SESSION)`, `observe` one assistant frame → spy receives one
  `provisional: true` payload at revision L; make `sessionLifecycle.endSession`
  return a deferred; `interruptSession(SESSION)`; before resolving, assert no
  settle yet; resolve and await → spy receives exactly one more payload (no
  `provisional`, revision > L, no `context`); `executeQuery` /
  `prepareRun`-driven paths were not called again (no new turn, no resume);
  then `publisher.dispose()` (the stream's late `finally`) → no further
  payload; `sessionBudget.observe` never called by the live callback.
- Files: MODIFY `libs/backend/agent-sdk/src/lib/helpers/sdk-adapter-callback-registry.ts`,
  `libs/backend/agent-sdk/src/lib/helpers/sdk-adapter-callback-registry.spec.ts`,
  `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`,
  `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts`.

### 6. Host broadcast wiring (cli-agent-runtime)

- Purpose: broadcast `session:stats-live` on every host.
- Responsibilities:
  - New `wireLiveStatsCallback(sdkAdapter, webviewManager, logger, tag)` called
    from `wireSdkCallbacks` right after `wireResultStatsCallback`
    (`sdk-callbacks.ts:97`); it registers a callback that calls
    `webviewManager.broadcastMessage(MESSAGE_TYPES.SESSION_STATS_LIVE, payload)`
    fire-and-forget with `.catch` logging at `debug` (session id and error name
    only). No `retryWithBackoff` (a retried estimate is stale and could land
    after the authoritative one; the floor would reject it, but the retry is
    wasted work). No per-publish `info` log (1/s).
  - Update the summary log line (`:118-122`) to mention live stats.
- Verified contracts and entry points: `WebviewManagerLike.broadcastMessage`
  `agent-events.ts:38-40`; host call site `register-rpc-surface.ts:244`.
- Dependencies: shared.
- Integration points: VS Code, Electron and CLI hosts via `wireBridges`; no app
  changes. TUI (`apps/ptah-tui/src/hooks/use-sessions.ts:250`) keeps listening to
  `session:stats` only; out of scope.
- Failure behaviour: broadcast rejection logged and dropped; the next publish or
  the authoritative `session:stats` corrects the header.
- Verification seam: `sdk-callbacks.spec.ts`: the harness adapter mock gains
  `setLiveStatsCallback` (otherwise `wireSdkCallbacks`' try block aborts the
  wiring that follows, `sdk-callbacks.ts:91-128`); invoking the captured callback
  broadcasts `'session:stats-live'` once with the payload unchanged; a rejecting
  broadcast is not retried and does not throw.
- Files: MODIFY `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts`,
  `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.spec.ts`.

### 7. Frontend state: snapshot validator and admitted live install (chat-state)

- Purpose: accept live snapshots (provisional or authoritative) and apply a live
  context reading only when the same snapshot passed the revision floor, without
  inventing a capacity.
- Responsibilities:
  - `isValidSessionStatsSnapshot` (`session-stats-snapshot.ts:19-54`): accept
    `provisional` only as `undefined` or a boolean.
  - New public `TabManagerService.installLiveSessionStats(tabId, snapshot:
    SessionStatsEntry, context?: { model: string; contextTokens: number }):
    boolean` (review finding 2):
    - `if (!this.acceptSessionStats(tabId, snapshot)) return false;` — the same
      admission as `installSessionStats` (`:2252-2262`, `:2348-2372`), called
      once.
    - Build one patch: `sessionStats: snapshot`, `...budgetPatch(snapshot,
      undefined)` (keeps the last budget, `:147-155`), and, only when
      `context` is present, the tab's current `liveModelStats` exists, its
      model equals `context.model` under `normalizeModelKey`
      (`pricing.utils.ts`), and the existing pure helper
      `postCompactionContextStats(tab.liveModelStats, context.contextTokens)`
      (`:2159-2196`, prior capacity, `null` for non-positive tokens) returns a
      payload, `liveModelStats: <that payload>`. One `updateTabInternal` call.
      Otherwise the fill is left as it is (never an explicit "unknown").
    - Context gate (revision 3, finding 1): the context branch above runs
      only when `snapshot.provisional === true`. An authoritative live
      snapshot never writes `liveModelStats`, even if a `context` argument
      reached the method (the parser already strips it; this is the last
      layer, so a future caller cannot reopen the hole).
    - Returns `true` when admitted. The return value exists for the
      aggregator's per-tab outcome and its tests; no caller branches on it
      for side effects.
  - `installSessionStats` is unchanged (still `void`); its two callers in the
    aggregator (`session-stats-aggregator.service.ts:148`, `:168`) are not
    touched. No public `applyLiveContextTokens` method exists, so a context
    reading cannot be applied outside admission.
- Verified contracts and entry points: `installSessionStats` `:2252`;
  `acceptSessionStats` `:2348` (tab-level bypass for an unrevisioned snapshot
  only, `:2358-2366`; live snapshots always carry a revision, enforced by the
  parser, Component 1); `SessionStatsRevisionFloor.admit`
  `session-stats-snapshot.ts:81-88`; `postCompactionContextStats` `:2159`;
  `setLiveModelStats` `:2233`.
- Dependencies: shared.
- Integration points: `SessionStatsAggregatorService` (Component 8).
- Failure behaviour: invalid snapshot, unknown tab, other session or below the
  floor → `false`, nothing written (neither snapshot nor context).
- Quality requirements: signals only via `updateTabInternal`; one update per
  admitted event; no new persisted field.
- Verification seam: CREATE `session-stats-snapshot.spec.ts` (no spec exists
  for this file today): `provisional: true` accepted, `provisional: 'yes'`
  rejected, floor admits live revision r then rejects a later live r-1 after
  authoritative r+1. `tab-manager.service.spec.ts`:
  - `installLiveSessionStats` admitted → snapshot and fill (prior capacity)
    installed in one update, returns `true`;
  - out-of-order after authoritative (finding 2): install an authoritative
    snapshot at revision 10 whose session fill is 40 000 tokens, then a live
    snapshot at revision 8 with `context.contextTokens: 90 000` → returns
    `false`; `sessionStats` and `liveModelStats.contextUsed` both unchanged;
  - model mismatch, no prior `liveModelStats`, or `contextTokens: 0` →
    snapshot installed, fill unchanged;
  - authoritative snapshot (no `provisional`) at an EQUAL revision to the
    installed one, passed with a `context` of 90 000 while the tab's fill is
    40 000 → returns `true`, `liveModelStats.contextUsed` still 40 000
    (revision 3, finding 1);
  - budget preserved across a live install;
  - post-compaction behaviour unchanged.
- Files: MODIFY `libs/frontend/chat-state/src/lib/session-stats-snapshot.ts`,
  `libs/frontend/chat-state/src/lib/tab-manager.service.ts`,
  `libs/frontend/chat-state/src/lib/tab-manager.service.spec.ts`;
  CREATE `libs/frontend/chat-state/src/lib/session-stats-snapshot.spec.ts`.
  `libs/frontend/chat-state/src/lib/surface-session-stats.registry.ts` is NOT
  modified (see Component 8); its spec gains one case:
  MODIFY `libs/frontend/chat-state/src/lib/surface-session-stats.registry.spec.ts`
  (exists today): `record(id, { live: L, snapshot: authoritative r10 })` then
  `record(id, { live: null, snapshot: live r8 })` → snapshot stays r10 and
  `live` stays L.

### 8. Frontend routing and aggregation (chat)

- Purpose: apply `session:stats-live` to the header only.
- Responsibilities:
  - `ChatMessageHandler`: add `MESSAGE_TYPES.SESSION_STATS_LIVE` to
    `handledMessageTypes` (`chat-message-handler.service.ts:138-162`), a `case`
    in `handleMessage` (`:164-236`), and `handleSessionStatsLive(payload)` that
    runs `parseSessionStatsLivePayload`, warns and drops on `null`, else calls
    `chatStore.handleSessionStatsLive(parsed)`. Update the header comment list
    (`:7-18`).
  - `ChatStore.handleSessionStatsLive` delegating to the aggregator (facade
    precedent `chat.store.ts:532-534`).
  - `SessionStatsAggregatorService.handleLiveSessionStats(event)`: resolve tabs
    exactly as `handleSessionStats` does (`:126-141`, including the
    cross-workspace lookup); validate with `snapshotFor` (`:251-269`);
    no tabs → `surfaceStats.record(sessionId, { live: null, snapshot })` only
    when the router knows the session (no warning otherwise; live events for an
    unknown session are expected during teardown). The surface path never
    receives a context reading (`live: null` keeps the stored `live`,
    `surface-session-stats.registry.ts:86-88`), so the registry's own floor
    (`:40-45`, `:92-103`) is the only gate and nothing can bypass it. Tabs →
    `tabManager.installLiveSessionStats(tab.id, snapshot, event.context)`
    (Component 7): admission and context in one call, so a snapshot the floor
    rejects carries no context with it.
  - The handler is the same for a provisional payload and an authoritative one
    (agent-count update, settle); `provisional` only changes the header marker
    (Component 9).
  - Must NOT call (the `SESSION_STATS` result-path effects,
    `session-stats-aggregator.service.ts:153-202`):
    `compactionLifecycle.clearCompactionState`,
    `streamingHandler.handleSessionStats` (which writes `pendingStats` on a
    streaming tab or merges the footer onto the last assistant message and
    returns queued content, `streaming-handler.service.ts:578-595`,
    `:660-679`), `sessionLoader.loadSessions`,
    `messageDispatch.sendQueuedMessage`, `handoverClient.record`,
    `setLiveModelStats` via `deriveLiveModelStats`. Turn finalization stays
    with `turn_state` / `TurnStateApplier`; the live channel neither triggers
    nor delays it.
- Verified contracts and entry points: as cited; `SurfaceSessionStatsRegistry.record`
  `surface-session-stats.registry.ts:72`.
- Dependencies: chat-state, shared, chat-routing (`StreamRouter`, already
  injected `:107`).
- Integration points: header (`chat-view.component.ts:858-859` reads
  `tab.sessionStats`).
- Failure behaviour: malformed payload/snapshot → warn once per event naming
  only the session, drop. Late live event → rejected by the revision floor,
  together with its context reading.
- Quality requirements: OnPush/signals untouched; no timers.
- Verification seam: `session-stats-aggregator.service.spec.ts`:
  - live install updates `sessionStats` via `installLiveSessionStats`;
  - for a provisional AND for an authoritative (settle) live payload, on a tab
    that is streaming and on one that is finalized with queued content:
    `streamingHandler.handleSessionStats` is never called (so no
    `pendingStats`, no footer merge), `sessionLoader.loadSessions`,
    `messageDispatch.sendQueuedMessage`, `compactionLifecycle.clearCompactionState`,
    `handoverClient.record` and `tabManager.setLiveModelStats` are never
    called (spies);
  - out-of-order (finding 2): a `session:stats` snapshot at revision 10 is
    installed, then a live payload at revision 8 with a different `context`
    → tab `sessionStats` and `liveModelStats` unchanged;
  - settle (finding 1): provisional live at revision 5, then an authoritative
    live payload at revision 6 with no `session:stats` in between (duplicate
    result) → tab shows the revision-6 snapshot without `provisional`;
  - a later `session:stats` replaces a live snapshot;
  - context, both arrival orders (revision 3, finding 1): a provisional live
    payload at revision 5 with partial `context` 90 000 is installed (fill
    90 000); the result is revision 6 with `modelUsage` deriving a fill of
    60 000. (a) `session:stats` r6 then the settle live payload r6 (no
    `context`) → final `sessionStats` r6 without `provisional`, fill 60 000;
    (b) settle r6 then `session:stats` r6 → same final state. A third case
    calls `handleLiveSessionStats` with an authoritative r6 snapshot AND a
    stray `context` 90 000 after `session:stats` → fill stays 60 000 (the
    Component 7 gate); `chat-message-handler.service.spec.ts` separately pins
    that the parser strips such a `context` before the store is called;
  - Stop on an open tab (revision 3, finding 2): replay the payload sequence
    the Component 4/5 Stop tests pin — provisional live r5 (marker shown),
    then authoritative live r6 with no `session:stats`, no `turn_state`, no
    new turn and no resume read → tab `sessionStats` is r6 without
    `provisional` (Component 9 marker hidden), the tab stays open and its
    status is untouched, and none of the result-path spies above fire;
  - surface path: records the snapshot and keeps `live`; a lower-revision live
    payload after an authoritative one changes nothing.
  `chat-message-handler.service.spec.ts`: new type routed; malformed payload
  dropped; `SESSION_STATS` routing unchanged.
- Files: MODIFY `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts`,
  `libs/frontend/chat/src/lib/services/chat-message-handler.service.spec.ts`,
  `libs/frontend/chat/src/lib/services/chat.store.ts`,
  `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts`,
  `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.spec.ts`.

### 9. Header estimate marker (chat-ui)

- Purpose: say honestly that in-turn figures are an estimate.
- Responsibilities: in `SessionStatsSummaryComponent`
  (`session-stats-summary.component.ts`), a `computed` `isEstimate =
  snapshot()?.provisional === true`; when true, the cost and tokens chips show a
  leading `~` and their tooltips (`costTooltip`, `tokenTooltip`, `:279-305`) gain
  the line "Live estimate while the turn runs; final figures replace it when it
  ends." Nothing changes when false.
- Verified contracts and entry points: `snapshot` input and `totalCost` /
  `tokensLabel` computeds `:229-262`.
- Dependencies: shared type only.
- Failure behaviour: not applicable.
- Quality requirements: OnPush retained; text available to screen readers
  through the existing tooltip/aria path; no animation.
- Verification seam: `session-stats-summary.component.spec.ts`: marker and
  tooltip line present for a provisional snapshot, absent otherwise.
- Files: MODIFY `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts`
  (and its template if external), `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.spec.ts`.

## Integration architecture

- Data flow:
  1. CLI → `sdkQuery` → `StreamTransformer` loop.
  2. `init` → `onSessionIdResolved` (owner rebound synchronously,
     `sdk-agent-adapter.ts:1314`) → `publisher.setSessionKey` (attaches the
     owner agent watcher).
  3. Each `assistant` frame (main or subagent) / `task_started` →
     `publisher.observe` → per-id max-merge → throttle. SubagentStart hook →
     `owner.recordAgent` → watcher → throttle (never synchronous).
  4. Flush → price rows → `owner.publishLive` (touch, live snapshot,
     `provisional: true`; or the authoritative snapshot when there is no
     estimate) → `onLiveStats` → `SdkAdapterCallbackRegistry` →
     `wireLiveStatsCallback` → `broadcastMessage('session:stats-live')` → host
     transport → webview `ChatMessageHandler` → parser →
     `SessionStatsAggregatorService.handleLiveSessionStats` →
     `installLiveSessionStats` (revision floor; context only for an admitted
     `provisional: true` snapshot) → header.
  5. `result` → `onTurnEnd` → `publisher.onResult` (cancel timer, clear map,
     `owner.clearProvisional` → touch, enter `settling`) → existing
     pricing/`replaceRun`/`markRunIncomplete` → `session:stats` when today's
     rules send it (unchanged) → `finally publisher.settle()` → when an
     estimate was shown, one `session:stats-live` with the authoritative
     snapshot at a strictly greater revision. The header ends on an
     authoritative snapshot on every exit; the footer, `pendingStats`, queued
     dispatch and the budget see only what `session:stats` carries, as today.
     Turn finalization is `turn_state` → `TurnStateApplier`, untouched.
  6. Stream end or error → `publisher.dispose()` (settles if an estimate is
     still shown and the owner was not released, detaches the watcher) →
     `onStreamEnd`.
  7. Stop / `/clear` / session end (revision 3): `chat:abort` →
     `abortSession` → `interruptSession` → await `sessionLifecycle.endSession`
     → `releaseStatsOwners` → `owner.release(lease)` → (lease matches)
     clear provisional, touch, `publish()`, delete state → each watcher's
     `onReleased(snapshot)` → publisher `emitAuthoritative` → one
     `session:stats-live` (authoritative, no `context`) → step 4's webview
     path → header marker cleared. Whichever of step 6 and step 7 runs first
     settles; the other emits nothing.
- State or persistence: estimate state lives in memory only: the publisher's
  per-id map (cleared every result, on release and on dispose) and
  `RunState.provisional` (cleared at every result and inside `release`); the
  owner watcher set on `OwnerState` (one entry per live stream, detached at
  dispose, notified and dropped on release). A tab may persist a provisional
  snapshot only in the narrowed A5 case (owner dropped by `startNew`
  replacement or `clearAll`, where no display is bound to the dropped
  owner's live output). No disk or schema change.
- External boundaries: SDK frames (external CLI process) parsed with Zod in the
  publisher; webview payload parsed by the hand-written shared parser and
  `isValidSessionStatsSnapshot`. No secrets or content in logs (error names and
  session ids only).
- Failure and rollback: pricing unknown → `costUSD: null` → `totalCost: null`,
  `knownCost` subtotal, `pricingCoverage: 'partial'` (existing UI path
  `session-stats-summary.component.ts:237-244`). Owner pending/stale → no live
  publish. Callback/broadcast failure → logged, dropped; the next live publish,
  the settle or `session:stats` corrects the header (a dropped settle on a
  duplicate/empty result is corrected by the next turn's snapshots; accepted
  as fire-and-forget, no retry). A throw inside the result branch still runs
  `settle()` (finally) and then propagates as today. Removing the feature = the callback absent
  (publisher inert).
- Observability: `debug` log on broadcast failure (cli-agent-runtime) and a
  one-time `warn` on callback throw (publisher); otherwise the header itself is
  the evidence. No per-second info logs.

## Architecture-level quality requirements

- Functional:
  - During a turn with token-bearing assistant frames, the header's tokens and
    cost change within about 1 s of a frame, before any `result`.
  - Subagent spend (frames with `parent_tool_use_id`) is included.
  - The agent count increases within about 1 s of whichever comes LAST of the
    SubagentStart hook and the `task_started` message, with no usage frame
    required, before any `result`.
  - After every `result` that follows a shown estimate (accepted, duplicate,
    rejected, empty-usage, incomplete, validation-dropped), and at stream end,
    the header shows an authoritative snapshot (no estimate marker) at a
    revision above every earlier live snapshot; no live event emitted before
    it, nor its context reading, can replace it.
  - After Stop (`chat:abort`), `/clear` or a session end that follows a shown
    estimate, the open tab's header shows an authoritative snapshot without
    the estimate marker, with no new turn and no resume, whether the owner is
    released before or after the stream's `finally`.
  - No authoritative live payload changes the context gauge; the gauge after
    a result equals the one derived from that result's `modelUsage`, in
    either arrival order of `session:stats` and the settle.
  - Turn finalization (`turn_state`), footer cost, `pendingStats`,
    queued-message dispatch, session-list reload, compaction clearing and the
    session budget behave exactly as before; no live payload (estimate or
    settle) reaches any of them.
- Performance: at most 1 throttled live broadcast per second per stream, plus
  at most one settle per result or stream end; one timer and one owner
  watcher per stream; O(models) work per flush.
- Security: no new input path from the webview; payloads validated at both
  boundaries; no content logged.
- Maintainability: layer rule respected (shared L0 ← agent-sdk L3 ←
  cli-agent-runtime ← rpc-handlers; frontend libs unchanged dependency
  direction); no new vscode-core imports in agnostic libs; no DI token needed
  (publisher is per-stream, constructed with `new`, like the isolated message
  transformer); host-source baseline untouched.
- Testability: every behaviour above has a spec in the owning project (see each
  component's verification seam).

## Team-leader handoff

- Recommended executors:
  - Component 1 (shared): backend-developer (type and parser work consumed by
    both sides; no UI).
  - Components 2-6 (agent-sdk, cli-agent-runtime): backend-developer.
  - Components 7-9 (chat-state, chat, chat-ui): frontend-developer.
- Complexity: MEDIUM-HIGH. Six projects, but each change is additive; the
  delicate parts are the revision-ordering invariant and the agent watcher
  (Component 2), the throttle/timer/settle lifecycle (Component 3), the
  `try/finally` settle around the result branch (Component 4), and admission
  coupled to context (Component 7). Revision 2 adds no new project or file
  outside the revision-1 list except the existing
  `surface-session-stats.registry.spec.ts`. Revision 3 adds no file: the
  release settle lives in `session-stats-owner.service.ts` (Component 2) and
  the publisher (Component 3); the Stop integration tests go into the
  already-listed `stream-transformer.live-stats.spec.ts`,
  `sdk-agent-adapter.spec.ts` and `session-stats-aggregator.service.spec.ts`;
  the context gate touches the already-listed parser, publisher and tab
  manager. `sdk-agent-adapter.ts` gains no Stop-specific code.
- Dependencies and ordering: Component 1 first (contract). Components 2 → 3 → 4
  → 5 in agent-sdk depend on each other in that order; Component 6 depends on 1
  and on 5's `IAgentAdapter` method existing in shared (already in 1).
  Components 7 → 8 → 9 depend on 1; 8 depends on 7.
- Parallel-safe work: after Component 1 lands, the backend group (2-6) and the
  frontend group (7-9) are file-disjoint and can run in parallel. Within the
  backend group, 6 (cli-agent-runtime) is file-disjoint from 2-5 (agent-sdk).
- Files affected:
  - CREATE: `libs/shared/src/lib/types/messages/session-stats-live.ts`,
    `libs/shared/src/lib/types/messages/session-stats-live.spec.ts`,
    `libs/backend/agent-sdk/src/lib/helpers/live-session-stats-publisher.ts`,
    `libs/backend/agent-sdk/src/lib/helpers/live-session-stats-publisher.spec.ts`,
    `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.live-stats.spec.ts`,
    `libs/frontend/chat-state/src/lib/session-stats-snapshot.spec.ts`.
  - MODIFY: `libs/shared/src/lib/types/messages/message-constants.ts`,
    `libs/shared/src/lib/types/messages/index.ts`,
    `libs/shared/src/lib/types/rpc/rpc-session.types.ts`,
    `libs/shared/src/lib/types/agent-adapter.types.ts`,
    `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts`,
    `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.spec.ts`,
    `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts`,
    `libs/backend/agent-sdk/src/lib/helpers/sdk-adapter-callback-registry.ts`,
    `libs/backend/agent-sdk/src/lib/helpers/sdk-adapter-callback-registry.spec.ts`,
    `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`,
    `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts`,
    `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts`,
    `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.spec.ts`,
    `libs/frontend/chat-state/src/lib/session-stats-snapshot.ts`,
    `libs/frontend/chat-state/src/lib/tab-manager.service.ts`,
    `libs/frontend/chat-state/src/lib/tab-manager.service.spec.ts`,
    `libs/frontend/chat-state/src/lib/surface-session-stats.registry.spec.ts`,
    `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts`,
    `libs/frontend/chat/src/lib/services/chat-message-handler.service.spec.ts`,
    `libs/frontend/chat/src/lib/services/chat.store.ts`,
    `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts`,
    `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.spec.ts`,
    `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts`,
    `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.spec.ts`.
  - REWRITE: none.
  - Explicitly untouched: `libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts`,
    `apps/ptah-tui/**`, all host transports,
    `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts` (keeps
    calling `recordAgent`), `libs/frontend/chat-state/src/lib/surface-session-stats.registry.ts`,
    `libs/frontend/chat-streaming/**` (finalization and `handleSessionStats`).
- Verification points (scoped, memory-safe, one heavy check at a time,
  `--maxWorkers=2`, no build/serve/e2e, no `run-many`):
  - shared: `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/types/messages/session-stats-live.spec.ts libs/shared/src/lib/types/rpc/host-source-registry.contract.spec.ts --coverage=false --maxWorkers=2`; `npx nx typecheck @ptah-extension/shared`.
  - agent-sdk: Jest on `session-stats-owner.service.spec.ts`,
    `live-session-stats-publisher.spec.ts`, `stream-transformer.live-stats.spec.ts`,
    `stream-transformer.spec.ts`, `stream-transformer.plan-limits.spec.ts`,
    `sdk-adapter-callback-registry.spec.ts`, `sdk-agent-adapter.spec.ts` with
    `-c libs/backend/agent-sdk/jest.config.ts --coverage=false --maxWorkers=2`;
    `npx nx typecheck @ptah-extension/agent-sdk`; `npx nx lint @ptah-extension/agent-sdk`.
  - cli-agent-runtime: Jest on `sdk-callbacks.spec.ts`; typecheck + lint the
    project.
  - chat-state, chat, chat-ui: Jest on the listed specs per project; typecheck
    + lint each changed project.
  - chat-state additionally: Jest on `surface-session-stats.registry.spec.ts`
    and `session-stats-snapshot.spec.ts`.
  - Contracts to honour: `SESSION_STATS` payload and handling unchanged
    (`onResultStats` called on exactly the same branches as today);
    `snapshot()` never contains an estimate; authoritative revision strictly
    greater than any earlier live revision AND delivered on every result exit
    and at stream end after a shown estimate (settle), AND on every successful
    lease `release` after a shown estimate (release settle), exactly once per
    estimate whichever of release / dispose runs first; `release` keeps its
    signature, boolean result and lease rule and notifies no watcher on its
    `false` branches, on `startNew` replacement or on `clearAll`; the live
    callback never reaches `observeBudget`; owner watchers never flush
    synchronously on `onAgentRecorded`, are detached at dispose, and a
    throwing watcher never breaks `release` or `recordAgent`; `context` rides
    only on `provisional: true` payloads (publisher, parser and
    `installLiveSessionStats` each enforce it) and is applied only after
    admission; the live path never calls
    `streamingHandler.handleSessionStats`, `loadSessions` or
    `sendQueuedMessage`.
  - Review-finding traceability: finding 1 → Components 2, 3, 4 (settle) and
    8 (settle install test); finding 2 → Components 7, 8; finding 3 →
    Components 2 (watcher), 3, 4 (ordering tests); finding 4 → rationale in
    Architecture decision alt 1, evidence table, Component 8 spies.
    Round 2: finding 1 (settle context) → Components 1 (payload doc, parser
    strip), 3 (publisher attaches context only to provisional), 4 (accepted
    result test), 7 (tab-manager gate + equal-revision test), 8 (both arrival
    orders); finding 2 (Stop) → Components 2 (`OwnerWatcher.onReleased`,
    release settle, generation-safety tests), 3 (`onOwnerReleased`, one
    settle either order), 4 (release-before-dispose integration), 5
    (`interruptSession` integration), 8 (open-tab marker clears); A5
    narrowed in Architecture decision.
