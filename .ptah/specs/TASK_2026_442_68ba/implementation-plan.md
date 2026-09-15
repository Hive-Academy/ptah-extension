# Implementation Plan - TASK_2026_442

## Summary

Replace the workspace-wide `ColumnsPreference` width cap with per-tile width intent. A tile either carries a named span (`third`, `half`, `two-thirds`, `full`) or a legacy/default `auto` width with a relative weight. Named spans are the only width values written by tile-menu actions and resize gestures; `auto` exists so untouched tiles retain the current even-fill behaviour and version-1 records retain their exact weight ratios during migration.

Layout remains a pure projection: ordered intent and explicit row breaks are packed into responsive rows, then mapped to the existing `{ x, y, w, h }` `TileLayout`. No concrete geometry is stored. A layout-focus id is transient workspace state and changes only the projection, so exiting focus restores the original span, order, and row breaks without a backup snapshot.

This is a frontend-only change. The current `CanvasStore` holds workspace tiles and column preferences only in component-scoped signals (`canvas.store.ts:75-87`, `:139-149`), and the current mount path restores canvas membership from already-persisted tabs rather than loading canvas intent (`orchestra-canvas.component.ts:376-399`). No RPC, shared contract, or backend schema currently carries canvas layout state.

## Inputs and constraints

- Requirements used: `.ptah/specs/TASK_2026_442_68ba/context.md`; `CLAUDE.md`; `libs/frontend/canvas/CLAUDE.md`; the seven named canvas source files and their specs; `.ptah/specs/TASK_2026_387/context.md`; `.ptah/specs/TASK_2026_387/implementation-plan.md`; `.ptah/specs/TASK_2026_404_6fcd/context.md`; `.ptah/specs/TASK_2026_404_6fcd/task-description.md`.
- Corrections applied: TASK_2026_404 correctly states that canvas intent is not persisted on this branch (`task-description.md:126-134`) and specifies the pending per-workspace/per-panel persistence contract (`:359-405`). Therefore this plan owns the canvas persistence slice and treats a TASK_2026_404 v1 record as the migration source if that slice lands first; it must not create a second persistence implementation.
- Design handoff used: none.
- Missing decision-critical input: none. The required choices are settled below.
- Repository constraints: Angular components remain standalone, OnPush, signal-based and zoneless (`CLAUDE.md:94-100`, `:159-168`; `libs/frontend/canvas/CLAUDE.md:47-56`). Only `CanvasWorkspaceGridComponent` may call Gridstack and `CanvasLayoutService` must remain Gridstack-free (`libs/frontend/canvas/CLAUDE.md:53-56`). `CanvasStore` remains panel-scoped through the canvas component providers (`orchestra-canvas.component.ts:52-63`).

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| `TileIntent` currently stores `order`, relative `weight`, and `rowBreakBefore`; geometry is explicitly derived. | `libs/frontend/canvas/src/lib/canvas-layout.service.ts:34-44` | Replace the width member in intent; do not add coordinates. |
| Width is currently a workspace cap plus responsive capacity, and rows are count-chunked before weight apportionment. | `canvas-layout-intent.ts:3`, `:48-54`; `canvas-layout.service.ts:111-154` | Remove the cap from runtime layout and pack by effective span units. |
| The 12-unit grid, 480px minimum tile width, three-column upper bound, and fixed six-unit height are current layout contracts. | `canvas-layout.service.ts:8-29`, `:139-145` | Spans map to 4/6/8/12 units; responsive fallback is derived from the same minimum-width capacity; height remains unchanged. |
| The store partitions tiles, focus, revisions and column preference by workspace, but does not write any of them outside memory. | `canvas.store.ts:75-92`, `:100-149` | Span/focus mutations belong in the same scoped store; persistence needs a named collaborator rather than more storage code in the 669-line store. |
| Removal already preserves logical row boundaries and gesture commits are workspace/revision addressed. | `canvas-layout-intent.ts:25-45`; `canvas.store.ts:269-334`, `:633-668` | Reuse row-preserving deletion and atomic gesture transactions, replacing weight commit with span commit. |
| Gridstack is configured for horizontal resize only, captures gesture context, validates complete engine membership, and reconciles all terminal paths. | `canvas-workspace-grid.component.ts:156-170`, `:243-355`, `:357-447`, `:479-551` | Keep the transaction and one-writer machinery; change only the width projection and resize result. |
| Tile headers already own view-mode and close actions but have no layout menu. | `canvas-tile.component.ts:65-97`, `:217-233`, `:263-279` | Add the per-tile menu here and emit intent requests upward. |
| `NativePopoverComponent` restores prior focus and closes on Escape. | `libs/frontend/ui/src/lib/native/popover/native-popover.component.ts:49-61`, `:166-213`, `:224-234` | Reuse it for a keyboard-reachable tile layout menu. |
| The dock currently exposes only 1/2/3 cap buttons and lock; cap actions are disabled while locked. | `canvas-layout-controls.component.ts:61-128`, `:147-196` | Replace cap buttons with preset actions while retaining the lock guard at both UI and handler levels. |
| The canvas measures the session viewport and renders one retained grid per workspace. | `orchestra-canvas.component.ts:145-167`, `:272-281` | Responsive span fallback continues to use the existing measured boundary and restores automatically when it widens. |
| Tab persistence already establishes workspace-path encoding and panel-namespaced local-storage keys. | `libs/frontend/chat-state/src/lib/tab-workspace-partition.service.ts:463-490` | Canvas persistence uses the same encoding and `panelId` namespace, but its own key prefix and schema. |
| `VSCodeService.config()` exposes `panelId`; the sidebar default is an empty string. | `libs/frontend/core/src/lib/services/vscode.service.ts:8-18`, `:72-86` | The canvas persistence key can distinguish editor panels without a new shared or backend contract. |
| TASK_2026_404 defines a pending v1 canvas record with `columnsPreference` and weighted tile intent and requires validated two-phase hydration. | `.ptah/specs/TASK_2026_404_6fcd/task-description.md:359-397` | Make v2 the only writer, accept v1 as a migration input, and preserve unknown-future bytes. |
| `TileLayout` is a public shape and the canvas guide records an external tribunal consumer. | `libs/frontend/canvas/CLAUDE.md:14-16` | Keep `{ x, y, w, h }` and all current public exports unchanged. |

