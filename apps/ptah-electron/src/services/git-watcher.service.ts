/**
 * Git Watcher Service
 *
 * Despite the name, this service now drives BOTH git status push updates
 * AND generic workspace file-tree change notifications to the renderer.
 * The class name is preserved for backward compatibility with DI wiring
 * and call sites; functionally it is a workspace + git watcher hybrid.
 *
 * Responsibilities:
 *   1. Watch the .git directory (when present) and push `git:status-update`
 *      events whenever HEAD, index, or refs change. This replaced the
 *      frontend `git:info` polling loop with event-driven push.
 *   2. Watch the workspace root unconditionally (NOT gated on `.git`
 *      existence) and push `file:tree-changed` events for any create /
 *      delete / rename, so the renderer's file explorer auto-refreshes
 *      even in non-git workspaces.
 *   3. Push `file:content-changed` events when the active editor file
 *      is modified externally.
 *
 * Watches (git side):
 * - .git/HEAD      (branch switches, checkouts)
 * - .git/index     (staging area changes: git add/reset)
 * - .git/refs/     (new commits, remote updates, tag creation)
 *
 * Workspace file changes (unstaged modifications, file/folder CRUD) are
 * detected via the workspace-root watcher and coalesced through
 * TREE_DEBOUNCE_MS before being pushed.
 *
 * Replaces git:info polling with event-driven push, and also drives generic
 * workspace file watching.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { GitInfoService, Logger } from '@ptah-extension/vscode-core';
import type { GitInfoResult } from '@ptah-extension/shared';

/** Message type used for pushing git status to the renderer. */
const GIT_STATUS_UPDATE = 'git:status-update';

/** Message type used for pushing file tree invalidation to the renderer. */
const FILE_TREE_CHANGED = 'file:tree-changed';

/** Message type used for pushing file content change notifications to the renderer. */
const FILE_CONTENT_CHANGED = 'file:content-changed';

/**
 * Message type used to ask the renderer to re-read every currently open
 * editor tab from disk. Emitted after a git operation (commit, checkout,
 * reset, push, branch switch) since git mutates files atomically via
 * rename, which fs.watch does not always surface as a per-file change.
 */
const EDITOR_REREAD_OPEN_TABS = 'editor:reread-open-tabs';

