# Code Logic Review — TASK_2026_motion_tuning

Review family: claude (reviewer) vs codex (implementer)

Score: 6/10
Verdict: REVISE (one Serious finding)

## Findings

1. **Serious** — `chat-transcript.component.css:17-32` (new `ptahPaneSwitchLeave`, opacity 1 to 0 on `:host(.ptah-pane-switch-leave)`).
   The transcript host contains `data-glass-surface="tile"` elements (`tool-call-item.component.ts:76`, `execution-node.component.ts:354`). The requirement says never animate opacity on an element that is or contains a glass surface, because opacity below 1 makes the host a Backdrop Root and the tiles' backdrop-filter stops sampling the scene. For 180 ms, every leaving transcript with tool calls loses its glass and then vanishes. This is new in this change. The pre-existing entrance (`ptahPaneSwitchEnter`, opacity 0 to 1, lines 1-16) has the same problem, and the lane did not fix it.
   Fix: make the leave transform-only (for example a small translateY/scale) and cover the pane with the entering one, or fade a glass-free layer. Do the same for the entrance, or state the exception explicitly. The inspector stats code in this change shows the intended pattern: transform on the host, opacity only on the glass-free cells.

2. **Moderate** — `styles.css`, `ptahPageIn`: `transform: translateY(18px)` on `::view-transition-new(root)`.
   The root snapshot is the whole window. The navbar, rails and dock rise 18 px and settle over 380 ms. This contradicts the adjacent comment ("The navbar, rails and dock are the same in both snapshots and do not move"). The old opaque snapshot shows through at the bottom 18 px, so the shift reads as a jolt of the chrome. The requirement asked for a 16-20 px rise, so this may be acceptable. Consider a smaller rise on the root snapshot, or keep the rise inside the content areas only.

3. **Moderate** — `session-inspector.component.ts:~232-251`. `previousStats` and `previousSessionId` are plain closure variables. The leaving copy is `previousStats`, which is the last stats object seen. If the stats become null in between (for example during a tab switch), the old copy is still shown for the next real session change, because `previousStats` is never cleared. The effect writes signals, which is fine on current Angular, and the destroy cleanup is correct. The timer's 420 ms is a magic number tied to 380 ms (switch) plus 40 ms. It is not derived from the token, so the two drift apart if the token changes.

4. **Minor** — `chat-view.component.ts:160-162`. The windows are correct against the CSS: ENTER 640 ms ≥ 60 + 6×36 + 320 = 596 ms; LEAVE 220 ms ≥ 180 ms. They are hard-coded numbers, not read from the tokens, so the presets work will need to change both places. The presets lane (B1) is planned to make the tokens variable, so the margin could become wrong.

5. **Minor** — `chat-transcript.component.css:35` keeps `animation: none !important` in the reduced-motion block. That is pre-existing. The new rules add no `!important`.

## Timing and requirement checks