## Decisions

### Named spans with an explicit legacy/default auto variant

- Chosen approach: use a discriminated `TileWidthIntent`. User actions write named spans; newly seeded tiles use `{ kind: 'auto', weight: 1 }`; migrated weighted tiles use `{ kind: 'auto', weight: oldWeight }`.
- Rationale: named spans make the four requested choices stable and discoverable. Keeping weight only under `auto` preserves current equal-fill behaviour and makes v1 migration lossless without allowing two width fields to disagree. Current width is relative weight (`canvas-layout.service.ts:31-44`, `:184-232`).
- Rejected alternative: replace every weight directly with its nearest named span. It cannot represent existing 5/7 or other apportioned ratios and would violate the no-loss migration requirement.
- Rejected alternative: retain sibling `weight` and `span` fields. It creates two competing authorities and forces every caller to invent precedence rules.

### Snap horizontal resize to a named span

- Chosen approach: on resize stop, snap only the dragged tile's observed Gridstack width to the nearest of 4, 6, 8 or 12 units; ties choose the wider span. Commit one named span under the captured workspace revision, then reconcile the engine from authoritative intent.
- Rationale: the existing gesture transaction already identifies the dragged id and validates its workspace, revision and complete membership (`canvas-workspace-grid.component.ts:311-355`, `:378-446`). Snapping produces the same vocabulary as the menu and makes resize reload-stable.
- Rejected alternative: free-weight resize or a user preference to disable snapping. That preserves the current undiscoverable continuum, adds a second interaction mode and persistence setting, and is not required by the acceptance criteria. Legacy weights remain renderable but no new gesture writes them.

### Replace 1/2/3 caps with presets

- Chosen approach: remove `ColumnsPreference`, `effectiveCapacity`, its store map/accessors, and the numeric dock buttons. The dock offers `Even grid`, `1 + 2`, and `Focus + stack` presets plus lock. Each preset atomically rewrites width/order/row-break intent for the active workspace.
- Rationale: the objective is to replace one workspace-wide cap with per-tile intent. Keeping both would let a hidden cap override an explicit tile choice. The current cap is the sole selected value in the dock (`canvas-layout-controls.component.ts:61-104`, `:157-191`).
- Preset contracts:
  - `Even grid`: preserve order; create logical rows of at most three auto-weight-1 tiles. One/two-tile final rows therefore fill as full/halves.
  - `1 + 2`: preserve order; first tile is `full`; remaining tiles are paired as `half`, with a break before the first tile of each row and a final unpaired tile set to `full`.
  - `Focus + stack`: move the active `CanvasStore.focusedTabId` (or the first tile when none is active) to order zero as `full`; remaining tiles keep relative order and are paired as `half` rows. This is a durable preset, distinct from transient Focus.
- Rejected alternative: retain 1/2/3 alongside presets. It creates unclear precedence and preserves the rigid control the task is replacing.

### Focus is a transient derived overlay

