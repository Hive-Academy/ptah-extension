# Implementation Plan - TASK_2026_629_c0b3 - Rail board mode

The Rail board is a second board mode. It becomes the default. The Gridstack board stays as "Grid" behind a toggle.
Nothing is removed.

Paths are relative to the worktree root. `canvas/` = `libs/frontend/canvas/src/lib/`, `chat/` =
`libs/frontend/chat/src/lib/`, `chat-ui/` = `libs/frontend/chat-ui/src/lib/`. Every `file:line` below was read in this
worktree at `b512157c0`. Each claim is labelled Verified (with a citation) or Assumption (with the check that settles it).

## Inputs and constraints

- Requirements used: `decisions.md` rows 43-54; `layout-design-spec.md` (sections 1-7, `## Revision 1`, `## Revision 2`,
  `## Dense mode (Gate 1.7 addendum)`); `prototypes/02-focus-rail.html` (reference only); `layout-design-spec-review.md`,
  `layout-design-spec-rereview.md`, `layout-design-spec-rereview-2.md`; `parity-inventory-layout.md` rows 1-44;
  `code-logic-review-final-fix.md` Moderates #1, #2, #8; style of `implementation-plan.md` and `plan-part-4.md`.
- Corrections applied:
  - Rows 44 (a)-(c) and 52-53 change AC 1.4 and the "1-2 sessions as today" NFR. Both now apply to **Grid only**.
    Rail is used from the first session.
  - The design-review open items carried as requirements: R2-1 (request identity), R2-2 (lane strip reveal on its own
    width change), #10 (contrast confirmed in Electron).
- Design handoff used: `layout-design-spec.md` and the prototype. Component names below follow the spec's words (rail,
  rail card, focus area, focus header, details column, Board toggle). The spec names no Angular classes.
- Missing decision-critical input:
  - The spec gives no value for the "lighter dark error red" (row 52). Resolved as lane-proposed D14: `#ef4444`,
    checked by a contrast spec and confirmed in Electron.
  - The spec's cap sentence differs from the shipped constant. Resolved by D11 (keep the constant).

### Rules and their source

