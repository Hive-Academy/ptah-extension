# Research Report - TASK_2026_853_3401

## Question

- Decision this supports: how to fix "The artifact could not be displayed. It is not loaded in this tab." and how to
  build the artifact side panel / detached window (goals A-E).
- Question: what produces the id mismatch, how is the chat column laid out, what does a second Electron window cost, is an
  inline preview affordable, and where does an auto-open toggle live?
- Bounds: static reading only. No app run, no repro, no web research (the web search tool returned 401, so the Electron
  process-model claim in Q4 is UNVERIFIED). Paths are relative to the worktree root.

## Answer

The orchestrator hypothesis is CONFIRMED as a mechanism: the card finds its record in ANY bucket, but Open and the sheet
read ONE bucket keyed by an id taken from a different place. For the plain main-tab path the ids are identical, so the
mismatch needs one of: (1) the card is rendered for a tab that is not `activeTabId()` (canvas tile / command-center
`SESSION_CONTEXT`), or (2) a live SDK session registered under an older tab id is continued from another tab.
The robust fix does not depend on guessing which: resolve the selected artifact by id from any bucket in the sheet, and
open the card in its OWN host tab (`SESSION_CONTEXT`), not `activeTabId()`.

## Q1 Root cause

### What each side uses (verified by reading)

| Step | Id used | Source |
| --- | --- | --- |
| Frontend sends `chat:start` / `chat:continue` | `tabId = TabManager activeTabId` | `libs/frontend/chat/src/lib/services/message-sender.service.ts:471-475, 743-747` |
| Backend registers the SDK session | `sessionConfig.tabId` (the same id) | `chat-session.service.ts:1012-1014` (`startChatSession({tabId...})`) |
| MCP URL baked into the SDK query, ONCE at query start | `/session/{sessionConfig.tabId ?? sessionId}` | `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1214, 1344-1348, 2060` |
| HTTP handler decodes it | `request._callerSessionId` | `mcp-http/http-server.handler.ts:248-252, 410` |
| Dispatcher publish scope | `getSessionTabId(caller) ?? caller` = `registry.find(caller).tabId` | `protocol-dispatcher.ts:2365-2379`, `http-mcp-server.service.ts:422` |
| Store persists + notifies | `record.sessionId = scope.sessionId` | `electron-artifact-store.ts:139`, `artifact-tool-handlers.ts:55-61` |
| Frontend buckets | `records[record.sessionId]` | `artifact.store.ts:42-47` |
| Card finds record | any bucket (`recordById`) | `artifact.store.ts:34-40`, `tool-call-item.component.ts:178-181` |
| Open | `dock.openArtifact(tabs.activeTabId(), id)` | `tool-call-item.component.ts:183-191` |
| Sheet passes panel one bucket | `records()[this.tabId()]`, `tabId` = ChatView `resolvedTabId` | `display-sheet.component.ts:115-117`, `chat-view.component.html:219`, `chat-view.component.ts:769-772` |
| Panel error | selected `artifact:<id>` not in `artifacts` input | `display-panel.component.ts:164, 221, 370` |

### Per publish path

- (a) Main Claude tab, first turn: URL id = frontend tab id; `find(tabId).tabId` = same. `record.sessionId` == tab id.
  Consistent while the card is shown in the tab that started the session. This path alone does not reproduce the bug.
- (b) `ptah_session_start` child: the spawner mints `childTabId` and starts the child with `tabId: childTabId`
  (`session-spawner.service.ts:403`); the child MCP URL carries that id, so the bucket is `childTabId`. The card is in the
  CHILD's transcript. Viewed from the parent tab the publish tool row is not present. Consistent if the child tab is the
  active tab; otherwise the same cross-tab mismatch as (1) below.
- (c) CLI lane / external MCP client: URL is `/agent/{id}/workspace/{root}` or `/workspace/{root}`
  (`ptah-mcp-url.ts:56-67`). `_callerSessionId` is `undefined`, so `callerSessionId` is undefined
  (`protocol-dispatcher.ts:2366-2379`) and `handleArtifactPublish` returns the error "Artifact publishing requires a
  trusted workspace and session." (`artifact-tool-handlers.ts:43-45`). NO record exists, no card. Not the user's bug.
  (Consequence: a lane can never publish; say so in the tool description if that is not intended.)
