import 'reflect-metadata';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS, type SqliteDatabase } from '@ptah-extension/persistence-sqlite';
import { ProviderAccountStore, type AccountRunAdmission } from './provider-account.store';
import { ProviderAccountStoreError, resolveProviderAccountRoute } from './provider-account-route';

// Real independent SQLite connections; no production/development DB path resolver.
const Database = require('better-sqlite3') as new (path: string) => SqliteDatabase;
const migration = MIGRATIONS.find(entry => entry.version === 58);
if (!migration?.sql) throw new Error('Provider account migration is missing');
const schema = migration.sql;

describe('ProviderAccountStore transactions', () => {
  let root: string;
  let first: SqliteDatabase;
  let second: SqliteDatabase;
  let a: ProviderAccountStore;
  let b: ProviderAccountStore;
  const profileId = 'profile-0001';
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ptah-account-store-'));
    first = new Database(join(root, 'isolated.sqlite'));
    first.pragma('journal_mode = WAL');
    first.exec(schema);
    second = new Database(join(root, 'isolated.sqlite'));
    for (const db of [first, second]) {
      db.pragma('foreign_keys = ON');
      db.pragma('busy_timeout = 0');
    }
    a = new ProviderAccountStore({ db: first });
    b = new ProviderAccountStore({ db: second });
  });
  afterEach(() => {
    if (first.inTransaction) first.exec('ROLLBACK');
    if (second.inTransaction) second.exec('ROLLBACK');
    first.close(); second.close();
    rmSync(root, { recursive: true, force: true });
  });
  function add(id = profileId, name = 'account'): void { a.add(id, 'Work', join(root, name)); }
  function request(overrides: Partial<AccountRunAdmission> = {}): AccountRunAdmission {
    return { profileId, expectedRevision: 0, route: resolveProviderAccountRoute(join(root, 'account')),
      runId: 'run-00001', reservationId: 'lease-0001', operationId: 'owner-0001', ...overrides };
  }
  function count(table: 'profiles' | 'selections' | 'operations' | 'run_bindings' | 'run_leases'): number {
    const queries = {
      profiles: 'SELECT * FROM provider_account_profiles',
      selections: 'SELECT * FROM provider_account_selections',
      operations: 'SELECT * FROM provider_account_operations',
      run_bindings: 'SELECT * FROM provider_account_run_bindings',
      run_leases: 'SELECT * FROM provider_account_run_leases',
    };
    return first.prepare(queries[table]).all().length;
  }
  function refuses(action: () => unknown, code = 'conflict'): void {
    expect(action).toThrow(expect.objectContaining({ code }));
  }

  it('two connections racing Add have one winner and preserve its directory', () => {
    add();
    refuses(() => b.add(profileId, 'Other', join(root, 'loser')));
    expect(existsSync(join(root, 'loser'))).toBe(false);
    refuses(() => b.add('profile-0002', 'Other', join(root, 'account')));
    expect(existsSync(join(root, 'account'))).toBe(true);
    expect(count('profiles')).toBe(1);
  });

  it('two connections racing rename and remove compare revisions', () => {
    add();
    const old = b.get(profileId);
    a.rename(profileId, old.revision, 'Personal');
    refuses(() => b.rename(profileId, old.revision, 'Stale'));
    refuses(() => b.remove(profileId, old.revision));
    a.remove(profileId, 1);
    refuses(() => b.remove(profileId, 1));
    expect(count('profiles')).toBe(1);
    expect(a.list()).toEqual([]);
  });

  it('two connections racing select have one CAS winner with independent scopes', () => {
    add();
    expect(b.selection(root, 'main').revision).toBe(-1);
    a.select(root, 'main', profileId, -1, 0);
    refuses(() => b.select(root, 'main', null, -1));
    expect(b.selection(root, 'main').profileId).toBe(profileId);
    b.select(root, 'lane', null, -1);
    expect(a.selection(root, 'lane').profileId).toBeNull();
  });

  it('two connections racing admission for the same run have one binding and lease', () => {
    add();
    a.admit(request());
    refuses(() => b.admit(request({ reservationId: 'lease-0002' })));
    expect(count('run_bindings')).toBe(1);
    expect(count('run_leases')).toBe(1);
  });

  it('allows distinct runs on one route but excludes auth until all leases release', () => {
    add();
    a.admit(request());
    b.admit(request({ runId: 'run-00002', reservationId: 'lease-0002' }));
    refuses(() => a.reserveAuth(profileId, 0, request().route, 'auth-00001', 'owner-0001', 'sign-in'), 'busy');
    for (const reservationId of ['lease-0001', 'lease-0002']) {
      b.release({ reservationId, operationId: 'owner-0001', authEpoch: 0, reason: 'child-closed' });
    }
    a.reserveAuth(profileId, 0, request().route, 'auth-00001', 'owner-0001', 'sign-in');
    expect(count('run_bindings')).toBe(2);
  });

  it('two connections racing auth have one winner and auth excludes admission', () => {
    add();
    a.reserveAuth(profileId, 0, request().route, 'auth-00001', 'owner-0001', 'sign-in');
    refuses(() => b.reserveAuth(profileId, 0, request().route, 'auth-00002', 'owner-0002', 'sign-out'));
    refuses(() => b.admit(request({ expectedRevision: 1 })), 'busy');
    refuses(() => b.remove(profileId, 1), 'busy');
    refuses(() => b.select(root, 'main', profileId, -1, 1), 'busy');
    expect(count('operations')).toBe(1);
    expect(count('run_leases')).toBe(0);
    expect(count('selections')).toBe(0);
  });

  it('auth completion compares operation, owner, epoch and revision before releasing', () => {
    add();
    a.reserveAuth(profileId, 0, request().route, 'auth-00001', 'owner-0001', 'sign-in');
    refuses(() => b.completeAuth('auth-00001', 'owner-0002', 1, 'signed-in'));
    refuses(() => b.completeAuth('auth-00001', 'owner-0001', 0, 'signed-in'));
    b.completeAuth('auth-00001', 'owner-0001', 1, 'signed-in');
    refuses(() => a.completeAuth('auth-00001', 'owner-0001', 1, 'signed-in'));
    expect(a.get(profileId)).toMatchObject({ state: 'signed-in', revision: 2, auth_epoch: 1 });
    expect(count('operations')).toBe(0);
  });

  it('selection changes before admission refuse the stale selected snapshot', () => {
    add();
    a.select(root, 'main', profileId, -1, 0);
    b.select(root, 'main', null, 0);
    refuses(() => a.admit(request({ selection: { workspaceRoot: root, scope: 'main', revision: 0 } })));
    expect(count('run_leases')).toBe(0);
  });

  it('removal clears future selections but retains snapshots, leases and tombstones', () => {
    add();
    a.select(root, 'main', profileId, -1, 0);
    a.select(root, 'lane', profileId, -1, 0);
    a.admit(request());
    const snapshot = a.binding('run-00001');
    b.remove(profileId, 0);
    expect(a.selection(root, 'main')).toEqual({ profileId: null, revision: 1 });
    expect(a.selection(root, 'lane')).toEqual({ profileId: null, revision: 1 });
    refuses(() => a.admit(request({ expectedRevision: 1, runId: 'run-00002' })), 'missing-profile');
    refuses(() => a.admit(request({ profileId: null, runId: 'run-00002' })));
    expect(count('run_bindings')).toBe(1);
    expect(b.binding('run-00001')).toEqual(snapshot);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(count('run_leases')).toBe(1);
    expect(existsSync(join(root, 'account'))).toBe(true);
    a.release({ reservationId: 'lease-0001', operationId: 'owner-0001', authEpoch: 0, reason: 'child-closed' });
    expect(count('profiles')).toBe(1);
  });

  it('refuses ambient collision in both directions without adopting external directories', () => {
    add();
    refuses(() => b.admit(request({ profileId: null })));
    const directory = join(root, 'ambient');
    mkdirSync(directory);
    b.admit(request({ profileId: null, route: resolveProviderAccountRoute(directory) }));
    refuses(() => a.add('profile-0002', 'Other', directory));
    expect(count('profiles')).toBe(1);
    expect(count('run_leases')).toBe(1);
  });

  it('refuses route replacement even with the same profile and revision', () => {
    add();
    const previous = request();
    renameSync(join(root, 'account'), join(root, 'original'));
    mkdirSync(join(root, 'account'));
    refuses(() => b.admit(previous), 'route-changed');
    refuses(() => b.admit(request()), 'route-changed');
    expect(count('run_bindings')).toBe(0);
  });

  it('a busy writer refuses safely and failed Add cleans its newly owned empty directory', () => {
    first.exec('BEGIN IMMEDIATE');
    refuses(() => b.add(profileId, 'Work', join(root, 'new')), 'busy');
    expect(second.inTransaction).toBe(false);
    expect(existsSync(join(root, 'new'))).toBe(false);
    first.exec('ROLLBACK');
    expect(count('profiles')).toBe(0);
  });

  it('failed lease insertion rolls back its binding and failed remove restores selections', () => {
    add();
    a.admit(request());
    refuses(() => b.admit(request({ runId: 'run-00002' })));
    expect(count('run_bindings')).toBe(1);
    a.select(root, 'main', profileId, -1, 0);
    first.exec(`CREATE TRIGGER reject_selection BEFORE UPDATE ON provider_account_selections
      BEGIN SELECT RAISE(ABORT, 'fixture'); END`);
    refuses(() => b.remove(profileId, 0));
    expect(a.get(profileId).revision).toBe(0);
    expect(a.selection(root, 'main').profileId).toBe(profileId);
  });

  it('a failed commit rolls back all profile changes and removes only its empty directory', () => {
    const exec = first.exec.bind(first);
    const fault = jest.spyOn(first, 'exec').mockImplementation(sql => {
      if (sql === 'COMMIT') throw new Error('injected commit failure');
      return exec(sql);
    });
    refuses(() => a.add(profileId, 'Work', join(root, 'new')), 'unavailable-storage');
    fault.mockRestore();
    expect(first.inTransaction).toBe(false);
    expect(count('profiles')).toBe(0);
    expect(existsSync(join(root, 'new'))).toBe(false);
  });

  it('failed auth reservation restores revision and epoch on the losing route', () => {
    add();
    a.reserveAuth(profileId, 0, request().route, 'auth-00001', 'owner-0001', 'sign-in');
    add('profile-0002', 'other');
    refuses(() => b.reserveAuth('profile-0002', 0, resolveProviderAccountRoute(join(root, 'other')),
      'auth-00001', 'owner-0002', 'sign-in'));
    expect(b.get('profile-0002')).toMatchObject({ revision: 0, auth_epoch: 0, state: 'not-signed-in' });
    expect(count('operations')).toBe(1);
  });

  it('never steals old reservations and a stuck route does not block unrelated routes', () => {
    add();
    a.reserveAuth(profileId, 0, request().route, 'auth-00001', 'owner-0001', 'sign-in');
    first.prepare('UPDATE provider_account_operations SET created_at = 0').run();
    refuses(() => b.reserveAuth(profileId, 1, request().route, 'auth-00002', 'owner-0002', 'sign-in'), 'busy');
    add('profile-0002', 'other');
    b.admit(request({ profileId: 'profile-0002', route: resolveProviderAccountRoute(join(root, 'other')) }));
    first.prepare('UPDATE provider_account_run_leases SET acquired_at = 0').run();
    a.retain({ reservationId: 'lease-0001', operationId: 'owner-0001', authEpoch: 0 });
    refuses(() => a.release({ reservationId: 'lease-0001', operationId: 'owner-0002', authEpoch: 0, reason: 'timeout' }));
    expect(count('operations')).toBe(1);
    expect(count('run_leases')).toBe(1);
  });

  it('rejects invalid labels and IDs without storing caller data', () => {
    expect(() => a.add('../unsafe', 'Work', join(root, 'bad'))).toThrow(ProviderAccountStoreError);
    expect(count('profiles')).toBe(0);
    expect(existsSync(join(root, 'bad'))).toBe(false);
  });
});
