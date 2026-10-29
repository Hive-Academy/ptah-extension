import 'reflect-metadata';
import { sql as providerAccountsSql } from './0058_provider_accounts';
import { sql as sessionLinksSql } from './0059_provider_account_session_links';
import { sql as previousHeadSql } from './0060_provider_account_lease_epoch';
import { sql } from './0061_provider_account_lease_host';
import { MIGRATIONS } from './index';

interface DatabaseShape {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: (string | number | null)[]): unknown;
    all(...params: (string | number | null)[]): unknown[];
  };
  close(): void;
}

describe('migration 0061_provider_account_lease_host', () => {
  let db: DatabaseShape;
  const machine = 'a'.repeat(64);

  beforeEach(() => {
    // Real SQLite, as in 0058-0060: the CHECK behaviour is the point.
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => DatabaseShape;
    };
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(providerAccountsSql);
    db.exec(sessionLinksSql);
    db.exec(previousHeadSql);
  });

  afterEach(() => db.close());

  function lease(leaseId: string, hostPid?: number | null, hostMachine?: string | null): void {
    if (hostPid === undefined) {
      db.prepare(`INSERT INTO provider_account_run_leases
        (lease_id, run_id, provider, profile_id, route_fingerprint, owner_id, acquired_at)
        VALUES (?, ?, 'claude', NULL, 'fp-ambient', 'owner', 1)`).run(leaseId, 'run-' + leaseId);
      return;
    }
    db.prepare(`INSERT INTO provider_account_run_leases
      (lease_id, run_id, provider, profile_id, route_fingerprint, owner_id, acquired_at, host_pid, host_machine)
      VALUES (?, ?, 'claude', NULL, 'fp-ambient', 'owner', 1, ?, ?)`)
      .run(leaseId, 'run-' + leaseId, hostPid, hostMachine ?? null);
  }

  it('registers 0061 immediately after 0060', () => {
    const previousIndex = MIGRATIONS.findIndex((entry) => entry.version === 60);
    expect(MIGRATIONS[previousIndex + 1]).toEqual({
      version: 61,
      name: '0061_provider_account_lease_host',
      sql,
    });
    expect(Math.max(...MIGRATIONS.map((entry) => entry.version))).toBe(62);
  });

  it('keeps legacy leases with no owning host and records owners on new rows', () => {
    lease('legacy');
    db.exec(sql);
    lease('owned', 4242, machine);
    expect(db.prepare('SELECT lease_id, host_pid, host_machine, child_pid, lease_state FROM provider_account_run_leases ORDER BY lease_id').all())
      .toEqual([
        { lease_id: 'legacy', host_pid: null, host_machine: null, child_pid: null, lease_state: 'live' },
        { lease_id: 'owned', host_pid: 4242, host_machine: machine, child_pid: null, lease_state: 'live' },
      ]);
  });

  it.each([
    ['a zero pid', 0, machine],
    ['a negative pid', -1, machine],
    ['a machine digest of the wrong length', 4242, 'short'],
  ])('rejects %s', (_label, pid, hostMachine) => {
    db.exec(sql);
    expect(() => lease('bad', pid, hostMachine)).toThrow(/CHECK/);
  });

  it('rejects a non-positive child pid', () => {
    db.exec(sql);
    lease('owned', 4242, machine);
    expect(() => db.prepare('UPDATE provider_account_run_leases SET child_pid = 0').run()).toThrow(/CHECK/);
  });
});
