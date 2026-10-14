# Code logic review B — Batches S, B1, B2 (TASK_2026_655)

Reviewer: Claude family (independent of the codex implementer). Read-only; no tests were run.

- Score: 7/10
- Verdict: REVISE (1 Serious, 3 Moderate, 3 Minor)

Scope read in full: `live-message-projection.ts`, `stream-delta-coalescer.ts`,
`chat-stream-delivery-coordinator.service.ts` (+ its three specs), `history-block-owners.ts`,
the diffs of `session-replay.service.ts`, `session-history-reader.service.ts`,
`chat-history-read.service.ts`, `chat-session.service.ts`, `chat-rpc.schema.ts`, the shared
contract diffs, and the old coordinator at `HEAD` for comparison. Cross-read (not under review):
`libs/frontend/chat/.../stream-flush-scheduler.service.ts:48-58`, `chat-stream-broadcaster.service.ts:167-371`,
`user-message.transformer.ts:40-80`, `history-page.utils.ts:97-143`.

## Defects

### 1. Serious — a requested (or repeat) resync can carry a `toSequence` the webview discards

- File: `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.service.ts:296-303`
  (also `:258` for the state-less case). Consumer rule:
  `libs/frontend/chat/src/lib/services/stream-flush-scheduler.service.ts:53`
  (`snapshot.toSequence <= previousSequence` is dropped; `appliedSnapshots` is never reset, `:22,:56`).
- Exact ordering:
  1. Tab A holds an open root message M (anchor plus unpersisted text, no complete batch yet). The host
     sends a snapshot for A with `toSequence = A.lastSequence = N` (any earlier reveal or overflow resync).
  2. A then emits no event for a while: long tool run, thinking pause, background wait.
     `lastSequence` stays N and the global counter does not advance for A.
  3. The user leaves and returns (workspace switch). The webview calls
     `chat:setStreamViewport({ resyncTabIds: [A] })`. `updateViewport` (`:197-203`) re-arms `resyncRequired`
     and `reveal` builds `{ resyncRequired, liveSeed, liveSeedBlocks, toSequence: N }` (`:296-312`).
  4. The scheduler sees `N <= N` and returns at `:53` before `apply`. The seed (anchor and text) is never applied.
     The webview has just rebuilt from JSONL, which lacks the unpersisted anchor, so the original bug is back for M.
  - The state-less variant has the same hole: `getState` stamps `lastSequence = this.sequence` (`:258`).
    With no publish anywhere since the previous snapshot, that is equal to the earlier `toSequence`.
  - R-B2 only covers "tail events exist after the terminal". Nothing covers a snapshot built without a new event.
- Correction: when `reveal` builds a snapshot with `resyncRequired`, or any snapshot that carries a seed or
  `liveSeedBlocks`, stamp it with a fresh global number: `state.lastSequence = ++this.sequence` before reading
  `toSequence` (set `fromSequence` to the same value when the tail is empty). Resync is fresh work by definition,
  so the number must strictly exceed anything the webview has applied. Add the test listed under Missing tests.

### 2. Moderate — `reveal` and `publishTerminal` delete or clear the tab state after awaits without re-checking it

- File: `chat-stream-delivery-coordinator.service.ts:320-329` (reveal) and `:227-235` (publishTerminal).
- Exact ordering (reveal):
  1. `reveal(A)` passes the synchronous section (`:296-322`), then awaits `send(snapshot)` (`:323`), then possibly
     `send(terminal)` (`:325`).
  2. During either await a newer `updateViewport` hides A (`:194-196`). Hidden events E are retained in
     `state.tail` (`retain`, `:270-282`), and a `publishTerminal` for A (`:223-225`) writes `state.terminal`.
  3. `reveal` resumes. If the projection is empty and there are no pending anchors, it runs
     `this.states.delete(tabId)` (`:327-329`). The retained tail, any `resyncRequired` flag and the deferred
     `chat:complete` or `chat:error` are destroyed. The tab is later revealed with no state and no terminal, so
     the UI can stay "streaming" for a turn that already ended.
  - `publishTerminal` (visible path) has the same shape. `clearHidden(state)` at `:231` runs after
    `flushBeforeTerminal` and `send`, so it wipes a tail, flag or terminal produced by a hide inside those awaits.
  - The old code only deleted state together with a terminal; the new non-terminal delete is new behaviour (plan 4c).
  - Window: the transport await. This is narrow, but it silently loses a terminal.
- Correction: guard the delete and the clear. Delete only when
  `visibleTabIds.has(tabId) && !state.terminal && !state.resyncRequired && state.tail.events.length === 0 && projection.isEmpty() && pendingAnchors.size === 0`.
  In `publishTerminal`, call `clearHidden` only if the tab is still visible, or capture the generation as `reveal` does.

### 3. Moderate — opted-in reply loses `historyBlockOwners` and `historySyntheticToolResults` on an empty or unloaded read

- File: `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:236-249` (returns without the collector
  maps), then `chat-session.service.ts:1095-1098` (the spread requires both maps).
