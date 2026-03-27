# Development Tasks - TASK_2025_227: Workspace Context Panel

**Total Tasks**: 27 | **Batches**: 6 | **Status**: 1/6 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- `cross-spawn` is an existing dependency (verified in `cli-adapter.utils.ts:9`) -- OK to use
- `EditorService` workspace-partitioned Map pattern exists and works (verified `_workspaceEditorState` Map)
- RPC handler pattern verified: `@injectable()` class with `register()` method, injected via `TOKENS.RPC_HANDLER`
- `IpcBridge` class has `setupRpcHandler()` + `setupStateHandlers()` + `initialize()` pattern -- extensible
- `preload.ts` uses `contextBridge.exposeInMainWorld()` -- can add `ptahTerminal` API
- `WorkspaceCoordinatorService` already coordinates EditorService + TabManager + SessionLoader -- extensible
- `PLATFORM_TOKENS.WORKSPACE_PROVIDER.getWorkspaceRoot()` verified as active workspace path source
- DI container Phase 4.2 section is where Electron-specific handler singletons are registered

### Risks Identified

| Risk                                                           | Severity | Mitigation                                                        |
| -------------------------------------------------------------- | -------- | ----------------------------------------------------------------- |
| `node-pty` native module needs Electron rebuild                | MED      | Add `electron-rebuild` script; Task 3.1 includes dependency setup |
| `@xterm/addon-webgl` may fail in some Electron configs         | LOW      | Plan includes try/catch fallback to canvas renderer (Task 4.3)    |
| xterm.css import path may not resolve in Angular build         | LOW      | Verify path in Task 4.1; fallback: copy CSS to assets             |
| Binary IPC channel names could conflict with future channels   | LOW      | Using namespaced `terminal:*` prefix; documented in plan          |
| `RPC_METHOD_NAMES` sync is manual (runtime companion)          | LOW      | Task 1.1 explicitly handles both registry + array sync            |
| Git status paths are relative but file tree paths are absolute | MED      | GitStatusService must normalize; documented in Task 2.3           |

### Edge Cases to Handle

- [ ] Non-git workspace (isGitRepo=false) -- handled in GitInfoService + GitStatusBarComponent conditional
- [ ] Detached HEAD state -- GitInfoService parses `# branch.head (detached)` pattern
- [ ] Git not installed -- execGit 10s timeout returns non-git state gracefully
- [ ] WebGL context loss in terminal -- handled by addon onContextLoss callback
- [ ] Max terminal sessions exceeded -- PtyManagerService enforces 20 total, 5 per workspace
- [ ] Workspace removal while terminals active -- killAllForWorkspace cleanup

---

## Batch 1: Shared Type Definitions + Backend Git Service - COMPLETE

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: None
**Commit**: 71aed800

### Task 1.1: Create Git RPC Type Definitions - COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc\rpc-git.types.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md:57-153

**Implementation Details**:

- Create `rpc-git.types.ts` with all git-related RPC types
- Types: `GitFileStatus`, `GitBranchInfo`, `GitInfoParams`, `GitInfoResult`, `GitWorktreesParams`, `GitWorktreesResult`, `GitWorktreeInfo`, `GitAddWorktreeParams`, `GitAddWorktreeResult`, `GitRemoveWorktreeParams`, `GitRemoveWorktreeResult`
- All types fully specified in the implementation plan Section 1.1

### Task 1.2: Create Terminal RPC Type Definitions - COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc\rpc-terminal.types.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md:155-202

**Implementation Details**:

- Create `rpc-terminal.types.ts` with terminal session lifecycle types
- Types: `TerminalCreateParams`, `TerminalCreateResult`, `TerminalKillParams`, `TerminalKillResult`, `TerminalResizeParams`
- Note: Binary IPC types (data-in/data-out/resize) are NOT in this file -- they use direct IPC, not JSON RPC

### Task 1.3: Register Git and Terminal Methods in RPC Registry - COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md:206-254

**Implementation Details**:

- Add barrel re-exports: `export * from './rpc/rpc-git.types';` and `export * from './rpc/rpc-terminal.types';`
- Add type imports for all new param/result types
- Add 6 entries to `RpcMethodRegistry` interface: `git:info`, `git:worktrees`, `git:addWorktree`, `git:removeWorktree`, `terminal:create`, `terminal:kill`
- Add all 6 method names to `RPC_METHOD_NAMES` array (CRITICAL: must stay in sync)
- **Pattern to Follow**: See existing entries like `editor:openFile` at line 668-676

