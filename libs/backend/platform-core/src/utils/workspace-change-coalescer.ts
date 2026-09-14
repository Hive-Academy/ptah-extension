/**
 * `WorkspaceChangeCoalescer` — the one implementation of the
 * {@link IWorkspaceWatcher} batching guarantees (TASK_2026_437 C7, INV-1,
 * INV-6).
 *
 * Every adapter owns one coalescer per subscription and feeds it raw engine
 * events with {@link WorkspaceChangeCoalescer.push}. Per event:
 *
 * 1. while a storm runs, the event costs one breaker counter and nothing else —
 *    no path parsing, no allocation (INV-1); the storm's end emits ONE
 *    `overflow` batch;
 * 2. otherwise paths outside the root are dropped;
 * 3. nested repositories (`<dir>/.git` below the root) are detected when asked
 *    to;
 * 4. exclusions apply — nested roots, directory names, segment rules, globs —
 *    so an excluded event costs nothing further and can never START a storm;
 * 5. the event is counted in an {@link EventStormBreaker};
 * 6. distinct paths accumulate up to `maxPathsPerBatch`; at most one batch per
 *    `minBatchIntervalMs` is emitted, always from a timer.
 *
 * One loss-of-events incident yields ONE `overflow` batch: a
 * `signalOverflow()` during a storm, or a storm starting while a signalled
 * overflow is still pending, is carried by the storm's exit overflow.
 *
 * It replaces the storm loops hand-copied into `GitWatcherService` and
 * `WorkspaceFileIndexService` once those consumers move onto the port.
 *
 * Pure: no filesystem, no process, no logger. Timers and the clock are
 * injectable; failures in the listener are handed to the caller.
 */

import picomatch from 'picomatch';

import type {
  WorkspaceChange,
  WorkspaceChangeBatch,
  WorkspaceChangeKind,
  WorkspaceChangeListener,
  WorkspaceWatchOptions,
} from '../interfaces/workspace-watcher.interface';
import {
  EventStormBreaker,
  type EventStormBreakerOptions,
  type EventStormStats,
} from './event-storm-breaker';

/** INV-1 bounds. Options are clamped into them, never widened past them. */
export const WORKSPACE_WATCH_LIMITS = {
  /** Default and floor for `minBatchIntervalMs` — at most 4 batches per second. */
  minBatchIntervalMs: 250,
  /** Default and ceiling for `maxPathsPerBatch`. */
  maxPathsPerBatch: 500,
} as const;

/** Timer handle as returned by {@link WorkspaceChangeCoalescerClock.setTimer}. */
export type CoalescerTimerHandle = unknown;

/** Clock and timers, injectable for tests and for hosts with their own loop. */
export interface WorkspaceChangeCoalescerClock {
  now(): number;
  setTimer(callback: () => void, delayMs: number): CoalescerTimerHandle;
  clearTimer(handle: CoalescerTimerHandle): void;
}

export interface WorkspaceChangeCoalescerHooks {
  /**
   * The listener threw. The coalescer keeps running; the caller logs. Required
   * because a throw from a timer callback would otherwise be an uncaught
   * exception in the host process.
   */
  readonly onListenerError: (error: unknown) => void;
  /** Storm breaker tunables, normally `readEventStormBreakerOptionsFromEnv(process.env)`. */
  readonly stormBreakerOptions?: EventStormBreakerOptions;
  /** A storm started or ended — for the adapter's log line. */
  readonly onStorm?: (
    transition: 'entered' | 'exited',
    stats: EventStormStats,
  ) => void;
  /**
   * `nestedRepoDetection` found a new nested root (absolute, in the root's
   * separator style). The Electron/CLI host uses it to add the root to the
   * native ignore set; exclusion inside this coalescer is already in force.
   */
  readonly onNestedRepoRoot?: (absoluteRoot: string) => void;
  /** Defaults to `Date.now` and the global timers. */
  readonly clock?: WorkspaceChangeCoalescerClock;
}

