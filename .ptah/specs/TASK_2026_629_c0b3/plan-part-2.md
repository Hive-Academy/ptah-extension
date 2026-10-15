# Implementation Plan Part 2 - TASK_2026_629_c0b3 (steps 4-5)

## Inputs and constraints

- Requirements used: `task-description.md` requirement 4 (`:145-161`),
  requirement 5 (`:163-178`), ownership boundary (`:243-292`);
  `prototypes/01-board.html` (detail, notch, Esc, arrows).
- Corrections applied (TASK_2026_628 owner update):
  1. 628 Batch 7 edits `canvas-workspace-grid.component.ts` lifecycle
     (`removeWidget(el, false, false)` on tile-set change, per-tile option
     pruning, clear on destroy; today the loop skips gone tiles at `:758-761`).
     The grid hunks here (H1-H4) stay out of that code, and are skipped on the
     spike NO-GO path.
  2. 628 Batch 5 moves tiles to the `tab-<id>` tree key and removes `tile-`.
     The detail transcript uses the normal tab/ChatView path and never calls
     `buildTree` with its own key.
  3. 628 keeps `AgentMonitorStore` public signals stable; 629 does not edit
     the store, agent-card, agent-card-output or markdown.
- Scope: steps 4 and 5 only. Steps 1-3 (card, board mode, budget) and 6-7 are
  planned by other architects. Contracts this part needs from part 1: a
  board-mode signal on `OrchestraCanvasComponent`, a card host with
  `data-canvas-card="<tabId>"`, and card calls into `CanvasDetailService`.
- Missing decision-critical input: none. Open checks are listed as
  Assumptions A1-A6.

## Codebase evidence

| Evidence | Location | Implication |
| --- | --- | --- |
| Gridstack version is `^12.5.0` | `package.json:174` | Angular wrapper `GridstackComponent` / `gridstack-item`; `grid.load(items)` adds/removes nodes to match the list. |
| Grid options: `column: 12`, `cellHeight: 120`, `float: false`, `margin: 8`, `animate: true` | `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:214-229` | With gravity on, any extra node pushes every node below it (changes their `y`). |
| Template renders one `gridstack-item` per tile from `items()` | `canvas-workspace-grid.component.ts:107-144` | The item list is the only Gridstack input. A detail node must be in it or outside `<gridstack>`. |
| The grid adapter is authoritative: it diffs every engine node against the derived layout and calls `grid.load(positioned...)` with tiles only | `canvas-workspace-grid.component.ts:750-800` | A foreign node (detail widget) is not in `positioned`. The next apply pass removes it or puts tiles back to their derived `y`. Option (a) fights the projection. |
| Per-node `noMove`/`noResize` derive from `locked()` / layout focus | `canvas-workspace-grid.component.ts:330-353` | The detail must not add a third freeze source in the adapter (628 region). |
| Requirement 4 AC2: Gridstack `x/y/w/h` of every tile is the same before and after open | `task-description.md:154` | Any approach that writes Gridstack `y` fails AC2. Rows below may shift visually only. |
| Requirement 4 AC1: if Gridstack cannot do it, fallback is a fixed bottom panel | `task-description.md:153` | Option (c) is the named fallback. |
| Prototype: detail is a DOM node inserted after the last card of the clicked row, Esc closes, ←/→ move with wrap, `scrollIntoView({block:'nearest'})` | `prototypes/01-board.html:194-223`, `:263-276` | Rows below shift down in the prototype (normal flow). |
| Prototype detail layout: header, tab strip `role="tablist"`, view, inspector column 300px with `hideAgents` | `prototypes/01-board.html:37-57`, `:201-203` | Session details column has no agent list (AC6). |
| 628 owns the canvas tile `ElementRef` leak, the grid adapter leak and tile registries | `task-description.md:251`, `:265-267` | This part must not add maps or arrays of tile `ElementRef`s. |

## Step 4 - Detail row below the clicked card

### Gridstack spike (first batch, go/no-go)

The spike is the first batch of step 4. It is a spec plus a short note
`spike-detail-row.md` in this task folder. It does not ship UI.

Options compared (by code read; the spike confirms in a spec):

