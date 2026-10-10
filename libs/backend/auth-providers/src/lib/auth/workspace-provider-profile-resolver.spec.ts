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
import type { AuthManager } from './auth-manager';
import type { ActiveAuth } from './active-provider-resolver';
import { AuthRequiredError } from '@ptah-extension/agent-sdk';

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
  /** Mutable: what the shared AuthEnv is configured for. */
  shared: { auth: ActiveAuth | null };
}

function createHarness(opts: {
  /** Per-workspace settings, read through `readForPath`. */
  workspaceSettings?: Record<string, unknown>;
  /** Values on the mock ConfigManager (persisted catalogue, tier overrides). */
  configValues?: Record<string, unknown>;
  providerKeys?: Record<string, string>;
  /**
   * Whether `workspaceSettings` are the workspace's OWN overrides (default) or
   * only the app/global values it inherits.
   */
  ownOverride?: boolean;
  /** What the shared AuthEnv is configured for (`AuthManager`). */
  sharedAuth?: ActiveAuth | null;
  /** Workspace-scoped overrides by path, over `workspaceSettings` (mutable). */
  settingsByPath?: Record<string, Record<string, unknown>>;
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
    readForPath: <T>(key: string, path: string): T | undefined =>
      (opts.settingsByPath?.[path]?.[key] ?? settings[key]) as T | undefined,
    hasOverrideForPath: (key: string): boolean =>
      (opts.ownOverride ?? true) && key in settings,
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
  const shared = { auth: opts.sharedAuth ?? null };
  const authManager = {
    getConfiguredAuth: () => shared.auth,
  } as unknown as AuthManager;

  const resolver = new WorkspaceProviderProfileResolver(
    logger,
    config,
    authSecrets,
    providerModels,
    modelResolver,
    activeProviderResolver,
    authManager,
    proxyPool,
  );

  return { resolver, globalAuthEnv, acquire, shared };
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
          timestamp: Date.now(),
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
          timestamp: Date.now(),
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
          timestamp: Date.now(),
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
          timestamp: Date.now(),
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
          timestamp: Date.now(),
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
          timestamp: Date.now(),
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

describe('WorkspaceProviderProfileResolver — chat sessions without an override', () => {
  it('builds a snapshot of the inherited app/global provider when the workspace has no override', async () => {
    const { resolver, globalAuthEnv } = createHarness({
      workspaceSettings: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'moonshot',
      },
      ownOverride: false,
      providerKeys: { moonshot: 'ms-key' },
    });

    const profile = await resolver.resolveProviderProfileForWorkspace(
      WORKSPACE,
      'default',
    );

    expect(profile?.providerId).toBe('moonshot');
    expect(Object.values(profile?.authEnv ?? {})).toContain('ms-key');
    expect(globalAuthEnv).toEqual({});
  });

  it('pins an inherited proxy provider to the pooled proxy', async () => {
    const { resolver, acquire } = createHarness({
      workspaceSettings: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'lm-studio',
      },
      ownOverride: false,
    });

    const profile = await resolver.resolveProviderProfileForWorkspace(
      WORKSPACE,
      'default',
    );

    expect(acquire).toHaveBeenCalledWith(
      WORKSPACE,
      'lm-studio',
      expect.objectContaining({ id: 'lm-studio' }),
    );
    expect(profile?.authEnv.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:51234');
  });
});

describe('WorkspaceProviderProfileResolver — cross-workspace isolation', () => {
  it('a workspace-scoped save in workspace A does not change the snapshot of a session in workspace B', async () => {
    const WS_A = 'D:/projects/a';
    const WS_B = 'D:/projects/b';
    const settingsByPath: Record<string, Record<string, unknown>> = {
      [WS_A]: { authMethod: 'thirdParty', anthropicProviderId: 'moonshot' },
    };
    const { resolver, globalAuthEnv, shared } = createHarness({
      // B has no override: it inherits the global provider.
      workspaceSettings: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'z-ai',
      },
      settingsByPath,
      providerKeys: {
        moonshot: 'ms-key',
        'z-ai': 'zai-key',
        requesty: 'rq-key',
      },
      sharedAuth: { authMethod: 'thirdParty', providerId: 'moonshot' },
    });

    const sessionB = await resolver.resolveProviderProfileForWorkspace(
      WS_B,
      'default',
    );
    const authEnvB = { ...sessionB?.authEnv };
    expect(sessionB?.providerId).toBe('z-ai');

    // Workspace A saves a different provider for itself; the shared env is
    // re-initialized for the active workspace (A).
    settingsByPath[WS_A] = {
      authMethod: 'thirdParty',
      anthropicProviderId: 'requesty',
    };
    globalAuthEnv.ANTHROPIC_BASE_URL = 'https://router.requesty.ai';
    globalAuthEnv.ANTHROPIC_AUTH_TOKEN = 'rq-key';
    shared.auth = { authMethod: 'thirdParty', providerId: 'requesty' };

    // The session already running in B keeps its snapshot untouched...
    expect(sessionB?.authEnv).toEqual(authEnvB);
    // ...and B's next query (resume) resolves B's own provider again.
    const nextB = await resolver.resolveProviderProfileForWorkspace(
      WS_B,
      'default',
    );
    expect(nextB?.providerId).toBe('z-ai');
    expect(nextB?.authEnv).toEqual(authEnvB);
    const nextA = await resolver.resolveProviderProfileForWorkspace(
      WS_A,
      'default',
    );
    expect(nextA?.providerId).toBe('requesty');
  });
});

describe('WorkspaceProviderProfileResolver — no snapshot', () => {
  it('fails closed when the shared auth env serves a different provider', async () => {
    // Moonshot resolved, but no key is stored: no snapshot can be built.
    const { resolver } = createHarness({
      workspaceSettings: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'moonshot',
      },
      sharedAuth: { authMethod: 'thirdParty', providerId: 'openrouter' },
    });

    const attempt = resolver.resolveProviderProfileForWorkspace(
      WORKSPACE,
      'default',
    );

    await expect(attempt).rejects.toBeInstanceOf(AuthRequiredError);
    await expect(attempt).rejects.toMatchObject({ providerId: 'moonshot' });
  });

  it('fails closed when the shared auth env holds no configuration', async () => {
    const { resolver } = createHarness({
      workspaceSettings: { authMethod: 'apiKey' },
      sharedAuth: null,
    });

    await expect(
      resolver.resolveProviderProfileForWorkspace(WORKSPACE, 'default'),
    ).rejects.toMatchObject({
      name: 'AuthRequiredError',
      providerId: 'anthropic',
    });
  });

  it('uses the shared auth env when it serves the same provider', async () => {
    // Direct API key resolved but none stored: the snapshot cannot be built,
    // and the shared env is configured for exactly this provider.
    const { resolver } = createHarness({
      workspaceSettings: { authMethod: 'apiKey' },
      sharedAuth: { authMethod: 'apiKey', providerId: 'anthropic' },
    });

    await expect(
      resolver.resolveProviderProfileForWorkspace(WORKSPACE, 'default'),
    ).resolves.toBeUndefined();
  });

  it('buildProfileForPath returns undefined without consulting the shared env', async () => {
    const { resolver } = createHarness({
      workspaceSettings: { authMethod: 'apiKey' },
      sharedAuth: null,
    });

    await expect(
      resolver.buildProfileForPath(WORKSPACE, 'default'),
    ).resolves.toBeUndefined();
  });
});

describe('WorkspaceProviderProfileResolver — direct Anthropic', () => {
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