- (d) Resumed / re-attached session: `chat:continue` on a session whose registry record is still live reuses it
  (`hasLiveSessionStream`, `chat-session.service.ts:1615-1623, 1656-1658`) and does NOT re-register under the new tab id.
  The baked MCP URL and the registry `tabId` keep the ORIGINAL tab id. If the user continues that session from a
  different tab (history reopen in a new tab, tab closed and reopened) the artifact lands in the OLD tab bucket while
  `activeTabId()` is the new one. The card still renders (global lookup) and Open fails exactly as reported.
  (INFERRED from the code path; not reproduced.)

### Two concrete mismatch sources found

1. Card tab vs active tab (verified by code). `ToolCallItemComponent` is rendered inside ChatView, whose sheet uses
   `resolvedTabId` = `SESSION_CONTEXT()` for canvas tiles / command-center surfaces, else `activeTabId()`
   (`chat-view.component.ts:769-772`). `openArtifact` ignores that context and opens the dock of `activeTabId()`
   (`tool-call-item.component.ts:184`). In a tile whose tab is not the active one, Open opens the wrong tab's sheet
   (which shows only "Turn summary" plus the error). `SESSION_CONTEXT` is at
   `libs/frontend/chat/src/lib/tokens/session-context.token` and `chat-input.component.ts:630` shows the optional-inject
   pattern.
2. Registry tab id vs current tab id on session re-attach (path d, inferred).

Also: persistence is keyed by the EPHEMERAL tab id. `artifacts:list` resolves `registry.find(sessionId).tabId` and
returns `[]` when the registry has no record (`artifact-rpc.handlers.ts:60-66`), so after an app restart a restored tab
loses its artifacts. Not the reported bug, but it is the same root design flaw (verified by reading).

### Most likely path for the user's case

"Agent in an Electron chat tab, ~20 tool calls, Open showed only Turn summary". The card rendered, so the record exists in
some bucket. Between sources 1 and 2, 1 needs a tile/command-center view and 2 needs a re-attached session; neither can
be excluded from the code alone. The fix below covers both. Smallest experiment to name the actual cause: log
`{activeTabId, resolvedTabId, record.sessionId}` in `openArtifact` (one `console.warn`) and reproduce.

### Minimal robust fix (recommendation, architect decides)

1. `DisplaySheetComponent`: build the panel `artifacts` input as the tab bucket PLUS the record for
   `state().selection.artifactId` resolved via `ArtifactStore.recordById` when missing from the bucket (keep the bucket
   order; append the selected one). The panel then never shows "not loaded" for an artifact the store holds.
   Same change in `command-rail-display.component.ts:164-167`.
2. `ToolCallItemComponent.openArtifact`: use `inject(SESSION_CONTEXT, {optional:true})?.() ?? tabs.activeTabId()`.
3. Backend (defence in depth, optional): in `chat:continue` when a live record is reused under a different `tabId`,
   no change needed if (1) is done; do not rewrite the baked MCP URL.
4. Longer term: key artifacts by the stable SDK session id with tab id as a view detail (separate task).

### Regression test that fails today

File: `libs/frontend/chat/src/lib/components/organisms/display-sheet/display-sheet.component.spec.ts` (real
`ArtifactStore` + `DisplayDockState`, mocked `ClaudeRpcService`/`TabManagerService` like `artifact.store.spec.ts:19-35`).

```
it('shows an artifact whose record is in another tab bucket (card Open -> panel)', async () => {
  // store holds the record under the registry tab, not under the tab being viewed
  store.upsert(record('report', 'registry-tab-b'));
  dock.openArtifact('tab-a', 'reportxxxxxxxxxx');          // what the card does with activeTabId = tab-a
  fixture.componentRef.setInput('tabId', 'tab-a'); detect();
  expect(el('[data-testid="display-panel-artifact-missing"]')).toBeNull();   // today: present
  expect(el('[data-testid="display-panel-artifact-viewer"]')).not.toBeNull(); // today: absent
});
```

Second test in `tool-call-item.component.spec.ts` (next to the case at line 40): provide `SESSION_CONTEXT = () => 'tile-tab'`
and `activeTabId = 'other-tab'`; click Open on the card; expect `dock.tab('tile-tab').selection` to be the artifact and
`dock.tab('other-tab').selection` to be unchanged. Today the assertion fails because `activeTabId()` is used.

## Q2 Layout

- Chat column owner: `libs/frontend/chat/src/lib/components/templates/chat-view.component.html` (shell
  `cs-shell flex h-full w-full relative`, line 2) wrapping `<ptah-chat-session-layout>` (line 15), a plain flex column
  `libs/frontend/chat/src/lib/components/templates/chat-session-layout.component.ts` with ordered slots transcript,
  controls, SHEET, composer.
