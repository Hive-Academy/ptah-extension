# Phase E round 1b — state lane

## Findings

- **F-1:** `components/command-center-turn-status.ts:8` derives the displayed status from the marked root tab. Streaming, awaiting-background, and sleeping display `running`; a non-streaming tab displays `idle` when the stored value is stale `running`. The pulse and streaming-edge settlers at `:58-89` retain `running` during background work. `model/session-coordinator.ts:95,130` resumes idle tabs as `idle`. The header, orchestration dock, and session controls use the derived value at `components/command-center-page.component.ts:141,185,315`. Specs in `components/command-center-page.controller.spec.ts:465,485` cover restreaming without send and background work; `model/session-coordinator.spec.ts:134` covers idle resume.
- **F-3:** `components/command-center-page.controller.ts:314,619` uses the page-exit roster teardown on marked-tab changes, including the pending proposal, expected request, roster timer, handled question ID, and Tribunal coordinator/transport state. `components/command-center-page.controller.spec.ts:1472` covers Start new with a pending card and confirms the old card cannot be confirmed afterward.
- **F-4:** `model/voice-provider-summary.ts:35-38` shows `No voice chosen` for an empty ElevenLabs TTS voice ID. `model/voice-provider-summary.spec.ts:5-46` covers empty and populated IDs and the short `Local` label. The existing controller provider expectation was updated at `components/command-center-page.controller.spec.ts:251`.
- **F-5:** `voice/command-voice-loop.ts:193,201` clears provider details with `summarizeVoiceProviders(null)` on both RPC failure paths. `model/command-center.store.ts:245-273` already treats explicit `stt: null` and `tts: null` as clears, so it needed no change. `voice/command-voice-loop.spec.ts:10` covers rejected and unsuccessful RPC responses after provider labels were present.
- **F-7:** `components/command-center-page.controller.ts:315-320` catches a voice-exit rejection and shows a safe toast. `components/command-center-page.controller.spec.ts:530` covers the rejection.

## Files changed

- `libs/frontend/command-center/src/lib/components/command-center-turn-status.ts`
- `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts`
- `libs/frontend/command-center/src/lib/components/command-center-page.controller.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-center-page.component.ts`
- `libs/frontend/command-center/src/lib/model/session-coordinator.ts`
- `libs/frontend/command-center/src/lib/model/session-coordinator.spec.ts`
- `libs/frontend/command-center/src/lib/model/voice-provider-summary.ts`
- `libs/frontend/command-center/src/lib/model/voice-provider-summary.spec.ts` (new)
- `libs/frontend/command-center/src/lib/voice/command-voice-loop.ts`
- `libs/frontend/command-center/src/lib/voice/command-voice-loop.spec.ts`
- `.ptah/specs/TASK_2026_678_9083/reports/phase-e-r1b-report.md` (this report)

## Decisions

- Used the existing `running` session status for awaiting-background and sleeping because the store has no separate background status.
- Kept the short chip provider name `Local`; the longer registry label would crowd the chip. Kept `ElevenLabs voice` for a configured ID without fetching the voice library.
- Reused page-exit roster cleanup on tab change, excluding voice exit from the shared method. A later Confirm remains a card action only and returns immediately once the old proposal is cleared.
- Used a safe toast for a failed asynchronous voice exit and the existing degradation-audit suppression form.

## Not done

- Nx, Jest, build, serve, e2e, and package commands were not run, per lane instructions. `git diff --check` passed; controller length is 690 lines, below the 700-line limit.
- Findings F-2, F-6, F-8, and F-9 were outside this lane's assigned scope.
- An unrelated pre-existing change to `.ptah/specs/TASK_2026_678_9083/future-enhancements.md` was left untouched.