| Option | What it does | Evidence against / for | Verdict |
| --- | --- | --- | --- |
| (a) Full-width Gridstack widget (`w:12`, `noMove`, `noResize`, `locked`) inserted after the clicked row | Gridstack places it at `y = rowEnd`. With `float: false` (`canvas-workspace-grid.component.ts:220`) gravity pushes every node below to `y + h`. | 1. AC2 (`task-description.md:154`) compares Gridstack `x/y/w/h` of all tiles: rows below change `y`, so AC2 fails. 2. The adapter is authoritative: `applyAuthoritativeGeometry` diffs every engine node and calls `grid.load(positioned...)` with tiles only (`:750-800`). The next apply pass removes the foreign node or moves tiles back. 3. `onGridChange` (`:114`) would see the pushed `y` values as a gesture/drift. 4. It needs hunks in the same node loop that 628 Batch 7 edits (`:758-761`). | Rejected |
| (b) Non-Gridstack overlay, sibling of `<gridstack>`, absolutely positioned at the clicked row's bottom edge; rows below shift down with a CSS `transform: translateY(var(--ptah-detail-h))` | Gridstack nodes are never written. Tile `x/y/w/h` stay the same (AC2). `transform` is compositor-only. The grid is set static while the detail is open through the existing `locked` input (`:202`, `setStatic` at `:436`), so no drag measures transformed tiles. | Needs the row bottom (pixel) and the set of tiles below. Both come from the layout the grid already computes (`layout()` `:293`, `items()` `:324`). That is a small template + computed hunk in the grid file, away from the lifecycle code. | **Chosen (go)** |
| (c) Fixed bottom panel in the canvas host | Panel docks at the bottom of the canvas area. No grid change. | Meets AC1 fallback (`task-description.md:153`). Loses "below its row" and the notch alignment. Zero overlap with 628. | Fallback (no-go path) |

Spike steps (spec `canvas-detail-row.spike.spec.ts` in `libs/frontend/canvas`):

1. Mount `CanvasWorkspaceGridComponent` with 6 tiles (3 rows). Record every
   engine node `{id,x,y,w,h}` from `gridComp().grid.engine.nodes`.
2. Set `detailTabId` to the first tile of row 2 and `locked` true. Flush.
3. Assert: engine nodes are deep-equal to step 1; the detail host element is a
   sibling of `gridstack` (not a `gridstack-item`); tiles with `y >= rowEnd`
   carry class `ptah-below-detail`; tiles above do not.
4. Trigger one forced apply pass (change container width signal) and repeat the
   assert. This proves the authoritative `grid.load` does not undo or fight
   the overlay.
5. Clear `detailTabId`. Assert: no detail element in the DOM, no
   `ptah-below-detail` class, nodes deep-equal to step 1.

Go/no-go criterion: GO for (b) when all five asserts pass in jsdom AND a manual
check in the webview shows (i) the panel top edge aligns with the row bottom
within one `margin` (8px), (ii) rows below are visible below the panel, (iii)
`gridstack` scroll height grows by the panel height. NO-GO (any assert fails,
or the transform breaks scroll/hit testing) selects (c), and the grid file is
not edited at all. Record the result and the option name in
`spike-detail-row.md`.

### Decision

Chosen: (b) overlay after the row, rows below shift down visually (as in the
prototype, `prototypes/01-board.html:194-213`). Gridstack geometry and
persisted layout intents are never touched, so `CanvasStore` intents,
`workspaceRevision` and the 628 lifecycle code stay as they are. While the
detail is open the grid is static through the existing `locked` input, which
the board host already owns as an input binding (no new freeze path in the
adapter). Rejected: (a) breaks AC2 and fights the authoritative `grid.load`
pass; (c) is kept only as the NO-GO path.

Assumption A1: `items()` (`:324-362`) carries no `y`. The hunk adds a
`detailRowEnd` computed from `layout().tiles` (which has `y`/`h`, as the diff
at `:765-769` shows). Check: open `CanvasLayoutService.computeLayout` return
type before coding.
Assumption A2: Gridstack 12 positions items with inline `top/left`, not
`transform`, so a `translateY` on `gridstack-item` does not conflict. Check in
the spike manual step; if it conflicts, apply the transform to the inner
`ptah-canvas-tile` host instead.

### Components, contracts, data flow

