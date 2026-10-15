# Implementation Plan - TASK_2026_655

> Addendum: residual fixes for open questions 2 and 3 are in implementation-plan-addendum.md (user decision: fix in this task).

Main-agent stream chunks stop rendering, and the spinner goes away, after a workspace switch
(Electron, single layout). The cause is a hidden-tail overflow that turns into a JSONL resync.
That resync wipes the in-flight message and the live turn state.

## Revision 1

This revision answers `implementation-plan-review.md` (verdict REVISE). Batches and files are
unchanged; no new file is added.

1. **Major: a superseded resync reset before the currency check.** Fixed. Component 7 has a new
   "Superseded-resync guard": right after `session:load` resolves, and before
   `clearPendingUpdates` and the reset, a resync returns when its claim is no longer current.
   R-F2 now asserts no reset and no `chat:resume` from the superseded call. Decision D-5 cites
   the guard.
2. **Major: resync and compaction interleaving.** Fixed with new Decision D-9, option (a)
   extended to plain targeted loads.
   - A resync stays in the in-flight registry, which becomes a `Map` with owner and reason. A
     compaction or plain load arriving during a resync is skipped, as today.
   - A resync arriving during a compaction or plain load reserves the fence and waits, then
     runs with its seed.
   - New replayer API: `reserveFence` / `releaseReservation` (component 8).
   - Updated: component 7 (responsibilities, failure behaviour, R-F5, R-F6), component 8
     (reservation and its specs), integration data flow step 5, both preserve-list rows,
     Proposed Removals, open question 2, testability.
3. **Minor: A-1 "persists earlier".** Corrected. The duplication is cross-node and lasts until
   reload (`uuid` against `message.id`). Open question 1 now cross-references it.
4. **Minor: the root-context drop on `awaiting-background`.** Gated on the persisted boundary.
   Component 3 marks the root stream ended, and the existing Close rule drops it only once its
   suffix is empty. The verification seam is amended, and A-1 notes that the window is gone.

## Revision 2

This revision answers the re-review's new findings in `implementation-plan-review.md`. It adds
component 10 and five MODIFY files, one per existing batch (S: `rpc-chat.types.ts`;
B: `chat-rpc.schema.ts` and its spec; F: `stream-viewport-controller.service.ts` and its spec).
The batches stay file-disjoint.

1. **Moderate: a fence overflow during a resync's span silently wipes live chunks.** Fixed
   with new Decision D-10, coordinator options (a) and (c) combined.
   - The bound stays as it is. The replayer records which holders saw an overflow
     (`overflowedDuring`, component 8).
   - A resync that sees the overflow before its reset aborts without resetting. One that sees
     it later finishes. Either way, it then requests a fresh resync through the new optional
     `resyncTabIds` on `chat:setStreamViewport` (components 1, 4i and 10).
   - The coordinator's fresh `liveSeed` comes from its projection, which observes every
     negotiated event, so the chunks delivered early are covered.
   - Memory bounds are unchanged.
   - Tests: R-F7 forces the bound during the wait and proves the final text is complete. R-B8
     proves the requested seed contains chunks already delivered while visible.
   - Also updated: component 7, Integration failure and observability, the preserve-list fence
     row, testability and the handoff.
2. **Minor: D-5 recency was implicit.** Fixed. Component 7 adds "Resync recency": a
   `resyncGeneration` counter taken synchronously on arrival, with a per-key `latestResync`.
   It is compared after every pre-claim `await` and before claiming, so a stale waiter exits
   without writing. D-5 is amended. R-F8 covers out-of-order awaits in the wait phase and in
   the load phase.
3. **Minor: no spec for release on a throw path.** Fixed. Component 7 now requires the
   reservation to be taken inside the `try` whose `finally` releases it. R-F9 covers every exit
   (`session:load` rejects, `chat:resume` rejects, the awaited compaction throws, the tab closes
   or its workspace is removed during the wait, recency lost). Component 8's seam adds the
   release-after-join and the throw-path reservation cases.

## Inputs and constraints

- Requirements used: `context.md`, `proof.md` (main claims re-verified below), the launcher brief,
  and the failing reproduction spec
  `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.ws-switch-resync.spec.ts`.
- Corrections applied: `diagnosis.md` and `code-logic-review.md` are ignored on purpose. They
  describe the reverted `BatchedUpdateService.canFlush` change, and this plan does not touch
  `BatchedUpdateService`.
- Design handoff used: none. No UI or visual change.
- Missing decision-critical input:
  - There is no captured live event log next to its JSONL for one multi-block turn. That capture
    would settle when the SDK persists an assistant content block compared with when it emits the
    `source: 'complete'` batch (Assumption A-1). The design avoids depending on the exact answer:
    it treats a complete batch as the persistence boundary. If the assumption is wrong, the effect
    is limited to the duplicate or loss window recorded under A-1.
- Repository rules applied:
  - Root `CLAUDE.md`: memory-safe verification, one project at a time, `--parallel=1`,
    `--maxWorkers=2`, and no build, serve or e2e.
  - Hexagonal backend: the coordinator stays in `rpc-handlers`, gets no new `vscode-core` runtime
    import (the type-only `Logger` import already exists) and no new DI token.
  - Strict types, no `as any`. Logger in the backend; `console.warn` in the frontend, matching
    `session-liveness-reconciler.service.ts:78`.
  - No per-library instruction file covers these directories. The `README.md` files in
    `rpc-handlers` and `chat` contain no relevant rules.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Hidden tail is capped at 256 events / 512 KiB. On overflow it discards the whole tail, sets `resyncRequired` and ignores later hidden events. | `chat-stream-delivery-coordinator.service.ts:23-24,203-218` | Every stream delta is one event, so about 4 s of text overflows the tail. This is the trigger. |
| Reveal emits either `events` or `resyncRequired`, never both. | `chat-stream-delivery-coordinator.service.ts:226-235` | A resync has no way to carry live state today. |
| `updateViewport` marks revealed tabs visible before `reveal` awaits `flushBeforeTerminal`. With several revealed tabs, later ones are visible before their own snapshot. | `chat-stream-delivery-coordinator.service.ts:137-150,220-238`; buffer delivers on a 16 ms timer, `stream-batch-buffer.ts:25-33,46` | A live chunk can reach the webview before the older snapshot. That reorders text, or puts the chunk into state the resync is about to wipe. |
| A visible terminal does `states.delete(tabId)`, and so does a reveal that carries a terminal. The per-tab `sequence` then restarts at 0. | `chat-stream-delivery-coordinator.service.ts:163-170,239-243,188-200` | The frontend drops any snapshot whose `toSequence` is ≤ the last one applied (`stream-flush-scheduler.service.ts:48-58`). A second hide in a later API message is therefore dropped silently: same symptom, no overflow needed. |
| `CHAT_COMPLETE` is published on every `message_complete` (per API message, reset at `message_start`). The frontend ignores it unless `command === 'clear'`. | `chat-stream-broadcaster.service.ts:269-271,284-296`; `chat-message-handler.service.ts:351-373` | Terminal deferral can stay as it is. The coordinator's per-tab state must not be released on every terminal once it holds live state. |
| `turn_state` travels in the chunk stream through the coordinator. The broadcaster also pushes `forceIdle` turn states through `publish`. | `stream-event.transformer.ts:194-198`; `assistant-message.transformer.ts:339-344`; `chat-stream-broadcaster.service.ts:199-203,221-226,257-259`; `stream-background.ts:303-308` | Hidden turn states are retained, and lost on overflow. The coordinator can see the latest turn state per tab. |
| The live `message_start` id is the API `message.id`. Stream deltas carry `source: 'stream'`. | `stream-event.transformer.ts:158-159,181-190,467,489,507` | Deltas with `source: 'stream'` append (see the accumulator row below), so merging them is safe. |
| A `source: 'complete'` batch (message_start, text/thinking/tool, message_complete) is emitted for each SDK assistant message under the same `message.id`. | `assistant-message.transformer.ts:88,119-150,354-363,413-430` | This batch marks when content is persisted to the JSONL (Assumption A-1). |
| A stream `message_complete` (`source: 'stream'`) is emitted at `message_stop`. | `stream-event.transformer.ts:306-334` | This is a reliable "API message ended" signal. |
| A `tool_result` carries the user record uuid as `messageId`, not the assistant message id. | `user-message.transformer.ts:39,57-68` | Tool results are persisted user records and must not enter the live seed. |
| JSONL history groups assistant records under the first record's `uuid`, not `message.id`. | `session-replay.service.ts:215-232`; `message.id` exists on records, `history.types.ts:85-86` | History and live ids never match, so frontend dedup by id cannot reconcile them. The live seed may only carry content that is not yet persisted. |
| The accumulator appends stream deltas and replaces block content for `complete`/`history` deltas. A duplicate `message_start` with source `complete` arms `pendingTextClear`. | `accumulator-core.service.ts:249-295,297-326,397-420` | The live seed can be replayed through the normal live path. A later complete batch heals any partial block text. |
| Buckets are kept in timestamp order. Rendering needs a `message_start` in the bucket. | `message-node.fn.ts:27-36,62-77` | A merged delta must keep a timestamp between its first and last parts. The seed must contain the in-flight `message_start`. |
| `message_complete` does not finalize. Finalization is driven by a terminal `turn_state`. | `accumulator-core.service.ts:530-543`; `turn-state-applier.service.ts:115-139` | A seed containing a terminal turn state after an open message finalizes it, as live delivery would. |
| A resync resets the tab: `messages []`, empty state, `resuming`, `lastTurnStateRevision` undefined. History finalization then sets `streamingState: null` and `loaded`. | `tab-manager.service.ts:2533-2562,2010-2016`; `session-loader.service.ts:837-844` | After a resync the tab shows no spinner, unless a turn state is applied after finalization. |
| Only a `generating` turn state sets `streaming`. | `tab-manager.service.ts:1471-1511` | Status recovery has to re-apply a turn state after finalization. |
| On workspace switch, `reconcileRestoredTabs` probes `session:status`. The resync reset can land after that probe and erase its result. | `workspace-coordinator.service.ts:184-194`; `session-liveness-reconciler.service.ts:50-83` | This explains the missing spinner. The probe is an existing, revision-safe fallback (`ordered: false`). |
| After finalization, a live event recreates `streamingState`. | `streaming-handler.service.ts:417-431` | Seed events applied after finalization render like ordinary live events. |
| `processStreamEvent` supports `fanOut: false`. `ChatStore.processStreamEvent` does not forward options. | `streaming-handler.service.ts:190-194,314-330`; `chat.store.ts:392-401` | The seed must not fan out to sibling tabs, which were not wiped. ChatStore needs an options passthrough. |
| The targeted resync claims the fence only after `session:load`. A duplicate `switchSession` for the same `${session}:${tab}` key is skipped. | `session-loader.service.ts:764-775,798-824` | Live chunks applied during `session:load` hit the old state and are then wiped (`:838`). A second resync while one is in flight is dropped. |
| Fence: claim, buffer, and delivery in arrival order when the claim's hold closes (after finalize, or on release). Superseding claims hand the hold over. | `session-history-replayer.service.ts:143-179,191-233,457-482,503-536` | The seed belongs at "this claim's hold closes", before the buffered live events. |
| Snapshot contract and a strict Zod decoder (refine: resync ⇒ no events). The hand-written frontend parser ignores unknown keys. | `payload-map.ts:253-262`; `schemas.ts:204-234`; `chat-message-handler.service.ts:552-569` | A new optional field is backward compatible with older webviews. The Zod schema and its spec must learn the field. |
| The coordinator is registered for every host. Only a v2 webview negotiates. CLI/TUI stay legacy-visible. | `rpc-handlers/src/lib/chat/di.ts:69-72`; `chat-rpc.handlers.ts:251-262`; `chat-stream-delivery-coordinator.service.ts:1-7,106-116` | All new work must sit behind `viewportNegotiated`. CLI/TUI must stay byte-identical. VS Code and Electron share the webview path. |
| `dispose(tabId)` has no production caller. | grep of `streamDelivery.` / `deliveryCoordinator.` | New per-tab state needs its own release path and cannot rely on `dispose`. |

