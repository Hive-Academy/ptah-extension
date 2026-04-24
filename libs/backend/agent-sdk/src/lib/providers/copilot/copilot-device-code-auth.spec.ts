/**
 * copilot-device-code-auth — unit specs.
 *
 * Covers the GitHub Device Code (RFC 8628) flow used by Copilot login when
 * no pre-existing GitHub token is available. Security-sensitive behaviour:
 *   - The initial POST MUST include `client_id` + `scope=copilot`. If either
 *     is missing or wrong, the user ends up authorising a different app or
 *     scope than we claim.
 *   - Polling MUST respect the server-provided `interval` and the RFC 8628
 *     `slow_down` response (adds 5s) — otherwise GitHub rate-limits us and
 *     the flow stalls or is blocked.
 *   - `authorization_pending` MUST continue polling silently. Any other
 *     recognised error (`expired_token`, `access_denied`) MUST short-circuit
 *     to `null` so the caller stops polling and surfaces a clean failure.
 *   - The access token MUST only be returned on an explicit
 *     `access_token` field — never inferred from partial responses.
 *
 * Time is frozen via `freezeTime` from `@ptah-extension/shared/testing` so
 * polling-interval assertions are deterministic across platforms.
 *
 * Pattern source:
 *   `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.spec.ts`
 *
 * Source-under-test:
 *   `libs/backend/agent-sdk/src/lib/copilot-provider/copilot-device-code-auth.ts`
 */

import 'reflect-metadata';

// Mock axios before importing the source — hoisted by ts-jest.
jest.mock('axios');

import axios from 'axios';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  freezeTime,
  type FrozenClock,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import {
  executeDeviceCodeFlow,
  type DeviceCodeCallbacks,
  type DeviceCodeResponse,
} from './copilot-device-code-auth';

/**
 * The production `Logger` is a concrete class with private fields so a
 * structural duck-type match fails nominal typing. The service only ever
 * invokes `debug/info/warn/error` on it — the `MockLogger` surface covers
 * that exactly. This cast bridges the gap without reaching for `any`.
 */
function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

/**
 * Advance fake timers AND flush the microtask queue so that awaited
 * `new Promise((r) => setTimeout(r, ms))` resolves cleanly and the next
 * `await axios.post(...)` settles before the test continues.
 *
 * `freezeTime` wraps `jest.advanceTimersByTime` which is synchronous and
 * leaves pending Promise continuations on the microtask queue. For the
 * polling loop in copilot-device-code-auth we need both to fire so the
 * loop actually reaches the next iteration.
 */
async function advanceByAsync(ms: number): Promise<void> {
  await jest.advanceTimersByTimeAsync(ms);
}

