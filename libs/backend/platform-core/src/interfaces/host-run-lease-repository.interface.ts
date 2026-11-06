/**
 * Host-run lease repository port — the heartbeat of each running host process
 * in the store that holds the session records, so every host that shares those
 * records also sees whether the writer of a `running` CLI reference is alive.
 *
 * Adapter lives in @ptah-extension/persistence-sqlite (`sessions.sqlite`),
 * registered with SESSION_RECORD_REPOSITORY on Electron and the CLI. VS Code
 * does not register it: consumers inject the token `{ isOptional: true }` and
 * keep their workspace-state fallback.
 */

export interface HostRunLeaseRecord {
  readonly hostRunId: string;
  /** OS process id of the host run, for a liveness probe beyond the heartbeat. */
  readonly pid: number;
  /** Epoch milliseconds of the latest heartbeat. */
  readonly heartbeatAt: number;
}

export interface IHostRunLeaseRepository {
  /** Insert or refresh this run's lease. */
  beat(hostRunId: string, pid: number, at: number): Promise<void>;
  /** Remove a run's lease on a clean exit. Silent when absent. */
  withdraw(hostRunId: string): Promise<void>;
  /**
   * Prune only: delete the lease if it still matches `observed` (same pid and
   * heartbeat) in one atomic step, so a beat that landed after the stale read
   * survives. Resolves whether a row was deleted.
   */
  withdrawIfUnchanged(observed: HostRunLeaseRecord): Promise<boolean>;
  /** The run's lease, or null when absent or unreadable as a lease. */
  get(hostRunId: string): Promise<HostRunLeaseRecord | null>;
  /**
   * Valid leases whose heartbeat is older than `olderThan` (epoch ms). The
   * caller decides which are dead and withdraws only those: a stale heartbeat
   * alone does not prove a host gone.
   */
  listStale(olderThan: number): Promise<readonly HostRunLeaseRecord[]>;
}
