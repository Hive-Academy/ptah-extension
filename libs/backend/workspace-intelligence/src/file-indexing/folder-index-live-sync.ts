/**
 * FolderIndexLiveSync — keeps one open folder's file index live between
 * builds.
 *
 * Split out of `WorkspaceFileIndexService` under the facade rule
 * (TASK_2026_437 FU-11b). The service owns the folder LIFECYCLE — the
 * per-folder cache, activation, the first build, eviction and the queries. This
 * class owns what happens to a built folder afterwards:
 *
 *   - its `IWorkspaceWatcher` subscription (subscribe, dispose, the retry after
 *     a `watch()` that threw);
 *   - each coalesced batch, patched into the folder's maps in one synchronous
 *     pass (deletes, the directory-delete sweep, created paths statted and
 *     re-checked against the ignore rules);
 *   - the one path-only rebuild an incomplete batch triggers, filled into a
 *     staging snapshot and swapped in whole.
 *
 * It holds no folders of its own: every call names the `FolderIndex` it acts
 * on, and every write is gated on that entry's generation, so an entry the
 * service tore down is never written again.
 */

import * as path from 'path';
import picomatch from 'picomatch';
import { FileType } from '@ptah-extension/platform-core';
import type {
  IFileSystemProvider,
  IWorkspaceWatcher,
  WorkspaceChangeBatch,
} from '@ptah-extension/platform-core';
import { NESTED_WORKSPACE_PATH_RULES } from '@ptah-extension/shared';
import type { BackgroundWorkAdmission } from '@ptah-extension/vscode-core';
import { DEFAULT_WORKSPACE_EXCLUDES } from './workspace-default-excludes';
import {
  addAncestorDirectories,
  addFileEntry,
  emptySnapshot,
  liveSnapshots,
  toIndexKey,
  type FolderIndex,
  type FolderSnapshot,
} from './folder-index-snapshot';

/**
 * Most new paths one batch stats at once. A batch holds at most 500 paths; a
 * bounded fan-out keeps a mass create from queueing 500 stats on the thread
 * pool in one turn.
 */
const STAT_CONCURRENCY = 32;

/**
 * Largest folder index (files + directories) a directory delete is swept in
 * place for. Sweeping visits every entry once, synchronously, on the host's
 * main thread; above this a batch holding a directory delete is treated as
 * incomplete and the coalesced path-only rebuild runs instead, whose walk
 * yields between batches. 5,000 entries sweep in well under a millisecond; the
 * largest captured folder (15,249 files, 4,935 directories) rebuilds instead.
 */
const DIRECTORY_DELETE_SWEEP_LIMIT = 5_000;

/**
 * Shortest gap between two attempts to subscribe a folder whose `watch()`
 * threw (ms). The retry rides on `ensureReadyFor`, which autocomplete calls per
 * query, so without a floor a dead watch host would be re-tried per keystroke.
 */
const SUBSCRIBE_RETRY_INTERVAL_MS = 60_000;

/**
 * Logger interface (avoids a hard dependency on vscode-core's concrete Logger).
 */
export interface FileIndexLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, error?: unknown): void;
  debug(message: string, ...args: unknown[]): void;
}

/**
 * Walk `entry`'s folder into `into` under `generation` — the service's build,
 * reused for a rebuild so both walks share one set of rules.
 */
export type FolderBuild = (
  entry: FolderIndex,
  generation: number,
  into: FolderSnapshot,
) => Promise<void>;

/** `whenClear` lane name; it only labels the governor's ceiling log line. */
const REBUILD_GOVERNOR_LANE = 'workspace-file-index-rebuild';

export interface FolderIndexLiveSyncDeps {
  readonly logger: FileIndexLogger;
  readonly fsProvider: IFileSystemProvider;
  readonly workspaceWatcher: IWorkspaceWatcher;
  readonly build: FolderBuild;
  /** `null`: rebuilds start at once (no governor registered). */
  readonly governor: BackgroundWorkAdmission | null;
}

export class FolderIndexLiveSync {
  /** Matcher over DEFAULT_WORKSPACE_EXCLUDES for created-path re-checks. */
  private readonly defaultExcludeMatcher = picomatch(
    [...DEFAULT_WORKSPACE_EXCLUDES],
    { dot: true },
  );

