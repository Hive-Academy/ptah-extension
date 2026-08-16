/**
 * WorkspaceProviderProfileResolver — the per-workspace tier chain.
 *
 * TASK_2026_262 Batch 2, task 2.1. This class holds its own copy of the
 * `persisted ?? defaults` chain because it writes an ISOLATED snapshot rather
 * than the process-global `authEnv` — which is exactly why Batch 1's fix to
 * `ProviderModelsService.applyPersistedTiers` did not reach it, and why a
 * workspace pinned to a provider that declares no `defaultTiers` still sent the
 * bare word `'opus'` after the foreground chat path stopped doing so.
 *
 * These specs drive the REAL collaborators for the whole resolution chain —
 * `ProviderModelsService` reading a persisted catalogue off a mock
 * `ConfigManager`, the real `ModelResolver`, the real `ActiveProviderResolver`
 * — because every link that matters here is a link BETWEEN those objects. A
 * suite that stubbed `getLiveDerivedTiers` would assert that this file calls a
 * function, not that a workspace ends up on a servable model.
 *
 * Provider choices are deliberate and load-bearing:
 *   - `requesty`: `requiresProxy: false`, `authType: 'apiKey'`, and no
 *     `defaultTiers` — its own entry says "tiers come from the live model list
 *     instead" (`requesty-provider-entry.ts:19-23`). The direct third-party
 *     path, with no proxy in the way.
 *   - `moonshot`: declares all three `defaultTiers`. The precedence control,
 *     and the proof that removing the ladder's `defaultTiers` rung changed
 *     nothing.
 */

import 'reflect-metadata';

import {
  createMockConfigManager,
  createMockAuthSecretsService,
} from '@ptah-extension/vscode-core/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { getAnthropicProvider, type AuthEnv } from '@ptah-extension/shared';
import type {
  ConfigManager,
  IAuthSecretsService,
  Logger,
} from '@ptah-extension/vscode-core';
import type { WorkspaceScopeResolver } from '@ptah-extension/settings-core';

import { WorkspaceProviderProfileResolver } from './workspace-provider-profile-resolver';
import { ProviderModelsService } from '../provider-models.service';
import { ModelResolver } from './model-resolver';
import { ActiveProviderResolver } from './active-provider-resolver';
import type { ProviderProxyPool } from './provider-proxy-pool';

const WORKSPACE = 'D:/projects/pinned-workspace';

/** A router-shaped catalogue: the provider names the tiers itself. */
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

interface Harness {
  resolver: WorkspaceProviderProfileResolver;
  /** The process-global auth env. Nothing here may write it. */
  globalAuthEnv: AuthEnv;
  acquire: jest.Mock;
}

function createHarness(opts: {
  /** Per-workspace settings, read through `readForPath`. */
  workspaceSettings?: Record<string, unknown>;
  /** Values on the mock ConfigManager (persisted catalogue, tier overrides). */
  configValues?: Record<string, unknown>;
  providerKeys?: Record<string, string>;
}): Harness {
  const logger = createMockLogger() as unknown as Logger;
  const config = createMockConfigManager({
    values: opts.configValues ?? {},
  }) as unknown as ConfigManager;
  const authSecrets = createMockAuthSecretsService({
    providerKeys: opts.providerKeys,
  }) as unknown as IAuthSecretsService;

  const settings = opts.workspaceSettings ?? {};
  const scope = {
    read: <T>(key: string): T | undefined => settings[key] as T | undefined,
    readForPath: <T>(key: string): T | undefined =>
      settings[key] as T | undefined,
    hasOverrideForPath: (key: string): boolean => key in settings,
  } as unknown as WorkspaceScopeResolver;

  const globalAuthEnv: AuthEnv = {};
  const activeProviderResolver = new ActiveProviderResolver(scope);
  const providerModels = new ProviderModelsService(
    logger,
    config,
    globalAuthEnv,
    activeProviderResolver,
  );
  const modelResolver = new ModelResolver(logger, globalAuthEnv);

  const acquire = jest.fn(async () => ({
    baseUrl: 'http://127.0.0.1:51234',
    authToken: 'isolated-proxy-token',
  }));
  const proxyPool = { acquire } as unknown as ProviderProxyPool;

  const resolver = new WorkspaceProviderProfileResolver(
    logger,
    config,
    authSecrets,
    providerModels,
    modelResolver,
    activeProviderResolver,
    scope,
    proxyPool,
  );

  return { resolver, globalAuthEnv, acquire };
}

