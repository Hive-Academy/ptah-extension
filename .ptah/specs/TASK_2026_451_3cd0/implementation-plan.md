# Implementation Plan - TASK_2026_451

## Summary

Project each tab's existing `TabManagerService` view mode into canvas-only geometry without adding view state to `TileIntent` or persistence. `CanvasWorkspaceGridComponent` will derive a stable, ordered `TileViewConstraint[]` from its workspace tiles and `tabManager.tabs()`, pass that transient input to pure layout functions, and remain the only Gridstack writer. Full tiles remain six grid units high; compact tiles use two units and the smallest responsive width (4, 6, or 12 units). A deterministic skyline placer will let later tiles occupy holes left under compact tiles while preserving reading order, explicit row boundaries, and layout-focus isolation.

The compact toggle remains available while layout lock is active. Lock continues to reject every stored or transient layout-intent mutation and every pointer gesture, but an authoritative view-mode change is allowed to reproject geometry. `TileLayout` remains exactly `{ x, y, w, h }`, `MAX_CANVAS_TILES` remains 9, and no backend, RPC, persistence schema, chat compact-card, or tribunal-panel contract changes.

## Inputs and constraints

- Requirements used: `.ptah/specs/TASK_2026_451_3cd0/context.md`; `.ptah/specs/TASK_2026_442_68ba/implementation-plan.md`; `CLAUDE.md`; `libs/frontend/canvas/CLAUDE.md`; the current canvas implementation/specs; `libs/frontend/chat-state/src/lib/tab-manager.service.ts`; `libs/frontend/chat/src/lib/components/templates/chat-view.component.{ts,html}`; `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts`; `libs/frontend/tribunal-panel`; `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts`.
- Corrections applied: the binding decisions in `.ptah/specs/TASK_2026_451_3cd0/context.md` supersede TASK_2026_442's explicit height deferral. Width intent, persistence, layout focus, and one-way Gridstack ownership from TASK_2026_442 remain in force.
- Design handoff used: none.
- Missing decision-critical input: none.
- Verified constraint: canvas is Angular standalone/OnPush and only `CanvasWorkspaceGridComponent` may call Gridstack (`libs/frontend/canvas/CLAUDE.md:47-56`).

## Decisions (restated)

1. **Skyline packing.** Compact tiles shrink independently. Later tiles may occupy the earliest collision-free hole under a compact tile, including a hole inside a band that also contains six-unit full tiles. Placement is deterministic over 12 columns.
2. **Compact width is projection-only.** A compact tile ignores its stored width while rendered and requests the responsive minimum: 4 units at capacity 3, 6 at capacity 2, and 12 at capacity 1. Returning to full mode restores the exact stored `TileWidthIntent`.
3. **Lock exception.** Lock permits compact/full toggling and the resulting authoritative geometry reflow. It still blocks drag, resize, presets, span changes, row-break changes, and layout-focus changes.
4. **Height tiers.** `FULL_TILE_HEIGHT_UNITS = 6`; `COMPACT_TILE_HEIGHT_UNITS = 2`. Two units gives compact content one third of a normal tile while retaining enough space for the compact card's fixed header/footer and a useful activity area.
5. **Focus precedence.** Layout focus overrides compact geometry for its target: the target is an isolated `12 x 6` tile while its inner chat content still follows `TabManagerService` and may render the compact card. Exiting layout focus immediately reveals the underlying compact projection. This preserves focus's current full-width, isolated meaning.
6. **Compact resize.** Compact tiles remain draggable when otherwise allowed, but their horizontal resize handles are disabled. A resize cannot express durable compact width because compact width is derived; rejecting it avoids writing a hidden span that the user cannot see until returning to full mode.
7. **Persistence and public API.** No view mode or height enters `TileIntent`, canvas v2 records, `CanvasStore`, or public `TileLayout`; the existing nine-tile cap remains unchanged.

## Architecture decision

- Chosen approach: derive an ordered, structurally stable per-tab view-constraint array in `CanvasWorkspaceGridComponent`; feed it into one pure responsive-width/variable-height skyline projector; keep Gridstack as a diffed renderer.
- Rationale: this satisfies the binding one-way data flow and reuses the existing component that already joins workspace intent to measured layout and Gridstack (`canvas-workspace-grid.component.ts:183-209`, `:548-605`).
- Rejected alternatives: persisting view mode in `TileIntent` creates two authorities; reading view mode inside `CanvasLayoutService` makes a pure projector depend on Angular/chat state; changing height in Gridstack event handlers reverses geometry ownership; retaining rigid row-index placement cannot backfill compact-created holes.
- Assumptions: Gridstack static mode accepts programmatic `grid.update()`; the locked real-Gridstack E2E is the required resolution check and the fallback is a synchronous static-mode suspend/restore inside `_applyingLayout`.
- Effect on existing code: replace rigid vertical positioning and equal-y drag reconstruction in place; extend the existing layout call and interaction diff; leave store intent, persistence, chat rendering, tribunal-panel, and public exports alone.

