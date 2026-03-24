# Development Tasks - TASK_2025_202

**Total Tasks**: 9 | **Batches**: 3 | **Status**: 3/3 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- SubagentRegistryService API: Confirmed `get()`, `getResumable()`, `getResumableBySession()` are correct methods; code uses wrong names (`getSubagent`, `getResumableSubagents`)
- IStateStorage interface: Confirmed `get<T>(key)` and `update(key, value)` available in platform-core
- PLATFORM_TOKENS: Confirmed `STATE_STORAGE`, `WORKSPACE_STATE_STORAGE`, `WORKSPACE_PROVIDER` exist
- electron-updater: Confirmed installed (6.8.3) in package.json
- Issue 4 (IPC broadcastMessage): VERIFIED WORKING -- no fix needed

### Risks Identified

| Risk                                                                          | Severity | Mitigation                                                         |
| ----------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| Auto-updater publish config points to `ptah/ptah-desktop` which may not exist | LOW      | Auto-updater gracefully handles missing releases via error handler |
| Window state persistence uses IStateStorage which is async for update         | LOW      | Save on close is fire-and-forget; no issue                         |

### Edge Cases to Handle

- [x] Issue 4 verified working -- no code changes needed
- [x] DI verification should not crash app if token missing -- log and continue
- [ ] Auto-updater should not block app startup
- [ ] Window bounds restore should handle invalid/off-screen bounds

---

## Batch 1: Blocking Fixes + DI Verification -- COMPLETE

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: None
**Commit**: bffb4d76

### Task 1.1: Add electron types to tsconfig -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-electron\tsconfig.app.json`
**Action**: MODIFY

**Quality Requirements**:

- Add `"electron"` to the `"types"` array alongside `"node"`

**Implementation Details**:

- Line 8: Change `"types": ["node"]` to `"types": ["node", "electron"]`
- The electron package ships its own type definitions

---

### Task 1.2: Fix SubagentRegistryService API mismatch -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\rpc-method-registration.service.ts`
**Action**: MODIFY
**Pattern to Follow**: `libs/backend/vscode-core/src/services/subagent-registry.service.ts` (actual API)

**Quality Requirements**:

- Fix all three method calls in `registerSubagentMethods()` (around lines 310-344)
- Use correct structural type for container.resolve that matches actual SubagentRegistryService API

**Implementation Details**:

- Line 323: `registry.getSubagent(params.toolCallId)` -> `registry.get(params.toolCallId)`
- Line 328: `registry.getResumableSubagents(params.sessionId)` -> `registry.getResumableBySession(params.sessionId)`
- Line 333: `registry.getResumableSubagents()` -> `registry.getResumable()`
- Update the structural type used in `container.resolve<...>` to match: `{ get(id: string): SubagentRecord | null; getResumable(): SubagentRecord[]; getResumableBySession(parentSessionId: string): SubagentRecord[]; }`
- Import `SubagentRecord` type from `@ptah-extension/shared` if not already imported

---

### Task 1.3: Add DI container verification -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\main.ts`
**Action**: MODIFY

**Quality Requirements**:

- Add verification step after `ElectronDIContainer.setup()` (after line 76)
- Resolve critical tokens and log success/failure for each
- Must NOT crash the app -- catch errors per-token and log warnings
- Log a summary line at the end

**Implementation Details**:

- Add a `verifyCriticalTokens()` function or inline block after line 76
- Tokens to verify: `TOKENS.RPC_HANDLER`, `TOKENS.LOGGER`, `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, `PLATFORM_TOKENS.STATE_STORAGE`, `PLATFORM_TOKENS.SECRET_STORAGE`
- For each token: try `container.resolve(token)`, log success or warning
- Log total verified vs failed count
- Do NOT add `SDK_TOKENS.SDK_AGENT_ADAPTER` -- it requires lazy resolution (session-scoped)

**Validation Notes**:

- This runs before IPC bridge setup, so only container-level tokens should be checked
- Do not check WEBVIEW_MANAGER (registered later in Phase 4)

---

**Batch 1 Verification**:

- All files exist at paths
- Build passes: `npx nx build ptah-electron` (or tsc --noEmit)
- code-logic-reviewer approved
- SubagentRegistryService methods match actual API

---

## Batch 2: Electron Features (Window State + Save Dialog + Auto-Updater) -- COMPLETE

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 1
**Commit**: 862c9d8d, plus CONFIG_MANAGER shim in final commit

### Task 2.1: Window state persistence -- save bounds on close -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\windows\main-window.ts`
**Action**: MODIFY

