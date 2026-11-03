# Implementation Plan - TASK_2026_853_3401

## Inputs and constraints

- Requirements used: `context.md`, `task-description.md` (goals A-E), `research-report.md` (Q1-Q5).
  Background: `TASK_2026_710_html/implementation-plan.md` (sandbox, CSP, bridge, "one live viewer"),
  `TASK_2026_539_67f5/context.md` (declarative surfaces in chat tabs: not touched here).
- Corrections applied: research line numbers drift. `display-sheet.component.ts` bucket read is at :122-124,
  not :115-117. Research "source 1" (tile/active-tab split) is real but gives "Open does nothing in the
  tile", not the reported text (see A). The research did not see that `artifacts:list` returns nothing for a
  session that is not live (`artifact-rpc.handlers.ts:60-66`); this drives the C design.
- Design handoff used: none. UI follows existing tokens and components (`ptah-sidebar-tab`, `ptah-artifact-card`).
- Missing decision-critical input: none. Unattended session: every open point is decided in "Risks and decisions".

## Codebase evidence

| Evidence | Location | Implication |
| --- | --- | --- |
| Card finds its record in ANY bucket | `artifact.store.ts:34-40`, `tool-call-item.component.ts:178-181` | Card shows Open even when the viewing tab has no such record |
| Open uses the GLOBAL active tab | `tool-call-item.component.ts:183-191` | Wrong dock tab in canvas tiles |
| Sheet gives the panel ONE bucket | `display-sheet.component.ts:122-124`; rail `command-rail-display.component.ts:162-165` | Panel shows "not loaded in this tab" (`display-panel.component.ts:164,221,368`) |
| Bucket = registry tab of the MCP caller | `protocol-dispatcher.ts:2365-2378`, `http-mcp-server.service.ts:422`, `session-registry.service.ts:416-418` | Bucket can differ from the tab that shows the transcript |
| `artifacts:list` needs a LIVE registry record and filters by its tab | `artifact-rpc.handlers.ts:60-69`; frontend filter `artifact.store.ts:66` | After restart or in a tile that never was active, records do not load |
| Bytes resolve by id only | `artifact-protocol.ts:40-61`, `electron-artifact-store.ts:189-194` | A record rebuilt from the transcript can render |
| Publish tool result = full record + savedPath | `artifact.schemas.ts:54-65` | Reply cards can rebuild records with `ArtifactPublishResultSchema` |
| Dock store is per ChatView, per tab, never moves focus | `display-dock.state.ts:87-107`, `chat-view.component.ts:207-214` | Auto-open is a state write; tiles own their own store |
| VS Code has no dock, so no sheet | `chat-view.component.ts:207-214, 430-434` | VS Code display is unchanged by D |
| Host-supplied dock (command center) | `session-embed.component.ts:116-120`, `command-center-page.component.ts:200` | Command center keeps its rail Display tab |
| Sheet sits in the column between transcript and composer | `chat-view.component.html:217-221`, `chat-session-layout.component.ts:10-11` | Move to a right column |
| Dock width, separator keys, pointer-capture drag already in ChatView (unused by the template) | `chat-view.component.ts:105-116, 455-476, 580-608, 662-688` | Reuse for the sidebar; host-relative clamp works in tiles |
| Persisted layout widths | `electron-layout.service.ts:219-272, 747-757` | Add the sidebar width here |
| Canvas focus selector names the sheet | `canvas-rail-board.component.ts:61-62` | Update with the overlay class |
| One window, one trusted webContents | `main-window.ts:121-145`, `ipc-sender-policy.ts:80-100`, `ipc-bridge.ts:315-331` | Generalise to a trusted-id set plus a method allowlist |
| Query string ignored by the navigation policy | `navigation-policy.ts:47-58` | `?ptahWindow=display` is safe |
| Pushes go to the main window only; replies go to the asker | `ipc-bridge.ts:183-199, 398` | Child receives only what its adapter sends |
| `set-state` writes one shared blob | `ipc-bridge.ts:628-640` | Child must not call it |
| Lib-owned RPC family pattern | `artifact-rpc.handlers.ts:32-50`, `manifest.ts:112-117`, `rpc-handler.ts:44-45` | Same shape for `displayWindow:*` |
| Settings descriptor table | `advanced-settings.types.ts:22-29, 83, 416-423` | `display.autoOpenArtifacts` |
| Turn-end chip anchored by end message id | `transcript-turn-summaries.ts:86-133`, `chat-transcript.component.html:93-106`, `transcript-turns.ts:85` | Same anchor for reply cards |
| One live viewer rule, no memory data | `TASK_2026_710_html/implementation-plan.md:101,165,175` | E deferred |