## Architecture decision

- **Chosen approach: an exact live seed plus a lossless-in-practice hidden tail.**
  1. **Coalescing hidden tail.** Stream text, thinking and tool deltas for the same block merge
     into one delta. Structure and turn states are kept verbatim. Overflow becomes rare (seconds
     of hidden text no longer cost 1 event each), and the reproduction spec passes.
  2. **Live-message projection.** For every v2 tab, visible or hidden, the coordinator keeps, per
     context (root, or one per `parentToolUseId`):
     - the stream `message_start` of the latest message;
     - the not-yet-persisted suffix of that message (stream events since its last complete
       batch, coalesced);
     - the latest `turn_state`.
  3. **Resync seed.** An overflow reveal sends `resyncRequired` together with a new optional
     `liveSeed`: the projection, ordered by sequence. An anchor whose suffix has no content is not
     seeded. It is held back and injected before the next live content event of that message.
  4. **Frontend.** The webview claims the replay fence when the snapshot arrives. It registers the
     seed on that claim and applies it, with `fanOut: false`, when the claim's hold closes: after
     history finalization, before buffered live events. When the seed has no turn state, it
     re-probes `session:status` after the resync.
  5. **Two adjacent loss paths found while tracing** are fixed in the same coordinator file:
     - a sequence counter that never restarts (global), so snapshots are not dropped as stale;
     - a reveal that marks a tab visible only in the same synchronous step that builds its
       snapshot.
- **Rationale.**
  - Requirement (a), all content of the in-flight message: the persisted part comes from history,
    the unpersisted part from the seed, and later parts from live delivery. They meet at the
    sequence boundary of the snapshot. Each block is shown once, because the seed holds only
    content without a complete batch, and only a complete batch puts content in JSONL (A-1).
  - Requirement (b), status: the seed's latest turn state is applied after finalization, and the
    probe covers seeds without one.
  - "Any length of hidden period": the projection is bounded by the size of one in-flight message
    per context, not by the length of the hidden period. The hidden tail can still overflow; it
    is no longer the thing that determines correctness.
- **Rejected alternatives.**
  - *Coalescing only.* Tool-heavy hidden periods (large `tool_result` outputs) still exceed
    512 KiB, and the resync would still wipe the open message. That fails "any length".
  - *Raise the tail caps.* Memory and one-shot snapshot application grow with the length of the
    hidden period, and correctness still breaks past the cap.
  - *Resync with the whole open message seeded, and `chat:resume` excluding JSONL records whose
    `message.id` is in the seed.* This changes `ChatResumeParams`, the `agent-sdk` history reader
    and the grouping (`session-replay.service.ts:215-232`). Excluding the in-flight message also
    removes the anchor of its Task tool, under which the subagent transcripts (`agentSessions`)
    are grouped. Completed subagent messages would be orphaned or lost. The bigger blast radius
    buys only a cosmetic gain: one node instead of two.
  - *Frontend keeps its pre-hide copy of the open message across the wipe.* The hidden part is
    gone after overflow, so (a) still fails. It would also need surgery on `StreamingState`
    extraction.
  - *Frontend synthesizes a `message_start` for orphan deltas in the accumulator.* This hides
    missing-start defects on the hottest path, still loses hidden text until the block completes,
    and changes `chat-streaming` behaviour for every stream.
- **Assumptions** (each has a check the implementer must run or record):
  - **A-1.** Content of an assistant block reaches the JSONL when (not long before) its
    `source: 'complete'` batch is emitted. Check: run one multi-block turn (thinking, text,
    tool_use) and log the coordinator's sequence of complete batches next to a JSONL tail read
    taken right after each batch. Record which of the two outcomes below occurs:
    - **Persists earlier** (JSONL written before the complete batch, and a resync reads it in
      that window): the block's text shows in **two nodes** and the duplication **persists until
      reload**. History groups the persisted record under `msg.uuid`
      (`session-replay.service.ts:219-220`); the seeded live node is keyed by the live
      `message.id`. The later complete batch arms `pendingTextClear` and replaces only the
      **live node's** block text (`accumulator-core.service.ts:273-276,314-319`); the history
      node keeps its copy under its own id, and no dedup key reconciles `uuid` with
      `message.id`. This is a content duplication, distinct from the accepted two-node *split*
      in open question 1, where no text appears twice.
    - **Persists later**: content in the window between the complete batch and the write is
      missing until reload.

    The root-context rule on `awaiting-background` / `sleeping` (component 3) no longer adds a
    window of its own: the root context is kept until its persisted boundary is seen.
  - **A-2.** A subagent anchor seeded after history finalization nests under its Task tool node,
    the same way deferred live subagent events do today after any resume of a live session.
    Check: frontend regression spec R-F4 (below) with a `parentToolUseId` anchor. If nesting
    fails, record it; do not widen the scope.
  - **A-3.** `SessionManager.setStatus('loaded')` after the replay (`session-loader.service.ts:961`)
    does not drive the tab spinner; the tab `status` does. Check: grep for readers of
    `sessionManager.status()` outside `chat-streaming` (none found at plan time).
- **Effect on existing code.**
  - The coordinator gains a projection and a coalescing retention, a global sequence and an
    ordered reveal.
  - The snapshot contract gains one optional field (`liveSeed`), and the viewport RPC params
    gain one (`resyncTabIds`, revision 2).
  - The resync path holds the fence from the moment the snapshot arrives, supersedes an older
    resync instead of skipping it, waits behind an in-flight compaction or plain targeted load
    on the same tab (Decision D-9), and applies the seed.
  - Nothing in `chat-streaming`, `chat-state`, `agent-sdk`, the broadcaster, the CLI/TUI or the
    VS Code host code changes.

## Component specifications

### 1. Snapshot contract: `liveSeed`

- Purpose: carry the live seed with a resync snapshot without breaking older decoders.
- Responsibilities:
  - Add to `ChatStreamSnapshotPayload` (`payload-map.ts:254-262`):
    `readonly liveSeed?: readonly FlatStreamEventUnion[];`
    Doc: valid only with `resyncRequired: true`. It holds the ordered events the receiver applies
    after rebuilding the tab from history and before later live events.
  - Extend `ChatStreamSnapshotPayloadSchema` (`schemas.ts:204-234`) with
    `liveSeed: z.array(z.unknown()).optional()`. Add a refine rule: `liveSeed` without
    `resyncRequired === true` is an issue.
  - **Revision 2 (D-10):** add to `ChatSetStreamViewportParams`
    (`rpc/rpc-chat.types.ts:354-358`):
    `readonly resyncTabIds?: readonly string[];`
    Doc: tabs whose stream the webview needs rebuilt. The host answers each with a
    `resyncRequired` snapshot carrying a fresh `liveSeed`: at once when the tab is in this
    viewport, or at its next reveal otherwise. No new RPC method, so `RpcMethodRegistry`
    (`rpc.types.ts:756-759`) and the host-source baseline are unchanged.
- Verified contracts: `payload-map.ts:253-262`, `schemas.ts:204-234`,
  `chat-stream-snapshot.spec.ts:1-45`. The Zod decoder is used only by its spec (grep); the
  webview uses the hand-written parser.
- Dependencies: none new. Lives in `@ptah-extension/shared` (`scope:shared`).
- Integration points:
  - Producer: `ChatStreamDeliveryCoordinator.reveal`.
  - Consumer: `ChatMessageHandler.parseStreamSnapshot` / `handleStreamSnapshot`.
- Compatibility:
  - An older webview ignores the unknown key (hand-written parser) and behaves as today.
  - An older host never sends it; the new webview falls back to the probe (component 8).
  - CLI/TUI never receive snapshots (legacy-visible).
- Failure behaviour: a malformed `liveSeed` makes the whole snapshot invalid, the same strictness
  as the existing events/resync rules.
- Quality: no runtime cost (type plus an optional schema field).
- Verification seam: `chat-stream-snapshot.spec.ts`.
  - Accepts a resync with `liveSeed`.
  - Rejects `liveSeed` on an events snapshot.
  - Rejects a `liveSeed` that is not an array.
  - Existing cases unchanged.
