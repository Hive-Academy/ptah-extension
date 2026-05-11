/**
 * PtahCliRegistry.resolveEffectiveTiers — scope-isolation spec.
 *
 * Verifies that resolveEffectiveTiers() reads from the `cliAgent` scope via
 * ProviderModelsService, not the `mainAgent` scope.  This is the CLI-layer
 * proof that the scope-split bug cannot regress: even if the main agent has
 * different tiers configured, the CLI registry picks up the CLI-specific
 * values.
 *
 * resolveEffectiveTiers() is private so we access it via an `as any` cast.
 * The test does not call the public API (getAdapter / spawnAgent) to avoid
 * pulling in the full DI chain (SdkModuleLoader, SdkMessageTransformer, etc.)
 * that are irrelevant to this unit.
 *
 * Source-under-test:
 *   libs/backend/agent-sdk/src/lib/ptah-cli/ptah-cli-registry.ts
 *   (resolveEffectiveTiers private method, lines ~953-1000)
 */

import 'reflect-metadata';

import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import type { ProviderModelsService } from '../provider-models.service';
import type { AnthropicProvider } from '../providers/_shared/provider-registry';
import type { PtahCliConfig } from '@ptah-extension/shared';
import { PtahCliRegistry } from './ptah-cli-registry';

// ---------------------------------------------------------------------------
// Narrow mock — only the method resolveEffectiveTiers() touches
// ---------------------------------------------------------------------------

type MockProviderModels = jest.Mocked<
  Pick<ProviderModelsService, 'getModelTiers'>
>;

function createMockProviderModels(): MockProviderModels {
  return {
    getModelTiers: jest.fn().mockReturnValue({
      sonnet: null,
      opus: null,
      haiku: null,
    }),
  };
}

// ---------------------------------------------------------------------------
// Minimal registry factory
// ---------------------------------------------------------------------------

function makeRegistry(providerModels: MockProviderModels): PtahCliRegistry {
  const logger = createMockLogger();

  // PtahCliRegistry has many constructor parameters but resolveEffectiveTiers()
  // only uses `this.logger` (for debug log) and `this.providerModels`.
  // We pass nulls for the rest since no public method that touches them is called.
  return new PtahCliRegistry(
    logger as unknown as Logger,
    null as never, // authSecrets
    null as never, // moduleLoader
    null as never, // messageTransformer
    null as never, // permissionHandler
    null as never, // subagentHookHandler
    null as never, // compactionHookHandler
    null as never, // compactionConfigProvider
    providerModels as unknown as ProviderModelsService,
    null as never, // configPersistence
    null as never, // spawnOptionsService
    null as never, // modelResolver
  );
}

// ---------------------------------------------------------------------------
// Minimal provider stub (only fields resolveEffectiveTiers reads)
// ---------------------------------------------------------------------------

const MOCK_PROVIDER: AnthropicProvider = {
  id: 'moonshot',
  name: 'Moonshot (Kimi)',
  baseUrl: 'https://api.moonshot.ai/anthropic/',
  authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
  keyPrefix: '',
  helpUrl: 'https://platform.moonshot.ai/console/api-keys',
  description: 'Kimi models via Anthropic-compatible API',
  keyPlaceholder: 'Enter Moonshot API key...',
  maskedKeyDisplay: '••••••••••••',
  staticModels: [
    {
      id: 'kimi-k2',
      name: 'Kimi K2',
      description: 'Flagship model',
      contextLength: 128_000,
      supportsToolUse: true,
    },
  ],
  defaultTiers: {
    sonnet: 'kimi-k2.5',
    opus: 'kimi-k2.5',
    haiku: 'kimi-k2.5',
  },
};

