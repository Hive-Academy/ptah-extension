# Development Tasks - TASK_2025_208 (Cleanup Phase)

**Total Tasks**: 6 | **Batches**: 2 | **Status**: 0/2 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- `fs.existsSync` calls in workspace-context-manager.ts confirmed at lines 57, 139: both are in sync methods that need to become async
- Rollback bug in electron-layout.service.ts confirmed: `previousIndex` captured at line 397 inside `coordinateWorkspaceSwitch()`, but `_activeWorkspaceIndex` is already updated at line 309 in `switchWorkspace()` before the debounced call reaches `coordinateWorkspaceSwitch()`. The revert at line 428 sets index back to itself (no-op).
- SessionMetadataStore `enqueueWrite()` pattern confirmed at lines 384-391. Only `addStats()` (line 200) and `addCliSession()` (line 229) use it. Methods `save()`, `delete()`, `touch()`, `create()`, `createChild()`, `rename()` all do unserialized read-modify-write.
- TabManagerService workspace methods confirmed present and extractable. Service is 1,171 lines with clear workspace-partitioning responsibilities separate from core tab CRUD.

### Risks Identified

| Risk                                                                                                                                                                            | Severity | Mitigation                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| Making `createWorkspace` async changes its return type and callers                                                                                                              | MED      | Task 5.1 must update `switchWorkspace()` and `restoreWorkspaces()` which call `createWorkspace()`              |
| `save()` is called by `touch()`, `create()`, `createChild()`, `rename()` -- wrapping all callers in `enqueueWrite()` means `save()` itself should NOT be wrapped (double-queue) | MED      | Task 5.3 must wrap the outer methods, not `save()` directly, OR wrap only `save()` and leave callers unwrapped |
| TabWorkspacePartitionService extraction must preserve cross-workspace updateTab behavior                                                                                        | LOW      | Task 6.2 must ensure `updateTab()` delegates cross-workspace lookups correctly                                 |

### Edge Cases to Handle

- [ ] `restoreWorkspaces()` iterates paths and calls `createWorkspace()` -- after making async, must await each or use Promise.allSettled --> Task 5.1
- [ ] `switchWorkspace()` calls `createWorkspace()` lazily -- must become async too --> Task 5.1
- [ ] `previousIndex` in `debouncedWorkspaceSwitch` closure must be captured before `_activeWorkspaceIndex.set()` in `switchWorkspace()` --> Task 5.2
- [ ] `touch()` calls `save()` which does read-modify-write -- if both are enqueued separately, double serialization. Solution: wrap `save()` + `delete()` in enqueueWrite, and `touch()`/`create()`/`createChild()`/`rename()` naturally serialize through `save()` --> Task 5.3

---

## Batch 5: Quick Fixes -- PENDING

**Developer**: backend-developer + frontend-developer (parallel)
**Tasks**: 3 | **Dependencies**: None

### Task 5.1: Replace fs.existsSync with async fs.promises.access in workspace-context-manager.ts -- IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\workspace-context-manager.ts`
**Spec Reference**: Code review finding - sync filesystem calls block event loop

**Quality Requirements**:

- All `fs.existsSync` calls replaced with async equivalent
- Methods that call existsSync must become async
- Callers of changed methods must be updated for async signatures
- No behavioral changes beyond sync-to-async conversion

**Implementation Details**:

- Line 57: `fs.existsSync(normalizedPath)` in `createWorkspace()` -- method returns a union type, must become `async createWorkspace()` returning `Promise<...>`
- Line 139: `fs.existsSync(normalizedPath)` in `restoreWorkspaces()` -- method must become `async restoreWorkspaces()` returning `Promise<void>`
- Replace pattern: `fs.existsSync(path)` --> `await fs.promises.access(path).then(() => true).catch(() => false)`
- `switchWorkspace()` calls `createWorkspace()` at line 97, must become async and await the result
- Update callers: check `workspace-context-manager.ts` usages across the codebase for any code that calls these methods synchronously
- Remove `import * as fs from 'fs'` if no other fs usage remains, or keep for `fs.promises`

---

### Task 5.2: Fix rollback index bug in electron-layout.service.ts -- PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\electron-layout.service.ts`
**Spec Reference**: Code review finding - rollback is a no-op

**Quality Requirements**:

- `previousIndex` must be captured BEFORE `_activeWorkspaceIndex` is updated
- The rollback in `coordinateWorkspaceSwitch` error handler must actually revert to the old workspace
- No changes to the public API or debounce behavior

**Implementation Details**:

- Bug location: `switchWorkspace()` (line 301) sets `_activeWorkspaceIndex` at line 309, then calls `debouncedWorkspaceSwitch()` at line 314
- `debouncedWorkspaceSwitch()` eventually calls `coordinateWorkspaceSwitch()` which captures `previousIndex` at line 397 -- but the index was already changed
- Fix approach:
  1. In `switchWorkspace()`, capture `const previousIndex = this._activeWorkspaceIndex()` BEFORE `this._activeWorkspaceIndex.set(index)` at line 309
  2. Pass `previousIndex` through to `debouncedWorkspaceSwitch(folder.path, previousIndex)`
  3. Pass `previousIndex` through to `coordinateWorkspaceSwitch(newPath, previousIndex)`
  4. In `coordinateWorkspaceSwitch`, use the passed-in `previousIndex` parameter instead of reading `this._activeWorkspaceIndex()`
  5. Update `removeFolder()` call to `coordinateWorkspaceSwitch` at line 278 -- pass current index as previousIndex (or handle the no-rollback case for removal)
  6. Update `restoreLayout()` call at line 575 -- pass restored index as previousIndex

**Validation Notes**:

- `coordinateWorkspaceSwitch` is called from 3 places: `debouncedWorkspaceSwitch`, `removeFolder`, `restoreLayout`
- Each call site needs appropriate previousIndex value
- For `removeFolder` the folder is already removed so rollback target may not exist -- consider passing `this._activeWorkspaceIndex()` (current) since there's nowhere to roll back to
- For `restoreLayout` the index was just restored, rollback to 0 is reasonable

---

### Task 5.3: Extend enqueueWrite() serialization to save() and delete() in SessionMetadataStore -- IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\session-metadata-store.ts`
**Spec Reference**: Code review finding - unserialized read-modify-write race conditions

**Quality Requirements**:

- All read-modify-write operations must be serialized through `enqueueWrite()`
- No double-serialization (methods that call `save()` internally should not ALSO be wrapped)
- Existing `addStats()` and `addCliSession()` behavior unchanged
- No changes to public API signatures

**Implementation Details**:

- Strategy: Wrap `save()` and `delete()` in `enqueueWrite()` since they are the two methods that directly call `this.storage.update()`
- `save()` (line 116): Wrap the entire body in `enqueueWrite()`, change return to `Promise<void>` (already is)
- `delete()` (line 270): Wrap the entire body in `enqueueWrite()`
- `touch()`, `create()`, `createChild()`, `rename()` all call `save()` internally -- they will automatically serialize through `save()`'s queue
- `addStats()` and `addCliSession()` already use `enqueueWrite()` and call `save()` internally -- after wrapping `save()`, these will double-queue. Fix: have `addStats()`/`addCliSession()` call an INTERNAL `_saveInternal()` (unwrapped) method, while public `save()` wraps `_saveInternal()` in `enqueueWrite()`
- Alternative simpler approach: Rename current `save()` to `_saveUnserialized()` (private), create new `save()` that wraps it in `enqueueWrite()`, have `addStats()`/`addCliSession()` call `_saveUnserialized()` directly since they already enqueue their own write
- `getAll()` and `get()` are read-only, no serialization needed

**Edge Cases**:

- Concurrent `create()` + `addStats()` for same session: `create()` calls `save()` (enqueued), `addStats()` calls `enqueueWrite()` then `_saveUnserialized()` -- properly serialized
- `delete()` + `save()` race: both enqueued, executed in order -- correct behavior

---

**Batch 5 Verification**:

- All files exist at specified paths
- Build passes: `npx nx build agent-sdk` and `npx nx build core`
- code-logic-reviewer approved
- Edge cases from validation handled
- Callers of changed async methods updated

---

## Batch 6: TabManagerService Extraction -- PENDING

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 5 complete (no hard dependency, but sequential for review flow)

### Task 6.1: Create TabWorkspacePartitionService with extracted workspace logic -- PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tab-workspace-partition.service.ts` (NEW)
**Source**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tab-manager.service.ts`
**Pattern to Follow**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\electron-layout.service.ts` (signal-based service pattern)

