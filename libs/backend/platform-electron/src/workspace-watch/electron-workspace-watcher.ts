/**
 * `ElectronWorkspaceWatcher` — `IWorkspaceWatcher` for the Electron host
 * (TASK_2026_437 C8, INV-1, AC-7).
 *
 * Recursive watching and every per-event decision run in ONE supervised watch
 * host (`workspace-watch-host.mjs` in an Electron `utilityProcess`), which runs
 * `WorkspaceWatchHostCore` over `@parcel/watcher`. The main process receives
 * only coalesced batches — at most one per 250 ms per subscription, at most 500
 * paths each — and does per-BATCH work here: validate, containment-check,
 * stamp the root, pace, deliver.
 *
 * No `electron` import. The host process arrives through an injected
 * {@link WorkspaceWatchHostForker} (the app's `ElectronUtilityWorkerProcess`
 * wrapper, a `worker_threads` Worker in specs, or the in-process hatch), per
 * this lib's "inject API shims" guideline.
 *
 * ## Supervision
 *
 * - The host is forked lazily on the first `watch`, and stopped 30 s after the
 *   last subscription is disposed (a workspace switch disposes then watches,
 *   and should not pay a fork for it).
 * - Liveness is the host's 2 s heartbeat. Three missed heartbeats (6 s with no
 *   message at all), an exit, a failed post or a `fatal` message are a host
 *   FAILURE: the host is killed, every subscription receives one `overflow`
 *   (its events are gone; the consumer rescans), and a new host is forked with
 *   every live subscription re-sent. A watchdog tick that itself ran late means
 *   MAIN was stalled, not the host: it waits one loop turn for the queued
 *   heartbeats before it judges.
 * - Restart budget: 5 per rolling 10 minutes. The sixth failure inside the
 *   window makes the adapter DEGRADED: it reports once per degraded episode
 *   through `onDegraded` (the app maps it to `DegradationReporter`) and emits an
 *   `overflow` to every subscription every 60 s — the consumer's rescan,
 *   polling in place of watching.
 * - Recovery: after 10 minutes degraded the budget is reset and ONE fresh host
 *   is forked. The episode ends only when the host has sent `subscribed` for
 *   EVERY subscription re-sent to it (one rescan, back to watching); heartbeats
 *   and errors prove nothing about the native watch. A subscribe error, any host
 *   failure, or acks still missing after the 6 s failure window return to
 *   degraded for another 10 minutes without a second report.
 * - The normal restart path does not wait for acks: a native subscribe failure
 *   in a live host is the host's own per-root overflow + retry, and charging it
 *   to the process restart budget would let one unwatchable root degrade every
 *   other root. Recovery is stricter because it is what ends polling.
 */

import {
  WORKSPACE_WATCH_LIMITS,
  WorkspaceChangeCoalescer,
  isPathWithinRoots,
  parseWorkspaceWatchHostInbound,
  parseWorkspaceWatchHostOutbound,
  toWorkspaceWatchSubscribeMessage,
  type CoalescerTimerHandle,
  type IDisposable,
  type IWorkspaceWatcher,
  type WorkspaceChange,
  type WorkspaceChangeBatch,
  type WorkspaceChangeCoalescerClock,
  type WorkspaceChangeListener,
  type WorkspaceWatchBatchMessage,
  type WorkspaceWatchHostInbound,
  type WorkspaceWatchHostOutbound,
  type WorkspaceWatchOptions,
} from '@ptah-extension/platform-core';

/**
 * The watch host as the adapter sees it. Structurally identical to the
 * worker-process ports other libs declare (`IIntegrityWorkerProcess`), so the
 * app's `ElectronUtilityWorkerProcess` satisfies it unchanged.
 */
export interface WorkspaceWatchHostProcess {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (message: unknown) => void): void;
  on(event: 'exit', listener: (code: number | null) => void): void;
  /** Terminates the host. Safe to call more than once. */
  kill(): void;
}

