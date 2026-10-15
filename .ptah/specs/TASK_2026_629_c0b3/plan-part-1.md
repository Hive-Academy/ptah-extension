# Implementation Plan Part 1 - TASK_2026_629_c0b3 (steps 1-3)

Scope: delivery steps 1-3 only. Steps 4-7 are in other plan parts.
Paths are repo-relative. `chat/...` = `libs/frontend/chat/src/lib/...`.

## Inputs and constraints

- Requirements used: `task-description.md:98-143` (steps 1-3), `:243-275` (628 boundary), `:311` (reflow risk), `:315-329` (open questions).
- Corrections applied: coordinator update from the 628 owner (step 2): `summarizeLive` has ONE caller, `CompactSessionCardComponent.summary` (`compact-session-card.component.ts:122-139`). The card renders compact mode in BOTH the canvas and the main panel. The 500 ms sampler lives in the card and is NOT gated to the canvas. 628 adds no sampler.
- Design handoff used: none read. `prototypes/01-board.html` was not opened (tool budget). Zone order comes from `task-description.md:135`. Visual detail is an Assumption (see step 3).
- Missing decision-critical input: none. The live budget has no UI (`task-description.md:79`, `:319`). One named constant is enough for AC 1.7.

## Codebase evidence

| Evidence | Location | Implication |
| --- | --- | --- |
| Step 1-3 acceptance criteria | `task-description.md:98-143` | Scope of this part |
| 628 ownership table and "work near" rules | `task-description.md:243-275` | No edits in listed files; step 1 must not write view mode via `updateTabInternal` (`:275`); no new maps of tile `ElementRef`s (`:266-267`) |
| No live-budget constant or setting exists in `libs/frontend` (Grep `liveBudget|budget` found only unrelated session/token budgets) | Grep over `libs/frontend/**/*.ts` | Step 1 creates the value (one named constant) |
| `ChatViewComponent` swaps to the compact card when `isCompactViewMode(resolvedViewMode()) && resolvedActiveTab()` | `chat/components/templates/chat-view.component.html:4` | One gate decides card vs transcript. The `@else` (`:15`) holds the transcript `@for` (`:80-81`), banners (`:105-203`). The agent sidebar block (`:268-354`) is OUTSIDE that `@if/@else`, so the card swap does NOT unmount the sidebar (see step 1 note) |
| Compact gate destroys the keep-alive region | `chat-view.component.ts:837-840` | Card mode unmounts the transcript, as intended |
| `resolvedViewMode` computed reads tile `SESSION_CONTEXT` | `chat-view.component.ts:909-912` | The gate already resolves per tile |
| Tile reads stored mode from `TabManagerService` | `canvas/src/lib/canvas-tile.component.ts:599-602` | Stored mode = `tabManager.getTabViewMode(tabId)` |
| Tile toggle writes stored mode via `tabManager.toggleTabViewMode` | `canvas-tile.component.ts:650-653` | Toggle path stays as is (AC 1.6) |
| Tile provides per-session tokens in a child injector: `SESSION_CONTEXT`, `SESSION_VISIBLE`, `SESSION_FOCUSED`, `SURFACE_ACTIVE` | `canvas-tile.component.ts:613-627` | Established pattern to carry a per-tile signal into `ptah-chat-view` |
| `SESSION_FOCUSED` token: `InjectionToken<Signal<boolean>>` | `chat/tokens/session-context.token.ts:42-44` | Place the new token beside it, same shape |
| `focused` input (default true); grid binds `canvasStore.focusedTabId() === item.tabId` | `canvas-tile.component.ts:436`, `canvas-workspace-grid.component.ts:126-130` | Focus is already known per tile |
| Grid projects geometry from the STORED view mode | `canvas-workspace-grid.component.ts:253` | Automatic card mode must NOT feed this path, so `x/y/w/h` stay unchanged (AC 1.4, risk `task-description.md:311`) |
| `canvasStore.tiles()` is active-workspace scoped | `orchestra-canvas.component.ts:444` | Tile count for the budget = tiles in the rendered workspace |
| `isCompactViewMode` helper | `chat-types/src/lib/chat-types.ts:453` | Reuse; no new `TabViewMode` value |
| Card `summary` computed calls `summarizeLive(tab.streamingState, context)` or `summarizeFinalized` | `chat/components/molecules/compact-session/compact-session-card.component.ts:122-139` | Sampling wraps this computed |
| Card context parts: `sessionQuestions` (`:75-82`), `sessionPermissions` (`:84-89`), `compaction` (`:91-103`), `metrics` (`:110-120`), `workspacePath` (`:71-73`); input `tab` (`:60`), output `expandToFull` (`:61`) | same file | These are the "immediate" inputs of AC 2.2. They read `tab()`, which changes on every stream flush |
| Card already injects `permissionHandler` (`routingTargetRevision`, `questionRequests`, `permissionRequests`) | `compact-session-card.component.ts:63-89` | Session-permission Allow/Deny can use this service (AC 3.5) |
| `CompactSessionActivityComponent` has one input `summary` | `chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts:696-697` | Add lane inputs; keep it presentational (AC 3.8). It injects only `DestroyRef`, `NgZone` (`:883-884`) |
| `agentVisibleInSession(parentSessionId, sessionId): boolean` | `chat-streaming/src/lib/session-scope.ts:60-63` | Lane scope filter (AC 3.4) |
| `MonitoredAgent` already used in chat lib (`agentId`, `cli`) | `chat-view.component.ts:122-125` | chat already depends on `AgentMonitorStore` types; no new lib edge |
| Store public API allowed: `agents`, `agentsForSession`, `sessionSubagentsForSession`, `permissionQueue`, `clearPermission`, `stopAgent` | `task-description.md:268-271` | Names verified only from the task text. See Assumption A3 |
| CLI permission resolve path | `canvas/src/lib/tile-agent-mini-panel.component.ts:124-142` (cited by `task-description.md:139`, not opened) | Copy the message + `clearPermission` path. See Assumption A4 |

