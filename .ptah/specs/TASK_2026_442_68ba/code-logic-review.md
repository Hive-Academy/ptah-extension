# Code Logic Review — `TASK_2026_442_68ba`

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 7/10                                 |
| Assessment          | APPROVED                             |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 1                                    |
| Failure modes found | 3                                    |

Scope: all eight production files under `libs/frontend/canvas/src/lib/` changed by this task (read in full), all eight spec files (read in full), `implementation-plan.md`, `context.md`, `implementation-notes.md`, and the TabManager bootstrap path in `libs/frontend/chat-state` that the hydration timing depends on. The review is read-only. No test run was executed by this reviewer; the notes' `run-many` claim (16 + 9 suites, 333 + 107 tests, two projects named) was checked for shape, not re-run.

## Five logic questions

### 1. How does this fail silently?

Three paths produce a success-looking result while something was lost:

- A drag below an auto row commits a durable row break. The user sees their drag honored, and the break re-renders the observed structure. But the break is now durable intent. It survives later re-flows that could have re-composed the row, and it persists to storage. See Failure mode 1.
- A stored layout record that fails both Zod schemas is silently replaced. `load` returns `writable: true` with `tiles: null` (`canvas-layout-persistence.service.ts:208-209`). The next debounced write overwrites the record. One `console.warn` is the only trace. This is the plan's contract for corrupt records (`implementation-plan.md:200`), but a record written by any non-conforming client vanishes without a user-visible signal.
- A storage write failure warns once per kind and returns success to the caller (`canvas-layout-persistence.service.ts:284-287`, `:290-295`). In-memory state stays authoritative. This is the plan's specified behavior (`implementation-plan.md:202`), so it is conformance, not a defect.

### 2. What user action produces unexpected behaviour?

Dragging a tile below a row that auto apportionment filled. Example: two default tiles at three-column capacity render as `[6, 6]` (a full row, `canvas-layout-intent.ts:235-247`). The user drags tile A below tile B. The projection counts the preceding row at minimum units (`4`), so the next tile "fits" (`canvas-layout-intent.ts:420-421`), and a durable `rowBreakBefore` is committed. The drag sticks, which is the intent of the rule. But the break then narrows every later layout: after the user adds a third tile, the packer renders `[B]` alone at 12 units and `[A, C]` below, instead of one row of three. The user never chose that boundary through the menu.

### 3. What input data produces a wrong answer?

A localStorage record with a non-integer future `version` (for example `2.5` or the string `"3"`). The future-version guard requires `Number.isInteger(version) && version > 2` (`canvas-layout-persistence.service.ts:182-189`). A non-integer value falls through to schema failure and returns `writable: true` (`:208-209`), so the bytes are overwritten on the next write instead of preserved. This code only writes integer versions, so the exposure is a hypothetical other client. See Failure mode 3.

### 4. What happens when a dependency fails?

- localStorage throws on read or write: caught, warned once, in-memory state continues (`canvas-layout-persistence.service.ts:161-167`, `:281-287`). No throw reaches a user action. Verified.
- Gridstack reports an incomplete or ghost node set: the complete-observation validation rejects the gesture and reconciles existing nodes from current intent (`canvas-workspace-grid.component.ts` `readCompleteNodes` / `reconcileGesture`; exercised at `canvas-workspace-grid.component.spec.ts:420-445`, `:673-695`). Verified.
- The workspace path arrives before tabs restore: this race cannot occur. `TabManagerService` restores tabs and the workspace partition synchronously from localStorage in its constructor (`tab-manager.service.ts:536-538`), before any Angular component constructs. So `hydrateWorkspace` always sees the restored tab set (`orchestra-canvas.component.ts:296-300`). Residual uncertainty: the pop-out flow (`initialSessionId`, `tab-manager.service.ts:541-553`) starts with an empty tab list, but it targets a fresh panel whose path is null, so hydration lands on the implicit partition, which never persists.

### 5. What is missing that the requirements never mentioned?

