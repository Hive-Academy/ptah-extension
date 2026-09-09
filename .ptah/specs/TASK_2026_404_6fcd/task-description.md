# Task description — Scale the Orchestra Canvas beyond nine tiles

Status: specification. No production code has been written for this task.

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

1. **Instrumentation and contracts.** Counters for mounted Live surfaces, layout
   passes, Gridstack `update()` calls, and streaming flushes per frame. The
   level-of-detail admission table, the notification identity and read
   semantics, and the canvas persistence schema, all written before any UI work.
2. **Compact tile redesign.** Replace the scrolling activity feed with a bounded
   summary view model that has two adapters, one for live `StreamingState` events
   and one for finalized `ExecutionNode` messages.
3. **Tile shell split and level-of-detail allocation.** Separate the tile shell
   from the heavy chat surface. Add a central allocator with a Live budget.
4. **Versioned canvas intent persistence.** Per workspace and panel, validated at
   the storage boundary.
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
3. A layout pass issues at most one Gridstack `update()` call per changed node.
   The current duplicate path through the Angular `[options]` setter is gone.
4. Switching to single-chat layout mode deregisters the canvas tiles. The main
   transcript and the canvas transcripts are never both live.
5. Canvas order, weight and pin survive an application restart, restore against
   valid tabs only, and reject a corrupt or older stored payload without
   throwing.
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

Track R runs in this order. Zoom follows the level-of-detail work, because a zoom
stop otherwise has nothing deterministic to control.

0. Session identity — a prerequisite for steps 2 and 6
1. Instrumentation and contracts
2. Compact redesign
3. Tile shell split and level-of-detail allocation
4. Intent persistence
5. Zoom
6. Terminal pulse and notification store
7. Cross-workspace focus routing
8. Host integration

Track C step 1, the measurement, should start in parallel with Track R step 1.
Everything else in Track C depends on what that measurement finds.

Step 3 is load-bearing. Until the child injector and the chat outlet in
`CanvasTileComponent` are conditional, a folded tile still pays most of today's
cost, and steps 4 through 8 deliver much less than they appear to. Step 4's
"restore folded, hydrate focused" has no cheap rendering to restore into, and
step 5's Overview would scale full chat views down to chips rather than
replacing them.

## Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Renderer work is mistaken for concurrency work | A chip costs the same backend session as a full tile | Track C is separate and gates `MAX_TILES` |
| Level-of-detail thrash at viewport edges | Mount and unmount churn is worse than always-live | Hysteresis, root margin, and a demotion delay |
| Zoom and fidelity coupled to one value | A wheel tick destroys a chat view | Split `zoomScale` from `zoomStop` |
| Notification queue drifts from the prompt source | A badge outlives the request | Pending prompts stay computed and are never pushed |
| localStorage quota at 50 long transcripts | Silent persistence failure | Track C criterion 4 |
| Gridstack behavior under transform | Third-party behavior, not a guarantee | Integration tests at several scales and device pixel ratios |

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