- Files:
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/shared/src/lib/types/messages/payload-map.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/shared/src/lib/types/messages/schemas.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/shared/src/lib/types/messages/chat-stream-snapshot.spec.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/shared/src/lib/types/rpc/rpc-chat.types.ts` (revision 2, type only)

### 2. Stream delta coalescer (pure helper)

- Purpose: one order-safe merge rule, shared by the hidden tail and the live projection, which
  must agree exactly.
- Responsibilities:
  - **Coalescible event:**
    - `text_delta` or `thinking_delta` with `source === 'stream'`, keyed by
      `(eventType, messageId, blockIndex)`;
    - `tool_delta` with `source === 'stream'`, keyed by `(messageId, toolCallId)`.
  - An undefined `source` is not coalesced. The existing spec
    (`chat-stream-delivery-coordinator.service.spec.ts:20-29,61-84`) relies on two such events
    staying separate.
  - **Merge condition:** a new coalescible event merges into the entry most recently appended for
    the same `messageId`, if and only if:
    - that entry has the same key; and
    - no barrier was appended since.
  - **Barriers:** `turn_state`, `compaction_start`, `compaction_complete`. A barrier clears the
    per-message "last entry" index.
  - **Merged event:** the latest event's fields (`id`, `timestamp`, `signature` when defined, else
    the previous one), with `delta` = the deltas concatenated in arrival order.
  - **Bytes:** an entry's byte estimate grows by the serialized size of the appended delta string.
- Verified contracts:
  - Event shapes: `stream.ts:60-91,118-140,159-163`.
  - Append semantics for stream deltas: `accumulator-core.service.ts:320-322,362-363,411-416`.
  - Timestamp-ordered buckets: `message-node.fn.ts:62-66`. The latest timestamp lies between the
    merged parts and the next event of the same message.
  - The id the spec requires: `delta-255` (`ws-switch-resync.spec.ts:43-46`).
- Dependencies: types from `@ptah-extension/shared` only.
- Integration: called by components 3 and 4.
- Failure behaviour: pure. An event that does not qualify is appended unchanged.
- Quality:
  - Amortized O(1) per merged delta. Store parts and join on materialization, or rely on string
    concatenation. Never re-serialize the aggregate.
  - No allocation per event beyond what is merged.
- Verification seam: a unit spec.
  - Only stream events of the same key merge.
  - An interleaved other message does not block merging.
  - Any same-message non-key event closes the aggregate.
  - A barrier closes all aggregates.
  - Merged output keeps the latest id and timestamp, the concatenated delta, and `signature`.
- Files:
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/backend/rpc-handlers/src/lib/chat/streaming/stream-delta-coalescer.ts`
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/backend/rpc-handlers/src/lib/chat/streaming/stream-delta-coalescer.spec.ts`

### 3. Live message projection (plain class, owned per tab by the coordinator)

- Purpose: hold exactly what a JSONL resync cannot reproduce for a live tab: the unpersisted part
  of each in-flight message, its anchor, and the latest turn state.
- Precedent: `StreamBatchBuffer` is a plain class in the same folder, constructed and owned by its
  caller (`stream-batch-buffer.ts:16-23`). This needs no DI token.
- Responsibilities (applied to every event for a negotiated tab, in sequence order; events
  published with `surfaceMode` are ignored):
  - **Contexts.** The context key is `parentToolUseId ?? ROOT`. Each context holds at most one
    message.
  - **Open.** A `message_start` with `source === 'stream'` replaces the context with
    `{ anchor, anchorSequence, suffix: [], streamEnded: false }`. The previous message of that
    context is dropped; it is persisted by then (A-1).
  - **Suffix.** Any event with the context message's `messageId` whose `source !== 'complete'` is
    appended through the coalescer. This covers stream deltas, `thinking_start`, stream
    `tool_start`, `signature_delta`, `message_delta`, and the stream `message_complete`.
  - **Persisted boundary.** A `message_complete` with `source === 'complete'` for that `messageId`
    clears the suffix. Other `complete` events are never stored.
  - **Close.** The context is dropped when its stream has ended (stream `message_complete` seen)
    and its suffix holds no content event. Content event types: `text_delta`, `thinking_start`,
    `thinking_delta`, `tool_start`, `tool_delta`, `signature_delta`.
  - **Turn state.** Keep the latest `turn_state` and its sequence.
    - On `idle` / `failed`: drop all contexts (`isTerminalTurnPhase`, `stream-background.ts:248-250`).
    - On `awaiting-background` / `sleeping`: **gated on the persisted boundary.** The root
      context is marked `streamEnded = true` and is not dropped there. The **Close** rule above
      then drops it as soon as its suffix holds no content event, which happens either at once
      (the complete `message_complete` for that `messageId` already cleared it) or when that
      complete batch arrives later. Subagent contexts are untouched; background subagents keep
      streaming.
      - Why gate rather than drop: the complete batch is emitted per SDK assistant message
        and can lag the stream `message_complete` and the phase transition
        (`assistant-message.transformer.ts:88,119-150,354-363,413-430`). An eager drop would lose
        unpersisted root text on an overflow resync during the background wait.
      - Why it is safe: it reuses the existing Close rule, so no new state is added. A root
        whose complete batch never arrives is still released by the next root `message_start`
        (Open), a terminal `idle` / `failed`, `compaction_complete`, `dispose`, or the byte cap.
  - **Subagent end.** A `tool_result` whose `toolCallId` equals a context key drops that subagent
    context.
  - **Compaction.** `compaction_complete` drops all contexts. This mirrors the frontend's
    replacement state (`accumulator-core.service.ts:571+`; `streaming-handler.service.ts:469-473`).
  - **Seed.** `buildSeed()` returns the latest `turn_state` plus, for every context whose suffix
    has a content event, `[anchor, ...suffix]`, all ordered by sequence. Contexts without content
    are returned separately as `deferredAnchors`.
  - **Byte cap.** `STREAM_LIVE_SEED_MAX_BYTES = 1 MiB` per tab, overridable via
    `configureForTest`.
    - Measure deltas as string bytes and other events with the existing `serializedBytes`. Only
      non-delta events are serialized; they are rare.
    - When adding would exceed the cap, the context's suffix is cleared and marked `truncated`;
      later suffix appends for that message are ignored. Its anchor still becomes a deferred
      anchor.
    - Effect: the hidden part of the block in progress appears when that block's complete batch
      arrives (the accumulator replaces it, `accumulator-core.service.ts:314-319`).
- Verified contracts:
  - Event sources and order: `stream-event.transformer.ts:181-198,290-327`;
    `assistant-message.transformer.ts:339-430`.
  - `tool_result` id semantics: `user-message.transformer.ts:57-68`.
  - Turn phases: `stream-background.ts:227-250`.
- Dependencies: component 2; `@ptah-extension/shared` (`isTerminalTurnPhase`, event types).
- Integration: the coordinator feeds `observe(event, sequence)` and reads `buildSeed()` /
  `isEmpty()`.
- Failure behaviour:
  - Events for an unknown context message are ignored, for example a stream that began before
    viewport negotiation. The resync then degrades to today's behaviour for that one message.
  - Truncation warns once per message through the coordinator's `Logger` (no content, no ids) and
    increments a metric.
- Quality: memory is bounded by `STREAM_LIVE_SEED_MAX_BYTES` per tab. Per event: one map lookup
  plus one append or merge.
- Verification seam: a unit spec of the class (inputs are event sequences, output is `buildSeed()`):
  - A pre-hide `message_start` plus 300 stream deltas gives `[turn_state?, anchor, 1 merged delta]`.
  - A complete batch clears the suffix.
  - Stream end followed by a complete batch drops the context.
  - An empty suffix becomes a deferred anchor.
  - Terminal `idle` drops all contexts.
  - `awaiting-background` with a root suffix that still holds content keeps the root context
    (it is in `buildSeed()`); a later complete `message_complete` for that `messageId` drops it.
    `awaiting-background` after the complete batch drops the root at once. Subagent contexts
    survive both.
  - Task `tool_result` drops the subagent context.
  - `compaction_complete` drops all contexts.
  - The cap truncates and defers the anchor.
  - `surfaceMode` events are ignored.
- Files:
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/backend/rpc-handlers/src/lib/chat/streaming/live-message-projection.ts`
  - CREATE `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/backend/rpc-handlers/src/lib/chat/streaming/live-message-projection.spec.ts`

### 4. `ChatStreamDeliveryCoordinator` (modified)

- Purpose (unchanged): the visibility-aware delivery boundary. It now also owns a monotonic
  sequence, ordered reveal, and the live seed.
- Responsibilities:
  - **4a. Coalescing retention.**
    - `retain` appends through the coalescer (component 2) instead of `push`.
    - The count cap checks entries; the byte cap checks the running estimate.
    - Overflow behaviour is unchanged (clear the tail, `resyncRequired`, count the metric).
  - **4b. Global sequence.**
    - Replace the per-tab `sequence` with one coordinator-wide counter, incremented per negotiated
      `publish`.
    - The per-tab state keeps `lastSequence`.
    - `fromSequence = tail[0]?.sequence ?? lastSequence` and `toSequence = lastSequence`.
    - Effect: snapshot sequences for a tab can only grow, even across state deletion. The existing
      spec numbers still hold for a single tab (`spec.ts:77-83,95-101`).
  - **4c. State lifetime.**
    - Split per-tab state into hidden-period fields (`tail`, `tailBytes`, `resyncRequired`,
      `terminal`) and live fields (projection, deferred anchors).
    - `publishTerminal` (visible) and `reveal` (with a terminal) clear the hidden-period fields.
      They delete the entry only when the projection is empty and no deferred anchor is pending.
    - The projection's own drop rules (component 3) release live state during and after the turn.
    - `dispose` stays.
  - **4d. Ordered reveal.**
    - `updateViewport` removes newly hidden tabs from `visibleTabIds` at once, but does not add the
      newly revealed ones.
    - Each revealed tab:
      1. Awaits `flushBeforeTerminal`.
      2. Checks it is still in the most recent requested viewport (a viewport generation counter).
         If not, it stays hidden.
      3. In one synchronous step: builds the snapshot, clears the hidden-period fields, adds the
         tab to `visibleTabIds`, and starts the snapshot send.
    - Events published during the flush are retained and included in the snapshot.
  - **4e. Projection feed.** Every negotiated `publish`, visible or hidden, calls
    `projection.observe(event, sequence)` before routing. The legacy (not negotiated) path returns
    first, as today (`:106-116`), so it does no projection work.
  - **4f. Resync seed.**
    - On a reveal with `resyncRequired`, the snapshot gets `liveSeed: seed.events`, omitted when
      empty.
    - `seed.deferredAnchors` move into the tab's `pendingAnchors` (keyed by `messageId`).
  - **4g. Deferred anchor injection.** In `publish`, before routing event `E` for a tab that has
    pending anchors:
    - If `E` is a content event (component 3 list) for a pending `messageId`: route the anchor
      first (same visible/hidden routing), then `E`, and drop the pending entry.
    - If `E` is a `message_start` or a stream `message_complete` for that id: drop the pending
      entry without injecting.
    - A projection drop of the context drops its pending anchor.
  - **4i. Requested resync (revision 2, D-10).** `updateViewport` reads the optional
    `resyncTabIds`. For each listed tab, before computing reveals:
    1. `getState(tabId)` (`:188-201`) creates the state if it is absent. Set
       `resyncRequired = true` and clear the tail.
    2. If the tab is in the requested viewport, remove it from `visibleTabIds` so the ordered
       reveal (4d) runs for it in this call, even though it was already visible. The reveal then
       sends `{ resyncRequired: true, liveSeed }` built from the projection in 4d's synchronous
       step (4f).
    3. If the tab is not in the viewport, the flag stays set and its next reveal sends the
       resync.

    While the flag is set, `retain` keeps nothing (`:204`); the projection still observes (4e).
    A tab with no live state (the turn already ended, state deleted at `:169`) gets a resync
    with an empty seed. That is complete, because after a terminal everything is in the JSONL.
    Validation: `ChatSetStreamViewportParamsSchema` (`chat-rpc.schema.ts:97-110`, `.strict()`)
    gains `resyncTabIds: z.array(uuidString('resyncTabIds')).max(128).optional()`, with the
    same no-duplicates refine as `visibleTabIds`.
  - **4h. Metrics** (aggregate only, no content or ids, same as the existing doc at `:183-186`).
    Add:
    - `coalescedHiddenDeltas`
    - `liveSeedEvents`
    - `liveSeedTruncations`
    - `deferredAnchorsInjected`
    - `requestedResyncs` (revision 2)
