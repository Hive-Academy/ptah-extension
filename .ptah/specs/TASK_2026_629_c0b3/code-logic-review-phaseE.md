# Code Logic Review, Phase E (Batch BL) — TASK_2026_629_c0b3

Scope: `git show d7042e545` (canvas-grid-release.ts, canvas-grid-release.engine.spec.ts, canvas-workspace-grid.component.ts, canvas-render-metrics.service.ts, grid spec). Static review only; no tests, typecheck or lint were run. Gridstack facts were read from `node_modules/gridstack/dist/gridstack.js`, `gridstack-engine.js` and `dist/angular/src/*.ts`.

| Metric | Value |
| --- | --- |
| Score | 7/10 |
| Verdict | PASS (no Serious finding) |
| Serious | 0 |
| Moderate | 4 |
| Minor | 5 |

## What was traced and found sound

- **Live tile released by mistake:** the live set is `this.tiles()` (`canvas-workspace-grid.component.ts:737`). Node ids come from `creationOptions` (`canvas-grid-items.ts:30-37`, `id: tile.tabId`), and the `items()` list is built from the same `tiles()`, so a node always has a string id equal to a tile id. A tile that is being created has no engine node yet, so nothing is selected for release. The B6 detail slot is a separate `<div>` outside `<gridstack>` (template line 162 onwards), not an engine node. An inactive (hidden) grid returns at `:709` before any pin or release.
- **Gesture guard:** a non-force apply during a gesture returns at `:720`. A force apply from `reconcileGesture` happens after `onGridChange` has cleared `_gesture` (`:544`). The `_gesture === null` check at `:742` is therefore close to a dead guard, but it is harmless.
- **Re-entrancy:** `removeWidget(el, false, false)` fires no `removed` or `change` event (`gridstack.js:1226-1253`, `triggerEvent=false`). `engine.removeNode` calls `_notify`, which is the layout callback only. `_applyingLayout` is already `true` (`:738`) before the release, so `onGridChange` returns early anyway.
- **Does it free what Gridstack holds?** `removeWidget` runs `delete el.gridstackNode`, `_removeDD(el)` (destroys draggable and resizable, deletes `el.ddElement`) and drops the node from `engine.nodes` (`gridstack.js:1243-1247`, `gridstack-engine.js:797`). The Angular item wrapper's `ngOnDestroy` removes nothing from the grid (`gridstack-item.component.ts:118-124`), so the engine array was the retainer the batch targets. An element Angular has already detached still passes the `parentElement` check (null), so release works whichever of the effect or Angular's @for runs first.
- **`locked` restore:** `pinLiveNodes` cannot throw. The restore is the first statement in the outer `finally` (`:790`), which covers the early return (empty positioned), a throw in `load`, and `setStatic` throwing. The no-grid return happens before the pin. All paths are covered.
- **User-visible pin:** the pin is synchronous, with no `await` or microtask between pin and restore, so a user cannot drag a pinned tile. `load()` keeps node objects and re-pushes them (`gridstack.js:675-703`). Update keys do not include `locked`, and DD setup does not read `locked` (the only `locked` use in gridstack.js is `:1459`, keyed off update options). So the pin changes no DD state.
- **Collision with a locked node during load:** the nodes being updated are removed from `engine.nodes` first and re-pushed one by one. A node can therefore only collide with already-placed nodes, and the derived layout is collision-free. In `_fixCollisions`, `_loading` already forces the "move the mover down" branch (`gridstack-engine.js:98`), so the lock adds no new behaviour. Other tiles are not displaced.
- **Pin holds through the final pack:** the restore happens after `load` returns, so the end-of-load `_packNodes` runs with every live node locked (top-gravity skip at `gridstack-engine.js:451`). Only nodes unknown to the tile set (the ghost nodes) are left unpinned, and they are removed first.
- **Metrics:** `increment(..., 0)` returns early, so `geometryDrift` stays at zero when there is no drift. `releasedNodes` counts one per attempted removal (see Minor 2).

## Moderate

