# Development Tasks - TASK_2025_208

**Total Tasks**: 14 | **Batches**: 4 | **Status**: 4/4 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- tsyringe `createChildContainer()` confirmed to work with `useFactory` registrations (architect verified in source): VERIFIED
- `SessionMetadataStore` injects `PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE` so child container override scopes metadata: VERIFIED
- Frontend `StreamingHandlerService` routes by session ID, not workspace: VERIFIED
- `ElectronLayoutService` already tracks `_workspaceFolders` and `_activeWorkspaceIndex` signals: VERIFIED
- `session:list` already accepts `workspacePath` param: VERIFIED
- RPC handlers use `workspace:switch`, `workspace:addFolder`, `workspace:removeFolder` methods that don't exist yet on provider: VERIFIED (duck-typed calls in RPC handler)

### Risks Identified

| Risk                                                                              | Severity | Mitigation                                                                   |
| --------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------- |
| Child container `dispose()` may not clean up singleton instances created in child | MEDIUM   | WorkspaceContext tracks all disposable resources explicitly (Task 1.1)       |
| Tab state migration from global `ptah.tabs` localStorage may lose existing tabs   | MEDIUM   | One-time migration reads global key, assigns to initial workspace (Task 3.1) |
| Background workspace tabs not in `_tabs` signal breaks `findTabBySessionId`       | HIGH     | Cross-workspace session lookup must search all workspace tab sets (Task 3.3) |
| Rapid workspace switching causes stale RPC responses applied to wrong workspace   | MEDIUM   | Debounce + switch-ID check discards superseded responses (Task 4.1)          |
| `TOKENS.STORAGE_SERVICE` adapter also needs child container override              | LOW      | Included in workspace-scoped token list for child container (Task 1.1)       |

### Edge Cases to Handle

- [ ] Workspace folder no longer exists on restore -> skip with warning (Task 2.2)
- [ ] Remove active workspace when it's the only one -> return to "no workspace" state (Task 4.3)
- [ ] Streaming active on workspace being closed -> confirmation dialog + abort (Task 4.3)
- [ ] `addFolder()` called with duplicate path -> deduplicate silently (Task 1.2)
- [ ] Switch to already-active workspace -> no-op (Task 1.1)

---

## Batch 1: Backend Foundation COMPLETE

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: None

### Task 1.1: Create WorkspaceContextManager COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\workspace-context-manager.ts` (CREATE)
**Spec Reference**: implementation-plan.md: Component 1 (lines 212-268)
**Pattern to Follow**: `D:\projects\ptah-extension\apps\ptah-electron\src\di\container.ts` (config manager shim pattern at lines 270-326)

**Quality Requirements**:

- `WorkspaceContext` interface: `{ workspacePath, encodedPath, container, stateStorage, createdAt, dispose() }`
- `workspaces: Map<string, WorkspaceContext>` internal state
- `activeWorkspacePath: string | undefined` tracking
- `createWorkspace(path)` creates child container with overrides for: WORKSPACE_STATE_STORAGE, PLATFORM_INFO, CONFIG_MANAGER, STORAGE_SERVICE, SDK_SESSION_METADATA_STORE
- `removeWorkspace(path)` calls dispose() and removes from map
- `switchWorkspace(path)` sets active; creates lazily if not yet initialized; is idempotent (no-op if already active)
- `getActiveContainer()` returns active child container (falls back to root if no active workspace)
- `getContainerForWorkspace(path)` for background operations (streaming)
- `restoreWorkspaces(paths[], activePath)` for startup restoration
- Must not throw if folder doesn't exist on createWorkspace — return error result
- Inject root container, `userDataPath`, and `ElectronWorkspaceProvider`
- Use `encodeWorkspacePath()` pattern from registration.ts (base64url encoding)

**Implementation Details**:

- Import `DependencyContainer` from tsyringe
- Import `PLATFORM_TOKENS` from `@ptah-extension/platform-core`
- Import `TOKENS` from `@ptah-extension/vscode-core`
- Import `SDK_TOKENS` from `@ptah-extension/agent-sdk`
- Import `ElectronStateStorage` from `@ptah-extension/platform-electron`
- Child container override pattern: `childContainer.register(TOKEN, { useValue: newInstance })`
- Config manager shim factory: copy pattern from container.ts lines 274-315, backed by child's WORKSPACE_STATE_STORAGE

---

### Task 1.2: Enhance ElectronWorkspaceProvider with workspace lifecycle methods COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\platform-electron\src\implementations\electron-workspace-provider.ts` (MODIFY)
**Spec Reference**: implementation-plan.md: Component 2 (lines 273-300)
**Pattern to Follow**: Existing `setWorkspaceFolders()` method in same file

**Quality Requirements**:

- Add private `activeFolder: string | undefined` field (separate from `folders[0]`)
- `addFolder(path: string)`: Add to folders array if not duplicate, fire `onDidChangeWorkspaceFolders`
- `removeFolder(path: string)`: Remove from folders array, update activeFolder if removed was active (set to `folders[0]` or undefined), fire event
- `setActiveFolder(path: string)`: Validate path exists in folders array, set activeFolder, fire event
- `getActiveFolder(): string | undefined`: Return activeFolder
- Override `getWorkspaceRoot()` to return `activeFolder ?? folders[0]`
- Events fire synchronously after state update
- Deduplicate paths in addFolder (normalize with path.resolve)

**Validation Notes**:

- The RPC handler currently duck-types these methods — after this task, the handler can use real typed calls

---

### Task 1.3: Create WorkspaceContainerProxy COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\workspace-container-proxy.ts` (CREATE)
**Spec Reference**: implementation-plan.md: Component 4 (lines 329-362)
**Pattern to Follow**: tsyringe `DependencyContainer` interface

**Quality Requirements**:

- Implements subset of `DependencyContainer` interface (at minimum: `resolve<T>(token)`)
- Maintains list of workspace-scoped tokens: WORKSPACE_STATE_STORAGE, PLATFORM_INFO, CONFIG_MANAGER, STORAGE_SERVICE, SDK_SESSION_METADATA_STORE
- `resolve(token)`: If token is workspace-scoped, delegate to `WorkspaceContextManager.getActiveContainer().resolve(token)`; otherwise delegate to root container
- Falls back to root container if no active workspace
- Transparent to consumers — handlers don't know they're using a proxy
- Inject `WorkspaceContextManager` and root `DependencyContainer`

**Implementation Details**:

- Create a Set of workspace-scoped token strings/symbols for fast lookup
- The proxy is NOT a full DependencyContainer implementation — only `resolve()` is needed since it's used by factory-registered handlers

---

### Task 1.4: Register WorkspaceContextManager and WorkspaceContainerProxy in DI container COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\di\container.ts` (MODIFY)
**Spec Reference**: implementation-plan.md: Component 1 files + Component 4 files
**Dependencies**: Task 1.1, Task 1.3

**Quality Requirements**:

- Register WorkspaceContextManager as singleton in root container (after Phase 0 platform registration)
- Register WorkspaceContainerProxy as singleton, injecting WorkspaceContextManager + root container
- Create initial workspace context for the startup workspace folder (if provided)
- Do NOT change existing factory registrations yet (Batch 2 handles RPC wiring)
- Export or make WorkspaceContextManager accessible for main.ts to call restoreWorkspaces()

**Implementation Details**:

- Place registration after Phase 1 (logger + core services) since WorkspaceContextManager needs Logger
- Use `container.register('WORKSPACE_CONTEXT_MANAGER', { useValue: new WorkspaceContextManager(...) })` pattern
- Pass `container` (root), `userDataPath`, and the registered `ElectronWorkspaceProvider` instance

---

**Batch 1 Verification**:

- All 4 files exist at paths
- Build passes: `npx nx build ptah-electron` (or compile step)
- code-logic-reviewer approved
- WorkspaceContextManager can create/remove/switch workspace contexts
- ElectronWorkspaceProvider has all 4 new methods
- WorkspaceContainerProxy resolves workspace-scoped tokens from active child container

