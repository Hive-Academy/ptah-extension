# Development Tasks - TASK_2025_228

**Total Tasks**: 8 | **Batches**: 3 | **Status**: 3/3 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- `PtyManagerService.killAllForWorkspace()` exists and works: VERIFIED (pty-manager.service.ts:203-213)
- `Symbol.for()` ensures same symbol across files: VERIFIED (but inconsistent with project DI conventions)
- Git porcelain v2 type 1 has exactly 8 space-separated fields before the path: VERIFIED per git documentation
- `fileStatusMap` uses `map.set(file.path, file)` causing last-writer-wins: VERIFIED (git-status.service.ts:114-120)
- `rpcCall` is copy-pasted identically across 4 services: VERIFIED (editor.service.ts:570-613, git-status.service.ts:296-339, terminal.service.ts:383-426, worktree.service.ts:151-194)
- Terminal data is dropped when no writer is registered: VERIFIED (terminal.service.ts:326-333 -- `if (writer) { writer(data); }`)

### Risks Identified

| Risk                                                                                                           | Severity | Mitigation                                                                |
| -------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------- |
| Fix #1 requires adding RPC calls in removeWorkspaceState which is synchronous                                  | MED      | Use fire-and-forget pattern (kill calls don't need to await)              |
| Fix #3 changes `fileStatusMap` return type from `Map<string, GitFileStatus>` to `Map<string, GitFileStatus[]>` | MED      | Must update FileTreeNodeComponent consumer to handle array                |
| Fix #5 extracting rpcCall creates a new utility file -- must not break circular imports                        | LOW      | Place utility in editor lib's services folder, no cross-lib import needed |
| Fix #4 buffer must be flushed in correct order and cleared to avoid memory leaks                               | LOW      | Use string array per terminal ID, clear on flush                          |

### Edge Cases to Handle

- [x] Fix #2: Rename/copy entries (type 2) also have spaces-in-path issue for the portion before the tab character
- [x] Fix #2: Unmerged entries (type u) have 10 fields before the path, not 8
- [x] Fix #3: FileTreeNodeComponent.nodeGitStatus returns a single GitFileStatus -- needs to pick priority (staged > unstaged)
- [x] Fix #4: If registerXtermWriter is never called (terminal killed before mount), buffer should be cleaned up
- [x] Fix #1: TerminalService.removeWorkspaceState must kill terminals BEFORE clearing state (otherwise tab IDs are lost)

---

## Batch 1: Backend Fixes (Git Path Parsing + DI Token Centralization) COMPLETE

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: None
**Commit**: 4f8ae87c

### Task 1.1: Fix git porcelain v2 path parsing for paths with spaces COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\git-info.service.ts`
**Spec Reference**: code-review-logic.md: Failure Mode 5, Issue 4
**Pattern to Follow**: git-info.service.ts:274-327 (the `parseFileStatus` method)

**Quality Requirements**:

- Type 1 entries (`1 XY sub mH mI mW hH hI path`): Use fixed-index slicing -- 8 space-separated fields before the path. Extract path as `parts.slice(8).join(' ')`
- Type 2 entries (`2 XY sub mH mI mW hH hI X<score> path<tab>origPath`): The path field before tab ALSO needs fixed-index extraction. The `X<score>` field is at index 8, and the path starts at index 9. Use `parts.slice(9).join(' ')` for the portion before the tab
- Unmerged entries (`u XY sub m1 m2 m3 mW h1 h2 h3 path`): 10 space-separated fields before the path. Extract path as `parts.slice(10).join(' ')`
- Untracked entries (`? path`): Already correct -- uses `line.substring(2)`

**Implementation Details**:

- In `parseFileStatus()`, replace all `parts[parts.length - 1]` patterns with fixed-index slicing
- For type 1: `const filePath = parts.slice(8).join(' ');`
- For type 2: Split line on tab first. For the portion before tab: `const beforeTabParts = beforeTab.split(' '); const filePath = beforeTabParts.slice(9).join(' ');`
- For unmerged: `const filePath = parts.slice(10).join(' ');`
- Keep the untracked (`?`) parsing as-is since it already uses `line.substring(2)`

