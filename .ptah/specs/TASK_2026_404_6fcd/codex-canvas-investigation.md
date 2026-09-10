# Orchestra Canvas Technical Investigation

Branch verified: `fix/task-401-agent-status-durability` on 2026-09-09. This is a static code investigation, not a runtime profile. Counts labeled **measured** follow directly from constants/templates; costs labeled **inference** need browser profiling. No product code was changed.

## Decision summary

- The current nine-tile experience is defensible, but the principal retained-memory cost is larger than nine tiles: the app shell always mounts the canvas and single-chat surfaces, while the canvas retains up to four workspace grids. At the configured caps that is up to **36 full tile `ChatViewComponent` trees**, plus the main `ChatViewComponent`, whose own LRU can retain up to eight transcript trees. The resulting static ceiling is **37 chat surfaces and 44 transcript component trees** before considering tribunal/pop-out surfaces.
- The current branch preserves the previously documented mitigations: retained canvas workspaces are capped at four; hidden tiles deregister from visible streaming flushes and freeze their transcript view-model; transcript messages are windowed with persistent lightweight slots, a 2,000 px observer margin, and a six-message always-mounted tail. These reduce update/layout work, but do not detach full hidden tile subtrees.
- Add zoom with a small **viewport/world CSS transform layer**, not by redefining Gridstack cells and not by replacing Gridstack. Gridstack 12.6.0 explicitly measures ancestor transforms and compensates drag and resize coordinates. The implementation still needs a browser proof for nested scrolling and embedded editors, scroll/world-bound compensation and transformed hit testing.
- Do not raise `MAX_TILES` directly to 25 or 50. Geometry computation itself is cheap; full chat surfaces, session state, observers, effects, streaming/RPC work, and Gridstack's per-node collision path dominate. Add lightweight/off-screen tile modes and pages or clusters first.

## Constraints that any design must preserve

- Angular 21, standalone components, `ChangeDetectionStrategy.OnPush`, signals, `inject()`, and zoneless-safe behavior are mandatory.
- Geometry is derived, never stored. `CanvasTile` remains intent only: `{ tabId, order, weight }`. Do not reintroduce `x/y/w/h` into it (`canvas.store.ts:6-13`; `canvas-layout.service.ts:29-38`).
- Only `CanvasWorkspaceGridComponent` may call Gridstack APIs. `CanvasLayoutService` must remain independent of Gridstack.
- Public `TileLayout` remains exactly `{ x, y, w, h }` (`canvas-layout.service.ts:40-45`). `libs/frontend/tribunal-panel/src/lib/types/tribunal-ui.types.ts:2,87` and `services/tribunal-state.service.ts:19,273,490` consume it; changing the shape is a cross-library break.
- Frontend libraries must not import backend libraries.

## Evidence table

