# Code Style Re-Review, Phase D style fixes, TASK_2026_678_9083

## Summary

| Metric | Value |
| --- | --- |
| Score | 7/10 (was 6/10) |
| Assessment | APPROVED |
| Blocking | 0 |
| Serious | 0 (was 3) |
| Moderate | 3 new, plus M1 still open (carried) |
| Minor | 6 new |
| Reviewer family | Anthropic (in-process) |
| Implementer family | codex |
| Range | `711a1c980^..e1f2e5ea7` (47 files, +606/-184) |
| Method | Read in full: `command-center-page.component.ts`, `command-center-page.controller.ts`, `work-state.ts`, `work-state.spec.ts`. Read in the changed regions: voice loop, HUD, pending input, session controls, work list, overlay, scene-layout, sprite-cache, status-narrator, work-projection, projection source, chat-state persona and barrel, tribunal-panel discovery files, `chat-input.component.ts`, both tsconfigs. Both implementer reports read. No nx, jest or tsc run (memory-safe rule). |

Score evidence: all three Serious findings and eight of nine Moderate findings are closed with
code evidence. The score does not reach 8 because the controller grew from 368 to 461 lines
(M1 open), and the two commits added behaviour (S1 wiring, S2 theme feed) with no assertion
that would catch the same wiring drift again.

## Prior findings

| ID | Status | Evidence |
| --- | --- | --- |
| S1 half-wired children | CLOSED | HUD now bound to `errorKind`, `turnAbortable`, `(interrupt)`, `(openVoiceSettings)` at `command-center-page.component.ts:119-125`. Pending input bound to `choices` and `timedOut` at `:130-131`. Controller backs them with `voiceErrorKind` (`controller:50-58`), `interruptSpeech` (`:351`), `openVoiceSettings` (`:354`), `rosterTimedOut` (`:49,256,432`), `ordinaryChoices` (`:98`). Dead members deleted: `canResume` and `resumeSession` (`command-session-controls.component.ts`, diff -11 lines), `pinNode`/`unpinNode` (`command-overlay.component.ts:125-130`). A grep over the HUD, pending-input and session-controls inputs/outputs finds no unbound member. Test gap is filed as N2. |
| S2 theme and reducedMotion producers | CLOSED | `controller:189-191` feeds `store.setTheme` from `ThemeService.isDarkMode` (a `computed` at `theme.service.ts:164`). `:192-200` feeds `setReducedMotion` from the OS query and releases the listener through `destroyRef`. Page binds both (`page.component.ts:78,91`). The "one source of truth" part is only partly met (see N6). |
| S3 node kind in id prefixes | CLOSED | `CommandWorkNode.kind` and `agentKind` at `command-center.store.ts:27-28`, set at every push in `work-projection.ts`. `grep startsWith` over non-spec sources in `libs/frontend/command-center/src/lib` returns zero hits. `status-narrator.ts:68-84` uses a `switch (node.kind)` with an exhaustive `never` guard. `scene-layout.ts:71,96,127,131,177-190,213,270` and `sprite-cache.ts:82-84` compare `kind`. Ids stayed opaque. |
| M1 controller split | OPEN (Moderate, carried) | `command-center-page.controller.ts` is 461 lines (was 368). It has 10 `inject()` fields (store, tabs, coordinator, rpc, theme, appState, destroyRef, chat, transport, projection source) plus 2 `new`-built collaborators. Roster flow is still inline (`:214-286` effects, `:413-440` confirm/decline/timeout). Pulse FIFO (`armedTurns`, `deliveredPulseSeq`, `:78-80,287-305,457-460`) is also still inline. Deferral was a recorded decision. The file is under the 700-line `max-lines` warning (`eslint.config.mjs:556`), so this is debt, not a lint failure. |
| M2 child internals, older hook | CLOSED | `CommandWorkListComponent.focusRow()` owns focus (`command-work-list.component.ts:84-92`). Overlay exposes `asReadonly()` ids and `closeCard()` (`command-overlay.component.ts:128-130,274`). Page uses `afterEveryRender` (`page.component.ts:2,179`) in place of `ngAfterViewChecked`. The global `document.querySelectorAll` is gone. Nit in N9. |
| M3 status mapping x3 | CLOSED | One `workStateForStatus` (`model/work-state.ts:4-31`) used by the projection source (`command-center-projection.source.ts:91`), lane state (`work-projection.ts:155`) and `runState`. Nested ternaries removed. `work-state.spec.ts` has one row per status. Placement of `runState` is N4. |
| M4 protocol literals | CLOSED | `COMMAND_CENTER_TRIBUNAL_REQUEST_TAG` is defined beside the persona (`chat-state/src/lib/command-center-persona.ts:4`), interpolated into the persona text, exported from the barrel (`chat-state/src/index.ts:75`) and used by the sender (`controller:408`). `TRIBUNAL_ROSTER_PROPOSAL_TAG` is exported at `tribunal-roster-proposal.ts:12` and used in the parser (`:108`) and controller (`:93,224`). Naming and barrel placement match `COMMAND_CENTER_PERSONA` and `commandCenterPersonaFor`. See "Carry-over" below for a related gap that this fix does not reach. |
| M5 toast display-text control flow | CLOSED for retry | `CommandToast.action?: 'retry-speech'` (`store.ts:56`), set in the voice loop (`command-voice-loop.ts:141`), switched on in the page (`page.component.ts:105`). The same smell was re-introduced for the HUD error kinds, filed as N1. |
| M6 harness in lib compile | CLOSED | `integration-harness.testing.ts` follows the existing `*.testing.ts` naming used by `chat`, `dashboard` and `marketplace`. `tsconfig.lib.json:12` excludes it and `tsconfig.spec.json:16` includes it. Six spec imports updated. |
| M7 discovery entry drags state service | CLOSED | `TRIBUNAL_MAX_VENDOR_TILES` moved to `tribunal-ui.types.ts:4`, re-exported by `tribunal-state.service.ts:28` for existing callers, and imported from types by `tribunal-discovery.service.ts:11`. The guard regex now forbids `tribunal-state.service` (`discovery.spec.ts:26-28`). |
| M8 service locator | CLOSED | `chat-input.component.ts:488` is an `inject(AppStateManager)` field. `Injector` import removed. Both spec setups provide it (implementer report cites `chat-input.component.spec.ts:78,211`). |
| M9 voice loop contract | CLOSED | `onTurnBoundary(assistantText, turnToken: number)` is required (`command-voice-loop.ts:432`). `sendTranscript` is required (`:21`), the coordinator fallback is deleted, and the loop keeps `coordinator` only for `startVoice`/`mute`/`stop` lifecycle (`:254,552,558`). `beginAwaitingTurn()` is shared (`:424`). The JSDoc is back on `onTurnBoundary` (`:431`). `options` is now a required constructor argument. |

