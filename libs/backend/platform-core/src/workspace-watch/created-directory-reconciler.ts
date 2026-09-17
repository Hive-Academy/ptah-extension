/**
 * `CreatedDirectoryReconciler` — closes the gap a per-directory watch engine
 * leaves when a directory is created (TASK_2026_437, PR #510 Linux CI).
 *
 * ## The gap
 *
 * `@parcel/watcher`'s inotify backend reports a created directory and only then
 * adds a watch on it (`src/linux/InotifyBackend.cc` `handleSubscription`,
 * 2.5.6). It never lists the directory, so:
 * - a file created inside it before that watch exists is never reported;
 * - a subdirectory created in that window is never watched, so every later
 *   change under it is lost too, silently, until the native subscription is
 *   rebuilt from scratch.
 *
 * Open upstream as parcel-bundler/watcher#243. Measured on WSL2 ext4 with 800
 * parallel `mkdir -p d/a/b/c/d/e && echo > d/a/b/c/d/e/first.txt`: 11–25 files
 * and 37–75 directory creates never reported, then 11–20 of 800 later writes
 * into those directories lost. FSEvents (macOS) and ReadDirectoryChangesW
 * (Windows) watch a whole tree from one handle, and the watchman backend is
 * recursive, so only the host entries on Linux enable this.
 *
 * ## What it does
 *
 * - Every engine `create` is tracked. The engine does not say whether the path
 *   is a directory; listing a file fails with ENOTDIR, and that is the answer.
 * - After {@link CREATED_DIRECTORY_RECONCILER_DEFAULTS.settleMs}, tracked paths
 *   are listed one level deep, a few at a time. A child the engine has not
 *   reported goes to `onDiscovered` as a `create` (the core pushes it through
 *   every subscriber's coalescer, which applies that subscriber's exclusions).
 *   A child in the native ignore set is skipped: the engine never reports it,
 *   by design.
 * - Recursion is one level per pass: a subdirectory the engine DID report is a
 *   tracked `create` of its own, and one it did NOT report is tracked too
 *   (nothing under an unwatched directory is ever reported), so the whole new
 *   subtree is listed within a few passes, bounded by `maxTrackedPaths`.
 * - A child DIRECTORY the engine has not reported is either a lost watch or a
 *   report still inside the engine's debounce. It is re-checked after
 *   `confirmMs`; still unreported, the watch is lost and `onIncomplete` fires
 *   (the core signals `overflow` at once, rebuilds the native subscription,
 *   and signals `overflow` again).
 * - A directory that cannot be listed (EACCES/EPERM) reconciles to nothing —
 *   the engine could not watch it either — and is reported through
 *   `onUnreadable`, rate-limited.
 * - Too many tracked paths or listed entries also fire `onIncomplete`: for a
 *   checkout-sized burst one rebuild is cheaper than reconciling, and exact.
 * - {@link suspend} while any subscriber of the root storms: nothing is tracked
 *   and each event costs one comparison. {@link resume} reports whether a
 *   create went unreconciled, so the core can rebuild after the storm.
 *
 * Pure: `listDirectory` and the clock are injected, so it runs on any OS in a
 * spec. Every method is synchronous except the listing pass, whose results are
 * dropped once {@link clear}, {@link suspend} or {@link dispose} ran.
 */

import picomatch from 'picomatch';

import type { WorkspaceChangeKind } from '../interfaces/workspace-watcher.interface';
import type {
  CoalescerTimerHandle,
  WorkspaceChangeCoalescerClock,
} from '../utils/workspace-change-coalescer';
import { toWorkspaceWatchPathKey } from './workspace-watch-protocol';

/** One directory entry, in `fs.readdir(dir, { withFileTypes: true })` shape. */
export interface WorkspaceWatchDirectoryEntry {
  readonly name: string;
  /** False for a symbolic link: the engine does not follow one either. */
  readonly isDirectory: boolean;
}

