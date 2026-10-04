import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  AuthEnv,
  ContextCapacityRoute,
  SessionId,
} from '@ptah-extension/shared';
import type { AccountInfo } from '../../types/sdk-types/claude-sdk.types';
import type { SessionRecord } from '../session-lifecycle/session-registry.service';
import { SdkAdapterEvents } from '../sdk-adapter-events.service';
import { SessionPlanLimitCallbackRegistry } from './session-plan-limit-callback-registry';
import {
  SESSION_QUOTA_PROBE_TIMEOUT_MS,
  SessionQuotaProbeService,
  type ClaudePlanUsage,
  type QuotaProbeSessionSource,
} from './session-quota-probe.service';

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

const ACCOUNT_A: AccountInfo = {
  email: 'a@example.test',
  organization: 'org-a',
  subscriptionType: 'max',
  apiProvider: 'firstParty',
};
const ACCOUNT_B: AccountInfo = {
  email: 'b@example.test',
  organization: 'org-b',
  subscriptionType: 'pro',
  apiProvider: 'firstParty',
};

const API_KEY_USAGE = {
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
} as unknown as ClaudePlanUsage;

interface FakeQuery {
  accountInfo?: jest.Mock<Promise<AccountInfo>, []>;
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?: jest.Mock<
    Promise<ClaudePlanUsage>,
    [{ skipBehaviors?: boolean }?]
  >;
}

function fakeQuery(...accounts: AccountInfo[]): FakeQuery & {
  accountInfo: jest.Mock<Promise<AccountInfo>, []>;
} {
  const accountInfo = jest.fn<Promise<AccountInfo>, []>();
  for (const account of accounts) accountInfo.mockResolvedValueOnce(account);
  return { accountInfo };
}

interface FakeRecordOptions {
  readonly tabId?: string;
  readonly realSessionId?: string | null;
  readonly query?: FakeQuery | null;
  readonly route?: ContextCapacityRoute;
  readonly authEnv?: AuthEnv;
}

function fakeRecord(options: FakeRecordOptions = {}): SessionRecord {
  return {
    tabId: options.tabId ?? 'tab-1',
    realSessionId: options.realSessionId ?? null,
    query: (options.query ?? null) as SessionRecord['query'],
    capacityRoute: options.route ?? { kind: 'native', providerId: 'anthropic' },
    accountingAuthEnv: options.authEnv ?? {},
  } as unknown as SessionRecord;
}

/** A session source that resolves tabId and real id to the same record. */
class FakeSessions implements QuotaProbeSessionSource {
  readonly records: SessionRecord[] = [];

  add(record: SessionRecord): SessionRecord {
    this.records.push(record);
    return record;
  }

  find(idOrTabId: string): SessionRecord | undefined {
    return this.records.find(
      (r) => r.tabId === idOrTabId || r.realSessionId === idOrTabId,
    );
  }

  getActiveSessionIds(): SessionId[] {
    return this.records.map((r) => (r.realSessionId ?? r.tabId) as SessionId);
  }
}

function setup() {
  const logger = makeLogger();
  const sessions = new FakeSessions();
  const planLimits = new SessionPlanLimitCallbackRegistry(logger);
  const adapterEvents = new SdkAdapterEvents(logger);
  const probe = new SessionQuotaProbeService(
    logger,
    sessions,
    planLimits,
    adapterEvents,
  );
  const turnStart = (sessionId: string): void =>
    planLimits.notifyAll({
      sessionId,
      signal: { kind: 'turn-start', observedAt: 1 },
    });
  const turnFailed = (
    sessionId: string,
    error: Parameters<SdkAdapterEvents['emitTurnFailed']>[0]['error'],
  ): void =>
    adapterEvents.emitTurnFailed({
      sessionId,
      cwd: '/w',
      lastAssistantMessage: null,
      error,
      errorDetails: null,
      terminalReason: null,
      timestamp: 1,
    });
  return {
    logger,
    sessions,
    planLimits,
    adapterEvents,
    probe,
    turnStart,
    turnFailed,
  };
}

