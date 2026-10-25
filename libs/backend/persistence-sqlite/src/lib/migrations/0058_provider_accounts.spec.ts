import 'reflect-metadata';
import { sql } from './0058_provider_accounts';
import { sql as previousHeadSql } from './0057_drop_skill_pipeline';
import { MIGRATIONS } from './index';
import * as skillPipelineArchive from '../skill-pipeline-archive';
import { SqliteMigrationRunner } from '../migration-runner';
import { FakeSqliteDatabase } from '../testing/fake-sqlite-database';
import { createMockLogger } from '../testing/mock-logger';

interface DatabaseShape {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: (string | number | null)[]): unknown;
    all(...params: (string | number | null)[]): unknown[];
  };
  close(): void;
}

const tables = [
  'provider_account_profiles',
  'provider_account_selections',
  'provider_account_operations',
  'provider_account_run_bindings',
  'provider_account_run_leases',
];
const indexes = [
  'idx_provider_account_profiles_provider_removed',
  'idx_provider_account_selections_profile',
  'idx_provider_account_operations_profile',
  'idx_provider_account_run_bindings_profile',
  'idx_provider_account_run_leases_route',
  'idx_provider_account_run_leases_profile',
];
const migration58 = MIGRATIONS.find((entry) => entry.version === 58);
if (migration58 === undefined) throw new Error('Migration 0058 is not registered');