### Task 1.4: Create GitInfoService (Main Process) - COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\git-info.service.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md:258-321

**Implementation Details**:

- Create `GitInfoService` class (NOT injectable -- plain class, instantiated in DI container)
- Constructor takes `Logger` instance
- Methods: `getGitInfo(workspacePath)`, `getWorktrees(workspacePath)`, `addWorktree(workspacePath, params)`, `removeWorktree(workspacePath, worktreePath, force?)`, `isGitRepo(workspacePath)`
- Private: `execGit(args, cwd)` using `crossSpawn` from `cross-spawn`
- Parse `git status --porcelain=v2 --branch` for branch info + file status
- Parse `git worktree list --porcelain` for worktree entries
- 10-second timeout on all git operations
- Import `crossSpawn` from `cross-spawn` (same as `cli-adapter.utils.ts:9`)

**Validation Notes**:

- RISK: Git status paths are relative to repo root. Store them as-is; frontend will handle normalization.
- Edge case: Handle detached HEAD (`# branch.head (detached)`)
- Edge case: Handle non-git directories (return `isGitRepo: false`)

---

**Batch 1 Verification**:

- All 4 files exist at specified paths
- TypeScript compilation passes: `npx nx build shared`
- code-logic-reviewer approved
- No stubs, placeholders, or TODOs

---

## Batch 2: Backend Git RPC Handlers + DI Registration - IN PROGRESS

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 1 (COMPLETE)

### Task 2.1: Create ElectronGitRpcHandlers - IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\electron-git-rpc.handlers.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md:326-376

**Implementation Details**:

- `@injectable()` class with `register()` method
- Inject: `TOKENS.LOGGER`, `TOKENS.RPC_HANDLER`, `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, `GIT_INFO_SERVICE` (Symbol.for('GitInfoService'))
- Register 4 RPC methods: `git:info`, `git:worktrees`, `git:addWorktree`, `git:removeWorktree`
- Phase 1: `git:info` and `git:worktrees` have full implementations
- Phase 3: `git:addWorktree` and `git:removeWorktree` also have full implementations (implement all 4 now since GitInfoService already supports them)
- **Pattern to Follow**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\electron-editor-rpc.handlers.ts` lines 12-50

### Task 2.2: Export ElectronGitRpcHandlers from Index - IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\index.ts`
**Action**: MODIFY

**Implementation Details**:

- Add: `export { ElectronGitRpcHandlers } from './electron-git-rpc.handlers';`

### Task 2.3: Register GitInfoService + ElectronGitRpcHandlers in DI Container - IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\di\container.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md:400-411

**Implementation Details**:

- Import `GitInfoService` from `../services/git-info.service`
- Import `ElectronGitRpcHandlers` from handlers index
- Define `GIT_INFO_SERVICE = Symbol.for('GitInfoService')` token
- In Phase 4.2 section: instantiate `const gitInfoService = new GitInfoService(logger);`
- Register: `container.register(GIT_INFO_SERVICE, { useValue: gitInfoService });`
- Register: `container.registerSingleton(ElectronGitRpcHandlers);`
- **Pattern to Follow**: See existing Phase 4.2 registrations at container.ts line 750-783

### Task 2.4: Add ElectronGitRpcHandlers to Registration Service - IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\rpc-method-registration.service.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md:388-393

**Implementation Details**:

- Add import: `ElectronGitRpcHandlers` from `./handlers`
- Add constructor parameter: `@inject(ElectronGitRpcHandlers) private readonly gitHandlers: ElectronGitRpcHandlers,`
- Add to `electronHandlers` array: `{ name: 'ElectronGitRpcHandlers', handler: this.gitHandlers },`

---

**Batch 2 Verification**:

- All files exist and compile
- ElectronGitRpcHandlers properly exports and registers
- DI container resolves GitInfoService correctly
- code-logic-reviewer approved

---

## Batch 3: Frontend Git Status Service + Components - PENDING

**Developer**: frontend-developer
**Tasks**: 5 | **Dependencies**: Batch 2

### Task 3.1: Create GitStatusService (Angular Service) - PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\git-status.service.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md:416-556

**Implementation Details**:

