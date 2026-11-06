import { normalizeWorkspaceRoot } from '@ptah-extension/shared';

import type { CommonDirRead, WorktreeListRead } from './git-probe-outcome';

/** How long a confirmed list or common-dir answer is reused. */
export const WORKTREE_LIST_CONFIRMED_TTL_MS = 60_000;
/**
 * How long a failed probe is reused as a failure. It is not a negative
 * "not a worktree" entry: callers still see `failed` and retry after this.
 */
export const WORKTREE_PROBE_FAILURE_BACKOFF_MS = 2_000;

export interface GitFolderProbeDeps {
  /** Uncached `git worktree list`. */
  readonly list: (
    folder: string,
    signal?: AbortSignal,
  ) => Promise<WorktreeListRead>;
  /** Uncached `rev-parse --git-common-dir`. */
  readonly commonDir: (
    dir: string,
    signal?: AbortSignal,
  ) => Promise<CommonDirRead>;
  readonly now?: () => number;
}

interface Cached<T> {
  readonly value: T;
  readonly until: number;
}

interface Flight<T> {
  promise: Promise<T>;
  readonly controller: AbortController;
  stale: boolean;
  /** A waiter with no signal: the child must not be aborted. */
  unsigned: boolean;
  readonly signals: AbortSignal[];
  readonly detach: Array<() => void>;
}

/**
 * One in-flight and one cached `git worktree list` and common-dir per
 * folder. The RPC root resolver and `git:watchRoots` share it through
 * `GitInfoService`. Confirmed answers last until watcher/mutation invalidation or
 * {@link WORKTREE_LIST_CONFIRMED_TTL_MS}. A failure is
 * remembered only for {@link WORKTREE_PROBE_FAILURE_BACKOFF_MS}.
 *
 * A caller's `AbortSignal` aborts the child only when every waiter has
 * aborted. A waiter without a signal keeps the child alive, so one
 * `git:watchRoots` deadline cannot cancel a `git:info` read that joined it.
 */
export class GitFolderProbe {
  private epochValue = 0;
  private readonly lists = new Map<string, Cached<WorktreeListRead>>();
  private readonly commons = new Map<string, Cached<CommonDirRead>>();
  private readonly listFlights = new Map<string, Flight<WorktreeListRead>>();
  private readonly commonFlights = new Map<string, Flight<CommonDirRead>>();

  constructor(private readonly deps: GitFolderProbeDeps) {}

  epoch(): number {
    return this.epochValue;
  }

  readList(folder: string, signal?: AbortSignal): Promise<WorktreeListRead> {
    return this.read(
      normalizeWorkspaceRoot(folder),
      this.lists,
      this.listFlights,
      signal,
      (child) => this.deps.list(folder, child),
    );
  }

  readCommonDir(dir: string, signal?: AbortSignal): Promise<CommonDirRead> {
    return this.read(
      normalizeWorkspaceRoot(dir),
      this.commons,
      this.commonFlights,
      signal,
      (child) => this.deps.commonDir(dir, child),
    );
  }

  /**
   * Drop cached answers for `root` and every path under or over it, or for
   * every path when `root` is omitted. A covered flight still finishes, but
   * its answer is not stored and later callers do not join it.
   */
  invalidate(root?: string): void {
    this.epochValue += 1;
    if (!root) {
      for (const flight of this.listFlights.values()) flight.stale = true;
      for (const flight of this.commonFlights.values()) flight.stale = true;
      this.lists.clear();
      this.commons.clear();
      return;
    }
    const key = normalizeWorkspaceRoot(root);
    this.dropCovered(key, this.lists, this.listFlights);
    this.dropCovered(key, this.commons, this.commonFlights);
  }

  private read<T>(
    key: string,
    cache: Map<string, Cached<T>>,
    flights: Map<string, Flight<T>>,
    signal: AbortSignal | undefined,
    load: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const now = this.now();
    const cached = cache.get(key);
    if (cached && cached.until > now) return Promise.resolve(cached.value);
    cache.delete(key);

    const running = flights.get(key);
    if (running && !running.stale) {
      this.attachSignal(running, signal);
      return running.promise;
    }

    const controller = new AbortController();
    const flight: Flight<T> = {
      promise: Promise.resolve(undefined as T),
      controller,
      stale: false,
      unsigned: false,
      signals: [],
      detach: [],
    };
    this.attachSignal(flight, signal);
    flight.promise = load(controller.signal)
      .then((value) => {
        if (!flight.stale) this.remember(cache, key, value);
        return value;
      })
      .finally(() => {
        for (const release of flight.detach) release();
        if (flights.get(key) === flight) flights.delete(key);
      });
    flights.set(key, flight);
    return flight.promise;
  }

  private remember<T>(
    cache: Map<string, Cached<T>>,
    key: string,
    value: T,
  ): void {
    const failed = isFailed(value);
    const ttl = failed
      ? WORKTREE_PROBE_FAILURE_BACKOFF_MS
      : WORKTREE_LIST_CONFIRMED_TTL_MS;
    cache.set(key, { value, until: this.now() + ttl });
  }

  private attachSignal<T>(flight: Flight<T>, signal?: AbortSignal): void {
    if (!signal) {
      flight.unsigned = true;
      return;
    }
    flight.signals.push(signal);
    const onAbort = (): void => {
      if (flight.unsigned) return;
      if (flight.signals.every((waiter) => waiter.aborted)) {
        flight.controller.abort();
      }
    };
    if (signal.aborted) onAbort();
    else {
      signal.addEventListener('abort', onAbort, { once: true });
      flight.detach.push(() => signal.removeEventListener('abort', onAbort));
    }
  }

  private dropCovered<T>(
    key: string,
    cache: Map<string, Cached<T>>,
    flights: Map<string, Flight<T>>,
  ): void {
    for (const [entryKey, flight] of flights) {
      if (covers(entryKey, key)) flight.stale = true;
    }
    for (const entryKey of [...cache.keys()]) {
      if (covers(entryKey, key)) cache.delete(entryKey);
    }
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }
}

function isFailed(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'failed'
  );
}

/** Same folder, or either path lies inside the other. */
function covers(entryKey: string, invalidated: string): boolean {
  return (
    entryKey === invalidated ||
    entryKey.startsWith(`${invalidated}/`) ||
    invalidated.startsWith(`${entryKey}/`)
  );
}
