# Current Navigation Mechanism — Research Report

Scope: document, do not judge. This report does not assess host limits (VS Code
webview / Electron `BrowserWindow` restrictions) — another lane covers that.

## View inventory

`ViewType` union: `libs/frontend/core/src/lib/services/app-state.service.ts:20-33`.

| View id | Owning component | Eager / Lazy | Entry points |
|---|---|---|---|
| `chat` | `ChatViewComponent` (single layout) or `OrchestraCanvasComponent` (grid layout), toggled by `[class.hidden]` — `app-shell.component.html:686-715` | Eager — `ORCHESTRA_CANVAS_COMPONENT` bound with `useValue` (class, not loader), `app.config.ts:155` | Default view; navbar "Canvas" tab (`electron-shell.component.ts:381-384`) |
| `settings` | `SettingsComponent` | Eager (statically imported, `app-shell.component.ts:42`) | `openSettings()` — `app-shell.component.ts:393-395`, `electron-shell.component.ts:386-388` |
| `analytics` | `DashboardGridComponent` | Eager (statically imported, `app-shell.component.ts:44`) | `openDashboard()` — `app-shell.component.ts:400-402`, `electron-shell.component.ts:390-392` |
| `setup-wizard` | `WizardViewComponent`, via `WIZARD_VIEW_COMPONENT` token | Eager on purpose — `app.config.ts:150`, `lazy-view-components.token.ts:69-79` | VS Code command `ptah.setupAgents` opens a **dedicated new webview panel** whose HTML hardcodes `initialView: 'setup-wizard'` (`libs/backend/agent-generation/src/lib/services/wizard/webview-lifecycle.service.ts:153`, activation event `apps/ptah-extension-vscode/package.json:41`) |
| `harness-builder` | `HarnessBuilderViewComponent`, via `HARNESS_BUILDER_COMPONENT` token | Lazy — `LazyViewService.resolveWhen`, trigger `currentView() === 'harness-builder'` (`app-shell.component.ts:210-213`) | Not in either `initialView` allow-list; reached by explicit navigation or `AppStateManager.requestHarnessWorkflow` |
| `setup-hub` | `SetupHubComponent`, via `SETUP_HUB_COMPONENT` token | Lazy — same loader chunk as `harness-builder` (`app.config.ts:169-175`) | `openSetupHub()` — `electron-shell.component.ts:401-403` (Electron navbar only) |
| `thoth` | `ThothShellComponent` | Lazy — Angular native `@defer (on immediate)` block, **not** `LazyViewService` (`app-shell.component.html:81-91`) | `openThoth()` — `app-shell.component.ts:409-414`, `electron-shell.component.ts:394-399` |
| `marketplace` | `MarketplaceHubComponent`, via `MARKETPLACE_COMPONENT` token | Lazy (`app-shell.component.ts:233-236`) | `openMarketplace()` — `app-shell.component.ts:419-421`, `electron-shell.component.ts:405-407` |
| `tribunal` | `TribunalPageComponent`, via `TRIBUNAL_COMPONENT` token | Lazy (`app-shell.component.ts:243-246`) | `openTribunal()` — `app-shell.component.ts:423-425`, `electron-shell.component.ts:409-411`; also a valid `initialView` value (`app.ts:132`) |
| `tasks` | `TasksViewComponent`, via `TASKS_VIEW_COMPONENT` token | Lazy (`app-shell.component.ts:253-256`) | `openTasks()` — `app-shell.component.ts:427-429`, `electron-shell.component.ts:413-415` |
| `command-builder` | none found | n/a | Present in `ViewType` (`app-state.service.ts:22`) and in `App.handleInitialView`'s `VALID_VIEWS` (`app.ts:126`), but there is **no** `@switch` case for it in `app-shell.component.html`. Setting this view falls through to the default shared chrome. Unverified whether this is dead code or a work-in-progress view. |
| `context-tree` | none found | n/a | Same situation as `command-builder` — declared (`app-state.service.ts:24`, `app.ts:127`) but no rendering branch found. Unverified. |
| `orchestra-canvas` | n/a — legacy alias | n/a | `AppStateManager.normalizeView` rewrites it to `chat` + grid layout mode before it is ever stored (`app-state.service.ts:341-347`). Kept only for backward compatibility with old persisted/host values. |

