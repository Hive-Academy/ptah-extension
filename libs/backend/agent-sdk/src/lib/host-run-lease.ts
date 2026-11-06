import { z } from 'zod';
import type { Logger } from '@ptah-extension/vscode-core';
import { currentHostRunId } from './host-run-id';
import { isProcessAlive } from './host-process-probe';

/** Each host run owns one heartbeat key beside the session metadata. */
export const HOST_RUN_LEASE_KEY_PREFIX = 'ptah.hostRunLease.';
export const HOST_RUN_HEARTBEAT_INTERVAL_MS = 30_000;
/** Three missed heartbeats make a host run stale. */
export const HOST_RUN_STALE_AFTER_MS = 90_000;
/**
 * Hard bound on pid evidence. A lease whose heartbeat is older than this is
 * dead and prunable whatever its pid says. Accepted edge cases: a host paused
 * for more than 24 h is treated as gone, and a reused pid can keep a dead
 * run's lanes live for at most 24 h.
 */
export const HOST_RUN_LEASE_RETENTION_MS = 24 * 60 * 60 * 1000;
export const HOST_RUN_CLOCK_SKEW_MS = 60_000;

const hostRunHeartbeatSchema = z.number().int().nonnegative();

export function hostRunLeaseKey(hostRunId: string): string {
  return `${HOST_RUN_LEASE_KEY_PREFIX}${hostRunId}`;
}

/** A malformed or absent value is no lease. */
export function parseHostRunHeartbeat(value: unknown): number | undefined {
  const parsed = hostRunHeartbeatSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * A heartbeat is fresh while recent. One beyond the clock-skew allowance is
 * not evidence of anything and counts as missing.
 */
export function isHostRunLive(
  heartbeatAt: number | undefined,
  now: number,
): boolean {
  return (
    heartbeatAt !== undefined &&
    heartbeatAt <= now + HOST_RUN_CLOCK_SKEW_MS &&
    now - heartbeatAt <= HOST_RUN_STALE_AFTER_MS
  );
}

/** What a store knows of one host run. The pid is absent in the fallback. */
export interface HostRunLeaseState {
  readonly heartbeatAt: number | undefined;
  readonly pid: number | undefined;
}

export interface HostRunLeaseEntry extends HostRunLeaseState {
  readonly hostRunId: string;
}

/** Where leases live: the shared session database, or workspace state. */
export interface HostRunLeaseStore {
  beat(hostRunId: string, at: number): Promise<void>;
  withdraw(hostRunId: string): Promise<void>;
  read(hostRunId: string): Promise<HostRunLeaseState | undefined>;
  /** Leases with no fresh heartbeat as of `olderThan`: prune candidates. */
  listStale(olderThan: number): Promise<readonly HostRunLeaseEntry[]>;
  /** Prune only: remove the lease if it still equals the listed snapshot. */
  withdrawIfUnchanged(observed: HostRunLeaseEntry): Promise<boolean>;
}

/**
 * A stale heartbeat alone does not prove a host dead: a paused host keeps its
 * process. A run is live while its heartbeat is fresh, or while its recorded
 * pid is alive and its heartbeat is within {@link HOST_RUN_LEASE_RETENTION_MS}.
 * Our own pid never vouches for a foreign run: it can only be a reused pid of
 * a run that died before this one started.
 */
export function isHostRunAlive(
  lease: HostRunLeaseState | undefined,
  now: number,
  ownPid: number = process.pid,
): boolean {
  if (lease === undefined || lease.heartbeatAt === undefined) return false;
  if (isHostRunLive(lease.heartbeatAt, now)) return true;
  return (
    lease.heartbeatAt <= now + HOST_RUN_CLOCK_SKEW_MS &&
    now - lease.heartbeatAt <= HOST_RUN_LEASE_RETENTION_MS &&
    lease.pid !== undefined &&
    lease.pid !== ownPid &&
    isProcessAlive(lease.pid)
  );
}

/**
 * This host run's heartbeat in a store shared with other hosts. Another host
 * reading the same store treats this run's `running` references as live while
 * the run is alive, and as interrupted once it is gone.
 */
export class HostRunLease {
  private timer: ReturnType<typeof setInterval> | undefined;
  private starting: Promise<void> | undefined;
  /** Bumped by dispose so a pending start cannot arm the interval after it. */
  private epoch = 0;
  private hostRunId = currentHostRunId();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: HostRunLeaseStore,
    private readonly logger: Logger,
  ) {}

  get isRunning(): boolean {
    return this.timer !== undefined;
  }

  /** The first call must persist a heartbeat before it arms the interval. */
  start(): Promise<void> {
    if (this.timer) return this.queue;
    if (this.starting) return this.starting;
    this.hostRunId = currentHostRunId();
    const epoch = this.epoch;
    const firstBeat = this.enqueue('heartbeat', true);
    const pending = firstBeat.then(
      () => {
        // A dispose since this start owns the state now: never re-arm.
        if (epoch !== this.epoch) return;
        this.starting = undefined;
        this.arm();
      },
      (error: unknown) => {
        // A later start must retry the failed first write.
        if (epoch === this.epoch) this.starting = undefined;
        throw error;
      },
    );
    this.starting = pending;
    return pending;
  }

  private arm(): void {
    this.timer = setInterval(() => {
      void this.beat();
    }, HOST_RUN_HEARTBEAT_INTERVAL_MS);
    // A heartbeat must never keep a quitting host alive.
    this.timer.unref();
  }

  /** Liveness reads only the requested owner's lease. */
  async isLive(hostRunId: string, now = Date.now()): Promise<boolean> {
    return isHostRunAlive(await this.store.read(hostRunId), now);
  }

  /** Stops the heartbeat and withdraws this run's lease on a clean exit. */
  dispose(): Promise<void> {
    if (!this.timer && !this.starting) return this.queue;
    this.epoch += 1;
    this.starting = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    // Queued behind a pending first beat, so the withdrawal lands last.
    return this.enqueue('withdraw', false);
  }

  private beat(): Promise<void> {
    return this.enqueue('heartbeat', false);
  }

  private enqueue(
    action: 'heartbeat' | 'withdraw',
    rejectOnFailure: boolean,
  ): Promise<void> {
    const run = this.queue.then(async () => {
      try {
        if (action === 'heartbeat') {
          await this.store.beat(this.hostRunId, Date.now());
        } else {
          await this.store.withdraw(this.hostRunId);
        }
      } catch (error: unknown) {
        // degradation-audit: reported - later beats retry after a warning; the
        // first beat rejects so no unleased running reference is persisted.
        this.logger.warn(
          `[HostRunLease] Could not write the host run ${action}`,
          error instanceof Error ? error : new Error(String(error)),
        );
        if (rejectOnFailure) throw error;
      }
      if (action === 'heartbeat') await this.prune();
    });
    // A rejected first beat reaches its caller but does not poison the queue.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Withdraws only leases proven dead by the same rule liveness reads use. */
  private async prune(): Promise<void> {
    try {
      const now = Date.now();
      const candidates = await this.store.listStale(
        now - HOST_RUN_STALE_AFTER_MS,
      );
      for (const lease of candidates) {
        if (lease.hostRunId === this.hostRunId) continue;
        // Conditional: a beat landing after the listing keeps the lease.
        if (!isHostRunAlive(lease, now)) {
          await this.store.withdrawIfUnchanged(lease);
        }
      }
    } catch (error: unknown) {
      // degradation-audit: optional-capability - pruning is maintenance only;
      // a failed prune delays cleanup and never changes liveness reads.
      this.logger.warn(
        '[HostRunLease] Could not prune old host run leases',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
}
