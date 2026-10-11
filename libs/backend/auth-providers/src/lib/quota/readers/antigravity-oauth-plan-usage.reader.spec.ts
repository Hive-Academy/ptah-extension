import { readAntigravityOAuthQuota } from './antigravity-oauth-plan-usage.reader';

const token = async () =>
  JSON.stringify({
    client_id: 'id',
    client_secret: 'secret',
    refresh_token: 'refresh',
  });
const access = { access_token: 'access', expires_in: 3600 };

describe('Antigravity OAuth quota', () => {
  it('reuses a refreshed token until expiry', async () => {
    const fetcher = jest.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith('/token')
              ? access
              : { buckets: [{ bucketId: 'go', remainingFraction: 0.5 }] },
          ),
        ),
    );
    await readAntigravityOAuthQuota(
      undefined,
      () => 1,
      fetcher as typeof fetch,
      token as never,
      {},
    );
    await readAntigravityOAuthQuota(
      undefined,
      () => 2,
      fetcher as typeof fetch,
      token as never,
      {},
    );
    expect(
      fetcher.mock.calls.filter(([url]) => url.endsWith('/token')),
    ).toHaveLength(1);
  });
  it.each([401])(
    'refreshes a revoked cached token after quota %i',
    async (status) => {
      let tokenReads = 0;
      let quotaReads = 0;
      const fetcher = jest.fn(async (url: string) => {
        if (url.endsWith('/token')) {
          tokenReads += 1;
          return new Response(
            JSON.stringify({
              access_token: `access-${tokenReads}`,
              expires_in: 3600,
            }),
          );
        }
        quotaReads += 1;
        return quotaReads === 1
          ? new Response('', { status })
          : new Response(
              JSON.stringify({
                buckets: [{ bucketId: 'go', remainingFraction: 0.5 }],
              }),
            );
      });
      const result = await readAntigravityOAuthQuota(
        undefined,
        () => 1,
        fetcher as typeof fetch,
        token as never,
        {},
      );
      expect(result?.status).toBe('available');
      expect(tokenReads).toBe(2);
      expect(quotaReads).toBe(2);
    },
  );
  it('returns before reading an already aborted request', async () => {
    const controller = new AbortController();
    controller.abort();
    const readAuth = jest.fn(token);
    expect(
      (
        await readAntigravityOAuthQuota(
          controller.signal,
          () => 1,
          jest.fn(),
          readAuth as never,
          {},
        )
      )?.status,
    ).toBe('service-unavailable');
    expect(readAuth).not.toHaveBeenCalled();
  });
  it('maps invalid_grant to authentication needed and caps JSON bodies', async () => {
    const revoked = jest.fn(
      async () =>
        new Response(JSON.stringify({ error: 'invalid_grant' }), {
          status: 400,
        }),
    );
    expect(
      (
        await readAntigravityOAuthQuota(
          undefined,
          () => 1,
          revoked as typeof fetch,
          token as never,
          {},
        )
      )?.status,
    ).toBe('unsupported-auth');
    const oversized = jest.fn(async () => new Response(' '.repeat(300_000)));
    expect(
      (
        await readAntigravityOAuthQuota(
          undefined,
          () => 1,
          oversized as typeof fetch,
          token as never,
          {},
        )
      )?.status,
    ).toBe('service-unavailable');
  });
  it('refreshes in memory and maps summary buckets', async () => {
    const fetcher = jest.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith('/token')
              ? access
              : {
                  buckets: [
                    {
                      bucketId: 'gemini-pro',
                      window: '5h',
                      remainingFraction: 0.3,
                      resetTime: '2030-01-01T00:00:00Z',
                    },
                  ],
                },
          ),
        ),
    );
    const result = await readAntigravityOAuthQuota(
      undefined,
      () => 1,
      fetcher as typeof fetch,
      token as never,
      {},
    );
    expect(result?.windows[0]).toMatchObject({
      kind: 'five_hour',
      used: { percent: 70 },
      resetsAt: Date.parse('2030-01-01T00:00:00Z'),
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(fetcher.mock.calls).toHaveLength(2);
  });
  it('uses local probe when no token file exists', async () => {
    const missing = async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    };
    await expect(
      readAntigravityOAuthQuota(
        undefined,
        () => 1,
        jest.fn(),
        missing as never,
        {},
      ),
    ).resolves.toBeUndefined();
  });
  it('continues to a second endpoint after a quota 403 without refreshing the token', async () => {
    let tokenReads = 0;
    const fetcher = jest.fn(async (url: string) => {
      if (url.endsWith('/token')) {
        tokenReads += 1;
        return new Response(JSON.stringify(access));
      }
      if (url.includes('daily-cloudcode-pa'))
        return new Response('', { status: 403 });
      return new Response(
        JSON.stringify({
          buckets: [{ bucketId: 'go', remainingFraction: 0.5 }],
        }),
      );
    });
    const result = await readAntigravityOAuthQuota(
      undefined,
      () => 1,
      fetcher as typeof fetch,
      token as never,
      {},
    );
    expect(result?.status).toBe('available');
    expect(tokenReads).toBe(1);
    expect(
      fetcher.mock.calls.some(
        ([url]) =>
          url.includes('cloudcode-pa') && !url.includes('daily-cloudcode-pa'),
      ),
    ).toBe(true);
  });
  it('maps OAuth 403 to no plan', async () => {
    const result = await readAntigravityOAuthQuota(
      undefined,
      () => 1,
      jest.fn(async () => new Response('', { status: 403 })),
      token as never,
      {},
    );
    expect(result?.status).toBe('no-usage-source');
  });
  it('rejects malformed token and times out', async () => {
    expect(
      (
        await readAntigravityOAuthQuota(
          undefined,
          () => 1,
          jest.fn(),
          (async () => '{}') as never,
          {},
        )
      )?.status,
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
      const pending = readAntigravityOAuthQuota(
        undefined,
        () => 1,
        fetcher as typeof fetch,
        token as never,
        {},
      );
      await jest.advanceTimersByTimeAsync(10_000);
      expect((await pending)?.status).toBe('service-unavailable');
    } finally {
      jest.useRealTimers();
    }
  });
});
