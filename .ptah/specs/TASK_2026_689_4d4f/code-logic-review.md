# Code Logic Review - TASK_2026_689_4d4f

Review family: Anthropic (reviewer) vs codex (implementer)

Scope: `git diff 858520a9d..HEAD -- libs/` (batches A, B, C, D1, D2, D3, E). I read in full: `scene/command-scene.component.ts` and `.css`, `command-streams.component.ts` and `.css`, `command-core.component.ts` and `.css`, `command-status-groups.component.ts`, `command-connectors.component.ts`, `connector-geometry.ts`, `scene-placement.ts`, `scene-measurement.ts`, `components/command-overlay.component.ts`, `command-overlay-placement.ts`, `command-overlay-positioner.ts`, `command-center-page.component.ts`, plus the overlay, scene and streams specs. I ran Jest once on `scene/` and `components/command-overlay*`: 11 suites, 64 tests, all pass. I did not run typecheck or lint. Everything below is paths relative to `libs/frontend/command-center/src/lib/`.

## Verdict

**APPROVED WITH FIXES** - score **6.5/10**.

| Severity | Count |
| --- | --- |
| Blocking | 0 |
| Serious | 3 |
| Minor | 10 |

No approved capability was lost without approval. The placement, projection, selection, roving-focus, overflow and live-region contract is intact. The weak spots are the fixed-position plate, which loses the scroll-following the old FloatingUI path had, and a pin that outlives its node. Several of the D2 test removals were replaced by weaker or vacuous tests.

## Preserve contract (checked)

| Item | Status | Evidence |
| --- | --- | --- |
| Projection / controller feed | Kept | Page passes `page.projection()`, `selectedId`, `theme`, voice, levels (`components/command-center-page.component.ts:173-179`). |
| 23-node cap, 4-tier priority, ancestors, projection order, overflow split | Kept, logic identical to old `layoutScene` | `scene/scene-placement.ts:34-107` vs the old `scene-layout.ts:71-114`. Only difference: root now also requires `kind === 'root'` (`:46`), which is harmless. |
| Selection | Kept | `command-center-page.component.ts:453-456` (`store.select` then `overlay.activate`). |
| Hover / pin / 150ms / 200ms | Kept | `command-overlay.component.ts:9-10,182-208`. |
| Keyboard + roving focus | Kept | `command-streams.component.ts:43,165-184` (Arrow, Home, End, Escape). Enter and Space come from native `<button>`. |
| Work-list focus | Kept | `command-streams.component.ts:79`, `command-overlay.component.ts:171`, page `:463-469`. |
| Voice ring, 7 states | Kept, with one regression (M2) | `scene/command-core.component.css` ring rules. Old muted was dashed and old stopped solid; both are now dashed. |
| Per-tribunal phase arcs, lane satellites | Kept | `command-streams.component.ts:60-65,135-141`, `:33`. |
| Reduced motion from the store, no matchMedia | Kept | `command-center-page.component.ts:179`; `grep matchMedia` in `scene/` and the overlay returns nothing. The CSS `@media` fallback is not TypeScript. |
| Visibility pause | Kept | `command-scene.component.ts:66,78,96`, wired to the core (`:34`) and streams (`:27`). |
| Theme feed | Kept | `command-scene.component.ts:21`. |
| Rail / dock order, one live region | Kept | The only `aria-live` is `command-work-list.component.ts:33`. |
| Approved removals only | Yes | No `canvasUnavailable`, anchoring APIs or sphere palette remain. `grep canvas` in non-spec sources is clean. |
| Repo rules | Pass | No `console.*`, `any`, `as unknown as`, `@ts-ignore` or `innerHTML`. Components are OnPush and standalone with `input()` / `output()` / `inject()`. Only transform and opacity animate. `lucide-angular` is the only import and it already exists. |

## N2 / M-R4 / M-R5 (checked)

