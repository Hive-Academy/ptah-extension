# Task description — Scale the Orchestra Canvas beyond nine tiles

Status: R1-lite + R4a implemented and awaiting independent logic/style review.
Step 0 session identity remains independently approved. R4b persistence,
hydration and disposal work has not started.

## Problem

`CanvasStore.MAX_TILES = 9` and `RETAINED_WORKSPACE_CAP = 4` are memory brakes,
not product choices. They exist because the canvas retains the wrong thing.

Two facts drive everything below.

1. **Every tile builds a full chat surface.** `CanvasTileComponent` creates a
   child `EnvironmentInjector` in `ngOnInit` and instantiates `ChatViewComponent`
   (`libs/frontend/canvas/src/lib/canvas-tile.component.ts:235-247`, `:107-114`).
   The `@if (childInjector())` guard reads like a choice but is only a readiness
   check, so it is always true. There is no tile-level virtualization.
2. **A hidden workspace stays mounted.** The grid host only sets `display: none`
   (`canvas-workspace-grid.component.ts:55`). Four retained workspaces times nine
   tiles is up to 36 chat surfaces, plus the always-mounted main panel, which
   retains up to eight transcript trees.

The `visible` input does not stop rendering. It only defers streaming flushes and
freezes the transcript view model. A hidden tile is still built and still in the
DOM.

The user's own summary of the symptom is that the compact tile "looks and feels
very bad". That is the same problem seen from the front: the compact view is a
smaller transcript, so it saves neither pixels nor work.

## Two tracks

The user confirmed the target is **25 to 50 sessions running at the same time**,
not merely open. That splits the work.

| Track | Owns | Bounds |
|---|---|---|
| **R — Renderer** | Tile fidelity, compact redesign, zoom, intent persistence, notifications | How much the UI costs per open session |
| **C — Concurrency** | Running-session budget, streaming flush cost, transcript retention, provider rate limits | How much the system costs per running session |

Track R does not bound Track C. A chip costs the same backend session as a full
tile. Do not raise `MAX_TILES` until Track C has a measured answer.

## In scope

### Track R

**Step 0 — Session identity.** A prerequisite found after the review. A
notification and a compact status line both need to say *which* session they
refer to, and today nothing can. See "Session identity" under Design decisions.

1. **Instrumentation and contracts.** Begin with R1-lite counters for canvas
   layout passes, Angular option writes, explicit Gridstack `update()` calls and
   gesture commits. Establish one post-mount geometry owner before row behavior
   changes. Full Live-surface/streaming instrumentation and the LOD admission
   table remain later renderer work; row layout does not depend on them.
2. **Compact tile redesign.** Replace the scrolling activity feed with a bounded
   summary view model that has two adapters, one for live `StreamingState` events
   and one for finalized `ExecutionNode` messages.
3. **Tile shell split and level-of-detail allocation.** Separate the tile shell
   from the heavy chat surface. Add a central allocator with a Live budget.
4. **Manual row layout and versioned canvas intent persistence.** Preserve
   explicit early row breaks, expose an Auto / 1 / 2 / 3 tiles-per-row
   preference, and persist both with order and bounded weight per workspace and
   panel. Validate at the storage boundary. Never persist raw Gridstack
   geometry. Defer `detailPin` and its schema version until LOD exists.
5. **Zoom.** A continuous `zoomScale` for the transform and a stable `zoomStop`
   for fidelity.
6. **Notification center.** A new `libs/frontend/notification-center` library.
7. **Cross-workspace focus routing.** One acknowledged activation transaction.
8. **Host integration.** The bell beside the theme toggle in both shells.

### Track C

Track C begins with an investigation, because nothing here has been measured.

1. Measure one running session end to end: renderer memory, backend memory,
   event rate, and CPU.
2. Determine whether any concurrency limit exists today in `agent-sdk` or
   `cli-agent-runtime`, and where a budget would belong.
