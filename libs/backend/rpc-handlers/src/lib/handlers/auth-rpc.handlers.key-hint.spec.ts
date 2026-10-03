/**
 * AuthRpcHandlers — masked stored-key hint (TASK_2026_555 Batch 28c, Task 28c.1).
 *
 * Proves, on the SERIALISED RPC response, that the full key never crosses RPC:
 *   - `auth:getApiKeyStatus` carries `keyHint` per stored provider key.
 *   - `auth:getAuthStatus` carries `apiKeyHint` for the Claude API key.
 *   - Neither the response, the logs nor Sentry hold the key or ANY substring of
 *     it longer than 4 characters (success and key-store failure paths).
 *   - Short, blank and absent keys get no hint.
 *   - A key-store read failure is a fixed error with no key text.
 *   - The hint helper is never called on the write path.
 */

import 'reflect-metadata';

import type {
  ConfigManager,
  IAuthSecretsService,
  Logger,
  RpcHandler,
  SentryService,
} from '@ptah-extension/vscode-core';
import {
  createMockAuthSecretsService,
  createMockConfigManager,
  createMockRpcHandler,
  createMockSentryService,
  type MockAuthSecretsService,
  type MockRpcHandler,
  type MockSentryService,
} from '@ptah-extension/vscode-core/testing';
import type {
  IPlatformAuthProvider,
  IPlatformCommands,
} from '@ptah-extension/platform-core';
import {
  createMockAuthProvider,
  createMockPlatformCommands,
} from '@ptah-extension/platform-core/testing';
import type {
  ClaudeCliDetector,
  SdkAgentAdapter,
} from '@ptah-extension/agent-sdk';
import type {
  CopilotAuthService,
  DraftVerificationService,
  ICodexAuthService,
  ProviderModelsService,
} from '@ptah-extension/auth-providers';
import { ActiveProviderResolver } from '@ptah-extension/auth-providers';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import type { WorkspaceScopeResolver } from '@ptah-extension/settings-core';
import type {
  AuthGetApiKeyStatusResult,
  AuthGetAuthStatusResponse,
} from '@ptah-extension/shared';

import { maskKeyHint } from '../utils/mask-key-hint';
import { ConnectionCheckRecorder } from '../utils/connection-check-recorder';
import { AuthRpcHandlers } from './auth-rpc.handlers';

jest.mock('../utils/mask-key-hint', () => {
  const actual = jest.requireActual<typeof import('../utils/mask-key-hint')>(
    '../utils/mask-key-hint',
  );
  return { ...actual, maskKeyHint: jest.fn(actual.maskKeyHint) };
});

const maskKeyHintSpy = maskKeyHint as jest.MockedFunction<typeof maskKeyHint>;

const BULLETS = '\u2022\u2022\u2022\u2022';

/** No dictionary words, so a 5-character window cannot collide with JSON field names. */
const LONG_KEY = 'QX7vZ9pL2vB4nR8tK1mW3cY6hJ0fD5gS2Hq8f21'; // 39
const LONGER_KEY = 'Vb8Nq2Lr7Tw4Yz1Kp6Jm3Xc9Hd5Gf0Sa8Ue2Io7Pk4R'; // 44
const TWELVE_KEY = 'Wq3Rt7Yu1Op9'; // exactly 12
const SHORT_KEY = 'Zx4Cv8Bn2Ml'; // 11

// ---------------------------------------------------------------------------
// Leak assertions
// ---------------------------------------------------------------------------

/** Every substring of `secret` longer than 4 characters (the widest allowed exposure is 4). */
function windowsLongerThanFour(secret: string): string[] {
  const out = new Set<string>();
  for (let i = 0; i + 5 <= secret.length; i++) out.add(secret.slice(i, i + 5));
  return [...out];
}

function expectNoKeyMaterial(
  serialised: string,
  secrets: readonly string[],
): void {
  for (const secret of secrets) {
    expect(serialised).not.toContain(secret);
    for (const window of windowsLongerThanFour(secret)) {
      expect(serialised).not.toContain(window);
    }
  }
}