## New findings

No Blocking or Serious findings.

### Moderate

**N1. `voiceErrorKind` is keyed on toast display text (M5 repeated)**
- File: `command-center-page.controller.ts:50-58`.
- Problem: three of four error kinds come from `message.includes('Microphone' | 'Transcription' | 'Voice request failed')`. Those strings are produced in `command-voice-loop.ts:240,343,407` and are user copy. Only `playback` uses the new typed `action`. Rewording a toast silently removes the HUD error state, with no compiler or spec signal. This is the defect the M5 fix removed for retry, reintroduced one level up by the S1 fix.
- Fix: add `readonly kind?: 'mic-denied' | 'transcription' | 'playback' | 'chat'` (or widen `action`) to `CommandToast`, set it where the voice loop creates the toast, and make `voiceErrorKind` a plain read of `toast()?.kind ?? null`.

**N2. The S1 and S2 wiring has no assertion that would catch its removal**
- Files: `command-center-page.component.spec.ts:67-83`, `command-center-page.controller.spec.ts` (no hit for `setTheme`, `isDarkMode`, `matchMedia`, `voiceErrorKind`, `openVoiceSettings` or `interruptSpeech`).
- Problem: the page spec replaces the controller with a stub whose new members (`voiceErrorKind`, `rosterTimedOut`, `ordinaryChoices`, `interruptSpeech`, `openVoiceSettings`) are never asserted. The controller spec does not cover the theme effect or the motion query. The lane B report says so for S2 ("no dedicated theme assertion"). S1 was filed because children were wired incompletely and nothing noticed. That regression class is unguarded again.
- Fix: three small cases. (1) Page: clicking the HUD interrupt and settings buttons calls the stub, and the card shows choices and `timedOut`. (2) Controller: `ThemeService` dark to light changes `store.theme()`; a `matchMedia` change updates `store.reducedMotion()`. (3) Controller: each toast maps to its `errorKind` (after N1).