## Step 1 - Automatic card mode above the live budget

### Decision

- Chosen approach: a per-tile "forced card" signal. The workspace grid computes `autoCard = tileCount > CANVAS_LIVE_BUDGET && !focused` for each tile. The tile passes it into its child injector through a new token `SESSION_FORCED_CARD: InjectionToken<Signal<boolean>>`. `ChatViewComponent` reads the token (optional) and shows the card when `forcedCard() || isCompactViewMode(resolvedViewMode())`.
- Rationale: the stored view mode is never written (AC 1.5, `task-description.md:275`). The grid geometry path (`canvas-workspace-grid.component.ts:253`) still reads the stored mode, so `x/y/w/h` do not change on focus (AC 1.4). The token follows the existing `SESSION_FOCUSED` pattern (`canvas-tile.component.ts:621`, `session-context.token.ts:42`).
- Rejected: (a) write `compact` through `TabManagerService` for unfocused tiles: it overwrites the stored mode and touches the 628 tab-flush area. (b) Make `resolvedViewMode` return `compact`: other consumers of that computed (height, labels) would change, and grid reflow could follow. (c) Read `SESSION_FOCUSED` directly in `ChatViewComponent` plus a tile-count service: it couples chat-view to canvas tile count; the grid already has both facts.
- Effect on existing code: no change for 1-2 tiles. The main panel provides no token, so it is unchanged.

### Contracts

- `canvas/src/lib/canvas-live-budget.ts` (CREATE):
  - `export const CANVAS_LIVE_BUDGET = 2;` — the one place the value lives (AC 1.7).
  - `export function isAutoCardTile(tileCount: number, focused: boolean, budget = CANVAS_LIVE_BUDGET): boolean` → `tileCount > budget && !focused`.