**4.1 `CanvasDetailService`** (component-scoped state, no store edit)

- Purpose: hold which session and which lane the detail shows.
- Provided in `OrchestraCanvasComponent.providers`, so cards (part 1), the
  grid and the panel inject the same instance through the element tree.
- API: `openTabId: Signal<string|null>`, `laneKey: Signal<LaneKey>`,
  `toggle(tabId, laneKey = 'orchestrator')` (same id and no lane = close),
  `open(tabId, laneKey)`, `selectLane(laneKey)`, `close()`,
  `step(dir: 1 | -1, orderedTabIds: readonly string[])` (wraps at ends, AC4.4).
- `LaneKey` = `'orchestrator' | \`cli:${agentId}\` | \`sub:${key}\` | \`bg:${id}\``.
  This string is the contract part 1 cards use for lane-row clicks (AC5.4).
- Holds ids only. No `ElementRef`, no DOM node, no map of tiles
  (`task-description.md:265-267`).

**4.2 Board host wiring** (`orchestra-canvas.component.ts`)

- `detailTabId = computed(...)`: `openTabId()` only when board mode is on
  (part 1 owns the "count > budget" signal) AND the id is in the current tile
  list. Else `null`. This gives AC4.7 (1-2 tiles: no detail) and AC4.8 (closed
  tile: detail gone in the same change detection).
- An `effect` calls `close()` when `openTabId()` is set and the tile is gone, so
  a re-added tab does not reopen the detail.
- Binding at `orchestra-canvas.component.ts:186-190`:
  `[locked]="locked() || detailTabId() !== null"` and
  `[detailTabId]="detailTabId()"`. The grid is static while the detail is open
  (existing `setStatic` path, `canvas-workspace-grid.component.ts:434-436`).
- Projects `<ptah-canvas-detail-panel ptahCanvasDetail ...>` inside
  `<ptah-canvas-workspace-grid>`, inside `@if (detailTabId(); as id)`.

**4.3 Grid hunks** (`canvas-workspace-grid.component.ts`, overlap: yes — rebase
over 628 Batch 7). Exact hunks, all away from the lifecycle code at
`:750-800` and from `removeWidget`/option pruning/destroy:

- H1 (inputs, next to `locked` at `:202`): `readonly detailTabId = input<string|null>(null);`
- H2 (new computeds, placed after `items` `:324-362`): `detailGeometry`
  computed from `layout()` (`:293`) and `layoutService.containerHeight()`:
  `{ rowEnd, topPx, heightPx, notchPct, belowIds: ReadonlySet<string> }` or
  `null`. `rowEnd = max(y+h)` of tiles that share the clicked tile's row;
  `topPx = rowEnd * cellHeight`; `heightPx = max(320, containerHeight - cellHeight * clickedRowH - 2*margin)`
  (fixed height, so no `ResizeObserver`); `notchPct = (x + w/2) / 12 * 100`.
- H3 (template `:122-125` and after `:144`): on `gridstack-item` add
  `[class.ptah-below-detail]="detailGeometry()?.belowIds.has(item.tabId)"`.
  After `</gridstack>` add one absolutely positioned wrapper
  `div.ptah-detail-slot` with `[style.top.px]`, `[style.height.px]`,
  `[style.--ptah-notch-pct.%]`, containing
  `<ng-content select="[ptahCanvasDetail]" />`. Host binding
  `[style.--ptah-detail-h.px]`.
- H4 (styles `:146+`): `:host { position: relative }`;
  `:host ::ng-deep gridstack-item.ptah-below-detail { transform: translateY(var(--ptah-detail-h)); }`;
  `gridstack` gets `padding-bottom: var(--ptah-detail-h, 0)` so scroll height
  grows. No `content-visibility`. No animation loop (one CSS transition on
  `transform` only).
- The grid does not read the card DOM. Geometry comes from the layout
  projection only.

**4.4 `CanvasDetailPanelComponent`** (`ptah-canvas-detail-panel`, new)

- Inputs: `tabId` (required). Reads `CanvasDetailService` for the lane.
- Layout from prototype `01-board.html:37-57`, `:201`: header (title, status,
  close button), body grid `minmax(0,1fr) 300px`: main (lane tabs + view) and
  the session details column.
