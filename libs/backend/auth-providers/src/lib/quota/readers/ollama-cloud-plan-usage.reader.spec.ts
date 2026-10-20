import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { PlanSecret } from '../plan-credential.source';
import {
  createOllamaCloudPlanUsageReader,
  OLLAMA_CLOUD_BALANCE_URL,
  OLLAMA_CLOUD_CACHE_MS,
  OLLAMA_CLOUD_USAGE_TIMEOUT_MS,
  OLLAMA_CLOUD_USAGE_URL,
} from './ollama-cloud-plan-usage.reader';
import type { PlanOwnerTarget } from './plan-usage-reader.types';

// Placeholder keys are rejected upstream by plan-credential.source.ts before
// this reader is called, so this fixture always represents a usable secret.
const API_KEY = 'ollama-private-api-key';
const TARGET = {
  providerId: 'ollama-cloud',
  ownerRef: {
    key: 'ollama-cloud#credential:0123456789abcdef',
    providerId: 'ollama-cloud',
    identityKind: 'credential',
    label: 'Ollama Cloud API key',
  },
} as PlanOwnerTarget;
// The real ollama.com/api/usage body: request-count buckets, no quota/limit.
const USAGE_PAYLOAD = {
  range: '7d',
  scope: 'self',
  granularity: 'day',
  totals: { request_count: 2588 },
  buckets: [{ from: '2026-10-06T00:00:00Z', request_count: 793 }],
};

function loggerCalls(logger: Record<string, unknown>): string {
  return JSON.stringify(
    Object.values(logger)
      .filter(jest.isMockFunction)
      .flatMap((method) => method.mock.calls),
  );
}

