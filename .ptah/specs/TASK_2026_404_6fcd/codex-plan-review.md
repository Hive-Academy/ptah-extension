# Adversarial review: Ptah Orchestra Canvas plan

Reviewed against branch `fix/task-401-agent-status-durability` on 2026-09-09. This is a design review only; no production code was changed.

## Executive verdict

| Area | Verdict | Short reason |
| --- | --- | --- |
| A. Compact tile redesign | **Right, but underspecified** | Replacing the miniature transcript with a glanceable summary is the correct product move. The asserted finalized-tree prose duplication is false, the proposed prompt priority is not yet correctly routed per tile, and the border-animation claim confuses a CSS variable with compositor-only animation. |
| B. Intent persistence | **Right direction, materially misstated** | Canvas intent is currently retained only in the component-scoped `CanvasStore`; tabs and session-list metadata are separate stores. Lowering the mounted-grid cap rebuilds component/DOM state from retained `TabState.messages`; it normally does not reload the transcript from the backend. Persistence needs its own versioned, validated envelope. |
| C. LOD ladder | **Right, but missing the allocation policy** | `pin` is legitimate intent. Angular `@defer (on viewport)` is useful for first creation, but installed Angular proves the block is monotonic and does not evict. A central allocator—not each tile—must enforce budgets and drive explicit destruction. |
| D. Zoom | **Right, but coupled to C and layout math** | Separate continuous visual scale from the named semantic stop. Keep GridStack geometry in unscaled world units, make scroll bounds explicit, and derive the effective lock. Do not feed transformed measurements back into cell-height calculations. |
| E. Notification center | **Product intent right; proposed event architecture wrong** | Pending prompts are current state and should be computed from existing signals. Completion and unread are history and require a small event ledger. Completion must be recorded at the accepted `turn_state` transition, not pushed independently by `StreamRouter`. Focus is a cross-workspace transaction that does not exist today. |

There is also a newly confirmed, release-critical requirement outside A–E: **25–50 sessions must be generating simultaneously**. That is not solved by LOD or DOM eviction. It requires a backend/transport/resource-budget track and a 50-run soak gate before the UI tile limit is raised.

## Branch drift in citations

Most canvas and compact-session citations are unchanged from the earlier investigation. The material shifts on this branch are in `SessionLoaderService`: the workspace-list cache is now documented at `session-loader.service.ts:113-141`, workspace switching at `:433-460`, LRU eviction at `:477-501`, the live-session fast path at `:570-579`, and the actual `session:load` call at `:590-599`. The status path is now especially explicit because `TabManagerService.applyTurnState` at `tab-manager.service.ts:1120-1210` is documented as the single accepted writer.

## A. Compact tile redesign

### Verdict

Proceed with the information-hierarchy redesign, but do not justify it with the duplication claim. The existing component is too transcript-like: it has an internal scrolling feed (`compact-session-activity.component.ts:197`), auto-scroll work (`:494-505`), and up to 50 entries supplied by the card (`compact-session-card.component.ts:83-89`). The card also composes a header (`:65-71`), stats (`:74-79`), activity (`:83-91`), input (`:96-101`), and footer controls (`:104` onward) inside a canvas tile that already supplies its own header and mode control (`canvas-tile.component.ts:65-97`). The critique of density and duplicated chrome is sound.

### The prose-duplication claim is false on the claimed code path

The exact finalized-message path is:

1. `feedEntries` chooses `buildFeedFromMessages()` only when there is no non-empty live event map (`compact-session-activity.component.ts:508-515`).
2. `buildFeedFromMessages()` visits each finalized assistant message's execution root and calls `walkExecutionTree()` once (`:531-542`).
3. When that walker reaches an `agent` node, it gathers **direct** text children into `textParts` (`:545-556`), chooses `node.summaryContent` first or joined child text as fallback (`:558-559`), pushes exactly one `agent` feed entry (`:561-581`), and then **returns immediately** at `:582`.
4. The standalone `text` entry branch is below that return (`:585-590`). The generic recursive descent is lower still (`:600-635`, with the recursive call at `:630`). Neither is reached for an agent node.

The builder can put the same semantic summary in two places: it reads `agentSummaryAccumulators` (`agent-node.fn.ts:83-85`) and, when there are no content blocks, also creates a summary text child (`:97-107`) before returning the agent with those children (`:116-121`). That is not rendered twice by this walker because of the agent-branch return. If the return were removed during refactoring, duplication would immediately become real; pin this behavior with a regression test.

The live-event path also contains an explicit seen-text guard (`compact-session-activity.component.ts:681-698`), so there is no evidence for the broader claim that the current UI blindly emits every prose block twice. The redesign remains worthwhile without that claim.

### Seven required corrections

1. **Replace the feed; do not mutate it into four zones.** Introduce a small summary view-model/reducer that derives `statusLine`, recent semantic marks, `primaryContent`, and aggregate footer metrics. Remove the scrolling template and its `afterRenderEffect`; do not keep a hidden 50-entry transcript computation behind the new UI.

2. **Define “newest” over semantic events, not raw deltas.** Text deltas, partial JSON, and repeated progress updates must coalesce. A pulse mark should represent a completed/meaningfully changed tool, agent start/end, prose block, prompt, or terminal state. Bound it (for example, 16–24 marks) and key it by stable event identity. Otherwise 50 simultaneous streams make the strip a repaint and allocation hot spot.

