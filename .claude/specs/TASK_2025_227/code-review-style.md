# Code Style Review - TASK_2025_227 (Workspace Context Panel)

## Review Summary

| Metric          | Value                         |
| --------------- | ----------------------------- |
| Overall Score   | 6.5/10                        |
| Assessment      | NEEDS_REVISION (minor)        |
| Blocking Issues | 1                             |
| Serious Issues  | 5                             |
| Minor Issues    | 8                             |
| Files Reviewed  | 27 (15 created + 12 modified) |

## The 5 Critical Questions

### 1. What could break in 6 months?

The `rpcCall` method is duplicated verbatim across 4 services (EditorService, GitStatusService, TerminalService, WorktreeService). When the RPC protocol changes (timeout, error format, correlation strategy), someone will update one and miss the others. This is a maintenance time bomb.

The `PtyManagerService` uses a single `dataCallback` and single `exitCallback` (lines 36-37). If a second IPC bridge is ever instantiated or the callbacks need to be stacked (e.g., for logging/monitoring), the last-writer-wins pattern silently breaks the previous consumer.

The `fileStatusMap` computed signal in `GitStatusService` (line 114-120) recreates a new `Map` on every access when `_files` signal changes. For a workspace with 500+ changed files and a file tree rendering 1000+ nodes, this creates a Map object on every signal read, though the Map is referentially stable within a signal tick due to Angular's memoization. Acceptable now but worth monitoring.

### 2. What would confuse a new team member?

The DI token pattern for `GitInfoService` and `PtyManagerService` is inconsistent with the rest of the codebase. Both use a locally-defined `Symbol.for('...')` in each consumer file (`electron-git-rpc.handlers.ts:28`, `electron-terminal-rpc.handlers.ts:27`, `container.ts:153,157`) rather than centralizing the symbol in a `TOKENS` or `PLATFORM_TOKENS` object. A new developer would wonder why these services don't follow the `TOKENS.XXX` pattern used everywhere else.

The split between "terminal lifecycle via JSON RPC" and "terminal data via binary IPC" is architecturally sound but not obvious. The `TerminalService` uses `rpcCall()` for create/kill but `window.ptahTerminal.*` for data/resize. There's a comment explaining this, but the dual communication channel is a conceptual hurdle.

### 3. What's the hidden complexity cost?

**rpcCall duplication**: 4 identical ~30-line methods across 4 services = 120 lines of copy-pasted code. Each has the same timeout (30s), same correlation logic, same error extraction. Any bug fix or enhancement must be applied 4 times. The original `EditorService` established this pattern; the 3 new services copied it instead of extracting a shared utility.

**Workspace state partitioning**: Now 4 services each maintain their own `Map<string, *WorkspaceState>` with identical save/restore/remove patterns. The workspace lifecycle (switch, remove) must be coordinated across all 4 services in `WorkspaceCoordinatorService`. Adding a 5th workspace-partitioned service means updating the coordinator.

### 4. What pattern inconsistencies exist?

- **Access modifiers**: Icons and template-bound signals/methods were inconsistently marked. Some components used `protected` for template bindings (matching EditorPanelComponent pattern), others used implicit `public`. **Fixed in this review** -- all template-bound members now use `protected`.
- **`canSubmit` was a method, not a computed signal**: AddWorktreeDialogComponent used a plain method for a derived state check, while the codebase convention is `computed()`. **Fixed in this review**.
- **DI token placement**: `GIT_INFO_SERVICE` and `PTY_MANAGER_SERVICE` symbols are defined locally in each file that uses them, rather than in a shared token file. All other backend services use `TOKENS.*` or `PLATFORM_TOKENS.*`.
- **GitInfoService is NOT @injectable()**: It's a plain class instantiated manually in the DI container, while all other RPC handler dependencies use `@injectable()` + tsyringe. The pattern works but diverges from the existing handler pattern (see `ElectronEditorRpcHandlers` which injects all deps via `@inject()`).

### 5. What would I do differently?

1. **Extract `rpcCall` to a shared utility function or base class** in `@ptah-extension/core`. Something like:

   ```typescript
   // In @ptah-extension/core
   export function createRpcCaller(vscodeService: VSCodeService) {
     return function rpcCall<T>(method: string, params: Record<string, unknown>): Promise<RpcCallResult<T>> { ... }
   }
   ```

   This eliminates 90+ lines of duplication and ensures protocol changes are made once.