describe('Ollama Cloud plan-usage reader', () => {
  it('F33: a working key reports its request count and never logs the key', async () => {
    const rawLogger = createMockLogger() as unknown as Record<string, unknown>;
    const fetcher = jest.fn(
      async () => new Response(JSON.stringify(USAGE_PAYLOAD), { status: 200 }),
    );
    const reader = createOllamaCloudPlanUsageReader(
      rawLogger as unknown as Logger,
      () => 1,
      fetcher,
    );
    const result = await reader({
      target: TARGET,
      credential: new PlanSecret(API_KEY),
      refresh: true,
    });
    expect(fetcher).toHaveBeenCalledWith(
      OLLAMA_CLOUD_USAGE_URL,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result).toEqual({
      status: 'available',
      fetchedAt: 1,
      windowSetEstablished: false,
      windows: [],
      statusReason: 'balance-unavailable',
      localUsage: {
        kind: 'local-usage',
        label: 'Ollama Cloud requests',
        tokens: 0,
        estimatedCostUsd: 0,
        requests: 2588,
        observedAt: 1,
        source: 'provider-api',
        range: 'last 7 days',
      },
    });
    expect(loggerCalls(rawLogger)).not.toContain(API_KEY);
  });

  it.each([
    ['an unparseable body', 'not json'],
    ['a body without request totals', JSON.stringify({ range: '7d' })],
    ['an oversized body', 'x'.repeat(256 * 1024 + 1)],
  ])(
    'an authenticated 200 with %s is a service failure, not an absent source',
    async (_, body) => {
      const fetcher = jest.fn(async () => new Response(body, { status: 200 }));
      const reader = createOllamaCloudPlanUsageReader(
        createMockLogger() as unknown as Logger,
        () => 1,
        fetcher,
      );
      await expect(
        reader({
          target: TARGET,
          credential: new PlanSecret(API_KEY),
          refresh: true,
        }),
      ).resolves.toEqual({
        status: 'service-unavailable',
        windowSetEstablished: false,
        windows: [],
      });
    },
  );

  it('keeps an unrecognised range code verbatim', async () => {
    const fetcher = jest.fn(
      async () =>
        new Response(
          JSON.stringify({ range: '90d', totals: { request_count: 3 } }),
          { status: 200 },
        ),
    );
    const reader = createOllamaCloudPlanUsageReader(
      createMockLogger() as unknown as Logger,
      () => 1,
      fetcher,
    );
    const result = await reader({
      target: TARGET,
      credential: new PlanSecret(API_KEY),
      refresh: true,
    });
    expect(result.localUsage).toMatchObject({ requests: 3, range: '90d' });
  });

  it('missing credential maps to unsupported-config without fetching', async () => {
    const fetcher = jest.fn();
    const reader = createOllamaCloudPlanUsageReader(
      createMockLogger() as unknown as Logger,
      () => 1,
      fetcher as typeof fetch,
    );
    await expect(
      reader({ target: TARGET, credential: undefined, refresh: true }),
    ).resolves.toEqual({
      status: 'unsupported-config',
      windowSetEstablished: false,
      windows: [],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps a non-ok HTTP response to service-unavailable', async () => {
    const reader = createOllamaCloudPlanUsageReader(
      createMockLogger() as unknown as Logger,
      () => 1,
      jest.fn(async () => new Response('', { status: 503 })),
    );
    await expect(
      reader({
        target: TARGET,
        credential: new PlanSecret(API_KEY),
        refresh: true,
      }),
    ).resolves.toEqual({
      status: 'service-unavailable',
      windowSetEstablished: false,
      windows: [],
    });
  });

  it.each([401, 403])(
    'maps a rejected API key (HTTP %i) to unsupported-auth',
    async (status) => {
      const reader = createOllamaCloudPlanUsageReader(
        createMockLogger() as unknown as Logger,
        () => 1,
        jest.fn(async () => new Response('', { status })),
      );
      await expect(
        reader({
          target: TARGET,
          credential: new PlanSecret(API_KEY),
          refresh: true,
        }),
      ).resolves.toEqual({
        status: 'unsupported-auth',
        windowSetEstablished: false,
        windows: [],
      });
    },
  );

  it('maps HTTP 404 to no-usage-source', async () => {
    const reader = createOllamaCloudPlanUsageReader(
      createMockLogger() as unknown as Logger,
      () => 1,
      jest.fn(async () => new Response('', { status: 404 })),
    );
    await expect(
      reader({
        target: TARGET,
        credential: new PlanSecret(API_KEY),
        refresh: true,
      }),
    ).resolves.toMatchObject({ status: 'no-usage-source', windows: [] });
  });

  it('never lets the bearer header follow a redirect', async () => {
    const fetcher = jest.fn(async (_url: string, init?: RequestInit) => {
      if (init?.redirect === 'error') throw new TypeError('redirect refused');
      return new Response(JSON.stringify(USAGE_PAYLOAD), { status: 200 });
    });
    const reader = createOllamaCloudPlanUsageReader(
      createMockLogger() as unknown as Logger,
      () => 1,
      fetcher as unknown as typeof fetch,
    );
    await expect(
      reader({
        target: TARGET,
        credential: new PlanSecret(API_KEY),
        refresh: true,
      }),
    ).resolves.toEqual({
      status: 'service-unavailable',
      windowSetEstablished: false,
      windows: [],
    });
    expect(fetcher).toHaveBeenCalledWith(
      OLLAMA_CLOUD_USAGE_URL,
      expect.objectContaining({ redirect: 'error' }),
    );
  });

  it('honours an already-aborted caller signal without fetching', async () => {
    const fetcher = jest.fn();
    const controller = new AbortController();
    controller.abort();
    const reader = createOllamaCloudPlanUsageReader(
      createMockLogger() as unknown as Logger,
      () => 1,
      fetcher as typeof fetch,
    );
    await expect(
      reader({
        target: TARGET,
        credential: new PlanSecret(API_KEY),
        refresh: true,
        signal: controller.signal,
      }),
    ).resolves.toEqual({
      status: 'service-unavailable',
      windowSetEstablished: false,
      windows: [],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps a request timeout to service-unavailable and restores real timers', async () => {
    jest.useFakeTimers();
    try {
      const fetcher = jest.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) =>
            init?.signal?.addEventListener('abort', () =>
              reject(new Error('aborted')),
            ),
          ),
      );
      const reader = createOllamaCloudPlanUsageReader(
        createMockLogger() as unknown as Logger,
        () => 1,
        fetcher as typeof fetch,
      );
      const pending = reader({
        target: TARGET,
        credential: new PlanSecret(API_KEY),
        refresh: true,
      });
      await jest.advanceTimersByTimeAsync(OLLAMA_CLOUD_USAGE_TIMEOUT_MS);
      await expect(pending).resolves.toEqual({
        status: 'service-unavailable',
        windowSetEstablished: false,
        windows: [],
      });
    } finally {
      jest.useRealTimers();
    }
  });

  describe('/api/balance', () => {
    const RESET = '2026-10-27T00:00:00Z';
    function route(
      balance: () => Response,
      usage: () => Response = () =>
        new Response(JSON.stringify(USAGE_PAYLOAD), { status: 200 }),
    ) {
      return jest.fn(async (url: string) =>
        url === OLLAMA_CLOUD_BALANCE_URL ? balance() : usage(),
      );
    }
    function run(fetcher: jest.Mock, now: () => number = () => 1) {
      return createOllamaCloudPlanUsageReader(
        createMockLogger() as unknown as Logger,
        now,
        fetcher as unknown as typeof fetch,
      )({
        target: TARGET,
        credential: new PlanSecret(API_KEY),
        refresh: true,
      });
    }
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status });

    it('maps the legacy session/weekly shape to used percent', async () => {
      const result = await run(
        route(() =>
          json({
            included: {
              session: { remaining_percent: 75, resets_at: RESET },
              weekly: { remaining_percent: 40.5, resets_at: RESET },
            },
            purchased: { balance_usd: 12.5 },
          }),
        ),
      );
      expect(result.status).toBe('available');
      expect(result.windowSetEstablished).toBe(true);
      expect(result.windows).toMatchObject([
        {
          key: 'other:session',
          used: { kind: 'percent', percent: 25 },
          resetsAt: Date.parse(RESET),
        },
        {
          key: 'weekly',
          used: { kind: 'percent', percent: 59.5 },
          resetsAt: Date.parse(RESET),
        },
      ]);
      // Purchased USD is an amount and never becomes a window.
      expect(result.windows).toHaveLength(2);
      expect(result.localUsage?.requests).toBe(2588);
    });

    it.each([
      ['top-level', (b: object) => b],
      ['included-nested', (b: object) => ({ included: b })],
    ])(
      'maps a positive credit allowance (%s) to a monthly window',
      async (_, wrap) => {
        const result = await run(
          route(() =>
            json(
              wrap({
                balance_usd: 15,
                allowance_usd: 60,
                period: { from: '2026-10-01T00:00:00Z', until: RESET },
              }),
            ),
          ),
        );
        expect(result.windows).toMatchObject([
          {
            key: 'monthly',
            kind: 'monthly',
            used: { kind: 'percent', percent: 75 },
            resetsAt: Date.parse(RESET),
          },
        ]);
      },
    );

    it('emits no percentage for a zero allowance, only the usage counts', async () => {
      const result = await run(
        route(() => json({ balance_usd: 4, allowance_usd: 0 })),
      );
      expect(result.windows).toEqual([]);
      expect(result.windowSetEstablished).toBe(false);
      expect(result.localUsage?.requests).toBe(2588);
    });

    it('carries per-model request detail without a percentage', async () => {
      const result = await run(
        route(
          () => json({ included: {} }),
          () =>
            json({
              range: '7d',
              totals: {
                request_count: 300,
                groups: [
                  { model: 'a', request_count: 100 },
                  { model: 'b', request_count: 200 },
                ],
              },
            }),
        ),
      );
      expect(result.windows).toEqual([]);
      expect(result.localUsage?.models).toEqual([
        { model: 'b', requests: 200 },
        { model: 'a', requests: 100 },
      ]);
    });

    it.each([
      [
        'an out-of-range percentage',
        { included: { session: { remaining_percent: 140, resets_at: RESET } } },
      ],
      [
        'an invalid date',
        { included: { weekly: { remaining_percent: 50, resets_at: 'soon' } } },
      ],
    ])('rejects %s and keeps the usage counts', async (_, body) => {
      const result = await run(route(() => json(body)));
      expect(result.windows).toEqual([]);
      expect(result.status).toBe('available');
      expect(result.localUsage?.requests).toBe(2588);
    });

    it('keeps balance windows when /api/usage fails', async () => {
      const result = await run(
        route(
          () =>
            json({
              included: { weekly: { remaining_percent: 10, resets_at: RESET } },
            }),
          () => new Response('', { status: 503 }),
        ),
      );
      expect(result.status).toBe('available');
      expect(result.windows).toHaveLength(1);
      expect(result.localUsage).toBeUndefined();
    });

    it.each([
      [401, 'unsupported-auth'],
      [403, 'unsupported-auth'],
      [429, 'service-unavailable'],
      [503, 'service-unavailable'],
    ])(
      'maps balance HTTP %i with a failing usage to %s',
      async (status, expected) => {
        const result = await run(
          route(
            () => new Response('', { status }),
            () => new Response('', { status }),
          ),
        );
        expect(result.status).toBe(expected);
        expect(result.windows).toEqual([]);
      },
    );

    const WEEKLY = {
      included: { weekly: { remaining_percent: 10, resets_at: RESET } },
    };

    it.each([
      [401, 'balance-auth-rejected'],
      [403, 'balance-auth-rejected'],
      [429, 'balance-unavailable'],
      [503, 'balance-unavailable'],
    ])(
      'balance HTTP %i with usage OK stays available and says %s',
      async (status, reason) => {
        const result = await run(route(() => new Response('', { status })));
        expect(result.status).toBe('available');
        expect(result.windows).toEqual([]);
        expect(result.localUsage?.requests).toBe(2588);
        expect(result.statusReason).toBe(reason);
      },
    );

    it('an unreadable balance body with usage OK says balance-unavailable', async () => {
      const result = await run(route(() => new Response('nope')));
      expect(result.statusReason).toBe('balance-unavailable');
    });

    it.each([401, 403])(
      'usage HTTP %i with balance OK keeps the windows and says usage-auth-rejected',
      async (status) => {
        const result = await run(
          route(
            () => json(WEEKLY),
            () => new Response('', { status }),
          ),
        );
        expect(result.status).toBe('available');
        expect(result.windows).toHaveLength(1);
        expect(result.localUsage).toBeUndefined();
        expect(result.statusReason).toBe('usage-auth-rejected');
      },
    );

    it('a healthy pair carries no statusReason', async () => {
      const result = await run(route(() => json(WEEKLY)));
      expect(result.statusReason).toBeUndefined();
    });

    it('a body over the cap is cancelled mid-stream, not buffered', async () => {
      let cancelled = false;
      let pulls = 0;
      const chunk = new Uint8Array(100 * 1024).fill(120);
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          controller.enqueue(chunk);
        },
        cancel() {
          cancelled = true;
        },
      });
      const result = await run(
        route(
          () => new Response(body, { status: 200 }),
          () => new Response('', { status: 503 }),
        ),
      );
      expect(cancelled).toBe(true);
      expect(pulls).toBeLessThan(10);
      expect(result.status).toBe('service-unavailable');
    });

    it('429 on one endpoint only delays that endpoint', async () => {
      let clock = 1_000;
      let usageStatus = 429;
      const fetcher = jest.fn(async (url: string) => {
        if (url === OLLAMA_CLOUD_BALANCE_URL) return json(WEEKLY);
        return usageStatus === 429
          ? new Response('', {
              status: 429,
              headers: { 'retry-after': '300' },
            })
          : new Response(JSON.stringify(USAGE_PAYLOAD), { status: 200 });
      });
      const reader = createOllamaCloudPlanUsageReader(
        createMockLogger() as unknown as Logger,
        () => clock,
        fetcher as unknown as typeof fetch,
      );
      const request = {
        target: TARGET,
        credential: new PlanSecret(API_KEY),
        refresh: true,
      };
      const calls = (u: string) =>
        fetcher.mock.calls.filter(([url]) => url === u).length;
      expect((await reader(request)).windows).toHaveLength(1);
      // Balance's own 60 s cooldown elapses; usage is still backing off.
      clock += OLLAMA_CLOUD_CACHE_MS + 1;
      usageStatus = 200;
      await reader(request);
      expect(calls(OLLAMA_CLOUD_BALANCE_URL)).toBe(2);
      expect(calls(OLLAMA_CLOUD_USAGE_URL)).toBe(1);
      // After the Retry-After the recovered endpoint is fetched again.
      clock += 300_000;
      const recovered = await reader(request);
      expect(calls(OLLAMA_CLOUD_USAGE_URL)).toBe(2);
      expect(recovered.localUsage?.requests).toBe(2588);
    });

    it('concurrent reads of one owner share one request pair', async () => {
      const fetcher = route(() => json(WEEKLY));
      const reader = createOllamaCloudPlanUsageReader(
        createMockLogger() as unknown as Logger,
        () => 1,
        fetcher as unknown as typeof fetch,
      );
      const request = {
        target: TARGET,
        credential: new PlanSecret(API_KEY),
        refresh: true,
      };
      await Promise.all([reader(request), reader(request), reader(request)]);
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('serves a cached reading for 60 s, then refetches', async () => {
      let clock = 1_000;
      const fetcher = route(() => json({ included: {} }));
      const reader = createOllamaCloudPlanUsageReader(
        createMockLogger() as unknown as Logger,
        () => clock,
        fetcher as unknown as typeof fetch,
      );
      const request = {
        target: TARGET,
        credential: new PlanSecret(API_KEY),
        refresh: true,
      };
      await reader(request);
      clock += OLLAMA_CLOUD_CACHE_MS - 1;
      await reader(request);
      expect(fetcher).toHaveBeenCalledTimes(2);
      clock += 2;
      await reader(request);
      expect(fetcher).toHaveBeenCalledTimes(4);
    });
  });
});
