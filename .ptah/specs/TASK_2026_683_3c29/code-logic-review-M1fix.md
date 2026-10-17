# Code Logic Review - M1 fix (TASK_2026_683)

Review family: reviewer: Claude; implementer: codex

Score: 7/10. Verdict: APPROVED (no Critical or Serious findings).

Scope: `surface-view-transitions.ts` and its spec (whole files), the perf-spec diff (attribution, probe, asserts, persist), plan :170-186, :796-815, :905, decisions O14/O15. Nothing was run: no Jest mutation check (the listener body is the only thing that calls `skip`, so the three skip tests cannot pass without it), no Electron. Remaining uncertainty is runtime-only (finding 1).

## Product

The fix matches plan A2. `skipOnInput` uses `this.current?.`, so it is a no-op when idle or settled. `finished` still resolves after a skip, so `settle()` runs once and queued `afterTransition` callbacks run once. The router update callback still runs after a skip. Chromium queues it as a task, so it is not dropped. One shared instance, guarded by `listening`, with removal in `destroyRef.onDestroy`. SSR is unaffected: `track()` only runs client-side after `onViewTransitionCreated`. The new tests fail without the fix: skip count 1, none before or after settle, one listener of each type, removal on destroy.

1. Moderate, `surface-view-transitions.ts:64-65`, unverified at runtime. A synthetic Playwright click sends pointerdown and pointerup back to back. If the skip lands before the update callback has run, the old DOM can still be the hit target at pointerdown. The new DOM then arrives in a later task, so the click can land on a node that was replaced. Real users have roughly 50-100 ms between the two events, so this is fine for them. The S7 re-run is the proof. Do not read a green unit spec as evidence that the click reaches the target. Fix if S7 still loses the click: also call the skip from `click` capture, or wait for `updateCallbackDone`.
2. Minor, `:65`. Any `keydown` skips the transition, including modifier-only keys and auto-repeat (`event.repeat`). It only drops the animation, so it is acceptable. Typing in the composer during the 200 ms window loses the animation, with no data effect. Ignoring modifier-only keys and repeats would be cheap.
3. Minor. `skipTransition()` rejects `ready` with AbortError. The existing comment says dev builds log this. It now happens on every user-interrupted navigation in dev. There is no production effect.
4. Minor, spec. There is no test that an `afterTransition` callback queued before an input skip still runs exactly once after `finish()`. That is the documented invariant.

## Recorder

Rail delta is fixed: `snapshot()` returns null and `delta()` (`perf.spec.ts:529`) is null unless both ends are finite. `m0RailShiftsDelta` is read with `?.`/`??` from the loaded M0 windows (`:544`). `probeVersion` stays 3 and the probe change is additive, so M0 still loads and compares. A missing M0 row still fails the "M0 record" assert. The scoped `_ptahTurnEnter` name is normalized once in the sample (`:215`) and in `recordEntrance` (`:165`). The reduced-motion filter on `type === 'CSSAnimation' && name === 'ptahTurnEnter'` therefore matches the scoped name and is not vacuous. A null `focusSwapsDelta` now fails `toBe(1|5)` where it used to be NaN, which is correct. Rail "0" became a report (O15). The evidence in O15 (counter rises with `layoutShiftAll` unchanged) is sound. The S8 and split rows now compare no-input `layoutShift` against M0, which is stricter than before and consistent with the plan.

5. Moderate, `perf.spec.ts:331-371, 731`. The motion long-task gate can pass without checking anything. `classification === 'motion'` needs a JS frame whose function name or url matches the regex (`:366`). Work caused by view transitions or CSS animations (snapshot capture, style recalc, animation frames) has no JS frame, so it is classed `render` or `unknown` and never fails. Attribution also needs the trace to contain the `ptah-motion-trace-anchor` event (`:335`) and `FunctionCall`/`EvaluateScript` children with `functionName`/`url`. If the trace categories omit user timing, or the dev build's bundled urls hide the source file names, every task is `unknown` and the assert is green. The report writes a note, but only when `stackAvailable` is false (`:430`). U2 allows render-caused excess to be reported, but a silent `unknown` is not a render finding. Fix: report the count of new >50 ms tasks by class and leave a visible marker (or fail soft) when any new >50 ms task is `unknown`. Reviewers must read `longTaskReport` before signing M1.
6. Moderate, `:366`. The regex does not include the stacks the plan names (`ChatView`, `ChatTranscript`, lane view). It also lacks `onViewTransitionCreated`. Add them or match on the source file names of those components.
7. Minor, `:724-736`. Indentation is inconsistent in the edited block (cosmetic, route to style).

## Plan pass-criteria check

- Long-task criterion is weakened only as far as O15 records, plus the gap in findings 5 and 6.
- "Rail shifts 0" is changed to a report (O15). "Layout shift 0" stays as at-most-M0 (the same as before this change).
- No NaN or undefined path remains in rail or focus deltas.
- Unchanged: S7 click receipt asserts. `finalSurface` and `inputEvents` are now captured for S7, which helps with finding 1.

## Re-review (fix round 1)

Findings 4-7 checked in the diff; findings 1-3 not re-reviewed.

- 4 fixed: the new spec queues `afterTransition` after `track`, skips on pointerdown, then asserts one callback after `finish()` and still one a microtask later.
- 5 fixed: new >50 ms tasks classed `unknown` now fail a soft assert when M0 max <= 50 ms. `longTaskNeedsReview` is also written into the report.
- 6 fixed: the motion regex now covers ChatView, ChatTranscript, CanvasLaneView, CanvasRailBoard, onViewTransitionCreated and the component urls.
- 7 fixed: indentation is consistent.
- No regressions seen.

Verdict: APPROVED. Score 8/10.

## Re-review (S7 CSS fix)

Verdict: APPROVED (8/10). No Serious findings. Nothing was run; this is CSS and code reading only.

- Mechanism correct (`styles.css:758-761`). The root group existed only because `html` had the implicit root name, and its pseudo layer overlays the page, which matched the run-2 symptom (target = HTML). With the root name removed, only `ptah-surface` is captured. Navbar, rail and dock stay live DOM. `::view-transition` keeps `pointer-events: none` (:763).
- Timing OK. `track()` adds `ptah-vt-active` synchronously in `onViewTransitionCreated`, before the next-frame old-state capture. It is removed on settle. The existing surface naming rule relies on the same timing.
- VS Code unchanged. `:has(.ptah-vt-surface)` is false there (the class is only used in `electron-shell.component.ts`), so the root cross-fade (plan rows 226-227) stays.
- The `(root)` animation rules at :779-793 match nothing in Electron; they are harmless dead CSS.
- Clicks inside the surface: the A2 pointerdown/keydown skip still covers them. Reduced motion is unchanged: transitions are skipped before `track()`, and :834 sets animation none.
- Minor (visual): with root uncaptured, the live background shows through while old/new fade at <1 opacity. Confirm the surface or html background is the same colour and that there is no flash in the frame strip. The surface group does not overlap the navbar, so there is no z-order risk. `:has()` needs Chromium 105 or later, which Electron satisfies.
- Minor: add a CSS or spec guard that `.ptah-vt-surface` is only set in the Electron shell.

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
