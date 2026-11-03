import 'reflect-metadata';
import type { KimiCodeRequestCredential } from '../../providers/kimi-code/kimi-code-provider.types';
import { KimiCodeHomeResolver } from '../../providers/kimi-code/kimi-code-home-resolver';
import { PlanSecret, type PlanCredentialResolution } from '../plan-credential.source';
import { cliStoreOwnerKey, credentialOwnerKey, quotaOwnerRefFromKey } from '../provider-owner.resolver';
import { createKimiCodePlanUsageReader, KIMI_CODE_USAGE_URL } from './kimi-code-plan-usage.reader';
import type { PlanOwnerTarget } from './plan-usage-reader.types';

const home = new KimiCodeHomeResolver('C:/test/kimi-home');
const oauthOwner = quotaOwnerRefFromKey(cliStoreOwnerKey('kimi-code', home.path));
const keyOwner = quotaOwnerRefFromKey(credentialOwnerKey('kimi-code', 'shared-key'));
const directOwner = quotaOwnerRefFromKey(credentialOwnerKey('kimi-code', 'direct-key'));
const body = {
  usages: {
    limit_5h: { used_ratio: 0.3, reset_time: '2026-11-01T05:00:00Z' },
    limit_7d: { used_ratio: '0.2', reset_time: '2026-11-07T00:00:00Z' },
    limit_month_total: { used_ratio: 0.4 },
    limit_month_code: { used_ratio: 0.25 },
  },
};
const main = (ownerRef = oauthOwner): PlanOwnerTarget => ({ providerId: 'kimi-code', ownerRef });
const lane = (ownerRef = directOwner): PlanOwnerTarget => ({
  providerId: 'kimi-code', ownerRef,
  credentialRef: { kind: 'ptah-cli-key', ptahCliId: 'kimi-1' },
});

function harness(options: {
  credential?: KimiCodeRequestCredential;
  slot?: PlanCredentialResolution;
  payload?: unknown;
  status?: number;
  fetchFails?: boolean;
} = {}) {
  const resolveRequestCredential = jest.fn<Promise<KimiCodeRequestCredential>, []>(
    async () => options.credential ?? { kind: 'oauth', accessToken: 'oauth-token' },
  );
  const forceRefresh = jest.fn(async () => true);
  const resolve = jest.fn(async () => options.slot ?? { kind: 'available' as const, secret: new PlanSecret('direct-key') });
  const fetcher = jest.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    if (options.fetchFails) throw new Error('network error with a token');
    return { status: options.status ?? 200, ok: (options.status ?? 200) === 200, json: async () => options.payload ?? body } as Response;
  });
  const reader = createKimiCodePlanUsageReader(
    { resolveRequestCredential, forceRefresh }, { resolve }, () => 1000, fetcher, home,
  );
  return { reader, resolveRequestCredential, forceRefresh, resolve, fetcher };
}