- The plan's drag rule counts units with `effectiveUnits` (`implementation-plan.md:186-188`). For auto tiles this is the minimum width, not the rendered apportioned width. The plan's rationale sentence ("store no break because span overflow caused the render-only wrap") assumes the row was full. An apportionment-filled auto row is full at rendered width but not at minimum width. The plan does not state which behavior wins for that case. The implementation follows the rule's letter. See Failure mode 1.
- The plan says the first real-path hydration "merges valid implicit ids" (`implementation-plan.md:204`). Ids are merged. But when a stored record exists for that path, the carried implicit tiles lose their width and order intent. The plan does not say whether implicit intent must survive. See Failure mode 2.
- No specification states whether a mid-gesture lock or focus change should cancel or queue. The implementation cancels and settles from current intent, which is the safe choice. Verified at `canvas-workspace-grid.component.spec.ts:499-517`, `:749-773`.

## Failure modes

### 1. Auto-row drag mints a durable break from a render-only full row

- Trigger: The user drags a tile below an observed row whose auto tiles apportionment rendered full. The preceding group holds one or two auto tiles (rendered 12 or 6+6), so the minimum-unit sum (`4` per auto tile) understates the rendered width.
- Symptom: The committed intent carries a durable `rowBreakBefore` the user never set through the menu. The drag itself re-renders correctly. Later re-flows (adding a tile, deleting a tile, later drags) keep the boundary and pack rows narrower than the intent alone requires. The break persists to localStorage.
- Evidence: `unitsOf` counts auto tiles through `effectiveUnits`, which returns the responsive minimum (`canvas-layout-intent.ts:413-414`; `effectiveUnits` auto branch at `:158-159`; `minimumUnitsFor` at `:145-147`). The fits branch mints a break when `used + unitsOf(next) <= 12` (`canvas-layout-intent.ts:420-421`). But `finishRow` apportions auto tiles to fill the row's remaining units (`canvas-layout-intent.ts:235-247`), so a rendered row of two autos at capacity 3 uses 12 units while `unitsOf` counts 8. The plan's rationale sentence (`implementation-plan.md:188`) only holds when `used` mirrors rendered width.
- Current handling: The implementation follows the plan's pseudocode exactly (`implementation-plan.md:187`, "used + nextEffectiveUnits <= 12"). The minted break also preserves the observed structure, which is the design goal inherited from TASK_2026_404. In the two-tile case the break is what makes the drag stick at all. So this is a gap between the plan's rule and its rationale, not an implementation deviation.
- Recommendation: Make a deliberate choice and pin it with a test. Either (a) compute the fits test against rendered units by apportioning the preceding observed group as `finishRow` does, so a full row is never treated as having room; or (b) keep the current rule and amend the plan's rationale to state that an apportionment-filled auto row counts at minimum units and may mint a durable break. Then add the missing spec: every existing drag test uses named spans only (`canvas-layout-intent.spec.ts:79-91`), so the default tile width has zero direct coverage of this branch.

### 2. Implicit tile intent is discarded when a stored record exists

- Trigger: Tiles are created while the workspace path is null, then the first real path arrives and `persistence.load(path)` finds a stored record from a previous session.
- Symptom: The carried tiles keep their ids and become tiles again, but their width and order intent is dropped. The same tab ids re-enter as default auto tiles at the end of the order.
- Evidence: `hydrateWorkspace` moves the implicit partition into the new path (`canvas.store.ts:396-399`), then prefers `loaded.tiles` over the moved `existing` when a record exists (`canvas.store.ts:417-421`). `reconcileIntent` appends ids absent from the stored record as default tiles (`canvas-layout-intent.ts:124-134`).
- Current handling: The ids survive, so no tile is lost. When no stored record exists, `loaded.tiles` is null and the moved implicit intent survives intact (`canvas.store.ts:418`). The window requires a persisted record for the exact path plus layout edits made while pathless, which is narrow.
- Recommendation: Acceptable to keep. If the pathless layout matters, merge per-tile intent for ids present in both, preferring the implicit intent for live tiles.

