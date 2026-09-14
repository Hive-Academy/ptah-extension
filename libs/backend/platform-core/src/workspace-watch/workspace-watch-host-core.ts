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
 *   {@link WorkspaceChangeCoalescer} applies that subscriber's full rules.
 * - One coalescer per subscriber: exclusion, nested-repo detection, the storm
 *   breaker, and at most one batch per 250 ms (INV-1). Batches are posted; the
 *   main process never sees a per-event message.
 * - A nested repository found at runtime (`<dir>/.git` created) is added to the
 *   native ignore set by re-subscribing, debounced 1 s and at most once per
 *   10 s per root. `.git` itself is never put in the native ignore set — that
 *   would blind the detection.
 * - A native error means events were lost (A1: Windows buffer overflow): every
 *   subscriber of that root gets `overflow`, and the root is re-subscribed with
 *   back-off.
 * - A heartbeat every 2 s, so the adapter can tell a hung host from a quiet one.
 *
 * It never spawns a process and never reads file contents.
 */

import picomatch from 'picomatch';

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
  clipWorkspaceWatchText,
  parseWorkspaceWatchHostInbound,
  toWorkspaceWatchBatchMessage,
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
  /** Re-subscribe even when the ignore set is unchanged (after a native error). */
  forceResubscribe: boolean;
  /** Another re-subscribe was requested while one was in flight. */
  resubscribeQueued: boolean;
  retryTimer: CoalescerTimerHandle | undefined;
  retryDelayMs: number;
  /** An overflow was already signalled for the current failure streak. */
  failureSignalled: boolean;
  nestedTimer: CoalescerTimerHandle | undefined;
  lastNestedResubscribeAt: number | undefined;
}

