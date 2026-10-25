import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS, type SqliteDatabase } from '@ptah-extension/persistence-sqlite';
import { killProcessTree, type ProcessSpawnRequest, type SpawnedProcessHandle } from '@ptah-extension/platform-core';
import { isSafeProviderAccountSummary, PROVIDER_ACCOUNT_RESULT_CODES } from '@ptah-extension/shared';
import { ProviderAccountStore } from './provider-account.store';
import { ProviderAccountService } from './provider-account.service';
import { ProviderAccountActionsService } from './provider-account-actions.service';
import { accountActionResult, ClaudeAccountCommand } from './claude-account-command';
import { ProviderAccountStoreError, resolveProviderAccountRoute } from './provider-account-route';

jest.mock('@ptah-extension/platform-core', () => ({
  ...jest.requireActual<typeof import('@ptah-extension/platform-core')>('@ptah-extension/platform-core'),
  killProcessTree: jest.fn().mockResolvedValue(undefined),
}));

const Database = require('better-sqlite3') as new (path: string) => SqliteDatabase;
const schema = MIGRATIONS.find(entry => entry.version === 58)?.sql;
if (!schema) throw new Error('Provider account migration is missing');

class Child extends EventEmitter implements SpawnedProcessHandle {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly whenSpawned = Promise.resolve(1234);
  readonly pid = 1234;
  readonly killed = false;
  readonly exitCode = null;
  kill(): boolean { return true; }
  close(code = 0, data = ''): void {
    this.stdout.write(data);
    this.emit('close', code, null);
  }
}