## Current state (file:line)

The following evidence is the current implementation baseline; every architectural change below traces back to one of these verified contracts.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Verified: stored intent contains only tab id, order, width, and row break. | `libs/frontend/canvas/src/lib/canvas-layout-intent.ts:32-42` | View mode must be a separate derived input, never a new intent field. |
| Verified: current packing sorts by `(order, tabId)`, respects `rowBreakBefore`, and resolves widths into sequential rows. | `libs/frontend/canvas/src/lib/canvas-layout-intent.ts:63-75`, `:178-219` | Reuse ordering and width resolution, then replace row-index positioning with skyline placement. |
| Verified: every projected tile currently receives `y = rowIndex * 6` and `h = 6`. | `libs/frontend/canvas/src/lib/canvas-layout.service.ts:100-116` | Height and vertical position must move into the pure intent projection. |
| Verified: cell height currently uses row count and always applies a 90%-viewport tile floor. | `libs/frontend/canvas/src/lib/canvas-layout.service.ts:135-149` | Compute from `max(y + h)` and apply the 90% floor only when a projected six-unit tile exists. |
| Verified: the workspace grid is the sole Gridstack adapter and already feeds store intent through `computeLayout()` to guarded `grid.update()`. | `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:50-65`, `:199-209`, `:556-605` | Add view constraints at this boundary; do not put compact branches in event handlers. |
| Verified: lock currently suppresses every layout application, while Gridstack static mode blocks gestures. | `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:267-275`, `:294-299`, `:556-558` | Split authoritative view reflow from ordinary resize/intent reflow while locked. |
| Verified: gesture validity currently captures workspace, revision, responsive capacity, focus id, and membership. | `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:36-45`, `:309-328`, `:406-423` | Add a view-constraint fingerprint so a mid-gesture compact/full change cancels and reconciles. |
| Verified: all nodes currently share one move/resize enablement flag. | `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:608-619` | Make resize enablement per node; compact nodes get `resizable(false)` while permitted full nodes remain resizable. |
| Verified: singleton CSS forces both grid and item height to 100%, regardless of mode. | `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:127-145` | Keep singleton interaction suppression, but limit the 100%-height item override to a full/focused singleton. |
| Verified: the outer tile already stretches its chat host to the Gridstack item's full height. | `libs/frontend/canvas/src/lib/canvas-tile.component.ts:89-101`, `:225-233` | A smaller Gridstack item automatically produces a smaller tile; no inner sizing adapter is required. |
| Verified: the compact button writes only through `toggleTabViewMode`, and lock does not disable it. | `libs/frontend/canvas/src/lib/canvas-tile.component.ts:196-207`, `:373-376`, `:406-413` | Preserve this authority and explicitly test/document the lock exception. |
| Verified: `tabs` is a readonly signal; view mode toggling updates the tab, and missing modes default to full. | `libs/frontend/chat-state/src/lib/tab-manager.service.ts:281-289`, `:2602-2619` | A computed over `tabs()` is reactive and has a safe full-mode fallback. |
| Verified: `ChatViewComponent` independently selects the compact card from the same tab view mode. | `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:585-599`; `chat-view.component.html:1-15` | Canvas geometry and inner content react to one authority without direct coupling to each other. |
| Verified: compact card host, root, activity region, and input already use `h-full`, `flex-1`, `min-h-0`, and shrink controls. | `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:56-64`, `:87-106` | No compact-session-card CSS change is needed. |
| Verified: canvas v2 validation stores only the existing four intent fields. | `libs/frontend/canvas/src/lib/canvas-layout-persistence.service.ts:23-40` | The schema and persisted bytes remain unchanged. |
| Verified: tribunal-panel consumes `TileLayout` directly. | `libs/frontend/tribunal-panel/src/lib/types/tribunal-ui.types.ts:81-88` | Do not add metadata to the public geometry shape. |

## Architecture (data flow)

### Derived view constraint ownership

`CanvasWorkspaceGridComponent` owns the computed because it already joins one workspace's `CanvasStore.tilesFor(path)` to layout projection and is the only Gridstack boundary. It injects the already-permitted `TabManagerService` dependency from `@ptah-extension/chat` and derives this canvas-local shape in tile reading order:

```ts
export type TileHeightTier = 'full' | 'compact';

export interface TileViewConstraint {
  readonly tabId: string;
  readonly heightTier: TileHeightTier;
}

export type TileViewConstraints = readonly TileViewConstraint[];
```