2. **Register DI tokens centrally**: Add `GIT_INFO_SERVICE` and `PTY_MANAGER_SERVICE` to an appropriate token file (e.g., a new `ELECTRON_TOKENS` or extend `PLATFORM_TOKENS`).

3. **Consider a workspace state mixin or base class**: The identical `_workspaceXxxState` + `saveCurrentState()` + `switchWorkspace()` + `removeWorkspaceState()` pattern appears in 4 services now. A `WorkspacePartitionedService<T>` abstract base could eliminate this repetition.

---

## Blocking Issues

### Issue 1: Duplicated rpcCall method across 4 services

- **Files**:
  - `libs/frontend/editor/src/lib/services/editor.service.ts:570-613`
  - `libs/frontend/editor/src/lib/services/git-status.service.ts:286-329`
  - `libs/frontend/editor/src/lib/services/terminal.service.ts:383-426`
  - `libs/frontend/editor/src/lib/services/worktree.service.ts:151-194`
- **Problem**: The `rpcCall<T>()` private method is copy-pasted verbatim across 4 Angular services. Each copy is ~30 lines with identical timeout handling, correlation ID generation, message listener setup, and error extraction. Even the JSDoc is copy-pasted ("Matches the EditorService.rpcCall() pattern exactly").
- **Impact**: Any protocol change (e.g., changing timeout from 30s, adding retry logic, supporting cancellation) must be applied in 4 places. Bugs found in one copy won't be fixed in others. This is the most significant technical debt introduced by this task.
- **Fix**: Extract to a shared utility function in `@ptah-extension/core` or create a base service class. Not fixed in this review because it requires cross-library refactoring beyond the scope of style fixes. **Recommendation: Create a follow-up ticket.**

---

## Serious Issues

### Issue 1: DI token symbols defined locally rather than centrally

- **Files**:
  - `apps/ptah-electron/src/services/rpc/handlers/electron-git-rpc.handlers.ts:28`
  - `apps/ptah-electron/src/services/rpc/handlers/electron-terminal-rpc.handlers.ts:27`
  - `apps/ptah-electron/src/di/container.ts:153,157`
- **Problem**: `const GIT_INFO_SERVICE = Symbol.for('GitInfoService')` and `const PTY_MANAGER_SERVICE = Symbol.for('PtyManagerService')` are defined independently in each file that uses them. While `Symbol.for()` ensures the same symbol across files, this pattern bypasses the project's centralized `TOKENS` / `PLATFORM_TOKENS` approach.
- **Tradeoff**: `Symbol.for()` makes it work, but a developer searching for "GIT_INFO_SERVICE" must find all 3 definitions. Adding a 4th consumer requires re-declaring the symbol.
- **Recommendation**: Move these to a shared electron tokens file or add to `PLATFORM_TOKENS`.

### Issue 2: PtyManagerService single-callback pattern

- **File**: `apps/ptah-electron/src/services/pty-manager.service.ts:36-37`
- **Problem**: `dataCallback` and `exitCallback` are single slots (`DataCallback | null`). Calling `onData()` or `onExit()` a second time silently replaces the previous callback. The code comment says "Called by IpcBridge" but there's no guard preventing double-registration.
- **Tradeoff**: Currently only one IpcBridge exists, so this works. But it's fragile -- if testing or hot-reload scenarios call `onData()` twice, the first listener is silently lost.
- **Recommendation**: Either add an assertion/warning when overwriting a non-null callback, or switch to an array of callbacks (EventEmitter pattern).

### Issue 3: GitStatusService polling not stopped on destroy of EditorPanelComponent

- **File**: `libs/frontend/editor/src/lib/services/git-status.service.ts:191-204`
- **Problem**: `startPolling()` is called in `EditorPanelComponent.ngOnInit()`. `GitStatusService` registers `this.destroyRef.onDestroy(() => this.stopPolling())` in its constructor, so polling stops when the service is destroyed. However, as a `providedIn: 'root'` service, it is never destroyed during the app lifecycle. If the editor panel is hidden/destroyed but the service keeps polling, it wastes CPU/RPC calls for invisible UI.
- **Tradeoff**: The focus/blur pausing mitigates this somewhat. But if the user never switches away from the window, polling continues even when the editor panel is not visible.
- **Recommendation**: Either call `stopPolling()` in `EditorPanelComponent.ngOnDestroy()` or make the polling conditional on editor panel visibility.

### Issue 4: Logger abuse pattern -- passing objects as `Error`