/** Lists one directory. Rejects when it is not a directory or is gone. */
export type WorkspaceWatchListDirectory = (
  absoluteDir: string,
) => Promise<readonly WorkspaceWatchDirectoryEntry[]>;

export const CREATED_DIRECTORY_RECONCILER_DEFAULTS = {
  /**
   * Wait after a create before listing, so the burst that creates a directory
   * and its first children is listed once rather than once per event.
   */
  settleMs: 100,
  /**
   * How long an unreported child directory may stay unreported before its
   * watch counts as lost. `@parcel/watcher` delivers a change within its
   * `MAX_WAIT_TIME` (500 ms, `src/Debounce.hh`) even under sustained load;
   * doubled for event-loop latency in the host.
   */
  confirmMs: 1_000,
  /** Created paths awaiting a listing. Beyond it a rebuild is cheaper. */
  maxTrackedPaths: 2_000,
  /** Entries one listing pass may read. Beyond it a rebuild is cheaper. */
  maxEntriesPerPass: 5_000,
  /** Concurrent listings: the size of libuv's default thread pool. */
  listConcurrency: 4,
  /** Minimum gap between two `onUnreadable` reports of one root. */
  unreadableReportIntervalMs: 60_000,
} as const;

export type CreatedDirectoryIncompleteReason = 'lost-watch' | 'limit-exceeded';

export interface CreatedDirectoryReconcilerOptions {
  /** The watched root, as given to the engine. */
  readonly root: string;
  readonly listDirectory: WorkspaceWatchListDirectory;
  readonly clock: WorkspaceChangeCoalescerClock;
  /** The ignore list the live native subscription was given. */
  readonly nativeIgnore: () => readonly string[];
  /** A child the engine never reported. */
  readonly onDiscovered: (absolutePath: string) => void;
  /** Watches are missing under the root. State is already cleared. */
  readonly onIncomplete: (
    reason: CreatedDirectoryIncompleteReason,
    detail: string,
  ) => void;
  /** A created directory could not be listed (`EACCES`/`EPERM`); rate-limited. */
  readonly onUnreadable?: (absolutePath: string, code: string) => void;
  readonly settleMs?: number;
  readonly confirmMs?: number;
  readonly maxTrackedPaths?: number;
  readonly maxEntriesPerPass?: number;
  readonly listConcurrency?: number;
  readonly unreadableReportIntervalMs?: number;
}

/** One reconciliation event: structurally the engine's event. */
export interface CreatedDirectoryEvent {
  readonly path: string;
  readonly type: WorkspaceChangeKind;
}

interface TrackedPath {
  readonly key: string;
  readonly path: string;
  /** Child keys the engine reported, of any kind, while this was tracked. */
  readonly reported: Set<string>;
  state: 'queued' | 'listing' | 'confirming';
  /** Unreported child directories awaiting confirmation: key → path. */
  unconfirmed: Map<string, string>;
  confirmAt: number;
}

interface IgnoreMatcher {
  readonly source: readonly string[];
  matches(key: string): boolean;
}

const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:(?:[\\/]|$)|\\\\)/;

export class CreatedDirectoryReconciler {
  private readonly rootKey: string;
  private readonly settleMs: number;
  private readonly confirmMs: number;
  private readonly maxTrackedPaths: number;
  private readonly maxEntriesPerPass: number;
  private readonly listConcurrency: number;
  private readonly unreadableReportIntervalMs: number;

  private readonly tracked = new Map<string, TrackedPath>();
  private settleTimer: CoalescerTimerHandle | undefined;
  private confirmTimer: CoalescerTimerHandle | undefined;
  private passRunning = false;
  /** Bumped by every clear; a listing result from an older generation is dropped. */
  private generation = 0;
  private suspended = false;
  private createSeenWhileSuspended = false;
  private disposed = false;
  private matcher: IgnoreMatcher | undefined;
  private unreadableReportedAt: number | undefined;

