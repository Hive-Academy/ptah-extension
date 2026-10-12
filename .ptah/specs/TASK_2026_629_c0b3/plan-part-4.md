# Implementation Plan - TASK_2026_629_c0b3 - Part 4: Detached canvas tile leak (hot spot 7)

## 1. Inputs and constraints

- Requirements used: `D:\projects\ptah-wt-628\.ptah\specs\TASK_2026_628_5ab5\implementation-plan.md`
  R3 (:81-104), R3.1 (:120-145), R3.2 (:147-155), R3 tests (:157-167), user decisions (:169-179),
  open items (:181-202), Part B3 Batch 7 (:1357-1405), D7.1-D7.3 (:1433-1435), heap steps (:1450-1459).
  This task's plan: `implementation-plan.md` D1 (:23-41), D6 (:91-97), batch table (:270-271).
- 628 user decision (628 plan :172-177): Batch 7 moves to 629. 628 edits no canvas file. R3, R3.1
  and R3.2 are input only. This part replaces them where they conflict (see section 3, "Changes to R3").
- Open item 1 (628 plan :185-189) is binding: release all nodes only when the tile SET is empty. Never
  key a release on `positioned.length === 0`.
- Open item 2 (628 plan :190-201) is binding: a test on the real GridStack engine must prove that
  row-break gaps stay after a release.
- Scope: only `libs/frontend/canvas` (Nx project `@ptah-extension/canvas`). No change to
  `canvas-layout-intent.ts`, `canvas-layout.service.ts`, `canvas-tile.component.ts` or `node_modules`.
- The review files `implementation-plan-review-r1.md` / `-r2.md` were not re-read. Their hot spot 7
  findings are already restated in the 628 plan open items (:181-202). No decision depends on more.
- gridstack is not installed in this worktree. Evidence is from gridstack 12.6.0 at
  `D:\projects\ptah-extension\node_modules\gridstack\dist` (same version in `D:\projects\ptah-wt-628`).

## 2. Root cause (evidence)

### 2.1 What holds the detached tree

| Evidence | Location | Implication |
| --- | --- | --- |
| The apply walks `grid.engine.nodes` and skips a node whose id has no derived target: `if (!target) continue;` | `canvas-workspace-grid.component.ts:758-761` | A node of a closed tile is tolerated, never removed. |
| No code in the component calls `removeWidget` / `removeNode`. `ngOnDestroy` only clears `_gesture` and `_gestureStopped`. | `canvas-workspace-grid.component.ts:883-886` | Nothing tile-related is released. |
| An engine node keeps `node.el` (the `gridstack-item` host element). `removeWidget` is the only path that deletes `el.gridstackNode`, calls `_removeDD(el)` and filters the node out of `engine.nodes`. | `gridstack.js:1228-1258` | While the node stays in `engine.nodes` (a JS array), its `el` and the whole detached subtree stay reachable. |
| The host element is the `ElementRef.nativeElement` of `GridstackItemComponent` (`deps: [ElementRef]`). It sets `this.el._gridItemComp = this` and deletes it in its own `ngOnDestroy`. | `gridstack-angular.mjs:101`, `:137-140`, `:145` | The retained `nativeElement` is the `gridstack-item` element, held by `engine.nodes[i].el`. |
| `creationOptions` is a `Map<string, GridStackWidget>`. Its entries are the objects the template passes as item options. | `canvas-workspace-grid.component.ts:321`, `:338-350` | Second possible holder if Gridstack adopts the option object as the node. It is pruned on each `items` recompute (`:326-329`) but never cleared on destroy. |
| A stale node also breaks gestures: the gesture snapshot is rejected when `nodes.length !== gesture.expectedTabIds.length`. | `canvas-gesture-observation.ts:23` | Release also fixes a second symptom (rejected gestures after a close). Assumption: `expectedTabIds` comes from the live tile set; implementer confirms at the `_gesture = {...}` site (`canvas-workspace-grid.component.ts:494`). |