The computed reads `tabManager.tabs()` once, indexes tabs by id, and maps only the current workspace's tiles. Missing tabs or missing `viewMode` yield `full`. Give the computed a structural equality function over `(tabId, heightTier)` so unrelated transcript/status updates in `TabState` do not trigger geometry work. The same ordered data produces a stable fingerprint (for example, length-prefixed `tabId` plus tier) captured by gestures; do not use object identity.

`TileViewConstraint` is an internal canvas projection contract in `canvas-layout-intent.ts`, not a public barrel export and not a persistence type. `CanvasLayoutService.computeLayout(tiles, layoutFocusTabId, viewConstraints)` accepts it as a third, default-empty argument so existing full-only callers retain current behavior. Empty/missing constraints mean full.

### One-way flow

1. `TabManagerService.toggleTabViewMode(tabId)` mutates the authoritative tab signal (`tab-manager.service.ts:2602-2619`).
2. The workspace grid's structurally stable computed derives `TileViewConstraints` for its tile membership.
3. `CanvasLayoutService.computeLayout()` passes stored intent, capacity, focus id, and constraints into pure functions in `canvas-layout-intent.ts`.
4. Pure width resolution and skyline placement return `{ tabId, x, y, w, h }`; `CanvasLayoutService` calculates cell height from that result and returns the unchanged public `CanvasLayout` shape.
5. The existing guarded diff batches only changed nodes through `grid.update()` (`canvas-workspace-grid.component.ts:563-599`). No compact condition is added to Gridstack change/stop translation.

## Component specifications

#### 1. Pure constraint projection and skyline placement

- Purpose: derive deterministic collision-free geometry from stored intent plus transient view/focus constraints.
- Responsibilities: responsive compact width, height tier, auto-width preference, skyline placement, explicit fences, drag-projection validation.
- Verified contracts and entry points: `TileIntent` (`canvas-layout-intent.ts:32-42`), `minimumUnitsFor`/`effectiveUnits` (`:138-162`), `packRows` (`:178-219`), `projectDragIntent` (`:330-448`).
- Dependencies: pure TypeScript only; no Angular, Gridstack, chat, or persistence imports.
- Failure behaviour: invalid/missing view constraints default to full; invalid drag observations or geometry with no valid intent reconstruction return `null`; layout projection remains total.
- Quality requirements: at most nine tiles and 12 columns bound skyline work; drag break reconstruction may enumerate at most `2^(9-1) = 256` masks.
- Verification seam: direct unit tests over pure functions and exact geometry.
- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-451-compact-tile-sizing\libs\frontend\canvas\src\lib\canvas-layout-intent.ts`; MODIFY its spec.

#### 2. Layout service height/cell projection

- Purpose: combine measured viewport dimensions with pure positioned geometry.
- Responsibilities: capacity selection, `max(y+h)` extent, fit cell height, conditional full-tile floor.
- Verified contracts and entry points: `TileLayout`/`CanvasLayout` (`canvas-layout.service.ts:24-38`), `columnsFor` (`:72-82`), `computeLayout` (`:84-123`).
- Dependencies: pure layout functions point inward; ResizeObserver remains the only measurement boundary.
- Failure behaviour: zero width/height or no tiles returns the existing empty fallback; non-finite values remain clamped/total.
- Verification seam: service tests with controlled ResizeObserver measurements.
- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-451-compact-tile-sizing\libs\frontend\canvas\src\lib\canvas-layout.service.ts`; MODIFY its spec.

#### 3. Workspace Gridstack projection adapter

