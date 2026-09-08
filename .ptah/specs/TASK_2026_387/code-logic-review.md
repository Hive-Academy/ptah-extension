# Code Logic Review — `TASK_2026_387`

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 2        |
| Failure modes found | 3        |

Scope examined: `canvas-layout.service.ts` (+spec), `canvas.store.ts` (+spec),
`canvas-workspace-grid.component.ts` (+spec), `orchestra-canvas.component.ts`
(+spec), `CLAUDE.md`, cross-checked line-by-line against
`node_modules/gridstack/dist/gridstack.js` and
`node_modules/gridstack/dist/gridstack-engine.js` (installed 12.6.0). Full
files read, not diff hunks. `npx nx run-many -t test -p @ptah-extension/canvas
@ptah-extension/tribunal-panel` run directly: 85/85 canvas tests and 333/333
tribunal-panel tests pass. `ptah_get_diagnostics` on the four changed sources
returns zero errors (the only workspace errors are pre-existing, in
`libs/frontend/{editor,git-ui}/.../monaco-loader.service.ts`, unrelated to this
lib).

## Five logic questions

### 1. How does this fail silently?

- `apportionRow`'s `total > 0` guard (`canvas-layout.service.ts:188-191`) has an
  unreachable else-branch. `computeLayout` always calls it with
  `rowTiles.map((t) => normalizeWeight(t.weight))`
  (`canvas-layout.service.ts:122-124`), and `normalizeWeight` coerces every
  non-finite or `<= 0` weight to `DEFAULT_TILE_WEIGHT = 1`
  (`canvas-layout.service.ts:173-175`), so `total` is always the sum of `n`
  positive numbers and can never be `<= 0` through this call path. The spec
  titled "splits equally when every weight is zero"
  (`canvas-layout.service.spec.ts:277-286`) asserts `[4,4,4]` for three
  zero-weight tiles, but that result comes from the `total > 0` branch acting
  on normalized weights `[1,1,1]`, not from the `else` branch the test's name
  claims to exercise. This is not a runtime bug (the numeric result is
  correct either way) but it is a silent gap: a genuine `total <= 0` defect
  introduced later in `apportionRow` would not be caught by this suite.
- A `changeCB` that fires with no dirty nodes is not really possible to
  observe from outside — Gridstack's own `_triggerChangeEvent`
  (`gridstack.js:1683-1695`) only dispatches when `getDirtyNodes(true)` is
  non-empty, so a `dragStopCB`/`resizeStopCB` that ends with zero net movement
  leaves `_gesture` latched with no consuming `changeCB` ever arriving
  (`canvas-workspace-grid.component.ts:225-232` vs `:242-274`). Traced in
  detail under Failure modes below: harmless today, but silent by
  construction — nothing observes or logs the stuck latch, and it is only
  provably safe because of an implicit ordering guarantee in a third-party
  library, not because of a check the guard was designed to assert.

### 2. What user action produces unexpected behaviour?

- Resizing a tile with the `e`/`w` handles when Gridstack's `float: false`
  push logic reflows a differently-sized neighbour (e.g. pushing it to the row
  below because the widened tile no longer fits) is read back purely as a
  weight change (`canvas-workspace-grid.component.ts:264-273`); any positional
  reflow the resize caused is discarded, not translated into a reorder. This
  is a deliberate design choice (goal 4: "resize carries dimensional
  information, drag carries positional") and self-heals on the very next
  apply pass, since the effect re-derives from `order`/`weight` and overwrites
  whatever transient geometry Gridstack produced — but the plan's own
  assumption #2 (`implementation-plan.md:197-203`) that `grid.engine.nodes` is
  settled and semantically clean by `changeCB` time is unproven for a mixed
  cross-row push, and no unit test exercises the real `gridstack-engine.js`
  collision/swap path (the spec stub sets final node coordinates directly,
  bypassing `_fixCollisions`/`swap`, `gridstack-engine.js:72-125`). A real drag
  between two differently-sized tiles is exactly the case the plan itself
  flags for the visual reviewer, not for unit coverage.
- Dragging a tile onto an occupied slot of a **different width** does not
  trigger Gridstack's same-size `swap()` (`gridstack-engine.js:78-81` gates
  swap on `node._moving && !opt.nested && !this.float`, and `swap` itself
  requires matching dimensions per its own guard, not shown here but implied
  by the "check if we collide with an object the same size" comment at
  `:77`); it falls through to the push-down branch instead
  (`gridstack-engine.js:96-119`), which can shove the collided tile into a new
  row rather than swapping places. The resulting `(y,x)` read-back
  (`canvas-workspace-grid.component.ts:257-261`) is still well-defined and
  total, but it will not always match a user's intuitive "swap these two"
  expectation for unequal-width tiles — a real but disclosed limitation.

