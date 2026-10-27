import axios from 'axios';
import type { Logger } from '@ptah-extension/vscode-core';
import { createMockLogger, type MockLogger } from '@ptah-extension/shared/testing';
import { KIMI_CODE_LOCK_STALE_MS } from './kimi-code-credential-store';
import {
  KIMI_CODE_OAUTH_CLIENT_ID,
  KIMI_CODE_REFRESH_DEADLINE_MS,
  KimiCodeOAuthRefresher,
} from './kimi-code-oauth-refresher';

jest.mock('axios', () => {
  const actual = jest.requireActual<typeof import('axios')>('axios');
  return {
    __esModule: true,
    default: { post: jest.fn(), isAxiosError: actual.default.isAxiosError },
  };
});

const post = axios.post as jest.MockedFunction<typeof axios.post>;

function asLogger(mock: MockLogger): Logger {
  const surface: Partial<Logger> = mock;
  return surface as Logger;
}

function reply(status: number, data: unknown) {
  return { status, data, headers: {}, statusText: '', config: {} };
}

describe('KimiCodeOAuthRefresher', () => {
  let logger: MockLogger;
  let sleep: jest.Mock<Promise<void>, [number]>;
  let refresher: KimiCodeOAuthRefresher;

  beforeEach(() => {
    post.mockReset();
    logger = createMockLogger();
    sleep = jest.fn(async (_ms: number) => undefined);
    refresher = new KimiCodeOAuthRefresher(asLogger(logger), { sleep });
  });

  it('posts the form body with the CLI headers and parses rotated tokens', async () => {
    post.mockResolvedValueOnce(
      reply(200, {
        access_token: 'fake-access-token-2',
        refresh_token: 'fake-refresh-token-2',
        expires_in: 900,
        token_type: 'Bearer',
        scope: 'kimi-code',
      }),
    );
    const outcome = await refresher.refresh(
      'fake-refresh-token-1',
      'https://auth.example.test/',
      '0123456789abcdef0123456789abcdef',
    );
    expect(outcome).toEqual({
      kind: 'ok',
      tokens: expect.objectContaining({
        access_token: 'fake-access-token-2',
        refresh_token: 'fake-refresh-token-2',
        expires_in: 900,
      }),
    });
    const [url, body, config] = post.mock.calls[0];
    expect(url).toBe('https://auth.example.test/api/oauth/token');
    expect(new URLSearchParams(String(body)).get('client_id')).toBe(
      KIMI_CODE_OAUTH_CLIENT_ID,
    );
    expect(new URLSearchParams(String(body)).get('grant_type')).toBe(
      'refresh_token',
    );
    expect(config?.timeout).toBe(30_000);
    expect(config?.headers).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Msh-Platform': 'kimi_cli',
        'X-Msh-Device-Id': '0123456789abcdef0123456789abcdef',
      }),
    );
  });

  it('omits the device id header when none is known', async () => {
    post.mockResolvedValueOnce(reply(200, { access_token: 'fake-a', refresh_token: 'fake-r', expires_in: 900 }));
    await refresher.refresh('fake-refresh-token-1', 'https://auth.example.test', undefined);
    expect(post.mock.calls[0][2]?.headers).not.toHaveProperty('X-Msh-Device-Id');
  });

  it.each([401, 403])('treats HTTP %d as a rejected login without retrying', async (status) => {
    post.mockResolvedValueOnce(reply(status, { error: 'unauthorized' }));
    await expect(
      refresher.refresh('fake-refresh-token-1', 'https://auth.example.test', undefined),
    ).resolves.toEqual({ kind: 'rejected', status });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('treats a 400 invalid_grant as rejected', async () => {
    post.mockResolvedValueOnce(reply(400, { error: 'invalid_grant' }));
    await expect(
      refresher.refresh('fake-refresh-token-1', 'https://auth.example.test', undefined),
    ).resolves.toEqual({ kind: 'rejected', status: 400 });
  });

  it('retries 429/5xx three times with backoff, then reports transient', async () => {
    post.mockResolvedValue(reply(503, 'unavailable'));
    await expect(
      refresher.refresh('fake-refresh-token-1', 'https://auth.example.test', undefined),
    ).resolves.toEqual({ kind: 'transient', status: 503 });
    expect(post).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000, 2000]);
  });

  it('recovers when a retry succeeds', async () => {
    post
      .mockResolvedValueOnce(reply(429, {}))
      .mockResolvedValueOnce(reply(200, { access_token: 'fake-a', refresh_token: 'fake-r', expires_in: 900 }));
    await expect(
      refresher.refresh('fake-refresh-token-1', 'https://auth.example.test', undefined),
    ).resolves.toMatchObject({ kind: 'ok' });
  });

  it('reports a network failure or a malformed body as transient without retrying', async () => {
    post.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(
      refresher.refresh('fake-refresh-token-1', 'https://auth.example.test', undefined),
    ).resolves.toEqual({ kind: 'transient' });
    post.mockResolvedValueOnce(reply(200, { access_token: 'fake-a' }));
    await expect(
      refresher.refresh('fake-refresh-token-1', 'https://auth.example.test', undefined),
    ).resolves.toEqual({ kind: 'transient', status: 200 });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it.each<[string, Record<string, unknown>]>([
    ['no refresh_token', { access_token: 'fake-a', expires_in: 900 }],
    ['an empty refresh_token', { access_token: 'fake-a', refresh_token: '', expires_in: 900 }],
    ['no expires_in', { access_token: 'fake-a', refresh_token: 'fake-r' }],
    ['a zero expires_in', { access_token: 'fake-a', refresh_token: 'fake-r', expires_in: 0 }],
    [
      'only an absolute expires_at',
      { access_token: 'fake-a', refresh_token: 'fake-r', expires_at: 2_000_000_000 },
    ],
  ])('treats a 200 with %s as malformed (transient, nothing to persist)', async (_label, data) => {
    post.mockResolvedValueOnce(reply(200, data));
    await expect(
      refresher.refresh('fake-refresh-token-1', 'https://auth.example.test', undefined),
    ).resolves.toEqual({ kind: 'transient', status: 200 });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('does not match the expected shape'),
    );
  });

  it('ends a slow retry sequence before the refresh lock can go stale', async () => {
    let now = 0;
    const slow = new KimiCodeOAuthRefresher(asLogger(logger), {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
    });
    // Every 503 arrives just before its timeout.
    post.mockImplementation(async (_url, _body, config) => {
      now += (config?.timeout ?? 0) - 1;
      return reply(503, 'unavailable');
    });

    await expect(
      slow.refresh('fake-refresh-token-1', 'https://auth.example.test', undefined),
    ).resolves.toEqual({ kind: 'transient', status: 503 });

    expect(now).toBeLessThanOrEqual(KIMI_CODE_REFRESH_DEADLINE_MS);
    expect(KIMI_CODE_REFRESH_DEADLINE_MS).toBeLessThan(KIMI_CODE_LOCK_STALE_MS);
    // The second attempt only gets the time left; no third attempt starts.
    expect(post.mock.calls.map(([, , config]) => config?.timeout)).toEqual([
      30_000,
      KIMI_CODE_REFRESH_DEADLINE_MS - 30_000 - 500 + 1,
    ]);
    expect(post.mock.calls[0][2]?.signal).toBeDefined();
  });

  it('never logs tokens or the device id', async () => {
    post.mockResolvedValueOnce(
      reply(200, {
        access_token: 'fake-access-token-9',
        refresh_token: 'fake-refresh-token-10',
        expires_in: 900,
      }),
    );
    await refresher.refresh(
      'fake-refresh-token-9',
      'https://auth.example.test',
      '0123456789abcdef0123456789abcdef',
    );
    const logged = JSON.stringify([
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.debug.mock.calls,
    ]);
    expect(logged).not.toContain('fake-');
    expect(logged).not.toContain('0123456789abcdef');
  });
});