- **Files**: Multiple files use `as unknown as Error` cast when calling logger methods:
  - `apps/ptah-electron/src/services/git-info.service.ts:42-45`
  - `apps/ptah-electron/src/services/pty-manager.service.ts:88-92`
  - `apps/ptah-electron/src/services/rpc/handlers/electron-git-rpc.handlers.ts:114-118`
  - `apps/ptah-electron/src/services/rpc/handlers/electron-terminal-rpc.handlers.ts:58-62`
- **Problem**: The pattern `this.logger.warn('[...] message', { ... } as unknown as Error)` casts plain objects to `Error` to satisfy the Logger interface. This is a pre-existing pattern in the codebase (seen in `ElectronEditorRpcHandlers`), but it's a type safety violation. The Logger's `warn`/`info`/`error` methods expect an `Error` object but receive plain metadata objects.
- **Tradeoff**: The existing codebase already does this, so it's consistent. But it's technically a lie to the type system.
- **Recommendation**: Not a blocker for this PR since it's a pre-existing pattern. A separate ticket could update the Logger interface to accept structured metadata.

### Issue 5: No input validation on terminal resize dimensions

- **File**: `apps/ptah-electron/src/services/pty-manager.service.ts:159-171`
- **Problem**: `resize(id, cols, rows)` only checks `cols > 0 && rows > 0`. There's no upper-bound validation. A malicious or buggy renderer could send `resize(id, 999999, 999999)` which would be passed directly to `node-pty`. While `node-pty` likely handles this gracefully, there's no validation at the application layer.
- **Tradeoff**: Low risk in practice since the renderer is our own Angular code.
- **Recommendation**: Add reasonable upper bounds (e.g., cols <= 1000, rows <= 500).

---

## Minor Issues

### Issue 1: Missing `protected` on template-bound members [FIXED]

- **Files**: `git-status-bar.component.ts`, `terminal-tab-bar.component.ts`, `add-worktree-dialog.component.ts`
- **Problem**: Template-bound signals, methods, and icon references lacked `protected` modifier, making them implicitly `public`. The codebase convention (see EditorPanelComponent) uses `protected` for template bindings.
- **Fix Applied**: Added `protected` to all template-bound members in the 3 files above.

### Issue 2: `canSubmit` was a method instead of computed signal [FIXED]

- **File**: `libs/frontend/editor/src/lib/worktree/add-worktree-dialog.component.ts`
- **Problem**: `canSubmit()` was a regular method returning a boolean, while the codebase convention uses `computed()` for derived state.
- **Fix Applied**: Converted to `protected readonly canSubmit = computed(...)` and added `computed` import.

### Issue 3: `_terminalCounter` not workspace-partitioned

- **File**: `libs/frontend/editor/src/lib/services/terminal.service.ts:101`
- **Problem**: `_terminalCounter` is a single number, not partitioned by workspace. When switching workspaces, the counter continues incrementing from where it left off, so workspace B might show "Terminal 4" as its first terminal if workspace A already created 3.
- **Recommendation**: Reset counter on workspace switch, or include workspace name in the counter key.

### Issue 4: `HIDDEN_SKIP` Set created inside loop

- **File**: `apps/ptah-electron/src/services/rpc/handlers/electron-editor-rpc.handlers.ts:273-286`
- **Problem**: A `new Set()` is created inside the `for (const entry of sorted)` loop for every dot-prefixed file. This is a pre-existing issue (not introduced by this task), but worth noting since the new code follows the same file tree scanning pattern.
- **Recommendation**: Move `HIDDEN_SKIP` to module scope as a constant.

### Issue 5: Worktree `isMain` detection is fragile

- **File**: `apps/ptah-electron/src/services/git-info.service.ts:392`
- **Problem**: `isMain: worktrees.length === 0` assumes the first worktree block in `git worktree list --porcelain` output is always the main worktree. While git does list the main worktree first, this is an implementation detail not guaranteed by the git documentation.
- **Recommendation**: Parse for the presence of a `bare` flag or check against the `.git` directory location for more robust detection.

### Issue 6: No error propagation in `loadWorktrees`

- **File**: `libs/frontend/editor/src/lib/services/worktree.service.ts:53-63`
- **Problem**: `loadWorktrees()` silently ignores RPC failures. If `result.success` is false, the worktree list simply isn't updated, and the user sees no error.
- **Recommendation**: Log the error or expose an error signal.

### Issue 7: `process.env` cast in PtyManagerService

