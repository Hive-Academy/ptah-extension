/**
 * ProviderModelsService — unit specs for scope-aware tier mappings.
 *
 * Behavioural contracts locked in here:
 *
 *   - `setModelTier(p, tier, modelId, 'mainAgent')`:
 *     - Persists to the scoped config key (`provider.<p>.mainAgent.modelTier.<tier>`)
 *     - Writes to `process.env[envVar]`
 *     - Writes to the injected `authEnv[envVar]`
 *
 *   - `setModelTier(p, tier, modelId, 'cliAgent')`:
 *     - Persists to the scoped config key (`provider.<p>.cliAgent.modelTier.<tier>`)
 *     - Does NOT touch `process.env[envVar]`
 *     - Does NOT touch the injected `authEnv[envVar]`
 *
 *   - `getModelTiers(p, 'mainAgent')` reads from the mainAgent scoped key.
 *     Falls back to the legacy unscoped key (`provider.<p>.modelTier.<tier>`)
 *     for backward-compatibility — no migration writes.
 *
 *   - `getModelTiers(p, 'cliAgent')` reads from the cliAgent scoped key ONLY.
 *     Does NOT fall back to legacy keys.
 *
 *   - `clearModelTier(p, tier, 'mainAgent')`:
 *     - Clears the scoped config key
 *     - Removes authEnv[envVar]
 *
 *   - `clearModelTier(p, tier, 'cliAgent')`:
 *     - Clears the scoped config key
 *     - Does NOT remove authEnv[envVar]
 *
 * Source-under-test:
 *   `libs/backend/agent-sdk/src/lib/provider-models.service.ts`
 */

import 'reflect-metadata';

import {
  createMockConfigManager,
  type MockConfigManager,
} from '@ptah-extension/vscode-core/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { getAnthropicProvider, type AuthEnv } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';

import { ProviderModelsService } from './provider-models.service';
import { ActiveProviderResolver } from './auth/active-provider-resolver';
import type { WorkspaceScopeResolver } from '@ptah-extension/settings-core';

function makeActiveProviderResolver(
  values: Record<string, unknown>,
): ActiveProviderResolver {
  const scope = {
    read: <T>(key: string): T | undefined => values[key] as T | undefined,
  } as unknown as WorkspaceScopeResolver;
  return new ActiveProviderResolver(scope);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROVIDER = 'moonshot';

function makeService(opts: {
  configValues?: Record<string, unknown>;
  authEnv?: Partial<AuthEnv>;
}): {
  service: ProviderModelsService;
  config: MockConfigManager;
  authEnv: AuthEnv;
  logger: ReturnType<typeof createMockLogger>;
} {
  const logger = createMockLogger();
  const config = createMockConfigManager({ values: opts.configValues });
  const authEnv: AuthEnv = { ...(opts.authEnv ?? {}) };

  const service = new ProviderModelsService(
    logger as unknown as Logger,
    config as unknown as import('@ptah-extension/vscode-core').ConfigManager,
    authEnv,
    makeActiveProviderResolver(opts.configValues ?? {}),
  );

  return { service, config, authEnv, logger };
}

// ---------------------------------------------------------------------------
// env isolation
// ---------------------------------------------------------------------------

const ENV_HAIKU = 'ANTHROPIC_DEFAULT_HAIKU_MODEL';
const ENV_SONNET = 'ANTHROPIC_DEFAULT_SONNET_MODEL';
const ENV_OPUS = 'ANTHROPIC_DEFAULT_OPUS_MODEL';

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {
    [ENV_HAIKU]: process.env[ENV_HAIKU],
    [ENV_SONNET]: process.env[ENV_SONNET],
    [ENV_OPUS]: process.env[ENV_OPUS],
  };
  delete process.env[ENV_HAIKU];
  delete process.env[ENV_SONNET];
  delete process.env[ENV_OPUS];
});

