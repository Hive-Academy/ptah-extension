# Implementation Plan - TASK_2026_387

## Inputs and constraints

- Requirements used:
  - `D:\projects\ptah-extension\.ptah\specs\TASK_2026_387\context.md`
  - `D:\projects\ptah-extension\.ptah\specs\TASK_2026_387\task.md`
  - `D:\projects\ptah-extension\libs\frontend\canvas\CLAUDE.md`
  - `D:\projects\ptah-extension\CLAUDE.md`
- Corrections applied: none
- Design handoff used: none (no `visual-design-specification.md` /
  `design-handoff.md` in the task folder; this is a layout-behaviour refactor,
  not a visual redesign)
- Missing decision-critical input: none. `task-description.md` and
  `research-report.md` are absent; `context.md` carries the four goals and the
  key-file list, which is sufficient. No decision was blocked.
- Scope: `libs/frontend/canvas` only. `src/index.ts` keeps every exported name
  it has today (`OrchestraCanvasComponent`, `CanvasTileComponent`,
  `CanvasEmptyStateComponent`, `CanvasStore`, `CanvasLayoutService`,
  `TileAgentIndicatorComponent`, `TileAgentMiniPanelComponent`, `CanvasTile`,
  `CanvasLayout`, `TileLayout`).

## Codebase evidence

| Evidence                                                                                                                                                            | Location                                                                                                                     | Architectural implication                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verified: columns come from two pixel breakpoints, `BREAKPOINT_NARROW = 500`, `BREAKPOINT_MEDIUM = 900`                                                             | `libs/frontend/canvas/src/lib/canvas-layout.service.ts:14-15`, `:69-73`                                                      | These two constants are the whole of goal 1 and are deleted, replaced by a min-tile-width derivation.                                                                                                |
| Verified: `tilesPerRow = Math.min(maxPerRow, tileCount)` and `tileW = floor(12 / tilesPerRow)` — every row gets the same width, so the last (short) row never fills | `canvas-layout.service.ts:74-75`, `:92-100`                                                                                  | Goal 2 needs per-row width distribution, not one global `tileW`.                                                                                                                                     |
| Verified: `GRID_COLUMNS = 12`, `MARGIN = 8`, `TILE_HEIGHT_UNITS = 6`, `MIN_CELL_HEIGHT = 20`, `MIN_TILE_VIEWPORT_RATIO = 0.9`                                       | `canvas-layout.service.ts:3-12`                                                                                              | The 12-unit Gridstack model and the "keep each tile ≥ 90% of viewport height, let the canvas scroll" rule are load-bearing and must survive unchanged.                                               |
| Verified: `cellHeight = max(MIN_CELL_HEIGHT, fitCellHeight, minTileCellHeight)` where `minTileCellHeight = floor(height * 0.9 / 6)`                                 | `canvas-layout.service.ts:78-90`                                                                                             | The scroll rule is already "max wins": once rows > 1 the computed height exceeds the container and the `overflow-auto` host scrolls. Only the `rows` input to it changes.                            |
| Verified: `CanvasTile` is `{ tabId, position: {x,y,w,h} }` — coordinates ARE the stored state                                                                       | `libs/frontend/canvas/src/lib/canvas.store.ts:6-9`                                                                           | Goal 4 replaces this field. Every writer/reader of `.position` in the lib is in scope.                                                                                                               |
| Verified: `CanvasStore` injects `CanvasLayoutService` only to stamp a position in `appendTile` and `switchWorkspaceTiles`                                           | `canvas.store.ts:56`, `:264-276`, `:358-369`                                                                                 | Under an intent model the store never needs the layout service — the dependency is deleted, not rewired.                                                                                             |
| Verified: `gsOptions` sets `float: true`, `column: 12`, `cellHeight: 120`, `resizable.handles: 'e, se, s, sw, w'`                                                   | `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:98-106`                                                     | `float: true` is the "dropped tile sits where dropped, no gravity" behaviour the user reports. Goal 3 flips it. The `s`/`se`/`sw` handles offer a vertical resize the intent model has no field for. |
| Verified: `tileCount` exists as a separate computed _specifically_ so the auto-layout effect does not depend on `tiles()`, with a comment naming the snap-back loop | `canvas-workspace-grid.component.ts:112-125`                                                                                 | This indirection is the current (partial) loop guard. Under an intent model the layout MUST depend on order+weight, so this guard is removed and replaced by an explicit one.                        |
| Verified: the auto-layout effect calls `grid.batchUpdate(true)` … `grid.update(node.el, …)` … `grid.batchUpdate(false)`                                             | `canvas-workspace-grid.component.ts:142-152`                                                                                 | This is the write path that must be made non-reentrant.                                                                                                                                              |
| Verified: `batchUpdate(false)` calls `_triggerChangeEvent()` — closing a batch DOES emit `change`                                                                   | `node_modules/gridstack/dist/gridstack.js:730-739`                                                                           | **`batchUpdate` is not a suppression mechanism.** Any design that relies on it to silence the write-back is wrong.                                                                                   |
| Verified: `_triggerChangeEvent` → `_triggerEvent` → `grid.el.dispatchEvent(event)` — synchronous dispatch                                                           | `gridstack.js:1683-1695`, `:1724-1731`                                                                                       | A plain synchronous boolean flag set around the write block is sufficient and reliable; no timer or microtask is needed.                                                                             |
| Verified: on drag/resize end, `this.triggerEvent(event, target)` (i.e. `dragstop`/`resizestop`) runs BEFORE `this._triggerChangeEvent()`                            | `gridstack.js:2635`, `:2639`                                                                                                 | A gesture latch set in `dragStopCB`/`resizeStopCB` is guaranteed to be populated by the time `changeCB` fires. This is what lets drag mean "reorder" and resize mean "weight".                       |
| Verified: the Angular wrapper exposes `changeCB`, `dragStopCB`, `resizeStopCB` as `EventEmitter`s on `GridstackComponent`                                           | `node_modules/gridstack/dist/angular/lib/gridstack.component.d.ts:126`, `:134`, `:146`                                       | The gesture latch needs no direct `grid.on(...)` wiring; the wrapper already emits both.                                                                                                             |
| Verified: `nodesCB = { event: Event; nodes: GridStackNode[] }` — `nodes` is the _dirty_ set, not the full set                                                       | `gridstack.component.d.ts:25-28`; dirty filter at `gridstack.js:1686`                                                        | With `float: false` a drag pushes neighbours, so deriving order from `data.nodes` alone is wrong. Read `grid.engine.nodes`.                                                                          |
| Verified: `GridStack.compact(layout?, doSort?)` and `GridStack.float(val)` both exist in 12.6.0                                                                     | `node_modules/gridstack/dist/gridstack.d.ts:298`, `:379`                                                                     | Both goal-3 options are real; the choice below is between them, not about availability.                                                                                                              |
| Verified: installed gridstack is **12.6.0**, not the 12.5.0 named in `canvas/CLAUDE.md:39`                                                                          | `node_modules/gridstack/package.json`                                                                                        | Doc drift only — the APIs used are present in both. `canvas/CLAUDE.md` should be corrected while it is being edited anyway.                                                                          |
| Verified: `TileLayout` is imported OUTSIDE this lib by `tribunal-panel`                                                                                             | `libs/frontend/tribunal-panel/src/lib/types/tribunal-ui.types.ts:2`, `services/tribunal-state.service.ts:19`, `:273`, `:490` | **`TileLayout` must keep the exact shape `{x,y,w,h}`.** `CanvasTile`, `CanvasLayout` and `CanvasStore` have no consumer outside `libs/frontend/canvas` and are free to change.                       |
| Verified: `layoutService.observe()` is given `#canvasContainer`, the flex wrapper; the grid child carries `w-[97%]`                                                 | `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:262-267`, `:72-77`                                               | The measured width is ~3% larger than the grid's real width. At a 480 px threshold that moves the 2→3 column boundary by ~45 px. Must be resolved, not ignored.                                      |
| Verified: `locked()` short-circuits the auto-layout effect (`:138`) and drives `grid.setStatic(locked)` (`:167-171`)                                                | `canvas-workspace-grid.component.ts:138`, `:167-171`                                                                         | Goal 5's mechanism already exists and is correct; it only has to keep working against the new write path.                                                                                            |
| Verified: hidden workspace grids run at `display: none` (0 width) and re-measure via `grid.onResize()` when shown                                                   | `canvas-workspace-grid.component.ts:38-48`, `:157-164`                                                                       | The keep-alive contract constrains the new apply path: it must stay guarded by `visible()`, and the re-measure call is another non-gesture `change` source to suppress.                              |
| Verified: `MAX_TILES = 9` is justified in a comment by "`CanvasLayoutService` switches to that arrangement at the largest breakpoint" (3×3)                         | `canvas.store.ts:59-66`                                                                                                      | Columns still clamp at 3, so the 9-tile cap and its rationale survive verbatim.                                                                                                                      |
| Verified: `canvas.store.spec.ts` asserts literal positions (`{x:0,y:0,w:4,h:6}`, `{x:7,y:3,w:5,h:8}`, `{x:5,y:5,w:5,h:5}`) and mocks `CanvasLayoutService`          | `canvas.store.spec.ts:72-82`, `:107-133`, `:220-250`                                                                         | Three tests break by construction and are rewritten against intent, not coordinates.                                                                                                                 |
| Verified: `orchestra-canvas.component.spec.ts` builds a `canvasStoreMock` with `tiles` carrying `position` and an `updateTilePosition` jest.fn                      | `orchestra-canvas.component.spec.ts:137-160`                                                                                 | Mock shape must track the new store surface or the component spec compiles against a stale contract.                                                                                                 |
| Verified: the canvas e2e asserts only presence/count of `[data-testid="canvas-tile"]` and `[data-testid="canvas-grid"]` — no coordinate assertions                  | `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:37`, `:46`, `:59-70`, `:105`                                         | No e2e change is required by this task.                                                                                                                                                              |