- **File**: `apps/ptah-electron/src/services/pty-manager.service.ts:99`
- **Problem**: `process.env as Record<string, string>` is incorrect -- `process.env` has type `Record<string, string | undefined>`. The cast hides potential `undefined` values. This doesn't cause runtime issues because node-pty handles undefined env values, but it's a type system lie.
- **Recommendation**: Use `{ ...process.env }` without the cast, or filter out undefined values.

### Issue 8: `gitStatus.startPolling()` called without corresponding stop

- **File**: `libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts:239`
- **Problem**: `ngOnInit` calls `this.gitStatus.startPolling()` but `ngOnDestroy` does not call `this.gitStatus.stopPolling()`. Related to Serious Issue 3 above.
- **Recommendation**: Add `this.gitStatus.stopPolling()` to `ngOnDestroy()`.

---

## File-by-File Analysis

### `libs/shared/src/lib/types/rpc/rpc-git.types.ts`

**Score**: 8/10
**Issues Found**: 0 blocking, 0 serious, 0 minor

Well-structured type definitions with proper JSDoc. Uses `Record<string, never>` for empty params (matching existing pattern). All interfaces are properly exported. Clean separation of request/response types per RPC method.

### `libs/shared/src/lib/types/rpc/rpc-terminal.types.ts`

**Score**: 8/10
**Issues Found**: 0 blocking, 0 serious, 0 minor

Minimal and focused. Only defines what's needed for JSON RPC lifecycle (create/kill/resize). Correctly notes that resize is binary IPC, not JSON RPC.

### `apps/ptah-electron/src/services/git-info.service.ts`

**Score**: 7/10
**Issues Found**: 0 blocking, 1 serious (logger cast), 1 minor (isMain detection)

Solid implementation. Good timeout handling with `settled` flag to prevent double-resolution. The `--porcelain=v2` parsing is thorough with proper handling of ordinary, rename/copy, unmerged, and untracked entries. The `mapStatusCode` method has a reasonable default-to-M fallback.

### `apps/ptah-electron/src/services/rpc/handlers/electron-git-rpc.handlers.ts`

**Score**: 7/10
**Issues Found**: 0 blocking, 1 serious (DI token), 0 minor

Follows the `ElectronEditorRpcHandlers` pattern exactly. Type-safe RPC method registration. Proper workspace root validation. The `type` import for `GitInfoService` is correct (avoids circular dependency).

### `apps/ptah-electron/src/services/pty-manager.service.ts`

**Score**: 6/10
**Issues Found**: 0 blocking, 2 serious (single callback, resize validation), 1 minor (env cast)

Functional but has the single-callback fragility issue. Good session limiting (20 total, 5 per workspace). Shell detection is correct for cross-platform. `disposeAll()` is proper cleanup.

### `apps/ptah-electron/src/services/rpc/handlers/electron-terminal-rpc.handlers.ts`

**Score**: 7/10
**Issues Found**: 0 blocking, 1 serious (DI token), 0 minor

Clean and minimal. Only handles create/kill -- data flow correctly delegated to binary IPC. Falls back to `process.cwd()` when no workspace root is available.

### `libs/frontend/editor/src/lib/services/git-status.service.ts`

**Score**: 6/10
**Issues Found**: 1 blocking (rpcCall duplication), 1 serious (polling lifecycle), 0 minor

Good workspace partitioning and polling with focus/blur awareness. The `NgZone.runOutsideAngular` for the interval is correct. The `computed` signals for derived state (changedFileCount, fileStatusMap) are well-designed.

### `libs/frontend/editor/src/lib/git-status-bar/git-status-bar.component.ts`

**Score**: 7/10
**Issues Found**: 0 blocking, 0 serious, 1 minor (access modifiers -- fixed)

Clean component with good accessibility (role="status", aria-label, aria-hidden on icons). Proper use of DaisyUI classes. The conditional worktree indicator and upstream ahead/behind display are well-structured.

### `libs/frontend/editor/src/lib/types/terminal.types.ts`

**Score**: 8/10
**Issues Found**: 0 blocking, 0 serious, 0 minor

Clean type definitions. The `declare global` block for `window.ptahTerminal` is the correct pattern for Electron preload bridge types. `TerminalTab` interface is well-documented.

### `libs/frontend/editor/src/lib/services/terminal.service.ts`

**Score**: 6/10
**Issues Found**: 1 blocking (rpcCall duplication), 0 serious, 1 minor (counter not partitioned)

Good binary IPC integration. The `setupBinaryIpcListeners` correctly runs data callbacks outside Angular zone for performance. The xterm writer registration pattern is clean.

