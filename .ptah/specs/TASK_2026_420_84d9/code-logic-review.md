# Code Logic Review — `TASK_2026_420_84d9` (RE-REVIEW, round 3)

Scope: full STAGED diff, 10 files, worktree
`D:/projects/ptah-extension/.claude-worktrees/task-420-mid-turn-bubble-split`
(`git diff --cached`). This is the third pass: round 2 found S1/S2/M1/M2, round 2's
revision was rejected by team-leader for R1, and this pass re-verifies R1's fix and
hunts for anything the R1 revision itself introduced.

## Previous findings — status

| ID | Round 2 finding | This pass |
| --- | --- | --- |
| S1 | Failed queue-flush leaves an orphaned bubble + false boundary, duplicates on retry | FIXED — verified in `message-sender.service.ts:643-737`, both failure exits roll back, queue flush drops the bubble too. New gap found in the same mechanism, see S3 below. |
| S2 | Real SDK user-echo root becomes a ghost empty assistant bubble | FIXED — `execution-tree-builder.service.ts:339-347` skips user roots entirely; `buildTree` never emits one. Verified against the event schema (`message_start.id` is a fresh event id, `messageId` is the SDK uuid) — the node/message id chain is internally consistent. |
| M1 | No spec exercises boundary + real echo together | FIXED — `message-finalization.service.spec.ts:390-427`, `execution-tree-builder.service.spec.ts` (boundary+echo real-accumulator test per `implementation-notes.md`). |
| M2 | Rewind while a boundary is live is untested | Unchanged, still a documented note only — accepted per round 2 disposition, not re-litigated. |
| R1 | `nativeUuid` anchor misplaces a reply after a failed direct send (stamped on the oldest unstamped bubble) | FIXED — `placeFinalizedTrees` (`message-finalization.service.ts:48-91`) anchors a user root ONLY when its `messageId` equals an existing user message's `id`; the echo is never an anchor. Regression spec `appends the reply after its own prompt when the echo uuid was stamped on an older failed bubble (R1)` (`message-finalization.service.spec.ts:471-528`) passes and correctly reproduces `main`'s plain-append order. |

## Five logic questions

### 1. How does this fail silently?

- **New, S3**: a queue-flush failure force-removes the optimistic bubble from
  `tab.messages` (`message-sender.service.ts:719-737`, `rollBackUnsentPrompt`)
  unconditionally, with no check for whether `finalizeCurrentMessage` already
  consumed that bubble as a split anchor and persisted the turn around it. If the
  live turn this flush interrupted finalizes (on its own, later stream events)
  before the failing RPC's promise settles, the bubble is already gone from the
  "live" state (boundary removal correctly no-ops — verified,
  `streaming-handler.service.spec.ts:624-632`) but is NOT gone from
  `tab.messages`, where it now sits as a real row inside an already-committed
  split. The rollback still deletes it there, silently dropping a
  user-visible, already-persisted message from the transcript while the "before"
  and "after" assistant content on either side of it survives untouched. See
  Serious-3.
- Round-2's already-fixed silent paths (S1/S2) stay fixed; no new silent failure
  found on the ordinary happy or failure paths.

### 2. What user action produces unexpected behaviour?

- Sending a follow-up mid-turn whose `chat:continue` RPC is slow to fail (auth
  hiccup, backend under load, timeout) while the interrupted turn keeps
  generating and reaches its own real end before the RPC settles: the user's
  message visibly appears, gets spliced into the transcript as a legitimate
  split point, then disappears once the (now stale) failure handler runs — and
  the text silently reappears later, out of place, at the end of the queue's
  next successful flush. See S3.
- Sending two follow-ups mid-turn back-to-back (both delivered) is
  correct by hand-trace (verified below) but has zero spec coverage — a
  regression here would not be caught. See Moderate-1.

### 3. What input data produces a wrong answer?

