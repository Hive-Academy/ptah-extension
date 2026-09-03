/**
 * PtahCliRegistry.spawnAgent — permission routing identity (TASK_2026_295).
 *
 * `resolvePermissionOptions` received `resumeSessionId ?? parentSessionId ??
 * \`ptah-cli:${id}\`` and then did `sessionId ? SessionId.from(sessionId) :
 * undefined`. Both branches were wrong, in opposite directions:
 *
 *   - `parentSessionId: ''` survives `??` (it is a string), is falsy at the
 *     ternary, and collapses to `undefined`. `isRoutablePermissionRequest` is
 *     then false, so every tool prompt for that agent auto-DENIES on the
 *     unroutable timeout instead of waiting for the user.
 *   - with no resume and no parent, the literal `ptah-cli:${id}` reaches
 *     `SessionId.from`, which is `z.string().uuid()`-strict and THROWS — taking
 *     the whole spawn down. That is the shape `agent:resumePtahCli` sends when
 *     the session file is missing.
 *
 * These tests drive the REAL spawnAgent() at permission level 'ask' (the
 * output-style spec runs at 'yolo', which returns before `createCallback` and
 * therefore could never see either failure).
 *
 * Source-under-test:
 *   libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts
 */

import 'reflect-metadata';

import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IAuthSecretsService } from '@ptah-extension/vscode-core';
import type {
  SdkModuleLoader,
  SdkMessageTransformer,
  SdkPermissionHandler,
} from '@ptah-extension/agent-sdk';
import type { ProviderModelsService } from '@ptah-extension/auth-providers';
import type { PtahCliConfig } from '@ptah-extension/shared';
import { PtahCliRegistry } from './ptah-cli-registry';

jest.mock('@ptah-extension/agent-sdk', () => {
  const actual = jest.requireActual('@ptah-extension/agent-sdk');
  return {
    ...actual,
    getAnthropicProvider: jest.fn(() => ({
      id: 'moonshot',
      name: 'Moonshot (Kimi)',
      baseUrl: 'https://api.moonshot.ai/anthropic/',
      authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
      keyPrefix: '',
      helpUrl: '',
      description: '',
      keyPlaceholder: '',
      maskedKeyDisplay: '',
      staticModels: [{ id: 'kimi-k2', name: 'Kimi K2' }],
      defaultTiers: { sonnet: 'kimi-tier-sonnet' },
    })),
    getProviderAuthEnvVar: jest.fn(() => 'ANTHROPIC_AUTH_TOKEN'),
    seedStaticModelPricing: jest.fn(),
    buildSafeEnv: jest.fn((env: unknown) => env),
  };
});

async function* emptyStream(): AsyncGenerator<never, void, unknown> {
  // No messages — streamLoop.run resolves with exit code 0.
}

const BASE_CONFIG: PtahCliConfig = {
  id: 'pc-perm-001',
  name: 'Permission Test Agent',
  providerId: 'moonshot',
  enabled: true,
  tierMappings: undefined,
  updatedAt: 0,
};

const PARENT_SESSION = '11111111-2222-4333-8444-555555555555';

