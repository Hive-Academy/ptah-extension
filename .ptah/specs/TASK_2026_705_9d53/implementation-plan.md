# Implementation Plan - TASK_2026_705_9d53 (revision 1)

Remove `ptah-tab-bar` and the `'single'` layout mode from every host, and delete the code that
the removal leaves unreachable. Both hosts always show the canvas grid with the session Rail.
Companion inventory: `parity-inventory.md`. Approved scope: `decisions.md` rows 2, 4, 5, 6, 7.

## Inputs and constraints

- Requirements used: `context.md`, `task.md`, `decisions.md` (rows 2, 4-7),
  `implementation-plan-review.md` (codex REVISE, 6 findings, all applied here).
- Corrections applied: review F1-F6. The tile-cap behaviour (decision 4), the badge drop
  (decision 5) and the dead-code deletions (decision 6) are required work in this PR. The workflow
  claim filter is not ported to the canvas (decision 7).
- Design handoff used: none (removal only).
- Missing decision-critical input: none for this PR. One open proposal that is NOT in scope:
  removing chat-view's no-context fallbacks and making `SESSION_CONTEXT` required
  (parity-inventory section C, "No-context fallbacks").
- Repository rules: worktree only; peer branches own `chat-transcript.*`, `message-bubble.*`,
  `chat-input.component.ts` (do not edit them). Scoped verification only (CLAUDE.md).

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| VS Code and Electron share one webview app | `apps/ptah-electron/project.json:7,279`; `apps/ptah-extension-webview/src/app/app.ts:20-33`, `app.html:54-57` | One change removes the layout in both hosts |
| Canvas bound for every host | `apps/ptah-extension-webview/src/app/app.config.ts:105,297` | VS Code can host the canvas |
| Grid is the default; `'single'` comes only from localStorage, written by the toggle or the notification cap fallback | `app-state.service.ts:403,776-781,1206-1211`; writers `app-shell.component.ts:362-364`, `notification-focus-coordinator.service.ts:53` | Removing the read and both writers maps any stored `'single'` to grid |
| Layout API | `app-state.service.ts:105-106,647-653,674-675,1206-1217` | The whole concept can be deleted |
| Only tab-bar mount | `app-shell.component.html:222-226`; `app-shell.component.ts:31,118` | One consumer |
| Single content area | `app-shell.component.html:412-419` | Removing it removes the only `ChatViewComponent` without `SESSION_CONTEXT` |
| Every other `ChatViewComponent` host provides `SESSION_CONTEXT` | `session-embed.component.ts:86`; `conductor-tile.component.ts:229` | `hostsInspector` (`chat-view.component.ts:1101-1104`) is false for every remaining instance, so the inspector host and session header are dead |
| Rail board hosts its own inspector | `canvas-rail-board.component.ts:18,69,74,201-268` | `SessionInspectorComponent`, its sections and `InspectorShellController` stay |
| `SessionHeaderComponent` has one consumer | `chat-view.component.ts:56,220`; template `chat-view.component.html:32-69` | Delete the component |
| Inspector-host styling | `chat-view.component.css:17-50` (`.cs-inspector`, `--sheet`, `--full`, `.cs-scrim`, `@keyframes csInspectorIn`), `:192-197` (reduced-motion list includes `.cs-inspector`) | Delete with the host |
| `TabItemComponent`, `AwaitingBackgroundIndicatorComponent` used only by the tab bar | `chat-ui/src/index.ts:14,107`; re-export `chat/src/lib/components/index.ts:104-108` | Delete both and their exports |
| `SURFACE_ACTIVE` must be provided for the canvas tree | `surface-active.directive.ts:6-28`; `execution-node.component.ts:566` | Keep the directive without its layout read |
| Canvas tiles every tab, claimed or not | `orchestra-canvas.component.ts:343-347`; `canvas.store.ts:444-448` | Decision 7: unchanged; no claim filter added |
| No DI or RPC involvement | layout lives only in localStorage; no token, handler or `rpc.types.ts` entry | The four host guards are unaffected (see handoff) |

