# Parity Inventory - TASK_2026_705_9d53

Source: worktree `D:\projects\ptah-extension\.claude-worktrees\remove-single-layout`, branch
`refactor/remove-single-layout` at main `15fe6031a`, read BEFORE any change. Every line reference
below is to that tree.

## Gate check: can the VS Code webview host the canvas? YES (no STOP)

- VS Code and Electron load the same Angular app, `apps/ptah-extension-webview`
  (`apps/ptah-electron/project.json:7,279` depend on `ptah-extension-webview:build`;
  `apps/ptah-extension-webview/src/app/app.ts:20-33` picks `AppShellComponent` for VS Code and
  `ElectronShellComponent` for Electron).
- The app binds the canvas for every host: `apps/ptah-extension-webview/src/app/app.config.ts:105,297`
  (`{ provide: ORCHESTRA_CANVAS_COMPONENT, useValue: OrchestraCanvasComponent }`, no host check).
- `AppShellComponent` renders it in the VS Code shell: `app-shell.component.html:383-411`
  (`ptahSurfaceActive="canvas"`, `*ngComponentOutlet="orchestraCanvasComponent"`).
- `'grid'` is already the VS Code default: `app-state.service.ts:403` (`signal<LayoutMode>('grid')`).
  `'single'` reaches `ptah-layout-mode` (`app-state.service.ts:1206-1211`, read back at 776-781)
  from two writers: the VS Code Canvas toggle (`app-shell.component.ts:362-364`) and the
  notification tile-cap fallback (`notification-focus-coordinator.service.ts:53`), which runs in
  BOTH hosts. In Electron the stored value is overwritten by the boot pin
  (`electron-shell.component.ts:425`); in VS Code it survives a reload.
- The canvas lib has no host gating of the Rail: the only `VSCodeService` use in
  `libs/frontend/canvas/src` (non-spec) is `canvas-layout-persistence.service.ts:150` (storage).
  The Rail (`canvas-rail.component.ts`), its board (`canvas-rail-board.component.ts`) and the
  focus header render the same in both hosts.

Conclusion: the user's decision stands; VS Code already runs the canvas grid with the session
Rail by default.

## Legend

- `keep` — unchanged behaviour, possibly an edited line.
- `remove-approved` — approved by the user in `decisions.md`: row 2 (tab bar and `'single'` layout),
  row 4 (tile-cap notification returns `cap-reached`), row 5 (agent-origin badge dropped), row 6
  (chat-view inspector host and session header, `TabItemComponent`,
  `AwaitingBackgroundIndicatorComponent`), row 7 (workflow-claim filter goes with the tab bar).
- `remove-proposed` — not approved; NOT part of this PR.

## A. `ptah-tab-bar` (libs/frontend/chat/src/lib/components/organisms/tab-bar.component.ts)