- `chat/tokens/session-context.token.ts` (MODIFY): add `export const SESSION_FORCED_CARD = new InjectionToken<Signal<boolean>>('SESSION_FORCED_CARD');` beside `SESSION_FOCUSED`. Export it where `SESSION_FOCUSED` is exported (Assumption A1: same barrel; implementer checks `chat/src/index.ts`).
- `CanvasTileComponent` (MODIFY): new input `readonly autoCard = input<boolean>(false);`. In `ngOnInit` (`:616-626`) add `{ provide: SESSION_FORCED_CARD, useValue: this.autoCard }`. Optional: the header shows a small "card (auto)" hint when `autoCard()`; no new buttons.
- `CanvasWorkspaceGridComponent` (MODIFY, template at `:126-130`): bind `[autoCard]="isAutoCardTile(items.length, canvasStore.focusedTabId() === item.tabId)"` (use the count of the grid's own rendered items; Assumption A2). Expose `isAutoCardTile` as a protected field. No other grid hunk.
- `ChatViewComponent` (MODIFY): `private readonly _forcedCard = inject(SESSION_FORCED_CARD, { optional: true });` and `readonly showCompactCard = computed(() => (this._forcedCard?.() ?? false) || isCompactViewMode(this.resolvedViewMode()));`. Template `chat-view.component.html:4` becomes `@if (showCompactCard() && resolvedActiveTab())`. `resolvedViewMode` itself is unchanged.

### Data flow

`canvasStore.focusedTabId()` + grid item count → grid binding `autoCard` → tile input → child-injector token → `ChatViewComponent.showCompactCard` → `@if` at `:4` → card or transcript.

### Behaviour per AC

- 1.1 / 1.2: count 1 or 2 → `isAutoCardTile` false → no change.
- 1.3: count ≥ 3 → every unfocused tile `autoCard = true` → card; focused tile renders by its stored mode.
- 1.4: focus change flips two booleans only. Grid layout input (`:253`) is stored mode → no Gridstack update. The spec asserts geometry is equal before and after.
- 1.5: stored mode untouched; when the count drops to 2, `autoCard` goes false and the stored mode shows again.
- 1.6: the focused tile is never auto-card, so its toggle (`:650-653`) acts as today. On an unfocused auto-card tile the toggle still writes the stored mode (user intent); the tile stays a card until focused. Accepted.
- 1.7: change `CANVAS_LIVE_BUDGET`; nothing else.
- Sidebar note: the agent sidebar block (`chat-view.component.html:268-354`) sits outside the `@if/@else`. Assumption A5: inside a canvas tile `hideAgentSidebar`/dock is off, so nothing extra mounts. Implementer checks the tile host bindings; if the sidebar mounts in tiles, gate it with `!showCompactCard()` as well.

### Failure behaviour

- Token absent (main panel, tribunal conductor, tests): `_forcedCard` is null → false → today's behaviour.
- Focused tab id is null or not in this workspace: every tile becomes a card when count > budget. Accepted: the user clicks a card to focus it (`onTileClick`, `canvas-tile.component.ts:639-641`).
- No new arrays or maps of `ElementRef` or DOM nodes (`task-description.md:266-267`).

## Step 2 - Sampled compact summary (~500 ms)

Applies the 628-owner update: the sampler lives in `CompactSessionCardComponent` and runs for EVERY card (canvas and main panel). No canvas gate. `compact-session-summary.ts` has no diff.

### Decision

- Chosen approach: split the card's `summary` into (1) an immediate context with structural equality and (2) a sampled copy of `tab().streamingState`. `summary` reads the sampled state, not `tab().streamingState`.
- Rationale: AC 2.1 needs ≤ 2-3 `summarizeLive` calls per second under 100 events. AC 2.2 needs permission, question, error and status changes on the next frame. Today every stream flush gives a new `tab` object, so `summary` (`:122-139`) re-runs `summarizeLive` each flush.
- Rejected: (a) `rxjs` `throttleTime` on a `toObservable(tab)`: adds an interop layer for one value; a single timer is enough. (b) Throttle the whole `summary`: delays the AC 2.2 signals. (c) Sampling in `compact-session-summary.ts`: 628-owned.

### Contracts (all inside `compact-session-card.component.ts`, or a helper file in the same folder)

- `CARD_SUMMARY_SAMPLE_MS = 500` (const, exported for the spec).
- `private readonly tabId = computed(() => this.tab().id);` and use `tabId()` (not `tab()`) in `tabLookup`, `compaction` and in `targetsTab` reads (Assumption A6: `targetsTab` reads `this.tab()`; implementer confirms and switches it to `tabId()`).
- Immediate parts get `equal` functions so a new `tab` object with the same values does not propagate:
  - `sessionStatus = computed(() => this.tab().status)`, `terminalReason = computed(() => this.tab().lastTerminalReason)`, `sessionIdentity = computed(() => this.tab().claudeSessionId ?? this.tab().id)`.
  - `sessionQuestions`, `sessionPermissions`: add `equal: sameItems` (same length and `===` per item).
  - `metrics`: add `equal` comparing the five fields (`:113-119`).
  - `context = computed<CompactSummaryContext>(...)` built from those parts.
- Sampler state: `private readonly sampledStreaming = signal<StreamingState | null>(null)` (type name per the `tab.streamingState` field type; Assumption A7), `lastSampleAt = 0`, `pending: ReturnType<typeof setTimeout> | null`.
- Sampler `effect` (one per card) reads `this.tab().streamingState`:
  - `null` → clear `pending`, set `sampledStreaming(null)` at once (finalized path, AC 2.3).
  - not null and `now - lastSampleAt >= 500` and no `pending` → set at once, `lastSampleAt = now`.
  - else if no `pending` → `setTimeout(flush, lastSampleAt + 500 - now)`; `flush` reads `untracked(() => this.tab().streamingState)`, sets it, clears `pending`.
- `summary = computed(() => { const live = this.sampledStreaming(); const tab = untracked(this.tab) ...; return this.tab().streamingState is set && live ? summarizeLive(live, this.context()) : summarizeFinalized(messages, this.context()); })`. Implementer note: the finalized branch must depend on `tab().messages` only through a computed with reference equality (`messages = computed(() => this.tab().messages)`), so the finalized path also does not re-run on unrelated flushes.
- Release: `inject(DestroyRef).onDestroy(() => clearTimeout(pending))` (AC 2.4).

### Data flow

stream flush → new `tab` input → sampler effect → (at most 2/s) `sampledStreaming` → `summary` → `ptah-compact-session-activity [summary]`. Permission/question/status/compaction → `context` (immediate) → `summary` with the last sample.

### Failure behaviour

- Timer fires after destroy: impossible, cleared in `onDestroy`.
- First live event: rendered at once (no 500 ms blank).
- Context changes still call `summarizeLive` once each; these are rare events. The 2-3/s bound in AC 2.1 is for stream events only; the spec sends stream events with fixed context.

## Step 3 - Status card layout with Lanes table

### Decision

- Chosen approach: the card (`chat` lib) computes lane rows from `AgentMonitorStore` public signals with a pure helper. `CompactSessionActivityComponent` (`chat-ui`) gets plain inputs and outputs and renders five fixed zones. No store edit; `chat-ui` does not import `chat` or `chat-streaming` stores.
- Rationale: AC 3.8 and the 628 rule (`task-description.md:268-271`). The card already owns session data and `permissionHandler` (`:63-89`).
- Rejected: injecting `AgentMonitorStore` into `CompactSessionActivityComponent` (breaks AC 3.8); a new store selector (628-owned file).
- Scope note: the card is shared, so the main-panel compact view gets the same zones. Accepted: one card layout everywhere.

### Contracts

- `chat-ui/src/lib/molecules/compact-session/compact-lane.types.ts` (CREATE), exported from the `chat-ui` barrel:
  - `type CompactLaneKind = 'subagent' | 'cli' | 'background';`
  - `type CompactLaneStatus = 'waiting' | 'error' | 'running' | 'done' | 'stopped';`
  - `interface CompactLaneRow { readonly id: string; readonly name: string; readonly kind: CompactLaneKind; readonly status: CompactLaneStatus; readonly startedAt: number | null; readonly endedAt: number | null; }`
  - `interface CompactLaneSummary { readonly rows: readonly CompactLaneRow[]; readonly moreCount: number; readonly total: number; readonly counts: Readonly<Record<CompactLaneStatus, number>>; }`
  - `type CompactCallout = { kind: 'permission'; source: 'session' | 'cli'; requestId: string; agentId?: string; text: string } | { kind: 'error'; text: string; canRetry: boolean } | null;`
- `chat/components/molecules/compact-session/compact-lane-rows.ts` (CREATE): pure `buildLaneSummary(agents, subagents, sessionId, max = 3): CompactLaneSummary`.
  - Filter CLI agents with `agentVisibleInSession(agent.parentSessionId, sessionId)` (`session-scope.ts:60`).
  - Map store status values to `CompactLaneStatus` (Assumption A3: exact store status strings; implementer opens `agent-monitor.store.ts`, read only).
  - Sort by `waiting, error, running, done, stopped`, then newest start first. Rows = first 3. `moreCount = total - rows.length` (AC 3.2-3.4).
- `CompactSessionCardComponent` (MODIFY):
  - `inject(AgentMonitorStore)`; `laneSummary = computed(() => buildLaneSummary(...))` from the public signals named in `task-description.md:269-270`.
  - `callout = computed<CompactCallout>()`: first session permission (`sessionPermissions()`), else first CLI permission from `permissionQueue` scoped by `agentVisibleInSession`, else session error from `tab().status`/`lastTerminalReason` (`canRetry` true only where a retry action exists today; Assumption A8).
  - Handlers: `onAllow/onDeny(callout)` → session: `PermissionHandlerService` response method (same one the full view uses; Assumption A4); CLI: post `AGENT_MONITOR_PERMISSION_RESPONSE` and call `AgentMonitorStore.clearPermission`, copied from `tile-agent-mini-panel.component.ts:124-142`. `onShowOutput` → emit existing `expandToFull` (`:61`).
  - Elapsed time: one `now = signal(Date.now())` updated by the step 2 sampler tick only while any lane is running. No per-row timer.
- `CompactSessionActivityComponent` (MODIFY): new inputs `lanes = input<CompactLaneSummary | null>(null)`, `callout = input<CompactCallout>(null)`, `now = input<number>(0)`, `branch`, `elapsed` (Assumption A9: if not already in `CompactSessionSummary`). Outputs `allow`, `deny`, `showOutput`, `retry`. Template order: header → branch · model · elapsed → Now → Lanes (summary line + table OR callout) → metrics. Each zone has a fixed min-height and a placeholder ("No lanes", "—") so offsets match across cards (AC 3.1, 3.7). No `content-visibility`. Any repeated animation uses `transform`/`opacity` only.
- Visual detail (icons, pill colours) follows `prototypes/01-board.html` (Assumption A10: not opened in this pass).

### Failure behaviour

- Store returns no agents → `total = 0` → placeholder row, summary line "No lanes".
- Allow/Deny post fails: keep the callout (do not clear locally first); the existing path decides. Same as the mini panel.
- Unknown store status → map to `running`, never drop the lane (AC 3.4).

## Parity list (steps 1-3)

| Behaviour | Today | After | Check |
| --- | --- | --- | --- |
| 1 tile live, fills canvas | yes | same (`isAutoCardTile` false) | grid spec AC 1.1 |
| 2 tiles live side by side | yes | same | grid spec AC 1.2 |
| Compact/full toggle per tile | `canvas-tile.component.ts:650-653` | same path; focused tile never forced | tile spec AC 1.6 |
| Stored per-tab view mode | `TabManagerService` | never written by auto mode | spec: `toggleTabViewMode`/setters not called |
| Grid geometry | from stored mode (`canvas-workspace-grid.component.ts:253`) | same input | spec: `x/y/w/h` equal across focus change |
| Main-panel compact card | `chat-view.component.html:4` | same gate + sampled summary | chat-view spec `:2244` block still passes |
| Retention / LRU of tile transcripts | keep-alive in chat-view, cache key `chat-transcript.component.ts:416` | untouched; card mode unmounts the transcript as compact does today (`chat-view.component.ts:837-840`) | no diff in 628 files |
| Card questions/permissions | immediate | still immediate (AC 2.2) | card spec |

## Unit tests (part 1)

- `canvas/src/lib/canvas-live-budget.spec.ts` (CREATE): `isAutoCardTile` table (1, 2, 3 tiles; focused/unfocused; budget 3).
- `canvas/src/lib/canvas-workspace-grid.component.spec.ts` (MODIFY or CREATE if absent): AC 1.1-1.5 — `autoCard` bindings per tile; geometry unchanged on focus change; stored mode not written.
- `canvas/src/lib/canvas-tile.component.spec.ts` (MODIFY): child injector provides `SESSION_FORCED_CARD` equal to `autoCard`.
- `chat/components/templates/chat-view.component.spec.ts` (MODIFY): forced token true → card, transcript not mounted; token absent → today.
- `chat/components/molecules/compact-session/compact-session-card.component.spec.ts` (MODIFY or CREATE): fake timers, `jest.spyOn` on `summarizeLive`; 100 stream updates in 1 s → ≤ 3 calls; permission arrives → visible without `advanceTimersByTime`; stream ends → `summarizeFinalized` used; destroy → `jest.getTimerCount() === 0`.
- `chat/components/molecules/compact-session/compact-lane-rows.spec.ts` (CREATE): cap 3, `moreCount`, sort order, scope filter, unknown status kept.
- `chat-ui/.../compact-session-activity.component.spec.ts` (MODIFY): zone order, placeholders, callout replaces rows and keeps the summary line, outputs fire.
- Verification (only if run): `npx nx test canvas --parallel=1`, `npx nx test chat --parallel=1`, `npx nx test chat-ui --parallel=1`, one at a time; or Jest on the changed specs with `--coverage=false --maxWorkers=2`. No workspace-wide runs, no build/serve/e2e. Filter output with `| tail`.

## Assumptions to resolve

- A1: `SESSION_FOCUSED` is exported from the `chat` public barrel and canvas imports it from there. Check `libs/frontend/chat/src/index.ts`.
- A2: the grid has a local item list for the rendered workspace. Use its length; else `canvasStore.tiles().length` (`orchestra-canvas.component.ts:444`, workspace scoped).
- A3: exact names and shapes of `agentsForSession`, `sessionSubagentsForSession`, `permissionQueue` and the agent status values. Open `chat-streaming/src/lib/agent-monitor.store.ts` read-only.
- A4: session permission response method on `PermissionHandlerService`, and the CLI path at `tile-agent-mini-panel.component.ts:124-142`.
- A5: agent sidebar in `chat-view.component.html:268-354` does not mount inside canvas tiles.
- A6: `targetsTab` reads `this.tab()`.
- A7: type name of `TabState.streamingState`.
- A8: which error states have a retry action today.
- A9: branch/elapsed fields exist in `CompactSessionSummary` or must come in as inputs.
- A10: visual detail from `prototypes/01-board.html`.

## Files to touch (part 1)

| Path | Create/modify | Step | Overlap with 628? |
| --- | --- | --- | --- |
| `libs/frontend/canvas/src/lib/canvas-live-budget.ts` | create | 1 | no |
| `libs/frontend/canvas/src/lib/canvas-live-budget.spec.ts` | create | 1 | no |
| `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts` | modify | 1 | yes: Gridstack area. Only hunk: `[autoCard]` binding in the tile template (`:126-130`) + one protected field. No adapter, registry or `ElementRef` change |
| `libs/frontend/canvas/src/lib/canvas-tile.component.ts` | modify | 1 | yes: tile file. Only hunks: new `autoCard` input near `:436`, one provider line in `ngOnInit` (`:616-626`), optional header hint. No `ElementRef`/destroy change |
| `libs/frontend/canvas/src/lib/canvas-tile.component.spec.ts` | modify | 1 | low: spec only |
| `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts` | modify/create | 1 | low: spec only |
| `libs/frontend/chat/src/lib/tokens/session-context.token.ts` | modify | 1 | no |
| `libs/frontend/chat/src/index.ts` (if token not auto-exported) | modify | 1 | no |
| `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` | modify | 1 | no (not in 628 list) |
| `libs/frontend/chat/src/lib/components/templates/chat-view.component.html` | modify | 1 | no; line `:4` only |
| `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts` | modify | 1 | no |
| `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts` | modify | 2, 3 | no edit to 628 files; it is the single `summarizeLive` caller, so 628's linear `summarizeLive` changes its cost |
| `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.spec.ts` | modify/create | 2, 3 | no |
| `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-lane-rows.ts` | create | 3 | no; reads store public API only |
| `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-lane-rows.spec.ts` | create | 3 | no |
| `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-lane.types.ts` | create | 3 | no |
| `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts` | modify | 3 | no; same folder as 628-owned `compact-session-summary.ts`, which gets no diff |
| `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.spec.ts` | modify | 3 | no |
| `libs/frontend/chat-ui/src/index.ts` | modify | 3 | no; export new types |

Not touched: `compact-session-summary.ts`, `agent-monitor.store.ts`, agent-card files, `chat-transcript.component.ts:416`, `batched-update.service.ts`, `tab-manager.service.ts`, `stream-presentation-store.service.ts`, `libs/frontend/markdown`, `apps/ptah-extension-webview/src/styles.css`.

## Requests to 628 (part 1)

1. Keep `CompactSessionCardComponent.summary` (`compact-session-card.component.ts:122-139`) as the only `summarizeLive` caller, and keep `summarizeLive(state, context)` / `summarizeFinalized(messages, context)` signatures stable. 629 wraps the call with the sampler.
2. Keep `AgentMonitorStore` public signal names and shapes stable: `agents`, `agentsForSession`, `sessionSubagentsForSession`, `permissionQueue`, `clearPermission`, `stopAgent`, and the agent status values. 629 maps them in `compact-lane-rows.ts`.
3. In `canvas-tile.component.ts` and `canvas-workspace-grid.component.ts`, 629 adds only: one `autoCard` input, one injector provider line, one template binding. Please keep the `ngOnInit` child-injector provider list (`canvas-tile.component.ts:616-626`) and the tile template binding block (`canvas-workspace-grid.component.ts:126-130`) in place so the rebase is clean.
4. Confirm the leak fix does not change how `ptah-chat-view` is created inside the tile (child injector from `canvas-tile.component.ts:616`). Step 1 depends on that injector.