3. Measure `BatchedUpdateService` flush cost as the count of streaming visible
   tabs rises. It flushes per RAF for every registered visible tab
   (`libs/frontend/chat-streaming/src/lib/batched-update.service.ts:85-124`).
4. Measure localStorage pressure. `TabState.messages` retains full finalized
   execution trees and persists them (`tab-persistence.ts:24-31`). Fifty long
   transcripts may exceed the quota. Define the eviction policy if so.
5. Define provider rate-limit and cost guardrails, and the queue behavior when
   the budget is full.

## Out of scope

- A freeform pan-and-zoom viewport that replaces Gridstack positioning. Revisit
  only if infinite space and cross-cluster drag become real requirements.
- Any change to the `TileLayout` shape. `libs/frontend/tribunal-panel` imports it
  and mutates positions through `updateTilePosition`.
- Re-adding `x`, `y`, `w` or `h` to `CanvasTile`.
- Making `CanvasStore` root-scoped. It must stay per panel.
- Raising `MAX_TILES` in this task. That is gated on Track C.

## Constraints

- Angular 21 signals, standalone components, `OnPush`, zoneless-safe.
- Geometry stays derived. A durable user preference such as a fidelity pin is
  acceptable intent. Derived geometry is not.
- Responsive wrapping is derived state. It may split an explicit row when the
  viewport narrows, but it must not write those temporary wraps back as manual
  row breaks or erase a stored break when the viewport widens.
- Only `CanvasWorkspaceGridComponent` may call a Gridstack API.
  `CanvasLayoutService` must never import Gridstack.
- Frontend libraries must not import backend libraries.
- `MAX_COLUMNS` must stay at 6 or below. Above 6, `apportionRow` returns a row
  wider than `GRID_COLUMNS = 12` and the layout corrupts
  (`canvas-layout.service.ts:177-220`). This dependency is not documented in
  `libs/frontend/canvas/CLAUDE.md:26` and must be added.

## Claims that were wrong

These four claims shaped an earlier version of the plan. They are false. Do not
reintroduce them.

1. **Finalized prose is not duplicated.** `walkExecutionTree` returns
   immediately after the agent branch (`compact-session-activity.component.ts:582`)
   and never recurses into the agent's direct text children. The compact redesign
   is justified by low information density, not by duplication.
2. **Workspace eviction does not reload the session.** Tab state is returned from
   the in-memory partition map, and `TabState.messages` retains finalized trees.
   The real cost is DOM and injector reconstruction.
3. **Canvas intent is not persisted today.** `restoreCanvasTilesFromTabs()` only
   seeds default order and weight through `appendTile()`. It restores no prior
   arrangement.
4. **Animating a border color is paint work, not compositor work.** Use a
   positioned pseudo-element and animate `opacity` or `transform`.

## Design decisions

### Session identity (step 0)

A notification that reads "session-09-09-03-14 finished" is useless at 30
sessions. Today a tab title comes from one of five places, and none of them
describes the work:

| Path | Title | Evidence |
|---|---|---|
| User types a name | The name | `tab-manager.service.ts:778` |
| User does not | `defaultSessionName()` → `session-09-09-03-14` | `default-session-name.util.ts:25` |
| New tab | `'New Chat'` | `tab-manager.service.ts:953` |
| Loaded session, no title | `claudeSessionId.substring(0, 50)` — a raw ID | `:740` |
| Rename | Manual only; the UI must collect the input | `:2082` |

There is no auto-titling from message content. Verified.

Identity has three parts, and all three are needed:

1. **Name.** Precedence: an explicit user name, then a title auto-derived from
   the first user message, then the timestamp default. The middle layer is the
   missing one. Derive on the first user message of a session: strip markdown,
   collapse whitespace, truncate to about 40 characters, write once. Never
   overwrite a user-given name, and never re-derive on later messages.
2. **Place.** The workspace folder basename. The user runs nine workspaces, so a
   title alone is ambiguous. A notification row reads
   `ptah-extension · fix the compaction reload bug · finished`.