- **Hover never reserves height.** `command-overlay.component.ts:238` sets `EMPTY_PLATE_RESERVATION` for the preview branch, and `setReservation` dedupes (`:241-246`). Only `placePinnedPlate` produces a non-empty reservation (`command-overlay-placement.ts:81,98-102`).
- **Synchronous release.**
  - Close button, Escape and outside click all go through `unpin` -> `closeCard`, which calls `setReservation(EMPTY)` in the same stack (`:142-152`).
  - A selection change goes through the effect at `:94-98`, which is a microtask-order effect rather than synchronous with the store write. It is acceptable, because `activateNode` sets `selectedBeforePin` first.
  - Destroy releases at `:105`.
- **Preview.**
  - It is pointer-inert (`:21`).
  - Next-row switching works: `requestOpen` replaces the open timer and the generation token guards stale timers (`:182-196`).
  - Stacked layouts suppress it twice, at `:191` and in `command-overlay-placement.ts:122`.
  - Obstacle test rejects any candidate that touches a row, the dial, a card or the viewport (`:125-126`).
- **Plate geometry.** It is 8px below its row with width `min(256, content)` (`:73,93`). The root pin sits 8px below the dial (`:75-79`).
- **Connectors under cards.** The connector host is z-index 0 (`scene/command-scene.component.css:130` plus the inline host style); streams, core and status groups are z-index 1 in every container mode (`:131`). The CSS is correct. The test claiming this is not (see finding 3).

## Test-coverage concerns from the orchestrator

| Removed test | Behaviour still exists? | Still tested? |
| --- | --- | --- |
| selects from a plate by click, Enter and Space through the page store | The plate has no select action any more. Selection is the row `<button>` click -> `activateNode` -> `store.select` (`page:453`). Enter and Space are native-button synthesised clicks. | Partly. `streams.spec.ts:37-60` covers click and re-click. `scene.spec.ts:20-41` covers selection output through the real scene. Enter and Space are never exercised, which is a jsdom limit. No test covers the page-level path from scene to `store.select`, because the page spec stubs the scene (`SceneStubComponent`). |
| removes card motion classes when reduced motion is set | The plate has no motion classes now, so nothing is lost. The overlay `reducedMotion` input (`:61`) is declared and never read. | Nothing to test. Loader freeze is tested (`streams.spec.ts:87-102`) and ring freeze is tested (`core.spec.ts:41`). |
| emits selection ... releases listeners and observer on teardown | The behaviour exists (`command-scene.component.ts:83-89`). | Lost in part. `scene.spec.ts:40` asserts only `disconnect` was called once. `cancelAnimationFrame`, `removeEventListener('visibilitychange')`, the destroyed guard, `geometryChange(null)` and the visibility-pause input are untested. The mock `ResizeObserver` never fires. |
| shows compact provider and state without an unknown placeholder | The overlay still hides "unknown" (`overlay:112-115`). The stream row prints "Session" for unknown (`streams:126-129`). | Lost. The overlay spec has no provider or state test. `streams.spec.ts:25` covers only the unknown icon. |
| uses one card ... fallback focus for a hidden trigger | One `@if` card, and `restoreFocus` has the fallbacks (`overlay:165-172`). | The Escape test is named "restores its trigger or rail focus" but asserts only `pinnedNodeId() === null` (`overlay.spec.ts:79-86`). Focus is never asserted. |
| new "composes cards below the decorative connector layer" | The CSS places cards above the connectors, which is correct. | The name is inverted ("cards below ... connector layer") and the assertion checks only that one SVG and four cards exist (`scene.spec.ts:43-51`). jsdom does not load `styleUrl`, so it cannot check z-order. The test proves nothing about M-R4. |

## Findings

### Serious