### 2.2 Why the wrapper does not remove the node

- The wrapper re-loads on every `gridstackItems` change: `updateAll()` calls `this.grid.load(layout)`
  with `addRemove` defaulted to `GridStack.addRemoveCB` (`gridstack-angular.mjs:322`, `:341-350`,
  `:237-238`; `gridstack.js:621`). That `load()` removes engine nodes that are missing from the new
  layout (`gridstack.js:658-671`).
- Assumption (not proven from source within this pass): in the leak case this diff does not run or
  does not match the node (for example, the `changes` emission is skipped, or the node has no `id`,
  which `gridstack.js:662-663` skips). The 628 plan also lists the exact retainer as unverified
  (628 plan :233). The fix does not depend on which branch fails: the component owns the authoritative
  write and must not tolerate a node whose id is not in the tile set. Heap step 3 (section 6) confirms
  the retainer after the fix.

### 2.3 Why the obvious fix moves live tiles (trap a)

| Evidence | Location |
| --- | --- |
| The grid uses `float: false`. | `canvas-workspace-grid.component.ts:220` |
| `removeNode` filters `nodes` and then calls `_packNodes()` (unless `_isAboutToRemove`), even with `removeDOM=false` and `triggerEvent=false`. | `gridstack-engine.js:786-801` |
| With float false, `_packNodes` is a top-gravity pack that moves each node up while it does not collide. It skips a node with `locked` set. It returns early in batch mode. | `gridstack-engine.js:427-465` (early return :428-430, `locked` skip :450-451) |
| `GridStack.load()` opens and closes its own batch. The engine batch close restores `_float` and packs. `GridStack.batchUpdate` does not pass `doPack`. | `gridstack.js:652`, `:730-737`; `gridstack-engine.js:47-63` |
| Batches do not nest: `engine.batchUpdate(flag)` returns when the flag does not change, so `load()` closes any outer batch. | `gridstack-engine.js:48-49` |
| `set float(false)` packs at once. | `gridstack-engine.js:393-399` |
| A row break lifts the reading floor to the skyline maximum, so a later tile can sit below empty cells. | `canvas-layout-intent.ts:568-570`, `:590-611` |

Result: when the stale node of a closed tile sits in cells above a live tile after a row break, it
holds the gap open by accident. Any release (or any `load()` close) without protection packs that live
tile up, against the derived layout. Note: the same pack already happens today at every `load()` close
for a gap that no stale node fills. The fix below also removes that drift.

## 3. Fix design

### 3.1 Decision: pin live nodes for the authoritative window

- Requirement: release stale nodes without any live tile moving off its derived geometry.
- Chosen approach: during `applyAuthoritativeGeometry`, set `locked = true` on every live engine node
  before the release, keep it through `load()`, and restore each node's previous `locked` value in
  `finally`. `_packNodes` skips locked nodes (`gridstack-engine.js:450-451`), so neither the
  `removeNode` pack nor the `load()` batch-close pack can move a live tile. `load()` re-pushes the same
  node objects (`gridstack.js:677-683`, `:698`), so the flag survives the load.
- Collisions: `load()` takes all updated nodes out of `engine.nodes` first and re-adds them one by one
  at derived coordinates (`gridstack.js:677-703`). The derived layout is collision-free, so a locked
  node never blocks a placement. Assumption: implementer confirms with the real-engine test (5.2).
- The flag is set directly on the node objects, not through `grid.update()`, so no engine method runs
  and nothing packs during pin or unpin. Assumption: the canvas sets no node-level `locked` today
  (implementer greps `\.locked\b` and `locked:` in `libs/frontend/canvas/src/lib`; only the canvas
  lock signal `this.locked()` is expected). If one exists, restore the saved prior value, never `false`.