## Architecture decision

- **Chosen approach: a pure, total layout function over stored intent, plus a
  one-way "derive → apply → suppress" projection into Gridstack, with gesture-typed
  read-back.**

  Four pieces, in dependency order:
  1. **Intent is the only stored tile state.** `CanvasTile` becomes
     `{ tabId, order, weight }`. `order` is a stable reading-order index;
     `weight` is a relative width share within whatever row the tile lands in.
     No `x`, `y`, `w`, `h` is ever persisted.
  2. **`CanvasLayoutService.computeLayout(tiles)` is a pure function of
     `(intent, containerWidth, containerHeight)`** returning `{ cellHeight,
columns, tiles: PositionedTile[] }` where `PositionedTile = TileLayout & { tabId }`.
     It derives the column count from a minimum tile width, chunks the
     order-sorted tiles into rows of at most `columns`, and distributes all 12
     Gridstack units across each row proportionally to weight — so every row,
     including a short last row, sums to exactly 12 and fills the width.
     Because rows are filled top-to-bottom and left-to-right with no gaps, the
     derived layout is compact **by construction**.
  3. **The grid component projects, never stores.** One effect derives the
     layout and writes it into Gridstack. A synchronous `_applyingLayout` flag
     wraps that write so the `change` event it provokes is dropped.
  4. **Gestures are translated back into intent, typed by which gesture ended.**
     `dragStopCB` / `resizeStopCB` latch the gesture kind; the `changeCB` that
     follows reads `grid.engine.nodes` (the full set, post-push/post-compact),
     and writes **order** for a drag or **weights** for a resize. Then the
     effect re-derives and re-applies, suppressed.

- **Rationale (goal by goal):**
  - _Goal 1_ — `columns = clamp(floor((width + MARGIN) / (MIN_TILE_WIDTH + MARGIN)), 1, 3)`
    with `MIN_TILE_WIDTH = 480`, `MARGIN = 8` (the existing margin,
    `canvas-layout.service.ts:4`). At the reported 1180 px:
    `floor(1188 / 488) = 2` — two columns, exactly the user's expected result.
    The `+ MARGIN` on both sides is the standard n-gaps-for-n-tiles form
    (`n*T + (n+1)*M ≤ W + M` ⟺ `n ≤ (W+M)/(T+M)`), so it accounts for the
    gutters the current breakpoints ignore. Clamp at 3 preserves the 3×3 /
    `MAX_TILES = 9` contract (`canvas.store.ts:59-66`).
  - _Goal 2_ — per-row proportional distribution of all 12 units. Weights are
    floored to integer units, every tile gets at least `MIN_TILE_UNITS = 2`, and
    the leftover units go to the largest fractional remainders (largest-remainder
    apportionment). The row therefore always sums to 12 for any weight vector and
    any 1..3 tile count — that is the fill-remainder guarantee, and it is an
    invariant a unit test can assert directly.
  - _Goal 3_ — **`float: false` for the live gesture, derived-compactness for the
    stored truth. `grid.compact()` is NOT called.** `float: false` gives
    Gridstack's own gravity during a drag, which is the interactive feedback the
    user is missing today (`float: true` at
    `canvas-workspace-grid.component.ts:102` is exactly the reported symptom).
    A post-hoc `grid.compact()` is rejected because it mutates the grid _after_
    the derived layout has been applied, producing a second `change` event whose
    result may disagree with `computeLayout` — two authorities for one layout.
    With derived compaction there is exactly one authority, and `compact()`
    would be a no-op on its output anyway.
  - _Goal 4_ — split of responsibility: drag carries positional information,
    resize carries dimensional information, and Gridstack tells us which one
    just ended before it tells us what changed (`gridstack.js:2635` fires
    `dragstop`/`resizestop`, `:2639` fires `change`). Reading a resize as a
    reorder — or a reorder as a weight change — is the failure this latch
    prevents. The translation is **idempotent**: re-deriving from the intent that
    was just read back reproduces the same node geometry, so there is no
    snap-back. Manual intent survives a container resize because the effect
    re-derives from `order`/`weight`, which the resize did not touch — only
    `columns` and `cellHeight` change.
  - _Goal 5_ — unchanged mechanism: `grid.setStatic(locked)` plus an early
    `return` in the apply effect. Additionally `onGridChange` returns early when
    `locked()` — a static grid should never produce a gesture, and the guard
    makes "no layout writes while locked" a property of the code rather than a
    property of Gridstack's static mode.

