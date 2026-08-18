/**
 * TASK_2026_265 — regression pins for the two defects that were closed by
 * deleting `ProviderModelsService`'s fetch-path tier auto-resolver.
 *
 * The deleted function ran inside `fetchDynamicModels`, immediately after the
 * catalogue was cached, and persisted a claude-only regex guess through
 * `setModelTier(providerId, tier, modelId, 'mainAgent')`. That single call did
 * two separate wrong things, so this file pins two separate properties:
 *
 *  - **Defect 2 (cross-provider contamination).** `setModelTier`'s `mainAgent`
 *    branch writes GLOBAL `process.env[ANTHROPIC_DEFAULT_*_MODEL]` and the
 *    shared `AuthEnv`. `provider:listModels` takes `providerId` from
 *    client-supplied RPC params and never compares it to the active provider,
 *    so merely opening a non-active provider's model picker repointed the
 *    ACTIVE session's tier resolution at the browsed provider's ids.
 *
 *  - **Defect 1 (precedence violation).** `setModelTier` also persists to
 *    `provider.<id>.<scope>.modelTier.<tier>` — the exact key
 *    `getPersistedTierValue` reads as the TOP link of
 *    `user pick ?? registry defaultTiers ?? live-derived`. A derived value in
 *    that slot is indistinguishable from a deliberate user choice, outranks a
 *    `defaultTiers` map the registry may later gain, and permanently
 *    short-circuits `deriveTiersFromCatalog` for that provider/tier.
 *
 * The two are pinned independently on purpose. Defect 1's case fetches the
 * provider that IS active, so an activeness guard would satisfy Defect 2 while
 * still failing Defect 1 — only "the fetch path writes no tier at all" passes
 * both.
 *
 * Both drive the real `ProviderModelsService`; only `axios` is mocked.
 */

import 'reflect-metadata';
import axios from 'axios';

import {
  createMockConfigManager,
  type MockConfigManager,
} from '@ptah-extension/vscode-core/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { AuthEnv } from '@ptah-extension/shared';
import type { Logger, ConfigManager } from '@ptah-extension/vscode-core';
import type { WorkspaceScopeResolver } from '@ptah-extension/settings-core';

import { ProviderModelsService } from './provider-models.service';
import { ActiveProviderResolver } from './auth/active-provider-resolver';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// ---------------------------------------------------------------------------
// A real OpenRouter-shaped /v1/models response: an anthropic/claude-* family
// alongside unrelated ids, matching the doc comment at
// provider-models.service.ts:47-49 ("Both OpenRouter and Moonshot use a
// compatible format") and the registry entry for `openrouter`
// (provider-registry.ts:178-192 — modelsEndpoint set, no defaultTiers).
//
// The claude-* ids are what made the deleted regex fire; a catalogue that did
// not match it would make both specs pass vacuously.
// ---------------------------------------------------------------------------
const OPENROUTER_API_RESPONSE = {
  data: {
    data: [
      {
        id: 'anthropic/claude-opus-4.5',
        name: 'Claude Opus 4.5',
        context_length: 200_000,
        supported_parameters: ['tools'],
      },
      {
        id: 'anthropic/claude-sonnet-4.5',
        name: 'Claude Sonnet 4.5',
        context_length: 200_000,
        supported_parameters: ['tools'],
      },
      {
        id: 'anthropic/claude-haiku-4.5',
        name: 'Claude Haiku 4.5',
        context_length: 200_000,
        supported_parameters: ['tools'],
      },
      {
        id: 'openai/gpt-5.3-codex',
        name: 'GPT-5.3 Codex',
        context_length: 400_000,
        supported_parameters: ['tools'],
      },
    ],
  },
};

const ENV_OPUS = 'ANTHROPIC_DEFAULT_OPUS_MODEL';
const ENV_SONNET = 'ANTHROPIC_DEFAULT_SONNET_MODEL';
const ENV_HAIKU = 'ANTHROPIC_DEFAULT_HAIKU_MODEL';
const TIER_ENV_KEYS = [ENV_OPUS, ENV_SONNET, ENV_HAIKU] as const;

/** `provider.<id>.<scope>.modelTier.<tier>` and its legacy unscoped form. */
const TIER_CONFIG_KEY = /^provider\.[^.]+\.(?:[^.]+\.)?modelTier\./;

function makeActiveProviderResolver(
  values: Record<string, unknown>,
): ActiveProviderResolver {
  const scope = {
    read: <T>(key: string): T | undefined => values[key] as T | undefined,
  } as unknown as WorkspaceScopeResolver;
  return new ActiveProviderResolver(scope);
}

function makeService(configValues: Record<string, unknown>): {
  service: ProviderModelsService;
  config: MockConfigManager;
  authEnv: AuthEnv;
} {
  const logger = createMockLogger();
  const config = createMockConfigManager({ values: configValues });
  const authEnv: AuthEnv = {};
  const service = new ProviderModelsService(
    logger as unknown as Logger,
    config as unknown as ConfigManager,
    authEnv,
    makeActiveProviderResolver(configValues),
  );
  return { service, config, authEnv };
}

/** Every `config.set` key the service wrote, in call order. */
function writtenConfigKeys(config: MockConfigManager): string[] {
  return config.set.mock.calls.map(([key]) => key as string);
}

