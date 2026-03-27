# Implementation Plan - TASK_2025_227: Workspace Context Panel

## Codebase Investigation Summary

### Libraries & Patterns Discovered

**Frontend Editor Library** (`libs/frontend/editor/`):

- `EditorPanelComponent`: Composition shell combining FileTreeComponent + CodeEditorComponent (line 34-204)
- `EditorService`: Workspace-partitioned state via `Map<string, EditorWorkspaceState>` (line 64-67), signal-based reactive state, RPC via `postMessage` with correlationId matching
- `FileTreeNodeComponent`: Recursive tree with lazy loading, `depth` input for indentation, git-friendly icon mapping already present
- `FileTreeNode` model: `{ name, path, type, children?, needsLoad? }` - we will extend with `gitStatus`

**Frontend Core Library** (`libs/frontend/core/`):

- `ElectronLayoutService`: Manages `_editorPanelWidth`, `_editorPanelVisible` signals, workspace folder CRUD, debounced workspace switch with stale-response protection
- `IWorkspaceCoordinator` token: Contract for cross-library workspace coordination (switch, remove, getStreamingSessionIds, confirm)
- `WorkspaceCoordinatorService` (in chat lib): Orchestrates TabManager + Editor + SessionLoader during workspace ops

**Backend (Electron)**:

- `ElectronEditorRpcHandlers`: Pattern for handler class with `@injectable()`, `register()` method, `TOKENS.RPC_HANDLER` injection, `validatePathInWorkspace()` helper
- `ElectronRpcMethodRegistrationService`: Orchestrator that calls `.register()` on each handler class in Phase 1 (shared) then Phase 2 (Electron-specific)
- `IpcBridge`: Routes `ipcMain.on('rpc')` to `RpcHandler.handleMessage()`, sends responses via `event.sender.send('to-renderer')`, also has `setupStateHandlers()` for synchronous state
- `preload.ts`: Exposes `window.vscode` (postMessage, getState, setState) + `window.ptahConfig` + forwards `ipcRenderer.on('to-renderer')` as `MessageEvent`
- `ElectronDIContainer.setup()`: 7-phase registration, Phase 4.2 is where Electron-specific handlers go
- `WorkspaceContextManager`: Backend workspace isolation via `WorkspaceAwareStateStorage` proxy
- `cli-adapter.utils.ts`: `crossSpawn` import from `cross-spawn`, `spawnCli()` function, `stripAnsiCodes()`, `resolveCliPath()` via `which`, `CLI_CLEAN_ENV`

**Shared Types** (`libs/shared/`):

- `RpcMethodRegistry` interface: Compile-time enforced method registry with `params` + `result` types
- `RPC_METHOD_NAMES` array: Runtime companion that MUST stay in sync with the interface
- Domain-specific type files under `libs/shared/src/lib/types/rpc/`

### Verified Imports & APIs

- `crossSpawn` from `cross-spawn` (verified in cli-adapter.utils.ts:9)
- `injectable`, `inject` from `tsyringe` (verified in electron-editor-rpc.handlers.ts:12)
- `TOKENS` from `@ptah-extension/vscode-core` (verified: LOGGER, RPC_HANDLER)
- `PLATFORM_TOKENS` from `@ptah-extension/platform-core` (verified: FILE_SYSTEM_PROVIDER, WORKSPACE_PROVIDER)
- `MESSAGE_TYPES` from `@ptah-extension/shared` (verified: RPC_CALL, RPC_RESPONSE)
- `ipcMain`, `ipcRenderer`, `contextBridge` from `electron` (verified in ipc-bridge.ts:23 and preload.ts:1)
- `signal`, `computed`, `inject`, `input`, `output` from `@angular/core` (verified across all frontend components)

---

## Architecture Design

### Design Philosophy

**Chosen Approach**: Extend the existing workspace-partitioned EditorService pattern with new git and terminal state slices. Follow the established RPC handler pattern for backend services. Use a **dedicated binary IPC channel** (separate from JSON RPC) for terminal data because terminal I/O is high-frequency binary that would bottleneck the JSON RPC pipeline.

**Rationale**: The codebase already has a clean pattern for workspace-partitioned state (EditorService Map pattern), RPC handler registration (handler class + orchestrator), and IPC bridging (preload + ipc-bridge). Extending these patterns minimizes risk and ensures consistency.

---

## Phase 1: Git Info Bar + File Tree Badges (Zero New Dependencies)

### 1.1 New Type Definitions

**File: `libs/shared/src/lib/types/rpc/rpc-git.types.ts`** (CREATE)

```typescript
/**
 * Git RPC Type Definitions
 * TASK_2025_227 Phase 1: Git info and worktree types
 */

/** Single file's git status */
export interface GitFileStatus {
  /** Relative path from workspace root */
  path: string;
  /** Git status code: M=modified, A=added, D=deleted, R=renamed, ??=untracked */
  status: 'M' | 'A' | 'D' | 'R' | 'C' | '??' | '!';
  /** Whether the change is staged (index) vs unstaged (worktree) */
  staged: boolean;
}

/** Branch ahead/behind information */
export interface GitBranchInfo {
  /** Current branch name (or HEAD if detached) */
  branch: string;
  /** Upstream tracking branch (e.g., "origin/main"), null if none */
  upstream: string | null;
  /** Number of commits ahead of upstream */
  ahead: number;
  /** Number of commits behind upstream */
  behind: number;
}

/** Parameters for git:info RPC method */
export type GitInfoParams = Record<string, never>;

/** Response from git:info RPC method */
export interface GitInfoResult {
  /** Branch and tracking info */
  branch: GitBranchInfo;
  /** All changed files with their status */
  files: GitFileStatus[];
  /** Whether the workspace is inside a git repository */
  isGitRepo: boolean;
}

/** Parameters for git:worktrees RPC method */
export type GitWorktreesParams = Record<string, never>;

/** Single worktree entry */
export interface GitWorktreeInfo {
  /** Absolute path to the worktree directory */
  path: string;
  /** Branch checked out in this worktree */
  branch: string;
  /** HEAD commit hash (abbreviated) */
  head: string;
  /** Whether this is the main worktree */
  isMain: boolean;
  /** Whether the worktree is bare */
  isBare: boolean;
}

/** Response from git:worktrees RPC method */
export interface GitWorktreesResult {
  worktrees: GitWorktreeInfo[];
}

/** Parameters for git:addWorktree RPC method */
export interface GitAddWorktreeParams {
  /** Branch name to checkout in the new worktree */
  branch: string;
  /** Optional custom path for the worktree directory (defaults to ../<branch>) */
  path?: string;
  /** Whether to create a new branch (vs checkout existing) */
  createBranch?: boolean;
}

/** Response from git:addWorktree RPC method */
export interface GitAddWorktreeResult {
  success: boolean;
  /** Absolute path to the created worktree */
  worktreePath?: string;
  error?: string;
}

/** Parameters for git:removeWorktree RPC method */
export interface GitRemoveWorktreeParams {
  /** Absolute path to the worktree to remove */
  path: string;
  /** Whether to force removal (--force flag) */
  force?: boolean;
}

/** Response from git:removeWorktree RPC method */
export interface GitRemoveWorktreeResult {
  success: boolean;
  error?: string;
}
```

**File: `libs/shared/src/lib/types/rpc/rpc-terminal.types.ts`** (CREATE)

