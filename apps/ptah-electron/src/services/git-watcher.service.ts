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

export class GitWatcherService {
  private watchers: fs.FSWatcher[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private workspacePath: string | null = null;
  private broadcastFn: ((type: string, payload: unknown) => void) | null = null;
  private isDisposed = false;

  /** Debounce interval for .git changes (ms). Git operations fire multiple events. */
  private static readonly GIT_DEBOUNCE_MS = 500;

  /** Debounce interval for workspace file changes (ms). Longer to avoid noise. */
  private static readonly WORKSPACE_DEBOUNCE_MS = 2000;

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

    // Watch workspace root for file modifications (unstaged changes).
    // Uses a longer debounce since file edits are frequent.
    this.watchDirectory(workspacePath, GitWatcherService.WORKSPACE_DEBOUNCE_MS);

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
