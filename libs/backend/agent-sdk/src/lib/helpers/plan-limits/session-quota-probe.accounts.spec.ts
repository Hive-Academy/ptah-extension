import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  ClaudeAccountNamedRoute,
  ClaudeCertifiedLaunchContext,
} from '@ptah-extension/auth-providers-tokens';
import type { SessionId } from '@ptah-extension/shared';
import type {
  AccountInfo,
  Query,
} from '../../types/sdk-types/claude-sdk.types';
import { SdkModelService } from '../sdk-model-service';
import { SessionRegistry } from '../session-lifecycle/session-registry.service';
import { SdkAdapterEvents } from '../sdk-adapter-events.service';
import { SessionPlanLimitCallbackRegistry } from './session-plan-limit-callback-registry';
import {
  SessionQuotaProbeService,
  SESSION_QUOTA_PROBE_TIMEOUT_MS,
  type ClaudePlanUsage,
} from './session-quota-probe.service';

// SDK and DI fixtures implement only the methods exercised by these controls.
function partialMock<T>(members: Partial<T>): T {
  return members as T;
}

const route = (id = 'a', authEpoch = 1): ClaudeAccountNamedRoute =>
  ({
    kind: 'named',
    provider: 'claude',
    profileId: id,
    canonicalConfigDir: `/accounts/${id}`,
    routeFingerprint: id,
    routeRevision: 1,
    authEpoch,
    runId: `run-${id}`,
  }) as ClaudeAccountNamedRoute;
const account = (id: string): AccountInfo => ({
  email: `${id}@example.test`,
  organization: id,
});
const usage = {
  session: {
    total_cost_usd: 0,
    total_api_duration_ms: 0,
    total_duration_ms: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
    model_usage: {},
  },
  subscription_type: null,
  rate_limits_available: false,
  rate_limits: null,
} as ClaudePlanUsage;

function harness() {
  const logger = partialMock<Logger>({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  });
  const registry = new SessionRegistry(logger);
  const callbacks = new SessionPlanLimitCallbackRegistry(logger);
  const events = new SdkAdapterEvents(logger);
  const probe = new SessionQuotaProbeService(
    logger,
    registry,
    callbacks,
    events,
  );
  const add = (id: string, admitted = true, epoch = 1) => {
    const record = registry.register(
      id,
      {},
      new AbortController(),
      undefined,
      { usageCostSource: 'unreported', authEnv: {} },
      { kind: 'native', providerId: 'anthropic' },
    );
    const accountInfo = jest
      .fn<Promise<AccountInfo>, []>()
      .mockResolvedValue(account(id));
    const readUsage = jest
      .fn<Promise<ClaudePlanUsage>, [{ skipBehaviors?: boolean }?]>()
      .mockResolvedValue(usage);
    const close = jest.fn();
    const query = partialMock<Query>({
      accountInfo,
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: readUsage,
      close,
    });
    registry.setSessionQuery(id as SessionId, query);
    if (admitted)
      expect(registry.bindAccountRoute(id, route(id, epoch))).toBe(true);
    return { record, query, accountInfo, readUsage, close };
  };
  return { registry, probe, add, callbacks };
}