### `libs/frontend/editor/src/lib/terminal/terminal.component.ts`

**Score**: 7/10
**Issues Found**: 0 blocking, 0 serious, 0 minor

Well-implemented xterm.js wrapper. WebGL fallback to canvas is properly handled including context loss. ResizeObserver for auto-fit is correct. Running init outside Angular zone is the right call for xterm's internal rendering loop. Proper cleanup in ngOnDestroy.

### `libs/frontend/editor/src/lib/terminal/terminal-tab-bar.component.ts`

**Score**: 7/10
**Issues Found**: 0 blocking, 0 serious, 1 minor (access modifiers -- fixed)

Clean UI component. Good exit state visualization. Tab switching and close button patterns match EditorPanelComponent's tab bar.

### `libs/frontend/editor/src/lib/terminal/terminal-panel.component.ts`

**Score**: 8/10
**Issues Found**: 0 blocking, 0 serious, 0 minor

The `[class.hidden]` approach instead of `@if` for tab preservation is a smart design decision, correctly documented. Minimal complexity.

### `libs/frontend/editor/src/lib/services/worktree.service.ts`

**Score**: 6/10
**Issues Found**: 1 blocking (rpcCall duplication), 0 serious, 1 minor (silent failure)

Good auto-registration of new worktrees as workspace folders via `layoutService.addFolderByPath()`. Optimistic UI update on removeWorktree (filtering local list before awaiting RPC) is a nice touch.

### `libs/frontend/editor/src/lib/worktree/add-worktree-dialog.component.ts`

**Score**: 7/10
**Issues Found**: 0 blocking, 0 serious, 2 minor (access modifiers + canSubmit -- both fixed)

Good modal pattern with backdrop click dismiss and Escape key handling. Form state is signal-based. Loading state and error message display are handled properly.

### `libs/shared/src/lib/types/rpc.types.ts`

**Score**: 8/10
**Issues Found**: 0 blocking, 0 serious, 0 minor

Git and terminal RPC methods correctly added to both the `RpcMethodRegistry` interface and the `RPC_METHOD_NAMES` runtime array. Imports are properly grouped with other domain-specific type imports.

### `apps/ptah-electron/src/preload.ts`

**Score**: 8/10
**Issues Found**: 0 blocking, 0 serious, 0 minor

Clean binary IPC bridge implementation. The cleanup function return pattern for `onData` and `onExit` is well-designed for preventing memory leaks. Using `contextBridge.exposeInMainWorld` is the correct Electron security pattern.

### `apps/ptah-electron/src/ipc/ipc-bridge.ts`

**Score**: 7/10
**Issues Found**: 0 blocking, 0 serious, 0 minor

Terminal handler setup is clean. The optional `ptyManager` parameter in the constructor is a reasonable approach. `dispose()` properly removes all terminal IPC listeners and calls `ptyManager.disposeAll()`.

### `libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts`

**Score**: 8/10
**Issues Found**: 0 blocking, 0 serious, 0 minor

Clean integration of `GitStatusService` and `TerminalService` into the workspace coordination flow. Both switchWorkspace and removeWorkspaceState correctly delegate to the new services.

### `libs/frontend/core/src/lib/services/electron-layout.service.ts`

**Score**: 7/10
**Issues Found**: 0 blocking, 0 serious, 0 minor

The new `addFolderByPath()` method is well-designed with deduplication and auto-switch. Follows the existing `addFolder()` pattern closely.

### `libs/frontend/editor/src/lib/file-tree/file-tree-node.component.ts`

**Score**: 7/10
**Issues Found**: 0 blocking, 0 serious, 0 minor

Good git status integration. Path normalization (backslash to forward slash) handles Windows correctly. The `gitStatusColor` computed signal maps status codes to DaisyUI color classes consistently.

### `libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts`

**Score**: 7/10
**Issues Found**: 0 blocking, 0 serious, 1 minor (missing stopPolling in ngOnDestroy)

Good layout integration. Terminal resize via drag handle with NgZone optimization is well-implemented. Minimum/maximum height clamping is correct.

### `libs/frontend/editor/src/index.ts`

**Score**: 8/10
**Issues Found**: 0 blocking, 0 serious, 0 minor

Clean barrel file. All new components and services properly exported. Type-only exports for interfaces. Good module documentation comment.

---

## Pattern Compliance