| Finding | Current file:line evidence | Status |
|---|---|---|
| Store intent contains only tab/order/weight | `canvas-layout.service.ts:29-38`; `canvas.store.ts:6-13` | Verified |
| Nine tiles per workspace | `canvas.store.ts:62-69,131,155,172,319` | Verified |
| Four workspace grids retained | `canvas.store.ts:25-32,79-88,441-474` | Verified |
| Tile intent survives workspace-grid eviction | `canvas.store.ts:276-330,465-470` | Verified |
| Parent mounts every retained grid and CSS-hides inactive ones | `orchestra-canvas.component.ts:67-79`; `canvas-workspace-grid.component.ts:47-55` | Verified |
| Every mounted tile creates a child injector and full dynamic chat view | `canvas-tile.component.ts:106-114,203-215,235-246` | Verified |
| Hidden tile chat views are not destroyed | `canvas-workspace-grid.component.ts:64-75`; `canvas-tile.component.ts:249-252` | Verified by template/lifecycle |
| App shell keeps grid and single layouts mounted | `chat/src/lib/components/templates/app-shell.component.html:681-712` | Verified |
| Main chat retains up to eight transcript trees | `chat/src/lib/services/transcript-retention.service.ts:14-18,102-130`; `chat-view.component.ts:497-525` | Verified |
| Tile chat renders exactly one transcript | `chat-view.component.ts:503-525` | Verified |
| Hidden tile transcript freezes | `canvas-tile.component.ts:128-134,185-200`; `chat-view.component.ts:527-543` | Verified |
| Transcript bubbles are windowed, wrappers remain | `chat-transcript.component.html:7-30`; `transcript-render-window.ts:4-24,113-139`; `chat-transcript.component.css:35-61` | Verified |
| ResizeObserver coalesces to the latest RAF | `canvas-layout.service.ts:72-86` | Verified |
| Layout sorts and walks all tiles | `canvas-layout.service.ts:105-142` | Verified; O(n log n) due to sort |
| Active projection calls `grid.update()` once per engine node inside a batch | `canvas-workspace-grid.component.ts:162-197` | Verified |
| Angular item options setter independently calls `grid.update()` | `canvas-workspace-grid.component.ts:64-65,130-145`; `node_modules/gridstack/dist/angular/src/gridstack-item.component.ts:89-97` | Verified |
| Grid options setter calls `updateOptions()` after init | `canvas-workspace-grid.component.ts:58-60`; `node_modules/gridstack/dist/angular/src/gridstack.component.ts:112-118` | Verified; current `gsOptions` identity is stable |
| Gridstack update enters move/collision logic when geometry differs | `node_modules/gridstack/dist/gridstack.js:1416-1433,1463-1477`; `gridstack-engine.js:936-999` | Verified |
| Collision resolution sorts and scans nodes recursively | `gridstack-engine.js:70-114,964-998` | Verified |
| Gridstack 12.6.0 detects transform scale | `node_modules/gridstack/package.json`; `utils.js:713-738` | Verified installed version/source |
| Drag and resize use transform compensation | `gridstack.js:2667-2685`; `dd-draggable.js:195-218`; `dd-resizable.js:199-208` | Verified |
| Visible tile set controls RAF streaming flushes | `chat-state/src/lib/tab-manager.service.ts:159-165,2353-2372`; `chat-streaming/src/lib/batched-update.service.ts:74-123` | Verified |
| On destroy all partitioned tab IDs are force-closed | `canvas.store.ts:362-374`; `orchestra-canvas.component.ts:430-444` | Verified |

## 1. Performance

### Mounted chat surfaces and DOM retention

The canvas does not virtualize or detach tiles. Each retained workspace has a `GridstackComponent`; each tile has a `CanvasTileComponent`, child `EnvironmentInjector`, dynamic `ChatViewComponent`, and one `ChatTranscriptComponent`. Inactive workspaces use `display:none`, preserving all component instances and DOM (`canvas-workspace-grid.component.ts:47-75`; `canvas-tile.component.ts:106-114,235-252`).

**Measured ceiling:** `RETAINED_WORKSPACE_CAP (4) × MAX_TILES (9) = 36` mounted tile chat surfaces. The app shell also permanently mounts the single-panel chat beside the CSS-hidden grid view (`app-shell.component.html:681-712`), giving 37 `ChatViewComponent` instances. The main chat's component-scoped LRU retains at most eight transcripts while every tile chat renders one, hence `36 + 8 = 44` transcript trees. The exact DOM element count cannot be derived reliably because a message bubble expands into markdown, tools, execution nodes, agent controls.

There is now message-level windowing. Every message keeps a persistent slot, but only intersecting messages, the last six, and current streaming messages keep the expensive bubble subtree; unmounted bubbles become measured-height placeholders (`transcript-render-window.ts:4-24,113-176`; `chat-transcript.component.html:7-30`). CSS `content-visibility:auto` adds another browser-native layout/paint skip (`chat-transcript.component.css:35-61`). This is meaningful, but it is not tile virtualization: injectors, chat headers/input/panels, transcript component, observers, signals, and one slot per message remain.

### Workspace switching retention

