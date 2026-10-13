## APPROVED WITH NOTES

**Score: 8/10.** The Phase 5 state transitions, transcript-local host-source wiring, and lazy-summary lifetime handling are sound in the reviewed paths. This is above 7 because the hard cross-tab, stale-completion, failure-fallback, and projection requirements have direct code evidence and focused test evidence recorded for the batch. It is below 9 because closed-tab dock state is retained for the whole ChatView lifetime, including potentially large surface and summary data, and no bounded-retention policy or cleanup path exists.

| Severity | File:line | Defect | Concrete failure scenario | Required fix |
|---|---|---|---|---|
| Minor | `libs/frontend/chat/src/lib/services/display-dock/display-dock.state.ts:104-110,354-364` | `tabs` and `seen` gain an entry for every tab ever written but expose no disposal path. Each entry can retain surfaces, statuses, renderer view state, and summary models after its chat tab is closed. | A long-lived ChatView repeatedly opens, receives display-heavy output in, and closes tabs. The state grows with every former tab until the whole ChatView is destroyed, retaining data the user can no longer reach. | Add an explicit tab-disposal/forget operation and call it from the tab-close lifecycle, or document and enforce a bounded tab lifetime/retention policy. Preserve state while a tab is merely switched away from. |

## Explicit checks

1. **#81 hard check — PASS.**
   - **(a)** `hasSeen` and `markSeen` are synchronous methods over `Map<tabId, Set<fenceKey>>`; neither awaits nor crosses tab keys: `display-dock.state.ts:314-326`. The sync sequence therefore has no async interleave at this boundary.
   - **(b)** `setSurfaces` reconstructs view state only for published surfaces and calls `retainViewState(previous, surface.retainedViewStateIds)`: `display-dock.state.ts:284-310`; the helper drops non-retained component and draft ids: `:386-406`.
   - **(c)** Every `ChatTranscriptComponent` owns a `PTAH_UI_HOST_SOURCES` provider which resolves that component's `display.hostSources`: `chat-transcript.component.ts:185-197`; the headless sync is nested in that transcript template: `chat-transcript.component.html:124-138`. `ChatViewComponent` provides the store and two dock ports, not host sources: `chat-view.component.ts:241-256` (provider block) and no `PTAH_UI_HOST_SOURCES` provider there.

2. **#94 — PASS.** The two new projections consume current slot records, not the structurally cached message array: display candidates use `view.slots.map((slot) => slot.record())` with `view.streamingBoundary` at `transcript-display-feed.ts:87-97`; host sources map `input.slots().map((slot) => slot.record())` at `transcript-ptah-ui-host-sources.ts:51-56`; summaries read each slot record at `transcript-turn-summaries.ts:156-165`. No new Phase 5 projection uses `vm().messages`.

3. **#104/#105 — PASS.** The shared loader stores only the promise/module namespace and removes a rejected attempt: `transcript-turn-recap-loader.ts:23-37`. The summary requester is single-flight, clears `loading` on both resolution and rejection, and the next eligible input publication requests the cleared loader again: `transcript-turn-summaries.ts:115-118,187-204`. Completion writes only the namespace after the lifetime guard (`destroyed`): `:191-198`, while `setSummaries` is a synchronous effect over current `tabId()` and current derived summaries: `:119-128`. This prevents an old completion from writing stale turns or another tab's map after remount.

4. **#109 — PASS.** The dock `@error` branch keeps the error visible and, while open, mounts one eager `ptah-agent-monitor-panel` with the Electron session, overlay, and close bindings: `chat-view.component.html:303-332`. It does not attempt to mount the failed dock again, so Agents remains reachable when the lazy dock chunk fails.

5. **#100; #108/#110 VS Code preservation — PASS.** `_userExplicitlyClosed` is absent from ChatView; `panelState` delegates the auto-open/user-close rule to `DisplayDockState` for Electron and uses a private, non-injectable instance for the VS Code monitor path: `chat-view.component.ts:428-448`. Agent activity calls store-owned `requestAgentsOpen`/`releaseAgentsUserClose`: `:1315-1324`; toggle and close route to `toggle`/`close`: `:564-576`. The Electron-only provider gate means no transcript can inject the private VS Code store: `:241-256,428-437`.

6. **#112 — PASS (acceptable, no defect).** A replay rebuild can show the Displays dot while Agents is active because `seenDisplaySeq` belongs to the mounted dock rather than the store: `display-dock.component.ts:258-292,314-320`. It is an inactive-tab indicator only—`hasNew` cannot open or select a tab—and it is suppressed on the active Displays tab. This does not violate R1.9's no-auto-open requirement. The wording can be mildly surprising for replayed, previously seen content, but there is no state mutation or user-path failure warranting a defect.

## Five logic questions

1. **Silent failure:** A rejected lazy recap chunk is deliberately non-fatal; it logs and omits summaries (`transcript-turn-summaries.ts:195-203`) rather than falsely reporting success. The Electron dock failure is surfaced by a role alert and preserves Agents access (`chat-view.component.html:313-331`).
2. **Unexpected user action:** Closing the unified dock on Displays deliberately suppresses later agent auto-open until agents settle; this is store-owned (`display-dock.state.ts:152-164,255-271`) and matches decision #100. No contrary path was found.
3. **Wrong-answer input:** Content-only streaming writes are handled from slot records, so a display fence or agent facts do not lag a structural message update (`transcript-display-feed.ts:87-97`; `transcript-ptah-ui-host-sources.ts:51-56`).
4. **Dependency failure/timeout/wrong shape:** Dynamic recap import rejection clears the shared attempt and preserves the transcript; a subsequent eligible publication retries (`transcript-turn-recap-loader.ts:26-37`; `transcript-turn-summaries.ts:187-204`). Summary actions catch rejected host actions and render an error rather than claiming completion (`display-dock.component.ts:387-407`).
5. **Missing requirement:** The requirements do not define when closed-tab dock data is released. The retained-state finding above is the remaining lifecycle gap.

## Notes

- Reviewed the complete Phase 5 production scope named in the request, including the full `DisplayDockState`, transcript projections/wiring, dock component, ChatView integration, monitor move, and changed chat-ui entry/sidebar files; also examined the Phase 5 targeted specs for rejection/retry, remount, distinct-tab publication, and replay/dot coverage.
- No `ptah_*` diagnostic tool was exposed in this session. I did not run a new heavy suite; the batch records report the scoped chat/chat-ui Jest, typecheck, and lint runs passing. Those records are supporting evidence, not a substitute for the path analysis above.
- No style/naming findings are included.
