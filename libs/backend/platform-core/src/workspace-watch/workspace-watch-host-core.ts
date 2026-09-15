/**
 * `WorkspaceWatchHostCore` — everything the out-of-main watch host does,
 * without knowing which process or transport it runs in (TASK_2026_437 C8,
 * INV-1, INV-2, INV-6).
 *
 * The Electron `utilityProcess` entry and the CLI `child_process.fork` entry are
 * thin: they detect their transport, load `@parcel/watcher`, and hand both to
 * this class. Keeping the logic here keeps `platform-core` free of Electron and
 * Node-IPC imports while letting one spec drive it with a fake engine.
 *
 * ## What it does
 *
 * - ONE native subscription per root, however many subscribers share it. Its
 *   `ignore` list is the INTERSECTION of the subscribers' exclusions, so the
 *   native layer drops only what every subscriber would drop. It is a cost
 *   filter, never the exclusion authority: each subscriber's own
 *   {@link WorkspaceChangeCoalescer} applies that subscriber's full rules. The
 *   list itself is planned by `planNativeIgnoreSet`.
 * - One coalescer per subscriber: exclusion, nested-repo detection, the storm
 *   breaker, and at most one batch per 250 ms (INV-1). Batches are posted; the
 *   main process never sees a per-event message.
 * - A nested repository found at runtime (`<dir>/.git` created) is added to the
 *   native ignore set by re-subscribing, debounced 1 s and at most once per
 *   10 s per root. `.git` itself is never put in the native ignore set — that
 *   would blind the detection.
 * - A native error means events were lost (A1: Windows buffer overflow): every
 *   subscriber of that root gets `overflow`, and the root is rebuilt with
 *   back-off.
 * - With a `listDirectory` (the Linux entries), a {@link CreatedDirectoryReconciler}
 *   per root lists created directories, delivers children the engine missed,
 *   and asks for a rebuild when a watch was lost.
 * - A heartbeat every 2 s, so the adapter can tell a hung host from a quiet one.
 *
 * ## Re-subscribe versus rebuild
 *
 * A nested-root ignore change re-subscribes with overlap: the replacement is
 * live before the old subscription is released, so no event is lost. That
 * overlap cannot repair anything: `@parcel/watcher` caches a root's directory
 * tree and watches while any subscription holds them, so the replacement
 * reuses them (measured on Linux: 16 of 800 writes under lost watches still
 * lost after an overlapping re-subscribe, 0 after a full one). Recovery — a
 * native error, a refused subscribe, a lost watch, creates during a storm —
 * therefore REBUILDS: release the live subscription, await it, subscribe
 * again. Every loss is signalled twice: `overflow` when it is detected, so no
 * consumer trusts a stale view while the rebuild waits out its debounce, and
 * `overflow` again once the new subscription is live, so a rescan also covers
 * the gap the rebuild itself opened.
 *
 * It never spawns a process and never reads file contents.
 */

import type {
  WorkspaceChangeKind,
  WorkspaceWatchOptions,
} from '../interfaces/workspace-watcher.interface';
import type { EventStormBreakerOptions } from '../utils/event-storm-breaker';
import {
  WorkspaceChangeCoalescer,
  type CoalescerTimerHandle,
  type WorkspaceChangeCoalescerClock,
} from '../utils/workspace-change-coalescer';
import {
  CreatedDirectoryReconciler,
  type WorkspaceWatchListDirectory,
} from './created-directory-reconciler';
import { planNativeIgnoreSet } from './native-ignore-set-planner';
import {
  clipWorkspaceWatchText,
  parseWorkspaceWatchHostInbound,
  toWorkspaceWatchBatchMessage,
  toWorkspaceWatchPathKey,
  type WorkspaceWatchErrorCode,
  type WorkspaceWatchHostOutbound,
  type WorkspaceWatchNoticeCode,
  type WorkspaceWatchSubscribeMessage,
} from './workspace-watch-protocol';

/** One raw engine event. Structurally `@parcel/watcher`'s `Event`. */
export interface WorkspaceWatchEngineEvent {
  readonly path: string;
  readonly type: WorkspaceChangeKind;
}

export type WorkspaceWatchEngineCallback = (
  error: Error | null,
  events: readonly WorkspaceWatchEngineEvent[],
) => unknown;

export interface WorkspaceWatchEngineSubscription {
  unsubscribe(): Promise<void>;
}

/**
 * The recursive watch engine. Structurally `@parcel/watcher`'s `subscribe`:
 * `ignore` entries are absolute paths or globs matched against the
 * root-relative path.
 */