afterEach(() => {
  for (const [key, val] of Object.entries(savedEnv)) {
    if (val === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
});

// ---------------------------------------------------------------------------
// setModelTier — mainAgent scope
// ---------------------------------------------------------------------------

describe('ProviderModelsService.setModelTier', () => {
  describe('mainAgent scope', () => {
    it('writes to process.env', async () => {
      const { service } = makeService({});
      await service.setModelTier(PROVIDER, 'haiku', 'kimi-k2', 'mainAgent');
      expect(process.env[ENV_HAIKU]).toBe('kimi-k2');
    });

    it('writes to the injected authEnv', async () => {
      const { service, authEnv } = makeService({});
      await service.setModelTier(PROVIDER, 'haiku', 'kimi-k2', 'mainAgent');
      expect(authEnv[ENV_HAIKU as keyof AuthEnv]).toBe('kimi-k2');
    });

    it('persists to the mainAgent-scoped config key', async () => {
      const { service, config } = makeService({});
      await service.setModelTier(PROVIDER, 'haiku', 'kimi-k2', 'mainAgent');
      expect(config.set).toHaveBeenCalledWith(
        `provider.${PROVIDER}.mainAgent.modelTier.haiku`,
        'kimi-k2',
      );
    });
  });

  describe('cliAgent scope', () => {
    it('does NOT write to process.env', async () => {
      const { service } = makeService({});
      await service.setModelTier(PROVIDER, 'haiku', 'kimi-k2', 'cliAgent');
      expect(process.env[ENV_HAIKU]).toBeUndefined();
    });

    it('does NOT write to the injected authEnv', async () => {
      const { service, authEnv } = makeService({});
      await service.setModelTier(PROVIDER, 'haiku', 'kimi-k2', 'cliAgent');
      expect(authEnv[ENV_HAIKU as keyof AuthEnv]).toBeUndefined();
    });

    it('persists to the cliAgent-scoped config key', async () => {
      const { service, config } = makeService({});
      await service.setModelTier(PROVIDER, 'haiku', 'kimi-k2', 'cliAgent');
      expect(config.set).toHaveBeenCalledWith(
        `provider.${PROVIDER}.cliAgent.modelTier.haiku`,
        'kimi-k2',
      );
    });

    it('uses separate config keys from mainAgent — no cross-scope contamination', async () => {
      const { service, config } = makeService({});
      await service.setModelTier(PROVIDER, 'sonnet', 'model-a', 'mainAgent');
      await service.setModelTier(PROVIDER, 'sonnet', 'model-b', 'cliAgent');

      const mainAgentCalls = config.set.mock.calls.filter(([key]) =>
        key.includes('mainAgent'),
      );
      const cliAgentCalls = config.set.mock.calls.filter(([key]) =>
        key.includes('cliAgent'),
      );

      expect(mainAgentCalls).toHaveLength(1);
      expect(mainAgentCalls[0][1]).toBe('model-a');
      expect(cliAgentCalls).toHaveLength(1);
      expect(cliAgentCalls[0][1]).toBe('model-b');
    });
  });
});

// ---------------------------------------------------------------------------
// getModelTiers — scope routing and legacy fallback
// ---------------------------------------------------------------------------

describe('ProviderModelsService.getModelTiers', () => {
  it('mainAgent scope reads from the mainAgent key', () => {
    const { service } = makeService({
      configValues: {
        [`provider.${PROVIDER}.mainAgent.modelTier.haiku`]: 'kimi-main',
      },
    });

    const tiers = service.getModelTiers(PROVIDER, 'mainAgent');
    expect(tiers.haiku).toBe('kimi-main');
  });

  it('cliAgent scope reads from the cliAgent key', () => {
    const { service } = makeService({
      configValues: {
        [`provider.${PROVIDER}.cliAgent.modelTier.haiku`]: 'kimi-cli',
      },
    });

    const tiers = service.getModelTiers(PROVIDER, 'cliAgent');
    expect(tiers.haiku).toBe('kimi-cli');
  });

  it('mainAgent scope falls back to legacy unscoped key when scoped key is absent', () => {
    const { service } = makeService({
      configValues: {
        // Legacy key — written by a version before scope was introduced
        [`provider.${PROVIDER}.modelTier.sonnet`]: 'claude-3.5-sonnet-legacy',
      },
    });

    const tiers = service.getModelTiers(PROVIDER, 'mainAgent');
    expect(tiers.sonnet).toBe('claude-3.5-sonnet-legacy');
  });

  it('cliAgent scope does NOT fall back to the legacy key', () => {
    const { service } = makeService({
      configValues: {
        // Only legacy key present — cliAgent should NOT see it
        [`provider.${PROVIDER}.modelTier.sonnet`]: 'claude-3.5-sonnet-legacy',
      },
    });

    const tiers = service.getModelTiers(PROVIDER, 'cliAgent');
    expect(tiers.sonnet).toBeNull();
  });

  it('mainAgent scoped key takes precedence over the legacy key', () => {
    const { service } = makeService({
      configValues: {
        [`provider.${PROVIDER}.mainAgent.modelTier.opus`]: 'model-scoped',
        [`provider.${PROVIDER}.modelTier.opus`]: 'model-legacy',
      },
    });

    const tiers = service.getModelTiers(PROVIDER, 'mainAgent');
    expect(tiers.opus).toBe('model-scoped');
  });

  it('returns null for a tier when no config key exists', () => {
    const { service } = makeService({});
    const tiers = service.getModelTiers(PROVIDER, 'mainAgent');
    expect(tiers.haiku).toBeNull();
    expect(tiers.sonnet).toBeNull();
    expect(tiers.opus).toBeNull();
  });

  it('mainAgent and cliAgent tiers are fully independent', () => {
    const { service } = makeService({
      configValues: {
        [`provider.${PROVIDER}.mainAgent.modelTier.haiku`]: 'main-haiku',
        [`provider.${PROVIDER}.cliAgent.modelTier.haiku`]: 'cli-haiku',
      },
    });

    const mainTiers = service.getModelTiers(PROVIDER, 'mainAgent');
    const cliTiers = service.getModelTiers(PROVIDER, 'cliAgent');

    expect(mainTiers.haiku).toBe('main-haiku');
    expect(cliTiers.haiku).toBe('cli-haiku');
  });
});

// ---------------------------------------------------------------------------
// clearModelTier — scope isolation
// ---------------------------------------------------------------------------

describe('ProviderModelsService.clearModelTier', () => {
  it('mainAgent scope clears the scoped config key', async () => {
    const { service, config } = makeService({});
    await service.clearModelTier(PROVIDER, 'haiku', 'mainAgent');
    expect(config.set).toHaveBeenCalledWith(
      `provider.${PROVIDER}.mainAgent.modelTier.haiku`,
      undefined,
    );
  });

  it('mainAgent scope removes authEnv entry', async () => {
    const { service, authEnv } = makeService({
      authEnv: { [ENV_HAIKU]: 'some-model' } as Partial<AuthEnv>,
    });
    await service.clearModelTier(PROVIDER, 'haiku', 'mainAgent');
    expect(authEnv[ENV_HAIKU as keyof AuthEnv]).toBeUndefined();
  });

  it('cliAgent scope clears the scoped config key', async () => {
    const { service, config } = makeService({});
    await service.clearModelTier(PROVIDER, 'haiku', 'cliAgent');
    expect(config.set).toHaveBeenCalledWith(
      `provider.${PROVIDER}.cliAgent.modelTier.haiku`,
      undefined,
    );
  });

  it('cliAgent scope does NOT remove authEnv entry', async () => {
    const { service, authEnv } = makeService({
      authEnv: { [ENV_HAIKU]: 'main-model' } as Partial<AuthEnv>,
    });
    await service.clearModelTier(PROVIDER, 'haiku', 'cliAgent');
    // Main agent's authEnv must be untouched when clearing a CLI sub-agent tier
    expect(authEnv[ENV_HAIKU as keyof AuthEnv]).toBe('main-model');
  });
});

// ---------------------------------------------------------------------------
// Scenario: the original bug — cliAgent tier leaking into process.env
// ---------------------------------------------------------------------------

describe('Bug repro: cliAgent tier must not contaminate process.env / authEnv', () => {
  it('does not leak cliAgent haiku override into process.env when applyPersistedTiers runs for the main agent', async () => {
    // Step 1: start with a clean env — the beforeEach already deleted the
    // tier vars, but assert explicitly to make the bug visible if it regresses.
    expect(process.env[ENV_HAIKU]).toBeUndefined();

    // This makeService() call supplies a real-style config: the CLI agent has
    // stored a tier under cliAgent scope, but mainAgent has nothing.
    const { service, authEnv } = makeService({
      configValues: {
        [`provider.moonshot.cliAgent.modelTier.haiku`]: 'kimi-k2.6:cloud',
        // No mainAgent scoped key and no legacy key → mainAgent sees null
      },
    });

    // Step 2: UI sets a CLI sub-agent tier.
    await service.setModelTier(
      'moonshot',
      'haiku',
      'kimi-k2.6:cloud',
      'cliAgent',
    );

    // Step 3: process.env must be untouched (this was the bug — it used to be written).
    expect(process.env[ENV_HAIKU]).toBeUndefined();
    expect(authEnv[ENV_HAIKU as keyof AuthEnv]).toBeUndefined();

    // Step 4: simulate main agent boot on Anthropic-direct ('anthropic' is not in
    // ANTHROPIC_PROVIDERS so getAnthropicProvider returns undefined → providerDefaults
    // is empty → no tier env vars should be set).
    service.applyPersistedTiers('anthropic');

    // Step 5: process.env must still be undefined — NOT the CLI agent's kimi model.
    expect(process.env[ENV_HAIKU]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Scenario: same provider, different scopes coexist independently
// ---------------------------------------------------------------------------

describe('Same-provider, different scopes coexist', () => {
  it('mainAgent and cliAgent tiers for the same provider do not interfere with each other', async () => {
    const { service } = makeService({});

    // Write different models to each scope for the same provider.
    await service.setModelTier(PROVIDER, 'haiku', 'main-model', 'mainAgent');
    await service.setModelTier(PROVIDER, 'haiku', 'cli-model', 'cliAgent');

    // After the cliAgent write, process.env must still reflect the mainAgent value.
    expect(process.env[ENV_HAIKU]).toBe('main-model');

    // Reading back — each scope returns its own value.
    const mainTiers = service.getModelTiers(PROVIDER, 'mainAgent');
    const cliTiers = service.getModelTiers(PROVIDER, 'cliAgent');

    expect(mainTiers.haiku).toBe('main-model');
    expect(cliTiers.haiku).toBe('cli-model');
  });
});

// ---------------------------------------------------------------------------
// Scenario: legacy-key fallback scope boundary
// ---------------------------------------------------------------------------

describe('Legacy-key fallback only applies to mainAgent scope', () => {
  it('mainAgent falls back to the pre-scope legacy key', () => {
    const { service } = makeService({
      configValues: {
        [`provider.${PROVIDER}.modelTier.haiku`]: 'old-model',
      },
    });

    const mainTiers = service.getModelTiers(PROVIDER, 'mainAgent');
    expect(mainTiers.haiku).toBe('old-model');
  });

  it('cliAgent does NOT fall back to the pre-scope legacy key (no cross-scope leak)', () => {
    const { service } = makeService({
      configValues: {
        [`provider.${PROVIDER}.modelTier.haiku`]: 'old-model',
      },
    });

    const cliTiers = service.getModelTiers(PROVIDER, 'cliAgent');
    expect(cliTiers.haiku).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scenario: clear scoping — cliAgent clear must not remove mainAgent env entry
// ---------------------------------------------------------------------------

describe('clearModelTier scope isolation', () => {
  it('clearing cliAgent tier after a mainAgent set does not remove process.env entry', async () => {
    const { service } = makeService({});

    // Main agent sets its tier (writes to process.env).
    await service.setModelTier(PROVIDER, 'haiku', 'main-model', 'mainAgent');
    expect(process.env[ENV_HAIKU]).toBe('main-model');

    // CLI agent clears its own tier (should not touch process.env).
    await service.clearModelTier(PROVIDER, 'haiku', 'cliAgent');

    // Main agent's runtime env var must survive.
    expect(process.env[ENV_HAIKU]).toBe('main-model');
  });
});

// ---------------------------------------------------------------------------
// clearAllTierEnvVars
// ---------------------------------------------------------------------------

describe('ProviderModelsService.clearAllTierEnvVars', () => {
  it('deletes all tier env vars from process.env and authEnv', async () => {
    const { service, authEnv } = makeService({});
    await service.setModelTier(PROVIDER, 'haiku', 'h-model', 'mainAgent');
    await service.setModelTier(PROVIDER, 'sonnet', 's-model', 'mainAgent');
    await service.setModelTier(PROVIDER, 'opus', 'o-model', 'mainAgent');

    service.clearAllTierEnvVars();

    expect(process.env[ENV_HAIKU]).toBeUndefined();
    expect(process.env[ENV_SONNET]).toBeUndefined();
    expect(process.env[ENV_OPUS]).toBeUndefined();
    expect(authEnv[ENV_HAIKU as keyof AuthEnv]).toBeUndefined();
    expect(authEnv[ENV_SONNET as keyof AuthEnv]).toBeUndefined();
    expect(authEnv[ENV_OPUS as keyof AuthEnv]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// switchActiveProvider
// ---------------------------------------------------------------------------

describe('ProviderModelsService.switchActiveProvider', () => {
  it('clears existing tier env vars then applies the new provider mainAgent tiers', async () => {
    const { service } = makeService({
      configValues: {
        'provider.openrouter.mainAgent.modelTier.haiku': 'openrouter-haiku',
      },
    });

    // Seed the env with a previous provider's mapping.
    await service.setModelTier(
      PROVIDER,
      'haiku',
      'moonshot-haiku',
      'mainAgent',
    );
    expect(process.env[ENV_HAIKU]).toBe('moonshot-haiku');

    service.switchActiveProvider('openrouter');

    // Should reflect the new provider's persisted mainAgent tier.
    expect(process.env[ENV_HAIKU]).toBe('openrouter-haiku');
  });
});

// ---------------------------------------------------------------------------
// resolveActiveProviderId
// ---------------------------------------------------------------------------

describe('ProviderModelsService.resolveActiveProviderId', () => {
  it('returns the anthropic-direct provider id for apiKey auth method', () => {
    const { service } = makeService({
      configValues: { authMethod: 'apiKey' },
    });
    expect(service.resolveActiveProviderId()).toBe('anthropic');
  });

  it('returns the anthropic-direct provider id for claudeCli auth method', () => {
    const { service } = makeService({
      configValues: { authMethod: 'claudeCli' },
    });
    expect(service.resolveActiveProviderId()).toBe('anthropic');
  });

  it('returns the configured anthropicProviderId for thirdParty auth method', () => {
    const { service } = makeService({
      configValues: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'moonshot',
      },
    });
    expect(service.resolveActiveProviderId()).toBe('moonshot');
  });

  it('falls back to anthropic-direct for unknown auth methods', () => {
    const { service } = makeService({
      configValues: { authMethod: 'something-else' },
    });
    expect(service.resolveActiveProviderId()).toBe('anthropic');
  });
});

// ---------------------------------------------------------------------------
// clearCache
// ---------------------------------------------------------------------------

describe('ProviderModelsService.clearCache', () => {
  it('clears cache for a specific provider when an id is passed', () => {
    const { service } = makeService({});
    expect(() => service.clearCache('moonshot')).not.toThrow();
  });

  it('clears all caches when no id is passed', () => {
    const { service } = makeService({});
    expect(() => service.clearCache()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// registerDynamicFetcher
// ---------------------------------------------------------------------------

describe('ProviderModelsService.registerDynamicFetcher', () => {
  it('registers a fetcher and uses it when fetchModels is called for that provider', async () => {
    const { service } = makeService({});
    const fetcher = jest.fn().mockResolvedValue([
      {
        id: 'dyn-model',
        name: 'Dynamic Model',
        description: '',
        contextLength: 8192,
        supportsToolUse: true,
      },
    ]);

    service.registerDynamicFetcher('moonshot', fetcher);

    const result = await service.fetchModels('moonshot', null);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.isStatic).toBe(false);
    expect(result.models).toHaveLength(1);
    expect(result.models[0].id).toBe('dyn-model');
  });
});

// ---------------------------------------------------------------------------
// persisted model catalog — fallback when a live fetch is unavailable
// ---------------------------------------------------------------------------

describe('ProviderModelsService persisted model catalog', () => {
  const CATALOG_KEY = 'provider.claude-cli.modelCatalog';

  it('persists the catalog a dynamic fetcher returns', async () => {
    const { service, config } = makeService({});
    service.registerDynamicFetcher('claude-cli', async () => [
      {
        id: 'opus[1m]',
        name: 'Opus (1M context)',
        description: '',
        contextLength: 1000000,
        supportsToolUse: true,
      },
    ]);

    await service.fetchModels('claude-cli', null);
    // persistCatalog is fire-and-forget — let the microtask queue drain.
    await Promise.resolve();

    expect(config.set).toHaveBeenCalledWith(
      CATALOG_KEY,
      expect.objectContaining({
        models: [expect.objectContaining({ id: 'opus[1m]' })],
      }),
    );
  });

  it('falls back to the persisted catalog instead of the hardcoded staticModels', async () => {
    const { service } = makeService({
      configValues: {
        [CATALOG_KEY]: {
          models: [
            {
              id: 'opus[1m]',
              name: 'Opus (1M context)',
              description: '',
              contextLength: 1000000,
              supportsToolUse: true,
            },
            {
              id: 'claude-fable-5[1m]',
              name: 'Fable',
              description: '',
              contextLength: 1000000,
              supportsToolUse: true,
            },
          ],
          timestamp: 1,
        },
      },
    });
    service.registerDynamicFetcher('claude-cli', async () => {
      throw new Error('SDK bridge unavailable');
    });

    const result = await service.fetchModels('claude-cli', null);

    expect(result.models.map((m) => m.id)).toEqual([
      'opus[1m]',
      'claude-fable-5[1m]',
    ]);
    expect(result.isStatic).toBe(false);
  });

  it('still falls back to staticModels when nothing is persisted', async () => {
    const { service } = makeService({});
    service.registerDynamicFetcher('claude-cli', async () => {
      throw new Error('SDK bridge unavailable');
    });

    const result = await service.fetchModels('claude-cli', null);

    expect(result.isStatic).toBe(true);
    expect(result.models.length).toBeGreaterThan(0);
  });

  it('ignores a malformed persisted catalog rather than serving junk', async () => {
    const { service } = makeService({
      configValues: {
        [CATALOG_KEY]: { models: [{ nope: true }, 'garbage'] },
      },
    });
    service.registerDynamicFetcher('claude-cli', async () => {
      throw new Error('SDK bridge unavailable');
    });

    const result = await service.fetchModels('claude-cli', null);

    expect(result.isStatic).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// live-catalogue tier derivation (TASK_2026_262)
// ---------------------------------------------------------------------------

/**
 * The third link in the tier chain: `userTiers ?? defaultTiers ?? liveDerived`.
 *
 * `openrouter`, `lm-studio` and `requesty` declare no `defaultTiers`, so before
 * this `applyPersistedTiers` ran for them and legitimately wrote nothing —
 * `followup-a-report.md:126-128` documents exactly that — and the chat path's
 * `'default'` reached the endpoint as the bare word `'opus'`. What these lock
 * in is not just "it now writes something" but the three things that make
 * writing something safe:
 *
 *   - precedence: a user's pick and a verified registry map both outrank the
 *     derivation, which is only ever consulted for a hole they left;
 *   - the read is synchronous, because `ModelResolver.resolve` is;
 *   - every failure of the out-of-band refresh — cold cache, offline local
 *     server, no key — is silent, non-throwing and leaves the previous state.
 */
describe('ProviderModelsService live-catalog tier derivation', () => {
  /** Catalogue shape a router returns: it names the tiers itself. */
  const ROUTER_MODELS = [
    {
      id: 'anthropic/claude-opus-4.5',
      name: 'Claude Opus 4.5',
      description: 'Frontier model',
      contextLength: 200_000,
      supportsToolUse: true,
    },
    {
      id: 'anthropic/claude-sonnet-4.5',
      name: 'Claude Sonnet 4.5',
      description: 'Balanced model',
      contextLength: 200_000,
      supportsToolUse: true,
    },
    {
      id: 'anthropic/claude-haiku-4.5',
      name: 'Claude Haiku 4.5',
      description: 'Fast model',
      contextLength: 200_000,
      supportsToolUse: true,
    },
  ];

  /** Catalogue shape a local server returns: no tier words, uniform metadata. */
  const LOCAL_MODELS = [
    {
      id: 'qwen3-coder-30b',
      name: 'Qwen3 Coder 30B',
      description: '',
      contextLength: 4096,
      supportsToolUse: false,
    },
    {
      id: 'gemma-3-12b',
      name: 'Gemma 3 12B',
      description: '',
      contextLength: 4096,
      supportsToolUse: false,
    },
  ];

  /** Let the fire-and-forget refresh, and everything it awaits, settle. */
  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  };

  afterEach(() => {
    for (const tier of ['OPUS', 'SONNET', 'HAIKU']) {
      delete process.env[`ANTHROPIC_DEFAULT_${tier}_MODEL_NAME`];
      delete process.env[`ANTHROPIC_DEFAULT_${tier}_MODEL_DESCRIPTION`];
    }
  });

  it('writes real catalogue ids where a no-defaultTiers provider previously wrote nothing', async () => {
    // The Task 1.3 acceptance case, and the user-visible bug: `openrouter`
    // active, nothing selected. `resolve('default')` recurses to `'opus'` and
    // reads ANTHROPIC_DEFAULT_OPUS_MODEL — which used to be unset.
    const { service, authEnv } = makeService({
      configValues: {
        'provider.openrouter.modelCatalog': {
          models: ROUTER_MODELS,
          timestamp: 1,
        },
      },
    });

    service.applyPersistedTiers('openrouter');

    expect(authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe(
      'anthropic/claude-opus-4.5',
    );
    expect(authEnv.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe(
      'anthropic/claude-sonnet-4.5',
    );
    expect(process.env[ENV_HAIKU]).toBe('anthropic/claude-haiku-4.5');
    await settle();
  });

  it('reads the catalogue synchronously — the value is there before any await', () => {
    // Load-bearing. `ModelResolver.resolve` returns `string` and is called
    // from per-message hot paths, so a tier that only appears after a
    // microtask is a tier that is not there when the message is built.
    const { service, authEnv } = makeService({
      configValues: {
        'provider.openrouter.modelCatalog': {
          models: ROUTER_MODELS,
          timestamp: 1,
        },
      },
    });

    service.applyPersistedTiers('openrouter');

    expect(authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeDefined();
  });

  it('lets a user pick outrank the live catalogue', async () => {
    const { service, authEnv } = makeService({
      configValues: {
        'provider.openrouter.mainAgent.modelTier.opus': 'openai/gpt-5.3-codex',
        'provider.openrouter.modelCatalog': {
          models: ROUTER_MODELS,
          timestamp: 1,
        },
      },
    });

    service.applyPersistedTiers('openrouter');

    expect(authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('openai/gpt-5.3-codex');
    // The tiers the user did NOT pick still come from the catalogue.
    expect(authEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe(
      'anthropic/claude-haiku-4.5',
    );
    await settle();
  });

  it('lets a registry defaultTiers map outrank the live catalogue', async () => {
    // A verified tier map is a statement by whoever added the entry; the
    // derivation is a heuristic over a list. The statement wins.
    const expected = getAnthropicProvider(PROVIDER)?.defaultTiers?.opus;
    expect(expected).toBeTruthy();

    const { service, authEnv } = makeService({
      configValues: {
        [`provider.${PROVIDER}.modelCatalog`]: {
          models: ROUTER_MODELS,
          timestamp: 1,
        },
      },
    });

    service.applyPersistedTiers(PROVIDER);

    expect(authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe(expected);
    await settle();
  });

  it('labels a live-derived tier from the same catalogue it was derived from', async () => {
    // `applyTierMetadata` used to look only in the in-memory cache, which is
    // cold on the very run where the persisted catalogue does the work — the
    // picker would have shown the raw id.
    const { service, authEnv } = makeService({
      configValues: {
        'provider.openrouter.modelCatalog': {
          models: ROUTER_MODELS,
          timestamp: 1,
        },
      },
    });

    service.applyPersistedTiers('openrouter');

    expect(authEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME).toBe('Claude Haiku 4.5');
    expect(authEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION).toBe(
      'Fast model',
    );
    await settle();
  });

  it('recovers from a cold cache: nothing persisted, then the refresh lands', async () => {
    // The fresh-install case (R1). Nothing is cached and nothing is persisted,
    // so the synchronous pass writes nothing — and then the out-of-band fetch
    // makes the second pass succeed without anyone asking again.
    const { service, authEnv } = makeService({});

    service.switchActiveProvider('lm-studio');
    // Registered on the statement AFTER switchActiveProvider, exactly as
    // `local-proxy.strategy.ts:101-102` does it.
    service.registerDynamicFetcher('lm-studio', async () => LOCAL_MODELS);

    expect(authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();

    await settle();

    expect(authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('gemma-3-12b');
    expect(authEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('gemma-3-12b');
  });

  it('survives an offline local server without throwing or writing a guess', async () => {
    // LM Studio not running: the fetcher throws, `fetchModels` swallows it and
    // returns an empty list. The defined outcome is "unchanged", not a
    // fabricated id and not an unhandled rejection.
    const { service, authEnv } = makeService({});
    service.registerDynamicFetcher('lm-studio', async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:1234');
    });

    expect(() => service.switchActiveProvider('lm-studio')).not.toThrow();
    await settle();

    expect(authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
    expect(process.env[ENV_OPUS]).toBeUndefined();
  });

  it('fetches at most once per activation, and not at all when nothing is missing', async () => {
    // Bounded work. The refresh re-applies the tiers when it lands, and that
    // re-application must not schedule a refresh of its own.
    const fetcher = jest.fn().mockResolvedValue(LOCAL_MODELS);
    const { service } = makeService({});
    service.switchActiveProvider('lm-studio');
    service.registerDynamicFetcher('lm-studio', fetcher);
    await settle();

    expect(fetcher).toHaveBeenCalledTimes(1);

    // Everything resolves now, so a second activation asks for nothing.
    service.switchActiveProvider('lm-studio');
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not reach for a catalogue for a provider that has no route to one', async () => {
    // `anthropic` is not a registry entry and has no fetcher. The refresh must
    // notice and return, not call `fetchModels` and eat an "Unknown provider".
    const { service } = makeService({});
    expect(() => service.applyPersistedTiers('anthropic')).not.toThrow();
    await settle();
    expect(process.env[ENV_OPUS]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// reapplyTiersForWarmedCatalog — the catalogue somebody else fetched
// ---------------------------------------------------------------------------

/**
 * TASK_2026_262 residual hole 3, closed after Batch 3's error-channel scope was
 * cancelled.
 *
 * `applyPersistedTiers` derives from the catalogue on hand at the moment it
 * runs, and it runs at provider activation. `fetchModels` — which is all
 * `provider:listModels` does — warms both catalogue caches and writes no tier
 * env var. The gap that leaves is not hypothetical: a user whose local server
 * was down during activation, or whose activation-time refresh had not landed,
 * opens the model picker, sees a full catalogue, sends a message, and still
 * gets the bare tier word at the endpoint, because nothing re-ran the
 * derivation. Before this, only another provider activation cleared it — an
 * auth flow the user has no reason to re-enter.
 *
 * What these lock in is not "it now re-applies" but the three guards that make
 * re-applying safe, since the method runs off a UI action rather than an auth
 * flow:
 *
 *   - it never writes for a provider that is not the active one, because
 *     `applyPersistedTiers` writes process-global env and the picker is the one
 *     place a user routinely inspects a provider they are not using;
 *   - it only ever fills a hole, and a user's explicit pick outranks the
 *     derivation even inside that hole;
 *   - it does not turn a picker open into a second network round trip.
 */
describe('ProviderModelsService.reapplyTiersForWarmedCatalog', () => {
  /** A local server's catalogue: no tier words, uniform metadata. */
  const LOCAL_MODELS = [
    {
      id: 'qwen3-coder-30b',
      name: 'Qwen3 Coder 30B',
      description: '',
      contextLength: 4096,
      supportsToolUse: false,
    },
    {
      id: 'gemma-3-12b',
      name: 'Gemma 3 12B',
      description: '',
      contextLength: 4096,
      supportsToolUse: false,
    },
  ];

  /** A router's catalogue: it names the tiers itself. */
  const ROUTER_MODELS = [
    {
      id: 'anthropic/claude-opus-4.5',
      name: 'Claude Opus 4.5',
      description: 'Frontier model',
      contextLength: 200_000,
      supportsToolUse: true,
    },
    {
      id: 'anthropic/claude-sonnet-4.5',
      name: 'Claude Sonnet 4.5',
      description: 'Balanced model',
      contextLength: 200_000,
      supportsToolUse: true,
    },
    {
      id: 'anthropic/claude-haiku-4.5',
      name: 'Claude Haiku 4.5',
      description: 'Fast model',
      contextLength: 200_000,
      supportsToolUse: true,
    },
  ];

  /** Let the fire-and-forget refresh, and everything it awaits, settle. */
  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  };

  afterEach(() => {
    for (const tier of ['OPUS', 'SONNET', 'HAIKU']) {
      delete process.env[`ANTHROPIC_DEFAULT_${tier}_MODEL_NAME`];
      delete process.env[`ANTHROPIC_DEFAULT_${tier}_MODEL_DESCRIPTION`];
    }
  });

  it('fills the tiers a picker fetch made derivable, where activation could not', async () => {
    // The residual hole end to end, in the shape a user actually meets it:
    // LM Studio's inference endpoint is up but `/v1/models` is not when the
    // provider is activated, so the activation-time refresh fetches nothing
    // and every tier stays unset. Nothing retries on a timer, by design. The
    // user then opens the model picker — which succeeds, because by now the
    // server is answering — and before this the env stayed empty anyway.
    let modelsEndpointUp = false;
    const { service, authEnv } = makeService({
      configValues: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'lm-studio',
      },
    });
    // A dynamic fetcher stands in for the picker's HTTP call: `fetchModels`
    // warms `modelCache` and persists the catalogue identically on both of its
    // live routes, and this one needs no axios mock.
    service.registerDynamicFetcher('lm-studio', async () => {
      if (!modelsEndpointUp) {
        throw new Error('connect ECONNREFUSED 127.0.0.1:1234');
      }
      return LOCAL_MODELS;
    });

    service.switchActiveProvider('lm-studio');
    await settle();
    expect(authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();

    modelsEndpointUp = true;
    await service.fetchModels('lm-studio', null);
    service.reapplyTiersForWarmedCatalog('lm-studio');

    expect(authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('gemma-3-12b');
    expect(authEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('gemma-3-12b');
    expect(process.env[ENV_SONNET]).toBe('gemma-3-12b');
    await settle();
  });

  it('refuses to write for a provider that is not the active one', async () => {
    // The guard the picker makes necessary. `applyPersistedTiers` takes a
    // provider id and writes process-global env; it does not check activeness.
    // Browsing LM Studio's models while OpenRouter is the active provider must
    // not repoint the OpenRouter session at ids OpenRouter cannot serve — a
    // silent wrong-model send, which is strictly worse than the 404 this
    // carrier exists to remove.
    const { service, authEnv } = makeService({
      configValues: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'openrouter',
      },
    });
    service.registerDynamicFetcher('lm-studio', async () => LOCAL_MODELS);

    service.switchActiveProvider('openrouter');
    await settle();
    // OpenRouter declares no `defaultTiers` and has no catalogue here, so the
    // active provider genuinely HAS a hole — only the activeness guard is
    // standing between LM Studio's ids and it.
    expect(authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();

    await service.fetchModels('lm-studio', null);
    service.reapplyTiersForWarmedCatalog('lm-studio');

    expect(authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
    expect(authEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
    expect(process.env[ENV_OPUS]).toBeUndefined();
    await settle();
  });

  it('leaves a user pick alone and fills only around it', async () => {
    // The precedence contract, `userTiers ?? providerDefaults ?? liveDerived`,
    // holds on this trigger too — and twice over: the pick is never reached,
    // and `applyPersistedTiers` would rank it above the derivation if it were.
    const { service, authEnv } = makeService({
      configValues: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'openrouter',
        'provider.openrouter.mainAgent.modelTier.opus': 'openai/gpt-5.3-codex',
      },
    });
    // Activation runs with nothing to derive from — no key, so the
    // `modelsEndpoint` route yields nothing and no catalogue is cached. The
    // user's pick lands; the two tiers they did not pick do not.
    service.switchActiveProvider('openrouter');
    expect(authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('openai/gpt-5.3-codex');
    await settle();
    expect(authEnv.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();

    service.registerDynamicFetcher('openrouter', async () => ROUTER_MODELS);
    await service.fetchModels('openrouter', 'sk-or-test');
    service.reapplyTiersForWarmedCatalog('openrouter');

    expect(authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('openai/gpt-5.3-codex');
    expect(authEnv.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe(
      'anthropic/claude-sonnet-4.5',
    );
    expect(authEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe(
      'anthropic/claude-haiku-4.5',
    );
    await settle();
  });

  it('declines silently when there is no hole to fill', async () => {
    // The picker is opened often and every re-application re-derives, re-writes
    // three env vars and re-resolves their display metadata. A configuration
    // that already resolves has nothing to gain from any of it, so the method
    // returns before it acts — observable as the absence of the one line it
    // logs when it does act.
    //
    // Stated plainly because it is a weaker guarantee than the other two: this
    // guard is a cheap exit, not a safety property. `applyPersistedTiers` is
    // idempotent over a resolved configuration, so removing this guard would
    // waste work rather than corrupt anything.
    const { service, authEnv, logger } = makeService({
      configValues: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'lm-studio',
      },
    });
    service.registerDynamicFetcher('lm-studio', async () => LOCAL_MODELS);

    service.switchActiveProvider('lm-studio');
    await settle();
    expect(authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('gemma-3-12b');

    logger.debug.mockClear();
    service.reapplyTiersForWarmedCatalog('lm-studio');
    await settle();

    expect(logger.debug).not.toHaveBeenCalledWith(
      expect.stringContaining('re-applying tiers'),
      expect.anything(),
    );
  });

  it('does not turn a picker open into a second round trip when nothing was warmed', async () => {
    // The catalogue came back empty, so the derivation still has nothing to
    // work from. Re-applying regardless would find the same hole and schedule
    // ANOTHER out-of-band fetch — a network call that cannot succeed where the
    // one the user just triggered did not.
    const fetcher = jest.fn().mockResolvedValue([]);
    const { service } = makeService({
      configValues: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'lm-studio',
      },
    });
    service.registerDynamicFetcher('lm-studio', fetcher);

    service.switchActiveProvider('lm-studio');
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);

    await service.fetchModels('lm-studio', null);
    expect(fetcher).toHaveBeenCalledTimes(2);

    service.reapplyTiersForWarmedCatalog('lm-studio');
    await settle();

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('swallows its own failure rather than throwing into the RPC handler', () => {
    // It hangs off `provider:listModels`, whose handler re-throws anything it
    // does not recognise. A settings read that fails must not turn a
    // successful model list into an RPC failure.
    const logger = createMockLogger();
    const config = createMockConfigManager({ values: {} });
    const authEnv: AuthEnv = {};
    const throwingScope = {
      read: () => {
        throw new Error('settings store unreadable');
      },
    } as unknown as WorkspaceScopeResolver;

    const service = new ProviderModelsService(
      logger as unknown as Logger,
      config as unknown as import('@ptah-extension/vscode-core').ConfigManager,
      authEnv,
      new ActiveProviderResolver(throwingScope),
    );

    expect(() =>
      service.reapplyTiersForWarmedCatalog('openrouter'),
    ).not.toThrow();
    expect(authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// per-tier display metadata env vars
// ---------------------------------------------------------------------------

describe('ProviderModelsService tier metadata env vars', () => {
  const ENV_OPUS_NAME = 'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME';
  const ENV_OPUS_DESC = 'ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION';
  const ENV_OPUS_CAPS = 'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES';

  afterEach(() => {
    delete process.env[ENV_OPUS_NAME];
    delete process.env[ENV_OPUS_DESC];
    delete process.env[ENV_OPUS_CAPS];
  });

  it('publishes the provider model label and description alongside the id', async () => {
    const { service, authEnv } = makeService({});
    service.registerDynamicFetcher('openai-codex', async () => [
      {
        id: 'gpt-5.6-luna',
        name: 'GPT-5.6 Luna',
        description: 'Most capable Codex model',
        contextLength: 400000,
        supportsToolUse: true,
      },
    ]);
    await service.fetchModels('openai-codex', null);

    await service.setModelTier(
      'openai-codex',
      'opus',
      'gpt-5.6-luna',
      'mainAgent',
    );

    expect(authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('gpt-5.6-luna');
    expect(authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME).toBe('GPT-5.6 Luna');
    expect(authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION).toBe(
      'Most capable Codex model',
    );
  });

  it('omits the capability allowlist when the provider declares none', async () => {
    const { service, authEnv } = makeService({});
    service.registerDynamicFetcher('openai-codex', async () => [
      {
        id: 'gpt-5.6-luna',
        name: 'GPT-5.6 Luna',
        description: '',
        contextLength: 400000,
        supportsToolUse: true,
      },
    ]);
    await service.fetchModels('openai-codex', null);

    await service.setModelTier(
      'openai-codex',
      'opus',
      'gpt-5.6-luna',
      'mainAgent',
    );

    // Setting it would tell the SDK every unlisted capability is unsupported.
    expect(
      authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES,
    ).toBeUndefined();
    expect(process.env[ENV_OPUS_CAPS]).toBeUndefined();
  });

  it('emits a comma-separated allowlist when the provider does declare capabilities', async () => {
    const { service, authEnv } = makeService({});
    service.registerDynamicFetcher('openai-codex', async () => [
      {
        id: 'gpt-5.6-luna',
        name: 'GPT-5.6 Luna',
        description: '',
        contextLength: 400000,
        supportsToolUse: true,
        capabilities: ['thinking', 'effort'] as const,
      },
    ]);
    await service.fetchModels('openai-codex', null);

    await service.setModelTier(
      'openai-codex',
      'opus',
      'gpt-5.6-luna',
      'mainAgent',
    );

    expect(authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES).toBe(
      'thinking,effort',
    );
  });

  it('clearAllTierEnvVars clears the metadata vars too', async () => {
    const { service, authEnv } = makeService({});
    service.registerDynamicFetcher('openai-codex', async () => [
      {
        id: 'gpt-5.6-luna',
        name: 'GPT-5.6 Luna',
        description: 'Most capable Codex model',
        contextLength: 400000,
        supportsToolUse: true,
      },
    ]);
    await service.fetchModels('openai-codex', null);
    await service.setModelTier(
      'openai-codex',
      'opus',
      'gpt-5.6-luna',
      'mainAgent',
    );

    service.clearAllTierEnvVars();

    expect(authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME).toBeUndefined();
    expect(authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION).toBeUndefined();
    expect(process.env[ENV_OPUS_NAME]).toBeUndefined();
    expect(process.env[ENV_OPUS_DESC]).toBeUndefined();
  });
});