  constructor(private readonly options: CreatedDirectoryReconcilerOptions) {
    const defaults = CREATED_DIRECTORY_RECONCILER_DEFAULTS;
    this.rootKey = toWorkspaceWatchPathKey(options.root);
    this.settleMs = options.settleMs ?? defaults.settleMs;
    this.confirmMs = options.confirmMs ?? defaults.confirmMs;
    this.maxTrackedPaths = options.maxTrackedPaths ?? defaults.maxTrackedPaths;
    this.maxEntriesPerPass =
      options.maxEntriesPerPass ?? defaults.maxEntriesPerPass;
    this.listConcurrency = Math.max(
      1,
      options.listConcurrency ?? defaults.listConcurrency,
    );
    this.unreadableReportIntervalMs =
      options.unreadableReportIntervalMs ?? defaults.unreadableReportIntervalMs;
  }

  /** True between {@link suspend} and {@link resume}. */
  get isSuspended(): boolean {
    return this.suspended;
  }

  /** Number of created paths not yet reconciled. */
  get trackedCount(): number {
    return this.tracked.size;
  }

  /** One engine batch, after it was pushed to the coalescers. */
  observe(events: readonly CreatedDirectoryEvent[]): void {
    if (this.disposed) return;
    if (this.suspended) {
      if (!this.createSeenWhileSuspended) {
        this.createSeenWhileSuspended = events.some((e) => e.type === 'create');
      }
      return;
    }

    // Two passes: the engine does not order a batch, so a child's report can
    // precede its parent's create in the same array.
    const keys = events.map((event) => toWorkspaceWatchPathKey(event.path));
    let queued = false;
    for (let i = 0; i < events.length; i++) {
      if (events[i].type !== 'create') continue;
      const key = keys[i];
      if (key === this.rootKey || this.tracked.has(key)) continue;
      if (this.tracked.size >= this.maxTrackedPaths) {
        this.giveUp(
          'limit-exceeded',
          `more than ${this.maxTrackedPaths} created paths awaiting reconciliation`,
        );
        return;
      }
      this.tracked.set(key, {
        key,
        path: events[i].path,
        reported: new Set(),
        state: 'queued',
        unconfirmed: new Map(),
        confirmAt: 0,
      });
      queued = true;
    }
    if (this.tracked.size === 0) return;

    for (let i = 0; i < events.length; i++) {
      const key = keys[i];
      const parent = this.tracked.get(parentKeyOf(key));
      if (parent) {
        parent.reported.add(key);
        parent.unconfirmed.delete(key);
      }
      if (events[i].type === 'delete' && this.tracked.has(key)) {
        this.forgetSubtree(key);
      }
    }
    if (queued) this.armSettle();
  }

  /** Stops reconciling (a subscriber storms). Tracked paths count as unreconciled. */
  suspend(): void {
    if (this.disposed || this.suspended) return;
    this.createSeenWhileSuspended ||= this.tracked.size > 0;
    this.suspended = true;
    this.clear();
  }

  /** Reconciles again. Returns true when a create went unreconciled meanwhile. */
  resume(): boolean {
    if (!this.suspended) return false;
    this.suspended = false;
    const seen = this.createSeenWhileSuspended;
    this.createSeenWhileSuspended = false;
    return seen;
  }

  /** Forgets every tracked path and drops in-flight results (a rebuild covers them). */
  clear(): void {
    this.generation++;
    this.tracked.clear();
    this.passRunning = false;
    if (this.settleTimer !== undefined) {
      this.options.clock.clearTimer(this.settleTimer);
    }
    if (this.confirmTimer !== undefined) {
      this.options.clock.clearTimer(this.confirmTimer);
    }
    this.settleTimer = undefined;
    this.confirmTimer = undefined;
  }

