import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { SpawnedProcessHandle } from '@ptah-extension/platform-core';
import { ClaudeAccountCommand } from './claude-account-command';
import { ProviderAccountActionsService } from './provider-account-actions.service';

import { existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS, type SqliteDatabase } from '@ptah-extension/persistence-sqlite';
import { ProviderAccountStore, type AccountRunAdmission } from './provider-account.store';
import { ProviderAccountStoreError, resolveProviderAccountRoute } from './provider-account-route';
import { ProviderAccountService } from './provider-account.service';

class DisposalChild extends EventEmitter implements SpawnedProcessHandle {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  // Spawn never settles: `null` would mean "never started" (proved termination).
  readonly whenSpawned = new Promise<number | null>(() => undefined);
  readonly pid = undefined;
  readonly killed = false;
  readonly exitCode = null;
  kill(): boolean { return true; }
}

// Real independent SQLite connections; no production/development DB path resolver.
const Database = require('better-sqlite3') as new (path: string) => SqliteDatabase;
const schema = [58, 59].map(version => {
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
  function add(id = profileId, name = 'account'): void { a.add(id, 'Work', join(root, name)); }
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
    const committed = await a.commitRunBinding(request({ identity: { kind: 'known', ownerKey: 'a'.repeat(64) } }));
    const service = new ProviderAccountService(a, { db: first, dbPath: join(root, 'isolated.sqlite') });
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
    await a.commitRunBinding(request());
    await a.commitRunBinding(request({ runId: 'run-00002', reservationId: 'lease-0002' }));
    await a.attachSdkSession(attachment);
    await expect(b.attachSdkSession({ ...attachment, runId: 'run-00002' }))
      .resolves.toEqual({ status: 'session-linked-elsewhere' });
    expect(first.prepare('SELECT run_id FROM provider_account_session_links').all()).toEqual([{ run_id: attachment.runId }]);
  });

  it('refuses another SDK session for the same run without changing the original link', async () => {
    add();
    await a.commitRunBinding(request());
    await a.attachSdkSession(attachment);
    await expect(b.attachSdkSession({ ...attachment, sdkSessionId: 'sdk-session-0002' }))
      .resolves.toEqual({ status: 'run-linked-elsewhere' });
    expect(first.prepare('SELECT sdk_session_id FROM provider_account_session_links').all())
      .toEqual([{ sdk_session_id: attachment.sdkSessionId }]);
  });

  it('requires a binding with the same provider', async () => {
    await expect(a.attachSdkSession(attachment)).resolves.toEqual({ status: 'binding-absent' });
    add();
    await a.commitRunBinding(request());
    await expect(a.attachSdkSession({ ...attachment, provider: 'codex' })).resolves.toEqual({ status: 'binding-absent' });
    expect(count('session_links')).toBe(0);
  });

  it.each(['', '/', '\\', '/private/account', 'C:\\private\\account', 'a'.repeat(257), ' ', 'sdk\u0000id'])
    ('refuses invalid SDK session id case %# without exposing its value', async sdkSessionId => {
      await expect(a.attachSdkSession({ ...attachment, sdkSessionId }))
        .rejects.toMatchObject({ code: 'conflict', message: 'The local account operation could not be completed.' });
      await expect(a.lookupBySdkSession({ provider: 'claude', sdkSessionId })).resolves.toEqual({ status: 'invalid-bound' });
      expect(count('session_links')).toBe(0);
    });

  it('accepts an SDK session id at the length bound', async () => {
    add();
    await a.commitRunBinding(request());
    await expect(a.attachSdkSession({ ...attachment, sdkSessionId: 'a'.repeat(256) })).resolves.toEqual({ status: 'attached' });
  });

  it('returns absence only for an absent provider/session link', async () => {
    add();
    await a.commitRunBinding(request());
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
    await a.commitRunBinding(request());
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
    await a.commitRunBinding(request());
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

  it('awaits the registry transaction and reads immutable unknown evidence from another connection', async () => {
    add();
    const committed = await a.commitRunBinding(request());
    expect(committed.binding?.identity).toEqual({ kind: 'unknown' });
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
    await expect(a.commitRunBinding(request({ identity }))).rejects.toMatchObject({ code: 'identity-unproved' });
    expect(count('run_bindings')).toBe(0);
    expect(count('run_leases')).toBe(0);
  });

  it('rolls back a registry binding when the lease write fails', async () => {
    add();
    first.exec("CREATE TRIGGER fail_lease BEFORE INSERT ON provider_account_run_leases BEGIN SELECT RAISE(ABORT, 'fixture'); END");
    await expect(a.commitRunBinding(request())).rejects.toMatchObject({ code: 'conflict' });
    expect(count('run_bindings')).toBe(0);
    expect(count('run_leases')).toBe(0);
  });

  it('refuses malformed stored evidence without downgrading to absence', async () => {
    add();
    await a.commitRunBinding(request());
    first.prepare("UPDATE provider_account_run_bindings SET identity_kind = 'known', owner_key_hash = ? WHERE run_id = ?")
      .run('/private/account', 'run-00001');
    await expect(b.lookupRunBinding('run-00001')).resolves.toEqual({ status: 'invalid-bound' });
  });

  it('does not replace an existing registry binding', async () => {
    add();
    await a.commitRunBinding(request());
    await expect(a.commitRunBinding(request({ identity: { kind: 'known', ownerKey: 'a'.repeat(64) } })))
      .rejects.toMatchObject({ code: 'conflict' });
    expect(a.binding('run-00001')?.identity).toEqual({ kind: 'unknown' });
  });

  it('keeps admission held and refuses persistence after service disposal', async () => {
    const service = new ProviderAccountService(a, { db: first, dbPath: join(root, 'isolated.sqlite') });
    await expect(service.admitClaudeRoute({ provider: 'claude', scope: 'main', operationId: 'owner-0001', runId: 'run-00001', selection: { kind: 'ambient' } }))
      .resolves.toMatchObject({ code: 'release-held' });
    add();
    service.dispose();
    await expect(service.lookupRunBinding('run-00001')).resolves.toEqual({ status: 'unavailable-storage' });
    await expect(service.commitRunBinding(request())).rejects.toMatchObject({ code: 'unavailable-storage' });
    await expect(service.attachSdkSession(attachment)).rejects.toMatchObject({ code: 'unavailable-storage' });
    await expect(service.lookupBySdkSession({ provider: 'claude', sdkSessionId: attachment.sdkSessionId }))
      .resolves.toEqual({ status: 'unavailable-storage' });
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

  it.each(['status', 'login', 'logout'] as const)(
    'disposal awaits bounded %s process termination, retains an unproved lease and refuses every new action',
    async kind => {
      jest.useFakeTimers();
      const child = new DisposalChild();
      const spawnProcess = jest.fn(() => child);
      const commands = new ClaudeAccountCommand({ findExecutable: jest.fn().mockResolvedValue({
        path: 'mock-claude', source: 'path', version: 'fixture',
      }) }, { spawnProcess });
      jest.spyOn(commands, 'authorization').mockReturnValue('ok');
      jest.spyOn(commands, 'environment').mockImplementation(route => ({ CLAUDE_CONFIG_DIR: route.canonicalPath }));
      const actions = new ProviderAccountActionsService(a, commands);
      try {
        add();
        const target = { provider: 'claude' as const, profileId };
        const command = { ...target, operationId: 'operation-disposal', expectedRevision: 0 };
        const running = kind === 'status' ? actions.readStatus(target)
          : kind === 'login' ? actions.startSignIn(command) : actions.signOut(command);
        await jest.advanceTimersByTimeAsync(0);
        expect(spawnProcess).toHaveBeenCalledTimes(1);
        let settled = false;
        const disposal = actions.dispose();
        expect(actions.dispose()).toBe(disposal);
        void disposal.then(() => { settled = true; });
        await jest.advanceTimersByTimeAsync(1_999);
        expect(settled).toBe(false);
        await jest.advanceTimersByTimeAsync(1);
        await disposal;
        await expect(running).resolves.toMatchObject({ code: 'cancelled' });
        expect(a.get(profileId).state).toBe(kind === 'status' ? 'not-signed-in' : 'pending');
        expect(count('operations')).toBe(1);
        refuses(() => b.reserveAuth(profileId, a.get(profileId).revision, request().route,
          'operation-other', 'owner-other', 'sign-in'), 'busy');
        for (const result of await Promise.all([
          actions.readStatus(target), actions.startSignIn(command),
          actions.signOut(command), actions.cancelSignIn(command),
        ])) expect(result.code).toBe('unavailable-storage');
        expect(spawnProcess).toHaveBeenCalledTimes(1);
        expect(child.listenerCount('close')).toBe(0);
        expect(child.stdout.listenerCount('data')).toBe(0);
        expect(jest.getTimerCount()).toBe(0);
      } finally {
        jest.restoreAllMocks();
        jest.useRealTimers();
      }
    },
  );

  it('disposal aborts a cancellation status recheck and retains its unproved operation', async () => {
    jest.useFakeTimers();
    const children: DisposalChild[] = [];
    const commands = new ClaudeAccountCommand({ findExecutable: jest.fn().mockResolvedValue({
      path: 'mock-claude', source: 'path', version: 'fixture',
    }) }, { spawnProcess: () => {
      const child = new DisposalChild(); children.push(child); return child;
    } });
    jest.spyOn(commands, 'authorization').mockReturnValue('ok');
    jest.spyOn(commands, 'environment').mockImplementation(route => ({ CLAUDE_CONFIG_DIR: route.canonicalPath }));
    const actions = new ProviderAccountActionsService(a, commands);
    try {
      add();
      const command = { provider: 'claude' as const, profileId, operationId: 'operation-disposal', expectedRevision: 0 };
      const running = actions.startSignIn(command);
      await jest.advanceTimersByTimeAsync(0);
      const cancellation = actions.cancelSignIn({ ...command, expectedRevision: 1 });
      children[0].emit('close', 0, null);
      await jest.advanceTimersByTimeAsync(0);
      expect(children).toHaveLength(2);
      const disposal = actions.dispose();
      await jest.advanceTimersByTimeAsync(2_000);
      await disposal;
      await expect(running).resolves.toMatchObject({ code: 'cancelled' });
      await expect(cancellation).resolves.toMatchObject({ code: 'cancelled' });
      expect(a.get(profileId).state).toBe('pending');
      expect(count('operations')).toBe(1);
      expect(children[1].listenerCount('close')).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.restoreAllMocks();
      jest.useRealTimers();
    }
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

  it('disposal retains an uncertain lease and refuses caller-driven release of a prior host reservation', async () => {
    add();
    const { reservation } = a.admit(request());
    const service = new ProviderAccountService(a, { db: first, dbPath: join(root, 'isolated.sqlite') });
    service.dispose();
    service.dispose();
    expect(await service.releaseReservation({ ...reservation, reason: 'disposal' })).toMatchObject({ code: 'conflict' });
    expect(count('run_leases')).toBe(1);
    expect(count('run_bindings')).toBe(1);
    refuses(() => b.reserveAuth(profileId, 0, request().route, 'auth-00001', 'owner-0001', 'sign-in'), 'busy');
  });

  it('executes the metadata facade surfaces against an injected isolated connection', () => {
    const service = new ProviderAccountService(a, { db: first, dbPath: join(root, 'isolated.sqlite') });
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
    const before = new ProviderAccountService(a, { db: first, dbPath: join(root, 'isolated.sqlite') });
    const added = before.add('Work', 'request-0001');
    before.dispose();
    // A new service on a new connection stands in for a host restart.
    const after = new ProviderAccountService(b, { db: second, dbPath: join(root, 'isolated.sqlite') });
    expect(after.add('Work', 'request-0001')).toEqual(added);
    expect(after.list()).toEqual([added]);
    expect(count('profiles')).toBe(1);
  });

  it('creates a new account for a different request ID and refuses a reused one with another label', () => {
    const service = new ProviderAccountService(a, { db: first, dbPath: join(root, 'isolated.sqlite') });
    const one = service.add('Work', 'request-0001');
    const two = service.add('Work', 'request-0002');
    expect(two.profileId).not.toBe(one.profileId);
    refuses(() => service.add('Personal', 'request-0001'), 'conflict');
    expect(count('profiles')).toBe(2);
  });

  it('does not recreate a removed account when its Add request is replayed', () => {
    const service = new ProviderAccountService(a, { db: first, dbPath: join(root, 'isolated.sqlite') });
    const added = service.add('Work', 'request-0001');
    service.remove(added.profileId, added.revision);
    refuses(() => service.add('Work', 'request-0001'), 'conflict');
    expect(service.list()).toEqual([]);
    expect(count('profiles')).toBe(1);
  });

  it('keeps live admission release-held without discovering or spawning a provider command', async () => {
    add();
    const service = new ProviderAccountService(a, { db: first, dbPath: join(root, 'isolated.sqlite') });
    expect(await service.admitClaudeRoute({ provider: 'claude', scope: 'main',
      selection: { kind: 'named', profileId }, operationId: 'owner-0001', runId: 'run-00001' })).toMatchObject({ code: 'release-held' });
    expect(count('run_leases')).toBe(0);
  });
});