- Chosen approach: keep `focusedTabId` as the existing active-session selection and add a separately named per-workspace `layoutFocusTabId`. While present, packing flushes before that tile, renders it as 12 units on its own row, then resumes packing. It never mutates width, order or row breaks and is not persisted.
- Rationale: the current `focusTile()` also switches the global active tab (`canvas.store.ts:336-345`), so overloading it would expand a tile on every ordinary click. A derived override restores the exact prior placement on exit without a stale backup snapshot.
- Failure behaviour: removing/pruning the focused tile clears `layoutFocusTabId`; switching workspaces exposes that workspace's independent transient focus; invalid ids are treated as no focus. Drag and resize are disabled for the grid while layout focus is active, but the menu's `Exit focus` remains enabled unless the canvas is locked.
- Rejected alternative: write `full` plus a saved previous span/order. It duplicates intent, complicates deletion/workspace changes, and makes crash/reload restoration ambiguous.

### Defer per-tile height tiers

- Chosen approach: retain `TILE_HEIGHT_UNITS = 6` for all tiles.
- Rationale: current horizontal-only resize and height alignment are deliberate inputs to cell-height scrolling (`canvas-layout.service.ts:8-17`, `:139-145`; `canvas-workspace-grid.component.ts:164-168`). Tall tiles introduce vertical collision/packing and are not needed for any acceptance criterion.
- Rejected alternative: add `normal | tall` now. It couples a separate two-dimensional packing problem to the width migration and makes deterministic row ownership materially harder.

## Data model

Move the intent-owned types into `canvas-layout-intent.ts`; `canvas-layout.service.ts` imports them. Do not export new public names from `src/index.ts` in this task.

```ts
export const TILE_SPANS = ['third', 'half', 'two-thirds', 'full'] as const;
export type TileSpan = (typeof TILE_SPANS)[number];

export type TileWidthIntent =
  | { readonly kind: 'span'; readonly span: TileSpan }
  | { readonly kind: 'auto'; readonly weight: number };

export interface TileIntent {
  readonly tabId: string;
  readonly order: number;
  readonly width: TileWidthIntent;
  readonly rowBreakBefore: boolean;
}

export type CanvasLayoutPreset =
  | 'even-grid'
  | 'one-plus-two'
  | 'focus-plus-stack';

export interface PackedTile {
  readonly tabId: string;
  readonly units: number;
}
```

Named span units are exact: `{ third: 4, half: 6, 'two-thirds': 8, full: 12 }`. `auto.weight` must be finite and greater than zero after boundary validation; internal defensive normalization uses `1` so `computeLayout` stays total.

Persistence types in the new internal persistence service are:

```ts
interface CanvasWorkspaceIntentV2 {
  readonly version: 2;
  readonly tiles: readonly TileIntent[];
}

interface CanvasWorkspaceIntentV1 {
  readonly version: 1;
  readonly columnsPreference: 'auto' | 1 | 2 | 3;
  readonly tiles: readonly {
    readonly tabId: string;
    readonly order: number;
    readonly weight: number;
    readonly rowBreakBefore: boolean;
  }[];
}
```

`CanvasLayout`, `PositionedTile`, and public `TileLayout { x, y, w, h }` do not change (`canvas-layout.service.ts:46-60`). `CanvasTile` remains an alias of `TileIntent` (`canvas.store.ts:10-17`).

## Packing algorithm

Put pure span resolution, row packing, preset projection, and drag projection in `canvas-layout-intent.ts`. `CanvasLayoutService.computeLayout(tiles, layoutFocusTabId = null)` reads only measured width/height plus these inputs and remains total and side-effect free, matching its existing contract (`canvas-layout.service.ts:106-120`).

```text
responsiveCapacity = columnsFor(containerWidth)       // 1..3
minimumUnits = ceil(12 / responsiveCapacity)          // 12, 6, or 4

effectiveUnits(width):
  if width.kind == auto: return minimumUnits
  desired = unitsBySpan[width.span]
  return first value in [4, 6, 8, 12] that is >= max(desired, minimumUnits)

pack(tiles, responsiveCapacity, layoutFocusTabId):
  ordered = sort by (order, tabId)
  rows = []
  current = []
  used = 0

  for tile in ordered:
    if tile.tabId == layoutFocusTabId:
      flush(current)
      rows.push([{ tile, units: 12, focused: true }])
      current = []; used = 0
      continue

    units = effectiveUnits(tile.width)
    if tile.rowBreakBefore and current is not empty: flush(current)
    if current is not empty and used + units > 12: flush(current)
    append tile with its minimum/effective units
    used += units
    if used == 12: flush(current)

  flush(current)

  for each non-focus row:
    explicitUnits = sum effective units for kind=span
    autoTiles = row entries with kind=auto
    remaining = 12 - explicitUnits
    if autoTiles exist:
      apportion remaining across their normalized weights using largest remainder,
      with minimumUnits as each auto tile's floor
    // no auto tiles: retain the intentional trailing gap; never stretch a named span

  map each row in order to x cumulative units, y=rowIndex*6, w=units, h=6
```

