# Verdict

**Not covered.** TASK_2026_442 makes horizontal layout fluid through per-tile width intent, named spans, presets, responsive promotion, and persistence, but compact view is not an input to that system. The task deliberately keeps every tile six Gridstack height units and explicitly puts per-tile heights, masonry, and compact/folded/chip levels of detail out of scope (`.ptah/specs/TASK_2026_442_68ba/implementation-plan.md:70-74`, `:386-391`). Its originating context even identifies equal tile height as a problem while making height tiers optional rather than an acceptance criterion (`.ptah/specs/TASK_2026_442_68ba/context.md:37-38`, `:52-55`, `:72-85`).

The branch therefore covers a user manually choosing a smaller **width span**, but it does not connect the existing **Switch to compact view** action to width, height, packing, or persisted canvas intent. Compact mode changes only which chat subtree is rendered inside an unchanged Gridstack item.

# Data path

The compact-mode path is:

1. `CanvasTileComponent.onToggleViewMode()` calls `TabManagerService.toggleTabViewMode(tabId)` (`libs/frontend/canvas/src/lib/canvas-tile.component.ts:406-413`).
2. `TabManagerService` changes only the requested tab's `viewMode` field; its getter reads that same field and defaults to `full` (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:2536-2552`).
3. The tile-local `ChatViewComponent` finds the scoped tab and reads `tab.viewMode` in `resolvedViewMode` (`libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:577-599`).
4. The chat template swaps the full chat subtree for `<ptah-compact-session-card>` (`libs/frontend/chat/src/lib/components/templates/chat-view.component.html:1-15`).

That path ends inside the tile. There is no compact-mode output from `CanvasTileComponent`, no store mutation, and no layout input carrying view mode.

The independent canvas geometry path is:

1. Stored `TileIntent` contains only `tabId`, `order`, `width`, and `rowBreakBefore` (`libs/frontend/canvas/src/lib/canvas-layout-intent.ts:20-42`). `CanvasTile` is exactly that type (`libs/frontend/canvas/src/lib/canvas.store.ts:25-32`).
2. `CanvasWorkspaceGridComponent.items()` passes only width/row/focus/lock layout state into each tile, while its `layout` computed calls `computeLayout(this.tiles(), layoutFocusTabId)` (`libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:99-116`, `:183-208`). Neither computed reads `TabManagerService` or view mode.
3. `packRows()` resolves only width intent, responsive capacity, row breaks, and transient layout focus (`libs/frontend/canvas/src/lib/canvas-layout-intent.ts:178-219`).
4. `computeLayout()` maps every packed tile to its span width and the same `h: 6`; row origins are always multiples of six (`libs/frontend/canvas/src/lib/canvas-layout.service.ts:89-123`).
5. The sole Gridstack writer diffs and applies the resulting `x/y/w/h` through `grid.update()` (`libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:548-605`). Since compact mode invalidates none of the layout inputs, it causes no geometry update and hence no neighbour reflow.
6. Canvas v2 persistence accepts and writes only `tabId`, `order`, `width`, and `rowBreakBefore` (`libs/frontend/canvas/src/lib/canvas-layout-persistence.service.ts:23-40`, `:265-283`). It contains neither view mode nor height intent. View mode exists on `TabState` (`libs/frontend/chat-types/src/lib/chat-types.ts:635-639`), but it is not projected into canvas persistence or geometry.

Thus compact mode feeds the chat renderer, but feeds none of layout intent, span selection, height units, Gridstack `w/h`, `computeLayout`, or canvas persistence.

# Root causes

1. **The fluid-layout task intentionally excluded this case.** The implementation plan says height remains unchanged, retains `TILE_HEIGHT_UNITS = 6`, and defers `normal | tall` because it introduces two-dimensional packing (`.ptah/specs/TASK_2026_442_68ba/implementation-plan.md:25`, `:70-74`). Its out-of-scope list explicitly names per-tile height, masonry, and compact/folded/chip detail levels (`.ptah/specs/TASK_2026_442_68ba/implementation-plan.md:386-391`). The post-implementation style review also calls compact chips a future feature whose vertical constraints must be resolved in `canvas-layout-intent.ts` (`.ptah/specs/TASK_2026_442_68ba/code-style-review.md:140-145`).