- `@Injectable({ providedIn: 'root' })` service
- Workspace-partitioned state: `Map<string, GitWorkspaceState>` following EditorService pattern
- Signals: `_branch`, `_files`, `_isGitRepo`, `_isLoading` (all with `.asReadonly()` public versions)
- Computed: `changedFileCount`, `hasChanges`, `branchName`, `fileStatusMap` (Map for O(1) lookup)
- Polling: 5s interval via `setInterval`, paused when `_isFocused=false`, stopped when editor hidden
- Focus listeners: `window.addEventListener('focus'/'blur')` with `DestroyRef` cleanup
- `switchWorkspace(path)`: Save current state, restore target, immediate fetch
- `removeWorkspaceState(path)`: Cleanup on workspace removal
- `startPolling()` / `stopPolling()`: Called by EditorPanelComponent
- Private `rpcCall<T>()`: Same correlationId pattern as EditorService (line 570-613)
- Private `fetchGitInfo()`: Calls `git:info` RPC, updates signals + saves to state map
- **Pattern to Follow**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor.service.ts`

**Validation Notes**:

- RISK: Git status file paths are relative to repo root. The `fileStatusMap` must use relative paths as keys. FileTreeNodeComponent will need to derive relative paths from absolute `node.path` for lookup.

### Task 3.2: Create GitStatusBarComponent - PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\git-status-bar\git-status-bar.component.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md:562-619

**Implementation Details**:

- Standalone component with `ChangeDetectionStrategy.OnPush`
- Inject `GitStatusService`
- Import `LucideAngularModule` with icons: `GitBranch`, `ArrowUp`, `ArrowDown`, `FileEdit`
- Template: horizontal bar (`h-7`, `bg-base-200`, `border-b`) showing:
  - Branch name with GitBranch icon (truncated max-w-[160px])
  - Ahead count (text-info) with ArrowUp icon when > 0
  - Behind count (text-warning) with ArrowDown icon when > 0
  - Changed file count (ml-auto) with FileEdit icon when hasChanges
- Only renders when `gitStatus.isGitRepo()` is true (`@if` guard)

### Task 3.3: Modify FileTreeNodeComponent for Git Badges - PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\file-tree\file-tree-node.component.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md:624-643

**Implementation Details**:

- Import and inject `GitStatusService`
- Add `nodeGitStatus` computed signal: looks up `this.node().path` (converted to relative) in `gitStatus.fileStatusMap()`
- Path normalization: strip workspace root prefix from the absolute `node().path` to get relative path for lookup
- After the `<span class="truncate">{{ node().name }}</span>`, add git status badge:
  ```
  @if (nodeGitStatus()) {
    <span class="ml-auto text-[10px] font-mono flex-shrink-0" [class]="gitStatusColor()">
      {{ nodeGitStatus()!.status }}
    </span>
  }
  ```
- Add `gitStatusColor()` method: M=text-warning, A=text-success, D=text-error, ??=text-info, default=text-base-content/50

### Task 3.4: Modify EditorPanelComponent for Git Status Bar - PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\editor-panel\editor-panel.component.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md:645-664

**Implementation Details**:

- Import `GitStatusBarComponent` and `GitStatusService`
- Add `GitStatusBarComponent` to `imports` array
- Inject `GitStatusService`
- In `ngOnInit()`: add `this.gitStatus.startPolling();`
- In template: add `<ptah-git-status-bar />` between toolbar `<div>` and content `<div class="flex flex-1 min-h-0">`

### Task 3.5: Update Editor Library Exports + WorkspaceCoordinator for Git - PENDING

**File 1**: `D:\projects\ptah-extension\libs\frontend\editor\src\index.ts`
**Action**: MODIFY

**File 2**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\workspace-coordinator.service.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md:674-709

**Implementation Details**:

- In `index.ts`: Add exports for `GitStatusService` and `GitStatusBarComponent`
- In `WorkspaceCoordinatorService`:
  - Import `GitStatusService` from `@ptah-extension/editor`
  - Add `private readonly gitStatus = inject(GitStatusService);`
  - In `switchWorkspace()`: add `this.gitStatus.switchWorkspace(newPath);`
  - In `removeWorkspaceState()`: add `this.gitStatus.removeWorkspaceState(workspacePath);`

---

**Batch 3 Verification**:

- All files exist and compile: `npx nx build editor`
- GitStatusService properly polls and updates signals
- GitStatusBarComponent displays branch info
- FileTreeNodeComponent shows git status badges
- WorkspaceCoordinator switches git state on workspace change
- code-logic-reviewer approved

---

## Batch 4: Backend Terminal (PTY + IPC) - PENDING

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 1 (shared types)

### Task 4.1: Install xterm + node-pty Dependencies - PENDING

**File**: `D:\projects\ptah-extension\package.json`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md:722-742

**Implementation Details**:

- Add to `dependencies`: `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl`, `node-pty`
- Add to `scripts`: `"electron:rebuild": "electron-rebuild -f -w node-pty"`
- Note: `node-pty` must be marked as `external` in webpack config if applicable
- Run `npm install` after modifying package.json

### Task 4.2: Create PtyManagerService (Main Process) - PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\pty-manager.service.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md:746-834

**Implementation Details**:

- Plain class (NOT injectable), takes `Logger` in constructor
- Internal `Map<string, PtySession>` for session tracking
- `PtySession` interface: `{ id, pty, workspacePath, pendingData }`
- `onData(callback)`: Register callback for terminal data output
- `onExit(callback)`: Register callback for terminal exit events
- `create({ cwd, shell?, name? })`: Spawn PTY, register listeners, return `{ id, pid }`
- `write(id, data)`: Forward input to PTY
- `resize(id, cols, rows)`: Resize PTY
- `kill(id)`: Kill PTY session
- `killAllForWorkspace(workspacePath)`: Bulk cleanup
- `getSessionsForWorkspace(workspacePath)`: List sessions
- `disposeAll()`: Shutdown cleanup
- Shell detection: `process.env.COMSPEC` on Windows, `process.env.SHELL` on Unix, fallbacks
- Session ID: `crypto.randomUUID()`
- PTY spawn: `pty.spawn(shell, [], { cwd, cols: 80, rows: 24, env: process.env })`
- Limits: Max 20 total sessions, max 5 per workspace

### Task 4.3: Modify Preload for Terminal Binary IPC - PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\preload.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md:838-868

**Implementation Details**:

- Add `contextBridge.exposeInMainWorld('ptahTerminal', { ... })` after existing `ptahConfig` block
- Expose: `write(id, data)`, `resize(id, cols, rows)`, `onData(callback)`, `onExit(callback)`
- Each `on*` method returns a cleanup function for unsubscribing
- Uses direct `ipcRenderer.send()` / `ipcRenderer.on()` -- NOT the JSON RPC channel

### Task 4.4: Modify IpcBridge for Terminal Channels - PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\ipc\ipc-bridge.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md:872-935

**Implementation Details**:

- Accept optional `PtyManagerService` in constructor (backward compatible)
- Add `setupTerminalHandlers()` method:
  - `ipcMain.on('terminal:data-in')`: Forward to `ptyManager.write()`
  - `ipcMain.on('terminal:resize')`: Forward to `ptyManager.resize()`
  - `ptyManager.onData()`: Forward to `win.webContents.send('terminal:data-out')`
  - `ptyManager.onExit()`: Forward to `win.webContents.send('terminal:exit')`
- Call `setupTerminalHandlers()` in `initialize()`
- In `dispose()`: Remove terminal IPC listeners + `ptyManager.disposeAll()`

### Task 4.5: Create ElectronTerminalRpcHandlers + DI Registration - PENDING

**File 1**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\electron-terminal-rpc.handlers.ts`
**Action**: CREATE

