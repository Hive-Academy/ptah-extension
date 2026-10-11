import { createGrokAccountPlanUsageReader } from './grok-account-plan-usage.reader';
import type { PlanOwnerTarget } from './plan-usage-reader.types';

const target = {
  providerId: 'grok',
  ownerRef: { key: 'grok', identityKind: 'cli-store' },
} as PlanOwnerTarget;
const request = { target, refresh: true };
const auth = async (path: string) =>
  path.endsWith('auth.json')
    ? JSON.stringify({
        'https://accounts.x.ai/sign-in': {
          key: 'secret',
          email: 'private@example.test',
        },
      })
    : '';

describe('Grok account plan reader', () => {
  it('does not read CLI auth for a credential owner', async () => {
    const readAuth = jest.fn(auth);
    const result = await createGrokAccountPlanUsageReader(
      () => 1,
      jest.fn(),
      readAuth as never,
      {},
    )({
      ...request,
      target: {
        ...target,
        ownerRef: { ...target.ownerRef, identityKind: 'credential' },
      },
    });
    expect(result.status).toBe('no-usage-source');
    expect(readAuth).not.toHaveBeenCalled();
  });
  it('skips a verified account owner whose identity cannot be bound to CLI auth', async () => {
    const readAuth = jest.fn(auth);
    const fetcher = jest.fn();
    const result = await createGrokAccountPlanUsageReader(
      () => 1,
      fetcher,
      readAuth as never,
      {},
    )({
      ...request,
      target: {
        ...target,
        ownerRef: { ...target.ownerRef, identityKind: 'account' },
      },
    });
    expect(result.status).toBe('no-usage-source');
    expect(readAuth).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('maps HTTP 401 to authentication needed', async () => {
    const result = await createGrokAccountPlanUsageReader(
      () => 1,
      jest.fn(async () => new Response('', { status: 401 })),
      auth as never,
      {},
    )(request);
    expect(result.status).toBe('unsupported-auth');
  });
  it('maps account billing without exposing the credential or email', async () => {
    const fetcher = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            config: {
              creditUsagePercent: 27,
              currentPeriod: {
                type: 'USAGE_PERIOD_TYPE_WEEKLY',
                end: '2030-01-01T00:00:00Z',
              },
            },
          }),
        ),
    );
    const result = await createGrokAccountPlanUsageReader(
      () => 1,
      fetcher,
      auth as never,
      {},
    )(request);
    expect(result.windows[0]).toMatchObject({
      kind: 'weekly',
      used: { percent: 27 },
      resetsAt: Date.parse('2030-01-01T00:00:00Z'),
    });
    expect(JSON.stringify(result)).not.toContain('private@example.test');
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('returns no plan for API-key mode and 403', async () => {
    const fetcher = jest.fn();
    expect(
      (
        await createGrokAccountPlanUsageReader(
          () => 1,
          fetcher,
          auth as never,
          { XAI_API_KEY: 'key' },
        )(request)
      ).status,
    ).toBe('no-usage-source');
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      (
        await createGrokAccountPlanUsageReader(
          () => 1,
          jest.fn(async () => new Response('', { status: 403 })),
          auth as never,
          {},
        )(request)
      ).status,
    ).toBe('no-usage-source');
  });
  it('rejects malformed billing and times out', async () => {
    expect(
      (
        await createGrokAccountPlanUsageReader(
          () => 1,
          jest.fn(async () => new Response('{')),
          auth as never,
          {},
        )(request)
      ).status,
    ).toBe('service-unavailable');
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
      const pending = createGrokAccountPlanUsageReader(
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
