/**
 * AuthRpcHandlers — auth:checkConnection and route `lastCheck`
 * (TASK_2026_555 Batch 28c, Task 28c.2).
 *
 *   - Params are validated with zod at the boundary; bad or unknown ids and
 *     connections without a check get fixed RpcUserError text.
 *   - A check is recorded and read back on `auth:getEffectiveRoute`
 *     `providers[].lastCheck`; the route itself never records.
 *   - `auth:verifyDraftConnection` never writes a saved connection's record.
 *   - The serialised result carries no key and no probe detail text.
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
  type MockRpcHandler,
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
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { WorkspaceScopeResolver } from '@ptah-extension/settings-core';
import type {
  AuthGetEffectiveRouteResult,
  AuthVerifyDraftConnectionResult,
  ConnectionCheckRecord,
} from '@ptah-extension/shared';

import { ConnectionCheckRecorder } from '../utils/connection-check-recorder';
import { AuthRpcHandlers } from './auth-rpc.handlers';

const KEY = 'FAKE0KEY1QQQ2WWW3ZZZ4XXX';

interface Harness {
  rpcHandler: MockRpcHandler;
  verify: jest.Mock;
  recorder: ConnectionCheckRecorder;
}

function makeHarness(
  verified: Partial<AuthVerifyDraftConnectionResult> = {},
): Harness {
  const rpcHandler = createMockRpcHandler();
  const store = new Map<string, unknown>([['authMethod', 'apiKey']]);
  const scopeResolver = {
    read: jest.fn((key: string) => store.get(key)),
    hasOverride: jest.fn(() => false),
    write: jest.fn(async () => undefined),
    clearOverride: jest.fn(async () => undefined),
    clearMoreSpecific: jest.fn(async () => undefined),
    effectiveKey: jest.fn((key: string) => key),
    getActivePath: jest.fn(() => undefined),
  };
  const verify = jest.fn(
    async (): Promise<AuthVerifyDraftConnectionResult> => ({
      probeId: 'p',
      outcome: 'verified',
      reason: null,
      detail: `used key ${KEY}`,
      latencyMs: 92,
      modelUsed: 'kimi-k2',
      checkedAt: '2026-10-01T00:00:00.000Z',
      ...verified,
    }),
  );
  const recorder = new ConnectionCheckRecorder();
  const handlers = new AuthRpcHandlers(
    createMockLogger() as unknown as Logger,
    rpcHandler as unknown as RpcHandler,
    createMockConfigManager() as unknown as ConfigManager,
    createMockAuthSecretsService({
      providerKeys: { moonshot: KEY },
    }) as unknown as IAuthSecretsService,
    { getHealth: jest.fn(), reset: jest.fn() } as unknown as SdkAgentAdapter,
    {
      clearCache: jest.fn(),
      getModelTiers: jest.fn(() => ({})),
      setModelTier: jest.fn(),
    } as unknown as ProviderModelsService,
    new ActiveProviderResolver(
      scopeResolver as unknown as WorkspaceScopeResolver,
    ),
    {
      isAuthenticated: jest.fn(async () => true),
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
        available: true,
        lastCheck: 0,
      })),
    } as unknown as ClaudeCliDetector,
    createMockSentryService() as unknown as SentryService,
    scopeResolver as unknown as WorkspaceScopeResolver,
    { verify, cancel: jest.fn() } as unknown as DraftVerificationService,
    recorder,
  );
  handlers.register();
  // The route composes this catalogue read; a real host registers it in LlmRpcHandlers.
  rpcHandler.registerMethod('llm:getProviderStatus', async () => ({
    providers: [
      {
        name: 'moonshot',
        authType: 'apiKey',
        hasApiKey: true,
        isLocal: false,
        requiresProxy: false,
      },
      {
        name: 'z-ai',
        authType: 'apiKey',
        hasApiKey: false,
        isLocal: false,
        requiresProxy: false,
      },
      {
        name: 'github-copilot',
        authType: 'oauth',
        hasApiKey: false,
        isLocal: false,
        requiresProxy: false,
      },
    ],
  }));
  return { rpcHandler, verify, recorder };
}

async function rpc(h: Harness, method: string, params: unknown) {
  return h.rpcHandler.handleMessage({
    method,
    params: params as Record<string, unknown>,
    correlationId: `corr-${method}`,
  });
}

async function routeProvider(h: Harness, id: string) {
  const response = await rpc(h, 'auth:getEffectiveRoute', {});
  expect(response.success).toBe(true);
  return (response.data as AuthGetEffectiveRouteResult).providers.find(
    (p) => p.id === id,
  );
}

describe('auth:checkConnection — boundary validation', () => {
  it.each([
    ['no params', undefined],
    ['an empty id', { providerId: '' }],
    ['a whitespace id', { providerId: '   ' }],
    ['a non-string id', { providerId: 42 }],
    [
      'an extra field',
      { providerId: 'moonshot', baseUrl: 'https://evil.example' },
    ],
    ['an over-long id', { providerId: 'x'.repeat(129) }],
  ])(
    'rejects %s with the standard invalid-params text and no probe (M-2)',
    async (_label, params) => {
      const h = makeHarness();
      const response = await rpc(h, 'auth:checkConnection', params);

      expect(response).toMatchObject({
        success: false,
        error: 'Invalid parameters for auth:checkConnection',
        errorCode: 'INVALID_PARAMS',
      });
      expect(h.verify).not.toHaveBeenCalled();
    },
  );

  it('keeps "Unknown provider id" for a well-formed but unknown id (M-2)', async () => {
    const h = makeHarness();
    const response = await rpc(h, 'auth:checkConnection', {
      providerId: 'no-such-provider',
    });
    expect(response).toMatchObject({
      success: false,
      error: 'Unknown provider id',
      errorCode: 'INVALID_PARAMS',
    });
  });

  it('refuses a connection that has no check (a local server) without probing', async () => {
    const h = makeHarness();
    const response = await rpc(h, 'auth:checkConnection', {
      providerId: 'ollama',
    });
    expect(response).toMatchObject({
      success: false,
      error: 'This connection cannot be checked here.',
      errorCode: 'INVALID_PARAMS',
    });
    expect(h.verify).not.toHaveBeenCalled();
  });
});

describe('auth:checkConnection — record and read back', () => {
  it('returns the record, which the route then reports as providers[].lastCheck', async () => {
    const h = makeHarness();

    const response = await rpc(h, 'auth:checkConnection', {
      providerId: 'moonshot',
    });
    const record = response.data as ConnectionCheckRecord;

    expect(response.success).toBe(true);
    expect(record).toEqual({
      status: 'verified',
      reason: null,
      latencyMs: 92,
      checkedAt: expect.any(String),
    });
    expect((await routeProvider(h, 'moonshot'))?.lastCheck).toEqual(record);
    expect(await routeProvider(h, 'z-ai')).not.toHaveProperty('lastCheck');
  });

  it('the serialised result holds no key material and no probe detail', async () => {
    const h = makeHarness();
    const response = await rpc(h, 'auth:checkConnection', {
      providerId: 'moonshot',
    });
    const serialised = JSON.stringify(response);

    expect(serialised).not.toContain('used key');
    for (let i = 0; i + 5 <= KEY.length; i++) {
      expect(serialised).not.toContain(KEY.slice(i, i + 5));
    }
  });

  it('a sign-in connection records status and time with latencyMs: null', async () => {
    const h = makeHarness();
    await rpc(h, 'auth:checkConnection', { providerId: 'github-copilot' });

    expect((await routeProvider(h, 'github-copilot'))?.lastCheck).toMatchObject(
      {
        status: 'verified',
        latencyMs: null,
      },
    );
    expect(h.verify).not.toHaveBeenCalled();
  });

  it('reading the route (even with refresh) never records a check', async () => {
    const h = makeHarness();
    await rpc(h, 'auth:getEffectiveRoute', { refresh: true });
    expect(h.recorder.get('moonshot')).toBeUndefined();
  });

  it('auth:verifyDraftConnection never writes the saved connection record', async () => {
    const h = makeHarness();
    await rpc(h, 'auth:verifyDraftConnection', {
      probeId: 'draft-1',
      providerId: 'moonshot',
      authMode: 'apiKey',
      credential: { kind: 'stored' },
    });

    expect(h.verify).toHaveBeenCalledTimes(1);
    expect(h.recorder.get('moonshot')).toBeUndefined();
    expect(await routeProvider(h, 'moonshot')).not.toHaveProperty('lastCheck');
  });

  it('two concurrent checks of one connection send one provider request', async () => {
    const h = makeHarness();
    const [a, b] = await Promise.all([
      rpc(h, 'auth:checkConnection', { providerId: 'moonshot' }),
      rpc(h, 'auth:checkConnection', { providerId: 'moonshot' }),
    ]);
    expect(h.verify).toHaveBeenCalledTimes(1);
    expect(a.data).toEqual(b.data);
  });
});

describe('a key change forgets the last check (revise round 1, S-1)', () => {
  async function checkedMoonshot(): Promise<Harness> {
    const h = makeHarness();
    await rpc(h, 'auth:checkConnection', { providerId: 'moonshot' });
    expect((await routeProvider(h, 'moonshot'))?.lastCheck?.status).toBe(
      'verified',
    );
    return h;
  }

  it('auth:deleteStoredKey clears the record, so the route no longer reports verified', async () => {
    const h = await checkedMoonshot();

    await rpc(h, 'auth:deleteStoredKey', { providerId: 'moonshot' });

    expect(await routeProvider(h, 'moonshot')).not.toHaveProperty('lastCheck');
  });

  it('auth:deleteStoredKey for the Claude API key clears the anthropic record', async () => {
    const h = makeHarness();
    await rpc(h, 'auth:checkConnection', { providerId: 'anthropic' });
    expect(h.recorder.get('anthropic')).toBeDefined();

    await rpc(h, 'auth:deleteStoredKey', { providerId: 'anthropic' });

    expect(h.recorder.get('anthropic')).toBeUndefined();
  });

  it('auth:setApiKey with a NEW key clears the record of the old key', async () => {
    const h = await checkedMoonshot();

    await rpc(h, 'auth:setApiKey', {
      provider: 'moonshot',
      apiKey: 'FAKE0PROVIDER0KEY0AAA',
    });

    expect(await routeProvider(h, 'moonshot')).not.toHaveProperty('lastCheck');
  });

  it('auth:setApiKey with an empty key (clear) clears the record', async () => {
    const h = await checkedMoonshot();

    await rpc(h, 'auth:setApiKey', { provider: 'moonshot', apiKey: '' });

    expect(h.recorder.get('moonshot')).toBeUndefined();
  });

  it('auth:saveSettings with a provider key or a Claude API key clears that record', async () => {
    const h = await checkedMoonshot();
    await rpc(h, 'auth:checkConnection', { providerId: 'anthropic' });

    await rpc(h, 'auth:saveSettings', {
      authMethod: 'thirdParty',
      anthropicProviderId: 'moonshot',
      providerApiKey: 'FAKE0PROVIDER0KEY0AAA',
      anthropicApiKey: 'FAKE0ANTHROPIC0KEY0BBB',
    });

    expect(h.recorder.get('moonshot')).toBeUndefined();
    expect(h.recorder.get('anthropic')).toBeUndefined();
  });

  it('a check that started BEFORE the key was deleted and finishes AFTER it is not recorded', async () => {
    const h = makeHarness();
    let release!: () => void;
    h.verify.mockImplementationOnce(
      () =>
        new Promise<AuthVerifyDraftConnectionResult>((resolve) => {
          release = () =>
            resolve({
              probeId: 'p',
              outcome: 'verified',
              reason: null,
              detail: null,
              latencyMs: 92,
              modelUsed: 'kimi-k2',
              checkedAt: '2026-10-01T00:00:00.000Z',
            });
        }),
    );

    const check = rpc(h, 'auth:checkConnection', { providerId: 'moonshot' });
    for (let i = 0; i < 50 && h.verify.mock.calls.length === 0; i++) {
      await Promise.resolve();
    }
    expect(h.verify).toHaveBeenCalledTimes(1);
    await rpc(h, 'auth:deleteStoredKey', { providerId: 'moonshot' });
    release();
    await check;

    expect(h.recorder.get('moonshot')).toBeUndefined();
    expect(await routeProvider(h, 'moonshot')).not.toHaveProperty('lastCheck');
  });
});