| Capability | Where today (file:line) | Backing RPC/API | Decision | New location | Test |
| --- | --- | --- | --- | --- | --- |
| Mount point: the tab bar renders only in single layout | `app-shell.component.html:222-226`; import `app-shell.component.ts:31,118` | none | remove-approved | none | `tab-bar.component.spec.ts:113` (deleted with the component) |
| Session switching (click a tab) | `tab-bar.component.ts:95-102,320-322` -> `TabManagerService.switchTab` | frontend `TabManagerService.switchTab` (chat-state); no RPC | remove-approved | Rail card select -> `CanvasStore.focusTile` -> `tabManager.switchTab` (`canvas.store.ts:425-430`) | `canvas-rail.component.spec.ts:178` (keyboard focus across cards); `orchestra-canvas.rail.spec.ts:150` |
| Close a session (tab x) | `tab-bar.component.ts:324-326` -> `TabManagerService.closeTab` | frontend `closeTab`; backend session end via `ClosedTabSessionEnderService` (still injected `app-shell.component.ts:168-170`) | remove-approved | Focus header "Close session" (`canvas-focus-header.component.ts:273-274`) -> `CanvasStore.removeTile` (`canvas-rail-board.component.ts:907`) | `canvas-focus-header.component.spec.ts:185,200` |
| Toggle a tab's view mode (full/compact) | `tab-bar.component.ts:328-330` -> `toggleTabViewMode` | frontend | remove-approved | Focus header `[viewMode]` (`canvas-focus-area.component.ts:40`) and `canvas-focus-area.component.ts` -> `toggleTabViewMode` | `canvas-focus-header.component.spec.ts` (compact control, line 77) |
| Rename a session | NOT in tab bar or `TabItemComponent` (no rename/dblclick handler) | n/a | n/a (nothing to remove) | Rail card menu "Rename" (`canvas-rail-card.component.ts:243-249,297`) | `canvas-rail-card.component.spec.ts:480,504` |
| Drag-reorder tabs | NOT present (no drag handlers in tab bar or tab item) | n/a | n/a | Rail card "Move up/down" (`canvas-rail-card.component.ts:272-284`) | `canvas-rail.component.spec.ts:178` |
| Overflow scroll arrows, wheel-to-horizontal scroll, active-tab scroll-into-view, ResizeObserver | `tab-bar.component.ts:78-90,152-160,254-282,306-317,395-482` | none | remove-approved | Rail is a vertical list with its own scrolling | `tab-bar.component.spec.ts:521` (deleted) |
| Streaming / liveness dot on a tab | `tab-bar.component.ts:98-99,296-300` (`isTabStreaming`, `SessionLivenessRegistry`) | frontend | remove-approved | Rail card `state` (`CompactRailState` running/needs/error/done/idle, `compact-lane.types.ts:66`); focus header `[running]` (`canvas-focus-area.component.ts:39`) | `canvas-rail-card.component.spec.ts` |
| Workflow badge on workflow tabs | `tab-bar.component.ts:104-110` (`WorkflowBadgeComponent`) | frontend | remove-approved | `canvas-focus-header.component.ts:129,285-286`; `canvas-rail-card.component.ts` (imports `WorkflowBadgeComponent`) | `tab-bar.component.spec.ts:177` (deleted); focus-header spec |
| Hide workflow-claimed tabs (VS Code single layout only) | `tab-bar.component.ts:206-208` (`WorkflowSessionClaimService.surfaceFor`) | frontend | remove-approved (decisions 2, 7) | none. The canvas tiles claimed tabs TODAY and keeps doing so: startup hydrates every `tabManager.tabs()` id (`orchestra-canvas.component.ts:343-347`) and `canvas.store.ts:444-448` appends authoritative ids; that is the behaviour Electron and VS Code grid ship on main, unchanged here. No claim filter is added to the canvas (decision 7) | `tab-bar.component.spec.ts:307,322` (deleted); workflow launch path `workflow-tab-launcher.service.spec.ts` (canvas tile request) |
| Agent-origin badge: "Started by <parent>", click jumps to the parent tab | `tab-bar.component.ts:111-147,332-343,384-389` | frontend | remove-approved | NOT covered by the Rail. The focus header shows only `agentOrigin.branch` (`canvas-focus-area.component.ts:38`). Lost with the tab bar | `tab-bar.component.spec.ts:340-505` (deleted) |
| Agent badge tooltip with worktree path (`tailPath`) | `tab-bar.component.ts:35-56,176-195,345-382` (`FloatingUIService`) | frontend | remove-approved | NOT covered (branch only, see above) | `tab-bar.component.spec.ts:448,475,491,507` (deleted) |
| Awaiting-background / sleeping indicator for the active tab | `tab-bar.component.ts:164-175,211-220` (`AwaitingBackgroundIndicatorComponent`) | frontend | remove-approved | Live-phase chip `session-live-phase-indicator.component.ts` (reads `pendingBackgroundTasks`) in session rows; Rail state `running` | `tab-bar.component.spec.ts:201-305` (deleted) |
| `TabItemComponent` (chat-ui) — only consumer is the tab bar | `libs/frontend/chat-ui/src/lib/molecules/session/tab-item.component.ts`; exported `chat-ui/src/index.ts:107`, re-exported deprecated `chat/src/lib/components/index.ts:104-108` | public lib export | remove-approved (decision 6) | delete the file and both exports (no other consumer: grep `TabItemComponent`/`ptah-tab-item` outside tab bar = 0) | none exists |
| `AwaitingBackgroundIndicatorComponent` (chat-ui) — only consumer is the tab bar | `chat-ui/src/lib/atoms/awaiting-background-indicator/*`; exported `chat-ui/src/index.ts:14` | public lib export | remove-approved (decision 6) | delete component, its spec and export | `awaiting-background-indicator.component.spec.ts` (deleted with it) |
| `TabManagerService` APIs used only by the tab bar | `switchTab`, `closeTab`, `toggleTabViewMode`, `isTabStreaming`, `tabs`, `activeTabId` | frontend | keep | every one has another consumer: `toggleTabViewMode` (canvas-focus-area, chat-view, conductor-tile), `isTabStreaming` (chat-input, agent-session-adoption, message-dispatch, setup-wizard) | n/a |
| Webview e2e harness fake "tab-bar" surface | `libs/frontend/webview-e2e-harness/src/lib/scenarios/chat/awaiting-background.e2e.spec.ts:7-32` (its own inline HTML, does not mount `ptah-tab-bar`) | none | keep (comments only; out of scope) | n/a | itself |