---

### Task 1.2: Create centralized Electron DI tokens file COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\di\electron-tokens.ts` (NEW FILE)
**Spec Reference**: code-review-style.md: Serious Issue 1
**Pattern to Follow**: `@ptah-extension/vscode-core` TOKENS pattern and `@ptah-extension/platform-core` PLATFORM_TOKENS pattern

**Quality Requirements**:

- Create a single file that exports an `ELECTRON_TOKENS` object with `GIT_INFO_SERVICE` and `PTY_MANAGER_SERVICE` symbols
- Use `Symbol.for()` for consistency with existing tokens (ensures cross-file reference works)
- Export both the object and the individual symbols for ergonomic usage

**Implementation Details**:

```typescript
/**
 * Electron-specific DI tokens for services that are only used in the Electron app.
 * Centralized to avoid duplicate Symbol.for() definitions across consumer files.
 *
 * TASK_2025_228: Centralize DI tokens (Fix #6 from TASK_2025_227 QA review)
 */
export const ELECTRON_TOKENS = {
  GIT_INFO_SERVICE: Symbol.for('GitInfoService'),
  PTY_MANAGER_SERVICE: Symbol.for('PtyManagerService'),
} as const;
```

---

### Task 1.3: Replace local Symbol.for definitions with centralized tokens COMPLETE

**Files**:

- `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\electron-git-rpc.handlers.ts`
- `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\electron-terminal-rpc.handlers.ts`
- `D:\projects\ptah-extension\apps\ptah-electron\src\di\container.ts`

**Spec Reference**: code-review-style.md: Serious Issue 1
**Dependencies**: Task 1.2

**Quality Requirements**:

- Remove the local `const GIT_INFO_SERVICE = Symbol.for('GitInfoService')` from all 3 files
- Remove the local `const PTY_MANAGER_SERVICE = Symbol.for('PtyManagerService')` from container.ts and electron-terminal-rpc.handlers.ts
- Import `ELECTRON_TOKENS` from the new tokens file and use `ELECTRON_TOKENS.GIT_INFO_SERVICE` and `ELECTRON_TOKENS.PTY_MANAGER_SERVICE`

**Implementation Details**:

- In `electron-git-rpc.handlers.ts`: Remove line 28, add import, change `@inject(GIT_INFO_SERVICE)` to `@inject(ELECTRON_TOKENS.GIT_INFO_SERVICE)`
- In `electron-terminal-rpc.handlers.ts`: Remove line 27, add import, change `@inject(PTY_MANAGER_SERVICE)` to `@inject(ELECTRON_TOKENS.PTY_MANAGER_SERVICE)`
- In `container.ts`: Remove lines 153 and 157 (the local const definitions), add import, change `container.register(GIT_INFO_SERVICE, ...)` and `container.register(PTY_MANAGER_SERVICE, ...)` to use `ELECTRON_TOKENS.*`

---

**Batch 1 Verification**:

- All files exist at paths
- Build passes: `npx nx build ptah-electron`
- code-logic-reviewer approved
- Git paths with spaces parse correctly (type 1, 2, unmerged)
- DI tokens resolve to the same symbols as before (Symbol.for ensures backward compatibility)

---

## Batch 2: Frontend Editor Fixes (rpcCall Dedup + Staged/Unstaged Collision) COMPLETE

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: None (independent of Batch 1)
**Commit**: c909f51a

### Task 2.1: Extract shared rpcCall utility function COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\rpc-call.util.ts` (NEW FILE)
**Spec Reference**: code-review-style.md: Blocking Issue 1
**Pattern to Follow**: editor.service.ts:570-613 (the canonical rpcCall implementation)

**Quality Requirements**:

- Extract the rpcCall pattern into a standalone utility function
- Function signature: `rpcCall<T>(vscodeService: VSCodeService, method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<RpcCallResult<T>>`
- Export a `RpcCallResult<T>` type: `{ success: boolean; data?: T; error?: string }`
- Default timeout: 30000ms (matching current behavior)
- Must handle the same correlationId, timeout, message listener, and error extraction logic

**Implementation Details**:

- Import `VSCodeService` from `@ptah-extension/core` and `MESSAGE_TYPES` from `@ptah-extension/shared`
- The function takes `vscodeService` as a parameter (not injected) so it can be called from any service
- Export from `libs/frontend/editor/src/index.ts` for potential future use by other libs
- JSDoc explaining the correlation-based RPC pattern

---

### Task 2.2: Replace rpcCall in all 4 services with shared utility COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor.service.ts`
- `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\git-status.service.ts`
- `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\terminal.service.ts`
- `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\worktree.service.ts`

**Spec Reference**: code-review-style.md: Blocking Issue 1
**Dependencies**: Task 2.1

**Quality Requirements**:

- Remove the private `rpcCall` method from all 4 services
- Replace all calls to `this.rpcCall(...)` with calls to the imported `rpcCall(this.vscodeService, ...)`
- Verify no behavior change -- same timeout, same correlation, same error handling
- Remove the `MESSAGE_TYPES` import from services that no longer directly reference it (if rpcCall was the only consumer)

**Implementation Details**:

- In each service: `import { rpcCall } from './rpc-call.util';`
- Change all call sites from `this.rpcCall<T>(method, params)` to `rpcCall<T>(this.vscodeService, method, params)`
- The `vscodeService` is already a private field in all 4 services, so just reference it
- ~120 lines of duplicated code removed across 4 files

---

### Task 2.3: Fix staged/unstaged file collision in fileStatusMap COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\git-status.service.ts`
**Also touches**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\file-tree\file-tree-node.component.ts`
**Spec Reference**: code-review-logic.md: Issue 5

**Quality Requirements**:

- `fileStatusMap` must preserve BOTH staged and unstaged entries for the same path
- Change Map type from `Map<string, GitFileStatus>` to `Map<string, GitFileStatus[]>`
- When a path appears multiple times (once staged, once unstaged), both entries are in the array
- Update `FileTreeNodeComponent.nodeGitStatus` to handle the array: pick the staged entry if it exists (staged changes are more significant for the tree badge), falling back to the first entry

**Validation Notes**:

- The `changedFileCount` computed signal counts `_files().length` which double-counts files with both staged and unstaged changes. This is actually correct behavior (shows total change count, not unique file count).

**Implementation Details**:

- In `git-status.service.ts`, change `fileStatusMap` computed:
  ```typescript
  readonly fileStatusMap = computed(() => {
    const map = new Map<string, GitFileStatus[]>();
    for (const file of this._files()) {
      const existing = map.get(file.path);
      if (existing) {
        existing.push(file);
      } else {
        map.set(file.path, [file]);
      }
    }
    return map;
  });
  ```
- In `file-tree-node.component.ts`, update `nodeGitStatus` computed to handle the array:
  ```typescript
  // Get entries for this path (may include both staged and unstaged)
  const entries = this.gitStatus.fileStatusMap().get(relativePath);
  if (!entries || entries.length === 0) return undefined;
  // Prefer staged entry for the badge (it's more significant)
  return entries.find((e) => e.staged) ?? entries[0];
  ```

---

**Batch 2 Verification**:

- All files exist at paths
- Build passes: `npx nx build ptah-extension-webview`
- code-logic-reviewer approved
- rpcCall removed from all 4 services, replaced with shared utility
- Files with both staged+unstaged changes display correctly in file tree

---

## Batch 3: Terminal Fixes (PTY Kill on Workspace Removal + Data Buffer) COMPLETE

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: None (independent of Batch 1 and 2)
**Commit**: 0af95727

### Task 3.1: Kill PTY sessions on workspace removal COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\terminal.service.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\workspace-coordinator.service.ts`