describe('Provider account official actions', () => {
  let root: string;
  let db: SqliteDatabase;
  let store: ProviderAccountStore;
  let service: ProviderAccountService;
  let actions: ProviderAccountActionsService;
  let commands: ClaudeAccountCommand;
  let children: Child[];
  let requests: ProcessSpawnRequest[];
  let id: string;
  const detector = { findExecutable: jest.fn() };
  const target = () => ({ provider: 'claude' as const, profileId: id });
  const command = (operationId = 'operation-0001') => ({ ...target(), operationId, expectedRevision: store.get(id).revision });
  const flush = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  const status = (method: string) => JSON.stringify({ configDir: store.get(id).canonical_route, authMethod: method });
  const permitMocks = (): void => {
    jest.spyOn(commands, 'authorization').mockReturnValue('ok');
    jest.spyOn(commands, 'environment').mockImplementation(route => ({ CLAUDE_CONFIG_DIR: route.canonicalPath }));
  };
  beforeEach(() => {
    jest.useFakeTimers();
    root = mkdtempSync(join(tmpdir(), 'ptah-account-actions-'));
    const dbPath = join(root, 'isolated.sqlite');
    db = new Database(dbPath);
    db.exec(schema);
    store = new ProviderAccountStore({ db });
    service = new ProviderAccountService(store, { db, dbPath });
    id = service.add('Work').profileId;
    children = []; requests = [];
    detector.findExecutable.mockResolvedValue({ path: 'mock-claude', source: 'path', version: 'fixture' });
    commands = new ClaudeAccountCommand(detector, { spawnProcess: request => {
      requests.push(request);
      const child = new Child(); children.push(child); return child;
    } });
    actions = new ProviderAccountActionsService(store, commands);
  });
  afterEach(() => {
    jest.restoreAllMocks(); jest.clearAllMocks(); jest.useRealTimers();
    db.close(); rmSync(root, { recursive: true, force: true });
  });

  it('holds live named commands before discovery and leaves ambient selections alone', async () => {
    expect((await actions.startSignIn(command())).code).toBe('release-held');
    expect((await actions.signOut(command())).code).toBe('release-held');
    expect((await actions.readStatus(target())).code).toBe('release-held');
    expect(detector.findExecutable).not.toHaveBeenCalled();
    expect(children).toHaveLength(0);
    expect(service.selection(root, 'main')).toEqual({ profileId: null, revision: -1 });
    expect(store.get(id).state).toBe('not-signed-in');
  });

  it('adds label-only beside the profile DB without selecting and changes both defaults atomically', () => {
    expect(store.get(id).canonical_route).toBe(join(root, 'provider-accounts', 'claude', id));
    expect(service.selection(root, 'lane').profileId).toBeNull();
    service.select(root, 'main', id, -1, 0);
    expect(service.selection(root, 'lane').profileId).toBeNull();
    expect(() => service.setDefault(root, id, { main: 0, lane: 4 }, 0)).toThrow();
    expect(service.selection(root, 'main').revision).toBe(0);
    service.setDefault(root, id, { main: 0, lane: -1 }, 0);
    expect(service.selection(root, 'lane').profileId).toBe(id);
    service.rename(id, 0, 'Personal');
    expect(service.list()[0].label).toBe('Personal');
    const directory = store.get(id).canonical_route;
    service.remove(id, 1);
    expect(service.list()).toEqual([]);
    expect(existsSync(directory)).toBe(true);
    expect(service.selection(root, 'main').profileId).toBeNull();
  });

  it('idle signed-in status preserves epoch, state and revision and never makes sign-in busy by pending', async () => {
    permitMocks();
    db.prepare("UPDATE provider_account_profiles SET state = 'signed-in' WHERE profile_id = ?").run(id);
    const before = store.get(id);
    const pending = actions.readStatus(target()); await flush();
    expect(store.get(id)).toEqual(before);
    const other = new ProviderAccountActionsService(store, commands);
    expect((await other.startSignIn(command('operation-concurrent'))).code).toBe('busy');
    expect(store.get(id).state).toBe('signed-in');
    children[0].close(0, status('claude.ai'));
    expect((await pending).code).toBe('ok');
    expect(store.get(id)).toEqual(before);
    const login = other.startSignIn(command('operation-after-status')); await flush();
    expect(store.get(id).state).toBe('pending');
    children[1].close(1); await login;
  });

  it.each([
    ['none', 0, 'signed-out'],
    ['claude.ai', 0, 'signed-in'],
    ['none', 1, 'disconnected'],
    ['unproved', 0, 'disconnected'],
  ] as const)('status %s with exit %s persists %s without changing epoch', async (method, code, state) => {
    permitMocks();
    db.prepare("UPDATE provider_account_profiles SET state = 'signed-in' WHERE profile_id = ?").run(id);
    const before = store.get(id);
    const pending = actions.readStatus(target()); await flush();
    children[0].close(code, status(method)); await pending;
    expect(store.get(id)).toMatchObject({ state, auth_epoch: before.auth_epoch,
      revision: before.revision + (state === before.state ? 0 : 1) });
    expect(db.prepare('SELECT * FROM provider_account_operations').all()).toEqual([]);
  });

  it('unproved status termination marks signed-in disconnected and retains exclusion', async () => {
    permitMocks();
    db.prepare("UPDATE provider_account_profiles SET state = 'signed-in' WHERE profile_id = ?").run(id);
    const before = store.get(id);
    jest.spyOn(commands, 'execute').mockResolvedValue({ code: 'timeout', terminated: false });
    await actions.readStatus(target());
    expect(store.get(id)).toMatchObject({ state: 'disconnected', auth_epoch: before.auth_epoch, revision: before.revision + 1 });
    expect(db.prepare('SELECT * FROM provider_account_operations').all()).toHaveLength(1);
    expect((await actions.startSignIn(command())).code).toBe('busy');
  });

  it('moves not-signed-in through pending to signed-in and verified signed-out', async () => {
    permitMocks();
    const login = actions.startSignIn(command()); await flush();
    expect(store.get(id).state).toBe('pending');
    children[0].close(); await flush();
    children[1].close(0, status('claude.ai'));
    expect((await login).code).toBe('ok');
    expect(store.get(id).state).toBe('signed-in');
    const logout = actions.signOut(command('operation-0002')); await flush();
    children[2].close(); await flush(); children[3].close(0, status('none'));
    expect((await logout).code).toBe('ok');
    expect(store.get(id).state).toBe('signed-out');
    expect(requests.map(request => request.args)).toEqual([
      ['auth', 'login'], ['auth', 'status'], ['auth', 'logout'], ['auth', 'status'],
    ]);
    expect(requests[0].launchGuard?.fileIdentities?.[0].realpath).toBe(store.get(id).canonical_route);
  });

  it('reports failed and disconnected without raw credential-shaped output', async () => {
    permitMocks();
    const failed = actions.startSignIn(command()); await flush();
    children[0].stderr.write('sk-ant-secret person@example.test');
    children[0].close(1, 'Bearer private');
    expect(await failed).toEqual(accountActionResult('unsupported-source'));
    expect(store.get(id).state).toBe('failed');
    const good = actions.readStatus(target()); await flush(); children[1].close(0, status('claude.ai')); await good;
    const lost = actions.readStatus(target()); await flush(); children[2].close(1, 'private'); await lost;
    expect(store.get(id).state).toBe('disconnected');
  });

  it('compares operation ID and auth epoch on cancel and completion', async () => {
    permitMocks();
    const login = actions.startSignIn(command()); await flush();
    expect((await actions.cancelSignIn(command('wrong-operation'))).code).toBe('conflict');
    expect(() => store.completeAuth('operation-0001', 'wrong-owner', 999, 'signed-in')).toThrow();
    const cancel = actions.cancelSignIn(command()); await flush();
    expect(killProcessTree).toHaveBeenCalledWith(1234, 'SIGKILL');
    children[0].close(0); await flush();
    children[1].close(0, status('claude.ai'));
    expect((await cancel).code).toBe('cancelled'); await login;
    expect(store.get(id).state).toBe('cancelled');
    const recheck = actions.readStatus(target()); await flush(); children[2].close(0, status('claude.ai')); await recheck;
    expect(store.get(id).state).toBe('signed-in');
  });

  it('retains unproved termination after two second grace and ignores late success', async () => {
    permitMocks();
    const login = actions.startSignIn(command()); await flush();
    const cancel = actions.cancelSignIn(command()); await flush();
    jest.advanceTimersByTime(2_000); await flush();
    expect((await cancel).code).toBe('cancelled'); await login;
    children[0].close(0, status('claude.ai')); await flush();
    expect(store.get(id).state).toBe('pending');
    expect((await actions.readStatus(target())).code).toBe('busy');
    expect(children[0].listenerCount('close')).toBe(0);
    expect(children[0].stdout.listenerCount('data')).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cancellation during the post-login status check cannot become success', async () => {
    permitMocks();
    const login = actions.startSignIn(command()); await flush();
    children[0].close(); await flush();
    const cancelled = actions.cancelSignIn(command()); await flush();
    children[1].close(0, status('claude.ai'));
    expect((await cancelled).code).toBe('cancelled'); await login;
    expect(store.get(id).state).toBe('cancelled');
  });

  it('bounds output and drains stderr without returning it', async () => {
    permitMocks();
    const pending = actions.readStatus(target()); await flush();
    children[0].stderr.write('private identity');
    children[0].stdout.write('x'.repeat(16_385)); await flush();
    children[0].close();
    expect(await pending).toEqual(accountActionResult('unsupported-source'));
    expect(store.get(id).state).toBe('failed');
  });

  it.each([['status', 10_000], ['logout', 10_000], ['login', 300_000]] as const)(
    'enforces %s deadline and kill grace', async (kind, deadline) => {
      permitMocks();
      const pending = commands.execute(kind, resolveProviderAccountRoute(store.get(id).canonical_route), new AbortController().signal);
      await flush(); jest.advanceTimersByTime(deadline - 1); await flush();
      expect(killProcessTree).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1); await flush();
      expect(killProcessTree).toHaveBeenCalled();
      jest.advanceTimersByTime(2_000); await flush();
      expect(await pending).toEqual({ code: 'timeout', terminated: false });
    });

  it('includes stalled CLI discovery in the status deadline', async () => {
    permitMocks();
    detector.findExecutable.mockImplementationOnce(() => new Promise(() => { /* Deliberately unresolved detector. */ }));
    const pending = commands.execute('status', resolveProviderAccountRoute(store.get(id).canonical_route), new AbortController().signal);
    await flush(); jest.advanceTimersByTime(10_000); await flush();
    expect(await pending).toEqual({ code: 'timeout', terminated: true });
    expect(children).toHaveLength(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('reports restart pending as unresolved and refuses duplicate host copies', async () => {
    permitMocks();
    const login = actions.startSignIn(command()); await flush();
    const other = new ProviderAccountActionsService(new ProviderAccountStore({ db }), commands);
    expect((await other.readStatus(target())).code).toBe('busy');
    expect((await other.startSignIn(command('operation-0002'))).code).toBe('busy');
    children[0].close(1); await login;
    expect(children).toHaveLength(1);
  });

  it('refuses an active run lease without spawning or advancing the epoch', async () => {
    permitMocks();
    store.admit({ profileId: id, expectedRevision: 0, route: resolveProviderAccountRoute(store.get(id).canonical_route),
      runId: 'run-00001', reservationId: 'lease-00001', operationId: 'admit-00001' });
    expect((await actions.startSignIn(command())).code).toBe('busy');
    expect(children).toHaveLength(0);
    expect(store.get(id).auth_epoch).toBe(0);
    expect(service.list()[0].activeRunCount).toBe(1);
  });

  it('rejects stale operation and epoch completions while preserving the current reservation', () => {
    const route = resolveProviderAccountRoute(store.get(id).canonical_route);
    const first = store.reserveAuth(id, 0, route, 'operation-first', 'owner-00001', 'sign-in');
    expect(() => store.completeAuth('operation-first', 'owner-00001', first.authEpoch + 1, 'signed-in')).toThrow();
    expect(store.get(id).state).toBe('pending');
    store.completeAuth('operation-first', 'owner-00001', first.authEpoch, 'cancelled');
    const second = store.reserveAuth(id, store.get(id).revision, route, 'operation-second', 'owner-00001', 'sign-in');
    expect(() => store.completeAuth('operation-first', 'owner-00001', first.authEpoch, 'signed-in')).toThrow();
    expect(store.get(id).auth_epoch).toBe(second.authEpoch);
    expect(store.get(id).state).toBe('pending');
    store.completeAuth('operation-second', 'owner-00001', second.authEpoch, 'failed');
  });

  it('maps closed codes to fixed safe sentences even when dependency errors contain secrets', async () => {
    for (const code of PROVIDER_ACCOUNT_RESULT_CODES) expect(isSafeProviderAccountSummary(accountActionResult(code).summary)).toBe(true);
    jest.spyOn(store, 'get').mockImplementation(() => { throw new ProviderAccountStoreError('conflict', 'sk-ant-secret person@example.test'); });
    expect(await actions.readStatus(target())).toEqual(accountActionResult('conflict'));
  });

  it('uses direct Node arguments only when the detector requires cliJsPath', async () => {
    permitMocks();
    detector.findExecutable.mockResolvedValue({ path: 'wrapper', useDirectExecution: true, cliJsPath: 'fixture cli.js' });
    const pending = actions.readStatus(target()); await flush(); children[0].close(0, status('none')); await pending;
    expect(requests[0].command).toBe(process.execPath);
    expect(requests[0].args).toEqual(['fixture cli.js', 'auth', 'status']);
  });
});
