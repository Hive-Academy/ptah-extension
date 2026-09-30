# Batch B2 report — canvas adjustable height (components 5, 6, 7)

Worktree: `D:/projects/ptah-extension/.claude-worktrees/task-583-compact-polish`.
Nothing committed. Only `libs/frontend/canvas/**` was touched; Batch A files were
not touched.

## Files changed

- `libs/frontend/canvas/src/lib/canvas-layout-intent.ts` — removed
  `TileHeightTier`, `heightUnitsFor`, `COMPACT_TALL_TILE_HEIGHT_UNITS`, the B1
  `isCompactTier` shim and the now-unused `assertNever` import. Added
  `MIN_COMPACT_TILE_HEIGHT_UNITS = 2`, `MAX_COMPACT_TILE_HEIGHT_UNITS = 5`,
  `clampCompactHeightUnits`, `tileViewConstraint`, `sameViewConstraints` and
  `compactResizeBounds`. `TileViewConstraint` is now
  `{ tabId, compact, heightUnits }`. The fingerprint encodes mode and units.
  Projection and the drag decoder read `compact`/`heightUnits`.
- `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts` —
  `viewConstraints` clamps `tab.compactHeightUnits`. Handles are `'e, s, w'`,
  and the per-item class `ptah-compact-item` plus CSS show south only on
  compact tiles and east/west only on full tiles. Compact tiles are no longer
  `noResize`. The resize commit has a compact branch that reads the engine
  `h`, clamps it, calls `setCompactHeight` when it differs, then reconciles. A
  missing or fractional `h` is rejected. `grid.load` entries carry
  `minH/maxH` (2/5) for compact tiles outside layout focus, and explicit
  `undefined` otherwise. The lock path is unchanged: `setStatic(true)`, the
  gesture guards refuse, and menu height changes reflow through the view
  fingerprint.
- `libs/frontend/canvas/src/lib/canvas-tile.component.ts` — `HEIGHT_PRESETS`
  (Full, Compact = 2, Tall = 3) keep `data-view-mode` (`full|compact|tall`).
  A preset is checked only when the height matches it, so a custom height
  checks none. While compact, a −/+ stepper (`data-layout-group="height-step"`,
  `data-height-step`, labelled "Decrease/Increase tile height") shows
  "N rows" (`data-testid="tile-height-units"`, `aria-live="polite"`). It is
  disabled at the bounds, enabled under lock, and keeps the menu open. When a
  step reaches a bound, focus moves to the opposite button. The header toggle
  is still binary.
- `libs/frontend/canvas/src/lib/canvas-layout.service.ts` — doc comment only.
- Specs: `canvas-layout-intent.spec.ts`, `canvas-layout.service.spec.ts`
  (fixture), `canvas-workspace-grid.component.spec.ts`,
  `canvas-tile.component.spec.ts`.

## Tests added or updated

- Intent: bounds; clamp (undefined, NaN, Infinity, ≤1, rounding, ≥6);
  constraint builder; structural equality; drag bounds; the fingerprint
  changes on units alone; compact at 4 and 5 packs with fill below; the drag
  decoder accepts `h = heightUnits` and rejects the old height 2.
- Grid: `h = 4` commits `setCompactHeight('t2', 4)` and the neighbour
  reflows; 9→5, 6→5, 1→2; an unchanged height is accepted with no write; a
  fractional height is rejected and settles back; a full-tile resize commits a
  span and ignores `h`; bounds are passed and cleared on return to full; a
  locked grid refuses the resize; a stepper-style height change under lock
  gives one `load` with frozen measurements, no gesture commit and no intent
  change; an out-of-range stored height is clamped. Replaced the "compact
  never resizable" case.
- Tile: the 5 B1-failing cases were rewritten for presets. New cases cover the
  stepper: visibility, labels, value, default 2, stepping and bounds, clamping
  a stored 9, focus at a bound, enabled under lock, Up/Down and Left/Right
  navigation, and preset checking at 2, 3, 4 and 5.

## Verification

- `npx nx test canvas --skip-nx-cache --maxWorkers=2`: 9/9 suites, 217/217
  tests passed.
- `npx nx lint canvas --skip-nx-cache`: passed, 0 errors, 0 warnings. An
  intermediate run hit `max-lines` (727 > 700) on the grid component. It was
  resolved by moving pure constraint helpers into `canvas-layout-intent.ts`,
  not by suppressing the rule.
- `npx nx run canvas:typecheck --skip-nx-cache`: passed.
- Prettier: clean on the files that were clean at HEAD. `canvas-layout-intent.ts`,
  `canvas-tile.component.ts` and `canvas-layout-intent.spec.ts` already
  differed from Prettier at HEAD. Their remaining differences are
  pre-existing lines, which were left alone.
- No `as any`, `@ts-ignore` or `eslint-disable` was added. `compact-tall` no
  longer appears in canvas.
- Remaining spec type errors in canvas (`canvas-layout.service.spec.ts:316`,
  formerly `:311`, and `canvas.store.spec.ts:45`) already existed. Jest does
  not report them.

## Notes for B3 (e2e) and review

- `canvas.spec.ts:559-563`: a compact tile now has 3 handles (e and w hidden
  by CSS, s shown).
- `canvas.spec.ts:670-686`: the `:not([data-view-mode])` count of 6 disabled
  items holds only for a **full** tile. On a compact tile, the two stepper
  buttons are `data-layout-item` without `data-view-mode`, and they are
  enabled under lock. Select them with `[data-height-step]`.
- Assumptions A1 (`maxH` applied by `grid.load`) and A2 (a south handle fires
  resize events) are untested outside jsdom. The commit-time clamp still
  guarantees the bounds.
- Compact singleton: the CSS rule `height: var(--ptah-compact-singleton-height) !important`
  pins the item height, so a south drag on a lone compact tile shows no live
  preview. The height applies on release. Not changed here.