**1. The pinned plate does not follow page scroll, and is not clipped when its row scrolls out of the list.**
- File: `components/command-overlay.component.ts:99,209-240`; `components/command-overlay-positioner.ts:25-33`.
- The plate is `position: fixed` with viewport coordinates from `stage.getBoundingClientRect()` taken during `position()`. `position()` runs only after Angular render, and the scene re-measures only on stage resize, row focus or `.stream-viewport` scroll (`command-streams.component.ts:31`).
- The page host is the scroller (`overflow-y-auto`, `command-center-page.component.ts:31`). Scrolling it fires no re-position, so a pinned plate detaches from its row and floats over the rail, dock or header.
- Scrolling the stream list moves the row (the measurement lags one frame). Once the row leaves the 10/6/4/3-row viewport, the plate keeps its `row.y + row.height + 8` position, outside the clipped list, on top of other rows and the "View all work" button. The old path used `FloatingUIService`; that scroll tracking was dropped.
- Required change:
  - Add a single throttled (rAF) `scroll` listener, `{ capture: true, passive: true }` on the page scroller or on `document`, active only while a plate is open, and removed on close or destroy.
  - Have that listener call `scene.requestMeasure()` and `position()`.
  - In `placePinnedPlate` for stream anchors, hide the plate (visibility hidden) when the row rect is not fully inside `streamViewport`. Alternatively clamp it.
  - Add a unit test for both.

**2. A pin outlives its node: stale reservation, stale slot and stuck pin state.**
- File: `components/command-overlay.component.ts:70,209-214`; `scene/command-scene.component.ts:38-40`.
- If a pinned node leaves the projection (session end, "New Command Center", terminal cleanup), `activeNode()` becomes null. The card unrenders, so `position()` returns early at `:214` and never runs `unpin`.
- `pinnedNodeId`, the document `pointerdown` listener and the last reservation all stay. The stage keeps `--plate-reserve` (`page:75,169`), plus the root-plate-slot when the root was pinned (`scene:38-40`). Hover is ignored while pinned (`:90`), and the only exit is a stray click.
- Required change:
  - Add an effect (or a guard in `activeNode`) that calls `closeCard()` when `pinnedNodeId()` is set and no projection node has that id.
  - In `position()`, treat a missing card with an existing pin as a state to repair.
  - Add a test that deletes the pinned node from the projection and asserts that `reservationChange` emits `EMPTY_PLATE_RESERVATION` and that the pin is null.

**3. Test-coverage regressions from D2 (see the table above).**
- File: `scene/command-scene.component.spec.ts:20-51`; `components/command-overlay.component.spec.ts:79-86`.
- The z-order test is mis-named and asserts nothing about z-order. The M-R4 fix is one of the three gate fixes.
- Teardown (rAF, `visibilitychange` listener, `geometryChange(null)`) and visibility pause have no coverage.
- The Escape test claims focus restoration and checks nothing.
- Hover never reserving height is not asserted. No overlay test covers the destroy-releases-reservation path, or the `<960px` suppression in `requestOpen`.
- Required change:
  - Rename the z-order test to "stacks cards above the connector layer" and assert the contract. Either read the real stylesheet through a CSS-text assertion, or at least check DOM order and the connector host's `z-index`. Better: add a Playwright or visual check.
  - Add scene tests: fire the `ResizeObserver` callback, dispatch `visibilitychange` with `document.hidden` true and assert the `reducedMotion` input passed to streams and the `visibilityPaused` input passed to the core, destroy and assert `removeEventListener` and `cancelAnimationFrame` (spy on both).
  - Make the Escape test assert `document.activeElement` is the row, root or work-list fallback.
  - Add a preview test asserting zero reservation emissions.

### Minor