## A. Root cause and fix

- Verified mechanism: two lookups disagree. The card resolves its record from all buckets; Open, the sheet
  and the rail resolve one bucket keyed by a tab id from another source.
- Verified sub-cause 1: Open writes `dock.openArtifact(activeTabId)`, but a canvas tile's sheet reads its own
  `SESSION_CONTEXT` tab in its own dock store. Result: Open does nothing in a non-active tile.
- Inferred sub-cause 2 (gives the exact reported text in the main view): the publishing session's registry
  `tabId` differs from the tab that shows its transcript. This can happen when a live session is continued
  from another tab or reopened from history. Not reproduced. `chat-session.service.ts:1615-1658` is cited by
  research only.
- Verified related defect: `artifacts:list` returns `[]` when the tab has no live registry record. After a
  restart, cards read "Not loaded yet".
- Fix (frontend only, no backend scope change):
  1. `ArtifactStore.panelArtifacts(tabId, selectedArtifactId)` returns the tab bucket plus the selected record
     from any bucket, without duplicates and in bucket order. Sheet, rail and detached window use it.
  2. Open targets the view's tab, never `activeTabId()` (reply card, section C).
  3. `ArtifactStore.adoptPublishResult(raw)` rebuilds records from publish tool results in the transcript.
     It validates with `ArtifactPublishResultSchema` (lazy import, as `artifact.store.ts:57` does), drops
     `savedPath` and upserts. Cards survive restart and tiles.
  4. A true miss (record unknown, or viewer 404) shows "This artifact is not available. It may have been
     deleted, or the list did not load." plus Retry (`retryArtifacts` output -> `ArtifactStore.reload(tabId)`).
- Regression specs (fail on `main`, pass on the branch):
  - `libs/frontend/chat/src/lib/components/organisms/display-sheet/display-sheet.component.spec.ts`:
    "passes an artifact held in another tab bucket to the panel". Records `{ 'registry-tab': [artifact with
    sessionId 'registry-tab'] }`; `dock.openArtifact('tab-1', id)`; input `tabId='tab-1'`. Expect
    `panel.artifacts()` to contain the id and `panel.selectedKey()` to be `artifact:<id>`. On main the list is `[]`.
    The mock store gets `panelArtifacts` delegating to the real pure helper.
  - `libs/frontend/command-center/src/lib/components/command-rail-display.component.spec.ts`: same scenario.
  - `libs/frontend/chat/src/lib/services/artifact.store.spec.ts`: `panelArtifacts` covers cross-bucket,
    already present, and unknown id (no entry).
  - `transcript-turn-artifacts.spec.ts` (new): reply-card Open with `tabId='tile-tab'` writes the selection to
    `dock.tab('tile-tab')`; `dock.tab('other-tab')` stays unchanged.

## B. Auto-open on publish

- Setting: `{ key: 'display.autoOpenArtifacts', group: 'display', kind: 'boolean', label: 'Open artifacts when
  published', help: 'Opens the Display panel on a newly published artifact.', default: true, apply: 'live' }`.
  Also new group id `'display'` in the `AdvancedSettingGroupId` union and `ADVANCED_SETTING_GROUPS`. Defaults
  and `settings:set` validation follow from the table (research Q5). File storage keeps the value across restart.