/**
 * Flush the microtask queue without advancing time. Use this after starting
 * the flow so the initial `await axios.post(...)` for the device-code
 * request resolves before we start ticking the polling interval.
 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Typed axios mock handle.
// `axios.post` returns a Promise<AxiosResponse> in production. We stub that
// shape precisely so no `as any` casts are needed.
// ---------------------------------------------------------------------------

interface AxiosLikeResponse<T> {
  data: T;
}

type AxiosPostMock = jest.MockedFunction<
  <T = unknown>(
    url: string,
    body?: unknown,
    config?: unknown,
  ) => Promise<AxiosLikeResponse<T>>
>;

const mockedAxios = axios as unknown as { post: AxiosPostMock };

// GitHub endpoint constants mirrored from the source so assertions don't
// silently drift if the source changes.
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const CLIENT_ID_FIXTURE = 'Iv1.b507a08c87ecfe98';

function makeDeviceCodeResponse(
  overrides: Partial<DeviceCodeResponse> = {},
): AxiosLikeResponse<DeviceCodeResponse> {
  return {
    data: {
      device_code: 'device-abc',
      user_code: 'USER-CODE',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
      ...overrides,
    },
  };
}

describe('executeDeviceCodeFlow', () => {
  let logger: MockLogger;
  let clock: FrozenClock;

  beforeEach(() => {
    logger = createMockLogger();
    clock = freezeTime('2026-01-01T00:00:00Z');
    mockedAxios.post = jest.fn() as AxiosPostMock;
  });

  afterEach(() => {
    clock.restore();
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Device code initiation
  // -------------------------------------------------------------------------

  describe('device code initiation', () => {
    it('posts client_id + scope=copilot to the device code endpoint', async () => {
      mockedAxios.post
        .mockResolvedValueOnce(makeDeviceCodeResponse())
        .mockResolvedValueOnce({ data: { access_token: 'gho_ok' } });

      const callbacks: DeviceCodeCallbacks = { onUserCode: jest.fn() };
      const flow = executeDeviceCodeFlow(
        asLogger(logger),
        callbacks,
        CLIENT_ID_FIXTURE,
      );
      // Let interval timer fire to complete the flow.
      await advanceByAsync(5_000);
      await expect(flow).resolves.toBe('gho_ok');

      expect(mockedAxios.post).toHaveBeenNthCalledWith(
        1,
        DEVICE_CODE_URL,
        expect.any(URLSearchParams),
        expect.objectContaining({
          headers: expect.objectContaining({ Accept: 'application/json' }),
          timeout: 15_000,
        }),
      );
      const body = mockedAxios.post.mock.calls[0][1] as URLSearchParams;
      expect(body.get('client_id')).toBe(CLIENT_ID_FIXTURE);
      expect(body.get('scope')).toBe('copilot');
    });

    it('invokes the onUserCode callback with the user_code + verification_uri', async () => {
      mockedAxios.post
        .mockResolvedValueOnce(makeDeviceCodeResponse())
        .mockResolvedValueOnce({ data: { access_token: 'gho_ok' } });

      const onUserCode = jest.fn();
      const flow = executeDeviceCodeFlow(
        asLogger(logger),
        { onUserCode },
        CLIENT_ID_FIXTURE,
      );
      await advanceByAsync(5_000);
      await flow;

      expect(onUserCode).toHaveBeenCalledWith(
        'USER-CODE',
        'https://github.com/login/device',
      );
    });

    it('invokes optional openBrowser callback with the verification_uri', async () => {
      mockedAxios.post
        .mockResolvedValueOnce(makeDeviceCodeResponse())
        .mockResolvedValueOnce({ data: { access_token: 'gho_ok' } });

      const openBrowser = jest.fn(async (_url: string): Promise<void> => {
        /* noop */
      });
      const flow = executeDeviceCodeFlow(
        asLogger(logger),
        { onUserCode: jest.fn(), openBrowser },
        CLIENT_ID_FIXTURE,
      );
      await advanceByAsync(5_000);
      await flow;

      expect(openBrowser).toHaveBeenCalledWith(
        'https://github.com/login/device',
      );
    });

    it('swallows errors from openBrowser (best-effort)', async () => {
      mockedAxios.post
        .mockResolvedValueOnce(makeDeviceCodeResponse())
        .mockResolvedValueOnce({ data: { access_token: 'gho_ok' } });

      const openBrowser = jest.fn(async () => {
        throw new Error('no browser available');
      });

      const flow = executeDeviceCodeFlow(
        asLogger(logger),
        { onUserCode: jest.fn(), openBrowser },
        CLIENT_ID_FIXTURE,
      );
      await advanceByAsync(5_000);
      await expect(flow).resolves.toBe('gho_ok');
    });
  });

  // -------------------------------------------------------------------------
  // Token polling
  // -------------------------------------------------------------------------

  describe('token polling', () => {
    it('exchanges the device_code for an access_token with the correct grant_type', async () => {
      mockedAxios.post
        .mockResolvedValueOnce(makeDeviceCodeResponse())
        .mockResolvedValueOnce({ data: { access_token: 'gho_xyz' } });

      const flow = executeDeviceCodeFlow(
        asLogger(logger),
        { onUserCode: jest.fn() },
        CLIENT_ID_FIXTURE,
      );
      await advanceByAsync(5_000);
      await expect(flow).resolves.toBe('gho_xyz');

      expect(mockedAxios.post).toHaveBeenNthCalledWith(
        2,
        TOKEN_URL,
        expect.any(URLSearchParams),
        expect.objectContaining({
          headers: expect.objectContaining({ Accept: 'application/json' }),
          timeout: 15_000,
        }),
      );
      const body = mockedAxios.post.mock.calls[1][1] as URLSearchParams;
      expect(body.get('client_id')).toBe(CLIENT_ID_FIXTURE);
      expect(body.get('device_code')).toBe('device-abc');
      expect(body.get('grant_type')).toBe(
        'urn:ietf:params:oauth:grant-type:device_code',
      );
    });

    it('enforces minimum 5s polling interval even if server returns smaller value', async () => {
      mockedAxios.post
        .mockResolvedValueOnce(makeDeviceCodeResponse({ interval: 1 }))
        .mockResolvedValueOnce({ data: { access_token: 'gho_ok' } });

      const flow = executeDeviceCodeFlow(
        asLogger(logger),
        { onUserCode: jest.fn() },
        CLIENT_ID_FIXTURE,
      );

      // Before advancing 5s the poll must not have fired.
      await advanceByAsync(4_999);
      await Promise.resolve(); // flush microtasks
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);

      // Advancing past the 5s floor fires the poll and resolves.
      await advanceByAsync(1);
      await expect(flow).resolves.toBe('gho_ok');
    });

    it('continues polling silently on authorization_pending', async () => {
      mockedAxios.post
        .mockResolvedValueOnce(makeDeviceCodeResponse())
        .mockResolvedValueOnce({ data: { error: 'authorization_pending' } })
        .mockResolvedValueOnce({ data: { error: 'authorization_pending' } })
        .mockResolvedValueOnce({ data: { access_token: 'gho_finally' } });

      const flow = executeDeviceCodeFlow(
        asLogger(logger),
        { onUserCode: jest.fn() },
        CLIENT_ID_FIXTURE,
      );

      // Three poll cycles at the 5s floor.
      await advanceByAsync(5_000);
      await advanceByAsync(5_000);
      await advanceByAsync(5_000);

      await expect(flow).resolves.toBe('gho_finally');
      // 1 device-code POST + 3 poll POSTs = 4.
      expect(mockedAxios.post).toHaveBeenCalledTimes(4);
    });

    it('honours slow_down by adding 5s to the polling interval', async () => {
      // Server says "slow down" on the first poll. The next poll must wait
      // `interval + 5s = 10s` rather than the original 5s.
      mockedAxios.post
        .mockResolvedValueOnce(makeDeviceCodeResponse({ interval: 5 }))
        .mockResolvedValueOnce({ data: { error: 'slow_down' } })
        .mockResolvedValueOnce({ data: { access_token: 'gho_ok' } });

      const flow = executeDeviceCodeFlow(
        asLogger(logger),
        { onUserCode: jest.fn() },
        CLIENT_ID_FIXTURE,
      );

      // First poll fires at 5s (slow_down response).
      await advanceByAsync(5_000);
      await Promise.resolve();
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);

      // Before the new 10s interval elapses, no additional poll.
      await advanceByAsync(9_999);
      await Promise.resolve();
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);

      // Crossing the 10s boundary fires the next poll.
      await advanceByAsync(1);
      await expect(flow).resolves.toBe('gho_ok');
      expect(mockedAxios.post).toHaveBeenCalledTimes(3);
    });

    it('returns null on expired_token without further polling', async () => {
      mockedAxios.post
        .mockResolvedValueOnce(makeDeviceCodeResponse())
        .mockResolvedValueOnce({ data: { error: 'expired_token' } });

      const flow = executeDeviceCodeFlow(
        asLogger(logger),
        { onUserCode: jest.fn() },
        CLIENT_ID_FIXTURE,
      );
      await advanceByAsync(5_000);

      await expect(flow).resolves.toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Device code expired'),
      );
      // No third POST — loop exited on expired_token.
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    });

    it('returns null on access_denied without further polling', async () => {
      mockedAxios.post
        .mockResolvedValueOnce(makeDeviceCodeResponse())
        .mockResolvedValueOnce({ data: { error: 'access_denied' } });

      const flow = executeDeviceCodeFlow(
        asLogger(logger),
        { onUserCode: jest.fn() },
        CLIENT_ID_FIXTURE,
      );
      await advanceByAsync(5_000);

      await expect(flow).resolves.toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('User denied access'),
      );
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    });

    it('returns null on unknown error code and stops polling', async () => {
      mockedAxios.post
        .mockResolvedValueOnce(makeDeviceCodeResponse())
        .mockResolvedValueOnce({
          data: {
            error: 'unsupported_grant_type',
            error_description: 'nope',
          },
        });

      const flow = executeDeviceCodeFlow(
        asLogger(logger),
        { onUserCode: jest.fn() },
        CLIENT_ID_FIXTURE,
      );
      await advanceByAsync(5_000);

      await expect(flow).resolves.toBeNull();
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    });

    it('continues polling through transient network errors', async () => {
      mockedAxios.post
        .mockResolvedValueOnce(makeDeviceCodeResponse())
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce({ data: { access_token: 'gho_recovered' } });

      const flow = executeDeviceCodeFlow(
        asLogger(logger),
        { onUserCode: jest.fn() },
        CLIENT_ID_FIXTURE,
      );
      await advanceByAsync(5_000); // transient error
      await advanceByAsync(5_000); // retry succeeds

      await expect(flow).resolves.toBe('gho_recovered');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Poll request failed'),
      );
    });

    it('never returns a token from a partial/unexpected response shape', async () => {
      // Response has neither `access_token` nor a recognised `error` string.
      mockedAxios.post
        .mockResolvedValueOnce(makeDeviceCodeResponse())
        .mockResolvedValueOnce({ data: { something_else: 'surprise' } });

      const flow = executeDeviceCodeFlow(
        asLogger(logger),
        { onUserCode: jest.fn() },
        CLIENT_ID_FIXTURE,
      );
      await advanceByAsync(5_000);

      // Falls through to "unknown error" branch → null.
      await expect(flow).resolves.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Initiation failures
  // -------------------------------------------------------------------------

  describe('initiation failures', () => {
    it('propagates errors from the initial device-code POST', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('github down'));

      // Note: the source does NOT wrap the initial failure — the caller
      // (CopilotAuthService.login) catches it. That's intentional so callers
      // can log / retry with richer context.
      await expect(
        executeDeviceCodeFlow(
          asLogger(logger),
          { onUserCode: jest.fn() },
          CLIENT_ID_FIXTURE,
        ),
      ).rejects.toThrow('github down');
    });
  });
});