/** Every log line and Sentry capture, flattened to text (Error messages included). */
function diagnosticsText(h: Harness): string {
  const parts: unknown[] = [];
  for (const fn of [
    h.logger.debug,
    h.logger.info,
    h.logger.warn,
    h.logger.error,
  ]) {
    for (const args of fn.mock.calls) parts.push(args);
  }
  for (const args of h.sentry.captureException.mock.calls) parts.push(args);
  return JSON.stringify(parts, (_key, value: unknown) =>
    value instanceof Error
      ? { name: value.name, message: value.message, stack: value.stack }
      : value,
  );
}

// ---------------------------------------------------------------------------
// Harness (same shape as auth-rpc.handlers.delete-stored-key.spec.ts)
// ---------------------------------------------------------------------------

interface Harness {
  handlers: AuthRpcHandlers;
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  authSecrets: MockAuthSecretsService;
  sentry: MockSentryService;
}

function makeHarness(
  opts: {
    credentialsSeed?: { apiKey?: string };
    providerKeysSeed?: Record<string, string>;
  } = {},
): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();
  const authSecrets = createMockAuthSecretsService({
    credentials: opts.credentialsSeed,
    providerKeys: opts.providerKeysSeed,
  });
  const sentry = createMockSentryService();
  const store = new Map<string, unknown>();
  const scopeResolver = {
    read: jest.fn((key: string) => store.get(key)),
    hasOverride: jest.fn(() => false),
    write: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    clearOverride: jest.fn(async () => undefined),
    clearMoreSpecific: jest.fn(async () => undefined),
    effectiveKey: jest.fn((key: string) => key),
    getActivePath: jest.fn(() => undefined),
  };

  const handlers = new AuthRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as RpcHandler,
    createMockConfigManager() as unknown as ConfigManager,
    authSecrets as unknown as IAuthSecretsService,
    {
      getHealth: jest.fn(() => ({ status: 'available', lastCheck: 0 })),
      reset: jest.fn(async () => undefined),
    } as unknown as SdkAgentAdapter,
    {
      clearCache: jest.fn(),
      getModelTiers: jest.fn(() => ({})),
      setModelTier: jest.fn(async () => undefined),
    } as unknown as ProviderModelsService,
    new ActiveProviderResolver(
      scopeResolver as unknown as WorkspaceScopeResolver,
    ),
    {
      isAuthenticated: jest.fn(async () => false),
    } as unknown as CopilotAuthService,
    {
      getTokenStatus: jest.fn(async () => ({
        authenticated: false,
        stale: false,
      })),
      clearCache: jest.fn(),
    } as unknown as ICodexAuthService,
    createMockPlatformCommands() as unknown as IPlatformCommands,
    createMockAuthProvider() as unknown as IPlatformAuthProvider,
    {
      performHealthCheck: jest.fn(async () => ({
        available: false,
        lastCheck: 0,
      })),
    } as unknown as ClaudeCliDetector,
    sentry as unknown as SentryService,
    scopeResolver as unknown as WorkspaceScopeResolver,
    {} as unknown as DraftVerificationService,
    new ConnectionCheckRecorder(),
  );
  handlers.register();
  return { handlers, logger, rpcHandler, authSecrets, sentry };
}

async function rpc(h: Harness, method: string, params: unknown = {}) {
  return h.rpcHandler.handleMessage({
    method,
    params: params as Record<string, unknown>,
    correlationId: `corr-${method}`,
  });
}

beforeEach(() => {
  maskKeyHintSpy.mockClear();
});

// ---------------------------------------------------------------------------
// auth:getApiKeyStatus
// ---------------------------------------------------------------------------

