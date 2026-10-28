import 'reflect-metadata';
import { sql as providerAccountsSql } from './0058_provider_accounts';
import { sql as previousHeadSql } from './0059_provider_account_session_links';
import { sql } from './0060_provider_account_lease_epoch';
import { MIGRATIONS } from './index';

interface DatabaseShape {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: (string | number | null)[]): unknown;
    all(...params: (string | number | null)[]): unknown[];
  };
  close(): void;
}

interface LeaseRow {
  lease_id: string;
  auth_epoch: number;
  route_revision: number;
  lease_state: string;
}

describe('migration 0060_provider_account_lease_epoch', () => {
  let db: DatabaseShape;

  beforeEach(() => {
    // Real SQLite, as in 0058/0059: the CHECK and FK behaviour is the point.
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => DatabaseShape;
    };
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(providerAccountsSql);
    db.exec(previousHeadSql);
  });

  afterEach(() => db.close());

  function profile(profileId: string, fingerprint: string, authEpoch = 0, routeRevision = 0): void {
    db.prepare(`INSERT INTO provider_account_profiles
      (profile_id, provider, label, canonical_route, route_fingerprint,
       route_revision, auth_epoch, state, created_at, updated_at)
      VALUES (?, 'claude', 'Work', ?, ?, ?, ?, 'signed-in', 1, 1)`)
      .run(profileId, 'route-' + profileId, fingerprint, routeRevision, authEpoch);
  }

  function binding(
    runId: string,
    profileId: string,
    fingerprint: string,
    authEpoch: number,
    routeRevision: number,
  ): void {
    db.prepare(`INSERT INTO provider_account_run_bindings
      (run_id, provider, profile_id, route_revision, route_fingerprint,
       auth_epoch, identity_kind, created_at)
      VALUES (?, 'claude', ?, ?, ?, ?, 'known', 1)`)
      .run(runId, profileId, routeRevision, fingerprint, authEpoch);
  }

  function lease(leaseId: string, runId: string, profileId: string | null, fingerprint: string): void {
    db.prepare(`INSERT INTO provider_account_run_leases
      (lease_id, run_id, provider, profile_id, route_fingerprint, owner_id, acquired_at)
      VALUES (?, ?, 'claude', ?, ?, 'owner-0001', 1)`)
      .run(leaseId, runId, profileId, fingerprint);
  }

  function leases(): LeaseRow[] {
    return db
      .prepare(`SELECT lease_id, auth_epoch, route_revision, lease_state
        FROM provider_account_run_leases ORDER BY lease_id`)
      .all() as LeaseRow[];
  }

  function columns(table: string): string[] {
    return (db.prepare('SELECT name FROM pragma_table_info(?)').all(table) as { name: string }[])
      .map((row) => row.name);
  }

  it('registers 0060 immediately after 0059 as the maximum version', () => {
    const previousIndex = MIGRATIONS.findIndex((entry) => entry.version === 59);
    expect(MIGRATIONS[previousIndex + 1]).toEqual({
      version: 60,
      name: '0060_provider_account_lease_epoch',
      sql,
    });
    expect(Math.max(...MIGRATIONS.map((entry) => entry.version))).toBe(60);
  });

  it('adds lease epoch, route revision and state columns and a NULL identity_ref', () => {
    profile('profile-a', 'fp-a');
    db.exec(sql);
    expect(columns('provider_account_run_leases')).toEqual(
      expect.arrayContaining(['auth_epoch', 'route_revision', 'lease_state']),
    );
    expect(columns('provider_account_profiles')).toContain('identity_ref');
    expect(db.prepare('SELECT identity_ref FROM provider_account_profiles').all()).toEqual([
      { identity_ref: null },
    ]);
  });

  it('backfills legacy leases (a)-(e) and quarantines inconsistent rows without losing any', () => {
    profile('profile-a', 'fp-a', 4, 2);
    profile('profile-b', 'fp-b', 1, 0);
    profile('profile-c', 'fp-c', 7, 3);
    profile('profile-d', 'fp-d', 5, 5);
    // (a) ambient lease, no binding.
    lease('lease-a', 'run-a', null, 'fp-ambient');
    // (b) named lease with a consistent binding at epoch 4, revision 2.
    binding('run-b', 'profile-a', 'fp-a', 4, 2);
    lease('lease-b', 'run-b', 'profile-a', 'fp-a');
    // (c) named lease without any binding.
    lease('lease-c', 'run-c', 'profile-b', 'fp-b');
    // (d) named lease whose run binding is for another profile and route.
    binding('run-d', 'profile-d', 'fp-d', 5, 5);
    lease('lease-d', 'run-d', 'profile-c', 'fp-c');
    // (e) ambient lease whose run has a binding.
    binding('run-e', 'profile-a', 'fp-a', 4, 2);
    lease('lease-e', 'run-e', null, 'fp-a');
    const bindingsBefore = db.prepare('SELECT * FROM provider_account_run_bindings ORDER BY run_id').all();
    const profilesBefore = db.prepare('SELECT * FROM provider_account_profiles ORDER BY profile_id').all();

    db.exec(sql);

    expect(leases()).toEqual([
      { lease_id: 'lease-a', auth_epoch: 0, route_revision: 0, lease_state: 'live' },
      { lease_id: 'lease-b', auth_epoch: 4, route_revision: 2, lease_state: 'live' },
      { lease_id: 'lease-c', auth_epoch: 0, route_revision: 0, lease_state: 'quarantined' },
      { lease_id: 'lease-d', auth_epoch: 0, route_revision: 0, lease_state: 'quarantined' },
      { lease_id: 'lease-e', auth_epoch: 0, route_revision: 0, lease_state: 'quarantined' },
    ]);
    expect(db.prepare('SELECT * FROM provider_account_run_bindings ORDER BY run_id').all())
      .toEqual(bindingsBefore);
    expect(
      (db.prepare('SELECT * FROM provider_account_profiles ORDER BY profile_id').all() as Record<string, unknown>[])
        .map(({ identity_ref, ...rest }) => {
          expect(identity_ref).toBeNull();
          return rest;
        }),
    ).toEqual(profilesBefore);
  });

  it('(d) quarantines a named lease whose binding has the same profile but another fingerprint', () => {
    profile('profile-a', 'fp-a', 4, 2);
    profile('profile-x', 'fp-x', 9, 9);
    lease('lease-d', 'run-d', 'profile-a', 'fp-a');
    // A legacy row that only exists with foreign keys off: profile matches, route does not.
    db.exec('PRAGMA foreign_keys = OFF');
    binding('run-d', 'profile-a', 'fp-x', 9, 9);
    db.exec('PRAGMA foreign_keys = ON');

    db.exec(sql);

    expect(leases()).toEqual([
      { lease_id: 'lease-d', auth_epoch: 0, route_revision: 0, lease_state: 'quarantined' },
    ]);
  });

  it('keeps the row count of every provider-account table', () => {
    profile('profile-a', 'fp-a', 4, 2);
    binding('run-b', 'profile-a', 'fp-a', 4, 2);
    lease('lease-a', 'run-a', null, 'fp-ambient');
    lease('lease-b', 'run-b', 'profile-a', 'fp-a');
    lease('lease-c', 'run-c', 'profile-a', 'fp-a');
    const counts = (): unknown =>
      db.prepare(`SELECT
        (SELECT COUNT(*) FROM provider_account_profiles) AS profiles,
        (SELECT COUNT(*) FROM provider_account_run_bindings) AS bindings,
        (SELECT COUNT(*) FROM provider_account_run_leases) AS leases,
        (SELECT COUNT(*) FROM provider_account_session_links) AS links`).all();
    const before = counts();
    expect(before).toEqual([{ profiles: 1, bindings: 1, leases: 3, links: 0 }]);
    db.exec(sql);
    expect(counts()).toEqual(before);
  });

  it('enforces the new CHECK constraints on later writes', () => {
    db.exec(sql);
    profile('profile-a', 'fp-a');
    const insert = (epoch: number, revision: number, state: string): unknown =>
      db.prepare(`INSERT INTO provider_account_run_leases
        (lease_id, run_id, provider, profile_id, route_fingerprint, owner_id, acquired_at,
         auth_epoch, route_revision, lease_state)
        VALUES ('lease-x', 'run-x', 'claude', 'profile-a', 'fp-a', 'owner-0001', 1, ?, ?, ?)`)
        .run(epoch, revision, state);
    expect(() => insert(-1, 0, 'live')).toThrow(/CHECK constraint failed/);
    expect(() => insert(0, -1, 'live')).toThrow(/CHECK constraint failed/);
    expect(() => insert(0, 0, 'released')).toThrow(/CHECK constraint failed/);
    insert(3, 1, 'quarantined');
    expect(leases()).toEqual([
      { lease_id: 'lease-x', auth_epoch: 3, route_revision: 1, lease_state: 'quarantined' },
    ]);
  });

  it('defaults a lease written without the new columns to 0/0 live', () => {
    db.exec(sql);
    lease('lease-a', 'run-a', null, 'fp-ambient');
    expect(leases()).toEqual([
      { lease_id: 'lease-a', auth_epoch: 0, route_revision: 0, lease_state: 'live' },
    ]);
  });
});