### 3. Non-integer future version is treated as corrupt and overwritten

- Trigger: A localStorage record carries `version: 2.5` (or a non-number version) written by a hypothetical non-conforming client.
- Symptom: The future-version guard does not fire (`canvas-layout-persistence.service.ts:182-189`). Both schemas fail. `load` returns `writable: true` (`:208-209`). The next scheduled write replaces the record.
- Evidence: `canvas-layout-persistence.service.ts:178-189` (integer check), `:200-209` (v1/v2 fallback, corrupt path).
- Current handling: Defensible. This code writes only integer version 2, and the schema contract defines integer versions, so a non-integer record is corrupt by definition. The plan only requires byte preservation for "unknown future version" (`implementation-plan.md:203`), which the integer guard covers and the spec pins (`canvas-layout-persistence.service.spec.ts:75-88`).
- Recommendation: None required. If defense in depth is wanted, treat any `version > LATEST_VERSION` (integer or not) as future and read-only.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

1. MODERATE — Failure mode 1: auto-row drag break accounting, plus the missing spec for the default-width drag path (`canvas-layout-intent.ts:413-421`; `canvas-layout-intent.spec.ts:79-91`).
2. MINOR — Failure mode 2: implicit intent discarded when a stored record exists (`canvas.store.ts:417-421`).
3. MINOR — Test gap: the `visibilitychange`-hidden and `beforeunload` flush paths have no direct test. The persistence spec covers `pagehide` and destroy only (`canvas-layout-persistence.service.spec.ts:104-114`). The production wiring exists (`canvas-layout-persistence.service.ts:133-147`).
4. MINOR — Test gap: the `focus-plus-stack` preset assertion checks order only, not widths or breaks (`canvas-layout-intent.spec.ts:69`), while its two siblings assert full width and break intent (`:63-68`).
5. MINOR — Failure mode 3: non-integer future version overwritten (`canvas-layout-persistence.service.ts:182-189`, `:208-209`).

## Data flow

Geometry is a one-way flow, verified end to end:

1. Store intent `{tabId, order, width, rowBreakBefore}` per workspace partition. OK.
2. `computeLayout(tiles, layoutFocusTabId)` packs rows (`canvas-layout.service.ts`; `packRows` at `canvas-layout-intent.ts:185-219`). OK — total, pure, empty-measurement safe (pinned at `canvas-layout.service.spec.ts:94-100`).
3. `CanvasWorkspaceGridComponent` is the sole Gridstack writer, guarded by `_applyingLayout` in try/finally. The feedback loop is proven closed: identical geometry issues zero updates (`canvas-workspace-grid.component.spec.ts:797-806`), and one gesture settles in one apply pass (`:822-838`). OK.
4. Gestures read the engine, validate complete membership, and commit through workspace-plus-revision guards (`canvas.store.ts:273-305`). Stale revisions are rejected (`:279`, `:303`; pinned at `canvas.store.spec.ts` and `canvas-workspace-grid.component.spec.ts:420-445`). OK.
5. Mutation commits call `setWorkspaceTiles`, which clears stale layout focus, bumps the revision, and schedules persistence (`canvas.store.ts:529-543`). OK.
6. `schedulePersist` passes a closure that reads the live partition at flush time (`canvas.store.ts:545-550`), and the persistence service keeps one pending snapshot per path (`canvas-layout-persistence.service.ts:128-137`, `:240-250`). A workspace switch between schedule and flush cannot write a stale snapshot. OK.
7. Hydration order is correct: load, reconcile, publish, `markHydrated`, then `schedulePersist` (`canvas.store.ts:415-438`). `schedule` refuses paths not in the writable set (`canvas-layout-persistence.service.ts:233`), so no write can precede hydration (pinned at `canvas-layout-persistence.service.spec.ts:90-102`). OK.
8. Teardown: `ngOnDestroy` flushes and closes nothing (`orchestra-canvas.component.ts:423-425`); the persistence service flushes on `pagehide`, `beforeunload`, `visibilitychange`-hidden, and destroy, and removes its listeners (`canvas-layout-persistence.service.ts:133-147`). OK.

