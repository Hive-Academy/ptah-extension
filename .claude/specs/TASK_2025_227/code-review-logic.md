# Code Logic Review - TASK_2025_227: Workspace Context Panel

## Review Summary

| Metric              | Value                                        |
| ------------------- | -------------------------------------------- |
| Overall Score       | 6.5/10                                       |
| Assessment          | NEEDS_REVISION                               |
| Critical Issues     | 2                                            |
| Serious Issues      | 4                                            |
| Moderate Issues     | 5                                            |
| Minor Issues        | 4                                            |
| Failure Modes Found | 8                                            |
| Files Reviewed      | 27 (15 created, 12 modified)                 |
| Fixes Applied       | 2 (stale-response race, missing stopPolling) |

## The 5 Paranoid Questions

### 1. How does this fail silently?

- **Stale git RPC responses**: ~~If the user switches workspaces while a `git:info` RPC is in flight, the response from the OLD workspace is written into the NEW workspace's signal state. The user sees branch info and file statuses from a different project with zero indication of the error.~~ **FIXED**: Applied stale-response guard in `fetchGitInfo()`.
- **PTY orphans on workspace removal**: When `TerminalService.removeWorkspaceState()` is called, it clears the frontend tab state but does NOT kill the PTY sessions on the backend. The `PtyManagerService.killAllForWorkspace()` method exists but is never invoked during workspace removal. Orphaned PTY processes silently consume resources.
- **Terminal data arrives before xterm writer registered**: Between `terminal:create` RPC response and `TerminalComponent.ngAfterViewInit()` completing, incoming PTY data has no registered writer and is silently dropped. The terminal may appear to miss initial shell prompt output.

### 2. What user action causes unexpected behavior?

- **Rapid terminal creation**: Clicking "New Terminal" multiple times quickly can trigger concurrent `terminal:create` RPC calls. Each increments `_terminalCounter` but the tab state updates are not atomic. If two responses arrive out of order, the tab list may have incorrect active states.
- **Toggle terminal while xterm is initializing**: If the user toggles `terminalVisible` to false while `TerminalComponent.ngAfterViewInit()` is running (xterm is opening), the component gets destroyed mid-initialization. The `ResizeObserver.observe()` call may target a detached DOM node.
- **Worktree creation with path traversal**: User-supplied branch names like `../../malicious` flow through `path.join(path.dirname(workspacePath), params.branch)` creating worktrees outside the project hierarchy. Mitigated by git itself validating branch names, but the path resolution is not sanitized.

### 3. What data makes this produce wrong results?