`switchWorkspaceTiles()` changes the active key and seeds only unseen paths; it does not delete old partition entries (`canvas.store.ts:280-330`). `setActivePath()` mounts/re-touches a grid, then LRU-evicts only from `workspacePaths`; eviction deliberately leaves `_workspaceTiles` and `_workspaceFocusedTabId` intact (`canvas.store.ts:441-474`). Therefore:

- Up to four workspace grid DOM trees stay alive.
- Workspaces beyond four lose their grid/chat DOM, but their small intent arrays and focus values remain for restoration.
- `_tilesForCache` also retains a computed per visited path until explicit workspace removal (`canvas.store.ts:84-88,116-123,381-399`). This is bounded by visited workspaces, not by four; its memory is likely small, but that is an inference.

The current branch preserves the previously documented four-grid mounted cap while intentionally retaining intent for all known workspaces; the critical anchors remain unchanged.

### ResizeObserver and RAF driver

One `CanvasLayoutService` observes the top-level canvas. Each observer delivery cancels the prior pending RAF and schedules a new one; the callback floors and writes width and height (`canvas-layout.service.ts:57-86`). This is latest-frame coalescing, not an unbounded RAF loop. Continuous resizing still produces approximately one layout opportunity per painted frame. It does not avoid identical signal writes explicitly; Angular signals' equality prevents notification when the same floored number is written.

Each retained workspace owns a `layout` computed subscribed to the same two dimensions and its tile signal (`canvas-workspace-grid.component.ts:104-127`). `computeLayout()` sorts `n` tiles then walks rows: O(n log n) time and O(n) allocation (`canvas-layout.service.ts:105-142`). At today's caps this arithmetic is trivial. **Inference:** a resize can invalidate up to four layout computeds; actual recomputation depends on which effects/templates Angular evaluates in that zoneless render turn.

### Duplicate Gridstack projection and collision work

The intended imperative path is batched but still per tile: active, unlocked grids call `cellHeight()`, loop every engine node, and call `grid.update()` N times between `batchUpdate(true/false)` (`canvas-workspace-grid.component.ts:162-197`). Batching postpones final packing/change notification; it does not turn N API calls into one `load()`.

There is a second projection path. `items()` creates fresh per-item options objects whenever derived layout changes (`canvas-workspace-grid.component.ts:130-145`). Angular binds each to `<gridstack-item [options]>`; Gridstack's Angular wrapper setter immediately invokes `grid.update(this.el, val)` after initialization (`gridstack-item.component.ts:89-97`). This path is outside `_applyingLayout`, `visible`, and `locked` guards. Consequently a dimension/intent invalidation can produce up to N wrapper updates for a retained grid and another N explicit updates for the active grid. At current caps the static upper bound is 36 wrapper setter calls plus nine explicit calls for one invalidation; whether every hidden OnPush view is checked in that turn is an **inference requiring instrumentation**.

It also means the documentation claim that hidden/locked grids skip all layout projection is too strong. The explicit effect skips it, but the Angular input setter can still project changed item options. The stable `[options]="gsOptions"` object normally avoids repeated grid-level `updateOptions()` because the binding identity does not change; the duplicate issue is the per-item binding, not the grid options binding.

When geometry differs, `grid.update()` calls engine movement; `moveNode()` scans collisions, can recursively fix collisions, and may pack (`gridstack.js:1416-1477`; `gridstack-engine.js:70-114,936-999`). Within explicit batch mode, automatic pack is suppressed until batch end, but collision detection is not eliminated. Worst-case collision cascades can approach quadratic behavior; that is an algorithmic inference, not a measured frame time. With `float:false`, batch close restores gravity/packing.

### Signal/effect fan-out and writes

Per workspace grid: three effects (layout projection, remeasure-on-show, static lock) plus three computeds (`tiles`, `layout`, `items`) (`canvas-workspace-grid.component.ts:104-220`). Per tile: at least three effects (freeze effort, freeze model, visibility registration), multiple computeds, a child injector, and the much larger `ChatViewComponent` graph (`canvas-tile.component.ts:157-200,225-246`). At 36 retained tiles, the canvas shell alone creates at least 108 tile effects before chat internals.

