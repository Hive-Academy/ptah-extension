/**
 * PtahCliRegistry.spawnAgent — capability policy enforcement (TASK_2026_560, C5).
 *
 * A Ptah CLI agent is a raw `claude` process: it reads its harness from disk
 * at startup and its MCP servers and skills from the options it is given. The
 * registry must therefore resolve the policy FIRST, bring the harness in line
 * with a verified one, and only then assemble the spawn options, which carry
 * the policy as flag-tier lists — or strict MCP with `skills: []` when the
 * policy could not be verified (R8: unknown never widens).
 *
 * The real `PtahCliSpawnOptions` is used so the assertions read the options
 * the SDK would actually receive.
 */

import 'reflect-metadata';

import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger, IAuthSecretsService } from '@ptah-extension/vscode-core';
import type { EnhancedPromptsService } from '@ptah-extension/agent-generation';
import type {
  CompactionConfigProvider,
  CompactionHookHandler,
  IHarnessPreflight,
  Options,
  SdkMessageTransformer,
  SdkModuleLoader,
  SdkPermissionHandler,
  SubagentHookHandler,
} from '@ptah-extension/agent-sdk';
import { getAnthropicProvider, SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { DependencyContainer } from 'tsyringe';
import type { ProviderModelsService } from '@ptah-extension/auth-providers';
import type { IMcpServerStatus } from '@ptah-extension/platform-core';
import type {
  EffectiveCapabilitySet,
  ICapabilityResolver,
  PtahCliConfig,
} from '@ptah-extension/shared';
import { PtahCliRegistry } from './ptah-cli-registry';
import { PtahCliSpawnOptions } from './helpers/ptah-cli-spawn-options.service';
import { createFakeSdkProcessSpawner } from './testing/fake-sdk-process-spawner';

const CUSTOM_BASE_URL = 'https://api.moonshot.ai/anthropic/';
const DIRECT_BASE_URL = 'https://api.anthropic.com';

function providerWithBaseUrl(baseUrl: string) {
  return {
    id: 'moonshot',
    name: 'Moonshot (Kimi)',
    baseUrl,
    authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
    keyPrefix: '',
    helpUrl: '',
    description: '',
    keyPlaceholder: '',
    maskedKeyDisplay: '',
    staticModels: [{ id: 'kimi-k2', name: 'Kimi K2' }],
    defaultTiers: { sonnet: 'kimi-tier-sonnet' },
  };
}

// The real barrel pulls workspace-intelligence's ESM-only AST modules; the
// spawn options need only the token.
jest.mock('@ptah-extension/agent-generation', () => ({
  AGENT_GENERATION_TOKENS: {
    ENHANCED_PROMPTS_SERVICE: Symbol.for('EnhancedPromptsService'),
  },
}));

jest.mock('@ptah-extension/agent-sdk', () => {
  const actual = jest.requireActual('@ptah-extension/agent-sdk');
  return {
    ...actual,
    getAnthropicProvider: jest.fn(),
    getProviderAuthEnvVar: jest.fn(() => 'ANTHROPIC_AUTH_TOKEN'),
    seedStaticModelPricing: jest.fn(),
    buildSafeEnv: jest.fn((env: unknown) => env),
  };
});

const CONFIG: PtahCliConfig = {
  id: 'pc-capabilities-001',
  name: 'Capabilities Test Agent',
  providerId: 'moonshot',
  enabled: true,
  tierMappings: undefined,
  updatedAt: 0,
};

const CWD = '/repo';
const MCP_PORT = 51820;

function verifiedPolicy(
  overrides: Partial<EffectiveCapabilitySet> = {},
): EffectiveCapabilitySet {
  return {
    physicalRoot: '/real/repo',
    policyKey: '/real/repo',
    status: 'verified',
    reasons: [],
    ptahEnabled: true,
    deniedMcpServers: ['firecrawl'],
    approvedProjectMcpServers: ['davinci-resolve'],
    deniedSkillNames: ['orchestration', 'ptah-core:orchestration'],
    disabledPluginIds: [],
    harnessFingerprint: 'fp-verified-1',
    ...overrides,
  };
}

function unverifiedPolicy(): EffectiveCapabilitySet {
  return {
    ...verifiedPolicy(),
    status: 'unverified',
    reasons: [{ path: '/store/items/firecrawl.json', error: 'Unexpected end' }],
    harnessFingerprint: '',
  };
}

async function* emptyStream(): AsyncGenerator<never, void, unknown> {
  // The registry's stream loop accepts an empty completed SDK response.
}

interface Harness {
  registry: PtahCliRegistry;
  resolve: jest.Mock | null;
  apply: jest.Mock | null;
  ensure: jest.Mock;
  assembleSpawnOptions: jest.SpyInstance;
  getQueryFunction: jest.Mock;
  queryFn: jest.Mock;
  logger: ReturnType<typeof createMockLogger>;
}

interface HarnessInput {
  resolve?: jest.Mock | null;
  apply?: jest.Mock | null;
  /** Registered tokens whose construction throws on `resolve`. */
  throwingTokens?: readonly symbol[];
}

/**
 * The slice of a container the registry uses: it looks the capability
 * services up at spawn time instead of injecting them.
 */
function fakeContainer(
  entries: ReadonlyMap<symbol, unknown>,
  throwingTokens: readonly symbol[],
): DependencyContainer {
  return {
    isRegistered: (token: symbol) =>
      entries.has(token) || throwingTokens.includes(token),
    resolve: (token: symbol) => {
      if (throwingTokens.includes(token)) {
        throw new Error('TypeInfo not known for "Object"');
      }
      return entries.get(token);
    },
  } as unknown as DependencyContainer;
}

function buildHarness(input: HarnessInput): Harness {
  const logger = createMockLogger();
  const queryFn = jest.fn((_args: { options?: Options }) => emptyStream());
  const getQueryFunction = jest.fn().mockResolvedValue(queryFn);
  const ensure = jest.fn().mockResolvedValue(null);
  const resolve = input.resolve ?? null;
  const apply = input.apply ?? null;

  const spawnOptions = new PtahCliSpawnOptions(
    logger as unknown as Logger,
    null as unknown as SubagentHookHandler,
    null as unknown as CompactionHookHandler,
    null as unknown as CompactionConfigProvider,
    {
      getProjectGuidanceContent: jest.fn().mockResolvedValue(null),
    } as unknown as EnhancedPromptsService,
    { getPort: () => MCP_PORT } as unknown as IMcpServerStatus,
    undefined,
  );
  const assembleSpawnOptions = jest.spyOn(spawnOptions, 'assembleSpawnOptions');

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
    spawnOptions,
    null as never,
    { get: jest.fn(() => undefined) } as never,
    createFakeSdkProcessSpawner(),
    { ensure } as IHarnessPreflight,
    fakeContainer(
      new Map<symbol, unknown>([
        ...(resolve === null
          ? []
          : [
              [
                SDK_TOKENS.SDK_CAPABILITY_RESOLVER,
                { resolve } as unknown as ICapabilityResolver,
              ] as const,
            ]),
        ...(apply === null
          ? []
          : [[SDK_TOKENS.SDK_HARNESS_POLICY_SYNC, { apply }] as const]),
      ]),
      input.throwingTokens ?? [],
    ),
  );

  return {
    registry,
    resolve,
    apply,
    ensure,
    assembleSpawnOptions,
    getQueryFunction,
    queryFn,
    logger,
  };
}