- None beyond S3. `placeFinalizedTrees`'s id-only anchor (`message-finalization.service.ts:57-58`)
  was traced against: single boundary, boundary+echo, echo-with-no-boundary
  (plain append), and the R1 stamped-on-stale-bubble case — all correct, all
  test-pinned except the two-boundary case (Moderate-1).

### 4. What happens when a dependency fails?

- `chat:continue` rejecting or throwing after the boundary write is handled
  for the "state still live" case (verified) but not for the "state already
  replaced by a finalization that ran while the RPC was in flight" case — S3.
- Compaction/event-cap dropping the boundary: unchanged from round 2,
  accepted/documented, not re-litigated here.

### 5. What is missing that the requirements never mentioned?

- A guard on `rollBackUnsentPrompt`'s bubble-drop path confirming the message
  it is about to delete is still the tab's OWN unfinalized optimistic bubble
  (e.g. checking it is not already referenced by a persisted
  `streamingState` node, or diffing whether `tab.streamingState` is still the
  same object the boundary was written into) before mutating `tab.messages`.
- A regression spec for two prompts sent mid-turn in the same live tree
  (Moderate-1) — the code is correct by trace, but nothing pins it.

## Failure modes

### S3 — Queue-flush rollback deletes an already-finalized message when the underlying turn settles before the RPC failure is observed

- Trigger: user sends prompt A while turn T is streaming. The premature-flush
  mechanism (accepted out of scope, `context.md` root cause step 1-2) dispatches
  `chat:continue` for A early — right after T's first streamed message, not at
  T's real end. T keeps streaming. Two things now race: (a) T reaches its own
  real terminal event and `finalizeCurrentMessage` runs, splicing A's bubble in
  as the anchor and calling `applyFinalizedTurn` (`message-finalization.service.ts:242-245`);
  (b) the `chat:continue` promise for A eventually rejects or throws.
- Symptom: if (a) happens before (b) resolves back into `runContinueConversation`'s
  `catch`/rejection branch, `rollBackUnsentPrompt` (`message-sender.service.ts:719-737`)
  still runs and calls `this.tabManager.setMessages(tabId, tab.messages.filter(m => m.id !== messageId))`
  against the CURRENT `tab.messages` — which by now is the finalized array
  containing A's bubble as a real split anchor with assistant content already
  placed before and after it. The filter removes A's row from that finalized
  array. The visible result: A's message vanishes from the middle of an
  otherwise-intact assistant reply, with no error, no notice, and the queued
  text is silently put back for a later retry that will append a duplicate
  reply at the END of the transcript, disconnected from where the turn was
  actually split.
- Evidence: `message-sender.service.ts:697-712` (the `catch` branch calls
  `rollBackUnsentPrompt(activeTabId, sentPromptId, dropBubbleOnFailure)`
  unconditionally, no check against `tab.streamingState` or a "still live"
  flag), `message-sender.service.ts:719-737` (`rollBackUnsentPrompt` reads
  `tab.messages` fresh via `findTabByIdAcrossWorkspaces` and filters
  unconditionally), `message-finalization.service.ts:242-245`
  (`applyFinalizedTurn` overwrites `tab.messages` with the spliced array,
  independent of any in-flight `chat:continue`). The developer's own
  `implementation-notes.md` (S1 section, last paragraph) states: "If the turn
  finalizes before the RPC fails, the state has already been replaced. The
  boundary removal is then a no-op. **On the queue path the bubble is still
  removed.**" — this is exactly the unguarded deletion, acknowledged but not
  fixed.
- Current handling: none — the boundary removal correctly no-ops against a
  replaced state (verified, `streaming-handler.service.spec.ts:624-632`), but
  the bubble removal in `message-sender.service.ts` has no equivalent guard and
  operates on `tab.messages` regardless of whether finalization already
  consumed the message.
