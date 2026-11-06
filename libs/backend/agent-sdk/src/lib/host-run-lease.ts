import { z } from 'zod';
import type { Logger } from '@ptah-extension/vscode-core';
import { currentHostRunId } from './host-run-id';

/** Storage key of the heartbeat map, kept beside the session metadata. */
export const HOST_RUN_LEASE_KEY = 'ptah.hostRunLeases';
export const HOST_RUN_HEARTBEAT_INTERVAL_MS = 30_000;
/** Three missed heartbeats: one lost cross-host merge cannot reach it. */
export const HOST_RUN_STALE_AFTER_MS = 90_000;
/** Entries older than this belong to long-gone runs and are pruned. */
export const HOST_RUN_LEASE_RETENTION_MS = 24 * 60 * 60 * 1000;
const HOST_RUN_LEASE_MAX_ENTRIES = 64;
const HOST_RUN_CLOCK_SKEW_MS = 60_000;

const hostRunLeasesSchema = z.record(
  z.string().min(1),
  z.number().int().nonnegative(),
);

/** `hostRunId` -> latest heartbeat, Unix milliseconds. */
export type HostRunLeases = Readonly<Record<string, number>>;

/** Persisted map, or empty when absent or malformed. */
export function parseHostRunLeases(value: unknown): HostRunLeases {
  const parsed = hostRunLeasesSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

/**
 * A host run is live while its heartbeat is recent. A heartbeat beyond the
 * clock-skew allowance is not evidence of anything and counts as missing.
 */
export function isHostRunLive(
  leases: HostRunLeases,
  hostRunId: string,
  now: number,
): boolean {
  const heartbeatAt = leases[hostRunId];
  return (
    heartbeatAt !== undefined &&
    heartbeatAt <= now + HOST_RUN_CLOCK_SKEW_MS &&
    now - heartbeatAt <= HOST_RUN_STALE_AFTER_MS
  );
}

/** Drops expired, future and excess entries; keeps the newest. */
export function pruneHostRunLeases(
  leases: HostRunLeases,
  now: number,
): Record<string, number> {
  const kept = Object.entries(leases)
    .filter(
      ([, heartbeatAt]) =>
        heartbeatAt <= now + HOST_RUN_CLOCK_SKEW_MS &&
        now - heartbeatAt <= HOST_RUN_LEASE_RETENTION_MS,
    )
    .sort(([, a], [, b]) => b - a)
    .slice(0, HOST_RUN_LEASE_MAX_ENTRIES);
  return Object.fromEntries(kept);
}

interface HostRunLeaseStorage {
  read(): Promise<unknown>;
  write(value: HostRunLeases | undefined): Promise<void>;
}

/**
 * This host run's heartbeat in the shared state storage. Another host reading
 * the same store treats this run's `running` references as live while the
 * heartbeat is fresh, and as interrupted once it stops.
 */
export class HostRunLease {
  private timer: ReturnType<typeof setInterval> | undefined;
  private hostRunId = currentHostRunId();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: HostRunLeaseStorage,
    private readonly logger: Logger,
  ) {}

  get isRunning(): boolean {
    return this.timer !== undefined;
  }

  /** First call writes a heartbeat and arms the interval; later calls are free. */
  start(): Promise<void> {
    if (this.timer) return this.queue;
    this.hostRunId = currentHostRunId();
    this.timer = setInterval(() => {
      void this.beat();
    }, HOST_RUN_HEARTBEAT_INTERVAL_MS);
    // A heartbeat must never keep a quitting host alive.
    this.timer.unref();
    return this.beat();
  }

  async read(): Promise<HostRunLeases> {
    return parseHostRunLeases(await this.storage.read());
  }

  /** Stops the heartbeat and withdraws this run's entry: a clean exit is dead at once. */
  dispose(): Promise<void> {
    if (!this.timer) return this.queue;
    clearInterval(this.timer);
    this.timer = undefined;
    return this.enqueue('withdraw', (leases) => {
      const { [this.hostRunId]: _own, ...rest } = leases;
      return rest;
    });
  }

  private beat(): Promise<void> {
    return this.enqueue('heartbeat', (leases, now) => ({
      ...leases,
      [this.hostRunId]: now,
    }));
  }

  private enqueue(
    action: string,
    change: (leases: HostRunLeases, now: number) => HostRunLeases,
  ): Promise<void> {
    const run = this.queue.then(async () => {
      try {
        const now = Date.now();
        const next = pruneHostRunLeases(change(await this.read(), now), now);
        await this.storage.write(
          Object.keys(next).length > 0 ? next : undefined,
        );
      } catch (error: unknown) {
        // A missed write is tolerated by the stale threshold; the next
        // interval retries. Failing the caller would block lane persistence.
        this.logger.warn(
          `[HostRunLease] Could not write the host run ${action}`,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    });
    this.queue = run;
    return run;
  }
}