**Quality Requirements**:

- Accept `IStateStorage` parameter in `createMainWindow()`
- Save window bounds to state storage on `close` event using key `window.bounds`
- Fire-and-forget the async save (no await needed in close handler)

**Implementation Details**:

- Import `IStateStorage` from `@ptah-extension/platform-core`
- Change signature: `createMainWindow(stateStorage?: IStateStorage): BrowserWindow`
- In the `close` handler: replace console.log with `stateStorage?.update('window.bounds', bounds)`
- Keep the console.log for debugging but also persist

---

### Task 2.2: Window state persistence -- restore bounds on startup -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\main.ts`
**Action**: MODIFY

**Quality Requirements**:

- Before creating BrowserWindow, read saved bounds from state storage
- Pass state storage to `createMainWindow()`
- Apply saved bounds to BrowserWindow after creation (or pass as options)

**Implementation Details**:

- After DI container setup (Phase 2), resolve `PLATFORM_TOKENS.STATE_STORAGE`
- Read `window.bounds` from state storage: `stateStorage.get<Electron.Rectangle>('window.bounds')`
- Pass stateStorage to `createMainWindow(stateStorage)`
- In `createMainWindow`, if bounds are provided, use them for initial window position/size
- Also update the `activate` handler on macOS to pass stateStorage

**Validation Notes**:

- Handle case where saved bounds are off-screen (e.g., external monitor disconnected)
- Simple approach: just set x, y, width, height if they exist; Electron handles off-screen gracefully

---

### Task 2.3: Native file save dialog for quality:export -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\rpc-method-registration.service.ts`
**Action**: MODIFY

**Quality Requirements**:

- Add a new `file:save-dialog` RPC method that opens Electron's native save dialog
- Takes content (string) and optional defaultFileName as params
- Returns `{ saved: boolean, filePath?: string }`

**Implementation Details**:

- Add a new method registration in the appropriate section of `registerExtendedRpcMethods()`
- Import `dialog` from `electron` (or use dynamic import)
- Use `dialog.showSaveDialog()` with filters for markdown/text files
- If user selects a path, write content with `fs.promises.writeFile()`
- Return success/failure result
- The renderer calls `file:save-dialog` after `quality:export` returns content

---

### Task 2.4: Auto-updater setup -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\main.ts`
**Action**: MODIFY

**Quality Requirements**:

- Import and configure electron-updater
- Call `autoUpdater.checkForUpdatesAndNotify()` after app ready
- Add error handling so updater failures don't crash the app
- Only check in production (not development)

**Implementation Details**:

- Import `autoUpdater` from `electron-updater`
- After Phase 5 (window created and loaded), add auto-update check
- Wrap in try/catch with console.error logging
- Skip if `process.env['NODE_ENV'] === 'development'`
- The electron-builder.yml already has `publish: { provider: github, owner: ptah, repo: ptah-desktop }`

---

**Batch 2 Verification**:

- All files exist at paths
- Build passes
- code-logic-reviewer approved
- Window state save/restore works conceptually (state storage API used correctly)
- Auto-updater import resolves (electron-updater 6.8.3 installed)

---

## Batch 3: Angular Platform Detection -- COMPLETE

**Developer**: frontend-developer
**Tasks**: 1 | **Dependencies**: None (independent of Batches 1-2)

### Task 3.1: Add isElectron to WebviewConfig -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\vscode.service.ts`
**Action**: MODIFY

**Quality Requirements**:

- Add `isElectron?: boolean` to the `WebviewConfig` interface
- Default to `false` in the default config signal value
- This enables the Angular frontend to detect when running in Electron

**Implementation Details**:

- Add `isElectron?: boolean` field to `WebviewConfig` interface (after line 21, before closing brace)
- Add `isElectron: false` to the default config in the signal initialization (line 69-79)
- The preload script already sets `window.ptahConfig.isElectron = true` -- this just adds the type

---

**Batch 3 Verification**:

- File exists
- Build passes: `npx nx build core`
- code-logic-reviewer approved
- Type matches what preload.ts sets

---

## Verified Issues (No Work Needed)

### Issue 4: IPC broadcastMessage wiring -- VERIFIED WORKING

**Status**: No fix needed
**Evidence**: `ElectronWebviewManagerAdapter.broadcastMessage()` calls `ipcBridge.sendToRenderer()` which calls `win.webContents.send('to-renderer', message)`. The preload's `ipcRenderer.on('to-renderer')` dispatches `window.dispatchEvent(new MessageEvent(...))`. This correctly mirrors the VS Code webview message flow.