- Rejected alternatives:
  - Release inside an outer `grid.batchUpdate(true)` (628 R3): `load()` closes that batch and packs
    (`gridstack-engine.js:48-49`, `gridstack.js:652`, `:730`). R3.1 already withdrew it.
  - Toggle `grid.float(true)` around the write: restoring `float(false)` packs at once
    (`gridstack-engine.js:393-399`). Restoring it inside a batch makes the batch close restore the saved
    `_prevFloat` (true) (`gridstack-engine.js:51-53`, `:57-58`), so the grid stays floating.
  - Make the grid `float: true` for good: it changes drag behaviour that the intent projection assumes
    (`canvas-workspace-grid.component.ts:219-220`, `:536`; `canvas-layout-intent.spec.ts:429`). That is
    a gesture redesign, not a leak fix.
  - Placeholder nodes in gaps: they add fake ids to `engine.nodes` and break the gesture node-count check
    (`canvas-gesture-observation.ts:23`).
- Effect on existing code: the derived layout now stays exact after every apply, also for gaps that no
  stale node fills today. Gestures are unchanged, because nodes are unpinned before the method returns.

### 3.2 Hunks in `canvas-workspace-grid.component.ts`

Existing order (`:717-826`): inactive return (:721-724) -> locked return (:725) -> gesture defer
(:726-729) -> layout (:730-738) -> `positioned.length === 0` return (:741-746) -> grid lookup (:747-748)
-> `changed` (:750-777) -> `_applyingLayout = true` and `try` (:779-781) -> `load()` (:786-803) ->
`finally` (:812-825).

New order (the first three returns are unchanged):

1. Compute the layout as today (:730-740).
2. Get `grid = this.gridComp()?.grid` BEFORE the `positioned.length === 0` return (move :747 up; keep
   `if (!grid) return;` after the early return for the write path).
3. Build `liveIds = new Set(this.tiles().map((t) => t.tabId))` from the intent tile SET, not from
   `positioned`. On a zero-size measurement `positioned` is empty but the set is not
   (`canvas-layout.service.ts:141-143`), so no live node is released (trap b).
4. Set `this._applyingLayout = true` and open the existing `try`. Move the `try` start up so it
   covers steps 5-8 (one `finally` restores pins, static mode and `_applyingLayout`).
5. Pin: for each node in `grid.engine.nodes` whose `id` is in `liveIds`, save `node.locked` and set
   `node.locked = true`. Save the list in a local array.
6. Release (only when `this._gesture === null`, trap c): new private method
   `releaseStaleNodes(grid, liveIds)`:
   - Collect first, remove after the walk, because `removeNode` reassigns `engine.nodes`
     (`gridstack-engine.js:796`).
   - A node is stale when `typeof node.id !== 'string' || !liveIds.has(node.id)`. Reason: a node
     without an id is never matched by the wrapper diff (`gridstack.js:662-663`), and the canvas gives
     every item an id (`:345`).
   - For a stale node with `el`: `grid.removeWidget(node.el, false, false)` (`removeDOM=false`:
     Angular owns the DOM; `triggerEvent=false`: no `change`, no `removedNodes` entry,
     `gridstack.js:1252-1255`, `gridstack-engine.js:791-793`). For a stale node without `el`:
     `grid.engine.removeNode(node, false, false)`.
   - Increment a new metric `releasedNodes` (see 3.4) per node.
   - The `force` path (locked canvas, view-mode apply at :411) also needs the explicit gesture check,
     because the defer at :726 runs only when `!force`.
7. If `positioned.length === 0`, run the existing early-return body (:742-745) and return (the
   `finally` restores pins). When the tile set is empty, step 6 has released every node (R3.2 and open
   item 1). When the set is not empty (zero size), only stale nodes went.
8. Compute `changed` AFTER the release (today's loop :754-777, unchanged). The `!target` skip at
   :761 stays as a guard but no longer meets a stale node when no gesture is active.
9. Write with the existing `grid.load(..., false)` (:793-803, unchanged).
10. `finally`: restore each pinned node's saved `locked` value (before `setStatic(true)` and
    `applyNodeInteractionState`, :814-817), then the existing static restore, `_applyingLayout = false`
    and `metrics.publish()`.

