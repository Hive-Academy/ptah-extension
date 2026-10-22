import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { container as rootContainer } from 'tsyringe';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import { AUTH_PROVIDERS_TOKENS } from './tokens';
import {
  registerAuthProvidersServices,
  registerCuratorAuthServices,
} from './register';
import { ProviderAuthResolver } from '../auth/provider-auth-resolver';
import { DraftVerificationService } from '../auth/draft-verification.service';
import { OpenRouterPricingService } from '../providers/openrouter';
import { PLATFORM_TOKENS, killProcessTree, type SpawnedProcessHandle } from '@ptah-extension/platform-core';
import { ClaudeAccountCommand } from '../accounts/claude-account-command';
import { ProviderAccountStore } from '../accounts/provider-account.store';
import { PlanLimitLedgerService } from '../quota/plan-limit-ledger.service';
import { ProviderOwnerResolver } from '../quota/provider-owner.resolver';
import { PlanCredentialSource } from '../quota/plan-credential.source';
import { PlanUsageService } from '../quota/plan-usage.service';
import { MIGRATIONS, PERSISTENCE_TOKENS, type SqliteConnectionService, type SqliteDatabase } from '@ptah-extension/persistence-sqlite';
import type { ProviderAccountAdmissionPort, ProviderAccountActionPort } from '@ptah-extension/auth-providers-tokens';
import { ProviderAccountService } from '../accounts/provider-account.service';
import { ProviderAccountActionsService } from '../accounts/provider-account-actions.service';
import * as publicApi from '../../index';

jest.mock('@ptah-extension/platform-core', () => ({
  ...jest.requireActual<typeof import('@ptah-extension/platform-core')>('@ptah-extension/platform-core'),
  killProcessTree: jest.fn().mockResolvedValue(undefined),
}));

class AccountChild extends EventEmitter implements SpawnedProcessHandle {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly whenSpawned = Promise.resolve(4321);
  readonly pid = 4321;
  readonly killed = false;
  readonly exitCode = null;
  kill(): boolean { return true; }
}