  /** Stops every timer; no callback fires afterwards. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
  }

  private armSettle(): void {
    if (this.settleTimer !== undefined || this.passRunning) return;
    this.settleTimer = this.options.clock.setTimer(() => {
      this.settleTimer = undefined;
      void this.runPass();
    }, this.settleMs);
  }

  private async runPass(): Promise<void> {
    if (this.disposed) return;
    const generation = this.generation;
    const batch = [...this.tracked.values()].filter(
      (item) => item.state === 'queued',
    );
    for (const item of batch) item.state = 'listing';
    this.passRunning = true;

    let next = 0;
    let listed = 0;
    const current = () => generation === this.generation;
    const worker = async (): Promise<void> => {
      while (next < batch.length && current()) {
        const item = batch[next++];
        const entries = await this.list(item.path);
        if (!current()) return;
        if (this.tracked.get(item.key) !== item) continue;
        if (entries === undefined) {
          this.tracked.delete(item.key);
          continue;
        }
        listed += entries.length;
        if (listed > this.maxEntriesPerPass) {
          this.giveUp(
            'limit-exceeded',
            `more than ${this.maxEntriesPerPass} entries in created directories`,
          );
          return;
        }
        this.reconcile(item, entries, current);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(this.listConcurrency, batch.length) }, () =>
        worker(),
      ),
    );
    if (!current()) return;

    this.passRunning = false;
    this.armConfirm();
    for (const item of this.tracked.values()) {
      if (item.state === 'queued') {
        this.armSettle();
        break;
      }
    }
  }

  private async list(
    path: string,
  ): Promise<readonly WorkspaceWatchDirectoryEntry[] | undefined> {
    try {
      return await this.options.listDirectory(path);
    } catch (error: unknown) {
      // degradation-audit: reported — ENOTDIR (the created path is a file) and
      // ENOENT (already deleted) are the expected answers and say nothing.
      // EACCES/EPERM is reconciled like ENOENT, because there is nothing this
      // host can do under it: `inotify_add_watch` needs read access to the
      // directory, so the engine could not watch it either (`@parcel/watcher`
      // drops such a directory from its tree silently), and a consumer cannot
      // read it. It is not silent, though: `onUnreadable` makes it visible,
      // at most once per `unreadableReportIntervalMs` per root.
      const code = errorCodeOf(error);
      if (code === 'EACCES' || code === 'EPERM')
        this.reportUnreadable(path, code);
      return undefined;
    }
  }

  private reportUnreadable(path: string, code: string): void {
    const now = this.options.clock.now();
    if (
      this.unreadableReportedAt !== undefined &&
      now - this.unreadableReportedAt < this.unreadableReportIntervalMs
    ) {
      return;
    }
    this.unreadableReportedAt = now;
    this.options.onUnreadable?.(path, code);
  }

  private reconcile(
    item: TrackedPath,
    entries: readonly WorkspaceWatchDirectoryEntry[],
    current: () => boolean,
  ): void {
    const ignored = this.ignoreMatcher();
    for (const entry of entries) {
      const path = joinChild(item.path, entry.name);
      const key = toWorkspaceWatchPathKey(path);
      if (item.reported.has(key) || ignored.matches(key)) continue;
      if (entry.isDirectory) {
        item.unconfirmed.set(key, path);
        // Possibly unwatched, so nothing under it will ever be reported: list
        // it too, and its content is delivered before the rebuild's overflow.
        if (!this.tracked.has(key)) {
          if (this.tracked.size >= this.maxTrackedPaths) {
            this.giveUp(
              'limit-exceeded',
              `more than ${this.maxTrackedPaths} created paths awaiting reconciliation`,
            );
            return;
          }
          this.tracked.set(key, {
            key,
            path,
            reported: new Set(),
            state: 'queued',
            unconfirmed: new Map(),
            confirmAt: 0,
          });
        }
      }
      this.options.onDiscovered(path);
      // A discovered create can start a storm, which suspends this reconciler.
      if (!current()) return;
    }
    if (item.unconfirmed.size === 0) {
      this.tracked.delete(item.key);
      return;
    }
    item.state = 'confirming';
    item.confirmAt = this.options.clock.now() + this.confirmMs;
  }

  private armConfirm(): void {
    if (this.confirmTimer !== undefined) return;
    let earliest = Infinity;
    for (const item of this.tracked.values()) {
      if (item.state === 'confirming') {
        earliest = Math.min(earliest, item.confirmAt);
      }
    }
    if (earliest === Infinity) return;
    const delay = Math.max(0, earliest - this.options.clock.now());
    this.confirmTimer = this.options.clock.setTimer(() => {
      this.confirmTimer = undefined;
      this.confirm();
    }, delay);
  }

  private confirm(): void {
    if (this.disposed) return;
    const now = this.options.clock.now();
    for (const item of [...this.tracked.values()]) {
      if (item.state !== 'confirming' || item.confirmAt > now) continue;
      const [lost] = item.unconfirmed.values();
      if (lost !== undefined) {
        this.giveUp('lost-watch', `${lost} was created but never reported`);
        return;
      }
      this.tracked.delete(item.key);
    }
    this.armConfirm();
  }

  /** A tracked directory was deleted: nothing under it can be reported any more. */
  private forgetSubtree(key: string): void {
    const prefix = `${key}/`;
    for (const trackedKey of [...this.tracked.keys()]) {
      if (trackedKey === key || trackedKey.startsWith(prefix)) {
        this.tracked.delete(trackedKey);
      }
    }
  }