```typescript
/**
 * Terminal RPC Type Definitions
 * TASK_2025_227 Phase 2: Terminal session management types
 */

/** Parameters for terminal:create RPC method */
export interface TerminalCreateParams {
  /** Working directory for the new terminal (defaults to workspace root) */
  cwd?: string;
  /** Shell executable path (defaults to system default) */
  shell?: string;
  /** Terminal display name */
  name?: string;
}

/** Response from terminal:create RPC method */
export interface TerminalCreateResult {
  /** Unique terminal session ID */
  id: string;
  /** PID of the spawned process */
  pid: number;
}

/** Parameters for terminal:kill RPC method */
export interface TerminalKillParams {
  /** Terminal session ID to kill */
  id: string;
}

/** Response from terminal:kill RPC method */
export interface TerminalKillResult {
  success: boolean;
  error?: string;
}

/** Parameters for terminal:resize (binary IPC, not JSON RPC) */
export interface TerminalResizeParams {
  /** Terminal session ID */
  id: string;
  /** New column count */
  cols: number;
  /** New row count */
  rows: number;
}
```

**File: `libs/shared/src/lib/types/rpc/rpc-git.types.ts`** -- also needs barrel export.

**File: `libs/shared/src/lib/types/rpc.types.ts`** (MODIFY)

Add re-exports for new type files:

```typescript
// At the top with other re-exports:
export * from './rpc/rpc-git.types';
export * from './rpc/rpc-terminal.types';
```

Add to the imports section:

```typescript
import type { GitInfoParams, GitInfoResult, GitWorktreesParams, GitWorktreesResult, GitAddWorktreeParams, GitAddWorktreeResult, GitRemoveWorktreeParams, GitRemoveWorktreeResult } from './rpc/rpc-git.types';

import type { TerminalCreateParams, TerminalCreateResult, TerminalKillParams, TerminalKillResult } from './rpc/rpc-terminal.types';
```

Add to `RpcMethodRegistry` interface:

```typescript
// ---- Git Methods (TASK_2025_227) ----
'git:info': { params: GitInfoParams; result: GitInfoResult };
'git:worktrees': { params: GitWorktreesParams; result: GitWorktreesResult };
'git:addWorktree': { params: GitAddWorktreeParams; result: GitAddWorktreeResult };
'git:removeWorktree': { params: GitRemoveWorktreeParams; result: GitRemoveWorktreeResult };

// ---- Terminal Methods (TASK_2025_227) ----
'terminal:create': { params: TerminalCreateParams; result: TerminalCreateResult };
'terminal:kill': { params: TerminalKillParams; result: TerminalKillResult };
```

Add to `RPC_METHOD_NAMES` array:

```typescript
// Git Methods (TASK_2025_227)
'git:info',
'git:worktrees',
'git:addWorktree',
'git:removeWorktree',

// Terminal Methods (TASK_2025_227)
'terminal:create',
'terminal:kill',
```

### 1.2 Backend: GitInfoService (Main Process)

**File: `apps/ptah-electron/src/services/git-info.service.ts`** (CREATE)

**Purpose**: Encapsulates all git CLI interactions. Shells out to `git` using existing `cross-spawn` utilities. Zero new dependencies.

**Pattern**: Follows the service pattern established by `WorkspaceContextManager` -- a plain class (not tsyringe injectable) instantiated in the DI container setup.

```typescript
import crossSpawn from 'cross-spawn';
import type { Logger } from '@ptah-extension/vscode-core';
import type { GitBranchInfo, GitFileStatus, GitInfoResult, GitWorktreeInfo } from '@ptah-extension/shared';

export class GitInfoService {
  constructor(private readonly logger: Logger) {}

  /**
   * Get git info for a workspace path.
   * Runs: git status --porcelain=v2 --branch
   * Parses: branch name, upstream, ahead/behind, changed files
   */
  async getGitInfo(workspacePath: string): Promise<GitInfoResult>;

  /**
   * List all worktrees for the repository at workspacePath.
   * Runs: git worktree list --porcelain
   */
  async getWorktrees(workspacePath: string): Promise<GitWorktreeInfo[]>;

  /**
   * Add a new worktree.
   * Runs: git worktree add [-b <branch>] <path> [<branch>]
   */
  async addWorktree(
    workspacePath: string,
    params: {
      branch: string;
      path?: string;
      createBranch?: boolean;
    },
  ): Promise<{ success: boolean; worktreePath?: string; error?: string }>;

  /**
   * Remove a worktree.
   * Runs: git worktree remove [--force] <path>
   */
  async removeWorktree(workspacePath: string, worktreePath: string, force?: boolean): Promise<{ success: boolean; error?: string }>;

  /**
   * Check if a path is inside a git repository.
   * Runs: git rev-parse --is-inside-work-tree
   */
  async isGitRepo(workspacePath: string): Promise<boolean>;

  /**
   * Internal: spawn git process and collect stdout/stderr.
   * Uses cross-spawn for Windows compatibility.
   * Timeout: 10 seconds.
   */
  private execGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}
```

**Key Implementation Details**:

- `execGit()` uses `crossSpawn('git', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })` -- same pattern as `spawnCli()` in cli-adapter.utils.ts:51
- Parsing `--porcelain=v2 --branch`: Lines starting with `# branch.oid`, `# branch.head`, `# branch.upstream`, `# branch.ab` for branch info; Lines starting with `1`, `2`, `u`, `?` for file status
- All operations are read-only except addWorktree/removeWorktree (Phase 3)
- The `cross-spawn` package is already in the project's dependencies (verified via cli-adapter.utils.ts:9)

### 1.3 Backend: ElectronGitRpcHandlers

**File: `apps/ptah-electron/src/services/rpc/handlers/electron-git-rpc.handlers.ts`** (CREATE)

**Purpose**: RPC handler class following the established pattern in ElectronEditorRpcHandlers.

**Pattern Source**: `apps/ptah-electron/src/services/rpc/handlers/electron-editor-rpc.handlers.ts` (line 12-42 for class structure, line 44 for register() pattern)

```typescript
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

// GitInfoService is injected via a custom DI token (see 1.5)
const GIT_INFO_SERVICE = Symbol.for('GitInfoService');

@injectable()
export class ElectronGitRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER) private readonly workspace: IWorkspaceProvider,
    @inject(GIT_INFO_SERVICE) private readonly gitInfo: GitInfoService,
  ) {}

  register(): void {
    this.registerGitInfo(); // git:info
    this.registerGitWorktrees(); // git:worktrees
    this.registerAddWorktree(); // git:addWorktree (Phase 3 but register now)
    this.registerRemoveWorktree(); // git:removeWorktree (Phase 3 but register now)
  }

  private registerGitInfo(): void {
    this.rpcHandler.registerMethod('git:info', async () => {
      const wsRoot = this.workspace.getWorkspaceRoot();
      if (!wsRoot) return { isGitRepo: false, branch: { branch: '', upstream: null, ahead: 0, behind: 0 }, files: [] };
      return this.gitInfo.getGitInfo(wsRoot);
    });
  }

  private registerGitWorktrees(): void {
    this.rpcHandler.registerMethod('git:worktrees', async () => {
      const wsRoot = this.workspace.getWorkspaceRoot();
      if (!wsRoot) return { worktrees: [] };
      const worktrees = await this.gitInfo.getWorktrees(wsRoot);
      return { worktrees };
    });
  }

  private registerAddWorktree(): void {
    /* Phase 3 */
  }
  private registerRemoveWorktree(): void {
    /* Phase 3 */
  }
}
```

### 1.4 Backend: Handler Registration

**File: `apps/ptah-electron/src/services/rpc/handlers/index.ts`** (MODIFY)

Add export:

```typescript
export { ElectronGitRpcHandlers } from './electron-git-rpc.handlers';
```

**File: `apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts`** (MODIFY)

- Add `import { ElectronGitRpcHandlers } from './handlers';` to imports
- Add constructor parameter: `@inject(ElectronGitRpcHandlers) private readonly gitHandlers: ElectronGitRpcHandlers,`
- Add to `electronHandlers` array: `{ name: 'ElectronGitRpcHandlers', handler: this.gitHandlers },`