- `<ptah-display-sheet sessionSheet [tabId]="displayTabId">` is mounted at `chat-view.component.html:217-221`, in the
  column BETWEEN transcript and composer, gated by `displaySheetEnabled` (`chat-view.component.ts:432-434`).
  Its styles: closed `flex: 0 0 auto`; open `flex: 0 1 40%`; `.sheet-full` `flex: 1 1 100%`
  (`display-sheet.component.ts:48-50`). `Expand` (full) therefore takes the whole column and covers the transcript:
  this is the "overlay" the user sees.
- Electron shell: `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts` already has a RIGHT-side
  resizable dock (git dock): `ptah-electron-resize-handle` (line ~453) + `div.electron-git-dock` with
  `[style.width.px]="layout.editorPanelWidth()"` gated by `layout.editorPanelVisible()`.
- Reusable pieces:
  - `libs/frontend/chat-ui/src/lib/atoms/electron-resize-handle.component.ts` (mouse drag; `direction 'right'` gives width
    = viewport - pointerX; outputs `dragStarted/dragMoved/dragEnded`).
  - `libs/frontend/core/src/lib/services/electron-layout.service.ts` (`editorPanelWidth`, `setEditorPanelWidth`,
    clamp + `persistLayout()`; same file holds the Apps page splitter commit pattern at ~254-272). Add a
    `displayPanelWidth/Visible` pair here to persist width and collapse state.
  - `libs/frontend/chat-ui/src/lib/atoms/split-handle.component.ts`,
    `libs/frontend/chat/src/lib/components/atoms/resize-handle.component.ts` (CDK drag; used by the agent panel with
    `PanelResizeService`), `libs/frontend/git-ui/src/lib/git-dock/rail-resize-handle.component.ts`.
- Note: `chat-view.component.ts:425-427` comment says "Electron: the right-side panel is the display dock", and
  `SESSION_DISPLAY_DOCK` lets a host supply its own dock (then no sheet). That host-supplied path is the existing seam
  for a side panel: provide the dock from the shell and the in-column sheet disappears.
- Per-tab dock state already exists: `DisplayDockState` (`display-dock.state.ts`, has `widthPx`, `open`, `selection`).

## Q3 Electron child window

Verified facts:

| Topic | Fact | Source |
| --- | --- | --- |
| Window creation | one `new BrowserWindow` in `createMainWindow`: `contextIsolation true, nodeIntegration false, sandbox true, webSecurity true`, `preload.js` | `apps/ptah-electron/src/windows/main-window.ts:121-138` (only other `BrowserWindow` is the browser-capability window, `services/electron-browser-capabilities.ts:509`) |
| Guards per window | `installNavigationGuard` (will-navigate allows only same-document, `will-frame-navigate` allows only `ptah-artifact://` child frames, `setWindowOpenHandler` deny) and `installPermissionPolicy(webContents, rendererFileUrl)` | `main-window.ts:72-90, 140-145` |
| Renderer load | `mainWindow.loadFile(<__dirname>/renderer/index.html)` after a preparing shell | `activation/post-window.ts:90-99` |
| CSP | injected `<meta>` by `apps/ptah-electron/scripts/copy-renderer.js` (script-src 'self', `frame-src ptah-artifact:`, etc.), so any window loading the same `index.html` gets it | `copy-renderer.js:~160-182` |
| Artifact protocol | `registerArtifactScheme()` (standard+secure) pre-ready; handler on `session.defaultSession.protocol` with its own response CSP and sandbox attr `allow-scripts` | `main.ts:58,139`; `artifacts/artifact-protocol.ts:8-33, 77-83` |
| IPC sender check | `isTrustedIpcSender` compares `event.sender.id` to ONE `webContentsId` (`getWindow()?.webContents.id`), requires main frame + a `file:` path in `trustedDocumentPaths`; query/hash ignored | `ipc/ipc-sender-policy.ts:80-100`; `ipc/ipc-bridge.ts:311-350` |
| Push channel | `IpcBridge.sendToRenderer` -> the ONE window `webContents.send('to-renderer')`; `ElectronWebviewManagerAdapter` says "only one renderer", `sendMessage` == `broadcastMessage` | `ipc-bridge.ts:185-199`; `ipc/webview-manager-adapter.ts:29-30, 103-109` |
| RPC reply | `event.sender.send('to-renderer', ...)` so replies go to the asking webContents | `ipc-bridge.ts:398, 425` |
| Preload | single preload for any window: `window.vscode.postMessage/getState/setState`, `ptahConfig` (`panelId: 'electron-main'`), clipboard, diag; `get-startup-config` sync | `apps/ptah-electron/src/preload.ts` |
| Bounds persistence | `window.bounds` in workspace state storage, saved on `close`, restored only if >= 800x600 and on a display | `main-window.ts:110-119, 173-189` |
| Quit | `window-all-closed` quits except darwin; `will-quit` runs `handleWillQuit` | `main.ts:406-413, 416-460`; `activate` recreates main window only when no window exists (`main.ts:381-385`) |
| Second window | none (no popout, settings or quick-chat window) | grep `new BrowserWindow` |
| Shared state hazard | `set-state` writes the one `webview-state` blob | `ipc-bridge.ts:628-640` |