**Spec Reference**: code-review-logic.md: Issue 3, Failure Mode 2
**Pattern to Follow**: terminal.service.ts:213-242 (closeTab method which kills then removes)

**Quality Requirements**:

- When `removeWorkspaceState(workspacePath)` is called on TerminalService, it must kill all active PTY sessions for that workspace BEFORE clearing the tab state
- Use the existing `killTerminal(id)` method (which calls `terminal:kill` RPC) for each tab
- The kill calls are fire-and-forget (don't need to await) since we're removing the workspace anyway
- Must also clean up xterm writers for the killed terminals

**Validation Notes**:

- `killTerminal` is async (returns Promise<void>) but we don't need to await it during workspace removal
- The workspace coordinator calls `this.terminalService.removeWorkspaceState(workspacePath)` -- no change needed there
- PTY sessions may have already exited naturally (hasExited: true) -- killTerminal handles this gracefully (RPC returns success:false for unknown sessions, which is fine)

**Implementation Details**:

- In `TerminalService.removeWorkspaceState()`:
  1. Get the current tabs BEFORE clearing state (either from signal or from workspace map)
  2. For each tab, call `this.killTerminal(tab.id)` (fire-and-forget, no await)
  3. For each tab, call `this._xtermWriters.delete(tab.id)` to clean up writers
  4. Then proceed with the existing state clearing logic
- If the workspace being removed is not the active one, get tabs from the workspace map cache
- If it IS the active workspace, get tabs from the current `_tabs()` signal

---

### Task 3.2: Add terminal data buffer for pre-registration data COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\terminal.service.ts`
**Spec Reference**: code-review-logic.md: Issue 7, Failure Mode 4

**Quality Requirements**:

- Buffer incoming terminal data when no xterm writer is registered for a terminal ID
- When a writer is registered via `registerXtermWriter()`, flush the buffer to the writer, then clear it
- Buffer is per-terminal-ID (Map<string, string[]>)
- Clean up the buffer when the terminal is closed or workspace state is removed

**Validation Notes**:

- Data arrives via the binary IPC `onData` callback in `setupBinaryIpcListeners()`
- Current code: `if (writer) { writer(data); }` -- data is silently dropped when no writer
- Buffer must be flushed in order (array preserves insertion order)
- Buffer should also be cleaned in `unregisterXtermWriter()` and `cleanup()`

**Implementation Details**:

- Add `private readonly _pendingDataBuffers = new Map<string, string[]>();`
- In `setupBinaryIpcListeners()` onData callback:
  ```typescript
  const writer = this._xtermWriters.get(id);
  if (writer) {
    writer(data);
  } else {
    // Buffer data until writer is registered
    const buffer = this._pendingDataBuffers.get(id);
    if (buffer) {
      buffer.push(data);
    } else {
      this._pendingDataBuffers.set(id, [data]);
    }
  }
  ```
- In `registerXtermWriter()`:
  ```typescript
  registerXtermWriter(terminalId: string, writer: (data: string) => void): void {
    this._xtermWriters.set(terminalId, writer);
    // Flush any buffered data that arrived before the writer was registered
    const buffer = this._pendingDataBuffers.get(terminalId);
    if (buffer && buffer.length > 0) {
      for (const data of buffer) {
        writer(data);
      }
      this._pendingDataBuffers.delete(terminalId);
    }
  }
  ```
- In `unregisterXtermWriter()`: Also delete from `_pendingDataBuffers`
- In `cleanup()`: Also clear `_pendingDataBuffers`
- In `removeWorkspaceState()` (after Task 3.1 changes): Also delete buffers for killed terminals

---

**Batch 3 Verification**:

- All files exist at paths
- Build passes: `npx nx build ptah-extension-webview`
- code-logic-reviewer approved
- PTY sessions are killed when workspace is removed (no orphan processes)
- Terminal data arriving before xterm mount is buffered and flushed on registration
- No memory leaks (buffers cleaned up on terminal close and workspace removal)