- Ordering: `chat:resume { historyBlockOwners: true }` for a session whose JSONL or sessions directory is missing
  (`loadSessionEventData` returns null, `:446-460`). The reply is `success: true, events: []` with neither field.
  The contract says the metadata is "present on a successful opt-in read" and `historySyntheticToolResults` is
  "sent with opted-in owners, possibly empty" (`rpc-chat.types.ts:289-299`, addendum `:842`).
- Impact: a webview holding an early claim cannot tell "no history, nothing to filter" from "old host that ignored
  the opt-in". If it treats absence conservatively, it drops or keeps the wrong side of the live content; if
  permissively, it may duplicate.
- Correction: when `params.historyBlockOwners === true` and the maps are absent, send `{}` and `[]`. A one-line
  default in `resumeSession`, or return empty collections from the reader's `!loaded` branch.

### 4. Moderate — pending-anchor housekeeping is O(pending anchors x contexts) on every published event

- File: `chat-stream-delivery-coordinator.service.ts:143-147` calling `live-message-projection.ts:147-152`
  (linear `hasMessage`).
- Ordering: a resync with K deferred anchors (the projection spec builds 300) leaves `pendingAnchors.size === K`
  until each message gets content. Every `publish`, visible deltas included, then runs K scans over up to M contexts.
  This is cost that grows with the session and sits on the hot path (plan: "per event one map lookup").
- Correction: index contexts by `messageId` in the projection (a `Set<string>`), or have `observe` report the
  dropped `messageId`s so the coordinator removes only those. No periodic full sweep.

### 5. Minor — projection suffix ignores the `turn_state` barrier that the hidden tail applies

- File: `live-message-projection.ts:54-67` returns before `suffix.append`, so `turn_state` never reaches the
  coalescer barrier at `stream-delta-coalescer.ts:88-93`. The plan requires the two to "agree exactly"
  (`implementation-plan.md:255-256,269-270`).
- Effect: root deltas before and after a `turn_state` merge into one entry sequenced at the first delta. Seed order
  becomes `[..merged delta.., turn_state]` while the live order was delta, turn_state, delta. Content is complete
  and nothing is lost; ordering fidelity differs only for deltas after an `awaiting-background` or `generating`
  re-emit. Either document the deviation or clear the suffix's last-entry index on `turn_state`.

### 6. Minor — requested-resync state leaks for a never-revealed unknown tab

- File: `chat-stream-delivery-coordinator.service.ts:197-203`. `getState(tabId)` creates a state for an id that has
  never published. If it is not in the viewport it lives until `dispose(tabId)`, which a closed tab may never call.
  Bounded by 128 ids per call but not across calls. Delete the state immediately when it is empty and the tab is
  not requested.

### 7. Minor — surface-mode events are retained into the hidden tail without their flag (pre-existing)

- File: `chat-stream-delivery-coordinator.service.ts:183-184` (`route` to `retain(state, event)`). Replayed in the
  snapshot `events` they look like ordinary chat events. This behaviour predates the batch (`HEAD` `publish`), and
  the batch correctly keeps surface events out of the projection and out of deferred anchors (`:138,:149`). Noted
  because the v2 snapshot is the first place it could surface.

## Verified (no defect found)

- **Reproduction spec.** `chat-stream-delivery-coordinator.ws-switch-resync.spec.ts` is unchanged (assertions at
  `:43-46`). It passes through the coalescer alone: 256 same-block deltas merge into one entry carrying
  `id: delta-255` (`stream-delta-coalescer.ts:67-82`), so no overflow occurs. The overflow-plus-seed path that
  fixes the user's actual scenario is covered by the separate spec at `...service.spec.ts:167-202`. The fix
  addresses the spec; the spec is not bypassed.
- **Sequence.** The counter is coordinator-wide (`:74,:136`) and a recreated state starts from it (`:258`), so it
  never restarts across `publishTerminal` or state deletion (test at `...service.spec.ts:152-165`).
- **Reveal order.** In the synchronous block `:296-322` the snapshot is built, hidden fields cleared, the tab marked
  visible and `send` invoked (`deliver` calls `broadcastMessage` synchronously). A later chunk is buffered on a timer,
  so it goes out after the snapshot. Events published during the flush await are retained and are in the snapshot
  (`...service.spec.ts:272-285`). The generation guard (`:287-290`) works (`:287-300`).
- **`resyncTabIds`.** A visible tab is dropped from `visibleTabIds` so the ordered reveal runs now (`:202-204`). A
  hidden tab keeps the flag until its next reveal. A tab with no state gets an empty-seed resync. `retain` is
  suppressed while the flag is set (`:271`) but `observe` still feeds the projection (`:139`). A terminal that
  arrives in the forced-hidden window is deferred and sent after the snapshot (`:223-225`, `:324-326`).
