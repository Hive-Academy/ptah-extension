/**
 * Git Watcher Service
 *
 * Despite the name, this service drives BOTH git status push updates AND
 * content-change notifications to the renderer. The class name is preserved
 * for backward compatibility with DI wiring and call sites; functionally it is
 * a workspace + git watcher hybrid.
 *
 * Responsibilities:
 *   1. Watch the .git directory (when present) and push `git:status-update`
 *      events whenever HEAD, index, or refs change. This replaced the
 *      frontend `git:info` polling loop with event-driven push.
 *   2. Watch the workspace root unconditionally (NOT gated on `.git`
 *      existence) so an agent's working-tree edit schedules a `git status`
 *      refresh even in a non-git workspace.
 *   3. Push `file:content-changed` batches when workspace files are modified
 *      externally — one push per coalesced window, never one per file
 *      (TASK_2026_437 INV-5).
 *
 * Watches (git side):
 * - .git/HEAD      (branch switches, checkouts)
 * - .git/index     (staging area changes: git add/reset)
 * - .git/refs/     (new commits, remote updates, tag creation)
 * - .git/worktrees/ (worktree add/remove — refreshes the nested-root set)
 *
 * ## Bounded main-thread cost (TASK_2026_437)
 *
 * On 2026-09-14 removing ten agent worktrees (~7,400 files each) delivered tens
 * of thousands of events to this watcher's recursive `fs.watch` callback on the
 * Electron main thread and froze the app. Three layers now bound that cost:
 *
 *   - **Exclusion.** An event under `WATCH_IGNORED_DIRS`, an agent worktree
 *     directory (`NESTED_WORKSPACE_PATH_RULES`) or a nested repository root
 *     (`NestedRepoRoots`, seeded from `git worktree list` and extended at
 *     runtime whenever a `.git` entry shows up below the root) is dropped
 *     before it can touch a timer. Nested-root detection runs BEFORE the `.git`
 *     segment filter, because that filter is what would otherwise hide the
 *     `pkg/sub/.git` event revealing the root.
 *   - **Storm breaker.** Every surviving event is counted by an
 *     `EventStormBreaker`. Above its rate threshold the callback stops doing
 *     per-event work: no timer re-arm, no path accumulation. ONE timer, armed
 *     from `msUntilNextPoll`, checks for the exit; on exit (quiet, or the
 *     forced `maxStormMs` refresh of a storm that never ends) exactly one
 *     `refreshGitInfo` and one truncated content push are issued. A storm that
 *     never quiets therefore logs one enter/exit pair per `maxStormMs`.
 *   - **Single content timer.** Content changes accumulate into one capped
 *     path set behind one debounce, instead of a timer per changed file.
 *
 * The file-tree refresh job (`scheduleTreeRefresh`, `FILE_TREE_CHANGED`) was
 * removed in TASK_2026_385 Batch 4.3 along with the file explorer it fed.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { GitInfoService, Logger } from '@ptah-extension/vscode-core';
import {
  EventStormBreaker,
  readEventStormBreakerOptionsFromEnv,
} from '@ptah-extension/platform-core';
import {
  MESSAGE_TYPES,
  NESTED_WORKSPACE_PATH_RULES,
  NestedRepoRoots,
  WATCH_IGNORED_DIRS,
  isExcludedWorkspacePath,
  nestedRepoRootOf,
} from '@ptah-extension/shared';
import type {
  FileContentChangedPayload,
  GitChangeKind,
  GitInfoResult,
  GitStatusUpdatePayload,
  GitWorktreeInfo,
} from '@ptah-extension/shared';

/**
 * The two push message types this watcher emits.
 *
 * These are aliases for the shared `MESSAGE_TYPES` entries — the wire
 * strings are unchanged from the local constants they replaced
 * ('git:status-update', 'file:content-changed'). Both sides of the wire now
 * name the same constant, so the frontend `MessageHandler` registrations
 * cannot drift from what this service broadcasts.
 */

/** Message type used for pushing git status to the renderer. */
const GIT_STATUS_UPDATE = MESSAGE_TYPES.GIT_STATUS_UPDATE;