- Tokens 180/320/380/36: match (`styles.css` lines 43-46).
- Crossfade without a blank frame: the root new snapshot has an animation, and old and new use `mix-blend-mode: normal`. The old snapshot stays opaque, so there is no blank frame. The transcript leaving pane is absolute, `inset:0`, `z-index:1`, over the entering pane, so there is no blank frame there either (the `.ptah-pane-switch-leave` rule beats Tailwind's `relative` on specificity).
- Leave pane `inert` and `aria-hidden`: correct. The reduced-motion block (`display:none`) removes the leave pane.
- Inspector stats: re-animates only when the non-null session id changes; same-session stats updates and same-id tab changes do not restart it. Covered by the spec. Not covered by a test: stats going null then a new id (see finding 3).
- Glass: the stats host gets transform only. Opacity applies only to the grid cells.

## Timeout judgement (chat-transcript.display.spec.ts)

Not caused by the tuning. The evidence:
- The spec contains no animation or timer dependence. Its only timer is `setTimeout(resolve, 0)` at line 340, and the test names (turn-summary chip, loaders) concern data flow.
- The tuning changes CSS, which jsdom does not apply. In `chat-transcript.component.ts` the diff only adds a `leaving` input and host class/attribute bindings (about 6 lines), which are cheap.
- The lane's earlier full scoped run had every test pass except the old-window assertion. The timeout appeared only in the final rerun, which ran under 310-suite load.

Verdict on the claim: environmental or load flakiness, probably 5 s Jest timeout under 2 workers. I did not run the spec; running `chat-transcript.display` in isolation once would confirm it, but nothing in the diff points to the tuning.

## Checked

CSS tokens and root view-transition; transcript CSS and host bindings; chat-view enter/leave logic and constants; session inspector component, template, timer cleanup and reduced-motion; `!important` additions; glass-surface contents of the transcript; the display spec's timing dependence. Not run: tests, build, visuals (the lane also had no screenshot).

## Re-review round 1

Review family: claude (implementer: codex)

Score: 8/10
Verdict: APPROVED (no Blocking or Serious defects; 3 Moderate/Minor follow-ups)

### Previous defects

- Defect 1 (opacity on the glass transcript host), FIXED. `chat-transcript.component.css:1-9` and `:17-19` animate transform only on the scroller and host. Opacity is applied only to direct `.chat-scroll-content` children matching `:not(:has([data-glass-surface]))` (css:21-24, 36-38). Slots containing glass are cut with `visibility:hidden` (css:40-42). The pane that carries the `.ptah-pane-switch-enter` class (`chat-transcript.component.html:3`) is the ancestor of `.chat-scroll-content` (html:15), so the selectors match.
- Defect 3 (previousStats never cleared, magic 420 ms), FIXED. `session-inspector.component.ts:240-247` clears timer, leaving copy, switching flag and `previousStats` on null. The window is derived from `--ptah-motion-switch` + 40 ms (ts:43-50). Timer cleared on destroy (ts:262-264).
- Defect 4 (hard-coded windows), FIXED. `chat-view.component.ts:1093-1118` reads the tokens at each entry. The fallbacks equal the token values.
- Defect 2 (root `ptahPageIn` 18 px rise on the chrome) and defect 5 (pre-existing `!important`) were not part of this round and are unchanged.

### Checks

- Rapid switching A to B to C: `startLeave` (ts:1120-1127) clears `leavingTimer` and resets the leaving id. `startEnter` clears `enteringTimer` (ts:1094), and `overlapping` requires `enteringTabId() === resolvedTabId()` (html:63), so no overlap class sticks to a stale tab. Return to a previous tab re-arms correctly. Both timers are cleared in `ngOnDestroy` (ts:737-739) and run outside the Angular zone, so they do not cause change-detection churn.
- Incoming "ready" detection (ts:1079-1086): messages present, or status not `resuming`/`switching` and not history replaying. A same-effect-run switch of a ready tab calls `startLeave` then `startEnter`. The delayed-history path is covered by the spec "waits for history before the entrance".
- Reduced motion: the `animation: none` rules cover the entrance, overlap and per-slot fades, and the leave host gets `display:none` (css:44-55). No new `!important`.
- Glass: the overlap rule hides glass slots instantly, an intended cut exit. The pane host never gets opacity.

### Defects

1. Moderate: `session-inspector.component.ts:240-247,257-258`. The null branch clears `previousStats` but leaves `previousSessionId` set. A stats sequence A, null, B has `previousStats` null, so `changed && previousStats` is false and B does not animate (the user-visible "inspector must animate on session switch" case, if stats ever drop to null between sessions). Same-id A, null, A is fine. Fix: keep the last stats as the leaving copy for a switch that crosses one null gap, or accept the gap and add a spec.
2. Moderate: `chat-view.component.ts:1087-1100,1114-1127` and `chat-transcript.component.css:26-31`. The leave timer starts only in `startEnter`. If the incoming tab stays "not ready" (stuck `resuming`, history replay that never reports completion), the old pane stays absolute over the new one (z-index 1, inert) indefinitely and hides the new tab's loading UI. The `tabId === null` early return (ts:1071) also leaves a pending leave id with no timer. Fix: add a safety timeout, for example 1-2 s, that drops the leaving id (or force `startEnter`) when readiness never arrives.
3. Minor (test quality): `chat-view.session-enter.spec.ts:285-301` and `chat-transcript.session-enter.spec.ts:119-123` assert CSS and template as source-text regex. They would pass if a selector was cascade-overridden, and the template test only pins strings. The behavioural timer and overlap tests (spec 259-283) are real. No spec covers the A, null, B inspector path (defect 1).

Not run: tests, since the lane reports `npm run verify -- -p @ptah-extension/chat` as 3/3 succeeded; no visual check was possible.

## Re-review round 2

Review family: claude (implementer: codex). Verdict: APPROVED, 8/10. A1 is fixed: the null branch in session-inspector.component.ts keeps previousSessionId and previousStats, so A to null to B animates and A to null to A does not (tests include a token-derived 739/740ms window). A2 is fixed: chat-view.component.ts startLeave arms a token-derived safety timer (clamped 1000 to 2000ms) that is cleared on the next switch, on enter and on destroy, and a null tab id clears the pending leave (tests: unready tab at 999/1000ms, null id, token windows). The focused chat tests (chat-view, chat-transcript, session-inspector) pass. The one new finding is a B7 glass cut-exit selector that never matches; see .ptah/specs/TASK_2026_motion_presets/batch-B7-code-logic-review.md.