Several effects write signals/services:

- Tile visibility effect mutates `TabManagerService.visibleTabIds` (`canvas-tile.component.ts:193-200`). This is an external registration bridge and appropriate, but workspace switches can fan out to every tile in outgoing and incoming grids.
- Orchestra request effects consume a signal and clear that request signal (`orchestra-canvas.component.ts:289-340`). They are command bridges, but effect ordering must remain guarded.
- Tile effort/model effects call tab mutations, though `untracked()` and “undefined only” guards prevent loops (`canvas-tile.component.ts:157-183`).
- The active-tab prune effect loops active tiles and can update the canvas map (`orchestra-canvas.component.ts:341-355`).

### Per-tile streaming and RPC cost

Hidden workspace tiles deregister from the visible set, so `BatchedUpdateService` keeps only the latest deferred `StreamingState` per tab and does not flush it into `TabManager`/downstream render computeds until visibility returns (`batched-update.service.ts:30-38,74-123`). Hidden transcript `mainPanelShowing()` is false and its view-model freezes (`chat-view.component.ts:527-543`). This avoids per-token DOM work for background workspaces.

It does **not** stop backend sessions, incoming RPC/event routing, accumulation of the latest streaming state, or finalization. The service explicitly fully drains deferred entries at turn-end to avoid resurrecting stale state (`batched-update.service.ts:145-190`). Active workspace tiles are all registered visible, so up to nine concurrent streams can flush together on each shared RAF, each causing tab-state propagation and transcript/execution-tree work. At 25/50 visible tiles, per-frame cost scales with the number of concurrently changing tabs, not merely total tile count. Exact RPC, token-rate, and memory costs require profiling with representative concurrent sessions.

## 2. Zoom

### Option A — CSS transform on a grid world (recommended)

Add an overflow viewport and a transformed “world” around the active grid: `transform: scale(var(--canvas-zoom)); transform-origin: 0 0`, as visual magnification, not reflow. Do not feed zoom into `CanvasLayoutService`, divide viewport dimensions by zoom, or change wrapping/columns. Explicitly compensate scroll/world bounds; zoom-out may show blank area unless product separately defines a larger logical world.

What breaks or needs proof:

- The generic warning “pointer coordinates are not scaled” is **not accurate for installed Gridstack 12.6.0**. It inserts a 1×1 transform reference, derives inverse X/Y scale, and uses that during drag start and resize (`utils.js:713-738`; `gridstack.js:2667-2685`; `dd-draggable.js:195-218`; `dd-resizable.js:199-208`). This makes the option viable, but nested scroll + inverse-sized world + transform-origin must be tested in the Electron and VS Code webviews.
- A transform without inverse world sizing only shrinks visuals and produces unused space. A transformed element's layout box is not resized by CSS transform, so scroll extents need an explicit wrapper/spacer.
- `CanvasLayoutService` currently observes the unscaled outer canvas and derives columns directly from width (`canvas-layout.service.ts:72-97`). If left unchanged, zoom-out would not increase logical width or columns. Leave this unchanged: zoom does not reflow.
- Current tiles do not contain Monaco or xterm. If embedded later, those renderers may be bitmap/compositor-scaled. Browser pointer dispatch generally targets transformed descendants, but text/caret/canvas sharpness and device-pixel-ratio assumptions may degrade at fractional zoom. Treat that as a visual/input test requirement, not a proven failure. Prefer discrete scale steps such as 0.75/0.85/1/1.15 and offer “reset to 100%”.

Exact product files: `orchestra-canvas.component.ts` (zoom state/controls and viewport), `canvas-workspace-grid.component.ts` (world wrapper/style/input and the only Gridstack coordination), plus their specs. `CanvasStore`, `CanvasTile`, and `TileLayout` need no shape changes.

### Option B — cellHeight and column recomputation as zoom

