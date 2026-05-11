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
import type { AuthEnv } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';

import { ProviderModelsService } from './provider-models.service';

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
} {
  const logger = createMockLogger();
  const config = createMockConfigManager({ values: opts.configValues });
  const authEnv: AuthEnv = { ...(opts.authEnv ?? {}) };

  const service = new ProviderModelsService(
    logger as unknown as Logger,
    config as unknown as import('@ptah-extension/vscode-core').ConfigManager,
    authEnv,
  );

  return { service, config, authEnv };
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
