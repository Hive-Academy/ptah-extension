/**
 * CopilotAuthService — unit specs.
 *
 * Covers the platform-agnostic Copilot authentication service. Security &
 * correctness surface under test:
 *   - Auth resolution priority: file-based token → device-code flow.
 *     The file path MUST be tried before prompting the user, and a
 *     successful device-code token MUST be persisted via writeCopilotToken
 *     so users don't re-auth on every restart.
 *   - Token exchange MUST send the GitHub token as `Authorization: token …`
 *     (NOT `Bearer …`) to the exchange endpoint — the Copilot internal
 *     endpoint rejects Bearer auth silently.
 *   - Bearer refresh MUST fire within the 5-minute buffer window before the
 *     stored `expires_at` so API calls never race expiry.
 *   - Refresh deduplication: concurrent calls to `getAuthState()` /
 *     `isAuthenticated()` MUST share a single in-flight refresh promise.
 *   - Tokens MUST never be logged in full. `describeToken` emits only the
 *     4-char prefix and length.
 *
 * `axios.get`, `readCopilotToken`, `writeCopilotToken`, and
 * `executeDeviceCodeFlow` are stubbed via `jest.mock(...)` so the service
 * runs in complete isolation. Constructor dependencies are injected
 * directly (no tsyringe container), matching the pattern in
 * `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.spec.ts`.
 *
 * Source-under-test:
 *   `libs/backend/agent-sdk/src/lib/copilot-provider/copilot-auth.service.ts`
 */

import 'reflect-metadata';

// ---------------------------------------------------------------------------
// Module mocks — MUST precede the source import so ts-jest hoists them above
// the `import { CopilotAuthService }` statement below.
// ---------------------------------------------------------------------------

jest.mock('axios');

jest.mock('./copilot-file-auth', () => ({
  readCopilotToken: jest.fn(),
  writeCopilotToken: jest.fn(),
}));

jest.mock('./copilot-device-code-auth', () => ({
  executeDeviceCodeFlow: jest.fn(),
  requestDeviceCode: jest.fn(),
  pollForAccessToken: jest.fn(),
}));

import axios, { AxiosError } from 'axios';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  freezeTime,
  type FrozenClock,
  type MockLogger,
} from '@ptah-extension/shared/testing';

/**
 * The production `Logger` is a concrete class with private fields so a
 * structural duck-type match fails nominal typing. The service only ever
 * invokes `debug/info/warn/error` on it — the `MockLogger` surface covers
 * that exactly. This cast bridges the gap without reaching for `any`.
 */