- **Projection rules.** Open resets `persistedBlocks` to 0 (`:82`). Counting domain is right: `text_delta`,
  `tool_start`, plus `thinking_delta` for root only (`:91-97`). One `blockCounts` entry per context, deferred
  included (`:130`). `awaiting-background` and `sleeping` gate on the Close rule (`:59-65`). Idle, failed and
  compaction clear all contexts. A Task `tool_result` drops the subagent context (`:68-70`). Byte accounting is
  consistent across open, append, truncate, complete and drop (`:81-86,:99-101,:113-118,:177`). The count survives
  truncation. `Object.create(null)` is safe for odd message ids (`:127`).
- **Deferred anchors.** Injected once, immediately before the first seed-content event of that message
  (`service.ts:149-154`), dropped on `message_start` or stream `message_complete` without injection (`:155-160`).
  The projection-drop cleanup (`:143-147`) is correct; only its cost is flagged (Defect 4).
- **Owners.** Keys are indices into the delivered page. `selectHistoryPage` slices, so object identity holds
  (`history-page.utils.ts:139`). A message is kept only when delivered and full counts match
  (`history-block-owners.ts:20-24`). Synthetic marking is exactly the synthesized branch
  (`session-replay.service.ts:418-429`); the persisted-result branch (`:377-387`) is not marked. Subagent replay
  records text and `tool_use` only, no thinking, through `processAgentMessages(…, collector)` (`:366-372,:543-545,:562-564`).
  Nested events keep identity through `push(...nestedEvents)`.
- **Old callers.** The collector is created only on opt-in (`session-history-reader.service.ts:211-213`). The
  replay call keeps its original three arguments when no collector exists (`:470-481`). `readForResume` forwards
  `includeBlockOwners` only when true (`chat-history-read.service.ts:73-77`). The reply spread is gated on
  `=== true` (`chat-session.service.ts:1095`). The legacy reply has no new keys (spec `chat-session-history-page.spec.ts`).
- **Schemas.** `historyBlockOwners: z.literal(true).optional()`, which rejects `false`. `resyncTabIds` is bounded
  to 128, has the duplicate refine, and keeps the schema `.strict()`. The snapshot schema rejects both seed fields
  without `resyncRequired` and permits `liveSeedBlocks` without `liveSeed` (`schemas.ts:238-246`).
- **Non-negotiated peers.** `publish` returns before any projection or sequence work (`:123-133`), so CLI and TUI
  behaviour is unchanged.

## Missing tests

1. Two resync snapshots for the same tab with no event between them (reveal, hide, `resyncTabIds` + reveal): assert
   the second `toSequence` is strictly greater (Defect 1). Include the state-less variant with no publish anywhere.
2. Hide during the snapshot send (use the blocked-transport helper): a hidden event and a `publishTerminal` issued
   after the snapshot has started must survive and be delivered on the next reveal (Defect 2).
3. `chat:resume` with `historyBlockOwners: true` against a missing or empty session: assert
   `historyBlockOwners: {}` and `historySyntheticToolResults: []` (Defect 3).
4. Projection: the stream `tool_start` / `tool_delta` suffix survives to the seed; a `tool_start`-only context counts
   as content; two contexts (root plus subagent) interleave by sequence in the seed. Existing specs only exercise
   text deltas in the seed.
5. Coordinator: a deferred anchor whose context is truncated (byte cap) still injects before the next content event
   and is dropped at stream completion.
6. Many deferred anchors plus many events: a guard that housekeeping cost does not scale with
   anchors x contexts (Defect 4), or at least a test of the replacement index.
7. R-B7 is only covered implicitly by the first coordinator test. Add an explicit assertion that no projection
   state exists before negotiation (for example, a later `resyncTabIds` yields no seed).
8. Owners: a record whose API `message.id` is split across the page boundary where the first half is cut and the
   second half holds a dispatch-tool `tool_start` (the `isAgentDispatchTool` branch). The existing unit uses
   synthetic event objects only.

## Notes

- The five loss/duplicate orderings checked and judged acceptable by plan: a truncated context's partial text
  reappears only with its complete batch (plan component 3, byte cap); a stream that began before negotiation has
  no context and degrades to old behaviour; a background Task `tool_result` drops the subagent context while the
  subagent may keep streaming (a later `message_start` reopens it); a complete batch split across `publish` calls
  can be interleaved with a snapshot (counts reflect the events published so far, which is the specified domain);
  chunks already buffered when a requested resync fires are flushed first and then covered by the seed, which the
  webview must replace rather than append (frontend lane).
- Turn state in the seed: `buildSeed` always includes the latest `turn_state`, even when no context exists
  (`live-message-projection.ts:128`). The state is deleted at idle, so no stale `generating` seed is possible
  unless the host never emits the idle (the broadcaster forces one in the error and finally paths,
  `chat-stream-broadcaster.service.ts:339-344,373+`).
- Lint: B1 reported one error in a B2 file; B2 reports it fixed (`batch-B2-report.md:59`). I could not re-run it.
- The `.some(isSeedContent)` scan in `closeIfComplete` is gated by `streamEnded` first, so it is not per-event cost.
