/**
 * PtahCliRegistry.spawnAgent — model-resolution precedence spec.
 *
 * Drives the REAL spawnAgent() up to the SDK queryFn() call and captures the
 * `options.model` that production code actually passes to the SDK. This proves
 * the override resolution line (ptah-cli-registry.ts ~line 508):
 *
 *   const model =
 *     modelOverride || agentConfig.selectedModel?.trim() || spawnFromTiers || '';
 *
 * Covers:
 *   (a) explicit `model` override wins over selectedModel AND tier
 *   (b) absent override preserves current behaviour (selectedModel, then tier)
 *
 * The capture asserts on the value handed to the SDK query — NOT on a mock's
 * own copy — so a production-code regression cannot pass on a mock alone.
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
  Options,
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
      defaultTiers: {
        sonnet: 'kimi-tier-sonnet',
        opus: 'kimi-tier-opus',
        haiku: 'kimi-tier-haiku',
      },
    })),
    getProviderAuthEnvVar: jest.fn(() => 'ANTHROPIC_AUTH_TOKEN'),
    seedStaticModelPricing: jest.fn(),
    buildSafeEnv: jest.fn((env: unknown) => env),
  };
});

async function* emptyStream(): AsyncGenerator<never, void, unknown> {
  // No messages — streamLoop.run resolves with exit code 0.
}

interface SpawnHarness {
  registry: PtahCliRegistry;
  getCapturedModel: () => string | undefined;
}

function buildHarness(config: PtahCliConfig): SpawnHarness {
  const logger = createMockLogger();

  let capturedModel: string | undefined;
  const queryFn = jest.fn((args: { options?: Options }) => {
    capturedModel = args.options?.model as string | undefined;
    return emptyStream();
  });

  const moduleLoader = {
    getQueryFunction: jest.fn().mockResolvedValue(queryFn),
    getCliJsPath: jest.fn().mockResolvedValue(undefined),
  } as unknown as SdkModuleLoader;

  const messageTransformer = {
    createIsolated: jest.fn().mockReturnValue({
      transform: jest.fn().mockReturnValue([]),
    }),
  } as unknown as SdkMessageTransformer;

  const permissionHandler = {
    getPermissionLevel: jest.fn().mockReturnValue('yolo'),
    createCallback: jest.fn(),
  } as unknown as SdkPermissionHandler;

  const authSecrets = {
    getProviderKey: jest.fn().mockResolvedValue('sk-test-key'),
  } as unknown as IAuthSecretsService;

  const providerModels = {
    getModelTiers: jest.fn().mockReturnValue({
      sonnet: null,
      opus: null,
      haiku: null,
    }),
  } as unknown as ProviderModelsService;

  const configPersistence = {
    loadConfigs: jest.fn().mockReturnValue([config]),
  } as unknown as never;

  const spawnOptionsService = {
    assembleSpawnOptions: jest.fn().mockResolvedValue({
      mcpServers: {},
      hooks: undefined,
      plugins: undefined,
      compactionControl: undefined,
      systemPromptMode: 'append',
      systemPromptContent: undefined,
      isPremium: false,
    }),
  } as unknown as never;

  const registry = new PtahCliRegistry(
    logger as unknown as Logger,
    authSecrets,
    moduleLoader,
    messageTransformer,
    permissionHandler,
    null as never, // subagentHookHandler
    null as never, // compactionHookHandler
    null as never, // compactionConfigProvider
    providerModels,
    configPersistence,
    spawnOptionsService,
    null as never, // modelResolver
  );

  return { registry, getCapturedModel: () => capturedModel };
}

const BASE_CONFIG: PtahCliConfig = {
  id: 'pc-spawn-001',
  name: 'Spawn Test Agent',
  providerId: 'moonshot',
  enabled: true,
  tierMappings: undefined,
  updatedAt: 0,
};

describe('PtahCliRegistry.spawnAgent — model override resolution', () => {
  it('uses the raw model override over selectedModel AND tier', async () => {
    const harness = buildHarness({
      ...BASE_CONFIG,
      selectedModel: 'configured-selected-model',
    });

    const result = await harness.registry.spawnAgent(
      BASE_CONFIG.id,
      'do work',
      { modelTier: 'opus', model: 'raw-override-model' },
    );

    expect('status' in result).toBe(false);
    expect(harness.getCapturedModel()).toBe('raw-override-model');
  });

  it('trims the raw model override before applying it', async () => {
    const harness = buildHarness({
      ...BASE_CONFIG,
      selectedModel: 'configured-selected-model',
    });

    await harness.registry.spawnAgent(BASE_CONFIG.id, 'do work', {
      model: '  spaced-override  ',
    });

    expect(harness.getCapturedModel()).toBe('spaced-override');
  });

  it('falls back to selectedModel when no override is given', async () => {
    const harness = buildHarness({
      ...BASE_CONFIG,
      selectedModel: 'configured-selected-model',
    });

    await harness.registry.spawnAgent(BASE_CONFIG.id, 'do work', {
      modelTier: 'opus',
    });

    expect(harness.getCapturedModel()).toBe('configured-selected-model');
  });

  it('falls back to the tier model when no override and no selectedModel', async () => {
    const harness = buildHarness({ ...BASE_CONFIG, selectedModel: undefined });

    await harness.registry.spawnAgent(BASE_CONFIG.id, 'do work', {
      modelTier: 'opus',
    });

    expect(harness.getCapturedModel()).toBe('kimi-tier-opus');
  });

  it('does not mutate the persisted config when an override is used', async () => {
    const config: PtahCliConfig = {
      ...BASE_CONFIG,
      selectedModel: 'configured-selected-model',
    };
    const harness = buildHarness(config);

    await harness.registry.spawnAgent(BASE_CONFIG.id, 'do work', {
      model: 'raw-override-model',
    });

    expect(config.selectedModel).toBe('configured-selected-model');
  });
});
