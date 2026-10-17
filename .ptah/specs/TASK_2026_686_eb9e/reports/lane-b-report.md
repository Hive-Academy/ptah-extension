# Lane B: voice review findings

## Findings

| Finding | Verdict and evidence | Change | Specs |
| --- | --- | --- | --- |
| B1: onset lost on mid-band frame | Valid. `vad.ts:59-73` begins onset above the active threshold but cleared it for every inactive frame, including RMS between 0.008 and 0.02. | `vad.ts:73` now clears onset only when RMS is below `noiseFloor`. Active-frame onset and the existing `belowSince` hangover path are unchanged. | `vad.spec.ts:39-56` covers mid-band dips in normal and playback modes and a dip below the noise floor. |
| B2: provider details lost on Start voice | Valid. `command-voice-loop.ts:224-233` previously stored only `transcription` and `synthesis`. The already imported `summarizeVoiceProviders` returns `stt` and `tts` as well (`../model/voice-provider-summary.ts:53-62`). | `command-voice-loop.ts:224-226` stores the complete summary and uses its readiness flags. No new import or circular dependency was introduced. | `command-voice-loop.spec.ts:233-317` proves a successful start retains both provider labels and model labels; the unready-provider case now checks both direction details. |
| B3: stale work narrated on first observation | Valid. `status-narrator.ts:19-24` and `:97-101` clear `previous`; `:42-63` previously queued every meaningful state with no prior state. | `status-narrator.ts:39-42` records owned states and returns when no baseline exists. Later state transitions still enter the narration loop. | `status-narrator.spec.ts:28-47` covers silent first observation and later completion; `:81-95` covers root change; `:96-113` covers `clear()`. |

## Files changed

- `libs/frontend/command-center/src/lib/voice/vad.ts`
- `libs/frontend/command-center/src/lib/voice/vad.spec.ts`
- `libs/frontend/command-center/src/lib/voice/command-voice-loop.ts`
- `libs/frontend/command-center/src/lib/voice/command-voice-loop.spec.ts`
- `libs/frontend/command-center/src/lib/voice/status-narrator.ts`
- `libs/frontend/command-center/src/lib/voice/status-narrator.spec.ts`
- `.ptah/specs/TASK_2026_686_eb9e/reports/lane-b-report.md`

## Verification

Scoped diff and file status were reviewed. Per lane instructions, no Nx, Jest, build, or command-line TypeScript check was run. Scoped `ptah_get_diagnostics` returned `Unavailable`: its TypeScript check remained running after 45 seconds, so all six changed TypeScript files were reported unchecked. The orchestrator owns executable checks.

## Decisions

| Decision | Options, evidence, reversible |
| --- | --- |
| Keep VAD hangover accounting for mid-band frames. | Options were to clear `belowSince` on mid-band frames or leave the existing end-of-speech behavior. B1 explicitly requires hangover unchanged, and `vad.ts:74-83` already tracks inactive frames. Reversible: yes. |
| Use the existing provider summary in `start()`. | Options were to duplicate readiness and add labels manually or use `summarizeVoiceProviders`. It was already imported at `command-voice-loop.ts:3` and supplies both readiness and direction details. Reversible: yes. |
| Make first owned projection a silent baseline. | Options were to suppress only completed states or all first-observation states. B3 explicitly calls for recording current states without queuing; `status-narrator.ts:39-42` implements that for every owned node. Reversible: yes. |