- Purpose: join tab view authority to canvas intent and apply the resulting geometry without accepting Gridstack as state.
- Responsibilities: derive stable constraints/fingerprint, pass constraints to layout, permit only view-driven application while locked, set per-node resize state, cancel stale gestures, make singleton CSS mode-aware.
- Verified contracts and entry points: layout computed (`canvas-workspace-grid.component.ts:183-209`), gesture lifecycle (`:309-483`), authoritative apply (`:548-605`), interaction state (`:608-619`).
- Dependencies: `CanvasStore` intent and `TabManagerService.tabs()` point into the adapter; Gridstack remains downstream only.
- Failure behaviour: a changed view fingerprint invalidates an active gesture and reconciles all nodes; missing tab state renders full; locked non-view invalidations stay frozen; unknown nodes remain skipped.
- Quality requirements: constraint equality prevents streaming tab updates from producing layout churn; programmatic updates retain `_applyingLayout`/`finally` protection.
- Verification seam: component tests with the existing Gridstack fake plus Electron E2E with real Gridstack.
- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-451-compact-tile-sizing\libs\frontend\canvas\src\lib\canvas-workspace-grid.component.ts`; MODIFY its spec.

#### 4. Tile toggle contract and documentation

- Purpose: keep compact toggling accessible/testable and document that it is not a locked layout-intent action.
- Responsibilities: add a dynamic `aria-label` and stable test id to the existing toggle; stop pointer-start events from initiating a header drag; correct lock comments; document height/lock/skyline contracts.
- Verified contracts and entry points: toggle template and handler (`canvas-tile.component.ts:196-207`, `:406-413`), store lock guards (`canvas.store.ts:272-348`).
- Dependencies: existing `TabManagerService` only; no new output or store mutation.
- Failure behaviour: unknown tab id remains a no-op in `TabManagerService`; button stays enabled under lock.
- Verification seam: tile component test for invocation, accessible label, pointer propagation, and lock exception; store lock test continues proving all actual intent mutations remain blocked.
- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-451-compact-tile-sizing\libs\frontend\canvas\src\lib\canvas-tile.component.ts`; MODIFY its spec; MODIFY comments only in `canvas.store.ts`; MODIFY `libs/frontend/canvas/CLAUDE.md`.

## Skyline placement algorithm

### Inputs and ordering

- `tiles`: stored `TileIntent[]`, sorted by `(order, tabId)` as today (`canvas-layout-intent.ts:63-68`).
- `capacity`: clamped 1..3; responsive minimum is `ceil(12 / capacity)` (`canvas-layout-intent.ts:138-147`).
- `constraints`: ordered internal view constraints; absent ids are full.
- `layoutFocusTabId`: optional transient focus.
- Reading order is the sorted tile order. The placer maintains a nondecreasing `readingFloorY` so a later tile can fill a hole below an earlier tile but cannot jump visually above it.
- `rowBreakBefore` is a hard fence: before that tile, raise its floor to the current maximum skyline. This preserves explicit rows and preset boundaries. An automatic width overflow is not a fence; this distinction is what allows default later tiles to rise into compact-created space.

### Width resolution

First retain the existing responsive named-span and weighted-auto row calculation to establish each full tile's **preferred** width. During that calculation compact tiles are fixed participants at `minimumUnitsFor(capacity)` and are excluded from auto-weight remainder sharing. Thus compact width never mutates or derives from stored width.

At placement time:

- layout-focused tile: only width 12;
- compact tile: only the responsive minimum;
- full named-span tile: only its responsive `effectiveUnits`;
- full auto tile: candidate widths from its preferred width down to the responsive minimum. Choose by earliest candidate `y`, then widest width, then lowest `x`. This preserves current full-row fill when vertical positions tie, but lets an auto tile temporarily contract to occupy an earlier compact-created hole. When compact mode exits, the earlier hole disappears and the same auto tile returns to its preferred width without changing stored weight.

### Pseudocode

```text
ordered = sort tiles by (order, tabId)
preferredWidths = resolve existing logical width rows(
  ordered,
  compact width = minimumUnits,
  compact excluded from auto remainder
)
skyline[0..11] = 0
readingFloorY = 0
positioned = []

for tile in ordered:
  tier = constraint(tile.id) default full

  if tile.id == layoutFocusTabId:
    readingFloorY = max(readingFloorY, max(skyline))
    place { x: 0, y: readingFloorY, w: 12, h: 6 }
    skyline[0..11] = readingFloorY + 6
    readingFloorY = readingFloorY + 6
    continue

  if tile.rowBreakBefore:
    readingFloorY = max(readingFloorY, max(skyline))

  h = tier == compact ? 2 : 6
  widthCandidates =
    compact    -> [minimumUnits]
    named full -> [effectiveUnits(storedWidth, capacity)]
    auto full  -> [preferredWidth, preferredWidth-1, ..., minimumUnits]

  candidates = for each w and each x in 0..(12-w):
    y = max(readingFloorY, max(skyline[x .. x+w-1]))
    candidate = (y, -w, x)

  choose lexicographically smallest candidate
  append { tabId, x, y, w, h }
  skyline[x .. x+w-1] = y + h
  readingFloorY = y

totalExtent = max(positioned.map(tile => tile.y + tile.h), default 0)
```

The skyline update makes overlap impossible. Integer inputs and the `(y, -w, x)` tie-break make output repeatable. The nondecreasing floor preserves DOM/reading order; explicit fences and focus prevent a later tile from backfilling across a user-declared semantic boundary.

### Worked examples at capacity 3

All tuples are `(x, y, w, h)`.

1. **Three stored thirds, middle compact, then another third with no explicit break**
   - A full: `(0, 0, 4, 6)`
   - B compact: `(4, 0, 4, 2)`
   - C full: `(8, 0, 4, 6)`
   - D full: `(4, 2, 4, 6)` — rises into B's freed columns
   - extent: `8`, not two rigid 6-unit rows (`12`)

