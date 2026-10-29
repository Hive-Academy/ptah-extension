import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS, type SqliteDatabase } from '@ptah-extension/persistence-sqlite';
import { killProcessTree, type SpawnedProcessHandle } from '@ptah-extension/platform-core';
import { isSafeProviderAccountSummary, PROVIDER_ACCOUNT_RESULT_CODES } from '@ptah-extension/shared';
import { ProviderAccountStore } from './provider-account.store';
import { ProviderAccountService } from './provider-account.service';
import { ProviderAccountActionsService } from './provider-account-actions.service';
import { accountActionResult, ClaudeAccountCommand, type ClaudeChildCloseReceipt } from './claude-account-command';
import type { ClaudeAccountStatus } from './claude-account-status';
import { ClaudeLoginConsole } from './claude-login-console';
import { ClaudeRouteCertifier, type ClaudeAuthContext, type ClaudeStatusProbeResult } from './claude-route-certifier';
import { ProviderAccountStoreError, resolveProviderAccountRoute } from './provider-account-route';

// The console tree kill must never reach a real process from a spec.
jest.mock('@ptah-extension/platform-core', () => ({
  ...jest.requireActual<typeof import('@ptah-extension/platform-core')>('@ptah-extension/platform-core'),
  killProcessTree: jest.fn().mockResolvedValue(undefined),
}));

const Database = require('better-sqlite3') as new (path: string) => SqliteDatabase;
const schema = [58, 59, 60, 61, 62].map(version => {
  const migration = MIGRATIONS.find(entry => entry.version === version);
  if (!migration?.sql) throw new Error('Provider account migration is missing');
  return migration.sql;
}).join('\n');

/** A console window: no stdio, only `close`. */
class ConsoleChild extends EventEmitter implements SpawnedProcessHandle {
  readonly stdin = null;
  readonly stdout = null;
  readonly stderr = null;
  readonly pid = 4321;
  readonly killed = false;
  readonly exitCode = null;
  constructor(readonly whenSpawned: Promise<number | null> = Promise.resolve(4321)) { super(); }
  kill(): boolean { return true; }
}

const signedIn = (accountClass: 'P' | 'O' = 'P'): ClaudeStatusProbeResult => ({
  status: { loggedIn: true, accountClass, identityReference: 'identity-ref-0001', configDirectoryMatches: true },
  terminated: true,
});
const signedOut: ClaudeStatusProbeResult = { status: { loggedIn: false } as ClaudeAccountStatus, terminated: true };
const unproved: ClaudeStatusProbeResult = { status: null, terminated: false };
const refusal = { ok: false as const, code: 'unsupported-source' as const, terminated: true };