This gives `two-thirds + third` as `8 + 4`, permits different combinations in later rows, and preserves an explicitly selected lone third as 4 units rather than silently changing the preference. At two-column capacity, a stored third renders as half; at one-column capacity every named span renders full. Stored intent is untouched, so widening restores the original named span. Auto tiles continue to fill their row, preserving today's singleton/short-row behaviour (`canvas-layout.service.ts:122-148`, `canvas-layout.service.spec.ts:122-253`).

Drag projection keeps the existing complete-observation and non-dragged-order validation (`canvas-layout-intent.ts:61-108`) but replaces count-based fullness with units:

```text
group validated observations by equal y after sorting (y, x, tabId)
reject at responsiveCapacity == 1 unless old logical-row blocks remain contiguous
for every observed row boundary at capacity > 1:
  preserve break when the next tile was an explicit old row start and is still a row start
  otherwise compute used units of the preceding observed row without a new break
  if the next tile would fit (used + nextEffectiveUnits <= 12), store a new break
  otherwise store no break because span overflow caused the render-only wrap
reject if non-dragged members of old logical rows become interleaved
return one dense complete TileIntent array, changing only order/rowBreakBefore
```

This is the span-aware form of the current ambiguity rule (`canvas-layout-intent.ts:56-161`) and preserves TASK_2026_404's durable logical rows when a responsive/full row makes the boundary otherwise ambiguous (`.ptah/specs/TASK_2026_404_6fcd/task-description.md:299-331`). Resize projection uses `snapSpan(observedDraggedWidth)` and does not modify neighbours, order, or breaks.

## Persistence and migration

Create a panel-scoped `CanvasLayoutPersistenceService` in the canvas library and add it to `OrchestraCanvasComponent.providers` beside the store/layout services. This is a nameable storage-boundary collaborator; do not put JSON/Zod/event-listener concerns into the already 669-line `CanvasStore` (`canvas.store.ts:1-669`).

- Key: `ptah.canvas-layout.ws.${encodeURIComponent(workspacePath).replace(/%/g, '_')}.${VSCodeService.config().panelId || 'primary'}`. This follows the repository's Unicode-safe workspace encoding and panel partitioning (`tab-workspace-partition.service.ts:463-490`) and uses the verified config signal (`vscode.service.ts:8-18`, `:72-86`).
- Boundary validation: parse JSON as `unknown`, then use Zod 4 schemas for v1 and v2. Require `version`, at most `CanvasStore.MAX_TILES` tiles, unique non-empty tab ids, non-negative integer order (normalize densely after sorting), boolean breaks, valid discriminants/spans, and finite weights in `(0, 12]`. Duplicate ids invalidate the record. Zod is already pinned at the repository boundary dependency (`package.json:194`).
- Hydration: replace `restoreCanvasTilesFromTabs()` with one workspace-addressed `CanvasStore.hydrateWorkspace(path, authoritativeTabIds)` transaction. Read/validate/migrate first; reconcile persisted ids against exact restored tab ids with `retainTilesInLogicalRows`; append new authoritative ids as auto weight 1; publish once; only then mark that partition writable. Never call `openSessionTab`, `switchSession`, or a session-load path during canvas hydration. The current loop can recreate session tabs by calling `addTileFromSession` (`orchestra-canvas.component.ts:376-399`; `canvas.store.ts:152-171`), so it is replaced in place.
- Save: after hydration, store mutations schedule a short debounced v2 write; skip byte-equivalent snapshots. Flush synchronously on `pagehide`, `beforeunload`, `visibilitychange` to hidden, and service destruction. Storage failures warn and retain in-memory state; they do not reject the user action. This follows the pending lifecycle contract in TASK_2026_404 (`task-description.md:376-405`).
- Unknown future version: render reconciled default auto intent from authoritative tabs, preserve the original bytes, and disable writes for that partition so an older client cannot downgrade it.
- Implicit workspace `''`: retain the current in-memory migration to the first real path (`canvas.store.ts:40-46`, `:363-402`) but never persist the sentinel. Hydration of the first real path merges valid implicit ids only after authoritative reconciliation.
- Workspace removal: `removeWorkspaceTileState` also deletes this panel's canvas key only for an acknowledged removed workspace; it already clears all in-memory workspace maps (`canvas.store.ts:470-503`).

V1 to v2 migration is pure and lossless:

1. Build old logical rows from `rowBreakBefore` and sorted order.
2. For each old logical row, chunk at `legacyMaximum`, where `auto -> 3` and numeric values stay 1/2/3. Add a durable break before every chunk after the first. This replaces the removed cap with equivalent row boundaries at the maximum supported width; narrower widths still wrap render-only.
3. Convert every `weight` to `width: { kind: 'auto', weight }`; keep tab id and relative order. Auto apportionment preserves the exact old weight ratios and fills short rows.
4. Normalize dense order and force the first tile's break false; write only v2 thereafter.

There is no current on-disk canvas record on this branch: current canvas state is signal-only (`canvas.store.ts:75-149`) and only tab state is restored (`orchestra-canvas.component.ts:376-399`). The v1 reader is required to interoperate with TASK_2026_404's specified record if R4b lands first (`task-description.md:368-374`), not evidence of an already-shipped schema.

## UI changes per component

### `CanvasTileComponent`: tile header menu

- Add inputs `widthIntent`, `layoutFocused`, and `layoutLocked`; add outputs `spanRequested`, `layoutFocusToggled`, and `rowBreakToggled`. Keep the component presentational and keep store mutation in the workspace grid.
- Add a `NativePopoverComponent` ellipsis trigger before view-mode/close. Stop propagation on trigger/content so menu use does not focus or drag the tile. The popover contains four span radio actions, `Focus`/`Exit focus`, and `Start new row`/`Join previous row`.
- Named span actions show the stored preference, not responsive effective width, so a third still reads “1/3” while temporarily rendered as half/full.
- Disable all layout mutation actions when locked. Keep `Exit focus` disabled under lock as well: lock means no layout intent or projection changes, matching the current no-write contract (`orchestra-canvas.component.ts:421-431`).
- Verification seam: component output/DOM tests; no Gridstack mock required.

### `CanvasLayoutControlsComponent`: preset dock

- Replace the numeric imports/buttons/selected-cap computed and `select()` with the three named preset actions. Disable preset actions while locked or singleton, with handler-level guards as today (`canvas-layout-controls.component.ts:147-196`).
- Emit a `presetRequested` output rather than injecting and mutating the store from this presentational control; `OrchestraCanvasComponent` calls `canvasStore.applyPreset(...)`.
- Keep the existing lock output and popover placement/closing behaviour.

### `CanvasWorkspaceGridComponent`: projection and gesture ownership

- Pass each tile's `width`, workspace layout-focus state, and lock state to `CanvasTileComponent`; route tile outputs to workspace-addressed store methods.
- Replace `capacity` with `responsiveCapacity = columnsFor(containerWidth)`; remove all preference reads. Include responsive capacity and layout-focus id in the gesture snapshot/invalidation checks.
- If layout focus is active, disable move/resize for all engine nodes. Otherwise retain singleton/lock behaviour. Do not use `grid.setStatic` for focus, because lock remains the only canvas-wide static mode.
- Resize stop reads only the dragged node width, snaps it, and calls `commitResizeSpan(workspacePath, revision, draggedId, span)`. Drag stop calls the span-aware projector. Preserve full node validation, synchronous `_applyingLayout`, changed-node diffing, batched updates and forced reconciliation (`canvas-workspace-grid.component.ts:357-551`).
- Verification seam: the existing faithful Gridstack component spec, expanded for span commits and focus interaction suppression.

### `OrchestraCanvasComponent`: hydration, presets and lifecycle

- Provide the new persistence service; replace eager session-based restoration with authoritative workspace hydration; pass preset output to the store.
- Keep session viewport measurement and per-workspace keep-alive unchanged (`orchestra-canvas.component.ts:145-167`, `:275-281`, `:333-373`).
- Remove unconditional `forceCloseTab` teardown. Ordinary component disposal must flush layout and destroy the view, not close persisted sessions; the current behaviour force-closes every retained tab (`orchestra-canvas.component.ts:434-449`) and conflicts with reload survival and TASK_2026_404's settled lifecycle (`task-description.md:399-405`). Explicit `removeTile()` remains the one-tile close path (`canvas.store.ts:218-227`).

### `CanvasStore`: intent facade

- Replace the columns-preference map/API with per-workspace `layoutFocusTabId` and hydration/writeability state delegated to persistence.
- Add guarded methods: `setTileSpan`, `toggleRowBreak`, `toggleLayoutFocus`, `applyPreset`, `hydrateWorkspace`, and workspace/revision-addressed `commitResizeSpan`. Every semantic mutation bumps the existing workspace revision and schedules persistence only after hydration.
- Update `sameIntent`, append/seeding, implicit migration, row-preserving removal and cross-workspace removal for the discriminated width and layout-focus cleanup. Retain store name, scope, tile cap and existing membership/focus APIs.
- Failure behaviour: invalid/unknown ids and stale revisions are no-ops/false; the first ordered tile can never retain `rowBreakBefore: true`; focus ids must belong to the target partition.

## Keyboard and a11y

