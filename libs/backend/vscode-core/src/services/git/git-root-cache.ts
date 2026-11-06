import { stat } from 'fs/promises';
import * as path from 'path';

/** How long a resolved repository root is reused. */
export const GIT_ROOT_SUCCESS_TTL_MS = 60_000;
/** How long a "no repository here" answer is reused. */
export const GIT_ROOT_FAILURE_TTL_MS = 2_000;
/** Most paths remembered at once; the oldest entry goes first. */
export const GIT_ROOT_CACHE_MAX_ENTRIES = 256;

interface RootEntry {
  readonly value: string | null;
  readonly until: number;
}

/** True when `target` exists on disk. */
async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    // degradation-audit: optional-capability - a missing path is the answer
    // this probe exists to give; the caller treats it as "no repository here".
    return false;
  }
}

/** `child` is `parent` or lies under it. */
function isAtOrUnder(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Remembers `git rev-parse --show-toplevel` answers per path.
 *
 * - A missing path never reaches git.
 * - Concurrent lookups of one path share a single probe.
 * - A cached root is served only while both the path and `<root>/.git` still
 *   exist, so a removed or replaced repository is probed again.
 * - {@link invalidate} also discards the answer of a probe that was already
 *   running, so a mutation can never be followed by a pre-mutation root.
 */
export class GitRootCache {
  private readonly entries = new Map<string, RootEntry>();
  /** Running probes per path; `stale` is set when an invalidation covers it. */
  private readonly pending = new Map<string, { promise: Promise<string | null>; stale: boolean }>();

  constructor(private readonly now: () => number = Date.now) {}

  async resolve(target: string, probe: () => Promise<string | null>): Promise<string | null> {
    const cached = this.entries.get(target);
    if (cached && cached.until > this.now()) {
      if (cached.value === null) {
        if (!(await exists(target))) return null;
      } else if ((await exists(target)) && (await exists(path.join(cached.value, '.git')))) {
        return cached.value;
      }
    }
    this.entries.delete(target);
    const running = this.pending.get(target);
    if (running && !running.stale) return running.promise;
    const flight = { promise: Promise.resolve<string | null>(null), stale: false };
    flight.promise = (async (): Promise<string | null> => {
      const value = (await exists(target)) ? await probe() : null;
      if (!flight.stale) this.remember(target, value);
      return value;
    })().finally(() => {
      if (this.pending.get(target) === flight) this.pending.delete(target);
    });
    this.pending.set(target, flight);
    return flight.promise;
  }

  /**
   * Forget answers for `root` and every path under it, or for every path when
   * `root` is omitted. A covered probe that is already running is not
   * stopped, but its answer is not stored and later callers do not join it.
   */
  invalidate(root?: string): void {
    for (const [key, flight] of this.pending) {
      if (!root || isAtOrUnder(key, root)) flight.stale = true;
    }
    if (!root) {
      this.entries.clear();
      return;
    }
    for (const [key, entry] of [...this.entries]) {
      if (isAtOrUnder(key, root) || (entry.value !== null && isAtOrUnder(entry.value, root))) {
        this.entries.delete(key);
      }
    }
  }

  private remember(target: string, value: string | null): void {
    this.entries.delete(target);
    if (this.entries.size >= GIT_ROOT_CACHE_MAX_ENTRIES) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    const ttl = value ? GIT_ROOT_SUCCESS_TTL_MS : GIT_ROOT_FAILURE_TTL_MS;
    this.entries.set(target, { value, until: this.now() + ttl });
  }
}