/** A probe child that outlived its limit and kill grace; `close()` is its late close. */
class FakeReceipt implements ClaudeChildCloseReceipt {
  closed = false;
  disposed = false;
  readonly listeners = new Set<() => void>();
  onClosed(listener: () => void): () => void {
    if (this.closed) { listener(); return () => undefined; }
    if (!this.disposed) this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  dispose(): void { this.disposed = true; this.listeners.clear(); }
  close(): void {
    if (this.closed || this.disposed) return;
    this.closed = true;
    const listeners = [...this.listeners];
    this.listeners.clear();
    for (const listener of listeners) listener();
  }
}
const unprovedWith = (closeReceipt: FakeReceipt): ClaudeStatusProbeResult & { closeReceipt: FakeReceipt } =>
  ({ status: null, terminated: false, closeReceipt });

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('ProviderAccountActionsService', () => {
  let root: string;
  let db: SqliteDatabase;
  let store: ProviderAccountStore;
  let service: ProviderAccountService;
  let actions: ProviderAccountActionsService;
  let id: string;
  let context: ClaudeAuthContext;
  let commands: { status: jest.Mock; logout: jest.Mock };
  let certifier: { authContext: jest.Mock; checkCoverage: jest.Mock };
  let loginConsole: { launch: jest.Mock; fallbackScript: jest.Mock };
  let completeAuth: jest.SpyInstance;

  const target = () => ({ provider: 'claude' as const, profileId: id });
  const command = (operationId = 'operation-0001') => ({ ...target(), operationId, expectedRevision: store.get(id).revision });
  const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const advance = async (ms: number): Promise<void> => { await jest.advanceTimersByTimeAsync(ms); await flush(); };
  const operations = () => db.prepare('SELECT * FROM provider_account_operations').all();
  const build = (logger: { warn: jest.Mock } | null = null): ProviderAccountActionsService => new ProviderAccountActionsService(store,
    Object.assign(Object.create(ClaudeAccountCommand.prototype) as ClaudeAccountCommand, commands),
    Object.assign(Object.create(ClaudeRouteCertifier.prototype) as ClaudeRouteCertifier, certifier),
    Object.assign(Object.create(ClaudeLoginConsole.prototype) as ClaudeLoginConsole, loginConsole), logger);
  const signIn = (accountState: 'signed-in' | 'signed-out'): void => {
    db.prepare('UPDATE provider_account_profiles SET state = ?, identity_ref = ? WHERE profile_id = ?')
      .run(accountState, accountState === 'signed-in' ? 'identity-ref-0001' : null, id);
  };

  beforeEach(() => {
    jest.useFakeTimers();
    root = mkdtempSync(join(tmpdir(), 'ptah-account-actions-'));
    const dbPath = join(root, 'isolated.sqlite');
    db = new Database(dbPath);
    db.exec(schema);
    store = new ProviderAccountStore({ db });
    const certifyOnly = Object.assign(Object.create(ClaudeRouteCertifier.prototype) as ClaudeRouteCertifier,
      { certify: jest.fn() });
    service = new ProviderAccountService(store, { db, dbPath }, certifyOnly);
    id = service.add('Work').profileId;
    const dir = store.get(id).canonical_route;
    context = Object.freeze({
      canonicalDir: dir, cwd: dir, env: { CLAUDE_CONFIG_DIR: dir }, envDigest: 'digest',
      executable: { command: 'claude', prefixArgs: [], sdkExecutablePath: 'claude', version: '2.1.310',
        fingerprint: { size: 1, mtimeMs: 1 } },
      policy: { coverage: 'win32@2.1.310' } as ClaudeAuthContext['policy'],
    });
    commands = { status: jest.fn().mockResolvedValue(signedOut), logout: jest.fn().mockResolvedValue({ exitCode: 0, terminated: true }) };
    certifier = { authContext: jest.fn().mockResolvedValue({ ok: true, context }), checkCoverage: jest.fn().mockResolvedValue({ ok: true }) };
    loginConsole = {
      launch: jest.fn().mockResolvedValue({ kind: 'unavailable' }),
      fallbackScript: jest.fn().mockReturnValue({ dialect: 'powershell', script: 'Set-Location fixture' }),
    };
    actions = build();
    completeAuth = jest.spyOn(store, 'completeAuth');
  });
  afterEach(async () => {
    await actions.dispose();
    jest.restoreAllMocks(); jest.clearAllMocks(); jest.useRealTimers();
    db.close(); rmSync(root, { recursive: true, force: true });
  });

  describe('coverage refusal starts no settings-reading child', () => {
    beforeEach(() => { certifier.checkCoverage.mockResolvedValue(refusal); });

    it('for sign-in, readStatus and sign-out', async () => {
      expect((await actions.startSignIn(command())).code).toBe('unsupported-source');
      expect(store.get(id).state).toBe('failed');
      expect((await actions.readStatus(target())).code).toBe('unsupported-source');
      expect((await actions.signOut(command('operation-0002'))).code).toBe('unsupported-source');
      expect(commands.status).not.toHaveBeenCalled();
      expect(commands.logout).not.toHaveBeenCalled();
      expect(loginConsole.launch).not.toHaveBeenCalled();
      expect(operations()).toEqual([]);
    });

    it('between two polls, stopping the polling', async () => {
      certifier.checkCoverage.mockReset()
        .mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: true })
        .mockResolvedValue(refusal);
      expect((await actions.startSignIn(command())).code).toBe('ok');
      await advance(2_000);
      expect(commands.status).toHaveBeenCalledTimes(1);
      await advance(2_000);
      expect(store.get(id).state).toBe('failed');
      await advance(20_000);
      expect(commands.status).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('fallback mode', () => {
    it('returns the generated script for the auth context and completes when every child closed', async () => {
      const started = await actions.startSignIn(command());
      expect(started).toEqual({ ...accountActionResult('ok'), fallback: { platform: 'win32', script: 'Set-Location fixture' } });
      expect(loginConsole.fallbackScript).toHaveBeenCalledWith(context);
      expect(store.get(id).state).toBe('pending');
      commands.status.mockResolvedValue(signedIn());
      await advance(2_000);
      expect(completeAuth).toHaveBeenCalledWith('operation-0001', expect.any(String), 1, 'signed-in', 'identity-ref-0001');
      expect(store.get(id).state).toBe('signed-in');
      expect(store.identityRef(id)).toBe('identity-ref-0001');
      expect(operations()).toEqual([]);
    });

    it('completes a class O account as signed-in (its named runs refuse later)', async () => {
      await actions.startSignIn(command());
      commands.status.mockResolvedValue(signedIn('O'));
      await advance(2_000);
      expect(store.get(id).state).toBe('signed-in');
    });

    it.each(['cancel', 'deadline'] as const)('completes on %s when every child closed', async how => {
      await actions.startSignIn(command());
      await advance(2_000);
      if (how === 'cancel') {
        expect((await actions.cancelSignIn(command())).code).toBe('cancelled');
        expect(store.get(id).state).toBe('cancelled');
      } else {
        await advance(300_000);
        expect(store.get(id).state).toBe('failed');
      }
      expect(completeAuth).toHaveBeenCalledTimes(1);
      expect(operations()).toEqual([]);
    });

    it('an unproved status child, then a success status: no completeAuth, pending, busy', async () => {
      commands.status.mockResolvedValueOnce(unproved).mockResolvedValue(signedIn());
      await actions.startSignIn(command());
      await advance(2_000);
      await advance(2_000);
      expect(commands.status).toHaveBeenCalledTimes(2);
      expect(completeAuth).not.toHaveBeenCalled();
      expect(store.get(id).state).toBe('pending');
      expect((await actions.readStatus(target())).code).toBe('busy');
      expect((await build().startSignIn(command('operation-0002'))).code).toBe('busy');
      expect(operations()).toHaveLength(1);
    });

    it.each(['cancel', 'deadline', 'disposal'] as const)('an unproved child, then %s: no completeAuth', async how => {
      commands.status.mockResolvedValue(unproved);
      await actions.startSignIn(command());
      await advance(2_000);
      if (how === 'cancel') expect((await actions.cancelSignIn(command())).code).toBe('busy');
      else if (how === 'deadline') await advance(300_000);
      else await actions.dispose();
      expect(completeAuth).not.toHaveBeenCalled();
      expect(store.get(id).state).toBe('pending');
      expect(operations()).toHaveLength(1);
    });

    it('stops polling after three unproved children', async () => {
      commands.status.mockResolvedValue(unproved);
      await actions.startSignIn(command());
      await advance(30_000);
      expect(commands.status).toHaveBeenCalledTimes(3);
    });
  });

  describe('console mode', () => {
    it('an unclosed console blocks completion and a late close then allows it', async () => {
      const child = new ConsoleChild();
      loginConsole.launch.mockResolvedValue({ kind: 'started', child });
      const started = await actions.startSignIn(command());
      // No accessor exposes the console handle.
      expect(Object.keys(started).sort()).toEqual(['code', 'summary']);
      commands.status.mockResolvedValue(signedIn());
      await advance(2_000);
      expect(killProcessTree).toHaveBeenCalledWith(4321, 'SIGKILL');
      await advance(2_000);
      expect(completeAuth).not.toHaveBeenCalled();
      expect(store.get(id).state).toBe('pending');
      child.emit('close', 0, null);
      expect(store.get(id).state).toBe('signed-in');
      expect(child.listenerCount('close')).toBe(0);
      expect(child.listenerCount('error')).toBe(0);
    });

    it('records the spawned console pid on the operation row', async () => {
      const child = new ConsoleChild();
      loginConsole.launch.mockResolvedValue({ kind: 'started', child });
      await actions.startSignIn(command());
      await flush();
      expect(db.prepare('SELECT kind, child_pid FROM provider_account_operations').all())
        .toEqual([{ kind: 'sign-in', child_pid: 4321 }]);
      // The console ends, so disposal does not wait for it.
      child.emit('close', 0, null);
    });

    it('records no pid for a console that never spawned', async () => {
      loginConsole.launch.mockResolvedValue({ kind: 'started', child: new ConsoleChild(Promise.resolve(null)) });
      await actions.startSignIn(command());
      await flush();
      expect(db.prepare('SELECT 1 FROM provider_account_operations WHERE child_pid IS NOT NULL').all()).toEqual([]);
    });

    it('a failed console pid write stops the console and restores the profile before start returns', async () => {
      signIn('signed-in');
      const logger = { warn: jest.fn() };
      await actions.dispose();
      actions = build(logger);
      const before = store.get(id);
      const child = new ConsoleChild();
      loginConsole.launch.mockResolvedValue({ kind: 'started', child });
      jest.spyOn(store, 'recordOperationChild').mockImplementation(() => { throw new ProviderAccountStoreError('busy'); });
      (killProcessTree as jest.Mock).mockImplementationOnce(async () => { child.emit('close', 1, null); });
      expect((await actions.startSignIn(command())).code).toBe('unavailable-storage');
      expect(killProcessTree).toHaveBeenCalledWith(4321, 'SIGKILL');
      expect(operations()).toEqual([]);
      expect(store.get(id)).toMatchObject({ state: 'signed-in', identity_ref: 'identity-ref-0001', revision: before.revision + 2 });
      expect(logger.warn.mock.calls).toEqual([
        ['[ProviderAccountActions] Could not record the sign-in console pid; ending the sign-in', { code: 'busy' }],
      ]);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('a pid write failing after start returned ends the sign-in and notifies', async () => {
      const logger = { warn: jest.fn() };
      await actions.dispose();
      actions = build(logger);
      const before = store.get(id);
      let spawn: (pid: number | null) => void = () => undefined;
      const child = new ConsoleChild(new Promise<number | null>(resolve => { spawn = resolve; }));
      loginConsole.launch.mockResolvedValue({ kind: 'started', child });
      jest.spyOn(store, 'recordOperationChild').mockImplementation(() => { throw new Error('SQLITE_IOERR'); });
      (killProcessTree as jest.Mock).mockImplementationOnce(async () => { child.emit('close', 1, null); });
      expect((await actions.startSignIn(command())).code).toBe('ok');
      expect(store.get(id).state).toBe('pending');
      const changes: unknown[] = [];
      actions.onStateChanged(change => changes.push(change));
      spawn(4321);
      await flush();
      expect(killProcessTree).toHaveBeenCalledWith(4321, 'SIGKILL');
      expect(operations()).toEqual([]);
      expect(store.get(id)).toMatchObject({ state: before.state, revision: before.revision + 2 });
      expect(changes).toEqual([{ profileId: id, state: before.state, revision: before.revision + 2 }]);
      expect(logger.warn).toHaveBeenCalledWith(
        '[ProviderAccountActions] Could not record the sign-in console pid; ending the sign-in', { code: 'unknown' });
    });

    it('a console closed by the kill settles within the grace', async () => {
      const child = new ConsoleChild();
      loginConsole.launch.mockResolvedValue({ kind: 'started', child });
      (killProcessTree as jest.Mock).mockImplementationOnce(async () => { child.emit('close', 1, null); });
      await actions.startSignIn(command());
      expect((await actions.cancelSignIn(command())).code).toBe('cancelled');
      expect(store.get(id).state).toBe('cancelled');
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('disposal', () => {
    it('waits for a bounded status, retains an unproved operation and refuses every new action', async () => {
      signIn('signed-in');
      const probe = deferred<ClaudeStatusProbeResult>();
      commands.status.mockReturnValue(probe.promise);
      const pending = actions.readStatus(target()); await flush();
      let disposed = false;
      const disposal = actions.dispose().then(() => { disposed = true; });
      await flush();
      expect(commands.status.mock.calls[0][1].aborted).toBe(true);
      expect(disposed).toBe(false);
      probe.resolve(unproved);
      await disposal; await pending;
      expect(operations()).toHaveLength(1);
      for (const result of [await actions.readStatus(target()), await actions.startSignIn(command('operation-0002')),
        await actions.signOut(command('operation-0003')), await actions.cancelSignIn(command('operation-0004'))]) {
        expect(result.code).toBe('unavailable-storage');
      }
    });

    it('aborts an in-flight sign-in status poll and retains its unproved operation', async () => {
      const probe = deferred<ClaudeStatusProbeResult>();
      commands.status.mockReturnValue(probe.promise);
      await actions.startSignIn(command());
      await advance(2_000);
      const disposal = actions.dispose(); await flush();
      expect(commands.status.mock.calls[0][1].aborted).toBe(true);
      probe.resolve(unproved);
      await disposal;
      expect(completeAuth).not.toHaveBeenCalled();
      expect(store.get(id).state).toBe('pending');
      expect(operations()).toHaveLength(1);
    });

    it.each([true, false])('stops a pending console sign-in (close proved: %s) and leaves no listener or timer', async proved => {
      const child = new ConsoleChild();
      loginConsole.launch.mockResolvedValue({ kind: 'started', child });
      await actions.startSignIn(command());
      const disposal = actions.dispose(); await flush();
      expect(killProcessTree).toHaveBeenCalledWith(4321, 'SIGKILL');
      if (proved) child.emit('close', 1, null);
      else await advance(2_000);
      await disposal;
      expect(store.get(id).state).toBe(proved ? 'cancelled' : 'pending');
      expect(operations()).toHaveLength(proved ? 0 : 1);
      expect(child.listenerCount('close')).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('releases a never-spawned console sign-in at once, without the grace or a tree kill', async () => {
      loginConsole.launch.mockResolvedValue({ kind: 'started', child: new ConsoleChild(Promise.resolve(null)) });
      await actions.startSignIn(command());
      await actions.dispose();
      expect(killProcessTree).not.toHaveBeenCalled();
      expect(store.get(id).state).toBe('cancelled');
      expect(operations()).toEqual([]);
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('status and sign-out', () => {
    it.each([
      [signedIn(), 'signed-in', 'identity-ref-0001', 'ok'],
      [signedOut, 'signed-out', null, 'ok'],
      [{ status: null, terminated: true }, 'disconnected', 'identity-ref-0001', 'unsupported-source'],
    ] as const)('readStatus records %#', async (probe, state, ref, code) => {
      signIn('signed-in');
      commands.status.mockResolvedValue(probe);
      const before = store.get(id);
      expect((await actions.readStatus(target())).code).toBe(code);
      expect(store.get(id)).toMatchObject({ state, auth_epoch: before.auth_epoch });
      expect(store.identityRef(id)).toBe(ref);
      expect(operations()).toEqual([]);
    });

    it('unproved status termination retains exclusion', async () => {
      signIn('signed-in');
      commands.status.mockResolvedValue(unproved);
      expect((await actions.readStatus(target())).code).toBe('identity-unproved');
      expect(operations()).toHaveLength(1);
      expect((await actions.startSignIn(command())).code).toBe('busy');
    });

    it('signs out only when status proves loggedIn:false and clears the identity reference', async () => {
      signIn('signed-in');
      expect((await actions.signOut(command())).code).toBe('ok');
      expect(commands.logout).toHaveBeenCalledWith(context, expect.any(AbortSignal));
      expect(store.get(id).state).toBe('signed-out');
      expect(store.identityRef(id)).toBeNull();
      signIn('signed-in');
      commands.status.mockResolvedValue(signedIn());
      expect((await actions.signOut(command('operation-0002'))).code).toBe('unsupported-source');
      expect(store.get(id).state).toBe('disconnected');
    });

    it('an unproved logout child keeps the reservation', async () => {
      signIn('signed-in');
      commands.logout.mockResolvedValue({ exitCode: null, terminated: false });
      expect((await actions.signOut(command())).code).toBe('busy');
      expect(commands.status).not.toHaveBeenCalled();
      expect(completeAuth).not.toHaveBeenCalled();
      expect(operations()).toHaveLength(1);
    });
  });

  describe('late probe close (close receipts)', () => {
    it('a status child closed after its timeout and grace no longer blocks a later successful sign-in', async () => {
      const late = new FakeReceipt();
      commands.status.mockResolvedValueOnce(unprovedWith(late)).mockResolvedValue(signedIn());
      await actions.startSignIn(command());
      await advance(2_000);
      expect(commands.status).toHaveBeenCalledTimes(1);
      expect(late.listeners.size).toBe(1);
      late.close();
      await advance(2_000);
      expect(commands.status).toHaveBeenCalledTimes(2);
      expect(completeAuth).toHaveBeenCalledWith('operation-0001', expect.any(String), 1, 'signed-in', 'identity-ref-0001');
      expect(store.get(id).state).toBe('signed-in');
      expect(operations()).toEqual([]);
    });

    it('a gated sign-in completes when the unproved status child closes later', async () => {
      const late = new FakeReceipt();
      commands.status.mockResolvedValueOnce(unprovedWith(late)).mockResolvedValue(signedIn());
      await actions.startSignIn(command());
      await advance(2_000); await advance(2_000);
      expect(completeAuth).not.toHaveBeenCalled();
      expect(store.get(id).state).toBe('pending');
      late.close(); await flush();
      expect(store.get(id).state).toBe('signed-in');
      expect(operations()).toEqual([]);
    });

    it('control: a status child that never closes keeps the operation busy, whatever the elapsed time', async () => {
      const never = new FakeReceipt();
      commands.status.mockResolvedValueOnce(unprovedWith(never)).mockResolvedValue(signedIn());
      await actions.startSignIn(command());
      await advance(2_000); await advance(2_000);
      await advance(600_000);
      expect(completeAuth).not.toHaveBeenCalled();
      expect(store.get(id).state).toBe('pending');
      expect((await actions.readStatus(target())).code).toBe('busy');
      expect(operations()).toHaveLength(1);
    });

    it('resumes polling at the unproved limit once one of the children closes', async () => {
      const receipts = [new FakeReceipt(), new FakeReceipt(), new FakeReceipt()];
      for (const receipt of receipts) commands.status.mockResolvedValueOnce(unprovedWith(receipt));
      commands.status.mockResolvedValue(signedOut);
      await actions.startSignIn(command());
      for (let i = 0; i < 4; i++) await advance(2_000);
      expect(commands.status).toHaveBeenCalledTimes(3);
      receipts[0].close();
      await advance(2_000);
      expect(commands.status).toHaveBeenCalledTimes(4);
    });

    it('an unproved logout child that closes later lets the gated sign-out settle', async () => {
      signIn('signed-in');
      const late = new FakeReceipt();
      commands.logout.mockResolvedValue({ exitCode: null, terminated: false, closeReceipt: late });
      expect((await actions.signOut(command())).code).toBe('busy');
      expect(operations()).toHaveLength(1);
      late.close(); await flush();
      expect(completeAuth).toHaveBeenCalledTimes(1);
      expect(store.get(id).state).toBe('disconnected');
      expect(operations()).toEqual([]);
    });

    it('a status action releases its reservation only when the unproved child closes', async () => {
      signIn('signed-in');
      const late = new FakeReceipt();
      commands.status.mockResolvedValue(unprovedWith(late));
      expect((await actions.readStatus(target())).code).toBe('identity-unproved');
      await advance(600_000);
      expect(operations()).toHaveLength(1);
      expect(store.get(id).state).toBe('signed-in');
      late.close();
      expect(operations()).toEqual([]);
      expect(store.get(id).state).toBe('signed-in');
    });

    it('disposal removes every receipt listener and leaves the reservations held', async () => {
      const signInChild = new FakeReceipt();
      commands.status.mockResolvedValue(unprovedWith(signInChild));
      await actions.startSignIn(command());
      await advance(2_000);
      expect(signInChild.listeners.size).toBe(1);
      await actions.dispose();
      expect(signInChild.disposed).toBe(true);
      expect(signInChild.listeners.size).toBe(0);
      signInChild.close();
      expect(completeAuth).not.toHaveBeenCalled();
      expect(store.get(id).state).toBe('pending');
    });

    it('disposal removes the listener of a status-action child that outlived the action', async () => {
      const late = new FakeReceipt();
      commands.status.mockResolvedValue(unprovedWith(late));
      expect((await actions.readStatus(target())).code).toBe('identity-unproved');
      expect(late.listeners.size).toBe(1);
      await actions.dispose();
      expect(late.disposed).toBe(true);
      expect(late.listeners.size).toBe(0);
      expect(operations()).toHaveLength(1);
    });
  });

  describe('late reg.exe close (policy scan close receipts)', () => {
    const unprovedScan = (...closeReceipts: FakeReceipt[]) =>
      ({ ok: false as const, code: 'unsupported-source' as const, terminated: false, closeReceipts });

    it('an auth-context refusal with an unproved reg.exe child blocks sign-out until its late close', async () => {
      signIn('signed-in');
      const late = new FakeReceipt();
      certifier.authContext.mockResolvedValue(unprovedScan(late));
      expect((await actions.signOut(command())).code).toBe('busy');
      expect(commands.logout).not.toHaveBeenCalled();
      expect(late.listeners.size).toBe(1);
      await advance(600_000);
      expect(completeAuth).not.toHaveBeenCalled();
      expect(operations()).toHaveLength(1);
      late.close(); await flush();
      expect(completeAuth).toHaveBeenCalledTimes(1);
      expect(store.get(id).state).toBe('disconnected');
      expect(operations()).toEqual([]);
    });

    it('a coverage refusal unblocks sign-in only when every unproved reg.exe child closed', async () => {
      const first = new FakeReceipt();
      const second = new FakeReceipt();
      certifier.checkCoverage.mockResolvedValue(unprovedScan(first, second));
      await actions.startSignIn(command());
      await flush();
      expect(loginConsole.launch).not.toHaveBeenCalled();
      expect(completeAuth).not.toHaveBeenCalled();
      first.close(); await flush();
      expect(completeAuth).not.toHaveBeenCalled();
      expect(operations()).toHaveLength(1);
      second.close(); await flush();
      expect(completeAuth).toHaveBeenCalledTimes(1);
      expect(store.get(id).state).toBe('failed');
      expect(operations()).toEqual([]);
    });

    it('control: a reg.exe child that never closes keeps the operation busy, whatever the elapsed time', async () => {
      const never = new FakeReceipt();
      certifier.checkCoverage.mockResolvedValue(unprovedScan(never));
      await actions.startSignIn(command());
      await advance(600_000);
      expect(completeAuth).not.toHaveBeenCalled();
      expect((await actions.readStatus(target())).code).toBe('busy');
      expect(operations()).toHaveLength(1);
    });

    it('an unterminated refusal without receipts stays unproved', async () => {
      certifier.checkCoverage.mockResolvedValue({ ok: false, code: 'unsupported-source', terminated: false });
      await actions.startSignIn(command());
      await advance(600_000);
      expect(completeAuth).not.toHaveBeenCalled();
      expect(operations()).toHaveLength(1);
    });

    it('disposal removes the reg.exe receipt listeners and leaves the reservation held', async () => {
      const never = new FakeReceipt();
      certifier.authContext.mockResolvedValue(unprovedScan(never));
      await actions.startSignIn(command());
      await flush();
      expect(never.listeners.size).toBe(1);
      await actions.dispose();
      expect(never.disposed).toBe(true);
      expect(never.listeners.size).toBe(0);
      never.close();
      expect(completeAuth).not.toHaveBeenCalled();
      expect(operations()).toHaveLength(1);
    });

    it('a status action releases its reservation only once every unproved reg.exe child closed', async () => {
      signIn('signed-in');
      const completeStatus = jest.spyOn(store, 'completeStatus');
      const first = new FakeReceipt();
      const second = new FakeReceipt();
      certifier.checkCoverage.mockResolvedValue(unprovedScan(first, second));
      expect((await actions.readStatus(target())).code).toBe('unsupported-source');
      expect(commands.status).not.toHaveBeenCalled();
      expect(first.listeners.size).toBe(1);
      expect(second.listeners.size).toBe(1);
      expect(operations()).toHaveLength(1);
      first.close();
      expect(operations()).toHaveLength(1);
      second.close();
      expect(operations()).toEqual([]);
      expect(store.get(id).state).toBe('signed-in');
      expect(store.identityRef(id)).toBe('identity-ref-0001');
      // One retaining record and one late release: no duplicate settlement.
      expect(completeStatus).toHaveBeenCalledTimes(2);
      expect(completeStatus).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), expect.any(Number), 'signed-in', true, undefined);
      first.close(); second.close();
      expect(completeStatus).toHaveBeenCalledTimes(2);
      certifier.checkCoverage.mockResolvedValue({ ok: true });
      commands.status.mockResolvedValue(signedIn());
      expect((await actions.readStatus(target())).code).toBe('ok');
    });

    it('control: a status action whose reg.exe or --version child never closes stays held; disposal removes listeners', async () => {
      signIn('signed-in');
      const closes = new FakeReceipt();
      const never = new FakeReceipt();
      certifier.authContext.mockResolvedValue({ ...unprovedScan(closes, never), code: 'timeout' });
      expect((await actions.readStatus(target())).code).toBe('timeout');
      closes.close();
      await advance(600_000);
      expect(operations()).toHaveLength(1);
      expect((await actions.readStatus(target())).code).toBe('busy');
      expect(never.listeners.size).toBe(1);
      await actions.dispose();
      expect(never.disposed).toBe(true);
      expect(never.listeners.size).toBe(0);
      never.close();
      expect(operations()).toHaveLength(1);
      expect(store.get(id).state).toBe('signed-in');
    });
  });

  describe('route-changed (reserved directory replaced)', () => {
    const changed = (terminated: boolean): ClaudeStatusProbeResult => ({ status: null, terminated, routeChanged: true });

    it('sign-in start-up: the console refusal ends the operation at once with no fallback', async () => {
      loginConsole.launch.mockResolvedValue({ kind: 'route-changed' });
      expect(await actions.startSignIn(command())).toEqual(accountActionResult('route-changed'));
      expect(loginConsole.fallbackScript).not.toHaveBeenCalled();
      expect(store.get(id).state).toBe('failed');
      expect(operations()).toEqual([]);
    });

    it('sign-in poll: records no signed-in state and releases a terminated child', async () => {
      commands.status.mockResolvedValue(changed(true));
      await actions.startSignIn(command());
      await advance(2_000);
      expect(completeAuth).toHaveBeenCalledWith('operation-0001', expect.any(String), 1, 'failed', undefined);
      expect(store.get(id).state).toBe('failed');
      expect(store.identityRef(id)).toBeNull();
      expect(operations()).toEqual([]);
    });

    it('sign-in poll: an unproved child keeps the reservation (busy)', async () => {
      commands.status.mockResolvedValue(changed(false));
      await actions.startSignIn(command());
      await advance(2_000);
      expect(completeAuth).not.toHaveBeenCalled();
      expect(store.get(id).state).toBe('pending');
      expect((await actions.readStatus(target())).code).toBe('busy');
    });

    it('sign-out: a changed route after logout or after the follow-up status records no signed-out state', async () => {
      signIn('signed-in');
      commands.logout.mockResolvedValueOnce({ exitCode: null, terminated: true, routeChanged: true });
      expect((await actions.signOut(command())).code).toBe('route-changed');
      expect(commands.status).not.toHaveBeenCalled();
      expect(store.get(id).state).toBe('disconnected');
      expect(store.identityRef(id)).toBe('identity-ref-0001');
      signIn('signed-in');
      commands.status.mockResolvedValueOnce(changed(true));
      expect((await actions.signOut(command('operation-0002'))).code).toBe('route-changed');
      expect(store.get(id).state).toBe('disconnected');
      expect(store.identityRef(id)).toBe('identity-ref-0001');
      expect(operations()).toEqual([]);
    });

    it('status action: records neither signed-in nor signed-out, and an unproved child retains', async () => {
      signIn('signed-out');
      commands.status.mockResolvedValueOnce(changed(true));
      expect((await actions.readStatus(target())).code).toBe('route-changed');
      expect(store.get(id).state).toBe('failed');
      expect(operations()).toEqual([]);
      const late = new FakeReceipt();
      commands.status.mockResolvedValueOnce({ ...changed(false), closeReceipt: late });
      expect((await actions.readStatus(target())).code).toBe('route-changed');
      expect(operations()).toHaveLength(1);
      late.close();
      expect(operations()).toEqual([]);
      expect(store.get(id).state).toBe('failed');
    });
  });

  it('refuses an active run lease without a child or a new epoch', async () => {
    signIn('signed-in');
    const profile = store.get(id);
    store.acquireRunLease({ profileId: id, expectedRevision: profile.revision,
      route: resolveProviderAccountRoute(profile.canonical_route),
      runId: 'run-00001', reservationId: 'lease-00001', operationId: 'admit-00001' });
    expect((await actions.startSignIn(command())).code).toBe('busy');
    expect(certifier.authContext).not.toHaveBeenCalled();
    expect(store.get(id).auth_epoch).toBe(0);
    expect(service.list()[0].activeRunCount).toBe(1);
  });

  it('reads status while a run lease is live; sign-in stays busy', async () => {
    signIn('signed-in');
    const profile = store.get(id);
    store.acquireRunLease({ profileId: id, expectedRevision: profile.revision,
      route: resolveProviderAccountRoute(profile.canonical_route),
      runId: 'run-00001', reservationId: 'lease-00001', operationId: 'admit-00001' });
    commands.status.mockResolvedValueOnce(signedIn());
    expect((await actions.readStatus(target())).code).toBe('ok');
    expect(commands.status).toHaveBeenCalledTimes(1);
    expect(store.get(id).state).toBe('signed-in');
    expect(operations()).toEqual([]);
    expect((await actions.startSignIn(command())).code).toBe('busy');
    expect(service.list()[0].activeRunCount).toBe(1);
  });

  /** A signed-in profile left 'pending' by a sign-in of a host that crashed; returns the profile before it. */
  const crashPendingSignIn = () => {
    signIn('signed-in');
    const profile = store.get(id);
    store.reserveAuth(id, profile.revision, resolveProviderAccountRoute(profile.canonical_route),
      'operation-crashed', 'owner-crashed', 'sign-in');
    // No process has this pid: the crashed host's operation is proved abandoned.
    const deadPid = 2_147_483_000;
    db.prepare('UPDATE provider_account_operations SET host_pid = ?').run(deadPid);
    jest.spyOn(process, 'kill').mockImplementation((pid: number) => {
      if (pid === deadPid) throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
      return true;
    });
    expect(store.get(id).state).toBe('pending');
    return profile;
  };

  it('a plain account list restores a profile an ended host left pending and notifies', () => {
    const profile = crashPendingSignIn();
    const changes: unknown[] = [];
    actions.onStateChanged(change => changes.push(change));
    expect(service.list().find(account => account.profileId === id))
      .toMatchObject({ state: 'signed-in', revision: profile.revision + 2 });
    expect(changes).toEqual([{ profileId: id, state: 'signed-in', revision: profile.revision + 2 }]);
    expect(operations()).toEqual([]);
  });

  it('restores a profile an ended host left pending, notifies, then reads its status', async () => {
    const profile = crashPendingSignIn();
    const changes: unknown[] = [];
    actions.onStateChanged(change => changes.push(change));
    commands.status.mockResolvedValueOnce(signedIn());
    expect((await actions.readStatus(target())).code).toBe('ok');
    expect(changes[0]).toEqual({ profileId: id, state: 'signed-in', revision: profile.revision + 2 });
    expect(store.get(id)).toMatchObject({ state: 'signed-in', auth_epoch: profile.auth_epoch + 1 });
    expect(operations()).toEqual([]);
  });

  describe('signed-in departure log', () => {
    let logger: { warn: jest.Mock };
    let logged: ProviderAccountActionsService;
    beforeEach(() => {
      logger = { warn: jest.fn() };
      logged = build(logger);
    });
    afterEach(async () => { await logged.dispose(); });
    const departures = () => logger.warn.mock.calls.filter(([text]) => text === '[ProviderAccountActions] Account left the signed-in state');

    it('logs a status that observes a signed-out account, with fixed fields only', async () => {
      signIn('signed-in');
      commands.status.mockResolvedValueOnce(signedOut);
      expect((await logged.readStatus(target())).code).toBe('ok');
      expect(departures()).toEqual([
        ['[ProviderAccountActions] Account left the signed-in state', { operation: 'status', state: 'signed-out', reason: 'ok' }],
      ]);
      // No profile id, path or CLI text reaches the log.
      // The account directory ends with the profile id, so this also excludes the path.
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(id);
    });

    it('logs a status that cannot prove the login, with its result code', async () => {
      signIn('signed-in');
      commands.status.mockResolvedValueOnce({ status: null, terminated: true });
      expect((await logged.readStatus(target())).code).toBe('unsupported-source');
      expect(departures()).toEqual([
        ['[ProviderAccountActions] Account left the signed-in state', { operation: 'status', state: 'disconnected', reason: 'unsupported-source' }],
      ]);
    });

    it('stays quiet while the account stays signed in or was not signed in', async () => {
      signIn('signed-in');
      commands.status.mockResolvedValueOnce(signedIn());
      await logged.readStatus(target());
      signIn('signed-out');
      commands.status.mockResolvedValueOnce(signedOut);
      await logged.readStatus(target());
      expect(departures()).toEqual([]);
    });

    it('logs a sign-out of a signed-in account once, at completion', async () => {
      signIn('signed-in');
      expect((await logged.signOut(command())).code).toBe('ok');
      expect(departures()).toEqual([
        ['[ProviderAccountActions] Account left the signed-in state', { operation: 'sign-out', state: 'signed-out', reason: 'ok' }],
      ]);
    });
  });

  it('compares operation id, revision and epoch on cancel', async () => {
    await actions.startSignIn(command());
    expect((await actions.cancelSignIn(command('wrong-operation'))).code).toBe('conflict');
    expect((await actions.cancelSignIn(command())).code).toBe('cancelled');
  });

  it('notifies state changes with a snapshot and stops after unsubscribe', async () => {
    const changes: unknown[] = [];
    const stop = actions.onStateChanged(change => changes.push(change));
    await actions.startSignIn(command());
    expect(changes).toContainEqual({ profileId: id, state: 'pending', revision: store.get(id).revision });
    stop();
    await actions.cancelSignIn(command());
    expect(changes).toHaveLength(1);
  });

  it('adds label-only beside the profile DB without selecting', () => {
    expect(store.get(id).canonical_route).toBe(join(root, 'provider-accounts', 'claude', id));
    expect(service.selection(root, 'lane').profileId).toBeNull();
    const directory = store.get(id).canonical_route;
    service.remove(id, 0);
    expect(service.list()).toEqual([]);
    expect(existsSync(directory)).toBe(true);
  });

  it('maps closed codes to fixed safe sentences even when dependency errors contain secrets', async () => {
    for (const code of PROVIDER_ACCOUNT_RESULT_CODES) expect(isSafeProviderAccountSummary(accountActionResult(code).summary)).toBe(true);
    jest.spyOn(store, 'get').mockImplementation(() => { throw new ProviderAccountStoreError('conflict', 'sk-ant-secret person@example.test'); });
    expect(await actions.readStatus(target())).toEqual(accountActionResult('conflict'));
  });
});