- The tile-menu trigger is a real `button` with `aria-label="Layout options for <tile label>"`, `aria-haspopup="menu"`, and `aria-expanded`. `NativePopoverComponent` provides Escape close and focus restoration (`native-popover.component.ts:166-213`, `:224-234`).
- On open, focus the checked span item. Span choices use `role="menuitemradio"` plus `aria-checked`; Focus and row actions use `role="menuitem"`. Enter/Space activate the native buttons. Up/Down cycle through enabled items; Home/End jump first/last. Selection closes the menu and restores focus to the trigger.
- Labels are explicit: “Set tile width to one third”, “Set tile width to one half”, “Set tile width to two thirds”, “Set tile width to full”, “Focus tile at full width”/“Exit tile focus”, and “Start a new row before this tile”/“Join the previous row”. Do not rely on icons or fractions alone.
- Disabled lock state is exposed with native `disabled`; it is also enforced in handlers/store so programmatic calls cannot bypass lock. The existing lock button keeps `aria-pressed` and its dynamic label (`canvas-layout-controls.component.ts:109-127`).
- Preset buttons use full accessible names and explain that they change all tile widths. After a preset action, focus returns to the dock trigger through the existing popover behaviour.

## Files to change

| Action | Absolute path | Change | Estimated size |
| --- | --- | --- | --- |
| MODIFY | `libs/frontend/canvas/src/lib/canvas-layout-intent.ts` | Own width/span types; responsive unit resolution; deterministic packer; preset projection; span-aware drag projector; resize snap helper. | +140/-70 lines |
| MODIFY | `libs/frontend/canvas/src/lib/canvas-layout-intent.spec.ts` | Packing helpers, fallback, presets and drag projection cases. | +180/-20 lines |
| REWRITE | `libs/frontend/canvas/src/lib/canvas-layout.service.ts` | Consume packed rows; remove columns preference and general row-weight apportionment; keep measurement/cell-height/public geometry contracts. | net -20 to +20 lines |
| MODIFY | `libs/frontend/canvas/src/lib/canvas-layout.service.spec.ts` | Mixed spans, auto fill, focus and responsive restoration. | +120/-100 lines |
| CREATE | `libs/frontend/canvas/src/lib/canvas-layout-persistence.service.ts` | Zod v1/v2 boundary, keying, hydration result, migration, debounced save and lifecycle flush. | 220-280 lines |
| CREATE | `libs/frontend/canvas/src/lib/canvas-layout-persistence.service.spec.ts` | Boundary, migration, future-version and flush tests. | 220-280 lines |
| MODIFY | `libs/frontend/canvas/src/lib/canvas.store.ts` | Width mutations, transient layout focus, presets, hydration and persistence delegation; delete column-preference state. | +110/-70 lines; keep facade cohesive near soft cap |
| MODIFY | `libs/frontend/canvas/src/lib/canvas.store.spec.ts` | Span/focus/preset, hydration and workspace persistence scheduling. | +180/-80 lines |
| MODIFY | `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts` | Pass tile layout inputs/actions; span-aware gesture snapshot; snapped resize commit; focus interaction state. | +70/-45 lines |
| MODIFY | `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts` | Drag/resize projection, fallback and focus interaction tests. | +170/-80 lines |
| MODIFY | `libs/frontend/canvas/src/lib/canvas-tile.component.ts` | Accessible per-tile layout popover and typed outputs. | +130 lines |
| MODIFY | `libs/frontend/canvas/src/lib/canvas-tile.component.spec.ts` | Menu keyboard, ARIA, outputs, lock and propagation tests. | +160 lines |
| MODIFY | `libs/frontend/canvas/src/lib/canvas-layout-controls.component.ts` | Replace numeric caps with named preset buttons/output; retain lock. | +35/-55 lines |
| MODIFY | `libs/frontend/canvas/src/lib/canvas-layout-controls.component.spec.ts` | Preset labels/emissions/lock guards. | +50/-80 lines |
| MODIFY | `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts` | Scoped persistence provider, authoritative hydration, preset routing, non-destructive teardown. | +35/-35 lines |
| MODIFY | `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts` | Hydration/no-duplicate-session and teardown-flush coverage; preset routing. | +100/-40 lines |
| MODIFY | `libs/frontend/canvas/CLAUDE.md` | Replace documented cap/weight model with width union, packer, focus and persistence ownership. | +20/-15 lines |

No change to `libs/frontend/canvas/src/index.ts`, `libs/shared`, any RPC type, or backend code. The persistence service is internal and the existing public export surface stays intact (`libs/frontend/canvas/src/index.ts:1-10`).

## Test plan

### `canvas-layout-intent.spec.ts`

