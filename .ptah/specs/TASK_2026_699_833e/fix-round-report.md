# Fix round report: TASK_2026_699 rev 4 (L1, V-F2)

Scope: only L1 (code-logic-review) and V-F2 (visual-review). V-F1, V-F3 and the Minors were not touched.
No edits to `chat-transcript.*`, `message-bubble.*`, `chat-input.component.ts` or `.electron-userdata/`. Nothing committed.

## Files changed

- MODIFIED `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`
  - L17: import `untracked` from `@angular/core`.
  - L204-212: split overlay `@defer (on idle)` changed to `@defer (when detailsOpen())`, with a skeleton placeholder.
  - L249-272: dock `<aside>` now has `data-inspector-dock`. Its `@defer (on idle)` changed to `@defer (when dockOpen())`, with a skeleton placeholder.
  - L280-288: compact sheet `@defer (on idle)` changed to `@defer (when compactSheetOpen())`, with a skeleton placeholder.
  - L577-584: new constructor effect that detects a crossing of the compact threshold (400 px).
  - L797-826: `openSplitDetails` now calls a new private `focusDetailsShell()`. This is the old focus block moved out unchanged, so the handoff can reuse it.
  - L933-947: `toggleDetails` and `closeDock` now call `stopDetailsFocusObserver()` first.
  - L948-998: new `handOffInspector(compact)` and `focusDock()`.
- MODIFIED `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts`
  - L14: import `DeferBlockBehavior`.
  - L195: helper comment updated.
  - L372-373: `deferBlockBehavior: DeferBlockBehavior.Manual` in `mount()`.
  - L858-911: two new tests.

## How the L1 handoff works

- The effect tracks `compactSheet()` and keeps the previous value in a closure, the same pattern as the existing `wasStacked` and `previousBand` effects.
- It ignores a change while `containerWidth() === 0`. A hidden board measures 0 px, and that is not a resize.
- On a real crossing it calls `handOffInspector(compact)` inside `untracked`.
- **Single focus, crossing below 400 px with the dock open:**
  - `dockOpen` is set to false and `detailsOpen` to true. This closes the source and opens the sheet.
  - `focusDetailsShell()` focuses the sheet (`[data-compact-sheet]`, `tabindex=-1`) after the next render.
  - The existing MutationObserver then moves focus to `[data-inspector-close]` once the deferred inspector renders.