Minimal design (recommendation, INFERRED, untested):

1. New port `IDisplayWindowHost` in `libs/backend/platform-core/src/interfaces` (+ token in `di/tokens.ts`), methods
   `open()`, `close()`, `isOpen()`, `onClosed`. Electron adapter lives in `apps/ptah-electron/src/windows/`
   (window code is in the app, `platform-electron` cannot import it). VS Code and CLI adapters return
   `{ ok:false, reason:'desktop-only' }`. Update the DI/RPC guard specs.
2. `createDisplayWindow(parent)`: same `webPreferences` and same preload, `parent: mainWindow` (so it closes with it and
   stays above it), reuse `installNavigationGuard` and `installPermissionPolicy` (both take a window / webContents;
   export them from `main-window.ts`), `loadFile(renderer/index.html, { query: { mode: 'display' } })`. Same file path
   means the CSP meta and `ptah-artifact:` (defaultSession) apply unchanged; the child gets the iframe CSP/guards for free.
3. IPC bridge: replace the single `getWindow()` identity with a set of trusted webContents ids (main + display), keep
   the file-path and main-frame checks. Reject `set-state` from the display window (or ignore) so it cannot overwrite
   `webview-state`. `sendToRenderer` stays main-only; add a small `displayRelay` that forwards ONLY a display-state
   channel (selection, artifacts, summary) to the child webContents.
4. Sync: do NOT use `BroadcastChannel`/`postMessage` between windows: both documents are `file:` (opaque origin), and
   same-origin is required for BroadcastChannel (INFERRED from web platform rules; not tested here). Use the existing
   RPC/notification path via main: main renderer pushes display state with an RPC (`display:publishState`) -> main
   relays to the child with `webContents.send`; child asks `artifacts:list` itself via the normal RPC (reply goes to the
   asker). Child boots Angular in `mode=display` (read `location.search` before bootstrap or in `app.config`) and renders only
   `DisplayPanelComponent` + `ArtifactViewerComponent`; it must not start streaming/session stores.
5. Bounds: reuse `stateStorage.update('display-window.bounds', ...)` with `isOnScreen` from `main-window.ts` (extract it);
   save on `close` as the main window does. Quit: close the child on main `closed` and in `handleWillQuit`; mark it so
   `window-all-closed` and darwin `activate` logic do not treat it as the main window.
6. Detach/attach: detach sets dock `detached=true` (hides the side panel) and calls `open()`; child `closed` event pushes
   `detached=false` back to the main renderer.

## Q4 Inline preview (goal E)

- Decision text: plan says "Keep frame creation bounded to active viewer (avoid one live iframe per chat card)"
  (`.ptah/specs/TASK_2026_710_html/implementation-plan.md:101`) and "one live viewer frame per active artifact" (line 165);
  review made it blocking: `code-logic-review-frontend.md:113, 186`, fixed in r2 (`display-panel.component.ts:243-250`,
  creates the viewer only for the active key while open). `batch-7-report.md:21` states "fixed decision: only one live
  iframe".
- Memory evidence: NONE measured. The plan lists it as an open item: "Measure a representative large dashboard for frame
  memory and resize cost" (`implementation-plan.md:175`). So "never in the transcript" is a precaution, not data.
- Electron process model for a sandboxed opaque-origin iframe (in-process vs OOPIF by default): UNKNOWN here. Not in the
  spec folder, and the web search failed. Smallest experiment: open DevTools Task Manager (or `app.getAppMetrics()`) with
  one artifact open and read the process list.
- Recommendation: DEFER the live inline iframe. Deliver B (auto-open into the side panel) and C (card in the reply
  flow) first; they remove the "buried under 20 tool calls" problem without a second live frame. If wanted later,
  gate it behind the measurement, then a design of at most 1 live preview (latest artifact only), height-capped, created
  on `@defer (on viewport)` and destroyed on scroll-away, others stay static cards.

## Q5 Settings

