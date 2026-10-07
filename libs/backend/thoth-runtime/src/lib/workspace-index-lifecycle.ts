import { basename, extname } from 'node:path';

import { NESTED_WORKSPACE_PATH_RULES } from '@ptah-extension/shared';
import type {
  IDisposable,
  IWorkspaceWatcher,
  WorkspaceChange,
  WorkspaceChangeBatch,
  WorkspaceWatchOptions,
} from '@ptah-extension/platform-core';
import {
  classifyFileForCoverage,
  DEFAULT_WORKSPACE_EXCLUDES,
} from '@ptah-extension/workspace-intelligence';

/**
 * Narrow indexer surface this lifecycle needs.
 *
 * `deleteFileSymbols` is `CodeSymbolIndexer`'s locked per-file delete. It
 * tombstones the path on a census that is still running, so the lifecycle
 * must not call the symbol sink itself.
 */
export interface WorkspaceSymbolIndex {
  indexWorkspace(
    workspaceRoot: string,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
  reindexFile(
    absoluteFilePath: string,
    workspaceRoot: string,
  ): Promise<unknown>;
  deleteFileSymbols(
    filePath: string,
    workspaceRoot: string,
  ): Promise<number> | number;
}

/** Collaborators. The indexer is the DI instance; the watcher is the port. */
export interface WorkspaceIndexLifecycleOptions {
  readonly indexer: WorkspaceSymbolIndex;
  readonly workspaceRoot: string;
  /** Absent when the host did not bind `IWorkspaceWatcher`. Boot index still runs. */
  readonly watcher?: IWorkspaceWatcher;
  readonly onError?: (message: string, error: unknown) => void;
  /** Quiet period before a per-file reindex. Default 500, matching wire-runtime. */
  readonly debounceMs?: number;
  /**
   * Distinct paths that collapse into one full run. An `overflow` or
   * `truncated` batch always collapses, whatever this number is.
   */
  readonly stormThreshold?: number;
  readonly watchOptions?: WorkspaceWatchOptions;
  /**
   * SQLite file the index writes. Events for that file and its `-wal`,
   * `-shm`, and `-journal` siblings are dropped before scheduling. This
   * service has no container; hosts pass `SqliteConnectionService.dbPath`
   * (or the `SQLITE_DB_PATH` registration). `:memory:` excludes nothing.
   */
  readonly databasePath?: string;
  /**
   * Minimum gap between full runs started by an extension-less delete.
   * Default 30 seconds. A delete inside the window schedules one trailing
   * run at the end of it.
   */
  readonly deleteRunCooldownMs?: number;
}

interface PendingFile {
  readonly timer: ReturnType<typeof setTimeout>;
  readonly kind: WorkspaceChange['kind'];
}

const DEFAULT_DEBOUNCE_MS = 500;
/** At most one extension-less-delete census per this gap. */
const DEFAULT_DELETE_RUN_COOLDOWN_MS = 30_000;
/**
 * A branch switch is far larger than a save. Below this, each path is
 * reindexed on its own; at or above it, one governed full run replaces them.
 */
const DEFAULT_STORM_THRESHOLD = 25;
/**
 * Longer than the gap `@parcel/watcher` can leave between the first event of
 * a burst and the rest, so one storm is one `overflow` (workspace-watcher
 * contract) rather than a small batch plus a later overflow.
 */
const WATCH_BATCH_INTERVAL_MS = 750;

const FULL_RUN_FAILURE =
  '[WorkspaceIndexLifecycle] indexWorkspace failed (non-fatal)';
const REINDEX_FAILURE =
  '[WorkspaceIndexLifecycle] reindexFile failed (non-fatal)';
const DELETE_FAILURE =
  '[WorkspaceIndexLifecycle] deleteSymbolsForFile failed (non-fatal)';
const WATCH_FAILURE =
  '[WorkspaceIndexLifecycle] workspace watch failed (non-fatal)';

/** Sidecars SQLite writes beside the database file. */
const SQLITE_SIDECAR_SUFFIXES = ['-wal', '-shm', '-journal'] as const;

/**
 * Same census rule as `CodeSymbolIndexer`: an extension `codeIndex` actually
 * analyses (`classifyFileForCoverage` is already exported; no second list).
 * A path with no such extension — a directory, `.md`, a database file — is
 * not a per-file index target.
 */
function isIndexerSourcePath(filePath: string): boolean {
  return classifyFileForCoverage(filePath, 'codeIndex') === 'eligible';
}

function isDatabaseArtifact(
  filePath: string,
  databasePath: string | undefined,
): boolean {
  if (!databasePath || databasePath === ':memory:') return false;
  const path = normalizeSymbolPath(filePath).toLowerCase();
  const database = normalizeSymbolPath(databasePath).toLowerCase();
  if (!database || database === ':memory:') return false;
  if (path === database || path.startsWith(`${database}/`)) return true;
  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    const sibling = `${database}${suffix}`;
    if (path === sibling || path.startsWith(`${sibling}/`)) return true;
  }
  return false;
}

