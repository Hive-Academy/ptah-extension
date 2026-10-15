# Code Logic Re-review — Phase C fix — `TASK_2026_678_9083`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Minor issues | 0 |
| Failure modes found | 1 |
| Reviewer family | grok |
| Implementer family | codex |
| Range | `57f5d0940^..57f5d0940` |

The score is 7 because S1, M1, M2, and M3 are closed in code and pinned by specs, and the turn serializer, discarded-clip path, and narrator keys hold on the scenarios those specs drive. An 8 would require the new playback-id queue to stay aligned on every path that already clears `playbackMarks`, including barge-in. A 6 would require a discarded utterance to still transcribe, or a stopped turn to paint `listening` or speak the pre-mute reply. This lane did not re-run Jest or Nx; the implementer report's voice Jest result (7 suites, 40 tests) is used as given and was not treated as proof of the barge-in id path below, which no spec covers.

## Five logic questions

1. Silent success: a discarded utterance now ends in `onClip(null)` (`pcm-capture.ts:124`), and the loop drops null clips (`command-voice-loop.ts:221`). The remaining silent miss is latency bookkeeping: after barge-in, a later reply can record no sample or a stale origin while playback still succeeds (N1).
2. User action: mute, then a new utterance, then the old `onTurnBoundary`, is ignored while the new send has not settled (`command-voice-loop.ts:404-410`, spec `command-voice-loop.spec.ts:282-289`). Barging in on a four-chunk reply, then speaking again, desynchronizes latency marks (N1).
3. Wrong answer: narrator `completed` / `failed` stay distinct from `started` (`status-narrator.ts:53-57`). The wrong answer that remains is a latency sample whose `endedAt` belongs to an older reply (N1).
4. Dependency failure: `coordinator.send` rejection still releases `sendTail` (`command-voice-loop.ts:388-390`) and calls `finishTurn` only when the generation still matches (`command-voice-loop.ts:393-398`). A synth rejection after barge-in removes the pre-barge id and leaves the live mark in place (N1).
5. Unspecified: the page still passes no turn id. That residual is carried, not filed.

## Prior findings

| Id | Status | Evidence |
| --- | --- | --- |
| S1 | CLOSED | Accepted clip stamps `turnGeneration` and clears `awaitingBoundary` (`command-voice-loop.ts:324-326`). Returns skip `finishTurn` after transcribe (`:331`), after the send queue (`:379-381`), and after `coordinator.send` (`:385`). `onTurnBoundary` requires `active`, the same generation, and `awaitingBoundary` (`:404-410`). `finishTurn` returns immediately when `!this.active` (`:458`) and does not write `listening` over `idle` or `stopped` (`:468-471`). Specs: `command-voice-loop.spec.ts:245` (one in-flight send, stale boundary leaves `busy` true, second send runs only after the first settles) and `:295` (send `false` after `stop` does not set `listening`). |
| M1 | CLOSED | Worklet `start` / `end` / `samples` carry an utterance id (`pcm-capture.ts:26-32`, `:44`). `discardUtterance` records the id, advances `utteranceId`, clears chunks, and posts `end` for the discarded id (`:147-153`). The main-thread handler drops samples whose id is not current (`:110-115`) and emits `onClip(null)` when that id is in `discardedIds` (`:123-125`). Spec `pcm-capture.spec.ts:86` posts a 128-sample tail and `end` for the discarded id and expects a single `null` clip (`:154-155`). |
| M2 | CLOSED | `enqueue` assigns a monotonic id, stores it on the mark, and pushes the same id for the synth callback (`command-voice-loop.ts:154-163`). Synth failure removes that id and moves `origin` onto the next mark with the same `replyId` (`:96`, `:142-151`). The sample is pushed only after `play()` resolves, and a rejected `play()` moves the origin instead (`:106-122`). Spec `command-voice-loop.spec.ts:332` fails the first of two identical long sentences and expects one `cold-worker` sample and an empty mark list. |
| M3 | CLOSED | The delivery key uses the spoken action, so `starting` and `running` share `started` while `completed` and `failed` keep their own keys (`status-narrator.ts:53-57`). Spec `status-narrator.spec.ts:43-59` drains "Worker started." once, drains nothing for the later `running` observe, then drains "Worker completed." |

## New findings

### N1 — Moderate — barge-in clears playback marks and leaves synthesis ids queued