3. **Color.** A stable color derived from the session ID, shown as a dot in the
   tile header and in the notification row. `generateAgentColor` already exists
   (`libs/frontend/chat-ui/src/lib/utils/agent-color.utils.ts`) and returns
   OKLCH. Matching a notification to a tile becomes a color match rather than a
   text read, which is what makes it work at 30 tiles.

Constraints for this step: the derive must not fire for a session restored from
history, must be idempotent under a replayed message, and must respect the
existing `renameTab` result as user-owned. Title writes go through the existing
`updateTabInternal` path, and the persistence mirror rules in
`tab-persistence.ts` still apply.

### Compact tile

Four fixed zones and no inner scroll: a status line, a pulse strip of about 24
marks, one content slot, and a metrics footer.

Delete `CompactSessionHeaderComponent` and `CompactSessionInputComponent` from
the card, and delete the card's own collapse and full-view footer. The canvas
tile header already carries the title and the mode toggle
(`canvas-tile.component.ts:65-97`). Remove the exports at
`libs/frontend/chat-ui/src/index.ts:47-48` if the files are deleted.

Content slot precedence: targeted pending question, then targeted pending
permission, then newest error, then newest prose, then idle.

Two rules that a naive implementation will get wrong:

- **Resolve the prompt by router target metadata first, then by session ID.**
  Filtering by `request.sessionId` alone (`compact-session-card.component.ts:161`)
  can miss the exact prompt the tile is meant to surface, because
  `PermissionHandlerService` documents ID mismatches and router-attached target
  tabs.
- **Do not put a full prompt form in a fixed no-scroll slot.** A question card
  can hold several questions. Render a blocking summary plus one action that
  opens the full tile.

State and focus must not share a style channel. Focus already owns
`border-primary` and `ring-primary`. Give state the border and glow, and give
focus the outline.

`SessionStatus` has no `error` member. Derive error meaning from
`lastTerminalReason`, not from `status`.

### Manual row layout and persistence

The current 2+1 failure is deterministic, not a Gridstack mystery.
`CanvasLayoutService.computeLayout()` sorts by `order` and chunks the sequence
at the responsive column count. At a three-column width, three tiles therefore
always derive as one row. After a drag, `CanvasWorkspaceGridComponent` reads the
full `grid.engine.nodes` set but persists only that sorted order. The next
computed layout consequently writes 4/4/4 geometry back into Gridstack and
removes the short row.

Gridstack 12.6.0's verified event order supports an intent projection:
`dragstop` is emitted before the following `change`, and that change occurs
after top-gravity packing. With `float: false`, a tile dropped at x=0 on the
second row remains there when the tile above blocks upward movement; the engine
node set therefore contains the observed 2+1 grouping. This is third-party
behavior and needs an integration test, but it does not require storing engine
coordinates.

Store the smallest durable intent. Add `rowBreakBefore` to tile intent; it means
"start a user row before this tile" and is always false for the first ordered
tile. Store one workspace-level
`columnsPreference: 'auto' | 1 | 2 | 3`. A numeric value caps the responsive
capacity but never forces tiles below `MIN_TILE_WIDTH`. Build logical rows from
the breaks, then responsively split each logical row at:

```text
responsiveCapacity = columnsFor(containerWidth)
effectiveCapacity = preference === 'auto'
  ? responsiveCapacity
  : min(responsiveCapacity, preference)
```

Responsive splits are render-only. They disappear when the viewport widens and
never become stored breaks. Do not add `x`, `y`, `w` or `h`, and do not change
public `TileLayout`.

#### Row-preserving deletion and reconciliation

Never treat `rowBreakBefore` as an attribute that simply dies with its tile.
For explicit close, external prune, and hydration reconciliation, use the same
pure operation:

1. Partition the pre-mutation ordered tiles into logical rows.
2. Filter removed or non-authoritative ids inside each row.
3. Drop empty rows.
4. Flatten the surviving rows, assign dense order, and set a break only on the
   first survivor of every row after the first.