// A minimal config — agentTiers undefined so the cascade falls through to
// the providerModels service call.
const BASE_AGENT_CONFIG: PtahCliConfig = {
  id: 'pc-test-001',
  name: 'Test CLI Agent',
  providerId: 'moonshot',
  enabled: true,
  tierMappings: undefined,
  updatedAt: 0,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

type ResolvedTiers =
  | {
      sonnet?: string | null;
      opus?: string | null;
      haiku?: string | null;
    }
  | undefined;

type RegistryInternals = {
  resolveEffectiveTiers: (
    config: PtahCliConfig,
    provider: AnthropicProvider,
  ) => ResolvedTiers;
};

describe('PtahCliRegistry.resolveEffectiveTiers', () => {
  it('calls getModelTiers with cliAgent scope (not mainAgent)', () => {
    const providerModels = createMockProviderModels();
    const registry = makeRegistry(providerModels);

    (registry as unknown as RegistryInternals).resolveEffectiveTiers(
      BASE_AGENT_CONFIG,
      MOCK_PROVIDER,
    );

    expect(providerModels.getModelTiers).toHaveBeenCalledWith(
      'moonshot',
      'cliAgent',
    );
    // Crucially, it must NOT have been called with 'mainAgent' — that would be
    // the pre-fix behaviour that caused the scope leak.
    expect(providerModels.getModelTiers).not.toHaveBeenCalledWith(
      'moonshot',
      'mainAgent',
    );
  });

  it('returns cliAgent tiers when cliAgent scope has values, ignoring mainAgent values', () => {
    const providerModels = createMockProviderModels();
    // Simulate: cliAgent scope has a haiku model configured.
    // If the registry were incorrectly reading mainAgent, it would get null here.
    providerModels.getModelTiers.mockImplementation(
      (_providerId: string, scope: string) => {
        if (scope === 'cliAgent') {
          return { sonnet: 'cli-sonnet', opus: null, haiku: 'cli-haiku' };
        }
        // mainAgent — should NOT be reached
        return { sonnet: 'main-sonnet', opus: null, haiku: 'main-haiku' };
      },
    );

    const registry = makeRegistry(providerModels);
    const resolved = (
      registry as unknown as RegistryInternals
    ).resolveEffectiveTiers(BASE_AGENT_CONFIG, MOCK_PROVIDER);

    // Must reflect cliAgent values, not mainAgent values.
    expect(resolved?.sonnet).toBe('cli-sonnet');
    expect(resolved?.haiku).toBe('cli-haiku');
  });

  it('agentConfig.tierMappings takes priority over cliAgent scope values', () => {
    const providerModels = createMockProviderModels();
    providerModels.getModelTiers.mockReturnValue({
      sonnet: 'cli-sonnet',
      opus: null,
      haiku: 'cli-haiku',
    });

    const configWithTiers: PtahCliConfig = {
      ...BASE_AGENT_CONFIG,
      tierMappings: {
        sonnet: 'agent-specific-sonnet',
        haiku: 'agent-specific-haiku',
      },
    };

    const registry = makeRegistry(providerModels);
    const resolved = (
      registry as unknown as RegistryInternals
    ).resolveEffectiveTiers(configWithTiers, MOCK_PROVIDER);

    // Per-agent config must win over the cliAgent scope from providerModels.
    expect(resolved?.sonnet).toBe('agent-specific-sonnet');
    expect(resolved?.haiku).toBe('agent-specific-haiku');
  });

  it('falls back to provider defaultTiers when both agentTiers and cliAgent scope are empty', () => {
    const providerModels = createMockProviderModels();
    // cliAgent returns nothing for all tiers.
    providerModels.getModelTiers.mockReturnValue({
      sonnet: null,
      opus: null,
      haiku: null,
    });

    const registry = makeRegistry(providerModels);
    const resolved = (
      registry as unknown as RegistryInternals
    ).resolveEffectiveTiers(BASE_AGENT_CONFIG, MOCK_PROVIDER);

    // Should fall through to MOCK_PROVIDER.defaultTiers.
    expect(resolved?.sonnet).toBe('kimi-k2.5');
    expect(resolved?.haiku).toBe('kimi-k2.5');
  });
});
