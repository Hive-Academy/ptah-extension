# Phase E · E4 implementation report

## Changes

- S1: Removed toast string matching in `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts:48`; added a typed `CommandVoiceError` signal, clearing on listening and new tab, in `libs/frontend/command-center/src/lib/model/command-center.store.ts:59,94,135,153`; bound typed errors in `libs/frontend/command-center/src/lib/components/command-center-page.component.ts:120`. The HUD keeps Start voice enabled for recovery and shows the supplied error message and Voice settings action in `libs/frontend/command-center/src/lib/components/command-voice-hud.component.ts:24,52,82`. `startVoice` clears the error and toast before retry in `command-center-page.controller.ts:444`. With explicit E4 authorization, `libs/frontend/command-center/src/lib/voice/command-voice-loop.ts:235-258` now maps the real `CaptureError.reason` to `mic-denied`, `mic-unavailable` or `worklet` and emits matching accurate copy.
- S7: Root-tab `streaming` status now drives `turnAbortable` in `command-center-page.controller.ts:48`, bound at `command-center-page.component.ts:122`. A terminal pulse now settles the page session status in `command-center-page.controller.ts:272`, so a completed turn does not stay `running` when the pulse arrives. The existing `latestReply` reads that terminal pulse.
- S6: Before an SDK session ID exists, the page projection supplies an idle Ptah root node with a tab-stable anchor in `command-center-page.controller.ts:184`.
- M4, M6, m2: The HUD has a 56 px circular mic action, state title/subtext, input level meter, Mute, Stop, hover/focus states and readable disabled controls in `command-voice-hud.component.ts:17`. Session controls use a compact command field with a Send icon and secondary Start new/Status controls in `command-session-controls.component.ts:12`.
- S3: The text form uses an opaque `border-base-content` boundary and the input has a 2 px warning focus outline in `command-session-controls.component.ts:17,21`.

## Preserve list check

- Start voice: kept as mic orb; Stop listening is the same orb while listening.
- Stop: kept as secondary control, enabled for a streaming typed turn.
- Mute/Unmute: kept as secondary control.
- Interrupt speech: kept and shown while speaking.
- Retry speech: kept in the page toast action; its markup was untouched.
- Open Voice settings: kept as the HUD recovery control.
- Send command: kept as the icon submit button.
- New session: kept as secondary Start new control.
- Status: kept in session controls.

## Specs added or changed

- `command-voice-hud.component.spec.ts:1`: error recovery per typed kind and typed-turn Stop state.
- `command-voice-loop.spec.ts:198`: real permission, unavailable and worklet capture failures populate the typed store error and accurate toast; worklet cleanup is checked.
- `command-session-controls.component.spec.ts:1`: form, boundary/focus classes, Start new and Status outputs.
- `command-center.store.spec.ts:17`: typed error clearing on retry, listening and new session.
- `command-center-page.controller.spec.ts:152`: idle root, retry clearing, typed Stop and terminal status/reply.
- `command-center-page.component.spec.ts:70`: controller stub updated for the new binding.
- Tests were not run by instruction. Scoped `ptah_get_diagnostics` was attempted three times and returned unavailable after 45 seconds each time, with no diagnostic result.

## Decisions

- Used the root tab ID as the temporary Ptah node key before the SDK session exists, then the normal session projection after it arrives. Options were an empty scene or a temporary root; the scene needs an anchor. Reversible.
- Used Voice settings as the microphone-denial recovery destination because the current controller only exposes `AppStateManager.setCurrentView('settings')`; there is no verified host API for opening OS microphone permissions in E4 scope. Reversible when such an API is available.
- Used opaque `border-base-content` for the input because it provides the theme's full contrast text color as its boundary; the previous `input-bordered` border was translucent in both themes. Reversible.

## Needed outside scope

- S1 beyond the newly authorized `start()` path: `libs/frontend/command-center/src/lib/voice/command-voice-loop.ts:135-142,340-346,407-411` still reports playback/transcription/request failures only through toasts. Typing those distinct failure sites would change other voice-loop behavior beyond the narrow S1 authorization for `start()`.
- M4 full horizontal dock placement requires moving HUD and session controls in `command-center-page.component.ts`; E4 permitted only changing their binding lines. They remain separate rail sections, with the work list between them. The components themselves now use the requested visual hierarchy.
- S7 if a backend turn finishes without `TabManagerService` receiving a terminal `turn_state` pulse, the page cannot settle `running` or populate `latestReply`: `libs/frontend/chat-state/src/lib/tab-manager.service.ts:1760-1801` updates tab status and the last reply only from an accepted terminal pulse. This E4 fix covers pulses that do arrive; the reported no-pulse case needs inspection of the backend/event delivery outside E4 ownership.
- S6 root state in the normal session projection remains hard-coded to `running` in `libs/frontend/command-center/src/lib/model/work-projection.ts:69-81`, owned by another lane. The new pre-session node is idle/unknown.

## Not done

- No Nx, Jest, TypeScript, build, serve, e2e, git or workspace-wide command was run.
- Visual contrast measurements and tests await the orchestrator's scoped checks.