2. **Half full + half compact, followed by a stored third**
   - A full half: `(0, 0, 6, 6)`
   - B compact (stored half ignored): `(6, 0, 4, 2)`
   - C full third: `(6, 2, 4, 6)`
   - extent: `8`

3. **Nine compact auto tiles**
   - A/B/C: `(0|4|8, 0, 4, 2)`
   - D/E/F: `(0|4|8, 2, 4, 2)`
   - G/H/I: `(0|4|8, 4, 4, 2)`
   - extent: `6`, versus the current `18`

4. **Explicit break before D in example 1**
   - A/B/C remain as above; the break raises D's floor to `6`, so D begins at `(0, 6, 4, 6)`.
   - This is intentional: a user/preset-declared row boundary wins over opportunistic compaction.

5. **Narrow capacity**
   - At capacity 2 a compact tile is 6 units; at capacity 1 it is 12. Height remains 2.
   - Stored width is untouched, so restoring full mode or widening the canvas reprojects from the original span/auto weight.

### Cell height and singleton behavior

`cellHeightFor` receives positioned tiles rather than row count. Compute `totalExtent = max(y + h)`, `hasFullTile = any(h === 6)`, and a vertical-band margin count from `ceil(totalExtent / 6)`. The fit denominator is `max(totalExtent, 6)` so a compact-only singleton does not stretch its two units back to full viewport height. The result is:

```text
fit = floor((containerHeight - totalMargins) / max(totalExtent, 6))
fullFloor = hasFullTile ? floor(containerHeight * 0.9 / 6) : 0
cellHeight = max(MIN_CELL_HEIGHT, fit, fullFloor)
```

The 90% floor therefore protects full chat tiles only. Mixed layouts may scroll when a six-unit tile requires the floor; all-compact layouts fit their true skyline extent. Rename/split singleton CSS state: keep `.singleton` for no-move/no-resize/header cursor behavior, and apply `height: 100% !important` to the item only under a derived `.singleton-expanded` class when its effective tier is full or it is layout-focused. A compact singleton uses its projected `h = 2` and is no longer forced to fill the canvas.

## Gesture/lock/focus interactions

- **Drag:** remains enabled for compact tiles unless singleton, locked, or layout-focused. Extend `TilePositionObservation` to include `w` and `h`; validate finite integer `x/y/w/h`, membership, and the expected projected height tier. Sort candidate reading order by `(y, x, tabId)` and retain the current rule that non-dragged tiles cannot silently reorder (`canvas-layout-intent.ts:363-378`).
- **Mixed-height row reconstruction:** equality of `y` no longer identifies a logical row. For capacity 2/3, enumerate the at-most-256 possible `rowBreakBefore` masks for the observed order, run each through the same pure skyline projector, and keep only masks whose complete `(x,y,w,h)` matches observations. Select minimum Hamming distance from existing break ownership, then lexicographically smallest mask. No match rejects the gesture. At capacity 1, preserve the existing logical-row-block contiguity rule because every width is 12 and row-break geometry is ambiguous (`canvas-layout-intent.ts:382-403`).
- **Resize:** `applyNodeInteractionState` calls `movable` and `resizable` separately. Compact nodes are movable but not resizable. `onGestureStart('resize', ...)` defensively refuses a compact id even if Gridstack emits a stale handle event. Full resize retains current named-span snapping and store transaction.
- **Mid-gesture view change:** capture the structural view fingerprint in `GestureSnapshot`; compare it in both the reactive invalidation effect and terminal commit guard beside capacity/focus/revision. Any compact/full change cancels, increments cancellation metrics, and force-reconciles current authoritative geometry.
- **Lock:** Gridstack remains static and every `CanvasStore` intent guard remains unchanged (`canvas.store.ts:272-348`). Track the last **applied** view fingerprint, not merely the last observed one. While locked, only a visible grid whose current fingerprint differs from the applied fingerprint may call guarded authoritative geometry application. Container measurement, preset, focus, span, row, and gesture paths stay frozen. Hidden locked grids retain a pending fingerprint difference and apply the view projection when visible.
- **Presets:** continue to rewrite stored width/order/break intent only. Compact projection overlays the preset. Explicit preset breaks are hard skyline fences. Presets remain disabled under lock.
- **Layout focus:** flush before and after the focus tile, render it `12 x 6`, and disable all move/resize as today (`canvas-workspace-grid.component.ts:194-220`, `:613-619`). Compact content stays compact because canvas does not write tab view mode. Focus actions remain blocked under lock.
- **Toggle pointer safety:** stop `mousedown`, `pointerdown`, and `touchstart` on the outer tile's compact toggle, matching the layout menu's header-drag isolation (`canvas-tile.component.ts:111-122`). The inner compact-card “Full View” control still exercises fingerprint cancellation if invoked during an active external gesture.