**File 2**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\index.ts`
**Action**: MODIFY

**File 3**: `D:\projects\ptah-extension\apps\ptah-electron\src\di\container.ts`
**Action**: MODIFY

**File 4**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\rpc-method-registration.service.ts`
**Action**: MODIFY

**Spec Reference**: implementation-plan.md:939-986, 1421-1435

**Implementation Details**:

- Create `ElectronTerminalRpcHandlers`: `@injectable()`, inject TOKENS + `PTY_MANAGER_SERVICE` symbol
- Register `terminal:create` and `terminal:kill` RPC methods
- Export from handlers index
- In DI container Phase 4.2: create `PtyManagerService` instance, register with `PTY_MANAGER_SERVICE` token, register handler singleton
- In registration service: add constructor param + `electronHandlers` array entry
- **Pattern to Follow**: Same as Task 2.1-2.4 for Git handlers

---

**Batch 4 Verification**:

- Dependencies installed successfully
- PtyManagerService can spawn/kill PTY sessions
- Binary IPC channels work (preload + ipc-bridge)
- Terminal RPC handlers registered
- code-logic-reviewer approved

---

## Batch 5: Frontend Terminal Components - PENDING

**Developer**: frontend-developer
**Tasks**: 5 | **Dependencies**: Batch 4

