# Code Logic Review — `TASK_2026_453_1eb4` (Batch 5 / Task 5.1, C5 replay render-window fence)

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 8/10                                 |
| Assessment          | APPROVED                             |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 1                                    |
| Failure modes found | 2 (both accepted residuals, not new) |

Scope reviewed: uncommitted diff in
`chat-transcript.component.ts` / `chat-transcript.component.html`, the new
`chat-transcript.replay-mount.spec.ts`, plus the surrounding, unmodified
context needed to prove the transition claims —
`transcript-render-window.ts`, `session-history-replayer.service.ts`,
`message-finalization.service.ts`, `tab-manager.service.ts`
(`applyFinalizedHistory`, `applyResumingSession`), and `session-loader.service.ts`
lines 640-800 (claim/supersession sequencing). `execution-node.component.ts`
and `execution-node.render-throttle.spec.ts` confirmed byte-identical to
Batch 4 (no diff).

## Five logic questions

### 1. How does this fail silently?

No new silent-failure path was found in the reviewed diff. `streamingBoundary`
is a plain derived number with a total fallback (`EMPTY_VIEW_MODEL.streamingBoundary
= 0`, `chat-transcript.component.ts:110`); there is no catch/try, no default
masking an error. The one place a silent divergence *could* have crept in —
`streamingBoundary` reading `motionSuppressed()`/`replayMotionHold()` instead of
raw `historyReplaying()`, extending the render-window fence past the actual
replay and quietly over-mounting or under-mounting content for 300 ms — is
explicitly avoided: `chat-transcript.component.ts:425-427` reads only
`this.historyReplaying()`. Confirmed by the report's grep-style safeguard and
independently by reading the source.

### 2. What user action produces unexpected behaviour?