function buildHarness(): {
  registry: PtahCliRegistry;
  createCallback: jest.Mock;
  logger: ReturnType<typeof createMockLogger>;
} {
  const logger = createMockLogger();
  const createCallback = jest.fn().mockReturnValue(jest.fn());

  const queryFn = jest.fn(() => emptyStream());
  const moduleLoader = {
    getQueryFunction: jest.fn().mockResolvedValue(queryFn),
    getCliJsPath: jest.fn().mockResolvedValue(undefined),
  } as unknown as SdkModuleLoader;

  const registry = new PtahCliRegistry(
    logger as unknown as Logger,
    {
      getProviderKey: jest.fn().mockResolvedValue('sk-test-key'),
    } as unknown as IAuthSecretsService,
    moduleLoader,
    {
      createIsolated: jest.fn().mockReturnValue({
        transform: jest.fn().mockReturnValue([]),
      }),
    } as unknown as SdkMessageTransformer,
    {
      // 'ask' — the mode that actually builds a canUseTool callback.
      getPermissionLevel: jest.fn().mockReturnValue('ask'),
      createCallback,
    } as unknown as SdkPermissionHandler,
    null as never, // subagentHookHandler
    null as never, // compactionHookHandler
    null as never, // compactionConfigProvider
    {
      getModelTiers: jest
        .fn()
        .mockReturnValue({ sonnet: null, opus: null, haiku: null }),
    } as unknown as ProviderModelsService,
    {
      loadConfigs: jest.fn().mockReturnValue([BASE_CONFIG]),
    } as unknown as never,
    {
      assembleSpawnOptions: jest.fn().mockResolvedValue({
        mcpServers: {},
        hooks: undefined,
        compactionControl: undefined,
        systemPromptMode: 'append',
        systemPromptContent: undefined,
        outputStyleName: undefined,
      }),
    } as unknown as never,
    null as never, // modelResolver
    { get: jest.fn(() => undefined) } as unknown as never, // configManager
    { spawn: jest.fn() } as unknown as never, // processSpawner
  );

  return { registry, createCallback, logger };
}

describe('PtahCliRegistry.spawnAgent — permission routing identity', () => {
  it('does not throw when the spawn has neither a resume nor a parent session', async () => {
    const { registry } = buildHarness();

    // Previously: SessionId.from('ptah-cli:pc-perm-001') -> TypeError, and the
    // whole spawn rejected. This is exactly what agent:resumePtahCli sends
    // when the session file is gone.
    const result = await registry.spawnAgent(BASE_CONFIG.id, 'do work');

    expect(result).toHaveProperty('handle');
  });

  it('passes no routable session id, but keeps the raw id as a routing hint', async () => {
    const { registry, createCallback } = buildHarness();

    await registry.spawnAgent(BASE_CONFIG.id, 'do work');

    const [sessionId, , , , routingHint] = createCallback.mock.calls[0];
    expect(sessionId).toBeUndefined();
    expect(routingHint).toBe(`ptah-cli:${BASE_CONFIG.id}`);
  });

  it('says out loud that prompts have no routable surface', async () => {
    const { registry, logger } = buildHarness();

    await registry.spawnAgent(BASE_CONFIG.id, 'do work');

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no routable session id'),
      expect.objectContaining({ routingHint: `ptah-cli:${BASE_CONFIG.id}` }),
    );
  });

  it('treats an empty parentSessionId as absent rather than as a silent auto-deny', async () => {
    const { registry, createCallback, logger } = buildHarness();

    await registry.spawnAgent(BASE_CONFIG.id, 'do work', {
      parentSessionId: '',
    });

    const [sessionId, , , , routingHint] = createCallback.mock.calls[0];
    expect(sessionId).toBeUndefined();
    // The '' never becomes the routing hint either — it falls through to the
    // agent-scoped fallback, and the drop is logged.
    expect(routingHint).toBe(`ptah-cli:${BASE_CONFIG.id}`);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no routable session id'),
      expect.anything(),
    );
  });

  it('routes to the parent session when it is a real UUID', async () => {
    const { registry, createCallback, logger } = buildHarness();

    await registry.spawnAgent(BASE_CONFIG.id, 'do work', {
      parentSessionId: PARENT_SESSION,
    });

    const [sessionId, , , , routingHint] = createCallback.mock.calls[0];
    expect(sessionId).toBe(PARENT_SESSION);
    expect(routingHint).toBe(PARENT_SESSION);
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('no routable session id'),
      expect.anything(),
    );
  });

  it('prefers the resumed session over the parent', async () => {
    const { registry, createCallback } = buildHarness();
    const resumed = '99999999-8888-4777-8666-555555555555';

    await registry.spawnAgent(BASE_CONFIG.id, 'do work', {
      resumeSessionId: resumed,
      parentSessionId: PARENT_SESSION,
    });

    expect(createCallback.mock.calls[0][0]).toBe(resumed);
  });
});
