# Code Logic Review - R9p (delete live budget, gesture observation, empty state)

Review family: Claude (implementer: opencode)
Task: TASK_2026_629_c0b3, Wave 3 | Reviewed: working tree on HEAD ca4021597 (uncommitted deletions)
Score: 8/10 | Verdict: APPROVE-WITH-FIXES (source change is correct; one unowned e2e regression guard is now broken and needs an owner)

## Scope examined
- Deleted: `canvas-live-budget.ts`, `canvas-live-budget.spec.ts`, `canvas-gesture-observation.ts`, `canvas-empty-state.component.ts` (git status `D`; contents read via `git show HEAD:`).
- Exports of the deleted files: `CANVAS_LIVE_BUDGET`, `isAutoCardTile`, `readCompleteGestureNodes`, `CanvasEmptyStateComponent`.
- Checks run: `rg` for every exported symbol and every module basename over `libs` and `apps` (0 hits, including specs); `rg` for the selector `ptah-canvas-empty-state`; `npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache` through the lock runner (rv-W3): green. Typecheck does not compile specs (A7), so the rg is the spec-level proof, and it is clean.
- `libs/frontend/canvas/src/index.ts` exports none of the deleted symbols, so no public-API break.

## Verdict on the contract
- No live importer, in code or specs. The only type the gesture file imported (`TilePositionObservation`) stays defined in `canvas-layout-intent.ts:180` and is still used there (`:680`). Nothing dangles.
- The Rail empty-board trigger is real: `canvas-rail-board.component.ts:76-110` renders `canvas-rail-empty-board` with a "New session" button that calls `emptyBoardNewSession()`, plus a disabled-reason line with `aria-describedby`. That covers parity row 67 and the New-session capability of the old empty state.
- No kept parity row needs the deleted capability. `readCompleteGestureNodes` validated Gridstack snapshots for drag/resize, and `CANVAS_LIVE_BUDGET`/`isAutoCardTile` were Grid placement. Both are Grid-only (rows 53, 113).

## Five logic questions
1. Silent failure: none in the source change. A deletion cannot fail silently, and typecheck plus rg both pass. The only silent-failure risk is the e2e one in finding 1.
2. Unexpected user action: opening a board with zero tiles now shows "No sessions on this board" instead of the "Orchestra Canvas" welcome panel (see finding 3).
3. Wrong-answer input: not applicable.
4. Dependency failure: not applicable. The replacement uses `newSessionBlockReason()`, which handles the capped/blocked case.
5. Missing: the old empty state embedded `ptah-project-setup-card` (skills warning and Intelligent Project Setup). The Rail empty board does not. The card still renders in the chat empty state (`chat-empty-state.component.ts:84`), so the feature is reachable. The loss is discoverability from an empty canvas.

## Findings

### 1. [Moderate] e2e regression guard `hunk-revert-top-layer.spec.ts` is now broken, and the lane report understates it
- File: `apps/ptah-electron-e2e/src/specs/git/hunk-revert-top-layer.spec.ts:193-196`
- Two locators depended on the deleted component. Lines 193-195 expect `getByRole('heading', { name: 'Orchestra Canvas' })`. That `h2` existed only in `canvas-empty-state.component.ts`, and `rg "Orchestra Canvas"` finds no remaining heading. Line 196 uses `page.locator('ptah-canvas-empty-state')` and then `boundingBox()`. The lane report (R-p1) names only the selector.
- Effect: the spec would fail at the heading expectation, before the overlap probe and the Cancel/Confirm `topmostAt` assertions it exists to protect (TASK_2026_227: the modal must paint above the canvas). The guard is lost until it is rewritten. It is not run this phase, so nothing is red now.
- Ownership: R9l lists only `canvas.spec.ts` and `task-337-agent-card-refresh.spec.ts`. This file has no owner.
- Fix: add `hunk-revert-top-layer.spec.ts` to R9l's file list (same "rewrite e2e selectors" contract). Probe the Rail board host (`[data-testid="session-viewport"]` or `canvas-rail-empty-board`) for the box, and drop or replace the "Orchestra Canvas" heading expectation. Otherwise record it in the R11 stale-selector list so it is not forgotten.

### 2. [Minor] Stale selector string in a kept unit spec
- File: `libs/frontend/canvas/src/lib/orchestra-canvas.rail.spec.ts:299`. `expect(find('ptah-canvas-empty-state')).toBeNull()` is now trivially true (the tag no longer exists). Harmless: it cannot fail, and it cannot hide a real regression because the meaningful assertion is `ptah-canvas-rail-board` x2 at `:293-295`.
- Fix (optional, fold into the next batch that touches the file): drop the line or replace it with an assertion on `canvas-rail-empty-board` where the scenario has zero tiles.

### 3. [Minor] Parity inventory is inconsistent about the empty state
- File: `parity-inventory-layout.md:60` (row 42: `canvas-empty-state.component.ts:24`, disposition "keep", "Dock / empty board unchanged") versus `:199` (row 113: remove-proposed). Row 42 reads as if the Grid empty state survives. Row 113 plus decisions 73/80 govern.
- The welcome copy, the Ptah icon and `ptah-project-setup-card` are not carried over. This is an approved removal, but the phase-diff review should state it so row 42 is not later read as a regression. `apps/ptah-docs/src/content/docs/getting-started/first-launch.md:28` still says "Click **New Session** to add your first tile"; the Rail button label is "New session".
- Fix: annotate row 42 as superseded by row 113; adjust the docs wording in the docs pass.

### 4. [Minor] e2e `canvas.spec.ts:122,277` still expects `ptah-canvas-empty-state` to be visible
- Owned by R9l. No action in R9p. Noted so R9l's reviewer checks both lines and the `getByRole('button', { name: 'Create new session' })` locator against the Rail buttons: the empty-board button is labelled "New session" with no `aria-label`.

## Stale selector strings - harmless or misleading?
- `orchestra-canvas.rail.spec.ts:299`: harmless (always passes).
- `orchestra-canvas.component.spec.ts:906`: harmless. It is a `querySelector` over a comma-list of removed tags; the stale tags only weaken the assertion. Trim when the file is next touched.
- `hunk-revert-top-layer.spec.ts:196`: misleading in effect. It is a live guard that will fail for the wrong reason (finding 1).

## Residual uncertainty
- Typecheck does not compile specs and I did not run Jest (barred). The rg is complete for imports and selectors in `libs` and `apps`, so the remaining risk is low. Mode 2's FULL(canvas) run is the backstop.