- **Single focus, crossing above 400 px with the sheet open:**
  - The focus observer is stopped. `detailsOpen` is set to false and `dockOpen` to true.
  - After the next render, `focusDock()` focuses the dock's `[data-inspector-close]` if it already exists.
  - If it does not exist yet, focus goes to the Stats tab button (the dock's toggle). A MutationObserver on the dock then moves focus to the close once it appears, but only if focus is still on the tab and the dock is still shown.
  - That observer is released when the close appears, and also on `toggleDetails`, `closeDock`, any other `stopDetailsFocusObserver` call, and destroy.
- **Split:** the overlay and the sheet both use `detailsOpen`, so the open state already carries over. Only focus moves, through `focusDetailsShell()`, to the destination shell.
- **Known limit:** a single resize that jumps from md or wider straight below 400 px also crosses the sm/md band. The rev 4 D-3 rule (`dockOpen` linkedSignal) resets the dock to closed there, so nothing is handed off. This matches D-3: the dock is closed by default at sm.

## How V-F2 is fixed

- All three inspector blocks now load on a `when <open signal>` trigger instead of `on idle`. The chunk is fetched as soon as the surface renders open, not when a busy page goes idle.
- Each block sits inside its own open `@if`, so the trigger is true at first render. That makes it the same as `on immediate`.
- `prefetch on idle` was left out. It could never fire before opening, because the block does not exist until the `@if` renders.
- The inspector is still behind `@defer`, so the lazy chunk is kept.
- The placeholder is now a skeleton: `div.skeleton` lines `h-4 w-32`, `h-3 w-full`, `h-3 w-3/4`, with `flex flex-col gap-2 p-4`. This follows the DaisyUI skeleton markup in `harness-config-preview.component.ts` and `timeline-view.component.ts`.
- The skeleton has `role="status"` and `aria-label="Loading session details"`. The old placeholder was `aria-hidden`, so screen readers heard nothing while it loaded (also noted in visual-review).

## Decisions

- **Defer trigger.**
  - Options: `on immediate`, or `when <open signal>`.
  - Chosen: `when <open signal>`, as the brief suggested.
  - Evidence: inside an open `@if` the two behave the same.
  - Reversible: yes.
- **Spec defer mode.**
  - Change: `mount()` now uses `DeferBlockBehavior.Manual`.
  - Evidence: with the default Playthrough mode, an eager trigger at first render moved the board's `afterRenderEffect` out of the synchronous `fixture.detectChanges()`. Probes showed `data-canvas-live-views` staying `0` while the effect logged `1` only after the test ended. 15 existing tests failed that way.
  - Manual mode keeps defer state under each test's control. The existing tests already drive it with `completeDeferBlocks`.
  - Production rendering is not affected.
  - Reversible: yes.

## Tests added

- `CanvasRailBoardComponent rendering › crossing below 400 px with the dock open hands it to the compact sheet and moves focus there`
  - 760 px: dock opened. Then 390 px.
  - Asserts `dockOpen` false, `detailsOpen` true, no dock, sheet present, focus inside the sheet.
  - After the deferred inspector loads, asserts focus is on the sheet close.
- `CanvasRailBoardComponent rendering › crossing above 400 px with the compact sheet open hands it to the dock and moves focus there`
  - 390 px: sheet open and loaded. Then 760 px.
  - Asserts `detailsOpen` false, `dockOpen` true, no sheet, dock present, Stats tab `aria-expanded="true"`.
  - With the dock in its placeholder state, asserts the skeleton is shown and focus is on the Stats tab.
  - After the inspector loads, asserts focus is on the dock close.

## Verification

- Baseline at HEAD: the same spec passed 117/117 (run with the HEAD files swapped in temporarily, then restored).
- `npx jest -c libs/frontend/canvas/jest.config.ts libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts --coverage=false --maxWorkers=2`
  - Result: `Tests: 119 passed, 119 total`.
- `ptah_get_diagnostics` on both changed files: no errors.
  - Sibling errors in `orchestra-canvas.rail.spec.ts`, `mock-rpc-service.ts` and `capability-id-codec.ts` already existed and are outside this change.
- Not run here, by brief: nx typecheck, lint and test (the orchestrator runs them).

## Out-of-scope observations

- None new.

## Bounded correction (decision 21)

Fixes the single Serious finding in `code-logic-rereview.md`: when one resize goes from md (1200 px) straight below 400 px, the open dock was lost and no compact sheet opened.

### Mechanism

- The compact-crossing effect (`canvas-rail-board.component.ts:577-590`) now keeps a plain closure variable, `dockWasOpen`. On every run with a non-zero width, it saves the previous value as `dockOpenBefore` and then reads `dockOpen()` again.
- The effect tracks `dockOpen()`, so it re-runs on every toggle, close and handoff, and `dockWasOpen` always holds the open state from the previous run. On a resize that crosses both sm/md and 400 px, the `linkedSignal` band reset has already cleared `dockOpen()`. `dockOpenBefore` still holds the state from before that resize.
- `handOffInspector(compact, dockWasOpen)` (`:961-978`) checks the passed pre-resize state (`compact && dockWasOpen`) instead of `this.dockOpen()`. The sheet-to-dock branch is unchanged.
- D-3 still holds for crossings that do not cross 400 px. Take a band-only resize such as 1200 to 760: the effect re-runs because the width changed, so it records the reset value `false`. A later 760 to 390 resize then hands off a closed dock, so no sheet opens.
- A hidden board (0 px) returns before the record step, so a hide and show across the threshold uses the last visible state.

### Lines changed

- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`: +10/-4 (effect at 577-590, signature and condition at 961/966).
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts`: +33 (one new test at 913).

### Test added

- `one resize from md to below 400 px hands the open dock to the compact sheet, and back`:
  - The dock is open at 1200 px. One resize to 390 px gives: `dockOpen` false, `detailsOpen` true, no dock, the sheet present with focus inside it, then focus on the sheet's `[data-inspector-close]` once the deferred block renders.
  - One resize back to 1200 px gives: `detailsOpen` false, `dockOpen` true, no sheet, the dock present, then focus on the dock's `[data-inspector-close]` once the deferred block renders.

### Verification

- `npx jest -c libs/frontend/canvas/jest.config.ts libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts --coverage=false --maxWorkers=1` gave `Test Suites: 1 passed, 1 total` / `Tests: 120 passed, 120 total` (119 before, plus 1 new).
- Not run, per the brief: typecheck, lint, and a run of the new test against the old code to show it fails there.

### Decisions

- **Snapshot in the effect rather than inside the `linkedSignal` computation.** The other option was to capture `previous.value` as a side effect inside the computation. That would keep a stale value from an earlier band-only reset, which breaks D-3. A local variable in the effect is current on every run, and the change can be reverted.