- `ArtifactMessageHandler` upserts first (card and count update always), then reads `settings:get`.
  An RPC failure uses the default `true`. When the setting is on, it sets
  `ArtifactStore.autoOpenRequest = { record, seq }`.
- `DisplayDockState.requestArtifactAutoOpen(tabId, artifactId)` copies `requestAutoOpen` (`:371-392`): an open
  pinned dock does not move; a user close in the live turn adds to `newCount`; otherwise it opens on Displays
  with the artifact selected. No focus change, no tab switch. Several publishes: the latest wins; the others
  stay listed.
- Consumer in `ChatViewComponent` (dock present). Main view: any tab that
  `TabManagerService.findTabByIdAcrossWorkspaces(record.sessionId)` finds. Tile: only its own `resolvedTabId`.
  A background tab keeps the selection until the user opens it. Unknown tab id: no open; the card still works.
- Detached: the dock state is the same, so the detached window shows it when that tab is the main window's
  active tab. The detached window is not focused.

## C. Cards in the reply flow

- New `TranscriptTurnArtifacts` (`organisms/transcript/transcript-turn-artifacts.ts`), constructed in
  `ChatTranscriptComponent` like `TranscriptTurnSummaries`. It runs `groupTurns`; for each FINALIZED turn it
  walks `roots` depth-first. It collects complete, non-error `ptah_artifact_publish` nodes in execution order
  with the shared parser `published-artifact.ts` (moved out of `tool-call-item.component.ts:162-177`). Output:
  `Map<endMessageId, PublishedArtifact[]>`. It calls `adoptPublishResult` once per new id.
- Template: after the turn-end slot, before the summary chip, `@for` one `<ptah-artifact-card>` per entry inside
  `@defer (when …)`. It renders on every host, outside the `display.enabled` branch. With no dock it is a
  read-only title card (C.4). Open and Full screen call `dock.openArtifact(tabId)` and
  `requestFullscreenArtifact(tabId)` with the transcript's `tabId` input.
- Reload: the cards come from tool results in the replayed transcript (`transcript-turns.ts:36-39`) plus adoption.
- Duplicate decision: the tool row keeps a compact read-only line ("Artifact · <title>"). It loses Open and Full
  screen and stops injecting `DisplayDockState`, `DisplaySheetState` and `TabManagerService`. One action point;
  bug A cannot recur from the tool row. Lane and subagent views keep their read-only line.

## D. Right sidebar and detached window

### D1 Sidebar (Electron; tiles; VS Code unchanged)
- `chat-view.component.html` moves `<ptah-display-sheet>` out of `ptah-chat-session-layout` into the `cs-shell`
  row on the right, like the agent panel block (`:231-268`): a `role="separator"` with `aria-valuenow/min/max`,
  bound to the existing `onResizeStart`, `onDockSeparatorKeydown` and `onResizeReset`. Then the sidebar column
  with `[style.width.px]="dockWidth()"`.
- States:
  - open: header (Display · N, Pin, Detach, Collapse) and panel.
  - collapsed (`dock.open=false`): a `ptah-sidebar-tab label="Display"` with the count; keyboard and
    `aria-expanded` are kept.
  - narrow host (`isOverlay()`, `:417-423`): an absolute right drawer; the region gets class `overlay`.
  - detached: stub (below).
- Remove the height modes and delete `display-sheet.state.ts`; the panel's own full screen stays. Escape still
  collapses.
- Width: `ElectronLayoutService.displaySidebarWidth` (`number|null`), set by
  `setDisplaySidebarWidth`, persisted in `persistLayout`/`restoreLayout`. ChatView seeds `PanelResizeService`
  from it and commits on drag end, key step and reset. Clamp: `clampDockWidth` (min 300 px, max 75% of host).