A user who scrolls up mid-replay before the `IntersectionObserver` has ever
reported a slot as intersecting will see that slot drop to a 120px placeholder
(A7's residual, `implementation-plan.md:549-553`, `transcript-render-window.ts:142-146`).
This is a documented, accepted risk carried forward from the plan (owned by
the M1 scroll-sanity check, not by this batch), not something Task 5.1
introduced — C5 makes the window narrower, so this case is reachable more
often than before C5, but the mechanism itself (unobserved slot → placeholder)
already existed for finalized history before this change.

No other user action was found to produce behaviour outside the documented
contract: opening a second tab while one replays is unaffected (the boundary
is computed per-component-instance from that tab's own `historyReplaying()`
input); scrolling to the bottom during replay only ever grows the visible
tail (`ALWAYS_MOUNTED_TAIL` + `finalizedCount..end` in
`transcript-render-window.ts:118-134`), never removes it.

### 3. What input data produces a wrong answer?

Traced the one input-shape combination that could desynchronize
`streamingBoundary` from the actual mount set: **compaction-targeted reload**
racing a **history replay of the same tab**. `session-loader.service.ts:677-679`
skips the up-front `applyResumingSession` (and therefore the streaming-state
reset) for `opts.reason === 'compaction' && targetTabId`, deferring the reset
to line 746-753 — *after* `chat:resume` resolves, not before. For the ordinary
(non-compaction) resume path this ordering hazard does not exist: `claim()`
(`session-loader.service.ts:657`) is immediately followed, synchronously, by
`applyResumingSession` (`:685-691`), which atomically clears
`streamingState`+`messages` (`tab-manager.service.ts:2107-2128`) before the
`await chat:resume` yields control. Since an older replay can only observe a
newer claim's supersession after its own `await yieldToMacrotask()`
(`session-history-replayer.service.ts:215`) or admission `await` — both real
event-loop yields — the newer claim's synchronous reset has always already
landed by the time the older replay's `finally` clears
`historyReplaying` (`markReplayFinished`, `:237-243`). So for the common path,
by the time `historyReplaying()` flips false on supersession, `streamingState`
is already the fresh empty one and `streamingMessages()` returns `[]`
(`chat-transcript.component.ts:332-334` early return) — no stale
non-finalized tree is ever exposed with `isStreaming=true`. This is the
scenario the task brief specifically asked to rule out, and it is ruled out
by construction, not by luck.

The compaction-target branch does not get this guarantee, since its state
reset happens *after* the RPC await rather than before it. This is pre-existing
Batch 3/4 logic, untouched by this diff, and is out of this batch's scope —
flagged under Moderate issues below for the record, not counted against
Task 5.1's own correctness.

### 4. What happens when a dependency fails?

`IntersectionObserver` absent (jsdom without a polyfill, or a platform that
lacks it): `TranscriptRenderWindow.supported = false` and `isMounted()`
returns `true` unconditionally (`transcript-render-window.ts:142-143`) —
`streamingBoundary`'s value becomes irrelevant to mounting (everything
mounts), matching the documented degradation and AC 4's "no `isAdjusting`"
requirement. `execution-node`'s own `isNodeStreaming` gate is unaffected by
this component either way, and its rAF throttle is proven by the unedited
`execution-node.render-throttle.spec.ts` (per the report; not independently
re-run per the reviewer's "do not run tests" constraint).

A `SessionHistoryReplayer.replay()` throw (chunk processing failure) does not
call `finalizeSessionHistory`, so the failed tab's `streamingState` is not
reset by this path — but `historyReplaying` still clears via the `finally`
(`markReplayFinished` runs unconditionally). The caller's catch branch
(`session-loader.service.ts:791-799`) then calls `applyResumeFailure`, which
clears `streamingState` (per its own spec, `tab-manager.intent-mutators.spec.ts:949-956`).
There is a small window between the `finally`'s flag-clear and the caller's
`applyResumeFailure` where `historyReplaying=false` and the old partial
`streamingState` (populated by the events processed before the throw) is
still live — any non-finalized tree in it would sit past `finalizedCount` and
read `isStreaming=true`. This is a genuine but narrow exposure, inherited from
the replayer's failure-branch design (Batch 3/4), not introduced by C5's
`streamingBoundary` binding — before this diff the same window existed with
`vm().finalizedCount` directly. Recorded as a residual, not a Task 5.1 defect.

### 5. What is missing that the requirements never mentioned?

- No unit coverage in this batch for the compaction-reload-vs-replay race
  analyzed in Q3, nor for the throw-path exposure in Q4. Both are pre-existing
  and out of Task 5.1's file scope, but neither is pinned anywhere in the
  suite as far as this review found; the M1 scroll-sanity check does not
  cover them either since they are not scroll-visible races in the common
  case.
- The spec (`chat-transcript.replay-mount.spec.ts`) proves the two `vm()`
  states (`historyReplaying` true → all-tail; `historyReplaying` false with a
  live tail) but never exercises the exact instant `finalizeSessionHistory`
  fires — it simulates the after-state (`setHistoryReplaying(false)` +
  `setStatus('loaded')` + `setMessages(...)` + `setTrees([])`, four
  independent signal writes at `:347-350`) rather than one atomic write. This
  is an acceptable unit-level simplification (Angular's `TestBed` fixture
  updates all inputs before the next `detectChanges()`), but it does not, by
  itself, prove the atomicity argument this review had to establish by
  reading `applyFinalizedHistory` — a one-line comment in the spec noting
  that the four calls model one atomic production write would have helped
  a future reader trust the test's fidelity without re-deriving it.

## Failure modes

### Compaction-reload race leaves a pre-reset window (pre-existing, out of scope)

- Trigger: a compaction-triggered targeted reload (`opts.reason === 'compaction' && targetTabId`) superseding an in-flight, chunked (>250-event) replay of the same tab.
- Symptom: theoretically, a stale non-finalized tree could render with `isStreaming=true` for one change-detection pass before the deferred `applyResumingSession` at `session-loader.service.ts:746-753` lands.
- Evidence: `session-loader.service.ts:677-679` (no up-front reset) vs `:685-691` (up-front reset in the non-compaction path).
- Current handling: none specific; relies on the general claim-keyed guard, which does not by itself clear stale tree content.
- Recommendation: out of this batch's scope (file not touched, was already this way after Batch 3/4). Worth a follow-up ticket if compaction-triggered reload of a currently-replaying tab is a reachable production path.

### Throw-path window between `finally` flag-clear and `applyResumeFailure`

- Trigger: a chunk throws mid-replay (>250 events).
- Symptom: one change-detection pass could show a non-finalized bubble as `isStreaming=true` after `historyReplaying` already reads false.
- Evidence: `session-history-replayer.service.ts:224-227` (`finally` clears the flag unconditionally) vs `session-loader.service.ts:791-799` (the state reset happens in the caller, after the `await replay(...)` rejects).
- Current handling: none beyond eventual correction by `applyResumeFailure`.
- Recommendation: pre-existing, not a Task 5.1 regression (the same window existed against raw `finalizedCount` before this diff). No fix requested in this review.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- Moderate: the compaction-reload race in Q3/Failure modes above has no
  regression test anywhere in the suite as far as this review found. Not
  this batch's file, but worth flagging so it isn't lost.
- Minor: `TranscriptRenderWindow.syncMessages`'s parameter is still named
  `finalizedCount` (`transcript-render-window.ts:118`) and its doc comment
  ("Ids at or past `finalizedCount` are the tab's streaming messages") is now
  stale for the replay case, where the caller passes `streamingBoundary` and
  no id is ever "at or past" it. File untouched by this batch, but a
  style/clarity nit worth a follow-up rename (`boundary`) — route to
  code-style-reviewer per the instructions, noted here only because it
  touches the semantics this review had to trace.
- Minor: the new spec's last test (`:337-361`) drives the finalize transition
  with four separate synchronous signal writes rather than one, which is
  faithful to Angular's batching model but does not itself demonstrate the
  atomicity this review had to verify by reading production code. A one-line
  comment would close that gap for the next reader.

## Data flow

1. `historyReplaying` input set by `ChatViewComponent` from
   `replayer.isReplaying(tabId)` (Batch 4, unchanged) — OK.
2. `vm()` computed reads `historyReplaying()`, `finalizedFiltered()`,
   `streamingMessages()`; derives `totalCount` and
   `streamingBoundary = historyReplaying() ? totalCount : finalized.length`
   (`chat-transcript.component.ts:419-428`) — OK, single source, no
   intermediate mutable state.
3. Template binds `[isStreaming]="i >= vm().streamingBoundary"`
   (`chat-transcript.component.html:21`) — OK, matches AC 3.
4. Render-window feeding effect passes `view.streamingBoundary` into
   `renderWindow.syncMessages` (`chat-transcript.component.ts:531-534`) — OK,
   single call site, both consumers (`isStreaming` binding and the render
   window) read the identical value from the same frozen `vm()` snapshot per
   change-detection pass, so no cross-consumer divergence within one pass.
5. `finalizeSessionHistory` → `applyFinalizedHistory` writes
   `messages`+`streamingState:null`+`status:'loaded'` atomically
   (`tab-manager.service.ts:1647-1653`) in the same synchronous call as
   `SessionHistoryReplayer.replay()`'s subsequent `closeFence` and
   (in `finally`) `markReplayFinished`, which clears `historyReplaying` — OK,
   verified no `await` sits between the write and the flag-clear, so the next
   `vm()` recomputation sees both changes together, never one without the
   other.
6. Supersession path: newer `claim()` + `applyResumingSession` (synchronous,
   atomic reset) always precedes the older replay's next opportunity to
   observe supersession (which requires an `await`) for the ordinary resume
   path — OK, traced in Q3. Compaction-targeted reload does not carry this
   guarantee — GAP, pre-existing, out of scope (see Failure modes).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| AC 1: `streamingBoundary` field + default + derivation from raw `historyReplaying()` | COMPLETE | none |
| AC 2: feeding effect passes `streamingBoundary` | COMPLETE | none |
| AC 3: template binds `i >= vm().streamingBoundary` | COMPLETE | none |
| AC 4: no `isAdjusting`, `vm().isStreaming`/render-window/scroll/CSS unchanged, no `content-visibility`, file < 700 lines | COMPLETE | none (669 lines) |
| AC 5: spec with local fake `IntersectionObserver`, tail-of-6 during replay, A7 retention, replayed bubbles `isStreaming=false`, live regression guard, post-replay exemption | COMPLETE | see Minor note on the last test's four-write simulation of one atomic write |
| S1-AC4 (DOM reduction during replay) | COMPLETE (mechanism); numeric confirmation deferred to M1 per plan | Batch 6's job, not this batch's |

Implicit requirements not addressed: none found beyond the two pre-existing,
out-of-scope residuals noted above.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Full history replay (no pre-existing finalized messages) | YES | `streamingBoundary=totalCount`, tail-of-6 only | none |
| Replay completes normally, transitions to `loaded` | YES | atomic `applyFinalizedHistory` write, boundary value unchanged across the transition (traced in Data flow #5) | none |
| Live streaming message, not replaying | YES | `streamingBoundary=finalizedCount`, live message(s) exempted by id via `syncMessages`'s second loop | none |
| Replay superseded by a new ordinary resume | YES (by construction) | newer claim's synchronous state reset precedes the older replay's next yield point | none found |
| Replay superseded by a compaction-targeted reload | NO explicit handling | reset deferred until after RPC await | pre-existing, out of scope, no regression test |
| Replay throws mid-chunk | PARTIALLY | flag clears immediately in `finally`; state reset arrives one step later from the caller | pre-existing, out of scope |
| No `IntersectionObserver` | YES | `supported=false` → mount everything | none |
| Slot leaves tail before first observer callback | NO (documented residual) | drops to placeholder, absorbed by `overflow-anchor: auto` | owned by M1 scroll-sanity check per plan |
| A7: slot leaves tail after being reported intersecting | YES | stays mounted (`isMounted` OR's `intersecting`) | none — pinned by the new spec |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none inside this batch's own diff. The one real risk surfaced by
  this review (compaction-targeted reload racing an in-flight replay) lives
  entirely in `session-loader.service.ts`/`session-history-replayer.service.ts`,
  files this batch did not touch and Batches 3-4 already reviewed; it predates
  C5 and is not made worse by it.
- What a robust implementation would add: (1) a regression test pinning the
  compaction-reload-vs-replay ordering so a future refactor of
  `session-loader.service.ts` cannot silently reintroduce the pre-reset
  window; (2) rename `TranscriptRenderWindow.syncMessages`'s `finalizedCount`
  parameter (and refresh its doc comment) now that its caller can hand it a
  replay-time total rather than a true finalized count.
