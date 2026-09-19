/**
 * PtahCliRegistry.spawnAgent — inbound peer visibility spec (TASK_2026_466).
 *
 * Drives the REAL spawnAgent() up to the SDK queryFn() call and captures the
 * `options.extraArgs` production code hands the SDK.
 *
 * A peer session that addresses a spawned lane by name reaches the model:
 * `crossSessionInbound: 'accept'` is already on this path, and a live probe on
 * CLI 2.1.270 (2026-09-18) confirmed the lane reads the message mid-turn.
 * What was missing is the ECHO. Without `--replay-user-messages` the CLI emits
 * no user message for that turn, so `PtahCliStreamLoop` sees nothing, the tile
 * records nothing, and a delivered message reads as lost. The chat path has
 * sent the flag since TASK_2026_402; this is the spawn half.
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
import { createFakeSdkProcessSpawner } from './testing/fake-sdk-process-spawner';

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
  id: 'pc-style-001',
  name: 'Style Test Agent',
  providerId: 'moonshot',
  enabled: true,
  tierMappings: undefined,
  updatedAt: 0,
};

function buildHarness(outputStyleName: string | undefined): {
  registry: PtahCliRegistry;
  getCapturedSettings: () => Record<string, unknown> | undefined;
  getCapturedExtraArgs: () => Record<string, string | null> | undefined;
} {
  const logger = createMockLogger();

  let capturedSettings: Record<string, unknown> | undefined;
  let capturedExtraArgs: Record<string, string | null> | undefined;
  const queryFn = jest.fn((args: { options?: Options }) => {
    capturedExtraArgs = args.options?.extraArgs;
    // `options.settings` is a SERIALIZED flag tier since TASK_2026_402:
    // `crossSessionInbound` rides along and the installed `Settings` interface
    // models no such key, so `buildFlagSettingsArg` stringifies it. The
    // assertions below are about the tier's CONTENT, so parse it back.
    const raw = args.options?.settings;
    capturedSettings =
      typeof raw === 'string'
        ? (JSON.parse(raw) as Record<string, unknown>)
        : (raw as Record<string, unknown> | undefined);
    return emptyStream();
  });

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
      getPermissionLevel: jest.fn().mockReturnValue('yolo'),
      createCallback: jest.fn(),
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
        autoCompact: {},
        systemPromptMode: 'append',
        systemPromptContent: undefined,
        outputStyleName,
      }),
    } as unknown as never,
    null as never, // modelResolver
    { get: jest.fn(() => undefined) } as unknown as never, // configManager
    createFakeSdkProcessSpawner(), // processSpawner
  );

  return {
    registry,
    getCapturedSettings: () => capturedSettings,
    getCapturedExtraArgs: () => capturedExtraArgs,
  };
}

describe('PtahCliRegistry.spawnAgent — inbound peer visibility', () => {
  it('asks the CLI to echo user turns so an inbound peer turn is observable', async () => {
    const harness = buildHarness(undefined);

    await harness.registry.spawnAgent(BASE_CONFIG.id, 'do work');

    const extraArgs = harness.getCapturedExtraArgs();
    expect(extraArgs).toBeDefined();
    // Null-valued: it is a flag, not a value argument. The SDK pushes
    // `--replay-user-messages` with no operand for a null entry.
    expect(extraArgs && 'replay-user-messages' in extraArgs).toBe(true);
    expect(extraArgs?.['replay-user-messages']).toBeNull();
  });

  it('sends the echo flag alongside --name, never instead of it', async () => {
    // The two are independent. They shared one conditional on the chat path
    // once, and disabling checkpointing silently took the session name with it.
    const harness = buildHarness('Terse');

    await harness.registry.spawnAgent(BASE_CONFIG.id, 'do work', {
      agentId: 'abcdef12-3456-4789-8abc-def012345678',
    });

    const extraArgs = harness.getCapturedExtraArgs();
    expect(extraArgs?.['replay-user-messages']).toBeNull();
    expect(extraArgs?.['name']).toMatch(/^ptah-.*-abcdef$/);
  });

  it('still asks the CLI to accept the inbound turn in the first place', async () => {
    // The echo is useless if the turn is held. Both halves, one spawn.
    const harness = buildHarness(undefined);

    await harness.registry.spawnAgent(BASE_CONFIG.id, 'do work');

    expect(harness.getCapturedSettings()).toMatchObject({
      crossSessionInbound: 'accept',
    });
  });
});