- Notch: a `::before` on the panel at `left: var(--ptah-notch-pct)`.
- `role="region"`, `aria-label="Session detail"`.
- On open: `scrollIntoView({ block: 'nearest' })` on its own host
  (prototype `01-board.html:213`), once per open, in `afterNextRender`.

**4.5 `CanvasDetailTranscriptComponent`** (Orchestrator view, new)

- Mounts `ChatViewComponent` through `NgComponentOutlet` with a child
  `EnvironmentInjector`, the same pattern as the tile
  (`canvas-tile.component.ts:613-632`): `SESSION_CONTEXT` (tabId signal),
  `SESSION_VISIBLE`, `SESSION_FOCUSED`, `SURFACE_ACTIVE`, plus
  `HIDE_AGENT_SIDEBAR: true` (Tribunal precedent:
  `tribunal-panel/.../conductor-tile.component.ts:221`).
- This is the normal tab/ChatView path. It never calls `buildTree` and never
  names a cache key. After 628 Batch 5 it uses the `tab-<id>` key with no
  change here.
- Destroys the child injector in `ngOnDestroy` (release path).
- Budget: in board mode cards (part 1) mount no `ChatViewComponent`, so the
  detail transcript is the only one (AC4.5). Assumption A3: the tile's
  visible-tab registration (`canvas-tile.component.ts:630` unregisters) must
  be mirrored here through the public `TabManagerService` register/unregister
  methods. Check: grep `registerVisibleTab` in `canvas-tile.component.ts`
  and copy the same call; do not edit the registry.

**4.6 `CanvasSessionDetailsComponent`** (details column, new, no agent list)

- Reuses existing chat-ui molecules as they are:
  `ptah-session-stats-summary` (`chat-ui/src/lib/molecules/session/session-stats-summary.component.ts:87`),
  `ptah-session-cost-summary` (`.../session-cost-summary.component.ts:21`),
  `ptah-token-badge` (`chat-ui/src/lib/atoms/token-badge.component.ts:27`),
  `ptah-todo-list-display` (`chat-ui/src/lib/molecules/tool-execution/todo-list-display.component.ts:33`).
- Assumption A4: no `ptah-context-*` or session git component exists by
  selector. Check: if part 1's card has a context bar component, reuse it;
  else render a `<progress>` from the tab's context-usage fields. Git: reuse the
  branch/dirty data part 1 shows on the card; do not add a host channel.
- Inputs are read from `TabManagerService` tab state by `tabId`. Computed,
  OnPush, no timers.

### Keyboard and focus

- Card activation (AC4.9): part 1 card host has `role="button"`,
  `tabindex="0"`, Enter/Space call `detail.toggle(tabId)`. Second click on the
  same card closes (AC4.3).
- Esc: handled on the board host `(keydown.escape)`. Closes the detail and
  returns focus to the card by `querySelector('[data-canvas-card="<tabId>"]')`
  at close time (no stored refs).
- ←/→: handled on the board host when the detail is open. Ignored when the
  event target is `input`, `textarea`, `[contenteditable]`, inside
  `[role="tablist"]`, or `event.defaultPrevented`. Calls
  `detail.step(±1, tileOrder)`; tile order is the `CanvasStore` tile order.
- On open, focus moves to the selected tab in the tab strip.
- Lane tablist: roving `tabindex`, ←/→/Home/End move between tabs and stop
  propagation (so they do not switch session), Enter/Space select.

### Failure behaviour

- Tile closed while open: `detailTabId()` becomes `null`, panel and
  transcript are destroyed, the effect clears the service (AC4.8).
- Tile count drops to the budget: board mode ends, `detailTabId()` is `null`.
- Tab has no session id yet: ChatView shows its own empty state; lane strip
  shows Orchestrator only.
- Spike NO-GO: grid file is not edited; the panel mounts in a fixed bottom
  slot of `orchestra-canvas`; notch hidden; all other contracts the same.

### Unit tests (Jest, `libs/frontend/canvas`)

- `canvas-detail.service.spec.ts`: toggle open/close, same-card close,
  `step` wrap both ends, `open` with lane key.
