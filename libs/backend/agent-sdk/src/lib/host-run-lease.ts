import { z } from 'zod';
import type { Logger } from '@ptah-extension/vscode-core';
import { currentHostRunId } from './host-run-id';

/** Each host run owns one heartbeat key beside the session metadata. */
export const HOST_RUN_LEASE_KEY_PREFIX = 'ptah.hostRunLease.';
export const HOST_RUN_HEARTBEAT_INTERVAL_MS = 30_000;
/** Three missed heartbeats make a host run stale. */
export const HOST_RUN_STALE_AFTER_MS = 90_000;
/** Keys older than this belong to long-gone runs and are pruned. */
export const HOST_RUN_LEASE_RETENTION_MS = 24 * 60 * 60 * 1000;
const HOST_RUN_CLOCK_SKEW_MS = 60_000;

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
 * A host run is live while its heartbeat is recent. A heartbeat beyond the
 * clock-skew allowance is not evidence of anything and counts as missing.
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

function shouldPruneHeartbeat(value: unknown, now: number): boolean {
  const heartbeatAt = parseHostRunHeartbeat(value);
  return (
    heartbeatAt === undefined ||
    heartbeatAt > now + HOST_RUN_CLOCK_SKEW_MS ||
    now - heartbeatAt > HOST_RUN_LEASE_RETENTION_MS
  );
}

interface HostRunLeaseStorage {
  read(key: string): Promise<unknown>;
  write(key: string, value: number | undefined): Promise<void>;
  keys(): readonly string[];
}

/**
 * This host run's heartbeat in the shared state storage. Another host reading
 * the same store treats this run's `running` references as live while the
 * heartbeat is fresh, and as interrupted once it stops.
 */
export class HostRunLease {
  private timer: ReturnType<typeof setInterval> | undefined;
  private starting: Promise<void> | undefined;
  private hostRunId = currentHostRunId();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: HostRunLeaseStorage,
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
    const firstBeat = this.enqueue('heartbeat', true);
    this.starting = firstBeat.then(
      () => {
        this.starting = undefined;
        this.arm();
      },
      (error: unknown) => {
        // A later start must retry the failed first write.
        this.starting = undefined;
        throw error;
      },
    );
    return this.starting;
  }

  private arm(): void {
    this.timer = setInterval(() => {
      void this.beat();
    }, HOST_RUN_HEARTBEAT_INTERVAL_MS);
    // A heartbeat must never keep a quitting host alive.
    this.timer.unref();
  }

  /** Liveness reads only the requested owner's key. */
  async isLive(hostRunId: string, now = Date.now()): Promise<boolean> {
    const value = await this.storage.read(hostRunLeaseKey(hostRunId));
    return isHostRunLive(parseHostRunHeartbeat(value), now);
  }

  /** Stops the heartbeat and withdraws this run's key on a clean exit. */
  dispose(): Promise<void> {
    if (!this.timer && !this.starting) return this.queue;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
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
        await this.storage.write(
          hostRunLeaseKey(this.hostRunId),
          action === 'heartbeat' ? Date.now() : undefined,
        );
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

  /** Key listing makes pruning best-effort without a shared updateable index. */
  private async prune(): Promise<void> {
    try {
      const now = Date.now();
      const keys = this.storage
        .keys()
        .filter((key) => key.startsWith(HOST_RUN_LEASE_KEY_PREFIX));
      for (const key of keys) {
        if (shouldPruneHeartbeat(await this.storage.read(key), now)) {
          await this.storage.write(key, undefined);
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
