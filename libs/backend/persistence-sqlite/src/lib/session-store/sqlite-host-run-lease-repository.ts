import { z } from 'zod';
import type {
  HostRunLeaseRecord,
  IHostRunLeaseRepository,
} from '@ptah-extension/platform-core';
import type { SessionStoreDatabase } from './session-store-database';

const leaseRowSchema = z.object({
  host_run_id: z.string().min(1),
  pid: z.number().int().positive(),
  heartbeat_at: z.number().int().nonnegative(),
});

// SECURITY: SQL MUST stay static. Values are bound parameters only.
const UPSERT = `
INSERT INTO host_run_leases (host_run_id, pid, heartbeat_at) VALUES (?, ?, ?)
ON CONFLICT (host_run_id) DO UPDATE SET
  pid = excluded.pid,
  heartbeat_at = excluded.heartbeat_at`;

/**
 * {@link IHostRunLeaseRepository} over `sessions.sqlite`. Every read goes to
 * the shared file, so a lease written by one process is visible to the next
 * read in another (WAL plus busy_timeout cover the concurrency).
 */
export class SqliteHostRunLeaseRepository implements IHostRunLeaseRepository {
  constructor(private readonly store: SessionStoreDatabase) {}

  async beat(hostRunId: string, pid: number, at: number): Promise<void> {
    const db = await this.store.ready();
    db.prepare(UPSERT).run(hostRunId, pid, at);
  }

  async withdraw(hostRunId: string): Promise<void> {
    const db = await this.store.ready();
    db.prepare('DELETE FROM host_run_leases WHERE host_run_id = ?').run(
      hostRunId,
    );
  }

  /** A row that fails validation is no lease. */
  async get(hostRunId: string): Promise<HostRunLeaseRecord | null> {
    const db = await this.store.ready();
    const row: unknown = db
      .prepare(
        'SELECT host_run_id, pid, heartbeat_at FROM host_run_leases WHERE host_run_id = ?',
      )
      .get(hostRunId);
    return toLease(row);
  }

  /** Rows that fail validation are left out: they read as no lease anyway. */
  async listStale(olderThan: number): Promise<readonly HostRunLeaseRecord[]> {
    const db = await this.store.ready();
    const rows: unknown[] = db
      .prepare(
        'SELECT host_run_id, pid, heartbeat_at FROM host_run_leases WHERE heartbeat_at < ?',
      )
      .all(olderThan);
    return rows
      .map(toLease)
      .filter((lease): lease is HostRunLeaseRecord => lease !== null);
  }
}

function toLease(row: unknown): HostRunLeaseRecord | null {
  const parsed = leaseRowSchema.safeParse(row);
  if (!parsed.success) return null;
  return {
    hostRunId: parsed.data.host_run_id,
    pid: parsed.data.pid,
    heartbeatAt: parsed.data.heartbeat_at,
  };
}