  /** Latch: a defective governor is warned about once, not per rebuild. */
  private governorFailureWarned = false;

  constructor(private readonly deps: FolderIndexLiveSyncDeps) {}

  /**
   * Release everything live about one entry: its subscription and any rebuild
   * state. The service calls this from its teardown AFTER bumping the entry's
   * generation, so an in-flight rebuild or batch stops writing.
   */
  release(entry: FolderIndex): void {
    this.disposeSubscription(entry);
    entry.rebuildStaging = undefined;
    entry.rebuildQueued = false;
    const deferral = entry.rebuildDeferral;
    entry.rebuildDeferral = undefined;
    deferral?.abort();
  }

  /**
   * Subscribe this folder to the batched workspace feed — ONCE per folder per
   * process.
   *
   * It is not disposed when the folder goes inactive: keeping it live keeps
   * the inactive folder's snapshot correct, which is what makes switching back
   * free rather than merely fast.
   *
   * Exclusion happens where the events are produced, not here:
   * `DEFAULT_WORKSPACE_EXCLUDES` as globs, the agent worktree segment rules
   * (case-insensitively, which the globs are not), the nested repositories the
   * walk skipped, and any `.git` entry the watcher sees appear below the root.
   */
  subscribe(entry: FolderIndex, generation: number): void {
    // Defensive: teardown disposes, but never let a second subscription be
    // armed over a live one.
    this.disposeSubscription(entry);
    const retrying = entry.subscribeRetryAt !== undefined;
    try {
      entry.subscription = this.deps.workspaceWatcher.watch(
        entry.root,
        {
          excludeGlobs: DEFAULT_WORKSPACE_EXCLUDES,
          excludeDirNames: [],
          excludeSegmentRules: NESTED_WORKSPACE_PATH_RULES,
          nestedRepoDetection: true,
          nestedRepoRoots: entry.nestedRepoRoots,
        },
        // Generation-gated: a batch a disposed subscription already had in
        // flight must not patch an entry that has been torn down.
        (batch) => this.onBatch(entry, generation, batch),
      );
      entry.subscribeRetryAt = undefined;
      if (retrying) {
        this.deps.logger.info(
          '[WorkspaceFileIndex] watcher subscribed on retry; the index is live again',
          { root: entry.root },
        );
      }
    } catch (error: unknown) {
      // A host without a real watcher degrades to a static snapshot — still
      // correct, just not live — and re-indexing must never start throwing
      // here. `retrySubscribeIfDue` tries again on a later `ensureReadyFor`.
      // Logged once per failure streak, not per retry.
      entry.subscribeRetryAt = Date.now() + SUBSCRIBE_RETRY_INTERVAL_MS;
      if (retrying) {
        this.deps.logger.debug(
          '[WorkspaceFileIndex] watcher still unavailable on retry',
          error,
        );
      } else {
        this.deps.logger.warn(
          '[WorkspaceFileIndex] watcher unavailable (index will not stay live until a retry succeeds)',
          error,
        );
      }
    }
  }

  /**
   * A built folder whose `watch()` threw is subscribed again, at most once per
   * {@link SUBSCRIBE_RETRY_INTERVAL_MS}, when a caller next asks for it. No
   * timer: a folder nobody queries stays static until it is queried. The
   * snapshot the failure left may be stale by then, so a successful retry also
   * rebuilds it once.
   */
  retrySubscribeIfDue(entry: FolderIndex): void {
    if (!entry.ready || entry.subscription) return;
    if (entry.subscribeRetryAt === undefined) return;
    if (Date.now() < entry.subscribeRetryAt) return;
    const generation = entry.generation;
    this.subscribe(entry, generation);
    if (entry.subscription) {
      this.requestRebuild(entry, generation, {
        reason: 'watcher subscribed after a failure',
      });
    }
  }

  /**
   * Dispose this entry's subscription, if any, and drop the reference.
   *
   * Clearing the field guarantees a given subscription is disposed exactly
   * once, and a throwing `dispose()` never blocks the caller.
   */
  private disposeSubscription(entry: FolderIndex): void {
    const subscription = entry.subscription;
    if (!subscription) return;
    entry.subscription = undefined;
    try {
      subscription.dispose();
    } catch (error: unknown) {
      this.deps.logger.warn(
        '[WorkspaceFileIndex] failed to dispose previous watcher',
        error,
      );
    }
  }