3. **Make the live verb a total, tested mapping.** Prefer a pending prompt (“Needs permission”), then terminal/error, then the newest active tool/agent, then streaming prose, then idle. Tool-specific verbs such as “Editing `foo.ts`” must be derived from already-validated tool input and degrade to “Running Edit” when a path is absent. Display only a basename or workspace-relative path; do not leak an absolute home path into a tiny cross-session overview.

4. **Route the “one thing” to this tile.** `ChatStore` exposes global arrays at `chat.store.ts:94-96`. `PermissionHandlerService` stores target maps (`permission-handler.service.ts:61` and `:125`), but its current visibility fallback deliberately returns true globally (`:169-178`). The compact card must use the router-attached target ids (`targetTabsFor` at `:343-345`; `questionTargetTabsFor` at `:552-554`) and an explicit, tested unresolved-target fallback. Simply taking the newest global request would show one session's permission in every tile.

5. **Make priority deterministic.** Recommended slot order: targeted question, targeted permission, latest non-empty assistant prose, latest meaningful tool/agent result, empty/starting state. If several prompts target the same session, show the oldest actionable item plus “+N more”; FIFO is the only ordering that helps unblock work.

6. **Do not equate a custom property with compositor execution.** Animating border color, box-shadow, or an unregistered color custom property still paints. Use a pseudo-element whose `opacity` and/or `transform` is animated; set one non-animated custom property for its state color if desired. Disable motion under `prefers-reduced-motion`, retain a non-motion border/icon, and do not encode status by color alone. Amber should mean actionable blockage only, not every question-like state.

7. **Remove chrome contextually, not by deleting shared atoms prematurely.** `CompactSessionCardComponent` is also used by `ChatViewComponent` (`chat-view.component.ts:39,117` and `chat-view.component.html:9`). Add a canvas presentation contract or make the redesigned card intrinsically headerless, then verify the non-canvas compact mode. Remove public exports for `CompactSessionHeaderComponent` and `CompactSessionInputComponent` only after repository-wide callers are gone (`chat-ui/src/index.ts:47-48`; chat re-exports at `chat/src/lib/components/index.ts:139-140`). The tile's existing mode button at `canvas-tile.component.ts:79` makes the inner “Full View” control redundant in canvas, but not automatically elsewhere.

Acceptance must include finalized and live paths, nested agents, a summary-child fixture proving one prose rendering, multiple targeted prompts, reduced motion, long/Unicode paths, and 50 concurrent high-rate view-model inputs.

## B. Intent persistence instead of retained DOM

### Verdict

Persisting arrangement is correct. The claim that the current cap exists purely because tabs do not persist is incorrect, and “restoreCanvasTilesFromTabs already covers this” is only true for membership, not user intent.

### Three stores were conflated

1. **Canvas intent/keep-alive store.** The component-scoped `CanvasStore` owns `_workspaceTiles`, focused tile ids, mounted workspace paths, and recency (`canvas.store.ts:45-88`). A `CanvasTile` is presently only `TileIntent` (`:6-13`). LRU eviction removes a path only from `_workspacePaths`; it deliberately leaves the map entry intact (`:472-491`). This preserves order/weight only for the lifetime of that mounted `OrchestraCanvasComponent`, not across a reload or layout-mode destruction.

2. **Tab/transcript store.** `TabWorkspacePartitionService` holds all workspace tab sets in memory (`tab-workspace-partition.service.ts:69-76`) and loads/saves a per-workspace, optionally per-panel localStorage key (`:481-512`). The envelope is version 2. `tab-persistence.ts:24-31` explicitly confirms finalized execution trees remain in `TabState.messages` and that restored transcripts are not re-fetched. This store preserves sessions and cached transcript data, not canvas order/weight.

3. **Session-list cache.** `SessionLoaderService.sessionCache` is a separate, ten-workspace LRU for session-list metadata (`session-loader.service.ts:113-141,477-501`). On a hit, workspace switching restores its signals without RPC (`:433-449`); on a miss it calls `loadSessionsForWorkspace` (`:451-460`). It is not the tile store and not the per-tab transcript cache.

`restoreCanvasTilesFromTabs()` recreates one tile for every active tab (`orchestra-canvas.component.ts:372-395`) using default append order and weight (`canvas.store.ts:405-409`). It therefore restores membership and active focus only. It cannot restore rearrangement, resizing, pins, or the distinction “tab exists but user removed it from canvas.” It also stops at the current nine-tile cap through `addTileFromSession`/`adoptTab` (`canvas.store.ts:130-176`).

### What lowering `RETAINED_WORKSPACE_CAP` to 1 actually costs

The cap is currently four (`canvas.store.ts:25-32`). At one, every workspace switch unmounts the previous `CanvasWorkspaceGridComponent`, its GridStack instance, every `CanvasTileComponent`, and every child injector/chat or compact component. Returning remounts and reconstructs execution-tree presentation from the `TabState.messages` already held by the tab partition. It also re-registers visible tiles (`canvas-tile.component.ts:195-198`), recreates child injectors (`:207-238`), runs Angular templates/computeds, rebuilds markdown/tool/agent DOM, and asks GridStack to measure/layout again.

That is potentially expensive—especially for long transcripts—but it is **not normally a backend transcript load**. `SessionLoaderService.switchSession()` returns early for an active-workspace tab with `hasLiveSession` (`session-loader.service.ts:570-579`). The actual `session:load` is at `:590-599` and is reached when the fast-path preconditions do not hold. A process reload is different: persisted messages rebuild the transcript, while status is reconciled separately; `tab-persistence.ts:24-31` says resume results are intentionally discarded because messages are already cached.