### Task 5.1: Create Terminal Type Definitions - PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\types\terminal.types.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md:990-1017

**Implementation Details**:

- `PtahTerminalApi` interface: `write()`, `resize()`, `onData()`, `onExit()`
- `declare global { interface Window { ptahTerminal?: PtahTerminalApi; } }`
- `TerminalTab` interface: `{ id, name, pid, isActive, hasExited, exitCode? }`

### Task 5.2: Create TerminalService (Angular Service) - PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\terminal.service.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md:1019-1126

**Implementation Details**:

- `@Injectable({ providedIn: 'root' })` service
- Workspace-partitioned: `Map<string, TerminalWorkspaceState>` with `{ tabs, activeTabId }`
- Signals: `_tabs`, `_activeTabId` with readonly public + `activeTab` computed
- `_xtermWriters` Map: terminal ID to xterm write callback (for data forwarding)
- Binary IPC listener setup in constructor via `window.ptahTerminal?.onData()` / `onExit()`
- `registerXtermWriter(id, writer)` / `unregisterXtermWriter(id)`: For terminal component binding
- `createTerminal(name?)`: RPC `terminal:create`, add tab to state
- `killTerminal(id)`: RPC `terminal:kill`
- `switchTab(id)`: Update active tab signal
- `closeTab(id)`: Kill + remove from tabs
- `writeToTerminal(id, data)`: `window.ptahTerminal?.write(id, data)`
- `resizeTerminal(id, cols, rows)`: `window.ptahTerminal?.resize(id, cols, rows)`
- `switchWorkspace(path)` / `removeWorkspaceState(path)`: Workspace partition management
- Private `rpcCall<T>()`: Same pattern as EditorService

### Task 5.3: Create TerminalComponent (xterm.js Wrapper) - PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\terminal\terminal.component.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md:1129-1236

**Implementation Details**:

- Standalone component, `ChangeDetectionStrategy.OnPush`
- Input: `terminalId` (required)
- In `ngAfterViewInit()`: initialize xterm Terminal instance
- xterm config: `cursorBlink: true`, `fontSize: 13`, JetBrains Mono font, dark theme colors
- Load `FitAddon`, try `WebglAddon` (catch to canvas fallback)
- `terminal.onData()` -> `terminalService.writeToTerminal()`
- `terminalService.registerXtermWriter()` -> `terminal.write()`
- `ResizeObserver` for auto-resize: `fitAddon.fit()` + `terminalService.resizeTerminal()`
- `ngOnDestroy()`: Unregister writer, disconnect observer, dispose addons + terminal

### Task 5.4: Create TerminalTabBarComponent + TerminalPanelComponent - PENDING

**File 1**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\terminal\terminal-tab-bar.component.ts`
**Action**: CREATE

**File 2**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\terminal\terminal-panel.component.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md:1239-1335

**Implementation Details**:

- **TerminalTabBarComponent**: Tab bar with terminal tabs + "New Terminal" button
  - Inject `TerminalService`, use Lucide icons (Plus, X, Terminal)
  - Show tabs from `terminalService.tabs()`, highlight active, show exit state
  - `newTerminal()` and `closeTab()` async handlers
- **TerminalPanelComponent**: Container wrapping tab bar + terminal instances
  - Renders ALL terminal tabs but hides inactive ones with `[class.hidden]` to preserve xterm state
  - Empty state: "Click + to open a terminal"
  - Uses `@if (terminalService.activeTab(); as activeTab)` pattern

### Task 5.5: Modify EditorPanelComponent for Terminal Split + Update Exports + WorkspaceCoordinator - PENDING

**File 1**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\editor-panel\editor-panel.component.ts`
**Action**: MODIFY

**File 2**: `D:\projects\ptah-extension\libs\frontend\editor\src\index.ts`
**Action**: MODIFY