- **The feedback-loop mechanism (explicit, as required):**

  **A private synchronous boolean `_applyingLayout` on
  `CanvasWorkspaceGridComponent`, set immediately before the grid-mutation block
  and cleared in a `finally` immediately after it. `onGridChange` returns early
  while it is set.**

  Why not `batchUpdate`: verified false. `batchUpdate(false)` explicitly calls
  `_triggerChangeEvent()` (`gridstack.js:730-739`). Batching coalesces the events
  into one; it does not suppress them. Batching is still used — for DOM-thrash
  reasons — but it is not the guard.

  Why not derived-vs-current comparison: Gridstack clamps, normalises and
  re-packs the values it is handed (`float: false` gravity, `minW`, column
  bounds), so "what we wrote" and "what the engine holds" are not reliably
  equal. A comparison guard would leak an occasional write-back and is
  untestable in the jsdom stub the existing specs use.

  Why a flag is safe here: `dispatchEvent` is synchronous
  (`gridstack.js:1724-1731`), so the flag's window is a single synchronous block
  with no `await` and no timer. The `finally` guarantees it clears even if
  `grid.update` throws. The same flag also wraps the `grid.onResize()`
  re-measure at `canvas-workspace-grid.component.ts:157-164`, which is the other
  non-gesture `change` source.

  **Second line of defence (not a substitute):** the store's intent writers
  return the _same array reference_ when nothing actually changed. A signal set
  to an identical reference does not notify, so even a leaked write-back
  terminates instead of re-running the effect. Both are specified; the flag is
  primary.

- **Rejected alternatives:**
  - _Call `grid.column(n)` for 1/2/3 columns instead of mapping onto 12._
    Rejected: `column(n, layout)` (`gridstack.d.ts:319-327`) rewrites every
    node's `x`/`w` with its own cached per-column layouts, which is a second,
    hidden store of positional state — precisely what goal 4 removes. It also
    makes fractional weights impossible (a 2-column grid cannot express 5/7).
    Keeping `column: 12` and mapping columns to unit widths (12 / 6+6 / 4+4+4,
    or any weighted split summing to 12) costs nothing and keeps one authority.
  - _`grid.compact()` after every change._ Rejected above — two authorities, an
    extra change event, no-op on a layout that is already compact.
  - _`grid.float(false)` only, with no derived compaction._ Rejected: Gridstack
    gravity is applied to the engine's node set, not to the persisted intent, so
    a workspace switch or a remount would restore the un-compacted arrangement.
  - _Keep `{x,y,w,h}` and re-flow only when the column count changes._
    Rejected: this is today's design. It cannot express "this tile should stay
    second" independently of pixel width, so any container resize either
    destroys the arrangement (unlocked) or freezes it stale (locked). That
    binary is the user's complaint.
  - _`weight` as a normalised fraction (sum-to-1)._ Rejected in favour of raw
    unit-share integers: reading `node.w` straight off the engine after a resize
    makes the read-back trivially idempotent (a row of 5/4/3 reads back as
    weights 5/4/3 and re-derives to 5/4/3), and normalisation happens inside
    `computeLayout` anyway.
  - _Add a second intent field for height (`heightWeight`) so `s`/`se`/`sw`
    resize handles keep working._ Rejected for this task: rows must stay
    height-aligned for the compaction and `cellHeight` scroll rules to hold, and
    a per-tile height weight inside a shared row is not expressible. Instead
    `resizable.handles` narrows to `'e, w'`. Recorded as a deliberate,
    user-visible reduction (see _Effect on existing code_) and as a candidate
    future enhancement (per-**row** height weight), not designed for now.

- **Assumptions:**
  - _Assumption:_ `MIN_TILE_WIDTH = 480` yields 1 column below ~968 px, so a
    900 px canvas that renders 2 columns today will render 1. This follows
    directly from the stated rule but is a visible behaviour change at a width
    the old `BREAKPOINT_MEDIUM` treated as 2-column.
    _Check:_ confirm with the requester, or measure the app's minimum practical
    canvas width; the value is a single exported constant so it can be tuned
    without touching logic. The tester must assert the boundary explicitly
    rather than assume it.
  - _Assumption:_ `grid.engine.nodes` is already in its post-gesture, settled
    state when `changeCB` fires. Supported by `gridstack.js:2624-2639`
    (`_writePosAttr` and `engine.endUpdate` bracket the trigger) but not proven
    by a test in this repo.
    _Check:_ the reorder-on-drag spec must assert against a stub whose
    `engine.nodes` carries post-push coordinates, and the visual reviewer must
    confirm a real drag between two occupied slots lands where dropped.
  - _Assumption:_ `MIN_TILE_UNITS = 2` (of 12) is a low enough floor that
    largest-remainder apportionment never needs to steal units back from a tile
    already at the floor. True for ≤ 3 tiles per row (3 × 2 = 6 ≤ 12).
    _Check:_ a unit test over every weight vector for 1, 2 and 3 tiles per row
    asserting `sum === 12` and `every(w >= 2)`.

- **Effect on existing code:**
  - Replaced: `BREAKPOINT_NARROW` / `BREAKPOINT_MEDIUM` and the uniform-`tileW`
    loop in `canvas-layout.service.ts`; `CanvasTile.position` and
    `CanvasStore.updateTilePosition`; the `CanvasStore → CanvasLayoutService`
    dependency; the `tileCount` computed and the `float: true` option in
    `canvas-workspace-grid.component.ts`.
  - Left alone: `MIN_TILE_VIEWPORT_RATIO` and the whole `cellHeight` /
    scroll rule; `GRID_COLUMNS = 12`; `MARGIN = 8`; `TILE_HEIGHT_UNITS = 6`;
    `MIN_CELL_HEIGHT`; the `ResizeObserver` + RAF driver
    (`canvas-layout.service.ts:45-59`); `MAX_TILES = 9`; the entire
    per-workspace partition, keep-alive, LRU-eviction and prune machinery in
    `canvas.store.ts` and `orchestra-canvas.component.ts`; `TileLayout`'s shape
    (tribunal-panel depends on it); every name in `src/index.ts`.
  - Removed capability: vertical tile resize (`s`, `se`, `sw` handles). This is
    the one user-visible subtraction and must be called out in the batch that
    makes it, so the visual reviewer does not report it as a regression.
  - No compatibility shim, no `V2` service, no feature flag. The old
    coordinate model is deleted, not kept alongside.

