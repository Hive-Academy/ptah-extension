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
 *   2. Subscribe to the workspace root unconditionally (NOT gated on `.git`
 *      existence) so an agent's working-tree edit schedules a `git status`
 *      refresh even in a non-git workspace.
 *   3. Push `file:content-changed` batches when workspace files are modified
 *      externally — one push per coalesced window, never one per file
 *      (TASK_2026_437 INV-5).
 *
 * Watches (git side, dedicated non-recursive `fs.watch` handles):
 * - .git/HEAD      (branch switches, checkouts)
 * - .git/index     (staging area changes: git add/reset)
 * - .git/refs/     (new commits, remote updates, tag creation)
 * - .git/worktrees/ (worktree add/remove — re-lists the nested-root seed)
 *
 * ## The workspace feed is a batched port (TASK_2026_437 C10, INV-1)
 *
 * On 2026-09-14 removing ten agent worktrees (~7,400 files each) delivered tens
 * of thousands of events to this service's recursive `fs.watch` callback on the
 * Electron main thread and froze the app. The workspace root is no longer
 * watched here. It is one `IWorkspaceWatcher` subscription
 * (`PLATFORM_TOKENS.WORKSPACE_WATCHER`): in Electron, `@parcel/watcher` in a
 * supervised watch host. Everything per-event happens in that host — exclusion
 * (`WATCH_IGNORED_DIRS`, `NESTED_WORKSPACE_PATH_RULES`, nested repository roots
 * seeded from `git worktree list` and detected at runtime), storm breaking and
 * coalescing. This service receives at most four batches a second, each with
 * at most 500 paths, or one `overflow` marker.
 *
 * - A normal batch schedules the debounced status refresh and adds its
 *   `update` paths to the one pending content set.
 * - An `overflow` or `truncated` batch means "the paths are incomplete": it is
 *   folded into exactly ONE `refreshGitInfo` plus ONE truncated content push,
 *   absorbing any refresh still pending on the debounce. A degraded adapter
 *   repeats `overflow` every 60 s; each costs one refresh, and a refresh already
 *   running is joined by `GitInfoService`'s single flight, so they never stack.
 *
 * The file-tree refresh job (`scheduleTreeRefresh`, `FILE_TREE_CHANGED`) was
 * removed in TASK_2026_385 Batch 4.3 along with the file explorer it fed.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { GitInfoService, Logger } from '@ptah-extension/vscode-core';