**N3. Turn-state reset block is now duplicated in `mute()` and `release()`, and already differs**
- File: `command-voice-loop.ts:549-575` (`mute`) and `:564-588` (`release`).
- Problem: about twelve identical field resets (`busy`, `queuedClip`, `playbackMarks`, `synthesisIds`, `turnGeneration`, `awaitingBoundary`, `awaitingTurnToken`, `queuedTypedTurns`, `currentReplyOrigin`, `currentUtteranceOrigin`, `bargeInCandidateAt`, `playbackEpoch++`, `vad.reset()`, `onTurnsAbandoned`). F1 added `queuedTypedTurns`, `awaitingTurnToken` and `onTurnsAbandoned` to both. They already differ (`release` also clears `pendingRoster` and the narrator; `mute` does not), so the next field has to be added twice and the divergence is not marked as intended.
- Fix: extract a private `resetTurnState()` for the shared fields; keep the differing lines in each method with a one-line comment on why.

**M1 (carried, still open)**: controller 461 lines, roster flow and pulse FIFO inline. See the Prior findings table.

### Minor

- N4. `runState` is exported from the component-layer `command-center-projection.source.ts:21` while the mapper it wraps is in `model/work-state.ts`. `model/work-state.spec.ts:2` therefore imports from `components/`, inverting the lib's own layering. Move `runState` into `work-state.ts`.
- N5. `CommandWorkNode.agentKind` (`command-center.store.ts:28`, set at `work-projection.ts:220`) has no consumer outside specs. The lane A report confirms nothing branches on it. Speculative field; delete it until a consumer exists.
- N6. `inject(ThemeService, { optional: true })` and `inject(AppStateManager, { optional: true })` (`controller:41-42`). Both are `providedIn: 'root'`, so `optional` only hides a mis-wired injector: the theme silently degrades to `'light'` (`:190`) and `openVoiceSettings` silently does nothing (`:355`). Use plain `inject()`. The controller also registers its own `matchMedia` listener (`:192-200`) while the scene keeps one (`command-scene.component.ts:152-155`). Both now read the same source, which is the lane B decision, but it is still two listeners for one fact.
- N7. M1 leftovers in the controller: `120_000` literal (`:268`) and `new RegExp(...)` built on every `sendCommand` (`:388-391`). Name the constant and hoist the pattern.
- N8. `focusWorkRow` reads the child's `list.projection().nodes` (`page.component.ts:198-203`) although the page holds `page.projection()`. Use the page's own projection, and drop the child read.
- N9. `measuredProjection`'s type is spelled as `ReturnType<CommandCenterPageController['projection']>` (`page.component.ts:168-170`). Import the `ProjectionResult` type already exported by `work-projection.ts`.

## Deferred (follow-up list)

- M1: extract `CommandCenterRosterFlow` and a shared pulse-cursor helper from the controller (Moderate, now the largest open item).
- The 10 Minors from the first review (decision already recorded).
- N4 to N9 above, which are cheap to fold into the M1 pass.
- Carry-over observation, pre-existing and not counted against this range: `command-center-persona.ts:10` tells the model to use "a clearly delimited payload" but never names `<TRIBUNAL_ROSTER_PROPOSAL>`. The parser accepts only that exact tag (`tribunal-roster-proposal.ts:108`). A grep for `ROSTER_PROPOSAL` over `libs`, `apps` and `.claude` finds it only in the controller, the parser and specs, so no prompt text tells the model to emit it. If that is accurate, a live roster would fail the parse and take the "Invalid Tribunal proposal. It was declined." path (`controller:245-253`). This is a runtime-contract question, so it is routed to `code-logic-reviewer` for confirmation. If confirmed, the fix is a shared `TRIBUNAL_ROSTER_PROPOSAL_TAG` exported next to the request tag in chat-state, interpolated into the persona.

## Decisions

- M1 stays a carried Moderate, not a Serious. It breaks no invariant (461 lines is under the 700-line `max-lines` warning, `eslint.config.mjs:556`), and the deferral was an orchestrator decision. Reversible: re-rank it if the follow-up pass grows the controller further.
- S2 is CLOSED although `store.reducedMotion` was kept and fed rather than removed. The review offered feeding the store as an alternative to deleting it, and the producer now exists. The duplicate listener is filed as Minor N6.
- The persona/roster-tag gap is reported as a carry-over, not as a finding against these commits, because the range did not introduce it. It is not counted in the totals.
- The `ElementRef` typing error that lane B recorded (`command-work-list.component.ts:79`) is treated as resolved: the orchestrator ran the scoped checks and reports them passing, and the declaration at `:78` is now `ElementRef<HTMLElement>`.
- Assessment is APPROVED because there is no open Blocking or Serious finding. N1 to N3 are recommended before the follow-up PR, not gating.

Verdict: APPROVED
