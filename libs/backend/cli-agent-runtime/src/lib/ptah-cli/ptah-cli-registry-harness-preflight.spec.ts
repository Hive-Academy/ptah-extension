/**
 * PtahCliRegistry.spawnAgent — harness preflight.
 *
 * A raw Ptah CLI consumes its harness from disk during SDK startup. These tests
 * pin the preflight boundary: use the requested cwd, finish before option
 * assembly or SDK startup, remain optional, and never block a valid spawn when
 * a faulty implementation rejects.
 */

import 'reflect-metadata';

import { homedir } from 'os';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger, IAuthSecretsService } from '@ptah-extension/vscode-core';
import type {
  IHarnessPreflight,
  Options,
  SdkMessageTransformer,
  SdkModuleLoader,
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

const CONFIG: PtahCliConfig = {
  id: 'pc-preflight-001',
  name: 'Preflight Test Agent',
  providerId: 'moonshot',
  enabled: true,
  tierMappings: undefined,
  updatedAt: 0,
};

async function* emptyStream(): AsyncGenerator<never, void, unknown> {
  // The registry's stream loop accepts an empty completed SDK response.
}

interface Harness {
  registry: PtahCliRegistry;
  ensure: jest.Mock | null;
  assembleSpawnOptions: jest.Mock;
  getQueryFunction: jest.Mock;
  logger: ReturnType<typeof createMockLogger>;
}

function buildHarness(ensure: jest.Mock | null): Harness {
  const logger = createMockLogger();
  const getQueryFunction = jest
    .fn()
    .mockResolvedValue(
      jest.fn((_args: { options?: Options }) => emptyStream()),
    );
  const assembleSpawnOptions = jest.fn().mockResolvedValue({
    mcpServers: {},
    hooks: undefined,
    compactionControl: undefined,
    systemPromptMode: 'append',
    systemPromptContent: undefined,
    outputStyleName: undefined,
  });

  const registry = new PtahCliRegistry(
    logger as unknown as Logger,
    {
      getProviderKey: jest.fn().mockResolvedValue('sk-test-key'),
    } as unknown as IAuthSecretsService,
    {
      getQueryFunction,
      getCliJsPath: jest.fn().mockResolvedValue(undefined),
    } as unknown as SdkModuleLoader,
    {
      createIsolated: jest.fn().mockReturnValue({
        transform: jest.fn().mockReturnValue([]),
      }),
    } as unknown as SdkMessageTransformer,
    {
      getPermissionLevel: jest.fn().mockReturnValue('yolo'),
      createCallback: jest.fn(),
    } as unknown as SdkPermissionHandler,
    null as never,
    null as never,
    null as never,
    {
      getModelTiers: jest
        .fn()
        .mockReturnValue({ sonnet: null, opus: null, haiku: null }),
    } as unknown as ProviderModelsService,
    { loadConfigs: jest.fn().mockReturnValue([CONFIG]) } as never,
    { assembleSpawnOptions } as never,
    null as never,
    { get: jest.fn(() => undefined) } as never,
    { spawn: jest.fn() } as unknown as never,
    ensure === null ? null : ({ ensure } as IHarnessPreflight),
  );

  return { registry, ensure, assembleSpawnOptions, getQueryFunction, logger };
}

describe('PtahCliRegistry.spawnAgent — harness preflight', () => {
  it('passes the explicit workingDirectory to the preflight', async () => {
    const ensure = jest.fn().mockResolvedValue(null);
    const harness = buildHarness(ensure);
    const workingDirectory = '/repo/packages/api';

    await harness.registry.spawnAgent(CONFIG.id, 'do work', {
      workingDirectory,
    });

    expect(ensure).toHaveBeenCalledWith(workingDirectory);
  });

  it('passes the default home working directory to the preflight', async () => {
    const ensure = jest.fn().mockResolvedValue(null);
    const harness = buildHarness(ensure);

    await harness.registry.spawnAgent(CONFIG.id, 'do work');

    expect(ensure).toHaveBeenCalledWith(homedir());
  });

  it('awaits preflight before spawn-option assembly and SDK startup', async () => {
    const ensure = jest.fn().mockResolvedValue(null);
    const harness = buildHarness(ensure);

    await harness.registry.spawnAgent(CONFIG.id, 'do work', {
      workingDirectory: '/repo',
    });

    expect(ensure.mock.invocationCallOrder[0]).toBeLessThan(
      harness.assembleSpawnOptions.mock.invocationCallOrder[0],
    );
    expect(ensure.mock.invocationCallOrder[0]).toBeLessThan(
      harness.getQueryFunction.mock.invocationCallOrder[0],
    );
  });

  it('spawns unchanged when the optional preflight is absent', async () => {
    const harness = buildHarness(null);

    const result = await harness.registry.spawnAgent(CONFIG.id, 'do work');

    expect(result).toHaveProperty('handle');
    expect(harness.assembleSpawnOptions).toHaveBeenCalled();
    expect(harness.getQueryFunction).toHaveBeenCalled();
  });

  it('logs a rejected preflight and continues the spawn', async () => {
    const ensure = jest.fn().mockRejectedValue(new Error('EPERM'));
    const harness = buildHarness(ensure);

    const result = await harness.registry.spawnAgent(CONFIG.id, 'do work');

    expect(result).toHaveProperty('handle');
    expect(harness.assembleSpawnOptions).toHaveBeenCalled();
    expect(harness.getQueryFunction).toHaveBeenCalled();
    expect(harness.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Harness preflight failed (ignored): EPERM'),
    );
  });
});