### 1.5 Backend: DI Container Registration

**File: `apps/ptah-electron/src/di/container.ts`** (MODIFY)

In Phase 4.2 (Electron-specific handlers section), add:

```typescript
// GitInfoService (TASK_2025_227)
import { GitInfoService } from '../services/git-info.service';
const GIT_INFO_SERVICE = Symbol.for('GitInfoService');

// Before handler registrations:
const gitInfoService = new GitInfoService(logger);
container.register(GIT_INFO_SERVICE, { useValue: gitInfoService });

// Handler registration:
container.registerSingleton(ElectronGitRpcHandlers);
```

### 1.6 Frontend: GitStatusService (Angular Service)

**File: `libs/frontend/editor/src/lib/services/git-status.service.ts`** (CREATE)

**Purpose**: Frontend service that polls git:info RPC and exposes signals for git state. Workspace-partitioned following EditorService pattern.

```typescript
import { Injectable, inject, signal, computed, DestroyRef, NgZone } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { GitInfoResult, GitBranchInfo, GitFileStatus } from '@ptah-extension/shared';

interface GitWorkspaceState {
  branch: GitBranchInfo;
  files: GitFileStatus[];
  isGitRepo: boolean;
  lastUpdated: number;
}

@Injectable({ providedIn: 'root' })
export class GitStatusService {
  private readonly vscodeService = inject(VSCodeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ngZone = inject(NgZone);

  // Workspace-partitioned state
  private readonly _workspaceGitState = new Map<string, GitWorkspaceState>();
  private _activeWorkspacePath: string | null = null;

  // Polling state
  private _pollIntervalId: ReturnType<typeof setInterval> | null = null;
  private _isFocused = true;

  // Signals (reflect active workspace's git state)
  private readonly _branch = signal<GitBranchInfo>({ branch: '', upstream: null, ahead: 0, behind: 0 });
  private readonly _files = signal<GitFileStatus[]>([]);
  private readonly _isGitRepo = signal(false);
  private readonly _isLoading = signal(false);

  readonly branch = this._branch.asReadonly();
  readonly files = this._files.asReadonly();
  readonly isGitRepo = this._isGitRepo.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();

  // Computed
  readonly changedFileCount = computed(() => this._files().length);
  readonly hasChanges = computed(() => this._files().length > 0);
  readonly branchName = computed(() => this._branch().branch);

  /**
   * Build a Map<filePath, status> for O(1) lookup by FileTreeNodeComponent.
   */
  readonly fileStatusMap = computed(() => {
    const map = new Map<string, GitFileStatus>();
    for (const file of this._files()) {
      map.set(file.path, file);
    }
    return map;
  });

  constructor() {
    this.setupFocusListeners();
    this.destroyRef.onDestroy(() => this.stopPolling());
  }

  /** Switch git state to a different workspace (called by WorkspaceCoordinator) */
  switchWorkspace(workspacePath: string): void {
    // Save current state
    this.saveCurrentState();
    this._activeWorkspacePath = workspacePath;

    // Restore cached state or reset
    const cached = this._workspaceGitState.get(workspacePath);
    if (cached) {
      this._branch.set(cached.branch);
      this._files.set(cached.files);
      this._isGitRepo.set(cached.isGitRepo);
    } else {
      this._branch.set({ branch: '', upstream: null, ahead: 0, behind: 0 });
      this._files.set([]);
      this._isGitRepo.set(false);
    }

    // Immediately fetch fresh data
    this.fetchGitInfo();
  }

  /** Remove cached git state for a workspace */
  removeWorkspaceState(workspacePath: string): void {
    this._workspaceGitState.delete(workspacePath);
  }

  /** Start polling (called when editor panel becomes visible) */
  startPolling(): void {
    if (this._pollIntervalId !== null) return;
    this.fetchGitInfo(); // Immediate first fetch
    this._pollIntervalId = setInterval(() => {
      if (this._isFocused && this._activeWorkspacePath) {
        this.fetchGitInfo();
      }
    }, 5000); // 5s interval
  }

  /** Stop polling (called when editor panel hidden or destroyed) */
  stopPolling(): void {
    if (this._pollIntervalId !== null) {
      clearInterval(this._pollIntervalId);
      this._pollIntervalId = null;
    }
  }

  /** Fetch git info via RPC */
  private async fetchGitInfo(): Promise<void> {
    if (!this._activeWorkspacePath) return;
    this._isLoading.set(true);
    const result = await this.rpcCall<GitInfoResult>('git:info', {});
    if (result.success && result.data) {
      this._branch.set(result.data.branch);
      this._files.set(result.data.files);
      this._isGitRepo.set(result.data.isGitRepo);
      this.saveCurrentState();
    }
    this._isLoading.set(false);
  }

  private saveCurrentState(): void {
    /* save signals to _workspaceGitState map */
  }

  private setupFocusListeners(): void {
    const onFocus = () => {
      this._isFocused = true;
    };
    const onBlur = () => {
      this._isFocused = false;
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    });
  }

  /** RPC helper -- matches EditorService.rpcCall() pattern */
  private rpcCall<T>(method: string, params: Record<string, unknown>): Promise<{ success: boolean; data?: T; error?: string }> {
    // Same implementation as EditorService.rpcCall() (line 570-613)
  }
}
```

### 1.7 Frontend: GitStatusBarComponent

**File: `libs/frontend/editor/src/lib/git-status-bar/git-status-bar.component.ts`** (CREATE)

**Purpose**: Horizontal bar at the top of the editor panel showing branch name, change count, ahead/behind status.

```typescript
import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { LucideAngularModule, GitBranch, ArrowUp, ArrowDown, FileEdit } from 'lucide-angular';
import { GitStatusService } from '../services/git-status.service';

@Component({
  selector: 'ptah-git-status-bar',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    @if (gitStatus.isGitRepo()) {
      <div
        class="flex items-center gap-3 h-7 px-3 bg-base-200 border-b border-base-content/10
                text-xs select-none flex-shrink-0"
      >
        <!-- Branch name -->
        <div class="flex items-center gap-1 opacity-80">
          <lucide-angular [img]="GitBranchIcon" class="w-3.5 h-3.5" />
          <span class="font-medium truncate max-w-[160px]">{{ gitStatus.branchName() }}</span>
        </div>

        <!-- Ahead/Behind -->
        @if (gitStatus.branch().upstream) {
          @if (gitStatus.branch().ahead > 0) {
            <div class="flex items-center gap-0.5 text-info" title="Commits ahead">
              <lucide-angular [img]="ArrowUpIcon" class="w-3 h-3" />
              <span>{{ gitStatus.branch().ahead }}</span>
            </div>
          }
          @if (gitStatus.branch().behind > 0) {
            <div class="flex items-center gap-0.5 text-warning" title="Commits behind">
              <lucide-angular [img]="ArrowDownIcon" class="w-3 h-3" />
              <span>{{ gitStatus.branch().behind }}</span>
            </div>
          }
        }

        <!-- Changed files count -->
        @if (gitStatus.hasChanges()) {
          <div class="flex items-center gap-1 ml-auto opacity-80" title="Changed files">
            <lucide-angular [img]="FileEditIcon" class="w-3 h-3" />
            <span>{{ gitStatus.changedFileCount() }}</span>
          </div>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GitStatusBarComponent {
  protected readonly gitStatus = inject(GitStatusService);

  readonly GitBranchIcon = GitBranch;
  readonly ArrowUpIcon = ArrowUp;
  readonly ArrowDownIcon = ArrowDown;
  readonly FileEditIcon = FileEdit;
}
```

### 1.8 Frontend: FileTreeNodeComponent - Git Badges

