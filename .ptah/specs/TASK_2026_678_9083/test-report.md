# Test report - TASK_2026_678_9083

## Preimplementation baseline

Status: WAIVED by the user on 2026-10-15 (Decision D34 in `batches.md`).

No values were measured, and none are recorded here. The plan forbids invented numbers
(`implementation-plan.md:60`).

Until Batch 18, code and specs use the plan's fixed scene targets:

- p95 draw time at most 8 ms at N=24 mixed nodes
- sustained frame rate at least 30 FPS

Voice latency marks (cold worker and post-barge-in) are recorded by the voice loop, with no pass/fail bound.

Batch 18 (the Electron Scene and Voice Gate, user-run) takes the baseline and the gate in one session:

- display refresh interval at 1280x720 on an integrated GPU
- the selected provider pair (STT, TTS)
- at least 30 end-of-utterance to first-audio samples, cold worker and post-barge-in reported separately
- the selected-provider p95 bound (measured p95 plus the declared tolerance)
- hardware, date and measurement method

## Automated evidence

The AC numbers below are extracted from the numbered acceptance criteria in `task-description.md:37-61`. "Partial" means the named assertion checks only the stated seam; it is not a claim that every clause of that AC is verified.

| AC | spec file | test name | status |
| --- | --- | --- | --- |
| AC1 | accessibility-list.spec.ts | shows a canvas and a text work list with usable voice and text controls | Partial; Electron guard and real canvas are outside this mocked scene |
| AC2 | session-identity-and-lock.spec.ts | opens the marked chat session and sends text through the existing sender | Partial; chat runtime streaming and MCP execution are outside this seam |
| AC3 | voice-turn-loop.spec.ts | uses the page voice controls and retains the chat session on mute | Partial; real mic and provider selection need B18 |
| AC4 | voice-turn-loop.spec.ts | uses the page voice controls and retains the chat session on mute | Partial; real resource release needs B18 |
| AC5 | `integration/voice-turn-loop.spec.ts`; `voice/vad.spec.ts` | `ignores empty utterances and sends one non-empty transcript through the page`; VAD cases (silence/noise floor, sustained utterance after hangover, short click rejected, sustained onset in playback) | Passed (2026-10-16 Gate 3 run, 5 tests across the two files). Empty and whitespace transcripts create no chat turn; a trimmed non-empty one creates exactly one. Real microphone capture remains B18. |
| AC6 | voice-turn-loop.spec.ts | routes explicit Stop response through chat abort | Partial; ordered playback and barge-in need B18 |
| AC7 | failure-and-fallback.spec.ts | keeps text interaction available when provider configuration fails | Partial; OS microphone denial needs B18 |
| AC8 | failure-and-fallback.spec.ts | keeps text interaction available when provider configuration fails | Partial; settings link and real provider failures need B18 |
| AC9 | `integration/failure-and-fallback.spec.ts` | `shows a safe error for a failed transcription and sends the next voice turn without replaying the first`; `hides a thrown transcription error, creates no turn and leaves text sending available`; `reports a synthesis failure safely, retries only the speech and keeps text turns available`; `hides secret-bearing send errors while leaving text interaction available` | Passed. Transcription failure (reported and thrown) and synthesis failure each stop the voice turn, show a fixed safe message with no secret text, leave the voice loop listening, and allow the next voice or text turn in the same session; Retry speech re-synthesizes only the last reply and sends no chat turn. Audio-element playback failure is covered by `voice/tts-playback-queue.spec.ts`, not at page level. Real provider failures need B18. |
| AC10 | delegation-and-status.spec.ts | sends a delegated command to the owned chat root | Partial; actual tool invocation and spoken acknowledgement need B18 |
| AC11 | delegation-and-status.spec.ts | shows owned child and lane states while excluding unrelated work | Passed for projected child/lane ownership |
| AC12 | `integration/delegation-and-status.spec.ts`; `integration/failure-and-fallback.spec.ts`; `voice/status-narrator.spec.ts` | `narrates an owned CLI lane once when starting and once when completed`; `shows a failed delegated lane in the list, speaks the failure once and keeps the root usable`; narrator unit cases (3) | Passed (2026-10-16 Gate 3 run). Start, completion and failure of an owned lane are each spoken once; a foreign lane is never narrated. Tribunal phase narration is covered only at narrator unit level. |
| AC13 | delegation-and-status.spec.ts | includes the current owned projection in a status turn | Partial; spoken summary needs B18 |
| AC14 | `integration/delegation-and-status.spec.ts` | `renders all seven lifecycle states with identity, type and parent, and keeps terminal nodes inspectable`; `shows owned child and lane states while excluding unrelated work` | Passed for the projection and the text list: queued, starting, running, awaiting input, completed, failed and cancelled each render label, state text, node type (child, CLI agent, SDK agent) and parent edge, and a failed node can be selected and shown. Canvas pixels are not asserted (the scene is a stub in jsdom); drawing needs B18. |
| AC15 | `integration/delegation-and-status.spec.ts`; `components/command-center-projection.source.spec.ts` | `groups a manifest root and monitored lanes under one Tribunal node with a stage`; `binds UUID agents to manifest lanes and advances the lane and run through terminal states` | Passed (2026-10-16 Gate 3 run). One Tribunal group under the root, two lanes under the group, a phase node, a failed lane shown as failed, and the group label rendered in the page. |
| AC16 | session-identity-and-lock.spec.ts | keeps the session identity across page voice exit and a new page open | Partial; app restart and persisted work need B18 |
| AC17 | failure-and-fallback.spec.ts | keeps the text controls and list when canvas is unavailable | Passed for list and controls fallback |
| AC18 | `integration/accessibility-list.spec.ts` | `exposes every voice control as a named, enabled native button and routes each one`; `sends a typed command from the labelled text field using form submit`; `moves between work rows with the arrow keys, selects one with Enter and announces a state change as text`; `shows a canvas and a text work list with usable voice and text controls` | Partial; passed. Start, stop, mute, interrupt and send are native buttons or a labelled form with no negative tabindex, and each routes to its handler; work rows use roving tabindex, ArrowDown moves focus, Enter selects, and a state change reaches a polite live region and the row text (not color alone). Not reachable in jsdom: real Tab order, Enter/Space browser activation, screen-reader output, and the webview navigation entry. Voice state changes show as HUD text but are not in a live region. Manual traversal remains B18. |
| AC19 | failure-and-fallback.spec.ts | hides secret-bearing send errors while leaving text interaction available | Partial; host key-store transport boundary is outside this project |
| AC20 | — | — | Manual B18 performance and latency gate |
| AC21 | `integration/failure-and-fallback.spec.ts` | `shows a failed chat turn as a safe error and lets the same session continue`; `shows a failed delegated lane in the list, speaks the failure once and keeps the root usable`; `hides secret-bearing send errors while leaving text interaction available`; `reports a synthesis failure safely, retries only the speech and keeps text turns available` | Passed. A failed chat turn sets the error state with a fixed safe message and the next text send continues the same session id; a failed delegated lane shows as failed in the list and is spoken once while the root is not marked failed; a failed send and a failed synthesis hide secrets. The only retry action in the product is Retry speech; there is no retry button for a failed delegated agent, so that clause is met by continuing the session only. Real tool-call failures need B18. |
| AC22 | accessibility-list.spec.ts | renders a pending ordinary question as an accessible action | Partial; tool permission and spoken prompt need B18 |
| AC23 | — | — | Manual B18 speaker/headset echo and true barge-in |
| AC24 | `integration/voice-turn-loop.spec.ts`; `voice/spoken-text.spec.ts` | `speaks bounded prose at a turn boundary while keeping the full reply visible`; spoken text unit cases (6) | Passed (2026-10-16 Gate 3 run). Code, diffs and the long tail are not spoken (under 700 characters sent to synthesis) and the full reply stays visible on the page. |
| AC25 | session-identity-and-lock.spec.ts | engages the competing-send lock during voice mode and releases it on mute | Partial; other-surface route-back UI is outside this seam |