const DEFAULT_CLOCK: WorkspaceChangeCoalescerClock = {
  now: () => Date.now(),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** `C:\…`, `C:/…`, or a UNC path: such a root folds case, like NTFS does. */
const WINDOWS_ABSOLUTE_PATH = /^(?:[A-Za-z]:(?:[\\/]|$)|\\\\|\/\/)/;
/** Splits on both POSIX and Windows separators. */
const PATH_SEPARATOR = /[\\/]/;
const GIT_MARKER = '.git';

/**
 * The directory-name and segment-rule half of the exclusion decision, exposed
 * pure so a lib that imports both this and `@ptah-extension/shared` can pin it
 * against `isExcludedWorkspacePath` (drift spec:
 * `libs/backend/workspace-intelligence/src/file-indexing/workspace-exclusion-drift.spec.ts`).
 *
 * MUST stay behaviourally identical to `isExcludedWorkspacePath(relativePath,
 * dirs, rules)` in `libs/shared/src/lib/constants/workspace-scan.constants.ts`
 * — platform-core cannot import shared, so the algorithm is duplicated, not
 * shared:
 * - `dirNames` match single segments EXACTLY (case-sensitive), like
 *   `WATCH_IGNORED_DIRS`;
 * - `rules` match consecutive segments at any depth, ASCII
 *   case-insensitively, skipping empty segments; an empty rule matches nothing.
 */
export function isExcludedBySegmentRules(
  relativePath: string,
  dirNames: ReadonlySet<string>,
  rules: readonly (readonly string[])[],
): boolean {
  if (!relativePath) return false;
  return matchesExcludedSegments(
    relativePath.split(PATH_SEPARATOR),
    dirNames,
    rules,
  );
}

export class WorkspaceChangeCoalescer {
  private readonly clock: WorkspaceChangeCoalescerClock;
  private readonly breaker: EventStormBreaker;
  private readonly minBatchIntervalMs: number;
  private readonly maxPathsPerBatch: number;
  private readonly nestedRepoDetection: boolean;
  private readonly dirNames: ReadonlySet<string>;
  private readonly segmentRules: readonly (readonly string[])[];
  private readonly globMatcher: ((relativePath: string) => boolean) | undefined;
  private readonly caseInsensitive: boolean;
  /** Root normalized (`/` separators, case-folded on Windows) plus one trailing `/`. */
  private readonly rootPrefix: string;
  private readonly rootSeparator: '/' | '\\';
  /** Root as passed, without trailing separators, for composing absolute roots. */
  private readonly rootSpelling: string;
  /** Root-relative nested repository roots, as normalized keys. */
  private readonly nestedRoots = new Set<string>();

  /** Distinct pending paths keyed by normalized relative path. */
  private readonly pending = new Map<string, WorkspaceChange>();
  private droppedCount = 0;
  private truncated = false;
  private overflowOwed = false;
  /**
   * The owed overflow is the periodic refresh of a storm that hit
   * `maxStormMs`. Only that one survives the storm re-entering; any other owed
   * overflow is carried by the next storm exit instead.
   */
  private overflowIsForcedStormRefresh = false;
  private lastEmitAt: number | undefined;
  private flushTimer: CoalescerTimerHandle | undefined;
  private stormTimer: CoalescerTimerHandle | undefined;
  private disposed = false;

  /**
   * Compiles `excludeGlobs` here, so a malformed glob throws from the
   * constructor — before any listener exists. An adapter taking globs from a
   * less-trusted source converts that throw into its own typed error.
   */
  constructor(
    private readonly root: string,
    options: WorkspaceWatchOptions,
    private readonly listener: WorkspaceChangeListener,
    private readonly hooks: WorkspaceChangeCoalescerHooks,
  ) {
    this.clock = hooks.clock ?? DEFAULT_CLOCK;
    this.breaker = new EventStormBreaker(hooks.stormBreakerOptions);
    this.minBatchIntervalMs = clampInterval(options.minBatchIntervalMs);
    this.maxPathsPerBatch = clampCap(options.maxPathsPerBatch);
    this.nestedRepoDetection = options.nestedRepoDetection;
    this.dirNames = new Set(options.excludeDirNames);
    this.segmentRules = options.excludeSegmentRules;
    this.globMatcher =
      options.excludeGlobs.length > 0
        ? picomatch([...options.excludeGlobs], { dot: true })
        : undefined;

    this.caseInsensitive = WINDOWS_ABSOLUTE_PATH.test(root);
    this.rootSpelling = root.replace(/(?<=.)[\\/]+$/, '');
    this.rootSeparator = root.includes('\\') ? '\\' : '/';
    const rootKey = this.normalizeAbsolute(root);
    this.rootPrefix = rootKey.endsWith('/') ? rootKey : `${rootKey}/`;

    for (const nestedRoot of options.nestedRepoRoots ?? []) {
      this.addNestedRepoRoot(nestedRoot);
    }
  }

  /** True once {@link dispose} ran. */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /** True while the storm breaker is suppressing per-event work. */
  get isStorming(): boolean {
    return this.breaker.isStorming;
  }

  /**
   * One raw engine event. O(1) and allocation-free while storming; never calls
   * the listener synchronously.
   */
  push(absolutePath: string, kind: WorkspaceChangeKind): void {
    if (this.disposed) return;

    if (this.breaker.isStorming) {
      // INV-1: during a storm an event is one counter. It is not parsed, so it
      // is not checked for containment or exclusion either; the storm's exit
      // overflow covers every path, excluded or not.
      this.breaker.record(this.clock.now());
      this.droppedCount++;
      return;
    }

    const segments = this.toRelativeSegments(absolutePath);
    if (segments === undefined) return;

    if (this.nestedRepoDetection && absolutePath.includes(GIT_MARKER)) {
      this.detectNestedRoot(segments);
    }

    const relative = segments.join('/');
    if (this.isExcluded(segments, relative)) return;

    if (this.breaker.record(this.clock.now()) === 'entered') {
      this.enterStorm();
      return;
    }

    if (this.overflowOwed) {
      // The owed rescan will see this change; listing it would be redundant.
      this.droppedCount++;
      return;
    }

    const key = this.caseInsensitive ? relative.toLowerCase() : relative;
    const previous = this.pending.get(key);
    if (previous) {
      const merged: WorkspaceChangeKind =
        previous.kind === 'create' && kind === 'update' ? 'create' : kind;
      this.pending.set(key, { path: absolutePath, kind: merged });
    } else if (this.pending.size >= this.maxPathsPerBatch) {
      this.droppedCount++;
      this.truncated = true;
    } else {
      this.pending.set(key, { path: absolutePath, kind });
    }
    this.scheduleFlush();
  }

  /**
   * The adapter lost events (native error, host restart, degraded mode). Any
   * pending paths are folded into one `overflow` batch, emitted on the normal
   * cadence. During a storm the storm's exit overflow already owes the rescan,
   * so the signal adds nothing but its pending count.
   */
  signalOverflow(): void {
    if (this.disposed) return;
    if (this.breaker.isStorming) {
      this.droppedCount += this.pending.size;
      this.pending.clear();
      this.truncated = false;
      return;
    }
    this.foldPendingIntoOverflow(false);
    this.scheduleFlush();
  }

  /**
   * Excludes an absolute nested repository root from now on. Returns false when
   * it is the root itself, lies outside the root, or is already covered.
   */
  addNestedRepoRoot(absoluteRoot: string): boolean {
    const segments = this.toRelativeSegments(absoluteRoot);
    if (segments === undefined) return false;
    return this.addRelativeNestedRoot(segments);
  }

  /** Stops every timer; the listener is never called again. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.flushTimer !== undefined) this.clock.clearTimer(this.flushTimer);
    if (this.stormTimer !== undefined) this.clock.clearTimer(this.stormTimer);
    this.flushTimer = undefined;
    this.stormTimer = undefined;
    this.pending.clear();
  }

  private enterStorm(): void {
    // A pending forced-exit overflow still goes out on its timer: that is the
    // periodic refresh a never-ending storm is owed. Any other pending flush —
    // changes, or a signalled overflow — is carried by this storm's exit, so
    // one incident yields one overflow batch.
    if (!this.overflowIsForcedStormRefresh && this.flushTimer !== undefined) {
      this.clock.clearTimer(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.droppedCount += this.pending.size + 1;
    this.pending.clear();
    this.truncated = false;
    this.hooks.onStorm?.('entered', this.breaker.stats());
    this.armStormTimer();
  }

  private armStormTimer(): void {
    const delay = this.breaker.msUntilNextPoll(this.clock.now());
    if (delay === undefined) return;
    if (this.stormTimer !== undefined) this.clock.clearTimer(this.stormTimer);
    this.stormTimer = this.clock.setTimer(() => {
      this.stormTimer = undefined;
      this.onStormTimer();
    }, delay);
  }

  private onStormTimer(): void {
    if (this.disposed) return;
    switch (this.breaker.poll(this.clock.now())) {
      case 'storming':
        this.armStormTimer();
        return;
      case 'exited': {
        const stats = this.breaker.stats();
        this.hooks.onStorm?.('exited', stats);
        this.foldPendingIntoOverflow(stats.lastExitReason === 'max-duration');
        this.scheduleFlush();
        return;
      }
      case 'idle':
        return;
    }
  }

  private foldPendingIntoOverflow(forcedStormRefresh: boolean): void {
    this.droppedCount += this.pending.size;
    this.pending.clear();
    this.truncated = false;
    // A signal merging into an owed forced refresh keeps it a forced refresh.
    this.overflowIsForcedStormRefresh =
      forcedStormRefresh ||
      (this.overflowOwed && this.overflowIsForcedStormRefresh);
    this.overflowOwed = true;
  }

  private scheduleFlush(): void {
    if (this.disposed || this.flushTimer !== undefined) return;
    const now = this.clock.now();
    const delay =
      this.lastEmitAt === undefined
        ? 0
        : Math.max(0, this.lastEmitAt + this.minBatchIntervalMs - now);
    this.flushTimer = this.clock.setTimer(() => {
      this.flushTimer = undefined;
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
          truncated: this.truncated,
          overflow: false,
          droppedCount: this.droppedCount,
        };

    this.pending.clear();
    this.droppedCount = 0;
    this.truncated = false;
    this.overflowOwed = false;
    this.overflowIsForcedStormRefresh = false;
    this.lastEmitAt = this.clock.now();

    try {
      this.listener(batch);
    } catch (error: unknown) {
      this.hooks.onListenerError(error);
    }
  }

  /**
   * Root-relative segments in the caller's spelling, with no empty or `.`
   * segments. `undefined` for the root itself or anything outside it. The one
   * split per non-storm event.
   */
  private toRelativeSegments(absolutePath: string): string[] | undefined {
    const normalized = this.normalizeAbsolute(absolutePath);
    if (!normalized.startsWith(this.rootPrefix)) return undefined;

    // Slice the un-folded spelling so emitted roots keep their original case.
    const segments = absolutePath
      .replace(/\\/g, '/')
      .replace(/(?<!^)\/{2,}/g, '/')
      .slice(this.rootPrefix.length)
      .split('/')
      .filter((segment) => segment.length > 0 && segment !== '.');
    if (segments.length === 0 || segments.includes('..')) return undefined;
    return segments;
  }

  private normalizeAbsolute(absolutePath: string): string {
    const normalized = absolutePath
      .replace(/\\/g, '/')
      .replace(/(?<!^)\/{2,}/g, '/')
      .replace(/(?<=.)\/+$/, '');
    return this.caseInsensitive ? normalized.toLowerCase() : normalized;
  }

  private isExcluded(segments: readonly string[], relative: string): boolean {
    if (this.nestedRoots.size > 0 && this.isUnderNestedRoot(segments)) {
      return true;
    }
    if (matchesExcludedSegments(segments, this.dirNames, this.segmentRules)) {
      return true;
    }
    return this.globMatcher !== undefined && this.globMatcher(relative);
  }

  private isUnderNestedRoot(segments: readonly string[]): boolean {
    let prefix = '';
    for (const raw of segments) {
      const segment = this.caseInsensitive ? raw.toLowerCase() : raw;
      prefix = prefix.length === 0 ? segment : `${prefix}/${segment}`;
      if (this.nestedRoots.has(prefix)) return true;
    }
    return false;
  }

  /**
   * `pkg/sub/.git[/…]` → `pkg/sub`. Only an exact `.git` segment counts
   * (`.gitignore`, `.github` do not); the root's own `.git` reveals nothing.
   */
  private detectNestedRoot(segments: readonly string[]): void {
    const markerIndex = segments.indexOf(GIT_MARKER);
    if (markerIndex <= 0) return;
    const parents = segments.slice(0, markerIndex);
    if (this.isExcluded(parents, parents.join('/'))) return;
    if (!this.addRelativeNestedRoot(parents)) return;
    this.hooks.onNestedRepoRoot?.(
      [this.rootSpelling, ...parents].join(this.rootSeparator),
    );
  }

  private addRelativeNestedRoot(segments: readonly string[]): boolean {
    if (this.isUnderNestedRoot(segments)) return false;
    const relative = segments.join('/');
    this.nestedRoots.add(
      this.caseInsensitive ? relative.toLowerCase() : relative,
    );
    return true;
  }
}

/** Shared-parity core of {@link isExcludedBySegmentRules}, over pre-split segments. */
function matchesExcludedSegments(
  segments: readonly string[],
  dirNames: ReadonlySet<string>,
  rules: readonly (readonly string[])[],
): boolean {
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (segment.length === 0) continue;
    if (dirNames.has(segment)) return true;
    for (const rule of rules) {
      if (ruleMatchesAt(segments, index, rule)) return true;
    }
  }
  return false;
}