### 3. What input data produces a wrong answer?

- None found for `computeLayout`/`apportionRow`: the round-trip property
  (`raw_i = 12 * u_i / 12 = u_i` for integer `u_i` summing to 12) makes a
  second apportionment of already-derived widths a no-op deterministically,
  not just for the two example vectors the spec checks — this was verified
  arithmetically, not just by the passing tests, and holds for every weight
  vector including ones that trigger the take-back loop
  (`canvas-layout.service.ts:206-218`, e.g. `[10,1,1] -> [8,2,2]`, and
  `[8,2,2]` re-apportions to `[8,2,2]` exactly).
- `columnsFor` and `apportionRow` are total and bounded as claimed; the
  `it.each` property test (`canvas-layout.service.spec.ts:151-174`) covers 1–9
  tiles at columns 1/2/3 with 8 weight vectors including the two
  take-back-triggering ones (`[10,1,1]`, `[1,1,10]`), which is the strongest
  evidence in the whole change.

### 4. What happens when a dependency fails?

- Gridstack (`GridstackComponent.grid`) not yet initialized: the apply effect
  bails via `if (!gridComp?.grid || positioned.length === 0) return;`
  (`canvas-workspace-grid.component.ts:170`) — no throw, no partial write.
- `grid.update` throwing mid-loop: `_applyingLayout` is set before the
  `batchUpdate`/`update` block and cleared in a `finally`
  (`canvas-workspace-grid.component.ts:176-196`) — confirmed this is not
  cosmetic: a stuck `true` would permanently drop every future `onGridChange`
  (`:243`), so the `finally` is load-bearing exactly as the plan states.
- A `node.id` of the wrong type is filtered defensively at both the apply
  loop (`typeof node.id !== 'string'`, `:182`) and the gesture read-back
  (`:251-254`) — no crash on a malformed Gridstack node.

### 5. What is missing that the requirements never mentioned?

- No regression test for a `dragStopCB`/`resizeStopCB` that ends with **no
  net movement** (Gridstack fires the stop event unconditionally but the
  `change` only if `getDirtyNodes` is non-empty, `gridstack.js:1683-1692`,
  `:2635`/`:2640`). Traced by hand under Failure modes: the stale latch is
  always overwritten by the next real gesture's stop handler before that
  gesture's own `change` is read, so no misattribution is possible given
  Gridstack's synchronous same-call-stack ordering — but this safety property
  rests on an implicit invariant of the third-party library that is not
  pinned by a test in this repo, unlike the ordering assumption the plan did
  choose to document and test (`implementation-plan.md:197-203`).
- The implementation-plan's stated early-return order for the apply effect —
  "not visible, if locked, if the grid is not yet built, or if there are no
  tiles" (`implementation-plan.md:427-428`) — is not what's implemented.
  `canvas-workspace-grid.component.ts:166-171` checks `visible()`, then
  `layout()`/`gridComp()?.grid`/`positioned.length`, and only _then_
  `locked()`. Functionally harmless (the mutation block is still gated),
  documented here because it means `locked()` is not always a tracked signal
  dependency of this effect — see Moderate issues.