This is not real zoom. Reducing `cellHeight` only compresses vertical Gridstack tracks; tile text, toolbars, Monaco/xterm, and minimum usable widths remain unchanged. Increasing the engine column count conflicts with the current invariant that each row apportions exactly 12 units, while `MAX_COLUMNS` means tiles per row, not Gridstack engine columns (`canvas-layout.service.ts:3-24,113-142,177-220`). Calling Gridstack `column()` can transform cached positions and invoke engine work, then the derived projection overwrites it. It also couples `CanvasLayoutService` to renderer semantics unless carefully isolated. Reject for a scale-factor requirement.

### Option C — replace positioning with a real pan/zoom viewport

A semantic pan/zoom scene can cull aggressively, keep overlays at 1×, and eventually support a minimap. But replacing Gridstack positioning means rebuilding drag, horizontal resize, gravity/collision behavior, keyboard/accessibility semantics, persistence-to-intent write-back, scroll, and tests. If it still uses CSS/canvas scaling, embedded editor quality remains; if it renders semantic LOD, every tile needs multiple renderers. This is justified only as the many-tile stage-2 architecture, not as the first zoom feature.

**Recommendation:** Option A behind a small scale signal and browser proof. Keep 100% as the editing-quality default; zoomed modes are overview modes. Do not assume compensation works merely because source contains it—exercise drag, east/west resize, nested vertical scroll, popovers, and both hosts.

## 3. Beyond the nine-tile cap

### What actually breaks at 25 or 50

- **Row arithmetic:** the engine has 12 units and every row member has a two-unit floor. Therefore `12 / 2 = 6` is the absolute representable maximum per row. `apportionRow()`'s own boundedness comment assumes `row.length × MIN_TILE_UNITS <= 12` (`canvas-layout.service.ts:177-220`). Above six entries in one row, floors already sum beyond 12 and the correction loop cannot reduce any item below two; the row cannot be represented. Today `MAX_COLUMNS=3`, so this does not occur. A future zoom implementation must never derive more than six tiles per row without changing the unit model/floor.
- **Current column clamp:** `MIN_TILE_WIDTH=480` and `MAX_COLUMNS=3` mean the layout remains 1–3 tiles wide regardless of tile count (`canvas-layout.service.ts:14-24,94-98`). Thus 25 tiles produce nine rows (last row one); 50 produce 17 rows (last row two) at three columns.
- **Scroll height:** each tile is six cells tall; `cellHeightFor()` enforces a tile height of roughly 90% of viewport height (`canvas-layout.service.ts:155-169`). So three-column 25/50 layouts are approximately 8.1/15.3 viewport heights plus margins. This is intentional scrolling, but it makes most expensive tile surfaces off-screen while still mounted.
- **DOM/renderers:** 25 or 50 full chat inputs, transcripts, agent panels, child injectors, observers, and per-message slots in one workspace scale memory approximately linearly. Windowed message bubbles reduce inner content cost, not the per-tile shell or slot count.
- **Gridstack:** each projection still makes N wrapper updates and N explicit updates for the active grid, and each changed update may scan N nodes/collisions. Raising the cap magnifies the duplicate path and collision cascades before pure layout math becomes material.
- **Session/RPC:** tabs and backend sessions exist independently of DOM. More tiles permit more simultaneous sessions/streams. Visibility gating currently treats every tile in the active workspace as visible even when vertically off-screen, so 50 active-workspace tiles can all flush streaming work, including the 47 that may be below the viewport.

### Architecture for many tiles

Keep one canonical intent list and derived layout, but split “tile exists” from “full chat surface is mounted”:

1. A viewport-aware tile host observes tile intersection with a generous overscan. Focused, streaming-visible-nearby, dragging, and permission-request tiles mount the full `CanvasTileComponent`; far tiles render a lightweight placeholder containing title/status/last activity/static transcript preview.
2. Visibility registration must follow actual viewport/LOD status, not only workspace visibility. Streaming state continues accumulating in the root store; a culled tile catches up once when promoted.
3. Preserve stable Gridstack item shells and geometry for all tiles so the engine retains collision/layout identity; cull only the expensive content. This avoids trying to virtualize Gridstack nodes out from under drag/collision calculations.
4. Add pages or named clusters. Only the active page mounts a Gridstack; other pages retain intent and summary metadata. A cluster of roughly 6–12 sessions provides a tractable working set while search/status surfaces span all sessions.
5. Build the minimap from derived `TileLayout` plus statuses. A DOM/SVG or regular canvas static preview is sufficient. `OffscreenCanvas` is useful only if profiling shows main-thread minimap drawing is material; it cannot host Angular chat DOM, Monaco, or xterm and is not a tile virtualization solution.