- Verified contracts:
  - The public API stays the same: `publish` (`:99-134`), `updateViewport` (`:137-150`),
    `flushBeforeTerminal` (`:153-155`), `publishTerminal` (`:158-170`), `dispose` (`:173-176`),
    `settle`, `getMetrics`, `configureForTest` (`:94-97`; gains `maxLiveSeedBytes`).
  - Callers: the broadcaster (`chat-stream-broadcaster.service.ts:167-203`) and the viewport RPC
    (`chat-rpc.handlers.ts:251-262`). Neither changes.
- Dependencies: components 2 and 3, `StreamBatchBuffer`, the `Logger` type (existing), and
  `WebviewManager`. No new imports from `vscode-core`; DI is unchanged (`di.ts:69-72`).
- Failure behaviour:
  - A send failure is logged and swallowed as today (`:250-259`).
  - Projection truncation degrades as in component 3.
  - A viewport superseded mid-reveal leaves the tab hidden; the next viewport reveals it.
- Quality:
  - CLI/TUI stay byte-identical (no negotiation means no new code runs).
  - Memory per negotiated tab ≤ 512 KiB tail + 1 MiB projection.
  - No timers, observers or polls added.
- Verification seam: `chat-stream-delivery-coordinator.service.spec.ts` (new cases) and the
  unchanged `ws-switch-resync.spec.ts`. New cases:
  - **R-B1:** the repro spec passes with its assertion unchanged (2 entries: start plus a merged
    delta with id `delta-255`).
  - **R-B2:** visible terminal, hide again, reveal: the second snapshot's `toSequence` is greater
    than the first's.
  - **R-B3:** an event published while the reveal flush is pending is in the snapshot `events`,
    never sent before the snapshot.
  - **R-B4:** a viewport superseded during the reveal flush sends no snapshot for the tab hidden
    again.
  - **R-B5:** overflow with an open message produces a resync snapshot with `liveSeed` =
    `[turn_state(generating), message_start, merged suffix]` in sequence order. This includes
    content streamed while visible before the hide.
  - **R-B6:** a deferred anchor is sent before the first content chunk of that message after the
    reveal, and not before a `message_complete`.
  - **R-B7:** never negotiated: no projection state is created and the output equals today's.
  - **R-B8 (requested resync covers delivered chunks):** a visible tab streams `message_start S`
    and 2001 visible `text_delta(S)` (all sent as chunks). Then
    `updateViewport({ ..., resyncTabIds: [tab] })` with the same visible set is called.
    Assert:
    - one snapshot with `resyncRequired: true` is sent, after the flush of earlier chunks;
    - its `liveSeed` is `[turn_state?, message_start S, one merged delta of all 2001 texts]`;
    - a chunk published after the call is sent after the snapshot.

    Variants:
    - the tab is hidden in the request: nothing is sent now, and the next reveal sends the
      resync with the seed;
    - no state for the tab: a resync with no `liveSeed`.
  - `chat-rpc.schema.spec.ts`:
    - accepts `resyncTabIds`;
    - rejects duplicates, non-uuid ids and more than 128 ids;
    - rejects other unknown keys, as today.
  - The four existing cases stay unchanged.
- Files:
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.service.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.service.spec.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts` (revision 2)
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.spec.ts` (revision 2)
  - UNCHANGED (must pass) `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.ws-switch-resync.spec.ts`

### 5. `ChatMessageHandler` snapshot handling (modified)

- Purpose: turn a resync snapshot's `liveSeed` into one `applySeed` callback with the live
  delivery semantics, minus fan-out.
- Responsibilities:
  - **Parser.** `parseStreamSnapshot` (`:552-569`) also rejects:
    - a `liveSeed` that is present but not an array;
    - a `liveSeed` without `resyncRequired === true`.
  - **Callback.** `handleStreamSnapshot` (`:530-543`) builds, for a resync with a non-empty seed,
    `applySeed = () => for each event in order: chatStore.processStreamEvent(event, tabId, sessionId, { fanOut: false }); streamRouter.routeStreamEvent(event, originTabId)`.
    This mirrors `applyChatStreamEvent`'s `deliver` (`:513-529`) but bypasses
    `deferLiveStreamEvent`: the seed runs inside the fence release.
  - **Call.** It calls `chatStore.resyncStream(tabId, sessionId, { applySeed, seedHasTurnState })`.
    With no seed, it calls exactly `resyncStream(tabId, sessionId)`, so the existing expectation
    `toHaveBeenCalledWith('tab-1','session-1')` (`chat-message-handler.service.spec.ts:1012-1027`)
    still holds.
  - The call stays synchronous up to the claim (component 7), so later chunks find the fence.
- Verified contracts: `chat-message-handler.service.ts:474-543,552-569`;
  `isTurnStateEvent` (`shared/type-guards/guards/exec.ts:406`).
- Dependencies: `ChatStore`, `StreamRouter`, both already injected.
- Failure behaviour: an invalid snapshot is dropped (existing policy). A rejected resync promise
  is handled in `ChatStore.resyncStream` (component 6).
- Verification seam (`chat-message-handler.service.spec.ts`):
  - A resync with `liveSeed` passes `applySeed`. Invoking it calls `processStreamEvent` in order
    with `{ fanOut: false }`.
  - `liveSeed` on an events snapshot is rejected.
  - The existing two snapshot cases are unchanged.
- Files:
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/frontend/chat/src/lib/services/chat-message-handler.service.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/frontend/chat/src/lib/services/chat-message-handler.service.spec.ts`

### 6. `ChatStore` passthroughs (modified)

- Purpose: keep ChatStore a thin facade.
- Responsibilities:
  - `processStreamEvent(event, tabId?, sessionId?, options?: { fanOut?: boolean })` forwards
    `options` to `streamingHandler.processStreamEvent` (`chat.store.ts:392-401`). Compaction and
    queue dispatch are unchanged.
  - `resyncStream(tabId, sessionId, seed?: { applySeed: () => void; seedHasTurnState: boolean })`
    forwards `seed` as `SwitchSessionOptions.liveSeed`.
  - `resyncStream` catches a rejection and `console.warn`s with no content. Today the
    `void resyncStream` caller (`chat-message-handler.service.ts:535`) leaves the rejection
    unhandled.
- Verified contracts: `chat.store.ts:227-236,392-430`.
- Failure behaviour: as stated.
- Verification seam: covered through component 5 and component 7 specs. `ChatStore` has no spec
  file, and none is added for two passthroughs.
- Files:
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/frontend/chat/src/lib/services/chat.store.ts`

### 7. `SessionLoaderService.switchSession`, resync path (modified)