### M1. Release is skipped while the canvas is locked or the grid is inactive, so a tile closed in those states keeps its detached tree

- File: `canvas-workspace-grid.component.ts:706-709` (`!active()` and `!force && locked()` return) and the locked effect at `:397-410`.
- Scenario: the user locks the layout, then closes a tile (or closes tiles in a workspace whose grid is hidden). The apply path returns before `releaseStaleNodes`. The locked effect only forces an apply when `_geometryDeferred` is set or the view fingerprint changed (`:402-405`), and closing a tile changes neither. The engine node, the `gridstack-item` element and its transcript tree stay alive until the user unlocks or reactivates the grid. A long locked session can hold many closed tiles.
- The lane report lists "release should happen after unlock" (manual step 7), so this is a known choice, but it is not bounded. There is no cap and no trigger on tile-set change while locked.
- Fix: release is not a layout write. Run `releaseStaleNodes` (still pinned, with `setStatic` handling) from the locked and inactive paths when the tile set shrinks. Alternatively, record `_releaseDeferred` and drain it on unlock or activation. Add a test for "close a tile while locked".

### M2. The root cause of the leak is asserted but not shown against the Angular wrapper's own `updateAll`

- File: `node_modules/gridstack/dist/angular/src/gridstack.component.ts:279,299-306`; claim at `lane-BL-report.md` (check-first 3) and `canvas-workspace-grid.component.ts:786-790` comment.
- Scenario: `GridstackComponent` subscribes to `gridstackItems.changes` and calls `grid.load(layout)` with the default `addRemove` (`gridstack.js:621`, `GridStack.addRemoveCB || true`). That call already runs the removal branch for engine nodes missing from the layout, including `removeWidget(n.el, true, false)` (`gridstack.js:662-670`). If that path runs for a closed tile, the engine node is already dropped by the wrapper, and the retainer behind the 18,898-node detached tree is somewhere else (DD handles, `QueryList`, an `LView`). In that case this batch would be a harmless no-op and the leak would remain. The two paths also interleave without ordering: `updateAll`'s unpinned load packs every live node to gravity first (this is why the apply effect must re-run), and the release then removes nothing.
- No test proves a stale node survives `updateAll` today. The unit evidence only shows that `load(items, false)` does not remove (which is true). The acceptance criterion (no detached tree) rests entirely on the manual heap check, and the lane report leaves that open.
- Fix: before accepting the leak as fixed, run the heap steps in lane-BL-report.md. If `Detached` trees remain, use the retainer guidance in step 3. Optionally add a jsdom test that mounts `GridstackComponent` with a `@for`, removes an item, and asserts `grid.engine.nodes` before the effect runs.

### M3. The real-engine spec does not prove the case the fix exists for, nodes whose target differs from their current position

- File: `canvas-grid-release.engine.spec.ts:62-80,89-115`.
- Scenario: the grid is built by `addWidget` at the exact derived coordinates, so every `load()` item hits the `Utils.samePos(item, w)` branch (`gridstack.js:690-693`, `moveNode(..., forceCollide)`), not the `update()`-moves-a-pinned-node branch. The real situation is: close a middle tile, so neighbours sit at their old positions and `load` must move several pinned nodes to new derived positions. Assertion 2 of the batch ("every live node equals the derived layout") passes trivially here because nothing needed to move. The release-and-pin helpers are called, but the component's order of operations, `grid.cellHeight`, `compactResizeBounds` items, `setStatic` toggling, and `float: false` options from `gsOptions` (`:214-227`) are not reproduced.
- It does go through the real `GridStack.load(items, false)`, not a direct engine call, and the unpinned control (D moves up) is a good negative control, so the gap-survives claim is genuinely demonstrated for the no-move case.
- Fix: add a case where the target layout differs (for example, after removing A, B and the row-break tile C get new derived y), asserting that pinned nodes land on the derived values and not on the gravity position. Add one case with a tile whose target moves into the old cell of another tile.

### M4. Stale comment now contradicts the behaviour the batch introduces