Therefore “Folded everywhere, focused Live” is cheaper than retained full DOM only if Folded does not instantiate transcript-heavy children. If a Folded tile still computes `feedEntries`, parses markdown, or creates `ChatViewComponent` behind CSS, the session data cost remains. Conversely, focused Live can still incur a large synchronous reconstruction from in-memory messages. Measure remount scripting, node count, heap, long tasks, and first-interaction latency on worst-case transcripts before setting the cap to one.

The statement “removes the workspace-count limit entirely” is too strong. It removes the **mounted-grid** count limit. In-memory tab sets, cached messages, canvas intent, notification history, and session-list cache remain bounded or need bounds. At 25–50 running sessions, stream state and transcript retention—not hidden grid count alone—can dominate memory.

### Correct persistence contract

Use a dedicated canvas envelope, not fields smuggled into the tab-v2 blob:

```ts
type PersistedCanvasWorkspaceV1 = {
  version: 1;
  workspaceKey: string;
  tiles: Array<{ tabId: string; order: number; weight: number; pin?: boolean }>;
  focusedTabId: string | null;
};
```

- Key it by the same canonical encoded workspace path and panel id rules as tabs, but under a distinct namespace such as `ptah.canvas.ws.{encodedPath}[.{panelId}]`.
- Parse the localStorage boundary with Zod. Reject unknown version/envelope corruption safely; sanitize each tile: known tab id only, finite positive weight clamped to supported limits, unique tab ids, dense deterministic order, boolean pin.
- Reconcile against restored tabs. Missing tabs are dropped; newly restored tabs are **not automatically added** if a persisted canvas envelope exists, because absence is user intent. Auto-seed all tabs only when no canvas record exists (migration/default case).
- Debounce drag/resize writes and flush on workspace switch/destruction. Do not persist derived GridStack `x/y/w/h`.
- Version canvas independently of tab persistence. Bumping tab version 2 would currently make existing readers reject all restored tabs (`tab-persistence.ts:53-60`; partition reader at `tab-workspace-partition.service.ts:504-506`).
- Keep focused id as navigation intent, but sanitize it to a surviving tile. LOD itself remains derived; only `pin` is persisted.

## C. Level-of-detail ladder

### Verdict

The ladder is necessary for 25–50 live streams, but “use `@defer` and cap Live at 6–9” is not an allocation design. It needs explicit creation, eviction, prioritization, hysteresis, and per-level work contracts.

### `pin` is acceptable intent

`pin` records a user preference, not derived geometry, so `{tabId, order, weight, pin?}` respects the intent-only rule. Its semantics must be precise: **pin raises allocation priority/minimum detail; it does not override hard safety budgets**. If nine slots are available and ten tiles are pinned, the UI must remain bounded and explain which pins are waiting. Naming it “keep detailed” may be clearer than implying permanent Live residency.

### Installed Angular proves `@defer` is creation-only here

The installed Angular runtime defines defer states in increasing order—Placeholder 0, Loading 1, Complete 2, Error 3 (`node_modules/@angular/core/fesm2022/_debug_node-chunk.mjs:10274-10280`)—and accepts only `currentState < newState` (`:10858-10859`). There is no Complete-to-Placeholder transition. The viewport trigger is an `IntersectionObserver` that fires only when `isIntersecting` (`:2116-2124`). Angular wraps observer construction outside and callback execution inside `NgZone` (`:10421-10423`), so the trigger works with Angular's zoneless-compatible `NgZone` implementation; it does not rely on a patched scroll event.

But a retained workspace host is literally `display:none` (`canvas-workspace-grid.component.ts:47-55`). Its descendants have no rendered box and cannot become intersecting until the workspace is shown. That behavior is desirable for initial creation, but it means `@defer (on viewport)` is not a background prefetch mechanism. Once a defer block reaches Complete, leaving the viewport or hiding the ancestor does not tear it down.

Use this contract:

- `@defer (on viewport)` may gate the **first import/creation** of a heavy surface.
- An explicit `@if (effectiveLod() === 'live')` owns **residency and destruction**. Put defer inside that branch if bundle deferral is still valuable.
- The allocator's `effectiveLod` is the eviction trigger. Do not use scroll effects that directly mutate per-tile signals independently.
- Determine viewport membership from the transformed tile bounds relative to the canvas viewport, preferably in one observer/coordinator. Add entry/exit margins and time hysteresis to prevent thrash during pan/zoom.

### Missing allocation policy

One central `CanvasLodAllocator` should take `zoomStop`, focused tab, viewport membership, pins, prompt-blocked state, running state, recency, and budgets. It returns a read-only map. A deterministic priority order is: focused; actionable prompt; pinned; visible and running; visible and recently active; everything else. Tie-break by last meaningful activity then tile order. Reserve headroom for a newly focused tile so focusing never temporarily creates Live N+1.

A reasonable starting policy—not a performance fact until profiled—is:

| Stop | Live budget | Compact budget | Default remainder | Notes |
| --- | ---: | ---: | --- | --- |
| Focus | 1–3, hard max 6 | up to 8 visible | Folded | Focused is always Live; adjacent/pinned candidates use spare Live slots. |
| Grid | hard max 6 | up to 12 visible | Folded | Prompts and pins outrank merely recent running sessions. |
| Deck | hard max 1 | up to 8 visible | Folded/Chip | Focus may be Live; pinned means Compact minimum, not Live. |
| Overview | 0 | at most focused/actionable summaries | Chip | No `ChatViewComponent`; overview is navigation/triage. |