const DEFAULT_CLOCK: WorkspaceChangeCoalescerClock = {
  now: () => Date.now(),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const WINDOWS_ABSOLUTE_PATH = /^(?:[A-Za-z]:(?:[\\/]|$)|\\\\|\/\/)/;
/** Names safe to turn into a native glob without escaping. */
const SAFE_GLOB_NAME = /^[A-Za-z0-9._-]+$/;
const GIT_MARKER = /\.git/i;

/** `/`-separated, trailing-separator-free, case-folded for a Windows path. */
export function toWorkspaceWatchPathKey(absolutePath: string): string {
  const normalized = absolutePath
    .replace(/\\/g, '/')
    .replace(/(?<!^)\/{2,}/g, '/')
    .replace(/(?<=.)\/+$/, '');
  return WINDOWS_ABSOLUTE_PATH.test(absolutePath)
    ? normalized.toLowerCase()
    : normalized;
}

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

  private readonly subscriptions = new Map<number, RootWatch>();
  private readonly roots = new Map<string, RootWatch>();
  private heartbeatTimer: CoalescerTimerHandle | undefined;
  private heartbeatSeq = 0;
  private eventsSinceHeartbeat = 0;
  private lastHeartbeatAt = 0;
  private invalidMessagesReported = 0;
  private started = false;
  private disposed = false;

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

  /** Stops every subscription and timer. Never rejects. */
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
    await Promise.all(roots.map((root) => this.teardownRoot(root)));
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
          onStorm: (transition, stats) =>
            this.postNotice(
              transition === 'entered' ? 'storm-entered' : 'storm-exited',
              root.dir,
              `subscription ${id}, ${stats.stormEvents} events`,
            ),
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
    if (root.subscribers.size > 0) return;
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
      forceResubscribe: false,
      resubscribeQueued: false,
      retryTimer: undefined,
      retryDelayMs: this.retryInitialMs,
      failureSignalled: false,
      nestedTimer: undefined,
      lastNestedResubscribeAt: undefined,
    };
    this.roots.set(key, root);
    return root;
  }

  private isCurrent(root: RootWatch): boolean {
    return !this.disposed && this.roots.get(root.key) === root;
  }

  /**
   * Makes the native subscription match the current ignore set. Subscribes the
   * replacement BEFORE unsubscribing the old one, so a re-subscribe loses no
   * events (a duplicate path in the overlap merges inside the coalescer).
   */
  private ensureNative(root: RootWatch): void {
    if (!this.isCurrent(root) || root.subscribers.size === 0) return;
    if (root.pendingToken !== undefined) {
      root.resubscribeQueued = true;
      return;
    }
    if (root.retryTimer !== undefined) return;

    const ignore = this.computeNativeIgnore(root);
    if (
      root.active !== undefined &&
      !root.forceResubscribe &&
      sameStrings(root.active.ignore, ignore)
    ) {
      return;
    }

    root.forceResubscribe = false;
    const token = ++root.nextToken;
    root.pendingToken = token;
    const callback: WorkspaceWatchEngineCallback = (error, events) =>
      this.onEngineEvents(root, token, error, events);

    // The executor runs synchronously, so a synchronous throw from the engine
    // becomes a rejection handled below.
    const subscribing = new Promise<WorkspaceWatchEngineSubscription>(
      (resolve) =>
        resolve(
          this.engine.subscribe(root.dir, callback, { ignore: [...ignore] }),
        ),
    );

    void subscribing.then(
      (subscription) =>
        this.onNativeSubscribed(root, token, subscription, ignore),
      (error: unknown) => this.onNativeSubscribeFailed(root, token, error),
    );
  }

  private onNativeSubscribed(
    root: RootWatch,
    token: number,
    subscription: WorkspaceWatchEngineSubscription,
    ignore: readonly string[],
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
      this.postError('native-error', describeError(error));
      this.lostEvents(root);
      root.forceResubscribe = true;
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
      root.forceResubscribe = true;
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

  /**
   * The native ignore set: only what EVERY subscriber excludes, and only in a
   * form whose native meaning cannot be wider than the coalescer's.
   *
   * - directory names and segment rules become `**\/…\/**` globs (subtree
   *   exclusions, so a backend that prunes a matched directory prunes exactly
   *   what the coalescer drops); names with characters that would need glob
   *   escaping are skipped; segment rules are spelled case-insensitively;
   * - consumer globs pass only when they end in `/**` (a subtree) and compile;
   * - nested roots pass as absolute paths: seeded ones every subscriber listed,
   *   detected ones when every subscriber has detection on.
   *
   * Nothing naming `.git` is ever included: nested-repo detection needs the
   * `.git` create events, and a narrower native set is always safe.
   */
  private computeNativeIgnore(root: RootWatch): readonly string[] {
    const subscribers = [...root.subscribers.values()];
    if (subscribers.length === 0) return [];
    // An intersection: which subscriber is `first` does not change the result.
    const [first, ...rest] = subscribers;
    const ignore = new Set<string>();

    for (const name of first.options.excludeDirNames) {
      if (!isSafeGlobName(name)) continue;
      if (rest.every((s) => s.options.excludeDirNames.includes(name))) {
        ignore.add(`**/${name}/**`);
      }
    }

    const ruleKey = (rule: readonly string[]) =>
      rule
        .filter((segment) => segment.length > 0)
        .map((segment) => segment.toLowerCase())
        .join('/');
    for (const rule of first.options.excludeSegmentRules) {
      const segments = rule.filter((segment) => segment.length > 0);
      if (segments.length === 0 || !segments.every(isSafeGlobName)) continue;
      const wanted = ruleKey(segments);
      if (
        rest.every((s) =>
          s.options.excludeSegmentRules.some(
            (other) => ruleKey(other) === wanted,
          ),
        )
      ) {
        ignore.add(`**/${segments.map(caseInsensitiveGlobName).join('/')}/**`);
      }
    }

    for (const glob of first.options.excludeGlobs) {
      if (!glob.endsWith('/**') || GIT_MARKER.test(glob)) continue;
      if (!rest.every((s) => s.options.excludeGlobs.includes(glob))) continue;
      if (compilesAsGlob(glob)) ignore.add(glob);
    }

    const rootKey = root.key;
    const isStrictlyUnderRoot = (key: string) =>
      key.startsWith(rootKey.endsWith('/') ? rootKey : `${rootKey}/`);
    for (const nestedRoot of first.options.nestedRepoRoots ?? []) {
      const key = toWorkspaceWatchPathKey(nestedRoot);
      if (!isStrictlyUnderRoot(key)) continue;
      if (rest.every((s) => s.seededNestedRootKeys.has(key))) {
        ignore.add(nestedRoot);
      }
    }
    if (this.allSubscribersDetectNestedRepos(root)) {
      for (const [key, nestedRoot] of root.detectedNestedRoots) {
        if (isStrictlyUnderRoot(key)) ignore.add(nestedRoot);
      }
    }

    return [...ignore].sort((a, b) => a.localeCompare(b));
  }

  private async teardownRoot(root: RootWatch): Promise<void> {
    if (root.retryTimer !== undefined) this.clock.clearTimer(root.retryTimer);
    if (root.nestedTimer !== undefined) this.clock.clearTimer(root.nestedTimer);
    root.retryTimer = undefined;
    root.nestedTimer = undefined;
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
      await subscription.unsubscribe();
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

function isSafeGlobName(name: string): boolean {
  return (
    SAFE_GLOB_NAME.test(name) &&
    name !== '.' &&
    name !== '..' &&
    name.toLowerCase() !== '.git'
  );
}

/** `Worktrees` → `[wW][oO]…` so the native glob folds ASCII case like the rule. */
function caseInsensitiveGlobName(name: string): string {
  let glob = '';
  for (const char of name) {
    const lower = char.toLowerCase();
    const upper = char.toUpperCase();
    glob += lower === upper ? char : `[${lower}${upper}]`;
  }
  return glob;
}

function compilesAsGlob(glob: string): boolean {
  try {
    picomatch.makeRe(glob, { dot: true });
    return true;
  } catch {
    // degradation-audit: optional-capability — a glob that does not compile
    // is left out of the native ignore set only; the subscriber's coalescer
    // compiled it already, so exclusion is unaffected.
    return false;
  }
}
