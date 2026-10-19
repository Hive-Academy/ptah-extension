# Code Logic Review - Phase A (A1, A2a, A2b) - TASK_2026_700_dcce

Score: 6/10. Verdict: NEEDS_FIXES.

Scope read: command-center-page.component.ts/.html/.css, command-center-header.component.ts, controller diff, start and stats component diffs, the page spec ResizeObserver and rail tests. I did not run tests (the orchestrator reported 538/538). Capability parity for the header, start view and stats cells was spot-checked against the diff, and no loss was found. The defects are in the new layout and measurement code.

## Findings

1. **Stats band height is measured as the content box, so the scene under-reserves.** MUST-FIX. Serious.
   - File: `command-center-page.component.ts:272-280` (`observeStatsBand`, `entries[0]?.contentRect.height`).
   - Cause: `.stats-band` is `box-sizing: border-box` with 16px vertical padding and a 1px bottom border (`command-center-page.component.css:12`). `contentRect.height` excludes padding and border, so a 72px band reports about 39px, 144px reports about 111px, and 154px reports about 121px.
   - Effect: `[reservedTop]` is about 33px too small. The scene starts at reservedTop + 10 (`command-scene.component.ts:181`), so spheres and the root plate sit under the opaque band. This breaks the design-spec rule that the scene starts at band bottom + 10px.
   - The page spec mirrors the bug: it feeds `{ contentRect: { height: 144 } }` and expects 144 (`command-center-page.component.spec.ts:595-597`). That is why the tests pass.
   - Fix: read `entry.borderBoxSize?.[0]?.blockSize`, falling back to `band.getBoundingClientRect().height`, or `offsetHeight`. Update the spec to deliver `borderBoxSize`.

2. **The observer is never re-attached when the band element is recreated.** MUST-FIX. Serious.
   - File: `command-center-page.component.ts:274`.
   - The guard `|| this.bandObserver` stops any re-observation. The band lives inside `@else` (marked tab) and `@if (!canvasUnavailable())`.
   - If the start view is shown again (the marked tab is cleared) and the deck then returns, the new `#statsBand` element is not observed. The old observer watches a detached node, and `statsBandHeight` freezes at the last value. After a viewport-class change (72 vs 144), the scene reservation is then wrong.
   - Fix: keep `observedEl`. When `statsBand()` differs from `observedEl`, call `disconnect()` and `observe()` on the new element, and disconnect when it becomes undefined. Keep the single instance and the `typeof ResizeObserver` guard. Add a test that toggles `markedTabId` off and on.

3. **The rail clips the pending question and approval cards.** MUST-FIX. Serious.
   - File: `command-center-page.component.css:6-8`.
   - `.rail` is `overflow: hidden` and `min-height: 0`. Every child except the work list is `flex: 0 0 auto`, and the work list is allowed to shrink to 0.
   - When the selected-work card, the record-failure notice, the pending-input or proposal card and the latest reply together exceed the rail height (about 600px + 14px + the dock height), the extra content is clipped with no scroll. The work-list scroller shrinks to 0 first.
   - Effect: a pending approval or question can be unreachable at 900-1000px wide. This is a lost capability. The 720px stacked layout is fine.
   - Fix: give `.work-list-region` a floor (for example `min-height: 8rem` or `flex: 1 1 8rem`) and make `.rail` `overflow-y: auto`. Alternatively, allow only the upper cards to scroll. Add a layout-agnostic test that the pending card is reachable.

4. **Container queries on `:host` against viewport `@media` in the dock.** Moderate. Not must-fix.
   - File: `command-center-page.component.css:13-16` against `command-dock.component.ts:26,35` (`@media` 1100 and 720).
   - The page switches on host width. The dock switches on viewport width. If the host is narrower than the viewport (sidebar, panel), the page and dock disagree. Example: viewport 1150 with a 1000px host gives a compact rail while the dock still uses its 1100+ row layout. At 1440, 900 and 720 with the page filling the viewport, the combination gives the approved rows.
   - Fix: convert the dock to `@container` queries, or document the full-viewport assumption in the spec.