/** Let fire-and-forget reads settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('SessionQuotaProbeService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('readAccount', () => {
    it('reads once per turn and serves the cached result within the turn', async () => {
      const { sessions, probe } = setup();
      const query = fakeQuery(ACCOUNT_A);
      sessions.add(fakeRecord({ query }));

      await expect(probe.readAccount('tab-1')).resolves.toEqual(ACCOUNT_A);
      await expect(probe.readAccount('tab-1')).resolves.toEqual(ACCOUNT_A);
      expect(query.accountInfo).toHaveBeenCalledTimes(1);
    });

    it('F77/G2: two consecutive turns with different accountInfo() results yield two different reads', async () => {
      const { sessions, probe, turnStart } = setup();
      const query = fakeQuery(ACCOUNT_A, ACCOUNT_B);
      sessions.add(fakeRecord({ query, realSessionId: 'sess-real' }));

      turnStart('tab-1');
      await expect(probe.readAccount('tab-1')).resolves.toEqual(ACCOUNT_A);

      // Next turn: the signal now carries the real id; the same record answers.
      turnStart('sess-real');
      await expect(probe.readAccount('sess-real')).resolves.toEqual(ACCOUNT_B);
      expect(query.accountInfo).toHaveBeenCalledTimes(2);
    });

    it('turn-start on a native route starts the read without being awaited', async () => {
      const { sessions, probe, turnStart } = setup();
      const query = fakeQuery(ACCOUNT_A);
      sessions.add(fakeRecord({ query }));

      turnStart('tab-1');
      expect(query.accountInfo).toHaveBeenCalledTimes(1);
      await flush();
      await expect(probe.readAccount('tab-1')).resolves.toEqual(ACCOUNT_A);
      expect(query.accountInfo).toHaveBeenCalledTimes(1);
    });

    it('turn-start on a proxy route drops the cache but does not prefetch', async () => {
      const { sessions, probe, turnStart } = setup();
      const query = fakeQuery(ACCOUNT_A, ACCOUNT_B);
      sessions.add(
        fakeRecord({
          query,
          route: { kind: 'proxy', providerId: 'openai-codex' },
        }),
      );

      await probe.readAccount('tab-1');
      turnStart('tab-1');
      expect(query.accountInfo).toHaveBeenCalledTimes(1);
      await expect(probe.readAccount('tab-1')).resolves.toEqual(ACCOUNT_B);
    });

    it('F77: query replacement drops the cached account', async () => {
      const { sessions, probe } = setup();
      const first = fakeQuery(ACCOUNT_A);
      const record = sessions.add(fakeRecord({ query: first }));
      await expect(probe.readAccount('tab-1')).resolves.toEqual(ACCOUNT_A);

      const second = fakeQuery(ACCOUNT_B);
      record.query = second as unknown as SessionRecord['query'];

      await expect(probe.readAccount('tab-1')).resolves.toEqual(ACCOUNT_B);
      expect(first.accountInfo).toHaveBeenCalledTimes(1);
      expect(second.accountInfo).toHaveBeenCalledTimes(1);
    });

    it.each([
      'authentication_failed',
      'oauth_org_not_allowed',
      'account_on_hold',
    ] as const)(
      'F77: an assistant %s error drops the cached account',
      async (error) => {
        const { sessions, probe, turnFailed } = setup();
        const query = fakeQuery(ACCOUNT_A, ACCOUNT_B);
        sessions.add(fakeRecord({ query, realSessionId: 'sess-real' }));
        await probe.readAccount('tab-1');

        turnFailed('sess-real', error);

        await expect(probe.readAccount('tab-1')).resolves.toEqual(ACCOUNT_B);
        expect(query.accountInfo).toHaveBeenCalledTimes(2);
      },
    );

    it('other turn failures keep the cached account', async () => {
      const { sessions, probe, turnFailed } = setup();
      const query = fakeQuery(ACCOUNT_A, ACCOUNT_B);
      sessions.add(fakeRecord({ query }));
      await probe.readAccount('tab-1');

      turnFailed('tab-1', 'rate_limit');

      await expect(probe.readAccount('tab-1')).resolves.toEqual(ACCOUNT_A);
      expect(query.accountInfo).toHaveBeenCalledTimes(1);
    });

    it('returns null for an unknown session or a record with no query', async () => {
      const { sessions, probe } = setup();
      sessions.add(fakeRecord({ query: null }));

      await expect(probe.readAccount('nope')).resolves.toBeNull();
      await expect(probe.readAccount('tab-1')).resolves.toBeNull();
    });

    it('returns null when the query lacks accountInfo', async () => {
      const { sessions, probe } = setup();
      sessions.add(fakeRecord({ query: {} }));

      await expect(probe.readAccount('tab-1')).resolves.toBeNull();
    });

    it('returns null on rejection, does not cache the failure, and logs no error text', async () => {
      const { sessions, probe, logger } = setup();
      const query = fakeQuery();
      query.accountInfo
        .mockRejectedValueOnce(new Error('secret-ish detail a@example.test'))
        .mockResolvedValueOnce(ACCOUNT_A);
      sessions.add(fakeRecord({ query }));

      await expect(probe.readAccount('tab-1')).resolves.toBeNull();
      await expect(probe.readAccount('tab-1')).resolves.toEqual(ACCOUNT_A);
      const logged = JSON.stringify(logger.debug.mock.calls);
      expect(logged).toContain('"failure":"rejected"');
      expect(logged).not.toContain('a@example.test');
      expect(logged).not.toContain('org-a');
    });

    it('returns null after the 3 s timeout', async () => {
      jest.useFakeTimers();
      const { sessions, probe } = setup();
      const query = fakeQuery();
      query.accountInfo.mockReturnValue(
        new Promise<AccountInfo>(() => undefined),
      );
      sessions.add(fakeRecord({ query }));

      const read = probe.readAccount('tab-1');
      jest.advanceTimersByTime(SESSION_QUOTA_PROBE_TIMEOUT_MS - 1);
      let settled = false;
      void read.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      jest.advanceTimersByTime(1);
      await expect(read).resolves.toBeNull();
    });

    it('logs only presence flags for a successful read', async () => {
      const { sessions, probe, logger } = setup();
      sessions.add(fakeRecord({ query: fakeQuery(ACCOUNT_A) }));

      await probe.readAccount('tab-1');

      const logged = JSON.stringify(logger.debug.mock.calls);
      expect(logged).toContain('"hasEmail":true');
      expect(logged).not.toContain('a@example.test');
      expect(logged).not.toContain('org-a');
      expect(logged).not.toContain('max');
    });

    it('releases both subscriptions on dispose', () => {
      const { probe, planLimits, adapterEvents } = setup();
      expect(planLimits.size).toBe(1);
      expect(adapterEvents.listenerCount('turnFailed')).toBe(1);

      probe.dispose();

      expect(planLimits.size).toBe(0);
      expect(adapterEvents.listenerCount('turnFailed')).toBe(0);
    });

    it('D4: does not subscribe to authFileChanged or configChanged', () => {
      const { adapterEvents } = setup();
      expect(adapterEvents.listenerCount('authFileChanged')).toBe(0);
      expect(adapterEvents.listenerCount('configChanged')).toBe(0);
    });
  });

  describe('readPlanUsage', () => {
    it('API key: passes rate_limits_available=false through with skipBehaviors', async () => {
      const { sessions, probe } = setup();
      const usage = jest
        .fn<Promise<ClaudePlanUsage>, [{ skipBehaviors?: boolean }?]>()
        .mockResolvedValue(API_KEY_USAGE);
      sessions.add(
        fakeRecord({
          query: {
            usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: usage,
          },
          authEnv: { ANTHROPIC_API_KEY: 'sk-test' },
        }),
      );

      const result = await probe.readPlanUsage('tab-1');

      expect(result?.rate_limits_available).toBe(false);
      expect(result?.rate_limits).toBeNull();
      expect(usage).toHaveBeenCalledWith({ skipBehaviors: true });
    });

    it('without an id uses the most recently active direct-Anthropic session', async () => {
      const { sessions, probe } = setup();
      const proxyUsage = jest.fn();
      const nativeUsage = jest
        .fn<Promise<ClaudePlanUsage>, [{ skipBehaviors?: boolean }?]>()
        .mockResolvedValue(API_KEY_USAGE);
      sessions.add(
        fakeRecord({
          tabId: 'tab-proxy',
          route: { kind: 'proxy', providerId: 'openrouter' },
          query: {
            usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET:
              proxyUsage,
          },
        }),
      );
      sessions.add(fakeRecord({ tabId: 'tab-no-query', query: null }));
      sessions.add(
        fakeRecord({
          tabId: 'tab-native',
          query: {
            usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET:
              nativeUsage,
          },
        }),
      );

      await expect(probe.readPlanUsage()).resolves.toBe(API_KEY_USAGE);
      expect(proxyUsage).not.toHaveBeenCalled();
      expect(nativeUsage).toHaveBeenCalledTimes(1);
    });

    it('returns null for a proxy session, no live session, or a timeout', async () => {
      jest.useFakeTimers();
      const { sessions, probe } = setup();
      await expect(probe.readPlanUsage()).resolves.toBeNull();

      sessions.add(
        fakeRecord({
          tabId: 'tab-proxy',
          route: { kind: 'proxy', providerId: 'openrouter' },
          query: {},
        }),
      );
      await expect(probe.readPlanUsage('tab-proxy')).resolves.toBeNull();

      sessions.add(
        fakeRecord({
          tabId: 'tab-slow',
          query: {
            usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: jest
              .fn()
              .mockReturnValue(new Promise(() => undefined)),
          },
        }),
      );
      const slow = probe.readPlanUsage('tab-slow');
      await Promise.resolve();
      jest.advanceTimersByTime(SESSION_QUOTA_PROBE_TIMEOUT_MS);
      await expect(slow).resolves.toBeNull();
    });

    it('is never called by turn-start', async () => {
      const { sessions, turnStart } = setup();
      const usage = jest.fn();
      sessions.add(
        fakeRecord({
          query: {
            ...fakeQuery(ACCOUNT_A),
            usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: usage,
          },
        }),
      );

      turnStart('tab-1');
      await flush();

      expect(usage).not.toHaveBeenCalled();
    });
  });

  describe('sessionRoute', () => {
    it.each<[string, Partial<FakeRecordOptions>, unknown]>([
      [
        'native subscription',
        {},
        { providerId: 'anthropic', routeKind: 'native' },
      ],
      [
        'direct API key',
        { authEnv: { ANTHROPIC_API_KEY: 'sk-test' } },
        { providerId: 'anthropic', routeKind: 'direct-key' },
      ],
      [
        'blank API key stays native',
        { authEnv: { ANTHROPIC_API_KEY: '  ' } },
        { providerId: 'anthropic', routeKind: 'native' },
      ],
      [
        'known proxy',
        { route: { kind: 'proxy', providerId: 'ollama-cloud' } },
        { providerId: 'ollama-cloud', routeKind: 'proxy' },
      ],
      [
        'unknown proxy',
        { route: { kind: 'proxy', providerId: null } },
        { providerId: null, routeKind: 'proxy' },
      ],
    ])('%s', (_name, options, expected) => {
      const { sessions, probe } = setup();
      sessions.add(fakeRecord(options));
      expect(probe.sessionRoute('tab-1')).toEqual(expected);
    });

    it('reports unknown when the record carries no route, null for no record', () => {
      const { sessions, probe } = setup();
      const record = fakeRecord();
      (record as { capacityRoute?: ContextCapacityRoute }).capacityRoute =
        undefined;
      sessions.add(record);

      expect(probe.sessionRoute('tab-1')).toEqual({
        providerId: null,
        routeKind: 'unknown',
      });
      expect(probe.sessionRoute('missing')).toBeNull();
    });

    it('never exposes a credential', () => {
      const { sessions, probe } = setup();
      sessions.add(fakeRecord({ authEnv: { ANTHROPIC_API_KEY: 'sk-secret' } }));
      expect(JSON.stringify(probe.sessionRoute('tab-1'))).not.toContain(
        'sk-secret',
      );
    });
  });
});