## Architecture decision

- Chosen approach: delete the layout concept (`LayoutMode`, `layoutMode`, `setLayoutMode`,
  `toggleLayoutMode`, the `ptah-layout-mode` read); collapse every layout branch to its grid body;
  delete `TabBarComponent`, the single content area, chat-view's inspector host and session header,
  `SessionHeaderComponent`, `TabItemComponent`, `AwaitingBackgroundIndicatorComponent`; keep
  `SurfaceActiveDirective` as a parameterless `SURFACE_ACTIVE` provider.
- Rationale: decisions 2 and 6 approve the removal and the dead-code deletion in this PR; grid is
  already the default and Electron's only path; "replace, do not accumulate" rules out a one-value
  layout type.
- Rejected alternatives:
  - Keep `LayoutMode = 'grid'`: a dead comparison at ten call sites.
  - Rewrite a stored `'single'` to `'grid'` on boot: a perpetual shim; ignoring the key already
    lands on the canvas (e2e `canvas.spec.ts:56-64`).
  - Delete `SurfaceActiveDirective`: the canvas subtree needs an element-injector `SURFACE_ACTIVE`
    that goes false on standalone routes.
  - Port the tab bar's workflow-claim filter to the canvas: rejected by decision 7.
- Assumptions:
  - A1. Bundle savings come from deleted files, so they do not depend on tree-shaking. The
    byte figures below are estimates from source size. Check: compare bundle sizes only if the user
    asks for a build.
  - A2. `openInEditor` keeps working because `tabManager.activeTab()` follows the focused tile
    (`canvas.store.ts:425-430`). Check: manual VS Code smoke (pop out a focused Rail session).
  - A3. In `chat-view.component.ts`, `stats` (`:1079`), `_inspectorStore` (`:1088`), `_gitStats`
    (`:1113`) and `sessionBranch` (import `:72`) have consumers outside the header and the inspector
    host. Known: `_inspectorStore` is still used by `needsYouCount` (compact card,
    `chat-view.component.html:16`) and answer-miss handling (`:1027,1042`). Check: after the
    deletion, remove each member and import that has no remaining reference (typecheck plus
    `noUnusedLocals`-style lint flags them).
- Effect on existing code: deletes 6 source files and 2 specs; removes about 10 layout branches;
  edits about 26 specs. Leaves `ChatViewComponent`'s no-context fallbacks in place (not approved).

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| D1 | Delete `LayoutMode` entirely | delete / narrow to `'grid'` | every call site reduces to its grid branch | yes |
| D2 | Stop reading `ptah-layout-mode`; no `removeItem` cleanup | ignore / migrate / remove key | ignoring = grid; e2e `canvas.spec.ts:56-64` pins it | yes |
| D3 | `SurfaceActiveDirective` loses its input; `active` = chat route addressed | keep `'canvas'` input / drop it | one remaining use (`app-shell.component.html:385`) | yes |
| D4 | Tile cap on a notification click returns `{ success: false, outcome: 'cap-reached' }`; panel stays open | user decision 4 | `notification-center.component.ts:275,282` | yes |
| D5 | chat-view no-context path keeps standalone-panel semantics (`mainPanelShowing` = `_sessionVisible?.() ?? true`; no main-panel question suppression); fork always uses the canvas | treat no-context as hidden / standalone | no production instance lacks context; least spec churn | yes |
| D6 | Keep the `cs-shell flex h-full w-full relative` wrapper div in `chat-view.component.html:2` as the layout box; drop only `#inspectorShell` | delete wrapper / keep box | its classes size the view for tiles too | yes |
| D7 | Keep the `SESSION_WORKFLOW_ADDONS` token and `workflowAddonsFor` export (public `chat` API, no provider today); remove only chat-view's consumption | delete / keep | `chat/src/index.ts:51-53`; not in decision 6 | yes |

## Component specifications

### 1. AppStateManager layout removal (core)