- **Git porcelain v2 rename/copy path parsing**: For type 2 entries (renamed files), the path extraction `parts[parts.length - 1]` extracts the NEW path from the score field `<X><score> <path>`. But if the path contains spaces, `split(' ')` will fragment it, and `parts[parts.length - 1]` gets only the last segment. Git paths with spaces will produce truncated results.
- **Duplicate git file entries**: `parseFileStatus` can produce TWO entries for the same file (one staged, one unstaged) when both index and worktree have changes. The `fileStatusMap` computed signal uses `map.set(file.path, file)`, so the LAST entry wins (unstaged overwrites staged). The file tree badge will show only the unstaged status, hiding the fact that the file has staged changes too.
- **Windows path normalization edge case**: `nodeGitStatus` in `FileTreeNodeComponent` normalizes backslashes to forward slashes for comparison. But if `activeWorkspacePath` contains a trailing backslash (e.g., `D:\projects\`) and `node().path` does not (e.g., `D:\projects\file.ts`), the normalization to `D:/projects//` vs `D:/projects/file.ts` could fail the `startsWith` check depending on OS behavior.

### 4. What happens when dependencies fail?

- **node-pty fails to spawn**: If `pty.spawn()` throws (e.g., shell binary not found), the `PtyManagerService.create()` method throws, and the `ElectronTerminalRpcHandlers.registerCreate()` handler re-throws as a new Error. The frontend `createTerminal()` receives `{ success: false }` but `_terminalCounter` has already been incremented, causing a gap in terminal naming ("Terminal 1" followed by "Terminal 3").
- **git not installed on system**: `execGit` with `crossSpawn('git', ...)` will fire an `error` event on the child process, which is caught and rejected. The `isGitRepo` method returns `false`, so `getGitInfo` returns `{ isGitRepo: false, ... }`. This is handled correctly.
- **WebGL context loss in terminal**: The `onContextLoss` callback disposes the WebGL addon and nulls it out. After this, the terminal falls back to canvas rendering. This is handled correctly.
- **xterm.js import fails (CSS missing)**: If `@xterm/xterm/css/xterm.css` import fails in `styles.css`, the terminal renders without styling. No error is shown to the user -- the terminal appears broken with overlapping text.

### 5. What's missing that the requirements didn't mention?

- **No workspace:removeTerminals RPC**: When a workspace folder is removed via `ElectronLayoutService.removeFolder()`, the coordinator calls `TerminalService.removeWorkspaceState()` which clears frontend state but NOT backend PTY sessions. There should be an RPC call or IPC message to `PtyManagerService.killAllForWorkspace()`.
- **No terminal reconnection on app restart**: Terminal tabs are persisted in workspace state cache, but PTY sessions are NOT persisted. After Electron app restart, the tab bar shows stale terminal tabs referencing dead sessions. There is no mechanism to detect and clean up these ghost tabs.
- **No error feedback for failed git polling**: When `fetchGitInfo()` fails (RPC timeout, network error), the service silently stays in its last-known state. There is no visual indicator or retry mechanism with backoff. Users may see stale git status for extended periods.
- **No terminal scrollback limit enforcement**: `Terminal` config sets `scrollback: 5000` which is reasonable, but there is no cap on the number of simultaneously active (but hidden via `class.hidden`) xterm instances. With 5 terminals each at 5000 lines, memory usage can be significant.
- **No focus management for accessibility**: The `AddWorktreeDialogComponent` modal does not trap focus. Tab key can escape the dialog and focus elements behind the backdrop.

## Failure Mode Analysis

### Failure Mode 1: Stale Git RPC Response Corrupts Workspace State

- **Trigger**: User switches workspace while `git:info` RPC is in flight
- **Symptoms**: Branch name and file statuses from workspace A appear in workspace B
- **Impact**: CRITICAL -- user sees wrong git info, may commit to wrong branch
- **Current Handling**: ~~None -- response applied unconditionally~~ **FIXED** in this review
- **Fix Applied**: Added workspace path comparison guard in `fetchGitInfo()` at `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\git-status.service.ts:230-232`

### Failure Mode 2: PTY Session Orphans on Workspace Removal

- **Trigger**: User removes a workspace folder that has active terminal sessions
- **Symptoms**: PTY processes continue running in background, consuming CPU/memory. No user-visible error.
- **Impact**: SERIOUS -- resource leak accumulates over time
- **Current Handling**: `TerminalService.removeWorkspaceState()` clears frontend state only
- **Recommendation**: Add `workspace:killTerminals` RPC or call `killAllForWorkspace()` from `IpcBridge` on workspace removal. Alternatively, add cleanup in `WorkspaceCoordinatorService.removeWorkspaceState()` that sends `terminal:kill` for each tab.

### Failure Mode 3: Missing stopPolling() on EditorPanel Destroy

- **Trigger**: Editor panel component is destroyed (e.g., view switch, panel close)
- **Symptoms**: `setInterval` for git polling continues firing. Each tick executes `fetchGitInfo()` which posts RPC messages to a potentially non-existent context.
- **Impact**: CRITICAL -- memory leak, wasted RPC calls, potential errors in console
- **Current Handling**: ~~`ngOnDestroy` only cleans up resize listeners~~ **FIXED** in this review
- **Fix Applied**: Added `this.gitStatus.stopPolling()` to `ngOnDestroy()` at `D:\projects\ptah-extension\libs\frontend\editor\src\lib\editor-panel\editor-panel.component.ts:243`

### Failure Mode 4: Terminal Data Dropped During xterm Initialization

- **Trigger**: PTY sends data (shell prompt, MOTD) before `TerminalComponent.ngAfterViewInit()` completes and registers the xterm writer
- **Symptoms**: Terminal appears blank or missing initial prompt. User must press Enter to trigger a re-draw.
- **Impact**: MODERATE -- cosmetic issue, no data loss
- **Current Handling**: Data is simply discarded if no writer is registered (`if (writer) { writer(data); }`)
- **Recommendation**: Buffer incoming data per terminal ID in `TerminalService` until a writer is registered, then flush the buffer on registration.

### Failure Mode 5: Git Status File Path Parsing with Spaces

- **Trigger**: Repository contains files with spaces in their paths
- **Symptoms**: Git status badges show on wrong files or not at all
- **Impact**: MODERATE -- incorrect UI for edge-case filenames
- **Current Handling**: `split(' ')` assumes no spaces in paths
- **Recommendation**: For porcelain v2 type 1 entries, the path is always the 9th field. Use a fixed-index approach: `const filePath = parts.slice(8).join(' ')`. For type 2, the tab-separated format already handles this partially.

### Failure Mode 6: Ghost Terminal Tabs After App Restart

- **Trigger**: User restarts Electron app with terminals open
- **Symptoms**: Tab bar shows terminal tabs from previous session. Clicking on them shows a dead terminal. Writing to them silently fails (PTY sessions no longer exist).
- **Impact**: MODERATE -- confusing UX, requires manual cleanup
- **Current Handling**: No detection or cleanup mechanism
- **Recommendation**: On TerminalService initialization, validate cached tabs by attempting a ping or checking PTY session existence. Remove tabs whose sessions don't exist.

### Failure Mode 7: PtyManagerService Single Data Callback

- **Trigger**: Theoretical -- if multiple windows or renderers need terminal output
- **Symptoms**: Only the last registered `onData` callback receives data
- **Impact**: LOW (single-window architecture currently)
- **Current Handling**: `this.dataCallback = callback` overwrites any previous callback
- **Recommendation**: Use an array of callbacks or EventEmitter pattern for future extensibility.

### Failure Mode 8: Concurrent fetchGitInfo Calls

- **Trigger**: `startPolling()` triggers immediate `fetchGitInfo()`, then the interval fires again 5 seconds later. If the first call hasn't returned yet (e.g., slow git on large repo), two fetches run concurrently.
- **Symptoms**: Responses arrive out of order, potentially setting signals in a non-deterministic order
- **Impact**: LOW -- both responses should contain valid data for the same workspace, just potentially stale
- **Current Handling**: No deduplication or in-flight tracking
- **Recommendation**: Add an `_isFetching` guard or cancel previous in-flight requests.

## Critical Issues

### Issue 1: Stale Git RPC Response Race Condition -- FIXED

- **File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\git-status.service.ts:224-238`
- **Scenario**: User switches workspaces while `git:info` RPC is in flight
- **Impact**: Wrong branch info and file statuses displayed for the active workspace
- **Evidence**: `fetchGitInfo()` did not capture workspace path before await and compare after
- **Fix Applied**: Added `workspaceAtFetchTime` guard -- captures `_activeWorkspacePath` before RPC, discards response if it changed

### Issue 2: Missing stopPolling() in EditorPanelComponent.ngOnDestroy -- FIXED

- **File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\editor-panel\editor-panel.component.ts:242-244`
- **Scenario**: EditorPanel destroyed (view switch, app close) while git polling active
- **Impact**: Interval leak -- `setInterval` continues firing, sending RPC messages to dead context
- **Evidence**: `ngOnDestroy` only called `cleanupResizeListeners()`, not `gitStatus.stopPolling()`
- **Fix Applied**: Added `this.gitStatus.stopPolling()` to `ngOnDestroy()`

## Serious Issues

### Issue 3: PTY Sessions Not Killed on Workspace Removal

- **File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\terminal.service.ts:303-312` and `D:\projects\ptah-extension\apps\ptah-electron\src\services\pty-manager.service.ts:203-213`
- **Scenario**: User removes a workspace folder via `ElectronLayoutService.removeFolder()`
- **Impact**: Orphaned PTY processes accumulate, consuming system resources
- **Evidence**: `removeWorkspaceState()` deletes frontend cache but never sends `terminal:kill` for active tabs or invokes `killAllForWorkspace()` on the backend
- **Recommendation**: In `TerminalService.removeWorkspaceState()`, iterate the cached tabs and call `killTerminal()` for each before clearing state. Alternatively, add a `workspace:cleanupTerminals` RPC that the coordinator invokes.

### Issue 4: Git Porcelain v2 Path Parsing Fails for Paths with Spaces

- **File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\git-info.service.ts:274-327`
- **Scenario**: Files with spaces in path (e.g., `src/my file.ts`)
- **Impact**: Git status badges display incorrectly or not at all for affected files
- **Evidence**: Line 295 uses `line.split(' ')` then `parts[parts.length - 1]` to extract file path. A path like `src/my file.ts` would be split into `[..., "my", "file.ts"]` and only `"file.ts"` would be extracted.
- **Recommendation**: For type 1 entries, use fixed-index slicing: `parts.slice(8).join(' ')` since porcelain v2 guarantees exactly 8 fields before the path. For type 2, the tab character already separates correctly but the path before the tab still has the same space issue.

### Issue 5: Duplicate File Status Entries (Staged vs Unstaged) -- Last Writer Wins

- **File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\git-status.service.ts:114-120` and `D:\projects\ptah-extension\apps\ptah-electron\src\services\git-info.service.ts:298-314`
- **Scenario**: A file has both staged and unstaged changes (common during partial staging)
- **Impact**: `fileStatusMap` overwrites the staged entry with the unstaged entry, hiding staged status from the file tree
- **Evidence**: `parseFileStatus` emits both entries for the same path. `fileStatusMap` computed uses `map.set(file.path, file)` -- second entry overwrites first.
- **Recommendation**: Either merge the entries (e.g., prioritize staged) or change `fileStatusMap` to hold an array per path.

### Issue 6: Terminal Tab Counter Increments on Failure

- **File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\terminal.service.ts:146-178`
- **Scenario**: `terminal:create` RPC fails (e.g., session limit reached)
- **Impact**: Next successful terminal gets "Terminal 3" instead of "Terminal 2" -- cosmetic but confusing
- **Evidence**: `this._terminalCounter++` runs before the RPC call on line 147
- **Recommendation**: Move the increment to after success confirmation, or use a different naming strategy.

## Moderate Issues

### Issue 7: No Buffering of Terminal Data Before xterm Writer Registration

- **File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\terminal.service.ts:326-333`
- **Scenario**: PTY sends shell prompt before the Angular component mounts and registers its writer
- **Impact**: Missing initial prompt; terminal appears blank until user interacts
- **Recommendation**: Add a `pendingData` buffer per terminal ID that accumulates data when no writer is registered. Flush on `registerXtermWriter()`.

### Issue 8: No Error State Exposure from Git Polling Failures

- **File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\git-status.service.ts:224-238`
- **Scenario**: RPC timeout or backend error during git polling
- **Impact**: UI silently shows stale data. User has no indication that git status is outdated.
- **Recommendation**: Add an `_error` signal that captures the last failure. Display a subtle warning icon in GitStatusBarComponent when error is set.

### Issue 9: ResizeObserver Firing During Terminal Hide

- **File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\terminal\terminal.component.ts:162-172`
- **Scenario**: Terminal tab is hidden (not active) -- `class.hidden` applied. ResizeObserver may still fire with 0x0 dimensions.
- **Impact**: `fitAddon.fit()` with zero dimensions could cause xterm layout issues. `resizeTerminal(id, 0, 0)` is sent to backend, but PtyManagerService guards against `cols > 0 && rows > 0`.
- **Recommendation**: Add a guard in the ResizeObserver callback: `if (container.offsetWidth === 0 || container.offsetHeight === 0) return;`

### Issue 10: AddWorktreeDialogComponent Does Not Trap Focus

- **File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\worktree\add-worktree-dialog.component.ts`
- **Scenario**: Modal is open, user presses Tab key
- **Impact**: Focus escapes to elements behind the backdrop, violating accessibility best practices
- **Recommendation**: Use Angular CDK's `FocusTrap` or manually manage focus trapping on mount.

### Issue 11: No Path Validation on addWorktree `path` Parameter

- **File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\git-info.service.ts:96-97`
- **Scenario**: User provides a custom path like `../../../../etc/sensitive`
- **Impact**: Worktree created outside project directory. Git itself provides some validation, but the path used for `worktreePath` is passed to `layoutService.addFolderByPath()` which registers it as a workspace folder unconditionally.
- **Recommendation**: Validate that the resolved worktree path is within or adjacent to the repository root.

## Minor Issues

### Issue 12: `_terminalCounter` Not Workspace-Partitioned

- **File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\terminal.service.ts:101`
- **Scenario**: Create 3 terminals in workspace A, switch to workspace B, create a terminal
- **Impact**: First terminal in workspace B is named "Terminal 4" instead of "Terminal 1"
- **Recommendation**: Store counter per workspace in `TerminalWorkspaceState`.

### Issue 13: Worktree `isMain` Detection Assumes First Entry

- **File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\git-info.service.ts:392`
- **Scenario**: `git worktree list --porcelain` output order may vary
- **Impact**: Unlikely to cause issues in practice since git lists the main worktree first, but the assumption is fragile
- **Recommendation**: Instead of `worktrees.length === 0`, check for a `bare` flag or compare to the `.git` directory path.

### Issue 14: Logger Type Casting Pattern

- **File**: Multiple files (e.g., `git-info.service.ts:42-45`, `pty-manager.service.ts:88-92`)
- **Scenario**: Logger API expects `Error` type for second parameter, but structured objects are passed with `as unknown as Error`
- **Impact**: No runtime issue, but loss of type safety and IDE error reporting
- **Recommendation**: Extend Logger interface to accept structured metadata, or use a wrapper.

### Issue 15: Hardcoded 30-Second RPC Timeout

- **File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\git-status.service.ts:293`, `terminal.service.ts:390`, `worktree.service.ts:158`
- **Scenario**: Git operations on very large repos may exceed 30 seconds. Conversely, simple operations should fail faster.
- **Impact**: Suboptimal timeout for different operation types
- **Recommendation**: Make timeout configurable per call, or at least use shorter timeouts for polling calls (5-10s) and longer for mutations (60s).

## Data Flow Analysis

```
[Git Status Flow]

1. EditorPanelComponent.ngOnInit()
   |-- gitStatus.startPolling()
       |-- fetchGitInfo()  <--- poll every 5s
           |-- rpcCall('git:info', {})
               |-- postMessage({ type: RPC_CALL, payload })
                   |-- preload.ts: ipcRenderer.send('rpc', msg)
                       |-- IpcBridge: rpcHandler.handleMessage()
                           |-- ElectronGitRpcHandlers.git:info()
                               |-- workspace.getWorkspaceRoot()  <-- CONCERN: Uses backend active workspace
                               |-- gitInfo.getGitInfo(wsRoot)
                                   |-- execGit(['status', '--porcelain=v2', '--branch'])
                                   |-- parseBranchInfo() + parseFileStatus()
                           |-- response via event.sender.send('to-renderer')
               |-- STALE RESPONSE CHECK (FIXED)
               |-- _branch.set(), _files.set(), _isGitRepo.set()
                   |-- saveCurrentState() to workspace map

2. FileTreeNodeComponent reads git status:
   |-- nodeGitStatus computed:
       |-- node().path (absolute) stripped of workspaceRoot prefix
       |-- gitStatus.fileStatusMap().get(relativePath)
           |-- CONCERN: Map has last-written entry for duplicate staged/unstaged

[Terminal Data Flow]

1. TerminalTabBarComponent: newTerminal() click
   |-- terminalService.createTerminal()
       |-- rpcCall('terminal:create', { name })
           |-- ElectronTerminalRpcHandlers.terminal:create()
               |-- ptyManager.create({ cwd, shell })
                   |-- pty.spawn(shell, [], { cwd, cols: 80, rows: 24 })
                   |-- ptyInstance.onData() -> dataCallback -> IpcBridge -> win.webContents.send('terminal:data-out')
               |-- response: { id, pid }
       |-- add tab to _tabs signal, set _activeTabId
       |-- CONCERN: data may arrive before xterm writer is registered

2. TerminalComponent.ngAfterViewInit() (runs AFTER createTerminal response):
   |-- new Terminal({ ... })
   |-- fitAddon.fit()
   |-- terminal.onData() -> terminalService.writeToTerminal() -> window.ptahTerminal.write()
   |-- terminalService.registerXtermWriter(id, (data) => terminal.write(data))
       |-- CONCERN: data received between step 1 response and this registration is DROPPED

3. Terminal data flow (steady state):
   User types -> xterm.onData() -> terminalService.writeToTerminal() -> window.ptahTerminal.write()
     -> preload: ipcRenderer.send('terminal:data-in') -> IpcBridge -> ptyManager.write()
   PTY output -> ptyManager.onData callback -> IpcBridge -> win.webContents.send('terminal:data-out')
     -> preload: ipcRenderer.on('terminal:data-out') -> callback -> terminalService._xtermWriters.get(id)(data)
     -> terminal.write(data) (runs outside Angular zone -- correct for performance)
```

### Gap Points Identified:

1. **Terminal data before writer registration**: Data dropped silently (Failure Mode 4)
2. **Staged/unstaged duplicate overwrite in fileStatusMap**: Last entry wins (Issue 5)
3. **PTY sessions not cleaned up on workspace removal**: Resource leak (Issue 3)
4. **Backend workspace root may differ from frontend**: RPC handlers resolve workspace from `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, which may be stale during rapid workspace switches

## Requirements Fulfillment

| Requirement                            | Status   | Concern                                                     |
| -------------------------------------- | -------- | ----------------------------------------------------------- |
| Git status bar with branch info        | COMPLETE | Works correctly for standard repos                          |
| Ahead/behind counts                    | COMPLETE | Only shown when upstream exists -- good                     |
| Changed file count                     | COMPLETE | May double-count staged+unstaged files                      |
| File tree git badges                   | COMPLETE | Fails for paths with spaces; only shows one status per file |
| Git status polling (5s)                | COMPLETE | No backoff on failure; ~~no stopPolling on destroy~~ FIXED  |
| Focus pause                            | COMPLETE | Correctly pauses on window blur                             |
| Workspace partitioning (git)           | COMPLETE | ~~Stale response race~~ FIXED                               |
| Terminal PTY spawn                     | COMPLETE | Works correctly with platform-specific shell detection      |
| Terminal binary IPC                    | COMPLETE | Well-designed separation from JSON RPC                      |
| Terminal tabs (create/switch/close)    | COMPLETE | Tab counter not workspace-partitioned                       |
| Terminal resize (ResizeObserver)       | COMPLETE | No guard for zero-dimension resize                          |
| WebGL fallback                         | COMPLETE | Properly handles context loss                               |
| Session limits (20 total, 5/workspace) | COMPLETE | Enforced correctly in PtyManagerService                     |
| Worktree list                          | COMPLETE | Works correctly                                             |
| Worktree add                           | COMPLETE | No path validation for custom paths                         |
| Worktree remove                        | COMPLETE | Works correctly                                             |
| Auto-register workspace folder         | COMPLETE | Correctly deduplicates and auto-switches                    |
| Workspace coordinator integration      | COMPLETE | Git + Terminal services properly wired                      |
| RPC registry entries                   | COMPLETE | All 6 methods in both interface and array                   |
| DI container registration              | COMPLETE | Proper token + singleton patterns                           |
| Terminal cleanup on dispose            | COMPLETE | `disposeAll()` called via `IpcBridge.dispose()`             |
| IPC bridge terminal handlers           | COMPLETE | Properly forwards data/exit/resize                          |
| Preload terminal API                   | COMPLETE | Returns cleanup functions for listeners                     |

### Implicit Requirements NOT Addressed:

1. PTY session cleanup when workspace folder is removed (orphaned processes)
2. Terminal tab invalidation after app restart (ghost tabs)
3. Git polling error visibility in UI
4. Accessibility focus trapping in worktree dialog modal
5. Terminal data buffering during component initialization gap

## Edge Case Analysis

| Edge Case                                | Handled | How                                                              | Concern                             |
| ---------------------------------------- | ------- | ---------------------------------------------------------------- | ----------------------------------- |
| Non-git workspace                        | YES     | `isGitRepo()` check returns false, GitStatusBar hidden           | None                                |
| Detached HEAD                            | YES     | Parsed as 'HEAD' in parseBranchInfo                              | None                                |
| Git not installed                        | YES     | `execGit` error caught, returns `isGitRepo: false`               | None                                |
| WebGL context loss                       | YES     | `onContextLoss` disposes addon, falls back to canvas             | None                                |
| Max terminal sessions (20)               | YES     | `PtyManagerService.create()` throws, RPC returns error           | Counter increments anyway (Issue 6) |
| Max per-workspace sessions (5)           | YES     | Same enforcement mechanism                                       | Same counter issue                  |
| Workspace removal while terminals active | PARTIAL | Frontend state cleared, **backend PTY sessions NOT killed**      | Issue 3                             |
| Rapid workspace switching                | PARTIAL | ~~No stale-response guard in fetchGitInfo~~ FIXED                | Backend workspace root may lag      |
| File paths with spaces                   | NO      | `split(' ')` parsing breaks                                      | Issue 4                             |
| Files with both staged+unstaged changes  | PARTIAL | Both entries emitted but Map overwrites                          | Issue 5                             |
| Empty workspace (no files)               | YES     | Returns empty arrays                                             | None                                |
| Very large repo (>10k files)             | PARTIAL | No pagination, 10s timeout on git commands                       | May timeout on large repos          |
| PTY exit during write                    | YES     | `sessions.delete(id)` in onExit, write to missing session logged | None                                |
| Multiple rapid "New Terminal" clicks     | PARTIAL | No debounce, could create multiple concurrent RPCs               | Issue 6                             |

## Integration Risk Assessment

| Integration                               | Failure Probability | Impact                          | Mitigation                            |
| ----------------------------------------- | ------------------- | ------------------------------- | ------------------------------------- |
| Git CLI -> GitInfoService                 | LOW                 | Incorrect status data           | 10s timeout, error handling           |
| GitInfoService -> ElectronGitRpcHandlers  | LOW                 | RPC error response              | Null workspace guard                  |
| Git RPC -> GitStatusService               | MED                 | Stale data on workspace switch  | FIXED: stale-response guard           |
| GitStatusService -> FileTreeNodeComponent | LOW                 | Missing badges                  | Path normalization handles most cases |
| node-pty -> PtyManagerService             | LOW                 | Terminal spawn failure          | Error propagated to frontend          |
| PtyManagerService -> IpcBridge            | LOW                 | Data forwarding failure         | Window null guard                     |
| IpcBridge -> preload -> TerminalService   | MED                 | Data before writer registered   | NOT MITIGATED: data dropped           |
| TerminalService -> TerminalComponent      | LOW                 | xterm rendering issues          | WebGL fallback in place               |
| WorktreeService -> ElectronLayoutService  | LOW                 | Workspace folder not registered | Deduplication handles re-adds         |
| WorkspaceCoordinator -> All services      | LOW                 | State out of sync on switch     | Synchronous coordination              |

## Verdict

**Recommendation**: NEEDS_REVISION
**Confidence**: HIGH
**Top Risk**: PTY session orphans on workspace removal (silent resource leak that accumulates)

## What Robust Implementation Would Include

A bulletproof version of this code would additionally have:

1. **PTY lifecycle management tied to workspace lifecycle**: When a workspace is removed, the coordinator should explicitly kill all PTY sessions for that workspace via `terminal:kill` RPC calls before clearing frontend state.

2. **Terminal data buffering**: `TerminalService` should maintain a `Map<string, string[]>` buffer per terminal ID. When `onData` fires with no registered writer, data goes to the buffer. When `registerXtermWriter` is called, the buffer is flushed to the writer, then cleared.

3. **Git status deduplication**: The `fileStatusMap` should use `Map<string, GitFileStatus[]>` (array per path) to handle files with both staged and unstaged changes. The file tree badge could show a composite indicator (e.g., "MA" for modified-staged + added-unstaged).

4. **Stale-response protection everywhere**: The worktree service and terminal service should capture the workspace path before async operations and verify it hasn't changed before applying results.

5. **Path parsing robustness**: Use the fixed-field-count nature of `git status --porcelain=v2` to extract paths correctly even when they contain spaces.

6. **Ghost tab detection**: On TerminalService initialization (or workspace switch), verify that cached terminal IDs still have live PTY sessions. Remove tabs for dead sessions.

7. **Polling error backoff**: After N consecutive git polling failures, increase the interval exponentially (5s -> 10s -> 30s -> 60s) and show a visual indicator.

8. **Focus trap in modal dialog**: Use Angular CDK's `A11yModule` with `cdkTrapFocus` on the dialog container.

## Fixes Applied in This Review

| #   | Severity | File                            | Fix                                                                                     |
| --- | -------- | ------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | CRITICAL | `git-status.service.ts:224-238` | Added stale-response guard: capture workspace path before RPC, discard if changed after |
| 2   | CRITICAL | `editor-panel.component.ts:243` | Added `this.gitStatus.stopPolling()` to `ngOnDestroy()` to prevent interval leak        |