- `packs two-thirds plus third into one row and preserves mixed later rows`.
- `leaves a deliberate gap when named spans do not fill a row`.
- `auto tiles consume remaining row width by weight and preserve legacy 5/7`.
- `promotes third to half at capacity two and every span to full at capacity one without mutating input`.
- `focus flushes before and after the target while leaving intent byte-identical on exit`.
- `preset even-grid, one-plus-two and focus-plus-stack produce exact dense order, widths and breaks`.
- `snapSpan maps 4/6/8/12 exactly and chooses wider on a tie`.
- `span-aware drag creates a break only when the observed boundary was not forced by overflow`.
- `drag preserves an old explicit boundary after a naturally full row and rejects capacity-one interleaving`.
- Retain current deletion/invalid-observation cases (`canvas-layout-intent.spec.ts:24-196`).

### `canvas-layout.service.spec.ts`

- `derives 8+4, 6+6, 4+4+4 and full rows from named spans`.
- `different logical rows use independent span combinations`.
- `narrow fallback restores original geometry after width widens`.
- `auto final rows still fill 12 units`.
- `layout focus is a full-width in-order row and exit restores exact prior layout`.
- `degenerate width/height/weights remain total`; keep cell-height and measurement tests (`canvas-layout.service.spec.ts:285-354`).

### `canvas-layout-persistence.service.spec.ts`

- `v2 round-trip preserves order, breaks and width discriminants per workspace/panel`.
- `migrates v1 auto/1/2/3 caps into equivalent durable row breaks`.
- `migrates arbitrary valid weights without rounding or session loss`.
- `rejects duplicate ids, invalid spans, invalid weights, geometry fields and over-cap records`.
- `unknown future version preserves bytes and disables writes`.
- `initial empty/unhydrated state never overwrites storage`.
- `debounces equivalent writes and flushes on pagehide, hidden visibility and destroy`.
- `storage exceptions retain in-memory operation and emit one bounded warning path`.

### `canvas.store.spec.ts`

- `setTileSpan changes only target width and revision`.
- `layout focus is workspace scoped, transient and cleared on removal`.
- `focus enter/exit never changes order/span/breaks`.
- `commitResizeSpan rejects stale revision, wrong workspace/id and invalid span atomically`.
- `hydrate reconciles authoritative ids once before enabling writes`.
- `workspace switch/reload restores v2 intent and migration restores v1 equivalent rows`.
- `each preset is one revision/persistence mutation`.
- Keep current partition, LRU, row-transfer and cross-workspace removal cases (`canvas.store.spec.ts:83-436`).

### `canvas-workspace-grid.component.spec.ts`

- `resize snaps dragged width and never rewrites neighbours/order/breaks`.
- `drag projects row boundaries by used span units, not tile count`.
- `responsive fallback performs zero store writes and restores on widen`.
- `layout focus disables engine move/resize and exit reapplies authoritative geometry`.
- `lock rejects menu-routed span/focus/break calls as well as gestures`.
- Retain stale/hide/capacity cancellation, feedback-loop and single-writer assertions (`canvas-workspace-grid.component.spec.ts:386-917`).

### Component specs

- `canvas-tile.component.spec.ts`: trigger/menu ARIA, four radio choices, focus/row actions, Enter/Space and arrow/Home/End navigation, Escape/focus return, lock-disabled actions, event propagation.
- `canvas-layout-controls.component.spec.ts`: three preset actions replace numeric buttons, exact output values, singleton/lock disablement, lock remains operable (`canvas-layout-controls.component.spec.ts:67-243`).
- `orchestra-canvas.component.spec.ts`: exact-tab-id hydration does not call session open/load; preset output routes once; destruction flushes but never closes tabs; retained-workspace visibility still holds (`orchestra-canvas.component.spec.ts:234-703`).

Repository verification commands:

```text
npx nx test @ptah-extension/canvas
npx nx lint @ptah-extension/canvas
npx nx typecheck @ptah-extension/canvas
npx nx run-many -t test -p @ptah-extension/canvas @ptah-extension/tribunal-panel
```

The tribunal test is the broader contract check because it consumes `TileLayout`; that public shape remains unchanged (`libs/frontend/canvas/CLAUDE.md:14-16`). Confirm Nx reports both projects in the final `run-many` command, per the root command warning (`CLAUDE.md:133-147`).

## Risks and conflicts with TASK_2026_387 / TASK_2026_404_6fcd