The one gap in the chain is step 4 for auto tiles: the drag projection's unit accounting diverges from the renderer's unit accounting (Failure mode 1). Nothing is lost or corrupted; a boundary is minted.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------------------------ | --------------- |
| Packer: spans 4/6/8/12; mixed rows pack; responsive fallback never mutates intent; auto fill by weight; row breaks honored | COMPLETE | `SPAN_UNITS` (`canvas-layout-intent.ts:10-16`), promotion (`:154-162`, no-mutation pinned at `canvas-layout-intent.spec.ts:42-48` and `canvas-layout.service.spec.ts:76-82`), apportionment (`:221-291`), breaks (`:207-212`) |
| Layout focus: transient, per workspace, not persisted, cleared on removal, exact restore, move/resize disabled | COMPLETE | `toggleLayoutFocus` never touches tiles, revision, or persistence (`canvas.store.ts:331-338`); stale focus cleared in `setWorkspaceTiles` (`:533-536`) and `removeTileFromAnyWorkspace` (`:454-455`); byte-identical restore pinned (`canvas-layout-intent.spec.ts:50-59`, `canvas-layout.service.spec.ts:84-92`); interaction disabled three ways (pinned at `canvas-workspace-grid.component.spec.ts:749-773`) |
| Resize snap: ties wider; only the dragged tile commits; stale revision rejected; drag projection uses units | COMPLETE | Ties wider via `<=` iteration order (`canvas-layout-intent.ts:164-176`, pinned at `canvas-layout-intent.spec.ts:72-77`); one-tile commit under revision guard (`canvas.store.ts:297-305`, pinned at `canvas-workspace-grid.component.spec.ts:608-632`); units, not tile counts (`canvas-layout-intent.ts:413-421`) |
| Lock blocks span, row, focus, preset in UI and store | COMPLETE | Store guards (`canvas.store.ts:309`, `:318`, `:332`, `:343`); UI disables every action (pinned at `canvas-tile.component.spec.ts:488-503`, `canvas-layout-controls.component.spec.ts:44-55`, `canvas-workspace-grid.component.spec.ts:725-746`) |
| Persistence: Zod first; v1 to v2 lossless; future version bytes kept and writes disabled; no write before hydration; debounce; lifecycle flushes; storage errors never throw; implicit `''` never persisted; key includes panelId | COMPLETE | Strict schemas (`canvas-layout-persistence.service.ts:28-62`); migration keeps weights and caps as durable rows (pinned for all four v1 caps, `canvas-layout-persistence.service.spec.ts:46-60`); future bytes + read-only (`:178-189`, pinned `:75-88`); hydration gating (`:233`, `:213-219`, pinned `:90-102`); flushes (`:133-147`, `pagehide`/destroy pinned `:104-114`); never throws (`:290-295`, pinned `:116-125`); `''` deleted and never written (`:157-160`, `:213-219`); key includes panelId (pinned `:34-44`) |
| Hydration never opens or loads sessions; teardown closes no tabs; no stale tiles | COMPLETE | `hydrateWorkspace` reads `tabManager.activeTabId()` only (`canvas.store.ts:422`); no `openSessionTab`/`switchSession` on the hydration path; `ngOnDestroy` flushes only (`orchestra-canvas.component.ts:423-425`, pinned at `orchestra-canvas.component.spec.ts:346-363`); prune effects cover active and background workspaces (`orchestra-canvas.component.ts:358-381`) |
| Races: debounce vs workspace switch; hydration vs early mutations; effects writing loops | COMPLETE | Per-path snapshot read at flush (`canvas.store.ts:545-550`, `canvas-layout-persistence.service.ts:240-250`); hydration is synchronous and one-shot per path (`canvas.store.ts:412-413`); `markHydrated` precedes the first `schedulePersist` (`:432-438`); the apply loop is closed (pinned at `canvas-workspace-grid.component.spec.ts:797-806`) |
| Tests assert the behaviors, not vacuous | PARTIAL | Assertions are exact (geometry tuples, revision counts, `setItem` call counts, JSON byte equality). Two gaps: no drag test with auto tiles in the preceding observed row (`canvas-layout-intent.spec.ts:79-91`), and `visibilitychange`/`beforeunload` flush untested (`canvas-layout-persistence.service.spec.ts:104-114`) |

