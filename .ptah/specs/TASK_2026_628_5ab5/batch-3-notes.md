# Batch 3 notes: AGENT_SUMMARY_CHUNK through BatchedUpdateService

## Files changed

- MODIFIED `libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.ts`: `handleAgentSummaryChunk` now mutates the queued state (or the tab's state when nothing is queued), appends blocks in place and calls `BatchedUpdateService.scheduleUpdate`. Adds the module-level `appendAgentSummary` helper and injects `BatchedUpdateService`.
- MODIFIED `libs/frontend/chat-streaming/src/lib/batched-update.service.ts`: adds the read accessor `queuedState(tabId)`, which returns `pendingTabUpdates.get(tabId) ?? deferredTabUpdates.get(tabId)`.
- MODIFIED `libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.spec.ts`: uses the real `BatchedUpdateService` with a hand-driven rAF and `provideSurfaceActiveTesting()`. Updates one existing test and adds 6 behaviour tests.
- MODIFIED `libs/frontend/chat-streaming/src/lib/batched-update.service.spec.ts`: adds 1 `queuedState` test.

## Design summary

- **Override applied.** Batch 2 keeps the `{ ...state }` copy in `flushPendingUpdates` (`batched-update.service.ts:190`). It also folds summary length and block count into the owning root's digest (`execution-tree-cache.ts` `foldAgentContent` :149-189, `agentMemoKey` :349-366). As a result, every flush publishes a new state object, and the owning root rebuilds when a summary grows. Batch 3 adds no revision field.
- **Per chunk, for each active-workspace tab with `streamingState`:**
  1. `state = batchedUpdate.queuedState(tab.id) ?? tab.streamingState`.
  2. `appendAgentSummary(state, …)`:
     - The summary string is concatenated.
     - Blocks are added with `push(...)` into the existing array. When the agent has no array yet, the handler creates one by copying the payload.
  3. `batchedUpdate.scheduleUpdate(tab.id, state)`. The handler no longer calls `setStreamingState` directly for these tabs.
- **Visibility gating** comes from `BatchedUpdateService.canFlush`:
  - A hidden document defers the publish.
  - A tab that is neither in the visible set nor the active tab also defers.
  - Deferred updates drain through the existing `visibilitychange`, active-tab and visible-set effects.
- **Block array identity:** no reader depends on it.
  - The tree cache keys on `.length` (`execution-tree-cache.ts:180, :364`).
  - `agent-node.fn.ts:80-96` and `tool-node.fn.ts:361` read the array without keeping a reference to it.
  - Finalization deep-copies each array (`message-finalization.service.ts:319-320`).
- **Background-workspace fallback** (`findTabBySessionIdAcrossWorkspaces`): keeps the direct workspace-aware `setStreamingState(id, { ...state })`, now with the in-place append. See Decisions.

## Proof: an older state is never scheduled over a newer queued one

`scheduleUpdate(tabId, s)` replaces whatever is queued for `tabId` with `s` (`batched-update.service.ts:127-140`). Overwriting is therefore the only way a scheduled state can lose newer data. The handler can be in one of two cases.

1. **A state Q is queued (pending or deferred).** The handler mutates Q and schedules Q again. The entry in the map is the same object before and after the call. The set of states that will be published is unchanged; Q only gains the summary. Nothing is replaced, so nothing is lost.
2. **Nothing is queued.** The newest state for the tab is the one `TabManager` holds, `tab.streamingState`. It was either published by the last flush or written directly. The handler mutates that state and queues it. The queue held no newer state for it to overwrite.

There are only two ways the tab's state reaches the queue: the streaming path's `scheduleUpdate` and this handler. Both resolve the state before they write. The JavaScript event loop runs the handler synchronously, so no flush can run between the `queuedState` read and the `scheduleUpdate` call.

Test: `never schedules an older state over the one already queued`.
- The tab holds `m-old` and the queue holds a different object `m-new`.
- After a chunk, `queuedState('tab-1')` is still the `m-new` object.
- The single flush publishes `currentMessageId === 'm-new'` with the summary appended.

A direct writer can install a fresh state around the queue: a compaction replacement, a resume, or a background-partition write. Round 1 originally treated this as out of scope. The review showed that Batch 3 widens the trigger, so it is now fixed. See "Review round 1" below.

- The test in this section now builds the queued state as a flush-copy sibling (`{ ...published }`), because that is the only way two states for one tab legitimately share containers.

## Check results

Every heavy check ran from `D:\projects\ptah-wt-628` while holding `.ptah/tmp/heavy-check.lock`. The lock was released in `finally`.

| Command | Result |
|---|---|
| `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.spec.ts --coverage=false --maxWorkers=2` | 1 suite, 26/26 passed |
| `npx jest -c libs/frontend/chat-streaming/jest.config.ts libs/frontend/chat-streaming/src/lib/batched-update.service.spec.ts libs/frontend/chat-streaming/src/lib/batched-update.visibility.spec.ts --coverage=false --maxWorkers=2` | 2 suites, 28/28 passed |
| `npx nx typecheck @ptah-extension/chat --parallel=1` | Successfully ran target |
| `npx nx typecheck @ptah-extension/chat-streaming --parallel=1` | Successfully ran target |
| `npx nx lint @ptah-extension/chat --parallel=1` | 0 errors, 34 warnings, none in the changed files |
| `npx nx lint @ptah-extension/chat-streaming --parallel=1` | 0 errors, 2 warnings, none in the changed files |

## Decisions

- **Accessor added (`queuedState`).** It is needed because the queued state and `tab.streamingState` are not always the same object:
  - after a flush, the tab holds the `{ ...state }` copy;
  - the compaction replacement path is a second source of divergence.

  So the handler cannot assume `tab.streamingState === queued`. It is a read-only accessor; no other behaviour of the service changed.
- **The background-workspace fallback stays a direct write.** This deviates from the plan's "no special case" wording.
  - That partition is written directly by `routeBackgroundEvent` → `updateBackgroundTab` (`streaming-handler.service.ts:551`). That path never enters `BatchedUpdateService`.
  - A deferred batched entry for such a tab can only drain when the tab becomes active. By then it could be older than a direct partition write, for example a compaction replacement, and it would overwrite it. That breaks the "never schedule an older one" rule.
  - The fallback is rare and renders nothing (the workspace is not shown), so its per-chunk write costs no tree rebuild.
  - Covered by the existing background test, which now also asserts that nothing is left queued.
- **Block arrays are appended in place.** A new array is created only on the first chunk for an agent, by copying the payload so the backend message's array is never aliased.
- **No revision field, no change to `execution-tree-builder*`** (resolution 1). `content-visibility` was not touched.
- **The spec uses the real `BatchedUpdateService`**, not a mock, so frame coalescing and visibility deferral are tested against the real gate.

## Review round 1

Fixes for `code-logic-review-batch-3.md` (CHANGES REQUESTED, 5/10).

### Changes

- **Stale-entry guard at flush** (`batched-update.service.ts`): `flushPendingUpdates` now calls `isSuperseded(tabId, queued)` before it publishes. The check works like this:
  1. Look up the tab's current `streamingState` with `findTabByIdAcrossWorkspaces`. This lookup covers the active workspace and every background partition, so forced drains into a background tab are covered too.
  2. If the current state exists and its `events` or `eventsByMessage` container is a different object from the queued state's, a direct writer has installed a newer, fresh state. The queued entry is skipped and is not published. It has already been removed from the pending map, so it is gone.

  Every flush path goes through this method: the rAF frame, `drainDeferred` / `drainDeferredForTab` → frame, and `flushSync` (forced). No logger is injected in this service, so the drop is silent. I added none, to avoid console noise per frame.
- **Explicit clears at the compaction sites** (`streaming-handler.service.ts`, only these two sites): `batchedUpdate.clearPendingUpdates(tabId)` runs before the replacement is installed.
  - Active path: just before `setStreamingState(targetTab.id, result.replacementState)`.
  - Background path: where `state = result.replacementState` precedes `updateBackgroundTab`.
- **Empty chunk skip** (`chat-lifecycle.service.ts`): `if (!summaryDelta && !contentBlocks?.length) return;` runs before any lookup. Nothing is appended, scheduled or warned.

### Why the guard does not drop legitimate updates

Every `scheduleUpdate` caller mutates and queues the tab's CURRENT state object:
- `streaming-handler.service.ts` uses `findTabStreamingState`, `targetTab.streamingState` read from `tabs()` per event, and `t.streamingState`;
- this handler uses `queuedState ?? tab.streamingState`.

The tab holds either that same object or its flush copy `{ ...state }`. Both share `events` and `eventsByMessage`, so the guard passes.

| Case | Current vs queued | Result |
|---|---|---|
| Normal delta | same object, or a flush copy sharing the containers | publishes (spec: `publishes a normal delta`) |
| First write, tab has no state yet | `current` is null | publishes (spec: `publishes the first write`). Note that the streaming handler installs `createEmptyStreamingState()` directly before it schedules, so in practice this is case 1 |
| Tab not found | no lookup result | publishes as before. `setStreamingState` decides |
| Fork / resume / history load | installed directly (`tab-manager.service.ts:2571` resume payload, replayer); later events mutate THAT state and queue it | the queued state is the new one, so it publishes. An entry queued before the resume is older and is dropped, which is the intended result |
| Compaction replacement, active or background | fresh containers | old entry dropped (and cleared explicitly) |

`messageRevisions` is deliberately left out of the comparison, unlike Batch 2's `sameStateIdentity`. `bumpRevisions` (`chat-types.ts:301-303`) creates it lazily on the live object. If it were compared, a state could look "replaced" while it was only mutated in place. `events` and `eventsByMessage` are always new on a fresh state (`createEmptyStreamingState`, compaction, finalization rebuild), so two containers are enough.

### Defect coverage

1. **Same-frame compaction:** the queue is cleared at the site. If an entry still survives (for example one re-queued by a summary that arrives after the clear but references the old state), the guard drops it, because its containers differ from the replacement.
2. **Move to a background workspace, then a background replacement, then return:**
   - The deferred entry drains on return. Its containers differ from the partition's replacement, so it is dropped.
   - A full `flushSync()` from another tab's finalization while the tab is still in the background is also dropped: the lookup spans workspaces.
   - The background summary fallback writes `{ ...state }`, which shares containers. It is therefore not a "newer fresh state", and the queued entry for the same Maps would still publish. That is correct, because the summary lives in the same Maps.

   `tab-manager.service.ts` was not edited (Batch 5 owns it).

### Tests added or changed

- `chat-lifecycle.service.spec.ts`:
  - `makeStreamingState` now carries `events` and `eventsByMessage` Maps.
  - New tests: `skips an empty chunk`; `a compaction replacement in the same frame survives the flush`; `tab moved to a background workspace with a queued summary` › `a background replacement survives the return to the workspace` and › `a full flushSync while backgrounded does not write the old state`.
  - The once-per-frame test is unchanged and still passes.
- `batched-update.service.spec.ts`: a `stale-entry guard` block with four tests: normal delta publishes, first write publishes, a fresh direct write drops the entry, and a forced `flushSync` drops it too. The mock gains `findTabByIdAcrossWorkspaces` (default `null`).
- `batched-update.visibility.spec.ts`: the mock gains `findTabByIdAcrossWorkspaces: jest.fn(() => null)`.
- `streaming-handler.service.spec.ts` and `streaming-handler.background.spec.ts`: the `BatchedUpdateService` mocks gain `clearPendingUpdates`. Both compaction tests now assert that it is called with the tab id. Without it they threw on the new call. These are mock-shape edits to existing specs that the coordinator asked me to re-run.

### Check results (round 1)

| Command | Result |
|---|---|
| `npx jest -c libs/frontend/chat-streaming/jest.config.ts libs/frontend/chat-streaming/src/lib/batched-update libs/frontend/chat-streaming/src/lib/streaming-handler --coverage=false --maxWorkers=2` | 5 suites, 89/89 passed |
| `npx jest -c libs/frontend/chat/jest.config.ts …/chat-lifecycle.service.spec.ts …/session-loader.service.spec.ts --coverage=false --maxWorkers=2` | 2 suites, 123 passed, 2 skipped (both skips were already in `session-loader`) |
| `npx jest -c libs/frontend/chat-routing/jest.config.ts …/surface-vs-tab-parity.spec.ts …/stream-router.setup-surfaces.spec.ts …/stream-router.service.spec.ts --coverage=false --maxWorkers=2` | 3 suites, 121/121 passed. This was a regression check only: these specs use the real `BatchedUpdateService` with mocks that lack the new lookup. No chat-routing file was changed |
| `npx nx typecheck @ptah-extension/chat-streaming --parallel=1` | Successfully ran target |
| `npx nx typecheck @ptah-extension/chat --parallel=1` | Successfully ran target |
| `npx nx lint @ptah-extension/chat-streaming --parallel=1` | 0 errors, 2 warnings (unchanged, none in changed files) |
| `npx nx lint @ptah-extension/chat --parallel=1` | 0 errors, 34 warnings (unchanged, none in changed files) |

### Decisions (round 1)

- **The guard compares two containers, not Batch 2's three.** The reason is the lazy `messageRevisions` (above).
- **The guard is defined locally, not imported from `execution-tree-cache.ts`.** That file is Batch 2's, and its `sameStateIdentity` includes `messageRevisions`.
- **A tab with no state, or no tab found, still publishes.** This keeps first-write and pre-existing behaviour. Close, reset and finalization already clear or drain the queue themselves (`stream-router.service.ts:969`, `message-finalization.service.ts:126/285`).
- **The background-workspace summary fallback remains a direct write** (round 1 decision). The guard now also makes a batched path safe there. I kept the direct write because it needs no deferred entry for a tab that only drains on workspace return.

## Review round 2

Fixes "New defects 1" in `code-logic-review-batch-3-r1.md`: a deferred entry left queued by a direct background write could later republish older top-level scalars, such as `currentMessageId`.

### Changes

- `libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.ts` (`handleAgentSummaryChunk`, background fallback): the base is `batchedUpdate.queuedState(tab.id) ?? tab.streamingState`. The method appends the summary to that base, calls `batchedUpdate.clearPendingUpdates(tab.id)`, and then writes `setStreamingState(tab.id, { ...base })`.
- `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts` (`routeBackgroundEvent`): the background stream path had the same hole. It applies the same rule: accumulate on `queuedState(tab.id) ?? tab.streamingState`, then clear the queue before `updateBackgroundTab`. The ephemeral check now uses that base. The separate compaction-only `clearPendingUpdates` call is merged into this single clear, which still covers compaction.
- `clearPendingUpdates` already deletes the pending, deferred and `pendingFlush` entries for the tab (`batched-update.service.ts:344-348`), so `BatchedUpdateService` was not changed.

### Tests

- `chat-lifecycle.service.spec.ts`, new block "then a background summary chunk and a background message_start". It uses the real `BatchedUpdateService` with a hand-driven rAF. The steps are: a deferred entry with a newer scalar (`msg-pre`), a partition holding an older copy that shares the Maps, a background summary chunk, and then a `message_start`-style scalar change (`msg-new`) on the published object. The block asserts four things:
  - the summary write carries `msg-pre` and nothing remains queued;
  - `msg-new` survives the return-to-workspace drain;
  - `msg-new` survives a forced `flushSync()`;
  - the summary text `queued bg` (pre-switch plus background) is kept.
- `streaming-handler.background.spec.ts`: the mock gains `queuedState`. A new test checks that a queued state is the one passed to the accumulator, and that `clearPendingUpdates` runs before `updateBackgroundTab`, which receives the queued object.

### Check results (round 2)

| Command | Result |
|---|---|
| `npx jest -c libs/frontend/chat-streaming/jest.config.ts …/streaming-handler.background.spec.ts …/streaming-handler.service.spec.ts …/batched-update.service.spec.ts …/batched-update.visibility.spec.ts --coverage=false --maxWorkers=2` | 4 suites, 89/89 passed |
| `npx jest -c libs/frontend/chat/jest.config.ts …/chat-lifecycle.service.spec.ts --coverage=false --maxWorkers=2` | 1 suite, 32/32 passed |
| `npx nx typecheck chat-streaming --parallel=1` | Successfully ran target |
| `npx nx typecheck chat --parallel=1` | Successfully ran target (1 existing NG8107 warning in an unrelated file) |
| `npx nx lint chat-streaming --parallel=1` | 0 errors, 2 warnings (existing) |
| `npx nx lint chat --parallel=1` | 0 errors, 34 warnings (existing count) |

### Decisions (round 2)

- **Merge, then clear the queue, then write directly. No revision field was added.** Every batched writer mutates the queued object, so that object is the newest whole state: it holds the pre-switch scalars, and its Maps are shared with the partition. Using it as the base keeps the queued changes. Clearing the queue before the direct write means no older object is left to drain over later background writes. After this, the partition is the only copy, and later stream events mutate it.
- **The same rule is applied in `routeBackgroundEvent`.** The fix there is a few lines, so it was not left as an open item.

### Open items (round 2)

- The chat-routing specs were not re-run, by scope. They mock `StreamingHandlerService` (`stream-router.service.spec.ts:367`, `stream-router.setup-surfaces.spec.ts:159`), so the new `queuedState` call is not reached there.
