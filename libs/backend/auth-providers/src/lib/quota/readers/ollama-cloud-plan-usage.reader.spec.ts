import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { PlanSecret } from '../plan-credential.source';
import {
  createOllamaCloudPlanUsageReader,
  OLLAMA_CLOUD_USAGE_TIMEOUT_MS,
} from './ollama-cloud-plan-usage.reader';
import type { PlanOwnerTarget } from './plan-usage-reader.types';

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
const PROVISIONAL_PAYLOAD = {
  session: { percentage: 20, resets_at: '2026-10-05T12:00:00Z' },
  weekly: { percentage: 40, resets_at: null },
};

function loggerCalls(logger: Record<string, unknown>): string {
  return JSON.stringify(
    Object.values(logger)
      .filter(jest.isMockFunction)
      .flatMap((method) => method.mock.calls),
  );
}

describe('Ollama Cloud plan-usage reader', () => {
  it('F33: maps provisional valid data and never logs the API key', async () => {
    const rawLogger = createMockLogger() as unknown as Record<string, unknown>;
    const fetcher = jest.fn(
      async () =>
        new Response(JSON.stringify(PROVISIONAL_PAYLOAD), { status: 200 }),
    );
    const reader = createOllamaCloudPlanUsageReader(
      rawLogger as unknown as Logger,
      () => 1,
      fetcher,
    );
    const reading = await reader({
      target: TARGET,
      credential: new PlanSecret(API_KEY),
      refresh: true,
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://ollama.com/api/usage',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(reading).toMatchObject({
      status: 'available',
      windowSetEstablished: true,
    });
    expect(reading.windows[0]).toMatchObject({
      usedSource: 'provider-unofficial',
      resetsAt: Date.parse('2026-10-05T12:00:00Z'),
    });
    expect(reading.windows[1].resetsAt).toBeUndefined();
    expect(loggerCalls(rawLogger)).not.toContain(API_KEY);
  });

  it.each([
    ['missing credential', undefined, 'unsupported-config'],
    [
      'malformed provisional payload',
      new PlanSecret(API_KEY),
      'service-unavailable',
    ],
  ] as const)(
    '%s does not produce windows or log the API key',
    async (_name, credential, status) => {
      const rawLogger = createMockLogger() as unknown as Record<
        string,
        unknown
      >;
      const fetcher = jest.fn(
        async () =>
          new Response(JSON.stringify({ session: {} }), { status: 200 }),
      );
      const reader = createOllamaCloudPlanUsageReader(
        rawLogger as unknown as Logger,
        () => 1,
        fetcher,
      );
      await expect(
        reader({ target: TARGET, credential, refresh: true }),
      ).resolves.toEqual({ status, windowSetEstablished: false, windows: [] });
      if (!credential) expect(fetcher).not.toHaveBeenCalled();
      expect(loggerCalls(rawLogger)).not.toContain(API_KEY);
    },
  );

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