- Recommendation: before deleting on the queue-flush failure path, check
  whether the bubble is still present in the tab's LIVE (unfinalized) state —
  e.g. only drop it when `tab.streamingState` is the same object reference
  captured at send time and still holds the boundary, or when the bubble id is
  absent from any finalized tree node built from the current `tab.messages`.
  Otherwise treat the failure as "too late to unwind" and skip the bubble
  removal (leave both the bubble and the requeued retry — a visible duplicate
  is a much smaller defect than a silently vanished message).

## Blocking issues

None. S3 requires an async interleaving (a slow/failing `chat:continue` racing
the interrupted turn's own natural end) rather than firing on the ordinary
happy or failure path, and it degrades the transcript (a message disappears,
a duplicate appears later) rather than crashing or corrupting the array
structurally.

## Serious issues

### S3 — Queue-flush rollback can delete an already-persisted message (see Failure modes above)

- File: `libs/frontend/chat/src/lib/services/message-sender.service.ts:697-712,719-737`
- Scenario: mid-turn `chat:continue` fails (or times out) after the underlying
  interrupted turn has already reached its own natural end and finalized
  around the boundary this call wrote.
- Impact: the user's own message silently disappears from a transcript that
  otherwise looks complete and correct; the text is requeued and later
  reappears out of order as an unexplained duplicate. This undermines the
  same guarantee S1 was fixed to protect (no orphaned/duplicated mid-turn
  prompt) — S1 covers the case where the RPC fails before the turn settles;
  this covers the case where it settles after.
- Fix: guard the bubble-drop branch of `rollBackUnsentPrompt` against a
  state that has already been finalized/replaced, per the recommendation
  above.

## Moderate and minor issues

- **Moderate-1 — Two prompts sent mid-turn (two boundaries in one live state) has no regression spec.**
  Hand-traced through `placeFinalizedTrees` (`message-finalization.service.ts:48-91`):
  for `existing = [msg0, promptA, promptB]` and roots
  `[before, boundaryA, mid, boundaryB, after]`, the result is
  `[msg0, before, promptA, mid, promptB, after]` — correct, `firstAnchor` stays
  pinned to the FIRST anchor (`??=`) and the per-message placement loop
  handles the rest generically. No spec constructs this two-boundary case (only
  single-boundary and boundary+echo scenarios exist in
  `message-finalization.service.spec.ts`), so a future change to the anchor
  loop could regress it silently. Carried over from round 2's "M1-adjacent"
  note; still open.
- **Minor — `chat-transcript.component.ts` needed no change and none was made.**
  Verified: `streamingMessages` (`chat-transcript.component.ts:307-330`) maps
  `buildTree`'s output directly to `role: 'assistant'` bubbles; since
  `buildTree` no longer emits user roots at all (S2 fix), this component
  automatically stopped rendering the ghost bubble with no edit required.
  `transcriptOrderKey`/`mergeByTime` (`chat-transcript.component.ts:50-87`)
  key off `streamingState.startTime` for assistant nodes and the bubble's own
  `timestamp` for user messages — both still monotonic under the boundary
  mechanism, no reordering found. This is a confirmation, not a defect.
- **M2 (round 2, rewind while a boundary is live)**: unchanged, still accepted
  as a note per the existing disposition. Not re-scored.

## Data flow

1. User sends prompt A while turn T streams → `queueOrAppendMessage`, no
   bubble/boundary yet — OK.
2. T's root `message_complete` (premature per the accepted out-of-scope
   trigger) fires the flush → `continueExistingSessionForQueueFlush` →
   `runContinueConversation`: bubble appended, `recordUserPromptBoundary`
   called, `sentPromptId` set — OK.
3a. Happy path: `chat:continue` resolves success before T's real end → nothing
    rolls back — OK, matches S1 disposition.