5. **`100vh` row math.** Moderate. Not must-fix.
   - File: `command-center-page.component.css:2`.
   - `max(600px, calc(100vh - 246px))` uses the viewport height, not the host height. The host is `h-full overflow-y-auto`, so extra chrome above the page (tab bar, title bar) makes the stage taller than the visible area and forces an inner page scroll. At 900px high the result is 654px, not the approved 600px.
   - Fix: use the host's container height, or cap at 600px (`clamp`) if the approved capture is 600px at 1440x900.

6. **Initial `statsBandHeight` is 72.** Minor.
   - File: `command-center-page.component.ts:181`.
   - Below 1100px the band is 144px until the first observer callback, so the scene lays out once with the wrong top. This needs no change after fix 1, but seed it from `getBoundingClientRect()` on the first render for a flicker-free first frame.

7. **The theme toggle is a dead button without ThemeService.** Minor.
   - File: `command-center-page.controller.ts:58-62`.
   - `darkMode` defaults to `true` and `toggleTheme` is a no-op, but the header still shows the button. Hide it with an `hasTheme` input, or accept this as the host contract.
   - The scene follows the theme through the existing effect (`controller.ts:197-199`), and `isDarkMode` is read from the same signal. Binding sync is OK.

8. **Spec quality.** Minor.
   - `command-center-page.component.spec.ts:538-542` rewrote the rail-scroller test as regex matches on the CSS source (`overflow: hidden`, `overflow-y: auto`). It is a string-mirror test and would not catch finding 3. N2 required asserting the fill-height scroller.
   - The N2 selectors were updated with a reason (`.stage .stats-band .stage-caption p:nth-child(2)`), which is acceptable.
   - Add a behavioral assertion in the ResizeObserver spec (see findings 1 and 2).

## Checked and OK

- N3: the ResizeObserver is guarded by `typeof ResizeObserver`, is a single instance, and is disconnected in `onDestroy` (`component.ts:260-262`).
- D7: the dock `(newSession)` calls `coordinator.newCommandCenter()`, not `chooseCurrentTab`.
- D9: no Open tab or child navigation was added.
- The draft is cleared through `dock().clearDraft(text)` only after `sendCommand` returns true.
- The `submitting` guard prevents a double send.
- Toasts, the retry buttons, the record-write-failure notice, the latest reply, the pending scroll and cue, and the canvas-failure list-only fallback are all retained.
- Stacking order for 720px and below is stage, dock, rail, which matches the DOM order with `flex-direction: column`.
- The start view keeps its disable-while-choosing behavior, the recorded mark, the hasTranscript note, the Retry button, and the livePhase and isActive labels. The activity bars were removed as the design spec requires.
- Unknown stats cells are omitted, and the provisional and known-subtotal wording is retained.

## Must-fix list

1. Finding 1: use the border-box height for `statsBandHeight`.
2. Finding 2: re-attach the observer when the band element changes.
3. Finding 3: stop the rail from clipping the pending-input, proposal and selected-work cards.

## Fix verification

| Item | Verdict | Evidence |
| --- | --- | --- |
| 1. Band height | Fixed | `command-center-page.component.ts:278-280` uses `borderBoxSize[0].blockSize`, falling back to `getBoundingClientRect().height`. The spec now supplies a 144px border box against a 111px content box. |
| 2. Recreated band | Fixed | `command-center-page.component.ts:271-286` tracks `observedBand`, keeps one observer, unobserves the old element, observes the new one, and keeps the `typeof ResizeObserver` guard. The callback filters on the current target. |
| 3. Rail clipping | Fixed | `command-center-page.component.css:6,8`: `.rail` is `overflow-y: auto` and `.work-list-region` has `min-height: 7rem`. Below 720px the rail is `overflow: visible`. |
| 4. Dock breakpoints | Fixed | `command-dock.component.ts:26,35` use `@container`. The dock sets no container-type of its own, so it resolves to the page host. Reduced motion stays `@media`. |
| 5. CUSTOM_ELEMENTS_SCHEMA | Fixed | No schema reference remains in the page component. The harness scene stub declares `reservedTop`. Typecheck and 539 tests pass per the orchestrator. |

New defects: none found. Residual (not blocking): the `100vh` row math (earlier finding 5) is unchanged and is accepted as the approved-capture assumption.

Final verdict: APPROVED.