- File: `command-voice-loop.ts:82`, `command-voice-loop.ts:96`, `command-voice-loop.ts:102`, `command-voice-loop.ts:154-163`, `command-voice-loop.ts:271-273`; `tts-playback-queue.ts:81-91`, `tts-playback-queue.ts:107-121`; `spoken-text.ts:60`
- Scenario: A reply of four sentences (the spoken cap at `spoken-text.ts:60`; each sentence at least 12 characters becomes its own chunk) calls `enqueue` four times. `pump` starts only two synths, so after those two synchronous `synthesisIds.shift()` calls the queue still holds ids 3 and 4. When the first synth resolves, `pump` starts chunk 3 and shifts id 3, then `playNext` sets `playing`. Id 4 is still queued. The user barges in while that first chunk is audible. `onFrame` calls `bargeIn()` (`stopAll` drops chunk 4, so its synth never runs) and sets `playbackMarks.length = 0`. `mute` and `release` also clear `synthesisIds` (`command-voice-loop.ts:485`, `:515`); this path does not. The next reply enqueues marks 5 (with the new origin) and 6. The next two synth calls shift the orphan id 4 and then id 5. If the first of those synths fails, `removePlaybackMark(4)` finds nothing, because mark 4 was cleared at barge-in, so mark 5 stays at the head. The queue plays the second chunk and the audio factory `shift()`s mark 5. The following one-chunk reply then has the leaked mark in front of its own mark: its successful `play()` shifts the leak (null origin, no sample) and leaves the real origin on the unplayed mark. The reply after that records the previous reply's `endedAt`. Each later four-chunk barge-in adds another orphan; the page-lifetime loop never resets `nextPlaybackId`.
- Fix: In the barge-in block, set `this.synthesisIds.length = 0` in the same place `playbackMarks` is cleared. In-flight synths have already shifted their ids; a late failure then looks up a cleared id and does not touch marks enqueued after barge-in. Add a spec that barges in while a four-chunk reply is playing, fails the next reply's first synth, and expects that reply's origin on the chunk that actually plays and no leftover mark.

## Carried

`onTurnBoundary(assistantText)` still has no turn id (`command-voice-loop.ts:404`). The loop rejects a stale boundary while the replacement turn is transcribing or waiting on `sendTail`, which the S1 spec pins. Once the replacement `send` has returned true, `awaitingBoundary` is set (`command-voice-loop.ts:386`) and a delayed callback from the previous turn has the same shape as the new one. Correlating those two callbacks is Task 14.2 (the page passes a turn token). Page wiring of the loop stays out of scope (D35).

`sendTail` waits across mute and restart until the in-flight `coordinator.send` settles. That is the serialization the fix chose so two sends do not overlap. The `finally` at `command-voice-loop.ts:388-390` resolves the tail on success, on `false`, and on throw. This is not filed.

## Checked and not filed

- `finishTurn`'s `if (!this.active) return` (`command-voice-loop.ts:458`) does not leave `busy` true. The only writers of `active = false` are `mute` and `release`, and both set `busy = false` and increment `generation` before any await (`:479-482`, `:510-512`). `start` increments `generation` only when `!(active && !muted)` (`:174`, `:217`); `muted` is set true only beside `active = false`. An early return after a generation change therefore belongs to a turn whose `busy` flag that path already cleared. A newer turn that has since set `busy` is left alone because the old turn returns without writing `busy`.
- `sendTail` is not stranded by stop, exit, or a thrown `send`. The replacement promise is created before `await priorSend`, the generation-mismatch return resolves it (`:379-381`), and the inner `finally` resolves it if `send` throws. The promises only resolve, so `await priorSend` does not reject.
- Parallel synth (in-flight cap 2) shifts ids at the start of `synthesize`, in `pump` order, before either call awaits the RPC. Playback still waits on `pending[0]`. For a two-chunk reply with no barge-in, failure removes the matching id and the factory shifts the surviving mark. That is the M2 spec, and it still holds.
- A second `beginUtterance` / `end` / `discard` on the worklet port is FIFO: `end` for the id the worklet still holds is posted before a later `start`. The discarded `end` takes the `onClip(null)` branch and does not `finishClip` the next utterance's chunks (`pcm-capture.ts:123-125`).
- `completed` and `failed` do not share the `started` key. The pending filter still drops a not-yet-drained row when `node.state` changes (`status-narrator.ts:39-41`), then the loop enqueues the new action. The M3 spec's completed line is that path.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| M2 stays CLOSED; the barge-in id leak is a new finding | (a) CLOSED plus N1; (b) reopen M2 as PARTIAL | The required M2 behavior is id-keyed removal, origin transfer, and a sample on the first resolved `play()`, pinned without barge-in at `command-voice-loop.spec.ts:332-388`. N1 needs a fourth queued chunk and `onFrame`'s barge-in path | yes |
| A hung `coordinator.send` blocking later sends is not a defect | (a) keep the cross-generation queue; (b) file the wait as a deadlock | Fix report decision: serialize because `mute` can release the coordinator lock while `send` is in flight. Throw and stop both reach `releaseSend` | yes |
| The stop spec's `voiceState()` stub is weak and is not a finding | (a) accept the code plus the assertion; (b) file the stub as an unpinned guard | `command-voice-loop.spec.ts:304` always returns `'stopped'`, so the idle/stopped guard alone would also suppress `listening`. The generation check at `command-voice-loop.ts:385` is present and returns before `finishTurn` | yes |

## Verdict

Verdict: APPROVED