| Pattern               | Status | Concern                                                                               |
| --------------------- | ------ | ------------------------------------------------------------------------------------- |
| Signal-based state    | PASS   | All new services use signals with asReadonly() and computed()                         |
| Type safety           | PASS   | Proper typed RPC params/results, no `any` types found                                 |
| DI patterns           | WARN   | GitInfoService/PtyManagerService use ad-hoc Symbol.for tokens instead of TOKENS.\*    |
| Layer separation      | PASS   | Types in shared, backend logic in electron, frontend in editor lib                    |
| OnPush everywhere     | PASS   | All components use ChangeDetectionStrategy.OnPush                                     |
| Standalone components | PASS   | All new components are standalone                                                     |
| inject() over ctor    | PASS   | All Angular services use inject(), backend uses @inject() (tsyringe) correctly        |
| kebab-case files      | PASS   | All file names follow kebab-case convention                                           |
| Error handling        | WARN   | Some RPC errors silently swallowed (loadWorktrees), logger `as unknown as Error` cast |
| DaisyUI/Tailwind      | PASS   | Consistent class usage, no inline styles                                              |
| Accessibility         | PASS   | role, aria-label, aria-hidden used consistently                                       |
| Import organization   | PASS   | Grouped by source (angular, third-party, internal)                                    |

---

## Technical Debt Assessment

**Introduced**:

- 4x copy-pasted `rpcCall` method (~120 lines of duplication)
- 4x copy-pasted workspace partitioning pattern (save/restore/remove state maps)
- 2x ad-hoc DI token symbols not in centralized token files
- Logger `as unknown as Error` pattern propagated to 4 new files

**Mitigated**:

- Workspace coordinator properly extended (no shortcuts)
- RPC method registry correctly updated (both interface and runtime array)
- Allowed method prefixes updated in rpc-handler.ts

**Net Impact**: Moderate debt increase. The rpcCall duplication is the primary concern -- it's the kind of copy-paste that starts at 2 copies, becomes 4, then 8, and eventually someone refactors it in a "cleanup sprint" that touches 20 files.

---

## Verdict

**Recommendation**: NEEDS_REVISION (minor)
**Confidence**: HIGH
**Key Concern**: The `rpcCall` duplication across 4 services is the single most significant issue. Everything else is either fixed in this review or is a non-blocking concern.

The code is functional, well-documented, follows existing patterns (including their warts), and integrates cleanly. The architecture decisions (binary IPC for terminal data, polling with focus awareness, workspace partitioning) are sound. The issues found are primarily about code hygiene and long-term maintainability, not correctness.

**Action items**:

1. **Now**: Merge with access modifier fixes applied in this review
2. **Next sprint**: Extract `rpcCall` to a shared utility (eliminates blocking issue)
3. **Backlog**: Centralize DI tokens, consider workspace state base class, add stopPolling in ngOnDestroy

---

## What Excellence Would Look Like

A 10/10 implementation would include:

1. **Shared RPC utility**: `rpcCall` extracted to `@ptah-extension/core` as a reusable function, injected into services
2. **Workspace state abstraction**: A `WorkspacePartitionedService<T>` base that handles the save/restore/remove Map pattern
3. **Centralized DI tokens**: `GIT_INFO_SERVICE` and `PTY_MANAGER_SERVICE` in a `ELECTRON_TOKENS` constant
4. **Integration tests**: At least basic tests for `GitInfoService.parseBranchInfo()` and `parseFileStatus()` with sample `git status --porcelain=v2` output
5. **Defensive resize bounds**: Upper-limit validation on terminal resize dimensions
6. **Proper Logger interface**: Logger accepting structured metadata objects without `as unknown as Error` casts
7. **Polling lifecycle management**: EditorPanelComponent calling `gitStatus.stopPolling()` on destroy
8. **EventEmitter pattern for PTY callbacks**: Multiple listeners instead of single-callback slots

---

## Issues Fixed in This Review

| #   | Severity | File                               | Fix                                                                                                                                        |
| --- | -------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | MINOR    | `git-status-bar.component.ts`      | Added `protected` to `showAddWorktreeDialog`, `worktreeCount`, `toggleAddWorktreeDialog`, `onWorktreeCreated`, `onWorktreeDialogCancelled` |
| 2   | MINOR    | `terminal-tab-bar.component.ts`    | Added `protected` to `PlusIcon`, `XIcon`, `TerminalIcon`, `newTerminal`, `closeTab`                                                        |
| 3   | MINOR    | `add-worktree-dialog.component.ts` | Converted `canSubmit()` method to `computed()` signal; added `protected` to all template-bound form signals, methods, and icons            |