5. Append newly authoritative tab ids, with default weight and no break, to the
   final surviving logical row (or create the first row when none survives).

Thus `A B | C D`, after deleting `C`, becomes `A B | D`. The boundary transfers
to the next survivor in `C`'s old logical row. The same rule handles deletion of
several adjacent row starts without inventing empty rows.

#### Gesture transaction

`dragstop` is too late to discover what the gesture meant. On `dragStartCB` (and
equivalently `resizeStartCB`) capture an immutable transaction:

```text
kind, workspacePath, draggedId, workspaceRevision,
effectiveCapacity, expectedTabIds
```

The `draggedId` comes from the event element's Gridstack node, not from active
focus. `workspaceRevision` is a monotonic per-workspace intent revision bumped
by membership, order, weight, break, and preference mutations. The following
stop/change may commit only when all of these remain true:

- the component is still visible and unlocked;
- its workspace and effective capacity equal the snapshot;
- the target workspace still has the captured revision;
- every expected tab id occurs exactly once in the full engine observation;
- no unknown/duplicate id or non-finite coordinate is present;
- for resize, the dragged node also has a finite positive width.

Commit through a workspace-addressed store method, never whichever workspace is
active when `change` happens. Cancel and discard the transaction on hide, lock,
component destroy, workspace/capacity change, a new gesture start, or any failed
validation. Equal workspace revision is sufficient to re-read the current
logical rows during projection: every membership, order, weight, break, or
preference mutation advances that partition's revision. Keeping duplicate row
arrays in the snapshot adds allocation without adding a stronger invariant.

A stale, incomplete, cancelled, or semantically unchanged observation writes no
intent, but it is not a renderer no-op: Gridstack has already moved engine
nodes. Every terminal gesture path therefore reprojects current authoritative
intent into existing nodes before clearing the latch. Reconciliation skips
unknown or missing nodes (never resurrecting a removed tile), never addresses a
different workspace, and remains under the same synchronous feedback guard as
normal geometry application.

#### Drag projection and narrow-layout ambiguity

Convert engine nodes to internal `{tabId, x, y}` observations, sort by `(y,x)`,
and group equal integer `y` values. The pure projector removes the dragged tile
from the revision-equivalent current logical rows first, using the
row-preserving deletion rule.
This is what prevents a moved row-start from carrying its old boundary blindly;
the next survivor keeps that boundary unless the observed gesture explicitly
merges or splits rows.

For each adjacent pair in observed order:

- equal observed `y` is unambiguous merge/join evidence: no logical break;
- a change in `y` after an observed row shorter than `effectiveCapacity` is
  unambiguous split evidence: add a logical break;
- a change after a full observed row is ambiguous responsive wrapping: preserve
  the snapshot logical-row relation rather than guessing.

If those rules would interleave members of old logical rows or cannot assign the
dragged tile to exactly one row, reject the entire commit. At capacity 1 there
is no geometric split/merge evidence, so only reorders that preserve each prior
logical row as a contiguous block are accepted. For example,
`A B | C D -> A B | D C` is valid when `D` is moved before `C`; an interleaving
such as `A D B C` is a no-op. To split or merge at that width, the user selects
2 or 3 in the workspace control or widens the canvas, then drags where row
membership is visible. This is an explicit product rule, not an inference
heuristic.

The projector returns the complete normalized intent once. Order and breaks are
committed atomically under the captured revision. Resize-stop updates only the
captured workspace's weights. Container resize, preference-driven reflow,
programmatic Gridstack changes, and changes without a valid transaction write no
gesture intent.

#### One geometry-update owner

There are two writers today. The Angular Gridstack item `options` setter calls
`grid.update()` whenever its reactive object changes
(`node_modules/gridstack/dist/angular/src/gridstack-item.component.ts:89-95`),
and the canvas effect calls `grid.update()` again
(`canvas-workspace-grid.component.ts:176-193`). `_applyingLayout` covers only the
explicit effect, so it cannot make the dual ownership safe.

