# TASK_2025_216: VS Code Disk-Based State Storage

## Strategy

**Type**: REFACTORING
**Workflow**: Minimal (direct developer)
**Complexity**: Simple (3-4 files, reference implementation exists)

## Problem

VS Code's `VscodeStateStorage` wraps `vscode.Memento` (in-memory), causing:
`WARN [mainThreadStorage] large extension state detected: 9195kb. Consider to use 'storageUri' or 'globalStorageUri'`

Multiple services store ~9MB in workspace state (session metadata, prompt cache, enhanced prompts, etc.).

## Solution

Create `VscodeDiskStateStorage` in `platform-vscode` — near-copy of Electron's `ElectronStateStorage`:

- JSON file on disk with in-memory cache
- Atomic writes (.tmp + rename)
- Promise chain serialization for concurrent writes
- Backed by `context.storageUri.fsPath` (or `globalStorageUri` fallback)

## Files Affected

1. **CREATE**: `libs/backend/platform-vscode/src/implementations/vscode-disk-state-storage.ts`
2. **MODIFY**: `libs/backend/platform-vscode/src/registration.ts` — use new class for WORKSPACE_STATE_STORAGE
3. **MODIFY**: `libs/backend/platform-vscode/src/index.ts` — export new class

## Reference

- `libs/backend/platform-electron/src/implementations/electron-state-storage.ts` — implementation to mirror