- Purpose: stop modelling a layout choice.
- Responsibilities: delete `LayoutMode` (`app-state.service.ts:105-106`), `_layoutMode` and its doc
  (393-403), `layoutMode` (674-675), the localStorage read (776-781), `setLayoutMode` and
  `toggleLayoutMode` (1206-1217); `normalizeView` maps `'orchestra-canvas'` to `'chat'` with no grid
  write (647-653); fix the doc comments at 109-111, 242-248, 806-808.
- Verified contracts: `normalizeInitialView` (`app-state.service.ts:810-820`) keeps its signature.
- Dependencies: none new. `LayoutMode` importers are specs only
  (`session-open-bridge.service.spec.ts:10`, `task-prompt-bridge.service.spec.ts:12`,
  `surface-active.spec.ts:11`, `app-state.service.spec.ts:66`).
- Failure behaviour: a stored `ptah-layout-mode` is ignored.
- Verification seam: `app-state.service.spec.ts`: delete 206-242, 661-675, 1004-1013; drop
  `layoutMode` from 156-162 and the `savedLayoutMode` option (103,113-114); add a regression case:
  with `localStorage['ptah-layout-mode'] = 'single'`, init leaves `currentView()` at `chat` and
  `'layoutMode' in service` is false. `webview-routing.spec.ts:339-348`: keep the
  `orchestra-canvas` -> `chat` assertion, drop the layout lines.