- No test exercises a real `CanvasWorkspaceGridComponent` remount after LRU
  eviction (only `canvas.store.spec.ts:327-356` proves intent survives at the
  store level). Traced by hand: since eviction removes the path from
  `workspacePaths()` and the `@for` track-by unmounts the component
  (`orchestra-canvas.component.ts:72-77`), a return creates a **fresh**
  component and a fresh Gridstack instance driven by the same
  derive-then-apply path as first mount, so there is no realistic
  stale-geometry risk — but this is architectural reasoning, not test
  evidence, for a task whose acceptance criteria explicitly name "no snap-back
  ... survives opening/closing the editor panel."

## Failure modes

### Stuck gesture latch on a no-op drag/resize

- Trigger: user starts and ends a drag/resize (`dragStopCB`/`resizeStopCB`
  fires) without net position/size change, so Gridstack's own `change` never
  dispatches (`getDirtyNodes` empty, `gridstack.js:1686-1692`).
- Symptom: none visible — `_gesture` stays latched at `'drag'` or `'resize'`
  until overwritten by the next real gesture's stop handler
  (`canvas-workspace-grid.component.ts:225-232`).
- Evidence: `canvas-workspace-grid.component.ts:246-247` clears `_gesture`
  only inside `onGridChange`, which is bound to `(changeCB)` and therefore
  never runs for a no-op gesture.
- Current handling: none; relies on Gridstack firing `dragstop`/`resizestop`
  synchronously immediately before its own `change` on every _real_ gesture
  (`gridstack.js:2635` then `:2640`), which always overwrites the stale value
  before it could be misread.
- Recommendation: acceptable as-is given the traced invariant, but add a
  regression test that fires `dragStopCB` with `grid.engine.nodes` unchanged
  and asserts no store write and no wedge on the following real gesture, so
  the safety property is pinned rather than only reasoned about.

### Mixed-width drag/resize not exercised against real Gridstack collision logic

- Trigger: dragging or resizing a tile in a row whose tiles have unequal
  weights, where Gridstack's `float: false` push (not swap) logic reflows a
  neighbour into a different row (`gridstack-engine.js:72-125`).
- Symptom: potential mismatch between what the user visually did mid-gesture
  and the `order`/`weight` the component derives from `grid.engine.nodes` at
  gesture end — self-corrects on the next apply pass since intent, not raw
  geometry, is the stored truth, but the _arrangement itself_ could differ
  from a naive "swap these two" expectation.
- Evidence: `canvas-workspace-grid.component.ts:257-261` (order-from-`y,x`
  sort), `implementation-plan.md:197-203` (assumption flagged as unproven).
- Current handling: none beyond the architectural self-healing described
  above; every unit test manipulates final node coordinates by hand rather
  than driving the real engine (`canvas-workspace-grid.component.spec.ts:351-378`).
- Recommendation: acceptable to ship — this is exactly the case the plan
  routes to `visual-reviewer` rather than unit tests — but confirm the visual
  review actually drags between two differently-weighted tiles, not just
  same-weight ones, before calling goal 4 fully verified.

### Dead `total <= 0` branch in `apportionRow`

- Trigger: none reachable from the shipped call path.
- Symptom: none — the branch is defensive dead code.
- Evidence: `canvas-layout.service.ts:188-191` (the branch) vs
  `canvas-layout.service.ts:173-175` (`normalizeWeight` guarantees the
  precondition is never met) vs `canvas-layout.service.spec.ts:277-286` (a
  test named for this branch that does not actually exercise it).
- Current handling: harmless, but the test's name overstates its own
  coverage.
- Recommendation: either drive the test through a path that truly bypasses
  `normalizeWeight` (call `apportionRow`-equivalent behaviour some other way)
  or rename the test/remove the dead branch so coverage claims match reality.
  Not a correctness defect; recorded as a minor precision issue.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- Moderate — `canvas-workspace-grid.component.ts:166-171`: the apply effect's
  documented early-return order (per `implementation-plan.md:427-428`) is
  "not visible → locked → grid not built → no tiles"; the code is "not
  visible → grid/tiles not ready → locked". Functionally safe (the mutation
  block is still gated by `locked()` before any write), but it means
  `locked()` is only a tracked signal dependency in the branch that reaches
  it, which is a subtler contract than the plan describes and worth a
  one-line comment explaining why the order is safe.