3b. Failure-before-settle path: `chat:continue` rejects/throws while T is
    still live (`state.currentMessageId` still set to T's message) →
    `rollBackUnsentPrompt` removes the boundary (real no-op-safe) and the
    bubble from the still-pre-finalization `tab.messages` — OK, this is what
    S1's specs pin.
3c. Failure-after-settle path (NEW): T reaches its own real end before the
    rejected/thrown `chat:continue` is handled → `finalizeCurrentMessage`
    splices A's bubble into `tab.messages` as a real anchor and calls
    `applyFinalizedTurn` → THEN `rollBackUnsentPrompt` runs against the now
    stale reference and deletes A's row from the persisted array — gap (S3).
4. `placeFinalizedTrees` walks `state.messageEventIds`, anchors a user root
   only on an existing user message `id` (R1 fix) — OK, verified against
   single-boundary, boundary+echo, echo-only, and the R1 stale-stamp
   scenarios; not verified for concurrent multi-boundary (Moderate-1).
5. `ExecutionTreeBuilderService.buildTreeWithIndexes` omits every user root
   from `nodeByRoot`/`ownerByRootIndex`/`reusedRoots` but keeps them in
   `rootOrder`/`digestByRoot`, so inserting/removing a boundary still forces a
   rebuild via the whole-tree reuse check — OK, verified by code read.
6. `chat-transcript.component.ts` renders `buildTree`'s (now user-root-free)
   output as assistant bubbles and merges by time with the finalized array —
   OK, no regression found.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Live bubble splits at the user's message while streaming | COMPLETE (happy path) | S3 only affects the specific RPC-failure-after-settle race, not the ordinary split. |
| A failed mid-turn send does not corrupt the transcript | PARTIAL | Fixed for failure-before-settle (S1); not fixed for failure-after-settle (S3). |
| A normal (non-mid-turn) send after an earlier failed send is not misplaced | COMPLETE | R1 fix verified, regression spec passes. |
| Multiple mid-turn prompts split correctly | COMPLETE (by inspection) | No regression spec (Moderate-1). |

Implicit requirements not addressed: a queue-flush failure that arrives after
its interrupted turn has already finalized must not delete an already-persisted
message (S3).

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Queue-flush RPC fails while the turn is still live | YES | boundary + bubble both rolled back, pinned by 4 specs | none |
| Queue-flush RPC fails AFTER the turn has already finalized | NO | bubble deleted from the now-persisted array unconditionally | S3 |
| Direct-send RPC fails | YES | boundary rolled back, bubble intentionally kept (`dropBubbleOnFailure=false`) | none |
| Failed direct send, then a normal retry succeeds (R1) | YES | anchor by `id` only; echo never anchors via stale `nativeUuid` | none, regression spec passes |
| Boundary + real SDK echo in one state | YES | echo skipped at placement (not an anchor); tree never builds a node for either | none |
| Two boundaries (two mid-turn prompts) in one state | YES (by inspection) | generic per-root placement loop | no spec (Moderate-1) |
| Compaction/cap eviction drops the boundary | ACCEPTED (pre-existing) | documented | out of scope, unchanged |
| Rewind while a boundary is live (M2) | UNKNOWN | unchanged from round 2 | out of scope for this pass |

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM — S3 is traced through concrete code paths
  (`message-sender.service.ts`, `message-finalization.service.ts`) and is
  explicitly acknowledged (not contradicted) by the implementer's own notes,
  but it depends on an async interleaving that was not reproduced against a
  running app and has no counterexample test either way.
- Top risk: the fix that closed S1 (drop the bubble on queue-flush failure so a
  retry doesn't duplicate) reaches back into `tab.messages` without checking
  whether that array has moved on since the bubble was written — the same
  category of bug S1 fixed (an unconditional mutation with no regard for
  concurrent state changes), recurring one step later in the same code path.
- What a robust implementation would add: (1) a liveness/ownership check in
  `rollBackUnsentPrompt` before deleting the bubble on the queue-flush path,
  so a late failure cannot unwind a message finalization already committed;
  (2) a regression spec reproducing S3 (turn finalizes, THEN the flush's RPC
  rejects) asserting the persisted message survives; (3) a two-boundary
  regression spec for `placeFinalizedTrees` (Moderate-1).
