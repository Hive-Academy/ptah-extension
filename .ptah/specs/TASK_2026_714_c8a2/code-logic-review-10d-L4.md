# Code Logic Review 10d.L4 (Codex peer queue)

Score: 7.5/10. Verdict: APPROVED (0 BLOCKER, 0 MAJOR, 4 MINOR). Read-only review; nothing was run.

Scope: git diff of codex-chat-adapter.ts and codex-chat-turn-stream.ts, plus codex-chat-peer-queue.ts in full. I also read codex-chat-admission.ts, codex-chat-session-controls.ts, the notifier call sites and the frontend queue path.

## Verified correct
- **No concurrent turns.** `startNext` (peer-queue.ts:84) starts nothing while `session.busy` or an `active` entry exists. `onIdle` is called from `release()` (turn-stream.ts:446) after `busy=false`.
  - It is also called from the interrupted/detached drain path (`.finally(release)`), so the queue advances only on the real release.
  - `active` is held until both admission and idle have happened (peer-queue.ts:94-107, `finish`). Admission alone (turn/start receipt) therefore never releases the next message. This is what the original `publishUntilAdmitted` shortcut would have broken.
- **Failed or rejected start.** If `run` rejects before admission, `entry.reject` is called and `finish` advances (peer-queue.ts:99-106). The following entries are not stuck.
- **Order.** FIFO via push/shift. User sends are refused while a peer is pending (adapter.ts:596-597), so a user message cannot jump ahead of a queued peer.
- **Close and dispose.** `dispose` calls `endSession`, which calls `close`, which calls `rejectPending` (adapter.ts:639). Reset, `closeSession` and the turn-failure close path (turn-stream.ts, `deps.close`) all go through `close` too.
  - Each rejected entry gets a coded `unavailable` error and a `logger.error` with a real Error object.
  - A rejected-but-already-running unadmitted `active` entry is unshifted and rejected. Its later `finish` is a no-op because of the `active.get(session) !== entry` guard.
- **Bound.** The cap is 32, counting the active entry, and a full queue returns a coded `busy` with operation `peerQueueFull` (peer-queue.ts:27-28).
- **Notifier honesty.** A queued send resolves at turn/start admission, not at enqueue (peer-queue.ts:97). The notifier's "delivered" log (lane-completion-notifier.service.ts:410-436, 531-548) therefore means "the turn that carries this message has started". That is honest. Rejection (close, blocked) surfaces as `delivery-failed` and is logged.
- **Map hygiene.** Entries are deleted when the queue empties. No leak was found.
- **Peer row.** The queue calls the same `publish` with `inboundPeer`, so the row is emitted when the queued turn starts. Spec adapter.spec.ts:340-376 asserts this.
- **Project rules.** I found no `any`, `as unknown as`, ts-ignore or eslint-disable in the diff. There are no swallowing catches. The logger is injected.

## Findings

### MINOR 1: `admission: 'require-idle'` is not honoured on Codex
- Evidence: `sendMessageToSession` ignores `options.admission` entirely (adapter.ts:~565-600). Claude refuses it at session-stream-pump.service.ts:236-316.
- Impact: a peer-origin send with `require-idle` would now be queued instead of refused. The only current producer is the Claude lifecycle manager (session-lifecycle-manager.ts:872), with a non-peer origin, so there is no live regression.
- Suggestion: in the peer branch, if `options?.admission === 'require-idle'` and (`session.busy` or `hasPending`), throw `busy`. This is cheap and removes a latent contract gap. Add a spec for it.

### MINOR 2: peer entry is lost to a racing non-queue turn
- Evidence: peer-queue.ts:92-96 starts `run` in a microtask after `startNext`. If a user turn (for example a chat:continue resume or first-turn path that does not go through `sendMessageToSession`) takes `busy` in that gap, `turn()` throws `busy` (adapter.ts:540). The entry is rejected with `busy` rather than re-queued, and the lane completion is refused.
- Impact: the window is very narrow, but a refusal is possible. Consider re-queueing at the head when `run` fails with `busy` while `session.busy` is true.

### MINOR 3: `send` refuses when `session.blocked`
- Evidence: peer-queue.ts:23. `blocked` is true transiently during a user Stop (session-controls.ts:111-118). A lane completion arriving in that moment gets `unavailable` and a `delivery-failed` refusal, although the interrupt is accepted and the session continues.
- Also, `onIdle` with `blocked` rejects every queued entry (peer-queue.ts:43), including after a recoverable pending interrupt.
- Impact: this is coded and logged, so it is not silent. It is still a lost completion on a recoverable state.

### MINOR 4: Claude's `source: 'complete'` is not verified
- Evidence: the spec asserts only `inboundPeer.label` (adapter.spec.ts:366-371). I did not confirm that the Codex peer row carries the same `source` marker as Claude. The earlier "renders a delivered lane message" spec (line 308) presumably covers it, but this batch adds nothing to pin it for queued turns.
- Also: the notifier promise stays pending for the whole preceding turn, and I found no timeout or caller-side cancellation. That is acceptable, but it should be known.

## User-typed busy refusal vs Claude
- Claude queues every send in `session.messageQueue` (stream-pump:224-289). Codex keeps the coded `busy` refusal for non-peer sends, which the RPC maps to `CODEX_BUSY` (chat-session.service.ts:942).
- UI impact is low. The frontend does not send while streaming. `MessageDispatchService.sendOrQueueMessage` queues in the tab (`queuedContent`) and flushes after the turn completes via `sendQueuedMessage` (message-dispatch.service.ts:106-263). `busy` is reachable only in a race: the frontend thinks the turn is done and the backend has not yet released, or a queued peer turn starts first. Native Codex also has no steer/queue primitive.
- Severity: MINOR and acceptable. A visible contract difference exists only in that race. The user sees the "Codex chat is busy. Try again" error, and the queued text stays in the tab, so it is not lost. If wanted, a follow-up could queue user sends in the same FIFO.

## Five questions (short)
1. Silent failure: none found. Rejections are logged and coded. Post-admission turn failures are not observable by the notifier, which is inherent.
2. Unexpected user action: Stop at the same moment as a lane completion (MINOR 3).
3. Wrong data: none.
4. Dependency failure: `turn/start` failure rejects that entry and the queue advances. Context close rejects all.
5. Missing: `require-idle` (MINOR 1), a queue-depth metric, and a spec for the blocked and interrupt paths and for a failed `run` followed by the next entry advancing.

## Verdict
APPROVED, 7.5/10. Core correctness (single-turn invariant, FIFO, close, bound, honest resolution) holds on code reading. The specs cover the four requested cases. I have not seen them run, and I was told not to run them. Recommend MINOR 1 and 2 as cheap hardening before merge, but not blocking.