## How navigation works today

1. Every view switch funnels through one signal write: `AppStateManager.setCurrentView(view)` (or the internal `openViewInActiveSlice`), which is the single place `currentView` changes. `libs/frontend/core/src/lib/services/app-state.service.ts:565-569`.
2. `WebviewNavigationService.navigateToView(view)` wraps that write with guard/error/history bookkeeping, but the actual state lives in `AppStateManager` — the service's own `currentView` computed signal reads `appState.currentView()` directly, not a private mirror, specifically because other callers (navbar buttons, the extension host) bypass this service and write `AppStateManager` directly. `libs/frontend/core/src/lib/services/webview-navigation.service.ts:46-63`.
3. The extension/Electron host can request a view switch by posting `MESSAGE_TYPES.SWITCH_VIEW`, handled by `AppStateManager.handleMessage`, which validates the view name against an allow-list before calling `handleViewSwitch`. `libs/frontend/core/src/lib/services/app-state.service.ts:216-243`. The Electron `IPlatformCommands.focusChat()` port documents broadcasting this exact message with `view: 'chat'`. `libs/backend/platform-core/src/interfaces/platform-abstractions.interface.ts:27-34`.
4. There is **no Angular Router** anywhere in the webview. `WebviewNavigationService`'s own doc block states the reason: VS Code webviews block `history.pushState`/`replaceState`. `libs/frontend/core/src/lib/services/webview-navigation.service.ts:13-22`. `app.config.ts`'s `WebviewErrorHandler` explicitly swallows the `SecurityError` such a call would throw. `apps/ptah-extension-webview/src/app/app.config.ts:86-102`.
5. `AppShellComponent` renders the active view with one `@switch (currentView())` for the nine "standalone" views, and always renders the shared chrome (sidebar/header/agent panel) underneath, hidden via `[class.hidden]="isStandaloneView()"` rather than removed. `libs/frontend/chat/src/lib/components/templates/app-shell.component.html:17-135`.
6. Inside the shared chrome, the `chat` content area itself has two permanently-mounted branches (canvas grid, single-chat) toggled the same `[class.hidden]` way, specifically so `CanvasStore` (scoped to the `OrchestraCanvasComponent` instance) is never destroyed by a layout-mode toggle. `libs/frontend/chat/src/lib/components/templates/app-shell.component.html:683-715`.
7. Every *other* standalone view (`setup-wizard`, `harness-builder`, `setup-hub`, `marketplace`, `tribunal`, `tasks`, plus `thoth`'s `@defer`) sits inside an `@switch` `@case`, which is Angular's mount/destroy directive: navigating away from one of these views **destroys** its component instance, and navigating to it again creates a fresh one. `libs/frontend/chat/src/lib/components/templates/app-shell.component.html:18-131`.
8. `ElectronShellComponent` never runs its own `@switch`. It always embeds `<ptah-app-shell>` (`electron-shell.component.ts:264`) and its own navbar tab buttons write `AppStateManager.setCurrentView(...)` directly (`electron-shell.component.ts:386-415`) — `AppShellComponent`'s `@switch` is what actually reacts. `ElectronShellComponent` layers one extra gate above that: no workspace folder open → `ElectronWelcomeComponent`; folder open → the 3-panel layout containing `AppShellComponent`. `electron-shell.component.ts:232-236`.
9. Every deferred surface loads through one function, `LazyViewService.resolveWhen(token, trigger)`. It is **trigger-gated, not read-gated**: the dynamic `import()` starts the first time `trigger()` evaluates `true` inside an Angular `effect`, exactly once, and is never retried on trigger flapping or on a rejected import. `libs/frontend/core/src/lib/services/lazy-view.service.ts:20-24,36-43,62-83`.
10. Deep-linking into a specific surface on cold start goes through `window.ptahConfig.initialView`, read once in `App.handleInitialView()`, checked against a local `VALID_VIEWS` allow-list (8 entries — narrower than the full `ViewType` union: excludes `harness-builder`, `setup-hub`, `thoth`, `marketplace`, `tasks`, `command-builder`/`context-tree` are actually present in this list), defaulting to `'chat'` on any invalid or missing value. `apps/ptah-extension-webview/src/app/app.ts:119-155`.

## Session and history state

| State item | Owner service | Survives reload | URL-addressable today |
|---|---|---|---|
| Active view (`currentView`) | `AppStateManager` (per-workspace `ViewSlice.currentView`) — `app-state.service.ts:193-200,349-351` | No — not written to `localStorage`; re-derived each load from `window.ptahConfig.initialView` (defaults to `'chat'`) | No, but the value already arrives as a single string through `ptahConfig.initialView` (`app.ts:118-138`) — mechanically close to a URL segment |
| Open view tabs (`openViews`) | `AppStateManager` (`ViewSlice.openViews`, a `Set<ViewType>`) — `app-state.service.ts:194-195` | No — same as above, not persisted | No |
| Layout mode (single / grid) | `AppStateManager` — `_layoutMode`, persisted to `localStorage['ptah-layout-mode']` — `app-state.service.ts:465-470,706-717` | Yes | No |
| Chat tab (`TabId`) | `TabManagerService` — `_tabs` array; `TabId` is a UUID v4 branded string (`identity/ids.ts:30-42`) | Yes — full `TabState` minus `streamingState`/`attachedBinding`/turn-revision fields is written to `localStorage` per workspace and restored via `sanitizeRestoredTabs` (`tab-manager.service.ts:2404-2565`, `tab-persistence.ts:74-83`) | Not currently, but `TabId` is already a stable, reload-surviving UUID — the natural URL-segment candidate |
| Active tab (`activeTabId`) | `TabManagerService` — `_activeTabId`, persisted alongside `_tabs` | Yes | No |
| Claude session id (`ClaudeSessionId`) | `TabManagerService` (`TabState.claudeSessionId`), attached via `attachSession` | Yes (part of persisted `TabState`) | No |
| Conversation id / multi-session thread | `ConversationRegistry` (`Map<ConversationId, ConversationRecord>`, sessions array) — `conversation-registry.service.ts:90-129` | Unverified — no `localStorage` call found inside `conversation-registry.service.ts` itself; ownership of conversation continuity across reload could not be confirmed in this pass | No |
| Tab ↔ conversation binding | `TabSessionBinding` (`chat-state`, two maps `_byTab`/`_bySurface`) | Unverified — not read in this pass | No |
| Canvas tile layout (grid positions) | `CanvasLayoutPersistenceService`, scoped per `OrchestraCanvasComponent`/`CanvasStore` instance, keyed per workspace path | Yes — explicit `localStorage.getItem/setItem` keyed by workspace (`canvas-layout-persistence.service.ts:164,282`) | No |
| Canvas tile ↔ tab membership | `CanvasStore`, restored from `TabManagerService`'s tabs via `restoreCanvasTilesFromTabs` on component mount (`orchestra-canvas.component.ts:404`, referenced) | Indirectly yes, rebuilt from persisted tabs on every mount, not itself stored | No |
| Thoth active sub-tab (memory/skills/cron/gateway) | `AppStateManager` (`ViewSlice.thothActiveTab`) — `app-state.service.ts:196,382-384` | No — same per-workspace slice as `currentView`, not persisted | No |
| Marketplace selected provider | `AppStateManager` (`ViewSlice.marketplaceActiveProvider`) — `app-state.service.ts:198-199,390-392` | No | No |
| Thoth first-run hint dismissed | `AppStateManager`, `localStorage[THOTH_FIRST_RUN_DISMISSED_KEY]` — `app-state.service.ts:325-330,690-694` | Yes | No (not session/view state, a UI flag) |
| Scroll position (transcript) | Not investigated | Unverified | Unverified |

## What a Router would replace, and what it would not

**Would plausibly replace:**
- The manual `@switch (currentView())` mount/destroy in `AppShellComponent` for the 9 standalone views — this is structurally the same job a `Route` outlet does.
- The hand-rolled deferred-load wiring (`LazyViewLoader` tokens + `LazyViewService.resolveWhen`) for `harness-builder`, `setup-hub`, `marketplace`, `tribunal`, `tasks` — Angular Router's lazy `loadComponent` does this natively, with less bespoke plumbing.
- The `window.ptahConfig.initialView` string-matching deep-link path in `App.handleInitialView` — a router's initial-navigation resolution covers the same need more uniformly, and could also absorb `command-builder`/`context-tree` consistently instead of leaving them as declared-but-unrendered.
- `AppStateManager`'s per-workspace `ViewSlice.currentView`/`openViews` bookkeeping, which largely duplicates what a router's own navigation state already tracks.

**Would not replace:**
- The core reason Angular Router is unavailable here at all: VS Code webviews block `history.pushState`/`replaceState` (`webview-navigation.service.ts:13-22`, `app.config.ts:86-102`). Any router use would need Angular's memory-location strategy or an equivalent, not the browser History API — this report does not judge whether that is viable (host-limits lane).
- The `[class.hidden]` "always mounted, never destroyed" pattern for the canvas/chat content area and for shared chrome under standalone views — this is a deliberate state-preservation choice (`app-shell.component.html:9-15,683-685`), not a routing gap; a naive router `Route` swap would destroy state a router-based rewrite would have to special-case back in (e.g. with an aux/parallel outlet or manual `keep-alive`-style wrapper).
- Multi-tab / multi-session chat state (`TabManagerService`, `ConversationRegistry`, `TabSessionBinding`) — this is domain state about open conversations, not navigation state; a router would at most provide the URL segment a `TabId` could sit in, not replace the tab/session/conversation model itself.
- Canvas tile layout persistence (`CanvasLayoutPersistenceService`) — unrelated to view routing, a separate per-workspace layout store.
- The `MESSAGE_TYPES.SWITCH_VIEW` RPC channel the extension/Electron host uses to command a view switch from outside Angular — a router still needs an equivalent host→app entry point; it would not remove this channel, only change what receives it.

## Unknowns

- Whether `ConversationRegistry` records survive a webview reload (no `localStorage` read/write found in `conversation-registry.service.ts` in this pass — marked `unverified`).
- Whether `TabSessionBinding` state is rebuilt from `TabManagerService`'s persisted tabs on reload, or is purely in-memory and reconstructed by `StreamRouter` on tab creation (`stream-router.service.ts:103-121` `onTabCreated` was read only at the signature level, not the body).
- Whether any component tracks and restores transcript scroll position across a reload or a view switch — not investigated.
- Whether `command-builder` and `context-tree` (both declared in `ViewType` and in `App.handleInitialView`'s `VALID_VIEWS`, `app.ts:124-133`) are dead code, an in-progress feature, or reachable through a path this pass did not find (e.g. a VS Code command not grepped for). Setting either currently renders the shared chrome with no dedicated `@switch` case matching it.
- The exact behavior of the VS Code (non-Electron) `initialView` allow-list vs. the Electron one — `App.handleInitialView`'s `VALID_VIEWS` (8 entries, `app.ts:124-133`) differs from the full 13-entry `ViewType` union and from `AppStateManager.handleMessage`'s own 13-entry `validViews` list (`app-state.service.ts:221-235`); which list actually gates a real host-originated deep link in each of the two hosts was not traced end-to-end into `webview-lifecycle.service.ts` or the Electron main-process HTML generator.