- Moderate — no unit test pins the "stale gesture latch from a no-op
  drag/resize" safety property (see Failure modes); it is currently correct
  only by hand-traced reasoning about Gridstack's internal event ordering.
- Minor — `canvas-layout.service.ts:188-191` dead branch / misleading test
  name (see Failure modes).
- Minor — `implementation-plan.md:293-296`'s claim that `computeLayout`'s
  `width === 0 || height === 0` early return is what makes "a hidden
  `display:none` grid still short-circuit" is not quite accurate:
  `CanvasLayoutService` is provided once per `OrchestraCanvasComponent` and
  observes the always-visible `#canvasContainer`
  (`orchestra-canvas.component.ts:262-267`), so `containerWidth`/`Height`
  never actually go to zero for a hidden workspace grid — the real guard
  against writing to a hidden grid is the `visible()` check in the apply
  effect (`canvas-workspace-grid.component.ts:167`), not this zero-size
  branch. No functional impact; a documentation precision gap only.

## Data flow

1. `ResizeObserver` on the shared `#canvasContainer` → RAF → `_containerWidth`
   / `_containerHeight` signals (`canvas-layout.service.ts:72-86`). OK —
   single measurement point shared by every workspace grid under one panel,
   confirmed by DI (child injects `CanvasLayoutService` without its own
   provider, resolving to the ancestor's instance).
2. `CanvasStore.tilesFor(path)` → `CanvasWorkspaceGridComponent.tiles`
   computed (`canvas-workspace-grid.component.ts:119-121`). OK — memoized per
   path (`canvas.store.ts:116-123`), stable signal identity.
3. `layout` computed derives `(tiles, width, height) → CanvasLayout` via
   `computeLayout` (`canvas-workspace-grid.component.ts:123-127`). OK — pure,
   total, verified against every degenerate input the plan lists.
4. Apply effect, guarded by `visible()` → `layout()`/`gridComp` readiness →
   `locked()` → `_applyingLayout` wraps `batchUpdate(true)` / `cellHeight` /
   per-node `grid.update` / `batchUpdate(false)`
   (`canvas-workspace-grid.component.ts:166-197`). OK for the write itself;
   see Moderate note on the guard-order deviation from the plan's stated
   contract.
5. User gesture ends → `dragStopCB`/`resizeStopCB` latches `_gesture`
   (`:225-232`), Gridstack's own `change` follows synchronously in the same
   call (`gridstack.js:2635` then `:2640`) → `onGridChange` reads
   `grid.engine.nodes`, dispatches `reorderTiles`/`setTileWeights`
   (`:242-274`). OK for the documented ordering guarantee; gap noted above
   for the no-op-gesture case (harmless but untested).
6. Store writers return the same array reference on a no-op
   (`canvas.store.ts:212-262`), so the derived-layout signal chain does not
   re-notify and effect 4 does not re-run — confirmed this is what breaks the
   loop, not merely `_applyingLayout` alone (the plan calls this out
   explicitly and correctly as "second line of defence").
7. Step 4's own `batchUpdate(false)` provokes a `change`; `onGridChange`'s
   first line (`if (this._applyingLayout) return;`) drops it before it can be
   misread as a gesture — confirmed against `gridstack.js:730-739`
   (`_triggerChangeEvent` on batch close) and the `engine.batchMode` early
   return inside `_triggerChangeEvent` (`gridstack.js:1683-1685`) which also
   makes every per-node `moveNode` call inside the batch a synchronous no-op
   for event purposes.

## Requirements fulfilment

| Requirement                                                                 | Status   | Gap                                                                                                                                                               |
| --------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Goal 1 — columns from `MIN_TILE_WIDTH`, clamp 1..3, 1180px → 2              | COMPLETE | Verified by direct test and by hand (`floor(1188/488)=2`).                                                                                                        |
| Goal 2 — short row fills full width (fill-remainder)                        | COMPLETE | Property test covers 1–9 tiles × 8 weight vectors, sum-to-12 proven algebraically idempotent.                                                                     |
| Goal 3 — compact after drag/close/add, one authority                        | COMPLETE | `float:false` + derive-apply-suppress verified against `gridstack-engine.js`; mixed-width drag left to visual review (disclosed).                                 |
| Goal 4 — intent-only state, drag=order/resize=weight, survives resize       | COMPLETE | No-snap-back test proves byte-identical intent across a column change; stale-latch and mixed-width-drag paths are untested but reasoned safe (see Failure modes). |
| Goal 5 — lock semantics preserved, no writes while locked/hidden            | COMPLETE | Lock and hidden-grid specs both pass; guard-order deviation from the plan is cosmetic.                                                                            |
| `TileLayout` shape frozen for `tribunal-panel`                              | COMPLETE | Unchanged `{x,y,w,h}`; tribunal-panel's 333 tests pass unmodified.                                                                                                |
| `src/index.ts` public names unchanged                                       | COMPLETE | Verified by direct read.                                                                                                                                          |
| `canvas/CLAUDE.md` corrected (breakpoints, gridstack version, changeCB doc) | COMPLETE | Verified against the file.                                                                                                                                        |

Implicit requirements not addressed: a regression test for the no-op
gesture/stale-latch case; a component-level (not just store-level) remount
test after LRU eviction.

## Edge cases

| Case                                                 | Handled            | How                                                               | Concern                                                                              |
| ---------------------------------------------------- | ------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Zero tiles / zero width / zero height                | YES                | `computeLayout` early return (`canvas-layout.service.ts:109-111`) | None                                                                                 |
| NaN / negative / zero weight                         | YES                | `normalizeWeight` coerces to default                              | Makes one `apportionRow` branch unreachable (minor)                                  |
| Lopsided weights needing take-back (e.g. 10/1/1)     | YES                | Take-back loop + property test                                    | None — proven idempotent by hand                                                     |
| Locked grid: resize/gesture attempted                | YES                | `setStatic` + early return in both effect and `onGridChange`      | None                                                                                 |
| Hidden (`display:none`) grid: layout write attempted | YES                | `visible()` guard on apply effect                                 | Doc (plan) misattributes the mechanism to `computeLayout`'s zero-size branch (minor) |
| Workspace switch / LRU remount                       | YES                | Store-level round-trip test; component remount reasoned safe      | No component-level remount test (moderate)                                           |
| No-op drag/resize (stop fires, no dirty nodes)       | YES (by reasoning) | Latch overwritten by next real gesture before misuse              | Not pinned by a test (moderate)                                                      |
| Non-string node id from Gridstack                    | YES                | Filtered in both apply and read-back paths                        | None                                                                                 |
| Own `batchUpdate(false)` / `onResize()` change       | YES                | `_applyingLayout` flag, `finally`-cleared                         | None                                                                                 |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: a real drag or resize between two differently-weighted tiles,
  where Gridstack's push (not swap) logic reflows a neighbour into another
  row, is untested by anything that exercises the real
  `gridstack-engine.js` collision path — every unit test manipulates final
  node coordinates directly. The design self-heals through the next apply
  pass regardless of what raw geometry Gridstack produces mid-gesture, so
  this is a coverage gap rather than a known defect, but it is the one path
  that has not been proven, only argued.
- What a robust implementation would add: (1) a regression test for a
  no-op drag/resize that pins the "stale latch is always overwritten before
  it can be misused" property instead of leaving it to be re-derived by a
  future reviewer; (2) a component-level test that actually recreates a
  `CanvasWorkspaceGridComponent` (simulating LRU eviction + return) rather
  than relying on store-level and architectural reasoning; (3) either
  exercise or remove the unreachable `total <= 0` branch in `apportionRow`
  so the "zero weight" test's name matches what it verifies.