describe('AuthRpcHandlers — auth:getApiKeyStatus keyHint', () => {
  const seeded = {
    openrouter: LONGER_KEY,
    moonshot: LONG_KEY,
    'z-ai': TWELVE_KEY,
  };

  it('returns bullets + last 4 per stored key, and the serialised result holds no other key material', async () => {
    const h = makeHarness({ providerKeysSeed: seeded });

    const response = await rpc(h, 'auth:getApiKeyStatus');
    const result = response.data as AuthGetApiKeyStatusResult;
    const byId = new Map(result.providers.map((p) => [p.provider, p]));

    expect(response.success).toBe(true);
    expect(byId.get('openrouter')?.keyHint).toBe(
      `${BULLETS} ${LONGER_KEY.slice(-4)}`,
    );
    expect(byId.get('moonshot')?.keyHint).toBe(`${BULLETS} 8f21`);
    expect(byId.get('z-ai')?.keyHint).toBe(
      `${BULLETS} ${TWELVE_KEY.slice(-4)}`,
    );
    expect(byId.get('moonshot')?.hasApiKey).toBe(true);
    expectNoKeyMaterial(JSON.stringify(response), Object.values(seeded));
  });

  it('gives no keyHint (and omits the field) for an absent, 11-character or whitespace-only key', async () => {
    const h = makeHarness({
      providerKeysSeed: { openrouter: SHORT_KEY, moonshot: '     \t   ' },
    });

    const response = await rpc(h, 'auth:getApiKeyStatus');
    const result = response.data as AuthGetApiKeyStatusResult;
    const byId = new Map(result.providers.map((p) => [p.provider, p]));

    expect(byId.get('openrouter')?.hasApiKey).toBe(true);
    expect(byId.get('openrouter')).not.toHaveProperty('keyHint');
    expect(byId.get('moonshot')).not.toHaveProperty('keyHint');
    expect(byId.get('z-ai')?.hasApiKey).toBe(false);
    expect(byId.get('z-ai')).not.toHaveProperty('keyHint');
    expectNoKeyMaterial(JSON.stringify(response), [SHORT_KEY]);
  });

  it('gives no keyHint to sign-in and CLI connections (Copilot, Codex, Claude CLI) and does not list Cursor', async () => {
    const h = makeHarness({ providerKeysSeed: seeded });

    const result = (await rpc(h, 'auth:getApiKeyStatus'))
      .data as AuthGetApiKeyStatusResult;

    for (const id of ['github-copilot', 'openai-codex', 'claude-cli']) {
      expect(
        result.providers.find((p) => p.provider === id)?.keyHint,
      ).toBeUndefined();
    }
    expect(result.providers.some((p) => p.provider === 'cursor')).toBe(false);
  });

  it('never writes the key or the hint to a log line or Sentry', async () => {
    const h = makeHarness({ providerKeysSeed: seeded });

    await rpc(h, 'auth:getApiKeyStatus');

    const text = diagnosticsText(h);
    expectNoKeyMaterial(text, Object.values(seeded));
    expect(text).not.toContain('\u2022');
  });

  it('one unreadable key marks only its entry; the other providers still load (final review M-6)', async () => {
    const h = makeHarness({ providerKeysSeed: seeded });
    const readKey = h.authSecrets.getProviderKey.getMockImplementation();
    h.authSecrets.getProviderKey.mockImplementation(async (id: string) => {
      if (id === 'moonshot') {
        throw new Error(
          `secrets.json decrypt failed near "${LONG_KEY}" at C:\\Users\\someone\\.ptah`,
        );
      }
      return readKey ? readKey(id) : undefined;
    });

    const response = await rpc(h, 'auth:getApiKeyStatus');
    const result = response.data as AuthGetApiKeyStatusResult;
    const byId = new Map(result.providers.map((p) => [p.provider, p]));

    expect(response.success).toBe(true);
    expect(byId.get('moonshot')).toMatchObject({
      hasApiKey: false,
      keyUnreadable: true,
    });
    expect(byId.get('moonshot')).not.toHaveProperty('keyHint');
    expect(byId.get('openrouter')).toMatchObject({ hasApiKey: true });
    expect(byId.get('openrouter')).not.toHaveProperty('keyUnreadable');
    expect(byId.get('z-ai')?.keyHint).toBe(
      `${BULLETS} ${TWELVE_KEY.slice(-4)}`,
    );
    const serialised = JSON.stringify(response);
    expect(serialised).not.toContain('decrypt');
    expect(serialised).not.toContain('someone');
    expectNoKeyMaterial(serialised, [LONG_KEY]);
    const diagnostics = diagnosticsText(h);
    expect(diagnostics).not.toContain('decrypt');
    expectNoKeyMaterial(diagnostics, Object.values(seeded));
  });

  it('when no key can be read it is a fixed error: no hint, no key text, no raw store message', async () => {
    const h = makeHarness({ providerKeysSeed: seeded });
    h.authSecrets.getProviderKey.mockRejectedValue(
      new Error(
        `secrets.json decrypt failed near "${LONG_KEY}" at C:\\Users\\someone\\.ptah`,
      ),
    );

    const response = await rpc(h, 'auth:getApiKeyStatus');

    expect(response.success).toBe(false);
    expect(response.error).toBe('Could not read the stored keys.');
    expect(response.errorCode).toBe('PERSISTENCE_UNAVAILABLE');
    expect(response.data).toBeUndefined();
    const serialised = JSON.stringify(response);
    expect(serialised).not.toContain('\u2022');
    expect(serialised).not.toContain('decrypt');
    expect(serialised).not.toContain('someone');
    expectNoKeyMaterial(serialised, Object.values(seeded));
    expectNoKeyMaterial(diagnosticsText(h), Object.values(seeded));
  });
});