**Quality Requirements**:

- New service is `@Injectable({ providedIn: 'root' })` singleton
- All extracted state and methods maintain identical behavior
- Public methods preserve same signatures
- Service ~350 lines

**Implementation Details**:

- Create `TabWorkspacePartitionService` with these extracted members:
  - **State**: `_workspaceTabSets` Map, `_activeWorkspacePath`, `_backendEncodedPaths` Map, `_sessionToWorkspace` Map, `_backgroundSaveTimers` Map, `_migrationDone` flag
  - **Public methods**: `switchWorkspace()`, `getWorkspaceTabs()`, `removeWorkspaceState()`, `setBackendEncodedPath()`, `findTabBySessionIdAcrossWorkspaces()`
  - **Private methods**: `_encodeWorkspacePath()`, `_migrateGlobalTabState()`, `_saveWorkspaceTabsToStorage()`, `_debouncedBackgroundSave()`, `_populateSessionIndex()`
- Import `WorkspaceTabSet` interface (move from tab-manager) and `TabLookupResult` export type
- Import `TabState` from `./chat.types`
- The service needs access to VSCodeService (for localStorage persistence via setState/getState) -- inject it
- `_migrateGlobalTabState` reads the global 'ptah.tabs' key and writes per-workspace key
- `_saveWorkspaceTabsToStorage` and `_debouncedBackgroundSave` write to per-workspace localStorage keys
- `switchWorkspace()` must accept a callback or return the loaded tab set so TabManagerService can update its `_tabs` signal
- `findTabBySessionIdAcrossWorkspaces()` returns `TabLookupResult | null` using `_sessionToWorkspace` reverse index
- Export the new service from `D:\projects\ptah-extension\libs\frontend\chat\src\index.ts`

---

### Task 6.2: Refactor TabManagerService to delegate workspace operations to TabWorkspacePartitionService -- PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tab-manager.service.ts`
**Dependencies**: Task 6.1

**Quality Requirements**:

- All existing public API signatures unchanged
- TabManagerService drops to ~800 lines
- All workspace delegation is clean (no duplicated logic)
- Cross-workspace tab updates still work via delegation

**Implementation Details**:

- Inject `TabWorkspacePartitionService` via `inject()`
- Remove extracted state: `_workspaceTabSets`, `_activeWorkspacePath`, `_backendEncodedPaths`, `_sessionToWorkspace`, `_backgroundSaveTimers`, `_migrationDone`
- Remove extracted methods: `switchWorkspace()` body, `getWorkspaceTabs()` body, `removeWorkspaceState()` body, `setBackendEncodedPath()` body, `findTabBySessionIdAcrossWorkspaces()` body, `_encodeWorkspacePath()`, `_migrateGlobalTabState()`, `_saveWorkspaceTabsToStorage()`, `_debouncedBackgroundSave()`, `_populateSessionIndex()`
- Replace with delegation calls:
  - `switchWorkspace(path)` --> calls `this.partitionService.switchWorkspace(path)`, then updates `_tabs` and `_activeTabId` signals from returned tab set
  - `getWorkspaceTabs(path)` --> `this.partitionService.getWorkspaceTabs(path)`
  - `removeWorkspaceState(path)` --> `this.partitionService.removeWorkspaceState(path)`
  - `setBackendEncodedPath(path, encoded)` --> `this.partitionService.setBackendEncodedPath(path, encoded)`
  - `findTabBySessionIdAcrossWorkspaces(sessionId)` --> `this.partitionService.findTabBySessionIdAcrossWorkspaces(sessionId)`
- Update `findTabBySessionId()` to delegate cross-workspace lookup
- Update `updateTab()` to delegate background workspace tab persistence via partition service
- Update `createTab()`, `closeTab()`, etc. to register/unregister sessions in partition service's `_sessionToWorkspace` index
- Keep `WorkspaceTabSet` interface in tab-workspace-partition.service.ts, remove from tab-manager.service.ts
- Keep `TabLookupResult` export type accessible (re-export from index.ts if needed)

---

**Batch 6 Verification**:

- Both files exist at paths
- Build passes: `npx nx build chat`
- code-logic-reviewer approved
- TabManagerService public API unchanged
- Cross-workspace streaming routing still works
- Tab persistence per workspace still works