- Hosts:
  - main chat view: sidebar plus Detach.
  - canvas tiles: sidebar, overlay when narrow, no Detach. `canvas-rail-board.component.ts:62` changes to
    `ptah-display-sheet [role="region"].overlay`.
  - session embed with a host dock (command center): unchanged, keeps the rail Display tab and gets the A fix.
  - VS Code: no dock, so no change. Only the reply card is added (read-only).

### D2 Port and adapters
- `libs/backend/platform-core/src/interfaces/display-window-host.interface.ts`. `IDisplayWindowHost`:
  `supported: boolean`; `open(): Promise<DisplayWindowOpenResult>` (opens, or focuses an open one);
  `close(): Promise<boolean>`; `isOpen(): boolean`; `publishState(p): boolean`; `getState(): p | null`;
  `relayAction(tabId, action): boolean`. Token `PLATFORM_TOKENS.DISPLAY_WINDOW_HOST =
  Symbol.for('PlatformDisplayWindowHost')`.
- `platform-core/src/display-window/desktop-only-display-window-host.ts`: returns `{ ok:false,
  reason:'desktop-only' }`, `false` and `null`. It is bound in `platform-vscode/src/registration.ts` and
  `platform-cli/src/registration.ts`. Contract suite `testing/contracts/run-display-window-host-contract.ts`
  plus a self spec.
- Electron adapter `apps/ptah-electron/src/windows/display-window.ts` (`ElectronDisplayWindowHost`). Window
  code lives in the app; `platform-electron` cannot reach `main-window.ts`. Bound with `useValue` in
  `activation/bootstrap.ts` right after the `IpcBridge` is built (`:518-526`), the same as `WEBVIEW_MANAGER`.
- Contract types: new `libs/shared/src/lib/types/rpc/rpc-display-window.types.ts`, with registry entries in
  `rpc.types.ts` and `RPC_METHOD_ENTRIES`.
  - Methods: `displayWindow:open` `{}` -> open result; `displayWindow:close` `{}` -> `{closed}`;
    `displayWindow:status` `{}` -> `{supported, open}`; `displayWindow:publishState`
    `{tabId, revision, state: JSON object}` -> `{delivered}`; `displayWindow:getState` `{}` -> `{state|null}`;
    `displayWindow:action` `{tabId, action}` -> `{relayed}`.
  - Action union: `select{key}` | `fullscreen-closed` | `view-state{surfaceKey, viewState}` |
    `open-file{path}` | `review` | `attach`.
  - Pushes: `displayWindow:state` (to child), `displayWindow:action` and `displayWindow:closed` (to main).
- Handler `libs/backend/rpc-handlers/src/lib/handlers/display-window-rpc.handlers.ts`. Zod strict schemas.
  `publishState` is capped at 4 MiB of JSON. It resolves the port per call through the container
  (`artifact-rpc.handlers.ts:57-67` pattern), because Electron binds it after phase 4. Unregistered port:
  `{ok:false, reason:'not-ready'}`. Manifest entry `displayWindow`, `requires: []`. Prefix `'displayWindow:'`
  in `ALLOWED_METHOD_PREFIXES`.

### D3 Child window (Electron main)
- `createDisplayWindow`:
  - `webPreferences` identical to `main-window.ts:129-135`: same preload, `contextIsolation` true,
    `nodeIntegration` false, `sandbox` true, `webSecurity` true.
  - Default session, so the `ptah-artifact:` handler (`main.ts:139`) and the CSP meta in `index.html` apply
    unchanged.
  - `installNavigationGuard` and `isOnScreen` are exported from `main-window.ts`;
    `installPermissionPolicy(webContents, rendererUrl)`.
  - `loadFile(renderer/index.html, { query: { ptahWindow: 'display' } })`.
  - No `parent`: the user can place it on another display or behind the main window.
  - Min 360x400, default 520x760 next to the main window. Title "Ptah - Display".
