
## Re-review (O12 + S7 live)

Review family: reviewer: Claude; implementer: codex. Read-only: CSS, code and m0/m1.json were read; nothing was run.

Verdict: APPROVED for O12 and for the S7-live design (7/10). The remaining `tasks-button` miss is NOT explained by this change and is not shown to be a product defect (finding 1 is a hypothesis, not a proof). No Serious finding in the code reviewed. Recommend one diagnostic probe before the next run.

### O12: `canvas-rail-board.component.ts:87` (overflow clip)

- Mechanism correct. The rule sits inside the `prefers-reduced-motion: no-preference` block, next to the animation, so it only applies where the translateX(8px) can overflow. The container and the `<section [animate.enter]>` are in this same template (:166, :169), so emulated encapsulation scopes both selectors.
- Class lifetime: `.rail-pane-enter` exists only while Angular `animate.enter` runs (180 ms). Reduced motion: the class may be added but the clip rule is not active.
- 2. Minor: `overflow: clip` turns the container into a non-scroll container for those 180 ms. If the user had already scrolled it horizontally (two 360 px panes in a narrow window), `scrollLeft` is lost and resets to 0 when `auto` returns. The entrance does not need scrolling, so only the stored offset is at risk. Acceptable; note it in the PR.
- 3. Minor: if the enter class is ever left on (animation never starts, e.g. element not rendered), the container stays clipped and unscrollable. Angular removes it on animationend, so this is low risk.
- Spec only greps the template source (`.spec.ts:459`). That is meaningful for regression of the rule, not of the visual effect (jsdom). The proof is the s8-01-012 vs s8-01-020 frames and the M1 re-run `layoutShiftAll`.

### S7 live incoming surface (`surface-view-transitions.ts:66-91`, `styles.css:754-760`)

- Timing: `ptah-vt-entering` is set in an `updateCallbackDone` microtask. The UA captures the new state in the next rendering step, after the callback is done, so the class lands first. `:not(.ptah-vt-entering)` then drops the name from the new surface and only the old group is captured. The run-4 sample at 100 ms confirms it: `ptahPageRiseIn` runs on the live surface and the only pseudo animations are the group and `ptahPageOut`.
- `finished` vs the rise: the group animation (200 ms) outlasts old-out (120 ms), so `finished` fires about 200 ms after the animations start. The rise starts when the class is added (same or earlier frame than the group). `settle()` therefore cannot cut a rise that runs to its natural end; at worst the tail is within one frame, and the final state equals the end keyframe, so no visible jump.
- 4. Moderate (cut short by design, not a bug): `settle()` also runs when the A2 skip fires. A pointerdown or keydown within 200 ms ends the transition, removes `ptah-vt-entering`, and cancels the rise mid-way. The surface then snaps to opacity 1 / translateY 0. This is visible as a pop for any click during the entrance, which is the exact case S7 exercises. If the pop is judged a regression, let the live rise finish (remove only `ptah-vt-active` on skip, or remove `ptah-vt-entering` on `animationend` of the surface).
- 5. Minor, superseded transitions: `track()` removes `ptah-vt-entering` synchronously (:69) and `settle()` ignores stale transitions (:87), so state follows the latest. The old snapshot of the next transition is captured with the in-flight rise cancelled (final state), so a rapid second navigation shows a pop from partial opacity to 1 before fading out. Cosmetic.
- 6. Minor: the `.then(..., () => undefined)` on `updateCallbackDone` swallows a rejected callback; `finished` still settles it. Fine.
- VS Code: no `.ptah-vt-surface` there, so the `:has()` root-name removal does not match and the root group rules (:779-793) stay. Reduced motion: the guard (:821) sets the surface animation to none and the pseudo animations to none; the feature also skips before `track()`.
- Test quality: the spec covers class add/remove through the tracker; the unit test cannot show the capture order, so run 4 frames are the evidence.

### Run 4: pointerdown on the Tasks view List button lands on a DIV

Facts (m1.json, `pointer-during-transition`): pointerdown #2 (Tasks rail button) is a BUTTON; pointerdown #3 is a DIV with no testId/title, `viewTransitionActive: true`. Target is not HTML, so the pseudo tree no longer swallows the event. M0 reached the button (`tasks-button: true`). The recorder clicks by coordinates: `clickCenter` (`perf.spec.ts:622-626`) reads `boundingBox()` once and calls `page.mouse.click`, with no actionability wait, right after `waitFor({state:'visible'})`.

Best hypothesis (ranked):
1. Stale or moved coordinates, not a hit-testing blocker. The box is read while the live surface is mid-animation (`ptahPageRiseIn`: opacity 0 -> 1, translateY 4 px; the Playwright box includes the transform) and while the new view is still laying out. Playwright "visible" is true at opacity 0. Between the read and the pointerdown the button moves (transform tail, lazy content), so the point falls on a wrapper DIV. M0 had no animated ancestor and a static layout, so it passed. A real user is slower than this 0-ms read-to-click.
2. A DIV overlay inside the new surface during the entering state (a loading or empty-state wrapper above the toolbar). Less likely, because `pointer-events` is not touched by the new rules.
3. The old snapshot group still hit-testing. Unlikely: the earlier HTML target is gone, and a pseudo hit would resolve to HTML again.

Cheap proof (no Electron launch needed to decide, one probe change for the next run): in the pointerdown probe record `document.elementsFromPoint(x, y)` (first 3 with tag/class/testid), the button's `getBoundingClientRect()` at that instant, and the point itself. If the button rect does not contain the point, it is hypothesis 1 and the recorder should re-read the box after one `requestAnimationFrame` (or wait for the rise) instead of changing product CSS. If the point is inside the rect and the top element is a DIV, it is hypothesis 2 and a product fix is needed.

### Does `settle()` cut the live 200 ms rise short?
Only on an early skip (finding 4). On a natural finish it ends within a frame of the rise, with an identical end state.