For 25–50 simultaneous runs, start with six rather than nine Live surfaces and validate. “Running” does not imply “Live”: background streams must continue through state services while their view is Folded/Chip. Each level needs a negative contract:

- **Live:** full chat surface, composer, markdown, terminals/tool details.
- **Compact:** four-zone summary only; no full transcript DOM, no Monaco/xterm, no mini input.
- **Folded:** header/status/actionable count; no execution-tree walk or markdown parsing.
- **Chip:** name, status icon, unread/actionable badge only.

Test that eviction destroys component instances and releases tile visibility/stream subscriptions. `CanvasTileComponent` currently registers/unregisters visibility at `canvas-tile.component.ts:195-198` and creates/destroys child injector state at `:207-251`; these lifecycle effects are part of the residency contract, not implementation trivia.

## D. Zoom

### Verdict

Keep the viewport/world design, but split visual interpolation from semantic policy and define who owns measurements. Otherwise continuous scaling, LOD, GridStack drag math, and the existing “row is 90% of viewport” rule form a feedback loop.

### `zoomScale` and `zoomStop` are different state

- `zoomScale: number` is transient presentation state used only by the world transform and scroll-bound compensation. It may interpolate continuously during wheel/pinch/animation.
- `zoomStop: 'focus' | 'grid' | 'deck' | 'overview'` is discrete semantic state. It drives the LOD budget, labels, snap behavior, and overview lock.

Do not derive LOD continuously from every scale tick. Change `zoomStop` only at defined thresholds with hysteresis or after snapping, then let the allocator in C recompute once. During an animated transition, keep the source stop's allocations until the destination is committed, or use a separate `isZoomTransitioning` flag that temporarily prevents costly promotions.

### World-bounds contract

GridStack and `CanvasLayoutService` operate in **unscaled world coordinates**. The world element has intrinsic width/height from GridStack. A surrounding bounds/spacer element exposes scroll extents equal to `worldWidth * zoomScale` and `worldHeight * zoomScale`; the transformed world uses `transform-origin: 0 0`. Clamp/recenter scroll offsets when scale changes so the pointer or viewport center remains anchored.

Never feed `getBoundingClientRect()` from the scaled world back into layout as its unscaled container size. GridStack itself has transform compensation—installed `Utils.getValuesFromTransformedElement()` measures a one-pixel child and returns inverse X/Y scale (`node_modules/gridstack/dist/utils.js:713-735`)—but that is evidence to test dragging under a transform, not permission to mix coordinate systems.

The current layout makes each tile at least 90% of the measured viewport height (`canvas-layout.service.ts:8-12,155-169`). Keep that cell height in world units based on the unscaled Focus/Grid viewport. At scale 0.5, a row should visually become roughly 45% of the viewport—that is the point of zooming out. Dividing cell height by scale to keep every row visually at 90% would defeat Deck/Overview and make continuous zoom trigger GridStack relayout. ResizeObserver should react to the outer viewport's actual resize, not the transformed world's compensated bounds.

### Derived effective lock

Do not overwrite the user's lock when entering Overview. Preserve `userLocked` and derive:

```text
effectiveLocked = userLocked || zoomStop === 'overview' || isZoomTransitioning
```

Pass only `effectiveLocked` to GridStack's `setStatic`; the current call is at `canvas-workspace-grid.component.ts:216-220`. Exiting Overview then restores the user's prior choice. Keyboard reordering and tile mode controls must follow the same effective lock, not just pointer gestures.

The zoom implementation must be tested with drag/resize at every scale, pointer-anchored zoom, nested scroll containers, a hidden-then-restored workspace, focus preservation, reduced motion, and LOD threshold hysteresis. The existing hidden-grid remeasure path (`canvas-workspace-grid.component.ts:199-213`) must run after the world is visible and its scale/bounds are committed.

## E. Notification center

### Verdict

Build it, but do not create a second source of truth by having `StreamRouter` “push notifications.” Use a state projection for pending work, a small accepted-transition ledger for historical completion/unread, and one shell-owned navigation transaction.

### 1. Computed state versus events: the exact line

No general event bus is needed.

- **Pending permission and question entries are state.** `PermissionHandlerService` already owns readonly signal arrays (`permission-handler.service.ts:43,103,110,115`), adds/removes requests in its handlers (`:288-300`, `:310-318`, `:389-419`, `:487-525`), and receives routing targets from `StreamRouter` (`stream-router.service.ts:416-471,493-520`). The bell's actionable list should be a `computed` projection of those signals plus target/workspace metadata. Removing/responding to a request automatically removes it. Do not copy a “prompt arrived” record into a notification queue.
- **Finished and read/unread are history.** “Finished” is an accepted transition and disappears from current status; “read” is user-owned state. These require a bounded notification ledger with stable ids, timestamps, workspace/tab/session identity, kind, terminal reason, and `readAt`/dismissal state.
- **Sound and ARIA announcement are side effects.** They react to a newly appended ledger sequence, but do not write business state. This is an appropriate narrowly scoped effect/subscription; the ledger append itself happens in the imperative turn-state application path.

That boundary follows the repository's signal architecture: `computed` for synchronous derivation; an event record only where time/history matters; effects only for external side effects. It avoids a StreamRouter notification bus that can race the actual prompt queue or retain a prompt after it was auto-resolved.