Keep the explicit workspace-grid effect as the sole post-mount geometry owner.
Give each `gridstack-item` one cached, stable creation-options object, seeded
with its id and initial derived geometry; do not replace that object on later
layout computations. The effect compares each engine node with its target and
calls `grid.update()` only for changed geometry, inside one guarded batch. Drop
cached creation options when a tile disappears. Repeat application of the same
intent must perform zero updates. This preserves the rule that only
`CanvasWorkspaceGridComponent` knows Gridstack while removing the unguarded
Angular update path.

Diagnostics distinguish actual layout computation (incremented inside the
computed callback on a cache miss), apply checks, changed apply passes, and
per-node updates. A separate publication clock refreshes diagnostic attributes
without making the counters reactive dependencies of layout computation. The
Auto/1/2/3 control is disabled while the canvas is locked, and its handler also
rejects programmatic mutation in that state.

#### Hydration, persistence, and disposal

R4b replaces `OrchestraCanvasComponent.restoreCanvasTilesFromTabs()`. That loop
currently calls `addTileFromSession()`, which in turn calls `openSessionTab()`
for an already-restored session (`orchestra-canvas.component.ts:377-388`,
`canvas.store.ts:130-144`). Hydration must instead pass the exact authoritative
restored tab ids into one store transaction; it must never find or recreate
tabs by session id.

Use one localStorage record per workspace and panel, derived from
`VSCodeService.config().panelId || 'primary'`, so a writer replaces only its own
partition. A v1 record contains `version`, `columnsPreference`, and at most
`MAX_TILES` entries of `{tabId, order, weight, rowBreakBefore}`. Zod validation
requires non-empty unique tab ids, dense-normalizable integer order, boolean
breaks, and finite weights in `(0, GRID_COLUMNS]`. It contains no rendered
geometry, focus, transcript, session identity, or future `detailPin`.

Hydration is a two-phase transaction: read/validate the target record, reconcile
it with the authoritative restored tab-id snapshot using the row-preserving
algorithm, publish the workspace state once, then enable persistence writes for
that partition. Do not let an initial empty signal overwrite storage. Do not
prune or create records for workspaces that have not been authoritatively opened.
After hydration, membership changes come from explicit tab close/adopt events or
an acknowledged workspace reconciliation, not an unqualified effect over a
possibly transient empty `tabs()` signal.

The implicit workspace is never persisted. If tiles are created before a real
path exists, the first authoritative workspace transaction reconciles those ids
with the target's restored tabs and persisted intent, appends valid implicit-only
ids, deletes the sentinel partition, and only then enables the real partition's
writes.

Classify storage reads as missing, current, corrupt-current, or unknown-future.
An unknown future version may render a safe default from authoritative tabs but
must keep its original bytes and disable automatic writes, preventing an older
client from downgrading it. Duplicate ids invalidate the current record rather
than being silently last-write-wins. Debounced dirty writes flush synchronously
on `pagehide`, `beforeunload`, visibility-hidden, and persistence-service
destruction; only hydrated, writable partitions may flush.

Ordinary `OrchestraCanvasComponent` disposal must flush intent and destroy the
view only. Remove its unconditional `forceCloseTab()` loop
(`orchestra-canvas.component.ts:430-445`). `CanvasStore.removeTile()` remains
the explicit user close path that closes one tab; any future "close all
sessions" action must be a separately named command. Destroy/remount must retain
the same authoritative tab ids and recreate tiles without `openSessionTab`,
`switchSession`, `closeTab`, `forceCloseTab`, or `session:load`.

The workspace-wide Auto / 1 / 2 / 3 maximum plus manual breaks is the accepted
default. No per-row configuration decision is pending.

### Level of detail

`level = f(zoomStop, focus, intersection, pin, budget)`.

