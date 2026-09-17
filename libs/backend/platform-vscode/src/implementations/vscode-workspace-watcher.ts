/**
 * `VscodeWorkspaceWatcher` — `IWorkspaceWatcher` for the VS Code extension
 * host (TASK_2026_437 C9, INV-1).
 *
 * VS Code already watches in its own file-watcher process, so this adapter
 * needs no host of its own and no native dependency enters the VSIX. Each
 * subscription is one `createFileSystemWatcher(new RelativePattern(root,
 * '**\/*'))` feeding one `WorkspaceChangeCoalescer` (platform-core), which owns
 * every port guarantee: the subscriber's exclusions, nested repository
 * detection, the storm breaker, ≤ 1 batch per 250 ms, ≤ 500 paths, overflow.
 *
 * ## Where exclusion happens
 *
 * Two layers, and only the first is native:
 * - VS Code's watcher applies the USER's `files.watcherExclude` before an event
 *   leaves its process. This adapter never reads or writes that setting — an
 *   adapter does not edit user or workspace settings.
 * - The port's own rules (`excludeDirNames`, `excludeSegmentRules`,
 *   `excludeGlobs`, nested repository roots) run in `WorkspaceChangeCoalescer`,
 *   inside the EXTENSION HOST process (never the renderer or UI), per event and
 *   before any consumer work. A path excluded by the port but not by the user's
 *   `files.watcherExclude` still costs VS Code's native watch, one event
 *   delivered to the extension host, and the coalescer's path normalization —
 *   unlike the Electron and CLI hosts, whose native subscription ignores it.
 *
 * ## Roots outside the workspace
 *
 * VS Code guarantees recursive watching for paths inside its workspace folders.
 * For a root outside every `workspace.workspaceFolders` entry, recursive
 * delivery depends on VS Code's watcher and may be partial, with no error to
 * observe. That is not a failure this adapter can detect, so it is not treated
 * as one: it logs one warning per root and watches anyway.
 *
 * A `FileSystemWatcher` reports no errors after it exists; the one failure this
 * adapter can see is `createFileSystemWatcher` throwing. That subscription then
 * receives `overflow` at once and again on the port's degraded rescan cadence
 * (60 s, the supervised adapters' value) while creation is retried on the same
 * tick; the first watcher that is created ends it with one more `overflow`,
 * because the changes before it were never observed.
 */

import * as vscode from 'vscode';
import {
  WORKSPACE_WATCH_SUPERVISION_DEFAULTS,
  WorkspaceChangeCoalescer,
  isPathWithinRoots,
  readEventStormBreakerOptionsFromEnv,
  type CoalescerTimerHandle,
  type EventStormBreakerOptions,
  type IDisposable,
  type IWorkspaceWatcher,
  type WorkspaceChangeCoalescerClock,
  type WorkspaceChangeKind,
  type WorkspaceChangeListener,
  type WorkspaceWatchOptions,
  type WorkspaceWatcherDiagnostic,
} from '@ptah-extension/platform-core';

export interface VscodeWorkspaceWatcherOptions {
  readonly onDiagnostic?: (diagnostic: WorkspaceWatcherDiagnostic) => void;
  /** Defaults to `Date.now` and the global timers. */
  readonly clock?: WorkspaceChangeCoalescerClock;
  /** Defaults to the tunables in `process.env`, as the watch hosts read them. */
  readonly stormBreakerOptions?: EventStormBreakerOptions;
  /** Overflow and creation-retry cadence after a failed create. Default 60 s. */
  readonly rescanIntervalMs?: number;
}