- Files: MODIFY `libs/frontend/core/src/lib/services/app-state.service.ts`, its spec,
  `apps/ptah-extension-webview/src/app/webview-routing.spec.ts`,
  `libs/frontend/core/src/lib/tokens/lazy-view-components.token.ts` (comment 29-38),
  `apps/ptah-extension-webview/src/app/app.config.ts` (comment 288-296: drop "ElectronShellComponent
  forces grid mode", keep the eager and retained rationale).

### 2. SurfaceActiveDirective (core)

- Purpose: provide `SURFACE_ACTIVE` to the retained canvas subtree.
- Responsibilities: `active` = `surfaceActiveFor('chat')()`; remove the input and the
  `AppStateManager` inject (`surface-active.directive.ts:17-28`); selector unchanged.
- Verified contracts: `surfaceActiveFor` (`core/src/lib/routing/surface-active.ts:8-13`); export
  `core/src/lib/routing/index.ts:24`.
- Integration points: `app-shell.component.html:385` becomes bare `ptahSurfaceActive`.
  `canvas-rail-board.component.ts:321` (`parentActive`) keeps its behaviour; update its comment at
  322-325 (no single-chat mode; the canvas is hidden only by `*ptahRetainWhile` on standalone
  routes).
- Verification seam: rewrite `surface-active.spec.ts:41-60` to follow the settled route only.
- Files: MODIFY `libs/frontend/core/src/lib/routing/surface-active.directive.ts`, its spec,
  `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts` (comment only).

### 3. AppShellComponent (chat) and TabBarComponent deletion

- Purpose: the VS Code shell shows the navbar plus the canvas only.
- Responsibilities:
  - Template: delete the Canvas toggle (`app-shell.component.html:209-220`), the tab-bar branch
    keeping only the "Orchestra Canvas" label (222-232), the navbar Previous sessions button
    (328-352), the single content div (412-419); canvas div drops `[class.hidden]` (386); header
    hide becomes `[class.hidden]="isElectron"` (114); update comments 7-13, 54, 376-381.
  - Class: remove `TabBarComponent` (31,118), `ChatViewComponent` (30,113), `History`/`LayoutGrid`
    icons and members (`HistoryIcon`, `LayoutGridIcon` 230), `layoutMode` (185),
    `openPreviousSessions` (300-307), `toggleLayoutMode` (358-364); `handleCreateSession`
    (420-431) keeps only `requestNewCanvasSession`; drop `TitleOrigin` (72) if unused; fix the class
    doc (77-107). `previousSessions` stays (defer block, `inert`).
  - Delete `tab-bar.component.ts` and its spec. The agent-origin badge goes with it (decision 5).
- Verified contracts: `requestNewCanvasSession` (`app-state.service.ts:1321-1325`); Rail opener of
  Previous sessions (`canvas-rail.component.ts:253-260`).
- Failure behaviour: if `ORCHESTRA_CANVAS_COMPONENT` is unbound, the existing spinner fallback
  (`app-shell.component.html:397-410`) is the only content.
- Quality requirements: the Rail footer button is the modal opener and focus-return target.
- Verification seam: `app-shell.previous-sessions.spec.ts`: drop the `layout` field
  (81,95,107,124,128), delete the navbar-button cases, open the modal through
  `PreviousSessionsDialogService.open()` for the inert/defer/load-state cases. Add a VS Code shell
  case: canvas container visible, no `ptah-tab-bar`, no "Toggle canvas grid" button, no
  `ptah-chat-view`, label "Orchestra Canvas" present. `app-shell.retained-chrome.spec.ts`,
  `.outlet-wrapper.spec.ts`, `.auth-redirect.spec.ts`, `.notification-center.spec.ts` must still pass.
- Files: MODIFY `app-shell.component.html`, `app-shell.component.ts`,
  `app-shell.previous-sessions.spec.ts` (all `libs/frontend/chat/src/lib/components/templates/`);
  DELETE `libs/frontend/chat/src/lib/components/organisms/tab-bar.component.ts`,
  `libs/frontend/chat/src/lib/components/organisms/tab-bar.component.spec.ts`.

### 4. ElectronShellComponent (chat)

- Responsibilities: delete the boot pin (`electron-shell.component.ts:421-425`) and the
  `setLayoutMode` line in `onCanvasTab` (500-503; keep `setCurrentView('chat')`).
- Verification seam: remove `setLayoutMode` stubs from `electron-shell.activity-placement.spec.ts:94`,
  `.apps-tab.spec.ts:68,98,131,186` (drop the not-called assertion), `.command-center-tab.spec.ts:61`,
  `.config-gate.spec.ts:77,130`, `.review-dock.spec.ts:107`, `.view-transition.spec.ts:63`.
- Failure behaviour: n/a. Files: MODIFY the component and those six specs.

### 5. Session-routing services (chat, harness-builder)

- Purpose: every "open/create a session" entry point targets the canvas.
- Responsibilities (each keeps only its grid body):
  - `session-open-bridge.service.ts:42-56`: always `requestCanvasSession`; drop the
    `SessionLoaderService` inject (28) and import.
  - `task-prompt-bridge.service.ts:79-91`: always `requestCanvasTab`; prefill with `tabId`.
  - `workflow-tab-launcher.service.ts:45-58`: same. Claimed workflow tabs are tiled, as on main
    today (decision 7).
  - `session-row-actions.service.ts:44-74`: canvas path only; drop `ChatStore` if unused.
  - `agent-session-adoption.service.ts:354`: delete the guard; fix comments 335-341.
  - `harness-builder-view.component.ts:436-442`: delete the guard.
- Verified contracts: `requestCanvasSession` (`app-state.service.ts:1219-1263`),
  `requestCanvasTab` (1331-1356).
- Failure behaviour: unchanged grid behaviour (`session-row-actions.service.ts:61-66` warns and
  resolves `'failed'`).
- Verification seam: delete single cases and `layoutMode` stubs in
  `session-open-bridge.service.spec.ts:10,19,33,49,66-80,100-104,121-`,
  `task-prompt-bridge.service.spec.ts:12,20,37,53,135-160`,
  `workflow-tab-launcher.service.spec.ts:8,19,37,56` (keep one case: a launched workflow tab
  requests a canvas tile with its `tabId`, the decision 7 path),
  `session-row-actions.service.spec.ts:49,66,77,94,134-160,194-`,
  `agent-session-adoption.service.spec.ts:49,89,257,521`,
  `harness-builder-view.component.spec.ts:96,155,235`,
  `previous-sessions-modal.component.spec.ts:180-220,722-887`.
- Files: MODIFY those six sources and nine specs.

### 6. NotificationFocusCoordinator (chat), decision 4

- Responsibilities: delete `setLayoutMode('grid')` (43) and the cap-reached fallback (53-72);
  return `canvasResult`. Drop the `ChatStore` inject (21) and the `openSessionTab`/`switchTab`
  calls; keep `resolve`.
- Verified contracts: `NotificationFocusResult` outcomes (`notification-focus-router.token.ts:7`).
- Failure behaviour: at the 20-tile cap the click resolves `cap-reached`; the panel stays open
  (`notification-center.component.ts:275,282`).
- Verification seam: replace "falls back to the full single view"
  (`notification-focus-coordinator.service.spec.ts:103`) with "returns cap-reached and switches no
  tab"; drop `layout:` entries (47,70).
- Files: MODIFY the service and its spec.

### 7. ChatViewComponent (chat): layout reads and the dead inspector host, decision 6

All `chat-view.component.*` edits live in this one component and one batch.

- Purpose: remove the layout reads and every member that only served the main-panel inspector host.
- Responsibilities:
  - Layout reads (D5): `mainPanelShowing` (861-865) becomes `this._sessionVisible?.() ?? true`;
    `resolvedQuestionRequests` drops `tilesPresent` and the main-panel return (1322-1326); fork
    (1698-1713) keeps only `requestCanvasSession`; fix the comment at 1377-1379.
  - Inspector host: delete `hostsInspector` (1101-1104), the `InspectorShellController` inject
    (1087) and provider (232), `wireInspectorShell` (980-1000) and its call (1375), the shell calls in
    question focus (1008, 1044-1045), the `inspectorShell` view query (1212-1213), and the template
    block `chat-view.component.html:285-316` (scrim and docked/sheet inspector). Remove
    `SessionInspectorComponent` from this component's `imports` if nothing else in the template uses
    it.
  - Session header: delete the template block `chat-view.component.html:32-69`, the
    `SessionHeaderComponent` import and entry (56, 220), and the header-only members
    `headerBranch` (1130-1140), `inspectorDot` (1143-1149), `limitCue` (1151-1153),
    `contextRingPercent` (1155-1157), `toggleDescription` (1160-1169), `headerChipAddons` and
    `headerActionAddons` (1172-1188), `_workflowAddons` (1115-1117) and the
    `SESSION_WORKFLOW_ADDONS`/`workflowAddonsFor` imports (66,68). Keep `needsYouCount` (compact
    card, html:16). Remove `stats`, `_gitStats`, `sessionBranch`, `limitAwareDot`,
    `inspectorToggleDescription` only when no reference remains (A3).
  - Host wrapper (D6): `chat-view.component.html:2` keeps `class="cs-shell flex h-full w-full
    relative"`, loses `#inspectorShell`; the main content loses `[attr.inert]="shell.isModal() ? ''
    : null"` (html:6).
  - Styles: delete `chat-view.component.css:17-50` (`.cs-inspector`, `.cs-inspector--sheet`,
    `.cs-inspector--full`, `.cs-scrim`, `@keyframes csInspectorIn`) and `.cs-inspector` from the
    reduced-motion list (192-197). Keep `.cs-shell` if still referenced.
  - Delete `libs/frontend/chat/src/lib/components/molecules/session-header/session-header.component.ts`.
  - Fix `libs/frontend/chat/src/lib/tokens/session-context.token.ts:34` ("single chat view" ->
    "tests and the Tribunal conductor").
- Kept on purpose: `SessionInspectorComponent` and its section components, `InspectorShellController`
  (Rail board, `canvas-rail-board.component.ts:74`), the agent sidebar tab
  (`chat-view.component.html:318-340`, reachable from tiles), no-context fallbacks in the
  `resolved*` computeds (not approved), `SESSION_WORKFLOW_ADDONS` token (D7).
- Failure behaviour: fork failure handling unchanged (`showActionError`).
- Verification seam: `chat-view.component.spec.ts`: drop `layoutModeSig` (443,451,597), the
  grid-setting cases (1352,1376,1554), the single fork path, and every case that asserts the session
  header, the inspector toggle, the sheet/docked inspector or the scrim; keep one fork case asserting
  `requestCanvasSession(newSessionId, 'Branch')`. Remove `layoutMode` from the `AppStateManager`
  stubs in `chat-view.dock.spec.ts:326`, `chat-view.keepalive.spec.ts:483`,
  `chat-view.session-enter.spec.ts:106` and
  `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.spec.ts:256`.
  `canvas-rail-board.component.spec.ts` (Rail inspector) must still pass unchanged.
- Files: MODIFY `chat-view.component.ts`, `.html`, `.css`, `.component.spec.ts`, `.dock.spec.ts`,
  `.keepalive.spec.ts`, `.session-enter.spec.ts` (all `libs/frontend/chat/src/lib/components/templates/`),
  `libs/frontend/chat/src/lib/tokens/session-context.token.ts`,
  `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.spec.ts`; DELETE
  `libs/frontend/chat/src/lib/components/molecules/session-header/session-header.component.ts`.

### 8. chat-ui components only the tab bar used, decision 6

- Responsibilities: delete `TabItemComponent` and `AwaitingBackgroundIndicatorComponent` with their
  exports (`chat-ui/src/index.ts:14,107`) and the deprecated re-export of `TabItemComponent`
  (`chat/src/lib/components/index.ts:104-108`; keep the other two names in that export).
- Verification seam: grep `TabItemComponent|ptah-tab-item|AwaitingBackgroundIndicator|ptah-awaiting-background-indicator`
  in `libs` and `apps` source returns 0; chat-ui typecheck/test/lint pass.
- Files: DELETE `libs/frontend/chat-ui/src/lib/molecules/session/tab-item.component.ts`,
  `libs/frontend/chat-ui/src/lib/atoms/awaiting-background-indicator/awaiting-background-indicator.component.ts`,
  `libs/frontend/chat-ui/src/lib/atoms/awaiting-background-indicator/awaiting-background-indicator.component.spec.ts`;
  MODIFY `libs/frontend/chat-ui/src/index.ts`, `libs/frontend/chat/src/lib/components/index.ts`.

### 9. Electron e2e and showcase (ptah-electron-e2e)

- Responsibilities: `src/specs/canvas/canvas.spec.ts:56` rename to "Electron ignores a stale
  ptah-layout-mode value and opens the Rail board" (body unchanged);
  `src/showcase/lane-console-review.scene.ts:44-55`: delete the `if (!visible(grid))` toggle click;
  keep `grid.waitFor({ state: 'visible', timeout: 30_000 })`. Drop the `visible` helper import only
  if unused. `show-canvas.ts` unchanged.
- Verification seam: typecheck and lint only (no e2e or showcase run).
- Files: MODIFY `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts`,
  `apps/ptah-electron-e2e/src/showcase/lane-console-review.scene.ts`.

## Integration architecture

- Data flow: entry points (navbar New, Rail, Tasks "Open session", task prompt, workflow launch,
  agent adoption, harness builder, fork, notification) -> `AppStateManager` request queues ->
  `OrchestraCanvasComponent` effects -> `CanvasStore` -> `TabManagerService`.
- State or persistence: `ptah-layout-mode` is no longer read or written; canvas persistence
  unchanged.
- External boundaries: none (`ptah.openFullPanel`, `ptah.openOrchestraCanvas` unchanged).
- Failure and rollback: each request keeps its grid failure path; rollback is a git revert.
- Observability: existing warnings in `session-row-actions.service.ts:62` and
  `orchestra-canvas.component.ts:366`.

## Architecture-level quality requirements

- Functional: in both hosts chat shows the canvas with the Rail; no Canvas toggle, tab bar, navbar
  Previous sessions button, chat-view session header or chat-view inspector; a stored
  `ptah-layout-mode=single` has no effect; a notification click at the tile cap leaves the panel open.
- Performance: one fewer always-mounted hidden `ChatViewComponent` in both hosts.
- Bundle (estimate from source sizes, no build): `tab-bar.component.ts` 16,322 B,
  `tab-item.component.ts` 4,684 B, `awaiting-background-indicator.component.ts` 4,116 B,
  `session-header.component.ts` 9,494 B, plus about 3 KB of app-shell template and layout code and
  about 6-8 KB of chat-view inspector-host TS, HTML and CSS: about 44-46 KB of source, roughly
  16-20 KB minified and 5-6 KB gzipped (TS -> minified ratio 0.35-0.45 assumed).
- Security: n/a.
- Maintainability: zero-reference sweep below; no new cross-library import; module boundaries
  checked by scoped lint.
- Testability: each removed branch loses its spec cases; each surviving grid path keeps one; the
  app-shell VS Code case, the AppStateManager stale-key case and the notification cap case are the
  regression tests.

## Risks

1. Notification click at the tile cap now gives no visible feedback (decision 4, accepted).
2. The agent-origin badge has no replacement (decision 5, accepted).
3. Ctrl/Cmd+T in VS Code creates a tab the mounted canvas does not tile (pre-existing grid
   behaviour, `keyboard-shortcuts.service.ts:67-68`). Out of scope.
4. Workflow-claimed tabs get canvas tiles in VS Code, as they already do in Electron (decision 7).
5. Spec churn is large (about 26 spec files); a missed `LayoutMode` import or a dangling member
   fails typecheck or lint, which is the intended detector.

## Team-leader handoff

- Recommended executors: frontend-developer for all components (Angular templates, signals, CSS,
  specs; no backend).
- Complexity: MEDIUM. Mechanical removal across about 15 sources and 26 specs in seven projects.
- Dependencies and ordering: batches are SEQUENTIAL, and each file belongs to exactly one batch.
  Batch 1 removes the core API, which breaks consumers until Batches 2-3 land, so commit after
  Batch 3 passes or commit Batches 1-3 together.
  - Batch 1 (core and webview app): components 1, 2. Files: `app-state.service.ts` and spec,
    `surface-active.directive.ts` and spec, `lazy-view-components.token.ts`,
    `webview-routing.spec.ts`, `app.config.ts`, `canvas-rail-board.component.ts` (comment).
  - Batch 2 (chat shell and services): components 3, 4, 5, 6. All app-shell, electron-shell,
    tab-bar, service, harness-builder and previous-sessions-modal files listed there.
  - Batch 3 (chat-view only): component 7. Every `chat-view.component.*` file,
    `session-context.token.ts`, `session-header.component.ts`,
    `canvas-detail-transcript.component.spec.ts`.
  - Batch 4 (chat-ui and e2e): components 8, 9.
- Parallel-safe work: none; the batches compile only together.
- Files affected:
  - DELETE: `libs/frontend/chat/src/lib/components/organisms/tab-bar.component.ts`,
    `libs/frontend/chat/src/lib/components/organisms/tab-bar.component.spec.ts`,
    `libs/frontend/chat/src/lib/components/molecules/session-header/session-header.component.ts`,
    `libs/frontend/chat-ui/src/lib/molecules/session/tab-item.component.ts`,
    `libs/frontend/chat-ui/src/lib/atoms/awaiting-background-indicator/awaiting-background-indicator.component.ts`,
    `libs/frontend/chat-ui/src/lib/atoms/awaiting-background-indicator/awaiting-background-indicator.component.spec.ts`.
  - MODIFY (source): `libs/frontend/core/src/lib/services/app-state.service.ts`,
    `libs/frontend/core/src/lib/routing/surface-active.directive.ts`,
    `libs/frontend/core/src/lib/tokens/lazy-view-components.token.ts`,
    `apps/ptah-extension-webview/src/app/app.config.ts`,
    `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`,
    `libs/frontend/chat/src/lib/components/templates/app-shell.component.html`,
    `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`,
    `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`,
    `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`,
    `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`,
    `libs/frontend/chat/src/lib/components/templates/chat-view.component.css`,
    `libs/frontend/chat/src/lib/tokens/session-context.token.ts`,
    `libs/frontend/chat/src/lib/components/index.ts`,
    `libs/frontend/chat/src/lib/services/notification-focus-coordinator.service.ts`,
    `libs/frontend/chat/src/lib/services/chat-store/session-open-bridge.service.ts`,
    `libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.ts`,
    `libs/frontend/chat/src/lib/services/workflow-tab-launcher.service.ts`,
    `libs/frontend/chat/src/lib/services/session-list/session-row-actions.service.ts`,
    `libs/frontend/chat/src/lib/services/agent-session-adoption.service.ts`,
    `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts`,
    `libs/frontend/chat-ui/src/index.ts`,
    `apps/ptah-electron-e2e/src/showcase/lane-console-review.scene.ts`.
  - MODIFY (specs): `libs/frontend/core/src/lib/services/app-state.service.spec.ts`,
    `libs/frontend/core/src/lib/routing/surface-active.spec.ts`,
    `apps/ptah-extension-webview/src/app/webview-routing.spec.ts`,
    `libs/frontend/chat/src/lib/components/templates/app-shell.previous-sessions.spec.ts`,
    `libs/frontend/chat/src/lib/components/templates/electron-shell.{activity-placement,apps-tab,command-center-tab,config-gate,review-dock,view-transition}.spec.ts`,
    `libs/frontend/chat/src/lib/components/templates/chat-view.{component,dock,keepalive,session-enter}.spec.ts`,
    `libs/frontend/chat/src/lib/services/notification-focus-coordinator.service.spec.ts`,
    `libs/frontend/chat/src/lib/services/chat-store/session-open-bridge.service.spec.ts`,
    `libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.spec.ts`,
    `libs/frontend/chat/src/lib/services/workflow-tab-launcher.service.spec.ts`,
    `libs/frontend/chat/src/lib/services/session-list/session-row-actions.service.spec.ts`,
    `libs/frontend/chat/src/lib/services/agent-session-adoption.service.spec.ts`,
    `libs/frontend/chat/src/lib/components/organisms/previous-sessions/previous-sessions-modal.component.spec.ts`,
    `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.spec.ts`,
    `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.spec.ts`,
    `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts`.
- Verification points:
  - Zero-reference sweep (source and specs under `libs/frontend` and `apps`): `LayoutMode`,
    `layoutMode`, `setLayoutMode`, `toggleLayoutMode`, `ptah-tab-bar`, `TabBarComponent`,
    `Toggle canvas grid`, `SessionHeaderComponent`, `ptah-session-header`, `hostsInspector`,
    `inspectorShell`, `cs-inspector`, `cs-scrim`, `csInspectorIn`, `TabItemComponent`,
    `ptah-tab-item`, `AwaitingBackgroundIndicator`; `ptah-layout-mode` only in two specs: the
    e2e `canvas.spec.ts` and the `app-state.service.spec.ts` regression case (a stored `'single'`
    lands on the grid). No production source reads or writes that key; no "single chat"/"single-chat"/"single layout" wording left in the files this
    plan edits.
  - DI/RPC guards, unaffected (no layout, tab-bar, surface-directive or canvas-token reference;
    no backend file changes): `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts`,
    `apps/ptah-extension-vscode/src/di/expected-resolvable.ts`,
    `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`,
    `apps/ptah-extension-vscode/src/di/surface-composition.spec.ts`, and the Electron
    counterparts in `apps/ptah-electron/src/di/` (same four files). Do not run them.
  - Scoped commands, one at a time, `--parallel=1`:
    1. `npx nx run-many -t typecheck -p @ptah-extension/core @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/canvas @ptah-extension/harness-builder ptah-extension-webview ptah-electron-e2e --parallel=1`
    2. `npx nx run-many -t test -p @ptah-extension/core @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/canvas @ptah-extension/harness-builder ptah-extension-webview --parallel=1`
       (header must say 6 projects; `ptah-electron-e2e` has no unit test target)
    3. `npx nx run-many -t lint -p @ptah-extension/core @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/canvas @ptah-extension/harness-builder ptah-extension-webview ptah-electron-e2e --parallel=1`
       (module boundaries)
    Add `@ptah-extension/tribunal-panel` only if a file there changes. No build, serve, e2e or
    showcase runs.