Levels are Live, Compact, Folded and Chip. Only the pin is stored, and it must be
named for what it promises, for example `detailPin?: 'live' | 'compact'`. A bare
boolean called `pin` invites the reading "never evict", which cannot coexist with
a hard budget.

Admission order when several tiles want Live: the focused tile, then a blocking
targeted prompt, then explicit pins by recency, then intersecting tiles by
distance to the viewport center, then overscan. Take the first N. Start N at 6.

`@defer (on viewport)` is a creation trigger only. Its state machine is
monotonic, so it never evicts. The outer `@if (lod() === 'live')` owns eviction.
A `display: none` ancestor delays the trigger, which is correct behavior for a
retained workspace and not a defect.

Tie `registerVisibleTab()` to an admitted Live surface, not to a mounted grid
tile. Otherwise a folded tile keeps receiving per-frame streaming flushes and the
level-of-detail work buys nothing.

**Two traps in the shell split.** First, destroying the child injector must not
destroy the session. The injector only provides `SESSION_CONTEXT`; the session
lives in `TabManagerService` and `ChatStore`. A demotion keeps the tab open, the
session running and `TabState.messages` intact. Assert this with a test, because
it is the failure that would be worst and quietest. Second, promotion back to
Live must re-read `TabState.messages` and must not call `switchSession()` — the
current path at `orchestra-canvas.component.ts:290-301` does, which can trigger a
needless `session:load` on every promotion.

A demoted tile loses its transcript scroll position and promotion lands at the
bottom. That is probably acceptable, but it should be chosen rather than
discovered.

### Zoom

Four stops: Focus, Grid, Deck, Overview. A continuous `zoomScale` drives the CSS
transform. A stable `zoomStop` with hysteresis drives fidelity. Fidelity must
never follow a raw scale tick, or a small wheel movement near a threshold will
repeatedly destroy and recreate a chat view.

Wrapper contract:

- The outer scroll viewport is the element `CanvasLayoutService` measures.
- An untransformed spacer exposes the scaled scroll extents.
- The inner world uses `transform: scale()` with `transform-origin: 0 0`.
- The transformed world must never be the `ResizeObserver` target. Dividing the
  measured width by the scale creates a feedback loop and cancels the zoom.
- The spacer must follow Gridstack's real rendered height, not a height guessed
  from the row rule in another service.

Gridstack 12.6.0 does compensate for CSS transforms. It measures transformed
elements (`node_modules/gridstack/dist/utils.js:714-736`) and stores a
`dragTransform` at drag start (`gridstack.js:2678-2688`). This supports the
approach but is third-party behavior, so it still needs integration coverage.

Overview must derive `effectiveStatic = userLocked || zoomStop === 'overview'`.
Calling `locked.set(true)` destroys the user's manual choice.

Preserve a scroll anchor around the focused tile across stop changes.

### Notification center

Pending prompts are state. Completion is history. Do not push a duplicate event
for a prompt from `StreamRouter`; a pushed queue can disagree with the source
after an auto-resolution, a response, a timeout or a cancellation.

The completion edge is detected inside `TabManagerService.applyTurnState()`
(`tab-manager.service.ts:1157-1209`), which already searches across workspaces and
is replay-protected by a monotonic revision. Detect it there, imperatively, in
the reducer that already owns the transition. Do not watch `tabs()` in an effect:
`tabs()` exposes only the active workspace and would miss the background
completions this feature promises. Do not treat `status: loaded` as the signal —
finalization and history loading also write it.

Classify `phase === 'failed'` as an error. For idle, read `terminalReason`; an
abort or a limit is not a pleasant success.

Ownership: a new `libs/frontend/notification-center` tagged `scope:webview` and
`type:feature`. The store cannot live in `chat-state`, which is tagged
`type:data-access` and may depend only on data-access and util
(`eslint.config.mjs:235-241`). `chat-state` contributes only the typed terminal
pulse and the cross-workspace lookup. The shells own activation, because they
already own navigation.