- IPC: `TrustedIpcSender.webContentsId` becomes `webContentsIds: readonly number[]`. `IpcBridge` gets
  `setDisplayWindowSender(id | null)`. Child role: `rpc` only for `DISPLAY_WINDOW_ALLOWED_METHODS =
  ['displayWindow:getState','displayWindow:action','displayWindow:close','artifacts:openLink']`. Any other
  method gets an RPC error reply. Fire-and-forget, `set-state` and `diag:cpu-profile` are refused.
  `get-state` (read) is allowed. Preload: no change.
- Sync: the main renderer is authoritative (dock state, artifacts, summaries, surfaces, theme). The adapter
  caches the last snapshot and forwards it with `child.webContents.send('to-renderer', {type:
  'displayWindow:state'})`. The child pulls `getState` on boot, so no boot race. Child actions go
  `displayWindow:action` -> adapter -> `IpcBridge.sendToRenderer` -> main renderer, which applies them to its
  dock state only when `tabId` equals the bound tab. Stream events never reach the child.
- Lifecycle:
  - Bounds key `displayWindow.bounds`, in the same `IStateStorage` that holds `window.bounds`. Saved on
    `close`. Restored when the window is on a display, else default placement.
  - When the main window closes, the child closes (`once('closed')` added at open).
  - On app quit, Electron closes all windows, so `close` saves bounds. In-flight replies are already guarded
    (`ipc-bridge.ts:398`).
  - On child `closed`: untrust the id, drop the cache, push `displayWindow:closed`.
  - `window-all-closed` and `activate` need no change, because the child never outlives the main window.

### D4 Renderer (main and child)
- `DisplayWindowSync` (root, `libs/frontend/chat/src/lib/services/display-window/`):
  - Signals `detached` and `error`. `detach()` calls `open`; `attach()` calls `close`; `focus()` calls `open`.
  - `bindSource({tabId, dock})`, called only by the main ChatView. While detached, one effect builds the
    snapshot with `display-window-wire.ts`: Maps and Sets become arrays, and theme comes from
    `ThemeService.currentTheme`. It publishes at most once per animation frame, and only on change.
  - It is a `MessageHandler` for `displayWindow:closed` and `displayWindow:action`, registered in `app.config.ts`.
  - On Electron init it calls `status`, so a reload of the main renderer restores `detached`.
- Main window while detached: a narrow right rail with "Display · N (separate window)" plus Focus and
  Re-attach buttons. The chat takes the rest of the width.
- Child: `apps/ptah-extension-webview/src/main.ts` branches on `URLSearchParams(location.search).get('ptahWindow')
  === 'display'` and lazy-imports `app/display-window/display-window.config.ts`. That config provides only the
  RPC client, the message router, `DisplayWindowStateHandler` and `DisplayWindowComponent`: no
  `ElectronLayoutService`, no chat or streaming stores, no `setState`. The component renders
  `<ptah-display-panel>` in `@defer` from the parsed wire state; outputs become `displayWindow:action`;
  `openExternal` calls `artifacts:openLink`. A Re-attach button sends `action{attach}`. Theme: it sets the
  `data-theme` and `data-theme-mode` attributes (`theme.service.ts:260-264`) from the snapshot.

### D5 Guard specs to update
- `apps/ptah-electron/src/di/rpc-surface.spec.ts`
- `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`
- `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`
- `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts`
- `apps/ptah-electron/src/di/expected-resolvable.ts` and `apps/ptah-extension-vscode/src/di/expected-resolvable.ts`
  (add `DisplayWindowRpcHandlers`; checked by each `container.smoke.spec.ts`)
- `apps/ptah-electron/src/di/phase-4-handlers.ts` (`registerSingleton`, as `:93`)
- Check only, edit if they fail: `apps/ptah-electron/src/di/surface-composition.spec.ts`,
  `apps/ptah-extension-vscode/src/di/surface-composition.spec.ts`,
  `libs/backend/cli-engine/src/lib/surface-composition.spec.ts`,
  `libs/backend/rpc-handlers/src/lib/host-profile/manifest.spec.ts`