export interface WorkspaceWatchEngine {
  subscribe(
    dir: string,
    callback: WorkspaceWatchEngineCallback,
    options: { ignore: string[] },
  ): Promise<WorkspaceWatchEngineSubscription>;
}

export const WORKSPACE_WATCH_HOST_DEFAULTS = {
  /** Heartbeat period. The adapter restarts a host that misses three. */
  heartbeatIntervalMs: 2_000,
  /** Quiet period before a nested-root re-subscribe. */
  nestedResubscribeDebounceMs: 1_000,
  /** Minimum gap between two nested-root re-subscribes of one root. */
  nestedResubscribeMinGapMs: 10_000,
  /** First retry delay after a native failure; doubles per failure. */
  nativeRetryInitialMs: 1_000,
  /** Retry delay ceiling. */
  nativeRetryMaxMs: 30_000,
  /**
   * Quiet period before a rebuild asked for by reconciliation or a storm, so
   * one re-walk covers the whole burst that lost watches.
   */
  rebuildDebounceMs: 1_000,
  /** Minimum gap between two such rebuilds of one root: each re-walks the whole tree. */
  rebuildMinGapMs: 10_000,
  /**
   * Longest one native unsubscribe may take before the engine counts as wedged
   * (`fatal`, host restart). Every native call waits behind the previous one,
   * so a hung call would otherwise stop the host for good. An unsubscribe
   * walks nothing — it removes watches — so a slow one IS the failure. Also
   * the most `dispose` waits, so it never holds up an app quit for long.
   */
  nativeUnsubscribeTimeoutMs: 10_000,
  /**
   * Longest one native subscribe may take. A subscribe walks the whole root
   * before it resolves, so this must cover a legitimate walk of a large
   * workspace on a slow disk (the manual load test's workspace holds 238k
   * files): a timeout here restarts the host, and repeated restarts end in
   * degraded mode. Two minutes still bounds a call that truly hangs.
   */
  nativeSubscribeTimeoutMs: 120_000,
  /**
   * Most runtime-detected nested roots a root keeps in its native ignore set.
   * Beyond it the coalescers still exclude them; only the native saving stops.
   */
  maxDetectedNestedRoots: 1_000,
} as const;

export interface WorkspaceWatchHostCoreOptions {
  readonly engine: WorkspaceWatchEngine;
  /** Sends one message to the adapter. */
  readonly post: (message: WorkspaceWatchHostOutbound) => void;
  /** Normally `readEventStormBreakerOptionsFromEnv(process.env)`. */
  readonly stormBreakerOptions?: EventStormBreakerOptions;
  /** Defaults to `Date.now` and the global timers. */
  readonly clock?: WorkspaceChangeCoalescerClock;
  readonly heartbeatIntervalMs?: number;
  readonly nestedResubscribeDebounceMs?: number;
  readonly nestedResubscribeMinGapMs?: number;
  readonly nativeRetryInitialMs?: number;
  readonly nativeRetryMaxMs?: number;
  readonly rebuildDebounceMs?: number;
  readonly rebuildMinGapMs?: number;
  readonly nativeUnsubscribeTimeoutMs?: number;
  readonly nativeSubscribeTimeoutMs?: number;
  /**
   * Enables created-directory reconciliation. Only an engine that adds a watch
   * per created directory needs it — `@parcel/watcher`'s inotify backend; the
   * entries pass `workspaceWatchListDirectoryFor(process.platform)`.
   */
  readonly listDirectory?: WorkspaceWatchListDirectory;
}

interface HostSubscription {
  readonly id: number;
  readonly options: WorkspaceWatchOptions;
  readonly coalescer: WorkspaceChangeCoalescer;
  readonly seededNestedRootKeys: ReadonlySet<string>;
  /** `subscribed` was posted: a settled native subscription covered it. */
  acked: boolean;
}

interface NativeHandle {
  readonly token: number;
  readonly subscription: WorkspaceWatchEngineSubscription;
  readonly ignore: readonly string[];
}

interface RootWatch {
  readonly key: string;
  /** The first subscriber's spelling; what the engine is given. */
  readonly dir: string;
  readonly subscribers: Map<number, HostSubscription>;
  /** Runtime-detected nested roots: normalized key → absolute spelling. */
  readonly detectedNestedRoots: Map<string, string>;
  active: NativeHandle | undefined;
  /** Token of the in-flight engine subscribe, if any. */
  pendingToken: number | undefined;
  nextToken: number;
  /** The next native subscribe releases the live one first, even with an unchanged ignore set. */
  rebuildRequested: boolean;
  /** Why the pending rebuild was asked for, for its notice. */
  rebuildReason: string | undefined;
  /** Every subscriber gets `overflow` once the next native subscribe is live. */
  overflowOnSettle: boolean;
  rebuildTimer: CoalescerTimerHandle | undefined;
  lastRebuildAt: number | undefined;
  /** Present when the host was given a `listDirectory`. */
  reconciler: CreatedDirectoryReconciler | undefined;
  /** Another re-subscribe was requested while one was in flight. */
  resubscribeQueued: boolean;
  retryTimer: CoalescerTimerHandle | undefined;
  retryDelayMs: number;
  /** An overflow was already signalled for the current failure streak. */
  failureSignalled: boolean;
  nestedTimer: CoalescerTimerHandle | undefined;
  lastNestedResubscribeAt: number | undefined;
}