  /**
   * One coalesced batch for one folder.
   *
   * `overflow` (events lost or suppressed: a storm, a host restart, a degraded
   * rescan tick) and `truncated` (more distinct paths than one batch holds)
   * both leave the batch incomplete, so the folder rebuilds once instead of
   * patching from a partial list.
   *
   * Otherwise ONE synchronous pass: deletes drop their entry (a deleted
   * directory drops everything under it, in one sweep for the whole batch);
   * a path not yet indexed is matched against the default excludes and the
   * folder's compiled ignore rules, and the survivors are statted — a batch
   * does not say whether a created path is a file or a directory. A path
   * already indexed needs nothing: the index tracks no content.
   *
   * Runs for INACTIVE folders too, and must: keeping a background folder's
   * snapshot fresh is exactly what lets a switch back to it skip the rebuild.
   */
  private onBatch(
    entry: FolderIndex,
    generation: number,
    batch: WorkspaceChangeBatch,
  ): void {
    if (entry.generation !== generation) return;
    if (batch.overflow || batch.truncated) {
      this.requestRebuild(entry, generation, {
        reason: 'watcher reported lost events',
        overflow: batch.overflow,
        truncated: batch.truncated,
        droppedCount: batch.droppedCount,
      });
      return;
    }

    const deletedDirectories = new Set<string>();
    const created: string[] = [];
    for (const change of batch.changes) {
      const key = toIndexKey(change.path);
      if (change.kind === 'delete') {
        if (entry.directories.has(key)) deletedDirectories.add(key);
        deleteLivePath(entry, key);
        continue;
      }
      if (entry.files.has(key) || entry.directories.has(key)) continue;
      if (this.isExcluded(entry, change.path)) continue;
      created.push(change.path);
    }
    if (deletedDirectories.size > 0) {
      if (
        entry.files.size + entry.directories.size >
        DIRECTORY_DELETE_SWEEP_LIMIT
      ) {
        // Too large to sweep synchronously: the batch is as good as
        // truncated. The rebuild covers this batch's creates too.
        this.requestRebuild(entry, generation, {
          reason: 'directory deleted in a large index',
          deletedDirectories: deletedDirectories.size,
          entries: entry.files.size + entry.directories.size,
        });
        return;
      }
      deleteLiveDescendants(entry, deletedDirectories);
    }
    if (created.length > 0) {
      void this.addCreatedPaths(entry, generation, created);
    }
  }

  /**
   * Stat the batch's new paths and index them as files or directories.
   *
   * Rule for this file: a generation check upstream does not protect a write
   * that sits behind an `await` — a teardown can land while the stats run, and
   * this would then resurrect maps the service has already released. Re-check
   * immediately before the write.
   */
  private async addCreatedPaths(
    entry: FolderIndex,
    generation: number,
    paths: readonly string[],
  ): Promise<void> {
    for (let start = 0; start < paths.length; start += STAT_CONCURRENCY) {
      const slice = paths.slice(start, start + STAT_CONCURRENCY);
      const types = await Promise.all(
        slice.map((absPath) => this.statType(absPath)),
      );
      if (entry.generation !== generation) return;
      slice.forEach((absPath, index) => {
        const type = types[index];
        if (type === undefined) return;
        if ((type & FileType.Directory) !== 0) {
          addLiveDirectoryEntry(entry, absPath);
        } else if ((type & FileType.File) !== 0) {
          addLiveFileEntry(entry, absPath);
        }
      });
    }
  }

  /** The path's type, or `undefined` when it is already gone or unreadable. */
  private async statType(absPath: string): Promise<FileType | undefined> {
    try {
      return (await this.deps.fsProvider.stat(absPath)).type;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - a path created and removed
      // inside one batch window, or locked, is simply not indexed; its own
      // delete or the next create brings the index back in line.
      this.deps.logger.debug(
        '[WorkspaceFileIndex] could not stat a created path (not indexed)',
        error,
      );
      return undefined;
    }
  }

