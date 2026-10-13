import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { PlanSecret } from '../plan-credential.source';
import {
  createOllamaCloudPlanUsageReader,
  OLLAMA_CLOUD_USAGE_TIMEOUT_MS,
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
      'https://ollama.com/api/usage',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result).toEqual({
      status: 'available',
      fetchedAt: 1,
      windowSetEstablished: false,
      windows: [],
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
      'https://ollama.com/api/usage',
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
});