## Integration architecture

- Data flow: tab signal -> grid-owned derived constraints -> pure width/skyline projection -> layout service cell height -> guarded Gridstack updates.
- State or persistence: view mode remains owned/lived with `TabManagerService`; derived arrays/fingerprints are computed/cache state only; canvas v2 bytes do not change.
- External boundaries: no new external input. Existing Zod persistence schema remains untouched.
- Failure and rollback: malformed/missing derived entries default full; invalid gestures are rejected and current authoritative geometry is re-applied; a failed/absent grid instance leaves intent and tab mode intact for the next effect pass.
- Observability: existing layout computation/apply/update/cancel/accept metrics remain the evidence path (`canvas-workspace-grid.component.ts:81-87`, `:394-483`, `:558-605`). E2E reads `gs-x/y/w/h` and these counters.

## File-by-file changes

### MODIFY

- `D:\projects\ptah-extension\.claude-worktrees\task-451-compact-tile-sizing\libs\frontend\canvas\src\lib\canvas-layout-intent.ts`
  - Add internal view-tier/constraint types and `FULL_TILE_HEIGHT_UNITS = 6`, `COMPACT_TILE_HEIGHT_UNITS = 2`.
  - Extend width projection for compact and auto-hole candidates; add skyline positioning and total-extent helpers.
  - Replace equal-`y` drag row grouping with geometry validation plus bounded break-mask reconstruction.
- `D:\projects\ptah-extension\.claude-worktrees\task-451-compact-tile-sizing\libs\frontend\canvas\src\lib\canvas-layout-intent.spec.ts`
  - Replace rigid-row-only expectations with width-resolution plus skyline geometry cases.
- `D:\projects\ptah-extension\.claude-worktrees\task-451-compact-tile-sizing\libs\frontend\canvas\src\lib\canvas-layout.service.ts`
  - Accept derived constraints, consume pure positioned output, and compute cell height from extent/full-tier presence.
- `D:\projects\ptah-extension\.claude-worktrees\task-451-compact-tile-sizing\libs\frontend\canvas\src\lib\canvas-layout.service.spec.ts`
  - Add exact mixed/all-compact/focus/responsive/cell-height expectations.
- `D:\projects\ptah-extension\.claude-worktrees\task-451-compact-tile-sizing\libs\frontend\canvas\src\lib\canvas-workspace-grid.component.ts`
  - Inject tab manager, derive structurally stable constraints/fingerprint, pass them to layout, cancel stale gestures, set per-node resize state, permit view-only locked application, and split singleton classes.
- `D:\projects\ptah-extension\.claude-worktrees\task-451-compact-tile-sizing\libs\frontend\canvas\src\lib\canvas-workspace-grid.component.spec.ts`
  - Extend the tab/grid fakes and cover real component integration rules.
- `D:\projects\ptah-extension\.claude-worktrees\task-451-compact-tile-sizing\libs\frontend\canvas\src\lib\canvas-tile.component.ts`
  - Add toggle accessibility/test selector and header-drag pointer isolation; clarify the lock comment.
- `D:\projects\ptah-extension\.claude-worktrees\task-451-compact-tile-sizing\libs\frontend\canvas\src\lib\canvas-tile.component.spec.ts`
  - Verify toggle authority, labels, pointer handling, and enabled-under-lock behavior.
- `D:\projects\ptah-extension\.claude-worktrees\task-451-compact-tile-sizing\libs\frontend\canvas\src\lib\canvas.store.ts`
  - Documentation-only correction: lock freezes layout intent and gestures, with tab-owned view projection explicitly outside store authority.
- `D:\projects\ptah-extension\.claude-worktrees\task-451-compact-tile-sizing\libs\frontend\canvas\CLAUDE.md`
  - Document transient view constraints, 6/2 height tiers, skyline/fence semantics, compact resize suppression, view-change gesture cancellation, full/focused singleton behavior, and the lock exception.
- `D:\projects\ptah-extension\.claude-worktrees\task-451-compact-tile-sizing\apps\ptah-electron-e2e\src\specs\canvas\canvas.spec.ts`
  - Add real Gridstack compact shrink/reflow/restore and locked-toggle coverage.

### CREATE / REWRITE

- None. Replace current row-index projection in place; do not add a parallel layout implementation.

### Explicitly unchanged