4. **Status cards use text glyphs** (`scene/command-status-groups.component.ts:99,104,109,114`: `↗ ◇ ✓ ◌`) although the user asked for lucide icons for states. Use `LucideAngularModule` with `aria-hidden` icons and keep the visible state word.
5. **Escape cannot dismiss the preview.** `command-center-page.component.ts:184` binds `(escape)="overlay?.closePinned()"`, which is a no-op when nothing is pinned. After a pin closes, the overlay effect (`:88-93`) re-runs, because `pinnedNodeId` is one of its dependencies, and re-opens the preview 150ms later. This happens while the row stays focused or hovered, since `page.hoveredNodeId` still holds the id. Add a "preview dismissed until hover changes" flag; this meets WCAG 1.4.13.
6. **Muted and stopped lost their distinction.** `scene/command-core.component.css` makes both dashed grey; the old code drew stopped solid and muted dashed (`command-scene-renderer.ts` old `drawVoiceRing`). Make `stopped` solid.
7. **Measurement edge cases.**
   - `command-scene.component.ts:102,114` return without clearing `geometry`, so stale geometry persists if the viewport or a card disappears.
   - `:99-101` query child-private classes (`.stream-viewport`, `[data-status-card]`), contradicting the plan's rule that "no component measures another component's private DOM".
   - A pinned plate whose geometry is null (before the first measure, or if `ResizeObserver` is missing) is `fixed` with no coordinates (`overlay:19-20`, `:214` early return). Set `visibility: hidden` until the first placement.
8. **Pin whose row is missing from geometry steals focus.** `overlay:220` calls `unpin(true)` -> `restoreFocus` when `placed` is null. A re-prioritised projection that drops a pinned, selected-then-demoted row out of the 23-node subset moves focus to the work list unprompted. Use `unpin(false)` here.
9. **Unknown provider copy is inconsistent.** The row shows "Session" (`streams:127`) while the plate hides it (`overlay:113`). Pick one.
10. **ARIA nuance.** `aria-expanded` is set on rows and root, but there is no `aria-controls` to `command-plate` (`streams:42`, `core:30`). Activating an expanded row re-pins rather than collapsing (`page:453-456`), which is intentional per the plan but odd for an expanded button; mention it in the accessible name or drop `aria-expanded`.
11. **SVG gradients use the default `objectBoundingBox` units** (`command-connectors.component.ts:139-154`). A perfectly horizontal or vertical ribbon has a zero-height or zero-width bounding box and paints nothing. Use `gradientUnits="userSpaceOnUse"`.
12. **Root reservation is applied twice.** `scene:39` makes the slot `reservedHeight` tall while the page adds `--plate-reserve` as `min-height` (`page:75,169`). Harmless, but the stage can be taller than needed. The root plate also reads the reserved stage height to size itself (`command-overlay-placement.ts:75`), which converges only because the sizing is monotonic; add a test.
13. **Duplication.** `StatusCounts` is defined in both `command-status-groups.component.ts:3` and `scene-placement.ts:13`. `age()` is duplicated in `overlay:116` and `streams:150` (and is not reactive: "just now" does not tick until a re-render). Unrelated to correctness, but worth routing to the style review.

## Five logic questions

1. **Silent failure.** `measure()` aborts quietly (finding 7); a connector `route()` that fails returns no ribbon (`connector-geometry.ts:133`) with no signal, though the cards still work. A pin whose node disappears keeps its reservation (finding 2).
2. **Unexpected user action.** Scrolling the page while a plate is pinned (finding 1). Pressing Escape on a focused row only to see the preview return (finding 5). Clicking an already-pinned row re-pins instead of collapsing (finding 10).
3. **Wrong answer from valid data.** A row scrolled out of the list keeps a plate that points at nothing (finding 1). A horizontal ribbon with a zero-size gradient box paints nothing (finding 11).
4. **Dependency failure.** No `ResizeObserver` (old browsers or non-browser hosts) would throw inside `afterNextRender` at `command-scene.component.ts:76`, as an uncaught error before `visibilitychange` is registered. `getComputedStyle` and `getBoundingClientRect` are guarded only by null checks on the elements.
5. **Missing, never specified.** Pointer-leave dismissal for keyboard focus when the pointer re-enters (fine); a toggle semantic for the expanded row; scroll tracking for fixed overlays; a component test that composes the real scene, overlay and geometry together (the page spec uses a stub scene, so the geometry -> overlay -> reservation -> stage loop is verified only through `scene` and `overlay` separately).