/** Forward slashes, matching the path the indexer writes into the store. */
export function normalizeSymbolPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * Adapt the registered indexer. A supported-file delete goes through
 * `indexer.deleteFileSymbols` (the file lock and the census tombstone).
 */
export function workspaceSymbolIndexFrom(
  indexer: Pick<
    WorkspaceSymbolIndex,
    'indexWorkspace' | 'reindexFile' | 'deleteFileSymbols'
  >,
): WorkspaceSymbolIndex {
  return {
    indexWorkspace: (workspaceRoot, options) =>
      indexer.indexWorkspace(workspaceRoot, options),
    reindexFile: (absoluteFilePath, workspaceRoot) =>
      indexer.reindexFile(normalizeSymbolPath(absoluteFilePath), workspaceRoot),
    deleteFileSymbols: (filePath, workspaceRoot) =>
      indexer.deleteFileSymbols(normalizeSymbolPath(filePath), workspaceRoot),
  };
}

/**
 * Same exclude policy as the workspace file index watcher
 * (`folder-index-live-sync.ts`): globs plus nested-workspace segment rules.
 * Directory-name excludes stay empty because the globs already name them.
 */
export function defaultSymbolWatchOptions(): WorkspaceWatchOptions {
  return {
    excludeGlobs: DEFAULT_WORKSPACE_EXCLUDES,
    excludeDirNames: [],
    excludeSegmentRules: NESTED_WORKSPACE_PATH_RULES,
    nestedRepoDetection: true,
    minBatchIntervalMs: WATCH_BATCH_INTERVAL_MS,
  };
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  );
}

/**
 * Governed full index at boot, and a debounced per-file follow-up from
 * `IWorkspaceWatcher`. A storm, an overflow, a truncated batch, or an
 * extension-less directory delete is one full run. A full run already in
 * flight queues at most one follow-up for those. A create, an update, or a
 * supported-extension delete still applies to that file after the debounce
 * while the full run is in flight, and does not queue a follow-up.
 *
 * `start` does not wait for `indexWorkspace`. `indexWorkspace` is called
 * without `userInitiated`, so the indexer's own governor still applies.
 */
export class WorkspaceIndexLifecycleService {
  private readonly indexer: WorkspaceSymbolIndex;
  private readonly workspaceRoot: string;
  private readonly watcher: IWorkspaceWatcher | undefined;
  private readonly onError:
    ((message: string, error: unknown) => void) | undefined;
  private readonly debounceMs: number;
  private readonly stormThreshold: number;
  private readonly watchOptions: WorkspaceWatchOptions;
  private readonly databasePath: string | undefined;
  private readonly deleteRunCooldownMs: number;

  private subscription: IDisposable | undefined;
  private readonly pending = new Map<string, PendingFile>();
  private runAbort: AbortController | undefined;
  private fullRun: Promise<void> | undefined;
  private followUp = false;
  private disposed = false;
  private started = false;
  /** `Date.now()` before which another delete-triggered census must wait. */
  private deleteRunReadyAt = 0;
  private deleteFollowUp: ReturnType<typeof setTimeout> | undefined;

  constructor(options: WorkspaceIndexLifecycleOptions) {
    this.indexer = options.indexer;
    this.workspaceRoot = options.workspaceRoot;
    this.watcher = options.watcher;
    this.onError = options.onError;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.stormThreshold = options.stormThreshold ?? DEFAULT_STORM_THRESHOLD;
    this.watchOptions = options.watchOptions ?? defaultSymbolWatchOptions();
    this.databasePath = options.databasePath;
    this.deleteRunCooldownMs =
      options.deleteRunCooldownMs ?? DEFAULT_DELETE_RUN_COOLDOWN_MS;
  }

  /** Fire the boot run and subscribe. Returns before the run settles. */
  start(): void {
    if (this.started || this.disposed) return;
    if (!this.workspaceRoot) return;
    this.started = true;
    this.requestFullRun();
    if (!this.watcher) return;
    try {
      this.subscription = this.watcher.watch(
        this.workspaceRoot,
        this.watchOptions,
        (batch) => {
          this.onBatch(batch);
        },
      );
    } catch (error: unknown) {
      this.report(WATCH_FAILURE, error);
    }
  }