- `canvas-layout-persistence.service.ts` and spec: v2 shape/bytes remain unchanged.
- `canvas.store.spec.ts`: existing lock test at `:149-156` continues to cover every store-owned layout mutation; no view-mode state or behavior is added to the store.
- `compact-session-card.component.ts` and `chat-view.component.{ts,html}`: existing flex/min-height contracts already fill the new box.
- `libs/frontend/tribunal-panel/**`: public `TileLayout` is unchanged.
- `src/index.ts`: no new public exports.

## Test plan per spec file

### `canvas-layout-intent.spec.ts`

- Preserve named-span, weighted-auto, responsive promotion, preset, deletion, and snap coverage.
- Add compact width tests at capacities 3/2/1 and assert input intent is byte-identical before/after.
- Add exact skyline cases for: three thirds with middle compact plus a following third; half full + half compact + third; nine compact tiles; mixed full/compact auto widths with an auto tile contracting only to fill an earlier hole.
- Add explicit `rowBreakBefore` fence and focus-before/after fence tests; compact focused target must be `12 x 6` while source constraints/intent remain unchanged.
- Add determinism tests under equal skyline candidates (widest auto candidate, then lowest `x`) and shuffled input with stable `(order, tabId)` output.
- Replace current drag tests at `:87-136` with full `(x,y,w,h)` observations: accept a valid mixed-height reorder, recover the minimum-change break mask, reject overlaps/non-integer or wrong-tier heights, preserve capacity-one block contiguity, and reject incomplete/duplicate membership.

### `canvas-layout.service.spec.ts`

- Keep the full-only exact geometry at `:64-70`; all those `h: 6` assertions remain correct because no compact constraint is supplied.
- Add `h: 2` and skyline `y` assertions for mixed mode and all compact.
- Extend responsive restoration: compact is 4/6/12 without mutating stored third/half/auto width; returning full restores the prior stored projection.
- Extend focus test at `:86-94` with a compact focused target and assert focus gives `12 x 6`, then exit returns it to compact geometry.
- Replace “every wrapped tile gets 90%” at `:104-109` with: any six-unit tile activates the floor; compact-only layouts do not; extent is `max(y+h)`; compact singleton uses the six-unit fit baseline and does not stretch to full height.
- Preserve zero-measurement and invalid-auto totality.

### `canvas-workspace-grid.component.spec.ts`

- Supply a writable `tabs` signal in the `TabManagerService` fake and ensure structural equality ignores unrelated tab-field updates.
- Projection: toggle the middle tile compact and assert only changed node(s), dependent reflow nodes, cell height, and cached creation options update; restore full and assert stored intent/revision are unchanged.
- Interaction: compact node remains movable but gets `noResize`/`resizable(false)`; stale compact resize-start is refused; full nodes remain horizontally resizable.
- Gesture: changing any participating tab's view tier during drag/resize cancels and reconciles; mixed-height observations commit only when the pure reconstruction matches.
- Lock: retain the existing container-resize freeze at `:743-763`, then add that a view fingerprint change while locked does update authoritative geometry, commits no store intent, keeps Gridstack static, and still refuses gestures/span/preset/focus/row operations.
- Singleton: retain no-move/no-resize tests at `:875-905`; assert full singleton gets expanded CSS, compact singleton does not, and compact singleton receives `h: 2`.
- Feedback loop: preserve guarded-batch/no-op metrics and prove a repeated equivalent view constraint causes zero `grid.update()` calls.
- Existing `h: 6` fake seeds/invalid-node fixtures at current `:306`, `:389`, and `:700` remain full-mode fixtures; add separate compact fixtures rather than globally changing them.

### `canvas-tile.component.spec.ts`

- Add a view-mode suite using the existing tab-manager fake (`:434-443`): dynamic “Switch to compact/full view” aria label, one `toggleTabViewMode(tabId)` call, pointer-start propagation suppression, and enabled behavior when `layoutLocked=true`.
- Update the current lock menu assertion at `:532-547` to state precisely that all **layout menu** items are disabled; the adjacent compact toggle remains enabled.

### `canvas.store.spec.ts`

- No behavioral change required. Keep `:149-156` proving lock blocks span, row, focus, and preset mutations. If the documentation-only comment edit causes this file to be touched during implementation, rename the test to “lock blocks every store-owned layout mutation” without adding view mode to the store fake or assertions.

### `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts`

- In a wide real Gridstack canvas, create at least four tiles, set deterministic third spans, compact the middle tile, and poll `gs-x/y/w/h` until the fourth tile occupies `(4,2,4,6)`; assert the compact item is `(4,0,4,2)` and has no visible resize handle.
- Toggle back to full and assert the middle tile's stored third projection returns and the later tile leaves the hole.
- Repeat compact toggle while layout lock is active: toggle remains enabled, geometry reflows, Gridstack stays static, presets/span/row/focus remain disabled, and gesture commit count does not change.
- Add a compact singleton assertion that its `gridstack-item` has `gs-h="2"` and is not forced to the full grid height.
- Retain the full-only narrow geometry at current `:275-279` (`h: 6` for all three); it verifies responsive full mode and should not be rewritten.

