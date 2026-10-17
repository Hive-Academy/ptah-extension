# Batch D2 — scene, overlay and page switch

## Files changed

- Replaced `libs/frontend/command-center/src/lib/scene/command-scene.component.ts`; added `scene/command-scene.component.css`; updated `scene/command-scene.component.spec.ts`.
- Replaced `libs/frontend/command-center/src/lib/components/command-overlay.component.ts` and `components/command-overlay-positioner.ts`; updated `components/command-overlay.component.spec.ts`; added `components/command-overlay-positioner.spec.ts`.
- Updated `libs/frontend/command-center/src/lib/components/command-center-page.component.ts` and `components/command-center-page.component.spec.ts`.
- Updated `libs/frontend/command-center/src/lib/integration/accessibility-list.spec.ts`, `integration/failure-and-fallback.spec.ts`, and `integration/integration-harness.testing.ts`.

The paths below are relative to `libs/frontend/command-center/src/lib/`.

## Preserve contract checklist

| Contract | Current location |
| --- | --- |
| Complete projection, stable IDs, full rail | `model/work-projection.ts:89`; `components/command-center-page.component.ts:340` |
| 23 node priority cap, ancestor validity, projection order | `scene/scene-placement.ts:41`; consumed by `scene/command-scene.component.ts:63` |
| Completed/other overflow, phase exclusion, full-list link | `scene/scene-placement.ts:50`; `scene/command-streams.component.ts:75` |
| Root, delegate, tribunal and lane relationship | `scene/scene-placement.ts:41`; `scene/command-streams.component.ts:33`; root at `scene/command-scene.component.ts:64` |
| Tribunal phase progress and detail phases | `scene/command-streams.component.ts:59`; `components/command-overlay.component.ts:47` |
| Selection, repeat activation, pin and pressed state | `scene/command-scene.component.ts:91`; `components/command-center-page.component.ts:453`; `components/command-overlay.component.ts:124` |
| 150ms preview, 200ms close, pin | `components/command-overlay.component.ts:9`, `:10`, `:180`, `:195` |
| Close, Escape, outside click, selection change and focus return | `components/command-overlay.component.ts:93`, `:141`, `:151`, `:157`, `:163`, `:171`; rail selection closes at `components/command-center-page.component.ts:458` |
| Row/root ARIA and native keyboard semantics; stable plate ID | `scene/command-streams.component.ts:35`; `scene/command-core.component.ts:24`; `components/command-overlay.component.ts:19` |
| Stream and rail roving focus; full-list focus | `scene/command-streams.component.ts:98`, `:158`; `components/command-center-page.component.ts:342`, `:463` |
| Seven voice states, level clamp and dock feed | `scene/command-core.component.ts:69`; `components/command-center-page.component.ts:265` |
| Running 3.7s transform rotation and explicit state word | `scene/command-streams.component.css:47`; `scene/command-streams.component.ts:54` |
| Reduced motion from store, no new media listener | `components/command-center-page.component.ts:179`; `scene/command-scene.component.ts:27`; `scene/command-core.component.ts:69` |
| Visibility pause and listener cleanup | `scene/command-scene.component.ts:78`, `:86`, `:96` |
| Dark/light feed, provider text and state glyphs | `components/command-center-page.component.ts:175`; `scene/command-scene.component.ts:21`; `scene/command-streams.component.ts:51` |
| Age only with timestamp; human-readable detail kind, provider, name and state | `scene/command-streams.component.ts:149`; `components/command-overlay.component.ts:29`, `:115` |
| One work-list live region, pending input and command entry | `components/command-work-list.component.ts:33`; `components/command-center-page.component.ts:310`, `:339` |
| Six existing scene inputs and `selection`/`hoveredNodeId` outputs | `scene/command-scene.component.ts:47`–`:59`; activation emits both at `:91` |
| DOM controls when decoration or measurement is absent | `scene/command-scene.component.ts:20`–`:43`; `components/command-center-page.component.ts:167`; integration failure spec |

## Design fixes

- **N2:** Hover uses an inert tooltip and safe placement; no hover reservation (`components/command-overlay.component.ts:20`, `:224`; `components/command-overlay-placement.ts:80`). Timers and generation token switch row N to N+1 (`components/command-overlay.component.ts:180`). Below 960px the visual preview is suppressed (`components/command-overlay.component.ts:189`; placement helper `:87`). Close paths emit the empty reservation synchronously (`components/command-overlay.component.ts:140`, `:148`, `:229`); the page reserves height only from a pin (`components/command-center-page.component.ts:169`).
- **M-R4:** Connector SVG is z-index 0; streams, dial and cards are z-index 1 in every container mode (`scene/command-scene.component.css:4`–`:9`). The Batch C card-aware router remains in `scene/connector-geometry.ts`.
- **M-R5:** The positioner consumes `placePinnedPlate` (`components/command-overlay-positioner.ts:6`). The stream plate is 8px below its row, width `min(256px, streamContent.width)`, with an inline slot and internal scroll where needed (`components/command-overlay-placement.ts:30`–`:69`; `scene/command-streams.component.ts:73`). A newly mounted slot scrolls into view (`components/command-overlay.component.ts:222`). Root pins use the slot below the dial (`scene/command-scene.component.ts:37`). At stacked widths the 16px stage inset plus 12px stream inset yields the approved 315px/255px content boxes with a 15px scrollbar (`scene/command-scene.component.css:8`–`:9`).

## Verification

- `npx nx typecheck command-center --parallel=1 --output-style=static`: **Successfully ran target typecheck for project @ptah-extension/command-center**.
- `npx nx lint command-center --parallel=1 --output-style=static`: **Successfully ran target lint for project @ptah-extension/command-center**.
- `npx nx test command-center --parallel=1 --output-style=static -- --maxWorkers=2`: **Test Suites: 47 passed, 47 total; Tests: 426 passed, 426 total**. Jest also printed a worker force-exit warning after the suites passed; it did not identify a test or open handle.
- Earlier scoped `ptah_get_diagnostics` found no errors in the requested changed source files. A later call timed out while its TypeScript check continued; the scoped Nx typecheck above completed successfully.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep one page-facing scene facade and compose the A–C components. | Direct page composition / scene facade. | Approved plan §5 fixes the facade and its inputs/outputs; existing page binds one scene. | Yes |
| Use the existing store selection followed by overlay activation in the page handler. | Overlay selects / page selects then pins. | Approved interface says one store update in the same event turn; `components/command-center-page.component.ts:453`. | Yes |
| Use stage-local measured geometry and a single stage observer/frame queue. | Per-row observers / one stage scheduler. | Approved plan §5 and `scene/scene-measurement.ts:20`; `scene/command-scene.component.ts:69`–`:124`. | Yes |
| Close a pin before a rail selection and let the overlay handle external store changes. | Selection only through effect / explicit rail close plus effect. | N2 requires immediate reservation release; `components/command-center-page.component.ts:458`. | Yes |
| Grow the page stage only for a pinned external reserve. | Fixed clipped stage / stage min-height bound to reservation. | N2 and D1 `PlateReservation`; `components/command-center-page.component.ts:60`, `:75`, `:169`. | Yes |

## Not done

- D3 owns removal of the unused controller canvas signal and its spec. Batch E owns deletion of old canvas renderer, sprite cache and radial layout files; none is referenced by the new scene/page.
- No Electron visual or e2e run was requested. The scoped test suite passed, with the worker teardown warning recorded above.