## Data flow

| Step | Status |
| --- | --- |
| Projection -> `placeScene` (`scene:63`) | OK. Faithful port; a cyclic or orphaned chain is skipped. |
| Rows render -> `requestMeasure` (`scene:82`) | OK. A single rAF is deduped and cancelled on destroy. No generation token is needed, because each frame re-reads the live DOM. |
| Measure -> `buildSceneGeometry` -> `geometry`, `geometryChange` | OK with finding 7 (stale geometry on early return). |
| Geometry -> connectors | OK, pure and null-safe (`connector-geometry.ts:105`). |
| Click -> `activateNode` -> `store.select` + `overlay.activate` | OK. `selectedBeforePin` is set after the store write, so the selection effect does not unpin. |
| Overlay `position()` -> `reservationChange` -> page `--plate-reserve` + scene `inlineSlotHeight` | OK for pin and release. Gap: stale pin (finding 2), scroll (finding 1). |
| Close paths -> `EMPTY_PLATE_RESERVATION` | OK and synchronous for close button, Escape, outside click and destroy. |

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Preserve contract (13 items) | COMPLETE | Voice ring muted/stopped (finding 6). |
| N2 hover does not reserve | COMPLETE | Not asserted in a test. |
| M-R4 connectors under cards | COMPLETE in CSS | The test is wrong (finding 3). |
| M-R5 plate near its row | PARTIAL | Holds at rest; breaks on scroll (finding 1). |
| User icon request for states | PARTIAL | Rows use lucide icons; the status cards still use text glyphs (finding 4). |

Implicit requirements not addressed: scroll tracking for fixed overlays, a teardown path for a node-removed pin, Escape dismissal of the hover preview.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty projection / no root | YES | `EMPTY` placement; "No root session" (`core:43`) | None |
| Cyclic or orphaned ancestors | YES | Skipped (`scene-placement.ts:70-83`) | None |
| 24+ nodes | YES | Cap 23, overflow link | None |
| Stacked width <960px | YES | Preview suppressed (`overlay:191`) | The overlay test lacks it |
| Pinned node removed | NO | Card unrenders, reservation stays | Finding 2 |
| Page or list scroll with pin | NO | Plate does not follow | Finding 1 |
| Reduced motion / hidden document | YES | `reducedMotion() \|\| visibilityPaused()` | Teardown untested |
| Measurement unavailable | PARTIAL | Rows and cards still work; plate is unpositioned | Finding 7 |

## Confidence

Confidence: HIGH on the static findings (1, 2, 3, 5, 6, 8). MEDIUM on finding 1's visual effect: I did not run the app, so what the detached plate covers is inferred from the CSS and code.

## Re-review (fix round)

Review family: Anthropic (reviewer) vs codex (implementer). Scope: `git diff edc93bd93..3c52df9e2 -- libs/` (commit 3c52df9e2). I read the changed overlay, placement, scene, streams, core, status-groups, connectors and page code. I ran Jest once on `scene/`, `components/command-overlay*` and the page spec: 12 suites, 94 tests, all pass. The only warning was the known worker-teardown notice. Paths are relative to `libs/frontend/command-center/src/lib/`.

**Verdict: APPROVED. Score 8/10. Blocking 0, Serious 0, Minor 3 (new, non-gating).**

### Closure of the 13 findings

