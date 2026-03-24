# Implementation Plan - TASK_2025_208: Multi-Workspace Isolation for Electron App

## Codebase Investigation Summary

### Key Findings

#### 1. tsyringe Child Container Behavior (CRITICAL)

**Finding**: tsyringe `createChildContainer()` exists and creates a new `InternalDependencyContainer` with the parent as a fallback. Child containers:

- Inherit all parent registrations (resolved via parent chain lookup)
- Only copy `ContainerScoped` registrations with fresh instances
- `useFactory` registrations ARE inherited — the factory function receives the **child container** as `c` parameter when resolved from the child
- `useValue` registrations ARE inherited — they resolve to the parent's value unless overridden in the child

**Evidence**: `node_modules/tsyringe/dist/esm2015/dependency-container.js:223-233`

**Verdict**: tsyringe child containers WILL work for this use case. We can create a child container per workspace, override workspace-scoped tokens (WORKSPACE_STATE_STORAGE, CONFIG_MANAGER, WORKSPACE_PROVIDER workspace root), and let all other services resolve from parent. Factory registrations that call `c.resolve(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE)` will automatically get the child container's override.

#### 2. Current DI Container Structure

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\di\container.ts`

The container is set up once with a single workspace path. Key workspace-sensitive tokens:

- `PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE` — `ElectronStateStorage` at `${userDataPath}/workspace-storage/${encodedPath}/` (line 109-114 of registration.ts)
- `PLATFORM_TOKENS.PLATFORM_INFO` — contains `workspaceStoragePath` (line 85-93 of registration.ts)
- `TOKENS.CONFIG_MANAGER` — config shim backed by WORKSPACE_STATE_STORAGE (line 271-326 of container.ts)
- `TOKENS.STORAGE_SERVICE` — adapter wrapping WORKSPACE_STATE_STORAGE (line 418-430 of container.ts)
- `SDK_TOKENS.SDK_SESSION_METADATA_STORE` — `SessionMetadataStore` injecting WORKSPACE_STATE_STORAGE (session-metadata-store.ts:107)

**App-global tokens** (shared across all workspaces):

- `PLATFORM_TOKENS.STATE_STORAGE` — global state at `${userDataPath}/global-state.json`
- `PLATFORM_TOKENS.SECRET_STORAGE` — encrypted secrets (API keys, shared)
- `TOKENS.LOGGER`, `TOKENS.OUTPUT_MANAGER` — logging infrastructure
- `TOKENS.RPC_HANDLER` — single RPC router (shared)
- `TOKENS.LICENSE_SERVICE`, `TOKENS.AUTH_SECRETS_SERVICE` — license/auth (global)
- `TOKENS.FEATURE_GATE_SERVICE` — feature gating (global)
- `TOKENS.WEBVIEW_MANAGER` — IPC bridge to renderer (single window)
- All platform abstractions: PLATFORM_COMMANDS, PLATFORM_AUTH_PROVIDER, SAVE_DIALOG_PROVIDER, MODEL_DISCOVERY

#### 3. ElectronWorkspaceProvider

**File**: `D:\projects\ptah-extension\libs\backend\platform-electron\src\implementations\electron-workspace-provider.ts`

Current state: Manages `folders: string[]` array, fires `onDidChangeWorkspaceFolders` event, `getWorkspaceRoot()` returns `folders[0]`. Missing: `addFolder()`, `removeFolder()`, `setActiveFolder()` — the RPC handler (workspace-rpc.handlers.ts:71-85) tries to call these via duck-typing but they don't exist.

#### 4. Frontend Architecture

**ElectronLayoutService** (`D:\projects\ptah-extension\libs\frontend\core\src\lib\services\electron-layout.service.ts`):

- Already tracks `_workspaceFolders` signal and `_activeWorkspaceIndex` signal
- `switchWorkspace(index)` sends `workspace:switch` RPC
- `addFolder()` sends `workspace:addFolder` RPC
- `removeFolder(index)` sends `workspace:removeFolder` RPC
- Persists layout via `vscodeService.setState()` (webview state)

**TabManagerService** (`D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tab-manager.service.ts`):

- `providedIn: 'root'` singleton
- Stores tab state in `localStorage` with key `ptah.tabs` (or `ptah.tabs.{panelId}`)
- No workspace awareness — all tabs are global

**EditorService** (`D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor.service.ts`):

- `providedIn: 'root'` singleton
- Manages fileTree, activeFilePath, activeFileContent signals
- No workspace partitioning

**ConversationService** (`D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\conversation.service.ts`):

- Gets `workspacePath` from `vscodeService.config().workspaceRoot` for `chat:start` RPC params
- Sessions are already workspace-scoped at the SDK level

**SessionLoaderService** (`D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts`):

- Uses `workspacePath` from `vscodeService.config().workspaceRoot` for `session:list` RPC

#### 5. Session Metadata Store Scoping

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\session-metadata-store.ts`

