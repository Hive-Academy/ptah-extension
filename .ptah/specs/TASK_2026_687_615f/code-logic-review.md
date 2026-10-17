# Code Logic Review — `TASK_2026_687_615f`

Scope: `git diff d5d3db286..HEAD -- libs` (waves 1 and 2). Read in full: `command-center-page.controller.ts`, `command-center-roster.provider.ts`, `command-voice-loop.ts` (changed regions and callers), `command-center-turn-status.ts`, `command-center-page.component.ts`, `command-center-workspace-binding.ts`, `session-coordinator.ts` (guard), `tribunal-run-coordinator.ts` (confirm path), `tts-playback-queue.ts`, notification ledger and voice-session service diffs, send-lock diff, B4 scene/overlay/shell/setup-hub diffs. Nothing was executed (read-only; checks reported green by the orchestrator).

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6.5/10 |
| Assessment | NEEDS_REVISION |
| Blocking | 0 |
| Serious | 2 |
| Moderate | 4 |
| Minor | 4 |

## Plan items: met / not met

| Item | Verdict | Evidence |
| --- | --- | --- |
| D M-1/M-2 pulse-sequence correlation (typed and voice) | MET | controller.ts:419-432 samples `minPulseSeq` before each send; loop.ts:472-486 carries it through the typed queue; voice sends use `voicePreSendSeq` (controller.ts:168-182). Rebind bumps the loop generation, so a stale tab/seq pair cannot reach `onVoiceSend`. |
| D M-3 mic recovery kinds | MET | hud.component.ts:91-120 (denied vs unavailable/worklet). |
| D M-4 / E M-4 abort vs failure cue | PARTIAL | Voice side is correct (controller.ts:251-261, loop.ts:508-523, no cue for abort). The page status/toast side is wrong, see S-1. |
| R3-3 idle grace only, no Stop fallback timer | MET | controller.ts:264-304 grace timer only; no timer on Stop (controller.ts:357-364). Timer cleared on pulse, status change, clearArmedTurns, destroy. |
| S1 M-A/M-B/M-C | MET with S-2 caveat | roster.provider.ts:279-323 (12 s grace, only after skipped pulse or observed activity), 438-475 (retry/cap/toast action), timers released in teardown and `DestroyRef`. |
| Guard M-3 nonce | MET | roster.provider.ts:390-402 captures the nonce before the await and clears only when it still matches. |
| F-2 old-tab visibility | MET | turn-status.ts:39-71 keeps the old registration until settled/gone, releases all on destroy. Residual leak: Minor m-3. |
| r5 M-2/M-3 | MET | turn-status.ts:97 admits a fast failure pulse before `running`; stale-workspace guard intact (session-coordinator.ts:238-287, `running` written at ~281 after `bindingIsCurrent()`). But the same clause causes S-1. |
| r6 M-1/M-2, A1 no replay | MET | `confirmProposal` is click-only (controller.ts:434-437, `canSend()` first); transport guard (tribunal.transport.ts:175-181) returns false with a "Confirm again" message; rebind runs `teardownSessionState` (controller.ts:218-229), which clears the pending proposal. No code path replays Confirm or a launch turn. |
| F-10 voice-session flag + per-pulse gating | PARTIAL | Per-pulse gating correct (ledger.service.ts:170-179, 441-468). Flag lifetime is coarser than "TTS will speak", see M-1. |
| 686 M-1/M-2 send-lock listener isolation | MET | send-lock.service.ts:66-75 iterates a copy and isolates each listener. |
| B4 scene/overlay/shell/setup-hub | MET with M-3 | Ring search is bounded (452 candidates), overlay unpin only after the plate was seen, active-tab scroll effect uses a one-shot `afterNextRender`, Space has `preventDefault`. |

Preserve contract: every listed public controller member still exists with the same name and signature (controller.ts:74-121, 157-187, 312-455). The stale-workspace guard is untouched. Effects and timers created in the roster are owned by the controller injection context and released on destroy; the roster `teardown` is called from rebind and exit.