describe('Kimi Code plan usage reader', () => {
  it('maps all four windows and sends only the official Bearer request', async () => {
    const h = harness();
    const result = await h.reader({ target: main(), refresh: false });
    expect(result.status).toBe('available');
    expect(result.windows.map((value) => [value.key, value.used?.kind === 'percent' ? value.used.percent : undefined])).toEqual([
      ['five_hour', 30], ['weekly', 20], ['monthly', 40], ['other:monthly-code', 25],
    ]);
    expect(result.windows[0]).toMatchObject({
      durationMins: 300, usedSource: 'provider-api', resetSource: 'provider-api',
      resetsAt: Date.parse('2026-11-01T05:00:00Z'),
    });
    expect(h.fetcher).toHaveBeenCalledWith(KIMI_CODE_USAGE_URL, expect.objectContaining({
      method: 'GET', redirect: 'error',
      headers: { Authorization: 'Bearer oauth-token', Accept: 'application/json' },
    }));
  });

  it('omits absent monthly entries', async () => {
    const h = harness({ payload: { usages: { limit_5h: body.usages.limit_5h, limit_7d: body.usages.limit_7d } } });
    const result = await h.reader({ target: main(), refresh: false });
    expect(result.status).toBe('available');
    expect(result.windows.map((value) => value.key)).toEqual(['five_hour', 'weekly']);
  });

  it('treats an empty reset timestamp as absent', async () => {
    const h = harness({ payload: { usages: {
      limit_5h: { used_ratio: 0.3, reset_time: '' },
      limit_7d: body.usages.limit_7d,
    } } });
    const result = await h.reader({ target: main(), refresh: false });
    expect(result.status).toBe('available');
    expect(result.windows[0].resetsAt).toBeUndefined();
  });

  it.each([
    { usages: { limit_5h: { used_ratio: -1 }, limit_7d: body.usages.limit_7d } },
    { usages: { limit_5h: { used_ratio: 'NaN' }, limit_7d: body.usages.limit_7d } },
    { usages: { limit_5h: { used_ratio: null }, limit_7d: body.usages.limit_7d } },
    { usages: { limit_5h: { used_ratio: '' }, limit_7d: body.usages.limit_7d } },
    { usages: { limit_5h: { used_ratio: false }, limit_7d: body.usages.limit_7d } },
    { usages: { limit_5h: { used_ratio: '   ' }, limit_7d: body.usages.limit_7d } },
    { usages: { limit_5h: { used_ratio: 1.2 }, limit_7d: body.usages.limit_7d } },
    { usages: { limit_5h: { used_ratio: 0.2, reset_time: 'tomorrow' }, limit_7d: body.usages.limit_7d } },
    { usages: {} },
  ])('rejects malformed or contradictory usage', async (payload) => {
    const result = await harness({ payload }).reader({ target: main(), refresh: false });
    expect(result).toMatchObject({ status: 'service-unavailable', windowSetEstablished: false, windows: [] });
  });

  it('rejects positive legacy usage with a contradictory zero weekly ratio', async () => {
    const payload = {
      usages: { ...body.usages, limit_7d: { used_ratio: 0 } },
      usage: { used: 100, limit: 100 },
    };
    const result = await harness({ payload }).reader({ target: main(), refresh: false });
    expect(result.status).toBe('service-unavailable');
  });

  it('accepts positive legacy usage with an unrelated zero monthly-code window', async () => {
    const payload = {
      usages: { ...body.usages, limit_month_code: { used_ratio: 0 } },
      usage: { used: 100, limit: 100 },
    };
    const result = await harness({ payload }).reader({ target: main(), refresh: false });
    expect(result.status).toBe('available');
    expect(result.windows.find((entry) => entry.key === 'other:monthly-code')?.used).toEqual({
      kind: 'percent', percent: 0,
    });
  });

  it.each([null, '', false, '   '])('rejects malformed numeric value %p', async (used) => {
    const payload = { ...body, usage: { used } };
    const result = await harness({ payload }).reader({ target: main(), refresh: false });
    expect(result.status).toBe('service-unavailable');
  });

  it('accepts fractional and exponent numeric ratio strings', async () => {
    const payload = { usages: {
      ...body.usages,
      limit_5h: { used_ratio: '.5' },
      limit_7d: { used_ratio: '1e-1' },
    } };
    const result = await harness({ payload }).reader({ target: main(), refresh: false });
    expect(result.status).toBe('available');
    expect(result.windows.slice(0, 2).map((entry) => entry.used)).toEqual([
      { kind: 'percent', percent: 50 },
      { kind: 'percent', percent: 10 },
    ]);
  });

  it('prefers a direct lane key over the shared OAuth login', async () => {
    const h = harness();
    expect((await h.reader({ target: lane(), refresh: false })).status).toBe('available');
    expect(h.resolveRequestCredential).not.toHaveBeenCalled();
    expect(h.fetcher.mock.calls[0][1]?.headers).toEqual({ Authorization: 'Bearer direct-key', Accept: 'application/json' });
  });

  it.each(['unsupported-config', 'unsupported-auth'] as const)('uses shared OAuth after a missing or placeholder slot: %s', async (status) => {
    const h = harness({ slot: { kind: 'unavailable', status } });
    expect((await h.reader({ target: lane(oauthOwner), refresh: false })).status).toBe('available');
    expect(h.resolveRequestCredential).toHaveBeenCalledTimes(1);
  });

  it('does not use the shared connection after a failed slot read', async () => {
    const h = harness({ slot: { kind: 'unavailable', status: 'service-unavailable' } });
    expect((await h.reader({ target: lane(oauthOwner), refresh: false })).status).toBe('service-unavailable');
    expect(h.resolveRequestCredential).not.toHaveBeenCalled();
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it('rejects a changed lane key or a credential-kind mismatch', async () => {
    const changed = harness({ slot: { kind: 'available', secret: new PlanSecret('another-key') } });
    expect((await changed.reader({ target: lane(), refresh: false })).status).toBe('service-unavailable');
    const mismatch = harness({ credential: { kind: 'apiKey', apiKey: 'shared-key' } });
    expect((await mismatch.reader({ target: main(), refresh: false })).status).toBe('service-unavailable');
    expect(changed.fetcher).not.toHaveBeenCalled();
    expect(mismatch.fetcher).not.toHaveBeenCalled();
  });

  it('reads the shared provider API key under its own owner', async () => {
    const h = harness({ credential: { kind: 'apiKey', apiKey: 'shared-key' } });
    expect((await h.reader({ target: main(keyOwner), refresh: false })).status).toBe('available');
  });

  it('refreshes rejected OAuth once within the same request', async () => {
    const h = harness();
    h.resolveRequestCredential
      .mockResolvedValueOnce({ kind: 'oauth', accessToken: 'expired-token' })
      .mockResolvedValueOnce({ kind: 'oauth', accessToken: 'fresh-token' });
    h.fetcher
      .mockResolvedValueOnce({ status: 401, ok: false } as Response)
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => body } as Response);
    expect((await h.reader({ target: main(), refresh: false })).status).toBe('available');
    expect(h.forceRefresh).toHaveBeenCalledTimes(1);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(h.fetcher.mock.calls[1][1]?.headers).toEqual({
      Authorization: 'Bearer fresh-token', Accept: 'application/json',
    });
  });

  it('aborts a hanging request after eight seconds', async () => {
    jest.useFakeTimers();
    try {
      const h = harness();
      h.fetcher.mockImplementation((_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }));
      const pending = h.reader({ target: main(), refresh: false });
      await jest.advanceTimersByTimeAsync(8_000);
      expect((await pending).status).toBe('service-unavailable');
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns auth rejection and source failures without exposing a response body', async () => {
    for (const status of [401, 403]) {
      expect((await harness({ status, credential: { kind: 'apiKey', apiKey: 'shared-key' } }).reader({ target: main(keyOwner), refresh: false })).status).toBe('unsupported-auth');
    }
    expect((await harness({ status: 404 }).reader({ target: main(), refresh: false })).status).toBe('service-unavailable');
    expect((await harness({ fetchFails: true }).reader({ target: main(), refresh: false })).status).toBe('service-unavailable');
    expect((await harness({ payload: { usages: null } }).reader({ target: main(), refresh: false })).status).toBe('service-unavailable');
  });
});