// ---------------------------------------------------------------------------
// auth:getAuthStatus
// ---------------------------------------------------------------------------

describe('AuthRpcHandlers — auth:getAuthStatus apiKeyHint', () => {
  it('returns the Claude API key hint and nothing else of the key', async () => {
    // No vendor prefix: `availableProviders` legitimately lists key prefixes.
    const claudeKey = 'Hy6Tg2Rf8Ed4Ws0Qa7Zx3Cv9Bn5Mk1Lp8f21Aa';
    const h = makeHarness({
      credentialsSeed: { apiKey: claudeKey },
      providerKeysSeed: { moonshot: LONG_KEY },
    });

    const response = await rpc(h, 'auth:getAuthStatus');
    const result = response.data as AuthGetAuthStatusResponse;

    expect(result.hasApiKey).toBe(true);
    expect(result.apiKeyHint).toBe(`${BULLETS} 21Aa`);
    expectNoKeyMaterial(JSON.stringify(response), [claudeKey, LONG_KEY]);
    expectNoKeyMaterial(diagnosticsText(h), [claudeKey, LONG_KEY]);
    expect(diagnosticsText(h)).not.toContain('\u2022');
  });

  it('omits apiKeyHint for a short key and for no key', async () => {
    const short = makeHarness({ credentialsSeed: { apiKey: SHORT_KEY } });
    const shortResult = (await rpc(short, 'auth:getAuthStatus'))
      .data as AuthGetAuthStatusResponse;
    expect(shortResult.hasApiKey).toBe(true);
    expect(shortResult).not.toHaveProperty('apiKeyHint');

    const none = makeHarness();
    const noneResult = (await rpc(none, 'auth:getAuthStatus'))
      .data as AuthGetAuthStatusResponse;
    expect(noneResult.hasApiKey).toBe(false);
    expect(noneResult).not.toHaveProperty('apiKeyHint');
  });

  it('a key-store read failure is a fixed error with no key text', async () => {
    const h = makeHarness({ credentialsSeed: { apiKey: LONGER_KEY } });
    h.authSecrets.getCredential.mockRejectedValueOnce(
      new Error(`keychain returned "${LONGER_KEY}"`),
    );

    const response = await rpc(h, 'auth:getAuthStatus');

    expect(response.success).toBe(false);
    expect(response.error).toBe('Could not read the stored keys.');
    expect(response.errorCode).toBe('PERSISTENCE_UNAVAILABLE');
    expectNoKeyMaterial(JSON.stringify(response), [LONGER_KEY]);
    expectNoKeyMaterial(diagnosticsText(h), [LONGER_KEY]);
  });
});

// ---------------------------------------------------------------------------
// Write path
// ---------------------------------------------------------------------------

describe('AuthRpcHandlers — the hint is read-path only', () => {
  it('never computes a hint (or reads a key back) when a key is stored or deleted', async () => {
    const h = makeHarness({ providerKeysSeed: { moonshot: LONG_KEY } });

    await rpc(h, 'auth:setApiKey', {
      provider: 'openrouter',
      apiKey: LONGER_KEY,
    });
    await rpc(h, 'auth:setApiKey', { provider: 'z-ai', apiKey: '' });
    await rpc(h, 'auth:deleteStoredKey', { providerId: 'moonshot' });
    await rpc(h, 'auth:deleteStoredKey', { providerId: 'anthropic' });

    expect(maskKeyHintSpy).not.toHaveBeenCalled();
    expect(h.authSecrets.getProviderKey).not.toHaveBeenCalled();
    expect(h.authSecrets.getCredential).not.toHaveBeenCalled();
  });

  it('the read path does call it (sanity check of the spy)', async () => {
    const h = makeHarness({ providerKeysSeed: { moonshot: LONG_KEY } });

    await rpc(h, 'auth:getApiKeyStatus');

    expect(maskKeyHintSpy).toHaveBeenCalled();
  });
});