Drift check (from 628 R3.1, diagnostic only): after step 9, if any live engine node differs from its
derived target, increment `geometryDrift`. Do not apply again in the same pass.

Skipped applies: when the grid is inactive (:721), locked without force (:725) or in a gesture
(:726), the stale node waits for the next apply. A locked canvas therefore keeps a closed tile's node
until unlock or destroy. Accepted: it is bounded to the tiles closed while locked.

### 3.3 `creationOptions` and `ngOnDestroy`

- Keep the prune loop where it is (`:326-329`). It runs on every `tiles()` change while the template
  reads `items`. Do not move it: 629 B5 edits computeds around :362, and a move adds merge risk for no
  gain. (This differs from 628 Part B3 item 2.)
- `ngOnDestroy` (:883-886): add `this.creationOptions.clear()`. Do not call `removeAll` or `destroy`;
  the wrapper calls `grid.destroy()` in its own `ngOnDestroy` (`gridstack-angular.mjs:328-336`).
  Double teardown can touch `this.el` after destroy (628 D7.3).

### 3.4 Metrics

- Add `releasedNodes` and `geometryDrift` counters to `CanvasRenderMetricsService` only if the
  service keys counters by a fixed type (the `metric()` signature reads
  `keyof ReturnType<CanvasRenderMetricsService['snapshot']>`, `:862-867`). Assumption: implementer
  opens the service and adds the two keys next to `applyPasses` / `gridUpdates`. If adding keys there
  touches a file that another batch edits, drop `releasedNodes` and keep only the tests.

### Changes to 628 R3 / R3.1 / R3.2

- R3 "one batch": withdrawn (as in R3.1).
- R3.1 order kept (release -> `changed` -> `load()`), plus pin/unpin around it. R3.1's claim "the
  release adds no packing after the authoritative write" is not enough: the `load()` close packs live
  tiles into the gap the release opened. The pin closes that hole.
- R3.2 replaced: key on the tile SET (step 3), not on `positioned.length === 0`.

## 4. Interaction with the 629 redesign and batch recommendation

- D6 (`implementation-plan.md:91-97`): the detail panel is an overlay next to the grid, not a
  Gridstack item. It adds no engine node and no `gridstack-item`, so it adds no leak path. Its
  `translateY` shift does not change Gridstack `x/y/w/h` (:97), so it does not interact with the pin.
- D1 (`implementation-plan.md:23-41`): card mode changes tile content, not tile geometry. It does not
  remove the leak path: a closed tile still leaves its engine node. It only makes the leaked subtree
  smaller when the closed tile was in card mode (no transcript DOM). With 1-2 tiles all tiles stay live,
  so the full transcript tree can still leak.
- Conclusion: the redesign neither removes nor changes the leak path. The fix is still needed.
- Batch recommendation: **own batch** (call it B5a), after B5 and before the B6 spike.
  - Reasons: B5 touches the same file (template, one input ~:202, one computed ~:362, styles,
    `[autoCard]` binding) but different regions. The leak fix touches `applyAuthoritativeGeometry`,
    a new private method, `ngOnDestroy` and possibly the metrics service. It needs a new real-engine
    spec and carries geometry risk. A separate batch keeps the geometry change revertible without
    losing step 1 (D1 "Step 1 must ship alone").
  - Same file as B5, so not parallel-safe with B5. Run B5 first; B5a rebases on it.
  - B6 adds `canvas-workspace-grid.detail.spec.ts` and does not edit `applyAuthoritativeGeometry`, so
    B5a must land before B6 so the spike measures the fixed grid.

## 5. Tests

Commands (only if the team-leader runs checks; one at a time, filtered output):
`npx jest -c libs/frontend/canvas/jest.config.ts <changed specs> --coverage=false --maxWorkers=2`,
then `npx nx typecheck @ptah-extension/canvas --parallel=1`, `npx nx lint @ptah-extension/canvas --parallel=1`.
No workspace-wide runs, no build/serve/e2e.