describe('required auth registration without the memory curator', () => {
  afterEach(() => jest.restoreAllMocks());

  function setup() {
    const c = rootContainer.createChildContainer();
    const logger = Logger.prototype;
    for (const method of ['debug', 'info', 'warn', 'error'] as const) {
      jest.spyOn(logger, method).mockImplementation(() => undefined);
    }
    jest
      .spyOn(OpenRouterPricingService.prototype, 'warmup')
      .mockImplementation(() => undefined);
    c.registerInstance(TOKENS.LOGGER, logger);
    c.registerInstance(TOKENS.CONFIG_MANAGER, { get: jest.fn() });
    c.registerInstance(TOKENS.AUTH_SECRETS_SERVICE, {});
    c.registerInstance(SETTINGS_TOKENS.WORKSPACE_SCOPE_RESOLVER, {});
    c.registerInstance(SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE, {});
    // The Codex proxy reads its quota owner from the Codex account service,
    // which needs these two agent-sdk boundaries (registered by every host).
    c.registerInstance(SDK_TOKENS.SDK_PROCESS_SPAWNER, {});
    c.registerInstance(SDK_TOKENS.SDK_ADAPTER_EVENTS, {
      onAuthFileChanged: jest.fn(),
    });
    registerAuthProvidersServices(c, logger);
    // Host-specific auth boundaries are outside this registration contract.
    c.registerInstance(AUTH_PROVIDERS_TOKENS.SDK_COPILOT_AUTH, {});
    c.registerInstance(AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH, {});
    return { c, logger };
  }

  it('resolves the draft verifier and its real resolver/proxy graph before optional curator setup', () => {
    const { c } = setup();
    expect(c.resolve(SDK_TOKENS.SDK_PROVIDER_AUTH_RESOLVER)).toBeInstanceOf(
      ProviderAuthResolver,
    );
    expect(
      c.resolve(AUTH_PROVIDERS_TOKENS.SDK_DRAFT_VERIFICATION),
    ).toBeInstanceOf(DraftVerificationService);
  });

  it('registers without persistence and resolves account singletons after phased startup without reading the DB', async () => {
    const { c } = setup();
    const readDb = jest.fn(() => { throw new Error('DB must stay unopened'); });
    const connection: Pick<SqliteConnectionService, 'db' | 'dbPath'> = {
      get db() { return readDb(); }, dbPath: 'unused',
    };
    c.registerInstance(PERSISTENCE_TOKENS.SQLITE_CONNECTION, connection);
    c.registerInstance(SDK_TOKENS.SDK_CLI_DETECTOR, { findExecutable: jest.fn() });
    const admission = c.resolve<ProviderAccountAdmissionPort>(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_ADMISSION);
    const actions = c.resolve<ProviderAccountActionPort>(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_ACTIONS);
    expect(admission).toBeInstanceOf(ProviderAccountService);
    expect(actions).toBeInstanceOf(ProviderAccountActionsService);
    expect(c.resolve(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_ADMISSION)).toBe(admission);
    expect(c.resolve(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_ACTIONS)).toBe(actions);
    expect(readDb).not.toHaveBeenCalled();
    const dispose = jest.spyOn(c.resolve(ProviderAccountService), 'dispose');
    const disposeActions = jest.spyOn(c.resolve(ProviderAccountActionsService), 'dispose');
    expect(c.resolve(ProviderAccountActionsService)).toBe(actions);
    await c.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(disposeActions).toHaveBeenCalledTimes(1);
  });

  it('returns typed busy refusals through every account port surface with an injected busy database', async () => {
    const { c } = setup();
    c.registerInstance(PERSISTENCE_TOKENS.SQLITE_CONNECTION, {
      get db(): never { throw Object.assign(new Error('private database path'), { code: 'SQLITE_BUSY' }); },
      dbPath: 'unused',
    });
    c.registerInstance(SDK_TOKENS.SDK_CLI_DETECTOR, { findExecutable: jest.fn() });
    const admission = c.resolve<ProviderAccountAdmissionPort>(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_ADMISSION);
    const actions = c.resolve<ProviderAccountActionPort>(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_ACTIONS);
    const target = { provider: 'claude' as const, profileId: 'profile-0001' };
    const command = { ...target, operationId: 'operation-0001', expectedRevision: 0 };
    const results = await Promise.all([
      admission.admitClaudeRoute({ provider: 'claude', scope: 'main', selection: { kind: 'named', profileId: target.profileId },
        operationId: command.operationId, runId: 'run-00001' }),
      actions.readStatus(target), actions.startSignIn(command), actions.signOut(command), actions.cancelSignIn(command),
    ]);
    for (const result of results) expect(result).toEqual({ code: 'busy', summary: 'The account is in use or has an unresolved operation.' });
    const lease = { reservationId: 'lease-0001', operationId: command.operationId, authEpoch: 0 };
    expect(await admission.releaseReservation({ ...lease, reason: 'disposal' })).toMatchObject({ code: 'conflict' });
    expect(await admission.retainUnresolvedReservation(lease)).toMatchObject({ code: 'conflict' });
    await c.dispose();
  });

  it('exports the metadata facade and keeps account store and certification internals private', () => {
    expect(publicApi.ProviderAccountService).toBe(ProviderAccountService);
    for (const name of ['ProviderAccountStore', 'ProviderAccountActionsService', 'ClaudeAccountCommand',
      'resolveProviderAccountRoute', 'claudeAccountRouteCertification', 'certifyClaudeAccountEnvironment']) {
      expect(Object.prototype.hasOwnProperty.call(publicApi, name)).toBe(false);
    }
  });

  it.each([false, true])('container disposal stops account actions with proved close=%s and preserves unproved reservations', async provedClose => {
    jest.useFakeTimers();
    const directory = mkdtempSync(join(tmpdir(), 'ptah-account-di-'));
    const Database = require('better-sqlite3') as new (path: string) => SqliteDatabase;
    const db = new Database(':memory:');
    try {
      const schema = MIGRATIONS.find(entry => entry.version === 58)?.sql;
      if (!schema) throw new Error('Provider account migration is missing');
      db.exec(schema);
      const { c } = setup();
      c.registerInstance(PERSISTENCE_TOKENS.SQLITE_CONNECTION, { db, dbPath: join(directory, 'isolated.sqlite') });
      const child = new AccountChild();
      const spawnProcess = jest.fn(() => child);
      c.registerInstance(SDK_TOKENS.SDK_PROCESS_SPAWNER, { spawnProcess });
      c.registerInstance(SDK_TOKENS.SDK_CLI_DETECTOR, {
        findExecutable: jest.fn().mockResolvedValue({ path: 'fixture-only', isWSL: false }),
      });
      jest.mocked(killProcessTree).mockImplementation(async () => {
        if (provedClose) child.emit('close', 1, null);
      });
      const commands = c.resolve(ClaudeAccountCommand);
      jest.spyOn(commands, 'authorization').mockReturnValue('ok');
      jest.spyOn(commands, 'environment').mockReturnValue({});
      const profile = c.resolve(ProviderAccountService).add('Disposal fixture');
      const store = c.resolve(ProviderAccountStore);
      const actions = c.resolve<ProviderAccountActionPort>(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_ACTIONS);
      const command = { provider: 'claude' as const, profileId: profile.profileId,
        expectedRevision: profile.revision, operationId: 'operation-disposal' };
      const pending = actions.startSignIn(command);
      for (let i = 0; i < 12; i++) await Promise.resolve();
      expect(spawnProcess).toHaveBeenCalledTimes(1);
      const disposed = c.dispose();
      await jest.advanceTimersByTimeAsync(2_000);
      await disposed;
      expect(await pending).toMatchObject({ code: 'cancelled' });
      expect(store.get(profile.profileId).state).toBe(provedClose ? 'cancelled' : 'pending');
      expect(db.prepare('SELECT * FROM provider_account_operations').all()).toHaveLength(provedClose ? 0 : 1);
      expect(killProcessTree).toHaveBeenCalledWith(4321, 'SIGKILL');
      expect(child.listenerCount('close')).toBe(0);
      expect(child.listenerCount('error')).toBe(0);
      expect(child.stdout.listenerCount('data')).toBe(0);
      expect(child.stderr.listenerCount('data')).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
      for (const result of await Promise.all([
        actions.readStatus(command), actions.startSignIn(command),
        actions.signOut(command), actions.cancelSignIn(command),
      ])) expect(result).toMatchObject({ code: 'unavailable-storage' });
      expect(spawnProcess).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('resolves the plan-limit services lazily, with agent-sdk tokens registered afterwards', () => {
    const { c } = setup();
    // Hosts run `registerSdkServices` after this library; register the
    // agent-sdk and platform boundaries only now to prove nothing resolved early.
    const registry = { register: jest.fn(() => jest.fn()) };
    c.registerInstance(SDK_TOKENS.SDK_SESSION_PLAN_LIMIT_REGISTRY, registry);
    c.registerInstance(SDK_TOKENS.SDK_SESSION_QUOTA_PROBE, {});
    c.registerInstance(PLATFORM_TOKENS.STATE_STORAGE, {
      get: () => undefined,
      update: async () => undefined,
      keys: () => [],
    });

    const ledger = c.resolve<PlanLimitLedgerService>(
      AUTH_PROVIDERS_TOKENS.PLAN_LIMIT_LEDGER,
    );
    expect(ledger).toBeInstanceOf(PlanLimitLedgerService);
    expect(c.resolve(AUTH_PROVIDERS_TOKENS.PLAN_LIMIT_LEDGER)).toBe(ledger);
    expect(registry.register).toHaveBeenCalledTimes(1);
    expect(
      c.resolve(AUTH_PROVIDERS_TOKENS.PROVIDER_OWNER_RESOLVER),
    ).toBeInstanceOf(ProviderOwnerResolver);
    expect(
      c.resolve(AUTH_PROVIDERS_TOKENS.PLAN_CREDENTIAL_SOURCE),
    ).toBeInstanceOf(PlanCredentialSource);
    const usage = c.resolve(AUTH_PROVIDERS_TOKENS.PLAN_USAGE_SERVICE);
    expect(usage).toBeInstanceOf(PlanUsageService);
    expect(c.resolve(AUTH_PROVIDERS_TOKENS.PLAN_USAGE_SERVICE)).toBe(usage);
    ledger.dispose();
  });

  it('preserves the resolver and proxy singletons when a host registers curator auth again', () => {
    const { c, logger } = setup();
    const resolver = c.resolve(SDK_TOKENS.SDK_PROVIDER_AUTH_RESOLVER);
    const manager = c.resolve(AUTH_PROVIDERS_TOKENS.SDK_CURATOR_PROXY_MANAGER);
    registerCuratorAuthServices(c, logger);
    expect(c.resolve(SDK_TOKENS.SDK_PROVIDER_AUTH_RESOLVER)).toBe(resolver);
    expect(c.resolve(AUTH_PROVIDERS_TOKENS.SDK_CURATOR_PROXY_MANAGER)).toBe(
      manager,
    );
  });
});
