/**
 * PtahCliRegistry.spawnAgent — off-thread spawn seam spec (TASK_2026_367 Batch B8).
 *
 * Asserts that:
 *   1. Options object handed to queryFn carries `spawnClaudeCodeProcess`.
 *   2. Calling `spawnClaudeCodeProcess` delegates to the injected ISdkProcessSpawner.
 *   3. The `onStderr` hook it passes is the classifier callback: benign lines reach
 *      `logger.debug`, and `logger.error` is never called.
 *
 * Mirrors ptah-cli-registry-spawn-model.spec.ts's SpawnHarness for construction.
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
import type {
  SpawnOptions,
  SpawnedProcess,
} from '@anthropic-ai/claude-agent-sdk';
import { PtahCliRegistry } from './ptah-cli-registry';
import type { ISdkProcessSpawner } from '../spawn/sdk-process-spawner.port';

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
  logger: ReturnType<typeof createMockLogger>;
  spawner: ISdkProcessSpawner;
  getCapturedOptions: () => Options | undefined;
}

function buildHarness(config: PtahCliConfig): SpawnHarness {
  const logger = createMockLogger();

  let capturedOptions: Options | undefined;
  const queryFn = jest.fn((args: { options?: Options }) => {
    capturedOptions = args.options;
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
      compactionControl: undefined,
      systemPromptMode: 'append',
      systemPromptContent: undefined,
    }),
  } as unknown as never;

  const dummyProcess: SpawnedProcess = {
    stdin: {} as never,
    stdout: {} as never,
    killed: false,
    exitCode: null,
    kill: jest.fn().mockReturnValue(true),
    on: jest.fn(),
    once: jest.fn(),
    off: jest.fn(),
  };

  const spawner: ISdkProcessSpawner = {
    spawn: jest.fn().mockReturnValue(dummyProcess),
  };

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
    { get: jest.fn(() => undefined) } as unknown as never, // configManager
    spawner,
  );

  return {
    registry,
    logger,
    spawner,
    getCapturedOptions: () => capturedOptions,
  };
}

const BASE_CONFIG: PtahCliConfig = {
  id: 'pc-spawn-001',
  name: 'Spawn Test Agent',
  providerId: 'moonshot',
  enabled: true,
  tierMappings: undefined,
  updatedAt: 0,
};

describe('PtahCliRegistry — off-thread spawn seam (TASK_2026_367 B8)', () => {
  it('supplies spawnClaudeCodeProcess on the Options object passed to queryFn', async () => {
    const { registry, getCapturedOptions } = buildHarness(BASE_CONFIG);
    await registry.spawnAgent(BASE_CONFIG.id, 'test prompt');

    const options = getCapturedOptions();
    expect(options).toBeDefined();
    expect(options?.spawnClaudeCodeProcess).toBeDefined();
    expect(typeof options?.spawnClaudeCodeProcess).toBe('function');
  });

  it('delegates to the injected processSpawner with spawnOptions and onStderr hook', async () => {
    const { registry, spawner, getCapturedOptions } = buildHarness(BASE_CONFIG);
    await registry.spawnAgent(BASE_CONFIG.id, 'test prompt');

    const options = getCapturedOptions();
    const spawnClaudeCodeProcess = options?.spawnClaudeCodeProcess;
    expect(typeof spawnClaudeCodeProcess).toBe('function');
    if (!spawnClaudeCodeProcess)
      throw new Error('spawnClaudeCodeProcess is undefined');

    const fakeSpawnOptions: SpawnOptions = {
      command: 'node',
      args: ['cli.js'],
      cwd: '/test/dir',
      env: {},
      signal: new AbortController().signal,
    };

    const spawned = spawnClaudeCodeProcess(fakeSpawnOptions);
    expect(spawner.spawn).toHaveBeenCalledTimes(1);
    expect(spawner.spawn).toHaveBeenCalledWith(
      fakeSpawnOptions,
      expect.objectContaining({
        onStderr: expect.any(Function),
      }),
    );
    expect(spawned).toBeDefined();
  });

  it('passes onStderr hook that classifies benign stderr to logger.debug and never calls logger.error', async () => {
    const { registry, logger, spawner, getCapturedOptions } =
      buildHarness(BASE_CONFIG);
    await registry.spawnAgent(BASE_CONFIG.id, 'test prompt');

    const options = getCapturedOptions();
    const spawnClaudeCodeProcess = options?.spawnClaudeCodeProcess;
    expect(typeof spawnClaudeCodeProcess).toBe('function');
    if (!spawnClaudeCodeProcess)
      throw new Error('spawnClaudeCodeProcess is undefined');

    const fakeSpawnOptions: SpawnOptions = {
      command: 'node',
      args: ['cli.js'],
      cwd: '/test/dir',
      env: {},
      signal: new AbortController().signal,
    };

    spawnClaudeCodeProcess(fakeSpawnOptions);

    const spawnCalls = (spawner.spawn as jest.Mock).mock.calls;
    expect(spawnCalls.length).toBe(1);
    const hooks = spawnCalls[0][1] as { onStderr?: (data: string) => void };
    expect(hooks?.onStderr).toBeDefined();
    if (!hooks.onStderr) throw new Error('onStderr hook is undefined');

    // Benign line
    hooks.onStderr('[claude-code:unrecognized_model] {"model":"x"}');

    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('[claude-code:unrecognized_model]'),
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('passes onStderr hook that classifies error stderr to logger.warn', async () => {
    const { registry, logger, spawner, getCapturedOptions } =
      buildHarness(BASE_CONFIG);
    await registry.spawnAgent(BASE_CONFIG.id, 'test prompt');

    const options = getCapturedOptions();
    const spawnClaudeCodeProcess = options?.spawnClaudeCodeProcess;
    expect(typeof spawnClaudeCodeProcess).toBe('function');
    if (!spawnClaudeCodeProcess)
      throw new Error('spawnClaudeCodeProcess is undefined');

    const fakeSpawnOptions: SpawnOptions = {
      command: 'node',
      args: ['cli.js'],
      cwd: '/test/dir',
      env: {},
      signal: new AbortController().signal,
    };

    spawnClaudeCodeProcess(fakeSpawnOptions);

    const hooks = (spawner.spawn as jest.Mock).mock.calls[0][1] as {
      onStderr?: (data: string) => void;
    };
    expect(hooks?.onStderr).toBeDefined();
    if (!hooks.onStderr) throw new Error('onStderr hook is undefined');

    // Error line
    hooks.onStderr('fatal: process failed with code 1');

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('fatal: process failed with code 1'),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('preserves the options.stderr callback alongside spawnClaudeCodeProcess', async () => {
    const { registry, getCapturedOptions } = buildHarness(BASE_CONFIG);
    await registry.spawnAgent(BASE_CONFIG.id, 'test prompt');

    const options = getCapturedOptions();
    expect(options?.stderr).toBeDefined();
    expect(typeof options?.stderr).toBe('function');
  });
});