  /**
   * The folder's view is stale — an incomplete batch, a directory delete too
   * large to sweep, or a subscription that missed events — so it rebuilds once
   * from a path-only walk.
   *
   * The subscription stays armed, so this reuses the service's build under the
   * SAME generation rather than a fresh start. The walk fills a staging
   * snapshot while queries keep serving the previous one; batches that land
   * meanwhile patch both, and success swaps the staging snapshot in
   * synchronously. A failed rebuild keeps the previous snapshot. An overflow
   * that arrives while a rebuild is running queues exactly one more, which runs
   * whether the current one succeeds or fails — so a degraded adapter's
   * overflow every 60 s never stacks rebuilds.
   *
   * The rebuild is background work (TASK_2026_437 C14 d): it starts only once
   * the governor is clear. While it waits, queries serve the previous snapshot
   * (still patched by live batches) and every further request joins the one
   * pending rebuild instead of adding another.
   */
  private requestRebuild(
    entry: FolderIndex,
    generation: number,
    detail: { readonly reason: string } & Readonly<Record<string, unknown>>,
  ): void {
    if (entry.rebuildStaging) {
      entry.rebuildQueued = true;
      return;
    }
    // A rebuild is already waiting for the governor; it will walk the folder
    // as it is when it starts, which covers this request too.
    if (entry.rebuildDeferral) return;
    const { reason, ...rest } = detail;
    this.deps.logger.warn(
      `[WorkspaceFileIndex] ${reason}; rebuilding the index once`,
      { root: entry.root, ...rest },
    );
    this.startRebuildWhenClear(entry, generation);
  }

  /**
   * Run the rebuild now when the governor is clear (or absent); otherwise hold
   * it until `whenClear` settles.
   *
   * - `'clear'` or `'timeout'` (the governor's starvation ceiling): run it,
   *   unless the entry was torn down meanwhile.
   * - An `AbortError` (the governor was disposed at shutdown): cancel it. The
   *   previous snapshot stays; nothing is logged above debug, because a
   *   shutdown is not a failure.
   * - Any other rejection is a governor defect: warn once and rebuild anyway
   *   (fail open), the rule every adopter follows.
   * - The wait was taken over by {@link expediteDeferredRebuild} or
   *   {@link release} (the deferral is no longer the entry's): nothing to do.
   */
  private startRebuildWhenClear(entry: FolderIndex, generation: number): void {
    const governor = this.deps.governor;
    if (governor === null || governor.isClear()) {
      this.runOverflowRebuild(entry, generation);
      return;
    }
    const deferral = new AbortController();
    entry.rebuildDeferral = deferral;
    this.deps.logger.info(
      '[WorkspaceFileIndex] rebuild deferred until background work clears (serving the previous snapshot)',
      { root: entry.root },
    );
    void governor
      .whenClear({ signal: deferral.signal, lane: REBUILD_GOVERNOR_LANE })
      .then(
        () => {
          if (entry.rebuildDeferral !== deferral) return;
          entry.rebuildDeferral = undefined;
          if (entry.generation !== generation) return;
          this.runOverflowRebuild(entry, generation);
        },
        (error: unknown) => {
          if (entry.rebuildDeferral !== deferral) return;
          entry.rebuildDeferral = undefined;
          if (entry.generation !== generation) return;
          const reason = error instanceof Error ? error.message : String(error);
          if (error instanceof Error && error.name === 'AbortError') {
            this.deps.logger.debug(
              '[WorkspaceFileIndex] deferred rebuild cancelled (keeping the previous snapshot)',
              { root: entry.root, reason },
            );
            return;
          }
          if (!this.governorFailureWarned) {
            this.governorFailureWarned = true;
            this.deps.logger.warn(
              '[WorkspaceFileIndex] background-work wait failed — rebuilding anyway',
              { root: entry.root, reason },
            );
          }
          this.runOverflowRebuild(entry, generation);
        },
      );
  }

  /**
   * A caller needs this folder NOW (`ensureReadyFor`, which every `@`-picker
   * query awaits), so a rebuild held for the governor starts immediately:
   * user-initiated work is never governed (Batch 16b). A folder with no held
   * rebuild is untouched; a background overflow nobody queries keeps waiting.
   */
  expediteDeferredRebuild(entry: FolderIndex): void {
    const deferral = entry.rebuildDeferral;
    if (deferral === undefined) return;
    // Taken over first, so the governor's abort rejection finds nothing to do.
    entry.rebuildDeferral = undefined;
    deferral.abort();
    this.deps.logger.info(
      '[WorkspaceFileIndex] held rebuild started early — the folder was queried',
      { root: entry.root },
    );
    this.runOverflowRebuild(entry, entry.generation);
  }

