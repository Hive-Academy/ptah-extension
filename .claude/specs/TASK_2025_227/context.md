# TASK_2025_227 — Workspace Context Panel

## User Intent

Evolve the existing editor panel (`EditorPanelComponent`) into an always-visible, intelligent **Workspace Context Panel** that adapts per selected workspace. The panel combines:

1. **Git Info Bar** — Current branch, file change count, ahead/behind status, git file status badges on file tree nodes
2. **Integrated Multi-Tab Terminal** — xterm.js + node-pty based terminal with multiple tabs per workspace, each with independent PTY session scoped to workspace CWD
3. **Worktree Management** — Native git worktree integration: list, add, remove worktrees; worktrees auto-register as workspace folders

## Key Design Decisions (From Architecture Discussion)

- **Git**: No `simple-git` dependency. Shell out to `git` via existing `cross-spawn` utilities. Zero bundle impact. Read-only info + worktree management only (AI agents handle commits/push).
- **Terminal**: `@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-webgl` for renderer. `node-pty` for main process PTY. Binary IPC channel (not JSON RPC) for terminal data.
- **Workspace partitioning**: Extend existing `Map<workspacePath, EditorWorkspaceState>` in EditorService to include git info + terminal tabs. Atomic state swap on workspace switch via existing `WorkspaceCoordinatorService`.
- **Layout**: Editor panel becomes always-visible (default `true`). Horizontal resizable split between editor and terminal. Git status bar at top.
- **Worktrees = Workspaces**: Worktrees map 1:1 to existing workspace folder concept. `git worktree add` auto-registers via `workspace:addFolder` flow.

## Implementation Phases

### Phase 1: Git Info Bar + File Tree Badges (Zero Dependencies)

- `GitInfoService` (main process) — shells out to `git status --porcelain=v2 --branch`, `git worktree list --porcelain`
- `ElectronGitRpcHandlers` — RPC methods: `git:info`, `git:worktrees`
- `GitStatusBarComponent` — displays branch, change count, ahead/behind
- `FileTreeNodeComponent` — extend with git status badges (M/A/D/??)
- Polling: 5s when app focused, stop when blurred
- Workspace-partitioned git state in EditorService

### Phase 2: Multi-Tab Terminal Integration (xterm + node-pty)

- `PtyManagerService` (main process) — spawn/write/resize/kill PTY sessions
- Binary IPC channel in preload.ts (not JSON RPC) for terminal data
- `TerminalComponent` — xterm.js wrapper with WebGL renderer
- `TerminalTabBarComponent` — multi-tab management
- Resizable horizontal split between editor and terminal
- Terminal tabs workspace-partitioned (PTYs pause/resume on workspace switch)

### Phase 3: Worktree Management

- "Add worktree" button in workspace sidebar
- `git:addWorktree` / `git:removeWorktree` RPC methods
- Auto-register worktree as workspace folder
- Worktree indicator in git status bar
- Cleanup: remove worktree state when worktree removed

## RPC Methods (Total: 7)

```typescript
// Git info (read-only)
'git:info':           { result: { branch, files[], ahead, behind } }
'git:worktrees':      { result: { worktrees[] } }

// Worktree management
'git:addWorktree':    { params: { branch, path? }; result: { worktreePath } }
'git:removeWorktree': { params: { path }; result: { success } }

// Terminal
'terminal:create':    { params: { cwd?, shell? }; result: { id } }
'terminal:kill':      { params: { id }; result: { success } }
// + Binary IPC: terminal:data-in, terminal:data-out, terminal:resize
```

## Affected Areas

- `libs/frontend/editor/` — Evolve into workspace panel
- `apps/ptah-electron/src/services/rpc/handlers/` — New git + terminal handlers
- `apps/ptah-electron/src/ipc/` — Binary IPC for terminal
- `apps/ptah-electron/src/preload.ts` — Terminal API exposure
- `libs/frontend/core/src/lib/services/electron-layout.service.ts` — Layout changes
- `libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts` — Extend coordination
- `libs/shared/src/lib/types/rpc/` — New RPC type definitions
- `apps/ptah-electron/src/di/container.ts` — DI registration
- `package.json` — New dependencies (xterm, node-pty)

## Strategy

- **Type**: FEATURE
- **Complexity**: Complex (3 phases, ~15 files affected)
- **Workflow**: Partial (Architect → Team-Leader → QA) — Requirements well-defined from architecture discussion
