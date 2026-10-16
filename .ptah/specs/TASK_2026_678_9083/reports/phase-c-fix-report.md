# Phase C voice fix report

## Findings

| Finding | Change                                                                                                                                                                                                                                                                                                        | Regression case                                                                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1      | `command-voice-loop.ts:324, 372-411, 457-475`: stamp a turn generation at clip acceptance; serialize `coordinator.send`; check generation after transcription, send wait, and send; accept boundaries only for an active turn awaiting its boundary; leave inactive and stopped states alone in `finishTurn`. | `command-voice-loop.spec.ts:245` “serializes send across mute and restart and ignores the old turn boundary”; `:295` “does not restore listening when send fails after stop” |
| M1      | `pcm-capture.ts:24-44, 62-63, 105-125, 136-154`: tag worklet samples and end events with utterance IDs, advance the ID on discard, reject the discarded tail, and emit `onClip(null)`.                                                                                                                        | `pcm-capture.spec.ts:86` “ignores tail samples from a discarded utterance and emits a null clip”                                                                             |
| M2      | `command-voice-loop.ts:37-41, 55-61, 82-119, 142-165, 443-451`: use IDs assigned by the loop's enqueue wrapper to match synthesis failures to marks; move the origin to the next unplayed mark in the same reply; sample latency when `play()` resolves.                                                      | `command-voice-loop.spec.ts:332` “keeps the latency origin when the first of two identical chunks fails”                                                                     |
| M3      | `status-narrator.ts:53-57`: use the spoken action in the delivery key, so starting and running share one start key while completed and failed retain distinct keys.                                                                                                                                           | `status-narrator.spec.ts:43` “speaks started once across starting and running boundaries, then completes”                                                                    |

## Existing expectations

No existing spec expectations were changed. Five regression cases were added (two for S1). No Jest or Nx command was run in this lane, per the verification rule.

## Verification

Prettier write and check ran on the six changed voice files only. Final check output: `Checking formatting... All matched files use Prettier code style!`

Scoped `ptah_get_diagnostics`: no errors in the six requested files. It reported seven errors in sibling files: five in `tribunal-run-coordinator.spec.ts` and two BigInt target errors in `capability-id-codec.ts`. Those files are outside this lane's scope.

## Degradation audit

- `command-voice-loop.ts:95` synthesis catch: rethrows after removing the ID-specific mark.
- `command-voice-loop.ts:109` playback catch: rethrows after moving the latency origin.
- `command-voice-loop.ts:391` turn catch: first body line is `// degradation-audit: reported — ...`; a safe voice error toast is shown only for the current generation. Its marker was already present.
- No catch in `pcm-capture.ts` or `status-narrator.ts` was changed.

## Decisions

| Decision                                                                            | Options                                                       | Evidence                                                                                                                       | Reversible |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| Keep the playback queue file untouched and assign IDs in the loop's enqueue wrapper | Change queue API; add a scoped wrapper                        | `tts-playback-queue.ts` is outside the allowed files; the queue calls synthesis in enqueue order and plays in submission order | Yes        |
| Serialize send promises across generation changes                                   | Allow a new send immediately; wait for the old send to settle | `coordinator.mute()` can release its own lock while an earlier `send` is still in flight; S1 requires no overlap               | Yes        |
| Emit one null clip for a discarded end                                              | Suppress the callback; emit null                              | The review explicitly requires `onClip(null)` and the loop already ignores null clips                                          | Yes        |

## Anything not done

The orchestrator owns broader scoped verification outside this lane.

## Correction round

- S1 failure cause: the spec resumed only one microtask before asserting the first `send`. `onClip` awaits transcription and then an already resolved send gate, so the assertion ran before `send` was called. The fixture now waits one event loop turn at `command-voice-loop.spec.ts:276`, retaining the exact send count, busy state, stale boundary, and serialization assertions. Production S1 behavior did not need a change.
- M2 failure cause: `Echo. Echo.` was shorter than `SentenceChunker`'s 12 character minimum per sentence, yielding a single chunk. The fixture at `command-voice-loop.spec.ts:380` now uses two identical sentences of sufficient length, so the first synthesis fails and the second chunk plays with the transferred origin. The latency and mark count assertions remain intact. Production M2 behavior did not need a change.
- Jest: `Test Suites: 7 passed, 7 total`; `Tests: 40 passed, 40 total` from the permitted voice command.
- ESLint: `npx eslint libs/frontend/command-center/src/lib/voice` exited 0 with no output.
- Prettier: write followed by check on the changed spec and this report; final check output: `Checking formatting... All matched files use Prettier code style!`

## Carried to Task 14.2

The page's `onTurnBoundary(assistantText)` callback carries no turn ID. The loop rejects a stale boundary while the replacement turn is transcribing or waiting to send, as pinned by the S1 case. Once a replacement send has settled, a delayed old callback and the new callback have the same observable shape. Full correlation requires the page to pass a turn identity or otherwise enforce callback ordering; that caller contract is outside the allowed files.