  private giveUp(
    reason: CreatedDirectoryIncompleteReason,
    detail: string,
  ): void {
    this.clear();
    this.options.onIncomplete(reason, detail);
  }

  /**
   * The engine's own ignore decision, mirrored: a non-glob entry is an
   * absolute path that ignores itself and everything under it; a glob is
   * compiled like `@parcel/watcher`'s `wrapper.js` does (`picomatch`,
   * `dot: true`) and matched against the root-relative path.
   *
   * It must agree with the engine in both directions: a path it wrongly calls
   * ignored would hide a real lost watch; one it wrongly calls watched costs a
   * spurious rebuild. Checked against the real 2.5.6 binary on Linux
   * (TASK_2026_437) with the ignore list `planNativeIgnoreSet` builds from
   * `node_modules`, `dist`, `.claude/worktrees` (the bracket-class glob), a
   * consumer `/**` glob and an absolute nested root: 46 of 46 created paths
   * agreed — including dot directories, a `dist` under a dot directory,
   * differently cased names and near-miss names (`distx`, `nested-repo-b`,
   * `excluded-globby`). Re-check it when the engine is upgraded.
   */
  private ignoreMatcher(): IgnoreMatcher {
    const source = this.options.nativeIgnore();
    if (this.matcher?.source === source) return this.matcher;

    const paths: string[] = [];
    const globs: RegExp[] = [];
    for (const entry of source) {
      if (ABSOLUTE_PATH.test(entry)) {
        paths.push(toWorkspaceWatchPathKey(entry));
        continue;
      }
      try {
        globs.push(picomatch.makeRe(entry, { dot: true }));
      } catch {
        // degradation-audit: optional-capability — the core only passes globs
        // that compiled; one that does not is one the engine could not have
        // applied either, so it ignores nothing here.
      }
    }
    const rootPrefix = `${this.rootKey}/`;
    this.matcher = {
      source,
      matches: (key) => {
        for (const path of paths) {
          if (key === path || key.startsWith(`${path}/`)) return true;
        }
        if (globs.length === 0 || !key.startsWith(rootPrefix)) return false;
        const relative = key.slice(rootPrefix.length);
        return globs.some((glob) => glob.test(relative));
      },
    };
    return this.matcher;
  }
}

/**
 * `/a/b` → `/a`; `/a` → `/`; a key with no `/` at all → `''`. Only the last
 * case is not a real parent, and it is unreachable: every key comes from an
 * absolute path, and `observe` never looks up the root's own parent.
 */
function parentKeyOf(key: string): string {
  const index = key.lastIndexOf('/');
  return index <= 0 ? key.slice(0, index + 1) : key.slice(0, index);
}

function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'string' ? error.code : undefined;
}

function joinChild(dir: string, name: string): string {
  const separator = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return dir.endsWith(separator)
    ? `${dir}${name}`
    : `${dir}${separator}${name}`;
}