describe('account-scoped session quota controls', () => {
  afterEach(() => jest.useRealTimers());

  it('binds once, accepts identical identity, refuses changes, and freezes the binding', () => {
    const h = harness();
    const a = h.add('a');
    expect(h.registry.bindAccountRoute('a', route())).toBe(true);
    expect(h.registry.bindAccountRoute('a', route('b'))).toBe(false);
    expect(h.registry.bindAccountRoute('a', route('a', 2))).toBe(false);
    expect(h.registry.bindAccountRoute('missing', route())).toBe(false);
    expect(Object.isFrozen(a.record.accountBinding)).toBe(true);
    expect(
      Object.getOwnPropertyDescriptor(a.record, 'accountBinding')?.writable,
    ).toBe(false);
    expect(a.record.accountBinding).not.toHaveProperty('canonicalConfigDir');
    h.probe.dispose();
  });

  it('reads the matching query even when an unrelated account was most recently active', async () => {
    const h = harness();
    const a = h.add('a');
    const b = h.add('b');
    expect(await h.probe.readAccountForRoute('a', route())).toEqual({
      status: 'available',
      value: account('a'),
    });
    expect(await h.probe.readAccountForRoute('b', route('b'))).toEqual({
      status: 'available',
      value: account('b'),
    });
    expect(await h.probe.readPlanUsageForRoute(undefined, route())).toEqual({
      status: 'available',
      value: usage,
    });
    expect(a.readUsage).toHaveBeenCalledWith({ skipBehaviors: true });
    expect(b.readUsage).not.toHaveBeenCalled();
    expect(await h.probe.readAccountForRoute('b', route())).toEqual({
      status: 'unavailable',
      code: 'account-mismatch',
    });
    h.probe.dispose();
  });

  it('returns closed unavailable codes for missing bindings, sessions, and control methods', async () => {
    const h = harness();
    h.add('a', false);
    expect(await h.probe.readAccountForRoute('a', route())).toEqual({
      status: 'unavailable',
      code: 'account-mismatch',
    });
    expect(await h.probe.readPlanUsageForRoute(undefined, route())).toEqual({
      status: 'unavailable',
      code: 'no-open-session',
    });
    expect(await h.probe.readAccountForRoute('missing', route())).toEqual({
      status: 'unavailable',
      code: 'no-open-session',
    });
    h.registry.bindAccountRoute('a', route());
    h.registry.setSessionQuery(
      'a' as SessionId,
      partialMock<Query>({ close: jest.fn() }),
    );
    expect(await h.probe.readAccountForRoute('a', route())).toEqual({
      status: 'unavailable',
      code: 'service-unavailable',
    });
    expect(await h.probe.readPlanUsageForRoute('a', route())).toEqual({
      status: 'unavailable',
      code: 'service-unavailable',
    });
    h.probe.dispose();
    expect(await h.probe.readAccountForRoute('a', route())).toEqual({
      status: 'unavailable',
      code: 'service-unavailable',
    });
  });

  it('shares same-query control reads and discards late responses after an epoch change', async () => {
    const h = harness();
    const a = h.add('a');
    let resolve!: (value: AccountInfo) => void;
    a.accountInfo.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const first = h.probe.readAccountForRoute('a', route());
    const second = h.probe.readAccountForRoute('a', route());
    expect(a.accountInfo).toHaveBeenCalledTimes(1);
    h.probe.invalidateAccountRoute(route('a', 2));
    resolve(account('stale'));
    const unavailable = { status: 'unavailable', code: 'stale-epoch' };
    expect(await first).toEqual(unavailable);
    expect(await second).toEqual(unavailable);
    expect(await h.probe.readAccountForRoute('a', route())).toEqual(
      unavailable,
    );
    expect(await h.probe.readAccountForRoute('a', route('a', 2))).toEqual({
      status: 'unavailable',
      code: 'account-mismatch',
    });
    h.probe.dispose();
  });

  it.each([false, true])(
    'pins a live quota identity under eviction pressure (advance=%s)',
    async (advance) => {
      const h = harness();
      const a = h.add('a');
      let resolve!: (value: AccountInfo) => void;
      a.accountInfo.mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      const pending = h.probe.readAccountForRoute('a', route());
      if (advance) h.probe.invalidateAccountRoute(route('a', 2));
      for (let i = 0; i < 140; i++)
        h.probe.invalidateAccountRoute(route(`pressure-${i}`));
      if (advance) {
        expect(await h.probe.readAccountForRoute('a', route())).toEqual({
          status: 'unavailable',
          code: 'stale-epoch',
        });
      }
      resolve(account('a'));
      expect(await pending).toEqual(
        advance
          ? { status: 'unavailable', code: 'stale-epoch' }
          : { status: 'available', value: account('a') },
      );
      expect(h.probe['accountEpochs'].size).toBeLessThanOrEqual(128);
      h.probe.dispose();
    },
  );

  it('refreshes quota epochs in LRU order', () => {
    const h = harness();
    for (let i = 0; i < 128; i++)
      h.probe.invalidateAccountRoute(route(`lru-${i}`));
    h.probe.invalidateAccountRoute(route('lru-0', 2));
    h.probe.invalidateAccountRoute(route('new'));
    expect(
      h.probe['accountEpochs'].get(JSON.stringify(['claude', 'lru-0'])),
    ).toBe(2);
    expect(
      h.probe['accountEpochs'].has(JSON.stringify(['claude', 'lru-1'])),
    ).toBe(false);
    h.probe.dispose();
  });

  it.each([false, true])(
    'pins model reads under pressure (advance=%s)',
    async (advance) => {
      type Dependencies = ConstructorParameters<typeof SdkModelService>;
      const service = new SdkModelService(
        partialMock<Logger>({ debug: jest.fn() }),
        partialMock<Dependencies[1]>({}),
        partialMock<Dependencies[2]>({}),
        partialMock<Dependencies[3]>({}),
        partialMock<Dependencies[4]>({}),
        partialMock<Dependencies[5]>({}),
        undefined,
      );
      const models = [
        { value: 'fixture', displayName: 'Fixture', description: 'Fixture' },
      ];
      let finishProbe!: (value: typeof models) => void;
      service['probeAccountModels'] = jest.fn(
        () =>
          new Promise<typeof models>((done) => {
            finishProbe = done;
          }),
      );
      // The probe is replaced, so only the cache-key fields are read.
      const launch = partialMock<ClaudeCertifiedLaunchContext>({
        executable: partialMock<ClaudeCertifiedLaunchContext['executable']>({
          sdkExecutablePath: '/fixture/cli.js',
          version: '1.0',
        }),
        envDigest: 'fixture-digest',
      });
      const pending = service.getSupportedModels(route(), undefined, launch);
      expect(service['probeAccountModels']).toHaveBeenCalledTimes(1);
      if (advance) service.invalidateAccountRoute(route('a', 2));
      for (let i = 0; i < 140; i++)
        service.invalidateAccountRoute(route(`pressure-${i}`));
      if (advance) {
        expect(
          await service.getSupportedModels(route(), undefined, launch),
        ).toEqual([]);
        expect(service['probeAccountModels']).toHaveBeenCalledTimes(1);
      }
      finishProbe(models);
      expect(await pending).toEqual(advance ? [] : models);
      expect(service['accountEpochs'].size).toBeLessThanOrEqual(128);
      expect(service['activeAccountReads'].size).toBe(0);
    },
  );

  it('discards a usage result when its query was replaced', async () => {
    const h = harness();
    const a = h.add('a');
    let resolve!: (value: ClaudePlanUsage) => void;
    a.readUsage.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = h.probe.readPlanUsageForRoute('a', route());
    h.registry.setSessionQuery(
      'a' as SessionId,
      partialMock<Query>({ accountInfo: jest.fn() }),
    );
    resolve(usage);
    expect(await pending).toEqual({
      status: 'unavailable',
      code: 'stale-epoch',
    });
    h.probe.dispose();
  });

  it('bounds rejected or hanging controls without closing the live session query', async () => {
    jest.useFakeTimers();
    const h = harness();
    const a = h.add('a');
    a.accountInfo.mockRejectedValueOnce(new Error('private failure'));
    expect(await h.probe.readAccountForRoute('a', route())).toEqual({
      status: 'unavailable',
      code: 'service-unavailable',
    });
    a.accountInfo.mockImplementation(() => new Promise(() => undefined));
    const pending = h.probe.readAccountForRoute('a', route());
    await jest.advanceTimersByTimeAsync(SESSION_QUOTA_PROBE_TIMEOUT_MS + 1);
    expect(await pending).toEqual({
      status: 'unavailable',
      code: 'service-unavailable',
    });
    expect(a.close).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    h.probe.dispose();
  });

  it('retains the unbound ambient account and latest-session usage behavior', async () => {
    const h = harness();
    const a = h.add('a', false);
    expect(await h.probe.readAccount('a')).toEqual(account('a'));
    expect(await h.probe.readPlanUsage()).toEqual(usage);
    expect(a.readUsage).toHaveBeenCalledTimes(1);
    h.probe.dispose();
  });
});
