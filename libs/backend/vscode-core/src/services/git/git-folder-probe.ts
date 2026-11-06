import { normalizeWorkspaceRoot } from '@ptah-extension/shared';

import type {
  CommonDirRead,
  GitProbeReads,
  WorktreeListRead,
} from './git-probe-outcome';

/** How long a confirmed common directory is reused. */
export const COMMON_DIR_CONFIRMED_TTL_MS = 60_000;
/**
 * How long every other answer is reused: a worktree list (it is also a
 * negative answer for every path it does not name), a `not-a-repo`, and a
 * failure. A failure is not a negative entry: callers still see `failed`
 * and retry after this.
 */
export const WORKTREE_PROBE_SHORT_TTL_MS = 2_000;

export interface GitFolderProbeDeps {
  readonly reader: GitProbeReads;
  readonly now?: () => number;
}

interface Cached<T> {
  readonly value: T;
  readonly until: number;
}

/** The mutable bookkeeping of one in-flight read, without its promise. */
interface FlightState {
  readonly controller: AbortController;
  stale: boolean;
  /** A waiter with no signal: the child must not be aborted. */
  unsigned: boolean;
  /** Signalled waiters that have not aborted yet. */
  liveWaiters: number;
  /** Listener removals of the live signalled waiters. */
  readonly detach: Set<() => void>;
}

interface Flight<T> {
  readonly state: FlightState;
  readonly promise: Promise<T>;
}

/**
 * One in-flight and one cached `git worktree list` and common-dir per
 * folder. The RPC root resolver and `git:watchRoots` share it through
 * `GitInfoService`. A confirmed common dir lasts until watcher/mutation
 * invalidation or {@link COMMON_DIR_CONFIRMED_TTL_MS}; everything else for
 * {@link WORKTREE_PROBE_SHORT_TTL_MS}, so a worktree created outside Ptah is
 * listed within seconds even when no watcher event reaches us.
 *
 * A caller's `AbortSignal` aborts the child only when every waiter has
 * aborted. A waiter without a signal keeps the child alive, so one
 * `git:watchRoots` deadline cannot cancel a `git:info` read that joined it.
 * An aborted flight is never joined and its answer is never stored: it
 * describes the abort, not the folder.
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
      () => WORKTREE_PROBE_SHORT_TTL_MS,
      (child) => this.deps.reader.readWorktreeList(folder, child),
    );
  }

  readCommonDir(dir: string, signal?: AbortSignal): Promise<CommonDirRead> {
    return this.read(
      normalizeWorkspaceRoot(dir),
      this.commons,
      this.commonFlights,
      signal,
      (value) =>
        value.kind === 'dir'
          ? COMMON_DIR_CONFIRMED_TTL_MS
          : WORKTREE_PROBE_SHORT_TTL_MS,
      (child) => this.deps.reader.readCommonDir(dir, child),
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
      for (const flight of this.listFlights.values()) flight.state.stale = true;
      for (const flight of this.commonFlights.values()) {
        flight.state.stale = true;
      }
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
    ttlFor: (value: T) => number,
    load: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const cached = cache.get(key);
    if (cached && cached.until > this.now()) {
      return Promise.resolve(cached.value);
    }
    cache.delete(key);

    const running = flights.get(key);
    if (
      running &&
      !running.state.stale &&
      !running.state.controller.signal.aborted
    ) {
      this.attachSignal(running.state, signal);
      return running.promise;
    }

    const state: FlightState = {
      controller: new AbortController(),
      stale: false,
      unsigned: false,
      liveWaiters: 0,
      detach: new Set(),
    };
    this.attachSignal(state, signal);
    const promise = load(state.controller.signal)
      .then((value) => {
        if (!state.stale && !state.controller.signal.aborted) {
          cache.set(key, { value, until: this.now() + ttlFor(value) });
        }
        return value;
      })
      .finally(() => {
        for (const release of state.detach) release();
        state.detach.clear();
        if (flights.get(key)?.state === state) flights.delete(key);
      });
    flights.set(key, { state, promise });
    return promise;
  }

  /**
   * Count `signal` as a live waiter of `state`. An aborted waiter leaves the
   * count and its listener, so neither grows with waiters that gave up.
   */
  private attachSignal(state: FlightState, signal?: AbortSignal): void {
    if (!signal) {
      state.unsigned = true;
      return;
    }
    const onAbort = (): void => {
      state.detach.delete(release);
      state.liveWaiters -= 1;
      if (!state.unsigned && state.liveWaiters === 0) state.controller.abort();
    };
    const release = (): void => signal.removeEventListener('abort', onAbort);
    state.liveWaiters += 1;
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    state.detach.add(release);
  }

  private dropCovered<T>(
    key: string,
    cache: Map<string, Cached<T>>,
    flights: Map<string, Flight<T>>,
  ): void {
    for (const [entryKey, flight] of flights) {
      if (covers(entryKey, key)) flight.state.stale = true;
    }
    for (const entryKey of [...cache.keys()]) {
      if (covers(entryKey, key)) cache.delete(entryKey);
    }
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }
}

/** Same folder, or either path lies inside the other. */
function covers(entryKey: string, invalidated: string): boolean {
  return (
    entryKey === invalidated ||
    entryKey.startsWith(`${invalidated}/`) ||
    invalidated.startsWith(`${entryKey}/`)
  );
}