// ---------------------------------------------------------------------------
// The behaviour change (TASK_2026_262 task 2.1)
// ---------------------------------------------------------------------------

describe('WorkspaceProviderProfileResolver — live-catalogue tiers', () => {
  it('resolves a workspace pinned to a no-defaultTiers provider to a real catalogue id', async () => {
    // The acceptance case. `requesty` declares no `defaultTiers`, the user has
    // pinned no model, and the chat asks for `'default'` — which used to leave
    // this resolver as the literal string `'opus'`.
    expect(getAnthropicProvider('requesty')?.defaultTiers).toBeUndefined();

    const { resolver } = createHarness({
      workspaceSettings: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'requesty',
      },
      configValues: {
        'provider.requesty.modelCatalog': {
          models: ROUTER_MODELS,
          timestamp: 1,
        },
      },
      providerKeys: { requesty: 'rq-key' },
    });

    const profile = await resolver.resolveProviderProfileForWorkspace(
      WORKSPACE,
      '',
    );

    expect(profile?.model).toBe('anthropic/claude-opus-4.5');
    expect(profile?.authEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe(
      'anthropic/claude-haiku-4.5',
    );
  });

  it('reaches the proxy path too — the snapshot is built the same way there', async () => {
    // `openrouter` is `requiresProxy: true`, so it takes the ProviderProxyPool
    // branch. Both branches call the same `applyProviderTiers`; this proves the
    // fix is not on one of them only.
    const { resolver, acquire } = createHarness({
      workspaceSettings: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'openrouter',
      },
      configValues: {
        'provider.openrouter.modelCatalog': {
          models: ROUTER_MODELS,
          timestamp: 1,
        },
      },
    });

    const profile = await resolver.resolveProviderProfileForWorkspace(
      WORKSPACE,
      'default',
    );

    expect(acquire).toHaveBeenCalled();
    expect(profile?.model).toBe('anthropic/claude-opus-4.5');
  });

  it('does not write the process-global auth env or process.env', async () => {
    // The whole reason this class exists. A snapshot that leaked would repoint
    // the user's other workspaces mid-conversation.
    const before = { ...process.env };
    const { resolver, globalAuthEnv } = createHarness({
      workspaceSettings: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'requesty',
      },
      configValues: {
        'provider.requesty.modelCatalog': {
          models: ROUTER_MODELS,
          timestamp: 1,
        },
      },
      providerKeys: { requesty: 'rq-key' },
    });

    await resolver.resolveProviderProfileForWorkspace(WORKSPACE, '');

    expect(globalAuthEnv).toEqual({});
    expect({ ...process.env }).toEqual(before);
  });

  it('lets a user tier outrank the catalogue, tier by tier', async () => {
    // Precedence identical to `applyPersistedTiers`: user > registry > live.
    const { resolver } = createHarness({
      workspaceSettings: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'requesty',
      },
      configValues: {
        'provider.requesty.mainAgent.modelTier.opus': 'openai/gpt-5.3-codex',
        'provider.requesty.modelCatalog': {
          models: ROUTER_MODELS,
          timestamp: 1,
        },
      },
      providerKeys: { requesty: 'rq-key' },
    });

    const profile = await resolver.resolveProviderProfileForWorkspace(
      WORKSPACE,
      'opus',
    );

    expect(profile?.model).toBe('openai/gpt-5.3-codex');
    // The tiers the user did NOT pick still come from the catalogue.
    expect(profile?.authEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe(
      'anthropic/claude-haiku-4.5',
    );
  });

  it('lets a registry defaultTiers map outrank the catalogue', async () => {
    // A verified tier map is a statement by whoever added the entry; the
    // derivation is a heuristic over a list. The statement wins.
    const expected = getAnthropicProvider('moonshot')?.defaultTiers?.opus;
    expect(expected).toBeTruthy();

    const { resolver } = createHarness({
      workspaceSettings: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'moonshot',
      },
      configValues: {
        'provider.moonshot.modelCatalog': {
          models: ROUTER_MODELS,
          timestamp: 1,
        },
      },
      providerKeys: { moonshot: 'moon-key' },
    });

    const profile = await resolver.resolveProviderProfileForWorkspace(
      WORKSPACE,
      'default',
    );

    expect(profile?.model).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// The post-fallback ladder, after the narrowing
// ---------------------------------------------------------------------------

describe('WorkspaceProviderProfileResolver — the post-fallback ladder', () => {
  it('carries a registry defaultTiers value through the SNAPSHOT, not through the ladder', async () => {
    // Why the ladder's `provider?.defaultTiers?.opus` rung was removed. It could
    // only fire when all three snapshot tier vars were empty — and
    // `applyProviderTiers` writes `persisted ?? defaults ?? derived` into them,
    // so an empty snapshot opus var means an empty `defaults.opus` too. This
    // case pins that the value arrives anyway, which is what makes the removal
    // a no-op rather than a regression.
    const expected = getAnthropicProvider('moonshot')?.defaultTiers?.opus;
    const { resolver } = createHarness({
      workspaceSettings: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'moonshot',
      },
      providerKeys: { moonshot: 'moon-key' },
    });

    const profile = await resolver.resolveProviderProfileForWorkspace(
      WORKSPACE,
      'default',
    );

    expect(profile?.authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe(expected);
    expect(profile?.model).toBe(expected);
  });

  it('still sends the tier word when nothing anywhere can name a model', async () => {
    // The residual TASK_2026_262 Q2 declined to turn into a failure channel:
    // no user tier, no `defaultTiers`, no catalogue ever fetched, no static
    // models. The profile still builds — a resolver that refused here would
    // take the workspace's chat down instead of letting the endpoint say why.
    const { resolver } = createHarness({
      workspaceSettings: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'requesty',
      },
      providerKeys: { requesty: 'rq-key' },
    });

    const profile = await resolver.resolveProviderProfileForWorkspace(
      WORKSPACE,
      '',
    );

    expect(profile?.model).toBe('opus');
  });

  it('leaves an explicitly requested model alone', async () => {
    // Not a tier alias, so nothing above the ladder and nothing in it applies.
    const { resolver } = createHarness({
      workspaceSettings: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'requesty',
      },
      configValues: {
        'provider.requesty.modelCatalog': {
          models: ROUTER_MODELS,
          timestamp: 1,
        },
      },
      providerKeys: { requesty: 'rq-key' },
    });

    const profile = await resolver.resolveProviderProfileForWorkspace(
      WORKSPACE,
      'deepseek/deepseek-v3.2',
    );

    expect(profile?.model).toBe('deepseek/deepseek-v3.2');
  });
});

// ---------------------------------------------------------------------------
// Untouched guarantees
// ---------------------------------------------------------------------------

describe('WorkspaceProviderProfileResolver — global-auth fallback', () => {
  it('returns undefined when the workspace has no explicit provider override', async () => {
    const { resolver } = createHarness({ workspaceSettings: {} });

    await expect(
      resolver.resolveProviderProfileForWorkspace(WORKSPACE, 'default'),
    ).resolves.toBeUndefined();
  });

  it('keeps direct Anthropic on the SDK sentinel rather than deriving a tier for it', async () => {
    // `claudeCli` builds a deliberately empty snapshot, so `isDirectAnthropic`
    // holds and `'default'` is a valid model string all the way down. No
    // catalogue is consulted, because there is no third-party provider here.
    const { resolver } = createHarness({
      workspaceSettings: { authMethod: 'claudeCli' },
    });

    const profile = await resolver.resolveProviderProfileForWorkspace(
      WORKSPACE,
      'default',
    );

    expect(profile?.model).toBe('default');
  });
});