---

## Batch 2: Backend Integration COMPLETE

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 1

### Task 2.1: Wire WorkspaceContextManager into ElectronWorkspaceRpcHandlers COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\electron-workspace-rpc.handlers.ts` (MODIFY)
**Spec Reference**: implementation-plan.md: Component 3 (lines 303-326)
**Pattern to Follow**: Existing RPC handler registration pattern in same file

**Quality Requirements**:

- Inject WorkspaceContextManager (via constructor DI or container resolution)
- `workspace:addFolder`: After folder picker returns path, call `workspaceContextManager.createWorkspace(path)` then `workspaceProvider.addFolder(path)`
- `workspace:removeFolder`: Call `workspaceContextManager.removeWorkspace(path)` then `workspaceProvider.removeFolder(path)`
- `workspace:switch`: Call `workspaceContextManager.switchWorkspace(path)` then `workspaceProvider.setActiveFolder(path)`. Return workspace metadata: `{ success, path, name, sessionCount? }`
- `workspace:getInfo`: Include `activeFolder` in response
- Remove ALL duck-typing casts — use real typed methods on ElectronWorkspaceProvider
- Failed workspace creation must not leave provider in inconsistent state (create context before adding to provider)
- All operations async-safe

**Validation Notes**:

- Order matters: create context BEFORE adding folder to provider (so if context creation fails, provider stays clean)

---

### Task 2.2: Add workspace restoration to main.ts COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\main.ts` (MODIFY)
**Spec Reference**: implementation-plan.md: Component 8 backend portion (lines 452-478)
**Dependencies**: Task 1.4

**Quality Requirements**:

- After DI container initialization, read persisted workspace list from global state storage (PLATFORM_TOKENS.STATE_STORAGE)
- Persist workspace list under key `ptah.workspaces` as `{ folders: string[], activeIndex: number }`
- On startup: if persisted workspaces exist, call `workspaceContextManager.restoreWorkspaces(folders, activeFolder)`
- Only eagerly initialize the active workspace; others are lazy (created on first switch)
- Validate each persisted path exists on filesystem (use `fs.existsSync`); skip stale paths with logger warning
- If CLI arg provides a workspace path, it takes priority (add to list if not present, make it active)
- Persist updated workspace list whenever workspaces change (listen to WorkspaceProvider events)

**Edge Cases**:

- No persisted workspaces + no CLI arg = no workspace state (app opens with "no workspace" prompt)
- Persisted path deleted from disk = skip with warning, don't crash

---

### Task 2.3: Add workspace list persistence on change COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\main.ts` (MODIFY — same file as 2.2, different concern)
**Spec Reference**: implementation-plan.md: Component 8
**Dependencies**: Task 2.2

**Quality Requirements**:

- Subscribe to `ElectronWorkspaceProvider.onDidChangeWorkspaceFolders` event
- On every folder change: persist current folders list + active folder index to global state storage under `ptah.workspaces`
- Debounce persistence writes (500ms) to avoid rapid writes during bulk operations
- This ensures workspace list survives app restart

---

**Batch 2 Verification**:

- All modified files compile
- Build passes
- code-logic-reviewer approved
- `workspace:switch` RPC creates child container and switches active workspace
- `workspace:addFolder` creates new workspace context + adds to provider
- `workspace:removeFolder` disposes context + removes from provider
- Workspace list persisted to global state on change
- Workspace contexts restored from persisted state on app launch

---

## Batch 3: Frontend State Partitioning COMPLETE

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 2

### Task 3.1: Partition TabManagerService state by workspace COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tab-manager.service.ts` (MODIFY)
**Spec Reference**: implementation-plan.md: Component 5 (lines 365-391)
**Pattern to Follow**: Existing signal-based state in same file

**Quality Requirements**:

- Add `_workspaceTabSets: Map<string, { tabs: TabState[], activeTabId: string | null }>` internal map
- Add `_activeWorkspacePath: string` field (set via `switchWorkspace()` method)
- `switchWorkspace(workspacePath: string)`: save current tabs/activeTabId to map for old workspace, load target workspace's tab set into `_tabs` and `_activeTabId` signals
- Change localStorage persistence key from `ptah.tabs` (or `ptah.tabs.{panelId}`) to `ptah.tabs.ws.${encodedWorkspacePath}` (or `ptah.tabs.ws.${encodedWorkspacePath}.{panelId}`)
- One-time migration: on first call to `switchWorkspace()`, if global `ptah.tabs` key exists in localStorage, read it, assign to the first workspace, delete global key
- All existing public API (createTab, closeTab, switchTab, etc.) continues to work against the active workspace's tab set
- New tab creation in workspace A must not appear in workspace B
- Must handle "no workspace" state (empty tab set, no persistence)

**Validation Notes**:

- RISK: Tab state migration from global localStorage. Test migration path carefully.
- Background workspace tabs are NOT in `_tabs` signal but ARE in `_workspaceTabSets` map (important for Task 3.3)

---

### Task 3.2: Partition EditorService state by workspace COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor.service.ts` (MODIFY)
**Spec Reference**: implementation-plan.md: Component 6 (lines 393-417)
**Pattern to Follow**: Same internal state map pattern as Task 3.1

**Quality Requirements**:

- Define `EditorState` type: `{ fileTree: FileTreeNode[], activeFilePath?: string, activeFileContent: string, scrollPosition?: number, cursorPosition?: { line: number, column: number } }`
- Add `_workspaceEditorState: Map<string, EditorState>` internal map
- Add `_activeWorkspacePath: string` field
- `switchWorkspace(workspacePath: string)`: save current editor state to map, load target workspace's state into signals. If target has no cached state, set signals to empty/defaults and trigger `loadFileTree()` reload
- Track scroll/cursor position in state (add to save/restore)
- Clear state from map when workspace is removed: `removeWorkspaceState(workspacePath: string)`
- File tree must reload via `editor:getFileTree` RPC when switching to a workspace not yet cached

---

### Task 3.3: Cross-workspace session lookup for streaming routing COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tab-manager.service.ts` (MODIFY — same file as Task 3.1)
**Spec Reference**: implementation-plan.md: Component 9 (lines 481-506)
**Dependencies**: Task 3.1

**Quality Requirements**:

- `findTabBySessionId(sessionId)` must search across ALL workspace tab sets in `_workspaceTabSets`, not just the active `_tabs` signal
- When a streaming event updates a tab in a background workspace, update the tab state in that workspace's entry in `_workspaceTabSets` (not in `_tabs` signal)
- When user switches to that workspace, the already-updated tab state loads into `_tabs` signal — streamed content appears instantly
- Existing streaming flow (StreamingHandlerService -> findTabBySessionId -> update tab) must not be interrupted
- No duplicate events (existing deduplication handles this already)

**Validation Notes**:

- RISK: If `findTabBySessionId` only searches `_tabs`, background streaming breaks. This task ensures cross-workspace search.

---

**Batch 3 Verification**:

- All modified files compile
- `nx build chat` and `nx build editor` pass (or equivalent)
- code-logic-reviewer approved
- Tabs are isolated per workspace (creating tab in A doesn't appear in B)
- Editor state (file tree, active file) is isolated per workspace
- Streaming events for background workspace update correct tab state
- Tab state persisted per-workspace in localStorage
- One-time migration from global `ptah.tabs` works correctly

---

## Batch 4: Frontend Coordination and Polish COMPLETE

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: Batch 3

### Task 4.1: Workspace switch coordination in ElectronLayoutService COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\electron-layout.service.ts` (MODIFY)
**Spec Reference**: implementation-plan.md: Component 7 (lines 420-449)
**Pattern to Follow**: Existing `switchWorkspace(index)` method in same file

**Quality Requirements**:

- Inject `TabManagerService` and `EditorService` (lazy inject to avoid circular deps if needed)
- After `workspace:switch` RPC response: call `tabManagerService.switchWorkspace(newPath)`, `editorService.switchWorkspace(newPath)`, update `vscodeService` config
- Implement 100ms debounce on `switchWorkspace()` — if called again within 100ms, cancel previous RPC and use new target
- Use a switchId counter — increment on each switch, check before applying RPC response (discard stale responses)
- UI updates (`_activeWorkspaceIndex` signal) should happen immediately (before RPC) for instant perceived switch
- Trigger session list reload after switch (via existing session:list mechanism)
- Trigger file tree reload after switch (via EditorService.loadFileTree)

**Validation Notes**:

- RISK: Rapid switching. Debounce + switchId ensures only final switch takes effect.

---

### Task 4.2: Add workspaceRoot update method to VSCodeService COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\vscode.service.ts` (MODIFY)
**Spec Reference**: implementation-plan.md: Component 7 (line 448)
**Pattern to Follow**: Existing `config()` accessor in VSCodeService

**Quality Requirements**:

- Add `updateWorkspaceRoot(newPath: string)` method
- Updates the `workspaceRoot` and `workspaceName` in the internal config signal/state
- ConversationService, SessionLoaderService, and any other service reading `vscodeService.config().workspaceRoot` must see the new value after this call
- Must not require re-initialization of consuming services

**Implementation Details**:

- Examine how `config()` is currently exposed (signal or getter) and add mutation path
- workspaceName derived from path: `newPath.split(/[/\\]/).pop() ?? 'Workspace'`

---

### Task 4.3: Workspace close with active streams confirmation COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\electron-layout.service.ts` (MODIFY — same as 4.1)
**Spec Reference**: implementation-plan.md: Component 10 (lines 509-532)
**Dependencies**: Task 4.1

**Quality Requirements**:

- Before `removeFolder()` sends RPC, check if the workspace being removed has streaming tabs
- Use `TabManagerService` to check: iterate target workspace's tab set for tabs with `status === 'streaming'`
- If streaming tabs exist: show confirmation dialog (inject/use ConfirmationDialogService)
- On confirm: send `chat:stop` RPC for each streaming session ID, then proceed with removal
- On cancel: no-op (don't remove)
- If no streaming tabs: proceed directly without confirmation
- After removal: call `tabManagerService.removeWorkspaceState(path)` and `editorService.removeWorkspaceState(path)` to clean up
- Handle edge case: removing the only workspace -> reset to "no workspace" empty state

---

### Task 4.4: Send initial workspace:switch RPC on renderer load COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\electron-layout.service.ts` (MODIFY — same file)
**Spec Reference**: implementation-plan.md: Component 8 frontend portion (lines 466-467)
**Dependencies**: Task 4.1

**Quality Requirements**:

- On `restoreLayout()` (called when renderer loads), after restoring workspace folders from webview state, send `workspace:switch` RPC for the restored active workspace
- This ensures backend activates the correct child container on app restart
- Must handle case where restored layout has no workspaces (skip RPC)
- Must handle case where active workspace index is stale (clamp to valid range)

---

**Batch 4 Verification**:

- All modified files compile
- `nx build core` passes
- code-logic-reviewer approved
- Workspace switch coordinates across all services (tabs swap, editor swaps, file tree reloads, session list reloads)
- Rapid switching only applies final workspace
- VSCodeService.config().workspaceRoot updates on switch
- Workspace close with active streams shows confirmation
- Renderer load sends initial workspace:switch for restored active workspace
- Removing only workspace returns to "no workspace" state

---

## Summary

| Batch | Name                        | Developer          | Tasks | Status   |
| ----- | --------------------------- | ------------------ | ----- | -------- |
| 1     | Backend Foundation          | backend-developer  | 4     | COMPLETE |
| 2     | Backend Integration         | backend-developer  | 3     | COMPLETE |
| 3     | Frontend State Partitioning | frontend-developer | 3     | COMPLETE |
| 4     | Frontend Coordination       | frontend-developer | 4     | COMPLETE |
