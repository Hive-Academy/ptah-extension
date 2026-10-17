# Code logic review fix round

All 13 findings in `code-logic-review.md` are addressed in the Command Center library. No files outside that library and this report were edited.

| Finding | Change | Test |
| --- | --- | --- |
| 1. Scroll following and clipping | `components/command-overlay.component.ts:145,199,230` registers one capture/passive document scroll listener only for a pin and routes it through `repositionRequested` to the scene's coalesced scheduler. `components/command-overlay-placement.ts:59` marks a plate invisible when its complete row is outside the stream viewport. | `components/command-overlay.component.spec.ts:96`; `components/command-overlay-placement.spec.ts:59` |
| 2. Removed node retains pin | `components/command-overlay.component.ts:107,228` closes a pin whose id leaves the projection or whose card disappears, releasing the listener and reservation in `closeCard`. | `components/command-overlay.component.spec.ts:122` |
| 3. Coverage regressions | `scene/command-scene.component.ts:26` sets card layers above connector host in the template. Scene teardown, visibility pause, null geometry, keyboard activation, preview reservation, focus return, one-card, unknown-provider, suppression and destroy cases are asserted. | `scene/command-scene.component.spec.ts:47,66,84,113`; `components/command-overlay.component.spec.ts:42,79,158,187` |
| 4. Status glyphs | `scene/command-status-groups.component.ts:2,12-32` renders four Lucide icons with visible titles and hidden decorative icons. | `scene/command-scene.component.spec.ts:47` |
| 5. Escape and preview reopening | `components/command-overlay.component.ts:88,150-157,172` dismisses a preview on Escape and suppresses reopening until the hovered id changes. | `components/command-overlay.component.spec.ts:170` |
| 6. Voice state distinction | `scene/command-core.component.css:21-22` keeps muted dashed and makes stopped solid. | `scene/command-core.component.spec.ts:30` checks all seven rendered voice states. |
| 7. Measurement and null geometry | `scene/command-scene.component.ts:77,105-136` tolerates missing ResizeObserver, clears stale geometry on missing elements and measures through child component measurement APIs; `components/command-overlay.component.ts:20,228` keeps a card hidden until geometry exists. | `scene/command-scene.component.spec.ts:113`; `components/command-overlay.component.spec.ts:139` |
| 8. Missing row focus | `components/command-overlay.component.ts:235` unpins without restoring focus when the pinned row is absent from geometry. | `components/command-overlay.component.spec.ts:139` |
| 9. Unknown provider copy | `components/command-overlay.component.ts:121` uses “Session”, matching the row. | `components/command-overlay.component.spec.ts:158` |
| 10. ARIA relation | `scene/command-streams.component.ts:44` and `scene/command-core.component.ts:31` bind `aria-controls` to the pinned `command-plate`. | `scene/command-streams.component.spec.ts:80`; `scene/command-core.component.spec.ts:97` cover expanded state. |
| 11. Gradient units | `scene/command-connectors.component.ts:16-28` uses `userSpaceOnUse` with full stage coordinates, including for horizontal or vertical ribbons. | Existing `scene/command-connectors.component.spec.ts` exercises connector rendering. |
| 12. Root reservation | `components/command-center-page.component.ts:169` excludes root slot height from the page's extra minimum height; the slot remains in `scene/command-scene.component.ts:39`. | `components/command-overlay-placement.spec.ts:66` checks root plate height stability after the slot grows the stage. |
| 13. Duplication and age tick | `scene/command-status-groups.component.ts:3` imports `StatusCounts`; `scene/scene-placement.ts:20` exports one `formatWorkAge` used by streams and plate. `components/command-center-page.component.ts:427-432` starts one 60-second ticker only while dated nodes exist, and releases it with effect cleanup. | Full page and integration suites cover the wired inputs; `components/command-center-page.component.spec.ts` and `integration/accessibility-list.spec.ts`. |

## Decisions

- The document capture scroll listener observes page and nested list scrolling while a plate is pinned. It asks the scene for a fresh snapshot; the scene owns the single rAF measurement scheduler. This keeps geometry current without a listener per row. Reversible.
- Child components expose their measurement elements through public methods. The scene no longer queries their private classes or data hooks. Reversible.
- A pinned row scrolled out of the viewport keeps its reservation, so returning to that row preserves placement, but its plate is hidden until the row is fully visible again. Reversible.
- Age text uses one page ticker only when a projected node has `updatedAt`. The ticker is cleaned up when dated nodes disappear or the page is destroyed. Reversible.

## Checks

- `NX Successfully ran target typecheck for project @ptah-extension/command-center`
- `NX Successfully ran target lint for project @ptah-extension/command-center`
- `Test Suites: 44 passed, 44 total`
- `Tests: 415 passed, 415 total`
- `NX Successfully ran target test for project @ptah-extension/command-center`
- After the final icon assertion: targeted scene spec `Test Suites: 1 passed, 1 total`; `Tests: 6 passed, 6 total`.

Nothing remains open from the review. The keyboard test explicitly emulates native button click after Enter and Space because jsdom does not synthesize that browser default action. The status z-order test checks DOM order and inline host stacking because Jest does not load `styleUrl` CSS.