| # | Status | Evidence |
| --- | --- | --- |
| 1 Scroll following and clipping | Closed | `components/command-overlay.component.ts:145` registers one `{capture, passive}` document `scroll` listener, and `closeCard` and destroy remove it. It only emits `repositionRequested`, which the page routes to `scene.requestMeasure()`, so the single rAF scheduler (`scene/command-scene.component.ts:92-95`) coalesces the work. The plate's own and the stream list's scrolls do not loop, because `position()` only writes styles. `components/command-overlay-placement.ts` adds `visible` (the whole row inside the stream viewport), and `position()` hides the plate when false while keeping the reservation. |
| 2 Pin outlives node | Closed | An effect closes the pin when its id leaves the projection (`components/command-overlay.component.ts:107-110`). `position()` also repairs a pin with no active node (`:228`). `closeCard` releases the reservation, the listeners and the pin synchronously. |
| 3 Coverage | Closed | The z-order test is renamed "stacks cards above the connector layer". It asserts inline z-index 0 against 1 and DOM order (`scene/command-scene.component.spec.ts:47-63`). Enter and Space, teardown, visibility, null geometry, preview reservation, focus return, unknown provider and destroy cases were added. Z-order is still checked through inline styles, not the real stylesheet, which is acceptable. |
| 4 Status glyphs | Closed | `scene/command-status-groups.component.ts` renders four lucide icons with `aria-hidden` plus the visible title. |
| 5 Escape and preview reopening | Closed for Escape | `onEscape` and `closePinned` call `dismissHover()`. `dismissedHover` blocks reopening until the hovered id changes or goes null (`components/command-overlay.component.ts:88-97`). See residual N1 for the focus-restore paths. |
| 6 Muted / stopped | Closed | `scene/command-core.component.css:21-22` (muted dashed, stopped solid). |
| 7 Measurement / null geometry | Closed | The scene reads the children through `measurementElements()` public methods. It clears stale geometry (`clearGeometry`). It guards `typeof ResizeObserver`. `position()` hides the card when geometry is missing (`:229`). |
| 8 Missing row steals focus | Closed | `components/command-overlay.component.ts:235` calls `unpin(false)`. |
| 9 Unknown provider copy | Closed | `providerName` returns "Session" (`:121`), matching the row. |
| 10 ARIA | Closed | `aria-controls="command-plate"` on pinned rows and root (`scene/command-streams.component.ts:44`, `scene/command-core.component.ts:31`). |
| 11 Gradient units | Closed in effect, see N2 | `userSpaceOnUse` is used. |
| 12 Double reservation | Closed | `command-center-page.component.ts:169` excludes root pins from `--plate-reserve`. The core-column slot supplies the height. |
| 13 Duplication / age tick | Closed | `StatusCounts` has one source. `formatWorkAge` is shared. The page ticker is one interval created inside an effect with `onCleanup` (`command-center-page.component.ts:427-432`). |

### New observations

- **N1 (Minor). The preview can reappear after a non-Escape unpin.**
  - `components/command-overlay.component.ts:164-168`: `unpin` records `dismissedHover = hoveredNodeId()`, then restores focus to the row.
  - When the pin is closed with the × button or by an outside click, the hovered id may already be null. The focus restore then emits `hover(id)` from the row's `(focus)` handler, which differs from the recorded null. The preview opens about 150ms later (a pure preview, no reservation).
  - Fix: in `unpin(true)`, set `dismissedHover = id`.
- **N2 (Minor). The ribbon gradient is now stage-diagonal.**
  - `scene/command-connectors.component.ts:16-28`: `userSpaceOnUse` runs from (0,0) to (stageW, stageH) for all four gradients. Each ribbon therefore shows only the slice of the gradient where it sits, so the start and end colours the design intended per ribbon may not appear.
  - Fix: set each gradient's `x1/y1/x2/y2` per ribbon from `ribbon.start` and `ribbon.end` (one gradient per ribbon).
- **N3 (Minor). Scroll repositioning lags the scroll by a frame.**
  - The fixed plate follows the scroll through a measure then a render then `position()`.
  - Fix: acceptable as is. If a visible wobble shows up in the Electron check, set the plate's top from `stage.getBoundingClientRect()` inside the rAF directly.

### Residual risk

I did not run the app. The plate's behaviour under real page scroll is inferred from the code and the unit tests. The Electron visual check is still the only evidence for the end-to-end look.