There is one required reactivity repair before that computed is correct. Both target indexes are currently plain `Map`s (`permission-handler.service.ts:61,125`). The router attaches targets **after** enqueueing. `attachQuestionTargets()` forces a new request-array identity at `:543-544`, but `attachPromptTargets()` only mutates the map at `:332-335`; no signal invalidates. A computed can therefore run when the permission is appended, see no targets, and never rerun when routing metadata arrives. Make target attachment atomic with enqueueing, or expose an immutable signal-backed target map/version for both prompt kinds. Do not paper over this by copying the prompt into a notification event.

### 2. Completion edge without an effect that writes signals

The backend's source is `SessionTurnState` (`stream-background.ts:255-273`). `TurnStateApplier.apply()` first performs session/revision acceptance (`turn-state-applier.service.ts:87-113`), finalizes terminal phases (`:115-135`), and then calls `TabManagerService.applyTurnState()` for every accepted target (`:137-139`). `TabManagerService.applyTurnState()` reads the old tab before writing and is documented as the single status writer (`tab-manager.service.ts:1120-1155`); it maps `generating` to `streaming`, background/sleeping to themselves, and `idle`/`failed` to `loaded` (`:1157-1195`) before one update (`:1209`).

Record completion **inside this accepted imperative transition**, not in a signal effect watching `tabs()`:

```text
previous phase-class = tab.status in {streaming, awaiting-background, sleeping}
accepted terminal event = state.phase in {idle, failed}
dedupe identity = sessionId + revision (+ tabId only for fan-out presentation)
success completion = state.phase === idle && state.terminalReason === completed
failure completion = state.phase === failed or non-completed terminalReason
```

If the product means “the foreground answer finished even though background work remains,” that is a different edge (`generating -> awaiting-background`) and must be named separately. The bell wording “session finished” should mean all tracked turn work is terminal, so use `busy-class -> idle/failed`. A sleeping cron is not “finished” merely because its spinner is absent. Preserve the accepted `revision` as dedupe protection; reload reconciliation or fan-out can replay terminal state.

Implementation-wise, add a bounded append-only terminal pulse/ledger writer at the same accepted command boundary (or have `TurnStateApplier` call a narrow data-access port after acceptance). Do not add an `effect(() => { if status changed) notifications.update(...) })`; it loses the previous accepted event semantics, can duplicate during workspace projection swaps, and violates the no-signal-writes-from-effect rule.

### 3. Ownership and Nx tags

Create `libs/frontend/notification-center` with `scope:webview` and `type:feature`. Those are the tags used by the shared Angular feature surface (`chat-streaming`, `chat-routing`, `chat-ui`, `canvas`, and `chat` are all `scope:webview`; their project files show `type:feature`, while `chat-state` is `type:data-access`). `type:feature` may depend on feature/data-access/util under the current boundary rules (`eslint.config.mjs:226-239`). Both the VS Code webview and Electron renderer already consume these frontend libraries, so `scope:webview` is the repo's actual shared-renderer scope despite the label.

The new library should own:

- notification projection/store: pending computeds, bounded completion ledger/read state, grouping;
- a smart `NotificationCenterComponent`/popover using `inject()` and OnPush;
- a dumb bell/list-row presentation split if the template grows;
- sound/announcement side-effect adapters;
- the focus request issued through a core/chat orchestration contract.

Do not put notification domain behavior in `chat-ui`; it is not a presentational atom. Do not put the bell/popover in `chat-state`; that library is data access. The lower-level accepted terminal pulse may live in `chat-state` because `TabManagerService` owns the transition, exposed readonly to the feature. Avoid making `chat` import a feature that imports `chat` back: the new feature should consume `chat-state`/`chat-streaming` and a core navigation token, not `ChatStore`. The shell merely places the component beside the theme control.

### 4. Focus routing is a transaction, not a click handler

The working route today is only active-workspace-centric:

```text
AppStateManager.requestCanvasSession(sessionId)
  -> canvasSessionRequest signal (`app-state.service.ts:657-674`)
  -> mounted OrchestraCanvas effect (`orchestra-canvas.component.ts:289-304`)
  -> CanvasStore.addTileFromSession
  -> ChatStore.switchSession
```

Workspace switching is a separate orchestration: `WorkspaceCoordinatorService.switchWorkspace()` changes workspace scope, tabs, session-list cache, pickers, and app state synchronously (`workspace-coordinator.service.ts:130-182`); the canvas then reacts to the new active path and calls `switchWorkspaceTiles()` (`orchestra-canvas.component.ts:329-334`). `CanvasStore.focusTile()` only writes focus for its current path and calls `TabManagerService.switchTab()` (`canvas.store.ts:264-273`). No method composes these into an awaited cross-workspace focus.

Six cases have no complete path today:

1. **Resolve identity:** an entry can carry a rotated session id, a tab id, or fan out to several bound tabs; current `CanvasSessionRequest` carries only `sessionId`/name (`app-state.service.ts:108-120`). Resolve to a canonical `{workspacePath, tabId, sessionId}` using the tab partition/router indexes, with deterministic handling of multiple tabs.
2. **Non-active workspace:** the current request is consumed by whichever canvas is active. It does not switch workspace. The transaction must `await workspaceCoordinator.switchWorkspace(targetPath)` before issuing tile focus.
3. **LRU-evicted grid:** after the switch, the target `CanvasWorkspaceGridComponent` may be newly mounted. Wait for a canvas/grid-ready acknowledgement; a signal write followed immediately by `focusTile` is a race with component creation and GridStack registration.
4. **Existing tab and existing tile:** focus it without calling `session:load`; switch the tab and then focus the tile after restoration.
5. **Existing tab but no canvas tile:** call `adoptTab(tabId)`, not `addTileFromSession`, then focus. This covers user-removed tiles and tabs restored beyond prior canvas membership.
6. **No usable tab/tile:** decide explicitly whether to create/load a tab and adopt it, or show a stale/deleted notification. Handle the nine-tile cap (`canvas.store.ts:130-176`), layout not in grid mode, canvas unmounted (the current request merely times out false after five seconds at `app-state.service.ts:653-674`), removed workspace, and missing session without silently doing nothing.