## Findings

### S-1 (Serious): a user Stop is turned into an error status plus a red toast

- File: `libs/frontend/command-center/src/lib/components/command-center-turn-status.ts:93-107` (new `|| pulse.classification === 'error'`), with `libs/frontend/chat-state/src/lib/tab-manager.service.ts:1838-1841` and `model/session-coordinator.ts:224-226`.
- Scenario: the HUD Stop button calls `stopVoice()` then `coordinator.stop()`, which sets `sessionStatus` to `stopped` and sends `chat:abort`. The ordered abort `turn_state` (`idle`, `aborted_streaming`) yields a pulse with `classification: 'error'` (anything but `completed` is `error`). The old guard required `sessionStatus() === 'running'`, so `stopped` stayed. The new clause admits every error pulse, so the status flips `stopped` -> `error` and the toast "The Command Center turn could not finish." appears.
- Impact: working behaviour lost (a clean Stop now reads as a failure, `shownSessionStatus` returns `error`, red alert role). It also contradicts the D M-4/E M-4 abort-vs-failure goal; the voice layer distinguishes abort, the page does not.
- Fix: keep the widening only for fast failures, and exclude aborts: require `pulse.terminalReason` not in `aborted_streaming`/`aborted_tools` and `sessionStatus() !== 'stopped'`, e.g. `(status === 'running' || (pulse.classification === 'error' && status !== 'stopped' && !isAbort(pulse)))`. Same abort exclusion for the `failed` computation at turn-status.ts:125-130 (`lastTerminalReason !== 'completed'`). Add a spec: stop -> abort pulse -> status stays `stopped`, no toast.

### S-2 (Serious): invalid-Decline recovery can become unreachable, and a voice failure overwrites specific toasts

- Files: `command-center-page.controller.ts:409-416` (gate toast has no `action`), `voice/command-voice-loop.ts:441-449` (new generic toast on `sent === false`), `command-center-roster.provider.ts:442-449`.
- Scenario: after 3 failed automatic Declines the toast carries `retry-decline`. Error toasts never auto-dismiss, but `setToast` replaces them. The user (or voice) sends anything: `sendCommand` returns false with the gate toast, which has no action. For voice, the loop then immediately overwrites that with "Voice request failed. Please try again or use text." The only Retry Decline button is gone while the send gate stays closed (the question is excluded from `ordinaryQuestion`, so it cannot be answered either) until the question disappears.
- Same overwrite also replaces the specific, fixed-text reasons produced by `sendCommand` (workspace switching, no session for Tribunal, invalid proposal pending) with the generic text; previously the loop only finished the turn silently.
- Impact: dead-end with a closed send gate; lost specific guidance.
- Fix: add `action: 'retry-decline'` to the gate toast (controller.ts:410-414); in the loop only toast on `sent === false` when no toast is already set by the sender (or let `sendTranscript` return a reason), and keep the `voiceError` update without replacing the toast.

### M-1 (Moderate): muting voice suppresses the completion chime but nothing speaks

- File: controller.ts:350-353 (`muteVoice` does not call `voiceSessions.deactivate`), ledger.service.ts:170-179, `command-voice-loop.ts:604-617` (mute sets `active=false`, stops playback).
- Scenario: user starts voice, mutes, runs a task from the keyboard. The pulse is root-tab and the session flag is still set, so `soundEligible=false`: no TTS (muted) and no chime. `toggleMuteVoice` -> `muteVoice` has the same hole; un-mute re-activates.
- Fix: deactivate on mute (and re-activate in `startVoice`, which already does); the plan listed stop/exit/destroy/rebind only, so this is a plan gap.

### M-2 (Moderate): `synthesisFailurePending` can go stale and swallow a later real playback error; stale TTS toast after Stop