function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}
import {
  createMockUserInteraction,
  createMockWorkspaceProvider,
  type MockUserInteraction,
  type MockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import {
  PlatformType,
  type IPlatformInfo,
} from '@ptah-extension/platform-core';
import type { ISettingsStore } from '@ptah-extension/settings-core';
import { CopilotAuthService } from './copilot-auth.service';
import type { CopilotTokenResponse } from './copilot-provider.types';
import { SdkError } from '@ptah-extension/agent-sdk';
import * as fileAuth from './copilot-file-auth';
import * as deviceAuth from './copilot-device-code-auth';

// ---------------------------------------------------------------------------
// Typed mock handles — no `as any` casts.
// ---------------------------------------------------------------------------

interface AxiosLikeResponse<T> {
  data: T;
}

type AxiosGetMock = jest.MockedFunction<
  <T = unknown>(url: string, config?: unknown) => Promise<AxiosLikeResponse<T>>
>;

const mockedAxios = axios as unknown as {
  get: AxiosGetMock;
  isAxiosError: typeof axios.isAxiosError;
};

const mockedReadCopilotToken = fileAuth.readCopilotToken as jest.MockedFunction<
  typeof fileAuth.readCopilotToken
>;
const mockedWriteCopilotToken =
  fileAuth.writeCopilotToken as jest.MockedFunction<
    typeof fileAuth.writeCopilotToken
  >;
const mockedExecuteDeviceCodeFlow =
  deviceAuth.executeDeviceCodeFlow as jest.MockedFunction<
    typeof deviceAuth.executeDeviceCodeFlow
  >;
const mockedRequestDeviceCode =
  deviceAuth.requestDeviceCode as jest.MockedFunction<
    typeof deviceAuth.requestDeviceCode
  >;
const mockedPollForAccessToken =
  deviceAuth.pollForAccessToken as jest.MockedFunction<
    typeof deviceAuth.pollForAccessToken
  >;

/**
 * Build a canonical fixture device-code response so begin/poll specs don't
 * have to re-state the shape every time.
 */
function makeDeviceCodeFixture(
  overrides: Partial<deviceAuth.DeviceCodeResponse> = {},
): deviceAuth.DeviceCodeResponse {
  return {
    device_code: 'D1',
    user_code: 'U1',
    verification_uri: 'https://github.com/login/device',
    expires_in: 600,
    interval: 5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Lightweight IPlatformInfo stub. No factory exists in platform-core/testing
// yet; inline here is consistent with the self-contained spec style used by
// session-lifecycle-manager.spec.ts.
// ---------------------------------------------------------------------------

function createMockPlatformInfo(
  overrides: Partial<IPlatformInfo> = {},
): IPlatformInfo {
  return {
    type: PlatformType.VSCode,
    extensionPath: '/fake/extension',
    globalStoragePath: '/fake/global',
    workspaceStoragePath: '/fake/workspace',
    ...overrides,
  };
}

// Helper: build an AxiosError-like rejection so the `axios.isAxiosError`
// branch in the source is exercised.
function makeAxiosError(
  status: number,
  body: unknown,
): AxiosError & { isAxiosError: true } {
  const err = new Error(`HTTP ${status}`) as AxiosError;
  err.isAxiosError = true;
  (err as { response: { status: number; data: unknown } }).response = {
    status,
    data: body,
  };
  return err as AxiosError & { isAxiosError: true };
}

/**
 * In-memory `ISettingsStore` double backing the logout tombstone
 * (`provider.github-copilot.loggedOut`). Only the global read/write pair is
 * exercised; the secret + watch surface throws so an accidental dependency on
 * it fails loudly rather than silently no-op'ing.
 */
interface FakeSettingsStore extends ISettingsStore {
  values: Map<string, unknown>;
  writeGlobal: jest.Mock<Promise<void>, [string, unknown]>;
}

function createFakeSettingsStore(
  initial: Record<string, unknown> = {},
): FakeSettingsStore {
  const values = new Map<string, unknown>(Object.entries(initial));
  const unsupported = (): never => {
    throw new Error('not used by CopilotAuthService');
  };
  const writeGlobal = jest.fn(async (key: string, value: unknown) => {
    values.set(key, value);
  });

  return {
    values,
    writeGlobal: writeGlobal as FakeSettingsStore['writeGlobal'],
    readGlobal: (<T>(key: string) =>
      values.get(key) as T | undefined) as ISettingsStore['readGlobal'],
    readSecret: unsupported,
    writeSecret: unsupported,
    deleteSecret: unsupported,
    watchGlobal: unsupported,
    watchSecret: unsupported,
    flushSync: () => undefined,
  } as FakeSettingsStore;
}

/** Tombstone key under test — mirrors the constant in the service. */
const TOMBSTONE_KEY = 'provider.github-copilot.loggedOut';

// Build a fresh service wired up with the canonical mock dependency set.
interface ServiceHarness {
  service: CopilotAuthService;
  logger: MockLogger;
  userInteraction: MockUserInteraction;
  workspaceProvider: MockWorkspaceProvider;
  platformInfo: IPlatformInfo;
  settingsStore: FakeSettingsStore;
}

function makeService(
  options: {
    config?: Record<string, unknown>;
    platformInfo?: Partial<IPlatformInfo>;
    settings?: Record<string, unknown>;
  } = {},
): ServiceHarness {
  const logger = createMockLogger();
  const userInteraction = createMockUserInteraction();
  const workspaceProvider = createMockWorkspaceProvider({
    config: options.config,
  });
  const platformInfo = createMockPlatformInfo(options.platformInfo);
  const settingsStore = createFakeSettingsStore(options.settings);

  const service = new CopilotAuthService(
    asLogger(logger),
    platformInfo,
    userInteraction,
    workspaceProvider,
    settingsStore,
  );

  return {
    service,
    logger,
    userInteraction,
    workspaceProvider,
    platformInfo,
    settingsStore,
  };
}

// Seconds → the service stores / checks `expires_at` in Unix seconds, so we
// use a fixed frozen instant to derive expected deltas.
const FROZEN_AT_ISO = '2026-01-01T00:00:00Z';
const FROZEN_AT_SECONDS = Math.floor(new Date(FROZEN_AT_ISO).getTime() / 1000);

// A valid successful token-exchange response fixture.
function makeTokenResponse(
  overrides: Partial<CopilotTokenResponse> = {},
): AxiosLikeResponse<CopilotTokenResponse> {
  return {
    data: {
      token: 'tid_abcdef1234',
      // Default: 1 hour in the future from the frozen clock.
      expires_at: FROZEN_AT_SECONDS + 3_600,
      endpoints: { api: 'https://api.githubcopilot.com' },
      ...overrides,
    },
  };
}

describe('CopilotAuthService', () => {
  let clock: FrozenClock;

  beforeEach(() => {
    clock = freezeTime(FROZEN_AT_ISO);
    mockedAxios.get = jest.fn() as AxiosGetMock;
    // Preserve `axios.isAxiosError` — it's a real function on the real
    // module but jest.mock('axios') replaces the entire module. Rebind it
    // to a type-guard that checks our fixture's `isAxiosError` flag.
    mockedAxios.isAxiosError = ((v: unknown): v is AxiosError => {
      return (
        typeof v === 'object' &&
        v !== null &&
        (v as { isAxiosError?: boolean }).isAxiosError === true
      );
    }) as typeof axios.isAxiosError;

    mockedReadCopilotToken.mockReset();
    mockedWriteCopilotToken.mockReset();
    mockedExecuteDeviceCodeFlow.mockReset();
    mockedRequestDeviceCode.mockReset();
    mockedPollForAccessToken.mockReset();
  });

  afterEach(() => {
    clock.restore();
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // login()
  // -------------------------------------------------------------------------

  describe('login()', () => {
    it('succeeds via file-based auth without invoking the device code flow', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce('gho_file_token');
      mockedAxios.get.mockResolvedValueOnce(makeTokenResponse());

      const { service } = makeService();
      await expect(service.login()).resolves.toBe(true);

      expect(mockedReadCopilotToken).toHaveBeenCalledTimes(1);
      expect(mockedRequestDeviceCode).not.toHaveBeenCalled();
      expect(mockedPollForAccessToken).not.toHaveBeenCalled();
      expect(mockedWriteCopilotToken).not.toHaveBeenCalled();
    });

    it('uses `Authorization: token …` (NOT Bearer) for the exchange', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce('gho_file_token');
      mockedAxios.get.mockResolvedValueOnce(makeTokenResponse());

      const { service } = makeService();
      await service.login();

      const [, config] = mockedAxios.get.mock.calls[0] as [
        string,
        { headers: Record<string, string>; timeout: number },
      ];
      expect(config.headers['Authorization']).toBe('token gho_file_token');
      expect(config.headers['Authorization']).not.toMatch(/^Bearer/);
      expect(config.headers['Accept']).toBe('application/json');
      expect(config.timeout).toBe(15_000);
    });

    it('falls back to device code flow and persists the new token on success', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce(null); // no file token
      mockedRequestDeviceCode.mockResolvedValueOnce(
        makeDeviceCodeFixture({
          device_code: 'D-device',
          user_code: 'USER-123',
          verification_uri: 'https://github.com/login/device',
        }),
      );
      mockedPollForAccessToken.mockResolvedValueOnce('gho_device_token');
      mockedAxios.get.mockResolvedValueOnce(makeTokenResponse());
      mockedWriteCopilotToken.mockResolvedValueOnce(undefined);

      const { service, userInteraction } = makeService();
      await expect(service.login()).resolves.toBe(true);

      expect(mockedRequestDeviceCode).toHaveBeenCalledTimes(1);
      expect(mockedPollForAccessToken).toHaveBeenCalledWith(
        'D-device',
        expect.any(String),
        expect.objectContaining({
          intervalMs: 5_000,
          timeoutMs: 5 * 60 * 1000,
        }),
      );
      // Token persisted after successful exchange so next launch restores silently.
      expect(mockedWriteCopilotToken).toHaveBeenCalledWith('gho_device_token');
      // login() surfaces the user code via clipboard + info message + browser.
      expect(userInteraction.writeToClipboard).toHaveBeenCalledWith('USER-123');
      expect(userInteraction.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('USER-123'),
        'OK',
      );
      expect(userInteraction.openExternal).toHaveBeenCalledWith(
        'https://github.com/login/device',
      );
    });

    /**
     * `showInformationMessage` is `console.log` under the CLI runtime and the
     * TUI replaces `console.*` with a no-op sink, so the device code was
     * invisible there. `onDeviceCode` is the headless-safe channel — and it
     * MUST fire before the clipboard/browser awaits and the 5-minute poll,
     * otherwise it is no better than what it replaces.
     */
    it('invokes onDeviceCode with the device metadata', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce(null);
      mockedRequestDeviceCode.mockResolvedValueOnce(
        makeDeviceCodeFixture({
          device_code: 'D-device',
          user_code: 'USER-123',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
        }),
      );
      mockedPollForAccessToken.mockResolvedValueOnce('gho_device_token');
      mockedAxios.get.mockResolvedValueOnce(makeTokenResponse());
      mockedWriteCopilotToken.mockResolvedValueOnce(undefined);

      const onDeviceCode = jest.fn();
      const { service } = makeService();
      await service.login({ onDeviceCode });

      expect(onDeviceCode).toHaveBeenCalledTimes(1);
      expect(onDeviceCode).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceCode: 'D-device',
          userCode: 'USER-123',
          verificationUri: 'https://github.com/login/device',
          expiresIn: 900,
        }),
      );
    });

    it('fires onDeviceCode BEFORE the clipboard/browser surfacing and the poll', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce(null);
      mockedRequestDeviceCode.mockResolvedValueOnce(makeDeviceCodeFixture());

      const order: string[] = [];
      const { service, userInteraction } = makeService();
      userInteraction.writeToClipboard.mockImplementation(async () => {
        order.push('clipboard');
      });
      mockedPollForAccessToken.mockImplementation(async () => {
        order.push('poll');
        return null;
      });

      await service.login({
        onDeviceCode: () => {
          order.push('onDeviceCode');
        },
      });

      expect(order).toEqual(['onDeviceCode', 'clipboard', 'poll']);
    });

    it('still surfaces the code via IUserInteraction (VS Code / Electron unchanged)', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce(null);
      mockedRequestDeviceCode.mockResolvedValueOnce(
        makeDeviceCodeFixture({ user_code: 'USER-123' }),
      );
      mockedPollForAccessToken.mockResolvedValueOnce(null);

      const { service, userInteraction } = makeService();
      await service.login({ onDeviceCode: jest.fn() });

      expect(userInteraction.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('USER-123'),
        'OK',
      );
    });

    it('does not invoke onDeviceCode when file-based auth short-circuits the flow', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce('gho_file_token');
      mockedAxios.get.mockResolvedValueOnce(makeTokenResponse());

      const onDeviceCode = jest.fn();
      const { service } = makeService();
      await service.login({ onDeviceCode });

      expect(onDeviceCode).not.toHaveBeenCalled();
    });

    it('completes the login even if onDeviceCode throws', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce(null);
      mockedRequestDeviceCode.mockResolvedValueOnce(makeDeviceCodeFixture());
      mockedPollForAccessToken.mockResolvedValueOnce('gho_device_token');
      mockedAxios.get.mockResolvedValueOnce(makeTokenResponse());
      mockedWriteCopilotToken.mockResolvedValueOnce(undefined);

      const { service } = makeService();
      await expect(
        service.login({
          onDeviceCode: () => {
            throw new Error('observer exploded');
          },
        }),
      ).resolves.toBe(true);
    });

    it('remains callable with no options (existing callers unchanged)', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce('gho_file_token');
      mockedAxios.get.mockResolvedValueOnce(makeTokenResponse());

      const { service } = makeService();
      await expect(service.login()).resolves.toBe(true);
    });

    it('uses the configured client ID when one is set in workspace config', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce(null);
      mockedRequestDeviceCode.mockResolvedValueOnce(makeDeviceCodeFixture());
      mockedPollForAccessToken.mockResolvedValueOnce(null); // user aborted

      const { service } = makeService({
        config: {
          'ptah.provider.github-copilot.clientId': 'Iv1.custom-enterprise',
        },
      });
      await service.login();

      expect(mockedRequestDeviceCode).toHaveBeenCalledWith(
        'Iv1.custom-enterprise',
      );
      expect(mockedPollForAccessToken).toHaveBeenCalledWith(
        expect.any(String),
        'Iv1.custom-enterprise',
        expect.any(Object),
      );
    });

    it('falls back to the well-known Copilot client ID when unconfigured', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce(null);
      mockedRequestDeviceCode.mockResolvedValueOnce(makeDeviceCodeFixture());
      mockedPollForAccessToken.mockResolvedValueOnce(null);

      const { service } = makeService();
      await service.login();

      expect(mockedRequestDeviceCode).toHaveBeenCalledWith(
        'Iv1.b507a08c87ecfe98',
      );
    });

    it('swallows persistence failures and still reports success (best-effort)', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce(null);
      mockedRequestDeviceCode.mockResolvedValueOnce(makeDeviceCodeFixture());
      mockedPollForAccessToken.mockResolvedValueOnce('gho_device');
      mockedAxios.get.mockResolvedValueOnce(makeTokenResponse());
      mockedWriteCopilotToken.mockRejectedValueOnce(new Error('disk full'));

      const { service, logger } = makeService();
      await expect(service.login()).resolves.toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to persist device code token'),
      );
    });

    it('returns false when device code flow returns null (user cancelled)', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce(null);
      mockedRequestDeviceCode.mockResolvedValueOnce(makeDeviceCodeFixture());
      mockedPollForAccessToken.mockResolvedValueOnce(null);

      const { service } = makeService();
      await expect(service.login()).resolves.toBe(false);
      expect(mockedWriteCopilotToken).not.toHaveBeenCalled();
    });

    it('returns false and logs when the exchange throws an unexpected error', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce('gho_file_token');
      mockedAxios.get.mockRejectedValueOnce(new Error('network meltdown'));
      // Second fallback read (device code path). We don't want it to succeed.
      mockedRequestDeviceCode.mockResolvedValueOnce(makeDeviceCodeFixture());
      mockedPollForAccessToken.mockResolvedValueOnce(null);

      const { service, logger } = makeService();
      await expect(service.login()).resolves.toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Token exchange request failed'),
      );
    });

    it('never logs the full GitHub token (only length + 4-char prefix)', async () => {
      const secret = 'gho_VERYSECRETTOKEN12345';
      mockedReadCopilotToken.mockResolvedValueOnce(secret);
      mockedAxios.get.mockResolvedValueOnce(makeTokenResponse());

      const { service, logger } = makeService();
      await service.login();

      const allLogs = [
        ...logger.info.mock.calls,
        ...logger.warn.mock.calls,
        ...logger.error.mock.calls,
        ...logger.debug.mock.calls,
      ]
        .flat()
        .map((entry) =>
          typeof entry === 'string' ? entry : JSON.stringify(entry),
        )
        .join('\n');

      expect(allLogs).not.toContain(secret);
      // Prefix (first 4 chars) is permitted.
      expect(allLogs).toContain('gho_');
    });
  });

  // -------------------------------------------------------------------------
  // tryRestoreAuth()
  // -------------------------------------------------------------------------

  describe('tryRestoreAuth()', () => {
    it('succeeds silently when the file-based token exchanges cleanly', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce('gho_file');
      mockedAxios.get.mockResolvedValueOnce(makeTokenResponse());

      const { service } = makeService();
      await expect(service.tryRestoreAuth()).resolves.toBe(true);

      // Shorter 5s timeout on the silent restore to avoid blocking startup.
      const [, config] = mockedAxios.get.mock.calls[0] as [
        string,
        { timeout: number },
      ];
      expect(config.timeout).toBe(5_000);
      // Device code flow NEVER runs during silent restore.
      expect(mockedExecuteDeviceCodeFlow).not.toHaveBeenCalled();
    });

    it('returns false without prompting when no file token exists', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce(null);

      const { service } = makeService();
      await expect(service.tryRestoreAuth()).resolves.toBe(false);
      expect(mockedExecuteDeviceCodeFlow).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Token exchange error handling
  // -------------------------------------------------------------------------

  describe('token exchange error handling', () => {
    it('logs a specific hint for HTTP 401 (invalid/expired token)', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce('gho_file');
      mockedAxios.get.mockRejectedValueOnce(
        makeAxiosError(401, { message: 'bad credentials' }),
      );
      mockedRequestDeviceCode.mockResolvedValueOnce(makeDeviceCodeFixture());
      mockedPollForAccessToken.mockResolvedValueOnce(null);

      const { service, logger } = makeService();
      await service.login();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('HTTP 401'),
      );
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('may be invalid or expired'),
      );
    });

    it('logs a specific hint for HTTP 403 (no Copilot subscription)', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce('gho_file');
      mockedAxios.get.mockRejectedValueOnce(
        makeAxiosError(403, { message: 'forbidden' }),
      );
      mockedRequestDeviceCode.mockResolvedValueOnce(makeDeviceCodeFixture());
      mockedPollForAccessToken.mockResolvedValueOnce(null);

      const { service, logger } = makeService();
      await service.login();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('subscription may not be active'),
      );
    });

    it('rejects responses missing `token` or `expires_at`', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce('gho_file');
      mockedAxios.get.mockResolvedValueOnce({
        data: { token: '', expires_at: 0 },
      } as AxiosLikeResponse<CopilotTokenResponse>);
      mockedRequestDeviceCode.mockResolvedValueOnce(makeDeviceCodeFixture());
      mockedPollForAccessToken.mockResolvedValueOnce(null);

      const { service, logger } = makeService();
      await service.login();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          'invalid response (missing token or expires_at)',
        ),
      );
    });

    it('uses the setting-override API endpoint when configured', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce('gho_file');
      mockedAxios.get.mockResolvedValueOnce(
        makeTokenResponse({
          endpoints: { api: 'https://response.example.com' },
        }),
      );

      const { service } = makeService({
        config: {
          'ptah.provider.github-copilot.apiEndpoint':
            'https://override.example.com',
        },
      });
      await service.login();

      const state = await service.getAuthState();
      expect(state?.apiEndpoint).toBe('https://override.example.com');
    });

    it('honours response-provided endpoint when no setting override exists', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce('gho_file');
      mockedAxios.get.mockResolvedValueOnce(
        makeTokenResponse({
          endpoints: { api: 'https://from-response.example.com' },
        }),
      );

      const { service } = makeService();
      await service.login();
      const state = await service.getAuthState();
      expect(state?.apiEndpoint).toBe('https://from-response.example.com');
    });

    it('falls back to the default Copilot API endpoint when neither is present', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce('gho_file');
      mockedAxios.get.mockResolvedValueOnce(
        makeTokenResponse({ endpoints: undefined }),
      );

      const { service } = makeService();
      await service.login();
      const state = await service.getAuthState();
      expect(state?.apiEndpoint).toBe('https://api.githubcopilot.com');
    });

    it('reads from the configured token exchange URL override', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce('gho_file');
      mockedAxios.get.mockResolvedValueOnce(makeTokenResponse());

      const { service } = makeService({
        config: {
          'ptah.provider.github-copilot.tokenExchangeUrl':
            'https://ghe.internal/copilot_internal/v2/token',
        },
      });
      await service.login();

      const [url] = mockedAxios.get.mock.calls[0] as [string];
      expect(url).toBe('https://ghe.internal/copilot_internal/v2/token');
    });
  });

  // -------------------------------------------------------------------------
  // isAuthenticated() / getAuthState()
  // -------------------------------------------------------------------------

  describe('isAuthenticated() / getAuthState()', () => {
    it('returns false before any login attempt', async () => {
      const { service } = makeService();
      await expect(service.isAuthenticated()).resolves.toBe(false);
      await expect(service.getAuthState()).resolves.toBeNull();
    });

    it('returns true while the token has plenty of runway', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce('gho_file');
      mockedAxios.get.mockResolvedValueOnce(
        makeTokenResponse({ expires_at: FROZEN_AT_SECONDS + 3_600 }),
      );

      const { service } = makeService();
      await service.login();
      await expect(service.isAuthenticated()).resolves.toBe(true);
      // getAuthState returns without forcing a refresh.
      await expect(service.getAuthState()).resolves.toMatchObject({
        bearerToken: 'tid_abcdef1234',
      });
    });

    it('auto-refreshes when expiry is inside the 5-minute buffer', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce('gho_file');
      // expires_at in 4 minutes → inside the 5-minute refresh buffer.
      mockedAxios.get.mockResolvedValueOnce(
        makeTokenResponse({
          token: 'tid_stale',
          expires_at: FROZEN_AT_SECONDS + 240,
        }),
      );
      // Refresh call resolves with a fresh token and long expiry.
      mockedAxios.get.mockResolvedValueOnce(
        makeTokenResponse({
          token: 'tid_fresh',
          expires_at: FROZEN_AT_SECONDS + 3_600,
        }),
      );

      const { service } = makeService();
      await service.login();
      await expect(service.isAuthenticated()).resolves.toBe(true);

      const state = await service.getAuthState();
      expect(state?.bearerToken).toBe('tid_fresh');
      // Initial login + refresh = 2 axios.get calls.
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });

    it('clears auth state when refresh fails and no file token is available', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce('gho_file');
      mockedAxios.get.mockResolvedValueOnce(
        makeTokenResponse({
          token: 'tid_stale',
          expires_at: FROZEN_AT_SECONDS + 60, // already inside buffer
        }),
      );
      // Refresh attempt #1 (re-exchange cached github token) fails.
      mockedAxios.get.mockRejectedValueOnce(
        makeAxiosError(401, { message: 'bad creds' }),
      );
      // File-based refresh fallback returns nothing.
      mockedReadCopilotToken.mockResolvedValueOnce(null);

      const { service } = makeService();
      await service.login();
      await expect(service.isAuthenticated()).resolves.toBe(false);
      await expect(service.getAuthState()).resolves.toBeNull();
    });

    it('deduplicates concurrent refresh attempts into a single in-flight promise', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce('gho_file');
      mockedAxios.get.mockResolvedValueOnce(
        makeTokenResponse({
          token: 'tid_stale',
          expires_at: FROZEN_AT_SECONDS + 60,
        }),
      );

      // Refresh call gated on a promise we control.
      let resolveRefresh!: (
        value: AxiosLikeResponse<CopilotTokenResponse>,
      ) => void;
      const refreshPromise = new Promise<
        AxiosLikeResponse<CopilotTokenResponse>
      >((resolve) => {
        resolveRefresh = resolve;
      });
      mockedAxios.get.mockReturnValueOnce(refreshPromise);

      const { service } = makeService();
      await service.login();

      // Two concurrent callers both see the expiring token; they must share
      // the same in-flight refresh.
      const a = service.isAuthenticated();
      const b = service.getAuthState();

      // Only one additional exchange call should be outstanding.
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);

      resolveRefresh(
        makeTokenResponse({
          token: 'tid_fresh',
          expires_at: FROZEN_AT_SECONDS + 3_600,
        }),
      );

      await expect(a).resolves.toBe(true);
      await expect(b).resolves.toMatchObject({ bearerToken: 'tid_fresh' });
      // Still just one refresh — not duplicated.
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // getHeaders()
  // -------------------------------------------------------------------------

  describe('getHeaders()', () => {
    it('throws SdkError when not authenticated', async () => {
      const { service } = makeService();
      await expect(service.getHeaders()).rejects.toBeInstanceOf(SdkError);
    });

    it('emits the full Copilot header set with Bearer auth', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce('gho_file');
      mockedAxios.get.mockResolvedValueOnce(makeTokenResponse());

      const { service } = makeService();
      await service.login();

      const headers = await service.getHeaders();
      expect(headers['Authorization']).toBe('Bearer tid_abcdef1234');
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Openai-Intent']).toBe('conversation-edits');
      expect(headers['Copilot-Integration-Id']).toBe('vscode-chat');
      expect(headers['x-initiator']).toBe('user');
      // Version defaults to 0.0.0 when extension package.json is absent.
      expect(headers['User-Agent']).toMatch(/^ptah-extension\//);
      expect(headers['Editor-Version']).toMatch(/^ptah\//);
      expect(headers['Editor-Plugin-Version']).toMatch(/^ptah\//);
    });
  });

  // -------------------------------------------------------------------------
  // logout()
  // -------------------------------------------------------------------------

  describe('logout()', () => {
    it('clears in-memory state so subsequent getHeaders() throws', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce('gho_file');
      mockedAxios.get.mockResolvedValueOnce(makeTokenResponse());

      const { service } = makeService();
      await service.login();
      await expect(service.getHeaders()).resolves.toBeDefined();

      await service.logout();

      await expect(service.isAuthenticated()).resolves.toBe(false);
      await expect(service.getAuthState()).resolves.toBeNull();
      await expect(service.getHeaders()).rejects.toBeInstanceOf(SdkError);
    });

    it('does not call any remote revocation endpoint', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce('gho_file');
      mockedAxios.get.mockResolvedValueOnce(makeTokenResponse());

      const { service } = makeService();
      await service.login();
      mockedAxios.get.mockClear();

      await service.logout();
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Headless device-code API: beginLogin() / pollLogin() / cancelLogin()
  // -------------------------------------------------------------------------

  describe('beginLogin() / pollLogin() / cancelLogin()', () => {
    it('beginLogin returns the device-code metadata in the documented shape', async () => {
      mockedRequestDeviceCode.mockResolvedValueOnce(
        makeDeviceCodeFixture({
          device_code: 'D1',
          user_code: 'U1',
          verification_uri: 'https://x.example.com',
          interval: 5,
          expires_in: 600,
        }),
      );

      const { service } = makeService();
      const info = await service.beginLogin();

      expect(info).toEqual({
        deviceCode: 'D1',
        userCode: 'U1',
        verificationUri: 'https://x.example.com',
        interval: 5,
        expiresIn: 600,
      });
      expect(mockedRequestDeviceCode).toHaveBeenCalledWith(
        'Iv1.b507a08c87ecfe98',
      );
    });

    it('pollLogin happy path: polls, exchanges, and persists the token', async () => {
      mockedRequestDeviceCode.mockResolvedValueOnce(
        makeDeviceCodeFixture({ device_code: 'D-happy' }),
      );
      mockedPollForAccessToken.mockResolvedValueOnce('access_token_value');
      mockedAxios.get.mockResolvedValueOnce(makeTokenResponse());
      mockedWriteCopilotToken.mockResolvedValueOnce(undefined);

      const { service } = makeService();
      const { deviceCode } = await service.beginLogin();

      await expect(service.pollLogin(deviceCode)).resolves.toBe(true);

      expect(mockedPollForAccessToken).toHaveBeenCalledWith(
        'D-happy',
        'Iv1.b507a08c87ecfe98',
        expect.objectContaining({
          intervalMs: 5_000,
          timeoutMs: 5 * 60 * 1000,
          signal: expect.any(AbortSignal),
        }),
      );
      expect(mockedWriteCopilotToken).toHaveBeenCalledWith(
        'access_token_value',
      );
      // Auth state populated.
      const state = await service.getAuthState();
      expect(state?.bearerToken).toBe('tid_abcdef1234');
    });

    it('pollLogin returns false on 5-min timeout without persisting any token', async () => {
      mockedRequestDeviceCode.mockResolvedValueOnce(
        makeDeviceCodeFixture({ device_code: 'D-timeout' }),
      );
      mockedPollForAccessToken.mockResolvedValueOnce(null); // timed out

      const { service } = makeService();
      const { deviceCode } = await service.beginLogin();

      await expect(service.pollLogin(deviceCode)).resolves.toBe(false);

      expect(mockedWriteCopilotToken).not.toHaveBeenCalled();
      // No exchange call either.
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('pollLogin honours the explicit timeoutMs override', async () => {
      mockedRequestDeviceCode.mockResolvedValueOnce(
        makeDeviceCodeFixture({ device_code: 'D-custom-timeout' }),
      );
      mockedPollForAccessToken.mockResolvedValueOnce(null);

      const { service } = makeService();
      const { deviceCode } = await service.beginLogin();
      await service.pollLogin(deviceCode, { timeoutMs: 60_000 });

      expect(mockedPollForAccessToken).toHaveBeenCalledWith(
        'D-custom-timeout',
        expect.any(String),
        expect.objectContaining({ timeoutMs: 60_000 }),
      );
    });

    it('cancelLogin aborts the in-flight pollLogin and stops further axios calls', async () => {
      mockedRequestDeviceCode.mockResolvedValueOnce(
        makeDeviceCodeFixture({ device_code: 'D-cancel' }),
      );
      // Implementation: capture the AbortSignal passed in and resolve `null`
      // when the signal fires. This proves the wiring (cancelLogin →
      // entry.abortController.abort() → signal seen by pollForAccessToken).
      let capturedSignal: AbortSignal | undefined;
      mockedPollForAccessToken.mockImplementationOnce(
        async (_dc, _cid, opts) => {
          capturedSignal = opts?.signal;
          return new Promise<string | null>((resolve) => {
            opts?.signal?.addEventListener('abort', () => resolve(null), {
              once: true,
            });
          });
        },
      );

      const { service } = makeService();
      const { deviceCode } = await service.beginLogin();
      const pollPromise = service.pollLogin(deviceCode);

      // Trigger cancel; the captured signal must abort and the poll resolve.
      service.cancelLogin(deviceCode);

      await expect(pollPromise).resolves.toBe(false);
      expect(capturedSignal?.aborted).toBe(true);
      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(mockedWriteCopilotToken).not.toHaveBeenCalled();
    });

    it('cancelLogin is a no-op for unknown deviceCodes', async () => {
      const { service, logger } = makeService();
      // Should not throw.
      service.cancelLogin('unknown-device-code');
      // No info log about cancellation either (the entry didn't exist).
      const cancelLogs = logger.info.mock.calls
        .map((args) => String(args[0] ?? ''))
        .filter((line) => line.includes('Cancelled in-flight device-code'));
      expect(cancelLogs).toHaveLength(0);
    });

    it('pollLogin returns false when called with an unknown deviceCode', async () => {
      const { service } = makeService();
      await expect(service.pollLogin('never-began')).resolves.toBe(false);
      expect(mockedPollForAccessToken).not.toHaveBeenCalled();
    });

    it('two concurrent beginLogin flows produce distinct deviceCodes and poll independently', async () => {
      mockedRequestDeviceCode
        .mockResolvedValueOnce(
          makeDeviceCodeFixture({ device_code: 'D-A', user_code: 'UA' }),
        )
        .mockResolvedValueOnce(
          makeDeviceCodeFixture({ device_code: 'D-B', user_code: 'UB' }),
        );

      // First poll succeeds; second is cancelled while in flight.
      mockedPollForAccessToken
        .mockResolvedValueOnce('gho_A')
        .mockImplementationOnce(async (_dc, _cid, opts) => {
          return new Promise<string | null>((resolve) => {
            opts?.signal?.addEventListener('abort', () => resolve(null), {
              once: true,
            });
          });
        });

      // Exchange + persist for flow A.
      mockedAxios.get.mockResolvedValueOnce(makeTokenResponse());
      mockedWriteCopilotToken.mockResolvedValueOnce(undefined);

      const { service } = makeService();
      const a = await service.beginLogin();
      const b = await service.beginLogin();
      expect(a.deviceCode).toBe('D-A');
      expect(b.deviceCode).toBe('D-B');
      expect(a.deviceCode).not.toBe(b.deviceCode);

      const pollA = service.pollLogin(a.deviceCode);
      const pollB = service.pollLogin(b.deviceCode);

      // Cancel only B while A is allowed to complete.
      service.cancelLogin(b.deviceCode);

      await expect(pollA).resolves.toBe(true);
      await expect(pollB).resolves.toBe(false);
    });

    it('legacy login() preserves the webview UX: clipboard + info message + browser open', async () => {
      // No file token → device-code path drives the new begin/poll surface
      // internally; the IUserInteraction wiring lives in login() itself.
      mockedReadCopilotToken.mockResolvedValueOnce(null);
      mockedRequestDeviceCode.mockResolvedValueOnce(
        makeDeviceCodeFixture({
          device_code: 'D-ux',
          user_code: 'UX-CODE',
          verification_uri: 'https://github.com/login/device',
        }),
      );
      mockedPollForAccessToken.mockResolvedValueOnce('gho_ux_token');
      mockedAxios.get.mockResolvedValueOnce(makeTokenResponse());
      mockedWriteCopilotToken.mockResolvedValueOnce(undefined);

      const { service, userInteraction } = makeService();
      await expect(service.login()).resolves.toBe(true);

      expect(userInteraction.writeToClipboard).toHaveBeenCalledWith('UX-CODE');
      expect(userInteraction.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('UX-CODE'),
        'OK',
      );
      expect(userInteraction.openExternal).toHaveBeenCalledWith(
        'https://github.com/login/device',
      );
    });
  });
  // -------------------------------------------------------------------------
  // Logout tombstone (TASK_2026_172 Issue 2)
  // -------------------------------------------------------------------------

  /**
   * `logout()` used to null only in-memory state. `hosts.json` survived, so
   * the next `configure()` -> `tryRestoreAuth()` silently signed the user back
   * in and logout appeared to do nothing.
   *
   * The fix is a Ptah-side tombstone in the settings store, NOT a delete of
   * `~/.config/github-copilot/hosts.json` — that file is shared with the
   * user's editor Copilot integrations, so deleting it would sign them out
   * everywhere. These specs pin both halves: the tombstone must stop silent
   * restore, and the shared credential file must never be written or removed
   * by logout.
   */
  describe('logout tombstone', () => {
    it('persists the tombstone so logout survives a process restart', async () => {
      const { service, settingsStore } = makeService();

      await service.logout();

      expect(settingsStore.writeGlobal).toHaveBeenCalledWith(
        TOMBSTONE_KEY,
        true,
      );
      expect(settingsStore.values.get(TOMBSTONE_KEY)).toBe(true);
    });

    it('never touches the shared hosts.json on logout', async () => {
      const { service } = makeService();

      await service.logout();

      expect(mockedWriteCopilotToken).not.toHaveBeenCalled();
      expect(mockedReadCopilotToken).not.toHaveBeenCalled();
    });

    it('login -> logout -> configure does NOT silently re-authenticate', async () => {
      // 1. Explicit login via the file token.
      mockedReadCopilotToken.mockResolvedValueOnce('gho_file_token');
      mockedAxios.get.mockResolvedValueOnce(makeTokenResponse());
      const { service } = makeService();
      await expect(service.login()).resolves.toBe(true);
      await expect(service.isAuthenticated()).resolves.toBe(true);

      // 2. Explicit logout.
      await service.logout();
      await expect(service.isAuthenticated()).resolves.toBe(false);

      // 3. What `configure()` does on the next run. hosts.json is still on
      //    disk and would exchange fine — the tombstone is what stops it.
      //    Clearing the call history isolates this step from the login above.
      mockedReadCopilotToken.mockClear();
      mockedReadCopilotToken.mockResolvedValue('gho_file_token');
      mockedAxios.get.mockResolvedValue(makeTokenResponse());

      await expect(service.tryRestoreAuth()).resolves.toBe(false);
      // The shared credential file was never even opened.
      expect(mockedReadCopilotToken).not.toHaveBeenCalled();
      await expect(service.isAuthenticated()).resolves.toBe(false);
    });

    it('honours a tombstone written by a previous process (cold start)', async () => {
      mockedReadCopilotToken.mockResolvedValue('gho_file_token');
      mockedAxios.get.mockResolvedValue(makeTokenResponse());

      const { service } = makeService({ settings: { [TOMBSTONE_KEY]: true } });

      await expect(service.tryRestoreAuth()).resolves.toBe(false);
      expect(mockedReadCopilotToken).not.toHaveBeenCalled();
    });

    it('restores silently when no tombstone is present', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce('gho_file_token');
      mockedAxios.get.mockResolvedValueOnce(makeTokenResponse());

      const { service } = makeService();

      await expect(service.tryRestoreAuth()).resolves.toBe(true);
      expect(mockedReadCopilotToken).toHaveBeenCalledTimes(1);
    });

    it('explicit login() clears the tombstone and re-authenticates', async () => {
      // Persistent (not `…Once`) so the follow-up silent restore below has a
      // token to find too — the point is that restore is no longer blocked.
      mockedReadCopilotToken.mockResolvedValue('gho_file_token');
      mockedAxios.get.mockResolvedValue(makeTokenResponse());

      const { service, settingsStore } = makeService({
        settings: { [TOMBSTONE_KEY]: true },
      });

      await expect(service.login()).resolves.toBe(true);

      expect(settingsStore.writeGlobal).toHaveBeenCalledWith(
        TOMBSTONE_KEY,
        false,
      );
      expect(settingsStore.values.get(TOMBSTONE_KEY)).toBe(false);
      await expect(service.isAuthenticated()).resolves.toBe(true);
      // And silent restore works again afterwards.
      await expect(service.tryRestoreAuth()).resolves.toBe(true);
    });

    it('headless re-login (beginLogin + pollLogin) clears the tombstone too', async () => {
      mockedRequestDeviceCode.mockResolvedValueOnce(makeDeviceCodeFixture());
      mockedPollForAccessToken.mockResolvedValueOnce('gho_device_token');
      mockedAxios.get.mockResolvedValueOnce(makeTokenResponse());
      mockedWriteCopilotToken.mockResolvedValueOnce(undefined);

      const { service, settingsStore } = makeService({
        settings: { [TOMBSTONE_KEY]: true },
      });

      const info = await service.beginLogin();
      await expect(service.pollLogin(info.deviceCode)).resolves.toBe(true);

      expect(settingsStore.values.get(TOMBSTONE_KEY)).toBe(false);
    });

    it('a failed poll leaves the tombstone in place', async () => {
      mockedRequestDeviceCode.mockResolvedValueOnce(makeDeviceCodeFixture());
      mockedPollForAccessToken.mockResolvedValueOnce(null);

      const { service, settingsStore } = makeService({
        settings: { [TOMBSTONE_KEY]: true },
      });

      const info = await service.beginLogin();
      await expect(service.pollLogin(info.deviceCode)).resolves.toBe(false);

      expect(settingsStore.values.get(TOMBSTONE_KEY)).toBe(true);
    });

    it('a settings-store read failure fails open (never harder than the user asked)', async () => {
      mockedReadCopilotToken.mockResolvedValueOnce('gho_file_token');
      mockedAxios.get.mockResolvedValueOnce(makeTokenResponse());

      const { service, settingsStore, logger } = makeService();
      settingsStore.readGlobal = (() => {
        throw new Error('settings file corrupt');
      }) as typeof settingsStore.readGlobal;

      await expect(service.tryRestoreAuth()).resolves.toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read logout tombstone'),
      );
    });

    it('a settings-store write failure still clears in-memory state and warns', async () => {
      const { service, settingsStore, logger } = makeService();
      settingsStore.writeGlobal.mockRejectedValueOnce(new Error('disk full'));

      await expect(service.logout()).resolves.toBeUndefined();
      await expect(service.isAuthenticated()).resolves.toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to persist logout tombstone'),
      );
    });
  });
});