### Other existing `h === 6` assertions

- `orchestra-canvas.component.spec.ts:459-468` is a full-only layout-service stub and remains `h: 6`.
- `libs/frontend/tribunal-panel/src/lib/services/tribunal-state.service.spec.ts:192` remains `h: 6`; tribunal layout is independent and `TileLayout` is unchanged.
- Full-mode Gridstack and service expectations stay six units. Only tests that explicitly supply a compact view constraint assert two units.

## Architecture-level quality requirements

- Functional: a compact tile projects to responsive minimum width and height 2; a full tile projects from stored width and height 6; mixed geometry has no overlap; explicit breaks/focus remain fences; lock permits only view-driven reflow.
- Performance: one view-mode toggle performs one computed invalidation and one guarded Gridstack batch; unrelated `TabState` updates compare equal; skyline is bounded by `9 * 12 * 12` candidate checks and drag reconstruction by 256 masks.
- Security: no new external boundary, HTML path, or persisted input; current Zod persistence validation remains the only storage boundary.
- Maintainability: pure geometry stays in `canvas-layout-intent.ts`; measurement stays in `CanvasLayoutService`; Gridstack stays in the workspace grid; view state stays in `TabManagerService`; no compatibility path or duplicate packer remains.
- Testability: exact pure geometry, component interaction state, cancellation, lock exception, singleton behavior, and one real Gridstack path must be observable.

## Risks

- **Gridstack compaction divergence.** Real drag placement may not exactly match the pure skyline. Mitigation: reverse-project only complete geometry that the pure projector can reproduce; otherwise reject and reconcile. The Electron E2E is required evidence.
- **Static-mode programmatic updates.** Assumption: Gridstack's static mode still accepts explicit `grid.update()` calls. Resolve by the locked compact-toggle Electron E2E; if false, temporarily leave static mode only inside `_applyingLayout` and restore it in `finally`, without enabling user interaction.
- **Auto-width surprise.** A full auto tile may temporarily narrow to occupy an earlier hole. Mitigation: earliest-y then widest-width ordering, projection-only behavior, and exact restore tests when compact exits.
- **Frequent tab-signal writes.** Streaming/status changes can replace tab objects. Mitigation: structural equality on only tile id/tier prevents layout churn.
- **Ambiguous drag row intent.** Mixed heights remove equal-`y` row grouping. Mitigation: bounded exhaustive break reconstruction, minimum-change selection, and rejection on ambiguity/no match.
- **Compact content minimums.** The existing compact tree is flex-safe, but dense permission/question content may scroll internally. Verify at the two-unit tier in E2E; do not increase grid height from content because geometry must remain authoritative.
- **Locked hidden workspace.** A view change can occur while its retained grid is hidden. Track last applied fingerprint so visibility restoration performs the pending view-only projection once.

## Handoff for the implementer

- Replace `rowIndex * 6` positioning in place; do not keep a legacy row path or introduce versioned layout classes.
- Preserve `TileIntent`, canvas v2 Zod schema/bytes, `TileLayout`, `MAX_CANVAS_TILES = 9`, and the `src/index.ts` export surface.
- Keep compact logic out of Gridstack event handlers: handlers receive already-derived constraints only for validation/cancellation and call the shared pure projector for reconstruction.

## Team-leader handoff

- Recommended executor: `frontend-developer` for all components because this is one Angular canvas slice with tightly coupled pure-layout and Gridstack behavior; `senior-tester` should independently exercise the real Electron Gridstack seam after implementation.
- Complexity: HIGH. The code surface is bounded, but variable-height skyline placement, auto-width hole filling, reversible intent projection, lock exception, and gesture reverse-projection interact.
- Dependencies and ordering: pure types/projection precede service integration; grid adapter consumes both; tile accessibility and documentation are independent; E2E follows the integrated behavior.
- Parallel-safe work: tile toggle/spec plus `CLAUDE.md` are file-disjoint from pure layout/service work, but grid/spec and E2E depend on the final constraint signature and geometry.
- Verification points: `npx nx test @ptah-extension/canvas`; `npx nx typecheck @ptah-extension/canvas`; `npx nx lint @ptah-extension/canvas`; run the repository's Electron E2E command filtered to `src/specs/canvas/canvas.spec.ts` and confirm the filter actually executes that spec.
- Complete affected-file set: the eleven MODIFY paths listed above; no CREATE/REWRITE production files.