/** The options the registry handed the SDK `query()` for the one spawn. */
function spawnedOptions(harness: Harness): Options {
  const call = harness.queryFn.mock.calls[0]?.[0] as
    { options?: Options } | undefined;
  if (!call?.options) throw new Error('query() was not called');
  return call.options;
}

/** The flag tier, parsed back from the serialized `settings` argument. */
function flagSettings(options: Options): Record<string, unknown> {
  if (typeof options.settings !== 'string') {
    throw new Error('settings were not serialized');
  }
  return JSON.parse(options.settings) as Record<string, unknown>;
}

async function spawn(harness: Harness): Promise<void> {
  const result = await harness.registry.spawnAgent(CONFIG.id, 'do work', {
    workingDirectory: CWD,
  });
  expect(result).toHaveProperty('handle');
}

describe('PtahCliRegistry.spawnAgent — capability policy', () => {
  beforeEach(() => {
    (getAnthropicProvider as jest.Mock).mockReturnValue(
      providerWithBaseUrl(CUSTOM_BASE_URL),
    );
  });

  describe('ordering', () => {
    it('resolves the policy before the harness sync, and syncs before assembling the spawn options', async () => {
      const harness = buildHarness({
        resolve: jest.fn().mockResolvedValue(verifiedPolicy()),
        apply: jest.fn().mockResolvedValue({ acknowledged: true }),
      });

      await spawn(harness);

      const resolveOrder = harness.resolve?.mock.invocationCallOrder[0] ?? 0;
      const applyOrder = harness.apply?.mock.invocationCallOrder[0] ?? 0;
      const assembleOrder =
        harness.assembleSpawnOptions.mock.invocationCallOrder[0];
      expect(harness.resolve).toHaveBeenCalledWith(CWD);
      expect(resolveOrder).toBeLessThan(applyOrder);
      expect(applyOrder).toBeLessThan(assembleOrder);
      expect(assembleOrder).toBeLessThan(
        harness.getQueryFunction.mock.invocationCallOrder[0],
      );
    });

    it('hands the resolved policy to the spawn-option assembly', async () => {
      const policy = verifiedPolicy();
      const harness = buildHarness({
        resolve: jest.fn().mockResolvedValue(policy),
        apply: jest.fn().mockResolvedValue({ acknowledged: true }),
      });

      await spawn(harness);

      expect(harness.assembleSpawnOptions.mock.calls[0]?.[7]).toBe(policy);
    });
  });

  describe('verified policy', () => {
    it('gives HarnessPolicySync the physical root and the set fingerprint, instead of the bare preflight', async () => {
      const harness = buildHarness({
        resolve: jest.fn().mockResolvedValue(verifiedPolicy()),
        apply: jest.fn().mockResolvedValue({ acknowledged: true }),
      });

      await spawn(harness);

      expect(harness.apply).toHaveBeenCalledTimes(1);
      expect(harness.apply).toHaveBeenCalledWith('/real/repo', 'fp-verified-1');
      expect(harness.ensure).not.toHaveBeenCalled();
    });

    it('carries the denied servers, the approved repository servers and the denied skills on the flag tier', async () => {
      const harness = buildHarness({
        resolve: jest.fn().mockResolvedValue(verifiedPolicy()),
        apply: jest.fn().mockResolvedValue({ acknowledged: true }),
      });

      await spawn(harness);

      const options = spawnedOptions(harness);
      const settings = flagSettings(options);
      expect(settings['disabledMcpjsonServers']).toEqual(['firecrawl']);
      expect(settings['deniedMcpServers']).toEqual([
        { serverName: 'firecrawl' },
      ]);
      expect(settings['enabledMcpjsonServers']).toEqual(['davinci-resolve']);
      expect(settings['skillOverrides']).toEqual({
        orchestration: 'off',
        'ptah-core:orchestration': 'off',
      });
      expect(settings['crossSessionInbound']).toBe('accept');
      expect(Object.keys(options.mcpServers ?? {})).toEqual(['ptah']);
      expect(options).not.toHaveProperty('strictMcpConfig');
      expect(options).not.toHaveProperty('skills');
    });

    it('drops ptah only when the policy turned it OFF', async () => {
      const harness = buildHarness({
        resolve: jest
          .fn()
          .mockResolvedValue(verifiedPolicy({ ptahEnabled: false })),
        apply: jest.fn().mockResolvedValue({ acknowledged: true }),
      });

      await spawn(harness);

      const options = spawnedOptions(harness);
      expect(options.mcpServers).toEqual({});
      expect(flagSettings(options)['deniedMcpServers']).toEqual([
        { serverName: 'firecrawl' },
        { serverName: 'ptah' },
      ]);
    });

    it('logs an unacknowledged harness pass and still spawns', async () => {
      const harness = buildHarness({
        resolve: jest.fn().mockResolvedValue(verifiedPolicy()),
        apply: jest.fn().mockResolvedValue({ acknowledged: false }),
      });

      await spawn(harness);

      expect(harness.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Harness did not acknowledge'),
        expect.objectContaining({ fingerprint: 'fp-verified-1' }),
      );
      expect(harness.getQueryFunction).toHaveBeenCalled();
    });

    it('logs a throwing harness sync and still spawns', async () => {
      const harness = buildHarness({
        resolve: jest.fn().mockResolvedValue(verifiedPolicy()),
        apply: jest.fn().mockRejectedValue(new Error('EPERM')),
      });

      await spawn(harness);

      expect(harness.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Harness policy sync failed (ignored): EPERM'),
      );
      expect(harness.getQueryFunction).toHaveBeenCalled();
    });

    it('falls back to the bare preflight when no HarnessPolicySync is registered', async () => {
      const harness = buildHarness({
        resolve: jest.fn().mockResolvedValue(verifiedPolicy()),
        apply: null,
      });

      await spawn(harness);

      expect(harness.ensure).toHaveBeenCalledWith(CWD);
    });

    it('gives a custom-base-URL provider exactly the flags a direct one gets', async () => {
      const policy = verifiedPolicy();
      const proxied = buildHarness({
        resolve: jest.fn().mockResolvedValue(policy),
        apply: jest.fn().mockResolvedValue({ acknowledged: true }),
      });
      await spawn(proxied);

      (getAnthropicProvider as jest.Mock).mockReturnValue(
        providerWithBaseUrl(DIRECT_BASE_URL),
      );
      const direct = buildHarness({
        resolve: jest.fn().mockResolvedValue(policy),
        apply: jest.fn().mockResolvedValue({ acknowledged: true }),
      });
      await spawn(direct);

      const proxiedOptions = spawnedOptions(proxied);
      const directOptions = spawnedOptions(direct);
      expect(
        (proxiedOptions.env as Record<string, string>)['ANTHROPIC_BASE_URL'],
      ).not.toBe(
        (directOptions.env as Record<string, string>)['ANTHROPIC_BASE_URL'],
      );
      expect(proxiedOptions.settings).toBe(directOptions.settings);
      expect(proxiedOptions.mcpServers).toEqual(directOptions.mcpServers);
      expect(proxiedOptions.strictMcpConfig).toBe(
        directOptions.strictMcpConfig,
      );
      expect(proxiedOptions.skills).toBe(directOptions.skills);
    });
  });

  describe('unverified policy (fail closed)', () => {
    function expectStrictMode(harness: Harness): void {
      const options = spawnedOptions(harness);
      expect(options.strictMcpConfig).toBe(true);
      expect(options.skills).toEqual([]);
      expect(Object.keys(options.mcpServers ?? {})).toEqual(['ptah']);
      const settings = flagSettings(options);
      expect(settings).not.toHaveProperty('enabledMcpjsonServers');
      expect(settings).not.toHaveProperty('skillOverrides');
    }

    function expectNoHarnessPass(harness: Harness): void {
      expect(harness.apply).not.toHaveBeenCalled();
      expect(harness.ensure).not.toHaveBeenCalled();
    }

    it('runs strict MCP with Ptah only and no skills, and skips every harness pass', async () => {
      const harness = buildHarness({
        resolve: jest.fn().mockResolvedValue(unverifiedPolicy()),
        apply: jest.fn().mockResolvedValue({ acknowledged: true }),
      });

      await spawn(harness);

      expectStrictMode(harness);
      expectNoHarnessPass(harness);
    });

    it('fails closed when the resolver throws', async () => {
      const harness = buildHarness({
        resolve: jest.fn().mockRejectedValue(new Error('boom')),
        apply: jest.fn().mockResolvedValue({ acknowledged: true }),
      });

      await spawn(harness);

      expectStrictMode(harness);
      expectNoHarnessPass(harness);
      expect(harness.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('The capability resolver failed'),
        expect.objectContaining({ cwd: CWD, error: 'boom' }),
      );
    });

    it('fails closed when no resolver is registered', async () => {
      const harness = buildHarness({
        resolve: null,
        apply: jest.fn().mockResolvedValue({ acknowledged: true }),
      });

      await spawn(harness);

      expectStrictMode(harness);
      expectNoHarnessPass(harness);
    });

    it('fails closed when the registered resolver cannot be constructed', async () => {
      const harness = buildHarness({
        resolve: null,
        apply: jest.fn().mockResolvedValue({ acknowledged: true }),
        throwingTokens: [SDK_TOKENS.SDK_CAPABILITY_RESOLVER],
      });

      await spawn(harness);

      expectStrictMode(harness);
      expectNoHarnessPass(harness);
      expect(harness.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not resolve'),
      );
    });

    it('still omits ptah when a readable store turned it OFF', async () => {
      const harness = buildHarness({
        resolve: jest
          .fn()
          .mockResolvedValue({ ...unverifiedPolicy(), ptahEnabled: false }),
        apply: null,
      });

      await spawn(harness);

      const options = spawnedOptions(harness);
      expect(options.strictMcpConfig).toBe(true);
      expect(options.skills).toEqual([]);
      expect(options.mcpServers).toEqual({});
    });
  });
});