## Component specifications

### 1. CanvasLayoutService — the pure layout engine

- **Purpose:** turn tile intent plus a measured container into concrete
  Gridstack geometry. Sole owner of the columns-from-width rule, the
  fill-remainder rule and the `cellHeight` scroll rule.
- **Responsibilities:**
  - Own the `ResizeObserver` + RAF measurement driver (unchanged behaviour).
  - `columnsFor(width): 1 | 2 | 3` from `MIN_TILE_WIDTH`.
  - Chunk order-sorted intent into rows of at most `columns`.
  - Apportion 12 units across each row by weight, sum exactly 12, floor
    `MIN_TILE_UNITS`.
  - Compute `cellHeight` from the row count, preserving
    `MIN_TILE_VIEWPORT_RATIO`.
  - Nothing else. It does not touch Gridstack, the DOM (beyond observing) or
    the store.
- **Verified contracts and entry points:**
  - `TileLayout { x, y, w, h }` — `canvas-layout.service.ts:17-22`. **Shape
    frozen**; imported by `libs/frontend/tribunal-panel/src/lib/types/tribunal-ui.types.ts:2`
    and `services/tribunal-state.service.ts:19,273,490`.
  - `CanvasLayout` — `canvas-layout.service.ts:24-27`. No external consumer
    (grep-verified); gains `columns` and its `tiles` element type gains `tabId`.
  - `observe(element)` — `canvas-layout.service.ts:45-59`. Signature and
    behaviour unchanged.
  - `containerWidth` / `containerHeight` readonly signals —
    `canvas-layout.service.ts:38-39`. Unchanged; the grid component's effect
    still tracks them.
  - `computeLayout` — `canvas-layout.service.ts:61`. Signature changes from
    `(tileCount: number)` to `(tiles: readonly TileIntent[])`.
  - Preserved constants: `GRID_COLUMNS = 12` (`:3`), `MARGIN = 8` (`:4`),
    `TILE_HEIGHT_UNITS = 6` (`:5`), `MIN_CELL_HEIGHT = 20` (`:6`),
    `MIN_TILE_VIEWPORT_RATIO = 0.9` (`:7-12`, keep the comment).
  - New exported constants: `MIN_TILE_WIDTH = 480`, `MAX_COLUMNS = 3`,
    `MIN_TILE_UNITS = 2`. Exported so specs assert against the constant, not a
    duplicated literal.
- **Behaviour to specify (prose contract, for the implementer):**
  - `TileIntent = { tabId: string; order: number; weight: number }` — declared
    here (the layout owns the vocabulary), re-used by the store.
  - `PositionedTile = TileLayout & { tabId: string }` — the layout result is
    keyed by `tabId`, never by array index. This removes the index-alignment
    coupling the current effect has at `canvas-workspace-grid.component.ts:146-149`.
  - `columns = clamp(floor((width + MARGIN) / (MIN_TILE_WIDTH + MARGIN)), 1, MAX_COLUMNS)`.
  - Rows: sort by `order` (ties broken by `tabId` for determinism), chunk into
    groups of `columns`.
  - Width apportionment per row: `raw_i = GRID_COLUMNS * weight_i / Σweight`;
    `w_i = max(MIN_TILE_UNITS, floor(raw_i))`; distribute
    `GRID_COLUMNS − Σw_i` remaining units one at a time to the largest
    fractional remainders. `x` is the running sum within the row; `y =
rowIndex * TILE_HEIGHT_UNITS`; `h = TILE_HEIGHT_UNITS`.
  - Degenerate inputs: empty tile list, zero width, zero height, non-finite or
    non-positive weight. Each must be total (see _Failure behaviour_).
