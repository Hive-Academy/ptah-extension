/**
 * GitRootWatcherPool — the lifetime of secondary per-root git watchers
 * (TASK_2026_855 component 5, D16).
 *
 * The primary `GitWatcherService` follows the active workspace folder. A
 * renderer that shows another root (a session's worktree) leases it through
 * `git:watchRoots`, and this pool runs a secondary watcher for it so that root
 * gets live `git:status-update` pushes too.
 *
 * - A lease is a renderer's whole root set; each `setLease` replaces it, and an
 *   empty set releases it.
 * - At most {@link MAX_LEASES} leases; a new lease beyond that drops the least
 *   recently renewed one.
 * - A lease not renewed within {@link LEASE_TTL_MS} expires on its own: ONE
 *   unref'd timer is scheduled at the nearest deadline, so a closed renderer
 *   never leaves watchers running.
 * - ONE {@link reconcile} computes the desired set — leased roots ranked by
 *   the lease whose root set changed most recently first (a renewal with the
 *   same roots keeps its rank, so periodic renewals never reorder watchers)
 *   and each lease's own order, minus the primary
 *   watcher's root, capped at {@link MAX_SECONDARY_ROOT_WATCHERS} — and starts
 *   or stops watchers to match. It runs on `setLease`, on expiry, on `attach`
 *   and whenever the primary watcher re-arms, so a root skipped because it was
 *   primary is armed once it no longer is.
 * - Before `attach()` (the heavy boot builds the watchers later) leases are
 *   recorded and answered `watched: []`; `attach()` arms them.
 * - Secondary watchers never run the agent-worktree audit: that housekeeping
 *   belongs to the primary watcher alone.
 */

import type { Logger } from '@ptah-extension/vscode-core';
import type {
  GitRootWatchLeaseOutcome,
  IGitRootWatchRegistry,
} from '@ptah-extension/platform-core';
import { normalizeWorkspaceRoot } from '@ptah-extension/shared';

import type { GitWatcherStartOptions } from './git-watcher.service';

/** Most secondary watchers running at once, across every lease. */
export const MAX_SECONDARY_ROOT_WATCHERS = 4;
/** Most leases held at once; the renderer holds one per instance. */
export const MAX_LEASES = 16;
/** A lease not renewed within this window expires (ms). */
export const LEASE_TTL_MS = 180_000;

const SECONDARY_START_OPTIONS: GitWatcherStartOptions = {
  agentWorktreeAudit: false,
};

type Broadcast = (type: string, payload: unknown) => void;

/** One watcher the pool owns; `GitWatcherService` in production. */
export interface RootWatcher {
  start(
    root: string,
    broadcast: Broadcast,
    options: GitWatcherStartOptions,
  ): void;
  stop(): void;
}

export interface GitRootWatcherPoolAttachment {
  readonly createWatcher: () => RootWatcher;
  readonly broadcast: Broadcast;
  /** The primary watcher's root, or null when it is not armed. */
  readonly primaryRoot: () => string | null;
}

interface Lease {
  /** Roots in the renderer's priority order, de-duplicated by key. */
  readonly roots: readonly string[];
  readonly renewedAt: number;
  /**
   * Ranking sequence: taken when the lease is created or its root set
   * changes, kept on a plain renewal. Higher ranks first (review M2).
   */
  readonly rank: number;
}

interface RunningWatcher {
  readonly root: string;
  readonly watcher: RootWatcher;
}

export class GitRootWatcherPool implements IGitRootWatchRegistry {
  private readonly leases = new Map<string, Lease>();
  /** Running watchers by normalized root key. */
  private readonly watchers = new Map<string, RunningWatcher>();
  /** Root keys whose watcher failed to start in the last reconcile. */
  private startFailures = new Set<string>();
  private attachment: GitRootWatcherPoolAttachment | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  /** Next lease rank; see {@link Lease.rank}. */
  private nextRank = 0;