/**
 * Every host timer — heartbeat, coalescers (they receive this clock), rebuild,
 * retry, reconciliation, native-call timeouts — is unref'd: none of them may
 * keep a quitting process alive. A host lives exactly as long as its channel to
 * the supervisor (fork IPC, utilityProcess `parentPort`) or its hosting process
 * (the in-process hatch), both of which keep the process referenced.
 */
const DEFAULT_CLOCK: WorkspaceChangeCoalescerClock = {
  now: () => Date.now(),
  setTimer: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    timer.unref?.();
    return timer;
  },
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class WorkspaceWatchHostCore {
  private readonly engine: WorkspaceWatchEngine;
  private readonly post: (message: WorkspaceWatchHostOutbound) => void;
  private readonly clock: WorkspaceChangeCoalescerClock;
  private readonly stormBreakerOptions: EventStormBreakerOptions | undefined;
  private readonly heartbeatIntervalMs: number;
  private readonly nestedDebounceMs: number;
  private readonly nestedMinGapMs: number;
  private readonly retryInitialMs: number;
  private readonly retryMaxMs: number;
  private readonly rebuildDebounceMs: number;
  private readonly rebuildMinGapMs: number;
  private readonly nativeUnsubscribeTimeoutMs: number;
  private readonly nativeSubscribeTimeoutMs: number;
  /** Native calls started and not yet settled or timed out. */
  private readonly inFlightNative = new Set<{ abandon(): void }>();
  private readonly listDirectory: WorkspaceWatchListDirectory | undefined;

  private readonly subscriptions = new Map<number, RootWatch>();
  private readonly roots = new Map<string, RootWatch>();
  private heartbeatTimer: CoalescerTimerHandle | undefined;
  private heartbeatSeq = 0;
  private eventsSinceHeartbeat = 0;
  private lastHeartbeatAt = 0;
  private invalidMessagesReported = 0;
  private started = false;
  private disposed = false;
  /** Tail of the native subscribe/unsubscribe queue ({@link serializeNative}). */
  private nativeOperations: Promise<unknown> = Promise.resolve();

  constructor(options: WorkspaceWatchHostCoreOptions) {
    const defaults = WORKSPACE_WATCH_HOST_DEFAULTS;
    this.engine = options.engine;
    this.post = options.post;
    this.clock = options.clock ?? DEFAULT_CLOCK;
    this.stormBreakerOptions = options.stormBreakerOptions;
    this.heartbeatIntervalMs =
      options.heartbeatIntervalMs ?? defaults.heartbeatIntervalMs;
    this.nestedDebounceMs =
      options.nestedResubscribeDebounceMs ??
      defaults.nestedResubscribeDebounceMs;
    this.nestedMinGapMs =
      options.nestedResubscribeMinGapMs ?? defaults.nestedResubscribeMinGapMs;
    this.retryInitialMs =
      options.nativeRetryInitialMs ?? defaults.nativeRetryInitialMs;
    this.retryMaxMs = options.nativeRetryMaxMs ?? defaults.nativeRetryMaxMs;
    this.rebuildDebounceMs =
      options.rebuildDebounceMs ?? defaults.rebuildDebounceMs;
    this.rebuildMinGapMs = options.rebuildMinGapMs ?? defaults.rebuildMinGapMs;
    this.nativeUnsubscribeTimeoutMs =
      options.nativeUnsubscribeTimeoutMs ?? defaults.nativeUnsubscribeTimeoutMs;
    this.nativeSubscribeTimeoutMs =
      options.nativeSubscribeTimeoutMs ?? defaults.nativeSubscribeTimeoutMs;
    this.listDirectory = options.listDirectory;
  }

  /** Number of live subscriptions. */
  get subscriptionCount(): number {
    return this.subscriptions.size;
  }

  /** Posts the first heartbeat and arms the rest. Idempotent. */
  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.lastHeartbeatAt = this.clock.now();
    this.beat();
  }

  /** One raw inbound message from the adapter. Invalid messages are reported and dropped. */
  handleMessage(raw: unknown): void {
    if (this.disposed) return;
    const message = parseWorkspaceWatchHostInbound(raw);
    if (message === undefined) {
      // Capped like the adapter's counter: a looping bad caller must not
      // become an error storm back over IPC.
      if (this.invalidMessagesReported++ < 10) {
        this.postError('invalid-message', 'Dropped an invalid inbound message');
      }
      return;
    }
    if (message.type === 'subscribe') {
      this.subscribe(message);
    } else {
      this.unsubscribe(message.id);
    }
  }

  /**
   * Stops every subscription and timer, and waits for the native calls already
   * queued — the releases of every root, and of a subscription that resolved
   * after its root was abandoned — for at most `nativeUnsubscribeTimeoutMs`,
   * so an app quit is never held longer. Never rejects.
   *
   * A native call still running at that cap (a subscribe mid-walk) is
   * abandoned: its timer stops, its caller sees a failure (inert — every root
   * is gone), and a subscription it resolves with later is released through
   * the same late-result path a timeout uses.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.heartbeatTimer !== undefined) {
      this.clock.clearTimer(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    const roots = [...this.roots.values()];
    this.roots.clear();
    this.subscriptions.clear();
    const released = Promise.all(
      roots.map((root) => this.teardownRoot(root)),
    ).then(() => this.nativeOperations);
    const settled = await this.settlesWithin(
      released,
      this.nativeUnsubscribeTimeoutMs,
    );
    if (settled) return;
    for (const call of [...this.inFlightNative]) call.abandon();
  }

  /** True when `promise` settles before `timeoutMs`; false at the timeout. */
  private settlesWithin(
    promise: Promise<unknown>,
    timeoutMs: number,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timer = this.clock.setTimer(() => resolve(false), timeoutMs);
      void promise.then(
        () => {
          this.clock.clearTimer(timer);
          resolve(true);
        },
        () => {
          this.clock.clearTimer(timer);
          resolve(true);
        },
      );
    });
  }

  private subscribe(message: WorkspaceWatchSubscribeMessage): void {
    if (this.subscriptions.has(message.id)) {
      this.postError(
        'subscribe-rejected',
        'Subscription id is already in use',
        message.id,
      );
      return;
    }

    const key = toWorkspaceWatchPathKey(message.root);
    const existing = this.roots.get(key);
    const root: RootWatch = existing ?? this.createRoot(key, message.root);
    const id = message.id;
    const options: WorkspaceWatchOptions = message.options;

    let coalescer: WorkspaceChangeCoalescer;
    try {
      coalescer = new WorkspaceChangeCoalescer(
        message.root,
        options,
        (batch) => this.post(toWorkspaceWatchBatchMessage(id, batch)),
        {
          stormBreakerOptions: this.stormBreakerOptions,
          clock: this.clock,
          onListenerError: (error) =>
            this.postError('listener-error', describeError(error), id),
          onStorm: (transition, stats) => {
            this.postNotice(
              transition === 'entered' ? 'storm-entered' : 'storm-exited',
              root.dir,
              `subscription ${id}, ${stats.stormEvents} events`,
            );
            if (transition === 'entered') root.reconciler?.suspend();
            else this.resumeReconciliationIfCalm(root);
          },
          onNestedRepoRoot: (absoluteRoot) =>
            this.onNestedRepoRoot(root, absoluteRoot),
        },
      );
    } catch (error: unknown) {
      // degradation-audit: reported — posted to the adapter as
      // `subscribe-rejected`. A malformed glob throws from the coalescer
      // constructor; the adapter validates before sending, so this is a defence.
      this.postError('subscribe-rejected', describeError(error), id);
      if (!existing) this.roots.delete(key);
      return;
    }

    if (options.nestedRepoDetection) {
      for (const detected of root.detectedNestedRoots.values()) {
        coalescer.addNestedRepoRoot(detected);
      }
    }

    root.subscribers.set(id, {
      id,
      options,
      coalescer,
      seededNestedRootKeys: new Set(
        (options.nestedRepoRoots ?? []).map(toWorkspaceWatchPathKey),
      ),
      acked: false,
    });
    this.subscriptions.set(id, root);
    this.ensureNative(root);
    this.ackSubscribers(root);
  }

  /** `subscribed` for each subscriber a settled native subscription now covers. */
  private ackSubscribers(root: RootWatch): void {
    if (!root.active || root.pendingToken !== undefined) return;
    if (root.retryTimer !== undefined) return;
    for (const subscriber of root.subscribers.values()) {
      if (subscriber.acked) continue;
      subscriber.acked = true;
      this.post({ type: 'subscribed', id: subscriber.id });
    }
  }

  private unsubscribe(id: number): void {
    const root = this.subscriptions.get(id);
    if (!root) return;
    this.subscriptions.delete(id);
    root.subscribers.get(id)?.coalescer.dispose();
    root.subscribers.delete(id);
    if (root.subscribers.size > 0) {
      // The subscriber that left may have been the one storming.
      this.resumeReconciliationIfCalm(root);
      return;
    }
    // The last subscriber left: the native subscription has no audience. A
    // remaining subscriber keeps the current (possibly narrower) ignore set;
    // widening it is an optimisation not worth a re-subscribe gap.
    this.roots.delete(root.key);
    void this.teardownRoot(root);
  }

  private createRoot(key: string, dir: string): RootWatch {
    const root: RootWatch = {
      key,
      dir,
      subscribers: new Map(),
      detectedNestedRoots: new Map(),
      active: undefined,
      pendingToken: undefined,
      nextToken: 0,
      rebuildRequested: false,
      rebuildReason: undefined,
      overflowOnSettle: false,
      rebuildTimer: undefined,
      lastRebuildAt: undefined,
      reconciler: undefined,
      resubscribeQueued: false,
      retryTimer: undefined,
      retryDelayMs: this.retryInitialMs,
      failureSignalled: false,
      nestedTimer: undefined,
      lastNestedResubscribeAt: undefined,
    };
    const listDirectory = this.listDirectory;
    if (listDirectory) {
      root.reconciler = new CreatedDirectoryReconciler({
        root: dir,
        listDirectory,
        clock: this.clock,
        nativeIgnore: () => root.active?.ignore ?? [],
        onDiscovered: (path) => this.onDiscovered(root, path),
        onIncomplete: (reason, detail) =>
          this.onWatchesLost(root, `${reason}: ${detail}`),
        onUnreadable: (path, code) =>
          this.postNotice('directory-unreadable', root.dir, `${code}: ${path}`),
      });
    }
    this.roots.set(key, root);
    return root;
  }

  private isCurrent(root: RootWatch): boolean {
    return !this.disposed && this.roots.get(root.key) === root;
  }

  /**
   * Makes the native subscription match the current ignore set.
   *
   * - An ignore-set change re-subscribes with overlap: the replacement is
   *   subscribed BEFORE the old one is released, so no event is lost (a
   *   duplicate path in the overlap merges inside the coalescer).
   * - A requested rebuild releases the live subscription first and awaits it,
   *   so the engine drops its cached tree and walks the root again.
   */
  private ensureNative(root: RootWatch): void {
    if (!this.isCurrent(root) || root.subscribers.size === 0) return;
    if (root.pendingToken !== undefined) {
      root.resubscribeQueued = true;
      return;
    }
    if (root.retryTimer !== undefined) return;

    const ignore = planNativeIgnoreSet({
      rootKey: root.key,
      subscribers: [...root.subscribers.values()],
      detectedNestedRoots: root.detectedNestedRoots,
    });
    if (
      root.active !== undefined &&
      !root.rebuildRequested &&
      sameStrings(root.active.ignore, ignore)
    ) {
      return;
    }

    const rebuild = root.rebuildRequested;
    root.rebuildRequested = false;
    const token = ++root.nextToken;
    root.pendingToken = token;
    const released = rebuild ? root.active : undefined;
    if (released) root.active = undefined;
    const callback: WorkspaceWatchEngineCallback = (error, events) =>
      this.onEngineEvents(root, token, error, events);

    void this.subscribeNative(root, released, callback, ignore).then(
      (subscription) => {
        if (subscription) {
          this.onNativeSubscribed(root, token, subscription, ignore, rebuild);
        } else if (root.pendingToken === token) {
          root.pendingToken = undefined;
        }
      },
      (error: unknown) => this.onNativeSubscribeFailed(root, token, error),
    );
  }

  /**
   * Releases `released` (a rebuild) and subscribes. Resolves `undefined` when
   * the root was abandoned while the release or the queue was awaited. A
   * synchronous engine throw becomes a rejection.
   */
  private async subscribeNative(
    root: RootWatch,
    released: NativeHandle | undefined,
    callback: WorkspaceWatchEngineCallback,
    ignore: readonly string[],
  ): Promise<WorkspaceWatchEngineSubscription | undefined> {
    if (released) {
      await this.unsubscribeNative(released.subscription);
      if (!this.isCurrent(root)) return undefined;
    }
    return this.serializeNative(
      'subscribe',
      async () =>
        // Re-checked in the queue: the root may have been abandoned meanwhile.
        this.isCurrent(root)
          ? this.engine.subscribe(root.dir, callback, { ignore: [...ignore] })
          : undefined,
      // Resolved after its timeout: nobody owns it any more.
      (late) => {
        if (late) void this.unsubscribeNative(late);
      },
    );
  }

  /**
   * Runs one native subscribe or unsubscribe after every earlier one settled.
   *
   * `@parcel/watcher` keeps ONE backend per process. When an unsubscribe removes
   * that backend's last subscription while a subscribe — for any root — is in
   * flight, the new subscription attaches to the backend being torn down: it
   * resolves, and never delivers an event. Measured on Linux with 2.5.6:
   * overlapping unsubscribe(A) + subscribe(B) pairs were dead in 100 of 100
   * runs idle and 94 of 100 under CPU load; awaiting the unsubscribe first, 0
   * of 100 either way. That is a workspace-folder switch, and the entry spec's
   * back-to-back tests on a loaded CI runner. Serializing keeps the nested-root
   * overlap intact: that replacement subscribe is queued before the old
   * subscription's unsubscribe.
   *
   * A queue is only as live as its slowest call, so each call is bounded:
   * `nativeSubscribeTimeoutMs` for a subscribe (it walks the root),
   * `nativeUnsubscribeTimeoutMs` for an unsubscribe. A call that misses it
   * means the engine is wedged: the host posts `fatal` (the supervisor restarts
   * it, within its budget), the call rejects so the queue moves on, and
   * whatever the call resolves with later goes to `onLate` instead of its
   * caller.
   */
  private serializeNative<T>(
    kind: 'subscribe' | 'unsubscribe',
    operation: () => Promise<T>,
    onLate?: (value: T) => void,
  ): Promise<T> {
    const run = this.nativeOperations.then(() =>
      this.withNativeTimeout(kind, operation, onLate),
    );
    // The queue only orders operations; each caller handles its own failure,
    // so a rejected one must not stall the ones behind it.
    this.nativeOperations = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private withNativeTimeout<T>(
    kind: 'subscribe' | 'unsubscribe',
    operation: () => Promise<T>,
    onLate: ((value: T) => void) | undefined,
  ): Promise<T> {
    // Once disposed a call still runs — releases must reach the engine, the
    // in-process hatch shares its process with a successor host — but untimed:
    // nothing may be posted any more, `dispose` already bounds its own wait,
    // and a queue behind a call `dispose` abandoned drains without arming a
    // fresh timer per release.
    if (this.disposed) return operation();
    const timeoutMs =
      kind === 'subscribe'
        ? this.nativeSubscribeTimeoutMs
        : this.nativeUnsubscribeTimeoutMs;
    return new Promise<T>((resolve, reject) => {
      // Set once the caller has been answered by a timeout or by dispose.
      let timedOut = false;
      const call = {
        abandon: () => {
          if (timedOut) return;
          timedOut = true;
          this.inFlightNative.delete(call);
          this.clock.clearTimer(timer);
          reject(new Error(`native ${kind} abandoned by dispose`));
        },
      };
      const timer = this.clock.setTimer(() => {
        timedOut = true;
        this.inFlightNative.delete(call);
        const message = `native ${kind} did not settle within ${timeoutMs} ms`;
        if (!this.disposed) this.post({ type: 'fatal', message });
        reject(new Error(message));
      }, timeoutMs);
      this.inFlightNative.add(call);

      let pending: Promise<T>;
      try {
        pending = operation();
      } catch (error: unknown) {
        pending = Promise.reject(error);
      }
      pending.then(
        (value) => {
          if (timedOut) {
            onLate?.(value);
            return;
          }
          this.inFlightNative.delete(call);
          this.clock.clearTimer(timer);
          resolve(value);
        },
        (error: unknown) => {
          // After a timeout this failure was already reported as `fatal` (or
          // the host is disposed); before it, the caller receives it.
          if (timedOut) return;
          this.inFlightNative.delete(call);
          this.clock.clearTimer(timer);
          reject(error);
        },
      );
    });
  }

  private onNativeSubscribed(
    root: RootWatch,
    token: number,
    subscription: WorkspaceWatchEngineSubscription,
    ignore: readonly string[],
    rebuilt: boolean,
  ): void {
    if (root.pendingToken === token) root.pendingToken = undefined;
    if (!this.isCurrent(root)) {
      void this.unsubscribeNative(subscription);
      return;
    }
    const previous = root.active;
    root.active = { token, subscription, ignore };
    root.retryDelayMs = this.retryInitialMs;
    root.failureSignalled = false;
    if (previous) {
      void this.unsubscribeNative(previous.subscription);
      this.postNotice(
        'native-resubscribed',
        root.dir,
        `${ignore.length} native ignore entries`,
      );
    }
    if (rebuilt) {
      this.postNotice(
        'native-rebuilt',
        root.dir,
        `${root.rebuildReason ?? 'recovery'}; ${ignore.length} native ignore entries`,
      );
      root.rebuildReason = undefined;
    }
    if (root.overflowOnSettle) {
      // After the gap, not before it: a rescan that starts now sees every
      // change made while no subscription was live.
      root.overflowOnSettle = false;
      for (const subscriber of root.subscribers.values()) {
        subscriber.coalescer.signalOverflow();
      }
    }
    if (root.resubscribeQueued) {
      root.resubscribeQueued = false;
      this.ensureNative(root);
    }
    this.ackSubscribers(root);
  }

  private onNativeSubscribeFailed(
    root: RootWatch,
    token: number,
    error: unknown,
  ): void {
    if (root.pendingToken === token) root.pendingToken = undefined;
    if (!this.isCurrent(root)) return;
    this.postError('native-subscribe-failed', describeError(error));
    this.lostEvents(root);
    root.rebuildReason ??= 'native subscribe failed';
    root.overflowOnSettle = true;
    this.scheduleRetry(root);
  }

  private onEngineEvents(
    root: RootWatch,
    token: number,
    error: Error | null,
    events: readonly WorkspaceWatchEngineEvent[],
  ): void {
    if (!this.isCurrent(root)) return;
    // Events from a subscription already replaced are dropped: its successor
    // was live before it was unsubscribed, so they are duplicates.
    if (root.active !== undefined && token < root.active.token) return;

    if (error) {
      // A subscription being released by a rebuild already has its recovery.
      if (root.active === undefined && token < (root.pendingToken ?? 0)) {
        return;
      }
      this.postError('native-error', describeError(error));
      this.lostEvents(root);
      root.rebuildRequested = true;
      root.rebuildReason = 'native error';
      root.overflowOnSettle = true;
      this.scheduleRetry(root);
      return;
    }

    this.eventsSinceHeartbeat += events.length;
    const subscribers = [...root.subscribers.values()];
    for (const event of events) {
      for (const subscriber of subscribers) {
        subscriber.coalescer.push(event.path, event.type);
      }
    }
    // After the push: a storm the push started has already suspended it.
    root.reconciler?.observe(events);
  }

  /** A child the engine never reported, found by listing a created directory. */
  private onDiscovered(root: RootWatch, absolutePath: string): void {
    if (!this.isCurrent(root)) return;
    for (const subscriber of root.subscribers.values()) {
      subscriber.coalescer.push(absolutePath, 'create');
    }
  }

  /**
   * Resumes reconciliation once no subscriber of `root` storms. Creates that
   * went unreconciled during the storm may have lost watches: rebuild.
   */
  private resumeReconciliationIfCalm(root: RootWatch): void {
    const reconciler = root.reconciler;
    if (!reconciler?.isSuspended || !this.isCurrent(root)) return;
    for (const subscriber of root.subscribers.values()) {
      if (subscriber.coalescer.isStorming) return;
    }
    if (reconciler.resume()) {
      this.onWatchesLost(
        root,
        'directories were created during an event storm',
      );
    }
  }

  /**
   * Watches under `root` are (or may be) missing. Subscribers get `overflow`
   * NOW, like a native error, so no consumer trusts a stale view while the
   * debounced, gap-limited rebuild waits, and once more when the rebuilt
   * subscription is live.
   *
   * At a storm's exit this runs inside the coalescer's `exited` hook, before
   * the coalescer folds its own exit overflow; the two fold into one owed
   * overflow, so the storming subscriber still receives one batch.
   */
  private onWatchesLost(root: RootWatch, reason: string): void {
    if (!this.isCurrent(root)) return;
    this.lostEvents(root);
    this.requestRebuild(root, reason);
  }

  /**
   * A debounced, gap-limited rebuild. Subscribers get `overflow` once the new
   * subscription is live ({@link onNativeSubscribed}).
   */
  private requestRebuild(root: RootWatch, reason: string): void {
    if (!this.isCurrent(root)) return;
    root.rebuildReason = reason;
    if (root.rebuildTimer !== undefined) return;
    const gapDelay =
      root.lastRebuildAt === undefined
        ? 0
        : root.lastRebuildAt + this.rebuildMinGapMs - this.clock.now();
    root.rebuildTimer = this.clock.setTimer(
      () => {
        root.rebuildTimer = undefined;
        if (!this.isCurrent(root)) return;
        root.lastRebuildAt = this.clock.now();
        root.rebuildRequested = true;
        root.overflowOnSettle = true;
        // The rebuild walks the whole root; what was tracked is covered.
        root.reconciler?.clear();
        this.ensureNative(root);
      },
      Math.max(this.rebuildDebounceMs, gapDelay),
    );
  }

  /** Every subscriber of `root` owes a rescan; once per failure streak. */
  private lostEvents(root: RootWatch): void {
    if (root.failureSignalled) return;
    root.failureSignalled = true;
    for (const subscriber of root.subscribers.values()) {
      subscriber.coalescer.signalOverflow();
    }
  }

  private scheduleRetry(root: RootWatch): void {
    if (root.retryTimer !== undefined) return;
    const delay = root.retryDelayMs;
    root.retryDelayMs = Math.min(this.retryMaxMs, delay * 2);
    root.retryTimer = this.clock.setTimer(() => {
      root.retryTimer = undefined;
      root.rebuildRequested = true;
      this.ensureNative(root);
    }, delay);
  }

  private onNestedRepoRoot(root: RootWatch, absoluteRoot: string): void {
    if (!this.isCurrent(root)) return;
    const key = toWorkspaceWatchPathKey(absoluteRoot);
    if (root.detectedNestedRoots.has(key)) return;
    if (
      root.detectedNestedRoots.size >=
      WORKSPACE_WATCH_HOST_DEFAULTS.maxDetectedNestedRoots
    ) {
      return;
    }
    root.detectedNestedRoots.set(key, absoluteRoot);
    this.postNotice('nested-root-detected', root.dir, absoluteRoot);
    if (!this.allSubscribersDetectNestedRepos(root)) return;
    this.scheduleNestedResubscribe(root);
  }

  private scheduleNestedResubscribe(root: RootWatch): void {
    if (root.nestedTimer !== undefined) return;
    const now = this.clock.now();
    const gapDelay =
      root.lastNestedResubscribeAt === undefined
        ? 0
        : root.lastNestedResubscribeAt + this.nestedMinGapMs - now;
    const delay = Math.max(this.nestedDebounceMs, gapDelay);
    root.nestedTimer = this.clock.setTimer(() => {
      root.nestedTimer = undefined;
      root.lastNestedResubscribeAt = this.clock.now();
      this.ensureNative(root);
    }, delay);
  }

  private allSubscribersDetectNestedRepos(root: RootWatch): boolean {
    for (const subscriber of root.subscribers.values()) {
      if (!subscriber.options.nestedRepoDetection) return false;
    }
    return true;
  }

  private async teardownRoot(root: RootWatch): Promise<void> {
    if (root.retryTimer !== undefined) this.clock.clearTimer(root.retryTimer);
    if (root.nestedTimer !== undefined) this.clock.clearTimer(root.nestedTimer);
    if (root.rebuildTimer !== undefined) {
      this.clock.clearTimer(root.rebuildTimer);
    }
    root.retryTimer = undefined;
    root.nestedTimer = undefined;
    root.rebuildTimer = undefined;
    root.reconciler?.dispose();
    for (const subscriber of root.subscribers.values()) {
      subscriber.coalescer.dispose();
    }
    root.subscribers.clear();
    const active = root.active;
    root.active = undefined;
    if (active) await this.unsubscribeNative(active.subscription);
  }

  private async unsubscribeNative(
    subscription: WorkspaceWatchEngineSubscription,
  ): Promise<void> {
    try {
      await this.serializeNative('unsubscribe', () =>
        subscription.unsubscribe(),
      );
    } catch (error: unknown) {
      if (!this.disposed) {
        this.postError('native-unsubscribe-failed', describeError(error));
      }
    }
  }

  private beat(): void {
    if (this.disposed) return;
    const now = this.clock.now();
    const elapsedMs = Math.max(1, now - this.lastHeartbeatAt);
    this.post({
      type: 'heartbeat',
      seq: this.heartbeatSeq++,
      subscriptions: this.subscriptions.size,
      eventsPerSec: Math.round((this.eventsSinceHeartbeat * 1000) / elapsedMs),
    });
    this.eventsSinceHeartbeat = 0;
    this.lastHeartbeatAt = now;
    this.heartbeatTimer = this.clock.setTimer(() => {
      this.heartbeatTimer = undefined;
      this.beat();
    }, this.heartbeatIntervalMs);
  }

  private postError(
    code: WorkspaceWatchErrorCode,
    message: string,
    id?: number,
  ): void {
    this.post({
      type: 'error',
      code,
      message: clipWorkspaceWatchText(message),
      ...(id === undefined ? {} : { id }),
    });
  }

  private postNotice(
    code: WorkspaceWatchNoticeCode,
    root: string,
    detail?: string,
  ): void {
    this.post({
      type: 'notice',
      code,
      root,
      ...(detail === undefined
        ? {}
        : { detail: clipWorkspaceWatchText(detail) }),
    });
  }
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