- Purpose: make a targeted resync safe for a live turn.
- Responsibilities (the compaction and plain-load code paths are unchanged; what changes for
  them is only how they interleave with a resync on the same `loadKey`, Decision D-9):
  - **Seed option.** `SwitchSessionOptions` (`:108-112`) gains
    `liveSeed?: { applySeed: () => void; seedHasTurnState: boolean }`.
  - **In-flight registry with owner and reason.** `_inFlightSessions` (`:209`) becomes a
    `Map<string, InFlightLoad>`, where
    `InFlightLoad = { reason: 'compaction' | 'resync' | 'load'; settled: Promise<void> }`
    plus its resolver. Every `switchSession` call registers its `loadKey` as today (`:789`),
    **including a resync**. The `finally` (`:981`) deletes the key only when the stored entry
    is this call's own entry, and then resolves `settled` (never rejects). The other user,
    `refreshResumableSubagentsForSession` (`:1453-1520`), keys by bare `sessionId`, never
    collides with a targeted key, and only changes `add` to `set(sessionId, entry)` with
    `reason: 'load'`.
  - **Resync recency (explicit, revision 2).** The loader keeps one counter,
    `resyncGeneration` (a number, incremented only by resync arrivals), and a
    `Map<loadKey, number>` named `latestResync`. A resync takes `myGeneration = ++resyncGeneration`
    and writes `latestResync.set(loadKey, myGeneration)` **synchronously on arrival**, before any
    `await`. Arrival order is snapshot order: each snapshot is handled synchronously
    (`chat-message-handler.service.ts:530-536`), so a higher generation always carries the
    fresher snapshot and seed.
    - **Rule:** a resync may register, take over the registry entry, or claim only while
      `latestResync.get(loadKey) === myGeneration`. It checks this after **every** `await`
      that precedes its claim (each wake-up from the wait loop) and immediately before claiming.
      When the check fails, it returns `{ staleSnapshot: false }` without registering, claiming,
      sending `session:load` or writing anything. Its `finally` releases its reservation.
    - After the claim, the existing claim currency (`isCurrent`, the superseded-resync guard
      below, and `:883-885`) carries the same recency, because a newer resync claims only after
      passing this rule.
    - The `finally` deletes the `latestResync` entry only if it still holds `myGeneration`.
    - Correctness therefore does not depend on promise continuation order, how waiters are
      notified, or polling.
  - **Same-key arrival rules** (checked synchronously, right after `requireTargetTab`):
    - Non-resync call while any call is in flight: skipped, exactly as today (`:769-775`).
      Because a resync now stays registered, a compaction or plain targeted load that arrives
      during a resync is skipped and can no longer supersede the resync's claim.
    - Resync while a **resync** is in flight: the arriving resync is by construction the newest
      generation. It takes over the registry entry and supersedes the older one through the
      claim (D-5). A woken waiter with an older generation never takes over (recency rule).
    - Resync while a **compaction or plain targeted load** is in flight: the resync **waits**
      (D-9). It first takes a fence reservation (`historyReplayer.reserveFence(sessionId)`,
      component 8) synchronously, so every live chunk from the snapshot onward is buffered.
      It then awaits the in-flight entry's `settled`, ignoring its outcome. On each wake-up it
      applies the recency rule first, then re-evaluates the same arrival rules in a loop, because
      another call may have registered meanwhile. When the key is free, it re-runs
      `requireTargetTab`, registers, and claims. The in-flight compaction
      keeps its claim, runs its `:883-908` branches and returns its real `staleSnapshot`
      result; its fence close does not deliver the buffer while the reservation holds it.
  - **Claim early.** A resync claims the fence before its first `await` on `session:load`
    (`:798`), passing `liveSeed?.applySeed` to `historyReplayer.claim`. A resync that waited
    claims right after its wait, before `session:load`. After the claim has joined the fence,
    the resync releases its reservation. The `finally` also releases it, so a throw during or
    after the wait (for example, the tab closed) never strands the buffer.
    - **Structure required for that guarantee:** the reservation is taken as the first statement
      inside the `try` whose `finally` releases it. That `try` also wraps the wait loop, the
      registration, the claim, `session:load` and everything after. No `await` and no throwing
      call sits between `reserveFence` and the `try`. The `finally` releases, in order: the
      reservation (idempotent), the claim (`release`, `:982`), the registry entry (owner-checked)
      and its `settled`, and the `latestResync` entry (owner-checked).
    - Live chunks that arrive during the wait, `session:load` and `chat:resume` are deferred.
      Before this change they were applied to the old state and wiped at `:838`.
    - The later claim at `:824` is skipped for a resync, because its claim already exists.
  - **Superseded-resync guard (new).** Right after the `session:load` await resolves (`:798`),
    before the `loadResult.success` check (`:802`), `clearPendingUpdates` (`:831`) and the reset
    `applyResumingSession` (`:837-844`), a resync returns `{ staleSnapshot: false }` when
    `!this.historyReplayer.isCurrent(replayClaim)`. The reset is now guarded for the resync path.
    - Reason: with early claims, a newer resync can supersede this one and already be replaying
      when this call's `session:load` resolves. The replayer re-checks currency only at chunk
      boundaries (`session-history-replayer.service.ts:209-224`). An unguarded reset here
      would wipe the newer resync's partly replayed messages, and the newer replay would then
      finish with a truncated transcript and no error.
    - The guard sits before the success check, so a superseded call neither throws nor writes
      `_resumableSubagents` in the `catch` (`:976-979`).
    - Today's invariant (whoever resets holds the current claim, because the claim at `:824`
      precedes the reset at `:837`) is restored for the resync path by this guard.
  - **Fence overflow during a resync's span (revision 2, D-10).** The fence bound and its
    early delivery (`session-history-replayer.service.ts:465-479`) stay as they are. A resync
    whose fence overflowed is followed by a fresh resync, so no live chunk is lost.
    - **Detection.** The resync asks `historyReplayer.overflowedDuring(holder)` (component 8)
      for both its reservation and its claim.
    - **Before the reset.** The superseded-resync guard point (after `session:load`, before
      `:831`/`:837`) also checks overflow. If the fence has already overflowed (during the wait
      or during `session:load`), the resync returns `{ staleSnapshot: false }` without resetting
      and without sending `chat:resume`, because its reload could no longer be complete. It
      sets `freshResyncNeeded`.
    - **After the reset.** If the overflow happens later (during `chat:resume` or the replay),
      the resync completes as specified. Its `finally` then sets `freshResyncNeeded` when the
      overflow flag is set. Live chunks delivered early may have landed before the seed's
      `message_start` (orphaned) or before the reset (wiped). The fresh resync rebuilds both.
    - **Request.** In the `finally`, after the releases, when `freshResyncNeeded` is set and the
      call is still the latest generation (not superseded), the loader calls
      `StreamViewportController.requestStreamResync(tabId)` (component 10) without awaiting
      it. The status fallback probe is skipped in that case, because the fresh resync applies
      its own seed and turn state.
    - **Why it covers the gap.** The coordinator answers with a `resyncRequired` snapshot whose
      `liveSeed` is built at that moment (component 4i). The coordinator's projection observes
      every negotiated event, visible or hidden (4e). So when the new snapshot is built, every
      chunk of the in-flight messages is either in the JSONL (persisted, behind a complete
      batch) or in the projection's unpersisted suffix (A-1). That includes the chunks the
      overflowed fence delivered early. Chunks after the new snapshot are fenced by the new
      resync's own early claim.
    - **Bounded cost.** Memory does not grow: the fence keeps its 2000-event bound and the
      projection its 1 MiB per tab. A fresh resync is requested only after the previous one has
      settled, so at most one resync is in flight per tab. Another overflow needs 2000 new live
      chunks inside that resync's own span. So the reload rate is bounded by the live event rate
      divided by 2000, and no retry cap is needed.
  - **Unchanged.** Reset (`:837-844`, now behind the guard for a resync), dedup cleanup
    (`:854`), `chat:resume` (`:855-868`), the post-resume currency check (`:883-885`), the
    compaction branches (`:887-908`), replay (`:937-958`), and the failure branches.
  - **Status fallback.** After the `finally` releases the claim (`:980-983`), when
    `liveSeed?.seedHasTurnState !== true`, the claim was not superseded and no fresh resync was
    requested, call
    `SessionLivenessReconcilerService.reconcileTab(tabId, sessionId)` without awaiting it.
- Verified contracts: `session-loader.service.ts:108-112,209,759-984,1453-1520`; replayer
  `claim` / `release` / `isCurrent` (`session-history-replayer.service.ts:143-179`); the
  replay's chunk-boundary currency check (`:209-224`); plain targeted loads exist
  (`agent-session-adoption.service.ts:182`).
- Dependencies:
  - `SessionHistoryReplayer` (existing).
  - `SessionLivenessReconcilerService` (new injection). Same lib; the reconciler injects no
    loader or store, so there is no cycle (`session-liveness-reconciler.service.ts:26-30`).
  - `StreamViewportController` (new injection, component 10). It injects only `TabManagerService`,
    `SurfaceRouterService`, `ClaudeRpcService` and `DestroyRef`
    (`stream-viewport-controller.service.ts:26-29`). `SurfaceRouterService` injects only
    Angular router services (`libs/frontend/core/src/lib/routing/surface-router.service.ts:66-68`).
    So there is no cycle back to the loader. The loader's existing injections are at `:165-172`.
- Failure behaviour:
  - `session:load` or `chat:resume` fails: the existing failure branch runs, then the release
    applies the seed and the buffered live events. The tab shows the live message even when
    history failed.
  - The tab is closed or rebound: the seed is skipped (component 8).
  - The awaited compaction or plain load throws or is superseded: the resync ignores the
    outcome (`settled` never rejects) and proceeds. If the tab is gone after the wait,
    `requireTargetTab` throws into the existing `catch`; the `finally` releases the reservation,
    and the buffered live chunks go to the normal path, as for any released fence.
  - The wait cannot deadlock: `settled` resolves in every `finally`, and a waiting resync never
    holds a registry entry or a claim, so nothing waits on it.
  - The fence overflows during the resync's span: a fresh resync is requested (above). If the
    request RPC fails, `StreamViewportController` logs a `console.warn` with no content or ids.
    The tab then keeps what rendered, which is today's outcome. Causes are a transport failure,
    or a host older than the webview rejecting the new field. The Electron host and webview ship
    together, so the second is unusual.
- Verification seam (`session-loader.service.spec.ts`, new `describe('resync')`):
  - **R-F1:** `historyReplayer.claim` is called before `session:load` resolves, with the seed.
  - **R-F2:** a second resync while one is pending is not skipped. Hold the first call's
    `session:load` until the second call has claimed and started its replay, then resolve it.
    Assert that the superseded (first) call:
    - returns `{ staleSnapshot: false }` without throwing;
    - performs no `clearPendingUpdates` and no `applyResumingSession` for the tab;
    - sends no `chat:resume`;
    - leaves the second call's replayed messages intact (the tab ends with the second call's full
      transcript).
  - **R-F5 (compaction in flight, resync arrives):** start a compaction reload
    (`reason: 'compaction'`, `targetTabId`) and hold its `chat:resume`; start a resync for the
    same tab with a seed; deliver a live chunk while both are pending; then let the compaction
    reply `staleSnapshot: true` (and, in a second case, a normal reply).
    Assert:
    - the compaction call is not superseded: it resolves `{ staleSnapshot: true }` and calls
      `applyResumeFailure` + `markTabIdle` (normal reply with stats: `applyResumingSession` at
      the `:902` site and `applyResumeStats` with `preserveCompactionContextSeed: true`);
    - the resync's `session:load` is sent only after the compaction call settles;
    - the resync then runs its own reset, `chat:resume` and replay;
    - the seed runs after the resync's finalization, and the live chunk is delivered once,
      after the seed.
  - **R-F6 (resync in flight, compaction arrives):** start a resync with a seed and hold its
    `chat:resume`; call a compaction reload for the same tab.
    Assert:
    - the compaction call is skipped (`{ staleSnapshot: false }`, no `session:load` of its own),
      as today;
    - the resync's claim stays current, its seed runs, and the tab keeps the seeded
      `message_start`.
    - Variant: a plain targeted load (`targetTabId` only) behaves like the compaction.
  - **R-F7 (bound forced during the wait; no chunk lost; integration-style with the real
    `SessionHistoryReplayer`, `StreamingHandlerService` and `TabManagerService`):** this spec
    proves the fence-overflow fix end to end.
    1. A compaction reload is in flight with its `chat:resume` held.
    2. A resync with seed `[turn_state(generating), message_start S, text "hidden"]` arrives
       and waits.
    3. The spec delivers `LIVE_EVENT_FENCE_LIMIT + 1` live `text_delta(S)` chunks through
       `deferLiveEvent`, so the bound fires during the wait.
    4. The compaction settles. The first resync must return without `applyResumingSession` and
       without `chat:resume`, and must call `requestStreamResync(tabId)` exactly once.
    5. The spec then plays the coordinator's answer: a second resync whose seed is
       `[turn_state(generating), message_start S, merged text "hidden" + all live chunk text]`.
       It also delivers one more live chunk during that resync's `chat:resume`.

    Assert, after both settle:
    - the text accumulator for `S` equals `"hidden"` followed by every live chunk in order,
      with nothing missing and nothing doubled;
    - the tab `status` is `streaming`.

    Variant: the bound fires during the first resync's replay, after its reset. The first resync
    completes, then requests the fresh resync once, and the final text is complete as above.
  - **R-F8 (recency with out-of-order awaits):**
    - **Wait phase.** Resyncs R1 (older) and R2 (newer) both wait behind the same compaction,
      then the compaction settles. Assert:
      - only R2 sends `session:load` and claims;
      - R1 returns `{ staleSnapshot: false }` with no `session:load`, no claim, no
        registry entry, and its reservation released;
      - only R2's seed runs.
    - **Load phase.** R1 is claimed with `session:load` pending, and R2 supersedes it. R2's
      `session:load` and `chat:resume` resolve **before** R1's, then R1's resolve. Assert that
      R1 writes nothing (this extends R-F2 with the reverse resolution order).
    - **Unit check of the rule.** A resync whose generation is no longer the latest when its
      wait ends never registers. Drive it by starting R2 while R1 is waiting, independently of
      the order in which the two continuations run.
  - **R-F9 (release on every exit):** one parameterised case per exit, each with one buffered
    live chunk held by the resync's reservation or claim:
    - `session:load` rejects;
    - `chat:resume` rejects;
    - the awaited compaction throws;
    - the tab is closed during the wait (`requireTargetTab` throws after wake-up);
    - the tab's workspace is removed during the wait (the cross-workspace lookup in
      `requireTargetTab` fails);
    - the call loses recency during the wait.

    Assert for each:
    - the buffered chunk is delivered exactly once after the call settles;
    - a later live chunk for the session is not deferred (`deferLiveEvent` returns `false`, so
      no fence remains);
    - the registry entry and the `latestResync` entry are gone (a later compaction on the
      same key is not skipped);
    - calling `releaseReservation` again is a no-op.
  - **R-F3:** the probe is called only when the seed lacks a turn state.
  - **R-F4 (integration-style, same spec or a new `session-loader.resync-live-seed.spec.ts`):**
    real `SessionHistoryReplayer`, `StreamingHandlerService` and `TabManagerService`; mocked RPC.
    Tab is `streaming` with message `S`.
    1. A resync arrives with seed `[turn_state(generating, rev N), message_start S, merged text "hidden"]`.
    2. `chat:resume` returns history with a different uuid-keyed message.
    3. A live `text_delta(S, "live")` arrives during `chat:resume`.

    Expect:
    - the tab's `streamingState.eventsByMessage` has `S`'s `message_start`;
    - the text accumulator for `S` is `"hiddenlive"`;
    - the history message is in `messages`;
    - the tab `status` is `streaming`.

    Variant: the seed has no turn state, and the probe answers `generating`: the status ends up
    `streaming`.
