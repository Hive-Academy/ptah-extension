# Batch 10 report

## Work completed

- **10.1 PCM capture:** `pcm-capture.ts:54` owns one microphone stream and AudioWorklet; `:73` requests echo cancellation, noise suppression and automatic gain control; `:122` takes worklet pre-roll; `:138` encodes bounded PCM as WAV base64 and rejects empty clips; `:185` releases tracks, context, nodes and module URL. `CaptureError` has denied, unavailable and worklet reasons.
- **10.2 Voice loop:** `command-voice-loop.ts:214` uses playback-mode VAD and optional echo rejection for barge-in; `:277` transcribes with a timeout and queues one utterance while a turn is active; `:349` speaks assistant text and drains narration only after the page reports turn completion; `:410` and `:438` release capture and reset meters. `:366` speaks a valid roster summary without answering or confirming it. `retrySpeech` retains the assistant text after speech failure. Latency marks are available through `getLatencyMarks`; D34 waived the baseline, so there is no invented pass/fail bound.
- **10.3 Narration:** `status-narrator.ts:18` derives owned child, lane and Tribunal transitions from projection diffs, revokes stale pending states and deduplicates by root, work ID and state; `:74` drains only at a reported turn boundary. It uses `toSpokenText(..., 'status')` for the 180-character cap. `command-voice-loop.ts:358` is the thin projection integration.

## RPC contracts

- `voice:getProviderConfig` at `libs/shared/src/lib/types/rpc.types.ts:2244` (result DTO at `:3478`) supplies readiness without a key in the renderer.
- `voice:transcribe` at `libs/shared/src/lib/types/rpc.types.ts:2202` (WAV-compatible base64 and MIME fields at `:3317`) uses a 30-second timeout.
- `voice:synthesize` at `libs/shared/src/lib/types/rpc.types.ts:2230` (audio result at `:3400`) uses a 30-second timeout.
- `chat:abort` is reached only through `CommandCenterSessionCoordinator.stop()` after explicit loop Stop, at `libs/frontend/command-center/src/lib/model/session-coordinator.ts:204`.

## Files written

- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/pcm-capture.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/pcm-capture.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/command-voice-loop.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/command-voice-loop.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/status-narrator.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/status-narrator.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/.ptah/specs/TASK_2026_678_9083/reports/batch-10-report.md`

## Specs and checks

- `pcm-capture.spec.ts`: verifies processing constraints, denied classification, single stream and release.
- `command-voice-loop.spec.ts`: verifies unready providers preserve text mode, a pending approval is not answered by voice, playback barge-in, roster voice blocking and VAD-close-to-play latency marks.
- `status-narrator.spec.ts`: verifies deduplication, turn-boundary drain and stale-state revocation.
- The orchestrator owns Jest/Nx execution; this lane ran neither.
- Scoped `ptah_get_diagnostics` found zero errors in the six requested files. It reported seven existing errors in sibling files: five in `tribunal-run-coordinator.spec.ts` and two in `capability-id-codec.ts`.
- Prettier check: `All matched files use Prettier code style!`

## Degradation audit

- `pcm-capture.ts:83` rethrows as a typed `CaptureError`; `:116` tears down and rethrows as `CaptureError`.
- `command-voice-loop.ts:86` rethrows synthesis failure after removing its pending playback mark. `:146` reports provider failure through a safe settings toast; `:191` reports capture failure through a safe permission toast; `:336` reports transcription/turn failure through a safe text toast. Each reporting catch carries the required marker.
- No `.catch(...)` sites were added in non-spec code.

## Needed changes outside the batch

- The Command Center page must instantiate `CommandVoiceLoop`, call `start/mute/stop/exit` from its controls, pass `onTurnBoundary(assistantText)` only after assistant streaming and tool calls settle, call `onProjection(rootId)` on owned projection changes, and call `onPendingPrompt`/`onRosterProposal` from its existing prompt card flow. It must call `onRosterResolved()` on confirm, decline, timeout and page exit (Task 14.2). It must pass an `answerOrdinaryQuestion` callback with the full AskUserQuestion key and enforce the existing Tribunal confirm gate. The current `CommandCenterStore.pendingInput` projection has no question key, so the loop cannot safely answer ordinary questions without this page callback. This change belongs in the page/integration file and was not made because only six voice files were assigned.
- The page may supply an audio correlation callback (`isIndependentSpeech`) to reject residual echo. The default uses browser echo cancellation and sustained playback-mode VAD so real barge-in works without a callback.

## Decisions

| Decision                                                                    | Options                                                   | Evidence                                                                                                                  | Reversible |
| --------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Keep capture and loop as page-owned classes with injected browser/RPC seams | Page-owned instance; root service                         | Coordinator is page-scoped (`session-coordinator.ts:17-18`); task assigns only six new files                              | Yes        |
| Use provider config readiness flags; never inspect keys                     | Main config RPC; renderer key lookup                      | `VoiceProviderConfigDto` at `rpc.types.ts:3478`; AC8                                                                      | Yes        |
| Require a page callback for ordinary question answers                       | Guess a key from display text; use page's full prompt key | Store pending input at `command-center.store.ts:38-43` has no question key; Amendment A1 bars Tribunal voice confirmation | Yes        |
| Record cold-worker and post-barge-in marks without a threshold              | Invent a threshold; defer judgment to B18                 | D34 in `batches.md:145` waived B0 and forbids invented numbers                                                            | Yes        |

## Orchestrator fix round

- **Default barge-in:** `command-voice-loop.ts:24-26,214-274` now treats sustained playback-mode VAD onset as speech after browser AEC by default. The optional callback can reject echo. A short candidate is discarded without stopping playback. `command-voice-loop.spec.ts:34-59` checks default onset, callback rejection and short-burst behavior.
- **Latency marks:** `command-voice-loop.ts:30-61,99-107,261-266,349-388` records utterance close time and one mark when the first reply clip's `play()` resolves. Labels are cold-worker, post-barge-in and warm. `command-voice-loop.spec.ts:155` checks one close-to-play mark per reply with an injected clock and all three labels. No pass/fail threshold was added.
- **Tribunal roster gate:** `command-voice-loop.ts:307-315,366-373` blocks both ordinary question answers and coordinator sends while a valid roster card is pending; `onRosterResolved()` reopens ordinary questions. `command-voice-loop.spec.ts:117` checks that a confirmation transcript reaches neither path until resolution.

## Not completed

- Page integration and real speaker/headset echo verification require changes or manual validation outside the assigned six source files.
- Jest/Nx was intentionally not run in this lane; the orchestrator runs the scoped command.