// ---------------------------------------------------------------------------
// The service mutates process-global env. Snapshot and restore the three tier
// keys around EVERY test so a failure mid-test cannot leak a value into a
// sibling spec file sharing the worker process.
// ---------------------------------------------------------------------------
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(
    TIER_ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  for (const key of TIER_ENV_KEYS) delete process.env[key];
  mockedAxios.get.mockReset();
  mockedAxios.isAxiosError = jest.fn().mockReturnValue(false) as never;
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('the model-catalogue fetch path writes no tier of its own', () => {
  it('leaves the ACTIVE session tier env untouched when a NON-active provider is browsed (Defect 2)', async () => {
    // The active provider is Moonshot — the user is chatting on it right now.
    // Read back from the same ActiveProviderResolver the service itself uses,
    // rather than merely asserted by the test's own setup.
    const { service, authEnv } = makeService({
      authMethod: 'thirdParty',
      anthropicProviderId: 'moonshot',
    });
    expect(service.resolveActiveProviderId()).toBe('moonshot');

    // Precondition: `openrouter` has no persisted tier values for mainAgent —
    // the state in which the deleted auto-resolver used to fire.
    const existingBefore = service.getModelTiers('openrouter', 'mainAgent');
    expect(existingBefore).toEqual({ sonnet: null, opus: null, haiku: null });

    // Precondition: nothing has touched the tier env vars yet.
    for (const key of TIER_ENV_KEYS) {
      expect(process.env[key]).toBeUndefined();
    }

    mockedAxios.get.mockResolvedValue(OPENROUTER_API_RESPONSE);

    // The user merely opens the model picker for OpenRouter — a provider they
    // are NOT chatting on — exactly what `provider:listModels` does when given
    // `{ providerId: 'openrouter' }`. Real call path: fetchModels ->
    // fetchDynamicModels.
    const { models } = await service.fetchModels(
      'openrouter',
      'sk-or-test-key',
    );

    // The fetch genuinely happened and genuinely carried claude-* ids, so the
    // assertions below are not passing for want of input.
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(models.map((m) => m.id)).toContain('anthropic/claude-opus-4.5');

    // Browsing must not repoint the active session's tier mapping. The active
    // provider is still Moonshot; Moonshot cannot serve an anthropic/claude-*
    // id, so a write here is a silent wrong-model send on the next message.
    expect(service.resolveActiveProviderId()).toBe('moonshot');
    for (const key of TIER_ENV_KEYS) {
      expect(process.env[key]).toBeUndefined();
    }

    // The shared AuthEnv is the other half of the same write and is read by
    // `reapplyTiersForWarmedCatalog`'s "already resolved" guard, so a leak
    // there is not merely cosmetic.
    expect(authEnv[ENV_OPUS as keyof AuthEnv]).toBeUndefined();
    expect(authEnv[ENV_SONNET as keyof AuthEnv]).toBeUndefined();
    expect(authEnv[ENV_HAIKU as keyof AuthEnv]).toBeUndefined();
  });

  it('persists no DERIVED tier into the user-choice config key, even for the ACTIVE provider (Defect 1)', async () => {
    // OpenRouter IS the active provider here. That is the point: an activeness
    // guard on the fetch path would let this case through, and it must not.
    const { service, config } = makeService({
      authMethod: 'thirdParty',
      anthropicProviderId: 'openrouter',
    });
    expect(service.resolveActiveProviderId()).toBe('openrouter');
    expect(service.getModelTiers('openrouter', 'mainAgent')).toEqual({
      sonnet: null,
      opus: null,
      haiku: null,
    });

    mockedAxios.get.mockResolvedValue(OPENROUTER_API_RESPONSE);
    await service.fetchModels('openrouter', 'sk-or-test-key');

    const keys = writtenConfigKeys(config);

    // The fetch DID do its job — it persisted the catalogue. Without this the
    // tier assertion below could pass simply because nothing ran.
    expect(keys).toContain('provider.openrouter.modelCatalog');

    // `provider.<id>.<scope>.modelTier.<tier>` is the top of
    // `user pick ?? registry defaultTiers ?? live-derived`. Only an explicit
    // user choice may land there. A value written here is indistinguishable
    // from one the user picked and permanently outranks the read-time
    // derivation for that provider/tier.
    expect(keys.filter((key) => TIER_CONFIG_KEY.test(key))).toEqual([]);

    // Read side of the same property, through the accessor all three tier
    // writers actually use.
    expect(service.getModelTiers('openrouter', 'mainAgent')).toEqual({
      sonnet: null,
      opus: null,
      haiku: null,
    });
    expect(service.getModelTiers('openrouter', 'cliAgent')).toEqual({
      sonnet: null,
      opus: null,
      haiku: null,
    });

    // The catalogue is nonetheless available to the read-time rule, which is
    // what makes deleting the writer a replacement and not a removal.
    expect(service.getLiveDerivedTiers('openrouter')).toEqual({
      opus: 'anthropic/claude-opus-4.5',
      sonnet: 'anthropic/claude-sonnet-4.5',
      haiku: 'anthropic/claude-haiku-4.5',
    });
  });
});
