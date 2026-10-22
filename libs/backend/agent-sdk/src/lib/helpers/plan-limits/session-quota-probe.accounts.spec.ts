import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { ClaudeAccountNamedRoute } from '@ptah-extension/auth-providers-tokens';
import type { SessionId } from '@ptah-extension/shared';
import type {
  AccountInfo,
  Query,
} from '../../types/sdk-types/claude-sdk.types';
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
    expect(await h.probe.readAccount('a', route())).toEqual({
      status: 'available',
      value: account('a'),
    });
    expect(await h.probe.readAccount('b', route('b'))).toEqual({
      status: 'available',
      value: account('b'),
    });
    expect(await h.probe.readPlanUsage(undefined, route())).toEqual({
      status: 'available',
      value: usage,
    });
    expect(a.readUsage).toHaveBeenCalledWith({ skipBehaviors: true });
    expect(b.readUsage).not.toHaveBeenCalled();
    expect(await h.probe.readAccount('b', route())).toEqual({
      status: 'unavailable',
      code: 'account-mismatch',
    });
    h.probe.dispose();
  });

  it('returns closed unavailable codes for missing bindings, sessions, and control methods', async () => {
    const h = harness();
    h.add('a', false);
    expect(await h.probe.readAccount('a', route())).toEqual({
      status: 'unavailable',
      code: 'account-mismatch',
    });
    expect(await h.probe.readPlanUsage(undefined, route())).toEqual({
      status: 'unavailable',
      code: 'no-open-session',
    });
    expect(await h.probe.readAccount('missing', route())).toEqual({
      status: 'unavailable',
      code: 'no-open-session',
    });
    h.registry.bindAccountRoute('a', route());
    h.registry.setSessionQuery(
      'a' as SessionId,
      partialMock<Query>({ close: jest.fn() }),
    );
    expect(await h.probe.readAccount('a', route())).toEqual({
      status: 'unavailable',
      code: 'service-unavailable',
    });
    expect(await h.probe.readPlanUsage('a', route())).toEqual({
      status: 'unavailable',
      code: 'service-unavailable',
    });
    h.probe.dispose();
    expect(await h.probe.readAccount('a', route())).toEqual({
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
    const first = h.probe.readAccount('a', route());
    const second = h.probe.readAccount('a', route());
    expect(a.accountInfo).toHaveBeenCalledTimes(1);
    h.probe.invalidateAccountRoute(route('a', 2));
    resolve(account('stale'));
    const unavailable = { status: 'unavailable', code: 'stale-epoch' };
    expect(await first).toEqual(unavailable);
    expect(await second).toEqual(unavailable);
    expect(await h.probe.readAccount('a', route())).toEqual(unavailable);
    expect(await h.probe.readAccount('a', route('a', 2))).toEqual({
      status: 'unavailable',
      code: 'account-mismatch',
    });
    h.probe.dispose();
  });

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
    const pending = h.probe.readPlanUsage('a', route());
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
    expect(await h.probe.readAccount('a', route())).toEqual({
      status: 'unavailable',
      code: 'service-unavailable',
    });
    a.accountInfo.mockImplementation(() => new Promise(() => undefined));
    const pending = h.probe.readAccount('a', route());
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