- `canvas-workspace-grid.detail.spec.ts` (from the spike): engine nodes
  `x/y/w/h` deep-equal before/after open and close (AC4.2, AC4.3); only tiles
  below get `ptah-below-detail`; no `gridstack-item` added.
- `orchestra-canvas.detail.spec.ts`: 6 tiles, open one, `ptah-chat-view` host
  count is 1 (AC4.5); 2 tiles: no detail element (AC4.7); remove the open tile:
  no `ptah-canvas-detail-panel` in DOM (AC4.8); Esc closes; ←/→ wraps; arrow
  in an input does nothing.
- `canvas-session-details.component.spec.ts`: renders stats/cost/todos, no
  `ptah-agent-card` and no agent list (AC4.6).

## Step 5 - Lane tabs in the detail panel

**5.1 `CanvasLaneTabsComponent`** (`ptah-canvas-lane-tabs`, new)

- Inputs: `tabId`, `sessionId` (real session id of the tab).
- Derives groups in the component from public store signals only
  (`task-description.md:268-271`):
  - Sub-agents: `AgentMonitorStore.sessionSubagentsForSession(sessionId)`
    (`chat-streaming/src/lib/agent-monitor.store.ts:933`).
  - CLI lanes: `AgentMonitorStore.agents()` (`:794`) filtered by
    `agentVisibleInSession(agent.parentSessionId, sessionId)`
    (`chat-streaming/src/lib/session-scope.ts:60`).
  - Background: Assumption A5: background agents come from
    `BackgroundAgentStore` (named at `session-scope.ts:56`). Check its public
    session-scoped signal and the component the monitor uses
    (`ptah-background-agent-strip`, `chat-ui/src/lib/molecules/background-agent-strip.component.ts:157`).
- Order: Orchestrator, Sub-agents, CLI lanes, Background; empty groups hidden
  (AC5.1). `role="tablist"`, each tab `role="tab"` with `aria-selected`,
  `aria-controls`.
- Lanes that end keep their tab with the terminal status until the store
  clears them (AC5.8). No local copy of agents is kept.
- If the selected `laneKey` no longer resolves, the view falls back to
  Orchestrator.

**5.2 `CanvasLaneViewComponent`** (one open tab only)

- One `@switch` on the lane kind. Angular destroys the previous view on
  switch, so only the open tab subscribes (AC5.5).
- Orchestrator: `CanvasDetailTranscriptComponent` (4.5).
- CLI lane: `<ptah-agent-card [agent]>` as is
  (`chat/src/lib/components/molecules/agent-card/agent-card.component.ts:34`,
  input `:120`). It already renders task (`:69-92`), elapsed (`:51`, `:142`),
  status header, Stop (`:56`, `:178`) and output
  (`ptah-cli-agent-output`, `:101-113`). No fork (AC5.3).
  Assumption A6: output renders only when `agent().expanded` (`:67`).
  Check how `AgentMonitorPanelComponent` handles `(toggleExpanded)`
  (`agent-monitor-panel.component.ts:538`) and call the same public store
  method once when the tab opens. If no public method exists, see request R2.
- Sub-agent: the same pair the monitor panel uses
  (`agent-monitor-panel.component.ts:568-578`): `ptah-subagent-usage-summary`
  and `ptah-subagent-transcript-viewer`
  (`chat-ui/src/lib/molecules/subagent-transcript-viewer.component.ts:41`).
  Stop: `AgentMonitorStore.stopAgent(taskId, ownerSessionId)` (`:2441`).
- Background: the existing background component (A5).
- Permissions (CLI and sub-agent): Allow/Deny with the existing protocol:
  `VSCodeService.postMessage({ type: MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_RESPONSE, payload: { requestId, decision, reason? } })`
  then `AgentMonitorStore.clearPermission(agentId)`
  (`canvas/src/lib/tile-agent-mini-panel.component.ts:125-143`). This is the
  third use of this logic (mini panel, monitor panel `:487-520`, lane view),
  so move the two methods into `agent-permission-responder.ts` (injectable,
  canvas lib) and make the mini panel call it. No new host channel.
- Stop failure: `stopAgent` rejects -> button re-enables, store status stays
  the source of truth; the agent card's own `isStopping` path handles CLI.

**5.3 Sidebar** (AC5.7)

