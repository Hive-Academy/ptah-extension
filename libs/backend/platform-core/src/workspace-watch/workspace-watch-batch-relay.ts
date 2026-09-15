/**
 * `WorkspaceWatchBatchRelay` — main-side pacing for one subscription of a
 * host-based `IWorkspaceWatcher` (TASK_2026_437 C8/C9).
 *
 * The host already coalesced; this keeps the port's guarantees true across the
 * IPC hop and across a restart:
 *
 * - at most one listener call per `minBatchIntervalMs`, never synchronously
 *   (two host batches the transport delivered close together are merged);
 * - an adapter-raised `overflow` (host failure) folds pending paths into it;
 * - a path the host sent from outside the root is discarded;
 * - nothing after `dispose`.
 *
 * Per-batch work only: at most `maxPathsPerBatch` paths per host batch. Owned
 * by `WorkspaceWatchSupervisor`; not part of the public barrel.
 */

import type {
  WorkspaceChange,
  WorkspaceChangeBatch,
  WorkspaceChangeListener,
  WorkspaceWatchOptions,
} from '../interfaces/workspace-watcher.interface';
import { isPathWithinRoots } from '../utils/path-containment';
import {
  WORKSPACE_WATCH_LIMITS,
  type CoalescerTimerHandle,
  type WorkspaceChangeCoalescerClock,
} from '../utils/workspace-change-coalescer';
import type { WorkspaceWatchBatchMessage } from './workspace-watch-protocol';

export class WorkspaceWatchBatchRelay {
  private readonly minBatchIntervalMs: number;
  private readonly maxPathsPerBatch: number;
  private readonly pending = new Map<string, WorkspaceChange>();
  private droppedCount = 0;
  private overflowOwed = false;
  private lastEmitAt: number | undefined;
  private timer: CoalescerTimerHandle | undefined;
  private disposed = false;

  constructor(
    private readonly root: string,
    options: WorkspaceWatchOptions,
    private readonly listener: WorkspaceChangeListener,
    private readonly clock: WorkspaceChangeCoalescerClock,
    private readonly onListenerError: (error: unknown) => void,
  ) {
    const { minBatchIntervalMs, maxPathsPerBatch } = WORKSPACE_WATCH_LIMITS;
    this.minBatchIntervalMs =
      typeof options.minBatchIntervalMs === 'number' &&
      Number.isFinite(options.minBatchIntervalMs)
        ? Math.max(minBatchIntervalMs, options.minBatchIntervalMs)
        : minBatchIntervalMs;
    this.maxPathsPerBatch =
      typeof options.maxPathsPerBatch === 'number' &&
      Number.isFinite(options.maxPathsPerBatch) &&
      options.maxPathsPerBatch >= 1
        ? Math.min(maxPathsPerBatch, Math.floor(options.maxPathsPerBatch))
        : maxPathsPerBatch;
  }

  deliver(batch: WorkspaceWatchBatchMessage): void {
    if (this.disposed) return;
    if (batch.overflow) {
      this.foldIntoOverflow(batch.droppedCount);
    } else if (this.overflowOwed) {
      // The owed rescan covers these; listing them would be redundant.
      this.droppedCount += batch.changes.length + batch.droppedCount;
    } else {
      this.droppedCount += batch.droppedCount;
      for (const change of batch.changes) this.add(change);
    }
    this.schedule();
  }

  signalOverflow(): void {
    if (this.disposed) return;
    this.foldIntoOverflow(0);
    this.schedule();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== undefined) this.clock.clearTimer(this.timer);
    this.timer = undefined;
    this.pending.clear();
  }

  private add(change: WorkspaceChange): void {
    // The host is a separate process: its paths are checked, not trusted.
    if (!isPathWithinRoots(change.path, [this.root])) return;
    const previous = this.pending.get(change.path);
    if (previous) {
      const kind =
        previous.kind === 'create' && change.kind === 'update'
          ? 'create'
          : change.kind;
      this.pending.set(change.path, { path: change.path, kind });
    } else if (this.pending.size >= this.maxPathsPerBatch) {
      this.droppedCount++;
    } else {
      this.pending.set(change.path, { path: change.path, kind: change.kind });
    }
  }

  private foldIntoOverflow(extraDropped: number): void {
    this.droppedCount += this.pending.size + extraDropped;
    this.pending.clear();
    this.overflowOwed = true;
  }

  private schedule(): void {
    if (this.disposed || this.timer !== undefined) return;
    if (!this.overflowOwed && this.pending.size === 0) return;
    const delay =
      this.lastEmitAt === undefined
        ? 0
        : Math.max(
            0,
            this.lastEmitAt + this.minBatchIntervalMs - this.clock.now(),
          );
    this.timer = this.clock.setTimer(() => {
      this.timer = undefined;
      this.flush();
    }, delay);
  }

  private flush(): void {
    if (this.disposed) return;
    if (!this.overflowOwed && this.pending.size === 0) return;
    const batch: WorkspaceChangeBatch = this.overflowOwed
      ? {
          root: this.root,
          changes: [],
          truncated: false,
          overflow: true,
          droppedCount: this.droppedCount,
        }
      : {
          root: this.root,
          changes: [...this.pending.values()],
          truncated: this.droppedCount > 0,
          overflow: false,
          droppedCount: this.droppedCount,
        };
    this.pending.clear();
    this.droppedCount = 0;
    this.overflowOwed = false;
    this.lastEmitAt = this.clock.now();
    try {
      this.listener(batch);
    } catch (error: unknown) {
      this.onListenerError(error);
    }
  }
}