/** Starts a fresh watch host. */
export interface WorkspaceWatchHostForker {
  fork(): WorkspaceWatchHostProcess;
}

/** One line for the app's logger. */
export interface WorkspaceWatcherDiagnostic {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

/** The budget-exhausted failure, handed to `onDegraded` once per degraded episode. */
export interface WorkspaceWatcherDegradation {
  /** Why the last host failed. */
  readonly reason: string;
  /** Failures counted inside the restart window, including the last. */
  readonly failuresInWindow: number;
  /** How often subscribers now receive a rescan `overflow`. */
  readonly rescanIntervalMs: number;
}

export interface WorkspaceWatchSupervision {
  readonly heartbeatIntervalMs: number;
  readonly missedHeartbeatsBeforeRestart: number;
  readonly restartBudget: number;
  readonly restartWindowMs: number;
  readonly restartDelayMs: number;
  readonly degradedRescanIntervalMs: number;
  /** Time spent degraded before one recovery attempt with a reset budget. */
  readonly degradedRecoveryDelayMs: number;
  readonly idleShutdownMs: number;
}

export const WORKSPACE_WATCH_SUPERVISION_DEFAULTS: WorkspaceWatchSupervision = {
  heartbeatIntervalMs: 2_000,
  missedHeartbeatsBeforeRestart: 3,
  restartBudget: 5,
  restartWindowMs: 10 * 60_000,
  restartDelayMs: 250,
  degradedRescanIntervalMs: 60_000,
  degradedRecoveryDelayMs: 10 * 60_000,
  idleShutdownMs: 30_000,
};

export interface ElectronWorkspaceWatcherOptions {
  readonly host: WorkspaceWatchHostForker;
  readonly onDiagnostic?: (diagnostic: WorkspaceWatcherDiagnostic) => void;
  readonly onDegraded?: (degradation: WorkspaceWatcherDegradation) => void;
  /** Defaults to `Date.now` and the global timers. */
  readonly clock?: WorkspaceChangeCoalescerClock;
  readonly supervision?: Partial<WorkspaceWatchSupervision>;
}

type AdapterState = 'idle' | 'running' | 'restarting' | 'degraded' | 'disposed';

interface RunningHost {
  readonly process: WorkspaceWatchHostProcess;
  readonly generation: number;
  lastMessageAt: number;
}

interface AdapterSubscription {
  readonly id: number;
  readonly subscribeMessage: WorkspaceWatchHostInbound;
  readonly relay: BatchRelay;
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

export class ElectronWorkspaceWatcher implements IWorkspaceWatcher {
  private readonly forker: WorkspaceWatchHostForker;
  private readonly clock: WorkspaceChangeCoalescerClock;
  private readonly supervision: WorkspaceWatchSupervision;
  private readonly diagnose: (diagnostic: WorkspaceWatcherDiagnostic) => void;
  private readonly onDegraded:
    | ((degradation: WorkspaceWatcherDegradation) => void)
    | undefined;

  private readonly subscriptions = new Map<number, AdapterSubscription>();
  private nextSubscriptionId = 0;
  private state: AdapterState = 'idle';
  private host: RunningHost | undefined;
  private generation = 0;
  private failureTimes: number[] = [];
  private watchdogTimer: CoalescerTimerHandle | undefined;
  private restartTimer: CoalescerTimerHandle | undefined;
  private idleTimer: CoalescerTimerHandle | undefined;
  private degradedTimer: CoalescerTimerHandle | undefined;
  /** While degraded: the next attempt. While recovering: the ack deadline. */
  private recoveryTimer: CoalescerTimerHandle | undefined;
  /** A degraded-mode recovery host is running but has not confirmed yet. */
  private recovering = false;
  /** Subscriptions the recovery host has not yet acked with `subscribed`. */
  private readonly awaitingAck = new Set<number>();
  private invalidMessagesReported = 0;