- File: `canvas-workspace-grid.component.ts:216-219` (and the `:773-777` comment about "documented all-node path").
- Scenario: the comment states that gravity "compacts up-and-left, which is also what the derived layout produces". Row-break gaps in the derived layout are exactly where it does not, and the batch now preserves them for programmatic applies. The next maintainer will either believe gaps are collapsed or "fix" the pin. Behavioural consequence: during a user drag, gravity still compacts, so the live gesture and the derived projection disagree about row-break gaps until the post-gesture apply re-pins. That reconcile is the only thing that restores the gap, and it is not asserted anywhere (the pin test covers only release+load).
- Fix: correct the comment, and add a test (mock or engine) showing a gesture followed by reconcile restores the row-break gap.

## Minor

1. `canvas-workspace-grid.component.ts:709-710`: `if (!grid) return` now sits before the empty-layout bookkeeping. A zero-tile apply with no grid instance yet no longer resets `_geometryDeferred` and the applied fingerprint (previously it did). Only matters before `GridStack` init, and a later effect resolves it.
2. `canvas-workspace-grid.component.ts:803-810`: `releasedNodes` is incremented even when `removeWidget` silently skips the node (`parentElement !== this.el`, `gridstack.js:1231-1232`) or `engine.removeNode` finds nothing. The metric can overstate frees. Compare `engine.nodes.length` before and after.
3. `canvas-grid-release.ts:73`: `restorePinnedNodes` writes `node.locked = undefined`, which leaves an own property with value `undefined`, not the original absence. Harmless to Gridstack (reads are truthy) but it changes `Object.keys`/`toEqual` results on nodes. Use `delete` when the saved value was `undefined`.
4. `gridstack-engine.js:680`: `_hasLocked` is cached in `saveInitial()` (called by `batchUpdate`). If `saveInitial` runs inside the pinned `load`, `_hasLocked` stays `true` until the next `saveInitial`, which changes the `_canMoveUp`-style predicate at `:68` for any engine move before then. User drags call `saveInitial` at drag start, so this is likely masked, but the spec does not check it.
5. `canvas-workspace-grid.component.ts:873-876`: `ngOnDestroy` clears `creationOptions` but not `previousAutoCards`. Small, bounded by tile count.

## Five logic questions (brief)

1. Silent failure: a skipped `removeWidget` still counts as released (Minor 2). A tile closed under a lock or hidden grid is silently not released (M1).
2. Unexpected user action: close while locked (M1). Drag then reconcile relies on the post-gesture re-pin (M4).
3. Wrong answer from input: a derived layout with unintended vertical gaps is now preserved verbatim, where gravity used to hide it. The authoritative layout owns all gaps from this change on. Nothing in the batch validates `projectTileGeometry` output for dead rows.
4. Dependency shape: the wrapper's own `updateAll` removal path interacts with this fix (M2).
5. Missing: a bounded release trigger when locked or hidden, and a gesture-then-reconcile test.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Pin, release stale nodes from `tiles()`, compute `changed` after release, `load(...,false)`, restore in outer `finally` | COMPLETE | None |
| Grid lookup above empty return, release-all only for empty tile set, zero-size releases stale only | COMPLETE | Minor 1 |
| Skip release during a gesture | COMPLETE | Guard is mostly redundant |
| Real-engine gap test through real `GridStack.load` plus unpinned control | PARTIAL | M3 (no moving-target case) |
| Mock tests: order, ghost, gesture, zero width/height, empty set, locked restore on throw, destroy | COMPLETE | Seven new cases found in the diff |
| `creationOptions.clear()` on destroy; metrics counters | COMPLETE | Minor 2 |
| No detached tile tree after close (acceptance) | PARTIAL | Manual heap check pending; M1, M2 |

## Verdict

PASS with moderate follow-ups. Confidence MEDIUM: the lock, pin and re-entrancy logic is correct against the Gridstack source, but the leak fix itself is unproven until the heap check, and the wrapper's `updateAll` may already do the removal this batch adds.

Top risk: M2 (the release may be redundant and the real retainer still alive).
