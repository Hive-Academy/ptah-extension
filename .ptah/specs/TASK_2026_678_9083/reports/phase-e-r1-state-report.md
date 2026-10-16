# Phase E revise round 1 — state lane

## Findings

- **M-1:** `components/command-voice-hud.component.ts:68,76,140-146` now uses separate Mute, Stop turn, and Start flags. A typed streaming turn leaves Start and Stop enabled while Mute stays disabled. `voice/command-voice-loop.ts:547-548` makes Mute a no-op until voice was genuinely active or muted. Specs: `components/command-voice-hud.component.spec.ts:81`, `components/command-center-page.controller.spec.ts:227`, `voice/command-voice-loop.spec.ts:10`.
- **M-d:** `components/command-center-page.controller.ts:302-308` ends the voice loop when the marked tab changes, covering Start new and other new-tab paths. `voice/command-voice-loop.ts:582-587,604-608` clears the loop's muted flag, the store muted flag, and voice state on release. Spec: `components/command-center-page.controller.spec.ts:334`.
- **M-2:** `components/command-center-page.controller.ts:310-338` consumes terminal pulses without settling a still-streaming root and settles a running status on the streaming-to-non-streaming transition even without a pulse. The fallback reads `lastTerminalReason`; completed or absent means idle, other terminal reasons mean error. The voice turn boundary effect remains unchanged. Specs: `components/command-center-page.controller.spec.ts:273,307,317` cover overlapping turns, no pulse, and failure.
- **M-3:** `model/work-projection.ts:90` uses `root:<rootTabId>`, matching the pre-session root at `components/command-center-page.controller.ts:211`. All edges from the root use that same `rootId`. Specs: `components/command-center-page.controller.spec.ts:190` pins and selects the root before the SDK ID arrives and checks both survive; `model/work-projection.spec.ts:118,195` and `integration/delegation-and-status.spec.ts:26,188` use the tab-based root format.

## Files changed

- `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts`
- `libs/frontend/command-center/src/lib/components/command-center-page.controller.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-voice-hud.component.ts`
- `libs/frontend/command-center/src/lib/components/command-voice-hud.component.spec.ts`
- `libs/frontend/command-center/src/lib/voice/command-voice-loop.ts`
- `libs/frontend/command-center/src/lib/voice/command-voice-loop.spec.ts`
- `libs/frontend/command-center/src/lib/model/work-projection.ts`
- `libs/frontend/command-center/src/lib/model/work-projection.spec.ts`
- `libs/frontend/command-center/src/lib/integration/delegation-and-status.spec.ts`

## Decisions

- **Tab ID is the root node identity.** Options: keep the SDK session ID and remap selection on arrival, or use the existing tab ID throughout. The pre-session projection already uses the tab ID, and `ProjectionInput` already carries `rootTabId`; using it is simpler and preserves selection, pins, edges, and narrator identity. Reversible.
- **Reset on marked-tab change.** Options: change the page's Start new binding, or observe the session tab in the controller. The page component belongs to another lane and the coordinator writes `markedTabId` for new sessions, so the controller observes that transition. Reversible.
- **Settle absent terminal reasons as idle.** Options: retain running, report error, or report idle. The tab leaving `streaming` is the available completion signal, and `lastTerminalReason` distinguishes known failure/abort; an absent reason has no evidence of failure. Reversible.

## Not done

- No Nx, Jest, build, serve, e2e, package, or git command was run, per lane instructions.
- Scoped `ptah_get_diagnostics` found no errors in the changed controller, HUD, voice loop, projection, or their focused specs. It reported 17 errors across the project, including three existing mock typing errors in `integration/delegation-and-status.spec.ts:81,130-131` and sibling spec/type errors. Those unrelated errors were outside this lane's fix scope.
- The root ID audit found no parser of the `root:` suffix in the store, overlay, narrator, or scene code. Their synthetic test IDs remain arbitrary; no out-of-scope source edit was needed.


## N5

- `components/command-center-page.controller.ts:296-307`: while this page has a marked tab, an Angular effect registers that tab as visible. Its cleanup unregisters on tab ID change and page destruction. Following the canvas transcript pattern, it checks `visibleTabIds` without tracking that signal and only unregisters a tab it registered itself. This lets the stream viewport include the Command Center tab, so retained host chunks and terminal events can be delivered. The M-2 non-streaming fallback remains in place.
- `components/command-center-page.controller.spec.ts:361-397`: added lifecycle coverage for registration, tab change, page destruction, and preservation of a tab that was already visible before this page observed it.
- **Decision:** use the page-scoped visibility registration pattern already present in `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts:95-107`. Options were unconditional register/unregister or ownership-aware cleanup; the visible tab set is not reference counted, so ownership-aware cleanup preserves other surfaces' registration. Reversible.
- **Verification:** scoped `ptah_get_diagnostics` reports no errors in the two changed files. It still reports the same 17 unrelated project diagnostics recorded above. Nx/Jest/build/serve/e2e/package and git were not run by instruction.
