# Batch 4c report — ChatTabRouteSync and `chat/:tabId`

Status: revise round 1 applied; all three checks green (see "Verification — initial run" and "Revise round 1" at the end).

## Files

- CREATED `libs/frontend/chat/src/lib/services/chat-tab-route-sync.service.ts`: root `ChatTabRouteSync`, idempotent `start()`.
- CREATED `libs/frontend/chat/src/lib/services/chat-tab-route-sync.service.spec.ts`: 16 cases (see Tests).
- MODIFIED `libs/frontend/chat/src/lib/services/index.ts`: exports `ChatTabRouteSync`. It reaches the public API through the `export * from './lib/services'` in `libs/frontend/chat/src/index.ts`.
- MODIFIED `apps/ptah-extension-webview/src/app/app.routes.ts`: `chat` keeps its `providers`, stays component-less, and gets `children: [{ path: '', children: [] }, { path: ':tabId', children: [] }]`. The comment edits from Batch 3b are kept.
- MODIFIED `apps/ptah-extension-webview/src/app/app.config.ts`: imports `ChatTabRouteSync` and adds `provideAppInitializer(() => inject(ChatTabRouteSync).start())` right after the `AgentSessionAdoptionService` starter.
- MODIFIED `apps/ptah-extension-webview/src/app/webview-routing.spec.ts`:
  - The chat-route shape test now pins the two children, the single provider and that there is no component, `loadComponent` or `loadChildren`.
  - New test: a `/chat/<uuid>` round trip. `navigateToUrl` lands. `currentView()` and `currentSurface()` stay `chat`. The `chat` and `:tabId` snapshots carry no component, and `paramMap.tabId` is set. Going back to bare `/chat` lands on the `''` child. No `history.pushState` call.
  - `declares exactly the surfaces in SURFACE_ROUTE_IDS` is untouched. It filters on top-level paths only, so it is unaffected.

## Design notes

- **URL to tab** (one `Router.events` `NavigationEnd` subscription, released through `DestroyRef`). It reads `segments[1]` of the parsed `urlAfterRedirects`, and only when `segments[0]` is `chat`.
  - If the id equals `activeTabId()`, nothing happens.
  - If the id passes `TabId.validate` and is in `tabs()`, it calls `switchTab`.
  - Otherwise it replaces the URL with `/chat/<active>`. A bare `/chat` with no active tab is left alone.
- **Tab to URL** (one root effect). Only `activeTabId()` is tracked; the rest runs in `untracked`.
  - It does nothing when `pendingSurface() !== null`, when the current URL is not a chat URL, or when the URL tab already equals the active tab.
  - Otherwise it replaces the URL.
- **No loop.** Each reaction leaves the other's guard (URL tab equals `activeTabId`) satisfied, so a settle causes at most one corrective navigation. The spec pins the exact `NavigationEnd` sequence.
- The service never creates, closes or reorders tabs. Its only write to `TabManagerService` is `switchTab`.

## Deviations

1. **The chat check reads the URL's own first segment, not `SurfaceRouterService.currentSurface()`.**
   - `currentSurface()` maps the pre-boot `/` to `chat` through the `surfaceIdFromSegment` fallback.
   - Under `withDisabledInitialNavigation()`, the effect's first run (inside the app initializer) would then see "on chat" and navigate to `/chat/<id>` before `App.handleInitialView` runs. That would pre-empt a setup-wizard deep link (P9) and flash chat.
   - This is pinned by the "does not navigate before the first navigation" test.
2. **The replace goes through `SurfaceRouterService.navigateToSurface('chat', [id], { replaceUrl: true })`, not raw `router.navigate([...], { replaceUrl: true })`.**
   - The URL and the flag are the same.
   - The difference is that the call never rejects and builds the tree with `createUrlTree`.
   - Its outcome is ignored, as the plan says. A failure is logged once by `navigateToSurface`.
3. **The export is added to `lib/services/index.ts`, not to `src/index.ts` directly.** That is the sibling pattern (`AgentSessionAdoptionService`), and it is re-exported by `src/index.ts`.

## Pitfall checks

