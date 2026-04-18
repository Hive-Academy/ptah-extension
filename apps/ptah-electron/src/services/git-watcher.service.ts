/**
 * Git Watcher Service
 *
 * Watches the .git directory for changes and pushes git status updates
 * to the renderer via WebviewManager. Replaces frontend polling with
 * event-driven push — git status is only computed when something actually changes.
 *
 * Watches:
 * - .git/HEAD      (branch switches, checkouts)
 * - .git/index     (staging area changes: git add/reset)
 * - .git/refs/     (new commits, remote updates, tag creation)
 *
 * Workspace file changes (unstaged modifications) are detected via a
 * secondary watcher on the workspace root with a longer debounce.
 *
 * TASK_2025_240: Replace git:info polling with event-driven push
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import type { GitInfoResult } from '@ptah-extension/shared';
import type { GitInfoService } from './git-info.service';

/** Message type used for pushing git status to the renderer. */
const GIT_STATUS_UPDATE = 'git:status-update';

/** Message type used for pushing file tree invalidation to the renderer. */
const FILE_TREE_CHANGED = 'file:tree-changed';

/** Message type used for pushing file content change notifications to the renderer. */
const FILE_CONTENT_CHANGED = 'file:content-changed';

export class GitWatcherService {
  private watchers: fs.FSWatcher[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private treeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
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

  /** Debounce interval for file tree refresh (ms). Longer to batch bulk operations like git pull. */
  private static readonly TREE_DEBOUNCE_MS = 3000;

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

    const gitDir = path.join(workspacePath, '.git');

    // Check if .git exists (could be a non-git workspace)
    if (!fs.existsSync(gitDir) || !fs.statSync(gitDir).isDirectory()) {
      this.logger.debug(
        '[GitWatcher] No .git directory found, skipping watch',
        { workspacePath } as unknown as Error,
      );
      return;
    }

    this.logger.info('[GitWatcher] Starting file system watchers', {
      workspacePath,
    } as unknown as Error);

    // Watch .git/HEAD (branch switches)
    this.watchFile(
      path.join(gitDir, 'HEAD'),
      GitWatcherService.GIT_DEBOUNCE_MS,
    );

    // Watch .git/index (staging changes)
    this.watchFile(
      path.join(gitDir, 'index'),
      GitWatcherService.GIT_DEBOUNCE_MS,
    );

    // Watch .git/refs/ directory (commits, remote updates)
    const refsDir = path.join(gitDir, 'refs');
    if (fs.existsSync(refsDir)) {
      this.watchDirectory(refsDir, GitWatcherService.GIT_DEBOUNCE_MS);
    }

    // Watch workspace root recursively for file modifications (unstaged changes)
    // and structural changes (file add/delete for tree refresh).
    this.watchWorkspaceRoot(workspacePath);

    // Push initial state immediately
    this.fetchAndPush();
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
   * Watch a single file for changes.
   */
  private watchFile(filePath: string, debounceMs: number): void {
    if (!fs.existsSync(filePath)) return;

    try {
      const watcher = fs.watch(filePath, () => {
        this.scheduleUpdate(debounceMs);
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
   * Watch a directory (non-recursive) for changes.
   */
  private watchDirectory(dirPath: string, debounceMs: number): void {
    try {
      const watcher = fs.watch(dirPath, { recursive: false }, () => {
        this.scheduleUpdate(debounceMs);
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
