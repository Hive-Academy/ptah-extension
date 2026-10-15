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
| AC5 | `integration/voice-turn-loop.spec.ts`; `voice/vad.spec.ts` | `ignores empty utterances and sends one non-empty transcript through the page`; VAD unit cases | Integration case passed in the second run; final run failed during TestBed setup. Real microphone capture remains B18. |
| AC6 | voice-turn-loop.spec.ts | routes explicit Stop response through chat abort | Partial; ordered playback and barge-in need B18 |
| AC7 | failure-and-fallback.spec.ts | keeps text interaction available when provider configuration fails | Partial; OS microphone denial needs B18 |
| AC8 | failure-and-fallback.spec.ts | keeps text interaction available when provider configuration fails | Partial; settings link and real provider failures need B18 |
| AC9 | failure-and-fallback.spec.ts | hides secret-bearing send errors while leaving text interaction available | Partial; speech failure and retry are not asserted here |
| AC10 | delegation-and-status.spec.ts | sends a delegated command to the owned chat root | Partial; actual tool invocation and spoken acknowledgement need B18 |
| AC11 | delegation-and-status.spec.ts | shows owned child and lane states while excluding unrelated work | Passed for projected child/lane ownership |
| AC12 | `integration/delegation-and-status.spec.ts`; `voice/status-narrator.spec.ts` | `narrates an owned CLI lane once when starting and once when completed`; narrator unit cases | Integration case passed in the second run; final run failed during TestBed setup. |
| AC13 | delegation-and-status.spec.ts | includes the current owned projection in a status turn | Partial; spoken summary needs B18 |
| AC14 | delegation-and-status.spec.ts | shows owned child and lane states while excluding unrelated work | Partial; all lifecycle states and canvas rendering are not asserted |
| AC15 | `integration/delegation-and-status.spec.ts`; `components/command-center-projection.source.spec.ts` | `groups a manifest root and monitored lanes under one Tribunal node with a stage`; `binds UUID agents to manifest lanes and advances the lane and run through terminal states` | New integration assertion was corrected after the second run; final run failed during TestBed setup, so this case is unverified. |
| AC16 | session-identity-and-lock.spec.ts | keeps the session identity across page voice exit and a new page open | Partial; app restart and persisted work need B18 |
| AC17 | failure-and-fallback.spec.ts | keeps the text controls and list when canvas is unavailable | Passed for list and controls fallback |
| AC18 | accessibility-list.spec.ts | shows a canvas and a text work list with usable voice and text controls | Partial; keyboard navigation and live announcements need B18 |
| AC19 | failure-and-fallback.spec.ts | hides secret-bearing send errors while leaving text interaction available | Partial; host key-store transport boundary is outside this project |
| AC20 | — | — | Manual B18 performance and latency gate |
| AC21 | failure-and-fallback.spec.ts | hides secret-bearing send errors while leaving text interaction available | Partial; delegated agent failure/retry is not asserted |
| AC22 | accessibility-list.spec.ts | renders a pending ordinary question as an accessible action | Partial; tool permission and spoken prompt need B18 |
| AC23 | — | — | Manual B18 speaker/headset echo and true barge-in |
| AC24 | `integration/voice-turn-loop.spec.ts`; `voice/spoken-text.spec.ts` | `speaks bounded prose at a turn boundary while keeping the full reply visible`; spoken text unit cases | Integration case passed in the second run; final run failed during TestBed setup. |
| AC25 | session-identity-and-lock.spec.ts | engages the competing-send lock during voice mode and releases it on mute | Partial; other-surface route-back UI is outside this seam |

Amendment A1 is exercised in `tribunal-confirm-gate.spec.ts`: wrong nonce and non-Decline-first rejection, click-only launch, Decline on exit and timeout, one launch after task and manifest, and no affirmative discovery answer. The test uses the page's timeout handler with fake timers; it does not assert the browser clock invokes the handler at 120 seconds.

## Manual items for B18

- Real microphone capture and OS permission denial; configured local and ElevenLabs STT/TTS readiness and settings recovery.
- End-of-utterance to first-audio latency, including cold worker and post-barge-in samples; ordered speech, interruption feel, and speaker/headset echo protection.
- Scene FPS and p95 draw time at N=24, control responsiveness, and dark/light visual comparison against `prototype/command-center.html`.
- R4 discovery-turn spawn check and real CLI/child/Tribunal delegation, spoken acknowledgement, pending permission speech, keyboard traversal, app restart resume, and compact spoken content.

The incomplete automated rows above remain open for follow-up. A passing Jest summary does not close them.
