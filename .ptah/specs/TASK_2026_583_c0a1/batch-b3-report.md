# Batch B3 report — e2e (component 8) plus compact-singleton live resize fix

Worktree: `D:/projects/ptah-extension/.claude-worktrees/task-583-compact-polish`.
Nothing committed.

## Files changed

- `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts`: the
  compact-singleton pin is now
  `gridstack.compact-singleton > gridstack-item:not(.ui-resizable-resizing)`.
  Gridstack adds `ui-resizable-resizing` and writes a pixel `height` inline
  while a resize handle is dragged (`dd-resizable.js` `_resizeStart`/`_applyChange`).
  With the pin released during the drag, the lone compact tile follows the
  pointer. When the drag stops, the committed `compactHeightUnits` updates
  `--ptah-compact-singleton-height`, so the tile is pinned again at the stored
  height. The full-singleton rule did not change. The CSS comment was shortened
  so the line count stays at the `max-lines` limit. CSS comments inside
  `styles` count toward that limit.
- `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts`: a new
  case, "pins a compact singleton to its stored height except while its edge
  is dragged". Jest-preset-angular strips component `styles`, so the test reads
  the pinning selector from the component source. It then checks
  `item.matches(selector)` before, during and after `ui-resizable-resizing`,
  and checks that the stored height is 4 and the variable is set. With the old
  selector the test fails.
- `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts`:
  - Helpers:
    - `waitForSettledHeight`: Gridstack animates height, so the helper waits
      until a box read stops changing.
    - `releaseResizeHover`: see the Gridstack quirk under Observations.
    - `rowPitch`.
    - `dragSouthHandle`: takes an optional mid-drag hook.
  - The compact test checks three handles on a compact tile: e and w are
    hidden, s is visible. A full tile shows e and hides s. The test then covers:
    - a south drag of 1.3 rows snaps to h=3; the neighbour moves to y=3 and one
      gesture commit is recorded;
    - dragging +6 rows clamps to 5, and dragging −6 rows clamps to 2;
    - the Tall preset gives 3 and the Compact preset gives 2, and `aria-checked`
      follows;
    - the stepper: − is disabled at 2; + steps 3, 4, 5 and is then disabled; the
      "N rows" text and the geometry follow; no preset is checked at a custom
      height; stepping down returns to 2.
  - The locked test:
    - the count of 6 disabled items (`:not([data-view-mode])`) is checked on a
      full tile only, and that tile has no `[data-height-step]` items;
    - a locked compact tile shows no visible handles;
    - the stepper + is enabled, sets 3 rows and reflows the neighbour, with no
      change to `data-canvas-gesture-commits`.
  - New test, "a compact singleton previews a south-edge drag live and keeps its
    height across a reload":
    - mid-drag, the height is greater than the start height plus one row;
    - after the drag, gs-h=4 and the tile is drawn at twice its 2-row height,
      smaller than the grid;
    - `ui.prepare()` reloads the page; afterwards gs-h=4 and the menu shows
      "4 rows".

## Verification

- `npx nx test canvas --skip-nx-cache --maxWorkers=2`: 9/9 suites, 218/218 passed.
- `npx nx lint canvas --skip-nx-cache`: passed, 0 errors, 0 warnings.
- `npx nx run ptah-electron-e2e:typecheck`: passed.
- `npx eslint` on canvas.spec.ts: clean. `nx lint ptah-electron-e2e` reports 15
  warnings, none of them in this file.
- `npx nx run ptah-electron-e2e:e2e:ci -- src/specs/canvas/canvas.spec.ts`
  (the build runs through `dependsOn`): **9 passed (4.1m)**. Two earlier runs
  failed:
  - Run 1 (7/9): a handle was read during the height animation, and the
    Gridstack hover record was stale. Both were fixed in the spec.
  - Run 2 (7/9): the handle-hover issue, plus one harness boot timeout in the
    unchanged "workspace round-trip" test (`ui-driver.ts:212`), which passed on
    the next run.

  The temporary debug spec was deleted.
- Assumptions A1 (`maxH`/`minH` are honoured) and A2 (the south handle fires
  resize events) are confirmed in Electron: the drags clamp to 5 and 2, and the
  commit is recorded.

## Observations (not changed)

- Gridstack `DDManager.overResizeElement` goes stale when a tile menu item is
  removed from under the pointer while the menu closes. No `mouseout` reaches
  the item, so no other tile shows its auto-hidden handles on hover until the
  pointer passes through that tile again. This comes from Gridstack together
  with the menus, which already existed. It was not introduced here. The spec
  works around it with `releaseResizeHover`. A product fix would need a
  synthetic `mouseout` when a menu closes, or `alwaysShowResizeHandle`.
