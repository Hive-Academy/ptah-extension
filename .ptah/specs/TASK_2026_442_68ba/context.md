# TASK_2026_442 — Fluid, user-driven canvas tile spans

## User intent

> We should have a task that enhances and elevates our canvas tiles to allow
> for showing multiple sessions in an intuitive way. The current setup with the
> 0 to 3 column layout is very rigid and limited. We should support more fluid
> and interactive, preference-based layouts: which session shows in one column,
> which shows in two, and which takes the whole three.

## Current state (as of `c5caa7c8c`)

- `libs/frontend/canvas/src/lib/canvas-layout-intent.ts` — `ColumnsPreference`
  is `'auto' | 1 | 2 | 3`. `effectiveCapacity()` clamps it to the responsive
  capacity. The preference is **workspace-wide**: one cap for every row.
- `libs/frontend/canvas/src/lib/canvas-layout.service.ts` — layout is derived
  from `TileIntent { order, weight, rowBreakBefore }`. Rows are chunked by the
  capacity, then `apportionRow()` splits `GRID_COLUMNS = 12` units by weight.
  `MAX_COLUMNS = 3`, `MIN_TILE_WIDTH = 480`, `TILE_HEIGHT_UNITS = 6` (every
  tile has the same height).
- `canvas-layout-controls.component.ts` — the dock exposes only 1/2/3 column
  toggles plus lock. No per-tile control.
- `canvas-workspace-grid.component.ts` — Gridstack drag/resize writes back
  `weight` (resize) and `order`/`rowBreakBefore` (drag via
  `projectDragIntent`). Weight from a resize is a relative share, so it is
  not a stable, nameable "span" and it is hard to discover.
- `canvas.store.ts` — owns intent + `columnsPreferenceFor(path)`.

## Problems to solve

1. A single global column cap cannot express mixed rows (full width row, then
   a 2/3 + 1/3 row, then three thirds).
2. No explicit per-tile span: users must drag a resize handle and hope the
   weight lands on a useful size.
3. No quick way to promote one session ("focus" / "expand to full width") and
   return it to its slot.
4. All tiles have the same height. A primary session cannot be taller than
   secondary sessions.
5. Discoverability: layout lives in a small popover. Tile-level actions do not
   exist in the tile header.

## Direction (for the architect to validate, not a fixed design)

- Add a per-tile **span preference** to `TileIntent` (for example
  `'auto' | 'third' | 'half' | 'two-thirds' | 'full'`, mapped to 12-unit
  grid spans), with row packing that honors spans and falls back when the
  responsive capacity cannot fit the span (narrow container → full width).
- Keep `weight` for free resize, but snap resize to the named spans, with an
  option to turn snapping off.
- Tile header menu: "Span: 1/3 · 1/2 · 2/3 · Full", "Focus (maximize in
  place)", "Move to new row".
- Optional per-tile height tier (normal / tall) if row packing can stay
  deterministic.
- Layout presets in the dock (for example "1 + 2", "Focus + stack",
  "Even grid") that write intents, replacing the bare 1/2/3 caps or sitting
  next to them.
- Persist per workspace through the existing store path. Migrate existing
  `ColumnsPreference` values without loss.

## Constraints

- Layout stays **derived** from intent. Never store concrete `x/y/w/h`.
- `computeLayout` stays a total, pure function (safe inside `computed`).
- Respect the responsive floor (`MIN_TILE_WIDTH`) when the editor panel
  narrows the canvas.
- Coordinate with TASK_2026_404_6fcd (scale beyond nine tiles, in progress)
  and TASK_2026_387 (intent-driven layout, in review) to avoid conflicts in
  `canvas-layout*.ts` and `canvas.store.ts`.
- OnPush, signals, zoneless. Accessible keyboard path for every span action.
- Lock mode must freeze span changes the same way it freezes drag/resize.

## Acceptance criteria (draft)

- A user can set any tile to 1/3, 1/2, 2/3 or full width from the tile header,
  and rows re-pack immediately.
- A row can mix spans (for example 2/3 + 1/3) while other rows use different
  spans.
- "Focus" expands one tile to full width and restores its prior span and
  position on exit.
- Spans and order survive a reload and a workspace switch.
- In a narrow container, tiles degrade to the widest span that keeps
  `MIN_TILE_WIDTH`, and they restore when the container widens.
- Existing workspaces with a `ColumnsPreference` open with an equivalent
  layout.
- Unit specs cover packing, fallback, migration and drag/resize projection.
