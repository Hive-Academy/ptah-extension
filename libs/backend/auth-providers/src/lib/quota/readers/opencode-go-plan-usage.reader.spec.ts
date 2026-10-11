import { createOpenCodeGoPlanUsageReader } from './opencode-go-plan-usage.reader';
import type { PlanOwnerTarget } from './plan-usage-reader.types';
import type { PlanSecret } from '../plan-credential.source';

const target = {
  providerId: 'opencode-go',
  ownerRef: { key: 'go', identityKind: 'cli-store' },
} as PlanOwnerTarget;
const request = { target, refresh: true };
const auth = async () =>
  JSON.stringify({ 'opencode-go': { type: 'api', key: 'secret' } });
const payload = {
  usage: {
    rolling: { percent: 20, resetsAt: '2030-01-01T00:00:00Z' },
    weekly: { percent: 40, resetsAt: '2030-01-02T00:00:00Z' },
    monthly: { percent: 60, resetsAt: '2030-01-03T00:00:00Z' },
  },
};

describe('OpenCode Go plan reader', () => {
  it('uses the stored key for credential owners without reading CLI auth', async () => {
    const fetcher = jest.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(payload)),
    );
    const readAuth = jest.fn(async () => {
      throw new Error('CLI auth must not be read');
    });
    const result = await createOpenCodeGoPlanUsageReader(
      () => 1,
      fetcher,
      readAuth as never,
      { OPENCODE_API_KEY: 'wrong' },
    )({
      ...request,
      target: {
        ...target,
        ownerRef: { ...target.ownerRef, identityKind: 'credential' },
      },
      credential: { reveal: () => 'stored' } as PlanSecret,
    });
    expect(result.status).toBe('available');
    expect(readAuth).not.toHaveBeenCalled();
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: 'Bearer stored' },
    });
  });
  it('maps the three subscription windows', async () => {
    const fetcher = jest.fn(async () => new Response(JSON.stringify(payload)));
    const result = await createOpenCodeGoPlanUsageReader(
      () => 1,
      fetcher,
      auth as never,
      {},
    )(request);
    expect(result.windows.map((window) => [window.kind, window.used])).toEqual([
      ['five_hour', { kind: 'percent', percent: 20 }],
      ['weekly', { kind: 'percent', percent: 40 }],
      ['monthly', { kind: 'percent', percent: 60 }],
    ]);
    expect(fetcher.mock.calls).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('returns no plan when no credential or HTTP 403', async () => {
    const missing = createOpenCodeGoPlanUsageReader(
      () => 1,
      jest.fn(),
      (async () => '{}') as never,
      {},
    );
    expect((await missing(request)).status).toBe('no-usage-source');
    const forbidden = createOpenCodeGoPlanUsageReader(
      () => 1,
      jest.fn(async () => new Response('', { status: 403 })),
      auth as never,
      {},
    );
    expect((await forbidden(request)).status).toBe('no-usage-source');
  });
  it('rejects malformed responses and times out', async () => {
    const malformed = createOpenCodeGoPlanUsageReader(
      () => 1,
      jest.fn(async () => new Response('{}')),
      auth as never,
      {},
    );
    expect((await malformed(request)).status).toBe('service-unavailable');
    jest.useFakeTimers();
    try {
      const fetcher = jest.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_, reject) =>
            init?.signal?.addEventListener('abort', () =>
              reject(new Error('aborted')),
            ),
          ),
      );
      const pending = createOpenCodeGoPlanUsageReader(
        () => 1,
        fetcher as typeof fetch,
        auth as never,
        {},
      )(request);
      await jest.advanceTimersByTimeAsync(5_000);
      expect((await pending).status).toBe('service-unavailable');
    } finally {
      jest.useRealTimers();
    }
  });
});
