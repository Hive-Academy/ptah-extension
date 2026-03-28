# TASK_2025_228 — Fix QA Review Findings from TASK_2025_227

## Origin

QA code-style-reviewer and code-logic-reviewer identified 6 issues in the Workspace Context Panel implementation (TASK_2025_227). Two critical fixes were already applied during review. The remaining issues need proper fixes.

## Issues to Fix

### 1. PTY Sessions Not Killed on Workspace Removal (SERIOUS)

**File**: `libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts` + backend
**Problem**: `TerminalService.removeWorkspaceState()` clears frontend state but never kills backend PTY processes. `PtyManagerService.killAllForWorkspace()` exists but is never called during workspace removal.
**Fix**: Add RPC method or use existing `terminal:kill` to kill all PTYs for a workspace before clearing state. Could add a `terminal:killAll` RPC method or iterate over workspace terminal tabs calling `terminal:kill`.

### 2. Git Porcelain Path Parsing Fails for Paths with Spaces (SERIOUS)

**File**: `apps/ptah-electron/src/services/git-info.service.ts`
**Problem**: `split(' ')` on porcelain v2 output truncates paths containing spaces. Porcelain v2 format has fixed-width fields; the path is the last field and can contain spaces.
**Fix**: Parse porcelain v2 format correctly — use fixed field positions/counts rather than naive split.

### 3. Staged/Unstaged Files Overwrite in fileStatusMap (SERIOUS)

**File**: `libs/frontend/editor/src/lib/services/git-status.service.ts`
**Problem**: Files with both staged and unstaged changes lose the staged entry in `fileStatusMap` due to Map key collision. A file can appear twice (once staged, once unstaged).
**Fix**: Either merge both statuses into a single entry (e.g., `{ staged: 'M', unstaged: 'M' }`) or change the Map key to include the staged flag.

### 4. Terminal Data Dropped Before xterm Writer Registration (MODERATE)

**File**: `libs/frontend/editor/src/lib/services/terminal.service.ts`
**Problem**: Timing gap between terminal creation (RPC returns terminal ID) and Angular component mounting (registers xterm writer). Shell output during this gap is silently discarded.
**Fix**: Add a pending data buffer in TerminalService. Buffer incoming data per terminal ID. When xterm writer is registered, flush the buffer, then switch to direct forwarding.

### 5. rpcCall Duplicated Across 4 Services (BLOCKING DEBT)

**Files**: `editor.service.ts`, `git-status.service.ts`, `terminal.service.ts`, `worktree.service.ts`
**Problem**: The `rpcCall<T>()` method is copy-pasted across 4 services (~120 lines of duplication). Same correlationId + postMessage + addEventListener pattern.
**Fix**: Extract to a shared utility function or service in `libs/frontend/editor/src/lib/services/` (or `libs/frontend/core/`). All 4 services should use the shared implementation.

### 6. DI Token Symbols Defined Locally Instead of Centrally (SERIOUS)

**Files**: `electron-git-rpc.handlers.ts`, `electron-terminal-rpc.handlers.ts`, `container.ts`
**Problem**: `Symbol.for('GitInfoService')` and `Symbol.for('PtyManagerService')` are defined in multiple files independently. Should be centralized.
**Fix**: Define tokens in a central location (e.g., `apps/ptah-electron/src/di/tokens.ts` or in `libs/backend/platform-core/`) and import from there.

## Strategy

- **Type**: BUGFIX
- **Complexity**: Medium (6 discrete, well-scoped fixes)
- **Workflow**: Minimal — Team-Leader → Developers (issues fully scoped from review)