- **Dependencies:** `@angular/core` only (`DestroyRef`, `Injectable`, `signal`).
  Direction: nothing in the lib depends on it except
  `CanvasWorkspaceGridComponent` (the store's dependency is deleted). No
  Gridstack import — keeping it Gridstack-free is what makes it unit-testable
  without the `gridstack/dist/angular` jest mock the component specs need
  (`orchestra-canvas.component.spec.ts:35-60`).
- **Integration points:** `OrchestraCanvasComponent` calls `observe()`
  (`orchestra-canvas.component.ts:262-267`); `CanvasWorkspaceGridComponent`
  calls `computeLayout()`. Provided per-panel at
  `orchestra-canvas.component.ts:52`; it must stay non-root.
- **Failure behaviour:** total function, no throws.
  - `tiles.length === 0` or `width === 0` or `height === 0` →
    `{ cellHeight: 120, columns: 1, tiles: [] }` (matches today's early return,
    `canvas-layout.service.ts:65-67`, so a hidden `display:none` grid still
    short-circuits).
  - `weight` non-finite or `≤ 0` → treated as `1`. `Σweight === 0` → equal
    split. A NaN must never reach Gridstack, which would silently drop the node.
  - The apportionment loop must be bounded by row length, not by a
    `while (remaining > 0)` on a value that could be negative.
- **Quality requirements:** pure and synchronous; no allocation per animation
  frame beyond the result array; `computeLayout` is called from a `computed`, so
  it must be side-effect free (writing a signal inside it would be a
  write-during-compute error).
- **Verification seam:** direct unit tests on the service with
  `containerWidth`/`containerHeight` seeded — no TestBed component, no
  Gridstack, no `ResizeObserver`. Seed the private width/height signals through
  a narrow test-only path or by driving `observe()` with a stubbed
  `ResizeObserver`; prefer whichever the implementer finds least invasive, and
  do not widen the public API to make testing easier beyond one setter if truly
  required.
- **Files:**
  - MODIFY `D:\projects\ptah-extension\libs\frontend\canvas\src\lib\canvas-layout.service.ts`
  - CREATE `D:\projects\ptah-extension\libs\frontend\canvas\src\lib\canvas-layout.service.spec.ts`

### 2. CanvasStore — intent-only tile state

- **Purpose:** own per-workspace tile intent. Unchanged in every other respect.
- **Responsibilities:**
  - `CanvasTile` becomes `{ tabId: string; order: number; weight: number }`.
  - Append assigns `order = <count>` and `weight = 1`.
  - Removal must not leave order gaps that change relative ordering — either
    renumber densely on removal, or make the layout tolerate gaps by sorting.
    **Choose dense renumbering on write** so the stored value is always
    canonical and a spec can assert `orders === [0,1,2]`.
  - Replace `updateTilePosition` with two intent writers.
  - Drop the `CanvasLayoutService` injection.
- **Verified contracts and entry points:**
  - `CanvasStore` class, exported from `src/index.ts:4`; `CanvasTile` type from
    `src/index.ts:5`. Both names kept.
  - `MAX_TILES = 9` — `canvas.store.ts:66`. Unchanged. Its comment references
    "the largest breakpoint"; reword to "the 3-column clamp" while keeping the
    3×3 rationale.
  - `RETAINED_WORKSPACE_CAP = 4` — `canvas.store.ts:28`. Unchanged.
  - `tiles` / `focusedTabId` / `tileCount` / `canAddTile` computeds —
    `canvas.store.ts:90-105`. Unchanged.
  - `tilesFor(path)` memoised signal — `canvas.store.ts:113-120`. Unchanged.
  - `appendTile` — `canvas.store.ts:358-369`. Loses the `computeLayout` call
    and the `{x:0,y:0,w:4,h:6}` fallback; becomes
    `{ tabId, order: tiles.length, weight: DEFAULT_TILE_WEIGHT }`.
  - `switchWorkspaceTiles` — `canvas.store.ts:227-280`. The seeding loop
    (`:264-276`) loses its per-tile `computeLayout` call — which today runs
    `computeLayout(n)` once per seeded tile, O(n²) — and becomes a plain
    `map` to intent. The `MAX_TILES` break (`:266`) and the implicit-workspace
    migration branch (`:240-262`) are untouched.
  - `updateTilePosition(tabId, pos)` — `canvas.store.ts:205-209`. **Deleted.**
    Grep-verified: the only call sites are
    `canvas-workspace-grid.component.ts:182`, `canvas.store.spec.ts:111,225`
    and the mock at `orchestra-canvas.component.spec.ts:159`. `TribunalStateService`
    has a same-named method (`tribunal-state.service.ts:273`) that is unrelated
    and out of scope.
  - `constructor`-level `inject(CanvasLayoutService)` — `canvas.store.ts:56`.
    **Deleted.**
- **New public surface (replacing `updateTilePosition`):**
  - `reorderTiles(orderedTabIds: readonly string[]): void` — assigns dense
    `order` in the given sequence. Ignores unknown ids; any stored tile absent
    from the argument keeps its relative order after the listed ones (defensive:
    a partial node list must not silently drop a tile).
  - `setTileWeights(weights: ReadonlyMap<string, number>): void` — writes
    `weight` for the listed tabIds, leaves others untouched, clamps to
    `> 0` and finite.
  - Both return the existing array reference unchanged when the write is a
    no-op, so the signal does not notify (the secondary loop guard).
- **Dependencies:** `TabManagerService` (`canvas.store.ts:55`), `SessionId`
  (`:3`). `CanvasLayoutService` removed. Direction: store → chat lib only, as
  today; frontend-only, no backend import (root `CLAUDE.md` isolation rule).
- **Integration points:** written by `CanvasWorkspaceGridComponent.onGridChange`;
  read by `CanvasWorkspaceGridComponent.tiles` via `tilesFor(path)`; driven by
  `OrchestraCanvasComponent`'s workspace/prune/adopt effects
  (`orchestra-canvas.component.ts:279-359`), none of which touch `.position`
  and so need no change.
- **Failure behaviour:** already-defensive style is preserved — cap checks
  return `null` (`:128`, `:152`, `:169`), `ensureActivePath()` seeds lazily
  (`:399-405`). New writers are no-ops on unknown tabIds rather than throwing;
  a weight of `NaN` or `≤ 0` is coerced to the default rather than stored.
- **Quality requirements:** every write stays immutable
  (`updateActiveTiles`, `:376-385`); no new reactive reads inside writers; the
  file stays under the 700-line soft ceiling (it is 451 today and shrinks).
- **Verification seam:** `canvas.store.spec.ts` with the existing
  `TabManagerService` mock. The `CanvasLayoutService` provider
  (`canvas.store.spec.ts:72-82`) is deleted from the TestBed — its absence is
  itself the proof the dependency is gone.
- **Files:**
  - MODIFY `D:\projects\ptah-extension\libs\frontend\canvas\src\lib\canvas.store.ts`
  - MODIFY `D:\projects\ptah-extension\libs\frontend\canvas\src\lib\canvas.store.spec.ts`

### 3. CanvasWorkspaceGridComponent — projection and gesture translation

- **Purpose:** the only place that talks to Gridstack. Projects derived layout
  into the grid one way, and translates finished gestures back into intent.
- **Responsibilities:**
  - Grid options: `float: false`, `column: 12`, `margin: 8`,
    `resizable.handles: 'e, w'`, `draggable.handle: '.tile-header'`,
    `animate: true`.
  - Template `[options]` bound from the derived layout keyed by `tabId`, not
    from a stored `position`.
  - Apply effect: derive → `batchUpdate(true)` → `cellHeight` → `update` each
    node → `batchUpdate(false)`, wrapped in `_applyingLayout`.
  - `onGridChange`: drop while `_applyingLayout` or `locked()`; otherwise read
    `grid.engine.nodes` and dispatch on the latched gesture.
  - Lock effect and visibility re-measure effect: unchanged in intent, the
    latter now wrapped in the same flag.
- **Verified contracts and entry points:**
  - `GridstackComponent` / `GridstackItemComponent` / `nodesCB` from
    `gridstack/dist/angular` — `canvas-workspace-grid.component.ts:12-16`;
    declarations at `gridstack.component.d.ts:68`, `:25-28` and
    `gridstack-item.component.d.ts:37`.
  - `changeCB: EventEmitter<nodesCB>` — `gridstack.component.d.ts:126`.
  - `dragStopCB: EventEmitter<elementCB>` — `gridstack.component.d.ts:134`.
    **New binding.**
  - `resizeStopCB: EventEmitter<elementCB>` — `gridstack.component.d.ts:146`.
    **New binding.**
  - `get grid(): GridStack | undefined` — `gridstack.component.d.ts:161`.
  - `GridStack.batchUpdate(flag?)` — `gridstack.d.ts:226`; verified to emit
    `change` on close at `gridstack.js:730-739`.
  - `GridStack.cellHeight(val?)` — `gridstack.d.ts:258`.
  - `GridStack.setStatic` — used today at `canvas-workspace-grid.component.ts:170`.
  - `grid.engine.nodes` — read today at `canvas-workspace-grid.component.ts:145`.
  - `(grid as { onResize?: () => void }).onResize?.()` — the existing
    re-measure escape hatch at `canvas-workspace-grid.component.ts:161`. Keep
    the cast and its comment; wrap the call in `_applyingLayout`.
  - Host `[style.display]` keep-alive binding —
    `canvas-workspace-grid.component.ts:38-48`. **Do not touch.** Its comment
    documents a production-only regression; it is load-bearing.
- **The three effects, precisely:**
  1. _Apply._ Reads `visible()`, `locked()`, `layoutService.containerWidth()`,
     `containerHeight()` and — **now** — `tiles()` itself. Returns early if not
     visible, if locked, if the grid is not yet built, or if there are no tiles.
     The `tileCount` computed (`:112-125`) is deleted along with its comment;
     the comment is replaced by one naming `_applyingLayout` as the new guard,
     because the old comment will otherwise read as a live warning against the
     code that now sits beneath it.
  2. _Visibility re-measure._ Unchanged (`:157-164`) except for the flag wrap.
  3. _Lock._ Unchanged (`:167-171`).
- **`onGridChange` contract:**
  - `if (this._applyingLayout) return;` — first line.
  - `if (this.locked()) return;` — goal 5, defence in depth.
  - Read `grid.engine.nodes`, not `data.nodes`: with `float: false` a drag
    pushes neighbours whose ids are not necessarily in the dirty set
    (`gridstack.js:1686` filters to dirty nodes).
  - Gesture `'drag'` → `reorderTiles(nodes sorted by (y asc, x asc).map(id))`.
    Weights untouched — a tile keeps its emphasis when it moves.
  - Gesture `'resize'` → `setTileWeights(new Map(nodes.map(n => [n.id, n.w])))`.
    Order untouched. Reading `n.w` in raw units is what makes the round-trip
    idempotent: the re-derivation apportions the same integers back.
  - Gesture `null` (a `change` from neither stop handler and not suppressed) →
    return without writing. There is no legitimate third source; writing on one
    would be guessing.
  - Latch is cleared after dispatch. Nodes with a non-string `id` are skipped
    (the existing guard at `:180-181`).
- **Dependencies:** `CanvasStore` (`:93`), `CanvasLayoutService` (`:94`),
  `CanvasTileComponent` (`:19`), Gridstack. Direction: component → services;
  services never import the component.
- **Integration points:** instantiated once per retained workspace by
  `OrchestraCanvasComponent` (`orchestra-canvas.component.ts:71-78`) with
  `[workspacePath]`, `[visible]`, `[locked]` — all three inputs unchanged.
- **Failure behaviour:**
  - `_applyingLayout` is cleared in a `finally`, so a throwing `grid.update`
    cannot wedge the grid into permanently ignoring user gestures. This is the
    single worst failure mode of the chosen guard and the `finally` is not
    optional.
  - A node whose `tabId` has no entry in the derived layout is skipped, not
    positioned at `(0,0)`.
  - A `changeCB` arriving before the grid is built, or while hidden, is a no-op.
- **Quality requirements:** OnPush (`:36`), zoneless-safe (signals + `effect`,
  no `setTimeout` in the layout path), no layout math while
  `display: none` (the `visible()` guard, per the class comment at `:30-32`).
- **Verification seam:** a TestBed spec over the component with a hand-rolled
  Gridstack stub — the `jest.mock('gridstack/dist/angular', …)` pattern already
  proven at `orchestra-canvas.component.spec.ts:35-60`, extended so the stub's
  `grid` exposes `engine.nodes`, `update`, `cellHeight`, `batchUpdate` and
  `setStatic` as spies, and the stub component exposes its `changeCB` /
  `dragStopCB` / `resizeStopCB` emitters so a test can fire a gesture. This is
  the smallest boundary at which "no snap-back" and "no feedback loop" are
  observable.
- **Files:**
  - MODIFY `D:\projects\ptah-extension\libs\frontend\canvas\src\lib\canvas-workspace-grid.component.ts`
  - CREATE `D:\projects\ptah-extension\libs\frontend\canvas\src\lib\canvas-workspace-grid.component.spec.ts`

### 4. OrchestraCanvasComponent — measurement accuracy and lock

- **Purpose:** unchanged panel host. Two narrow changes only.
- **Responsibilities / changes:**
  - Change the grid host class from `w-[97%]` to `w-full`
    (`orchestra-canvas.component.ts:73`). The layout service observes
    `#canvasContainer` (`:262-267`); with the child at 97% the measured width
    overstates the grid's real width by ~3%, which at a 480 px threshold moves
    the 2→3 column boundary by roughly 45 px — i.e. the column count would be
    computed from a width the tiles do not have. Gutters are already handled by
    Gridstack's `margin: 8`. The vertical scrollbar that `overflow-auto`
    introduces is the reason the 97% exists; pair the change with
    `scrollbar-gutter: stable` on the grid host so reserving that space cannot
    itself oscillate the measured width.
  - Update the `toggleLock` doc comment (`:420-426`): "freezes the auto-layout
    effect" is still true, but it should now also say that `onGridChange`
    refuses to write intent while locked, so locked means _no layout writes_
    rather than _no layout recomputation_.
- **Verified contracts and entry points:**
  - `providers: [CanvasStore, CanvasLayoutService]` — `:52`. Unchanged;
    per-panel scoping is a hard rule (`canvas/CLAUDE.md:47`).
  - `layoutService.observe(el)` in `afterNextRender` — `:262-267`. Unchanged.
  - `locked` signal and `toggleLock()` — `:243`, `:427-429`. Unchanged.
  - Every workspace/prune/adopt/destroy effect — `:268-359`, `:439-446`.
    Unchanged; none reads `.position`.
- **Dependencies:** unchanged.
- **Integration points:** unchanged.
- **Failure behaviour:** unchanged.
- **Quality requirements:** the lock button keeps `aria-pressed` and its
  label pair (`:90-97`) — the accessibility contract must not regress.
- **Verification seam:** `orchestra-canvas.component.spec.ts`; its
  `canvasStoreMock` (`:137-160`) must be updated to the new store surface
  (`reorderTiles` / `setTileWeights` instead of `updateTilePosition`, tiles
  carrying `order`/`weight`). All existing assertions in that file should
  continue to pass unchanged — if one does not, the change has leaked past its
  intended scope.
- **Files:**
  - MODIFY `D:\projects\ptah-extension\libs\frontend\canvas\src\lib\orchestra-canvas.component.ts`
  - MODIFY `D:\projects\ptah-extension\libs\frontend\canvas\src\lib\orchestra-canvas.component.spec.ts`

### 5. Documentation surface

- **Purpose:** keep `canvas/CLAUDE.md` true. It currently describes the model
  this task deletes.
- **Responsibilities:** correct these verified inaccuracies:
  - `canvas/CLAUDE.md:26` — "`ResizeObserver` + RAF driver computing responsive
    grid layout across breakpoints (500/900 px)" → columns from a minimum tile
    width, clamped 1..3.
  - `canvas/CLAUDE.md:34` — "Gridstack events `(changeCB)` → store position
    updates" → gesture-typed intent updates (drag → order, resize → weight),
    with the `_applyingLayout` suppression named.
  - `canvas/CLAUDE.md:48` — "Position changes must flow through Gridstack's
    `changeCB`" → intent changes flow through `changeCB`; positions are derived
    and never stored.
  - `canvas/CLAUDE.md:39` — "gridstack (v12.5.0)" → 12.6.0 (verified in
    `node_modules/gridstack/package.json`). Pre-existing drift, fixed in
    passing.
  - `canvas/CLAUDE.md:16` — Public API list: unchanged, and say so.
- **Verified contracts:** the file paths and line anchors above.
- **Failure behaviour:** not applicable.
- **Verification seam:** review only.
- **Files:**
  - MODIFY `D:\projects\ptah-extension\libs\frontend\canvas\CLAUDE.md`

## Integration architecture

- **Data flow (boundary to boundary):**
  1. `ResizeObserver` on `#canvasContainer` → RAF → `CanvasLayoutService`
     `containerWidth` / `containerHeight` signals
     (`canvas-layout.service.ts:45-59`).
  2. `CanvasStore.tilesFor(path)` → `CanvasWorkspaceGridComponent.tiles()`
     (intent).
  3. `computed` in the grid component: `(intent, width, height)` →
     `CanvasLayoutService.computeLayout(...)` → `{ cellHeight, columns,
tiles: PositionedTile[] }`.
  4. Apply effect (guarded by `visible()`, `locked()`, `_applyingLayout`) →
     `grid.cellHeight(...)` + `grid.update(el, {x,y,w,h})` per node.
  5. User gesture → `dragStopCB` / `resizeStopCB` latch → `changeCB` →
     read `grid.engine.nodes` → `CanvasStore.reorderTiles(...)` or
     `setTileWeights(...)`.
  6. Step 5 invalidates step 2, so 3 and 4 re-run; the `change` that 4 provokes
     is dropped at step 5's first line. The cycle closes in exactly one pass.
- **State or persistence:** in-memory only, owned by the per-panel `CanvasStore`
  and partitioned by workspace path (`canvas.store.ts:68-79`). Lifetime is the
  `OrchestraCanvasComponent` instance; `ngOnDestroy` force-closes every retained
  tab (`orchestra-canvas.component.ts:439-446`). Intent survives a workspace
  round-trip through the same map that survives positions today
  (`canvas.store.ts:429-450`, LRU eviction drops the _mount_, not the entry).
  No localStorage, no RPC, no backend involvement — nothing crosses the
  frontend/backend boundary, so no Zod schema is required.
- **External boundaries:** none. All input is same-process DOM measurement and
  Gridstack callbacks. The one untrusted-shaped value is `GridStackNode.id`,
  already narrowed with `typeof node.id !== 'string'`
  (`canvas-workspace-grid.component.ts:180-181`); keep that guard, and add the
  same defensive treatment to `node.w` / `node.x` / `node.y`
  (`?? fallback`, reject non-finite) before they become intent.
- **Failure and rollback:** there is no multi-step transaction to roll back. The
  system is convergent: if a write is dropped or a derivation is skipped, the
  next signal change re-derives from intent, which is never corrupted by a
  partial apply. The one non-convergent risk is a stuck `_applyingLayout`,
  neutralised by the `finally`.
- **Observability:** not applicable — the lib has no logger and adding one for
  layout would be noise. The observable failure surface is the DOM itself; a
  wrong layout is visible. The `_applyingLayout` mechanism, which is the one
  invisible-if-broken piece, is covered by an explicit spec (see below) rather
  than by logging.

## Architecture-level quality requirements

- **Functional:**
  - At container width 1180 px, `columns === 2` (the reported case).
  - Every derived row's `w` values sum to exactly `12`, for any tile count 1..9
    and any weight vector.
  - Derived layouts have no gaps: `y` values are contiguous multiples of
    `TILE_HEIGHT_UNITS` and each row starts at `x === 0`.
  - A container resize changes only `columns`, `cellHeight` and the derived
    `x`/`w`; stored `order` and `weight` are byte-identical before and after.
  - Locked: zero calls to `grid.update`, zero writes to `CanvasStore`.
- **Performance:** `computeLayout` is O(n) in tiles (n ≤ 9) and is called from
  a `computed`, so it runs at most once per invalidation. Measurement stays
  RAF-coalesced (`canvas-layout.service.ts:47-57`). The apply path stays inside
  one `batchUpdate` so a container resize causes one reflow, not n. The
  O(n²) `computeLayout`-per-seeded-tile loop at `canvas.store.ts:264-276` is
  removed outright.
- **Security:** not applicable — no user-authored content, no HTML rendering, no
  external input. The XSS chokepoint rule (`libs/frontend/markdown`) is
  untouched.
- **Maintainability:**
  - One authority for geometry: `CanvasLayoutService`. Gridstack is a renderer,
    not a store. No code outside `CanvasWorkspaceGridComponent` may call a
    Gridstack API.
  - `TileLayout`'s shape is frozen by an out-of-lib consumer
    (`tribunal-panel`); changing it is a cross-lib break and out of scope.
  - `CanvasStore` must stay non-root (`canvas/CLAUDE.md:47`).
  - Frontend libs must not import backend libs (root `CLAUDE.md`); nothing here
    comes close, but the layout service must not acquire a Gridstack import,
    which is the realistic drift.
  - No file exceeds the 700-line soft ceiling; all four sources shrink or hold.
- **Testability (behaviour, not percentage):** the six behaviours listed under
  _Verification points_ must each be pinned by at least one spec that fails
  against today's code.

## Team-leader handoff

- **Recommended executors:**
  - Component 1 (`CanvasLayoutService` + spec) — `frontend-developer`. Pure
    arithmetic with an exact, checkable invariant; no framework surface.
  - Component 2 (`CanvasStore` + spec) — `frontend-developer`. Signal-store
    refactor inside an existing partition scheme that must not be disturbed.
  - Component 3 (`CanvasWorkspaceGridComponent` + spec) — `frontend-developer`.
    The highest-risk piece: third-party event semantics, effect re-entrancy, and
    a jest stub that has to model Gridstack faithfully enough to be meaningful.
    Assign the strongest executor here.
  - Component 4 (`OrchestraCanvasComponent` + spec) — `frontend-developer`.
    Two-line source change plus mock upkeep.
  - Component 5 (`canvas/CLAUDE.md`) — `frontend-developer`, folded into
    whichever batch lands last.
  - After components 1–4: `senior-tester` for the acceptance run, then
    `visual-reviewer` for the rendered behaviour (drag feel, the removed
    vertical resize handles, the 2-column result with the editor open).
- **Complexity: MEDIUM-HIGH.** Small surface (four files, ~1200 lines total) but
  three genuinely subtle mechanisms: an event-ordering assumption inside a third
  party (`gridstack.js:2635` before `:2639`), a deliberate effect re-entrancy
  guard, and a round-trip that is only correct because it is idempotent. Two of
  the three are invisible when wrong until a user drags something.
- **Dependencies and ordering:**
  - Component 1 first — it declares `TileIntent` / `PositionedTile`, which 2 and
    3 both import.
  - Components 2 and 3 both depend on 1. Component 3 also depends on 2's new
    writer names.
  - Component 4 depends on 2 (its spec mock mirrors the store surface).
  - Component 5 last.
- **Parallel-safe work:** after component 1 lands, components 2 and 3 touch
  disjoint files and can run concurrently **provided** the exact signatures of
  `reorderTiles` and `setTileWeights` are fixed in component 1's batch as part
  of the agreed contract. If the team-leader would rather not pin signatures
  across batches, run 1 → 2 → 3 → 4 serially; the total surface is small enough
  that the serial cost is low.
- **Files affected:**
  - CREATE
    - `D:\projects\ptah-extension\libs\frontend\canvas\src\lib\canvas-layout.service.spec.ts`
    - `D:\projects\ptah-extension\libs\frontend\canvas\src\lib\canvas-workspace-grid.component.spec.ts`
  - MODIFY
    - `D:\projects\ptah-extension\libs\frontend\canvas\src\lib\canvas-layout.service.ts`
    - `D:\projects\ptah-extension\libs\frontend\canvas\src\lib\canvas.store.ts`
    - `D:\projects\ptah-extension\libs\frontend\canvas\src\lib\canvas.store.spec.ts`
    - `D:\projects\ptah-extension\libs\frontend\canvas\src\lib\canvas-workspace-grid.component.ts`
    - `D:\projects\ptah-extension\libs\frontend\canvas\src\lib\orchestra-canvas.component.ts`
    - `D:\projects\ptah-extension\libs\frontend\canvas\src\lib\orchestra-canvas.component.spec.ts`
    - `D:\projects\ptah-extension\libs\frontend\canvas\CLAUDE.md`
  - REWRITE: none.
  - UNCHANGED (explicitly out of scope, do not touch):
    `src\index.ts`, `canvas-tile.component.ts`, `canvas-tile.component.spec.ts`,
    `canvas-empty-state.component.ts`, `tile-agent-indicator.component.ts`,
    `tile-agent-mini-panel.component.ts`, everything under
    `libs\frontend\tribunal-panel`, and
    `apps\ptah-electron-e2e\src\specs\canvas\canvas.spec.ts`.

- **Verification points:**

  _References to confirm before writing code (each already cited above; re-open
  if a signature surprises you):_ `gridstack.js:730-739` (batch emits change),
  `gridstack.js:2635` vs `:2639` (stop before change), `gridstack.js:1686`
  (dirty-node filter), `gridstack.component.d.ts:126,134,146` (emitters),
  `tribunal-ui.types.ts:2` (`TileLayout` is external).

  _Contracts to honour:_ every name in `src/index.ts`; `TileLayout` shape;
  `MAX_TILES = 9`; `RETAINED_WORKSPACE_CAP = 4`; `MIN_TILE_VIEWPORT_RATIO`
  and the scroll rule; the `[style.display]` keep-alive binding; `CanvasStore`
  non-root; OnPush everywhere.

  _Specs that break and must be rewritten (not deleted):_
  - `canvas.store.spec.ts:107-120` "round-trip A->B->A preserves custom
    positions" → preserves custom **intent** (order + weight).
  - `canvas.store.spec.ts:122-133` "seeds first-visit workspace from activeTabs
    using layout positions" → seeds dense `order` and default `weight`.
  - `canvas.store.spec.ts:220-250` LRU-eviction test's
    `updateTilePosition` / `position` assertions → intent equivalents.
  - `canvas.store.spec.ts:72-82` the `CanvasLayoutService` provider and mock →
    deleted.
  - `orchestra-canvas.component.spec.ts:137-160` `canvasStoreMock` shape →
    updated to the new store surface.

  _New specs that must pin the six task behaviours:_
  1. **Column count from width** — `columnsFor` / `computeLayout` returns 1, 2
     and 3 across the boundary widths, with 1180 px → 2 asserted by name as the
     regression case, and the exact boundary values derived from
     `MIN_TILE_WIDTH` rather than hard-coded twice.
  2. **Fill-remainder** — for 4 tiles at 3 columns, row 0 is `4/4/4` and row 1
     is a single tile at `x=0, w=12`; and property-style, for every tile count
     1..9 and several weight vectors, each row's widths sum to `12` and no
     width is below `MIN_TILE_UNITS`.
  3. **Reorder on drag** — firing `dragStopCB` then `changeCB` against a stub
     whose `engine.nodes` describe a swapped arrangement calls
     `reorderTiles` with the new sequence and does **not** call
     `setTileWeights`.
  4. **Weight on resize** — firing `resizeStopCB` then `changeCB` with widened
     node widths calls `setTileWeights` with those widths and does **not** call
     `reorderTiles`; and re-deriving from those weights reproduces the same
     widths (the idempotence assertion that makes "no snap-back" true rather
     than hoped for).
  5. **No snap-back after a container resize** — set a non-default weight and a
     non-default order, change `containerWidth` so `columns` changes, flush, and
     assert the store's `order`/`weight` are unchanged and the applied layout
     still reflects them.
  6. **Lock freezes layout** — with `locked() === true`: `setStatic(true)` is
     called; a container-size change produces zero `grid.update` calls; and a
     `changeCB` (however provoked) produces zero store writes.
  7. **No feedback loop** — the apply effect's own `changeCB` (fired
     synchronously from the stub's `batchUpdate(false)`, mirroring
     `gridstack.js:736`) results in zero store writes; and a single user gesture
     settles after exactly one apply pass, asserted by spying the apply count.

  _Commands that must pass:_
  - `npx nx run-many -t test -p @ptah-extension/canvas @ptah-extension/tribunal-panel`
    (tribunal included because it imports `TileLayout`; note the repo rule —
    never `nx test projA projB`, and check the `Running target test for 2
projects` header).
  - `npx nx run-many -t lint -p @ptah-extension/canvas`
  - `npm run typecheck:all` (or `npx nx run-many -t typecheck -p
@ptah-extension/canvas @ptah-extension/tribunal-panel`)
  - Manual/visual, by `visual-reviewer`: editor panel open at ~1180 px shows two
    columns; a 4th tile creates a full-width second row; dragging a tile
    reorders and the arrangement survives opening/closing the editor panel;
    the lock button still freezes everything; vertical resize handles are gone
    (expected, not a regression).