## B. The `'single'` layout mode

| Capability | Where today (file:line) | Backing RPC/API | Decision | New location | Test |
| --- | --- | --- | --- | --- | --- |
| `LayoutMode = 'single' \| 'grid'` type and `layoutMode` signal | `app-state.service.ts:105-106,403,674-675` | none | remove-approved | deleted; grid is the only layout | `app-state.service.spec.ts:156-162` |
| Persisted layout, localStorage `ptah-layout-mode` (read) | `app-state.service.ts:776-781` | localStorage (no RPC) | remove-approved | no read; a stored `'single'` is ignored, which lands on the canvas | `app-state.service.spec.ts:206-242`; e2e `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:56-64` |
| `setLayoutMode` (writes `ptah-layout-mode`) | `app-state.service.ts:1206-1211`; callers `electron-shell.component.ts:425,502`, `notification-focus-coordinator.service.ts:43,53` | localStorage | remove-approved | deleted with every caller | `app-state.service.spec.ts:661-666` |
| `toggleLayoutMode` and the VS Code "Canvas" navbar toggle | `app-state.service.ts:1213-1217`; `app-shell.component.ts:358-364`; `app-shell.component.html:209-220` | none | remove-approved | none | `app-state.service.spec.ts:668-675` |
| Single-chat content area: the main `<ptah-chat-view />` (no `SESSION_CONTEXT`) | `app-shell.component.html:412-419` (`ptahSurfaceActive="chat"`, hidden unless single). Also mounted, hidden, in Electron (`electron-shell.component.ts:337` embeds `ptah-app-shell`) | none | remove-approved | none | `chat-view.component.spec.ts` (harness without context) |
| Header label "Orchestra Canvas" vs tab bar | `app-shell.component.html:222-232` | none | keep (label only; becomes unconditional) | same file | new app-shell spec (plan) |
| Header hidden in Electron grid | `app-shell.component.html:114` (`isElectron && layoutMode() === 'grid'`) | none | keep | condition becomes `isElectron` | `electron-shell.*.spec.ts` |
| New-session popover: single branch creates a tab (`tabManager.createTab`) | `app-shell.component.ts:420-431` | frontend | remove-approved (single branch) / keep (grid branch `requestNewCanvasSession`) | same method, grid path only | none for the shell; canvas new-session `canvas-rail.component.spec.ts:59,150` |
| VS Code navbar "Previous sessions" button (single only) | `app-shell.component.html:328-352`; `app-shell.component.ts:300-307` (`openPreviousSessions`, `HistoryIcon`) | none | remove-approved | Rail footer "Previous sessions" (`canvas-rail.component.ts:253-260`) -> `PreviousSessionsDialogService` | `canvas-rail.component.spec.ts:70`; `app-shell.previous-sessions.spec.ts:257-660` (navbar-trigger cases rewritten) |
| `SurfaceActiveDirective` 'single' branch | `core/src/lib/routing/surface-active.directive.ts:17-28` | none | remove-approved (the `'chat'` surface value and the layout read); keep the directive as the `SURFACE_ACTIVE` provider for the canvas tree (non-optional inject, `execution-node.component.ts:566`) | same file; active = chat route addressed | `core/src/lib/routing/surface-active.spec.ts:41-60` |
| `*ptahRetainWhile` retention | `app-shell.component.html` row (`*ptahRetainWhile="!isStandaloneView()"`) | none | keep — keyed on standalone routes, not on layout | unchanged | `app-shell.retained-chrome.spec.ts` |
| Canvas eager token rationale | `core/src/lib/tokens/lazy-view-components.token.ts:24-39` (comment mentions `setLayoutMode('grid')` and both layouts mounted) | none | keep (comment edit) | same | n/a |
| `normalizeView('orchestra-canvas')` forces grid | `app-state.service.ts:642-653,810-812` | host `initialView` from `ptah.openOrchestraCanvas` (`apps/ptah-extension-vscode/src/core/ptah-extension.ts:171`, `webview-html-generator.ts:115`) | keep (map to `'chat'`; drop the grid write) | same | `apps/ptah-extension-webview/src/app/webview-routing.spec.ts:339-348` (rewritten) |
| Electron pins grid on boot and on its Canvas tab | `electron-shell.component.ts:421-425,500-503` | none | remove-approved (the calls); keep `onCanvasTab` navigation to chat | same | `electron-shell.apps-tab.spec.ts:186` |
| Session open bridge (Tasks "Open session"): single -> `switchSession` | `chat/src/lib/services/chat-store/session-open-bridge.service.ts:42-56` | frontend; `SessionLoaderService.switchSession` | remove-approved (single branch) | canvas path `requestCanvasSession` only | `session-open-bridge.service.spec.ts:66,81,121` |
| Task prompt bridge: single skips tile adoption, prefill scoped `null` | `task-prompt-bridge.service.ts:79-91` | frontend | remove-approved (single branch) | always `requestCanvasTab` + prefill by `tabId` | `task-prompt-bridge.service.spec.ts:100,117,135-160` |
| Workflow tab launcher: same split | `workflow-tab-launcher.service.ts:45-58` | frontend | remove-approved (single branch) | always canvas | `workflow-tab-launcher.service.spec.ts:8-60` |
| Session row "Open" (previous-sessions modal): single -> `switchSession` | `session-row-actions.service.ts:44-74` | frontend; `ChatStore.switchSession` | remove-approved (single branch) | canvas path only | `session-row-actions.service.spec.ts:134,143,194` (single cases); `previous-sessions-modal.component.spec.ts:180-220` |
| Agent child adoption: no tile in single | `agent-session-adoption.service.ts:354` | frontend | remove-approved (guard) | always request a tile | `agent-session-adoption.service.spec.ts:257,521` |
| Harness builder: tile request only in grid | `harness-builder-view.component.ts:436-442` | frontend | remove-approved (guard) | always request | `harness-builder-view.component.spec.ts:235,326` |
| Chat view fork ("Branch"): single opens a tab + `switchSession` | `chat-view.component.ts:1698-1713` | `forkSession` RPC (unchanged) | remove-approved (single branch) | canvas path `requestCanvasSession` | `chat-view.component.spec.ts` fork cases (1554 region) |
| Chat view `mainPanelShowing` reads layout | `chat-view.component.ts:861-865` | none | keep (drop the layout read; no-context instance treated as showing) | same | `chat-view.component.spec.ts:1352,1376` |
| Chat view questions: main panel suppressed while tiles present | `chat-view.component.ts:1322-1326` | none | keep (drop guard; only tiles exist) | same | `chat-view.component.spec.ts:1554` |
| Notification click at canvas tile cap (20, `canvas-layout-intent.ts:11`) falls back to the full single view | `notification-focus-coordinator.service.ts:49-72`; reachable in BOTH hosts (Electron too, since `setLayoutMode('single')` unhides the main chat view) | `NotificationFocusRouter` (`core/src/lib/tokens/notification-focus-router.token.ts:7`) | remove-approved (decision 4) | return the canvas `cap-reached` result; the panel stays open (`notification-center.component.ts:275,282`) | `notification-focus-coordinator.service.spec.ts:103` |
| VS Code editor-panel pop-out (`ptah.openFullPanel`) | `app-shell.component.html` pop-out button (`@if (!isElectron)`); `app-shell.component.ts:375-409` | `command:execute` RPC -> `ptah.openFullPanel` (`ptah-extension.ts:140`) | keep — layout-independent; in grid `tabManager.activeTab()` is the focused tile (`canvas.store.ts:425-430`) | unchanged | none found (gap, not introduced here) |
| Keyboard shortcuts Ctrl/Cmd+T, W, Tab | `chat/src/lib/services/keyboard-shortcuts.service.ts:38-94` | frontend | keep (unchanged). Note: in grid, Ctrl+T creates a tab the mounted canvas does not tile (no `requestCanvasTab`; canvas adopts only on mount, `orchestra-canvas.component.ts:343`). Pre-existing grid behaviour, now the only behaviour in VS Code | unchanged | none found |
| e2e helper `showCanvas` | `apps/ptah-electron-e2e/src/support/show-canvas.ts:30-37` (`ui.goto('canvas')`, no layout write) | none | keep | unchanged | `specs/git/hunk-revert-top-layer.spec.ts` |
| e2e "persisted single-view preference" | `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:56-64` | localStorage | keep (rename: a stale value is ignored) | same | itself |
| Showcase scene clicks the Canvas toggle when the grid is hidden | `apps/ptah-electron-e2e/src/showcase/lane-console-review.scene.ts:44-55` (`name: 'Toggle canvas grid / single chat'`) | none | remove-approved (the toggle goes, decision 2) | wait for `[data-testid="canvas-grid"]` only | not run (showcase capture) |
| Stale layout comments | `apps/ptah-extension-webview/src/app/app.config.ts:288-296`; `canvas-rail-board.component.ts:321-325` ("Single-chat mode keeps the canvas mounted but hidden"; `parentActive` behaviour kept); `chat/src/lib/tokens/session-context.token.ts:34` ("single chat view") | none | keep (comment edits only) | same files | n/a |
| Analytics or other views only rendered in single mode | none: every standalone view is a route (`app-shell.component.html:84-86`, `app.routes.ts`) | n/a | n/a | n/a | n/a |
| DI / RPC surface | none: layout is frontend-only state in localStorage; no RPC method, no backend token | n/a | n/a | n/a | `rpc-surface.spec.ts`, `expected-resolvable.ts` untouched |