**File 3**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\workspace-coordinator.service.ts`
**Action**: MODIFY

**File 4**: `D:\projects\ptah-extension\apps\ptah-extension-webview\src\styles.css`
**Action**: MODIFY

**Spec Reference**: implementation-plan.md:1339-1447

**Implementation Details**:

- **EditorPanelComponent**:
  - Import `TerminalPanelComponent`
  - Add `terminalHeight` signal (default 200, min 100)
  - Add `terminalVisible` signal (default false)
  - Add terminal toggle button in toolbar (Lucide Terminal icon)
  - Add resizable horizontal split: drag handle (h-1, cursor-row-resize) between editor and terminal
  - Add `onTerminalResizeStart(event)` mouse drag handler for resize
  - Terminal panel at bottom with `[style.height.px]="terminalHeight()"`
- **index.ts**: Export `TerminalService`, `TerminalComponent`, `TerminalTabBarComponent`, `TerminalPanelComponent`, `TerminalTab`, `PtahTerminalApi`
- **WorkspaceCoordinatorService**: Add `TerminalService` injection + `switchWorkspace`/`removeWorkspaceState` calls
- **styles.css**: Add `@import '@xterm/xterm/css/xterm.css';`

---

**Batch 5 Verification**:

- All terminal components render correctly
- xterm.js initializes with WebGL or canvas fallback
- Terminal tabs create/switch/close properly
- Resizable split between editor and terminal works
- Workspace switching preserves terminal state
- xterm.css imported and styles applied
- code-logic-reviewer approved

---

## Batch 6: Worktree Management (Fullstack) - PENDING

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: Batch 2 (git handlers already support worktree CRUD), Batch 3 (GitStatusBar exists)

### Task 6.1: Create WorktreeService (Angular Service) - PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\worktree.service.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md:1501-1532

**Implementation Details**:

- `@Injectable({ providedIn: 'root' })` service
- Signal: `_worktrees` (list of `GitWorktreeInfo`)
- `loadWorktrees()`: RPC `git:worktrees`, update signal
- `addWorktree(branch, options?)`: RPC `git:addWorktree`, on success auto-register as workspace folder via `ElectronLayoutService.addFolderByPath()` or equivalent RPC
- `removeWorktree(path, force?)`: RPC `git:removeWorktree`, on success remove workspace folder
- Private `rpcCall<T>()`: Same pattern as EditorService

### Task 6.2: Create AddWorktreeDialogComponent - PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\worktree\add-worktree-dialog.component.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md:1535-1546

**Implementation Details**:

- Standalone component with DaisyUI modal styling
- Signal-based form state: `branchName`, `customPath`, `createNewBranch` (checkbox)
- Outputs: `worktreeCreated` event, `cancelled` event
- "Create" button calls `worktreeService.addWorktree()` with form values
- Error display for failed operations
- Loading state while RPC in progress

### Task 6.3: Modify GitStatusBarComponent for Worktree Indicator - PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\git-status-bar\git-status-bar.component.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md:1483-1497

**Implementation Details**:

- Inject `WorktreeService`
- Add `worktreeCount` computed: `worktreeService.worktrees().length`
- Load worktrees on init: call `worktreeService.loadWorktrees()` in constructor or via GitStatusService poll
- In template after branch name: show worktree count with `GitFork` icon when > 1
- Import `GitFork` from lucide-angular
- Add "Add Worktree" button (small, in the status bar) that opens the dialog

### Task 6.4: Update Editor Library Exports for Worktree - PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\index.ts`
**Action**: MODIFY

**Implementation Details**:

- Export `WorktreeService` from `./lib/services/worktree.service`
- Export `AddWorktreeDialogComponent` from `./lib/worktree/add-worktree-dialog.component`

---

**Batch 6 Verification**:

- WorktreeService can list/add/remove worktrees via RPC
- AddWorktreeDialogComponent form works with validation
- GitStatusBar shows worktree count indicator
- New worktrees auto-register as workspace folders
- code-logic-reviewer approved
- All exports updated

---

## Completion Checklist

- [ ] All 6 batches verified and committed
- [ ] All 27 tasks completed
- [ ] All 15 new files created
- [ ] All 12 modified files updated
- [ ] TypeScript compilation passes across affected projects
- [ ] Git RPC methods registered and functional
- [ ] Terminal PTY sessions spawn and communicate via binary IPC
- [ ] All validation risks addressed
- [ ] No stubs, placeholders, or TODOs remaining