Focus routing is one acknowledged transaction:

```
resolve {workspacePath, tabId?, sessionId}
  -> appState.setCurrentView('chat')
  -> appState.setLayoutMode('grid')
  -> workspaceCoordinator.switchWorkspace(workspacePath)
  -> acknowledged canvas focus request carrying workspacePath + tabId/sessionId
  -> focus existing intent, else adopt existing tab, else open session
  -> focus the tile after its shell exists
  -> mark read only on success
```

It returns `{ success, outcome }` where outcome is one of `focused`, `adopted`,
`opened`, `cap-reached` or `missing`. On `cap-reached`, fall back to the normal
full session view rather than leaving a dead entry.

`CanvasStore` is component-scoped, so the shell cannot inject it. Keep the
`AppStateManager` bridge or add a narrow canvas-focus port.

Sound: start with a short Web Audio envelope. It needs no asset and no CSP
change, and it behaves the same in both hosts. Create or resume the
`AudioContext` only after a user gesture, and skip the sound if it stays
suspended. One sound per coalesced burst with a cooldown of about two seconds. A
mute toggle in the panel. Suppress in automated tests.

Bursts: bound the store to 50 to 100 entries. Coalesce completions inside a 250
to 500 ms window and group by workspace. Never coalesce pending prompts so
tightly that a request becomes unreachable.

Accessibility: a real `<button>` with `aria-label`, `aria-haspopup`,
`aria-expanded` and `aria-controls`; an exact count in the accessible name with
`9+` capping only the visual badge; focus moved into the panel on open and
restored on Escape; and one visually hidden `role="status"` announcer that
speaks a coalesced phrase rather than twelve insertions.

## Acceptance criteria

### Track R

0. A session whose user never typed a name shows a title derived from its first
   user message. The derive runs once, does not fire on a history restore, does
   not overwrite a user-given name, and survives a reload. Each session exposes
   a stable color and a workspace label.
1. A canvas holding 30 tiles mounts no more than the configured Live budget of
   full `ChatViewComponent` instances. A test asserts the count.
2. A compact tile renders in a fixed height with no internal scrollbar, and it
   shows a blocking prompt summary within one frame of the prompt arriving.
3. A layout pass has one post-mount geometry owner, issues at most one Gridstack
   `update()` per changed node, issues zero for unchanged nodes on repeat
   application, and produces no intent feedback. The reactive Angular
   `[options]` update path is gone.
4. Switching to single-chat layout mode deregisters the canvas tiles. The main
   transcript and the canvas transcripts are never both live.
5. Canvas order, bounded weight, explicit row breaks and tiles-per-row
   preference survive an application restart and restore against exact
   authoritative tab ids only. Unknown future records are not overwritten.
   With three tiles, a manually-created 2+1 arrangement survives workspace
   A -> B -> A, a wide -> narrow -> wide resize, and an application restart.
   `A B | C D` reconciled without `C` becomes `A B | D`. Ordinary canvas
   destroy/remount preserves the same tabs and performs no session lifecycle
   call; only an explicit tile close closes a tab.
6. Drag and east-or-west resize behave correctly at every zoom stop, at non-unit
   browser zoom, and at a non-unit Electron device pixel ratio.
7. Entering Overview does not change the user's manual lock state. Leaving it
   restores the prior interaction state.
8. Demoting a tile below Live keeps its tab open, its session running and its
   messages intact. Promoting it back issues no `session:load`.
9. A completion in a background workspace produces exactly one notification
   entry, and a replayed revision produces none.
10. Clicking a notification for another workspace switches the workspace, focuses
    the tile, and marks the entry read only on success.
11. The bell is reachable and operable by keyboard, and a burst of twelve
    completions produces one announcement and one sound.

### Track C

1. The per-session cost of one running session is measured and recorded.
2. A concurrency budget exists, with defined queue behavior when it is full.
3. Streaming flush cost is measured against the count of streaming visible tabs,
   and the scaling is documented.