export class GitWatcherService {
  private watchers: fs.FSWatcher[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private treeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private gitOpsDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly contentChangeTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private workspacePath: string | null = null;
  private broadcastFn: ((type: string, payload: unknown) => void) | null = null;
  private isDisposed = false;

  /** Debounce interval for file content change notifications (ms). */
  private static readonly CONTENT_CHANGE_DEBOUNCE_MS = 500;

  /** Debounce interval for .git changes (ms). Git operations fire multiple events. */
  private static readonly GIT_DEBOUNCE_MS = 500;

  /** Debounce interval for workspace file changes (ms). Longer to avoid noise. */
  private static readonly WORKSPACE_DEBOUNCE_MS = 2000;

  /** Debounce interval for file tree refresh (ms). Batches bulk ops (git pull, npm install) without making routine file creation feel laggy. */
  private static readonly TREE_DEBOUNCE_MS = 500;

  constructor(
    private readonly gitInfo: GitInfoService,
    private readonly logger: Logger,
  ) {}

  /**
   * Start watching a workspace for git changes.
   * Call this after the workspace is known and the WebviewManager is ready.
   *
   * @param workspacePath - Absolute path to the workspace root
   * @param broadcast - Function to push messages to the renderer
   */
  start(
    workspacePath: string,
    broadcast: (type: string, payload: unknown) => void,
  ): void {
    // Clean up any previous watchers
    this.stop();

    this.workspacePath = workspacePath;
    this.broadcastFn = broadcast;
    this.isDisposed = false;

    this.logger.info('[GitWatcher] Starting file system watchers', {
      workspacePath,
    } as unknown as Error);

    // Watch workspace root recursively for file modifications and structural
    // changes (file add/delete/rename → tree refresh). This must run for
    // ALL workspaces, not only git repos — the file explorer depends on it
    // to stay in sync when files are created via the UI, CLI agents, or
    // external tools.
    this.watchWorkspaceRoot(workspacePath);

    // Resolve the real git directory. In a normal repo `.git` is a directory;
    // in worktrees and submodules it is a FILE containing `gitdir: <path>`
    // pointing to the actual gitdir under the parent repo's `.git/worktrees/`.
    // Without this resolution, worktree users get zero git-driven refresh.
    const gitDir = this.resolveGitDir(workspacePath);
    if (!gitDir) {
      this.logger.debug(
        '[GitWatcher] No .git directory found, skipping git-specific watchers',
        { workspacePath } as unknown as Error,
      );
      return;
    }

    const onGitOps = (): void => this.scheduleGitOpsRefresh();

    // HEAD (branch switches), index (staging), refs/ (commits & remote updates).
    this.watchFile(path.join(gitDir, 'HEAD'), onGitOps);
    this.watchFile(path.join(gitDir, 'index'), onGitOps);

    const refsDir = path.join(gitDir, 'refs');
    if (fs.existsSync(refsDir)) {
      this.watchDirectory(refsDir, onGitOps);
    }

    // After `git gc` or on cloned repos, refs live in `packed-refs` and
    // `git fetch` / `git push` may update only that file. ORIG_HEAD and
    // FETCH_HEAD cover reset/merge/fetch operations that don't move HEAD.
    this.watchFile(path.join(gitDir, 'packed-refs'), onGitOps);
    this.watchFile(path.join(gitDir, 'ORIG_HEAD'), onGitOps);
    this.watchFile(path.join(gitDir, 'FETCH_HEAD'), onGitOps);

    // Push initial git state immediately
    this.fetchAndPush();
  }

  /**
   * Resolve the real git directory for a workspace.
   *
   * Returns the directory itself for a normal repo. For worktrees and
   * submodules, `.git` is a file whose first line is `gitdir: <path>` —
   * we follow that pointer (resolving relative paths against the workspace).
   * Returns null when no git context exists.
   */
  private resolveGitDir(workspacePath: string): string | null {
    const dotGit = path.join(workspacePath, '.git');
    if (!fs.existsSync(dotGit)) return null;

    const stat = fs.statSync(dotGit);
    if (stat.isDirectory()) return dotGit;
    if (!stat.isFile()) return null;

    try {
      const contents = fs.readFileSync(dotGit, 'utf8').trim();
      const match = contents.match(/^gitdir:\s*(.+)$/m);
      if (!match) return null;
      const target = match[1].trim();
      const resolved = path.isAbsolute(target)
        ? target
        : path.resolve(workspacePath, target);
      return fs.existsSync(resolved) ? resolved : null;
    } catch (err) {
      this.logger.warn('[GitWatcher] Failed to resolve gitdir pointer', {
        dotGit,
        error: err instanceof Error ? err.message : String(err),
      } as unknown as Error);
      return null;
    }
  }

  /**
   * Switch to watching a different workspace.
   */
  switchWorkspace(workspacePath: string): void {
    if (this.workspacePath === workspacePath) return;
    if (this.broadcastFn) {
      this.start(workspacePath, this.broadcastFn);
    }
  }

  /**
   * Stop all watchers and clean up.
   */
  stop(): void {
    this.isDisposed = true;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.treeDebounceTimer) {
      clearTimeout(this.treeDebounceTimer);
      this.treeDebounceTimer = null;
    }

    if (this.gitOpsDebounceTimer) {
      clearTimeout(this.gitOpsDebounceTimer);
      this.gitOpsDebounceTimer = null;
    }

    for (const timer of this.contentChangeTimers.values()) {
      clearTimeout(timer);
    }
    this.contentChangeTimers.clear();

    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {
        // Watcher may already be closed
      }
    }
    this.watchers = [];
  }

  /**
   * Watch a single file for changes. Caller supplies the scheduler
   * callback (e.g. `scheduleGitOpsRefresh` or `scheduleUpdate`) since
   * coalescing semantics differ per watcher kind.
   */
  private watchFile(filePath: string, onChange: () => void): void {
    if (!fs.existsSync(filePath)) return;

    try {
      const watcher = fs.watch(filePath, () => {
        onChange();
      });

      watcher.on('error', (err) => {
        this.logger.warn('[GitWatcher] File watcher error', {
          filePath,
          error: err.message,
        } as unknown as Error);
      });

      this.watchers.push(watcher);
    } catch (err) {
      this.logger.warn('[GitWatcher] Failed to watch file', {
        filePath,
        error: err instanceof Error ? err.message : String(err),
      } as unknown as Error);
    }
  }

  /**
   * Watch a directory (non-recursive) for changes. Caller supplies the
   * scheduler callback.
   */
  private watchDirectory(dirPath: string, onChange: () => void): void {
    try {
      const watcher = fs.watch(dirPath, { recursive: false }, () => {
        onChange();
      });

      watcher.on('error', (err) => {
        this.logger.warn('[GitWatcher] Directory watcher error', {
          dirPath,
          error: err.message,
        } as unknown as Error);
      });

      this.watchers.push(watcher);
    } catch (err) {
      this.logger.warn('[GitWatcher] Failed to watch directory', {
        dirPath,
        error: err instanceof Error ? err.message : String(err),
      } as unknown as Error);
    }
  }

  /**
   * Watch the workspace root recursively for both git status changes
   * and structural changes (file add/delete/rename).
   *
   * - All file events schedule a git status update (existing behavior).
   * - 'rename' events (file add/delete) also schedule a file tree refresh
   *   push to the renderer so the file explorer stays in sync.
   *
   * Uses recursive: true which is natively supported on Windows and macOS.
   */
  private watchWorkspaceRoot(dirPath: string): void {
    try {
      const watcher = fs.watch(
        dirPath,
        { recursive: true },
        (eventType, filename) => {
          // Skip .git directory changes — handled by dedicated git watchers
          if (
            typeof filename === 'string' &&
            (filename.startsWith('.git/') ||
              filename.startsWith('.git\\') ||
              filename === '.git')
          ) {
            return;
          }

          // Skip node_modules and dist to avoid noise
          if (typeof filename === 'string') {
            if (
              filename.startsWith('node_modules/') ||
              filename.startsWith('node_modules\\') ||
              filename.startsWith('dist/') ||
              filename.startsWith('dist\\')
            ) {
              return;
            }
          }

          // Always update git status (debounced)
          this.scheduleUpdate(GitWatcherService.WORKSPACE_DEBOUNCE_MS);

          // 'rename' events indicate file/directory add, delete, or rename —
          // these require a file tree refresh
          if (eventType === 'rename') {
            this.scheduleTreeRefresh();
          }

          if (eventType === 'change' && filename) {
            this.scheduleContentChange(dirPath, filename);
          }
        },
      );

      watcher.on('error', (err) => {
        this.logger.warn('[GitWatcher] Workspace watcher error', {
          dirPath,
          error: err.message,
        } as unknown as Error);
      });

      this.watchers.push(watcher);
    } catch (err) {
      this.logger.warn('[GitWatcher] Failed to watch workspace root', {
        dirPath,
        error: err instanceof Error ? err.message : String(err),
      } as unknown as Error);
    }
  }

  /**
   * Schedule a debounced file tree refresh push.
   * Uses a longer debounce than git status to batch bulk operations (e.g. git pull).
   */
  private scheduleTreeRefresh(): void {
    if (this.isDisposed) return;

    if (this.treeDebounceTimer) {
      clearTimeout(this.treeDebounceTimer);
    }

    this.treeDebounceTimer = setTimeout(() => {
      this.treeDebounceTimer = null;
      if (!this.isDisposed && this.broadcastFn) {
        this.broadcastFn(FILE_TREE_CHANGED, {});
      }
    }, GitWatcherService.TREE_DEBOUNCE_MS);
  }

  /**
   * Schedule a debounced content-change notification for a specific file.
   * Each file gets its own debounce timer so rapid saves to the same file
   * coalesce, but changes to different files are independent.
   */
  private scheduleContentChange(workspaceRoot: string, filename: string): void {
    if (this.isDisposed) return;

    const fullPath = path.join(workspaceRoot, filename).replace(/\\/g, '/');

    const existing = this.contentChangeTimers.get(fullPath);
    if (existing) {
      clearTimeout(existing);
    }

    this.contentChangeTimers.set(
      fullPath,
      setTimeout(() => {
        this.contentChangeTimers.delete(fullPath);
        if (!this.isDisposed && this.broadcastFn) {
          this.broadcastFn(FILE_CONTENT_CHANGED, { filePath: fullPath });
        }
      }, GitWatcherService.CONTENT_CHANGE_DEBOUNCE_MS),
    );
  }

  /**
   * Schedule a debounced git-operation refresh: pushes git status AND
   * tells the renderer to re-read every open editor tab from disk.
   *
   * Coalesces a flurry of .git/* events (a single git command can write
   * HEAD, index, and refs in rapid succession) into one broadcast pair.
   */
  private scheduleGitOpsRefresh(): void {
    if (this.isDisposed) return;

    if (this.gitOpsDebounceTimer) {
      clearTimeout(this.gitOpsDebounceTimer);
    }

    this.gitOpsDebounceTimer = setTimeout(() => {
      this.gitOpsDebounceTimer = null;
      if (this.isDisposed || !this.broadcastFn) return;
      void this.fetchAndPush();
      this.broadcastFn(EDITOR_REREAD_OPEN_TABS, {});
    }, GitWatcherService.GIT_DEBOUNCE_MS);
  }

  /**
   * Schedule a debounced git status fetch + push.
   * Resets the timer on each call so rapid events coalesce.
   */
  private scheduleUpdate(debounceMs: number): void {
    if (this.isDisposed) return;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.fetchAndPush();
    }, debounceMs);
  }

  /**
   * Fetch git info and push to renderer.
   */
  private async fetchAndPush(): Promise<void> {
    if (this.isDisposed || !this.workspacePath || !this.broadcastFn) return;

    try {
      const result: GitInfoResult = await this.gitInfo.getGitInfo(
        this.workspacePath,
      );
      this.broadcastFn(GIT_STATUS_UPDATE, result);
    } catch (err) {
      this.logger.warn('[GitWatcher] Failed to fetch git info', {
        error: err instanceof Error ? err.message : String(err),
      } as unknown as Error);
    }
  }
}