Amendment A1 is exercised in `tribunal-confirm-gate.spec.ts`: wrong nonce and non-Decline-first rejection, click-only launch, Decline on exit and timeout, one launch after task and manifest, and no affirmative discovery answer. The test uses the page's timeout handler with fake timers; it does not assert the browser clock invokes the handler at 120 seconds.

## Gate 3 QA run (2026-10-16)

Command: `npx jest -c libs/frontend/command-center/jest.config.ts <specs> --coverage=false --maxWorkers=2`.
The stale "final run failed during TestBed setup" wording on AC5, AC12, AC15 and AC24 is replaced above with
this run's result; those four cases pass. Added 9 tests: AC9 (3), AC14 (1), AC18 (3), AC21 (2). One harness
type was widened in `integration/integration-harness.testing.ts` so a terminal pulse can be an error without
a reply. AC20 and AC23 stay manual (B18).

### Defects found

None. `accessibility-list.spec.ts` logs NG0101 (`ApplicationRef.tick is called recursively`) console noise from
the existing `TestBed.tick()` call in the pending-question test; the test passes and it is not a product defect.

## Manual items for B18

- Real microphone capture and OS permission denial; configured local and ElevenLabs STT/TTS readiness and settings recovery.
- End-of-utterance to first-audio latency, including cold worker and post-barge-in samples; ordered speech, interruption feel, and speaker/headset echo protection.
- Scene FPS and p95 draw time at N=24, control responsiveness, and dark/light visual comparison against `prototype/command-center.html`.
- R4 discovery-turn spawn check and real CLI/child/Tribunal delegation, spoken acknowledgement, pending permission speech, keyboard traversal, app restart resume, and compact spoken content.

The incomplete automated rows above remain open for follow-up. A passing Jest summary does not close them.

### Status (2026-10-16, decision D57): NOT MEASURED - deferred to a user follow-up

The user chose to defer the person-run measurements. None of the values below exist yet; this section does not claim them.

| Item | Status | Evidence so far |
| --- | --- | --- |
| Mic latency, end of utterance to first audio, 30+ samples, cold worker and after barge-in (median, p95) | Not measured | Local TTS synthesis took about 3.5 s before audio started in one observed turn (`visual-review-phase-e-r1.md`, S-B); not a measurement. |
| Barge-in feel | Not measured | Not reached with the looping fake mic (`visual-review-phase-e-r3.md`, "Could not reach"). |
| Speaker vs headset echo protection | Not measured | Needs a person with real audio devices. |
| Scene FPS and p95 draw time at N=24 | Not measured | Headless and CDP numbers do not count (Task 18.1). |
| R4 discovery-turn spawn check (no agent spawns during discovery or after Decline) | Not measured | A real Tribunal Confirm was never clicked in the visual reviews. |
| D34 baseline (refresh rate, provider pair) | Not recorded | Visual reviews used the `Ptah Dev` profile with local STT base.en and local TTS af_heart. |
| Real microphone permission denial and settings recovery | Partly covered | Rejecting `getUserMedia` stub shown in `visual-review-phase-e-r1.md`; real OS denial not tested. |
| Dark and light comparison with `prototype/command-center.html` | Done by the visual reviewer | `visual-review.md`, `visual-review-phase-e-r1.md`, `-r3.md`, `-r6.md`. |