import type {
  IDisposable,
  IWorkspaceWatcher,
  WorkspaceChangeBatch,
} from '@ptah-extension/platform-core';
import {
  MESSAGE_TYPES,
  NESTED_WORKSPACE_PATH_RULES,
  NestedRepoRoots,
  WATCH_IGNORED_DIRS,
  isExcludedWorkspacePath,
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

/** `WATCH_IGNORED_DIRS` as the port's array channel, built once. */
const WATCH_IGNORED_DIR_NAMES: readonly string[] = [...WATCH_IGNORED_DIRS];

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
   * tear down and rebuild the workspace subscription on every intermediate hop.
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

  /** The live workspace-root subscription on the batched port. */
  private workspaceSubscription: IDisposable | null = null;

  /**
   * The absolute nested repository roots the live subscription was created
   * with, sorted. A worktree re-list that yields the same set does not
   * resubscribe.
   */
  private subscribedNestedRoots: readonly string[] = [];

  /** Debounce for re-listing worktrees after a `.git/worktrees` change. */
  private nestedRootsRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Bumped by every `start` and `stop`, so a worktree listing or a batch that
   * lands after the watcher moved on is discarded instead of acting on the
   * workspace now being watched.
   */
  private armGeneration = 0;

  /**
   * Sequence of the latest `git worktree list` started. Two listings in flight
   * together (rapid worktree churn) can resolve in either order; only the one
   * started last may resubscribe, so a stale list never replaces a newer one.
   */
  private worktreeListingSeq = 0;

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

  /**
   * Batch interval — and leading-edge hold — for the workspace subscription
   * (ms). `@parcel/watcher` reports the first change of a burst on its own and
   * the rest up to `MAX_WAIT_TIME` (500 ms) plus `MIN_WAIT_TIME` (50 ms) later
   * (`src/Debounce.cc` `notifyIfReady`/`wait`); measured on Windows, a
   * tree delete's lone first event led its flood by ~470 ms. Holding the first
   * batch for twice that ceiling lets the flood enter the host's storm while
   * the lone event is still pending, so one delete costs one refresh (AC-2).
   * It costs at most one second of extra latency on a change after quiet,
   * inside the 2 s status debounce.
   */
  private static readonly WORKSPACE_BATCH_INTERVAL_MS = 1000;

  /** Debounce for re-listing worktrees (ms). `git worktree add` writes several records at once. */
  private static readonly NESTED_ROOTS_REFRESH_DEBOUNCE_MS = 500;

  /** Debounce interval for workspace switches (ms). Rapid A→B→A switching re-arms watchers only once, on the final target. */
  private static readonly SWITCH_DEBOUNCE_MS = 300;

  /** Delay before the initial post-arm git fetch (ms). Keeps the switch itself uncontended by the first `git status`. */
  private static readonly INITIAL_FETCH_DELAY_MS = 50;

  constructor(
    private readonly gitInfo: GitInfoService,
    private readonly logger: Logger,
    private readonly workspaceWatcher: IWorkspaceWatcher,
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

    this.logger.info('[GitWatcher] Starting file system watchers', {
      workspacePath,
    });
    // Subscribed at once with the static rules; the worktree listing below
    // resubscribes only when it finds a worktree registered under the root.
    this.subscribeWorkspace(workspacePath, []);
    const gitDir = this.resolveGitDir(workspacePath);
    if (!gitDir) {
      this.logger.debug(
        '[GitWatcher] No .git directory found, skipping git-specific watchers',
        { workspacePath },
      );
      return;
    }

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

    if (this.nestedRootsRefreshTimer) {
      clearTimeout(this.nestedRootsRefreshTimer);
      this.nestedRootsRefreshTimer = null;
    }

    this.disposeWorkspaceSubscription(this.workspaceSubscription);
    this.workspaceSubscription = null;
    this.subscribedNestedRoots = [];

    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];

    this.pendingCauses.clear();
  }

  /**
   * Subscribe to the workspace root, replacing any live subscription.
   *
   * The new subscription is created BEFORE the old one is disposed, so a
   * resubscribe never opens a window with no feed; a change reported by both
   * during the overlap only re-arms the same debounce.
   *
   * Excluded here, in the watch host: `WATCH_IGNORED_DIRS` (the workspace's own
   * `.git` among them — the dedicated `.git` watchers own it, and routing them
   * through this exclusion would stop every commit, stage and checkout from
   * being detected), agent worktree directories, and nested repositories — the
   * `nestedRoots` seed plus any `.git` entry the host sees below the root.
   */
  private subscribeWorkspace(
    workspaceRoot: string,
    nestedRoots: readonly string[],
  ): void {
    const generation = this.armGeneration;
    const previous = this.workspaceSubscription;
    try {
      this.workspaceSubscription = this.workspaceWatcher.watch(
        workspaceRoot,
        {
          excludeGlobs: [],
          excludeDirNames: WATCH_IGNORED_DIR_NAMES,
          excludeSegmentRules: NESTED_WORKSPACE_PATH_RULES,
          nestedRepoDetection: true,
          nestedRepoRoots: nestedRoots,
          minBatchIntervalMs: GitWatcherService.WORKSPACE_BATCH_INTERVAL_MS,
        },
        (batch) => this.onWorkspaceBatch(generation, batch),
      );
      this.subscribedNestedRoots = nestedRoots;
    } catch (err) {
      // degradation-audit: optional-capability - the workspace feed only
      // schedules refreshes; the dedicated .git watchers and every explicit
      // RPC read still work without it. A previous subscription stays live.
      this.logger.warn('[GitWatcher] Failed to watch workspace root', {
        workspaceRoot,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    this.disposeWorkspaceSubscription(previous);
  }

  private disposeWorkspaceSubscription(subscription: IDisposable | null): void {
    if (!subscription) return;
    try {
      subscription.dispose();
    } catch (err) {
      // degradation-audit: optional-capability - a subscription that fails to
      // dispose is still unreachable: its batches are generation-gated.
      this.logger.warn(
        '[GitWatcher] Failed to dispose workspace subscription',
        {
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
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
   * One coalesced batch from the workspace subscription.
   *
   * Per batch, not per event: one status schedule, and one pass over the
   * changed paths into the content set. `update` is the content kind — a
   * create or delete changes git status but not an open file's text.
   *
   * No echo filter: `@parcel/watcher` does not report the directory metadata
   * updates our own `git status` causes on NTFS, which the recursive `fs.watch`
   * this replaced did (TASK_2026_437 FU-4d; pinned by ST-1b in
   * `git-watcher.stress.spec.ts`: no batch reaches main after the rescan).
   */
  private onWorkspaceBatch(
    generation: number,
    batch: WorkspaceChangeBatch,
  ): void {
    if (this.isDisposed || generation !== this.armGeneration) return;
    if (batch.overflow || batch.truncated) {
      this.onWorkspaceOverflow();
      return;
    }
    if (batch.changes.length === 0) return;

    this.scheduleUpdate(GitWatcherService.WORKSPACE_DEBOUNCE_MS, 'workspace');
    let contentChanged = false;
    for (const change of batch.changes) {
      if (change.kind !== 'update') continue;
      this.addContentPath(change.path);
      contentChanged = true;
    }
    if (contentChanged) this.armContentChange();
  }

  /**
   * The batch's paths are incomplete — a storm, a host restart, a degraded
   * rescan tick, or more distinct paths than one batch holds.
   *
   * Exactly one status refresh and one truncated content push, and both are
   * idempotent: a refresh still pending on the workspace debounce and any
   * accumulated content paths are folded in, so a burst of overflows costs one
   * refresh each at most, and `refreshGitInfo` joins a run already in flight.
   */
  private onWorkspaceOverflow(): void {
    this.clearWorkspaceDebounce();
    this.pendingCauses.add('workspace');
    void this.fetchAndPush();

    this.pendingContentPaths.clear();
    this.contentChangeTruncated = true;
    this.flushContentChanges();
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
   * List the worktrees registered under the workspace and resubscribe when
   * that set differs from the one the live subscription holds.
   *
   * Agent worktree directories are left out: the static rules exclude them by
   * name already. A failed listing keeps the current subscription — the static
   * rules and the host's runtime `.git` detection stay in force, so the
   * degradation is only that a pre-existing worktree registered elsewhere under
   * the workspace is watched until a `.git` event reveals it.
   *
   * Accepted cost of a resubscribe: roots the host discovered at runtime belong
   * to the old subscription and are re-detected on their next `.git` event.
   */
  private async refreshNestedRepoRoots(
    workspaceRoot: string,
    generation: number,
  ): Promise<void> {
    const seq = ++this.worktreeListingSeq;
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
    // A listing started after this one owns the answer.
    if (seq !== this.worktreeListingSeq) return;

    const nestedRoots = NestedRepoRoots.fromWorktreeList(
      worktrees,
      workspaceRoot,
    )
      .roots()
      .filter(
        (root) =>
          !isExcludedWorkspacePath(
            root,
            WATCH_IGNORED_DIRS,
            NESTED_WORKSPACE_PATH_RULES,
          ),
      )
      .map((root) => path.join(workspaceRoot, root))
      .sort();
    if (sameRoots(nestedRoots, this.subscribedNestedRoots)) return;

    this.logger.debug('[GitWatcher] Excluding nested worktree roots', {
      workspaceRoot,
      roots: nestedRoots,
    });
    this.subscribeWorkspace(workspaceRoot, nestedRoots);
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
   * forcing it mid-sequence would tear down and re-subscribe the workspace
   * feed on an intermediate target — the exact churn its debounce exists to
   * avoid.
   */
  private static burstExpired(
    burstStartedAt: number | null,
    maxWaitMs: number,
  ): boolean {
    return burstStartedAt !== null && Date.now() - burstStartedAt >= maxWaitMs;
  }

  /**
   * Add one changed file to the pending content batch. A path that does not
   * fit under the cap marks the batch truncated instead.
   */
  private addContentPath(absolutePath: string): void {
    if (this.contentChangeTruncated) return;
    const fullPath = absolutePath.replace(/\\/g, '/');
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

  /**
   * (Re-)arm the single content timer. Rapid saves to one file and changes to
   * many files coalesce into the same push.
   */
  private armContentChange(): void {
    if (this.isDisposed) return;

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

/** Both sorted: equal lengths and equal entries. */
function sameRoots(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((root, index) => root === b[index]);
}