2. **Compact mode and canvas layout are disconnected state graphs.** The toggle only updates `TabState.viewMode` (`libs/frontend/canvas/src/lib/canvas-tile.component.ts:373-376`, `:406-413`; `libs/frontend/chat-state/src/lib/tab-manager.service.ts:2540-2552`). The canvas's authoritative type has no view-mode or height member (`libs/frontend/canvas/src/lib/canvas-layout-intent.ts:32-42`), and the grid's layout computed consumes only `tiles()` plus `layoutFocusTabId()` (`libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:194-208`). Therefore the toggle cannot change either `w` or `h` and cannot trigger a geometry projection.

3. **Every projected tile is forced to the same near-viewport height.** `TILE_HEIGHT_UNITS` is a constant `6`; every tile gets `h: 6`, and each row starts at `rowIndex * 6` (`libs/frontend/canvas/src/lib/canvas-layout.service.ts:4-12`, `:103-116`). `cellHeightFor()` then enforces a tile-height floor of 90% of the measured viewport, even when several rows make the grid scroll (`libs/frontend/canvas/src/lib/canvas-layout.service.ts:135-149`). This is why changing the content subtree cannot shrink the outer item.

4. **Vertical geometry cannot currently become intent.** Gridstack exposes only east/west resize handles, with the source comment stating that rows must remain height-aligned and there is no height field to write (`libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:167-181`). The resize commit reads only node width and writes a snapped named span (`libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:451-476`). This is appropriate for TASK_2026_442, but proves that compact height has no ingress through gestures either.

5. **The compact content is stretched to the Gridstack box, not intrinsically sized.** The canvas shell is `h-full`; the chat host and root are `height: 100%`/`h-full`; the compact wrapper and card are `flex-1 min-h-0`; and the compact card host plus its inner div are both `h-full` (`libs/frontend/canvas/src/lib/canvas-tile.component.ts:89-102`, `:225-233`; `libs/frontend/chat/src/lib/components/templates/chat-view.component.css:1-4`; `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:1-14`; `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:56-65`). The activity component is also `flex-1 min-h-0` with an `overflow-y-auto` feed (`libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:87-102`; `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts:115-142`, `:194-198`). Even the card's local Collapse action merely removes the middle zones; its outer `h-full` remains (`libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:76-107`, `:109-135`). Content height therefore cannot influence Gridstack height.

6. **Singleton CSS is an additional hard override.** When only one tile exists, the workspace grid forces the Gridstack item to `width: 100%` and `height: 100%` with `!important` (`libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:132-141`). A future compact projection would still appear full-size in the singleton case unless this rule were made mode-aware or removed.

# Proposed fix

The smallest correct fix is a **derived compact layout constraint**, not DOM measurement and not a Gridstack-event special case:

1. Add a small, explicit presentation constraint to the pure layout inputs, for example `TileLayoutConstraint { view: 'full' | 'compact' }`, keyed by `tabId`. Derive it reactively from `TabManagerService.tabs()` for the mounted workspace. Keep the existing persisted `TileIntent` unchanged so `TabState.viewMode` remains the single authority and canvas v2 does not duplicate it.
2. In `canvas-layout-intent.ts`, define the compact width and height tiers in Gridstack units and resolve them together with responsive capacity. Compact width should project to the smallest allowed span at the current capacity (4 units when three tiles fit, promoted to 6 or 12 at narrower capacities); full mode continues to use the stored width intent. A fixed compact height tier should replace content measurement. Returning to full mode then restores the original stored width automatically, just as transient layout focus restores stored intent today.
3. Replace the width-only `packRows()` projection with a deterministic pure placement function that returns `x/y/w/h` (or packed rows plus per-tile height). If the requirement includes filling space below short compact tiles, it must use a bounded 12-column occupancy/skyline placement rather than `rowIndex * 6`; merely changing `h` while retaining uniform row origins leaves vertical holes. All collision rules, responsive promotion, layout-focus behavior, and compact/full restoration belong in this pure function in `canvas-layout-intent.ts`.
4. Let `CanvasLayoutService.computeLayout()` consume that result and calculate `cellHeight` from the resulting maximum grid extent and the distinct full/compact height floors. Remove the unconditional `MIN_TILE_VIEWPORT_RATIO` floor for compact tiles while retaining it for full tiles (`libs/frontend/canvas/src/lib/canvas-layout.service.ts:135-149`).
5. Keep `CanvasWorkspaceGridComponent` as a mechanical writer: its existing reactive effect should see the view-constraint signal change and apply the derived `x/y/w/h` through the current diff/batch path (`libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:267-275`, `:556-605`). Do not add compact logic to `onGridChange`, drag-stop, or resize-stop. Make the singleton `100%` CSS conditional on a full-view singleton, or remove the geometry override and freeze only interaction (`libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:132-145`, `:608-619`).
6. Keep the compact subtree filling its **new smaller grid box**; removing `h-full` alone would leave a large empty Gridstack item and still prevent reflow. If the intended compact design also requires no internal scrollbar, separately bound/reduce its activity content rather than using intrinsic DOM height; the present feed explicitly scrolls (`libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts:194-198`).

Required tests:

- `libs/frontend/canvas/src/lib/canvas-layout-intent.spec.ts`: full/compact constraint resolution, responsive promotion, mixed-height collision-free packing, deterministic hole filling, and byte-identical restoration of stored width when returning to full.
- `libs/frontend/canvas/src/lib/canvas-layout.service.spec.ts`: exact compact `w/h`, full-tile height floor versus compact height, mixed layouts, and compact/full restoration.
- `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts`: a reactive view-mode change causes the expected `grid.update()` calls and neighbour reflow without any store write or gesture callback; include singleton compact behavior.
- `libs/frontend/canvas/src/lib/canvas-tile.component.spec.ts`: the mode button calls `toggleTabViewMode(tabId)` and exposes the correct full/compact accessible title.
- `libs/frontend/canvas/src/lib/canvas.store.spec.ts`: only if the store owns the TabState-to-layout-constraint adapter; prove it is derived and not scheduled for canvas persistence.
- `libs/frontend/canvas/src/lib/canvas-layout-persistence.service.spec.ts`: retain a boundary assertion that view mode/height/concrete geometry are not accepted in the canvas v2 record if the persisted schema remains unchanged.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts` and a new `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.spec.ts`: prove the scoped tab selects the compact subtree and, if adopted, that the compact presentation is bounded/non-scrolling.
- The existing Electron canvas E2E spec should toggle a real tile and assert its Gridstack `w/h` plus a neighbour's changed `x/y`; unit tests alone cannot prove the browser/CSS/engine interaction.

# Test coverage gaps

There is **no existing test for compact-mode tile sizing or reflow**.

The only direct view-mode tests exercise `TabManagerService` state toggling/defaults, not geometry (`libs/frontend/chat-state/src/lib/tab-manager.lifecycle.spec.ts:384-392`; `libs/frontend/chat-state/src/lib/tab-manager.intent-mutators.spec.ts:968-975`). `canvas-tile.component.spec.ts` supplies `getTabViewMode` and `toggleTabViewMode` mocks but has no assertion for the mode button or any resulting size (`libs/frontend/canvas/src/lib/canvas-tile.component.spec.ts:434-443`, `:486-556`). `chat-view.component.spec.ts` also provides a toggle mock but has no compact-rendering or size assertion (`libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts:227-233`). There are no spec files under either compact-session component directory.

Current canvas layout tests instead lock in the uniform-height behavior: named-span cases expect every tile to have `h: 6`, and the height-floor case expects every wrapped tile to remain at least 90% of the viewport (`libs/frontend/canvas/src/lib/canvas-layout.service.spec.ts:55-70`, `:104-108`). Those tests cover TASK_2026_442's intended width projection, not compact sizing.