**File: `libs/frontend/editor/src/lib/file-tree/file-tree-node.component.ts`** (MODIFY)

Add `GitStatusService` injection and git status badge display.

**Changes**:

1. Import `GitStatusService`
2. Inject it: `private readonly gitStatus = inject(GitStatusService);`
3. Add a computed `fileGitStatus` that looks up the node's relative path in `gitStatus.fileStatusMap()`
4. In the template, after the filename span, add a git status badge:

```html
@if (nodeGitStatus()) {
<span class="ml-auto text-[10px] font-mono flex-shrink-0" [class]="gitStatusColor(nodeGitStatus()!)"> {{ nodeGitStatus()!.status }} </span>
}
```

5. Add a `gitStatusColor()` method that returns: `'text-warning'` for M, `'text-success'` for A, `'text-error'` for D, `'text-info'` for ??, `'text-base-content/50'` for others.

**Note**: The git status `path` from `git status --porcelain=v2` is relative to the repository root. The file tree node `path` is absolute. The GitStatusService must normalize paths to relative paths from workspace root for matching.

### 1.9 Frontend: EditorPanelComponent Update

**File: `libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts`** (MODIFY)

**Changes**:

1. Import `GitStatusBarComponent` and `GitStatusService`
2. Add `GitStatusBarComponent` to `imports` array
3. Inject `GitStatusService`
4. In `ngOnInit()`, call `this.gitStatus.startPolling()`
5. Add `<ptah-git-status-bar />` in the template between the toolbar and the content area:

```html
<!-- Git status bar (below toolbar, above content) -->
<ptah-git-status-bar />

<!-- Content area: file tree + code editor -->
<div class="flex flex-1 min-h-0">...</div>
```

### 1.10 Frontend: EditorService - Git State in Workspace Partition

**File: `libs/frontend/editor/src/lib/services/editor.service.ts`** (MODIFY -- minimal)

No changes needed to EditorService itself. Git state is managed by the separate `GitStatusService` which follows the same workspace-partitioning pattern independently.

### 1.11 Frontend: WorkspaceCoordinatorService Update

**File: `libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts`** (MODIFY)

Add `GitStatusService` coordination:

```typescript
import { GitStatusService } from '@ptah-extension/editor';

// In constructor:
private readonly gitStatus = inject(GitStatusService);

// In switchWorkspace():
switchWorkspace(newPath: string): void {
  this.tabManager.switchWorkspace(newPath);
  this.editorService.switchWorkspace(newPath);
  this.sessionLoader.switchWorkspace(newPath);
  this.gitStatus.switchWorkspace(newPath);  // NEW
}

// In removeWorkspaceState():
removeWorkspaceState(workspacePath: string): void {
  this.tabManager.removeWorkspaceState(workspacePath);
  this.editorService.removeWorkspaceState(workspacePath);
  this.sessionLoader.removeWorkspaceCache(workspacePath);
  this.gitStatus.removeWorkspaceState(workspacePath);  // NEW
}
```

### 1.12 Library Exports Update

**File: `libs/frontend/editor/src/index.ts`** (MODIFY)

Add exports:

```typescript
export { GitStatusService } from './lib/services/git-status.service';
export { GitStatusBarComponent } from './lib/git-status-bar/git-status-bar.component';
```

### 1.13 FileTreeNode Model Extension

**File: `libs/frontend/editor/src/lib/models/file-tree.model.ts`** (NO CHANGE)

We do NOT modify FileTreeNode. Git status badges are looked up at render time via `GitStatusService.fileStatusMap()`, which is a computed signal. This avoids the complexity of merging git status into the tree model on every poll cycle.

---

## Phase 2: Multi-Tab Terminal Integration (xterm + node-pty)

### 2.1 New Dependencies

**File: `package.json`** (MODIFY)

Add to `dependencies`:

```json
"@xterm/xterm": "^5.5.0",
"@xterm/addon-fit": "^0.10.0",
"@xterm/addon-webgl": "^0.18.0",
"node-pty": "^1.0.0"
```

**File: `apps/ptah-electron/webpack.config.js` or equivalent** (MODIFY)

`node-pty` is a native Node module. It must be:

1. Marked as `external` in webpack config (not bundled)
2. Rebuilt for Electron's Node version via `electron-rebuild` or `@electron/rebuild`

Add to build scripts in `package.json`:

```json
"electron:rebuild": "electron-rebuild -f -w node-pty"
```

### 2.2 Backend: PtyManagerService (Main Process)

**File: `apps/ptah-electron/src/services/pty-manager.service.ts`** (CREATE)

**Purpose**: Manages PTY sessions in the main process. Spawns node-pty instances, tracks them by ID, forwards data via IPC.

```typescript
import * as pty from 'node-pty';
import * as os from 'os';
import type { Logger } from '@ptah-extension/vscode-core';

interface PtySession {
  id: string;
  pty: pty.IPty;
  workspacePath: string;
  /** Buffer for data before renderer subscribes */
  pendingData: string[];
}

export class PtyManagerService {
  private readonly sessions = new Map<string, PtySession>();
  private dataCallback: ((id: string, data: string) => void) | null = null;
  private exitCallback: ((id: string, exitCode: number) => void) | null = null;

  constructor(private readonly logger: Logger) {}

  /**
   * Register callback for terminal data output.
   * Called by IpcBridge to forward data to renderer.
   */
  onData(callback: (id: string, data: string) => void): void;

  /**
   * Register callback for terminal exit events.
   */
  onExit(callback: (id: string, exitCode: number) => void): void;

  /**
   * Create a new PTY session.
   * Returns session ID and PID.
   */
  create(params: { cwd: string; shell?: string; name?: string }): { id: string; pid: number };

  /**
   * Write data to a PTY session (input from renderer).
   */
  write(id: string, data: string): void;

  /**
   * Resize a PTY session.
   */
  resize(id: string, cols: number, rows: number): void;

  /**
   * Kill a PTY session.
   */
  kill(id: string): { success: boolean; error?: string };

  /**
   * Kill all PTY sessions for a workspace (workspace removal cleanup).
   */
  killAllForWorkspace(workspacePath: string): void;

  /**
   * Get all active session IDs for a workspace.
   */
  getSessionsForWorkspace(workspacePath: string): string[];

  /**
   * Dispose all sessions. Called on app shutdown.
   */
  disposeAll(): void;

  /** Detect default shell for the current platform */
  private getDefaultShell(): string {
    if (process.platform === 'win32') {
      return process.env['COMSPEC'] || 'cmd.exe';
    }
    return process.env['SHELL'] || '/bin/bash';
  }
}
```

**Key Implementation Details**:

- Session ID: `crypto.randomUUID()`
- Shell detection: `process.env.COMSPEC` on Windows, `process.env.SHELL` on Unix
- PTY spawn: `pty.spawn(shell, [], { cwd, cols: 80, rows: 24, env: process.env })`
- Data forwarding: `ptyInstance.onData((data) => this.dataCallback?.(id, data))`
- Exit handling: `ptyInstance.onExit(({ exitCode }) => this.exitCallback?.(id, exitCode))`
- Memory limit: Max 20 concurrent sessions total, max 5 per workspace

### 2.3 Backend: Binary IPC Channel in Preload

**File: `apps/ptah-electron/src/preload.ts`** (MODIFY)

Add terminal-specific IPC API alongside the existing `window.vscode` API:

```typescript
// Expose terminal binary IPC API
contextBridge.exposeInMainWorld('ptahTerminal', {
  /** Write data to terminal (renderer -> main) */
  write: (id: string, data: string) => {
    ipcRenderer.send('terminal:data-in', id, data);
  },
  /** Resize terminal */
  resize: (id: string, cols: number, rows: number) => {
    ipcRenderer.send('terminal:resize', id, cols, rows);
  },
  /** Listen for terminal data output (main -> renderer) */
  onData: (callback: (id: string, data: string) => void) => {
    const handler = (_event: unknown, id: string, data: string) => callback(id, data);
    ipcRenderer.on('terminal:data-out', handler);
    return () => {
      ipcRenderer.removeListener('terminal:data-out', handler);
    };
  },
  /** Listen for terminal exit events */
  onExit: (callback: (id: string, exitCode: number) => void) => {
    const handler = (_event: unknown, id: string, exitCode: number) => callback(id, exitCode);
    ipcRenderer.on('terminal:exit', handler);
    return () => {
      ipcRenderer.removeListener('terminal:exit', handler);
    };
  },
});
```

**Why separate from `window.vscode`**: Terminal data is high-frequency binary. Routing it through the JSON RPC pipeline (serialize -> correlationId match -> deserialize) would add latency and unnecessary overhead. Direct IPC channels (`terminal:data-in`, `terminal:data-out`) bypass JSON serialization.

### 2.4 Backend: IPC Bridge Terminal Channel

**File: `apps/ptah-electron/src/ipc/ipc-bridge.ts`** (MODIFY)

Add terminal IPC handlers alongside existing RPC handler:

```typescript
import { PtyManagerService } from '../services/pty-manager.service';

// In constructor, accept PtyManagerService:
constructor(
  private readonly container: DependencyContainer,
  private readonly getWindow: GetWindowFn,
  private readonly ptyManager?: PtyManagerService, // Optional for backward compat
) { ... }

// Add new method:
private setupTerminalHandlers(): void {
  if (!this.ptyManager) return;

  // Renderer -> Main: terminal input
  ipcMain.on('terminal:data-in', (_event: IpcMainEvent, id: string, data: string) => {
    this.ptyManager!.write(id, data);
  });

  // Renderer -> Main: terminal resize
  ipcMain.on('terminal:resize', (_event: IpcMainEvent, id: string, cols: number, rows: number) => {
    this.ptyManager!.resize(id, cols, rows);
  });

  // Main -> Renderer: terminal output
  this.ptyManager!.onData((id: string, data: string) => {
    const win = this.getWindow();
    if (win) {
      win.webContents.send('terminal:data-out', id, data);
    }
  });

  // Main -> Renderer: terminal exit
  this.ptyManager!.onExit((id: string, exitCode: number) => {
    const win = this.getWindow();
    if (win) {
      win.webContents.send('terminal:exit', id, exitCode);
    }
  });
}

// Call in initialize():
initialize(): void {
  this.setupRpcHandler();
  this.setupStateHandlers();
  this.setupTerminalHandlers(); // NEW
  console.log('[IpcBridge] IPC listeners initialized');
}

// Cleanup in dispose():
dispose(): void {
  ipcMain.removeAllListeners('rpc');
  ipcMain.removeAllListeners('get-state');
  ipcMain.removeAllListeners('set-state');
  ipcMain.removeAllListeners('terminal:data-in');   // NEW
  ipcMain.removeAllListeners('terminal:resize');     // NEW
  this.ptyManager?.disposeAll();                     // NEW
  console.log('[IpcBridge] IPC listeners disposed');
}
```

### 2.5 Backend: Terminal RPC Handlers

**File: `apps/ptah-electron/src/services/rpc/handlers/electron-terminal-rpc.handlers.ts`** (CREATE)

**Purpose**: RPC handlers for terminal:create and terminal:kill (session lifecycle). Data flow uses binary IPC, not RPC.

```typescript
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

const PTY_MANAGER_SERVICE = Symbol.for('PtyManagerService');

@injectable()
export class ElectronTerminalRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER) private readonly workspace: IWorkspaceProvider,
    @inject(PTY_MANAGER_SERVICE) private readonly ptyManager: PtyManagerService,
  ) {}

  register(): void {
    this.registerCreate();
    this.registerKill();
  }

  private registerCreate(): void {
    this.rpcHandler.registerMethod('terminal:create', async (params) => {
      const wsRoot = this.workspace.getWorkspaceRoot();
      const cwd = params?.cwd || wsRoot || process.cwd();
      try {
        const result = this.ptyManager.create({ cwd, shell: params?.shell, name: params?.name });
        return { success: true, ...result };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    });
  }

  private registerKill(): void {
    this.rpcHandler.registerMethod('terminal:kill', async (params) => {
      if (!params?.id) return { success: false, error: 'id is required' };
      return this.ptyManager.kill(params.id);
    });
  }
}
```

### 2.6 Frontend: Terminal Type Declaration

**File: `libs/frontend/editor/src/lib/types/terminal.types.ts`** (CREATE)

```typescript
/** Window extension for terminal binary IPC */
export interface PtahTerminalApi {
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  onData(callback: (id: string, data: string) => void): () => void;
  onExit(callback: (id: string, exitCode: number) => void): () => void;
}

declare global {
  interface Window {
    ptahTerminal?: PtahTerminalApi;
  }
}

/** Terminal tab state */
export interface TerminalTab {
  id: string;
  name: string;
  pid: number;
  isActive: boolean;
  /** Whether the terminal process has exited */
  hasExited: boolean;
  exitCode?: number;
}
```

### 2.7 Frontend: TerminalService

**File: `libs/frontend/editor/src/lib/services/terminal.service.ts`** (CREATE)

**Purpose**: Manages terminal tabs per workspace. Workspace-partitioned following the same Map pattern as EditorService.

```typescript
import { Injectable, inject, signal, computed, DestroyRef } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { TerminalTab } from '../types/terminal.types';

interface TerminalWorkspaceState {
  tabs: TerminalTab[];
  activeTabId: string | null;
}

@Injectable({ providedIn: 'root' })
export class TerminalService {
  private readonly vscodeService = inject(VSCodeService);
  private readonly destroyRef = inject(DestroyRef);

  // Workspace-partitioned state
  private readonly _workspaceTerminalState = new Map<string, TerminalWorkspaceState>();
  private _activeWorkspacePath: string | null = null;

  // Signals
  private readonly _tabs = signal<TerminalTab[]>([]);
  private readonly _activeTabId = signal<string | null>(null);

  readonly tabs = this._tabs.asReadonly();
  readonly activeTabId = this._activeTabId.asReadonly();
  readonly activeTab = computed(() => {
    const id = this._activeTabId();
    return id ? (this._tabs().find((t) => t.id === id) ?? null) : null;
  });
  readonly hasTerminals = computed(() => this._tabs().length > 0);

  // Binary IPC listeners cleanup functions
  private _dataUnsubscribe: (() => void) | null = null;
  private _exitUnsubscribe: (() => void) | null = null;

  // Callbacks map: terminal ID -> xterm instance write function
  private readonly _xtermWriters = new Map<string, (data: string) => void>();

  constructor() {
    this.setupBinaryIpcListeners();
    this.destroyRef.onDestroy(() => this.cleanup());
  }

  /** Register an xterm instance's write callback for data forwarding */
  registerXtermWriter(terminalId: string, writer: (data: string) => void): void;

  /** Unregister when terminal component is destroyed */
  unregisterXtermWriter(terminalId: string): void;

  /** Create a new terminal tab via RPC */
  async createTerminal(name?: string): Promise<string | null>;

  /** Kill a terminal tab */
  async killTerminal(id: string): Promise<void>;

  /** Switch active terminal tab */
  switchTab(id: string): void;

  /** Close a terminal tab (kill + remove from list) */
  async closeTab(id: string): Promise<void>;

  /** Write data to terminal (user input from xterm) */
  writeToTerminal(id: string, data: string): void {
    window.ptahTerminal?.write(id, data);
  }

  /** Resize terminal */
  resizeTerminal(id: string, cols: number, rows: number): void {
    window.ptahTerminal?.resize(id, cols, rows);
  }

  /** Workspace switch */
  switchWorkspace(workspacePath: string): void;

  /** Workspace removal cleanup */
  removeWorkspaceState(workspacePath: string): void;

  private setupBinaryIpcListeners(): void {
    if (!window.ptahTerminal) return;

    this._dataUnsubscribe = window.ptahTerminal.onData((id, data) => {
      const writer = this._xtermWriters.get(id);
      if (writer) writer(data);
    });

    this._exitUnsubscribe = window.ptahTerminal.onExit((id, exitCode) => {
      this._tabs.update((tabs) => tabs.map((t) => (t.id === id ? { ...t, hasExited: true, exitCode } : t)));
    });
  }

  private cleanup(): void {
    this._dataUnsubscribe?.();
    this._exitUnsubscribe?.();
  }

  /** RPC helper -- same pattern as EditorService */
  private rpcCall<T>(method: string, params: Record<string, unknown>): Promise<{ success: boolean; data?: T; error?: string }>;
}
```

