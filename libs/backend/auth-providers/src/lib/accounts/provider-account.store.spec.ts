import 'reflect-metadata';
import type { ClaudeCertifiedLaunchContext } from '@ptah-extension/auth-providers-tokens';
import { ClaudeRouteCertifier, type ClaudeRouteCertification } from './claude-route-certifier';

import { existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS, type SqliteDatabase } from '@ptah-extension/persistence-sqlite';
import { PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY, PROVIDER_ACCOUNT_RESERVED_LABEL } from '@ptah-extension/shared';
import { ProviderAccountStore, type AccountRunAdmission, type AccountRunLease } from './provider-account.store';
import { ProviderAccountStoreError, resolveProviderAccountRoute } from './provider-account-route';
import { ProviderAccountService } from './provider-account.service';

// Real independent SQLite connections; no production/development DB path resolver.
const Database = require('better-sqlite3') as new (path: string) => SqliteDatabase;
const schema = [58, 59, 60].map(version => {
  const migration = MIGRATIONS.find(entry => entry.version === version);
  if (!migration?.sql) throw new Error('Provider account migration is missing');
  return migration.sql;
}).join('\n');

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
  const ownerKey = 'a'.repeat(64);
  const identityRef = 'identity-ref-0001';
  /** Adds a profile and records a signed-in status with an identity reference (admission precondition). */
  function add(id = profileId, name = 'account'): void {
    // Live names must differ (D40): the first account is "Work", others are named by their id.
    a.add(id, id === profileId ? 'Work' : id, join(root, name));
    first.prepare("UPDATE provider_account_profiles SET state = 'signed-in', identity_ref = ? WHERE profile_id = ?").run(identityRef, id);
  }
  function commit(store: ProviderAccountStore, lease: AccountRunLease, key = ownerKey) {
    const { reservation } = lease;
    return store.commitRunBinding({ reservationId: reservation.reservationId, operationId: reservation.operationId,
      authEpoch: reservation.authEpoch, runId: reservation.runId, identity: { kind: 'known', ownerKey: key } });
  }
  /** Lease then binding, as a certified run does. */
  function bind(store: ProviderAccountStore, admission: AccountRunAdmission, key = ownerKey) {
    return commit(store, store.acquireRunLease(admission), key);
  }
  const launch: ClaudeCertifiedLaunchContext = {
    executable: { command: 'claude-fixture', prefixArgs: [], sdkExecutablePath: 'claude-fixture', version: '2.1.310',
      fingerprint: { size: 1, mtimeMs: 1 } },
    env: {}, envDigest: 'digest-fixture', cwd: 'fixture', settingSources: ['user', 'project', 'local'],
    policy: { coverage: 'win32@2.1.310', managedFile: 'absent', managedDropIn: 'absent', registry: 'absent', remoteSignals: 'absent' },
    accountClass: 'personal', identityReference: 'identity-ref-0001',
  };
  /** Certifier fake: the real class's prototype with only `certify` replaced. */
  function certifier(result: ClaudeRouteCertification = { ok: true, launch }): ClaudeRouteCertifier & { certify: jest.Mock } {
    return Object.assign(Object.create(ClaudeRouteCertifier.prototype) as ClaudeRouteCertifier,
      { certify: jest.fn(async () => result) });
  }
  function accountService(store = a, certify = certifier()): ProviderAccountService {
    return new ProviderAccountService(store, { db: store === a ? first : second, dbPath: join(root, 'isolated.sqlite') }, certify);
  }
  function request(overrides: Partial<AccountRunAdmission> = {}): AccountRunAdmission {
    return { profileId, expectedRevision: 0, route: resolveProviderAccountRoute(join(root, 'account')),
      runId: 'run-00001', reservationId: 'lease-0001', operationId: 'owner-0001', ...overrides };
  }
  function count(table: 'profiles' | 'selections' | 'operations' | 'run_bindings' | 'run_leases' | 'session_links'): number {
    const queries = {
      profiles: 'SELECT * FROM provider_account_profiles',
      selections: 'SELECT * FROM provider_account_selections',
      operations: 'SELECT * FROM provider_account_operations',
      run_bindings: 'SELECT * FROM provider_account_run_bindings',
      run_leases: 'SELECT * FROM provider_account_run_leases',
      session_links: 'SELECT * FROM provider_account_session_links',
    };
    return first.prepare(queries[table]).all().length;
  }
  function refuses(action: () => unknown, code = 'conflict'): void {
    expect(action).toThrow(expect.objectContaining({ code }));
  }

  const attachment = { provider: 'claude', runId: 'run-00001', sdkSessionId: 'sdk-session-0001', attachedAt: 123 };

  it('attaches durably, resolves the full frozen binding, and preserves the first attachment on repeat', async () => {
    add();
    const committed = { binding: await bind(a, request()) };
    const service = accountService(a);
    await expect(service.attachSdkSession(attachment)).resolves.toEqual({ status: 'attached' });
    await expect(b.attachSdkSession({ ...attachment, attachedAt: 456 })).resolves.toEqual({ status: 'attached' });
    const lookup = { provider: attachment.provider, sdkSessionId: attachment.sdkSessionId };
    const result = await b.lookupBySdkSession(lookup);
    expect(result).toEqual({ status: 'bound', binding: committed.binding });
    await expect(service.lookupBySdkSession(lookup)).resolves.toEqual(result);
    if (result.status !== 'bound') throw new Error('Expected bound SDK session');
    expect(Object.isFrozen(result.binding)).toBe(true);
    expect(Object.isFrozen(result.binding.identity)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(root);
    expect(JSON.stringify(result)).not.toMatch(/canonicalPath|canonical_route|directory|requestedPath/);
    expect(first.prepare('SELECT attached_at FROM provider_account_session_links').get()).toEqual({ attached_at: 123 });
    expect(count('session_links')).toBe(1);
  });

  it('refuses another run for the same SDK session without changing the original link', async () => {
    add();
    await bind(a, request());
    await bind(a, request({ runId: 'run-00002', reservationId: 'lease-0002' }));
    await a.attachSdkSession(attachment);
    await expect(b.attachSdkSession({ ...attachment, runId: 'run-00002' }))
      .resolves.toEqual({ status: 'session-linked-elsewhere' });
    expect(first.prepare('SELECT run_id FROM provider_account_session_links').all()).toEqual([{ run_id: attachment.runId }]);
  });

  it('refuses another SDK session for the same run without changing the original link', async () => {
    add();
    await bind(a, request());
    await a.attachSdkSession(attachment);
    await expect(b.attachSdkSession({ ...attachment, sdkSessionId: 'sdk-session-0002' }))
      .resolves.toEqual({ status: 'run-linked-elsewhere' });
    expect(first.prepare('SELECT sdk_session_id FROM provider_account_session_links').all())
      .toEqual([{ sdk_session_id: attachment.sdkSessionId }]);
  });

  it('requires a binding with the same provider', async () => {
    await expect(a.attachSdkSession(attachment)).resolves.toEqual({ status: 'binding-absent' });
    add();
    await bind(a, request());
    await expect(a.attachSdkSession({ ...attachment, provider: 'codex' })).resolves.toEqual({ status: 'binding-absent' });
    expect(count('session_links')).toBe(0);
  });

  it.each(['', '/', '\\', '/private/account', 'C:\\private\\account', 'a'.repeat(257), ' ', 'sdk\u0000id'])(
    'refuses invalid SDK session id case %# without exposing its value', async sdkSessionId => {
      await expect(a.attachSdkSession({ ...attachment, sdkSessionId }))
        .rejects.toMatchObject({ code: 'conflict', message: 'The local account operation could not be completed.' });
      await expect(a.lookupBySdkSession({ provider: 'claude', sdkSessionId })).resolves.toEqual({ status: 'invalid-bound' });
      expect(count('session_links')).toBe(0);
    });

  it('accepts an SDK session id at the length bound', async () => {
    add();
    await bind(a, request());
    await expect(a.attachSdkSession({ ...attachment, sdkSessionId: 'a'.repeat(256) })).resolves.toEqual({ status: 'attached' });
  });

  it('returns absence only for an absent provider/session link', async () => {
    add();
    await bind(a, request());
    await expect(a.lookupBySdkSession({ provider: 'claude', sdkSessionId: attachment.sdkSessionId })).resolves.toEqual({ status: 'absent' });
    await a.attachSdkSession(attachment);
    await expect(a.lookupBySdkSession({ provider: 'codex', sdkSessionId: attachment.sdkSessionId })).resolves.toEqual({ status: 'absent' });
  });

  it('refuses an orphan session link rather than classifying it as ambient', async () => {
    first.pragma('foreign_keys = OFF');
    first.prepare('INSERT INTO provider_account_session_links (provider, sdk_session_id, run_id, attached_at) VALUES (?, ?, ?, ?)')
      .run(attachment.provider, attachment.sdkSessionId, attachment.runId, attachment.attachedAt);
    first.pragma('foreign_keys = ON');
    await expect(b.lookupBySdkSession({ provider: 'claude', sdkSessionId: attachment.sdkSessionId }))
      .resolves.toEqual({ status: 'invalid-bound' });
  });

  it('refuses malformed bound evidence and provider-mismatched persisted links', async () => {
    add();
    await bind(a, request());
    await a.attachSdkSession(attachment);
    first.prepare("UPDATE provider_account_session_links SET provider = 'codex'").run();
    await expect(b.lookupBySdkSession({ provider: 'codex', sdkSessionId: attachment.sdkSessionId }))
      .resolves.toEqual({ status: 'invalid-bound' });
    first.prepare("UPDATE provider_account_session_links SET provider = 'claude'").run();
    first.prepare("UPDATE provider_account_run_bindings SET identity_kind = 'known', owner_key_hash = ? WHERE run_id = ?")
      .run('/private/account', attachment.runId);
    await expect(b.lookupBySdkSession({ provider: 'claude', sdkSessionId: attachment.sdkSessionId }))
      .resolves.toEqual({ status: 'invalid-bound' });
    await expect(b.attachSdkSession(attachment)).rejects.toMatchObject({ code: 'invalid-bound' });
  });

  it('reports unavailable SDK lookup for inaccessible and closed databases', async () => {
    const unavailable = new ProviderAccountStore({ get db(): SqliteDatabase { throw { code: 'SQLITE_IOERR', message: '/private/account' }; } });
    const closed = new Database(join(root, 'closed.sqlite'));
    closed.close();
    for (const store of [unavailable, new ProviderAccountStore({ db: closed })]) {
      await expect(store.lookupBySdkSession({ provider: 'claude', sdkSessionId: attachment.sdkSessionId }))
        .resolves.toEqual({ status: 'unavailable-storage' });
      await expect(store.attachSdkSession(attachment)).rejects.toMatchObject({
        code: 'unavailable-storage', message: 'The local account operation could not be completed.',
      });
    }
  });

  it('rolls back SDK attachment on a native SQLite constraint error without exposing its message', async () => {
    add();
    await bind(a, request());
    first.exec("CREATE TRIGGER fail_attachment AFTER INSERT ON provider_account_session_links BEGIN SELECT RAISE(ABORT, '/private/account'); END");
    await expect(a.attachSdkSession(attachment)).rejects.toMatchObject({
      code: 'conflict', message: 'The local account operation could not be completed.',
    });
    expect(count('session_links')).toBe(0);
  });

  it('recognizes SQLite constraint codes on objects outside the Error hierarchy', async () => {
    const unavailable = new ProviderAccountStore({ get db(): SqliteDatabase {
      throw { code: 'SQLITE_CONSTRAINT_UNIQUE', message: '/private/account' };
    } });
    await expect(unavailable.attachSdkSession(attachment)).rejects.toMatchObject({
      code: 'conflict', message: 'The local account operation could not be completed.',
    });
  });

  it('awaits the registry transaction and reads immutable known evidence from another connection', async () => {
    add();
    const committed = { binding: await bind(a, request()) };
    expect(committed.binding.identity).toEqual({ kind: 'known', ownerKey });
    await expect(b.lookupRunBinding('run-00001')).resolves.toEqual({ status: 'bound', binding: committed.binding });
    expect(JSON.stringify(committed.binding)).not.toContain(root);
    expect(Object.isFrozen(committed.binding)).toBe(true);
    expect(Object.isFrozen(committed.binding?.identity)).toBe(true);
  });

  it('reports unavailable registry lookup instead of legacy absence', async () => {
    const unavailable = new ProviderAccountStore({ get db(): SqliteDatabase { throw { code: 'SQLITE_IOERR' }; } });
    await expect(unavailable.lookupRunBinding('run-00001')).resolves.toEqual({ status: 'unavailable-storage' });
    await expect(a.lookupRunBinding('run-absent')).resolves.toEqual({ status: 'absent' });
  });

  it('refuses extra identity fields before committing a path-bearing binding', async () => {
    add();
    const identity = { kind: 'unknown' as const, directory: '/private/account' };
    const { reservation } = a.acquireRunLease(request());
    await expect(a.commitRunBinding({ ...reservation, identity })).rejects.toMatchObject({ code: 'identity-unproved' });
    await expect(a.commitRunBinding({ ...reservation, identity: { kind: 'unknown' } })).rejects.toMatchObject({ code: 'identity-unproved' });
    expect(count('run_bindings')).toBe(0);
    expect(count('run_leases')).toBe(1);
  });

  it('keeps the lease and stores no binding when the binding write fails', async () => {
    add();
    first.exec("CREATE TRIGGER fail_binding BEFORE INSERT ON provider_account_run_bindings BEGIN SELECT RAISE(ABORT, 'fixture'); END");
    await expect(bind(a, request())).rejects.toMatchObject({ code: 'conflict' });
    expect(count('run_bindings')).toBe(0);
    expect(count('run_leases')).toBe(1);
  });

  it('refuses malformed stored evidence without downgrading to absence', async () => {
    add();
    await bind(a, request());
    first.prepare("UPDATE provider_account_run_bindings SET identity_kind = 'known', owner_key_hash = ? WHERE run_id = ?")
      .run('/private/account', 'run-00001');
    await expect(b.lookupRunBinding('run-00001')).resolves.toEqual({ status: 'invalid-bound' });
  });

  it('does not replace an existing registry binding', async () => {
    add();
    const lease = a.acquireRunLease(request());
    await commit(a, lease);
    await expect(commit(a, lease, 'b'.repeat(64))).rejects.toMatchObject({ code: 'conflict' });
    expect(a.binding('run-00001')?.identity).toEqual({ kind: 'known', ownerKey });
  });

  it('refuses ambient admission and every persistence surface after service disposal', async () => {
    const certify = certifier();
    const facade = accountService(a, certify);
    await expect(facade.admitClaudeRoute({ provider: 'claude', scope: 'main', operationId: 'owner-0001', runId: 'run-00001', selection: { kind: 'ambient' } }))
      .resolves.toMatchObject({ code: 'conflict' });
    add();
    const lease = a.acquireRunLease(request());
    facade.dispose();
    await expect(facade.lookupRunBinding('run-00001')).resolves.toEqual({ status: 'unavailable-storage' });
    await expect(facade.commitRunBinding({ ...lease.reservation, identity: { kind: 'known', ownerKey } }))
      .rejects.toMatchObject({ code: 'unavailable-storage' });
    await expect(facade.attachSdkSession(attachment)).rejects.toMatchObject({ code: 'unavailable-storage' });
    await expect(facade.lookupBySdkSession({ provider: 'claude', sdkSessionId: attachment.sdkSessionId }))
      .resolves.toEqual({ status: 'unavailable-storage' });
    await expect(facade.readStoredSelection(root, 'main')).rejects.toMatchObject({ code: 'unavailable-storage' });
    expect(certify.certify).not.toHaveBeenCalled();
    expect(count('run_bindings')).toBe(0);
    expect(count('session_links')).toBe(0);
  });

  it('status reservation keeps row unchanged and excludes auth across connections until completion', () => {
    add();
    const before = a.get(profileId);
    const held = a.reserveStatus(profileId, before.revision, request().route, 'status-0001', 'owner-0001');
    expect(b.get(profileId)).toEqual(before);
    refuses(() => b.reserveAuth(profileId, before.revision, request().route, 'auth-00001', 'owner-0002', 'sign-in'), 'busy');
    refuses(() => b.completeStatus('status-0001', 'owner-0002', held.authEpoch, 'signed-in', true));
    refuses(() => b.completeStatus('status-0001', 'owner-0001', held.authEpoch + 1, 'signed-in', true));
    a.completeStatus('status-0001', 'owner-0001', held.authEpoch, before.state, true);
    expect(b.get(profileId)).toEqual(before);
    expect(count('operations')).toBe(0);
    expect(b.reserveAuth(profileId, before.revision, request().route, 'auth-00001', 'owner-0002', 'sign-in').authEpoch)
      .toBe(before.auth_epoch + 1);
  });

  it('Add refuses a directory swapped for a link after mkdir and never stores the link target', () => {
    const directory = join(root, 'account');
    const target = join(root, 'external');
    mkdirSync(target);
    const native = realpathSync.native;
    const resolve = jest.spyOn(realpathSync, 'native').mockImplementationOnce(path => {
      renameSync(directory, join(root, 'owned'));
      symlinkSync(target, directory, process.platform === 'win32' ? 'junction' : 'dir');
      return native(path);
    });
    try {
      refuses(() => a.add(profileId, 'Work', directory), 'route-changed');
      expect(count('profiles')).toBe(0);
      expect(existsSync(target)).toBe(true);
      expect(existsSync(directory)).toBe(true);
      expect(existsSync(join(root, 'owned'))).toBe(true);
    } finally { resolve.mockRestore(); }
  });

  it('Add rechecks ownership inside the insertion transaction before storing a route', () => {
    const directory = join(root, 'account');
    const target = join(root, 'external');
    mkdirSync(target);
    const guarded = new ProviderAccountStore({ get db() {
      renameSync(directory, join(root, 'owned'));
      symlinkSync(target, directory, process.platform === 'win32' ? 'junction' : 'dir');
      return first;
    } });
    refuses(() => guarded.add(profileId, 'Work', directory), 'route-changed');
    expect(count('profiles')).toBe(0);
    expect(existsSync(directory)).toBe(true);
    expect(existsSync(target)).toBe(true);
    expect(existsSync(join(root, 'owned'))).toBe(true);
  });

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

  it('two connections racing admission for the same run have one lease and no binding', () => {
    add();
    a.acquireRunLease(request());
    refuses(() => b.acquireRunLease(request({ reservationId: 'lease-0002' })));
    expect(count('run_bindings')).toBe(0);
    expect(count('run_leases')).toBe(1);
  });

  it('allows distinct runs on one route but excludes auth until all leases release', () => {
    add();
    a.acquireRunLease(request());
    b.acquireRunLease(request({ runId: 'run-00002', reservationId: 'lease-0002' }));
    refuses(() => a.reserveAuth(profileId, 0, request().route, 'auth-00001', 'owner-0001', 'sign-in'), 'busy');
    for (const reservationId of ['lease-0001', 'lease-0002']) {
      b.release({ reservationId, operationId: 'owner-0001', authEpoch: 0, reason: 'child-closed' });
    }
    a.reserveAuth(profileId, 0, request().route, 'auth-00001', 'owner-0001', 'sign-in');
    expect(count('run_bindings')).toBe(0);
  });

  it('two connections racing auth have one winner and auth excludes admission', () => {
    add();
    a.reserveAuth(profileId, 0, request().route, 'auth-00001', 'owner-0001', 'sign-in');
    refuses(() => b.reserveAuth(profileId, 0, request().route, 'auth-00002', 'owner-0002', 'sign-out'));
    refuses(() => b.acquireRunLease(request({ expectedRevision: 1 })), 'busy');
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
    refuses(() => a.acquireRunLease(request({ selection: { workspaceRoot: root, scope: 'main', revision: 0 } })));
    expect(count('run_leases')).toBe(0);
  });

  it('removal clears future selections but retains snapshots, leases and tombstones', async () => {
    add();
    a.select(root, 'main', profileId, -1, 0);
    a.select(root, 'lane', profileId, -1, 0);
    await bind(a, request());
    const snapshot = a.binding('run-00001');
    b.remove(profileId, 0);
    expect(a.selection(root, 'main')).toEqual({ profileId: null, revision: 1 });
    expect(a.selection(root, 'lane')).toEqual({ profileId: null, revision: 1 });
    refuses(() => a.acquireRunLease(request({ expectedRevision: 1, runId: 'run-00002' })), 'missing-profile');
    refuses(() => a.acquireRunLease(request({ profileId: null, runId: 'run-00002' })));
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
    refuses(() => b.acquireRunLease(request({ profileId: null })));
    const directory = join(root, 'ambient');
    mkdirSync(directory);
    b.acquireRunLease(request({ profileId: null, route: resolveProviderAccountRoute(directory) }));
    refuses(() => a.add('profile-0002', 'Other', directory));
    expect(count('profiles')).toBe(1);
    expect(count('run_leases')).toBe(1);
  });

  it('refuses route replacement even with the same profile and revision', () => {
    add();
    const previous = request();
    renameSync(join(root, 'account'), join(root, 'original'));
    mkdirSync(join(root, 'account'));
    refuses(() => b.acquireRunLease(previous), 'route-changed');
    refuses(() => b.acquireRunLease(request()), 'route-changed');
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

  it('failed lease insertion keeps the first lease and failed remove restores selections', () => {
    add();
    a.acquireRunLease(request());
    refuses(() => b.acquireRunLease(request({ runId: 'run-00002' })));
    expect(count('run_leases')).toBe(1);
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
    expect(b.get('profile-0002')).toMatchObject({ revision: 0, auth_epoch: 0, state: 'signed-in' });
    expect(count('operations')).toBe(1);
  });

  it('never steals old reservations and a stuck route does not block unrelated routes', () => {
    add();
    a.reserveAuth(profileId, 0, request().route, 'auth-00001', 'owner-0001', 'sign-in');
    first.prepare('UPDATE provider_account_operations SET created_at = 0').run();
    refuses(() => b.reserveAuth(profileId, 1, request().route, 'auth-00002', 'owner-0002', 'sign-in'), 'busy');
    add('profile-0002', 'other');
    b.acquireRunLease(request({ profileId: 'profile-0002', route: resolveProviderAccountRoute(join(root, 'other')) }));
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

  it('disposal retains an uncertain lease and refuses caller-driven release after disposal', async () => {
    add();
    const { reservation } = a.acquireRunLease(request());
    const facade = accountService(a);
    expect(await facade.releaseReservation({ ...reservation, operationId: 'owner-0002', reason: 'disposal' }))
      .toMatchObject({ code: 'conflict' });
    facade.dispose();
    facade.dispose();
    expect(await facade.releaseReservation({ ...reservation, reason: 'disposal' })).toMatchObject({ code: 'unavailable-storage' });
    expect(count('run_leases')).toBe(1);
    expect(count('run_bindings')).toBe(0);
    refuses(() => b.reserveAuth(profileId, 0, request().route, 'auth-00001', 'owner-0001', 'sign-in'), 'busy');
  });

  it('executes the metadata facade surfaces against an injected isolated connection', () => {
    const service = accountService(a);
    const profile = service.add('Work');
    expect(service.list()).toEqual([profile]);
    expect(service.selection(root, 'main')).toEqual({ profileId: null, revision: -1 });
    expect(service.select(root, 'main', profile.profileId, -1, profile.revision)).toEqual({ profileId: profile.profileId, revision: 0 });
    expect(service.setDefault(root, profile.profileId, { main: 0, lane: -1 }, profile.revision)).toEqual({
      main: { profileId: profile.profileId, revision: 1 }, lane: { profileId: profile.profileId, revision: 0 },
    });
    const renamed = service.rename(profile.profileId, profile.revision, 'Personal');
    expect(renamed.label).toBe('Personal');
    service.remove(profile.profileId, renamed.revision);
    expect(service.list()).toEqual([]);
    service.dispose();
  });

  it('makes Add idempotent by request ID across a restart: same request returns the stored account', () => {
    const before = accountService(a);
    const added = before.add('Work', 'request-0001');
    before.dispose();
    // A new service on a new connection stands in for a host restart.
    const after = accountService(b);
    expect(after.add('Work', 'request-0001')).toEqual(added);
    expect(after.list()).toEqual([added]);
    expect(count('profiles')).toBe(1);
  });

  it('creates a new account for a different request ID and refuses a reused one with another label', () => {
    const service = accountService(a);
    const one = service.add('Work', 'request-0001');
    const two = service.add('Home', 'request-0002');
    expect(two.profileId).not.toBe(one.profileId);
    refuses(() => service.add('Personal', 'request-0001'), 'conflict');
    expect(count('profiles')).toBe(2);
  });

  describe('unique account names (D40)', () => {
    function refusesDuplicate(action: () => unknown): void {
      expect(action).toThrow(expect.objectContaining({ code: 'conflict', message: PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY }));
    }

    it('refuses Add of a live name in another case or with surrounding space, and leaves no row or directory', () => {
      a.add(profileId, 'Work', join(root, 'account'));
      refusesDuplicate(() => a.add('profile-0002', 'WORK', join(root, 'upper')));
      // A padded name never reaches the uniqueness check: the label validator refuses it first.
      refuses(() => a.add('profile-0002', ' work', join(root, 'spaced')));
      expect(count('profiles')).toBe(1);
      expect(existsSync(join(root, 'upper'))).toBe(false);
      expect(existsSync(join(root, 'spaced'))).toBe(false);
    });

    it('refuses Add of the reserved ambient name in any case', () => {
      refusesDuplicate(() => a.add(profileId, PROVIDER_ACCOUNT_RESERVED_LABEL, join(root, 'reserved')));
      refusesDuplicate(() => a.add(profileId, 'existing claude LOGIN', join(root, 'reserved')));
      expect(count('profiles')).toBe(0);
    });

    it('refuses Rename to another live account name or the reserved name, keeping the old name', () => {
      a.add(profileId, 'Work', join(root, 'account'));
      const other = a.add('profile-0002', 'Personal', join(root, 'other'));
      refusesDuplicate(() => a.rename(other.profile_id, other.revision, 'work'));
      refusesDuplicate(() => a.rename(other.profile_id, other.revision, PROVIDER_ACCOUNT_RESERVED_LABEL));
      expect(a.get(other.profile_id)).toMatchObject({ label: 'Personal', revision: other.revision });
    });

    it('allows Rename of an account to its own name in another case', () => {
      const own = a.add(profileId, 'Work', join(root, 'account'));
      expect(a.rename(profileId, own.revision, 'WORK').label).toBe('WORK');
    });

    it('lets a removed account name be used again', () => {
      const removed = a.add(profileId, 'Work', join(root, 'account'));
      a.remove(profileId, removed.revision);
      expect(a.add('profile-0002', 'work', join(root, 'again')).label).toBe('work');
    });

    it('returns the stored account when the same Add request is replayed', () => {
      const service = accountService(a);
      const added = service.add('Work', 'request-0001');
      expect(service.add('Work', 'request-0001')).toEqual(added);
      expect(() => service.add('work', 'request-0002')).toThrow(
        expect.objectContaining({ code: 'conflict' }));
      expect(count('profiles')).toBe(1);
      service.dispose();
    });
  });

  it('does not recreate a removed account when its Add request is replayed', () => {
    const service = accountService(a);
    const added = service.add('Work', 'request-0001');
    service.remove(added.profileId, added.revision);
    refuses(() => service.add('Work', 'request-0001'), 'conflict');
    expect(service.list()).toEqual([]);
    expect(count('profiles')).toBe(1);
  });

  /** A lease row as migration 0060 leaves it, plus its binding when `bound`. */
  function legacyLease(lease: string, run: string, profile: string | null, epoch: number, state: 'live' | 'quarantined', bound: boolean): void {
    const route = profile === null ? 'f'.repeat(64) : a.get(profile).route_fingerprint;
    if (bound && profile !== null) {
      first.prepare(`INSERT INTO provider_account_run_bindings (run_id, provider, profile_id, route_revision, route_fingerprint,
        auth_epoch, identity_kind, owner_key_hash, created_at) VALUES (?, 'claude', ?, 0, ?, ?, 'known', ?, 1)`)
        .run(run, profile, route, epoch, ownerKey);
    }
    first.prepare(`INSERT INTO provider_account_run_leases (lease_id, run_id, provider, profile_id, route_fingerprint, owner_id,
      acquired_at, auth_epoch, route_revision, lease_state) VALUES (?, ?, 'claude', ?, ?, 'owner-0001', 1, ?, 0, ?)`)
      .run(lease, run, profile, route, epoch, state);
  }

  it('settles a post-migration bound lease only at its own epoch', () => {
    add();
    first.prepare('UPDATE provider_account_profiles SET auth_epoch = 4 WHERE profile_id = ?').run(profileId);
    legacyLease('lease-0004', 'run-00004', profileId, 4, 'live', true);
    refuses(() => a.release({ reservationId: 'lease-0004', operationId: 'owner-0001', authEpoch: 0, reason: 'child-closed' }));
    expect(a.retain({ reservationId: 'lease-0004', operationId: 'owner-0001', authEpoch: 4 }))
      .toMatchObject({ phase: 'retained', routeKind: 'named', runId: 'run-00004', authEpoch: 4 });
    expect(count('run_leases')).toBe(1);
    expect(a.release({ reservationId: 'lease-0004', operationId: 'owner-0001', authEpoch: 4, reason: 'child-closed' }))
      .toMatchObject({ phase: 'released', authEpoch: 4 });
    expect(count('run_leases')).toBe(0);
  });

  it.each([
    ['named without binding', true],
    ['ambient with binding', false],
  ] as const)('a quarantined %s lease is never settled and blocks auth on its route', (_case, named) => {
    add();
    legacyLease('lease-0009', 'run-00009', named ? profileId : null, 0, 'quarantined', !named);
    const keys = { reservationId: 'lease-0009', operationId: 'owner-0001', authEpoch: 0 };
    refuses(() => a.release({ ...keys, reason: 'child-closed' }));
    refuses(() => a.retain(keys));
    expect(count('run_leases')).toBe(1);
    if (named) refuses(() => a.reserveAuth(profileId, 0, request().route, 'auth-00001', 'owner-0002', 'sign-in'), 'busy');
  });

  it('releases a pre-binding lease at a nonzero epoch (the old COALESCE read 0 here)', () => {
    add();
    let revision = a.get(profileId).revision;
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      const held = a.reserveAuth(profileId, revision, request().route, `auth-0000${cycle}`, 'owner-0002', 'sign-in');
      a.completeAuth(`auth-0000${cycle}`, 'owner-0002', held.authEpoch, 'signed-in', identityRef);
      revision = a.get(profileId).revision;
    }
    expect(a.get(profileId)).toMatchObject({ auth_epoch: 3, identity_ref: identityRef, state: 'signed-in' });
    const { reservation, binding } = a.acquireRunLease(request({ expectedRevision: revision }));
    expect(binding).toBeNull();
    expect(reservation).toMatchObject({ phase: 'reserved', authEpoch: 3, routeKind: 'named' });
    a.release({ ...reservation, reason: 'startup-failure' });
    expect(count('run_leases')).toBe(0);
  });

  it('refuses a named lease until a signed-in status recorded an identity', () => {
    a.add(profileId, 'Work', join(root, 'account'));
    refuses(() => a.acquireRunLease(request()), 'identity-unproved');
    first.prepare("UPDATE provider_account_profiles SET state = 'signed-in' WHERE profile_id = ?").run(profileId);
    refuses(() => a.acquireRunLease(request()), 'identity-unproved');
    expect(count('run_leases')).toBe(0);
    refuses(() => a.completeAuth('auth-00001', 'owner-0001', 1, 'signed-in', 'bad ref'));
  });

  it('resumes a bound run without a second binding and refuses a second lease for a live run', async () => {
    add();
    const held = a.acquireRunLease(request());
    const binding = await commit(a, held);
    refuses(() => b.acquireRunLease(request({ reservationId: 'lease-0002' })));
    a.release({ ...held.reservation, reason: 'child-closed' });
    const resumed = b.acquireRunLease(request({ reservationId: 'lease-0002' }));
    expect(resumed.binding).toEqual(binding);
    await expect(commit(b, resumed)).rejects.toMatchObject({ code: 'conflict' });
    expect(count('run_bindings')).toBe(1);
    expect(count('run_leases')).toBe(1);
  });

  it('three routes hold run leases at once and settle independently', () => {
    const leases = (['account', 'second', 'third'] as const).map((name, index) => {
      const id = `profile-000${index + 1}`;
      add(id, name);
      return a.acquireRunLease(request({ profileId: id, route: resolveProviderAccountRoute(join(root, name)),
        runId: `run-0000${index + 1}`, reservationId: `lease-000${index + 1}` }));
    });
    expect(count('run_leases')).toBe(3);
    b.release({ ...leases[2].reservation, reason: 'child-closed' });
    expect(a.retain(leases[0].reservation).phase).toBe('retained');
    expect(count('run_leases')).toBe(2);
  });

  describe('admission', () => {
    const named = { provider: 'claude' as const, scope: 'main' as const, selection: { kind: 'named' as const, profileId },
      operationId: 'owner-0001', runId: 'run-00001' };

    it('certifies a leased named route and returns its launch', async () => {
      add();
      const certify = certifier();
      const outcome = await accountService(a, certify).admitClaudeRoute({ ...named, workingDirectory: root });
      if (outcome.code !== 'ok') throw new Error(`Expected admission, got ${outcome.code}`);
      expect(outcome.reservation).toMatchObject({ phase: 'reserved', routeKind: 'named', runId: 'run-00001', authEpoch: 0 });
      expect(outcome.resources).toMatchObject({ kind: 'named', launch, route: { kind: 'named', profileId, runId: 'run-00001' } });
      expect(certify.certify).toHaveBeenCalledWith(expect.objectContaining({
        cwd: root, settingSources: ['user', 'project', 'local'], profile: { identityRef } }));
      expect(count('run_leases')).toBe(1);
      expect(count('run_bindings')).toBe(0);
    });

    it.each([
      [true, 0],
      [false, 1],
    ] as const)('a certification refusal with proved child close=%s leaves %d leases', async (terminated, leases) => {
      add();
      const outcome = await accountService(a, certifier({ ok: false, code: 'unsupported-source', terminated }))
        .admitClaudeRoute(named);
      expect(outcome).toMatchObject({ code: 'unsupported-source' });
      expect(count('run_leases')).toBe(leases);
    });

    it('refuses default and malformed requests, and a busy route, before certification', async () => {
      add();
      const certify = certifier();
      const facade = accountService(a, certify);
      for (const request of [{ ...named, selection: { kind: 'omitted' as const } }, { ...named, workingDirectory: 'relative' }]) {
        expect(await facade.admitClaudeRoute(request)).toMatchObject({ code: 'conflict' });
      }
      a.reserveStatus(profileId, 0, resolveProviderAccountRoute(join(root, 'account')), 'status-0001', 'owner-0002');
      expect(await facade.admitClaudeRoute(named)).toMatchObject({ code: 'busy' });
      expect(certify.certify).not.toHaveBeenCalled();
    });

    it('logs each admission refusal with its code and a fixed stage word only', async () => {
      add();
      const logger = { warn: jest.fn() };
      const refusing = new ProviderAccountService(a, { db: first, dbPath: join(root, 'isolated.sqlite') },
        certifier({ ok: false, code: 'unsupported-source', terminated: true }), logger);
      // A project settings override in another workspace refuses at certification, before any child.
      expect(await refusing.admitClaudeRoute({ ...named, workingDirectory: join(root, 'other-workspace') }))
        .toMatchObject({ code: 'unsupported-source' });
      expect(await refusing.admitClaudeRoute({ ...named, selection: { kind: 'omitted' } }))
        .toMatchObject({ code: 'conflict' });
      expect(await refusing.admitClaudeRoute({ ...named, selection: { kind: 'named', profileId: 'absent-profile-0001' } }))
        .toMatchObject({ code: 'missing-profile' });
      expect(logger.warn.mock.calls).toEqual([
        ['[ProviderAccountService] Claude route admission refused', { stage: 'certify', code: 'unsupported-source' }],
        ['[ProviderAccountService] Claude route admission refused', { stage: 'request', code: 'conflict' }],
        ['[ProviderAccountService] Claude route admission refused', { stage: 'store', code: 'missing-profile' }],
      ]);
      // Fixed text only: no path, profile ID or run ID reaches the log.
      expect(JSON.stringify(logger.warn.mock.calls)).not.toMatch(new RegExp(`${profileId}|run-00001|other-workspace`));
    });

    it('reads the stored selection for the selection reader', async () => {
      add();
      a.select(root, 'lane', profileId, -1, 0);
      const facade = accountService(a);
      await expect(facade.readStoredSelection(root, 'lane')).resolves.toEqual({ profileId });
      await expect(facade.readStoredSelection(root, 'main')).resolves.toEqual({ profileId: null });
    });
  });
});