  constructor(options: ElectronWorkspaceWatcherOptions) {
    this.forker = options.host;
    this.clock = options.clock ?? DEFAULT_CLOCK;
    this.supervision = {
      ...WORKSPACE_WATCH_SUPERVISION_DEFAULTS,
      ...options.supervision,
    };
    const onDiagnostic = options.onDiagnostic;
    this.diagnose = (diagnostic) => {
      try {
        onDiagnostic?.(diagnostic);
      } catch (error: unknown) {
        // degradation-audit: optional-capability — a throwing log sink must not
        // take supervision down with it; the diagnostic line is the only loss.
        void error;
      }
    };
    this.onDegraded = options.onDegraded;
  }

  /** True once the restart budget is spent, until a recovery host is confirmed. */
  get isDegraded(): boolean {
    return this.state === 'degraded' || this.recovering;
  }

  watch(
    root: string,
    options: WorkspaceWatchOptions,
    listener: WorkspaceChangeListener,
  ): IDisposable {
    if (this.state === 'disposed') return INERT_DISPOSABLE;

    const id = ++this.nextSubscriptionId;
    const subscribeMessage = validateSubscription(id, root, options);
    const relay = new BatchRelay(root, options, listener, this.clock, (error) =>
      this.diagnose({
        level: 'error',
        message: '[WorkspaceWatcher] listener threw',
        detail: { root, error: describeError(error) },
      }),
    );
    this.subscriptions.set(id, { id, subscribeMessage, relay });
    this.cancelIdleShutdown();

    switch (this.state) {
      case 'idle':
        this.startHost();
        break;
      case 'running':
        if (this.recovering) this.awaitingAck.add(id);
        this.send(subscribeMessage);
        break;
      case 'degraded':
        relay.signalOverflow();
        break;
      case 'restarting':
        // Re-sent with every other subscription when the new host starts.
        break;
    }

    let disposed = false;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        this.unwatch(id);
      },
    };
  }

  /** Stops the host and every subscription. Idempotent. */
  dispose(): void {
    if (this.state === 'disposed') return;
    this.state = 'disposed';
    this.clearTimer('watchdogTimer');
    this.clearTimer('restartTimer');
    this.clearTimer('idleTimer');
    this.clearTimer('degradedTimer');
    this.clearTimer('recoveryTimer');
    this.stopRecovering();
    this.killHost();
    for (const subscription of this.subscriptions.values()) {
      subscription.relay.dispose();
    }
    this.subscriptions.clear();
  }

  private unwatch(id: number): void {
    const subscription = this.subscriptions.get(id);
    if (!subscription) return;
    this.subscriptions.delete(id);
    subscription.relay.dispose();
    if (this.state === 'running') {
      this.send({ type: 'unsubscribe', id });
    }
    if (this.awaitingAck.delete(id)) this.confirmRecoveryIfAcked();
    if (this.subscriptions.size === 0 && this.state === 'running') {
      this.scheduleIdleShutdown();
    }
  }

  private startHost(): void {
    const generation = ++this.generation;
    let process: WorkspaceWatchHostProcess;
    try {
      process = this.forker.fork();
    } catch (error: unknown) {
      // degradation-audit: reported — a failed fork is a host failure: logged,
      // counted against the restart budget, and degraded when it is spent.
      this.state = 'running';
      this.onHostFailure('fork-failed', describeError(error));
      return;
    }

    const host: RunningHost = {
      process,
      generation,
      lastMessageAt: this.clock.now(),
    };
    this.host = host;
    this.state = 'running';

    process.on('message', (message) => {
      if (this.generation !== generation) return;
      this.onHostMessage(host, message);
    });
    process.on('exit', (code) => {
      if (this.generation !== generation) return;
      this.onHostFailure('exited', `exit code ${String(code)}`);
    });

    for (const subscription of this.subscriptions.values()) {
      if (this.generation !== generation) return;
      this.send(subscription.subscribeMessage);
    }
    this.armWatchdog(generation);
  }