Define a core request/response contract such as `requestCanvasFocus(target): Promise<FocusResult>` with structured outcomes (`focused`, `stale`, `workspace-missing`, `tile-cap`, `canvas-unavailable`, `load-failed`). The chat shell/orchestrator owns the transaction because it can coordinate workspace and view state; the component-scoped CanvasStore remains behind the existing signal bridge. Set the app view/layout to the canvas before waiting for readiness, restore focus to the tile or first actionable control, and mark read only after successful navigation—not on pointer-down.

### 5. Sound and CSP

The VS Code webview CSP is `default-src 'none'` and includes img/script/style/font/connect/frame/object/base directives but **no `media-src`** (`apps/ptah-extension-vscode/src/services/webview-html-generator.ts:269-278`). Therefore a bundled `<audio>` file is not currently allowed merely because its URI came through `asWebviewUri`; `default-src 'none'` is the fallback. A data URI also needs an explicit `media-src data:`. Electron's renderer path does not remove the VS Code constraint from the shared component.

The simplest cross-host choice is a short WebAudio oscillator/envelope generated in code: no fetched asset, no second host URL adapter, and no CSP media change. It must lazily create/resume `AudioContext` after user activation; autoplay policy means the first background completion before any interaction may be silent, and that is an acceptable documented fallback. If product insists on a designed audio asset, bundle it and add the narrow `media-src ${webview.cspSource}` (and `data:` only if actually used), then test the production webview CSP.

Provide a real mute preference. `prefers-reduced-motion` must disable pulse/transition motion; it is not semantically an audio preference, though it may be used as a conservative default for surprise effects. Persist `notifications.soundEnabled` through the existing host-backed `settings:get`/`settings:set` RPC rather than ad-hoc localStorage so VS Code and Electron agree; those methods are the shared settings boundary (`rpc.types.ts:1347-1355`, handlers in `libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.handlers.ts:104-163`). Validate the boundary and make sound opt-in or clearly controllable. Never play a sound for restored/replayed history, self-acknowledged prompts, or while the relevant session is already focused.

### 6. Accessibility

- Bell is a real button with an accessible name containing the unread count, `aria-expanded`, `aria-controls`, and visible focus.
- Popover supports Enter/Space to open, Escape to close, Arrow keys or normal tab order, Home/End if using listbox semantics, and returns focus to the bell on close. Do not use menu semantics unless every child really is a menu item.
- On open, focus the heading or first unread entry; after successful activation, move focus to the target tile/header or its pending prompt control.
- Keep one visually hidden `aria-live="polite"`/`role="status"` announcer outside the popover. Announce a coalesced summary (“12 sessions finished; 3 need attention”), not every streaming event. Permission requests needing immediate action may be announced assertively only if testing shows it is not disruptive.
- Icons/colors require text labels (“Needs permission”, “Failed”, “Finished”). Respect reduced motion and high-contrast/forced-colors modes.
- Theme placement is host-specific: VS Code's theme toggle is only inside `@if (!isElectron)` at `app-shell.component.html:660-677`; Electron places its global theme toggle at `electron-shell.component.ts:211-222`. The bell must be added to both locations, not only `AppShell`.

### 7. Bursts: 30 open, 12 complete together

Keep individual records for navigation, but present and announce groups. Group by workspace and kind in the popover; default sort is actionable prompts first, then failures, then completions, newest group first. Collapse a burst window (for example 750–1500 ms) into one sound and one live-region announcement. Never debounce ledger insertion—the identities and navigation targets must survive—but debounce/coalesce only the external sound/announcement side effects.

Bound history by both count and age (for example 200 records/7 days), while unresolved prompt entries remain source-derived and therefore cannot be evicted from the actionable view. Deduplicate terminal records by `{sessionId, revision, kind}`; fan-out tabs should be one completion with multiple possible surfaces unless product explicitly wants one record per tab. Badge count should mean unread groups or unread sessions, not raw events. A “mark all read” action must not resolve prompts.

At 25–50 simultaneous sessions, add a notification storm test: 12 terminal states in one batch, prompt arrivals during the burst, replayed terminal revisions, workspace switching during click, and two clicks racing to different workspaces.

## Confirmed concurrency track: 25–50 generating sessions

This requirement is now in scope, not a hypothetical risk. The UI plan can reduce renderer cost, but it does not establish that the product can sustain 50 SDK queries, tool processes, permission waits, event streams, persistence writes, and session-state records concurrently.

Before raising `CanvasStore.MAX_TILES` above nine, establish:

- a documented per-session and host-wide resource budget (processes, file descriptors/handles, memory, stdout/event throughput, PTYs/tool children, pending prompts, transcript/event caps);
- admission and overload behavior that still permits the target 50 genuine generators on supported hardware, with cancellation/fairness and no session starving another;
- isolation: one blocked tool/prompt, slow consumer, malformed event, or failed SDK process cannot stall other sessions;
- transport backpressure and batching. The existing `ChatStreamBroadcaster` and `stream-batch-buffer.ts` are the correct surfaces to profile; do not create one UI subscription per rendered level or drop events merely because a tile is not Live;
- durable, bounded turn-state and prompt routing across workspace switches and renderer reloads;
- load tests at 25 and 50 simultaneous root sessions, including subagents/tools, plus a soak long enough to expose heap growth, synchronous localStorage pressure, event-loop lag, and sound/notification storms.

