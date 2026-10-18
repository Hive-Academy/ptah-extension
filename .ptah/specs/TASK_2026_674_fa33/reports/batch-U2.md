# Batch U2 — canvas and layout leftovers

## L3a — pane-side Details opener

- Root cause: `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:226-235` rendered the small-band strip control as a text `i` button.
- Change: `canvas-rail-board.component.ts:30,69,226-234,266` renders `PanelRight` through `LucideAngularModule`, with the header's small square button and focus outline pattern. The existing label, expanded state, and click binding remain; the title is `Session details`.
- Spec: `canvas-rail-board.component.spec.ts:633-643` checks the 760 px control, icon, title, expanded state, and focus class. The test override imports Lucide at line 387.
- Jest: passed, as part of 102/102 tests across the two changed canvas specs.

## L3b — agent dock hover card

- Root cause: `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts:415-417` treated any focused tab as a reason to retain the card. Pointer focus after clicking a tab could therefore keep it open after both pointer-leave events.
- Change: `canvas-lane-tabs.component.ts:416` retains the card only for visible keyboard focus. Pointer leave still waits the existing 220 ms so moving from tab to card works; Escape and focus handling are unchanged.
- Spec: `canvas-lane-tabs.component.spec.ts:569-608` covers pointer leaving the tab, entering and leaving the card, and closing while the tab has pointer focus.
- Jest: passed, as part of 102/102 tests across the two changed canvas specs.

## L4 — 400 px horizontal overflow

- Root cause: unresolved from code alone. `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:135-217` contains a six-tab nonwrapping nav; line 231 reserves at least 13 rem for actions. The same shell requires at least 400 px for its chat panel at line 308 and 300 px for an optional editor panel at line 324, in addition to sidebars. These can exceed 400 px, but the review's 723 px document width does not identify which element owns the measured overflow.
- Change: none. A nav overflow rule alone could leave the canvas New Session button clipped by the panel minimum widths; changing the panel minimum alone could leave the nav overflowing. The requested smallest safe CSS change needs a measured overflowing element.
- Specs: none; no L4 file changed. Jest: not applicable.

## Decisions

- Use the existing `PanelRight` icon and focus classes from the canvas focus header for the strip control. Alternative: a different icon or custom SVG. Evidence: `canvas-focus-header.component.ts:194-210`; reversible: yes.
- Use `:focus-visible` as the dock card retention condition. Alternative: retain on all focus, which reproduces the pointer-focus issue. Evidence: keyboard opening already checks `:focus-visible` at `canvas-lane-tabs.component.ts:351`; reversible: yes.
- Leave L4 CSS unchanged pending a measured overflow owner. Alternative: add clipping or remove one minimum width speculatively. Evidence: multiple independent constraints in the Electron shell; reversible: yes.

## Open

- L4: identify the 400 px element whose bounding box or scroll width reaches 723 px, including its ancestor chain. Candidates: Electron nav tab strip plus 13 rem action cluster (`electron-shell.component.ts:135-231`), Electron three-panel chat `min-w-[400px]` and editor `min-w-[300px]` (`:308,:324`), and the retained AppShell sidebars (`app-shell.component.html:87-104,559-562`). Then select a single responsive CSS correction that keeps the nav and New Session reachable.
- Scoped `ptah_get_diagnostics` remained unavailable after a 45-second TypeScript timeout; no compiler verdict was returned. Jest verification passed: 2 suites, 102 tests, `--coverage=false --maxWorkers=1`.

## Fix round 1

- L3b root cause: `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts:343-346` cancelled A's close timer on entry to B, then tried to close B on exit while A's card was still open. `:346` now queues closure for the current card. The existing idle check preserves the tab-to-card hover path and keyboard focus; Escape and destroy cleanup are unchanged.
- Regression spec: `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.spec.ts:606` opens A, enters B, leaves B before its open delay, then confirms the tooltip closes after the close delay.
- Review minor m2: `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:231` now binds `aria-expanded` to `detailsOpen()` instead of a static string. The existing small-band opener spec checks its closed state.
- Jest: requested canvas lane tabs and rail board specs passed: 2 suites, 103 tests, `--coverage=false --maxWorkers=1`.
- Open from review: minor m1 at `canvas-rail-board.component.ts:228` asks for visual confirmation of the strip control's 24 px height and 44 px width; no visual run was authorized. Review minor m3 concerns an out-of-scope chat file. The earlier L4 overflow finding remains open as recorded above.