### Staged plan

**Stage 1 — cheap, measurable wins**

1. Instrument counts and timings: mounted full tiles, transcript slots/bubbles, Gridstack update calls, `computeLayout` calls, collision/pack duration, RAF flush tabs, heap after workspace switches.
2. Remove the duplicate Gridstack projection contract: choose one owner. Prefer a single batched `grid.load(derivedWidgets)`/equivalent inside `CanvasWorkspaceGridComponent`, or make bound item options initial-only and update imperatively. Verify gesture write-back and Angular child stability.
3. Make active-workspace streaming visibility viewport-aware so below-fold tiles defer flushes. Keep focused/permission tiles live.
4. Add lightweight content mode for off-screen/unfocused tiles while retaining Gridstack item shells. Reuse existing transcript windowing and hidden transcript freeze.
5. Add Option-A zoom with discrete steps and host-specific interaction/visual tests.

**Stage 2 — structural scale**

1. Introduce pages/clusters in canvas intent without storing geometry. Retain only a small LRU of page/workspace grids.
2. Define tile LOD states: placeholder, static preview, live chat. Promotion/demotion owns injector creation/destruction and visible-tab registration.
3. Add a derived SVG/canvas minimap and search/jump navigation; evaluate `OffscreenCanvas` only after profiling.
4. If requirements demand hundreds of freely pannable nodes, prototype Option C behind the same intent/layout contracts. Do not replace Gridstack until the prototype matches drag/resize/accessibility and embedded-editor behavior.

## Documentation drift and contradictions

- `libs/frontend/canvas/CLAUDE.md` cites `canvas.store.ts:21` for the store; the class now starts at line 59 and `MAX_TILES` is line 69. `orchestra-canvas.component.ts:50` still points near the decorator (current line 50), not the class (239).
- The guide says hidden layout math is skipped and locked mode freezes layout. The explicit projection effect does this (`canvas-workspace-grid.component.ts:163-171`), but `[options]="item.options"` reaches Gridstack's setter independently (`gridstack-item.component.ts:89-97`). The guarantee is therefore not complete.
- “Geometry flows one way … to `grid.update()`” omits the fact that two code paths invoke update: the explicit engine-node loop and the Angular item input setter.
- The current branch preserves the prior report's four-workspace retention cap; critical anchors are unchanged.
- Tile-level non-virtualization coexists with the previously documented transcript windowing: Transcript bubbles have explicit intersection-based windowing and CSS `content-visibility`; persistent message slots and full tile/chat shells remain.
- The common CSS-transform warning that Gridstack pointer coordinates are unscaled is contradicted by installed 12.6.0 source, which measures transform scale for drag and resize. End-to-end host behavior remains unmeasured.

## Recommended sequence

1. Profile the current 1/9/36-surface cases and record heap, long tasks, Gridstack calls, and concurrent-stream RAF cost.
2. Eliminate the duplicate per-item/manual Gridstack projection path; confirm visibility and lock truly gate all programmatic layout.
3. Make “visible tab” mean in-viewport full tile, with focused/permission exceptions.
4. Add placeholder LOD for off-screen/unfocused tiles while retaining stable Gridstack shells.
5. Implement viewport/world CSS zoom with visual-only scaling, unchanged layout math, explicit transformed bounds, and discrete steps; test drag/resize, scroll, popovers, VS Code, and Electron.
6. Only then raise the per-page cap experimentally. Keep at most six tiles per row under the present 12-unit/two-unit contract.
7. Add pages/clusters and a derived minimap before targeting 25–50 sessions as one navigable orchestra.
