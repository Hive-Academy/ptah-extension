# B2 report — voice loop and shared boundaries

## Items

| Item | Pre-edit status and evidence | Change and regression coverage |
| --- | --- | --- |
| D M-1/M-2 | Open: `command-voice-loop.ts` queued typed turns as a count and sent no pre-send pulse sequence; a clip could start while a typed boundary was armed. | `armTypedTurn(minPulseSeq?)` now retains each sequence in FIFO order and supplies it to `onVoiceSend(token, minPulseSeq?)`; clips wait for an armed typed boundary. Existing one-argument callers still work. Loop specs cover sequence order and the reverse clip order. B3 must sample the sequence before each send and use the callback's optional second argument. |
| D M-3 | Partial: capture errors were typed, but retry recovery was not pinned. | Start clears a prior voice error after capture succeeds; failures preserve `mic-denied`, `mic-unavailable`, and `worklet` distinctions. Loop spec retries after unavailable capture. HUD copy is B3 ownership. |
| D M-4 / E M-4 and R3-3 loop side | Open: `abandonTurn` finished silently; empty successful text was silent. | Optional `abandonTurn(token, 'failed' \| 'aborted' \| 'timed-out')` speaks a fixed retry cue for failure/timeout, never for abort. Empty successful reply gets a fixed cue. STT, chat, TTS and playback failures set typed voice errors. Existing omitted outcome remains silent. Loop specs cover single cue, abort, timeout and empty reply. B3 classifies terminal pulses and owns idle grace; no Stop timer was added. |
| Style N3 | Open: mute and release repeated the same turn-state reset. | `resetTurnState()` now owns the shared reset; existing mute/release behavior is retained. Existing mute/stop loop specs and the queued-turn reset spec cover it. |
| F-2 | Partial: `trackMarkedTabVisibility` unregistered the old tab immediately on rebind, although the old turn may still stream. | It retains per-tab registration until the old tab becomes idle or gets a newer terminal pulse, and releases all registrations on destroy. The cross-workspace lookup reads `_tabs()` for the active workspace (`tab-manager.service.ts:697-701`); background partition lookup itself is not a signal (`tab-workspace-partition.service.ts:373`), so the helper also observes `lastTerminalPulseByTab`. New turn-status spec covers workspace switch, terminal/idle and destroy. Both helper signatures remain unchanged. |
| r5 M-3 | Open: a failure before stored `running` left the page idle. | A fresh error pulse now sets error and the fixed toast even when stored status is not `running`; new turn-status spec covers the fast failure. B3 owns the later `running` write ordering. |
| 686 M-1/M-2 | Open: a throwing release listener stopped later listeners; dispatch lacked turn-end/release ordering coverage. | `notifyRelease` catches per-listener errors and uses fixed-content injected logging when available. Its state is already cleared before notification. Send-lock spec covers a throwing listener; dispatch spec covers release/turn-end in both orders with one clear and flush. |
| F-10 | Open: `notification-ledger.service.ts:166-173,433-453` sounded every completion after a 350 ms burst, possibly over voice. | Added root-tab `CommandCenterVoiceSessionService` and exported it from chat-state. Ledger snapshots sound eligibility for each pulse before queuing the burst; cards and announcement still include silent completions, and only eligible pulses trigger `playBurst()` at expiry. Service and notification-center specs cover independent roots, silent voice burst, mixed burst, cards and announcement. B3 must call `activate(rootTabId)` on voice start and `deactivate(rootTabId)` on stop/exit/destroy/rebind. |

## Dependency evidence

`notification-ledger.service.ts` already imported `TabManagerService`, `TerminalTurnPulse` and `workspaceLabelFromPath` from `@ptah-extension/chat-state` before this edit. The new voice-session import uses that existing edge. `libs/frontend/chat-state/src` has no import from `@ptah-extension/notification-center`, so this adds no reverse edge or cycle.

## Files changed

- `libs/frontend/command-center/src/lib/voice/command-voice-loop.ts` and `.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-center-turn-status.ts` and new `.spec.ts`
- `libs/frontend/chat-state/src/lib/command-center-send-lock.service.ts` and `.spec.ts`
- New `libs/frontend/chat-state/src/lib/command-center-voice-session.service.ts` and `.spec.ts`; `libs/frontend/chat-state/src/index.ts`
- `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.command-center-lock.spec.ts`
- `libs/frontend/notification-center/src/lib/notification-ledger.service.ts` and adjacent `notification-center.store.spec.ts`

## Verification

No Nx, Jest, tsc, build or e2e command was run, as required for parallel lanes. `git diff --check` passed for the edited tracked files. Ptah AST parsing reported no errors for the changed source and turn-status spec. Scoped `ptah_get_diagnostics` was attempted twice but reported TypeScript check unavailable after 45 seconds, so type diagnostics remain unverified. The orchestrator should run the focused specs and changed-project checks after wave 1.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep the pre-send sequence on each typed queue entry and add an optional callback argument. | Per-entry sequence / global latest sequence. | A global latest pulse can move while transcription waits; plan D M-1/M-2 requires preserving each send's sampled sequence. | Yes. |
| Retain old tab registration based on active tab state and terminal pulse. | Immediate release / old-tab retention. | The old page turn continues after rebind; background tab lookup is not signal-backed, while terminal pulse is. | Yes. |
| Store root voice activity in chat-state and snapshot sound eligibility at pulse collection. | Playback-time check / per-pulse check. | The 350 ms timer can expire before speech starts; the plan explicitly assigns per-pulse eligibility. | Yes. |
| Keep an absent `abandonTurn` outcome silent and avoid a Stop timer. | Change omitted behavior / preserve current caller behavior. | B2 runs before controller B3; the approved plan requires optional parameters and the user rejected a Stop timer. | Yes. |