Relevant implementation surfaces to audit are `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`, `helpers/session-turn-state.registry.ts`, permission/question registries, `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts`, `stream-batch-buffer.ts`, the host webview managers, frontend `StreamingHandlerService`/accumulators, and tab persistence. The internal-query gate described in `agent-sdk/CLAUDE.md` governs a different background-query facility; do not mistake its configurable concurrency for user-session capacity.

The UI allocator must also be load-tested with all 50 continuing to update while only 0–6 are Live. If Folded/Chip still causes full execution-tree reconstruction or every delta triggers global computed invalidation, the LOD design has failed even if DOM node count looks small.

## Corrected ordered sequence

The confirmation of 25–50 simultaneous runs changes the sequence. Compact redesign remains the first **UI** change, but concurrency discovery and a baseline load harness become step zero and a release gate; no tile-cap increase waits until the backend/transport track passes.

1. **Concurrency baseline and contracts.** Build a repeatable 25/50-session load/soak harness; measure host/SDK process count, heap, event-loop lag, batch throughput, persistence, renderer signal invalidations, and failure isolation. Decide supported hardware/resource budgets and overload behavior.
2. **Compact summary reducer and card.** Replace the mini transcript with the four-zone, non-scrolling presentation; correct prompt routing and state animation; retain current max tile count.
3. **Versioned canvas-intent persistence.** Add the independent V1 envelope, reconciliation, debounced writes, and migration behavior. Measure remount from worst-case persisted messages before changing keep-alive.
4. **LOD allocator and lifecycle.** Implement the central budget policy, four negative work contracts, viewport/hysteresis calculation, initial `@defer`, and explicit `@if` eviction. Prove background sessions keep routing while heavy views are destroyed.
5. **Lower retained-grid cap experimentally.** Profile cap 4 versus 1 with long transcripts and 50 active streams. Ship 1 only if remount latency is acceptable; otherwise retain 2 or add a short warm cache. This is a measured value, not an architectural axiom.
6. **Backend/transport hardening to the confirmed concurrency target.** Address bottlenecks exposed by step 1, then pass 25/50 soak and failure-injection gates. Only now raise canvas/session membership caps and remove the 3x3 assumptions.
7. **Notification data model and terminal edge.** Add the accepted-transition completion ledger, computed prompt projection, dedupe/read/group policies, and replay tests before building the popover.
8. **Cross-workspace focus transaction.** Add the awaited core bridge and all structured failure cases; test active, inactive, evicted, absent-tile, cap, missing-workspace/session, and rapid-race paths.
9. **Notification UI, sound, and accessibility.** Place the bell in both shells, add keyboard/live-region behavior, mute setting, WebAudio side effect, and burst coalescing.
10. **Zoom after LOD semantics are stable.** Add world/viewport scaling, bounds compensation, stop hysteresis, and derived locking. Zoom consumes the allocator; implementing it first would force the LOD policy to be rewritten.
11. **Integrated performance/accessibility gate.** Run 50 simultaneous sessions across several workspaces with zooming, eviction, prompts, burst completions, reduced motion, keyboard-only navigation, and host-specific VS Code/Electron builds.

## File-level change list by step

This is a planning inventory, not permission to implement.

### 1 and 6: concurrency baseline/hardening

- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` and its specs — lifecycle, cancellation, per-query resource accounting.
- `libs/backend/agent-sdk/src/lib/helpers/session-turn-state.registry.ts` and specs — bounded 50-session state/revision behavior.
- `libs/backend/agent-sdk/src/lib/permission/*` — pending prompt capacity, cleanup, and isolation.
- `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts`, `stream-batch-buffer.ts`, and specs — batching/backpressure/fairness.
- Host webview/message managers in `apps/ptah-extension-vscode` and `apps/ptah-electron` — delivery throughput and closed-renderer behavior.
- `libs/frontend/chat-streaming/src/lib/*accumulator*`, `streaming-handler.service.ts`, and specs — bounded event retention and cross-session invalidation.
- `libs/frontend/chat-state/src/lib/tab-persistence.ts` and partition specs — persistence cost under 50 active sessions.
- A dedicated performance/load harness project or existing e2e/perf project, with both VS Code and Electron scenarios; do not hide it in a unit spec.

### 2: compact tile

- `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts` and spec — replace feed UI with presentational four-zone component or split atoms.
- New compact summary types/pure reducer under `libs/frontend/chat-ui/src/lib/molecules/compact-session/` only if inputs remain presentation-ready; otherwise place orchestration in chat.
- `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts` and spec — derive per-tab inputs, targeted prompts, remove canvas-redundant chrome/input/footer.
- `libs/frontend/canvas/src/lib/canvas-tile.component.ts` and spec — pass canvas context/status style, retain sole title/mode controls.
- `libs/frontend/chat-ui/src/index.ts` and `libs/frontend/chat/src/lib/components/index.ts` — remove obsolete exports only after usage is gone.
- `apps/ptah-extension-webview/src/styles.css` or component styles — compositor-safe pseudo-element and reduced-motion fallback.

### 3 and 5: persistence/retention

- New focused persistence adapter/schema files in `libs/frontend/canvas/src/lib/` (for example `canvas-persistence.ts` and `.spec.ts`) — V1 Zod envelope, sanitize/reconcile.
- `libs/frontend/canvas/src/lib/canvas.store.ts` and spec — hydrate/write intent, pin field, focused id, membership semantics, configurable/measured retained cap.
- `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts` and spec — initialization ordering and flush/restore; replace membership-only restoration when a canvas record exists.
- `libs/frontend/chat-state/src/lib/tab-workspace-partition.service.ts` only if a public canonical workspace storage-key helper is extracted; do not couple canvas to its private map.
- Keep `tab-persistence.ts` version 2 unchanged unless tab schema itself changes.

### 4: LOD

- New `libs/frontend/canvas/src/lib/canvas-lod-allocator.service.ts` and spec — central budgets, priority, hysteresis, hard cap.
- `canvas-workspace-grid.component.ts` and spec — viewport reporting and LOD input per tile.
- `canvas-tile.component.ts` and spec — explicit Live/Compact/Folded/Chip branches, defer-for-create and if-for-evict, lifecycle cleanup.
- `canvas.store.ts` — user pin intent only; no persisted effective LOD.
- `orchestra-canvas.component.ts` — allocator composition and global budgets across the active/retained surfaces.

### 7–9: notification center and navigation

- New `libs/frontend/notification-center/project.json` with `scope:webview`, `type:feature`; `src/index.ts` as the only public API.
- New notification projection/store, component/popover, sound service, and focused specs in that lib.
- `libs/frontend/chat-state/src/lib/tab-manager.service.ts` and specs — emit/append a dedupable terminal transition record at accepted `applyTurnState`; expose cross-workspace lookup metadata without UI dependencies.
- `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts` and specs — expose target-aware readonly projections/helpers without duplicating request state.
- `libs/frontend/chat-routing/src/lib/stream-router.service.ts` tests — prove routing metadata, not notification duplication.
- `libs/frontend/core/src/lib/services/app-state.service.ts` plus a core token/type — structured, awaited canvas-focus request/result.
- `libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts` and a new/focused navigation orchestrator — own the cross-workspace transaction.
- `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts`, `canvas.store.ts`, and specs — consume focus requests, await readiness/adoption/focus, return structured result.
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.html/.ts` — VS Code placement.
- `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts` — Electron placement.
- Shared settings RPC contracts/registry and frontend settings UI for `notifications.soundEnabled`; `apps/ptah-extension-vscode/src/services/webview-html-generator.ts` only if an audio asset is chosen and `media-src` is required.
- Webview/electron e2e tests — keyboard, focus restoration, live announcements, CSP/audio, burst grouping, cross-workspace navigation.

### 10: zoom

- `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts` and styles — controls, outer viewport/world/bounds wrapper.
- `canvas-workspace-grid.component.ts` and specs — scale/stop/effective-lock inputs and hidden-grid remeasure ordering.
- `canvas-layout.service.ts` and specs — explicit unscaled measurement contract; no scale feedback into `cellHeightFor`.
- New small zoom state/controller under canvas if needed — `zoomScale`, `zoomStop`, threshold hysteresis, pointer anchor math.
- `canvas.store.ts` only for persisted user zoom preference if product explicitly wants one; do not mix zoom with tile geometry intent by default.

## What to drop or change

- **Drop the prose-duplication rationale.** It is refuted by the immediate return at `compact-session-activity.component.ts:582`.
- **Drop a general notification event bus and StreamRouter “notification pushes.”** They duplicate prompt truth and reintroduce ordering races.
- **Drop “custom property means compositor.”** Animate transform/opacity on a pseudo-element.
- **Drop `@defer` as eviction.** It is a monotonic creation state machine in the installed Angular runtime.
- **Drop “cap 1” as a foregone conclusion.** Make it a profiled result; cap 2 may be a better remount/heap tradeoff.
- **Drop “workspace limit removed entirely.”** Only mounted grids become unbounded in count; retained state still needs bounds.
- **Drop a permanent 6–9 Live target without stop-specific budgets.** Overview should have zero Live surfaces, and the confirmed 50-run target argues for starting at six or fewer.
- **Defer deletion of compact header/input classes until non-canvas use is resolved.** Remove redundant composition first.
- **Do not make `prefers-reduced-motion` the only sound control.** Add an explicit mute setting.

## Riskiest assumption—now confirmed as a required track

The earlier riskiest assumption was that “many tiles” meant many open sessions with only a few generating. The user has now confirmed the opposite: **25–50 sessions must be running simultaneously**. The risk is no longer uncertainty about scope; it is that this plan is predominantly a renderer design while the hardest capacity constraint may be backend process creation, tool/PTY fan-out, provider limits, stream multiplexing, memory retention, or synchronous persistence.

That confirmation changes the recommendation in three ways:

1. A concurrency load harness and resource contract move to step zero, before UI cap changes.
2. LOD is still mandatory, but its proof is “44–50 background streams continue correctly while at most six heavy views exist,” not merely “the DOM is smaller.”
3. Zoom and notification polish move behind a 25/50-session soak gate; otherwise the team can ship an elegant overview of a workload the core cannot sustain.

The single highest-risk implementation assumption is now: **that the existing backend and host transport can run and fairly multiplex 50 independent SDK turns without an explicit, measured capacity architecture.** Nothing inspected establishes that. Treat 50-way generation as a cross-host performance and fault-isolation feature with its own acceptance criteria, not as a larger `MAX_TILES` constant.
