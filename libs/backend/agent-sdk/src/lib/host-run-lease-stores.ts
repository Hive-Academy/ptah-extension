import type { IHostRunLeaseRepository } from '@ptah-extension/platform-core';
import {
  HOST_RUN_CLOCK_SKEW_MS,
  HOST_RUN_LEASE_KEY_PREFIX,
  HOST_RUN_LEASE_RETENTION_MS,
  hostRunLeaseKey,
  parseHostRunHeartbeat,
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
    prune: (now) => repository.prune(now - HOST_RUN_LEASE_RETENTION_MS),
  };
}

/** The workspace-state operations the fallback store needs. */
export interface LeaseStateStorage {
  read(key: string): Promise<unknown>;
  write(key: string, value: number | undefined): Promise<void>;
  keys(): readonly string[];
}

function shouldPruneHeartbeat(value: unknown, now: number): boolean {
  const heartbeatAt = parseHostRunHeartbeat(value);
  return (
    heartbeatAt === undefined ||
    heartbeatAt > now + HOST_RUN_CLOCK_SKEW_MS ||
    now - heartbeatAt > HOST_RUN_LEASE_RETENTION_MS
  );
}

/**
 * VS Code fallback: one heartbeat key per host run in workspace state. It
 * records no pid, so a stale heartbeat there means a dead run (legacy rule).
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
    prune: async (now) => {
      const keys = storage
        .keys()
        .filter((key) => key.startsWith(HOST_RUN_LEASE_KEY_PREFIX));
      for (const key of keys) {
        if (shouldPruneHeartbeat(await storage.read(key), now)) {
          await storage.write(key, undefined);
        }
      }
    },
  };
}