- Pattern: file-based settings in `~/.ptah/settings.json`, each described once in the shared table
  `libs/shared/src/lib/types/advanced-settings.types.ts` (`ADVANCED_SETTINGS`, entries at ~393-432; boolean example
  `notifications.hostEnabled`, `kind: 'boolean'`, `default`, `apply: 'live'`). Defaults flow to
  `libs/backend/platform-core/src/file-settings-keys.ts` automatically (`ADVANCED_SETTINGS_DEFAULTS`, line 86-88, spread at
  463), `settings:set` validates against the descriptor, and the Settings UI renders it via
  `libs/frontend/chat/src/lib/settings/advanced/advanced-settings-group.component.ts` (`settings:get/set`).
- Add: one descriptor `{ key: 'display.autoOpenArtifacts', group: <new 'display' group or existing 'notifications'>,
  kind: 'boolean', label: 'Open artifacts when published', help: ..., default: true, apply: 'live' }` to
  `advanced-settings.types.ts` (and a group entry in `ADVANCED_SETTING_GROUPS`, line 83, if a new group; the
  `AdvancedSettingGroupId` union at line 22 needs the id). Update `advanced-settings.types.spec.ts`.
- Frontend reader: `rpc.call('settings:get', { key })` (as `thoth-status.service.ts:325`), cached in a small signal in
  `ArtifactMessageHandler` (`libs/frontend/chat/src/lib/services/artifact-message-handler.service.ts`) which then calls
  `dock.openArtifact(record.sessionId, record.id)` after `store.upsert`. Re-read the key on each publish (cheap, `live`).
  Caution: open the dock of the tab that owns the session, not `activeTabId()`, and respect `userClosedTurnKey`
  (`display-dock.state.ts`) so a user close is not overridden by a pinned view.

## Evidence

| Claim | Source | Date | Verified how |
| --- | --- | --- | --- |
| MCP session URL carries `sessionConfig.tabId` | `sdk-query-options-builder.ts:1214,2060` | undated | read |
| Publish scope = `registry.find(caller).tabId` | `protocol-dispatcher.ts:2365-2379` | undated | read |
| CLI lane URL has no session id, publish errors | `ptah-mcp-url.ts:56-67`, `artifact-tool-handlers.ts:43-45` | undated | read |
| Card global lookup vs panel single bucket | `artifact.store.ts:34`, `display-sheet.component.ts:115` | undated | read |
| Open ignores SESSION_CONTEXT | `tool-call-item.component.ts:183-191`, `chat-view.component.ts:769-772` | undated | read |
| IPC trusts one webContents | `ipc-sender-policy.ts:80-100` | undated | read |
| No memory measurement exists | `TASK_2026_710_html/implementation-plan.md:175` | undated | read |

## Options

| Option | Fit here | Cost | Known failure mode |
| --- | --- | --- | --- |
| Resolve selected artifact by id in sheet + open in host tab | fixes both mismatch sources, frontend only | 3 files + 2 tests | does not fix restart loss (keyed by tab id) |
| Re-register / remap backend tab ids on re-attach | fixes source 2 at origin | invasive in registry, MCP URL is baked | cannot change URL of a live query |
| Key artifacts by SDK session id | correct long term | store, RPC, migration | out of scope here |
| Child window via main-process relay | matches single-webContents bridge | port + adapter + bridge generalisation | state drift if relay drops messages |
| Child window via BroadcastChannel | no main code | n/a | `file:` opaque origins (inferred) |

## Disagreements

- Orchestrator hypothesis says the id differs for "child session, external caller, SDK id". Code says external callers
  cannot publish at all, and child sessions are consistent in their own tab. The real mismatch candidates are the
  tile/active-tab split and session re-attach.

## Local consequences

- `tool-call-item.component.ts`, `display-sheet.component.ts`, `command-rail-display.component.ts`: tab resolution fix.
- `ipc-bridge.ts`, `ipc-sender-policy.ts`, `main-window.ts`, `main.ts`: child window needs a trusted-id set, exported
  guards, quit handling.
- `advanced-settings.types.ts`: toggle descriptor; `rpc.types.ts` + handler registrations plus DI/RPC guard specs for any
  new RPC.

## Unknowns

- Which of the two mismatch sources the user actually hit (needs the log experiment above).
- Per-iframe memory and process placement in Electron (needs Task Manager / `app.getAppMetrics()` measurement).
- Whether a second `file:` document with `?mode=display` passes `isSameDocumentNavigation` on reload (query is ignored
  per `navigation-policy.ts` docs; confirm with a spec).