  private send(message: WorkspaceWatchHostInbound): void {
    const host = this.host;
    if (!host) return;
    try {
      host.process.postMessage(message);
    } catch (error: unknown) {
      this.onHostFailure('post-failed', describeError(error));
    }
  }

  private onHostMessage(host: RunningHost, raw: unknown): void {
    host.lastMessageAt = this.clock.now();
    const message = parseWorkspaceWatchHostOutbound(raw);
    if (message === undefined) {
      // Bounded: a host spamming garbage must not become a log storm on main.
      if (this.invalidMessagesReported < 10) {
        this.invalidMessagesReported++;
        this.diagnose({
          level: 'warn',
          message: '[WorkspaceWatcher] dropped an invalid host message',
        });
      }
      return;
    }
    this.dispatch(message);
  }

  private dispatch(message: WorkspaceWatchHostOutbound): void {
    switch (message.type) {
      case 'batch':
        this.subscriptions.get(message.id)?.relay.deliver(message);
        return;
      case 'heartbeat':
        return;
      case 'error':
        this.diagnose({
          level: 'warn',
          message: `[WorkspaceWatcher] host error: ${message.code}`,
          detail: {
            message: message.message,
            ...(message.id === undefined ? {} : { subscriptionId: message.id }),
          },
        });
        if (
          this.recovering &&
          (message.code === 'native-subscribe-failed' ||
            message.code === 'subscribe-rejected')
        ) {
          this.onHostFailure('recovery-subscribe-failed', message.code);
        }
        return;
      case 'subscribed':
        if (this.awaitingAck.delete(message.id)) this.confirmRecoveryIfAcked();
        return;
      case 'notice':
        this.diagnose({
          level: 'info',
          message: `[WorkspaceWatcher] ${message.code}`,
          detail: {
            root: message.root,
            ...(message.detail === undefined ? {} : { detail: message.detail }),
          },
        });
        return;
      case 'fatal':
        this.onHostFailure('fatal', message.message);
        return;
    }
  }

  private armWatchdog(generation: number): void {
    this.clearTimer('watchdogTimer');
    const { heartbeatIntervalMs, missedHeartbeatsBeforeRestart } =
      this.supervision;
    const silenceLimitMs = heartbeatIntervalMs * missedHeartbeatsBeforeRestart;
    const armedAt = this.clock.now();
    this.watchdogTimer = this.clock.setTimer(() => {
      this.watchdogTimer = undefined;
      const host = this.host;
      if (!host || host.generation !== generation) return;
      const now = this.clock.now();
      if (now - host.lastMessageAt <= silenceLimitMs) {
        this.armWatchdog(generation);
        return;
      }
      if (now - armedAt - heartbeatIntervalMs <= heartbeatIntervalMs) {
        this.onHostFailure(
          'heartbeat-missed',
          `${now - host.lastMessageAt} ms without a message`,
        );
        return;
      }
      // This tick ran more than a whole interval late, so MAIN was stalled and
      // the host's heartbeats may still sit queued behind this timer. A 0 ms
      // timer runs on the next loop turn, after that queued IPC is delivered;
      // only a host that is still silent then has failed.
      const lastSeenAt = host.lastMessageAt;
      this.watchdogTimer = this.clock.setTimer(() => {
        this.watchdogTimer = undefined;
        if (this.host !== host) return;
        if (host.lastMessageAt !== lastSeenAt) {
          this.armWatchdog(generation);
          return;
        }
        this.onHostFailure(
          'heartbeat-missed',
          `${this.clock.now() - lastSeenAt} ms without a message after a main-process stall`,
        );
      }, 0);
    }, heartbeatIntervalMs);
  }

