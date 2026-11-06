import type { IHostRunLeaseRepository } from '@ptah-extension/platform-core';
import {
  HOST_RUN_CLOCK_SKEW_MS,
  HOST_RUN_LEASE_KEY_PREFIX,
  HOST_RUN_STALE_AFTER_MS,
  hostRunLeaseKey,
  parseHostRunHeartbeat,
  type HostRunLeaseEntry,
  type HostRunLeaseStore,
} from './host-run-lease';

/**
 * Leases in the database that holds the session records (Electron, CLI), so
 * every host that shares those records reads the same leases, whichever
 * workspace each host has open.
 */
export function repositoryLeaseStore(
  repository: IHostRunLeaseRepository,
  pid: number = process.pid,
): HostRunLeaseStore {
  return {
    beat: (hostRunId, at) => repository.beat(hostRunId, pid, at),
    withdraw: (hostRunId) => repository.withdraw(hostRunId),
    read: async (hostRunId) => {
      const lease = await repository.get(hostRunId);
      return lease === null
        ? undefined
        : { heartbeatAt: lease.heartbeatAt, pid: lease.pid };
    },
    listStale: async (olderThan) =>
      (await repository.listStale(olderThan)).map((lease) => ({
        hostRunId: lease.hostRunId,
        heartbeatAt: lease.heartbeatAt,
        pid: lease.pid,
      })),
  };
}

/** The workspace-state operations the fallback store needs. */
export interface LeaseStateStorage {
  read(key: string): Promise<unknown>;
  write(key: string, value: number | undefined): Promise<void>;
  keys(): readonly string[];
}

/**
 * Not fresh as of `olderThan`: malformed, older than it, or beyond the skew
 * allowance in the future (`olderThan` is one stale window before now).
 */
function isStaleHeartbeat(
  heartbeatAt: number | undefined,
  olderThan: number,
): boolean {
  return (
    heartbeatAt === undefined ||
    heartbeatAt < olderThan ||
    heartbeatAt > olderThan + HOST_RUN_STALE_AFTER_MS + HOST_RUN_CLOCK_SKEW_MS
  );
}

/**
 * VS Code fallback: one heartbeat key per host run in workspace state. It
 * records no pid, so under the shared liveness rule a stale heartbeat there
 * means a dead run (legacy rule), and pruning withdraws it.
 */
export function stateStorageLeaseStore(
  storage: LeaseStateStorage,
): HostRunLeaseStore {
  return {
    beat: (hostRunId, at) => storage.write(hostRunLeaseKey(hostRunId), at),
    withdraw: (hostRunId) =>
      storage.write(hostRunLeaseKey(hostRunId), undefined),
    read: async (hostRunId) => {
      const value = await storage.read(hostRunLeaseKey(hostRunId));
      const heartbeatAt = parseHostRunHeartbeat(value);
      return heartbeatAt === undefined
        ? undefined
        : { heartbeatAt, pid: undefined };
    },
    // Key listing keeps pruning best-effort without a shared updateable index.
    // A malformed key is listed with no heartbeat, so it reads as dead.
    listStale: async (olderThan) => {
      const stale: HostRunLeaseEntry[] = [];
      const keys = storage
        .keys()
        .filter((key) => key.startsWith(HOST_RUN_LEASE_KEY_PREFIX));
      for (const key of keys) {
        const heartbeatAt = parseHostRunHeartbeat(await storage.read(key));
        if (isStaleHeartbeat(heartbeatAt, olderThan)) {
          const hostRunId = key.slice(HOST_RUN_LEASE_KEY_PREFIX.length);
          stale.push({ hostRunId, heartbeatAt, pid: undefined });
        }
      }
      return stale;
    },
  };
}