  private runOverflowRebuild(entry: FolderIndex, generation: number): void {
    const staging = emptySnapshot();
    entry.rebuildStaging = staging;
    const startedAt = Date.now();
    void this.deps
      .build(entry, generation, staging)
      .then(
        () => {
          if (entry.generation !== generation) return;
          entry.files = staging.files;
          entry.directories = staging.directories;
          entry.ignoreFiles = staging.ignoreFiles;
          entry.isIgnored = staging.isIgnored;
          entry.nestedRepoRoots = staging.nestedRepoRoots;
          this.deps.logger.info(
            `[WorkspaceFileIndex] Rebuilt after lost watcher events: ${entry.files.size} files, ${entry.directories.size} directories`,
            { root: entry.root, durationMs: Date.now() - startedAt },
          );
        },
        (error: unknown) => {
          if (entry.generation !== generation) return;
          this.deps.logger.error(
            '[WorkspaceFileIndex] Rebuild after lost watcher events failed (keeping the previous snapshot)',
            error,
          );
        },
      )
      .finally(() => {
        if (entry.generation !== generation) return;
        entry.rebuildStaging = undefined;
        if (!entry.rebuildQueued) return;
        entry.rebuildQueued = false;
        this.startRebuildWhenClear(entry, generation);
      });
  }

  /**
   * Synchronous: the default excludes, then the folder's compiled ignore
   * rules, read into a local so one decision never mixes two rule sets.
   */
  private isExcluded(entry: FolderIndex, absPath: string): boolean {
    const relative = path.relative(entry.root, absPath).replace(/\\/g, '/');
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return true;
    }
    if (this.defaultExcludeMatcher(relative)) return true;
    const isIgnored = entry.isIgnored;
    return isIgnored(relative);
  }
}

/** A batch delete: the live snapshot, plus a rebuild's staging one if any. */
function deleteLivePath(entry: FolderIndex, key: string): void {
  for (const snapshot of liveSnapshots(entry)) {
    snapshot.files.delete(key);
    snapshot.directories.delete(key);
  }
}

/**
 * Drop every entry below a deleted directory, in one sweep per batch. Some
 * watchers report only the directory's own delete (VS Code's does), others
 * each child too (`@parcel/watcher`); both end up with nothing stale.
 */
function deleteLiveDescendants(
  entry: FolderIndex,
  deletedDirectories: ReadonlySet<string>,
): void {
  const underDeleted = (key: string): boolean => {
    let parent = path.dirname(key);
    while (parent.length >= entry.root.length) {
      if (deletedDirectories.has(toIndexKey(parent))) return true;
      const next = path.dirname(parent);
      if (next === parent) return false;
      parent = next;
    }
    return false;
  };
  for (const snapshot of liveSnapshots(entry)) {
    for (const key of [...snapshot.files.keys()]) {
      if (underDeleted(key)) snapshot.files.delete(key);
    }
    for (const key of [...snapshot.directories.keys()]) {
      if (underDeleted(key)) snapshot.directories.delete(key);
    }
  }
}

/** A batch add: the live snapshot, plus a rebuild's staging one if any. */
function addLiveFileEntry(entry: FolderIndex, absPath: string): void {
  for (const snapshot of liveSnapshots(entry)) {
    addFileEntry(entry.root, absPath, snapshot);
  }
}

/** A created directory, with its ancestors, in every live snapshot. */
function addLiveDirectoryEntry(entry: FolderIndex, absPath: string): void {
  const relativePath = path.relative(entry.root, absPath);
  if (!relativePath || relativePath.startsWith('..')) return;
  for (const snapshot of liveSnapshots(entry)) {
    // `addAncestorDirectories` indexes every directory ABOVE its path, so a
    // child segment makes the created directory itself the last of them.
    addAncestorDirectories(entry.root, path.join(absPath, '_'), snapshot);
  }
}