### 2.8 Frontend: TerminalComponent (xterm.js Wrapper)

**File: `libs/frontend/editor/src/lib/terminal/terminal.component.ts`** (CREATE)

**Purpose**: Wraps a single xterm.js Terminal instance. Handles rendering, input, resize.

```typescript
import { Component, input, inject, signal, ElementRef, viewChild, AfterViewInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { TerminalService } from '../services/terminal.service';

@Component({
  selector: 'ptah-terminal',
  standalone: true,
  template: `<div #terminalContainer class="h-full w-full"></div>`,
  styles: `
    :host {
      display: block;
      height: 100%;
      width: 100%;
    }
    /* xterm.css must be imported globally in styles.css */
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminalComponent implements AfterViewInit, OnDestroy {
  readonly terminalId = input.required<string>();

  private readonly terminalService = inject(TerminalService);
  private readonly terminalContainer = viewChild.required<ElementRef<HTMLDivElement>>('terminalContainer');

  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private webglAddon: WebglAddon | null = null;
  private resizeObserver: ResizeObserver | null = null;

  ngAfterViewInit(): void {
    this.initTerminal();
  }

  ngOnDestroy(): void {
    this.terminalService.unregisterXtermWriter(this.terminalId());
    this.resizeObserver?.disconnect();
    this.webglAddon?.dispose();
    this.fitAddon?.dispose();
    this.terminal?.dispose();
  }

  private initTerminal(): void {
    const container = this.terminalContainer().nativeElement;

    this.terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        // Match DaisyUI dark theme colors
      },
      allowProposedApi: true,
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    // Try WebGL renderer, fallback to canvas
    try {
      this.webglAddon = new WebglAddon();
      this.terminal.loadAddon(this.webglAddon);
      this.webglAddon.onContextLoss(() => {
        this.webglAddon?.dispose();
        this.webglAddon = null;
      });
    } catch {
      // WebGL not available, canvas renderer is fine
    }

    this.terminal.open(container);
    this.fitAddon.fit();

    // Forward user input to main process
    this.terminal.onData((data: string) => {
      this.terminalService.writeToTerminal(this.terminalId(), data);
    });

    // Register for receiving data from main process
    this.terminalService.registerXtermWriter(this.terminalId(), (data: string) => {
      this.terminal?.write(data);
    });

    // Auto-resize on container size change
    this.resizeObserver = new ResizeObserver(() => {
      this.fitAddon?.fit();
      if (this.terminal) {
        this.terminalService.resizeTerminal(this.terminalId(), this.terminal.cols, this.terminal.rows);
      }
    });
    this.resizeObserver.observe(container);
  }
}
```

### 2.9 Frontend: TerminalTabBarComponent

**File: `libs/frontend/editor/src/lib/terminal/terminal-tab-bar.component.ts`** (CREATE)

```typescript
import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { LucideAngularModule, Plus, X, Terminal as TermIcon } from 'lucide-angular';
import { TerminalService } from '../services/terminal.service';

@Component({
  selector: 'ptah-terminal-tab-bar',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <div class="flex items-center bg-base-300 border-t border-base-content/10 h-8 flex-shrink-0">
      <span class="text-xs font-semibold tracking-wider opacity-60 uppercase px-2 select-none">Terminal</span>
      <div class="flex items-center overflow-x-auto flex-1 scrollbar-thin">
        @for (tab of terminalService.tabs(); track tab.id) {
          <button class="flex items-center gap-1 px-2 py-1 text-xs border-r border-base-content/5 whitespace-nowrap" [class.bg-base-100]="tab.id === terminalService.activeTabId()" [class.bg-base-300]="tab.id !== terminalService.activeTabId()" [class.opacity-50]="tab.hasExited" (click)="terminalService.switchTab(tab.id)">
            <lucide-angular [img]="TerminalIcon" class="w-3 h-3" />
            <span>{{ tab.name }}</span>
            <button class="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-base-content/10" (click)="closeTab($event, tab.id)">
              <lucide-angular [img]="XIcon" class="w-3 h-3" />
            </button>
          </button>
        }
      </div>
      <button class="btn btn-ghost btn-xs mx-1" title="New Terminal" (click)="newTerminal()">
        <lucide-angular [img]="PlusIcon" class="w-3.5 h-3.5" />
      </button>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminalTabBarComponent {
  protected readonly terminalService = inject(TerminalService);
  readonly PlusIcon = Plus;
  readonly XIcon = X;
  readonly TerminalIcon = TermIcon;

  async newTerminal(): Promise<void> {
    await this.terminalService.createTerminal();
  }

  async closeTab(event: MouseEvent, id: string): Promise<void> {
    event.stopPropagation();
    await this.terminalService.closeTab(id);
  }
}
```

### 2.10 Frontend: TerminalPanelComponent (Wrapper with Tabs)

**File: `libs/frontend/editor/src/lib/terminal/terminal-panel.component.ts`** (CREATE)