### 5.1 Unit tests, mock grid (`canvas-workspace-grid.component.spec.ts`)

The spec mocks `gridstack/dist/angular` and `gridstack` (spec :45, :78) and models `engine.nodes`
(spec :157, :174). Extend that mock with `removeWidget(el, removeDOM, triggerEvent)` that filters
`engine.nodes` and deletes `el.gridstackNode`, and record the call order of `removeWidget` and `load`.

1. Close the middle of three tiles. `removeWidget(el, false, false)` is called once, before `load`.
   `load` gets the derived geometry of the two live tiles. The engine has two nodes, equal to the
   derived layout. The closed element has no `gridstackNode` and no `creationOptions` entry.
2. Stale node without a live tile (pins the :758-761 gap): push `{ id: 'ghost', el: <gridstack-item> }`
   into `engine.nodes`, trigger an apply. `ghost` is gone.
3. Gesture (trap c): start a drag, close a tile so that no `cancelGesture` runs (or set `_gesture`
   through the spec's existing seam), run the forced locked-view apply. No `removeWidget` call and no
   coordinate change. After the gesture ends, the next apply releases the node.
4. Zero size (trap b): live tiles, measured width 0 (and a second case height 0). `positioned` is
   empty. No `removeWidget` call for a live id. A stale id is released.
5. Empty set: close the last tile while the workspace stays mounted. The engine has no nodes, and
   `creationOptions` is empty.
6. Pins restored: after any apply, every live node's `locked` equals its value before the apply
   (also when `load` throws: make the mock throw once and check `finally`).
7. Destroy: `fixture.destroy()` leaves `creationOptions.size === 0`, and the component calls no
   `removeAll` / `destroy` itself.
8. `geometryDrift` stays 0 in tests 1-5. Existing layout tests pass unchanged.

### 5.2 Real-engine test for trap (a) (CREATE `canvas-grid-release.engine.spec.ts`)

- Must not use the module mock. Import `GridStackEngine` from `gridstack` (or
  `gridstack/dist/gridstack-engine`; implementer checks which path resolves under the canvas Jest
  config). The engine is DOM-free.
- To test the production logic, not a copy, put pin, unpin and stale selection in a small exported
  module `canvas-grid-release.ts` (pure functions over `{ nodes: GridStackNode[] }` and a remove
  callback). The component calls it from steps 5, 6 and 10. This is one module with two callers
  (component and spec), justified by the real-engine requirement.
- Fixture: a derived layout with a row-break gap, built by `computeLayout` (or `projectTileGeometry`)
  so the geometry comes from the real projection. Example shape: row 1 = A (full height) and B
  (compact, smaller height) side by side, then C with `rowBreakBefore: true`, then D, where D sits
  below the empty cells under B. Assert first that the fixture has a gap (D.y > skyline under D).
- Steps on a real `GridStackEngine({ column: 12, float: false })`: add A, B, C, D and a stale node E
  at its old place above D; pin live nodes; remove E through the release function with
  `engine.removeNode(node, false, false)` (what `removeWidget` calls, `gridstack.js:1247`); then
  replay the `load()` engine sequence: `engine.batchUpdate(true)`, set derived coordinates,
  `engine.batchUpdate(false)` (`gridstack.js:652`, `:730-731`; `gridstack-engine.js:47-63`); unpin.
- Assert: every live node equals its derived `x/y/w/h`, D keeps its gap.
- Control test in the same file: the same steps without pin. D moves up. This proves the test can
  fail and that the pin is the cause.
- Optional (only if `GridStack.init` runs in the canvas jsdom env): the same through a real
  `GridStack` with `removeWidget` and `load(items, false)`. If jsdom fails on layout math, skip it and
  record why; the engine test is the required proof.

## 6. Acceptance (heap snapshot)

Copied from 628 Part B3 section 5, "Hot spot 7" (628 plan :1450-1459):

1. Open 3 canvas tiles with long transcripts, take snapshot 1, close one tile, force GC (trash icon),
   take snapshot 2.
2. In snapshot 2, filter "Detached": expect NO `Detached <gridstack-item>`, `Detached <ptah-canvas-tile>`
   or detached `chat-msg-slot` trees attributable to the closed tile. The 18,898-node tree must be gone.
3. If one remains, open its Retainers. Record the first non-DOM retainer:
   - `nodes` in `GridStackEngine`: the fix did not run (check the hook placement).
   - `DDElement`, `_dd` or `dd-manager`: `_removeDD` was skipped.
   - `_results` in `QueryList`, or an `LView` array: a wrapper or Angular retention, outside this fix.
     Escalate with the path.
4. Comparison view (snapshot 2 vs 1): `HTMLElement` delta about minus the closed tile's node count;
   `GridstackItemComponent` and `CanvasTileComponent` counts drop by 1.
5. Close all tiles and re-open one. The counts return to the single-tile baseline, with no growth
   across 5 open/close cycles.

Added for 629: 6. With a row break on the board (one compact tile next to a full tile, then a break),
close a tile in row 1. The tiles below the break do not move up. 7. Close a tile while the canvas is
locked: the node is released at unlock (heap step 2 holds after unlock + GC).

## Files to touch (part 4)

| Path | Create/modify | Notes |
| --- | --- | --- |
| `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-workspace-grid.component.ts` | modify | `applyAuthoritativeGeometry` (:717-826): grid lookup before the early return, pin/release/unpin, `try` moved up; new private `releaseStaleNodes`; `ngOnDestroy` (:883-886) adds `creationOptions.clear()`. No template, input or computed edits (B5 owns those). |
| `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-grid-release.ts` | create | Pure pin / unpin / stale-selection functions used by the component and the real-engine spec. |
| `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-grid-release.engine.spec.ts` | create | Real `GridStackEngine` test for row-break gaps, plus the no-pin control test. No `jest.mock('gridstack')`. |
| `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-workspace-grid.component.spec.ts` | modify | Mock `removeWidget`; tests 5.1 (1-8). |
| `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-render-metrics.service.ts` | modify | Verified typed counter shape (interface :7-8, defaults :21-22). Add `releasedNodes` and `geometryDrift` to both. |

Not touched: `canvas-layout-intent.ts`, `canvas-layout.service.ts`, `canvas-tile.component.ts`,
`canvas-gesture-observation.ts`, anything under `node_modules`, anything in `D:\projects\ptah-wt-628`.

## Risks

- Retainer is not the engine node (assumption 2.2). If heap step 3 shows a `QueryList` or `LView`
  retainer, this fix is incomplete. Escalate with the path; add no speculative cleanup.
- Node-level `locked` is already used somewhere (assumption 3.1). Mitigation: restore saved values,
  never hard-set `false`; test 5.1-6.
- `load()` moves a locked node on a collision. Mitigation: derived layout is collision-free and
  `load()` re-adds nodes one by one (`gridstack.js:677-703`); the real-engine test proves it.
- Pin left set after a throw would freeze drag pushing. Mitigation: unpin in the outermost `finally`
  (step 10); test 5.1-6.
- Behaviour change: gaps that today collapse at every `load()` close now stay (engine matches the
  derived layout). This is the intended contract, but a user may see a gap that was hidden before.
  The visual check (section 6, step 6) covers it.
- Merge conflict with B5 in the same file. Mitigation: B5a runs after B5 and edits only the regions
  listed above.
- A closed tile's node stays while the canvas is locked or hidden. Bounded; released at the next apply
  or on destroy (wrapper `grid.destroy()`).
- `releaseStaleNodes` on a node without `el` calls `engine.removeNode` directly; the `_dd` cleanup
  does not apply because no element exists.
