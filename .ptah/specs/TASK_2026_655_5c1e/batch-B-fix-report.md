# Batch B round 1 fixes

## Defects

1. **Resync sequence:** `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.service.ts:313` assigns every resync snapshot a new global sequence before choosing `fromSequence` and `toSequence`. Empty tails start at that new sequence; later publishes increment from it. Tests: `assigns a fresh sequence to repeated seeded resyncs without new events` and `assigns a fresh sequence to repeated empty visible resyncs` in `chat-stream-delivery-coordinator.service.spec.ts:341,365`. The existing overflow assertion now expects a fresh sequence.
2. **Awaited send races:** `chat-stream-delivery-coordinator.service.ts:235-250` clears visible terminal state only when the viewport generation and visibility still match. `:345-355` deletes reveal state only while visible, when it is still the same state and has no terminal, resync flag, tail, projection or pending anchor. Tests: `keeps hidden tail and terminal received during an awaited reveal send` and `keeps hidden state received during an awaited visible terminal send` in `chat-stream-delivery-coordinator.service.spec.ts:377,412`.
3. **Empty opted-in history:** `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:245-254` returns empty collector maps on a missing read when opted in; `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1095-1107` always serializes empty owner and synthetic-result collections for a successful opted-in resume when the reader omitted them. The non-opted-in reply is unchanged. Tests: `returns empty owner collections for an opted-in missing session` in `session-history-reader.service.spec.ts:235` and `returns empty owner metadata for an opted-in unloaded read` in `chat-session-history-page.spec.ts:139`.
4. **Pending-anchor cost:** `libs/backend/rpc-handlers/src/lib/chat/streaming/live-message-projection.ts:147-151,173-190` reports message IDs only when contexts are actually dropped; `chat-stream-delivery-coordinator.service.ts:144-146` removes only those pending anchors. Ordinary publishes no longer scan all pending anchors and all contexts. Test: `does not scan every pending anchor on an unrelated publish` in `chat-stream-delivery-coordinator.service.spec.ts:448`.
5. **Turn state barrier:** `libs/backend/rpc-handlers/src/lib/chat/streaming/stream-delta-coalescer.ts:117-119` exposes the existing merge barrier; `live-message-projection.ts:56` applies it to open suffixes on `turn_state`, preserving before/turn/after order. Test: `keeps stream deltas on opposite sides of a turn state in seed order` in `live-message-projection.spec.ts:131`.
6. **Unknown hidden resync:** `chat-stream-delivery-coordinator.service.ts:190-211,272-278,307-308` keeps an unknown hidden request as a bounded, pruned ID marker instead of allocating tab state. A later publish or reveal consumes the marker and retains the resync requirement. Test: `keeps no tab state for an unknown hidden resync and honors its later publish` in `chat-stream-delivery-coordinator.service.spec.ts:472`.

Defect 7 is pre-existing and unchanged. `chat-stream-delivery-coordinator.ws-switch-resync.spec.ts` was read but not edited.

## Decisions

- An unknown hidden resync marker is kept through the next reveal or publish. A later viewport that neither shows nor requests that tab prunes the marker, limiting retained unknown IDs to the current request window.
- Projection context drops are queued and drained after each publish. This makes ordinary anchor housekeeping proportional to contexts actually dropped by that event.
- The new tests were written so their stated assertions fail against the reviewed code. They were not run in this lane because the assignment reserves Jest and Nx checks for the orchestrator.

## Open

- Jest, Nx, lint and typecheck were not run, as instructed. Scoped `ptah_get_diagnostics` initially found one TypeScript error in the new sequence test fixture; it was corrected. Subsequent scoped diagnostics requests timed out in the shared compiler service, so the post-correction compiler result is unavailable.
- The orchestrator should run these exact Jest spec files (the last file is the unchanged reproduction spec):
  - `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.service.spec.ts`
  - `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.ws-switch-resync.spec.ts`
  - `libs/backend/rpc-handlers/src/lib/chat/streaming/live-message-projection.spec.ts`
  - `libs/backend/rpc-handlers/src/lib/chat/streaming/stream-delta-coalescer.spec.ts`
  - `libs/backend/rpc-handlers/src/lib/chat/session/chat-session-history-page.spec.ts`
  - `libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts`