```typescript
import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { TerminalComponent } from './terminal.component';
import { TerminalTabBarComponent } from './terminal-tab-bar.component';
import { TerminalService } from '../services/terminal.service';

@Component({
  selector: 'ptah-terminal-panel',
  standalone: true,
  imports: [TerminalComponent, TerminalTabBarComponent],
  template: `
    <div class="flex flex-col h-full">
      <ptah-terminal-tab-bar />
      <div class="flex-1 min-h-0">
        @if (terminalService.activeTab(); as activeTab) {
          @for (tab of terminalService.tabs(); track tab.id) {
            <div class="h-full" [class.hidden]="tab.id !== activeTab.id">
              <ptah-terminal [terminalId]="tab.id" />
            </div>
          }
        } @else {
          <div class="h-full flex items-center justify-center text-sm opacity-40">
            <span>Click + to open a terminal</span>
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminalPanelComponent {
  protected readonly terminalService = inject(TerminalService);
}
```

**Note**: All terminal tabs are rendered (not destroyed) but hidden via `[class.hidden]` to preserve xterm state. Only the active tab is visible.

### 2.11 Frontend: EditorPanelComponent - Horizontal Split

**File: `libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts`** (MODIFY)

Add a resizable horizontal split between editor area (top) and terminal panel (bottom).

**Changes**:

1. Import `TerminalPanelComponent`
2. Add terminal panel below the editor with a drag handle for resizing
3. Add a `terminalHeight` signal (default 200px, min 100px, max 60% of panel)
4. Add a `terminalVisible` signal (default false)
5. Template structure becomes:

```html
<div class="flex flex-col h-full w-full bg-base-100">
  <!-- Toolbar -->
  <div class="flex items-center h-8 px-2 bg-base-200 border-b border-base-content/10 flex-shrink-0">
    <!-- existing toolbar content + add terminal toggle button -->
  </div>

  <!-- Git status bar -->
  <ptah-git-status-bar />

  <!-- Main content area -->
  <div class="flex flex-col flex-1 min-h-0">
    <!-- Editor area (takes remaining space) -->
    <div class="flex flex-1 min-h-0" [style.flex]="terminalVisible() ? '1 1 0' : '1 1 auto'">
      <!-- file tree + code editor (existing) -->
    </div>

    <!-- Resize handle -->
    @if (terminalVisible()) {
    <div class="h-1 bg-base-300 cursor-row-resize hover:bg-primary/30 transition-colors flex-shrink-0" (mousedown)="onTerminalResizeStart($event)"></div>
    }

    <!-- Terminal panel -->
    @if (terminalVisible()) {
    <div [style.height.px]="terminalHeight()" class="flex-shrink-0 min-h-[100px]">
      <ptah-terminal-panel />
    </div>
    }
  </div>

  <!-- Error toast -->
  ...
</div>
```

6. Add resize handlers following the same pattern as `ElectronLayoutService` sidebar dragging.

### 2.12 Frontend: xterm.css Global Import

**File: `apps/ptah-extension-webview/src/styles.css`** (MODIFY)

Add xterm CSS import:

```css
@import '@xterm/xterm/css/xterm.css';
```

### 2.13 WorkspaceCoordinatorService Update for Terminal

**File: `libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts`** (MODIFY)

Add `TerminalService` coordination (same as 1.11 but for terminal):

```typescript
import { TerminalService } from '@ptah-extension/editor';

private readonly terminalService = inject(TerminalService);

switchWorkspace(newPath: string): void {
  // ... existing ...
  this.terminalService.switchWorkspace(newPath);
}

removeWorkspaceState(workspacePath: string): void {
  // ... existing ...
  this.terminalService.removeWorkspaceState(workspacePath);
}
```

### 2.14 Backend: DI & Registration for Terminal

Same pattern as 1.4 and 1.5 but for `PtyManagerService` and `ElectronTerminalRpcHandlers`:

**File: `apps/ptah-electron/src/di/container.ts`** (MODIFY)

- Create `PtyManagerService` instance
- Register with `PTY_MANAGER_SERVICE` token
- Register `ElectronTerminalRpcHandlers`

**File: `apps/ptah-electron/src/services/rpc/handlers/index.ts`** (MODIFY)

- Export `ElectronTerminalRpcHandlers`

**File: `apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts`** (MODIFY)

- Add terminal handlers to the electronHandlers array

### 2.15 Editor Library Exports for Phase 2

**File: `libs/frontend/editor/src/index.ts`** (MODIFY)

Add exports:

```typescript
export { TerminalService } from './lib/services/terminal.service';
export { TerminalComponent } from './lib/terminal/terminal.component';
export { TerminalTabBarComponent } from './lib/terminal/terminal-tab-bar.component';
export { TerminalPanelComponent } from './lib/terminal/terminal-panel.component';
export type { TerminalTab, PtahTerminalApi } from './lib/types/terminal.types';
```

---

## Phase 3: Worktree Management

### 3.1 Backend: Complete git:addWorktree and git:removeWorktree Handlers

**File: `apps/ptah-electron/src/services/rpc/handlers/electron-git-rpc.handlers.ts`** (MODIFY)

Fill in the Phase 3 stubs:

```typescript
private registerAddWorktree(): void {
  this.rpcHandler.registerMethod('git:addWorktree', async (params) => {
    const wsRoot = this.workspace.getWorkspaceRoot();
    if (!wsRoot) return { success: false, error: 'No workspace folder open' };
    if (!params?.branch) return { success: false, error: 'branch is required' };
    return this.gitInfo.addWorktree(wsRoot, {
      branch: params.branch,
      path: params.path,
      createBranch: params.createBranch,
    });
  });
}

private registerRemoveWorktree(): void {
  this.rpcHandler.registerMethod('git:removeWorktree', async (params) => {
    const wsRoot = this.workspace.getWorkspaceRoot();
    if (!wsRoot) return { success: false, error: 'No workspace folder open' };
    if (!params?.path) return { success: false, error: 'path is required' };
    return this.gitInfo.removeWorktree(wsRoot, params.path, params.force);
  });
}
```

### 3.2 Frontend: Worktree UI in GitStatusBar

**File: `libs/frontend/editor/src/lib/git-status-bar/git-status-bar.component.ts`** (MODIFY)

Add a worktree indicator and "Add Worktree" action:

```html
<!-- Worktree indicator (after branch name) -->
@if (worktreeCount() > 1) {
<div class="flex items-center gap-0.5 opacity-60" title="Active worktrees">
  <lucide-angular [img]="GitForkIcon" class="w-3 h-3" />
  <span>{{ worktreeCount() }}</span>
</div>
}
```

### 3.3 Frontend: WorktreeService

**File: `libs/frontend/editor/src/lib/services/worktree.service.ts`** (CREATE)

**Purpose**: Manages worktree operations. When a worktree is created, it auto-registers as a workspace folder via `ElectronLayoutService.addFolderByPath()`.

```typescript
import { Injectable, inject, signal, DestroyRef } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { GitWorktreeInfo } from '@ptah-extension/shared';

@Injectable({ providedIn: 'root' })
export class WorktreeService {
  private readonly vscodeService = inject(VSCodeService);

  private readonly _worktrees = signal<GitWorktreeInfo[]>([]);
  readonly worktrees = this._worktrees.asReadonly();

  /** Fetch worktree list via RPC */
  async loadWorktrees(): Promise<void>;

  /** Add a new worktree and register as workspace folder */
  async addWorktree(branch: string, options?: { path?: string; createBranch?: boolean }): Promise<{ success: boolean; error?: string }>;

  /** Remove a worktree and unregister workspace folder */
  async removeWorktree(path: string, force?: boolean): Promise<{ success: boolean; error?: string }>;

  /** RPC helper */
  private rpcCall<T>(method: string, params: Record<string, unknown>): Promise<{ success: boolean; data?: T; error?: string }>;
}
```

### 3.4 Frontend: AddWorktreeDialogComponent

**File: `libs/frontend/editor/src/lib/worktree/add-worktree-dialog.component.ts`** (CREATE)

A small form dialog with:

- Branch name input
- Optional path input
- Create new branch checkbox
- Create / Cancel buttons

Uses DaisyUI modal styling. Signal-based form state.

---

## Integration Points

### How Components Connect to Existing Architecture

1. **EditorPanelComponent** (composition root for workspace context panel):
   - Already imported by the Electron app shell
   - Adds `GitStatusBarComponent`, `TerminalPanelComponent` as children
   - Resizable split between editor area and terminal

2. **WorkspaceCoordinatorService** (cross-library coordination):
   - Already coordinates EditorService + TabManager + SessionLoader
   - Extended to also coordinate GitStatusService + TerminalService
   - Token-based injection avoids circular dependencies

3. **ElectronLayoutService** (layout management):
   - `_editorPanelVisible` signal should default to `true` (always visible)
   - This is a simple `.set(true)` change in the restoreLayout default

4. **RpcMethodRegistry** (type safety):
   - New git:_ and terminal:_ methods added with full param/result types
   - Compile-time enforced: frontend can only call registered methods

5. **IpcBridge** (message routing):
   - JSON RPC channel (existing) handles git:\* and terminal:create/kill
   - Binary IPC channel (new) handles terminal:data-in/data-out/resize
   - Both channels share the same `BrowserWindow.webContents`

6. **DI Container** (service registration):
   - GitInfoService registered as plain value (like WorkspaceContextManager)
   - PtyManagerService registered as plain value
   - Handler classes registered as singletons (standard pattern)

---

## Performance Considerations

### Git Polling

- **Interval**: 5 seconds when app is focused, paused when blurred
- **Scope**: Only the active workspace is polled (not all cached workspaces)
- **Data size**: `git status --porcelain=v2 --branch` output is typically < 5KB
- **Timeout**: 10 second timeout on git process to prevent hanging
- **Debounce**: No debounce needed (5s interval is already infrequent)

### Terminal Data

- **Binary IPC**: Direct `ipcMain.on` / `webContents.send` -- no JSON serialization overhead
- **Buffer strategy**: xterm.js handles its own scrollback buffer (default 1000 lines)
- **WebGL renderer**: `@xterm/addon-webgl` for GPU-accelerated rendering, canvas fallback
- **Resize**: Uses `ResizeObserver` on the terminal container, debounced by xterm.js's FitAddon

### Memory

- **Terminal tab preservation**: Hidden tabs keep xterm state in DOM (no re-creation)
- **Max sessions**: 20 total, 5 per workspace (hard limit in PtyManagerService)
- **Workspace cleanup**: All PTY sessions for a workspace are killed on workspace removal

### Lazy Initialization

- **GitStatusService**: Polling starts only when editor panel is visible
- **TerminalService**: No PTY spawned until user clicks "+" button
- **xterm.js**: Terminal instances created lazily per tab
- **node-pty**: External native module, loaded only when first terminal is created

---

## Files Affected Summary

### CREATE (18 files)

| File                                                                             | Phase | Purpose                         |
| -------------------------------------------------------------------------------- | ----- | ------------------------------- |
| `libs/shared/src/lib/types/rpc/rpc-git.types.ts`                                 | 1     | Git RPC type definitions        |
| `libs/shared/src/lib/types/rpc/rpc-terminal.types.ts`                            | 2     | Terminal RPC type definitions   |
| `apps/ptah-electron/src/services/git-info.service.ts`                            | 1     | Git CLI wrapper service         |
| `apps/ptah-electron/src/services/pty-manager.service.ts`                         | 2     | PTY session manager             |
| `apps/ptah-electron/src/services/rpc/handlers/electron-git-rpc.handlers.ts`      | 1     | Git RPC handlers                |
| `apps/ptah-electron/src/services/rpc/handlers/electron-terminal-rpc.handlers.ts` | 2     | Terminal RPC handlers           |
| `libs/frontend/editor/src/lib/services/git-status.service.ts`                    | 1     | Frontend git state service      |
| `libs/frontend/editor/src/lib/services/terminal.service.ts`                      | 2     | Frontend terminal state service |
| `libs/frontend/editor/src/lib/services/worktree.service.ts`                      | 3     | Frontend worktree operations    |
| `libs/frontend/editor/src/lib/git-status-bar/git-status-bar.component.ts`        | 1     | Git info bar component          |
| `libs/frontend/editor/src/lib/terminal/terminal.component.ts`                    | 2     | xterm.js wrapper component      |
| `libs/frontend/editor/src/lib/terminal/terminal-tab-bar.component.ts`            | 2     | Terminal tab bar component      |
| `libs/frontend/editor/src/lib/terminal/terminal-panel.component.ts`              | 2     | Terminal panel container        |
| `libs/frontend/editor/src/lib/worktree/add-worktree-dialog.component.ts`         | 3     | Add worktree dialog             |
| `libs/frontend/editor/src/lib/types/terminal.types.ts`                           | 2     | Terminal type declarations      |

### MODIFY (12 files)

| File                                                                     | Phase | Changes                                                          |
| ------------------------------------------------------------------------ | ----- | ---------------------------------------------------------------- |
| `libs/shared/src/lib/types/rpc.types.ts`                                 | 1     | Add git:_ and terminal:_ to RpcMethodRegistry + RPC_METHOD_NAMES |
| `libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts`    | 1+2   | Add git bar, terminal panel, resizable split                     |
| `libs/frontend/editor/src/lib/file-tree/file-tree-node.component.ts`     | 1     | Add git status badges                                            |
| `libs/frontend/editor/src/index.ts`                                      | 1+2+3 | Export new services and components                               |
| `libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts`   | 1+2   | Coordinate GitStatus + Terminal on workspace switch              |
| `apps/ptah-electron/src/preload.ts`                                      | 2     | Add `window.ptahTerminal` binary IPC API                         |
| `apps/ptah-electron/src/ipc/ipc-bridge.ts`                               | 2     | Add terminal binary IPC handlers                                 |
| `apps/ptah-electron/src/di/container.ts`                                 | 1+2   | Register GitInfoService, PtyManagerService, handler classes      |
| `apps/ptah-electron/src/services/rpc/handlers/index.ts`                  | 1+2   | Export new handler classes                                       |
| `apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts` | 1+2   | Register new handlers in orchestrator                            |
| `apps/ptah-extension-webview/src/styles.css`                             | 2     | Import xterm.css                                                 |
| `package.json`                                                           | 2     | Add xterm + node-pty dependencies                                |

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: Both backend-developer AND frontend-developer

**Rationale**:

- Phase 1 is fullstack: backend git service + RPC handlers + frontend components
- Phase 2 is fullstack: backend PTY manager + binary IPC + frontend xterm integration
- Phase 3 is mostly frontend with minor backend handler completion
- Recommend splitting: backend-developer for services/handlers/IPC, frontend-developer for Angular components

### Complexity Assessment

**Complexity**: HIGH
**Estimated Effort**: 12-16 hours

**Breakdown**:

- Phase 1 (Git Info Bar): 4-5 hours (types, service, RPC, component, badges)
- Phase 2 (Terminal): 6-8 hours (node-pty, binary IPC, xterm wrapper, tabs, resize)
- Phase 3 (Worktrees): 2-3 hours (complete handlers, dialog, auto-register)

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **cross-spawn is available**: Already a dependency (verified in cli-adapter.utils.ts:9). Do NOT add `simple-git`.

2. **node-pty compatibility**: Must be rebuilt for Electron's Node.js version. Test on Windows + macOS + Linux.

3. **xterm.css path**: The `@import '@xterm/xterm/css/xterm.css'` path must resolve correctly in the Angular build pipeline.

4. **Binary IPC channel names**: `terminal:data-in`, `terminal:data-out`, `terminal:resize`, `terminal:exit` -- these must not conflict with any existing IPC channels.

5. **Workspace provider**: `this.workspace.getWorkspaceRoot()` returns the active workspace path (verified in electron-editor-rpc.handlers.ts:54).

6. **RPC_METHOD_NAMES sync**: After adding to `RpcMethodRegistry`, the `RPC_METHOD_NAMES` array MUST be updated too (it's a runtime companion, TypeScript won't catch mismatches).

7. **WebGL addon fallback**: The `@xterm/addon-webgl` may not work in all Electron configurations. The canvas renderer is the automatic fallback.

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase (EditorService Map pattern, RPC handler pattern, IPC bridge pattern)
- [x] All imports/decorators verified as existing (cross-spawn, tsyringe, TOKENS, PLATFORM_TOKENS)
- [x] Quality requirements defined (polling intervals, buffer limits, max sessions)
- [x] Integration points documented (WorkspaceCoordinator, IpcBridge, DI Container, RpcMethodRegistry)
- [x] Files affected list complete (18 CREATE + 12 MODIFY)
- [x] Developer type recommended (fullstack: backend + frontend)
- [x] Complexity assessed (HIGH, 12-16 hours)
- [x] Phase boundaries clearly defined (Phase 1 = zero deps, Phase 2 = xterm + pty, Phase 3 = worktree CRUD)