## E. Inline preview: DEFERRED

TASK_2026_710 fixed "one live viewer frame per active artifact" (`implementation-plan.md:101,165`; review
blocker fixed at `display-panel.component.ts:243-250`). Nobody has measured the memory per frame
(`implementation-plan.md:175`; research Q4). Whether Electron puts a sandboxed opaque-origin frame in its own
process is also not known. B (auto-open) and C (reply cards) already fix "buried under 20 tool calls" with no
second live frame. A detached window adds one more live viewer, so the measurement matters more now. A bounded
preview (at most 1-2 live, `@defer (on viewport)`, height-capped) can come later, behind an
`app.getAppMetrics()` measurement. No inline frame is added (criterion 5.3).

## Preserve list
- TASK_2026_710: `ARTIFACT_IFRAME_SANDBOX='allow-scripts'`, `ARTIFACT_CSP`, response headers
  (`artifact-protocol.ts:5-12`), id and URL checks, `will-frame-navigate` artifact-only guard, the renderer
  CSP meta, the nonce-checked theme/height/open-link bridge, and the http(s) allowlist (`artifact-rpc.handlers.ts:18-26`).
- One live viewer per open panel. The detached window counts as that panel for the visible tab.
- Declarative `ptah-ui` fences and the display sync ports (`PtahUiDisplayDock`/`Sync`); surface semantics owned
  by TASK_2026_539. Display panel strip keys (`summary`, `artifact:<id>`, surface keys) and summary actions.
- `display-panel` stays lazy (`display-sheet.component.ts:5-9`); the detached app is a lazy chunk.
- VS Code: no dock, no sheet, agent monitor panel unchanged. CLI/TUI: compile and tests only.

## Batches (file-disjoint, at most 8 files each)

| # | Executor | Files | Depends | Verify |
| --- | --- | --- | --- | --- |
| 1 | frontend-developer | `libs/frontend/chat-ui/src/lib/organisms/display-panel/display-panel.component.ts`, `.spec.ts` (missing text + `retryArtifacts`) | - | `npm run verify -- -p @ptah-extension/chat-ui` |
| 2 | frontend-developer | `libs/frontend/chat/src/lib/services/artifact.store.ts` + spec, `artifact-message-handler.service.ts` + spec, `services/artifacts/published-artifact.ts` + spec (new), `libs/frontend/command-center/src/lib/components/command-rail-display.component.ts` + spec | 1 | `npm run verify -- -p @ptah-extension/chat,@ptah-extension/command-center` |
| 3 | backend-developer | `libs/shared/src/lib/types/advanced-settings.types.ts` + spec, `rpc/rpc-display-window.types.ts` (new), `rpc.types.ts` | - | `npm run verify -- -p @ptah-extension/shared` |
| 4 | backend-developer | platform-core: `interfaces/display-window-host.interface.ts`, `display-window/desktop-only-display-window-host.ts`, `di/tokens.ts`, `index.ts`, `testing/contracts/run-display-window-host-contract.ts` + `.self.spec.ts`, `testing/contracts/index.ts` | 3 | `npm run verify -- -p @ptah-extension/platform-core` |
| 5 | backend-developer | `rpc-handlers/.../handlers/display-window-rpc.handlers.ts` + spec, `host-profile/manifest.ts`, `rpc-handlers/src/index.ts`, `rpc-allowlist.spec.ts`, `vscode-core/src/messaging/rpc-handler.ts` | 3,4 | `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/vscode-core` |
| 6 | backend-developer | `platform-vscode/src/registration.ts`, `platform-cli/src/registration.ts`, the 3 `rpc-surface.spec.ts`, 2 `expected-resolvable.ts`, electron `phase-4-handlers.ts` | 5 | `npm run verify -- -p @ptah-extension/platform-vscode,@ptah-extension/platform-cli,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode` |
| 7 | backend-developer | `apps/ptah-electron/src/windows/display-window.ts` + spec (new), `windows/main-window.ts`, `ipc/ipc-sender-policy.ts` + spec, `ipc/ipc-bridge.ts`, `ipc/ipc-bridge.display-window.spec.ts` (new), `activation/bootstrap.ts` | 4,6 | `npm run verify -- -p ptah-electron` |
| 8 | frontend-developer | `tool-call-item.component.ts` + spec, `transcript/transcript-turn-artifacts.ts` + spec (new), `chat-transcript.component.ts`, `.html`, `services/display-dock/display-dock.state.ts` + spec | 2 | `npm run verify -- -p @ptah-extension/chat` |
| 9 | frontend-developer | `services/display-window/display-window-sync.service.ts` + spec, `display-window-wire.ts` + spec, `components/templates/display-window/display-window.component.ts` + spec, `libs/frontend/chat/src/index.ts`, `apps/ptah-extension-webview/src/app/app.config.ts` | 2,3 | `npm run verify -- -p @ptah-extension/chat,ptah-extension-webview` |
| 10 | frontend-developer | `apps/ptah-extension-webview/src/main.ts`, `src/app/display-window/display-window.config.ts` + spec (new), `libs/frontend/core/src/lib/services/electron-layout.service.ts` + spec | 9 | `npm run verify -- -p @ptah-extension/core,ptah-extension-webview` |
| 11 | frontend-developer | `display-sheet/display-sheet.component.ts` + spec, delete `display-sheet.state.ts`, `chat-view.component.ts`, `.html`, `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts` (+ its spec if it pins the selector) | 1,2,8,9,10 | `npm run verify -- -p @ptah-extension/chat,@ptah-extension/canvas,@ptah-extension/command-center` |