SessionMetadataStore injects `PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE`. Each workspace's state storage is a different `ElectronStateStorage` instance pointing to a different filesystem path. So session metadata is ALREADY scoped to workspace IF we give each workspace its own WORKSPACE_STATE_STORAGE. The `getForWorkspace(workspaceId)` method provides an additional workspace filter.

#### 6. RPC Layer

**SessionRpcHandlers** (`D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\session-rpc.handlers.ts`):

- `session:list` takes `workspacePath` param and calls `metadataStore.getForWorkspace(workspacePath)` — already workspace-scoped
- `session:load` validates against metadata store
- `session:delete` uses workspace path from metadata

**ChatRpcHandlers**: `chat:start` receives `workspacePath` in params from frontend

**ElectronWorkspaceRpcHandlers** (`D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\electron-workspace-rpc.handlers.ts`):

- `workspace:switch` tries to call `setActiveFolder()` (doesn't exist yet)
- `workspace:addFolder` opens native folder picker
- `workspace:removeFolder` tries to call `removeFolder()` (doesn't exist yet)

#### 7. Streaming Events Routing

**StreamingHandlerService** routes events by session ID (tab's `claudeSessionId`). It does NOT filter by workspace — any streaming event for any session goes to the matching tab. This already works correctly IF tab state is properly partitioned by workspace (events route to the right tab regardless of active workspace).

---

## Architecture Design

### Design Philosophy

**Chosen Approach**: WorkspaceContextMap pattern with tsyringe child containers

**Rationale**: tsyringe child containers provide natural DI scoping. Each workspace gets a child container that overrides workspace-scoped tokens while inheriting all app-global services. Frontend services remain singletons but internally partition state by active workspace ID using a `Map<workspacePath, WorkspaceState>` pattern.

**Why NOT pure child containers for everything**: The frontend is Angular-based with `providedIn: 'root'` singletons — Angular's DI is separate from tsyringe. Frontend services must use internal state partitioning.

### Architecture Diagram

```
+------------------------------------------------------------------+
|  Electron Main Process                                            |
|                                                                   |
|  +---------------------------+                                    |
|  | Root DI Container (tsyringe)                                   |
|  | (App-Global Services)     |                                    |
|  | - Logger, RPC Handler     |                                    |
|  | - LicenseService          |                                    |
|  | - AuthSecretsService      |                                    |
|  | - SecretStorage (global)  |                                    |
|  | - StateStorage (global)   |                                    |
|  | - WebviewManager          |                                    |
|  +-----|-----------|--------+                                    |
|        |           |                                              |
|  +-----v-----+ +--v--------+  +------------+                     |
|  | Child      | | Child     |  | Child      |                     |
|  | Container  | | Container |  | Container  |                     |
|  | Workspace A| | Workspace B| | Workspace C|                     |
|  | overrides: | | overrides: | | overrides: |                     |
|  | -WORKSPACE | | -WORKSPACE | | -WORKSPACE |                     |
|  |  _STATE_   | |  _STATE_   | |  _STATE_   |                     |
|  |  STORAGE   | |  STORAGE   | |  STORAGE   |                     |
|  | -CONFIG_   | | -CONFIG_   | | -CONFIG_   |                     |
|  |  MANAGER   | |  MANAGER   | |  MANAGER   |                     |
|  | -STORAGE_  | | -STORAGE_  | | -STORAGE_  |                     |
|  |  SERVICE   | |  SERVICE   | |  SERVICE   |                     |
|  | -SESSION_  | | -SESSION_  | | -SESSION_  |                     |
|  |  METADATA  | |  METADATA  | |  METADATA  |                     |
|  |  _STORE    | |  _STORE    | |  _STORE    |                     |
|  +------------+ +------------+ +------------+                     |
|        ^                                                          |
|        | active                                                   |
|  +-----+---------------------------------------------+           |
|  | WorkspaceContextManager                            |           |
|  | - workspaces: Map<path, WorkspaceContext>           |           |
|  | - activeWorkspacePath: string                      |           |
|  | - getActiveContainer(): DependencyContainer        |           |
|  | - createWorkspace(path): WorkspaceContext           |           |
|  | - removeWorkspace(path): void                      |           |
|  | - switchWorkspace(path): void                      |           |
|  +----------------------------------------------------+           |
+------------------------------------------------------------------+

+------------------------------------------------------------------+
|  Renderer Process (Angular)                                       |
|                                                                   |
|  +----------------------------------------------------+           |
|  | ElectronLayoutService (providedIn: 'root')          |           |
|  | - workspaceFolders signal                           |           |
|  | - activeWorkspaceIndex signal                       |           |
|  | - switchWorkspace(index) -> RPC workspace:switch    |           |
|  +----------------------------------------------------+           |
|                                                                   |
|  +----------------------------------------------------+           |
|  | TabManagerService (internal state partitioning)     |           |
|  | - _workspaceTabs: Map<workspacePath, TabState[]>    |           |
|  | - active tabs = _workspaceTabs.get(activeWsPath)    |           |
|  | - on workspace switch: swap tab sets                |           |
|  +----------------------------------------------------+           |
|                                                                   |
|  +----------------------------------------------------+           |
|  | EditorService (internal state partitioning)         |           |
|  | - _workspaceEditorState: Map<path, EditorState>     |           |
|  | - on workspace switch: save current, restore target |           |
|  +----------------------------------------------------+           |
+------------------------------------------------------------------+
```

### Workspace Switch Flow

```
User clicks Workspace B in sidebar
  |
  v
ElectronLayoutService.switchWorkspace(index)
  |
  +--> Update _activeWorkspaceIndex signal (UI updates instantly)
  +--> RPC call: workspace:switch { path: '/projects/B' }
  |
  v
Backend: WorkspaceContextManager.switchWorkspace('/projects/B')
  |
  +--> Set activeWorkspacePath = '/projects/B'
  +--> (Child container for B already exists or is created lazily)
  +--> Resolve needed services from B's child container
  +--> Return { success: true, workspacePath, workspaceName }
  |
  v
Frontend receives RPC response
  |
  +--> TabManagerService: swap to Workspace B's tab set
  +--> EditorService: save A's state, restore B's state
  +--> SessionLoaderService: workspaceRoot now points to B
  +--> File tree reloads via editor:getFileTree RPC
  +--> Session list reloads via session:list RPC
```

---

## Component Specifications

### Component 1: WorkspaceContextManager (Backend)

**Purpose**: Manages the lifecycle of per-workspace DI child containers and tracks the active workspace.

**Pattern**: Singleton service registered in root container, owns a `Map<string, WorkspaceContext>` where each context wraps a tsyringe child container.

**Evidence**:

- tsyringe `createChildContainer()` confirmed at `node_modules/tsyringe/dist/esm2015/dependency-container.js:223`
- `registerPlatformElectronServices()` at `D:\projects\ptah-extension\libs\backend\platform-electron\src\registration.ts:71` shows how workspace-scoped tokens are registered
- `ElectronStateStorage` at `D:\projects\ptah-extension\libs\backend\platform-electron\src\implementations\electron-state-storage.ts:14` — instantiated per-workspace with different paths
- Config manager shim at `D:\projects\ptah-extension\apps\ptah-electron\src\di\container.ts:271-326` — delegates to WORKSPACE_STATE_STORAGE

**Responsibilities**:

- Create child containers for new workspaces with workspace-scoped token overrides
- Maintain active workspace tracking
- Provide `getActiveContainer()` for service resolution
- Provide `getContainerForWorkspace(path)` for background operations
- Dispose child containers on workspace removal (release ElectronStateStorage, file watchers)
- Restore workspaces from persisted layout state on app launch

**WorkspaceContext shape**:

```typescript
interface WorkspaceContext {
  workspacePath: string;
  encodedPath: string;
  container: DependencyContainer; // tsyringe child container
  stateStorage: ElectronStateStorage;
  createdAt: number;
  dispose(): void;
}
```

**Workspace-scoped tokens to override in child container**:

1. `PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE` — new `ElectronStateStorage` at `${userDataPath}/workspace-storage/${encodedPath}/workspace-state.json`
2. `PLATFORM_TOKENS.PLATFORM_INFO` — updated `workspaceStoragePath`
3. `TOKENS.CONFIG_MANAGER` — new config shim backed by the child's WORKSPACE_STATE_STORAGE
4. `TOKENS.STORAGE_SERVICE` — new storage adapter backed by the child's WORKSPACE_STATE_STORAGE
5. `SDK_TOKENS.SDK_SESSION_METADATA_STORE` — new `SessionMetadataStore` instance resolving the child's WORKSPACE_STATE_STORAGE

**App-global tokens inherited from parent (NOT overridden)**:

- TOKENS.LOGGER, TOKENS.RPC_HANDLER, TOKENS.OUTPUT_MANAGER
- TOKENS.LICENSE_SERVICE, TOKENS.AUTH_SECRETS_SERVICE, TOKENS.FEATURE_GATE_SERVICE
- PLATFORM_TOKENS.STATE_STORAGE (global state), PLATFORM_TOKENS.SECRET_STORAGE
- PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, PLATFORM_TOKENS.WORKSPACE_PROVIDER
- TOKENS.WEBVIEW_MANAGER
- All platform abstraction tokens (PLATFORM_COMMANDS, etc.)
- All RPC handler classes (they use the active container for resolution)

**Quality Requirements**:

- `createWorkspace()` must not throw if folder doesn't exist — returns error result
- `removeWorkspace()` must call `dispose()` on the context to prevent memory leaks
- `switchWorkspace()` must be idempotent (switching to already-active workspace is a no-op)
- Must support restoring workspaces from persisted paths at startup

**Files Affected**:

- `D:\projects\ptah-extension\apps\ptah-electron\src\services\workspace-context-manager.ts` (CREATE)
- `D:\projects\ptah-extension\apps\ptah-electron\src\di\container.ts` (MODIFY — register WorkspaceContextManager)
- `D:\projects\ptah-extension\apps\ptah-electron\src\main.ts` (MODIFY — restore workspaces at startup)

---

### Component 2: ElectronWorkspaceProvider Enhancement (Backend)

**Purpose**: Add `addFolder()`, `removeFolder()`, `setActiveFolder()`, `getActiveFolder()` methods to ElectronWorkspaceProvider so the RPC handlers can call them without duck-typing.

**Pattern**: Extend existing class with new methods. Update `IWorkspaceProvider` interface if needed (or add Electron-specific interface extending it).

**Evidence**:

- Current provider at `D:\projects\ptah-extension\libs\backend\platform-electron\src\implementations\electron-workspace-provider.ts`
- RPC handler at `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\electron-workspace-rpc.handlers.ts:71-85` — already tries to call these methods
- `IWorkspaceProvider` at `D:\projects\ptah-extension\libs\backend\platform-core\src\interfaces\workspace-provider.interface.ts` — current interface

**Responsibilities**:

- `addFolder(path: string)`: Add to folders array, fire `onDidChangeWorkspaceFolders`
- `removeFolder(path: string)`: Remove from folders array, fire event
- `setActiveFolder(path: string)`: Set the primary/active workspace, fire event
- `getActiveFolder(): string | undefined`: Return the currently active folder (not just `folders[0]`)
- Track `activeFolder` separately from `folders[0]` (multiple folders, one active)

**Quality Requirements**:

- `addFolder()` must deduplicate (no duplicate paths)
- `removeFolder()` must update activeFolder if the removed folder was active
- `setActiveFolder()` must validate the path exists in folders array
- Events must fire synchronously after state update

**Files Affected**:

- `D:\projects\ptah-extension\libs\backend\platform-electron\src\implementations\electron-workspace-provider.ts` (MODIFY)
- `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\electron-workspace-rpc.handlers.ts` (MODIFY — remove duck-typing, use typed methods)

---

### Component 3: WorkspaceContextManager Integration with RPC (Backend)

**Purpose**: Wire `workspace:switch` RPC to WorkspaceContextManager so backend services resolve from the correct child container when workspace changes. Wire `workspace:addFolder` and `workspace:removeFolder` to create/destroy workspace contexts.

**Pattern**: Modify ElectronWorkspaceRpcHandlers to call WorkspaceContextManager in addition to ElectronWorkspaceProvider.

**Evidence**:

- RPC handler at `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\electron-workspace-rpc.handlers.ts`
- `workspace:switch` currently only calls `setActiveFolder()` — must also switch the active container context

**Responsibilities**:

- `workspace:addFolder`: After folder picker returns, call `workspaceContextManager.createWorkspace(path)`
- `workspace:removeFolder`: Call `workspaceContextManager.removeWorkspace(path)` before removing from provider
- `workspace:switch`: Call `workspaceContextManager.switchWorkspace(path)` to activate the target child container
- `workspace:getInfo`: Include active workspace path in response

**Quality Requirements**:

- `workspace:switch` must return workspace metadata (path, name, sessionCount) for frontend use
- All operations must be async-safe (no race conditions on rapid calls)
- Failed workspace creation must not leave provider in inconsistent state

**Files Affected**:

- `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\electron-workspace-rpc.handlers.ts` (MODIFY)

---

### Component 4: RPC Active Container Resolution (Backend)

**Purpose**: Ensure RPC handlers that need workspace-scoped services resolve them from the active workspace's child container, not the root container.

**Pattern**: Modify services that inject WORKSPACE_STATE_STORAGE or CONFIG_MANAGER to resolve through WorkspaceContextManager. For handlers registered with `useFactory`, the factory receives the container — we need these to use the active workspace's container.

**Evidence**:

- SetupRpcHandlers, WizardGenerationRpcHandlers, EnhancedPromptsRpcHandlers, ElectronEditorRpcHandlers, ElectronConfigExtendedRpcHandlers, LlmRpcHandlers all use `useFactory` with container (`c`) parameter
- SessionRpcHandlers injects `SDK_TOKENS.SDK_SESSION_METADATA_STORE` — needs workspace-scoped metadata store

**Design Decision**: Rather than re-registering all RPC handlers in each child container (expensive, complex), we introduce a `WorkspaceContainerProxy` that wraps the root container. When `resolve()` is called for workspace-scoped tokens, it delegates to the active workspace's child container. For all other tokens, it delegates to the root container.

This proxy is registered as a singleton service and injected where handlers currently receive the raw container.

**Alternative Considered**: Re-registering all handlers in child containers. Rejected because:

- RPC handlers are registered once at startup, not per-workspace
- The RpcHandler (method router) is a singleton — it doesn't know about workspaces
- Handlers need to resolve workspace-scoped dependencies at call time, not at registration time

**Responsibilities**:

- Create `WorkspaceContainerProxy` implementing `DependencyContainer` interface
- Intercept `resolve()` for workspace-scoped tokens, delegate to WorkspaceContextManager.getActiveContainer()
- Pass-through `resolve()` for all other tokens to root container
- Replace raw container injection in factory-registered handlers with proxy

**Quality Requirements**:

- Must be transparent to existing code — handlers don't know they're using a proxy
- Must handle case where no active workspace exists (fall back to root container)
- Must be thread-safe (no concurrent modification issues)

**Files Affected**:

- `D:\projects\ptah-extension\apps\ptah-electron\src\services\workspace-container-proxy.ts` (CREATE)
- `D:\projects\ptah-extension\apps\ptah-electron\src\di\container.ts` (MODIFY — register proxy, use in factory registrations)

---

### Component 5: TabManagerService Workspace Partitioning (Frontend)

**Purpose**: Partition tab state by workspace so each workspace has independent chat tabs.

**Pattern**: Internal state map — the service remains a `providedIn: 'root'` singleton but maintains a `Map<workspacePath, { tabs: TabState[], activeTabId: string | null }>` internally. On workspace switch, it swaps the active tab set.

**Evidence**:

- TabManagerService at `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tab-manager.service.ts`
- Currently uses flat `_tabs` signal and `localStorage` persistence with key `ptah.tabs`
- Task description requirement 3: "Each workspace to have its own set of chat tabs"

**Responsibilities**:

- Add `_workspaceTabSets: Map<string, { tabs: TabState[], activeTabId: string | null }>` internal state
- On workspace switch signal: save current workspace's tab state to map, load target workspace's tab state
- Change localStorage key to `ptah.tabs.ws.${encodedWorkspacePath}` for per-workspace persistence
- Migrate existing global `ptah.tabs` data to the first/initial workspace on first launch
- Expose `switchWorkspace(workspacePath: string)` method called by workspace switch coordination

**Quality Requirements**:

- Workspace switch must preserve in-memory tab state (no re-parse from localStorage)
- Streaming tabs must continue in background workspace (streaming events are session-routed, not workspace-routed)
- Creating a tab in workspace A must not appear in workspace B
- Must handle "no workspace" state (empty tab set)

**Files Affected**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tab-manager.service.ts` (MODIFY)

---

### Component 6: EditorService Workspace Partitioning (Frontend)

**Purpose**: Partition editor state (file tree, active file, scroll position) by workspace.

**Pattern**: Same internal state map pattern as TabManagerService.

**Evidence**:

- EditorService at `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor.service.ts`
- Currently has flat `_fileTree`, `_activeFilePath`, `_activeFileContent` signals

**Responsibilities**:

- Add `_workspaceEditorState: Map<string, EditorState>` where `EditorState = { fileTree, activeFilePath, scrollPosition, cursorPosition }`
- On workspace switch: save current editor state to map, restore target workspace's state
- `loadFileTree()` already calls `editor:getFileTree` RPC which returns workspace-scoped tree (backend handles scoping)
- Add scroll/cursor position tracking to state (if not already tracked)

**Quality Requirements**:

- File tree must reload when switching to a workspace that hasn't been loaded yet
- Active file content must be restored from cache (not re-fetched) for instant switch
- Must clear state cleanly when workspace is removed

**Files Affected**:

- `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor.service.ts` (MODIFY)

---

### Component 7: Workspace Switch Coordination (Frontend)

**Purpose**: Coordinate the workspace switch across all frontend services when `ElectronLayoutService.switchWorkspace()` fires.

**Pattern**: ElectronLayoutService already has `switchWorkspace(index)` that sends RPC. After RPC completes, it needs to notify TabManagerService and EditorService. Use Angular's signal reactivity — services watch `ElectronLayoutService.activeWorkspace` signal via `effect()`.

**Evidence**:

- ElectronLayoutService at `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\electron-layout.service.ts:222-236`
- `activeWorkspace` computed signal already exists (line 59-63)
- ConversationService uses `vscodeService.config().workspaceRoot` — this must be updated on switch

**Responsibilities**:

- Update `VSCodeService.config().workspaceRoot` when workspace switches (so ConversationService, SessionLoaderService get correct path)
- Create a `WorkspaceSwitchCoordinator` service (or add to ElectronLayoutService) that:
  1. Sends `workspace:switch` RPC (already done)
  2. Updates VSCodeService config with new workspaceRoot
  3. Calls `tabManagerService.switchWorkspace(newPath)`
  4. Calls `editorService.switchWorkspace(newPath)`
  5. Triggers session list reload
- Implement debounce (100ms) for rapid switching (requirement: only final switch takes effect)

**Quality Requirements**:

- UI must update within 200ms (swap signals immediately, RPC is background)
- Debounce rapid switches (cancel intermediate RPC calls)
- No flash of stale content (signals must swap atomically)

**Files Affected**:

- `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\electron-layout.service.ts` (MODIFY — add debounce, coordinate services)
- `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\vscode.service.ts` (MODIFY — add workspaceRoot update method)

---

### Component 8: Workspace Persistence and Restore (Backend + Frontend)

**Purpose**: Persist the list of open workspaces and active workspace index so they survive app restart.

**Pattern**: Frontend already persists `workspaceFolders` and `activeWorkspaceIndex` in webview state via `ElectronLayoutService.persistLayout()`. Backend needs to restore workspace contexts from this persisted state on app launch.

**Evidence**:

- ElectronLayoutService persistence at `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\electron-layout.service.ts:244-293`
- main.ts at `D:\projects\ptah-extension\apps\ptah-electron\src\main.ts` — currently parses CLI args for initial workspace

**Responsibilities**:

- Backend: On app launch, read persisted workspace list from global state storage
- Backend: Create WorkspaceContext for each persisted workspace (lazily — only active workspace eagerly)
- Backend: Validate persisted paths exist (skip stale paths with warning)
- Frontend: On renderer load, restore layout from webview state (already works)
- Frontend: Send `workspace:switch` RPC for the restored active workspace

**Quality Requirements**:

- Cold start with 5 workspaces must complete within 3 seconds (lazy initialization)
- Stale workspace paths must be skipped with user notification, not crash
- First workspace should be initialized eagerly, others lazily on first switch

**Files Affected**:

- `D:\projects\ptah-extension\apps\ptah-electron\src\main.ts` (MODIFY — restore workspaces)
- `D:\projects\ptah-extension\apps\ptah-electron\src\services\workspace-context-manager.ts` (handles lazy init)
- `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\electron-layout.service.ts` (MODIFY — send initial switch RPC)

---

### Component 9: Streaming Event Workspace Tagging (Backend)

**Purpose**: Tag streaming events with workspace ID so the frontend can route events to the correct workspace's tab set, even if a different workspace is active.

**Pattern**: The streaming pipeline already routes by session ID (tab → claudeSessionId). Since tabs are now partitioned by workspace, a streaming event for Workspace A's session will find Workspace A's tab in the map even if Workspace B is active. However, the `WebviewManager.postMessage()` sends to the single renderer — the renderer must have all workspace tabs in memory (not just active workspace's tabs).

**Evidence**:

- StreamingHandlerService at `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\streaming-handler.service.ts` — routes by session ID via `tabManager.findTabBySessionId(sessionId)`
- TabManagerService stores all tabs in `_tabs` signal — BUT with workspace partitioning, background workspace tabs won't be in `_tabs`

**Design Decision**: TabManagerService must keep ALL workspace tabs accessible for session lookup (not just active workspace's tabs). The `_tabs` signal shows the active workspace's tabs (for UI), but `findTabBySessionId()` must search across ALL workspaces.

**Responsibilities**:

- TabManagerService: `findTabBySessionId()` must search `_workspaceTabSets` across all workspaces
- Streaming events for background workspaces must update the tab state in the background workspace's tab set
- When user switches back to a workspace, all streamed content is already in the tab state
- No backend changes needed — session ID routing already works; the fix is in frontend tab lookup

**Quality Requirements**:

- Background streaming must not be interrupted by workspace switch
- Streamed content must be visible immediately when switching back
- No duplicate events (existing deduplication handles this)

**Files Affected**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tab-manager.service.ts` (MODIFY — cross-workspace session lookup)

---

### Component 10: Workspace Close with Active Streams (Frontend)

**Purpose**: When closing a workspace with active streaming sessions, prompt user for confirmation and abort streams.

**Pattern**: Add confirmation dialog before workspace removal, similar to existing tab close confirmation.

**Evidence**:

- ConfirmationDialogService used by TabManagerService at `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tab-manager.service.ts:263-275`
- ElectronLayoutService.removeFolder at `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\electron-layout.service.ts:180-220`

**Responsibilities**:

- Before removing workspace, check if any tabs in that workspace have `status === 'streaming'`
- If streaming tabs exist, show confirmation dialog
- On confirm: abort streams (via `chat:stop` RPC for each streaming session), then remove workspace
- On cancel: no-op

**Quality Requirements**:

- Must not leave orphaned streaming sessions
- Must not block other workspaces' operations
- Confirmation must be skippable if no active streams

**Files Affected**:

- `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\electron-layout.service.ts` (MODIFY)

---

## Integration Architecture

### Integration Points

1. **WorkspaceContextManager ← ElectronWorkspaceRpcHandlers**: RPC handlers call manager for create/remove/switch
2. **WorkspaceContainerProxy ← Factory-registered RPC handlers**: Proxy routes resolve() to active child container
3. **ElectronLayoutService → TabManagerService + EditorService**: workspace switch signal triggers state swap
4. **ElectronLayoutService → VSCodeService**: Updates workspaceRoot config on switch
5. **TabManagerService → StreamingHandlerService**: Cross-workspace session lookup for streaming routing

### Data Flow (Workspace Switch)

```
Frontend                              Backend
--------                              -------
User clicks Workspace B
  |
  v
ElectronLayoutService
  .switchWorkspace(1)
  |
  +--> _activeWorkspaceIndex.set(1)      [instant UI update]
  +--> debounce(100ms)
  |
  +--> RPC: workspace:switch -----------> ElectronWorkspaceRpcHandlers
       { path: '/projects/B' }              |
                                            v
                                         WorkspaceContextManager
                                           .switchWorkspace('/projects/B')
                                            |
                                            +--> Create child container if needed
                                            +--> Set activeWorkspacePath
                                            +--> Return metadata
                                            |
  <-- { success, path, name } <-----------+
  |
  v
WorkspaceSwitchCoordinator
  +--> vscodeService.updateWorkspaceRoot('/projects/B')
  +--> tabManagerService.switchWorkspace('/projects/B')
  +--> editorService.switchWorkspace('/projects/B')
  +--> Trigger session:list reload
  +--> Trigger editor:getFileTree reload
```

### Dependencies

**New npm dependencies**: None required

**Internal dependencies**:

- WorkspaceContextManager depends on: tsyringe DependencyContainer, ElectronStateStorage, ElectronWorkspaceProvider
- WorkspaceContainerProxy depends on: WorkspaceContextManager
- All modified frontend services depend on: ElectronLayoutService (for active workspace signal)

---

## Implementation Order (Batched)

### Batch 1: Backend Foundation (No frontend changes, no user-visible behavior change)

**Components**: 1 (WorkspaceContextManager), 2 (ElectronWorkspaceProvider), 4 (WorkspaceContainerProxy)

**Rationale**: These are the core backend building blocks. WorkspaceContextManager creates child containers. WorkspaceContainerProxy ensures existing handlers work through the new workspace-scoped resolution. ElectronWorkspaceProvider gets the missing methods.

**Risk**: Medium — tsyringe child container behavior needs verification with actual factory registrations. Mitigated by: factory registrations receive child container's `c` parameter, and child containers inherit parent registrations.

**Files**:

- CREATE: `D:\projects\ptah-extension\apps\ptah-electron\src\services\workspace-context-manager.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-electron\src\services\workspace-container-proxy.ts`
- MODIFY: `D:\projects\ptah-extension\libs\backend\platform-electron\src\implementations\electron-workspace-provider.ts`
- MODIFY: `D:\projects\ptah-extension\apps\ptah-electron\src\di\container.ts`

### Batch 2: Backend Integration (RPC wiring, workspace lifecycle)

**Components**: 3 (RPC Integration), 8 (Persistence/Restore — backend portion)

**Rationale**: Wire the WorkspaceContextManager into RPC handlers so workspace:switch actually creates/activates child containers. Add workspace restoration at app launch.

**Risk**: Low-Medium — RPC handlers are well-structured, changes are additive.

**Files**:

- MODIFY: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\electron-workspace-rpc.handlers.ts`
- MODIFY: `D:\projects\ptah-extension\apps\ptah-electron\src\main.ts`

### Batch 3: Frontend State Partitioning

**Components**: 5 (TabManagerService), 6 (EditorService), 9 (Streaming routing)

**Rationale**: Refactor frontend singletons to partition state by workspace. This is the largest change surface but each service is independent.

**Risk**: Medium-High — TabManagerService is complex (616 lines) with many consumers. Streaming routing changes must preserve existing behavior. Mitigated by: internal state map is additive, existing API surface unchanged.

**Files**:

- MODIFY: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tab-manager.service.ts`
- MODIFY: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor.service.ts`

### Batch 4: Frontend Coordination and Polish

**Components**: 7 (Workspace Switch Coordination), 8 (Persistence — frontend portion), 10 (Workspace Close with Streams)

**Rationale**: Wire everything together — coordinate the switch signal across services, handle persistence, add UX polish (confirmation dialogs, debounce).

**Risk**: Low-Medium — coordination is orchestration logic, not new functionality.

**Files**:

- MODIFY: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\electron-layout.service.ts`
- MODIFY: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\vscode.service.ts`

---

## Risk Assessment

### Batch 1 Risks

| Risk                                                                    | Probability | Impact   | Mitigation                                                                                                                              |
| ----------------------------------------------------------------------- | ----------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| tsyringe child container doesn't properly inherit factory registrations | Low         | High     | Verified in source code — factory `c` parameter is the resolving container. Write integration test early.                               |
| SessionMetadataStore in child container reads wrong storage             | Low         | Critical | Each child overrides WORKSPACE_STATE_STORAGE — SessionMetadataStore constructor injection picks up the override. Verify with unit test. |
| Child container dispose doesn't clean up singleton instances            | Medium      | Medium   | Explicitly track disposable resources in WorkspaceContext. Call dispose() on removal.                                                   |

### Batch 2 Risks

| Risk                                                            | Probability | Impact | Mitigation                                                                                  |
| --------------------------------------------------------------- | ----------- | ------ | ------------------------------------------------------------------------------------------- |
| Workspace restoration on startup causes slow launch             | Low         | Medium | Lazy initialization — only active workspace is eagerly initialized. Others on first switch. |
| Race condition between workspace:switch and workspace:addFolder | Low         | Medium | WorkspaceContextManager serializes operations via async mutex or queue.                     |

### Batch 3 Risks

| Risk                                                               | Probability | Impact   | Mitigation                                                                                                               |
| ------------------------------------------------------------------ | ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| Tab state migration from global localStorage breaks existing tabs  | Medium      | High     | One-time migration: read global `ptah.tabs`, assign to initial workspace, delete global key. Test migration path.        |
| Streaming events lost during workspace switch                      | Low         | Critical | Streaming routes by session ID — all workspace tabs remain in memory for lookup. Explicit test for background streaming. |
| EditorService file tree cache grows unbounded with many workspaces | Low         | Low      | Limit cache to N workspaces (e.g., 10), evict LRU. Each idle workspace < 15MB budget.                                    |

### Batch 4 Risks

| Risk                                                              | Probability | Impact | Mitigation                                                                          |
| ----------------------------------------------------------------- | ----------- | ------ | ----------------------------------------------------------------------------------- |
| Rapid workspace switching causes stale RPC responses              | Medium      | Medium | Debounce (100ms) + switch-ID check — discard RPC responses for superseded switches. |
| Workspace close with streaming abort leaves sessions in bad state | Low         | Medium | Send `chat:stop` RPC per session, wait for confirmation, then remove workspace.     |

---

## Quality Requirements (Architecture-Level)

### Functional Requirements

- Zero cross-workspace data leakage (chat, sessions, editor state, config)
- Workspace switch within 200ms perceived latency (UI), 500ms backend re-bind
- Background streaming continues during workspace switch
- Workspace list persists across app restart
- Stale workspace paths handled gracefully (skip with notification)

### Non-Functional Requirements

- **Memory**: < 15MB per idle workspace context (child container + cached state)
- **Concurrency**: Support 10+ simultaneous workspaces without degradation
- **Cold start**: 5 previously-open workspaces restored in < 3 seconds
- **Crash recovery**: All workspace contexts restorable from persisted state

### Pattern Compliance

- tsyringe child container pattern for backend DI scoping
- Internal state map pattern for frontend singleton services (preserves Angular `providedIn: 'root'`)
- Signal-based reactivity for all frontend state changes (Angular 20+ pattern per `D:\projects\ptah-extension\libs\frontend\core\CLAUDE.md`)
- RPC-based communication between frontend and backend (existing pattern)

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: Full-stack (backend-developer + frontend-developer)

**Rationale**:

- Batch 1-2 are pure backend (tsyringe DI, Node.js filesystem, Electron IPC) — backend developer
- Batch 3-4 are pure frontend (Angular signals, services, localStorage) — frontend developer
- These can be parallelized if two developers are available
- Alternatively, one full-stack developer handles all batches sequentially

### Complexity Assessment

**Complexity**: HIGH
**Estimated Effort**: 16-24 hours

**Breakdown**:

- Batch 1 (Backend Foundation): 5-7 hours
- Batch 2 (Backend Integration): 3-4 hours
- Batch 3 (Frontend Partitioning): 5-8 hours (TabManagerService is complex)
- Batch 4 (Frontend Coordination): 3-5 hours

### Files Affected Summary

**CREATE**:

- `D:\projects\ptah-extension\apps\ptah-electron\src\services\workspace-context-manager.ts`
- `D:\projects\ptah-extension\apps\ptah-electron\src\services\workspace-container-proxy.ts`

**MODIFY**:

- `D:\projects\ptah-extension\apps\ptah-electron\src\di\container.ts`
- `D:\projects\ptah-extension\apps\ptah-electron\src\main.ts`
- `D:\projects\ptah-extension\libs\backend\platform-electron\src\implementations\electron-workspace-provider.ts`
- `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\electron-workspace-rpc.handlers.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tab-manager.service.ts`
- `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor.service.ts`
- `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\electron-layout.service.ts`
- `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\vscode.service.ts`

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **tsyringe child container with useFactory**: Write a quick integration test that creates a child container, overrides a token, and resolves a factory-registered service — verify the factory receives the child container.

2. **All workspace-scoped tokens identified**: Cross-reference the tokens overridden in child containers against ALL services that inject WORKSPACE_STATE_STORAGE or CONFIG_MANAGER. Any missed token = potential data leakage.

3. **SessionMetadataStore re-instantiation**: Verify that creating a new SessionMetadataStore in the child container (with the child's WORKSPACE_STATE_STORAGE) correctly isolates session metadata. The parent's SessionMetadataStore must not be used for workspace-scoped operations.

4. **Tab state migration**: Test the one-time migration from global `ptah.tabs` localStorage to per-workspace keys. Existing users must not lose their tabs.

5. **Streaming in background workspace**: Test that starting a stream in Workspace A, switching to Workspace B, and switching back to A shows all streamed content.

### Architecture Delivery Checklist

- [x] All 10 components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/tokens verified as existing
- [x] Quality requirements defined (functional + non-functional)
- [x] Integration points documented
- [x] Files affected list complete (2 CREATE, 8 MODIFY)
- [x] Developer type recommended (full-stack or backend+frontend pair)
- [x] Complexity assessed (HIGH, 16-24 hours)
- [x] 4-batch implementation order with dependencies
- [x] Risk assessment per batch
- [x] No step-by-step implementation (team-leader decomposes into atomic tasks)