- **Colons in tab ids.** None. Tabs are minted only by `TabManagerService.generateTabId()`, which calls `TabId.create()` (UUID v4, `tab-manager.service.ts:2979-2980`). `/chat/<uuid>` has no colon, is well under 2048 characters, and is accepted by `parseWebviewRouteState`, so persistence keeps `/chat/<tabId>` routes.
  - A legacy non-UUID tab id restored from localStorage is honoured in the URL only while it is already active. A deep link to one is corrected, because `TabId.validate` fails. Persistence would drop such a URL only if the legacy id contained a colon. The current code mints no such id, and none was found.
- **`panelId` keying of `TabManagerService`** is untouched.
- **`surfaceOf`** reads `segments[0]` only. The webview spec pins that `currentView()` stays `chat` on `/chat/<id>`.

## Tests (`chat-tab-route-sync.service.spec.ts`)

The spec uses the real Router over `provideSurfaceRouterTesting()` and the real `MemoryPlatformLocation`, with a signal stub for `TabManagerService`. It covers:

- deep link to an existing tab → `switchTab`, and no correction;
- an unknown or invalid id → corrected with `replaceState`, with no `pushState`;
- an invalid legacy id is never switched to;
- with no active tab, an unknown id → bare `/chat`;
- `/chat` → `/chat/<active>`, and `/chat` is left alone with no active tab;
- other surfaces are ignored;
- a tab switch → URL replaced, with the push count unchanged;
- closing the last tab → `/chat`;
- a workspace switch → the URL follows;
- a pending navigation → no write;
- a tab change on another surface → caught up on return through bare `/chat`;
- no write before the first navigation;
- a bounded `NavigationEnd` sequence (no loop);
- `start()` called twice → still one reaction.

## Risks