/** Message type used for pushing file content change notifications to the renderer. */
const FILE_CONTENT_CHANGED = MESSAGE_TYPES.FILE_CONTENT_CHANGED;

/**
 * A workspace-root event naming the workspace's own `.git/worktrees` directory
 * or one worktree record directly inside it — `git worktree add|remove|prune`.
 * Deeper paths (`.git/worktrees/<name>/HEAD`) are ordinary commits inside a
 * worktree and must not re-list worktrees on every one of them.
 */
const ROOT_WORKTREES_EVENT = /^\.git[\\/]worktrees(?:[\\/][^\\/]+)?[\\/]?$/;

/** A workspace-root event inside the workspace's own `.git` directory. */
const ROOT_GIT_DIR_EVENT = /^\.git(?:[\\/]|$)/;

export class GitWatcherService {
  private watchers: fs.FSWatcher[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private gitOpsDebounceTimer: ReturnType<typeof setTimeout> | null = null;
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
  private gitOpsBurstStartedAt: number | null = null;
  private contentChangeBurstStartedAt: number | null = null;

  /**
   * Forward-slash absolute paths changed in the current content window. Capped
   * at {@link MAX_PENDING_CONTENT_PATHS}; a path that does not fit sets
   * {@link contentChangeTruncated} instead, which tells the renderer to
   * revalidate everything rather than trust the list.
   */
  private readonly pendingContentPaths = new Set<string>();
  private contentChangeTruncated = false;
  private contentChangeTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Rate guard for the recursive workspace watcher. Replaced on every `start`
   * so a storm on one workspace never carries over to the next.
   */
  private stormBreaker = GitWatcherService.createStormBreaker();

  /** The one timer that checks for a storm's exit, armed from `msUntilNextPoll`. */
  private stormTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * A path containing `.git` arrived while storming. Parsing it then would
   * allocate per event, so the storm exit re-lists worktrees once instead.
   */
  private gitMarkerSeenDuringStorm = false;

  /**
   * Nested repository and worktree roots below the watched workspace. Seeded
   * from `git worktree list`, then extended at runtime by
   * {@link noteGitMarker}.
   */
  private nestedRepoRoots: NestedRepoRoots | null = null;

  /**
   * Workspace-relative roots discovered from `.git` events, kept apart from the
   * worktree list so a re-list does not forget them. A discovered repository
   * that is later deleted stays excluded until the next `start` — the cost is a
   * missed refresh for a directory that no longer exists.
   */
  private readonly discoveredNestedRoots = new Set<string>();

  /** Debounce for re-listing worktrees after a `.git/worktrees` change. */
  private nestedRootsRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Bumped by every `start` and `stop`, so a worktree listing that resolves
   * after the watcher moved on is discarded instead of overwriting the roots of
   * the workspace now being watched.
   */
  private armGeneration = 0;

  /** Latch for "worktree listing failed" — logged once per service, not per refresh. */
  private worktreeListFailureLogged = false;

  /** Debounce interval for file content change notifications (ms). */
  private static readonly CONTENT_CHANGE_DEBOUNCE_MS = 500;

  /** Debounce interval for .git changes (ms). Git operations fire multiple events. */
  private static readonly GIT_DEBOUNCE_MS = 500;

  /** Debounce interval for workspace file changes (ms). Longer to avoid noise. */
  private static readonly WORKSPACE_DEBOUNCE_MS = 2000;

  /**
   * Max-wait ceiling for the workspace `git status` channel (ms).
   *
   * Four `WORKSPACE_DEBOUNCE_MS` windows (4 x 2000 ms). Under sustained churn
   * this caps the shell-out at
   * one `git status` per 8 s — the most expensive of the three channels, and
   * the one whose staleness the user reads as a frozen decoration rather
   * than a missing refresh, so it buys the largest coalescing win per forced
   * fire. Eight seconds is also short enough that a decoration is never more
   * than one glance out of date.
   */
  private static readonly WORKSPACE_MAX_WAIT_MS = 8000;

  /**
   * Max-wait ceiling for the .git-operations channel (ms).
   *
   * Four `GIT_DEBOUNCE_MS` windows (4 x 500 ms). A single git command
   * writes HEAD, index and refs within milliseconds, so a burst that is still
   * alive 2 s later is churn rather than one operation — at that point the
   * pending commit/checkout is worth pushing even if more events follow.
   */
  private static readonly GIT_OPS_MAX_WAIT_MS = 2000;

  /**
   * Max-wait ceiling for content-change notifications (ms).
   *
   * Four `CONTENT_CHANGE_DEBOUNCE_MS` windows (4 x 500 ms), all on the one
   * content timer. One path set collects every changed file,
   * so the ceiling bounds how long the open editor can show stale content
   * while ambient churn keeps re-arming the single content timer.
   */
  private static readonly CONTENT_CHANGE_MAX_WAIT_MS = 2000;

  /**
   * Most paths one `file:content-changed` push carries. Past this the renderer
   * gets `truncated: true` and revalidates every open view once, which is
   * cheaper than matching thousands of paths it mostly does not have open.
   */
  private static readonly MAX_PENDING_CONTENT_PATHS = 256;

  /** Debounce for re-listing worktrees (ms). `git worktree add` writes several records at once. */
  private static readonly NESTED_ROOTS_REFRESH_DEBOUNCE_MS = 500;

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
    this.armGeneration++;
    this.stormBreaker = GitWatcherService.createStormBreaker();
    this.nestedRepoRoots = new NestedRepoRoots(workspacePath);
    this.discoveredNestedRoots.clear();

    this.logger.info('[GitWatcher] Starting file system watchers', {
      workspacePath,
    });
    this.watchWorkspaceRoot(workspacePath);
    const gitDir = this.resolveGitDir(workspacePath);
    if (!gitDir) {
      this.logger.debug(
        '[GitWatcher] No .git directory found, skipping git-specific watchers',
        { workspacePath },
      );
      return;
    }

    // Not awaited: the static rules already cover agent worktree directories,
    // so the watcher is useful before the listing lands.
    void this.refreshNestedRepoRoots(workspacePath, this.armGeneration);

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
    const worktreesDir = path.join(gitDir, 'worktrees');
    if (fs.existsSync(worktreesDir)) {
      this.watchDirectory(worktreesDir, () =>
        this.scheduleNestedRootsRefresh(),
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
      // degradation-audit: optional-capability - following a worktree or
      // submodule gitdir pointer is optional; null means "no git context to
      // watch", the same answer a workspace with no .git at all produces.
      this.logger.warn('[GitWatcher] Failed to resolve gitdir pointer', {
        dotGit,
        error: err instanceof Error ? err.message : String(err),
      });
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
    this.armGeneration++;

    if (this.switchDebounceTimer) {
      clearTimeout(this.switchDebounceTimer);
      this.switchDebounceTimer = null;
    }
    this.pendingSwitchPath = null;

    if (this.initialFetchTimer) {
      clearTimeout(this.initialFetchTimer);
      this.initialFetchTimer = null;
    }

    this.clearWorkspaceDebounce();

    if (this.gitOpsDebounceTimer) {
      clearTimeout(this.gitOpsDebounceTimer);
      this.gitOpsDebounceTimer = null;
    }
    this.gitOpsBurstStartedAt = null;

    this.clearContentChangeTimer();
    this.pendingContentPaths.clear();
    this.contentChangeTruncated = false;

    if (this.stormTimer) {
      clearTimeout(this.stormTimer);
      this.stormTimer = null;
    }
    this.gitMarkerSeenDuringStorm = false;

    if (this.nestedRootsRefreshTimer) {
      clearTimeout(this.nestedRootsRefreshTimer);
      this.nestedRootsRefreshTimer = null;
    }

    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];

    this.pendingCauses.clear();
  }

  /** Breaker with the default thresholds, overridable through `PTAH_WATCH_STORM_*`. */
  private static createStormBreaker(): EventStormBreaker {
    return new EventStormBreaker(
      readEventStormBreakerOptionsFromEnv(process.env),
    );
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
        });
      });

      this.watchers.push(watcher);
    } catch (err) {
      this.logger.warn('[GitWatcher] Failed to watch file', {
        filePath,
        error: err instanceof Error ? err.message : String(err),
      });
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
        });
      });

      this.watchers.push(watcher);
    } catch (err) {
      this.logger.warn('[GitWatcher] Failed to watch directory', {
        dirPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * True when a workspace-root watch event names a path Ptah does not track:
   * an ignored directory, an agent worktree directory, or anything at or below
   * a known nested repository root.
   *
   * It holds no list of its own — `WATCH_IGNORED_DIRS` and
   * `NESTED_WORKSPACE_PATH_RULES` in `@ptah-extension/shared` are the only
   * places directory names are enumerated. It exists so the decision is
   * reachable from a unit test without intercepting `fs.watch`, whose export is
   * non-configurable and therefore not spy-able.
   */
  private isIgnoredWorkspaceEvent(filename: string | null): boolean {
    if (typeof filename !== 'string') return false;
    if (
      isExcludedWorkspacePath(
        filename,
        WATCH_IGNORED_DIRS,
        NESTED_WORKSPACE_PATH_RULES,
      )
    ) {
      return true;
    }
    const roots = this.nestedRepoRoots;
    return roots !== null && roots.size > 0 && roots.contains(filename);
  }

  /**
   * Watch the workspace root recursively for git status changes and
   * content changes. See {@link onWorkspaceEvent} for the per-event path.
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
          this.onWorkspaceEvent(
            dirPath,
            eventType,
            typeof filename === 'string' ? filename : null,
          );
        },
      );

      watcher.on('error', (err) => {
        this.logger.warn('[GitWatcher] Workspace watcher error', {
          dirPath,
          error: err.message,
        });
      });

      this.watchers.push(watcher);
    } catch (err) {
      this.logger.warn('[GitWatcher] Failed to watch workspace root', {
        dirPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * One raw event from the recursive workspace watcher.
   *
   * Order matters and each step is cheap:
   *   1. `.git` marker detection, BEFORE the exclusion filter hides it. A
   *      substring test first; the path is only parsed outside a storm. While
   *      storming, a marker only sets {@link gitMarkerSeenDuringStorm} — a
   *      `git worktree remove` deleting thousands of `.git/worktrees/<name>/…`
   *      files must not allocate per event — and the exit re-lists worktrees
   *      once.
   *   2. The exclusion predicate — excluded events cost nothing further and
   *      never count toward a storm, so a worktree removal can neither refresh
   *      nor push.
   *   3. One breaker counter. While storming, return with no timer touched and
   *      no path accumulated.
   *   4. Normal: schedule the status refresh and, for `change` events, the
   *      content push.
   *
   * Accepted blind spot: events for files of a freshly created nested
   * repository that arrive before its `.git` entry's event (or before the
   * worktree listing lands, or during a storm) are processed as ordinary
   * workspace events — at most one extra refresh. The static rules already
   * cover agent worktree directories, and the next `.git` marker event outside
   * a storm closes the gap.
   */
  private onWorkspaceEvent(
    workspaceRoot: string,
    eventType: string,
    filename: string | null,
  ): void {
    if (this.isDisposed) return;

    if (filename?.includes('.git')) {
      if (this.stormBreaker.isStorming) {
        this.gitMarkerSeenDuringStorm = true;
      } else {
        this.noteGitMarker(filename);
      }
    }
    if (this.isIgnoredWorkspaceEvent(filename)) return;

    switch (this.stormBreaker.record(Date.now())) {
      case 'storming':
        return;
      case 'entered':
        this.enterStorm();
        return;
      case 'normal':
        break;
    }

    this.scheduleUpdate(GitWatcherService.WORKSPACE_DEBOUNCE_MS, 'workspace');
    if (eventType === 'change' && filename) {
      this.scheduleContentChange(workspaceRoot, filename);
    }
  }

  /**
   * React to a workspace-relative path containing `.git`.
   *
   * - The workspace's own `.git/worktrees[/<name>]` → re-list worktrees.
   * - Anything else inside the workspace's own `.git` → nothing.
   * - `pkg/sub/.git[/…]` → `pkg/sub` is a nested repository or worktree root.
   */
  private noteGitMarker(filename: string): void {
    if (ROOT_GIT_DIR_EVENT.test(filename)) {
      if (ROOT_WORKTREES_EVENT.test(filename)) {
        this.scheduleNestedRootsRefresh();
      }
      return;
    }

    const root = nestedRepoRootOf(filename);
    if (root === undefined || this.nestedRepoRoots === null) return;
    if (this.nestedRepoRoots.contains(root)) return;
    // Agent worktree directories are excluded by name already; holding their
    // roots too would only grow the set.
    if (
      isExcludedWorkspacePath(
        root,
        WATCH_IGNORED_DIRS,
        NESTED_WORKSPACE_PATH_RULES,
      )
    ) {
      return;
    }
    if (!this.nestedRepoRoots.add(root)) return;
    this.discoveredNestedRoots.add(root);
    this.logger.debug('[GitWatcher] Excluding nested repository root', {
      root,
    });
  }

  /** Coalesces worktree add/remove bursts into one `git worktree list`. */
  private scheduleNestedRootsRefresh(): void {
    if (this.isDisposed) return;
    const workspaceRoot = this.workspacePath;
    if (!workspaceRoot) return;
    if (this.nestedRootsRefreshTimer) {
      clearTimeout(this.nestedRootsRefreshTimer);
    }
    const generation = this.armGeneration;
    this.nestedRootsRefreshTimer = setTimeout(() => {
      this.nestedRootsRefreshTimer = null;
      void this.refreshNestedRepoRoots(workspaceRoot, generation);
    }, GitWatcherService.NESTED_ROOTS_REFRESH_DEBOUNCE_MS);
  }

  /**
   * Rebuild {@link nestedRepoRoots} from `git worktree list`, keeping the roots
   * discovered at runtime.
   *
   * A failed listing keeps the current set: the static rules still exclude
   * every agent worktree directory, so the degradation is only that a worktree
   * registered elsewhere under the workspace is watched.
   */
  private async refreshNestedRepoRoots(
    workspaceRoot: string,
    generation: number,
  ): Promise<void> {
    let worktrees: GitWorktreeInfo[];
    try {
      worktrees = await this.gitInfo.getWorktrees(workspaceRoot);
    } catch (err) {
      // degradation-audit: optional-capability - nested worktree roots are
      // an addition to the static exclusion rules, which stay in force.
      if (!this.worktreeListFailureLogged) {
        this.worktreeListFailureLogged = true;
        this.logger.warn(
          '[GitWatcher] Could not list worktrees; nested worktree roots are not excluded',
          {
            workspaceRoot,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
      return;
    }
    if (this.armGeneration !== generation || this.isDisposed) return;

    const next = NestedRepoRoots.fromWorktreeList(worktrees, workspaceRoot);
    for (const root of this.discoveredNestedRoots) {
      next.add(root);
    }
    this.nestedRepoRoots = next;
  }

  /**
   * A storm just started: fold every pending per-event job into the single
   * refresh the exit will issue, and arm the one exit timer.
   */
  private enterStorm(): void {
    this.clearWorkspaceDebounce();
    this.clearContentChangeTimer();
    this.logger.warn('[GitWatcher] event storm entered', {
      workspacePath: this.workspacePath,
      stormsEntered: this.stormBreaker.stats().stormsEntered,
    });
    this.armStormTimer();
  }

  /** (Re-)arms the exit check for the earliest moment the storm could end. */
  private armStormTimer(): void {
    const delay = this.stormBreaker.msUntilNextPoll(Date.now());
    if (delay === undefined) return;
    if (this.stormTimer) clearTimeout(this.stormTimer);
    this.stormTimer = setTimeout(() => {
      this.stormTimer = null;
      this.onStormTimer();
    }, delay);
  }

  private onStormTimer(): void {
    if (this.isDisposed) return;
    switch (this.stormBreaker.poll(Date.now())) {
      case 'storming':
        this.armStormTimer();
        return;
      case 'exited':
        this.exitStorm();
        return;
      case 'idle':
        return;
    }
  }

  /**
   * The storm ended (quietly or by `maxStormMs`): exactly one status refresh
   * and one truncated content push, since the events in between were counted
   * but never inspected.
   */
  private exitStorm(): void {
    const stats = this.stormBreaker.stats();
    this.logger.warn('[GitWatcher] event storm exited', {
      workspacePath: this.workspacePath,
      reason: stats.lastExitReason,
      durationMs: stats.lastStormDurationMs,
      events: stats.stormEvents,
    });

    this.clearWorkspaceDebounce();
    this.pendingCauses.add('workspace');
    void this.fetchAndPush();

    if (this.gitMarkerSeenDuringStorm) {
      this.gitMarkerSeenDuringStorm = false;
      this.scheduleNestedRootsRefresh();
    }

    this.contentChangeTruncated = true;
    this.flushContentChanges();
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
   * Add one changed file to the pending content batch and (re-)arm the single
   * content timer. Rapid saves to one file and changes to many files coalesce
   * into the same push.
   */
  private scheduleContentChange(workspaceRoot: string, filename: string): void {
    if (this.isDisposed) return;

    if (!this.contentChangeTruncated) {
      const fullPath = path.join(workspaceRoot, filename).replace(/\\/g, '/');
      if (
        this.pendingContentPaths.size <
          GitWatcherService.MAX_PENDING_CONTENT_PATHS ||
        this.pendingContentPaths.has(fullPath)
      ) {
        this.pendingContentPaths.add(fullPath);
      } else {
        this.contentChangeTruncated = true;
      }
    }

    this.contentChangeBurstStartedAt ??= Date.now();
    if (this.contentChangeTimer) {
      clearTimeout(this.contentChangeTimer);
      this.contentChangeTimer = null;
    }

    // Bounded by CONTENT_CHANGE_MAX_WAIT_MS so a file being rewritten in a
    // tight loop still surfaces to the open editor.
    if (
      GitWatcherService.burstExpired(
        this.contentChangeBurstStartedAt,
        GitWatcherService.CONTENT_CHANGE_MAX_WAIT_MS,
      )
    ) {
      this.flushContentChanges();
      return;
    }

    this.contentChangeTimer = setTimeout(
      () => this.flushContentChanges(),
      GitWatcherService.CONTENT_CHANGE_DEBOUNCE_MS,
    );
  }

  /**
   * Push the pending content batch, if there is anything to say. An empty,
   * untruncated batch is not pushed — the renderer would ignore it anyway.
   */
  private flushContentChanges(): void {
    this.clearContentChangeTimer();
    if (this.isDisposed || !this.broadcastFn) return;
    if (this.pendingContentPaths.size === 0 && !this.contentChangeTruncated) {
      return;
    }
    const payload: FileContentChangedPayload = {
      filePaths: Array.from(this.pendingContentPaths),
      truncated: this.contentChangeTruncated,
    };
    this.pendingContentPaths.clear();
    this.contentChangeTruncated = false;
    this.broadcastFn(FILE_CONTENT_CHANGED, payload);
  }

  private clearContentChangeTimer(): void {
    if (this.contentChangeTimer) {
      clearTimeout(this.contentChangeTimer);
      this.contentChangeTimer = null;
    }
    this.contentChangeBurstStartedAt = null;
  }

  private clearWorkspaceDebounce(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.workspaceBurstStartedAt = null;
  }

  /**
   * Schedule a debounced git-operation refresh: pushes git status.
   *
   * Coalesces a flurry of .git/* events (a single git command can write
   * HEAD, index, and refs in rapid succession) into one broadcast.
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

    try {
      // Reaching here means the repository changed on disk, possibly outside
      // Ptah (a `git checkout` in the integrated terminal), which reaches
      // `GitInfoService` no other way (TASK_2026_343). `refreshGitInfo`
      // invalidates the branch/stash/tag/remote caches and resolves with a
      // status run that started AFTER this call — joining the one queued
      // trailing run when a run is already alive, so a burst of pushes never
      // stacks parallel `git status` pipelines (TASK_2026_437 INV-3).
      const result: GitInfoResult =
        await this.gitInfo.refreshGitInfo(workspaceRoot);
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
      });
    }
  }
}