4. A transcript retention or eviction policy exists that keeps persisted state
   inside the storage quota at the target session count.
5. `MAX_TILES` is raised only after criteria 1 to 4 hold.

## Sequence

The immediate canvas lane runs in this order:

0. Session identity — complete and independently approved.
1. **R1-lite + R4a — implemented, pending review:** baseline/update counters, one post-mount geometry writer,
   row semantics, workspace-scoped revisions, Auto / 1 / 2 / 3 control, and real
   Gridstack interaction proof. No persistence and no tile/session calls.
2. **R4b:** authoritative tab-id hydration, lifecycle correction, per-workspace
   and per-panel persistence, teardown flush, and real destroy/remount proof.
3. Zoom, after row projection and persistence are stable.

Compact redesign (R2) is independent of row layout and remains the user's
highest-priority visual work. It may be scheduled alongside this lane when file
ownership is disjoint. Tile shell split/LOD and full Live/streaming
instrumentation remain required renderer work, but neither is a prerequisite
for R4a or R4b. `detailPin` is deliberately absent from the v1 canvas record and
gets a schema version only when LOD implements it.

Track C step 1, the measurement, should start in parallel with Track R step 1.
Everything else in Track C depends on what that measurement finds.

LOD remains load-bearing for the eventual high tile count: until the child
injector and chat outlet are conditional, a folded tile still pays most of
today's cost. That performance dependency does not apply to row ownership or
canvas lifecycle. R4b must remove forced tab closure on ordinary disposal before
LOD begins destroying and recreating view surfaces, otherwise view lifecycle and
session lifecycle remain dangerously coupled.

## Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Renderer work is mistaken for concurrency work | A chip costs the same backend session as a full tile | Track C is separate and gates `MAX_TILES` |
| Level-of-detail thrash at viewport edges | Mount and unmount churn is worse than always-live | Hysteresis, root margin, and a demotion delay |
| Zoom and fidelity coupled to one value | A wheel tick destroys a chat view | Split `zoomScale` from `zoomStop` |
| Notification queue drifts from the prompt source | A badge outlives the request | Pending prompts stay computed and are never pushed |
| localStorage quota at 50 long transcripts | Silent persistence failure | Track C criterion 4 |
| Gridstack behavior under transform | Third-party behavior, not a guarantee | Integration tests at several scales and device pixel ratios |
| Dual geometry ownership | Angular input and explicit effect each write Gridstack, hiding feedback and doubling work | Stable creation-only options plus one diffing imperative owner, measured in a real browser |
| Gesture commits after workspace/capacity change | A stale `change` mutates the wrong partition or destroys row intent | Gesture-start snapshot, workspace revision, exact-node validation, and cancel-on-context-change |
| Older client overwrites future intent | Downgrade destroys data it cannot understand | Per-partition write gate; preserve unknown-version bytes |

## Open questions

1. What is the per-session backend cost of a running session? Unmeasured.
2. Does any concurrency limit exist today in `agent-sdk` or `cli-agent-runtime`?
3. What is the correct Live budget? Six is a starting value, not a measurement.
4. Should the notification mute preference live in localStorage as a UI-only
   setting, or in the host-agnostic `~/.ptah/settings.json` path? Choose one.
   Do not create two stores.
5. Does the product want a Live focused tile in Overview? If yes, Overview is not
   a cheap overview and the stop table must change.

## Evidence

- `codex-canvas-investigation.md` — performance, zoom options and the tile cap,
  with a file-and-line evidence table.
- `codex-plan-review.md` — adversarial review of this plan, including the
  notification architecture and the corrections listed above.

Both reports were lost to the `TASK_2026_392` id collision and were regenerated
by resuming the original Codex sessions. If either is missing, resume Codex
session `01a08296-7c0b-7391-90a6-e9296450e463` (investigation) or
`01a082c3-5e70-7581-ae98-dc71403bf65f` (review).