  /**
   * The host is gone or unusable. Kill it, owe every subscriber a rescan, and
   * restart within the budget — or degrade.
   */
  private onHostFailure(reason: string, detail: string): void {
    if (this.state !== 'running') return;
    this.killHost();
    this.clearTimer('watchdogTimer');

    for (const subscription of this.subscriptions.values()) {
      subscription.relay.signalOverflow();
    }

    if (this.subscriptions.size === 0) {
      // Nobody is watching; the next `watch` forks a fresh host for free.
      this.state = 'idle';
      this.stopRecovering();
      this.clearTimer('idleTimer');
      this.clearTimer('degradedTimer');
      this.clearTimer('recoveryTimer');
      this.diagnose({
        level: 'info',
        message: '[WorkspaceWatcher] idle host stopped',
        detail: { reason, detail },
      });
      return;
    }

    if (this.recovering) {
      // The one recovery attempt failed: same episode, so no second report.
      this.stopRecovering();
      this.state = 'degraded';
      this.diagnose({
        level: 'warn',
        message: '[WorkspaceWatcher] degraded host recovery failed',
        detail: {
          reason,
          detail,
          nextAttemptInMs: this.supervision.degradedRecoveryDelayMs,
        },
      });
      this.armDegradedTimers();
      return;
    }

    const now = this.clock.now();
    const { restartBudget, restartWindowMs, restartDelayMs } = this.supervision;
    this.failureTimes = this.failureTimes.filter(
      (at) => now - at < restartWindowMs,
    );
    this.failureTimes.push(now);

    if (this.failureTimes.length > restartBudget) {
      this.enterDegraded(reason, detail);
      return;
    }

    this.state = 'restarting';
    this.diagnose({
      level: 'warn',
      message: '[WorkspaceWatcher] host restarted',
      detail: {
        reason,
        detail,
        restartsInWindow: this.failureTimes.length,
        restartBudget,
        subscriptions: this.subscriptions.size,
      },
    });
    this.restartTimer = this.clock.setTimer(() => {
      this.restartTimer = undefined;
      if (this.state !== 'restarting') return;
      if (this.subscriptions.size === 0) {
        this.state = 'idle';
        return;
      }
      this.startHost();
    }, restartDelayMs);
  }

  private enterDegraded(reason: string, detail: string): void {
    this.state = 'degraded';
    const { degradedRescanIntervalMs } = this.supervision;
    const degradation: WorkspaceWatcherDegradation = {
      reason,
      failuresInWindow: this.failureTimes.length,
      rescanIntervalMs: degradedRescanIntervalMs,
    };
    this.diagnose({
      level: 'error',
      message: '[WorkspaceWatcher] host degraded',
      detail: { ...degradation, detail },
    });
    try {
      this.onDegraded?.(degradation);
    } catch (error: unknown) {
      this.diagnose({
        level: 'error',
        message: '[WorkspaceWatcher] degradation report failed',
        detail: { error: describeError(error) },
      });
    }
    this.armDegradedTimers();
  }

  /** The rescan cadence (kept if already running) and the next recovery attempt. */
  private armDegradedTimers(): void {
    if (this.degradedTimer === undefined) this.armDegradedRescan();
    this.clearTimer('recoveryTimer');
    this.recoveryTimer = this.clock.setTimer(() => {
      this.recoveryTimer = undefined;
      this.attemptRecovery();
    }, this.supervision.degradedRecoveryDelayMs);
  }

  private armDegradedRescan(): void {
    this.degradedTimer = this.clock.setTimer(() => {
      this.degradedTimer = undefined;
      // Rescans continue until a recovery host has proven itself.
      if (this.state !== 'degraded' && !this.recovering) return;
      for (const subscription of this.subscriptions.values()) {
        subscription.relay.signalOverflow();
      }
      this.armDegradedRescan();
    }, this.supervision.degradedRescanIntervalMs);
  }

  /** ONE fresh host with a reset budget. It counts once it sends a message. */
  private attemptRecovery(): void {
    if (this.state !== 'degraded') return;
    this.failureTimes = [];
    if (this.subscriptions.size === 0) {
      this.clearTimer('degradedTimer');
      this.state = 'idle';
      return;
    }
    this.recovering = true;
    for (const id of this.subscriptions.keys()) this.awaitingAck.add(id);
    this.startHost();
    if (!this.recovering) return; // The fork or a post already failed.
    const { heartbeatIntervalMs, missedHeartbeatsBeforeRestart } =
      this.supervision;
    this.recoveryTimer = this.clock.setTimer(() => {
      this.recoveryTimer = undefined;
      if (!this.recovering) return;
      this.onHostFailure(
        'recovery-unconfirmed',
        `${this.awaitingAck.size} subscription(s) never acked`,
      );
    }, heartbeatIntervalMs * missedHeartbeatsBeforeRestart);
  }

