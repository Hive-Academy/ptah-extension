/**
 * PtahCliRegistry.spawnAgent — output-style FLAG tier spec (TASK_2026_197).
 *
 * Drives the REAL spawnAgent() up to the SDK queryFn() call and captures the
 * `options.settings` object production code actually hands the SDK. This is the
 * half a unit test of `buildFlagSettings` cannot see: the helper was correct
 * long before this call site sent any `settings` at all, which is exactly why
 * every agent spawned by `ptah_agent_spawn` — and every `ptah-cli` tribunal
 * lane — ran unstyled while the main chat agent obeyed the user's selection.
 *
 * Covers:
 *   (a) an active style rides `settings.outputStyle`
 *   (b) no active style leaves the `outputStyle` KEY ABSENT — not `undefined`,
 *       not `'default'` (G4b: the flag tier outranks the user's own
 *       `~/.claude/settings.json`, so an empty opinion must say nothing)
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

describe('PtahCliRegistry.spawnAgent — output-style flag tier', () => {
  it('sends the active style name on options.settings', async () => {
    const harness = buildHarness('Terse');

    await harness.registry.spawnAgent(BASE_CONFIG.id, 'do work');

    expect(harness.getCapturedSettings()).toMatchObject({
      outputStyle: 'Terse',
    });
  });

  it('omits the outputStyle KEY entirely when no style is active (G4b)', async () => {
    const harness = buildHarness(undefined);

    await harness.registry.spawnAgent(BASE_CONFIG.id, 'do work');

    const settings = harness.getCapturedSettings();
    expect(settings).toBeDefined();
    // `'outputStyle' in settings` — not `settings.outputStyle === undefined`.
    // An explicit undefined key still overrides the user's own CLI setting.
    expect(settings && 'outputStyle' in settings).toBe(false);
  });

  it('asks the CLI to accept inbound peer turns, styled or not', async () => {
    // Without `crossSessionInbound: 'accept'` a turn injected by a peer session
    // is HELD until it expires, so a spawned agent could be messaged and never
    // see it. The chat path already sends this; this is the spawn half.
    for (const style of ['Terse', undefined]) {
      const harness = buildHarness(style);
      await harness.registry.spawnAgent(BASE_CONFIG.id, 'do work');
      expect(harness.getCapturedSettings()).toMatchObject({
        crossSessionInbound: 'accept',
      });
    }
  });

  it('names the session from the reserved agent id (TASK_2026_402)', async () => {
    const harness = buildHarness('Terse');

    await harness.registry.spawnAgent(BASE_CONFIG.id, 'do work', {
      agentId: 'abcdef12-3456-4789-8abc-def012345678',
    });

    // Composed by `buildSessionName`: prefix, workspace label, the agent's own
    // (slugified) configured name, then the id's first six characters, which
    // are what make the name unique.
    const name = harness.getCapturedExtraArgs()?.['name'];
    expect(typeof name).toBe('string');
    expect(name).toMatch(/^ptah-.*-abcdef$/);
  });

  it('omits --name when no agent id was reserved, and does not warn about it', async () => {
    const harness = buildHarness('Terse');

    await harness.registry.spawnAgent(BASE_CONFIG.id, 'do work');

    expect(harness.getCapturedExtraArgs()?.['name']).toBeUndefined();
  });

  it('still disables SDK auto-memory, styled or not', async () => {
    for (const style of ['Terse', undefined]) {
      const harness = buildHarness(style);
      await harness.registry.spawnAgent(BASE_CONFIG.id, 'do work');
      expect(harness.getCapturedSettings()).toMatchObject({
        autoMemoryEnabled: false,
      });
    }
  });
});