## C. Code made unreachable by removing the single layout (coordinator note, 2026-10-19)

After B, every production `ChatViewComponent` has `SESSION_CONTEXT`: `session-embed.component.ts:86`
(canvas tiles, Rail) and `conductor-tile.component.ts:229` (Tribunal). The only instance without
it was `app-shell.component.html:417`. So these become dead code paths.

| Capability | Where today (file:line) | Backing RPC/API | Decision | New location | Test |
| --- | --- | --- | --- | --- | --- |
| Inspector host in chat view (`hostsInspector`) | `chat-view.component.ts:1101-1104`; template `chat-view.component.html:285-316` (modal sheet + side `ptah-session-inspector`) | frontend stores | remove-approved (decision 6) | Rail board hosts the inspector itself: `canvas-rail-board.component.ts:69,74,201-268` (`SessionInspectorComponent`, own `InspectorShellController`) | `chat-view.component.spec.ts` inspector cases (deleted) |
| Session header (`SessionHeaderComponent`, needs-you count, git stats chip, limit dot, inspector toggle) | `chat-view.component.html:32-69`; `chat-view.component.ts:56,220,1106-1140`; component `molecules/session-header/session-header.component.ts` (only consumer chat-view) | `SessionGitStatsStore` | remove-approved (decision 6) | Rail focus header (`canvas-focus-header.component.ts`: state, limit cue, context ring, details toggle) | chat-view specs |
| Inspector shell wiring in chat view | `chat-view.component.ts:1087,1375` (`wireInspectorShell`), provider `chat-view.component.ts:232` | frontend | remove-approved (decision 6) | `InspectorShellController` itself stays (Rail board provides it, `canvas-rail-board.component.ts:74`) | `inspector-shell.controller` specs |
| Inspector-host styling (`.cs-inspector`, `--sheet`, `--full`, `.cs-scrim`, `@keyframes csInspectorIn`, reduced-motion entry) | `chat-view.component.css:17-50,192-197` | none | remove-approved (decision 6) | Rail board styles its own `<aside>` (`canvas-rail-board.component.ts:201-268`) | chat-view specs |
| Inspector-shell host wrapper ref and view query; modal `inert` on main content | `chat-view.component.html:2` (`#inspectorShell`), `:6` (`[attr.inert]="shell.isModal()..."`); `chat-view.component.ts:1212-1213` (`viewChild('inspectorShell')`), shell calls in question focus `:1008,1044-1045` | none | remove-approved (decision 6); the `cs-shell flex h-full w-full relative` div stays as the layout box | same file | chat-view specs |
| Header add-on slots (`headerChipAddons`, `headerActionAddons` via `SESSION_WORKFLOW_ADDONS`) | `chat-view.component.ts:1115-1117,1172-1188`; `chat-view.component.html:50-66` | DI token, no provider anywhere in non-spec source | remove-approved (bindings, decision 6) | none | chat-view specs |
| `SESSION_WORKFLOW_ADDONS` token and `workflowAddonsFor` export | `chat/src/lib/tokens/session-workflow-addons.token.ts:35-60`; `chat/src/index.ts:51-53` | public lib export | remove-proposed (unconsumed after this PR); NOT in this PR | unchanged | token spec if any |
| No-context fallbacks in `resolved*` computeds (global active tab, all agents, all resumable subagents) | `chat-view.component.ts:543-550,762-940` | frontend | remove-proposed (would make `SESSION_CONTEXT` required); NOT in this PR | unchanged |  chat-view specs mount without context |
| Agent sidebar tab in chat view | `chat-view.component.html:318-340` | frontend | keep — gated on `!dockEnabled && !hideAgentSidebar`, still reachable from tiles without a dock | unchanged | `chat-view.dock.spec.ts` |
| `SessionInspectorComponent` and the inspector section components | `chat/inspector` entry, used by `canvas-rail-board.component.ts:18,69` | frontend | keep | unchanged | inspector specs |

Count: 59 rows (A 17, B 32, C 10).