  /** Ends the episode once the recovery host has acked every subscription. */
  private confirmRecoveryIfAcked(): void {
    if (!this.recovering || this.awaitingAck.size > 0) return;
    if (this.subscriptions.size === 0) return; // Idle shutdown decides.
    this.stopRecovering();
    this.clearTimer('recoveryTimer');
    this.clearTimer('degradedTimer');
    // Changes since the last rescan predate the new native subscription.
    for (const subscription of this.subscriptions.values()) {
      subscription.relay.signalOverflow();
    }
    this.diagnose({
      level: 'info',
      message: '[WorkspaceWatcher] host recovered from degraded mode',
      detail: { subscriptions: this.subscriptions.size },
    });
  }

  private scheduleIdleShutdown(): void {
    this.clearTimer('idleTimer');
    this.idleTimer = this.clock.setTimer(() => {
      this.idleTimer = undefined;
      if (this.state !== 'running' || this.subscriptions.size > 0) return;
      this.killHost();
      this.clearTimer('watchdogTimer');
      this.clearTimer('degradedTimer');
      this.clearTimer('recoveryTimer');
      this.stopRecovering();
      this.state = 'idle';
    }, this.supervision.idleShutdownMs);
  }

  private stopRecovering(): void {
    this.recovering = false;
    this.awaitingAck.clear();
  }

  private cancelIdleShutdown(): void {
    this.clearTimer('idleTimer');
  }

  /** Invalidates the current host's listeners, then terminates it. */
  private killHost(): void {
    const host = this.host;
    this.host = undefined;
    this.generation++;
    if (!host) return;
    try {
      host.process.kill();
    } catch (error: unknown) {
      this.diagnose({
        level: 'warn',
        message: '[WorkspaceWatcher] host kill failed',
        detail: { error: describeError(error) },
      });
    }
  }

  private clearTimer(
    name:
      | 'watchdogTimer'
      | 'restartTimer'
      | 'idleTimer'
      | 'degradedTimer'
      | 'recoveryTimer',
  ): void {
    const handle = this[name];
    if (handle !== undefined) this.clock.clearTimer(handle);
    this[name] = undefined;
  }
}

/**
 * Validates a subscription synchronously, so a consumer's mistake throws from
 * `watch` instead of vanishing inside the host: the coalescer constructor
 * compiles the globs, and the wire schema enforces the protocol's size bounds.
 */
function validateSubscription(
  id: number,
  root: string,
  options: WorkspaceWatchOptions,
): WorkspaceWatchHostInbound {
  new WorkspaceChangeCoalescer(root, options, () => undefined, {
    onListenerError: () => undefined,
  }).dispose();
  const message = parseWorkspaceWatchHostInbound(
    toWorkspaceWatchSubscribeMessage(id, root, options),
  );
  if (message === undefined) {
    throw new Error(
      'IWorkspaceWatcher.watch: options exceed the watch host protocol limits',
    );
  }
  return message;
}

/**
 * Main-side pacing for one subscription. The host already coalesced; this
 * keeps the port's guarantees true across the IPC hop and across a restart:
 *
 * - at most one listener call per `minBatchIntervalMs`, never synchronously
 *   (two host batches the transport delivered close together are merged);
 * - an adapter-raised `overflow` (host failure) folds pending paths into it;
 * - a path the host sent from outside the root is discarded;
 * - nothing after `dispose`.
 *
 * Per-batch work only: at most `maxPathsPerBatch` paths per host batch.
 */
class BatchRelay {
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