- Files:
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`
  - CREATE (optional, if R-F4 does not fit the existing spec's mocks) `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/frontend/chat/src/lib/services/chat-store/session-loader.resync-live-seed.spec.ts`

### 8. `SessionHistoryReplayer`, seed at fence close (modified)

- Purpose: apply a claim's seed exactly once, at the only point that is ordered correctly. That is
  after this claim's history finalization (or failure), and before the fence's buffered live
  events.
- Responsibilities:
  - `claim(tabId, sessionId, liveSeed?: () => void)` stores the seed by claim number. A claim that
    supersedes an older one on the same tab discards the older seed (`:143-157`, `openFence`
    `:503-518`).
  - `closeFence(claim)` (`:521-526`): when the held claim matches, run the stored seed. Guard:
    `isCurrent(claim)` and the tab (`findTabByIdAcrossWorkspaces`) is still bound to the claim's
    session. The guard is side-effect free; it does not reuse `canContinueReplay`, which mutates
    status (`:381-398`). Then delete the seed and `leaveFence` as today.
  - **Error isolation.** A throwing seed is caught and `console.error`ed. The buffered live events
    still run, matching `deliverAll` (`:539-550`).
  - `release` always deletes the claim's seed entry (`:173-179`), so no seed outlives its claim.
  - **Fence reservation (new, for D-9).** `reserveFence(sessionId): FenceReservation` adds a
    holder to the session's fence (opening it if absent, as `openFence` does at `:503-513`)
    **without** touching `claims` or `heldFences`. So it supersedes no claim, and
    `isCurrent` of the in-flight compaction is unaffected. The holder number comes from
    `++claimCounter` (`:120`), so it can never equal a real claim.
    `releaseReservation(reservation)` leaves the fence through the existing `leaveFence`
    (`:529-536`) and is idempotent (a `released` flag on the reservation).
    - Effect: while a reservation is held, a compaction's `closeFence` / `release` leaves its own
      hold, but the buffer stays closed (`holders.size > 0`, `:533`). Live chunks that arrive
      during the wait are found by session id (`findFence`, `:491-494`) or through the
      compaction's held fence (`:489-490`), both the same fence object, and they are delivered
      only after the waiting resync's own claim closes, after its seed.
    - The existing 2000-event bound (`:465-479`) still applies over the longer span. Its
      consequence (early delivery that a later reset can wipe) is handled by the overflow
      record below and the fresh resync in component 7 (D-10).
  - **Overflow record (new, revision 2).** `overflowedDuring(holder: ReplayClaim |
    FenceReservation): boolean` is true when that holder's session fence overflowed while the
    holder held it.
    - When `deferLiveEvent` sets `fence.overflowed` (`:476`), every holder number currently in
      `fence.holders` is added to a private `overflowedHolders: Set<number>`.
    - A holder that joins a fence that has already overflowed (through `openFence` or
      `reserveFence`) is added at join time, because `overflowed` is never reset while the fence
      lives (`:80,464`).
    - Entries are removed by `release` / `releaseReservation`. The loader therefore reads the
      flag before releasing, and copies it into a local for its `finally`.
    - Memory: at most one entry per live holder.
    - The bound itself, its `console.warn` (`:468-475`) and its in-order early delivery are
      unchanged.
- Verified contracts: `session-history-replayer.service.ts:118-233,457-551`.
- Dependencies: unchanged (`TabManagerService` is already injected, `:99`).
- Failure behaviour: as above. The seed never runs for a superseded claim, or for a closed or
  rebound tab.
- Verification seam (`session-history-replayer.service.spec.ts`):
  - The seed runs after `finalizeSessionHistory` and before a buffered live delivery.
  - The seed runs on `release` after a replay throws.
  - A superseded claim's seed never runs.
  - A rebound tab skips the seed.
  - The seed runs once even when both `replay` and `release` close the fence.
  - A reservation keeps the buffer closed across another claim's close. A claim that joins the
    reserved fence, followed by `releaseReservation`, delivers the buffer only at that claim's
    close, after its seed. `releaseReservation` twice is a no-op. A reservation does not change
    `isCurrent` for the tab's existing claim.
  - `releaseReservation` after the reserving resync's claim has joined the fence does not close
    the fence: the buffer is still held until that claim closes.
  - A reservation released on a throw path, with no claim ever made, delivers the buffer at
    once when it is the last holder.
  - `overflowedDuring`:
    - is true for every holder present when the bound fires, and for a claim that joins the
      fence afterwards;
    - is false for a holder of a different session's fence;
    - is cleared by `release` / `releaseReservation`.
- Files:
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.spec.ts`

### 9. `SessionLivenessReconcilerService.reconcileTab` (modified)

- Purpose: a one-tab status probe that reuses the existing revision-safe probe.
- Responsibilities: add public `reconcileTab(tabId, sessionId): Promise<void>`. It resolves
  `workspacePath` as `reconcileRestoredTabs` does (`:33-36`) and delegates to the private `probe`
  (`:50-83`, `ordered: false`). There is no new logic.
- Failure behaviour: inherited. It `console.warn`s and leaves the tab unchanged.
- Verification seam (`session-liveness-reconciler.service.spec.ts`): `reconcileTab` applies a
  `generating` answer to that tab only.
- Files:
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/frontend/chat/src/lib/services/chat-store/session-liveness-reconciler.service.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/frontend/chat/src/lib/services/chat-store/session-liveness-reconciler.service.spec.ts`

### 10. `StreamViewportController.requestStreamResync` (modified, revision 2)

- Purpose: ask the host for a fresh resync snapshot for one tab, used when a resync's fence
  overflowed (D-10).
- Responsibilities:
  - `requestStreamResync(tabId: string): Promise<void>`. When v2 is not accepted
    (`v2Accepted`, `:97`), it does nothing: no v2 host means no fenced resync to repair.
  - Otherwise it calls `chat:setStreamViewport` at once (not debounced) with the current
    viewport (`currentViewport ?? deriveViewport()`, `:56-72`) plus `resyncTabIds: [tabId]`.
  - It records that viewport as `declaredViewport`, so the debounced path (`:71-86`) does not
    re-send it.
  - The request never changes `declarationGeneration` (`:78,96`), so an in-flight normal
    declaration still applies its result.
- Verified contracts: `stream-viewport-controller.service.ts:22-29,46-111`;
  `chat:setStreamViewport` params (`rpc-chat.types.ts:354-358`) and schema
  (`chat-rpc.schema.ts:97-110`).
- Dependencies: unchanged injections (`:26-29`). The caller is `SessionLoaderService`
  (component 7). There is no cycle (component 7, Dependencies).
- Integration: the host answers on the existing `CHAT_STREAM_SNAPSHOT` path. It is handled by
  `ChatMessageHandler.handleStreamSnapshot` (`chat-message-handler.service.ts:530-536`) like any
  overflow resync, so a seed and an early claim follow.
- Failure behaviour: an RPC failure or `success: false` is caught and logged once with
  `console.warn`, with no ids or content. It is never rethrown, because the caller does not
  await it.
- Quality: one RPC per overflowed resync. No timer, observer or poll is added.
- Verification seam (`stream-viewport-controller.service.spec.ts`):
  - after v2 is accepted, the request sends one immediate `chat:setStreamViewport` with the
    current viewport and `resyncTabIds: [tab]`, and a later identical debounced declaration is
    not re-sent;
  - before v2 is accepted, nothing is sent;
  - a rejected RPC warns and resolves.
- Files:
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/frontend/chat/src/lib/services/stream-viewport-controller.service.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/frontend/chat/src/lib/services/stream-viewport-controller.service.spec.ts`

## Integration architecture