- TASK_2026_387 overlap: this task directly rewrites the intent, layout and Gridstack projection that TASK_2026_387 introduced. Preserve its one geometry writer, synchronous `_applyingLayout` guard, complete engine-node validation, workspace revision transaction, row-preserving deletion and public `TileLayout` contract. Those are current source, not optional draft ideas (`canvas-workspace-grid.component.ts:233-245`, `:357-551`; `canvas-layout-intent.ts:25-45`).
- TASK_2026_387 conflict: its relative `weight` is replaced as the normal resize output, but retained inside `auto` solely for defaults/migration. Do not leave `setTileWeights`/`commitResizeWeights` beside the new span methods; replace and delete them (`canvas.store.ts:288-334`).
- TASK_2026_404 overlap: R4a row intent and gesture safety are already present on this branch (`canvas-layout-intent.ts:1-162`; `canvas-workspace-grid.component.ts:243-491`). Build on them rather than reimplementing a parallel projector.
- TASK_2026_404 conflict: its accepted Auto/1/2/3 cap and v1 weighted schema (`task-description.md:225-241`, `:368-374`, `:407-408`) are superseded by this task's product requirement. Coordinate ordering so TASK_2026_442 either lands before R4b and writes v2 directly, or lands after R4b and migrates its v1. Never keep both persistence services or both cap/span controls.
- TASK_2026_404 compatibility: keep its two-phase hydration, unknown-future protection, per-workspace/per-panel keying, lifecycle flush, and non-destructive canvas disposal (`task-description.md:376-405`). These serve the reload requirement independently of the old width model.
- File-size risk: `canvas.store.ts` is already 669 lines. Storage parsing/listeners belong in the new persistence collaborator; do not fragment pure span helpers further unless the implementation genuinely pushes a production file well beyond the 700-line soft ceiling (`CLAUDE.md:161-169`).
- Packing ambiguity risk: variable spans make “row shorter than capacity” invalid. All drag decisions must use effective units and preserve an aligned old explicit boundary; count-based logic will erase durable rows after widening.
- Focus naming risk: `focusedTabId` already means active chat selection (`canvas.store.ts:109-114`, `:336-345`). Use `layoutFocusTabId` consistently so clicking a tile does not unexpectedly resize it.
- Persistence boundary risk: localStorage is mutable external input. Zod validation must precede all casts/normalization; an unknown future record must not be overwritten.

## Architecture-level quality requirements

- Functional: every named span maps deterministically to 4/6/8/12 units at full capacity; responsive promotion never renders a tile narrower than `MIN_TILE_WIDTH`; focus exit reproduces the pre-focus layout from unchanged intent; v1 and v2 hydration preserve authoritative tab ids and order.
- Performance: packing, migration and reconciliation are O(n log n) only because of order sorting and otherwise O(n); n remains bounded by the existing tile cap. One semantic mutation schedules at most one debounced storage write and one derived geometry pass.
- Security: parse localStorage as unknown through strict Zod schemas; reject duplicate ids and unrecognized keys/versions as specified; do not bind HTML or add a new sanitizer.
- Maintainability: one geometry authority, one persistence collaborator, no shared/backend imports, no duplicate legacy cap path, and no change to public `TileLayout`.
- Testability: pure packing/migration tests cover all width combinations and fallbacks; component tests cover accessible actions; Gridstack tests prove projection/reconciliation without treating engine geometry as persisted truth.

## Team-leader handoff

- Recommended executors: `frontend-developer` for all components because the change is confined to the Angular canvas feature, its pure TypeScript layout code, and browser-local persistence.
- Complexity: HIGH. The model replacement crosses packing, gesture projection, hydration/migration and accessible UI while preserving a single geometry writer.
- Dependencies and ordering: pure types/packer and persistence schema are foundational; store consumes both; grid/tile/dock consume the store contracts; orchestra wires hydration/lifecycle. TASK_2026_404 R4b must be sequenced as a replacement/supersession, not a parallel implementation.
- Parallel-safe work: persistence service/spec is file-disjoint from tile menu/spec after width types are settled. Layout intent/service and store/grid are contract-coupled and should not be implemented concurrently without an agreed type patch.
- Files affected: exactly the 17 files listed under “Files to change”; CREATE 2, REWRITE 1, MODIFY 14. No shared, backend, RPC, public barrel or project configuration change.
- Verification points: open and preserve `TileLayout`, `_applyingLayout`, complete gesture validation, workspace revisions, scoped providers, `NativePopoverComponent` focus behaviour and panel-id config at the cited lines; run the four commands under “Test plan”.

## Out of scope

- Per-tile normal/tall height, vertical resize, masonry or any other two-dimensional packing.
- Free-weight resize for new interactions, a snap-disable preference, arbitrary pixel widths, or persisted Gridstack geometry.
- Raising `MAX_TILES`, compact/folded/chip levels of detail, zoom, notification center or concurrency changes from TASK_2026_404.
- Persisting transient layout focus, selected/active chat focus, lock state, rendered fallback spans, or concrete row coordinates.
- Changes to `TileLayout`, canvas public exports, shared contracts, RPC handlers, backend storage or host composition roots.