describe('migration 0058_provider_accounts', () => {
  let db: DatabaseShape;

  beforeEach(() => {
    // Match 0057's real SQLite seam: do not use the fake to prove constraints.
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => DatabaseShape;
    };
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
  });

  afterEach(() => db.close());

  function profile(id = 'profile-0001', route = '/account/one', fingerprint = 'a'.repeat(64)): void {
    db.prepare(`INSERT INTO provider_account_profiles
      (profile_id, provider, label, canonical_route, route_fingerprint, created_at, updated_at)
      VALUES (?, 'claude', 'Work', ?, ?, 1, 1)`)
      .run(id, route, fingerprint);
  }

  function binding(runId = 'run-0001', profileId = 'profile-0001', provider = 'claude', fingerprint = 'a'.repeat(64)): void {
    db.prepare(`INSERT INTO provider_account_run_bindings
      (run_id, provider, profile_id, route_revision, route_fingerprint,
       auth_epoch, identity_kind, created_at)
      VALUES (?, ?, ?, 0, ?, 0, 'unknown', 1)`)
      .run(runId, provider, profileId, fingerprint);
  }

  it('explicitly registers 0058 immediately after 0057', () => {
    expect(migration58).toEqual({ version: 58, name: '0058_provider_accounts', sql });
    const previousIndex = MIGRATIONS.findIndex((entry) => entry.version === 57);
    expect(MIGRATIONS[previousIndex + 1]).toBe(migration58);
  });

  it('creates every table and index on a fresh database without importing data', () => {
    db.exec(sql);
    for (const name of [...tables, ...indexes]) {
      expect(db.prepare('SELECT name FROM sqlite_schema WHERE name = ?').all(name))
        .toEqual([{ name }]);
    }
    for (const table of tables) {
      expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
    }
  });

  it('reapplies static DDL without changing account data', () => {
    db.exec(sql);
    profile();
    const before = db.prepare('SELECT * FROM provider_account_profiles').all();
    db.exec(sql);
    expect(db.prepare('SELECT * FROM provider_account_profiles').all()).toEqual(before);
  });

  it('upgrades a real SQLite database after 0057 without changing unrelated data', () => {
    db.exec('CREATE TABLE job_runs (job_id TEXT); CREATE TABLE scheduled_jobs (id TEXT);');
    for (const table of [
      'skill_invocations', 'skill_candidates', 'skill_suggestions',
      'skill_synthesis_queue', 'skill_synthesis_budget', 'skill_synthesis_workspace_cursor',
    ]) {
      db.exec(`CREATE TABLE ${table} (id TEXT)`);
    }
    db.prepare('INSERT INTO scheduled_jobs (id) VALUES (?)').run('unrelated-job');
    db.exec(previousHeadSql);
    db.exec('PRAGMA user_version = 57');
    db.exec(sql);
    for (const name of tables) {
      expect(db.prepare('SELECT name FROM sqlite_schema WHERE name = ?').all(name)).toEqual([{ name }]);
    }
    expect(db.prepare('SELECT id FROM scheduled_jobs').all()).toEqual([{ id: 'unrelated-job' }]);
  });

  it.each([0, 57])('applies from head %i and skips a repeated runner invocation', async (head) => {
    const fake = new FakeSqliteDatabase();
    if (head !== 0) {
      fake.insertMigrationRow(head, 0);
      fake.exec('PRAGMA user_version = 57');
    }
    // The runner invokes the earlier archive gate for every version >= 57.
    // Its filesystem/archive behavior is covered by 0057, not this migration.
    const archive = jest.spyOn(skillPipelineArchive, 'archiveSkillPipeline')
      .mockReturnValue({ archivePath: 'verified' } as ReturnType<typeof skillPipelineArchive.archiveSkillPipeline>);
    try {
      const runner = new SqliteMigrationRunner(fake, createMockLogger());
      const first = await runner.applyAll([migration58], { vecExtensionLoaded: false });
      expect(first.appliedVersions).toEqual([58]);
      expect(fake.getUserVersion()).toBe(58);
      expect(runner.readAppliedVersions()).toEqual(new Set(head === 0 ? [58] : [57, 58]));
      const repeated = await runner.applyAll([migration58], { vecExtensionLoaded: false });
      expect(repeated.appliedVersions).toEqual([]);
      expect(repeated.skippedVersions).toEqual([58]);
    } finally {
      archive.mockRestore();
    }
  });

  it('rejects duplicate profile IDs, physical routes and fingerprints including tombstones', () => {
    db.exec(sql);
    profile();
    expect(() => profile('profile-0001', '/account/two', 'b'.repeat(64))).toThrow();
    expect(() => profile('profile-0002', '/account/one', 'b'.repeat(64))).toThrow();
    expect(() => profile('profile-0002', '/account/two', 'a'.repeat(64))).toThrow();
    db.exec('UPDATE provider_account_profiles SET removed_at = 2');
    expect(() => profile('profile-0002', '/account/one', 'b'.repeat(64))).toThrow();
  });

  it('enforces per-scope selection keys and same-provider profile references', () => {
    db.exec(sql);
    profile();
    const insert = db.prepare(`INSERT INTO provider_account_selections
      (workspace_root, provider, scope, profile_id, updated_at) VALUES ('workspace', ?, ?, ?, 1)`);
    insert.run('claude', 'main', 'profile-0001');
    insert.run('claude', 'lane', 'profile-0001');
    expect(() => insert.run('claude', 'main', 'profile-0001')).toThrow();
    expect(() => insert.run('codex', 'main', 'profile-0001')).toThrow();
    db.exec('DELETE FROM provider_account_selections');
    expect(() => insert.run('claude', 'main', 'missing-profile')).toThrow();
    // Ambient selection retains a CAS revision without a named profile.
    insert.run('claude', 'main', null);
  });

  it('enforces operation replay keys and exclusive route reservations', () => {
    db.exec(sql);
    profile();
    const insert = db.prepare(`INSERT INTO provider_account_operations
      (operation_id, route_fingerprint, profile_id, provider, kind,
       auth_epoch, expected_revision, owner_id, created_at)
      VALUES (?, ?, ?, 'claude', 'sign-in', 0, 0, 'owner-0001', 1)`);
    insert.run('operation-0001', 'a'.repeat(64), 'profile-0001');
    expect(() => insert.run('operation-0002', 'a'.repeat(64), 'profile-0001')).toThrow();
    expect(() => insert.run('operation-0001', 'b'.repeat(64), null)).toThrow();
    expect(() => insert.run('operation-0002', 'b'.repeat(64), 'profile-0001')).toThrow();
    // Ambient routes also participate in exclusion without adopting a profile.
    insert.run('operation-0002', 'b'.repeat(64), null);
  });

  it('retains bound snapshots through removal and rejects invalid binding references', () => {
    db.exec(sql);
    profile();
    binding();
    expect(() => binding()).toThrow();
    expect(() => binding('run-0002', 'missing-profile')).toThrow();
    expect(() => binding('run-0002', 'profile-0001', 'codex')).toThrow();
    expect(() => binding('run-0002', 'profile-0001', 'claude', 'b'.repeat(64))).toThrow();
    const before = db.prepare('SELECT * FROM provider_account_run_bindings').all();
    db.exec('UPDATE provider_account_profiles SET removed_at = 2, revision = 1, auth_epoch = 1');
    expect(db.prepare('SELECT * FROM provider_account_run_bindings').all()).toEqual(before);
    expect(() => db.exec('DELETE FROM provider_account_profiles')).toThrow();
  });

  it('enforces lease replay keys and references while allowing concurrent runs on a route', () => {
    db.exec(sql);
    profile();
    const insert = db.prepare(`INSERT INTO provider_account_run_leases
      (lease_id, run_id, provider, profile_id, route_fingerprint, owner_id, acquired_at)
      VALUES (?, ?, 'claude', ?, ?, 'owner-0001', 1)`);
    insert.run('lease-0001', 'run-0001', 'profile-0001', 'a'.repeat(64));
    insert.run('lease-0002', 'run-0002', 'profile-0001', 'a'.repeat(64));
    expect(() => insert.run('lease-0001', 'run-0003', 'profile-0001', 'a'.repeat(64))).toThrow();
    expect(() => insert.run('lease-0003', 'run-0001', 'profile-0001', 'a'.repeat(64))).toThrow();
    expect(() => insert.run('lease-0003', 'run-0003', 'missing-profile', 'a'.repeat(64))).toThrow();
    insert.run('lease-0003', 'run-0003', null, 'b'.repeat(64));
  });

  it('rejects null idempotency keys and negative profile revisions or epochs', () => {
    db.exec(sql);
    profile();
    for (const column of ['profile_id', 'revision', 'route_revision', 'auth_epoch']) {
      expect(() => db.exec(`UPDATE provider_account_profiles SET ${column} = NULL`)).toThrow();
    }
    for (const column of ['revision', 'route_revision', 'auth_epoch']) {
      expect(() => db.exec(`UPDATE provider_account_profiles SET ${column} = -1`)).toThrow();
    }
  });

  it('rolls back all migration DDL when a later statement fails', () => {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      expect(() => db.exec('INSERT INTO missing_table VALUES (1)')).toThrow();
    } finally {
      db.exec('ROLLBACK');
    }
    for (const name of [...tables, ...indexes]) {
      expect(db.prepare('SELECT name FROM sqlite_schema WHERE name = ?').all(name)).toEqual([]);
    }
  });

  it('rolls back profile and selection writes together after a constraint failure', () => {
    db.exec(sql);
    db.exec('BEGIN IMMEDIATE');
    try {
      profile();
      db.exec(`INSERT INTO provider_account_selections
        (workspace_root, provider, scope, profile_id, updated_at)
        VALUES ('workspace', 'claude', 'main', 'profile-0001', 1)`);
      expect(() => profile()).toThrow();
    } finally {
      db.exec('ROLLBACK');
    }
    expect(db.prepare('SELECT * FROM provider_account_profiles').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM provider_account_selections').all()).toEqual([]);
  });
});
