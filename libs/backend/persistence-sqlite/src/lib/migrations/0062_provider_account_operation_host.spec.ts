import 'reflect-metadata';
import { sql as providerAccountsSql } from './0058_provider_accounts';
import { sql as sessionLinksSql } from './0059_provider_account_session_links';
import { sql as leaseEpochSql } from './0060_provider_account_lease_epoch';
import { sql as leaseHostSql } from './0061_provider_account_lease_host';
import { sql } from './0062_provider_account_operation_host';
import { MIGRATIONS } from './index';

interface DatabaseShape {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: (string | number | null)[]): unknown;
    all(...params: (string | number | null)[]): unknown[];
  };
  close(): void;
}

describe('migration 0062_provider_account_operation_host', () => {
  let db: DatabaseShape;
  const machine = 'a'.repeat(64);

  beforeEach(() => {
    // Real SQLite, as in 0058-0061: the CHECK behaviour is the point.
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => DatabaseShape;
    };
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(providerAccountsSql);
    db.exec(sessionLinksSql);
    db.exec(leaseEpochSql);
    db.exec(leaseHostSql);
  });

  afterEach(() => db.close());

  function operation(id: string, host?: { pid: number | null; machine: string | null; prior: string | null }): void {
    if (!host) {
      db.prepare(`INSERT INTO provider_account_operations
        (operation_id, route_fingerprint, profile_id, provider, kind, auth_epoch, expected_revision, owner_id, created_at)
        VALUES (?, ?, NULL, 'claude', 'sign-in', 1, 1, 'owner', 1)`).run(id, 'fp-' + id);
      return;
    }
    db.prepare(`INSERT INTO provider_account_operations
      (operation_id, route_fingerprint, profile_id, provider, kind, auth_epoch, expected_revision, owner_id, created_at,
        host_pid, host_machine, prior_state)
      VALUES (?, ?, NULL, 'claude', 'sign-in', 1, 1, 'owner', 1, ?, ?, ?)`)
      .run(id, 'fp-' + id, host.pid, host.machine, host.prior);
  }

  it('registers 0062 immediately after 0061 as the maximum version', () => {
    const previousIndex = MIGRATIONS.findIndex((entry) => entry.version === 61);
    expect(MIGRATIONS[previousIndex + 1]).toEqual({
      version: 62,
      name: '0062_provider_account_operation_host',
      sql,
    });
    expect(Math.max(...MIGRATIONS.map((entry) => entry.version))).toBe(62);
    expect(sql).not.toContain('${');
  });

  it('keeps legacy operations with no owning host and records owners on new rows', () => {
    operation('legacy');
    db.exec(sql);
    operation('owned', { pid: 4242, machine, prior: 'signed-in' });
    expect(db.prepare('SELECT operation_id, host_pid, host_machine, child_pid, prior_state FROM provider_account_operations ORDER BY operation_id').all())
      .toEqual([
        { operation_id: 'legacy', host_pid: null, host_machine: null, child_pid: null, prior_state: null },
        { operation_id: 'owned', host_pid: 4242, host_machine: machine, child_pid: null, prior_state: 'signed-in' },
      ]);
  });

  it('records a console child pid and rejects a non-positive one', () => {
    db.exec(sql);
    operation('owned', { pid: 4242, machine, prior: 'signed-in' });
    db.prepare('UPDATE provider_account_operations SET child_pid = 4321').run();
    expect(db.prepare('SELECT child_pid FROM provider_account_operations').all()).toEqual([{ child_pid: 4321 }]);
    expect(() => db.prepare('UPDATE provider_account_operations SET child_pid = 0').run()).toThrow(/CHECK/);
  });

  it.each([
    ['a zero pid', { pid: 0, machine, prior: null }],
    ['a negative pid', { pid: -1, machine, prior: null }],
    ['a machine digest of the wrong length', { pid: 4242, machine: 'short', prior: null }],
    ['a pending prior state', { pid: 4242, machine, prior: 'pending' }],
  ])('rejects %s', (_label, host) => {
    db.exec(sql);
    expect(() => operation('bad', host)).toThrow(/CHECK/);
  });
});