  /**
   * Unsubscribe, clear debounce timers, and abort the in-flight run.
   * A second call does nothing.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.followUp = false;
    this.clearPending();
    if (this.deleteFollowUp !== undefined) {
      clearTimeout(this.deleteFollowUp);
      this.deleteFollowUp = undefined;
    }
    const subscription = this.subscription;
    this.subscription = undefined;
    subscription?.dispose();
    const abort = this.runAbort;
    this.runAbort = undefined;
    abort?.abort();
  }

  private onBatch(batch: WorkspaceChangeBatch): void {
    if (this.disposed) return;
    const kept: WorkspaceChange[] = [];
    let directoryDelete = false;
    for (const change of batch.changes) {
      if (isDatabaseArtifact(change.path, this.databasePath)) continue;
      const source = isIndexerSourcePath(change.path);
      if (change.kind === 'delete' && !source) {
        // The path is already gone, so it cannot be stat'ed. A non-empty
        // `path.extname` is a file the indexer never stored (`.md`, `.json`):
        // drop it. An extension-less name may be a directory. Trade-off: a
        // deleted directory whose name contains a dot keeps its rows until
        // the next full run.
        if (extname(basename(change.path)) !== '') continue;
        directoryDelete = true;
        continue;
      }
      if (!source) continue;
      kept.push(change);
    }
    if (
      batch.overflow ||
      batch.truncated ||
      kept.length >= this.stormThreshold ||
      this.pending.size + kept.length >= this.stormThreshold
    ) {
      this.requestFullRun();
      return;
    }
    if (directoryDelete) {
      this.requestDeleteFullRun();
    }
    for (const change of kept) {
      this.schedule(change);
    }
  }

  /**
   * At most one extension-less-delete census per cooldown. A request inside
   * the window arms one trailing run at the window end; further requests
   * before that timer fires do not add another.
   */
  private requestDeleteFullRun(): void {
    if (this.disposed) return;
    const now = Date.now();
    if (now >= this.deleteRunReadyAt) {
      this.deleteRunReadyAt = now + this.deleteRunCooldownMs;
      this.requestFullRun();
      return;
    }
    if (this.deleteFollowUp !== undefined) return;
    this.deleteFollowUp = setTimeout(() => {
      this.deleteFollowUp = undefined;
      if (this.disposed) return;
      this.deleteRunReadyAt = Date.now() + this.deleteRunCooldownMs;
      this.requestFullRun();
    }, this.deleteRunReadyAt - now);
  }

  private schedule(change: WorkspaceChange): void {
    if (this.disposed) return;
    // A census in flight does not swallow this file. Storms, overflow,
    // truncation and directory deletes are the only paths that set
    // `followUp`, and they do it in `requestFullRun`.
    const path = normalizeSymbolPath(change.path);
    const previous = this.pending.get(path);
    if (previous) clearTimeout(previous.timer);
    const timer = setTimeout(() => {
      const current = this.pending.get(path);
      if (current?.timer !== timer) return;
      this.pending.delete(path);
      this.apply(path, current.kind);
    }, this.debounceMs);
    this.pending.set(path, { timer, kind: change.kind });
    if (this.pending.size >= this.stormThreshold) {
      this.requestFullRun();
    }
  }

  private apply(path: string, kind: WorkspaceChange['kind']): void {
    if (this.disposed) return;
    if (kind === 'delete') {
      try {
        const pending = this.indexer.deleteFileSymbols(
          path,
          this.workspaceRoot,
        );
        void Promise.resolve(pending).catch((error: unknown) => {
          this.report(DELETE_FAILURE, error);
        });
      } catch (error: unknown) {
        this.report(DELETE_FAILURE, error);
      }
      return;
    }
    void this.indexer
      .reindexFile(path, this.workspaceRoot)
      .catch((error: unknown) => {
        this.report(REINDEX_FAILURE, error);
      });
  }

  private requestFullRun(): void {
    if (this.disposed) return;
    this.clearPending();
    if (this.fullRun) {
      this.followUp = true;
      return;
    }
    const controller = new AbortController();
    this.runAbort = controller;
    let pending: Promise<unknown>;
    try {
      pending = this.indexer.indexWorkspace(this.workspaceRoot, {
        signal: controller.signal,
      });
    } catch (error: unknown) {
      if (this.runAbort === controller) this.runAbort = undefined;
      if (!controller.signal.aborted && !isAbort(error)) {
        this.report(FULL_RUN_FAILURE, error);
      }
      return;
    }
    this.fullRun = pending
      .then(() => undefined)
      .catch((error: unknown) => {
        if (this.disposed || controller.signal.aborted) return;
        this.report(FULL_RUN_FAILURE, error);
        if (isAbort(error)) this.followUp = true;
      })
      .finally(() => {
        if (this.runAbort === controller) this.runAbort = undefined;
        this.fullRun = undefined;
        if (this.disposed || !this.followUp) return;
        this.followUp = false;
        this.requestFullRun();
      });
  }

  private clearPending(): void {
    for (const pending of this.pending.values()) clearTimeout(pending.timer);
    this.pending.clear();
  }

  private report(message: string, error: unknown): void {
    try {
      this.onError?.(message, error);
    } catch {
      // The host logger failed. The index run must not throw into the watcher.
    }
  }
}