- **Data flow (overflow case):**
  1. The SDK loop calls `broadcaster.publish`, then `coordinator.publish`.
  2. The coordinator updates the projection (always, once negotiated).
  3. Visible tab: the event goes to the buffer. Hidden tab: the coalesced tail retains it, and on
     overflow sets `resyncRequired`.
  4. `chat:setStreamViewport` reveals the tab: flush, then synchronously
     `{ resyncRequired, liveSeed }`, tab visible, send.
  5. `ChatMessageHandler` (sync) calls `ChatStore.resyncStream`, then `switchSession` (sync
     prefix), which claims the fence and stores the seed. If a compaction or plain targeted
     load is in flight on the same tab, the sync prefix only reserves the fence. The resync
     waits for that call to settle, then claims (D-9).
  6. Live chunks queue in the fence.
  7. `session:load`, reset, `chat:resume` (JSONL), replay, finalize.
  8. `closeFence`: seed (`fanOut: false`), then buffered live chunks in arrival order.
  9. Status probe if the seed has no turn state.
- **Data flow (non-overflow case):** the snapshot `events` (coalesced) are applied through the
  scheduler on top of the intact tab state, as today. Sequences now always grow, so the snapshot
  is never dropped as stale.
- **State or persistence:**
  - Coordinator projection: owned per tab, lives for the in-flight message, bounded at 1 MiB, and
    released by the projection rules and by `dispose`.
  - Frontend seed: owned by the claim, lives from claim to fence close or release.
  - Nothing persisted.
- **External boundaries:** host to webview over postMessage. Validation is the hand-written
  parser (component 5) and, for tests and tooling, the Zod schema (component 1). Seed events get
  the same trust as snapshot `events` today: from the host, with a shape-checked container. No
  secrets and no user content in logs.
- **Failure and rollback:**
  - Resync RPC failure: tab in the failure state, plus seed, plus live (component 7).
  - Seed throw: isolated; live still flows.
  - Projection truncation: the anchor is deferred, and the text heals at the block's complete batch.
  - Live-event fence overflow during a resync: the resync aborts before its reset, or finishes
    if the reset already happened. Then one fresh resync is requested, and its seed covers the
    chunks delivered early (D-10, components 7, 8, 10 and 4i).
  - Older webview: ignores `liveSeed` and keeps today's behaviour.
  - Rollback: revert the coordinator change; the contract field is optional, so either side
    reverts alone.
- **Observability:** coordinator metrics (`getMetrics`: `snapshotOverflowResyncs`,
  `coalescedHiddenDeltas`, `liveSeedEvents`, `liveSeedTruncations`, `deferredAnchorsInjected`,
  `requestedResyncs`). The existing fence-bound `console.warn` (`session-history-replayer.service.ts:468-475`)
  marks the frontend side of an overflow.
  One `Logger.warn` per truncation, with no ids or content. Frontend `console.warn` on resync
  failure.

## Preserve list

| Behaviour today | Where | Status after this plan |
| --- | --- | --- |
| Legacy-visible until a v2 viewport is negotiated; CLI/TUI byte-compatible | coordinator `:1-7,106-116` | **Kept.** All new work runs after the negotiation check (R-B7). |
| Hidden-tab traffic suppression (nothing sent while hidden) | `:121-133` | **Kept.** The projection is internal; deferred anchors route with the same visibility rule. |
| Memory bounds: tail ≤ 256 entries / 512 KiB | `:23-24,203-218` | **Kept**, same constants. Entries are now coalesced. A new 1 MiB per-tab projection bound is added. |
| Overflow → `resyncRequired`, no `events` | `:210-214,232-234` | **Kept.** `liveSeed` is an added optional field. The existing overflow spec still passes. |
| Batch-before-terminal ordering; terminal deferred while hidden and delivered after the snapshot | `:152-170,239-243`; broadcaster `:284-296` | **Kept.** State is now deleted only when its live part is empty too. |
| One snapshot per reveal, ordered after accepted chunks | `:136-150,220-238` | **Kept and tightened.** The tab becomes visible in the same step that builds the snapshot. |
| Frontend stale-snapshot drop by `toSequence` | `stream-flush-scheduler.service.ts:48-58` | **Kept.** Made sound by the global sequence. |
| Resync rebuilds from canonical JSONL history (`chat:resume`, paging, stats, CLI cards) | `session-loader.service.ts:837-975` | **Kept.** The seed is applied after it. |
| Live-event fence: buffer while replaying, deliver in arrival order, bounded at 2000, release on every exit | `session-history-replayer.service.ts:143-179,457-551` | **Kept.** The seed runs at the claim's own close, before the buffer. The bound, its warning and its in-order early delivery are unchanged. Revision 2 adds an overflow record per holder, so a resync whose fence overflowed requests a fresh resync (D-10). |
| Compaction targeted reload (keep transcript until boundary-ready, staleSnapshot containment) | `session-loader.service.ts:833-908` | **Code path kept; one interleaving changes** (D-9). Its claim timing (`:824`), keep-transcript rule, `:883-908` branches and returned `staleSnapshot` do not change, and it is never superseded by a resync. A compaction arriving during a resync is skipped, as today. What changes: when a resync arrives during a compaction, the resync reserves the session fence and waits instead of being skipped. So the compaction's fence close no longer delivers its buffered live chunks; they are delivered after the waiting resync's replay and seed. |
| `_inFlightSessions` de-duplication of `switchSession` | `:209,769-775,789,981` | **Kept** for every non-resync arrival, including a compaction or plain load arriving during a resync. It becomes a `Map` with owner and reason. A resync supersedes an in-flight resync (D-5) and waits behind an in-flight compaction or plain targeted load (D-9). |
| Turn-state revision guard and terminal heal | `turn-state-applier.service.ts:20-37,87-139`; `tab-manager.service.ts:1471-1511` | **Kept.** The seed's turn state is an ordered stream event; the probe uses `ordered: false`. |
| `dispose(tabId)` | `:173-176` | **Kept** (also clears the projection). |

## Proposed Removals

None. Two behaviours change without removing a capability:

- The per-tab `sequence` field is replaced by a global counter with the same wire meaning.
- The skip of a duplicate resync is replaced by supersession. The skip of a resync behind an
  in-flight compaction or plain targeted load is replaced by a wait (D-9).

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| D-1 | Recover the in-flight message after overflow | (a) seed of the unpersisted suffix plus anchor (chosen); (b) seed the whole message and exclude it from JSONL by `message.id`; (c) coalescing only | History ids ≠ live ids (`session-replay.service.ts:215-232`). Complete batch = persistence boundary (`assistant-message.transformer.ts:119-150,413-430`). Excluding the message orphans subagent transcripts. Coalescing still overflows on tool output. | Yes. Coordinator plus frontend only; the contract field is optional. |
| D-2 | Where the seed is applied | At the claim's fence close, before buffered live (chosen); as fence-buffered deliveries; inside `replay` only | The buffer is per session and can outlive a superseded claim (`:503-536`). The failure path closes the fence through `release`. | Yes |
| D-3 | Status recovery | Seed's latest `turn_state` (primary) plus `session:status` probe when absent (fallback) | Reset erases the earlier probe (`tab-manager.service.ts:2555-2560`; `workspace-coordinator.service.ts:184-194`). Only `generating` sets `streaming` (`:1504-1511`). | Yes |
| D-4 | Sequence numbering | Global monotonic counter (chosen); a per-tab counter kept forever | Terminal deletes state (`:169,241`). Frontend drop rule (`stream-flush-scheduler.service.ts:53`). The global counter needs no per-tab retention. | Yes |
| D-5 | A resync arriving while **a resync** is in flight | Supersede through the claim (chosen); skip (today); queue | Skipping loses the second hidden period. A queue lets live events that arrive between the two snapshots hit the state that the second resync then wipes. Claims already supersede (`:143-161`). The superseded call's reset is guarded (component 7), so it cannot wipe the newer replay (`session-loader.service.ts:798,831,837-844`; replayer `:209-224`). Recency is explicit (revision 2): a per-loader `resyncGeneration` taken synchronously on arrival and compared after every pre-claim `await`. It does not rely on promise continuation order. | Yes |
| D-6 | Hidden tail caps | Keep 256 / 512 KiB (chosen); raise | Coalescing removes the per-delta count pressure. The caps also bound the cost of applying one snapshot at once (`stream-flush-scheduler.service.ts:93-95`). | Yes (constants) |
| D-7 | Coalesce only explicit `source: 'stream'` | Only stream (chosen); also undefined | The existing spec expects two undefined-source deltas kept apart (`spec.ts:61-84`). The append semantics are a property of the stream source by contract. | Yes |
| D-8 | Empty-suffix anchors | Defer and inject before the next content event (chosen); always seed; drop | Seeding an empty anchor renders an empty message bubble that is finalized empty (`message-node.fn.ts:44-54`). Dropping orphans the later deltas (`:35-36`). | Yes |
| D-9 | Resync and compaction (or plain targeted load) on the same `loadKey` `${sessionId}:${targetTabId}` (`session-loader.service.ts:764`) | **(a) chosen:** a resync stays in the in-flight registry, so a compaction or plain load arriving during it is skipped as today. A resync arriving during a compaction or plain load reserves the fence, waits for that call to settle, then runs with its own seed. (b) Carry the seed through the compaction reload and claim early for it. (c) Accept both windows as documented residuals. | **Why (c) loses:** in both directions it regenerates the bug or breaks compaction. If a compaction's `:824` claim supersedes a resync's early claim, the replayer discards the resync's seed. The compaction replay then has no `message_start` for the in-flight message, so later deltas are orphaned. If a resync supersedes a compaction, the compaction exits at `:883-885` with `staleSnapshot: false` and never runs `:887-908`, with no retry. **Why (b) loses:** the compaction's `chat:resume` may have read the JSONL before the resync's snapshot. Content persisted between that read and the snapshot is then in neither the history nor the seed (the seed holds only the unpersisted suffix). (b) also changes compaction claim timing, which open question 2 keeps out of scope. **Why (a) holds:** the compaction is never superseded and returns its real result. The resync's JSONL read happens after its snapshot, and its seed is intact. The reservation buffers every live chunk from the snapshot onward (`session-history-replayer.service.ts:503-536`), so nothing reaches the state the resync then wipes. **Not queued the other way:** a compaction queued behind a resync would run its `:902` reset after the seed and wipe the seeded live message, which is the bug again. The skip is today's behaviour. | Yes. Loader and replayer only. |
| D-10 | Live-event fence overflow (2000 events, `session-history-replayer.service.ts:465-479`) during a resync's fenced span, which D-9's wait lengthens | **Chosen:** (a) and (c) combined. Keep the bound and its early in-order delivery. Record which holders saw the overflow. Abort the resync before its reset when the overflow is already known, otherwise finish it. In both cases, after it settles, request a fresh `resyncRequired` snapshot through `chat:setStreamViewport` `resyncTabIds`. The coordinator builds that snapshot's `liveSeed` from its projection at that moment. Rejected: (b) raise or remove the bound for resync fences; (a') abort and keep today's outcome. | **Why (b) loses:** the span is not tightly bounded. It covers two `chat:resume` calls of up to 120 s each (`session-loader.service.ts:237,867`) plus the global FIFO replay admission across tabs (`session-history-replayer.service.ts:201-206`). A tool-heavy stream can buffer an unbounded number of closures in that time, which breaks the memory rule the bound exists for (`:107-113`). **Why (a') loses:** a resync that gives up without a follow-up leaves the tab without its seed, so the in-flight `message_start` is missing again. That is the original bug. **Why the chosen option is complete:** the projection observes every negotiated event, visible or hidden (component 4e). So at the new snapshot, every chunk the overflowed fence delivered early is either persisted in the JSONL or in the projection's unpersisted suffix (A-1). Chunks after it are fenced by the new resync's early claim. **Memory:** unchanged bounds (2000 fence entries, 1 MiB projection). The reload rate is at most the live event rate divided by 2000, with one resync in flight per tab. **Contract:** one optional, strictly validated param (`chat-rpc.schema.ts:97-110`); no new RPC method. | Yes. Optional field; an older host rejects it and the webview logs and keeps today's outcome. |
## Open questions