- **R5 (accepted by D6).** Back from a standalone surface returns to the tab that was active when chat was left. If that tab still exists, reaction 1 re-activates it.
- **Extra history entry when chat is reselected while already on chat.**
  - Calling `AppStateManager.setCurrentView('chat')` while on `/chat/<id>` pushes `/chat`, because `navigateToSurface('chat')` targets the bare root. Reaction 1 then replaces it with `/chat/<id>`, which leaves two identical `/chat/<id>` entries in memory history. Back then appears to do nothing once.
  - The plan accepts "setCurrentView('chat') keeps landing on /chat". The fix belongs in core (`navigateToSurface` / `AppStateManager`, outside this batch's files): treat "already on chat" as already-there.
  - Flagged for 4d or a follow-up.
- **One extra persistence write per chat entry.** The transient `/chat` settles before `/chat/<id>`, which adds one extra `SurfaceRoutePersistence` write per chat entry. It is harmless, and the last write wins.

## Verification

Not run, per the orchestrator's instruction. Commands to run when cleared, one at a time:

1. `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/chat-tab-route-sync.service.spec.ts --coverage=false --maxWorkers=2`
2. `npx nx run-many -t test,typecheck,lint -p @ptah-extension/chat --parallel=1`
3. `npx nx run-many -t test,typecheck,lint -p ptah-extension-webview --parallel=1`

## Verification — initial run (before revise round 1)

The three commands were run one at a time. Each Nx header named exactly one project.

1. Jest on the spec: `Test Suites: 1 passed, 1 total`, `Tests: 16 passed, 16 total`.
2. `nx run-many -t test,typecheck,lint -p @ptah-extension/chat --parallel=1`: "Running targets test, typecheck, lint for project @ptah-extension/chat". The result was "Successfully ran targets test, typecheck, lint for project @ptah-extension/chat".
3. `nx run-many -t test,typecheck,lint -p ptah-extension-webview --parallel=1`: "Successfully ran targets test, typecheck, lint for project ptah-extension-webview".

## Revise round 1

This round responds to `batch4c-review.md`, which raised two defects. Both were valid and both are fixed. The batch still touches 6 files, and only the service and its spec changed.

### Defect 1: restored tab URL discarded before the workspace tabs load

- **The readiness signal.** No new signal was added; an existing one is used. `TabWorkspacePartitionService.switchWorkspace` sets `activeWorkspacePath$` in the same synchronous call in which `TabManagerService.switchWorkspace` applies the workspace's `tabs` and `activeTabId` (`tab-workspace-partition.service.ts:206`, `tab-manager.service.ts:760-773`). By the time an effect sees a non-null path, the workspace's tab set is applied.
- **This only holds on Electron.** `switchWorkspace` is called only from `ElectronLayoutService.syncFromBackend` / `coordinateWorkspaceSwitch`, and `restoreLayout` runs only when `isElectron` (`electron-layout.service.ts:130-139`). On VS Code, `activeWorkspacePath$` stays null for the page's lifetime, while the panel's tabs are loaded synchronously in the `TabManagerService` constructor and are final.
- **The readiness rule** is therefore `tabsReady = !VSCodeService.isElectron || activeWorkspacePath$() !== null`. This adds a dependency on `VSCodeService` (core, an existing chat → core edge).
- **The new behaviour:**
  - A well-formed URL tab id that is not in `tabs()` while the tabs are not ready is held. The URL is left as it is.
  - The effect now also tracks `tabsReady()`. When the tabs become ready, it calls `switchTab(held)` if the id exists. Otherwise it replaces the URL toward the active tab.
  - A malformed id is still corrected at once.
  - If the user selects a tab before the tabs are ready, `activeTabId` differs from its value when the id was held. The held id is then dropped and the URL follows the user's choice.
  - Leaving chat also drops the held id.

### Defect 2: an in-flight correction undoing a newer tab switch

There are two guards. Both mark a landing as stale, and a stale landing is never turned into `switchTab`. Instead it is corrected toward the current active tab, with `replaceUrl`.

1. **The service's own corrections are remembered.** `replaceChatUrl` keeps a token holding the tab id it targets, from the start of the replace until it resolves. `NavigationEnd` is emitted before `navigateByUrl` resolves, so the landing sees the token. A landing on that URL while `activeTabId()` differs is stale.
2. **A tab change the effect skipped is carried into the landing.** When the effect skips because `pendingSurface() !== null` and the active tab changed, it sets a flag. The next `NavigationEnd` consumes it and treats that landing as stale, so the user's switch is not lost.
   - The tab change applied by the first workspace load (the not-ready to ready edge) is excluded. Without that exclusion, a boot deep link settling across the workspace load would be discarded.

### New specs (23 tests in total, up from 16)

- **Boot (Electron, `activeWorkspacePath$` null):**
  - `/chat/B` settles and is held. Then `switchWorkspace` loads `[A, B]` with A active. The result is `switchTab(B)` exactly once, B active, the URL `/chat/B`, and `settledUrls === ['/chat/B']`. No correction was ever settled, and therefore none was persisted.
  - The held id is absent from the loaded workspace → corrected to the workspace's active tab.
  - A malformed id is corrected at once.
  - The user picks a tab before the load → the held id is dropped, and B is never selected.
  - VS Code (not Electron, path null) → an unknown id is corrected immediately.
- **Race:** bare `/chat` starts the replace to `/chat/A`. On its `NavigationStart`, the user switches to B. The result is `switchTab` calls `[[B]]` only, B active, and the URL `/chat/B`. This runs in two variants:
  - effects not flushed while pending, which exercises guard 1;
  - effects flushed with `TestBed.tick()` while pending, which exercises the effect's skip-and-carry path (guard 2).
- No routed spec hung, so no `whenStable` workaround was needed.

### Residual risks

- **Electron with no workspace folders.** `switchWorkspace` never runs, so a held, well-formed but unknown id stays in the URL, and is persisted, until the user picks a tab or opens a folder. It is valid-format and harmless.
  - The precise fix is a "layout sync finished" signal on `ElectronLayoutService` (core). That would push the batch past 6 files and into another library, so it is not done here.
- **A cancelled or failed navigation emits no `NavigationEnd`.** A flag set during it is consumed by the next settle, not immediately, and the URL catches up on the next settle or tab change. The plan already accepts this ("the next settle re-reconciles").
- **The review's correction on the duplicate-history risk is accepted.** `AppStateManager.setCurrentView` returns early when chat is already current and idle (`app-state.service.ts:995-1005`), so the ordinary reselect path does not push. Only the unowned or pending edge can still issue a bare `/chat`.

### Verification (revise round 1)

The commands were run one at a time, with `--skip-nx-cache` on the Nx runs so that the results reflect the revised code. Each Nx header named exactly one project.

1. `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/chat-tab-route-sync.service.spec.ts --coverage=false --maxWorkers=2`: `Test Suites: 1 passed, 1 total`, `Tests: 23 passed, 23 total`.
2. `npx nx run-many -t test,typecheck,lint -p @ptah-extension/chat --parallel=1 --skip-nx-cache`: "Running targets test, typecheck, lint for project @ptah-extension/chat". The result was "Successfully ran targets test, typecheck, lint for project @ptah-extension/chat". No FAIL, `error TS` or lint error lines. The Nx output did not print per-suite counts.
3. `npx nx run-many -t test,typecheck,lint -p ptah-extension-webview --parallel=1 --skip-nx-cache`: "Running targets test, typecheck, lint for project ptah-extension-webview". The result was "Successfully ran targets test, typecheck, lint for project ptah-extension-webview". No FAIL, `error TS` or lint error lines.

## Round-2 follow-up (batch4c-review-r2.md, defect 3)

**The defect.** Suppose a `switchTab(C)` runs in the same synchronous turn as the first `switchWorkspace` that applies the tabs, before the effect runs. The effect then cannot tell C from the active tab the load applied. Two things follow:

- The held URL tab would override C (`followActiveTab`, held branch).
- During a pending navigation, the `!becameReady` exemption would suppress the stale flag.

### Evidence: no production path does this

- **The first load (boot, Electron).** It goes `ElectronLayoutService.syncFromBackend`, then `coordinateWorkspaceSwitch` (`electron-layout.service.ts:529-535`), then `WorkspaceCoordinatorService.switchWorkspace`. That method's synchronous fan-out is `workspace-coordinator.service.ts:177-183`:
  - `workspaceScope.switchTo`;
  - `tabManager.switchWorkspace`;
  - `sessionLoader.switchWorkspace` (`session-loader.service.ts:627-651`: session-list signals, then an RPC);
  - `filePicker.switchWorkspace`;
  - two `clearCache` calls;
  - `appState.switchWorkspace`. `app-state.service.ts` has no `TabManagerService` reference outside comments.

  None of them calls `switchTab`, `openSessionTab` or `createTab`. The rest of that method is asynchronous:
  - `livenessReconciler.reconcileRestoredTabs()` (`:189`) is an RPC;
  - the git services wait on `await resolveGitServices()` (`:197`).

- **`TabManagerService.switchWorkspace`** (`tab-manager.service.ts:760-773`) sets `tabs` and `activeTabId` and does nothing else.
- **Every production `switchTab` caller** (a grep that excluded specs) runs on a user event, or after an `await`/RPC:
  - `tab-bar.component.ts:312,379`;
  - `keyboard-shortcuts.service.ts:68,94`;
  - `canvas.store.ts:365` (tile focus);
  - `chat-view.component.ts:851`;
  - `background-agent-tray.component.ts:343`;
  - `session-handover-client.service.ts:72` (a host push);
  - `chat-agent-feedback-sender.service.ts:77`;
  - `message-sender.service.ts:412`;
  - `notification-focus-coordinator.service.ts:56,64` (after `await switchWorkspace` and `await requestCanvasFocus`, and on an already-loaded workspace, not the first load);
  - `AgentSessionAdoptionService`'s workspace effect (after the `chat:agent-sessions` RPC).

### What I did: option (b)

- **Why not option (a).** It needs the active id that the load applied. Neither `TabManagerService` nor `TabWorkspacePartitionService` exposes it: the partition's public surface has `activeWorkspacePath$` and `getWorkspaceTabs` (tabs only), and its stored `activeTabId` is private. Angular signals give the service no synchronous hook at the moment of the load. A correct fix would therefore need a new read-only signal in `@ptah-extension/chat-state` (for example "last loaded active tab id" from `switchWorkspace`). That is outside this batch's files and outside "service only".
- **The comment.** I added an `ASSUMPTION` comment at the exemption in `chat-tab-route-sync.service.ts` (`followActiveTab`, at `becameReady`). It states the assumption, the evidence (`workspace-coordinator.service.ts:177-183`), and why it cannot be checked locally.
- **Follow-up if this ever becomes reachable.** Expose `lastLoadedActiveTabId` from `TabManagerService.switchWorkspace`. Then honour the held id only when `activeTabId() === lastLoadedActiveTabId`, and gate the `!becameReady` exemption the same way.

### Verification

Only the one spec was run (`--maxWorkers=1`; no Nx, per the coordinator):

`npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/chat-tab-route-sync.service.spec.ts --coverage=false --maxWorkers=1`: `Test Suites: 1 passed, 1 total`, `Tests: 23 passed, 23 total`.

The change is a comment only, so behaviour is unchanged.