const DEFAULT_CLOCK: WorkspaceChangeCoalescerClock = {
  now: () => Date.now(),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const INERT_DISPOSABLE: IDisposable = { dispose: () => undefined };

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class VscodeWorkspaceWatcher implements IWorkspaceWatcher {
  private readonly clock: WorkspaceChangeCoalescerClock;
  private readonly stormBreakerOptions: EventStormBreakerOptions;
  private readonly rescanIntervalMs: number;
  private readonly diagnose: (diagnostic: WorkspaceWatcherDiagnostic) => void;
  private readonly subscriptions = new Set<WatchSubscription>();
  /** Roots already warned about as outside every workspace folder. */
  private readonly warnedOutsideRoots = new Set<string>();
  private disposed = false;

  constructor(options: VscodeWorkspaceWatcherOptions = {}) {
    this.clock = options.clock ?? DEFAULT_CLOCK;
    this.stormBreakerOptions =
      options.stormBreakerOptions ??
      readEventStormBreakerOptionsFromEnv(process.env);
    this.rescanIntervalMs =
      options.rescanIntervalMs ??
      WORKSPACE_WATCH_SUPERVISION_DEFAULTS.degradedRescanIntervalMs;
    const onDiagnostic = options.onDiagnostic;
    this.diagnose = (diagnostic) => {
      try {
        onDiagnostic?.(diagnostic);
      } catch (error: unknown) {
        // degradation-audit: optional-capability — a throwing log sink must not
        // break watching; the diagnostic line is the only loss.
        void error;
      }
    };
  }

  watch(
    root: string,
    options: WorkspaceWatchOptions,
    listener: WorkspaceChangeListener,
  ): IDisposable {
    if (this.disposed) return INERT_DISPOSABLE;
    // Constructed first: a malformed glob throws from `watch`, before any
    // watcher exists.
    const coalescer = new WorkspaceChangeCoalescer(root, options, listener, {
      clock: this.clock,
      stormBreakerOptions: this.stormBreakerOptions,
      onListenerError: (error) =>
        this.diagnose({
          level: 'error',
          message: '[WorkspaceWatcher] listener threw',
          detail: { root, error: describeError(error) },
        }),
    });
    const subscription = new WatchSubscription(
      root,
      coalescer,
      this.clock,
      this.rescanIntervalMs,
      this.diagnose,
    );
    this.subscriptions.add(subscription);
    this.warnIfOutsideWorkspace(root);
    subscription.start();

    let disposed = false;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        this.subscriptions.delete(subscription);
        subscription.dispose();
      },
    };
  }

  private warnIfOutsideWorkspace(root: string): void {
    if (this.warnedOutsideRoots.has(root)) return;
    const folders = (vscode.workspace.workspaceFolders ?? []).map(
      (folder) => folder.uri.fsPath,
    );
    if (isPathWithinRoots(root, folders)) return;
    this.warnedOutsideRoots.add(root);
    this.diagnose({
      level: 'warn',
      message:
        "[WorkspaceWatcher] root is outside every workspace folder; recursive watching may be partial and depends on VS Code's file watcher",
      detail: { root },
    });
  }

  /** Disposes every watcher and coalescer. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const subscription of this.subscriptions) subscription.dispose();
    this.subscriptions.clear();
  }
}

/** One root: a VS Code watcher (or its retry) feeding one coalescer. */
class WatchSubscription {
  private watcher: vscode.FileSystemWatcher | undefined;
  private eventDisposables: vscode.Disposable[] = [];
  private retryTimer: CoalescerTimerHandle | undefined;
  private failing = false;
  private disposed = false;

  constructor(
    private readonly root: string,
    private readonly coalescer: WorkspaceChangeCoalescer,
    private readonly clock: WorkspaceChangeCoalescerClock,
    private readonly rescanIntervalMs: number,
    private readonly diagnose: (diagnostic: WorkspaceWatcherDiagnostic) => void,
  ) {}

  start(): void {
    if (this.disposed) return;
    let watcher: vscode.FileSystemWatcher;
    try {
      watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(this.root, '**/*'),
      );
    } catch (error: unknown) {
      // degradation-audit: reported — the subscriber is told to rescan now and
      // on every retry tick, and the failure is logged once per episode.
      this.coalescer.signalOverflow();
      if (!this.failing) {
        this.failing = true;
        this.diagnose({
          level: 'error',
          message:
            '[WorkspaceWatcher] file system watcher could not be created',
          detail: {
            root: this.root,
            error: describeError(error),
            retryInMs: this.rescanIntervalMs,
          },
        });
      }
      this.retryTimer = this.clock.setTimer(() => {
        this.retryTimer = undefined;
        this.start();
      }, this.rescanIntervalMs);
      return;
    }

    this.watcher = watcher;
    const push = (kind: WorkspaceChangeKind) => (uri: vscode.Uri) =>
      this.coalescer.push(uri.fsPath, kind);
    this.eventDisposables = [
      watcher.onDidCreate(push('create')),
      watcher.onDidChange(push('update')),
      watcher.onDidDelete(push('delete')),
    ];
    if (this.failing) {
      this.failing = false;
      this.coalescer.signalOverflow();
      this.diagnose({
        level: 'info',
        message: '[WorkspaceWatcher] file system watcher recovered',
        detail: { root: this.root },
      });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.retryTimer !== undefined) this.clock.clearTimer(this.retryTimer);
    this.retryTimer = undefined;
    for (const disposable of this.eventDisposables) disposable.dispose();
    this.eventDisposables = [];
    this.watcher?.dispose();
    this.watcher = undefined;
    this.coalescer.dispose();
  }
}
