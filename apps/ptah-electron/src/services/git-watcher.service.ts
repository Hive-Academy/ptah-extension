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
import {
  MESSAGE_TYPES,
  WATCH_IGNORED_DIRS,
  isExcludedWorkspacePath,
} from '@ptah-extension/shared';
import type {
  GitChangeKind,
  GitInfoResult,
  GitStatusUpdatePayload,
} from '@ptah-extension/shared';

/**
 * The four push message types this watcher emits.
 *
 * These are aliases for the shared `MESSAGE_TYPES` entries — the wire
 * strings are unchanged from the local constants they replaced
 * ('git:status-update', 'file:tree-changed', 'file:content-changed',
 * 'editor:reread-open-tabs'). Both sides of the wire now name the same
 * constant, so the frontend `MessageHandler` registrations cannot drift
 * from what this service broadcasts.
 */

/** Message type used for pushing git status to the renderer. */
const GIT_STATUS_UPDATE = MESSAGE_TYPES.GIT_STATUS_UPDATE;

/** Message type used for pushing file tree invalidation to the renderer. */
const FILE_TREE_CHANGED = MESSAGE_TYPES.FILE_TREE_CHANGED;

/** Message type used for pushing file content change notifications to the renderer. */
const FILE_CONTENT_CHANGED = MESSAGE_TYPES.FILE_CONTENT_CHANGED;

/**
 * Message type used to ask the renderer to re-read every currently open
 * editor tab from disk. Emitted after a git operation (commit, checkout,
 * reset, push, branch switch) since git mutates files atomically via
 * rename, which fs.watch does not always surface as a per-file change.
 */
