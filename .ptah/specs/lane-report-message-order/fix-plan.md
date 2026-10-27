# Fix plan: lane reports break the chat message order

Worktree: `D:/projects/ptah-extension/.claude-worktrees/lane-report-message-order`
(branch `fix/lane-report-message-order`). Evidence: `investigation.md` in this folder.

## Verified causes (checked by the coordinator against code on main)

- **H1 (confirmed).** A live peer `message_start` (role `user`, `inboundPeer`) never becomes a
  `tab.messages` entry. `placeFinalizedTrees` (`chat-streaming/.../message-finalization.service.ts:57-125`)
  only anchors on user roots whose id is an EXISTING user message; others are skipped.
- **User hypothesis (confirmed).** `groupTurns` (`chat/.../transcript-turns.ts:85-126`) and
  `draftTurns`/`buildTurnContexts` (`chat/.../utils/turn-facts.utils.ts:153-225`) start a turn only at
  a user message. Without the peer message every reply joins the original prompt's turn.
  `splitTurnMessage` (`chat/.../utils/turn-answer-split.utils.ts:108-110`) puts ALL children of a
  non-last assistant message into the collapsed work log, so only the last reply shows its answer.
  Note `draftTurns` already expects inbound peer user messages ("an inbound peer message does (it
  starts work)").
- **H2 (confirmed).** Real JSONL user records for these turns have NO `origin` field (checked on
  real transcripts: keys are `promptSource:"sdk"`, `turnOrigin:"sdk"`, no origin).
  `HistoryEventFactory.createMessageStart` (`agent-sdk/.../history/history-event-factory.ts:65-83`)
  has no `inboundPeer`. So a reload shows raw envelope XML as a "You" bubble.
- **H3 (confirmed).** `streaming-handler.service.ts:508-519` releases `queuedContent` on any root
  `message_complete` without `stopReason: 'tool_use'`. The user echo `message_complete`
  (`user-message.transformer.ts:155-163`) has no `stopReason`.
- **H4 (confirmed).** `streaming-handler.service.ts:458-469` calls
  `reconcileUserMessageNativeUuid` for every live user `message_start`, peers included.
- **H5 (confirmed, config-dependent).** `sdk-query-options-builder.ts:1471-1473` adds
  `--replay-user-messages` only when file checkpointing is on (default on).

## Shared (done by the coordinator)

`libs/shared/src/lib/utils/lane-envelope.ts`: `parseLaneEnvelope(text)` and
`laneEnvelopePeerLabel(envelope)`, exported from `@ptah-extension/shared`. The label equals the live
`origin.name` (`<cli> · <agent>`, or `session · <agent>` for `cli="ptah-session"`).

## Backend batch (backend-developer)

1. `HistoryEventFactory.createMessageStart`: accept an optional `inboundPeer` and spread it like the
   live transformer does.
2. `SessionReplayService` user branch (`session-replay.service.ts:~180-215`): when the user text
   parses with `parseLaneEnvelope`, pass `{ label: laneEnvelopePeerLabel(envelope) }`. Only root
   user records (no `parent_tool_use_id` / not sidechain). Keep the text unchanged.
3. `sdk-query-options-builder.ts` `buildExtraArgs`: add `replay-user-messages` unconditionally, and
   update the doc comment. Update the specs that expect it to depend on checkpointing.
4. Specs: replay of a JSONL user record with each envelope kind gets `inboundPeer`; plain user text
   does not.

## Frontend batch (frontend-developer)

1. **Peer message in the live transcript (H1).** In `StreamingHandlerService.processEventForTab`,
   live only (`!isReplay`): on a ROOT `message_complete` whose `message_start` (via
   `findMessageStartEvent(state, messageId)`) is role `user` with `inboundPeer`, insert a user
   `ExecutionChatMessage` into the tab's `messages`. Build it with the SAME shape as
   `HistoryMessageBuilder` (`history-message-builder.service.ts:~214-229`): `id: messageId`,
   `role: 'user'`, `rawContent: extractHistoryTextForMessage(state, messageId)`, `sessionId`,
   `timestamp: start.timestamp`, `inboundPeer`. Extract one exported helper and use it in both
   places so live and replay cannot drift.
   - Idempotent by id (a resync live seed can replay the same start).
   - Position: append, EXCEPT when the tail of `messages` (after the last non-user message) holds
     optimistic user bubbles that are not echoed yet (`!nativeUuid` and id not a uuid). The backend
     queue is FIFO, so those prompts are queued behind this peer turn: insert the peer message
     BEFORE the first of them.
   - Workspace-aware write (background tabs receive lane reports too). Do not grow
     `tab-manager.service.ts` with logic; a thin setter is acceptable if no existing method fits.
   - Then `placeFinalizedTrees` anchors the reply on the peer message, and `groupTurns` /
     `buildTurnContexts` start a new turn there. Verify this, do not change their rules.
2. **No uuid stamping by peers (H4).** Skip `reconcileUserMessageNativeUuid` when the
   `message_start` has `inboundPeer`.
3. **Queued release only at the true end of a turn (H3).** In the `message_complete` release gate,
   require that the root message's start role is not `user`.
4. **Compact peer label (Req 1).** In the peer bubble (`message-bubble.component.html:~198-231` and
   its `.ts`), when `rawContent` parses with `parseLaneEnvelope`, render a compact header (agent
   label, `report` or `completed` plus the verdict when present) and the envelope BODY, not the raw
   tags. Keep the unverified-sender caption. Keep the body compact: first line visible, the rest
   behind an accessible expand toggle. Non-envelope peer messages keep today's rendering.
5. **Specs (required).**
   - Live vs replay parity: feed the same event sequence (U1 turn, then 2 lanes × report +
     completion turns) through the live path (processEventForTab + finalize per terminal turn) and
     through `finalizeSessionHistory`; the resulting `messages` (ids, roles, order, inboundPeer,
     rawContent) are equal.
   - Peer turn grouping: `groupTurns` and `buildTurnContexts` over the live result give one turn
     per injected lane message; each reply is `isLastAssistant` of its own turn (so the answer split
     shows it).
   - Queued release: a queued message is NOT released on the peer user echo `message_complete`,
     and IS released on the assistant `message_complete`.
   - No uuid stamping: a peer `message_start` leaves an unstamped optimistic bubble unstamped.
   - Ordering with a prompt queued behind the peer turn.

## Out of scope

- `ptah_session_send` parent → child messages carry no envelope; a reload cannot label them.
- The `chat-layout-declutter` worktree.