| Rule | Tag |
|---|---|
| Rail is the default. Grid keeps today's behaviour. No removals. | user-requested (row 44) |
| Dense mode is a user toggle, persisted per workspace, never automatic | user-requested (rows 52-53) |
| Send to messaging goes in the focus-header overflow menu. No hover close on cards. | user-requested (row 52 Q4, Q5) |
| Actions bind to the shown request id. The strip reveals the selected tab on its own width change. Contrast is confirmed in Electron. | user-requested (row 52: R2-1, R2-2, #10) |
| Carried fixes #1 (ended lanes by `endedAt`), #2 (lane summary equality), #8 (one Escape handler) | user-requested (row 45) |
| Standalone components, OnPush, `inject()`, signals, no NgModules; imports through `@ptah-extension/<lib>` barrels; no new `as any`; Nx `scope:*`/`type:*` boundaries stay valid | project-rule |
| Presentational chat-ui never imports `chat`, `chat-state` or `canvas` | project-rule (direction verified below) |
| Verification commands (STRICT block in the handoff) | project-rule (`CLAUDE.md`) |
| Lane-introduced rules | lane-proposed (listed under `## Lane-introduced constraints`) |

## Codebase evidence

| Evidence | Location | Architectural implication |
|---|---|---|
| Record versions 1 and 2 are accepted. Writes are always v2 (`LATEST_VERSION = 2`). | `canvas/canvas-layout-persistence.service.ts:14,28-62,265-287` | v3 is added beside them. The v2 schema stays so v2 records keep loading. |
| A newer `version` gives `writable:false` and keeps the bytes. The spec covers 99 **and 2.5**. | `canvas-layout-persistence.service.ts:179-189`; spec `canvas-layout-persistence.service.spec.ts:75-88` | With `LATEST_VERSION = 3`, 2.5 is no longer "> latest". The check must also treat a non-integer version as newer. |
| Load result is `{tiles, writable, needsWrite}`. The round-trip spec asserts that exact shape. | `canvas-layout-persistence.service.ts:67-74`; spec `:39-43,82-86` | The shape grows, so those two assertions change. This is a recorded spec edit (D16). |
| Writes are enabled per path after `markHydrated`. Writes are debounced 250 ms and flushed on pagehide, beforeunload, hidden and destroy. | `canvas-layout-persistence.service.ts:12,134-148,213-250` | Board state reuses the same gate. No new timer. |
| A failed write only warns, once per kind. | `canvas-layout-persistence.service.ts:281-295` | "Failed write surfaced" needs a signal that the dock reads. |
| zod 4.6.5. `.catch()` fallback precedent exists. | `package.json:207`; `libs/backend/agent-generation/src/lib/services/wizard/analysis-schema.ts:334` | An unknown `railDensity` or `boardMode` value falls back without failing the whole record (spec: unknown density reads as comfortable). |
| Store state is per workspace: tiles, focus, layout focus, revisions. `RETAINED_WORKSPACE_CAP = 4`. | `canvas/canvas.store.ts:59,107-131` | Board state becomes another per-path map. The cap is unchanged. |
| `setWorkspaceTiles` bumps the gesture revision and schedules persistence. | `canvas.store.ts:638-660` | Board-state writes must not bump the revision. Gridstack gesture snapshots compare it. |
| Hydration loads, reconciles, sets focus, then `markHydrated`, then schedules only if needed. | `canvas.store.ts:486-549` | Board state is set in the same transaction, before `markHydrated`. |
| Hidden-workspace tabs are not signals. The running count polls only at the cap. | `canvas.store.ts:161-212` (comment `:199-202`) | Rail cards of a hidden workspace would show stale data. D4: hidden Rail hosts mount no cards. |
| Running cap 9 with one message constant. Tile bound 20. | `canvas/canvas-running-cap.ts:6-7`; `canvas/canvas-layout-intent.ts:13`; `canvas.store.ts:157-159,213-229` | The Rail footer and meter read the same signals. |
| Each retained workspace mounts its own grid. The detail panel exists only for the active one. | `canvas/orchestra-canvas.component.ts:232-249` | The per-path loop picks Rail or Grid per path. Only one mode is mounted per workspace. |
| Detail gate `detailTabId` closes the detail through an effect when it no longer applies. | `orchestra-canvas.component.ts:335-342,393-395` | Adding "active mode is Grid" to the gate closes the Grid detail on a switch to Rail, with no new code path. |
| Window keydown goes to `handleCanvasDetailKeydown`. That handler ignores inputs, menus, dialogs and popovers, and any event already `defaultPrevented`. | `orchestra-canvas.component.ts:71,344-351`; `canvas/canvas-detail/canvas-detail-keyboard.ts:9-34` | The Rail keyboard handler uses the same ignore rules. A queue that calls `preventDefault` on Escape wins (fix #8). |
| Queue Escape is a document listener with no `preventDefault`. | `canvas/canvas-needs-you-queue.component.ts:147-162` (Escape `:154`) | Fix #8. Document listeners run before the window listener, so `preventDefault` is enough. |
| Queue items are keyed `perm:<id>` / `q:<id>`. `answer` re-checks that the key is still current. | `canvas/canvas-needs-you-queue.ts:58,76`; `canvas-needs-you-queue.component.ts:181-210` | Queue identity is already request-id based. The Rail needs no queue rewrite. |
| The detail service holds one `_laneKey`, reset on `close`. `open` focuses the tile. | `canvas/canvas-detail/canvas-detail.service.ts:9-42` | Replace it with a per-tab map. `open` stays the one entry point for card lanes and the queue (D6). |
| A tile mounts ChatView through its own `EnvironmentInjector`, and its forced card is that same ChatView. Release: `unregisterVisibleTab` + `childInjector.destroy()`. | `canvas/canvas-tile.component.ts:425-433,632-665`; `chat/components/templates/chat-view.component.ts:925-928` | Rail cards must not use `CanvasTileComponent`. Each tile is a whole ChatView. |
| Effort/model freeze runs on tile mount. | `canvas-tile.component.ts:536-562` | Row 38 needs the same freeze on the Rail focus mount (D8 helper). |
| Card click guard: ignore controls, ignore a non-collapsed selection inside the host. | `canvas-tile.component.ts:692-727` | The Rail card applies the same rule (F6, row 43). It is extracted into one helper (D8). |
| The lane view mounts one lane under `@for (key of [laneKey()]; track key)`. Its default lane is the detail transcript (ChatView). | `canvas/canvas-detail/canvas-lane-view.component.ts:50,117-118,191-194` | "Exactly one ChatView or one lane panel" is this component as it is today. The Rail reuses it. |
| The detail transcript owns an injector. It registers the visible tab only if the tab is absent. `visible` is constant `true`. | `canvas/canvas-detail/canvas-detail-transcript.component.ts:44-73` | Reused as the Rail live view. It gains surface gating so an inactive canvas pauses it (D7). |
| A changed `tabId` input reuses the transcript instance (`tabIdSignal` follows the input). | `canvas-detail-transcript.component.ts:41-47` | The Rail must remount by tab id (`track` the focused id). Otherwise one ChatView switches context in place. |
| Lane tablist: the selected tab is tabbable. It falls back to `orchestrator` by an emit when the lane disappears. No width observer. | `canvas/canvas-detail/canvas-lane-tabs.component.ts:32-36,146-157,159-182` | R2-2: add one ResizeObserver on the strip. The fallback contract is reused. |
| The card's derivations are signals on `CompactSessionCardComponent`. `laneSummary` filters the whole `subagents()` map and has no `equal`. | `chat/components/molecules/compact-session/compact-session-card.component.ts:134-164,232-270,286-352` | One smart card serves both variants (D2). #2 is an `equal` on `laneSummary`. |
| Callout ids: a session permission uses `PermissionRequest.id`, a CLI permission uses `request.requestId`. The error callout has **no id** and `canRetry:false`. | `compact-session-card.component.ts:165-224` (`:175,197,215-222`); `libs/shared/src/lib/types/permission.types.ts:32` | R2-1: give error and question callouts an id from the model (D10). No Retry action exists in the real model. |
| `respond` re-finds a session request by id. CLI `respondLane` dedups but does not check that the request is still queued. | `compact-session-card.component.ts:377-393`; `chat/services/agent-permission-responder.ts:20-27,49-58` | A CLI answer must also check `agent.permissionQueue` membership. |
| Ended sub-agent rows have `startedAt:null`. The sort ties keep insertion order. | `chat/components/molecules/compact-session/compact-lane-rows.ts:70-94` | Fix #1: ended rows sort by `endedAt` descending. |
| Turn identity on the tab: `lastTurnStateRevision` + `lastTurnStateSessionId`, bumped per backend `turn_state`. `generating` clears the terminal reason. | `libs/frontend/chat-types/src/lib/chat-types.ts:783,793,803`; `libs/frontend/chat-state/src/lib/tab-manager.service.ts:1498-1525` | The error id source (D10). |
| Drafts: root store keyed by tab id, cleared on tab close. The composer saves on every edit, on context change and on destroy. | `chat/services/composer-draft.store.ts:19-51`; `chat/components/molecules/chat-input/chat-input.component.ts:730-731,1533-1547,1569-1607` | A destroy-before-mount swap keeps drafts with no new API (D5). The spec "preserves a draft when a second empty composer mounts before the first unmounts" (`chat-input.component.spec.ts:319`) covers the overlap order. |
| Stop acts on the **active** tab. | `chat/services/chat.store.ts:368-370`; `chat/services/chat-store/conversation.service.ts:179-191` | The focus-header Stop first makes the focused tab active (D12). |
| Board width signal already exists: `layoutService.containerWidth()`, from one ResizeObserver on the session viewport. | `orchestra-canvas.component.ts:396-401`; `canvas/canvas-workspace-grid.component.ts:88,252` | Rail breakpoints and the auto-collapse read it. No second board observer. |
| One-`buildTree` probe pattern. | `canvas/canvas-tile.component.spec.ts:1315-1329` | The Rail focus spec copies it. |
| Metrics counters, published as `data-canvas-*` host attributes. | `canvas/canvas-render-metrics.service.ts:19-31`; `canvas-workspace-grid.component.ts:88-95` | The Rail host publishes mode and live-view counters (row 41). |
| Per-theme CSS variable precedent `--bcm`, a color utility over it, and a spec that recomputes contrast from the literal theme source. | `apps/ptah-extension-webview/tailwind.config.js:31,105,174`; `apps/ptah-extension-webview/src/app/base-content-muted.spec.ts:1-40` | State-ink tokens follow the same pattern (D13). |
| Boundaries: `scope:webview` libs depend only on `scope:shared`/`scope:webview`. `type:feature` libs depend on feature, data-access, ui, util and core. canvas, chat and chat-ui are all `scope:webview, type:feature`. chat-ui imports no `chat`/`chat-state`. | `eslint.config.mjs:295-296,407-415`; `libs/frontend/{canvas,chat,chat-ui}/project.json:7`; import census of `chat-ui/src` | The rail card view goes in chat-ui (consumed by chat). The Rail board goes in canvas. No new edges. |
| Public exports exist for `CompactSessionCardComponent`, `SESSION_CARD_ACTIONS`, `laneKey`, `parseLaneKey`, `AgentPermissionResponder`, `SESSION_START_GUARD`. | `libs/frontend/chat/src/index.ts:31-43`; `chat/components/index.ts:129` | Canvas consumes them through `@ptah-extension/chat`. |
| No frontend Logger class exists. canvas uses `console.warn`/`console.error`. | search of `libs/frontend` (`class *Logger` none); `canvas-layout-persistence.service.ts:294`; `orchestra-canvas.component.ts:434,465,620` | The "Logger not console" rule has no target here. Keep the existing warn path (D15). |

## Architecture decision

- **Chosen approach:**
  - `OrchestraCanvasComponent` keeps its per-workspace `@for` loop. Per path, it mounts **either**
    `CanvasRailBoardComponent` (Rail) **or** `CanvasWorkspaceGridComponent` (Grid, unchanged), chosen from a
    per-workspace `boardMode` in `CanvasStore`. The value is persisted in a v3 layout record.
  - The Rail board composes:
    - a rail of `CanvasRailCardComponent`s, each rendering the existing smart `CompactSessionCardComponent` in a new
      `rail` variant with a new chat-ui presentational `CompactRailCardComponent`;
    - one focus area whose body is the existing `CanvasLaneViewComponent`, remounted per focused tab id (its default
      lane is the existing transcript ChatView);
    - the existing `CanvasSessionDetailsComponent` as the details column.
  - Lane selection moves to a per-tab map in `CanvasDetailService`.
- **Rationale:**
  - It reuses every existing data source: the card derivations, the lane tabs/view, the transcript injector and
    release, the queue, the cap and the drafts.
  - The one-live-view contract becomes a structural property: one keyed `@for` with one lane view.
  - Grid is not edited except at the gate (`detailTabId`) and the dock.
- **Rejected alternatives:**
  - (a) Render Rail cards as `CanvasTileComponent` in forced-card mode. Each one is a full ChatView with its own
    injector (`canvas-tile.component.ts:425-433`). That breaks "exactly one ChatView" and the BL budget.
  - (b) Extract the card derivations into a new shared model class used by a new canvas-side smart card. It copies the
    wiring of 9 injected services (`compact-session-card.component.ts:113-124`) into a second place for no new
    behaviour. A `variant` input reuses them in place.
  - (c) One persistent ChatView whose `SESSION_CONTEXT` is swapped. `chat-input.component.ts:1533-1541` supports a
    context change, but ChatView keeps per-tab internals: scroll, tree and registration. The spec requires that a swap
    releases the injector and the registration (spec section 4.5). Rejected.
  - (d) A Gridstack-backed rail. It adds the engine release problem (row 39) with no benefit for fixed slots.
  - (e) A global board mode. The spec requires per workspace (D10 of the spec), and hidden workspaces keep their own
    mode.
- **Assumptions:** listed per component and collected under `## Decisions`. Each one has a check.
- **Effect on existing code:**
  - Replaced in place:
    - `_laneKey` becomes the per-tab lane map.
    - The persisted record moves from v2 to v3. Reading v1 and v2 stays.
    - The lane-row sort tie-break.
    - The queue Escape handling.
    - The transcript's constant `visible`.
  - Left alone (Grid): Gridstack, presets, lock, spans, row breaks, layout focus, detail geometry, `CANVAS_LIVE_BUDGET`,
    `canvas-grid-release.ts`, and the tile's layout menu.

## Component specifications

### 1. Board state model and v3 layout record

- **Purpose:** One schema and type source for per-workspace board state, and its storage boundary.
- **Responsibilities:**
  - CREATE `canvas/canvas-board-mode.ts`. Pure, no Angular. It holds:
    - `CanvasBoardMode = 'rail' | 'grid'` and `CanvasRailDensity = 'comfortable' | 'dense'`.
    - `CanvasBoardState { mode; railCollapsed: boolean; railDensity; railScrollTop: number }`.
    - `DEFAULT_BOARD_STATE = { mode:'rail', railCollapsed:false, railDensity:'comfortable', railScrollTop:0 }`.
    - `railWidthBand(width)`, returning `'xl' | 'lg' | 'md' | 'sm'` for >=1760 / 1280-1759 / 1120-1279 / <1120
      (spec section 1 table).
  - MODIFY the persistence service:
    - `LATEST_VERSION = 3`.
    - `v3Schema = strictObject({ version: literal(3), tiles: <v2 tile array, unchanged>, board: strictObject({...}) })`.
      `board` has:
      - `mode: z.enum(['rail','grid']).catch('rail')`
      - `railCollapsed: z.boolean().catch(false)`
      - `railDensity: z.enum([...]).catch('comfortable')`
      - `railScrollTop: z.number().int().nonnegative().max(1_000_000).catch(0)`
  - Load order: newer-version check first, then v3, then v2, then v1.
    - The **newer check becomes** `typeof version === 'number' && (version > 3 || !Number.isInteger(version))`. This
      keeps 2.5 and 3.5 read-only.
    - v1 and v2 load with `board: null`. The store treats `null` as Rail defaults (spec 7.2).
    - v2 gives `needsWrite:false`, a lossless read. The record is upgraded to v3 on its first real change.
    - v1 keeps `needsWrite:true`, as today.
    - The `lastWritten` dedupe is seeded only for v3 raw bytes, as `:193` does for v2 today.
  - `CanvasLayoutLoadResult` gains `board: CanvasBoardState | null` and `readOnlyReason: 'newer-version' | null`.
  - `schedule(path, snapshot: () => CanvasWorkspaceRecord)` with `CanvasWorkspaceRecord { tiles; board }`.
    `write()` always emits v3.
  - New signals:
    - `writeFailed: Signal<boolean>`: true after a failed `setItem`, false after the next success.
    - `readOnlyPaths: Signal<ReadonlySet<string>>`: set in `load` for newer records, cleared in `remove`.
- **Verified contracts and entry points:**
  - load `canvas-layout-persistence.service.ts:158-210`, schedule `:229-237`, write `:265-287`, warn `:290-295`.
  - `TileIntent` and `MAX_CANVAS_TILES` from `canvas-layout-intent.ts` (imports `:4-9`).
- **Dependencies:** `VSCodeService` (panel id, `:126,153`), zod. No new dependency.
- **Integration points:** `CanvasStore.hydrateWorkspace` (load, markHydrated), `schedulePersist` (schedule), and the
  orchestra dock (signals).
- **Failure behaviour:**
  - Read, parse and schema failures keep today's results.
  - A newer version is read-only, and the path is added to `readOnlyPaths`.
  - A write failure: `warn('write')` once, `writeFailed` set to true, in-memory state stays authoritative.
  - A remove failure: warn, as today.
- **Quality requirements:**
  - One `setItem` per debounce window per path.
  - Identical serialized records are not rewritten (`:280`).
  - Scroll-offset churn is bounded by the 250 ms debounce.
- **Verification seam:** `canvas-layout-persistence.service.spec.ts`, with these new cases:
  - (1) v3 round-trip including all four board fields;
  - (2) v2 loads with `board:null`, `needsWrite:false`, tiles identical;
  - (3) v1 migrates tiles and gives `board:null`;
  - (4) unknown `mode`/`railDensity` and a negative `railScrollTop` fall back without losing tiles;
  - (5) `it.each([99, 2.5, 3.5])` stays read-only, keeps the bytes and adds to `readOnlyPaths`;
  - (6) no write before `markHydrated`, including a board-only change;
  - (7) `writeFailed` true after a throwing `setItem`, false after the next success.

  The round-trip and future-version assertions get the new fields (D16).
- **Files:** CREATE `libs/frontend/canvas/src/lib/canvas-board-mode.ts`. MODIFY
  `libs/frontend/canvas/src/lib/canvas-layout-persistence.service.ts`,
  `libs/frontend/canvas/src/lib/canvas-layout-persistence.service.spec.ts`.

### 2. CanvasStore board state

- **Purpose:** Own per-workspace board state next to tile intent, and persist both through one snapshot.
- **Responsibilities:**
  - Add `_workspaceBoard = signal<ReadonlyMap<string, CanvasBoardState>>`.
  - Add `boardFor(path): CanvasBoardState`, memoized per path like `tilesFor` (`canvas.store.ts:243-250`), and
    `activeBoard` as a computed.
  - Add setters:
    - `setBoardMode(path, mode)`
    - `setRailCollapsed(path, collapsed)`
    - `setRailDensity(path, density)`
    - `setRailScrollTop(path, px)`, rounded and clamped to `>= 0`

    Each setter:
    - writes only `_workspaceBoard`;
    - **does not** call `setWorkspaceTiles` and does not bump `_workspaceRevisions`;
    - calls `schedulePersist(path)`;
    - is a no-op when the value is equal.
  - Hydration (`:521-548`) sets `_workspaceBoard[path] = loaded.board ?? existing ?? DEFAULT_BOARD_STATE` before
    `markHydrated`.
  - `moveIn` / `deleteIn` cover the board map in the implicit-path migration (`:502-515`) and in
    `removeWorkspaceTileState` (`:574-586`).
  - `schedulePersist` snapshot becomes `{ tiles, board }`.
  - Rail tile membership (add, adopt, close) keeps using the existing `appendTile` / `dropTile`. No other tile-intent
    mutation is called by Rail code. This keeps Grid intent untouched while in Rail (spec 7.3).
- **Verified contracts:**
  - `hydrateWorkspace` `canvas.store.ts:486-549`, `setWorkspaceTiles` `:638-653`, `schedulePersist` `:655-660`.
  - `focusTile` `:461-465`, `focusedTabIdFor` `:261-263`, `tilesFor` `:243-250`.
  - `canStartRunningSession` `:214-216`, `runningSessionCount` `:213`, `canAddTile` `:157-159`.
- **Dependencies:** Component 1 types. Direction stays store → persistence.
- **Integration points:** orchestra (mode per path, toggle), Rail board (collapse, density, scroll, focus), and
  `CanvasDetailService` (active mode, Component 3).
- **Failure behaviour:** Before hydration, setters write memory only (the persistence gate drops the schedule). On a
  read-only path, memory changes and nothing is persisted.
- **Quality requirements:** A board write never changes `tiles()` identity or `workspaceRevision(path)`.
- **Verification seam:** `canvas.store.spec.ts`, with these new cases:
  - (1) a v2-backed path hydrates as Rail;
  - (2) each setter persists once and leaves `tilesFor(path)()` and `workspaceRevision(path)` unchanged;
  - (3) hidden workspaces keep their own mode across `hydrateWorkspace` switches;
  - (4) removing a workspace drops its board state;
  - (5) the implicit-path migration carries board state.
- **Files:** MODIFY `libs/frontend/canvas/src/lib/canvas.store.ts`, `libs/frontend/canvas/src/lib/canvas.store.spec.ts`.

### 3. CanvasDetailService: per-tab lane selection, mode-aware open

- **Purpose:** One selection model for "which lane of which tab". Grid detail and the Rail focus area both use it.
- **Responsibilities:**
  - Replace `_laneKey` with `_laneKeys = signal<ReadonlyMap<string, string>>`, with value-equality writes: skip the
    update when the entry already holds that key.
  - `laneKeyFor(tabId)` returns the stored key or `'orchestrator'`.
  - `laneKey` (Grid) becomes `computed(() => laneKeyFor(detailTabId() ?? ''))`, so the Grid panel binding
    `canvas-detail-panel.component.ts:55,64` keeps its meaning.
  - `open(tabId, laneKey='orchestrator')`:
    - validate as today (`:16-17`);
    - `focusTile`;
    - set the map entry;
    - set `_detailTabId` **only when** `canvasStore.boardFor(activePath).mode === 'grid'`.

    This keeps the queue's `openSession` (`canvas-needs-you-queue.component.ts:220-232`) and the card lane action
    working in both modes with no caller change.
  - `selectLaneFor(tabId, key)` sets an entry without opening a detail. Used by the Rail lane tabs and the lane
    fallback.
  - `close()` resets only `_detailTabId`. The map entry survives, so focus swaps restore the lane (spec 3).

    Grid's observable behaviour does not change. Every Grid open passes an explicit key
    (`canvas-detail.service.ts:30`), and `toggle` compares against `laneKeyFor(detailTabId())`.
  - Prune entries on a real tab close through `tabManager.onTabClosed` (pattern `composer-draft.store.ts:26-30`),
    ignoring `reset` like `orchestra-canvas.component.ts:556`. Release it through `DestroyRef`.
- **Verified contracts:** `canvas-detail.service.ts:9-64`; `parseLaneKey` from `@ptah-extension/chat`
  (`chat/src/index.ts:36`).
- **Dependencies:** `CanvasStore` (Component 2), `TabManagerService`.
- **Integration points:**
  - Grid panel, queue, tile `openCardLane` (`canvas-tile.component.ts:682-685`).
  - Rail card actions, Rail lane tabs, and the lane-disappears fallback (`canvas-lane-tabs.component.ts:152-157`
    emits `'orchestrator'`, and the Rail focus area forwards it to `selectLaneFor`).
- **Failure behaviour:** An unknown tab or a malformed key does nothing (today's guard). A pruned tab reads
  `'orchestrator'`.
- **Verification seam:** `canvas-detail.service.spec.ts`. The existing three cases stay unedited. New cases:
  - (1) lane per tab restored after focusing another tab;
  - (2) `open` in Rail mode focuses and sets the lane, and `detailTabId()` stays `null`;
  - (3) `close` keeps the map;
  - (4) a closed tab is pruned and `reset` is ignored;
  - (5) re-selecting the same key writes nothing (the map identity is unchanged).
- **Files:** MODIFY `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail.service.ts`, `.../canvas-detail.service.spec.ts`.

### 4. Lane tab strip: overflow and reveal (R2-2)

- **Purpose:** Keep the selected lane tab visible on a selection change, a sample, or a change of the strip's own
  width.
- **Responsibilities:**
  - MODIFY `CanvasLaneTabsComponent`:
    - The strip has a fixed height of 35 px in Rail. It scrolls horizontally with no scrollbar and a 32 px edge fade
      on each cut side. Each fade is shown only while that side is cut; the state is computed from `scrollLeft`,
      `clientWidth` and `scrollWidth` on scroll and on resize.
    - Use **one ResizeObserver on the tablist element itself**, not on window resize.
    - On a width change, and after the selected key changes, call
      `selectedTab.scrollIntoView({ block:'nearest', inline:'nearest' })` in `afterNextRender`.
    - Disconnect the observer in `DestroyRef`.
  - The keyboard model is unchanged (`:159-182`).
  - Grid's detail strip gets the same behaviour. That is an improvement with no geometry effect: the strip height is
    unchanged in Grid because the fixed height is a Rail host class.
- **Verified contracts:** `canvas-lane-tabs.component.ts:32-36` (tablist container, `overflow-x-auto` already),
  `:146-157`.
- **Dependencies:** none new.
- **Failure behaviour:** If `ResizeObserver` is undefined (jsdom), fall back silently to reveal-on-select. Guard it with
  `typeof ResizeObserver !== 'undefined'`.
- **Quality requirements:** One observer per mounted strip. At most one strip is mounted per app in Rail. Release is
  verified.
- **Verification seam:** `canvas-lane-tabs.component.spec.ts`. Mock `ResizeObserver` and assert:
  - (1) a resize callback reveals the selected tab (spy on `scrollIntoView`);
  - (2) a selection change reveals it;
  - (3) destroy disconnects the observer.

  The existing tests stay unedited.
- **Files:** MODIFY `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts`,
  `.../canvas-lane-tabs.component.spec.ts`.

### 5. Session live view: transcript gating, freeze, shared click guard

- **Purpose:** Make the existing transcript the single Rail live view and give it the tile's guarantees: surface pause
  (row 18) and effort/model freeze (row 38). Share the card click rule (row 43).
- **Responsibilities:**
  - MODIFY `CanvasDetailTranscriptComponent`:
    - `active = inject(SURFACE_ACTIVE, { optional:true }) ?? signal(true)` from the parent. It replaces the constant
      `visible` for `SESSION_VISIBLE`, `SESSION_FOCUSED` and `SURFACE_ACTIVE` (`:44-58`).
    - The registration effect registers only while `active()` is true and the tab is absent. It releases only what it
      registered (`:59-69`).
    - Call `freezeSessionOverrides(this.tabId)` (below).
  - CREATE `canvas/canvas-session-overrides.ts`. It holds `freezeSessionOverrides(tabId: Signal<string>): void`, run in
    an injection context. It is the two effects moved verbatim from `canvas-tile.component.ts:536-562`.
  - CREATE `canvas/canvas-card-click.ts`:
    - `isIgnoredCardClick(event: MouseEvent, host: HTMLElement): boolean`. It is the selection and control logic moved
      from `canvas-tile.component.ts:692-703,720-727`.
    - `isInteractiveTarget(target, host)`.
  - MODIFY `CanvasTileComponent` to call both helpers. This is behaviour-preserving. The tile spec stays unedited.
- **Verified contracts:** tokens `SESSION_CONTEXT/VISIBLE/FOCUSED/START_GUARD`, `HIDE_AGENT_SIDEBAR` from
  `@ptah-extension/chat` (`canvas-detail-transcript.component.ts:15-23`); `SURFACE_ACTIVE` from `@ptah-extension/core`
  (`:24`); `EffortStateService` and `ModelStateService` (`canvas-tile.component.ts:33-37,511-512`).
- **Dependencies:** unchanged library edges.
- **Integration points:** `CanvasLaneViewComponent` default lane (`canvas-lane-view.component.ts:117-118`), so both the
  Grid detail and the Rail focus area get it.
- **Failure behaviour:** `childInjector.destroy()` in `ngOnDestroy` stays (`:71-73`). Freezing is a no-op when an
  override already exists (`:541,555`).
- **Quality requirements:** On every swap or close, exactly one `EnvironmentInjector.destroy()` per transcript instance.
  No visible-tab registration survives a destroy that this instance made.
- **Verification seam:** `canvas-detail-transcript.component.spec.ts`. The existing two tests stay unedited. New
  cases:
  - (1) an inactive parent surface unregisters, and reactivation registers again;
  - (2) the effort/model freeze runs once;
  - (3) destroy calls `childInjector.destroy()`.

  `canvas-tile.component.spec.ts` stays unedited and must pass. It proves the helper extraction.
- **Files:** MODIFY `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts`,
  `.../canvas-detail-transcript.component.spec.ts`, `libs/frontend/canvas/src/lib/canvas-tile.component.ts`. CREATE
  `libs/frontend/canvas/src/lib/canvas-session-overrides.ts`, `libs/frontend/canvas/src/lib/canvas-card-click.ts`.

### 6. Needs-you queue: one Escape handler (#8) and focus return

- **Purpose:** Escape while the queue is open closes only the queue.
- **Responsibilities:**
  - In `closeOutside` (`canvas-needs-you-queue.component.ts:153-155`), on Escape:
    - `open.set(false)`;
    - `event.preventDefault()`, so the window handlers (`canvas-detail-keyboard.ts:9` and the Rail handler) skip it;
    - return focus to the queue trigger button (a `viewChild` on the trigger) in `afterNextRender`.
  - Answer and Open bind to the item key (`:181-186`), unchanged. In Rail, `openSession` → `detail.open` focuses and
    selects the lane (Component 3).
- **Verified contracts:** `canvas-needs-you-queue.component.ts:147-162,181-232`.
- **Failure behaviour:** Listeners are still added only while open and removed in `onCleanup` (`:156-161`).
- **Verification seam:** `canvas-needs-you-queue.component.spec.ts`, new case: with the detail open and the queue open,
  a document Escape closes the queue, `defaultPrevented` is true, the detail stays open, and focus is on the trigger.
  The existing tests stay unedited.
- **Files:** MODIFY `libs/frontend/canvas/src/lib/canvas-needs-you-queue.component.ts`,
  `libs/frontend/canvas/src/lib/canvas-needs-you-queue.component.spec.ts`.

### 7. Smart card: rail variant, request identity, carried #1/#2

- **Purpose:** One data source for every card view (Grid tile card and Rail card).
- **Responsibilities:**
  - `compact-lane-rows.ts`. The sort (`:90-94`) tie-break:
    - when both rows are ended (`done|error|stopped`), sort by `(b.endedAt ?? 0) - (a.endedAt ?? 0)`;
    - otherwise sort by `startedAt` as today.

    `total` and `counts` are unchanged. Carried #1 asks only for the order; capping the counts would change the "+N
    more" meaning.
  - `CompactSessionCardComponent`:
    - **#2:** `laneSummary` gets `equal: sameLaneSummary`, a value comparison of `rows` (same length and order, and
      per row **every** `CompactLaneRow` field: `id`, `name`, `kind`, `status`, `startedAt`, `endedAt`,
      `compact-lane.types.ts:11-20`), `moreCount`, `total` and `counts` (every `CompactLaneStatus` key). `startedAt`
      is required because the lane view derives elapsed time from it (`compact-session-lanes.component.ts:171-174`).
      A sub-agent event of another session then re-runs only the filter. There is no template work. Rev 1: if a field
      is ever added to `CompactLaneRow`, the comparator must add it; the spec pins this with a field-by-field case.
    - **Request identity (R2-1)**, callout ids:
      - Session permission: `PermissionRequest.id` (today, `:175`).
      - CLI permission: `requestId` (today, `:197`).
      - Question: add `requestId: request.id` (`AskUserQuestionRequest.id`, the same id the queue uses at
        `canvas-needs-you-queue.ts:76`).
      - Error (Rev 1, replaces the revision-based id): `requestId = 'err:' + tabId + ':' +
        (tab.terminalFailureSeq ?? 0)`. `terminalFailureSeq` is a new per-tab counter owned by chat-state
        (Component 7a). It advances in the same store update that stamps a new terminal reason, on every path,
        including `StopFailure`. The revision is not usable: `setLastTerminalReason`
        (`tab-manager.service.ts:2223-2227`, the `StopFailure` path through `turn-end-handler.service.ts:212-224`)
        and `setTurnEndedFields` (`:2204-2217`) stamp the reason without touching `lastTurnStateRevision`, which only
        `applyTurnState` writes (`:1498-1500`). So two equal-text failures on the `StopFailure` path give two ids.

      - `canRetry` stays `false`. No Retry action exists in the real model (only `:220` sets it). The Rail renders no
        Retry button (D10).
    - `respond(callout, decision)`:
      - session: unchanged (re-find by id, `:379-384`);
      - CLI: proceed only if `agentStore.agentsOwnedBySession(sessionIdentity())` still has an agent with
        `agentId === callout.agentId` whose `permissionQueue` contains `callout.requestId`. Otherwise do nothing and
        emit `staleAction`.

      `openRequest`, `openFullView` and `openLane` accept an optional shown id and act only while
      `callout()?.requestId === shownId`.
    - **Question answer (Rev 1).** New method `answerQuestion(shownId: string)`:
      - proceed only while `callout()?.kind === 'question' && callout()?.requestId === shownId`, else emit
        `staleAction` and do nothing;
      - then `openLane('orchestrator')` (`:403-411`). In the Rail the wrapper resolves it to
        `detail.open(tabId, 'orchestrator')`, which focuses the session and selects the Orchestrator lane
        (Component 3 `open`, `canvas-detail.service.ts:15`). This is the same destination the queue uses for a
        question (`canvas-needs-you-queue.component.ts:220-232`, `'orchestrator'` at `:227`).
      - The rail branch binds `(answer)="answerQuestion($event)"`. The tile branch keeps `(answer)="openFullView()"`
        unchanged (`:103`), so Grid behaviour does not change. `SessionCardActions` is not changed.
    - **Rail variant:** new inputs:
      - `variant = input<'tile'|'rail'>('tile')`
      - `density = input<CanvasRailDensity-like 'comfortable'|'dense'>('comfortable')`, typed locally in chat-ui as
        `CompactRailDensity` (no canvas import)
      - `focused = input(false)`
      - `holdText = input(false)`

      New outputs:
      - `railState = output<CompactRailState>()`, emitted from an effect when the derived state changes;
      - `staleAction = output<void>()`;
      - `lanesRequested = output<void>()` (Rev 1), emitted after `openFullView()` when the rail view's `moreLanes`
        fires.

      The template becomes `@if (variant() === 'rail') { <ptah-compact-rail-card ...> } @else { <ptah-compact-session-activity ...> }`.
      The tile branch is byte-identical to today (`:85-108`).
    - `CompactRailState` (`'running'|'needs'|'error'|'done'|'idle'`) derivation:
      - callout `permission|question` → `needs`;
      - else `summary().status.tone === 'error'` → `error`;
      - else `sessionStatus()` is `streaming|resuming` or `laneSummary().counts.running > 0` → `running`;
      - else any message → `done`;
      - else `idle`.

      Assumption A1: `tone` and the status values map as stated. Check by reading where `tone` is assigned in
      `chat-ui/molecules/compact-session/compact-session-summary.ts` (`:258,276,670` region) before writing the
      mapping.
- **Verified contracts:** `compact-session-card.component.ts:112-224,286-294,346-352,377-419`;
  `compact-lane-rows.ts:51-110`; `AgentMonitorStore.agentsOwnedBySession` (used at `:189-190`).
- **Dependencies:** chat-ui Component 8 (types and view). chat → chat-ui is existing (`:13-24`). Rev 1: Component
  7a (`TabState.terminalFailureSeq`); chat → chat-state/chat-types is existing (`TabManagerService` import, `:113`).
- **Integration points:** Grid (chat-view forced card, unchanged inputs) and the Rail card wrapper (Component 10).
- **Failure behaviour:** A stale action never posts. The card repaints because `callout()` is current, and the
  wrapper announces "That request changed. Review the new one." (spec Revision 2).
- **Quality requirements:** One elapsed timer per mounted card, as today (`:361-370`). The number of mounted cards is
  bounded by `MAX_CANVAS_TILES = 20`, and hidden workspaces mount none (D4).
- **Verification seam:**
  - `compact-lane-rows.spec.ts`: newest ended rows first; mixed active and ended order unchanged.
  - `compact-session-card.component.spec.ts`:
    - (1) a sub-agent event for another session leaves `laneSummary()` reference-equal;
    - (1b, Rev 1) a same-status, same-name update that only sets or corrects a row's `startedAt` produces a new
      `laneSummary()` with the new `startedAt`; a `kind`-only change does the same;
    - (2, Rev 1) two errors with equal text and an unchanged `lastTurnStateRevision` (the `StopFailure` shape), with
      `terminalFailureSeq` 1 then 2, get two different error `requestId`s; the same tab re-emitted with seq 1 keeps
      the id. The store side of the `StopFailure` path is proven in Component 7a's
      `tab-manager.terminal-failure.spec.ts` (1);
    - (3) a CLI Allow with a request that is no longer queued posts nothing;
    - (4) `variant='rail'` renders `ptah-compact-rail-card` and the tile variant renders the activity component;
    - (5) `railState` emits on a needs transition;
    - (6, Rev 1) a question callout carries `AskUserQuestionRequest.id`; `answerQuestion(shownId)` calls
      `SESSION_CARD_ACTIONS.openLane('orchestrator')` once;
    - (7, Rev 1) the question is replaced by a new one (new id, same text): `answerQuestion(oldId)` calls nothing and
      emits `staleAction`; `answerQuestion(newId)` routes;
    - (8, Rev 1) the tile variant's `answer` still calls `openFullView` (Grid unchanged).

  Existing tests stay unedited.
- **Files:** MODIFY `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-lane-rows.ts`,
  `.../compact-lane-rows.spec.ts`, `.../compact-session-card.component.ts`, `.../compact-session-card.component.spec.ts`.

### 7a. Terminal failure sequence (chat-state, Rev 1)

- **Purpose:** Give every terminal failure of a tab its own identity, whichever path stamps it (finding R1-2).
- **Responsibilities:**
  - MODIFY `TabState` (`chat-types.ts:783` region): add `terminalFailureSeq?: number`, documented as "advances once
    per newly stamped terminal reason; never decreases; meaningful only per tab". It is persisted like
    `lastTerminalReason` (it is not added to `NON_PERSISTED_TAB_KEYS`, `tab-persistence.ts:82-88`), so a restored
    error keeps its id.
  - CREATE `libs/frontend/chat-state/src/lib/terminal-failure-seq.ts`, pure:
    `withTerminalFailureSeq(existing: TabState, updates: Partial<TabState>): Partial<TabState>`. When `updates` has
    the `lastTerminalReason` key with a truthy value, and `existing.lastTerminalReason` is falsy or a different
    value, return `{ ...updates, terminalFailureSeq: (existing.terminalFailureSeq ?? 0) + 1 }`. Otherwise return
    `updates` unchanged (same reference).
  - Rule rationale: every new turn clears the reason first (`generating` at `tab-manager.service.ts:1508`, the
    optimistic send `markTabStreaming` at `:2819`, the reset at `:1278`), so a new failure always stamps over a
    cleared value and advances. The same failure stamped twice (the `failed` `turn_state` at `:1524`, then
    `StopFailure` at `:2223-2227`, then the Stop hook's `effectiveReason` at `turn-end-handler.service.ts:121-127`)
    does not advance, so a shown error id does not go stale by itself. The reset block at `:1262-1280` must **not**
    clear `terminalFailureSeq`, otherwise a reset followed by a failure could repeat an earlier id.
  - Apply it at the two tab writers, inside the same update, so the reason and the counter can never be observed
    apart:
    - `TabManagerService.updateTabInternal` (`tab-manager.service.ts:1334`), against `existingTab` inside the
      `_tabs.update` callback (`:1340-1345`), before the `differs` check (`:1358-1363`);
    - `TabWorkspacePartitionService.updateBackgroundTab` (`tab-workspace-partition.service.ts:372-391`), against
      `existingTab` before the spread at `:387`. This covers the background `StopFailure` and Stop-hook paths
      (`turn-end-handler.service.ts:103-107,221-223`).
- **Verified contracts:** `setLastTerminalReason` `tab-manager.service.ts:2223-2227`; `setTurnEndedFields`
  `:2204-2217`; `applyTurnState` updates `:1498-1525` and its `updateTabInternal` call `:1539`;
  `updateBackgroundTab` `tab-manager.service.ts:642-644` delegating to the partition `:372`.
- **Dependencies:** chat-types (type only). chat-state → chat-types is existing (`TabState` import).
- **Integration points:** Component 7 reads `tab.terminalFailureSeq` for the error id.
- **Failure behaviour:** A tab with no counter (an older persisted blob) reads `0`; its next new failure becomes `1`.
  Assumption A5: the restore path (`tab-persistence.ts:110-124,280-292`) keeps an unknown numeric field. Check
  `tab-restore-sanitize` for a field allow-list before relying on persistence; if it strips the field, the id still
  works from `0` after a restore, so nothing else changes.
- **Quality requirements:** No extra store write and no extra signal emission: the counter rides in the existing
  update object.
- **Verification seam:**
  - `terminal-failure-seq.spec.ts` (pure): cleared → reason advances; same reason again does not; a different
    reason advances; `null` and `undefined` do not; an update without the key returns the same reference.
  - `tab-manager.terminal-failure.spec.ts` (new file, real `TabManagerService` with the existing test wiring of
    `tab-manager.service.spec.ts`): (1) `setLastTerminalReason(id,'x')`, `markTabStreaming(id)`,
    `setLastTerminalReason(id,'x')` gives seq 1 then 2 with no `turn_state`; (2) a `failed` `turn_state` followed by
    `setLastTerminalReason` with the same reason keeps seq 1; (3) the same through `updateBackgroundTab` for a tab
    in a background workspace.
  - Existing chat-state specs stay unedited.
- **Files:** MODIFY `libs/frontend/chat-types/src/lib/chat-types.ts`,
  `libs/frontend/chat-state/src/lib/tab-manager.service.ts`,
  `libs/frontend/chat-state/src/lib/tab-workspace-partition.service.ts`. CREATE
  `libs/frontend/chat-state/src/lib/terminal-failure-seq.ts` + `.spec.ts`,
  `libs/frontend/chat-state/src/lib/tab-manager.terminal-failure.spec.ts`. The helper stays internal (no barrel
  export); only the `TabState` field is public, through the existing chat-types barrel.

### 8. CompactRailCardComponent (chat-ui, presentational)

- **Purpose:** Render the fixed-zone rail card in both densities. It has no service injection.
- **Responsibilities:**
  - Selector `ptah-compact-rail-card`. Inputs:
    - title
    - `summary` (`CompactSessionSummary`)
    - `lanes` (`CompactLaneSummary`)
    - `callout` (`CompactCallout`)
    - branch, model, elapsed, contextPercent
    - `todos` (`CompactTodoState`), `gitStats` (`CompactGitState`)
    - `state` (`CompactRailState`)
    - `density`, `focused`
    - `innerTabbable` (from `focused`)
    - `holdText`

    Outputs:
    - `selectRequested`
    - `laneSelected(key)`
    - `allow(callout)`, `deny(callout)`
    - `openRequest(callout)`
    - `answer(shownId: string)` (Rev 1, question callout)
    - `showOutput(shownId)`
    - `moreLanes`
  - Zones (spec section 1 table, Dense addendum table):
    - comfortable is 176 px: head 26, meta 16, now 20, lanes-or-callout 70 (callout 52), metrics 22;
    - dense is 96 px: grid rows `26/20/22/18`, padding 4.

    The height is a fixed `box-sizing:border-box` height on the host, bound as
    `[style.height.px]="COMPACT_RAIL_CARD_HEIGHT[density()]"` (Rev 1: from the shared constant, never a literal or a
    per-class CSS value). Content truncates. Nothing inside can change the height.
  - **Shared height pair (Rev 1, spec Dense requirement 2, `layout-design-spec.md:355`).** MODIFY
    `compact-lane.types.ts`: export
    `COMPACT_RAIL_CARD_HEIGHT: Readonly<Record<CompactRailDensity, number>> = { comfortable: 176, dense: 96 }`
    next to `CompactRailDensity`, and export it from the chat-ui barrel. It lives in chat-ui because the card cannot
    import canvas, while canvas already imports chat-ui (`canvas-session-details.component.ts:21`,
    `canvas-lane-view.component.ts:25`). The card host, the rail list item (Component 10), the shift guard and the
    scroll anchor (Component 13) read only this constant.
  - Lane rows: up to 3 real `<button>`s with an `aria-label` and `+N more` (comfortable, shown when `moreCount > 0`).
  - **Dense lane line (Rev 1, `layout-design-spec.md:286`).** `Lanes` label plus the counts text, and one `+N`
    button where **N = `lanes.total`** (not `moreCount`, `compact-lane.types.ts:23-29`). The button renders whenever
    `lanes.total >= 1`; at `total === 0` the line reads `Lanes none yet` with no button. `aria-label` "Open the N
    lanes of <title>". It emits `moreLanes`, the same output as the comfortable `+N more`, so both reach the lane
    tabs by one route. Ended rows come already sorted by Component 7.
  - **Question callout (Rev 1).** Comfortable: the question text line (selectable, ellipsis, full text in `title`)
    plus one `Answer` button. Dense: the same text on the 22 px line plus a compact `Answer` button (18 px visual,
    24 px `::after` hit area, at least 39 px wide). Accessible name "Answer <question text>" (visible word first,
    WCAG 2.5.3). The button carries `callout.requestId` and emits `answer(requestId)`. It follows the same keyed
    rebuild, roving `tabindex` and stale-focus rule as the permission buttons below. Enter and Space work because it
    is a native `<button>`; no key handler is added.
  - Callout block: keyed by `callout.requestId` (`@for (c of [callout]; track c.requestId)`), so a replaced request
    rebuilds its buttons. Every action button carries the shown id.

    Stale-callout focus rule: if `document.activeElement` was inside the removed callout, focus moves to the select
    button after render (spec section 2).
  - Select button: `aria-label` "<title>, <state>[, branch <b>][, asks permission], in focus", `aria-current` when
    focused, `tabindex` 0 only when focused, no pointer events.
  - Inner buttons: `tabindex = innerTabbable ? 0 : -1`. This is bound per render, so roving holds on every pass
    (Revision 2).
  - Text hold: while `holdText()` is true, title, now and metrics render the latched values. The callout, state bar
    and pill always render current values (spec: "a selection or focus never defers a callout change").
  - Accessible names start with the visible word (WCAG 2.5.3, dense notes). 24 px hit areas through `::after` (2.5.8).
    No muted text on state tints. State colours come from the state-ink utilities (Component 17).
  - MODIFY `compact-lane.types.ts`:
    - `CompactQuestionCallout.requestId: string`
    - `CompactErrorCallout.requestId: string`
    - `CompactRailState`
    - `CompactRailDensity`
    - `COMPACT_RAIL_CARD_HEIGHT` (Rev 1)

    Export them from the chat-ui `index.ts` (barrel region `:49-80`).
- **Verified contracts:** types `compact-lane.types.ts:11-62`; `todoTitle` / `gitTitle`
  (`compact-session-metrics.ts:47-60`), reused for titles (git title "Uncommitted changes in the whole folder" per spec
  is a text change inside `gitTitle` only if the user wants it. Not in this plan, D11 style); `CompactSessionSummary`
  (`compact-session-summary.ts:74-85`).
- **Dependencies:** chat-ui internals only (`@ptah-extension/shared`, `chat-types` types). No `chat`/`canvas` import.
- **Integration points:** used only by Component 7's rail branch.
- **Failure behaviour:** A `null` callout shows the lanes zone. `todos` `none`/`unknown` shows an em dash with
  `todoTitle`.
- **Quality requirements:** No decorative animation (row 37). No timers. No listeners other than template bindings.
- **Verification seam:** `compact-rail-card.component.spec.ts`:
  - (1) host class and height per density;
  - (2) three lane buttons plus `+N more`;
  - (3) inner `tabindex` follows `innerTabbable` across re-renders with unchanged data;
  - (4) a replaced `requestId` rebuilds the callout buttons, and focus inside moves to the select button;
  - (5) Allow emits the shown callout object;
  - (6) `holdText` keeps the now text while a new value arrives, and the callout still updates;
  - (7) the em dash and title for unknown todos;
  - (8, Rev 1) dense with `lanes.total = 1` (`moreCount = 0`): a `+1` button whose name starts "Open the 1" and ends with the
    title (spec pattern "Open the N lanes of <title>") emits `moreLanes`; dense with `total = 4`: `+4` and `moreLanes`; dense with
    `total = 0`: `Lanes none yet` and no button;
  - (9, Rev 1) a question callout renders `Answer` in both densities; click and keyboard Enter on the focused button
    emit `answer` with the shown `requestId`; the button is `tabindex=-1` when `innerTabbable` is false;
  - (10, Rev 1) the question is replaced (new `requestId`, same text) while `Answer` has focus: the button is
    rebuilt, focus moves to the select button, and the new button emits the new id;
  - (11, Rev 1) host `style.height` equals `COMPACT_RAIL_CARD_HEIGHT[density]` and does not change across a new
    `summary`, a new callout and a `holdText` flip in each density.
- **Files:** CREATE `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-rail-card.component.ts`,
  `.../compact-rail-card.component.spec.ts`. MODIFY `.../compact-lane.types.ts`, `libs/frontend/chat-ui/src/index.ts`.

### 9. CanvasRailComponent (rail column)

- **Purpose:** Rail header, card list and footer for one workspace. It renders cards and emits user intents.
- **Responsibilities:**
  - `aside[aria-label="Sessions"]`.
  - Header 72 px fixed (`overflow:hidden`):
    - Title row 28: title, `n / 9 running` meter, collapse button, density toggle `≡` (`aria-pressed`, name "Dense
      cards", hint dot plus `aria-describedby` at 12 or more sessions while comfortable, hidden while collapsed).
    - Chip row 28: one line, `nowrap`, count-only chips (words only for "needs you" and "error"),
      `aria-label "<n> <state>, jump to the next one"`, horizontal scroll with a right fade.
  - List: `ul[role="list"]` of `CanvasRailCardComponent`, in stable `order` (oldest first, never regrouped, spec Q1),
    `@for (tile of orderedTiles(); track tile.tabId)`, 8 px gap, `scrollbar-gutter: stable`, vertical scroll only.
  - Collapsed (56 px): state dot plus index per card, tooltip. Height is 56 px in both densities.
  - Footer 84 px: New session button (30) and reason text.
    - At the running cap: `aria-disabled="true"` plus `aria-describedby` with `RUNNING_CAP_MESSAGE` (D11). It stays
      focusable, and a click is refused.
    - At the tile bound: the same pattern with the bound reason (lane-proposed text "The board holds 20 sessions.
      Close one to add another.").
  - Zero state: "No sessions yet", chip row "No sessions", New session enabled.
  - Width per `railWidthBand` (304/304/288/272) through a host class.
- **Verified contracts:** `RUNNING_CAP_MESSAGE`, `MAX_RUNNING_SESSIONS` (`canvas-running-cap.ts:6-7`);
  `MAX_CANVAS_TILES` (`canvas-layout-intent.ts:13`).
- **Dependencies:** Component 10 (cards), Component 1 (types). Inputs only. It does not inject the store, so it stays
  testable as a dumb component.
- **Integration points:** Inputs: tiles, `states: ReadonlyMap<tabId, CompactRailState>`, `focusedTabId`, density,
  collapsed, band, runningCount, canStart, canAdd, `holdTabId`. Outputs: `focusRequested(tabId)`,
  `collapseToggled`, `densityToggled`, `jumpTo(state)`, `newSession`, `scrolled(px)`, and (Rev 1)
  `lanesRequested(tabId)`. Rev 1: the list keeps an 8 px gap (`RAIL_CARD_GAP`, Component 13 geometry file); slot
  heights come from the card host (`COMPACT_RAIL_CARD_HEIGHT`), never from a literal in this component.
- **Failure behaviour:** not applicable (no I/O).
- **Quality requirements:**
  - One passive scroll listener on the list, emitted through the store's debounced persistence.
  - No per-card listener.
  - Card order and height change only on add, close or density.
- **Verification seam:** `canvas-rail.component.spec.ts`:
  - (1) `role=list` and the `li` count;
  - (2) order equals `order` and does not change on a state change;
  - (3) the chips row has one line and the counts;
  - (4) the cap gives `aria-disabled`, `aria-describedby` and a refused click;
  - (5) the density toggle has `aria-pressed`, is hidden while collapsed, and shows the hint at 12 sessions;
  - (6) the zero state.
- **Files:** CREATE `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts`, `.../canvas-rail.component.spec.ts`.

### 10. CanvasRailCardComponent (canvas wrapper per card)

- **Purpose:** Wire one smart card into the rail: click rule, keyboard entry, card actions.
- **Responsibilities:**
  - Host `li` with `data-rail-card` and `data-tab-id`.
  - Renders `<ptah-compact-session-card [tab] variant="rail" [density] [focused] [holdText]>`.
  - Rev 1: the host `li` binds `[style.height.px]="COMPACT_RAIL_CARD_HEIGHT[density()]"` (imported from
    `@ptah-extension/chat-ui`), so the list slot and the card read the same pair.
  - Rev 1, lane-tab route for `+N` / `+N more`: the smart card's rail branch binds `(moreLanes)="openFullView()"`
    (`compact-session-card.component.ts:413-419`), which reaches `openSession()` → `focusTile(tabId)` below; today's
    tile "+N more lanes" is a plain span (`compact-session-lanes.component.ts:135-139`), so there is no existing
    action to reuse. The card also emits a new `lanesRequested` output (Component 7 rail branch, forwarded here), and
    the board, in `afterNextRender`, moves DOM focus to the selected `[role=tab]` of the focus area's lane strip. The
    per-tab lane choice is kept (Component 3), so `+N` never resets the lane.
  - Rev 1, question route: `answer` → the card's `answerQuestion(shownId)` →
    `SESSION_CARD_ACTIONS.openLane('orchestrator')` → `detail.open(tabId, 'orchestrator')` below (focus the session,
    select the Orchestrator lane). No new `SessionCardActions` member.
  - Implements `SessionCardActions` and provides it with
    `providers: [{ provide: SESSION_CARD_ACTIONS, useExisting: forwardRef(() => CanvasRailCardComponent) }]`:
    - `openLane(key)` → `detail.open(tabId, key)`;
    - `openSession()` → `canvasStore.focusTile(tabId)`.

    `(expandToFull)` maps to `focusTile`.
  - Host `(click)`: if `isIgnoredCardClick(event, host)` (Component 5), return. Otherwise emit `focusRequested`.
  - Forwards `railState`, `staleAction` and (Rev 1) `lanesRequested` to the rail, which re-emits them to the board.
- **Verified contracts:** `SESSION_CARD_ACTIONS`, `SessionCardActions` (`chat/tokens/session-context.token.ts:62-69`,
  exported `chat/src/index.ts:38,43`); `CompactSessionCardComponent.openLane/openFullView`
  (`compact-session-card.component.ts:403-419`).
- **Dependencies:** `CanvasStore`, `CanvasDetailService`, `TabManagerService` (the `tab` lookup by id across
  workspaces).
- **Failure behaviour:** If the tab is not found, render nothing (the prune effect removes the tile,
  `orchestra-canvas.component.ts:538-547`).
- **Verification seam:** `canvas-rail-card.component.spec.ts`:
  - (1) a non-collapsed selection inside the card does not focus;
  - (2) a click on an inner button does not focus through the host;
  - (3) a plain click focuses;
  - (4) a lane button calls `detail.open(tabId, key)`, using the real `SESSION_CARD_ACTIONS` resolution. This proves
    the `useExisting` provider (Assumption A2: a component's own providers can resolve `forwardRef` to itself for a
    child; it is the `NG_VALUE_ACCESSOR` pattern);
  - (5, Rev 1) a question callout's `Answer` (click, and Enter after focusing the button) calls
    `detail.open(tabId, 'orchestrator')` once and the card becomes the focused tile; after the question is replaced,
    an `answer` carrying the old id calls nothing and `staleAction` is forwarded;
  - (6, Rev 1) dense with 1 lane and with 4 lanes: `+1` / `+4` calls `focusTile(tabId)` and emits
    `lanesRequested`; `detail.laneKeyFor(tabId)` is unchanged;
  - (7, Rev 1) the host `li` `style.height` is 176 in comfortable and 96 in dense.
- **Files:** CREATE `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts`,
  `.../canvas-rail-card.component.spec.ts`.

### 11. CanvasFocusHeaderComponent (dumb)

- **Purpose:** The 48 px focus header, patched in place.
- **Responsibilities:**
  - Title, branch chip (truncates at 170 px), model chip (hidden below 1280), state pill.
  - Stop (only while running), Compact/Full, overflow `…` (`aria-haspopup="menu"`), Close.
  - Below 1280: icon-only buttons with `aria-label` plus `title`, `nowrap`.
  - The overflow menu is `role="menu"` with one item, `ptah-send-to-messaging [tabId]` (Q4). Esc closes it and returns
    focus to the `…` button. It stops propagation, so the Rail handler does not also act.
  - Controls are static elements bound to inputs. Only Stop is inside an `@if`. If Stop disappears while it has focus,
    focus moves to Compact (Revision 2).
  - Outputs: `stop`, `toggleViewMode`, `close`.
- **Verified contracts:** `SendToMessagingComponent` selector and `[tabId]` (`chat/components/molecules/send-to-messaging/send-to-messaging.component.ts:60`;
  usage `canvas-tile.component.ts:182-185`); `NEXT_VIEW_MODE_LABEL` text pattern (`canvas-tile.component.ts:103-107`).
- **Dependencies:** inputs only, plus `SendToMessagingComponent` from `@ptah-extension/chat`.
- **Verification seam:** `canvas-focus-header.component.spec.ts`:
  - (1) a focused Stop node stays the same element across input changes of title or pill;
  - (2) when Stop is removed while focused, Compact gets focus;
  - (3) menu Esc returns focus to `…` and the event does not propagate;
  - (4) labels are icon-only below 1280 (band input).
- **Files:** CREATE `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.ts`,
  `.../canvas-focus-header.component.spec.ts`.

### 12. CanvasFocusAreaComponent

- **Purpose:** The single live area: header, lane strip and one mounted lane.
- **Responsibilities:**
  - `section` landmark. `CanvasFocusHeaderComponent` sits **outside** the keyed block, so it is patched in place
    across samples and swaps.
  - `ptah-canvas-lane-tabs [sessionId] [laneKey]="detail.laneKeyFor(id)" (laneSelected)="detail.selectLaneFor(id, $event)"`.
  - The body is `@for (id of focusedIds(); track id) { <ptah-canvas-lane-view [tabId]="id" ...> }`. `focusedIds` holds
    0 or 1 entries. A swap therefore destroys the previous lane view, transcript, ChatView and child injector before
    the next one mounts. Draft safety: the ChatInput destroy-save (`chat-input.component.ts:730-731`) runs before the
    new composer's restore (D5).
  - Header actions:
    - Stop: if `tabManager.activeTabId() !== id`, call `focusTile(id)` first, then `chatStore.abortWithConfirmation()`
      (D12).
    - Compact: `tabManager.toggleTabViewMode(id)` (`tab-manager.service.ts:2949`, row 8; never writes `viewMode`
      otherwise).
    - Close: emitted to the board.
  - Empty: "No session in focus". The slot keeps its size.
- **Verified contracts:** `CanvasLaneViewComponent` inputs (`canvas-lane-view.component.ts:191-194`), lane tabs inputs
  and outputs (`canvas-lane-tabs.component.ts:76-79`), `ChatStore.abortWithConfirmation` (`chat.store.ts:368-370`).
- **Dependencies:** Components 3, 4, 5, 11; `TabManagerService`; `ChatStore`.
- **Failure behaviour:** Abort errors are logged with `console.error` (precedent `orchestra-canvas.component.ts:434`).
  The tab state stays authoritative.
- **Quality requirements:** At most one `ptah-canvas-lane-view` and at most one `ptah-canvas-detail-transcript` in the
  DOM.
- **Verification seam:** `canvas-focus-area.component.spec.ts`, using the tile-spec probe pattern
  (`canvas-tile.component.spec.ts:1172,1228,1315-1329`):
  - (1) swapping A→B→A leaves exactly one transcript, and each previous transcript's injector was destroyed;
  - (2) one `buildTree` per published snapshot of the focused tab, and zero for an unfocused one;
  - (3) the lane per tab is restored on a swap back;
  - (4) a removed lane falls back to Orchestrator through `selectLaneFor`;
  - (5) the header element is the same instance across a swap.
- **Files:** CREATE `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.ts`,
  `.../canvas-focus-area.component.spec.ts`.

### 13. CanvasRailBoardComponent (smart, one per retained workspace)

- **Purpose:** Compose rail, focus area and details column for one workspace path. It owns effective focus, keyboard,
  text hold, scroll anchor, live region and metrics attributes.
- **Responsibilities:**
  - Inputs `workspacePath`, `visible`. Host `[style.display]` follows the grid precedent
    (`canvas-workspace-grid.component.ts:84-86`).
  - **When not visible, render nothing inside: no cards, no focus area** (D4).
  - Effective focus: `focusedTabIdFor(path)` if it is in `tilesFor(path)()`, else the first tile by order. It is
    derived, never written (rows 11-12, grid precedent `:293-311`).
  - Close of the focused session: compute the neighbour (next, else previous) before `await removeTile(id)`. If the
    tab is gone afterwards, `focusTile(neighbour)` (spec section 2, row 33).
  - New session from the footer: `canStartRunningSession && canAddTile`, then `addTile(defaultSessionName())`, then
    `focusTile(id)`, then scroll that card into view (D9).
  - Layout grid: `rail | focus 1fr | details`. Widths come from the band (Component 1) via
    `layoutService.containerWidth()`.
    - Below 1120 the details column is a 44 px strip with a toggle (`aria-expanded`).
    - Opening it pushes (never overlays) and auto-collapses the rail to 56. Closing restores the user's collapse
      state. The auto-collapse is not persisted; only the user toggle writes `railCollapsed`.
  - Details column: `ptah-canvas-session-details [tabId]` (`canvas-detail-panel.component.ts:68-71`), body scrolls
    alone.
  - Scroll anchor: after a band change, a rail collapse, a details toggle or a density toggle, in `afterNextRender`, set
    the list's `scrollTop` to `railAnchorScrollTop(...)` (Rev 1, below), the `block:'nearest'` rule computed from the
    shared height pair instead of `scrollIntoView`, so it is exact in the same pass and testable in jsdom.
  - **Geometry (Rev 1, finding R1-5, `layout-design-spec.md:304,354-356`).** CREATE
    `canvas-rail/canvas-rail-geometry.ts`, pure, no Angular:
    - `RAIL_CARD_GAP = 8`, `RAIL_COLLAPSED_CARD_HEIGHT = 56`, and `railCardHeight(density, collapsed)` returning
      `collapsed ? 56 : COMPACT_RAIL_CARD_HEIGHT[density]` (the pair imported from `@ptah-extension/chat-ui`; this
      file re-states no 176 or 96);
    - `railAnchorScrollTop(index, height, viewportHeight, scrollTop)`: card top `index * (height + RAIL_CARD_GAP)`;
      return it if above the viewport, `top + height - viewportHeight` if below, else `scrollTop`;
    - `RailGeometryBaseline { key: string; order: readonly string[] }` with `key = density + '|' + collapsed`;
    - `checkRailGeometry(baseline, sample, expectedHeight)`, where `sample = { key, order, heights }` and the
      result is `{ baseline, shifts }`: a `null` baseline or a different `key` returns the sample as the new
      baseline and `shifts: 0` (the reset); otherwise `shifts` counts each card whose height differs from
      `expectedHeight` plus 1 if `order` differs from the baseline order.
  - **Baseline ownership (Rev 1).** The board owns one `private geometryBaseline: RailGeometryBaseline | null`
    (a plain field, not a signal, so a check never schedules work).
    - It is **reset** (set to `null`) on a density toggle and a collapse toggle (the key changes too, so a missed
      reset still re-baselines), and on a user add or close (the only permitted order changes, spec section 2). It
      is **not** reset by a focus change, a band or width change, or a details toggle (`layout-design-spec.md:86`).
    - The check runs in one `afterRenderEffect` of the board that reads `railStates()`, `orderedTiles()`, density
      and collapsed, so it runs after a state change, a callout change, a toggle and an add or close, and only while
      `visible()`. It samples `[data-rail-card]` elements of the list once (`getBoundingClientRect().height`,
      `data-tab-id` order). It does not run per stream sample; a sample cannot change a height because the host
      height is fixed (Component 8), and the Electron probe covers samples.
    - Non-zero `shifts` increments the `railShifts` metric (Component 16) and is exposed as
      `data-canvas-rail-shifts`.
  - Scroll offset: restore `railScrollTop` once after the first visible render (best effort, clamped). The `scrolled`
    output goes to `setRailScrollTop`.
  - Text hold:
    - Use one `document:selectionchange` listener plus one `pointerdown` on the list, with
      `pointerup`/`pointercancel` on the document **only while pressed**. These produce
      `holdTabId = signal<string|null>` (the card containing the selection anchor or the press).
    - Listeners are added only while `visible()` and are removed in the effect cleanup.
    - A density toggle clears the hold (the only repaint that ignores it, Dense addendum).
  - States: `railStates = signal<ReadonlyMap<tabId, CompactRailState>>`, filled from card `railState` outputs. Entries
    are pruned when a tile leaves. The map feeds chips, jumps and the live region.
  - Live region: one `aria-live="polite"` element. It announces "<title> needs you" or "<title> stopped with an error"
    on a transition into `needs` or `error`, but not on the first value for a card. It also announces the stale-action
    sentence.
  - Keyboard: host `(keydown)` delegates to `handleCanvasRailKeydown` (Component 14) for the list. The window-level
    Left/Right and Esc come from the orchestra (Component 15).
  - Metrics attributes:
    - `data-canvas-board-mode="rail"`
    - `data-canvas-live-views` (count of mounted transcripts: 0 or 1)
    - `data-canvas-focus-swaps` (Component 16 counter)
    - `data-canvas-rail-shifts` (Rev 1, Component 16 `railShifts`)
  - Rev 1, `lanesRequested(tabId)` from the rail: in `afterNextRender`, focus the focus area's selected
    `[role=tab]` (the lane strip of `tabId`, now focused by the card action). If the strip has no tab yet, focus stays
    on the card's select button.
- **Verified contracts:** store APIs (Component 2), `defaultSessionName` (`@ptah-extension/core`,
  `orchestra-canvas.component.ts:29`), `layoutService.containerWidth` (`canvas-workspace-grid.component.ts:252`).
- **Dependencies:** Components 2, 3, 9, 10, 12, 14, 16; `CanvasLayoutService`; `TabManagerService`.
- **Failure behaviour:**
  - The close-confirm is cancelled: the tile and focus are kept (store `:337-342`).
  - Add refused at the cap: no-op, and the footer reason stays.
  - A scroll restore past the end clamps.
- **Quality requirements:** No-shift contract (spec section 2).
  - Card order and height change only on a user add, close or density toggle.
  - Widths change only at bands and panel toggles.
  - Each document listener has a release path.
- **Verification seam:** `canvas-rail-board.component.spec.ts`:
  - (1) a hidden board has zero `ptah-canvas-rail-card` and zero transcripts;
  - (2) focus moves keep card DOM nodes identical (same element references) and order;
  - (3) closing the focused card focuses the next one, else the previous;
  - (4) a footer add focuses the new card;
  - (5) the details strip below 1120 auto-collapses the rail without writing `railCollapsed`;
  - (6) a density toggle writes once and clears the hold;
  - (7) the live region announces needs/error transitions only;
  - (8) BL: after 5 swaps and 1 close, `querySelectorAll('ptah-canvas-tile').length === 0`, at most one lane view, and
    no visible-tab registration remains for closed tabs;
  - (9) document listeners are removed on hide and on destroy (spy on `removeEventListener`);
  - (10, Rev 1) in each density: toggle density (baseline reset, `railShifts` 0), then a `railState` change on one
    card and then a new `tab` object for another card (a stream sample): order is unchanged, every card host and
    `li` `style.height` equals `COMPACT_RAIL_CARD_HEIGHT[density]`, and `railShifts` stays 0
    (`getBoundingClientRect` stubbed to return the bound `style.height`);
  - (11, Rev 1) negative: with one card's stubbed height wrong after the baseline, the same state change raises
    `railShifts` to 1; a focus change alone never resets the baseline (a wrong height is still counted);
  - (12, Rev 1) after a density toggle with the last card focused, the list `scrollTop` equals
    `railAnchorScrollTop` for that index and the new height;
  - (13, Rev 1) `lanesRequested` focuses the selected lane tab of the focus area.
  - `canvas-rail-geometry.spec.ts` (Rev 1): anchor above / below / inside the viewport; a key change resets with 0
    shifts; equal order and heights give 0; a reordered sample gives 1; `railCardHeight` reads the chat-ui pair and
    56 when collapsed.
- **Files:** CREATE `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`,
  `.../canvas-rail-board.component.spec.ts`, and (Rev 1) `.../canvas-rail/canvas-rail-geometry.ts` + `.spec.ts`.

### 14. Rail keyboard (pure)

- **Purpose:** One keyboard policy for the Rail, mirroring the detail handler's ignore rules.
- **Responsibilities:**
  - `handleCanvasRailKeydown(event, ctx)`, where `ctx` = `{ surfaceActive, orderedIds, focusedId, focus(id),
    focusSelectButton(id), focusInnerButtons }`.
  - Ignore: `defaultPrevented`; inputs, textarea, select, contenteditable, `[role=menu]`, `[role=listbox]`,
    `[role=dialog]`, `[popover]` (same selector as `canvas-detail-keyboard.ts:13-15`).
  - Rail list (target inside `[data-rail-card]`, on the select button or an inner button): Up/Down/Home/End move
    **and** activate (selection follows focus, D5 of the spec), then focus the new card's select button.
  - Escape from an inner button returns to its select button.
  - Window level (the board is visible): Left/Right outside tablists step the focus in order, with wrap (row 24
    parity). Escape from the focus area returns focus to the selected card's select button and never changes the
    selection (Q3).
  - Each handled key calls `preventDefault`.
- **Verified contracts:** `canvas-detail-keyboard.ts:3-34` (the pattern copied).
- **Verification seam:** `canvas-rail-keyboard.spec.ts`:
  - each key from the select button and from an inner button;
  - ignores inputs, menus, dialogs and `defaultPrevented`;
  - Left/Right ignored inside `[role=tablist]`;
  - Esc returns focus without calling `focus(id)`.
- **Files:** CREATE `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-keyboard.ts`, `.../canvas-rail-keyboard.spec.ts`.

### 15. Board toggle and OrchestraCanvas integration

- **Purpose:** Mount one mode per workspace, expose the toggle, surface persistence state and route keys.
- **Responsibilities:**
  - CREATE `CanvasBoardToggleComponent` (dumb): a "Board" segmented control, Rail | Grid, `aria-pressed`. It goes in
    the dock **before** the layout controls and the queue (spec 7). Output `modeChanged`.
  - MODIFY `OrchestraCanvasComponent`:
    - The loop at `:232-249` becomes:

      ```
      @for (path...) {
        @if (boardFor(path).mode === 'rail') { <ptah-canvas-rail-board [workspacePath] [visible]> }
        @else { <ptah-canvas-workspace-grid ...unchanged...> + detail panel }
      }
      ```
    - `ptah-canvas-layout-controls` (`:123-128`) is rendered only in Grid. Row 1: Rail replaces the Layout menu with
      the Board toggle.
    - The empty-state overlay (`:251-257`) is Grid-only. Rail shows its own zero state (row 42).
    - `detailTabId` (`:335-342`) adds `canvasStore.activeBoard().mode === 'grid'`. The existing effect (`:393-395`)
      closes the Grid detail on a switch.
    - `onDetailKeydown` (`:344-351`) routes by the active mode: Grid → `handleCanvasDetailKeydown` (unchanged),
      Rail → `handleCanvasRailKeydown` window branch through the active Rail board.
    - Dock notes (`role="status"`):
      - when `layoutPersistence.writeFailed()`: "Board layout could not be saved. Changes stay for this session.";
      - when `readOnlyPaths().has(activePath)`: "This board layout was saved by a newer Ptah version. Changes here are
        not saved."
    - The switch carries focus, lanes, drafts, cap, queue and the rail state, because all of them live in shared
      services. Nothing is recomputed. A switch never stops, closes or reloads a session (spec 7).
- **Verified contracts:** dock `orchestra-canvas.component.ts:95-224`, loop `:232-249`, gates `:335-351,393-395`,
  providers `:72-78`, `ngOnDestroy` flush `:689-693`.
- **Dependencies:** Components 2, 13, 14 and the existing ones.
- **Failure behaviour:** A toggle on a read-only path switches in memory and shows the note.
- **Verification seam:** CREATE `orchestra-canvas.rail.spec.ts`, keeping `orchestra-canvas.component.spec.ts` and
  `orchestra-canvas.detail.spec.ts` unedited. They must pass, which needs their fixture to resolve Grid: the plan
  requires the Grid path when a v2 record or a test persistence stub sets mode `grid`. Assumption A3: those specs mount
  Grid only if their persistence stub returns `board.mode='grid'`, or `board: null` maps to Rail. Check by reading how
  those specs provide `CanvasLayoutPersistenceService`. If they use the real service with empty storage, they now get
  Rail. The executor then adds one `beforeEach` that seeds a `grid` v3 record, and records that edit.

  New cases:
  - (1) default is Rail, with a toggle to Grid and back;
  - (2) a workspace switch keeps per-workspace modes;
  - (3) only one mode is mounted per workspace;
  - (4) a hidden Rail workspace mounts nothing live (one transcript in the DOM in total);
  - (5) the Grid detail closes on a switch to Rail;
  - (6) the queue Esc does not close the Grid detail (#8, integration);
  - (7) the write-failed and newer-version notes;
  - (8) the cap text in the Rail footer.
- **Files:** CREATE `libs/frontend/canvas/src/lib/canvas-board-toggle.component.ts`,
  `libs/frontend/canvas/src/lib/canvas-board-toggle.component.spec.ts`,
  `libs/frontend/canvas/src/lib/orchestra-canvas.rail.spec.ts`. MODIFY
  `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts`.

### 16. Render metrics counters

- **Purpose:** Row 41 for Rail.
- **Responsibilities:** Add `focusSwaps` and `liveViewMounts` to `CanvasRenderMetrics` / `EMPTY_METRICS`
  (`canvas-render-metrics.service.ts:3-31`). The focus area increments them per keyed remount. Rev 1: add
  `railShifts`, incremented by the board's geometry check (Component 13) through `increment` (`:44-54`).
- **Verification seam:** `canvas-render-metrics.service.spec.ts`, existing tests unedited, plus one case for the new
  keys saturating.
- **Files:** MODIFY `libs/frontend/canvas/src/lib/canvas-render-metrics.service.ts`, `.../canvas-render-metrics.service.spec.ts`.

### 17. State-ink tokens (contrast #10)

- **Purpose:** State bar, dot and ring colours that pass 3:1 (WCAG 1.4.11) in both themes.
- **Responsibilities:**
  - In `tailwind.config.js`, add `--state-ink-run|need|err|done|idle` to each anubis theme object, next to `--bcm`
    (`:105` dark, `:174` light).
    - Light uses the spec values: `#2a56c6 #8f5200 #b4232a #13713a`, idle `#6b6570`.
    - Dark uses the real fills: run `#3b82f6`, need `#f97316`, done `#16a34a`, idle `#6b7280`. For err, the lighter
      `#ef4444` (D14, lane-proposed: about 4.07:1 on `#242430`, against 3.16:1 for `#dc2626`).
  - Add colours `state-run` … `state-idle` = `var(--state-ink-*)` beside `base-content-muted` (`:31`). Tints use CSS
    `color-mix(in oklch, var(--state-ink-x) 14%, transparent)` in component styles.
  - Themes that lack the variables fall back to the DaisyUI semantic colour: `var(--state-ink-run, oklch(var(--in)))`.
    This mirrors the `--bcm` fallback rule (`:26-29`).
  - CREATE `state-ink-contrast.spec.ts`, modelled on `base-content-muted.spec.ts`. It reads the literal theme objects
    and asserts each state ink is at least 3:1 against `base-100/200/300` in both anubis themes.
- **Verified contracts:** `tailwind.config.js:31,97-122,165-181`; spec pattern `base-content-muted.spec.ts:1-40` (uses
  `culori/require`).
- **Failure behaviour:** If a ratio is below 3:1, the spec fails. The Electron re-check measures the composites
  (spec section 5).
- **Files:** MODIFY `apps/ptah-extension-webview/tailwind.config.js`. CREATE
  `apps/ptah-extension-webview/src/app/state-ink-contrast.spec.ts`.

## Integration architecture

- **Data flow:**
  1. Hydration: `TabManagerService` tabs, then `CanvasStore.hydrateWorkspace` loads the v3/v2/v1 record, then tiles
     and board state are set, then `markHydrated`.
  2. The orchestra picks the mode per path.
  3. The Rail board derives effective focus. Cards (`CompactSessionCardComponent` rail variant) read `TabState`,
     `PermissionHandlerService`, `AgentMonitorStore` and `SessionGitStatsStore` (existing) and emit `railState`. The
     board aggregates chips and the live region.
  4. A user focus calls `CanvasStore.focusTile`, which makes the tab active. The focus area remounts the keyed lane
     view, and the transcript gives ChatView its `SESSION_*` tokens.
  5. Lane choice flows through `CanvasDetailService` (per tab).
  6. A permission action flows card → `AgentPermissionResponder` (session by id, CLI by id and a queue membership
     check).
  7. Board-state changes go `CanvasStore` setters → `CanvasLayoutPersistenceService.schedule` → a debounced v3 write.
- **State or persistence:**
  - Board state, tile intent and focus are owned by the panel-scoped `CanvasStore` (`orchestra-canvas.component.ts:72-78`).
    They live as long as the canvas panel, and are persisted per workspace and panel (`storageKey`,
    `canvas-layout-persistence.service.ts:151-155`).
  - The lane map and the hold, state and live-region signals are panel-scoped and not persisted.
  - Drafts are root-scoped (`composer-draft.store.ts:19`).
  - The scroll offset is persisted best effort.
- **External boundaries:** localStorage is the only untrusted input. Zod parses every record from `unknown`, with
  `.catch` fallbacks per board field. Strict objects reject unknown keys inside `board` and the tiles, so a malformed
  record does not become intent. No new RPC.
- **Failure and rollback:**
  - Storage failures leave memory authoritative and surface `writeFailed`.
  - A newer record is never overwritten.
  - A stale request action is refused, repainted and announced.
  - A cancelled close keeps focus.
  - Rollback of the feature: the Board toggle to Grid restores today's surface per workspace, with Grid intent intact.
    A v3 record makes older builds (main writes v2, `git show main:…persistence.service.ts:14`) render default layout
    read-only. This is the existing forward-safety contract (inventory constraint 10).
- **Observability:**
  - Host attributes `data-canvas-board-mode`, `data-canvas-live-views`, `data-canvas-focus-swaps` on the Rail board.
  - The existing `data-canvas-*` stay on the Grid.
  - The one-time `console.warn` per storage failure kind.
  - The dock status notes.

## Architecture-level quality requirements

- **Functional:**
  - Default Rail for new, v1 and v2 records.
  - Per-workspace mode, collapse, density and scroll.
  - Exactly one mounted transcript ChatView or lane panel per app in Rail. Zero for hidden workspaces.
  - Lane selection restored per tab.
  - The F5 draft survives every swap and mode switch.
  - Card actions act only on the shown request id.
  - The cap guard on New session, resume and wrap-up (transcript `SESSION_START_GUARD`,
    `canvas-detail-transcript.component.ts:50-53`).
  - Hard bound 20.
- **Performance:**
  - One `buildTree` per published snapshot (focused view only).
  - Card summaries are sampled at 2/s or less (`CARD_SUMMARY_SAMPLE_MS = 500`, `compact-session-card.component.ts:58`).
  - A sub-agent event of another session causes no card template work (#2).
  - No window-resize listener is added. One ResizeObserver is added on the lane strip.
  - Document listeners exist only while needed.
- **Security:** Stored input is validated with zod. No string-built commands or queries. No secrets.
- **Maintainability:**
  - chat-ui stays presentational: no import of `chat`, `chat-state` or `canvas`.
  - canvas → chat → chat-ui direction is unchanged.
  - `scope:webview`/`type:feature` tags are unchanged.
  - Grid files are touched only where listed (orchestra gate and dock; tile helper extraction).
  - No `as any`. No NgModule.
- **Testability:**
  - Each component has a jsdom spec at its boundary, listed above.
  - Geometry (no-shift, contrast, heap) is proven in Electron (re-check list below), not in jsdom.

## Parity (parity-inventory-layout.md rows 1-44)

Grid column: "today" means unchanged code. Its proving test is the existing one cited in the inventory, and that test
must still pass unedited, except D16 and A3. Rail tests name the new spec and case from the components above.

| # | Capability | Rail destination | Grid destination | Test that proves it |
|---|---|---|---|---|
| 1 | Layout menu in dock | Board toggle in the dock (layout controls hidden in Rail) | today | Rail: `orchestra-canvas.rail.spec.ts` (1); Grid: `canvas-layout-controls.component.spec.ts` "offers three named presets…" |
| 2 | Presets | none (Grid only) | today | `orchestra-canvas.component.spec.ts` "routes a dock preset request…" |
| 3 | Lock | none (Grid only) | today | `orchestra-canvas.component.spec.ts` "toggles lock state…" |
| 4 | Drag reorder | none (stable order) | today | grid spec "a finished drag reorders by (y, x)…" |
| 5 | Resize to span | none | today | grid spec "a finished resize snaps only the dragged tile…" |
| 6 | Row break | none | today | grid spec "commits an explicit 2+1 break…" |
| 7 | Layout focus | the focus area itself | today | grid spec `describe('layout focus')` |
| 8 | Compact/full toggle | focus header Compact (Component 11/12) | today | Rail: `canvas-focus-header.component.spec.ts` + `canvas-focus-area.component.spec.ts` (toggle calls `toggleTabViewMode`); Grid: tile spec "toggles the view mode once per click…" |
| 9 | Compact height stepper | none (fixed card heights) | today | tile spec `describe` `:783-905` |
| 10 | Stored view mode vs auto card | Rail never writes `viewMode`; focus slot uses the stored mode (no `SESSION_FORCED_CARD`) | today | Rail: `canvas-focus-area.component.spec.ts` (transcript injector has no forced card); Grid: chat-view spec "forces a compact card…" `:2369` |
| 11 | `focusTile` | card click, keys, chips, queue | today | Rail: `canvas-rail-card.component.spec.ts` (3), `canvas-rail-keyboard.spec.ts`; Grid: orchestra "canvasTabRequests effect adopts…" |
| 12 | Effective focus | derived first-by-order when null or stale | today | Rail: `canvas-rail-board.component.spec.ts` (3); Grid: grid "keeps the first tile live…" |
| 13 | Auto card at 3+ | moot: one live view at any count | today | Rail: `canvas-focus-area.component.spec.ts` (1); Grid: `canvas-live-budget.spec.ts` |
| 14 | Detail ⇒ all cards | moot | today | Grid: `canvas-grid-items.spec.ts` "turns the focused tile into a card…" |
| 15 | 1-2 tiles side by side | none (Rail from session 1, row 44b) | today | Grid: orchestra "closes detail when its tile is removed…" |
| 16 | Singleton modes | none | today | grid "keeps a singleton full…" |
| 17 | Hidden workspaces mounted | host retained, nothing mounted inside (D4) | today | Rail: `orchestra-canvas.rail.spec.ts` (4), `canvas-rail-board.component.spec.ts` (1); Grid: orchestra "keeps workspace A grid mounted…" |
| 18 | Hidden pause / deregister | transcript surface gate; hidden board mounts none | today | Rail: `canvas-detail-transcript.component.spec.ts` (1); Grid: tile "unregisters when it becomes hidden…" |
| 19 | Persisted layout | v3 record (Component 1) | same record, Grid reads `tiles` | `canvas-layout-persistence.service.spec.ts` (1)-(7); `canvas.store.spec.ts` (1)-(5) |
| 20 | Hydration, adoption, requests | appended cards; `focus:true` → focus area | today | Grid/both: orchestra "hydrates exact existing tab ids…", "drains a burst…"; Rail: `orchestra-canvas.rail.spec.ts` (1) with adopted tab |
| 21 | Detail open/close | none; `open` focuses and selects a lane in Rail | today | Rail: `canvas-detail.service.spec.ts` (2); Grid: "toggles the same tab and lane closed" |
| 22 | Detail geometry | none | today | `canvas-detail-geometry.spec.ts` |
| 23 | Detail locks grid | none | today | row 22 specs |
| 24 | Esc, Left/Right | Rail keyboard (Component 14) | today | Rail: `canvas-rail-keyboard.spec.ts`; Grid: `orchestra-canvas.detail.spec.ts` "closes and steps only while detail is open" |
| 25 | Lane tabs | focus area tab strip with reveal | detail strip (same component) | `canvas-lane-tabs.component.spec.ts` (new 1-3 + existing) |
| 26 | Card lane row → lane | lane buttons → `detail.open(tab, key)`; dense `+N` (N = `lanes.total`, shown at 1+ lanes) → focus + lane tabs (Rev 1) | today | Rail: `canvas-rail-card.component.spec.ts` (4)(6), `compact-rail-card.component.spec.ts` (8), `canvas-rail-board.component.spec.ts` (13); Grid: tile "focuses its tile for both forced-card actions" |
| 27 | Detail transcript + details | focus lane view + details column | today | Rail: `canvas-focus-area.component.spec.ts` (1)(3), `canvas-rail-board.component.spec.ts`; Grid: panel spec |
| 28 | Needs-you queue | dock queue, card callouts (permission Allow/Deny/Open; Rev 1: question `Answer` bound to the shown question id → focus + Orchestrator lane, both densities), chips | today | `canvas-needs-you-queue.component.spec.ts` (new Escape case + existing); Rail: `canvas-rail.component.spec.ts` (3), `compact-session-card.component.spec.ts` (6)(7), `compact-rail-card.component.spec.ts` (9)(10), `canvas-rail-card.component.spec.ts` (5) |
| 29 | Cap 9 + gate | footer `aria-disabled` + reason, meter | today | Rail: `canvas-rail.component.spec.ts` (4), `orchestra-canvas.rail.spec.ts` (8); Grid: orchestra "disables the New Session trigger…" |
| 30 | Send guard at cap | transcript `SESSION_START_GUARD` | today | Rail: `canvas-detail-transcript.component.spec.ts` (existing guard + focus-area mount); Grid: tile "provides the cap guard…" |
| 31 | Hard bound 20 | footer disabled with the bound reason; rail scrolls | today | Rail: `canvas-rail.component.spec.ts` (4); Grid: orchestra "…does NOT focus when adoptTab returns null" |
| 32 | Hand off banner | inside the live ChatView | today | chat-view spec "blocks the budget wrap-up send…" `:1340` |
| 33 | Tile close | focus header Close + neighbour focus | tile × | Rail: `canvas-rail-board.component.spec.ts` (3); Grid: store "keeps the tile and focus when the close confirm is cancelled" |
| 34 | Header actions | focus header incl. overflow Send to messaging (Q4) | today | Rail: `canvas-focus-header.component.spec.ts` (3); Grid: tile spec menu cases |
| 35 | Drafts per tab | keyed remount: destroy-save then restore (D5) | today | `chat-input.component.spec.ts:304,319,333`; Rail: `canvas-focus-area.component.spec.ts` (1); Electron `s-draft3.mjs` |
| 36 | Scroll | rail list, transcript and details scroll independently; scroll anchor | today | Rail: `canvas-rail-board.component.spec.ts` (5)(6); Grid: grid "keeps intent byte-identical…" |
| 37 | Unfocused animation pause | cards have no decorative animation | today | Rail: `compact-rail-card.component.spec.ts` (no animate classes); Grid: tile "provides the focused input…" |
| 38 | Effort/model freeze | freeze on transcript mount (helper) | today (helper) | Rail: `canvas-detail-transcript.component.spec.ts` (2); Grid: tile "snapshots the global default…" unedited |
| 39 | BL release | no detached tile, lane panel or injector after swap or close; no Gridstack in Rail | engine release | Rail: `canvas-rail-board.component.spec.ts` (8), `canvas-focus-area.component.spec.ts` (1), Electron `s-heap.mjs`; Grid: grid `describe('stale Gridstack node release')`, `canvas-grid-release.engine.spec.ts` |
| 40 | One `buildTree` per snapshot | focused view only | per tile | Rail: `canvas-focus-area.component.spec.ts` (2); Grid: tile `:1315` |
| 41 | Render metrics | Rail host attributes + 2 counters | grid host | Rail: `canvas-render-metrics.service.spec.ts` new case + board attribute check; Grid: existing |
| 42 | Dock ticker, message, empty state | dock shared; Rail zero state | empty board | Rail: `canvas-rail.component.spec.ts` (6); Grid: orchestra "renders reserved dock…" |
| 43 | Card keyboard / click / selection | rail card select button, roving, click guard | tile | Rail: `canvas-rail-card.component.spec.ts` (1)(2), `compact-rail-card.component.spec.ts` (3); Grid: tile "keeps a card text selection…" |
| 44 | Prune / cross-workspace close | same store effects; the lane map is pruned too | same | orchestra "closed-tab effect…" (both), `canvas-detail.service.spec.ts` (4) |

## Decisions

| # | Decision | Options | Evidence | Reversible |
|---|---|---|---|---|
| D1 | Per-path `@if` mode switch inside the existing workspace loop | separate Rail loop; global mode | `orchestra-canvas.component.ts:232-249`; spec D10 | yes |
| D2 | One smart card with a `variant` input; a new chat-ui view for rail zones | canvas-side smart card plus extracted model; tile forced card | `compact-session-card.component.ts:112-352`; tile is a ChatView `canvas-tile.component.ts:425-433` | yes |
| D3 | The Rail live view is the existing lane view and transcript, remounted by `track` focused id | persistent ChatView with a swapped context | `canvas-lane-view.component.ts:50,117`; `canvas-detail-transcript.component.ts:41-47` | yes |
| D4 | A hidden Rail workspace keeps its host but mounts no cards and no focus area. The spec says "only its rail cards stay". | keep the cards mounted (paused) | hidden tabs are not reactive (`canvas.store.ts:199-202`), so hidden cards would be stale; card timers `compact-session-card.component.ts:361-370`; inventory constraint 8 keeps `RETAINED_WORKSPACE_CAP` | yes |
| D5 | No new draft-flush API. Destroy-save before the next mount, plus per-edit saves. | explicit flush call from the board | `chat-input.component.ts:730-731,1533-1547`; spec `chat-input.component.spec.ts:319` | yes |
| D6 | `CanvasDetailService.open` stays the single entry and is mode-aware; per-tab lane map | separate Rail lane service | queue `canvas-needs-you-queue.component.ts:220-232`, tile `:682-685` call `open` | yes |
| D7 | The transcript follows the parent `SURFACE_ACTIVE` instead of a constant `true` (also in Grid detail) | Rail-only flag | `canvas-detail-transcript.component.ts:44`; tile gating `canvas-tile.component.ts:532-534` | yes |
| D8 | Extract `freezeSessionOverrides` and `isIgnoredCardClick` from the tile. These are the same contracts (rows 38, 43) used in two places, so drift would be a correctness bug. | copy the code | `canvas-tile.component.ts:536-562,692-727` | yes |
| D9 | The Rail footer New session creates with `defaultSessionName()` and focuses it. The dock keeps the named popover. | open the name popover from the footer | `orchestra-canvas.component.ts:641-651`; spec section 2 "(7) New session takes focus" | yes |
| D10 | (Rev 1) Error id = `'err:' + tabId + ':' + tab.terminalFailureSeq`, a per-tab counter that chat-state advances in the same update that stamps a new terminal reason on every path, `StopFailure` included (Component 7a). No Retry is rendered, because no Retry exists in the model. | id from the error text (prototype, rejected R2-1); turn-state revision + reason (Rev 0, rejected: `StopFailure` and the Stop hook stamp without a revision); a card-local counter (rejected: lost on remount, hidden cards are not mounted, D4) | `compact-session-card.component.ts:215-222`; `tab-manager.service.ts:1498-1500,2204-2227`; `turn-end-handler.service.ts:212-224` | yes |
| D11 | Keep `RUNNING_CAP_MESSAGE` for the Rail reason. The spec sentence "9 of 9 … Nothing was stopped." is not adopted. The literal appears in 5 Grid/chat specs. | change the constant and the 5 specs | `canvas-running-cap.ts:7`; literal in `canvas.store.spec.ts`, `orchestra-canvas.component.spec.ts`, `canvas-tile.component.spec.ts`, `canvas-detail-transcript.component.spec.ts`, `chat-input.component.spec.ts` | yes (one constant + 5 literals) |
| D12 | Stop makes the focused tab active first, then calls `abortWithConfirmation` | a new per-tab abort API | `conversation.service.ts:179-191` aborts the active tab | yes |
| D13 | State inks are per-theme CSS variables in `tailwind.config.js` plus a contrast spec | component-local constants; `styles.css` | `--bcm` precedent `tailwind.config.js:31,105,174`; `base-content-muted.spec.ts` | yes |
| D14 | Dark error ink `#ef4444` (lane-proposed) | keep `#dc2626` (3.16:1 on b3) | computed sRGB ratios against `#242430`; row 52 "lighter dark error red" | yes |
| D15 | Keep `console.warn` for storage warnings. The "Logger not console" rule has no frontend target. | add a Logger | no frontend Logger class exists; `canvas-layout-persistence.service.ts:294` | yes |
| D16 | Edit the 2 persistence spec assertions that pin the load-result shape | keep the shape and add a second method | `canvas-layout-persistence.service.spec.ts:39-43,82-86` | yes |
| D17 | v2 → v3 upgrade happens on the first real change, not at hydration | write v3 at once | `canvas.store.ts:546-548`; minimises older-build read-only exposure | yes |
| D18 | Esc conflict in the spec: section 1 says the overflow menu returns focus to its button; section 5 says return to the selected card. Resolution: an open menu or queue returns focus to its own invoker and consumes the key. The next Esc (nothing open) returns focus to the selected card. | always the card | `layout-design-spec.md:29,135-136`; Revision 2 queue rule `:254` | yes |
| D19 | Breakpoints come from `layoutService.containerWidth()` bands, not CSS container queries, so auto-collapse and widths share one source | container queries | `orchestra-canvas.component.ts:396-401` | yes |

## Clarifications Needed

none. Every open point was settled from code or recorded as a reversible decision. D4, D9, D11 and D14 can be
overturned by the user without a redesign.

## Lane-introduced constraints

- D14 dark error ink `#ef4444`, confirmed in the Electron re-check.
- The tile-bound reason text "The board holds 20 sessions. Close one to add another." (Component 9).
- The dock note texts for write failure and newer version (Component 15).
- The non-integer version is read-only (Component 1). It keeps today's 2.5 behaviour under v3.
- Auto-collapse below 1120 is not persisted (Component 13).
- The live-region sentences (Component 13).
- Assumptions to resolve first:
  - **A1:** tone mapping in `compact-session-summary.ts`.
  - **A2:** a `useExisting: forwardRef` self-provider resolves for the child card, proved by
    `canvas-rail-card.component.spec.ts` (4).
  - **A3:** the existing orchestra specs resolve Grid or need a seeded `grid` record (Component 15).
  - **A4:** the `@if/@else` mode swap destroys the old branch before creating the new one in the same pass, so the
    composer saves before the new one restores. Prove it with an orchestra rail spec case: type a draft, switch mode,
    the draft is restored. Even in the reverse order, `chat-input.component.spec.ts:319` covers safety.
  - **A5 (Rev 1):** the tab restore path keeps the new numeric `terminalFailureSeq` (Component 7a). Not
    load-bearing: without it the id restarts at 0 after a restore and still advances per failure.

## Team-leader handoff

- **Recommended executors:** `frontend-developer` for every batch (Angular webview code, specs, Tailwind tokens). This
  is a CLI codex lane per batch, as in rows 41-44.
- **Complexity:** HIGH. Eighteen components (Rev 1 adds 7a) across 6 projects, a persisted-schema version change, and a live-view
  contract with leak and draft-safety requirements.
- **Dependencies and ordering:**
  - R0 (Rev 1) and R8 have no dependency.
  - R2 needs R0 and R1.
  - R4a and R4b need R3.
  - R5 needs R2 and R3.
  - R6 needs R4a, R4b and R5.
  - R7 needs R6.
- **Parallel-safe work:** R0, R1, R3 and R8 are file-disjoint. R4a and R4b are file-disjoint. Code may be written in
  parallel, but **checks run one at a time** (CLAUDE.md).
- **Proposed batch split** (the team-leader re-derives it; each batch is one commit, up to about 8 files and 40-60
  tool calls):

| Batch | Project | Files | Tests in the batch |
|---|---|---|---|
| R0 (Rev 1) | `@ptah-extension/chat-types`, `@ptah-extension/chat-state` | `chat-types.ts`, CREATE `terminal-failure-seq.ts` + spec, `tab-manager.service.ts`, `tab-workspace-partition.service.ts`, CREATE `tab-manager.terminal-failure.spec.ts` | `terminal-failure-seq.spec.ts`, `tab-manager.terminal-failure.spec.ts`; existing chat-state specs unedited |
| R1 | `@ptah-extension/chat-ui` | `compact-lane.types.ts`, CREATE `compact-rail-card.component.ts` + spec, `src/index.ts` | `compact-rail-card.component.spec.ts` |
| R2 | `@ptah-extension/chat` | `compact-lane-rows.ts` + spec, `compact-session-card.component.ts` + spec | `compact-lane-rows.spec.ts`, `compact-session-card.component.spec.ts` |
| R3 | `@ptah-extension/canvas` | CREATE `canvas-board-mode.ts`, `canvas-layout-persistence.service.ts` + spec, `canvas.store.ts` + spec | persistence and store specs |
| R4a | `@ptah-extension/canvas` | `canvas-detail.service.ts` + spec, `canvas-lane-tabs.component.ts` + spec, `canvas-needs-you-queue.component.ts` + spec | those three specs |
| R4b | `@ptah-extension/canvas` | `canvas-detail-transcript.component.ts` + spec, CREATE `canvas-session-overrides.ts`, CREATE `canvas-card-click.ts`, `canvas-tile.component.ts` | transcript spec + `canvas-tile.component.spec.ts` (unedited) |
| R5 | `@ptah-extension/canvas` | CREATE `canvas-rail/canvas-rail-keyboard.ts` + spec, `canvas-rail.component.ts` + spec, `canvas-rail-card.component.ts` + spec, `canvas-focus-header.component.ts` + spec | those four specs |
| R6 | `@ptah-extension/canvas` | CREATE `canvas-rail/canvas-focus-area.component.ts` + spec, `canvas-rail-board.component.ts` + spec, CREATE `canvas-rail-geometry.ts` + spec (Rev 1), `canvas-render-metrics.service.ts` + spec | those four specs |
| R7 | `@ptah-extension/canvas` | CREATE `canvas-board-toggle.component.ts` + spec, CREATE `orchestra-canvas.rail.spec.ts`, `orchestra-canvas.component.ts` | toggle spec, rail spec, existing `orchestra-canvas.component.spec.ts` and `orchestra-canvas.detail.spec.ts` |
| R8 | `ptah-extension-webview` | `tailwind.config.js`, CREATE `src/app/state-ink-contrast.spec.ts` | `state-ink-contrast.spec.ts`, `base-content-muted.spec.ts` |

- **Files affected:**
  - CREATE:
    - `libs/frontend/canvas/src/lib/canvas-board-mode.ts`
    - `libs/frontend/canvas/src/lib/canvas-session-overrides.ts`
    - `libs/frontend/canvas/src/lib/canvas-card-click.ts`
    - `libs/frontend/canvas/src/lib/canvas-board-toggle.component.ts` + `.spec.ts`
    - `libs/frontend/canvas/src/lib/orchestra-canvas.rail.spec.ts`
    - `libs/frontend/canvas/src/lib/canvas-rail/{canvas-rail-board,canvas-rail,canvas-rail-card,canvas-focus-area,canvas-focus-header}.component.ts` + specs
    - `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-keyboard.ts` + spec
    - `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-geometry.ts` + spec (Rev 1)
    - `libs/frontend/chat-state/src/lib/terminal-failure-seq.ts` + spec (Rev 1)
    - `libs/frontend/chat-state/src/lib/tab-manager.terminal-failure.spec.ts` (Rev 1)
    - `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-rail-card.component.ts` + spec
    - `apps/ptah-extension-webview/src/app/state-ink-contrast.spec.ts`
  - MODIFY:
    - `libs/frontend/canvas/src/lib/{canvas-layout-persistence.service,canvas.store,orchestra-canvas.component,canvas-tile.component,canvas-needs-you-queue.component,canvas-render-metrics.service}.ts` (+ listed specs)
    - `libs/frontend/canvas/src/lib/canvas-detail/{canvas-detail.service,canvas-lane-tabs.component,canvas-detail-transcript.component}.ts` (+ specs)
    - `libs/frontend/chat/src/lib/components/molecules/compact-session/{compact-lane-rows,compact-session-card.component}.ts` (+ specs)
    - `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-lane.types.ts`
    - `libs/frontend/chat-ui/src/index.ts`
    - `libs/frontend/chat-types/src/lib/chat-types.ts` (Rev 1)
    - `libs/frontend/chat-state/src/lib/{tab-manager.service,tab-workspace-partition.service}.ts` (Rev 1)
    - `apps/ptah-extension-webview/tailwind.config.js`
  - REWRITE: none.
- **Verification points:**
  - Resolve A1-A4 before the dependent batch.
  - Confirm that no new import in chat-ui reaches `@ptah-extension/chat`, `chat-state` or `canvas`.
  - Confirm that `canvas/src/index.ts` exports nothing new (Rail components stay internal).
  - Confirm `it.each([99, 2.5, 3.5])` stays read-only.
  - Confirm the existing canvas, chat and chat-ui specs pass unedited, except D16 and A3.

### Checks for every batch (STRICT, CLAUDE.md — repeat verbatim in every lane prompt)

- Test only the changed project. First the changed specs, one at a time:
  `npx nx test <project> --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  (never `--testPathPattern`).
- Then the project once:
  `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`.
- Then `npx nx typecheck <project> --parallel=1 --skip-nx-cache` and
  `npx nx lint <project> --parallel=1 --skip-nx-cache`.
- One heavy check at a time across all lanes. No workspace-wide runs. No `build`, `serve`, `dev`, `e2e` or `package`.
  No `npm install`.
- Filter output. Jest summary lines carry ANSI codes, so redirect to a file, strip `\x1b\[[0-9;]*m`, and grep
  `Tests:|Test Suites:|FAIL `.
- Backend Jest that loads better-sqlite3 fails until the user rebuilds it. Frontend Jest is fine.
- Per batch `<project>`:
  - R0 (Rev 1): `@ptah-extension/chat-state` (test the two new specs one at a time, then the project once, then
    typecheck and lint), then `@ptah-extension/chat-types` typecheck and lint only (its `project.json` declares
    `lint` and `typecheck`, and the batch adds no spec there). One project at a time.
  - R1: `@ptah-extension/chat-ui`
  - R2: `@ptah-extension/chat`
  - R3-R7: `@ptah-extension/canvas`
  - R8: `ptah-extension-webview`. Run test and lint only. The webview app is not typechecked by rule (decisions row
    35); the Electron re-check builds it.

## Electron re-check list (after implementation)

1. Rail and Grid, dark (`anubis`) and light (`anubis-light`), at 1920, 1600, 1280 and 920 px canvas widths. Rail with 0, 1, 3, 9 and
   12 sessions, comfortable and dense.
2. `s-draft3.mjs` F5 must pass. That means a draft typed in A survives: focus B and back to A, Rail to Grid to Rail, and
   a workspace switch. A data-loss failure blocks the PR.
3. F6: a text selection on a card title, Now line or callout does not change focus, and the selection survives a stream
   sample (hold).
4. F7 Escape and #8: with the queue open, Esc closes only the queue (the Grid detail stays open), and focus returns to
   the queue button. In Rail, Esc from the focus area returns focus to the selected card. The overflow-menu Esc returns
   focus to `…`.
5. F3: sub-agent lanes appear on the cards, with ended rows newest first (#1). "+N more" / `+N` open the lane tabs.
6. No-shift probe, prototype-probe style (`.ptah/tmp/final-run/proto-rail-probe.mjs` logic):
   - card order, tops and heights are unchanged across focus changes, state changes, permission/error simulations and
     samples;
   - after a density toggle, there is exactly one height per density (176/96);
   - the focused card stays in view after a rail collapse, a details toggle and a width change.
7. R2-2: select the last lane tab at a wide canvas, open a side panel so the canvas narrows to 920, and the selected
   tab stays visible.
8. R2-1: a replacement permission, a replacement question, and two equal-text errors (Rev 1: at least one through the
   `StopFailure` path). Allow, Open or Answer on the old shown id does nothing and is announced, and the queue and card
   stay consistent. Answer on a current question focuses the session on the Orchestrator lane, by pointer and by
   keyboard, in both densities.
9. Cap of 9 text: the meter reads `9 / 9 running`. New session has `aria-disabled` with `RUNNING_CAP_MESSAGE`. Resume
   and wrap-up are refused with the same reason. The hard bound of 20 shows the bound reason.
10. `s-heap.mjs` BL heap: after 20 focus swaps and 3 closes in Rail, there are no detached `ptah-canvas-tile`,
    `ptah-canvas-lane-view`, `ptah-canvas-detail-transcript` or `chat-msg-slot`, and at most one live ChatView. Run the
    Grid baseline again.
11. Contrast (#10), measured in the built app in both themes:
    - computed `--bcm` after gamut clipping;
    - the state inks (`--state-ink-*`, including `#ef4444` dark error) on b1/b2/b3 and on the focused surface;
    - 14 % tint composites;
    - DaisyUI hover and focus mixes;
    - the focus ring, the callout border, and the lane-strip edge fades over the surface.

    Text needs 4.5:1 or more and UI 3:1 or more.
12. Mode persistence: reload keeps each workspace's mode, collapse, density and scroll. A v2 record from main opens as
    Rail with its Grid layout intact after a toggle.

## Revision 1

Source: `implementation-plan-rail-review.md` (codex cross-side logic review, REVISE 6/10). Each finding is fixed in
the plan body; this table maps it. Decisions D1-D9 and D11-D19, batches R1-R8 and the STRICT checks are unchanged
except as listed. Plan line numbers are as of this revision.

| Finding | What changed | Plan lines |
|---|---|---|
| 1. Serious: Rail cards lose the question Answer action | Component 7: question callout keeps `requestId = AskUserQuestionRequest.id`; new `answerQuestion(shownId)` guarded by the shown id (stale → `staleAction`), routing `openLane('orchestrator')`, so the Rail focuses the session on the Orchestrator lane (queue precedent `canvas-needs-you-queue.component.ts:227`); tile branch keeps `(answer)="openFullView()"` (`compact-session-card.component.ts:103`). Component 8: `answer(shownId)` output and an `Answer` button in comfortable and dense, same keyed rebuild, roving tabindex and stale-focus rule. Component 10: route through `detail.open(tabId,'orchestrator')`, no new `SessionCardActions` member. Tests: card spec (6)(7)(8), rail-card view spec (9)(10), wrapper spec (5) (replacement / stale id refused, keyboard Enter). Parity row 28 and Electron item 8 updated. | 402-410, 458-462, 542, 565-571, 612-615, 678-680, 703-705, 1088, 1259-1263 |
| 2. Serious: D10 error id does not advance on `StopFailure` | New Component 7a in chat-state: `TabState.terminalFailureSeq`, advanced by a pure `withTerminalFailureSeq` inside the same update in both tab writers (`updateTabInternal`, `updateBackgroundTab`) whenever a truthy reason is stamped over a cleared or different one, so `StopFailure`, Stop hook and `failed` `turn_state` all share one identity source and a duplicate stamp of one failure does not advance. Error id = `'err:' + tabId + ':' + seq`. D10 rewritten with the rejected revision-based id. New batch R0 (`@ptah-extension/chat-types`, `@ptah-extension/chat-state`) with its project-scoped checks; R2 now needs R0. Assumption A5 added (not load-bearing). Tests: `terminal-failure-seq.spec.ts`, `tab-manager.terminal-failure.spec.ts` (two equal-text `StopFailure` stamps → seq 1, 2; duplicate stamp keeps 1; background tab), card spec (2). | 384-390, 438-439, 451-455, 468-520, 1119, 1151-1152, 1158-1162, 1174, 1195-1196, 1205-1206, 1231-1233 |
| 3. Moderate: lane summary comparator omits fields | `sameLaneSummary` compares every `CompactLaneRow` field (`id`, `name`, `kind`, `status`, `startedAt`, `endedAt`) plus `moreCount`, `total`, every `counts` key. Test (1b): a same-status `startedAt` update and a `kind`-only change produce a new summary; test (1) unrelated-session event stays reference-equal. | 373-378, 448-450 |
| 4. Moderate: dense `+N` underspecified | Component 8: dense `+N` uses `N = lanes.total` (not `moreCount`), shown whenever `total >= 1`, `Lanes none yet` and no button at 0, name "Open the N lanes of <title>", emits `moreLanes`. Components 7/9/10/13: `moreLanes` → `openFullView()` → `focusTile`, plus a new `lanesRequested` output that the board uses to focus the selected lane tab; the per-tab lane is kept. Tests: rail-card view spec (8) for 1, 4 and 0 lanes; wrapper spec (6); board spec (13). Parity row 26 updated. | 421-422, 560-564, 609-611, 647-649, 672-677, 688, 706-707, 838-840, 871, 1086 |
| 5. Moderate: density geometry acceptance incomplete | One shared pair `COMPACT_RAIL_CARD_HEIGHT = {comfortable:176, dense:96}` in chat-ui (`compact-lane.types.ts`, barrel-exported), read by the card host, the list `li`, the shift guard and the scroll anchor. New pure `canvas-rail-geometry.ts` (gap, collapsed 56, `railAnchorScrollTop`, `checkRailGeometry`). The board owns `geometryBaseline`; it is reset on a density toggle, a collapse toggle and a user add/close, never on focus, width or details. New `railShifts` metric and `data-canvas-rail-shifts`. Tests: view spec (11), wrapper spec (7), board spec (10)(11)(12) (toggle, then a state change and a stream sample in each density keep order and height), geometry spec. R6 gains the geometry file + spec (8 files). The Electron no-shift probe (item 6) is kept unchanged. | 549-559, 589, 616-617, 647-649, 670-671, 708, 791-814, 837, 863-876, 958-959, 1181, 1194, 1252-1257 |

Verdict for the reviewer: all five findings addressed in the body; one decision changed (D10); one batch added
(R0); no new public API in `canvas`; chat-ui still imports nothing from `chat`, `chat-state` or `canvas`.