1. **After an overflow resync, the in-flight API message can render as two nodes.** Its persisted
   blocks are inside the history-merged message, and its in-progress block and the blocks after it
   are in a live node. When A-1 holds, no text is lost or duplicated. Accept?
   - Do not conflate this with A-1's "persists earlier" outcome. There, a block's text appears
     in both nodes and stays duplicated until reload. That is an assumption failure, recorded
     under A-1's check, not part of the split accepted here.
   - (Recommended) Accept the split. It matches what a reload during a live turn shows today.
   - Require one node. This needs D-1 option (b) and changes to `chat:resume` and `agent-sdk`.
     Subagent transcript handling is unresolved.
2. **Should the early fence claim also cover the compaction targeted reload?** That path has the
   same pre-claim window (`session-loader.service.ts:798-824`, then wipe at `:902`).
   - (Recommended) A separate follow-up task, so this fix does not change compaction specs.
     D-9 keeps this boundary: the compaction's own claim timing is untouched. Only a resync that
     waits behind it holds the fence early, through its reservation.
   - Include it now.
3. **Residual race.** Content can render twice in two narrow cases:
   - a message that starts after the snapshot and has a block persisted before `chat:resume`
     reads the JSONL (the same class as today's deferred live events);
   - a second overflow while a resync is still in flight.

   Options:
   - (Recommended) Accept and document. Both windows are about one RPC round trip.
   - Open a follow-up that passes live message ids to `chat:resume` for exclusion.

## Architecture-level quality requirements

- **Functional:**
  - After any hidden period, the active tab shows the full in-flight message: persisted part,
    hidden unpersisted part, and later live deltas (R-B5, R-F4).
  - The status is `streaming` while the backend turn state is `generating` (R-F4 and its variant).
  - A non-overflow reveal is never dropped as stale (R-B2) and never reordered (R-B3).
- **Performance:**
  - Projection work per event is O(1) amortized, with no `JSON.stringify` per visible delta.
  - Zero added work on the CLI/TUI path.
  - No new timers, observers or polls.
- **Security:** no content or ids in backend logs or metrics; container validation at the webview
  boundary.
- **Maintainability:**
  - The coordinator stays the single delivery boundary.
  - The projection and the coalescer are plain, pure-tested units in the same folder.
  - No new DI tokens, no `vscode-core` runtime imports, no `chat-streaming`/`chat-state` changes.
  - Nx boundaries: `shared` (`scope:shared`) is consumed by `rpc-handlers` (`scope:extension`) and
    `chat` (`scope:webview`) as today.
- **Testability** (behaviours covered):
  - the merge rule;
  - the projection lifecycle;
  - reveal ordering and sequence growth;
  - seed contents and order;
  - deferred anchors;
  - legacy unchanged;
  - snapshot parse;
  - seed ordering at fence close;
  - resync supersession, with no reset or `chat:resume` from the superseded call;
  - resync and compaction interleaving in both directions (R-F5, R-F6);
  - fence reservation;
  - fence overflow during a resync with no chunk lost (R-F7, R-B8);
  - explicit resync recency with out-of-order awaits (R-F8);
  - release of the reservation, claim and registry on every exit (R-F9);
  - early claim;
  - root-context retention until the persisted boundary on `awaiting-background`;
  - status recovery with and without a seeded turn state.

## Team-leader handoff

- **Recommended executors:**
  - Components 1 to 4: `backend-developer`, for the shared contract and the `rpc-handlers`
    coordinator. The shared change is tiny and blocks both sides.
  - Components 5 to 10: `frontend-developer`, for Angular services in `@ptah-extension/chat`.
  - `senior-tester` for R-F4, if the frontend executor cannot fit it into the existing mocks.
- **Complexity: HIGH.** The ordering is subtle (sequence boundary, fence close, persistence
  boundary). The change spans the backend, shared and frontend, with three assumptions that need
  checking. Production code size is moderate.
- **Dependencies and ordering:** component 1 comes first, because components 4, 5 and 10 use
  its types (`liveSeed`, `resyncTabIds`). Components 2 and 3 come before 4. Components 8, 9 and
  10 come before 7, and 7 before 6 and 5 (signature flow).
- **Parallel-safe work:** after component 1, the backend set {2,3,4} and the frontend set
  {5,6,7,8,9,10} touch disjoint files and projects.
- **Suggested file-disjoint batches** (the team-leader may re-derive):
  - **Batch S, shared contract** (component 1): `payload-map.ts`, `schemas.ts`,
    `chat-stream-snapshot.spec.ts`, `rpc/rpc-chat.types.ts` (type only).
    Test:
    `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/types/messages/chat-stream-snapshot.spec.ts --coverage=false --maxWorkers=2`,
    then `npx nx typecheck @ptah-extension/shared --parallel=1` if that target exists.
  - **Batch B, backend coordinator** (components 2, 3, 4): `stream-delta-coalescer.ts`(+spec),
    `live-message-projection.ts`(+spec), `chat-stream-delivery-coordinator.service.ts`(+spec),
    `handlers/chat-rpc.schema.ts`(+spec).
    Test: `npx nx test @ptah-extension/rpc-handlers --parallel=1`. Or the changed spec files with
    `npx jest -c libs/backend/rpc-handlers/jest.config.ts <specs> --coverage=false --maxWorkers=2`,
    which must include the unchanged `chat-stream-delivery-coordinator.ws-switch-resync.spec.ts`.
    Then `npx nx lint @ptah-extension/rpc-handlers --parallel=1`.
  - **Batch F, frontend resync** (components 5 to 10): `chat-message-handler.service.ts`(+spec),
    `chat.store.ts`, `session-loader.service.ts`(+spec, optional new
    `session-loader.resync-live-seed.spec.ts`), `session-history-replayer.service.ts`(+spec),
    `session-liveness-reconciler.service.ts`(+spec), `stream-viewport-controller.service.ts`(+spec).
    Test: `npx nx test @ptah-extension/chat --parallel=1`, then
    `npx nx lint @ptah-extension/chat --parallel=1`.
  - Batches B and F may run in parallel after S, but **one heavy check at a time** across lanes
    (root `CLAUDE.md`). Never workspace-wide; no build, serve or e2e.
- **Files affected:**
  - CREATE:
    - `libs/backend/rpc-handlers/src/lib/chat/streaming/stream-delta-coalescer.ts`
    - `libs/backend/rpc-handlers/src/lib/chat/streaming/stream-delta-coalescer.spec.ts`
    - `libs/backend/rpc-handlers/src/lib/chat/streaming/live-message-projection.ts`
    - `libs/backend/rpc-handlers/src/lib/chat/streaming/live-message-projection.spec.ts`
    - optional: `libs/frontend/chat/src/lib/services/chat-store/session-loader.resync-live-seed.spec.ts`
  - MODIFY:
    - `libs/shared/src/lib/types/messages/payload-map.ts`
    - `libs/shared/src/lib/types/messages/schemas.ts`
    - `libs/shared/src/lib/types/messages/chat-stream-snapshot.spec.ts`
    - `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.service.ts`
    - `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.service.spec.ts`
    - `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts`
    - `libs/frontend/chat/src/lib/services/chat-message-handler.service.spec.ts`
    - `libs/frontend/chat/src/lib/services/chat.store.ts`
    - `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`
    - `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`
    - `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts`
    - `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.spec.ts`
    - `libs/frontend/chat/src/lib/services/chat-store/session-liveness-reconciler.service.ts`
    - `libs/frontend/chat/src/lib/services/chat-store/session-liveness-reconciler.service.spec.ts`
    - `libs/shared/src/lib/types/rpc/rpc-chat.types.ts` (revision 2)
    - `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts` (revision 2)
    - `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.spec.ts` (revision 2)
    - `libs/frontend/chat/src/lib/services/stream-viewport-controller.service.ts` (revision 2)
    - `libs/frontend/chat/src/lib/services/stream-viewport-controller.service.spec.ts` (revision 2)
  - MUST PASS UNCHANGED:
    - `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.ws-switch-resync.spec.ts`
- **Verification points:**
  - The reproduction spec assertion is untouched and passes.
  - The four existing coordinator cases pass.
  - `chat-message-handler.service.spec.ts:1012-1027` passes unchanged (two-argument
    `resyncStream`).
  - No import of `vscode-core` runtime symbols is added to the coordinator.
  - The existing compaction cases pass unchanged: `session-loader.service.spec.ts` compaction
    describes and `compaction-lifecycle.service.spec.ts`. Both run inside
    `npx nx test @ptah-extension/chat --parallel=1`. For a narrower run, use
    `npx jest -c libs/frontend/chat/jest.config.ts <specs> --coverage=false --maxWorkers=2`.
  - The broadcaster, `chat-streaming` and `chat-state` are untouched. `agent-sdk` changes only
    through the addendum's Residual B (see `implementation-plan-addendum.md`, B.8).
    The addendum also changes `compaction-lifecycle.service.ts` (Residual A, RA-5); its
    compaction specs then change as A.6 lists.
  - Before closing, record the A-1 and A-2 checks in the task folder: captured event/JSONL order,
    and R-F4 subagent nesting.