  constructor(
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  /** Hand the pool what it needs to run watchers, and arm recorded leases. */
  attach(attachment: GitRootWatcherPoolAttachment): void {
    if (this.disposed) return;
    this.attachment = attachment;
    this.reconcile();
    this.scheduleExpiry();
  }

  setLease(
    leaseId: string,
    roots: readonly string[],
  ): GitRootWatchLeaseOutcome {
    if (this.disposed) return { watched: [], evicted: [] };
    const now = this.now();
    this.dropExpired(now);

    if (roots.length === 0) {
      this.leases.delete(leaseId);
    } else {
      const previous = this.leases.get(leaseId);
      if (!previous) this.makeRoomForLease();
      const unique = uniqueByKey(roots);
      const rank =
        previous && sameRootList(previous.roots, unique)
          ? previous.rank
          : this.nextRank++;
      this.leases.set(leaseId, { roots: unique, renewedAt: now, rank });
    }

    this.reconcile();
    this.scheduleExpiry();
    return this.outcomeFor(this.leases.get(leaseId)?.roots ?? []);
  }

  /**
   * The primary watcher re-armed on another root: stop duplicating the new
   * one and arm the old one when it is leased.
   */
  primaryRootChanged(): void {
    if (this.disposed) return;
    this.reconcile();
  }

  /** Stop every watcher, drop every lease and clear the expiry timer. */
  dispose(): void {
    this.disposed = true;
    this.clearExpiryTimer();
    for (const key of [...this.watchers.keys()]) this.stopWatcher(key);
    this.leases.clear();
    this.startFailures.clear();
    this.attachment = null;
  }

  /** Bring the running watchers in line with the live leases. */
  private reconcile(): void {
    const attachment = this.attachment;
    if (!attachment || this.disposed) return;
    const desired = this.desiredRoots(attachment.primaryRoot());

    for (const key of [...this.watchers.keys()]) {
      if (!desired.has(key)) this.stopWatcher(key);
    }

    const failures = new Set<string>();
    for (const [key, root] of desired) {
      if (this.watchers.has(key)) continue;
      const watcher = attachment.createWatcher();
      try {
        watcher.start(root, attachment.broadcast, SECONDARY_START_OPTIONS);
      } catch (error: unknown) {
        // The lease keeps the root, so a later reconcile retries it; until
        // then the root only lacks live pushes (fetch on switch still works).
        failures.add(key);
        this.logger.warn('[GitRootWatcherPool] Watcher failed to start', {
          root,
          error: error instanceof Error ? error.message : String(error),
        });
        this.safeStop(watcher, root);
        continue;
      }
      this.watchers.set(key, { root, watcher });
      this.logger.info('[GitRootWatcherPool] Watching root', { root });
    }
    this.startFailures = failures;
  }

  /**
   * Leased roots by normalized key: highest lease rank first (stable across
   * renewals), each lease in its own priority order, without the primary
   * root, capped.
   */
  private desiredRoots(primaryRoot: string | null): Map<string, string> {
    const primaryKey =
      primaryRoot === null ? null : normalizeWorkspaceRoot(primaryRoot);
    const ranked = [...this.leases.values()].sort((a, b) => b.rank - a.rank);
    const desired = new Map<string, string>();
    for (const lease of ranked) {
      for (const root of lease.roots) {
        if (desired.size >= MAX_SECONDARY_ROOT_WATCHERS) return desired;
        const key = normalizeWorkspaceRoot(root);
        if (key === primaryKey || desired.has(key)) continue;
        desired.set(key, root);
      }
    }
    return desired;
  }

  /** What one lease's roots got: watched (primary included) or evicted. */
  private outcomeFor(roots: readonly string[]): GitRootWatchLeaseOutcome {
    const attachment = this.attachment;
    if (!attachment) return { watched: [], evicted: [] };
    const primary = attachment.primaryRoot();
    const primaryKey =
      primary === null ? null : normalizeWorkspaceRoot(primary);
    const watched: string[] = [];
    const evicted: string[] = [];
    for (const root of roots) {
      const key = normalizeWorkspaceRoot(root);
      if (key === primaryKey || this.watchers.has(key)) watched.push(root);
      else if (!this.startFailures.has(key)) evicted.push(root);
    }
    if (evicted.length > 0) {
      // Debug: every 60 s renewal of an over-cap lease reports it again.
      this.logger.debug('[GitRootWatcherPool] Roots over the watcher cap', {
        evicted,
        cap: MAX_SECONDARY_ROOT_WATCHERS,
      });
    }
    return { watched, evicted };
  }

  /** At the lease cap, drop the least recently renewed lease. */
  private makeRoomForLease(): void {
    if (this.leases.size < MAX_LEASES) return;
    let oldestId: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [id, lease] of this.leases) {
      if (lease.renewedAt < oldestAt) {
        oldestAt = lease.renewedAt;
        oldestId = id;
      }
    }
    if (oldestId === null) return;
    this.leases.delete(oldestId);
    this.logger.info('[GitRootWatcherPool] Lease cap reached; dropped lease', {
      leaseId: oldestId,
      cap: MAX_LEASES,
    });
  }

  /** Delete leases whose TTL has run out; true when any was deleted. */
  private dropExpired(now: number): boolean {
    let dropped = false;
    for (const [id, lease] of this.leases) {
      if (lease.renewedAt + LEASE_TTL_MS <= now) {
        this.leases.delete(id);
        dropped = true;
        this.logger.info('[GitRootWatcherPool] Lease expired', { leaseId: id });
      }
    }
    return dropped;
  }

  /** One timer at the nearest lease deadline; none while no lease is held. */
  private scheduleExpiry(): void {
    this.clearExpiryTimer();
    if (this.disposed || this.leases.size === 0) return;
    let nearest = Number.POSITIVE_INFINITY;
    for (const lease of this.leases.values()) {
      nearest = Math.min(nearest, lease.renewedAt + LEASE_TTL_MS);
    }
    const delay = Math.max(0, nearest - this.now());
    const timer = setTimeout(() => this.onExpiryTimer(), delay);
    // The timer must never keep the process alive on its own.
    timer.unref?.();
    this.expiryTimer = timer;
  }

  private onExpiryTimer(): void {
    this.expiryTimer = null;
    if (this.disposed) return;
    if (this.dropExpired(this.now())) this.reconcile();
    this.scheduleExpiry();
  }

  private clearExpiryTimer(): void {
    if (this.expiryTimer === null) return;
    clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
  }

  private stopWatcher(key: string): void {
    const running = this.watchers.get(key);
    if (!running) return;
    this.watchers.delete(key);
    this.safeStop(running.watcher, running.root);
    this.logger.info('[GitRootWatcherPool] Stopped watching root', {
      root: running.root,
    });
  }

  private safeStop(watcher: RootWatcher, root: string): void {
    try {
      watcher.stop();
    } catch (error: unknown) {
      this.logger.error(
        `[GitRootWatcherPool] Watcher failed to stop for ${root}`,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
}

/** `roots` without a second spelling of an already-listed root. */
function uniqueByKey(roots: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const root of roots) {
    const key = normalizeWorkspaceRoot(root);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(root);
  }
  return unique;
}

/** Same roots in the same order, compared by normalized key. */
function sameRootList(a: readonly string[], b: readonly string[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (root, i) =>
        normalizeWorkspaceRoot(root) === normalizeWorkspaceRoot(b[i]),
    )
  );
}