const EDITOR_REREAD_OPEN_TABS = MESSAGE_TYPES.EDITOR_REREAD_OPEN_TABS;

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

  /**
   * Pending workspace-switch debounce. Rapid successive `switchWorkspace`
   * calls (A→B→A) collapse to a single re-arm on the FINAL target so we do not
   * tear down and rebuild the recursive `fs.watch` on every intermediate hop.
   */
  private switchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSwitchPath: string | null = null;

  /**
   * Deferred initial `fetchAndPush` timer. The first git fetch after arming is
   * pushed onto a later tick so it does not compete with the switch itself.
   */
  private initialFetchTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Distinct change kinds accumulated across the current debounce window(s).
   * Drained on every `fetchAndPush` so the broadcast carries a precise
   * `causes` list and downstream consumers can skip RPCs whose triggers
   * never fired. Shared across the git-ops and workspace schedulers because
   * a single user action (e.g. `git pull`) commonly fires both.
   */
  private readonly pendingCauses = new Set<GitChangeKind>();

  /**
   * Timestamp of the first event in the burst currently coalescing on each
   * channel, or null when no burst is in flight. Read only by the max-wait
   * ceiling check in {@link burstExpired}.
   *
   * A plain re-arming debounce starves: on a machine with ambient churn (Nx
   * daemon, editor autosave, watch-mode builds) events keep arriving inside
   * the window, the timer is cleared every time, and the trailing edge never
   * runs. Measured against this repository, the 2000 ms workspace channel
   * produced 0 pushes across a 60 s window despite 655 qualifying events (734
   * when the defect was first recorded), so git decorations silently froze.
   * Stamping the burst start lets each channel force its trailing edge once
   * the ceiling is crossed.
   */
  private workspaceBurstStartedAt: number | null = null;
  private treeBurstStartedAt: number | null = null;
  private gitOpsBurstStartedAt: number | null = null;
  private readonly contentChangeBurstStarts = new Map<string, number>();

  /** Debounce interval for file content change notifications (ms). */
  private static readonly CONTENT_CHANGE_DEBOUNCE_MS = 500;

  /** Debounce interval for .git changes (ms). Git operations fire multiple events. */
  private static readonly GIT_DEBOUNCE_MS = 500;

  /** Debounce interval for workspace file changes (ms). Longer to avoid noise. */
  private static readonly WORKSPACE_DEBOUNCE_MS = 2000;

  /** Debounce interval for file tree refresh (ms). Batches bulk ops (git pull, npm install) without making routine file creation feel laggy. */
  private static readonly TREE_DEBOUNCE_MS = 500;

  /**
   * Max-wait ceiling for the workspace `git status` channel (ms).
   *
   * Four debounce windows. Under sustained churn this caps the shell-out at
   * one `git status` per 8 s — the most expensive of the four channels, and
   * the one whose staleness the user reads as a frozen decoration rather
   * than a missing refresh, so it buys the largest coalescing win per forced
   * fire. Eight seconds is also short enough that a decoration is never more
   * than one glance out of date.
   */
  private static readonly WORKSPACE_MAX_WAIT_MS = 8000;

  /**
   * Max-wait ceiling for the .git-operations channel (ms).
   *
   * Four debounce windows, as with every 500 ms channel. A single git command
   * writes HEAD, index and refs within milliseconds, so a burst that is still
   * alive 2 s later is churn rather than one operation — at that point the
   * pending commit/checkout is worth pushing even if more events follow.
   */
  private static readonly GIT_OPS_MAX_WAIT_MS = 2000;

  /**
   * Max-wait ceiling for the file-tree refresh channel (ms).
   *
   * Four debounce windows. The push is a bare invalidation the renderer
   * answers with one `editor:getFileTree`, so forcing it is cheap; 2 s keeps
   * the explorer usable during a bulk operation instead of leaving it frozen
   * until the operation ends.
   */
  private static readonly TREE_MAX_WAIT_MS = 2000;

  /**
   * Max-wait ceiling for per-file content-change notifications (ms).
   *
   * Four debounce windows. Timers here are per file path, so a burst only
   * ever means one file being rewritten repeatedly (a generator, a
   * formatter-on-save loop); 2 s bounds how long the open editor can show
   * stale content while still coalescing a normal save flurry.
   */
  private static readonly CONTENT_CHANGE_MAX_WAIT_MS = 2000;

  /** Debounce interval for workspace switches (ms). Rapid A→B→A switching re-arms watchers only once, on the final target. */
  private static readonly SWITCH_DEBOUNCE_MS = 300;

  /** Delay before the initial post-arm git fetch (ms). Keeps the switch itself uncontended by the first `git status`. */
  private static readonly INITIAL_FETCH_DELAY_MS = 50;

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
    this.stop();

    this.workspacePath = workspacePath;
    this.broadcastFn = broadcast;
    this.isDisposed = false;

    this.logger.info('[GitWatcher] Starting file system watchers', {
      workspacePath,
    } as unknown as Error);
    this.watchWorkspaceRoot(workspacePath);
    const gitDir = this.resolveGitDir(workspacePath);
    if (!gitDir) {
      this.logger.debug(
        '[GitWatcher] No .git directory found, skipping git-specific watchers',
        { workspacePath } as unknown as Error,
      );
      return;
    }

    this.watchFile(path.join(gitDir, 'HEAD'), () =>
      this.scheduleGitOpsRefresh('head'),
    );
    this.watchFile(path.join(gitDir, 'index'), () =>
      this.scheduleGitOpsRefresh('index'),
    );

    const refsDir = path.join(gitDir, 'refs');
    if (fs.existsSync(refsDir)) {
      this.watchDirectory(refsDir, (filename) =>
        this.scheduleGitOpsRefresh(
          filename === 'stash' ? 'refs-stash' : 'refs',
        ),
      );
    }
    this.watchFile(path.join(gitDir, 'packed-refs'), () =>
      this.scheduleGitOpsRefresh('refs'),
    );
    this.watchFile(path.join(gitDir, 'ORIG_HEAD'), () =>
      this.scheduleGitOpsRefresh('head'),
    );
    this.watchFile(path.join(gitDir, 'FETCH_HEAD'), () =>
      this.scheduleGitOpsRefresh('refs'),
    );

    // Defer the initial fetch slightly so the `git status` shell-out does not
    // compete with the switch that just armed these watchers.
    if (this.initialFetchTimer) {
      clearTimeout(this.initialFetchTimer);
    }
    this.initialFetchTimer = setTimeout(() => {
      this.initialFetchTimer = null;
      if (!this.isDisposed) {
        void this.fetchAndPush();
      }
    }, GitWatcherService.INITIAL_FETCH_DELAY_MS);
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
   *
   * Debounced: rapid successive switches collapse to a single re-arm on the
   * FINAL target. If that final target is the path already being watched (the
   * classic A→B→A bounce), the queued restart is dropped so the current
   * watchers are left in place — A stays watched, no teardown/rebuild churn.
   */
  switchWorkspace(workspacePath: string): void {
    // Already watching this path and nothing queued → nothing to do.
    if (
      this.pendingSwitchPath === null &&
      this.workspacePath === workspacePath
    ) {
      return;
    }

    this.pendingSwitchPath = workspacePath;
    if (this.switchDebounceTimer) {
      clearTimeout(this.switchDebounceTimer);
    }
    this.switchDebounceTimer = setTimeout(() => {
      this.switchDebounceTimer = null;
      const target = this.pendingSwitchPath;
      this.pendingSwitchPath = null;
      if (target && target !== this.workspacePath && this.broadcastFn) {
        this.start(target, this.broadcastFn);
      }
    }, GitWatcherService.SWITCH_DEBOUNCE_MS);
  }

  /**
   * Stop all watchers and clean up.
   */
  stop(): void {
    this.isDisposed = true;

    if (this.switchDebounceTimer) {
      clearTimeout(this.switchDebounceTimer);
      this.switchDebounceTimer = null;
    }
    this.pendingSwitchPath = null;

    if (this.initialFetchTimer) {
      clearTimeout(this.initialFetchTimer);
      this.initialFetchTimer = null;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.workspaceBurstStartedAt = null;

    if (this.treeDebounceTimer) {
      clearTimeout(this.treeDebounceTimer);
      this.treeDebounceTimer = null;
    }
    this.treeBurstStartedAt = null;

    if (this.gitOpsDebounceTimer) {
      clearTimeout(this.gitOpsDebounceTimer);
      this.gitOpsDebounceTimer = null;
    }
    this.gitOpsBurstStartedAt = null;

    for (const timer of this.contentChangeTimers.values()) {
      clearTimeout(timer);
    }
    this.contentChangeTimers.clear();
    this.contentChangeBurstStarts.clear();

    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];

    this.pendingCauses.clear();
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
   * scheduler callback. The callback receives the changed entry's filename
   * (or null when the platform doesn't surface it) so the caller can refine
   * the broadcast kind — e.g. distinguishing `refs/stash` from other refs.
   */
  private watchDirectory(
    dirPath: string,
    onChange: (filename: string | null) => void,
  ): void {
    try {
      const watcher = fs.watch(
        dirPath,
        { recursive: false },
        (_event, filename) => {
          onChange(typeof filename === 'string' ? filename : null);
        },
      );

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
   * True when a workspace-root watch event names a path Ptah does not track.
   *
   * A one-line adapter over the shared predicate — it holds no list of its
   * own; `WATCH_IGNORED_DIRS` in `@ptah-extension/shared` is the only place
   * directory names are enumerated. It exists so the decision is reachable
   * from a unit test without intercepting `fs.watch`, whose export is
   * non-configurable and therefore not spy-able.
   */
  private isIgnoredWorkspaceEvent(filename: string | null): boolean {
    return (
      typeof filename === 'string' &&
      isExcludedWorkspacePath(filename, WATCH_IGNORED_DIRS)
    );
  }

  /**
   * Watch the workspace root recursively for both git status changes
   * and structural changes (file add/delete/rename).
   *
   * - All file events schedule a git status update (existing behavior).
   * - 'rename' events (file add/delete) also schedule a file tree refresh
   *   push to the renderer so the file explorer stays in sync.
   *
   * Events under an excluded directory are dropped before they can re-arm the
   * debounce timer — see `WATCH_IGNORED_DIRS` in `@ptah-extension/shared`,
   * which is the single source of truth this and the file-tree builder share.
   *
   * NOTE: the exclusion applies HERE ONLY. The dedicated `.git/HEAD`,
   * `.git/index` and `.git/refs/` watchers armed via `watchFile` /
   * `watchDirectory` must never be filtered — `.git` is excluded from this
   * recursive watcher precisely because those dedicated watchers own it, and
   * routing them through the same predicate would stop every commit, stage,
   * checkout and branch switch from being detected.
   *
   * Uses recursive: true which is natively supported on Windows and macOS.
   */
  private watchWorkspaceRoot(dirPath: string): void {
    try {
      const watcher = fs.watch(
        dirPath,
        { recursive: true },
        (eventType, filename) => {
          if (this.isIgnoredWorkspaceEvent(filename)) {
            return;
          }
          this.scheduleUpdate(
            GitWatcherService.WORKSPACE_DEBOUNCE_MS,
            'workspace',
          );
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
   * True when the burst that started at `burstStartedAt` has already run for
   * at least `maxWaitMs`, i.e. the trailing edge must be forced now rather
   * than re-armed for the umpteenth time.
   *
   * Null means no burst is in flight, so nothing can have expired. Callers
   * stamp the field on the first event of a burst and clear it when the burst
   * fires, which makes the ceiling relative to the burst rather than to the
   * process.
   *
   * Deliberately NOT applied to `switchDebounceTimer`: that channel coalesces
   * discrete user-initiated workspace switches, not file-system churn, and
   * forcing it mid-sequence would tear down and re-arm the recursive watcher
   * on an intermediate target — the exact churn its debounce exists to avoid.
   */
  private static burstExpired(
    burstStartedAt: number | null,
    maxWaitMs: number,
  ): boolean {
    return burstStartedAt !== null && Date.now() - burstStartedAt >= maxWaitMs;
  }

  /**
   * Schedule a debounced file tree refresh push.
   * Uses a longer debounce than git status to batch bulk operations (e.g. git pull).
   *
   * Bounded by TREE_MAX_WAIT_MS: continuous arrivals can delay the push, but
   * never suppress it indefinitely.
   */
  private scheduleTreeRefresh(): void {
    if (this.isDisposed) return;

    this.treeBurstStartedAt ??= Date.now();

    if (this.treeDebounceTimer) {
      clearTimeout(this.treeDebounceTimer);
      this.treeDebounceTimer = null;
    }

    const fire = (): void => {
      this.treeDebounceTimer = null;
      this.treeBurstStartedAt = null;
      if (!this.isDisposed && this.broadcastFn) {
        this.broadcastFn(FILE_TREE_CHANGED, {});
      }
    };

    if (
      GitWatcherService.burstExpired(
        this.treeBurstStartedAt,
        GitWatcherService.TREE_MAX_WAIT_MS,
      )
    ) {
      fire();
      return;
    }

    this.treeDebounceTimer = setTimeout(
      fire,
      GitWatcherService.TREE_DEBOUNCE_MS,
    );
  }

  /**
   * Schedule a debounced content-change notification for a specific file.
   * Each file gets its own debounce timer so rapid saves to the same file
   * coalesce, but changes to different files are independent.
   */
  private scheduleContentChange(workspaceRoot: string, filename: string): void {
    if (this.isDisposed) return;

    const fullPath = path.join(workspaceRoot, filename).replace(/\\/g, '/');

    if (!this.contentChangeBurstStarts.has(fullPath)) {
      this.contentChangeBurstStarts.set(fullPath, Date.now());
    }

    const existing = this.contentChangeTimers.get(fullPath);
    if (existing) {
      clearTimeout(existing);
      this.contentChangeTimers.delete(fullPath);
    }

    const fire = (): void => {
      this.contentChangeTimers.delete(fullPath);
      this.contentChangeBurstStarts.delete(fullPath);
      if (!this.isDisposed && this.broadcastFn) {
        this.broadcastFn(FILE_CONTENT_CHANGED, { filePath: fullPath });
      }
    };

    // Bounded by CONTENT_CHANGE_MAX_WAIT_MS so a file being rewritten in a
    // tight loop still surfaces to the open editor.
    if (
      GitWatcherService.burstExpired(
        this.contentChangeBurstStarts.get(fullPath) ?? null,
        GitWatcherService.CONTENT_CHANGE_MAX_WAIT_MS,
      )
    ) {
      fire();
      return;
    }

    this.contentChangeTimers.set(
      fullPath,
      setTimeout(fire, GitWatcherService.CONTENT_CHANGE_DEBOUNCE_MS),
    );
  }

  /**
   * Schedule a debounced git-operation refresh: pushes git status AND
   * tells the renderer to re-read every open editor tab from disk.
   *
   * Coalesces a flurry of .git/* events (a single git command can write
   * HEAD, index, and refs in rapid succession) into one broadcast pair.
   * The originating `kind` is added to `pendingCauses` so consumers can
   * skip RPCs whose triggers never fired during the window.
   *
   * Bounded by GIT_OPS_MAX_WAIT_MS so a long flurry of .git writes still
   * reports the operation that is already complete.
   */
  private scheduleGitOpsRefresh(kind: GitChangeKind): void {
    if (this.isDisposed) return;

    this.pendingCauses.add(kind);
    this.gitOpsBurstStartedAt ??= Date.now();

    if (this.gitOpsDebounceTimer) {
      clearTimeout(this.gitOpsDebounceTimer);
      this.gitOpsDebounceTimer = null;
    }

    const fire = (): void => {
      this.gitOpsDebounceTimer = null;
      this.gitOpsBurstStartedAt = null;
      if (this.isDisposed || !this.broadcastFn) return;
      void this.fetchAndPush();
      this.broadcastFn(EDITOR_REREAD_OPEN_TABS, {});
    };

    if (
      GitWatcherService.burstExpired(
        this.gitOpsBurstStartedAt,
        GitWatcherService.GIT_OPS_MAX_WAIT_MS,
      )
    ) {
      fire();
      return;
    }

    this.gitOpsDebounceTimer = setTimeout(
      fire,
      GitWatcherService.GIT_DEBOUNCE_MS,
    );
  }

  /**
   * Schedule a debounced git status fetch + push.
   * Resets the timer on each call so rapid events coalesce.
   *
   * Bounded by WORKSPACE_MAX_WAIT_MS. This is the channel the live-monorepo
   * measurement caught starving outright: without the ceiling, ambient churn
   * kept re-arming the 2000 ms timer and `git:status-update` never fired.
   */
  private scheduleUpdate(debounceMs: number, kind: GitChangeKind): void {
    if (this.isDisposed) return;

    this.pendingCauses.add(kind);
    this.workspaceBurstStartedAt ??= Date.now();

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    const fire = (): void => {
      this.debounceTimer = null;
      this.workspaceBurstStartedAt = null;
      void this.fetchAndPush();
    };

    if (
      GitWatcherService.burstExpired(
        this.workspaceBurstStartedAt,
        GitWatcherService.WORKSPACE_MAX_WAIT_MS,
      )
    ) {
      fire();
      return;
    }

    this.debounceTimer = setTimeout(fire, debounceMs);
  }

  /**
   * Drain the accumulated cause set. Returns `['initial']` when empty so
   * the bootstrap push (and any defensive call paths) carry a non-empty
   * causes list — consumers treat 'initial' as "refresh everything".
   */
  private drainCauses(): readonly GitChangeKind[] {
    if (this.pendingCauses.size === 0) {
      return ['initial'];
    }
    const list = Array.from(this.pendingCauses);
    this.pendingCauses.clear();
    return list;
  }

  /**
   * Fetch git info and push to renderer with the drained causes set.
   */
  private async fetchAndPush(): Promise<void> {
    if (this.isDisposed || !this.workspacePath || !this.broadcastFn) return;

    const causes = this.drainCauses();
    const workspaceRoot = this.workspacePath;

    // Reaching here means the repository changed on disk. `GitInfoService`
    // caches the branch list, stash list, tags, remotes and last commit until
    // something says otherwise, and a change made OUTSIDE Ptah (a `git
    // checkout` in the integrated terminal) reaches the service no other way —
    // its own invalidation only covers commands it ran itself. Dropping the
    // entries here, before the status fetch, is what keeps the status this
    // push carries and the branch list the renderer asks for next describing
    // the same instant (TASK_2026_343).
    this.gitInfo.invalidateReadCache(workspaceRoot);

    try {
      const result: GitInfoResult =
        await this.gitInfo.getGitInfo(workspaceRoot);
      if (this.workspacePath !== workspaceRoot) return;
      const payload: GitStatusUpdatePayload = {
        ...result,
        causes,
        workspaceRoot,
      };
      this.broadcastFn(GIT_STATUS_UPDATE, payload);
    } catch (err) {
      this.logger.warn('[GitWatcher] Failed to fetch git info', {
        error: err instanceof Error ? err.message : String(err),
      } as unknown as Error);
    }
  }
}