Implicit requirements not addressed: none beyond the two plan ambiguities named in Failure modes 1 and 2. The removed public APIs (`columnsPreference`, `effectiveCapacity`, weight commits, `allTabIds`, `restoreCanvasTilesFromTabs`) have no remaining production references — only comments and task documents.

## Edge cases

| Case   | Handled | How           | Concern        |
| ------ | ------- | ------------- | -------------- |
| Zero or NaN container measurement | YES | Total layout returns empty; NaN capacity clamps to 1 (`canvas-layout-intent.ts:138-142`; pinned `canvas-layout.service.spec.ts:94-100`) | None |
| NaN / zero / negative auto weight | YES | `normalizeWeight` coerces to 1 at pack time (`canvas-layout-intent.ts:250-253`); schema rejects stored 0 (`canvas-layout-persistence.service.ts:18`) | None |
| Duplicate tab ids in a stored record | YES | Unique-ids refine invalidates (`canvas-layout-persistence.service.ts:40-41`; pinned `:62-73`) | None |
| Capacity 1 drag with interleaved rows | YES | Contiguity check rejects (`canvas-layout-intent.ts:387-404`; pinned `canvas-layout-intent.spec.ts:99-104`) | None |
| Row break on the first tile in order | YES | `toggleRowBreak` refuses (`canvas.store.ts:319-320`); `densify` strips it (`canvas-layout-intent.ts:77-84`) | None |
| Tile cap 9 | YES | Schema `.max` (`canvas-layout-persistence.service.ts:39`); `reconcileIntent` bound (`canvas-layout-intent.ts:126`) | None |
| Ghost node with unknown id in the engine | YES | Complete-observation rejection; ghost left untouched (pinned `canvas-workspace-grid.component.spec.ts:673-695`) | None |
| Non-integer stored `version` | PARTIAL | Treated as corrupt; overwritten on next write | Failure mode 3 |
| Gesture interrupted by lock, focus, hide, or capacity change | YES | Invalidation effect cancels; commit refused; nodes reconciled from current intent (pinned `canvas-workspace-grid.component.spec.ts:447-517`) | None |
| Auto row preceding a drag boundary | PARTIAL | Minimum-unit fits test mints a durable break | Failure mode 1 |

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM
- Top risk: The drag projection's unit accounting diverges from the renderer's for auto tiles — the default width — and that interplay has no test. The behavior follows the plan's letter and preserves observed structure, but the minted durable breaks will shape every later layout of that workspace.
- What a robust implementation would add:
  1. A decision on Failure mode 1 — rendered-unit fits accounting, or a plan amendment plus a spec that drags an auto row at two- and three-column capacity.
  2. Direct specs for the `visibilitychange`-hidden and `beforeunload` flush paths.
  3. Full width and break assertions for the `focus-plus-stack` preset.
  4. Optional: per-tile intent merge for carried implicit tiles when a stored record exists.
  5. Optional: extend the future-version guard to any `version > 2`, integer or not.

## Resolution after revise rounds

- Failure mode 1, the auto-row drag break, was kept by explicit product decision. The fit check intentionally mirrors `packRows` minimum-unit accounting, and capacity-two and capacity-three behavior is now pinned by specs.
- The direct lifecycle flush coverage gap for `beforeunload` and hidden/visible `visibilitychange` was resolved in revise round 1.
- The incomplete `focus-plus-stack` assertion was resolved in revise round 1 with exact order, width, and row-break expectations.
- Non-integer numeric future versions are now preserved byte-for-byte and marked read-only, resolved in revise round 1.
- The corrected review scope is eight production files and eight spec files, as reflected in the scope line above.