/** True when `rule` matches the non-empty segments starting at `start`. */
function ruleMatchesAt(
  segments: readonly string[],
  start: number,
  rule: readonly string[],
): boolean {
  if (rule.length === 0) return false;

  let cursor = start;
  for (const name of rule) {
    while (cursor < segments.length && segments[cursor].length === 0) {
      cursor++;
    }
    if (
      cursor >= segments.length ||
      !equalsIgnoringAsciiCase(segments[cursor], name)
    ) {
      return false;
    }
    cursor++;
  }
  return true;
}

function clampInterval(value: number | undefined): number {
  const floor = WORKSPACE_WATCH_LIMITS.minBatchIntervalMs;
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(floor, value)
    : floor;
}

function clampCap(value: number | undefined): number {
  const ceiling = WORKSPACE_WATCH_LIMITS.maxPathsPerBatch;
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.min(ceiling, Math.floor(value))
    : ceiling;
}

/**
 * ASCII case-insensitive equality without allocating (no `toLowerCase`).
 * Identical to `equalsIgnoringAsciiCase` in shared `workspace-scan.constants.ts`:
 * per UTF-16 index, `codePointAt` yields a full non-BMP code point at a high
 * surrogate and the lone unit at a low one — neither is in the A-Z fold range,
 * so a non-BMP character only ever equals itself. `?? -1` is unreachable and
 * only narrows the type.
 */
function equalsIgnoringAsciiCase(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    let x = a.codePointAt(i) ?? -1;
    let y = b.codePointAt(i) ?? -1;
    if (x === y) continue;
    if (x >= 65 && x <= 90) x += 32;
    if (y >= 65 && y <= 90) y += 32;
    if (x !== y) return false;
  }
  return true;
}
