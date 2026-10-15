# R9 item 8 — Grid summary tile height: cause trace

Read-only trace, 2026-10-13, on HEAD `0c3cf0ac4` (started by the R9 architect before the user stopped it). Input for
the R9 plan. Paths are relative to the worktree.

## Cause

A summary card is still placed and sized as a full 6-row tile, and the row-height rule then makes it about 90-100 %
of the viewport tall. The card fills whatever height it gets. Regression on this branch: the auto-card feature
(`6f3e87e7a`, "Grid geometry and the stored view mode do not change") changed only what is drawn. The height rule is
unchanged from origin/main, where every tile was a live chat and a ~900 px tile was intended.

1. `canvas-workspace-grid.component.ts:210-226` builds each tile height from `viewMode` / `compactHeightUnits`;
   `tileViewConstraint` (`canvas-layout-intent.ts:122-134`) returns `FULL_TILE_HEIGHT_UNITS = 6` (`:16`) for any
   non-compact tab. Nothing knows about auto-cards.
2. `projectTileGeometry` (`canvas-layout-intent.ts:573`): `h = constraint?.heightUnits ?? FULL_TILE_HEIGHT_UNITS`.
3. `canvas-layout.service.ts:160-166` `hasFullTile`; `cellHeightFor` (`:196-210`) = max of the fit value
   `(H - margins) / max(extent, 6)` and, with any full tile, `floor(0.9 * H / 6)` (`MIN_TILE_VIEWPORT_RATIO = 0.9`,
   `:25`). 3 columns at 1600 (`columnsFor`, `:118-122`). H ~ 950: 3 tiles → 155/row → 930 px; 4-6 tiles → 142/row →
   852 px.
4. Applied at `canvas-workspace-grid.component.ts:731-739`, `:771` (`grid.cellHeight`), `:774-784` (`grid.load`);
   `gsOptions.cellHeight: 120` (`:182-196`) is only the start value.
5. `canvas-grid-items.ts:51-54` computes `autoCard` (`canvas-live-budget.ts:2,5-11`, budget 2) AFTER the layout; it
   only reaches the template (`canvas-workspace-grid.component.ts:124`), never `computeLayout`.
6. The card fills the height: `canvas-tile.component.ts:612` `SESSION_FORCED_CARD` → `chat-view.component.ts:925-929`
   → `chat-view.component.html:7-12` (`flex-1 min-h-0`); `compact-session-card.component.ts:111,143-148` `block h-full`;
   `compact-session-activity.component.ts:101,372` `grid h-full grid-rows-[auto_1fr_auto]` → the empty space under
   "No lanes" (`compact-session-lanes.component.ts:164`); tile wrapper `h-full` (`canvas-tile.component.ts:164`).

## Why the detail panel opens below the fold

`canvas-detail-geometry.ts:24-46`: `topPx = rowEnd * cellHeight` (6 x 155 = 930 for a first-row tile);
`heightPx = max(round(0.7 * H), H - selected.h * cellHeight - 16)` (70 % floor from `3aa592e66`, F4; was 320).
`--ptah-detail-h` (`canvas-workspace-grid.component.ts:87`), slot `:139-148`, `canvasDetailStyles`
(`canvas-workspace-grid.styles.ts:42-54`) pad the bottom and translate the rows below. Scroll container: the grid host
(`orchestra-canvas.component.ts:273-274`); H = session viewport (`:261-264`, `:477-481`). Shorter tiles alone are not
enough: the 70 % floor still pushes the panel past the bottom unless `topPx` <= ~0.3 H.

## Saved compact heights (a fix must keep this)

`TabState.compactHeightUnits` (`chat-types.ts:732-737`, `:441-468`; TASK_2026_583, `75f36d39f`). Write:
`TabManagerService.setCompactHeight` (`tab-manager.service.ts:2975-2984`, also sets `viewMode: 'compact'`);
`setViewMode` / `toggleTabViewMode` (`:2951-2965`) keep it. Read: `getTabCompactHeightUnits` (`:2997-2999`). Persisted
via `tab-persistence.ts` (`restoredCompactView` `:188-208`, `sanitizeRestoredTab` `:266-272`, legacy defaults `:170`).
Clamp 2-5 rows (`canvas-layout-intent.ts:19-40`; max 5 so a compact tile never triggers the 90 % floor). Drag-resize:
`onGridChange` → `commitCompactHeight` (`canvas-workspace-grid.component.ts:585-591,632-642`), bounds
`compactResizeBounds` (`canvas-layout-intent.ts:158-168`); only compact tiles get the bottom handle (`styles.ts:27-31`).
Tile menu stepper/presets (`canvas-tile.component.ts:81-100,287-326,594-598,716-750`).

## Specs that pin today's heights

- `canvas-workspace-grid.component.spec.ts`: `binds auto-card by focus for %i tiles without moving nodes or writing
  view mode` (~`:695-724`, no-reflow-on-focus guard), `keeps the first tile live…` (`:648`), `writes derived geometry
  keyed by tabId…` (`:726`), `keeps open detail geometry frozen through a container resize` (`:1398`), `view-mode
  heights` (`:762+`), `compact height resize` (`:1520-1700`), singleton heights (`:2033-2121`).
- `canvas-workspace-grid.detail.spec.ts`: `keeps every engine node while opening, applying and closing the overlay`
  (identical x/y/w/h; assumes `node.y >= 12`).
- `canvas-layout.service.spec.ts`: `:304` (90 % floor), `:315`, `:341`, `:364`.
- `canvas-detail-geometry.spec.ts`: `gives a full-height tile row a usable detail…` (`topPx` 852, `heightPx` 616),
  `extends the selected compact row…`.
- `canvas-grid-items.spec.ts`: `turns the focused tile into a card while detail is open`.
- `canvas-tile.component.spec.ts`: `height stepper` (`:768-832`), `provides the auto-card input as a live signal…`
  (`:1346`).
- `canvas-layout-intent.spec.ts`: `:158`, `:119`.

## Candidate fixes

- **Fix 1 (recommended):** when `tiles().length > CANVAS_LIVE_BUDGET` in Grid, full-mode tiles get a card height below
  6 (new constant, 2-3 rows, or the tab's clamped `compactHeightUnits` when stored) while staying non-compact; the
  focused live tile gets the same height. Change `viewConstraints` (`canvas-workspace-grid.component.ts:210-226`) and
  `tileViewConstraint` + fingerprint (`canvas-layout-intent.ts`). Focus still moves nothing (the `it.each` guard and
  row 43 hold), the 90 % floor stops applying, drag validation (~`:694`) follows. Cost: the focused live chat in Grid
  becomes ~310-490 px; resizing card tiles needs the bottom handle for them and a decision about `setCompactHeight`
  switching the stored mode to compact (`tab-manager.service.ts:2980-2983`).
- **Fix 2 (needed with Fix 1):** `canvas-detail-geometry.ts:34-37` — replace the 70 % floor with about
  `max(MIN_PX, containerHeight - topPx - margin)`. Without it, at H = 950 and `topPx` ~ 310 the panel is 665 px and
  overflows ~25 px.
- **Not recommended unless the user changes AC 1.4 / D1:** shrink only card tiles and keep the focused tile full
  height — focus would reflow the grid (forbidden by the `it.each` spec and decisions row 43).

## Open product decisions (ask the user, row 43 vs row 72)

1. May the focused live tile in Grid shrink to the card height (Fix 1), or must it keep full height (needs AC 1.4 / D1
   reopened)?
2. Default card height in rows (2 or 3)?

H was inferred from the report (~900 px), not measured.