Parallel-safe: {1,3}, then {2,4}, then {5,8}, then {6,9}, then {7,10}, then 11. Final gate: `npm run verify`
(affected, includes `ptah-tui`), then an Electron visual review and a security review of batches 7 and 10.
Batch 11 may need `chat-view.component.spec.ts` updates for the moved sheet. If that goes over 8 files, the
team-leader splits out the spec work.

## Risks and decisions

| Risk / question | Decision |
| --- | --- |
| Actual user path (sub-cause 2) unproven | Fix by id resolution, which covers both causes. No production diagnostic log. Reversible. |
| Records keyed by unstable tab id (restart loss) | Adopt from transcript now. Keying by SDK session id is a separate task. |
| `artifacts:list` returns empty for non-live sessions | Not changed (backend scope); covered by adoption. |
| Auto-open target unknown tab | Skip the open; the card still works. |
| Tool-row Open removed | Compact read-only line; Open moves to the reply card. Reversible. |
| Detached window parent vs independent | Independent window; it closes with the main window. Reversible. |
| Detached shows which tab | The main view's active tab only; tiles and command center stay in place. |
| Child IPC surface | Trusted-id set plus a 4-method allowlist; no `set-state`; preload unchanged. |
| Snapshot size and rate | 4 MiB cap in the handler; at most 1 publish per frame, only while detached. |
| Theme in child | Attributes from the snapshot. Assumption: `ArtifactThemeBridgeService` reads computed CSS variables; the batch 9 spec confirms. |
| Bounds storage | Same storage as `window.bounds`. Assumption: batch 7 confirms the resolver used by `post-window.ts:87`. |
| Sheet file and selector names kept (`ptah-display-sheet`) | Less churn; reversible rename later. |
| Narrow tiles | Overlay drawer (layout change reported for canvas tiles). |
| New settings group shows in VS Code too | Accepted; the descriptor table has no host filter. |
| Clipboard IPC has no sender check (pre-existing) | Out of scope; noted for the security review. |