- Files: `command-voice-loop.ts:103-108` and `142-148`, `tts-playback-queue.ts:106-118`.
- Scenario: synthesis rejects; the loop sets `synthesisFailurePending=true` and reports. The queue only calls `onFailure` when `clip.generation === this.generation`; after mute/stop/barge-in it does not, so the flag stays true. The next genuine `audio.onerror` runs `onFailure`, sees the flag, clears it and returns, so that playback failure is never reported. Also the TTS toast/voiceError is shown even when the failing clip belonged to a stopped voice session.
- Fix: report from the queue's `onFailure` only (pass a kind), or reset the flag in `resetTurnState`/`start` and skip `reportSpeechFailure` when `playbackEpoch` changed.

### M-3 (Moderate): overflow chip collides with the "01 / Voice command" caption

- Files: `scene/command-scene.component.ts:86` (`right-3 top-3`) vs `command-center-page.component.ts:205` (`right-5 top-5`, same stage).
- Scenario: more nodes than fit (the chip appears) -> the chip text sits under/over the static caption in the upper right. B4 moved it away from the bottom hint into this one.
- Fix: place the chip at `left`/second row (e.g. `top-12 right-5`) or drop the caption when the chip is shown; verify in Electron at 900 px.

### M-4 (Moderate): the voice grace timer has no "activity seen" eligibility

- File: controller.ts:264-304 versus the roster's `graceEligible` (roster.provider.ts:279-295).
- Scenario: a typed or voice turn is armed while the tab is `loaded`/`fresh`/`draft` and the host is slow to flip to `streaming`, or the message sits behind the Command Center send lock for over 12 s. The effect fires "The turn stopped responding" while the turn is still coming.
- Fix: arm the timer only after the root has been observed non-idle since arming, as the roster already does, or lengthen the first grace.

### Minor

- m-1: `voicePreSendSeq` is not cleared when `coordinator.send` rejects (controller.ts:422-432); next voice `sendCommand` overwrites it, so harmless today.
- m-2: loop catch block sets `voiceError` kind/message by stage but the toast is always "Voice request failed" (voice-loop.ts:456-466); a transcription exception shows mismatched texts.
- m-3: `trackMarkedTabVisibility` re-evaluates only on `tabs()`/pulse changes; an old background tab that leaves `streaming` with no pulse stays registered until the next trigger or page destroy (turn-status.ts:48-70).
- m-4: Space/Enter on the Setup card re-trigger `openCommandCenter()` on key repeat (setup-hub.component.ts:796-798); add `!$event.repeat`.

## Five logic questions

1. Silent failure: a TTS failure after a generation change is silent and arms a flag that swallows the next playback error (M-2). A held Stop that becomes an `error` status is the reverse, a false failure (S-1).
2. Unexpected user action: Stop (S-1); mute then keyboard work (M-1); sending while the Decline gate is closed (S-2).
3. Wrong answer with valid input: an abort pulse is classified `error` by chat-state and the page widened its trust in that classification (S-1).
4. Dependency failure: synthesis, STT and capture failures now set typed `voiceError` with fixed text and no raw error strings reach the UI (checked loop.ts:103-108, 431-466, hud.component.ts:91-120). Confirm with a stale workspace fails closed (tribunal.transport.ts:175-181) and is retryable.
5. Missing: mute does not release the voice-session flag (M-1); no activity requirement for the voice grace (M-4).

## Lost behaviour

- Lost: after a user Stop the status stays `stopped` (S-1 regression); specific fixed-text toasts for failed voice sends (S-2).
- Intentional changes, not losses: empty success reply now speaks a status instead of staying silent; old workspace visibility held until settlement; Confirm gated by `canSend()`.
- Everything else the old controller did (theme/motion feeds, projection, status context, pending-input effect, prompt speech, roster timeout, workspace teardown, `voice.exit` on rebind) is present in the controller or `CommandCenterRosterProvider`. No public member was removed.

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM-HIGH (static trace; no execution)
- Top risk: S-1 turns a normal Stop into a visible failure state.
- A robust implementation would add: abort-aware status handling, `action` on every gate toast, mute-aware voice-session flag, a single owner for speech-failure reporting tied to the playback epoch, and an "activity first" condition on the voice grace.