- Provide `HIDE_AGENT_SIDEBAR: true` in the tile child injector
  (`canvas-tile.component.ts:618-623`, one provider line) and in 4.5.
  Consumers: `chat-view.component.ts:243`, `:268`. The single chat view does
  not get the provider, so it is unchanged.

**5.4 Lane-row click on a card** (AC5.4): part 1 card calls
`CanvasDetailService.open(tabId, laneKey)`.

Unit tests:

- `canvas-lane-tabs.component.spec.ts`: group order, empty groups hidden,
  foreign-session agents filtered by `agentVisibleInSession`, terminal lane
  keeps tab, unknown lane falls back.
- `canvas-lane-view.component.spec.ts`: one `ptah-agent-card` instance at a
  time; switching destroys the previous (AC5.5); sub-agent Stop calls
  `stopAgent(taskId, ownerSessionId)`; Allow/Deny post the existing message
  and clear the permission.
- `agent-permission-responder.spec.ts` and the existing mini-panel spec stay
  green.
- `canvas-tile` spec: `HIDE_AGENT_SIDEBAR` resolves `true` inside the tile.
- Grep check in review: no new file under `libs/frontend/canvas` declares
  selector `ptah-agent-card*`.

Verification (only if needed, CLAUDE.md): `npx nx test canvas --parallel=1`
or Jest on changed specs with `--coverage=false --maxWorkers=2`. One heavy
check at a time. No build/serve/e2e.

## Files to touch (part 2)

| Path | Create/modify | Step | Overlap with 628? |
| --- | --- | --- | --- |
| `.ptah/specs/TASK_2026_629_c0b3/spike-detail-row.md` | create | 4 (spike) | no |
| `libs/frontend/canvas/src/lib/canvas-workspace-grid.detail.spec.ts` | create | 4 (spike) | no |
| `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts` | modify (H1-H4 only) | 4 | yes — rebase over 628 Batch 7; hunks at `:202`, after `:362`, template `:122-125`/`:144`, styles; none in `:750-800` or lifecycle code. Skipped on NO-GO. |
| `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts` | modify (providers, `detailTabId`, binding `:186-190`, keydown, projection) | 4 | no (part 1 also edits it: coordinate) |
| `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail.service.ts` (+spec) | create | 4 | no |
| `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-panel.component.ts` | create | 4 | no |
| `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts` | create | 4 | no (uses tab path; no cache key) |
| `libs/frontend/canvas/src/lib/canvas-detail/canvas-session-details.component.ts` (+spec) | create | 4 | no |
| `libs/frontend/canvas/src/lib/orchestra-canvas.detail.spec.ts` | create | 4 | no |
| `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts` (+spec) | create | 5 | no (reads store public API only) |
| `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts` (+spec) | create | 5 | no (mounts agent-card unchanged) |
| `libs/frontend/canvas/src/lib/agent-permission-responder.ts` (+spec) | create | 5 | no |
| `libs/frontend/canvas/src/lib/tile-agent-mini-panel.component.ts` | modify (`:125-143` delegate) | 5 | no |
| `libs/frontend/canvas/src/lib/canvas-tile.component.ts` | modify (one provider line in `:618-623`) | 5 | yes — 628 owns the tile `ElementRef` leak; this hunk only adds a provider, no refs |

## Requests to 628 (part 2)

- R1: Keep `canvas-workspace-grid.component.ts` lines `:107-145` (template),
  `:202` (inputs) and the space after `items` (`:362`) free of structural
  moves in Batch 7, or tell us the new anchors, so H1-H4 rebase cleanly.
- R2: Confirm the public store method that sets `MonitoredAgent.expanded`
  (used by the monitor panel `(toggleExpanded)`) stays public and stable, or
  that `ptah-agent-card` renders output without `expanded`. 629 will not
  edit the store.
- R3: Confirm the canvas tile env injector block (`canvas-tile.component.ts:613-632`)
  stays as a provider array in Batch 7, so 629 adds one
  `HIDE_AGENT_SIDEBAR` line there.
- R4: Confirm the `tab-<id>` build (Batch 5) has one owner per tab when two
  `ChatViewComponent`s for the same tab could exist for one frame (card mode
  switch to detail), so the detail does not trigger a second build.
