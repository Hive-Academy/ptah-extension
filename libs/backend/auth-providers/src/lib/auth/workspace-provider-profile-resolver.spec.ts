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
 *   - `kimi-code`: declares all three `defaultTiers`. The precedence control,
 *     and the proof that removing the ladder's `defaultTiers` rung changed
 *     nothing.
 */

import 'reflect-metadata';
import { resolve } from 'node:path';
import { CodexHomeResolver } from '../providers/codex/codex-home-resolver';
import {
  normalizeCodexHomeKey,
  normalizeCodexWorkspaceKey,
} from '@ptah-extension/codex-runtime';
import type { SessionRuntimeIdentity } from '@ptah-extension/shared';

import {
  createMockConfigManager,
  createMockAuthSecretsService,
} from '@ptah-extension/vscode-core/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';
import {
  CODEX_DEFAULT_TIERS,
  getAnthropicProvider,
  type AuthEnv,
  type ProviderAmbientClaudeStatus,
} from '@ptah-extension/shared';
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

const WORKSPACE =
  process.platform === 'win32'
    ? 'D:/projects/pinned-workspace'
    : '/projects/pinned-workspace';

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
  activeProviderResolver: ActiveProviderResolver;
  /** The process-global auth env. Nothing here may write it. */
  globalAuthEnv: AuthEnv;
  acquire: jest.Mock;
  configureAuthentication: jest.Mock;
  /** Mutable: what the shared AuthEnv is configured for. */
  shared: { auth: ActiveAuth | null };
  logger: ReturnType<typeof createMockLogger>;
  /** The ambient Claude CLI login read. */
  ambientRead: jest.Mock<Promise<ProviderAmbientClaudeStatus>, []>;
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
  /** The Anthropic API key in SecretStorage (`authSecrets.getCredential('apiKey')`). */
  apiKey?: string;
  /** What the ambient Claude CLI login reader answers. */
  ambientState?: ProviderAmbientClaudeStatus['state'];
}): Harness {
  const mockLogger = createMockLogger();
  const logger = mockLogger as unknown as Logger;
  const config = createMockConfigManager({
    values: opts.configValues ?? {},
  }) as unknown as ConfigManager;
  const authSecrets = createMockAuthSecretsService({
    providerKeys: opts.providerKeys,
    credentials: opts.apiKey === undefined ? {} : { apiKey: opts.apiKey },
  }) as unknown as IAuthSecretsService;
  const ambientRead = jest.fn(async (): Promise<ProviderAmbientClaudeStatus> =>
    opts.ambientState === 'connected' || opts.ambientState === 'signed-out'
      ? { state: opts.ambientState, checkedAt: '2026-10-29T00:00:00.000Z' }
      : { state: 'unknown', reason: 'timeout', checkedAt: null },
  );

  const settings = opts.workspaceSettings ?? {};
  const readForPath = <T>(key: string, path: string): T | undefined =>
    (opts.settingsByPath?.[path]?.[key] ?? settings[key]) as T | undefined;
  const scope = {
    read: <T>(key: string): T | undefined => settings[key] as T | undefined,
    readForPath,
    isStored: (key: string): boolean => settings[key] !== undefined,
    isStoredForPath: (key: string, path: string): boolean =>
      readForPath(key, path) !== undefined,
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
  const configureAuthentication = jest.fn();
  const authManager = {
    configureAuthentication,
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
    new CodexHomeResolver('synthetic-codex-home'),
    { read: ambientRead },
  );

  return {
    resolver,
    activeProviderResolver,
    globalAuthEnv,
    acquire,
    shared,
    configureAuthentication,
    logger: mockLogger,
    ambientRead,
  };
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
    const expected = getAnthropicProvider('kimi-code')?.defaultTiers?.opus;
    expect(expected).toBeTruthy();

    const { resolver } = createHarness({
      workspaceSettings: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'kimi-code',
      },
      configValues: {
        'provider.kimi-code.modelCatalog': {
          models: ROUTER_MODELS,
          timestamp: Date.now(),
        },
      },
      providerKeys: { 'kimi-code': 'kimi-key' },
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
    const expected = getAnthropicProvider('kimi-code')?.defaultTiers?.opus;
    const { resolver } = createHarness({
      workspaceSettings: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'kimi-code',
      },
      providerKeys: { 'kimi-code': 'kimi-key' },
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
        anthropicProviderId: 'z-ai',
      },
      ownOverride: false,
      providerKeys: { 'z-ai': 'fake-zai-key' },
    });

    const profile = await resolver.resolveProviderProfileForWorkspace(
      WORKSPACE,
      'default',
    );

    expect(profile?.providerId).toBe('z-ai');
    expect(Object.values(profile?.authEnv ?? {})).toContain('fake-zai-key');
    expect(globalAuthEnv).toEqual({});
  });

  it('routes a kimi-code workspace through the proxy pool: no raw key in the snapshot, tier capabilities declared', async () => {
    const { resolver, acquire } = createHarness({
      workspaceSettings: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'kimi-code',
      },
      providerKeys: { 'kimi-code': 'fake-kimi-key' },
    });

    const profile = await resolver.resolveProviderProfileForWorkspace(
      WORKSPACE,
      'default',
    );
    // The snapshot is a full AuthEnv at runtime; ProviderProfileAuthEnv only
    // types the subset the SDK adapter reads by name.
    const env = profile?.authEnv as Record<string, string | undefined>;
    const capabilities =
      'thinking,interleaved_thinking,effort,xhigh_effort,max_effort';

    expect(acquire).toHaveBeenCalled();
    expect(env['ANTHROPIC_BASE_URL']).toBe('http://127.0.0.1:51234');
    expect(JSON.stringify(env)).not.toContain('fake-kimi-key');
    expect(env['ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES']).toBe(
      capabilities,
    );
    expect(env['ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES']).toBe(
      capabilities,
    );
    expect(env['ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES']).toBe(
      capabilities,
    );
  });

  // The session env is `{ ...process.env, ...snapshot }`, and the globally
  // active provider (here Kimi Code) leaves its tier vars in `process.env`.
  // Every tier key must be PRESENT in the snapshot so it wins the spread, and
  // `undefined` (not '') so the runtime treats it as unset: it skips a
  // capability override only when the var is `undefined`, while '' is an empty
  // allowlist that disables every capability of the tier model.
  const AMBIENT_KIMI_TIER_ENV: Record<string, string> = {
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'k3.1-pro',
    ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: 'Kimi K3.1 Pro',
    ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION: 'Kimi description',
    ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES:
      'thinking,interleaved_thinking,effort,xhigh_effort,max_effort',
    ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES: 'thinking',
    ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES: 'thinking',
    ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: 'Kimi sonnet label',
    ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION: 'Kimi haiku description',
  };
  const TIER_METADATA_KEYS = [
    'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
    'ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION',
    'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
    'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
    'ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION',
    'ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
  ];

  it('clears every undeclared tier metadata key so the global provider values cannot leak', async () => {
    const { resolver } = createHarness({
      workspaceSettings: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'z-ai',
      },
      providerKeys: { 'z-ai': 'zai-key' },
    });

    const profile = await resolver.resolveProviderProfileForWorkspace(
      WORKSPACE,
      'default',
    );
    const env = profile?.authEnv as Record<string, string | undefined>;
    expect(profile?.providerId).toBe('z-ai');

    for (const key of TIER_METADATA_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(env, key)).toBe(true);
      expect(env[key]).toBeUndefined();
    }
    const sessionEnv = { ...AMBIENT_KIMI_TIER_ENV, ...env };
    for (const key of TIER_METADATA_KEYS) {
      expect(sessionEnv[key]).toBeUndefined();
    }
    // The provider's own tier model still wins over the ambient one.
    expect(sessionEnv['ANTHROPIC_DEFAULT_OPUS_MODEL']).toBe(
      env['ANTHROPIC_DEFAULT_OPUS_MODEL'],
    );
    expect(sessionEnv['ANTHROPIC_DEFAULT_OPUS_MODEL']).not.toBe('k3.1-pro');
  });

  it('clears every tier key for a direct-Anthropic workspace', async () => {
    const { resolver } = createHarness({
      workspaceSettings: { authMethod: 'claudeCli' },
    });

    const profile = await resolver.resolveProviderProfileForWorkspace(
      WORKSPACE,
      'default',
    );
    const env = profile?.authEnv as Record<string, string | undefined>;
    const sessionEnv = { ...AMBIENT_KIMI_TIER_ENV, ...env };

    for (const key of [
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      ...TIER_METADATA_KEYS,
    ]) {
      expect(Object.prototype.hasOwnProperty.call(env, key)).toBe(true);
      expect(sessionEnv[key]).toBeUndefined();
    }
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
      [WS_A]: { authMethod: 'thirdParty', anthropicProviderId: 'kimi-code' },
    };
    const { resolver, globalAuthEnv, shared } = createHarness({
      // B has no override: it inherits the global provider.
      workspaceSettings: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'z-ai',
      },
      settingsByPath,
      providerKeys: {
        'kimi-code': 'kimi-key',
        'z-ai': 'zai-key',
        requesty: 'rq-key',
      },
      sharedAuth: { authMethod: 'thirdParty', providerId: 'kimi-code' },
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
    // Z.AI resolved, but no key is stored: no snapshot can be built.
    const { resolver } = createHarness({
      workspaceSettings: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'z-ai',
      },
      sharedAuth: { authMethod: 'thirdParty', providerId: 'openrouter' },
    });

    const attempt = resolver.resolveProviderProfileForWorkspace(
      WORKSPACE,
      'default',
    );

    await expect(attempt).rejects.toBeInstanceOf(AuthRequiredError);
    await expect(attempt).rejects.toMatchObject({ providerId: 'z-ai' });
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

  it('refuses an explicit apiKey without a stored key and names the auth method setting', async () => {
    const { resolver, ambientRead } = createHarness({
      workspaceSettings: { authMethod: 'apiKey' },
      ambientState: 'connected',
      sharedAuth: null,
    });

    await expect(
      resolver.resolveProviderProfileForWorkspace(WORKSPACE, 'default'),
    ).rejects.toMatchObject({
      name: 'AuthRequiredError',
      providerId: 'anthropic',
      message:
        'Cannot start this session: the Anthropic API key is not ready. Add an API key, or choose the Claude CLI login in Settings > Providers > Main agent authentication.',
      recoveryHint:
        'Add an API key, or choose the Claude CLI login in Settings > Providers > Main agent authentication.',
    });
    // An explicit value is honoured: the login is never consulted.
    expect(ambientRead).not.toHaveBeenCalled();
  });
});

describe('WorkspaceProviderProfileResolver — default auth method', () => {
  // The default also counts `ANTHROPIC_API_KEY` as a key; keep the
  // developer's shell environment out of these cases.
  const envApiKey = process.env['ANTHROPIC_API_KEY'];
  beforeEach(() => {
    delete process.env['ANTHROPIC_API_KEY'];
  });
  afterEach(() => {
    if (envApiKey === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = envApiKey;
  });

  it.each([
    ['missing', {}],
    ['unknown', { authMethod: 'garbage' }],
  ])(
    'uses the connected Claude CLI login when the auth method is %s and no API key is stored',
    async (_label, workspaceSettings) => {
      const { resolver, ambientRead } = createHarness({
        workspaceSettings,
        ambientState: 'connected',
        sharedAuth: { authMethod: 'thirdParty', providerId: 'openrouter' },
      });

      const profile = await resolver.resolveProviderProfileForWorkspace(
        WORKSPACE,
        'default',
      );

      expect(ambientRead).not.toHaveBeenCalled();
      expect(profile?.providerId).toBe('anthropic');
      expect(profile?.authEnv.ANTHROPIC_API_KEY).toBe('');
      expect(profile?.authEnv.ANTHROPIC_BASE_URL).toBe('');
      expect(profile?.model).toBe('default');
    },
  );

  it('keeps the API key when one is stored and the login is signed out', async () => {
    const { resolver, ambientRead } = createHarness({
      workspaceSettings: {},
      apiKey: 'test-stored-key',
      ambientState: 'signed-out',
    });

    const profile = await resolver.resolveProviderProfileForWorkspace(
      WORKSPACE,
      'default',
    );

    expect(profile?.authEnv.ANTHROPIC_API_KEY).toBe('test-stored-key');
    expect(ambientRead).toHaveBeenCalledTimes(1);
  });

  it('prefers a connected login over a stored API key', async () => {
    const { resolver } = createHarness({
      workspaceSettings: {},
      apiKey: 'test-stored-key',
      ambientState: 'connected',
    });

    const profile = await resolver.resolveProviderProfileForWorkspace(
      WORKSPACE,
      'default',
    );

    expect(profile?.providerId).toBe('anthropic');
    expect(profile?.authEnv.ANTHROPIC_API_KEY).toBe('');
  });

  it.each(['signed-out', undefined] as const)(
    'builds the native Claude CLI profile without reading the login when no key is stored and the login is %s',
    async (ambientState) => {
      const { resolver, ambientRead } = createHarness({
        workspaceSettings: {},
        ambientState,
        sharedAuth: null,
      });

      const profile = await resolver.resolveProviderProfileForWorkspace(
        WORKSPACE,
        'default',
      );

      expect(profile?.providerId).toBe('anthropic');
      expect(profile?.authEnv.ANTHROPIC_API_KEY).toBe('');
      expect(profile?.model).toBe('default');
      expect(ambientRead).not.toHaveBeenCalled();
    },
  );

  it('applies the default to buildProfileForPath too', async () => {
    const { resolver } = createHarness({
      workspaceSettings: {},
      ambientState: 'connected',
    });

    const profile = await resolver.buildProfileForPath(WORKSPACE, 'default');

    expect(profile?.providerId).toBe('anthropic');
    expect(profile?.authEnv.ANTHROPIC_API_KEY).toBe('');
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

describe('resolveExecutionProfile', () => {
  const input = {
    workspacePath: WORKSPACE,
    requestedModel: 'gpt-6-sol',
    hostCapabilities: { nativeCodex: true },
    consumer: 'chat' as const,
  };
  const home = new CodexHomeResolver('synthetic-codex-home').path;
  const identity: SessionRuntimeIdentity = {
    version: 1,
    sessionId: 'native-session' as SessionRuntimeIdentity['sessionId'],
    runtime: 'codex-app-server',
    providerId: 'openai-codex',
    workspaceId: WORKSPACE,
    codex: { normalizedHome: normalizeCodexHomeKey(home, process.platform) },
  };
  function nativeHarness(providerId = 'openai-codex') {
    return createHarness({
      workspaceSettings: {
        authMethod: 'thirdParty',
        anthropicProviderId: providerId,
      },
    });
  }

  it.each(['chat'] as const)(
    'returns a credential-free %s seed without materialization',
    async (consumer) => {
      const h = nativeHarness();
      const buildProfile = jest.spyOn(h.resolver, 'buildProfile' as never);
      h.globalAuthEnv.ANTHROPIC_AUTH_TOKEN = 'global-token';
      const before = { ...h.globalAuthEnv };
      const processBefore = { ...process.env };
      await expect(
        h.resolver.resolveExecutionProfile({ ...input, consumer }),
      ).resolves.toEqual({
        runtime: 'codex-app-server',
        seed: {
          providerId: 'openai-codex',
          consumer,
          workspacePath: WORKSPACE,
          home,
          normalizedHome: identity.codex?.normalizedHome,
          model: input.requestedModel,
          existingIdentity: undefined,
        },
      });
      expect(buildProfile).not.toHaveBeenCalled();
      expect(h.acquire).not.toHaveBeenCalled();
      expect(h.configureAuthentication).not.toHaveBeenCalled();
      expect(h.globalAuthEnv).toEqual(before);
      expect(process.env).toEqual(processBefore);
    },
  );

  it(
    'selects native Codex for a gateway turn with the gateway capability and Codex provider',
    async () => {
      const { resolver } = nativeHarness();
      await expect(
        resolver.resolveExecutionProfile({
          ...input,
          consumer: 'gateway',
          hostCapabilities: { nativeCodex: false, nativeCodexGateway: true },
        }),
      ).resolves.toEqual({
        runtime: 'codex-app-server',
        seed: {
          providerId: 'openai-codex',
          consumer: 'gateway',
          workspacePath: WORKSPACE,
          home,
          normalizedHome: identity.codex?.normalizedHome,
          model: input.requestedModel,
          existingIdentity: undefined,
        },
      });
    },
  );

  it.each([
    {
      name: 'gateway with only the gateway capability',
      consumer: 'gateway',
      hostCapabilities: { nativeCodex: false, nativeCodexGateway: true },
      allowed: true,
    },
    {
      name: 'gateway with only the chat capability',
      consumer: 'gateway',
      hostCapabilities: { nativeCodex: true },
      allowed: false,
    },
    {
      name: 'chat with the chat capability',
      consumer: 'chat',
      hostCapabilities: { nativeCodex: true },
      allowed: true,
    },
    {
      name: 'chat with only the gateway capability',
      consumer: 'chat',
      hostCapabilities: { nativeCodex: false, nativeCodexGateway: true },
      allowed: false,
    },
    {
      name: 'lane with both capabilities',
      consumer: 'lane',
      hostCapabilities: { nativeCodex: true, nativeCodexGateway: true },
      allowed: false,
    },
  ] as const)('resumes native Codex for $name only when allowed', async ({
    consumer,
    hostCapabilities,
    allowed,
  }) => {
    const h = nativeHarness();
    const request = {
      ...input,
      consumer,
      hostCapabilities,
      existingIdentity: identity,
    };
    const profile = h.resolver.resolveExecutionProfile(request);
    if (allowed) {
      await expect(profile).resolves.toMatchObject({
        runtime: 'codex-app-server',
        seed: { consumer, existingIdentity: identity },
      });
    } else {
      await expect(profile).rejects.toBeInstanceOf(AuthRequiredError);
      await expect(profile).rejects.toThrow(
        'This session requires a host with native Codex support.',
      );
    }
  });

  it.each([
    {
      name:
        'keeps a gateway turn on Claude when only the chat capability is enabled',
      consumer: 'gateway' as const,
      hostCapabilities: { nativeCodex: true },
      providerId: 'openai-codex',
      readsActiveProvider: false,
    },
    {
      name:
        'keeps a chat turn on Claude when only the gateway capability is enabled',
      consumer: 'chat' as const,
      hostCapabilities: { nativeCodex: false, nativeCodexGateway: true },
      providerId: 'openai-codex',
      readsActiveProvider: false,
    },
    {
      name: 'keeps a lane turn on Claude when both native capabilities are enabled',
      consumer: 'lane' as const,
      hostCapabilities: { nativeCodex: true, nativeCodexGateway: true },
      providerId: 'openai-codex',
      readsActiveProvider: false,
    },
    {
      name: 'keeps a gateway turn on Claude when the provider is not Codex',
      consumer: 'gateway' as const,
      hostCapabilities: { nativeCodex: true, nativeCodexGateway: true },
      providerId: 'kimi-code',
      readsActiveProvider: true,
    },
  ])(
    '$name',
    async ({ consumer, hostCapabilities, providerId, readsActiveProvider }) => {
      const h = nativeHarness(providerId);
      const active = jest.spyOn(
        h.activeProviderResolver,
        'resolveActiveAuthForPath',
      );
      const legacy = jest
        .spyOn(h.resolver, 'resolveProviderProfileForWorkspace')
        .mockResolvedValue(undefined);
      await expect(
        h.resolver.resolveExecutionProfile({
          ...input,
          consumer,
          hostCapabilities,
        }),
      ).resolves.toEqual({
        runtime: 'claude-sdk',
        model: input.requestedModel,
        providerProfile: undefined,
      });
      expect(legacy).toHaveBeenCalledWith(WORKSPACE, input.requestedModel);
      if (readsActiveProvider) {
        expect(active).toHaveBeenCalledWith(WORKSPACE);
      } else {
        expect(active).not.toHaveBeenCalled();
      }
    },
  );

  it('resumes after a workspace provider switch without reading the active provider', async () => {
    const h = nativeHarness('kimi-code');
    const active = jest.spyOn(
      h.activeProviderResolver,
      'resolveActiveAuthForPath',
    );
    await expect(
      h.resolver.resolveExecutionProfile({
        ...input,
        existingIdentity: identity,
      }),
    ).resolves.toMatchObject({ runtime: 'codex-app-server' });
    expect(active).not.toHaveBeenCalled();
    expect(h.acquire).not.toHaveBeenCalled();
    expect(h.configureAuthentication).not.toHaveBeenCalled();
  });

  it.each([
    ['gpt-6-sol', 'gpt-6-sol'],
    [' gpt-6-sol ', 'gpt-6-sol'],
    ['opus', CODEX_DEFAULT_TIERS.opus],
    ['sonnet', CODEX_DEFAULT_TIERS.sonnet],
    ['haiku', CODEX_DEFAULT_TIERS.haiku],
    [' OPUS ', CODEX_DEFAULT_TIERS.opus],
    ['Sonnet', CODEX_DEFAULT_TIERS.sonnet],
    ['HAIKU', CODEX_DEFAULT_TIERS.haiku],
  ])(
    'resolves native model %s to %s without a substitution',
    async (requestedModel, model) => {
      const { resolver } = nativeHarness();
      const result = await resolver.resolveExecutionProfile({
        ...input,
        requestedModel,
      });
      expect(result).toMatchObject({ seed: { model } });
      expect(result).not.toHaveProperty('modelSubstitution');
    },
  );

  it.each([
    ['default', CODEX_DEFAULT_TIERS.opus, 'not-in-catalog'],
    ['', CODEX_DEFAULT_TIERS.opus, 'not-in-catalog'],
    ['claude-sonnet-4.5', CODEX_DEFAULT_TIERS.opus, 'not-in-catalog'],
    [' unknown-model ', CODEX_DEFAULT_TIERS.opus, 'not-in-catalog'],
    ['GPT-6-SOL', 'gpt-6-sol', 'case-mismatch'],
    [' GpT-6-SoL ', 'gpt-6-sol', 'case-mismatch'],
  ])(
    'reports the substitution for %s as %s (%s) on start and resume',
    async (requestedModel, used, reason) => {
      const { resolver } = nativeHarness();
      for (const existingIdentity of [undefined, identity]) {
        await expect(
          resolver.resolveExecutionProfile({
            ...input,
            requestedModel,
            existingIdentity,
          }),
        ).resolves.toMatchObject({
          seed: { model: used },
          modelSubstitution: { requested: requestedModel, used, reason },
        });
      }
    },
  );

  it.each(['', 'relative-private-workspace'])(
    'refuses invalid current or stored workspace %p without exposing it',
    async (invalid) => {
      const h = nativeHarness();
      const buildProfile = jest.spyOn(h.resolver, 'buildProfile' as never);
      for (const overrides of [
        { workspacePath: invalid },
        { workspacePath: invalid, existingIdentity: identity },
        { existingIdentity: { ...identity, workspaceId: invalid } },
      ]) {
        await expect(
          h.resolver.resolveExecutionProfile({ ...input, ...overrides }),
        ).rejects.toMatchObject({
          constructor: AuthRequiredError,
          message: 'Cannot use native Codex session: workspaceId is invalid.',
        });
      }
      expect(buildProfile).not.toHaveBeenCalled();
      expect(h.acquire).not.toHaveBeenCalled();
      expect(h.configureAuthentication).not.toHaveBeenCalled();
    },
  );

  it('accepts a workspace identity persisted through the shared helper', async () => {
    const { resolver } = nativeHarness();
    await expect(
      resolver.resolveExecutionProfile({
        ...input,
        existingIdentity: {
          ...identity,
          workspaceId: normalizeCodexWorkspaceKey(WORKSPACE, process.platform),
        },
      }),
    ).resolves.toMatchObject({ runtime: 'codex-app-server' });
  });

  const workspaceVariants =
    process.platform === 'win32'
      ? [
          WORKSPACE.toUpperCase(),
          WORKSPACE.toLowerCase(),
          WORKSPACE.replace(/\//g, '\\'),
          `${WORKSPACE}/`,
        ]
      : [`${WORKSPACE}/`];
  it.each(workspaceVariants)(
    'normalizes both workspace identity paths: %s',
    async (variant) => {
      const { resolver } = nativeHarness();
      for (const [workspacePath, workspaceId] of [
        [WORKSPACE, variant],
        [variant, WORKSPACE],
      ]) {
        await expect(
          resolver.resolveExecutionProfile({
            ...input,
            workspacePath,
            existingIdentity: { ...identity, workspaceId },
          }),
        ).resolves.toMatchObject({ runtime: 'codex-app-server' });
      }
    },
  );

  it('normalizes the stored home before comparing it', async () => {
    const { resolver } = nativeHarness();
    const storedHome =
      process.platform === 'win32' ? `${home.toUpperCase()}/` : `${home}/`;
    await expect(
      resolver.resolveExecutionProfile({
        ...input,
        existingIdentity: {
          ...identity,
          codex: { normalizedHome: storedHome },
        },
      }),
    ).resolves.toMatchObject({ runtime: 'codex-app-server' });
  });

  it('refuses an invalid stored home with a typed authentication error', async () => {
    const { resolver } = nativeHarness();
    await expect(
      resolver.resolveExecutionProfile({
        ...input,
        existingIdentity: {
          ...identity,
          codex: { normalizedHome: 'relative-home' },
        },
      }),
    ).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('preserves a matching native identity', async () => {
    const { resolver } = nativeHarness();
    const result = await resolver.resolveExecutionProfile({
      ...input,
      existingIdentity: identity,
    });
    expect(result.runtime).toBe('codex-app-server');
    if (result.runtime === 'codex-app-server')
      expect(result.seed.existingIdentity).toBe(identity);
  });

  it('refuses a native identity on a non-native host without falling back', async () => {
    const h = nativeHarness();
    const legacy = jest.spyOn(h.resolver, 'resolveProviderProfileForWorkspace');
    await expect(
      h.resolver.resolveExecutionProfile({
        ...input,
        existingIdentity: identity,
        hostCapabilities: { nativeCodex: false },
      }),
    ).rejects.toBeInstanceOf(AuthRequiredError);
    expect(legacy).not.toHaveBeenCalled();
    expect(h.acquire).not.toHaveBeenCalled();
  });

  it.each([
    ['providerId', { ...identity, providerId: 'other' }],
    ['workspaceId', { ...identity, workspaceId: resolve('other-workspace') }],
    [
      'normalizedHome',
      { ...identity, codex: { normalizedHome: resolve('other-home') } },
    ],
  ] as const)(
    'refuses a %s mismatch before materialization',
    async (field, existingIdentity) => {
      const h = nativeHarness();
      const buildProfile = jest.spyOn(h.resolver, 'buildProfile' as never);
      await expect(
        h.resolver.resolveExecutionProfile({ ...input, existingIdentity }),
      ).rejects.toThrow(field);
      expect(buildProfile).not.toHaveBeenCalled();
      expect(h.acquire).not.toHaveBeenCalled();
    },
  );

  it.each([
    { hostCapabilities: { nativeCodex: false } },
    {
      existingIdentity: {
        version: 1,
        sessionId: identity.sessionId,
        runtime: 'claude-sdk',
        providerId: 'openai-codex',
        workspaceId: WORKSPACE,
      } as SessionRuntimeIdentity,
    },
  ])(
    'returns the unchanged legacy profile when native selection is disabled',
    async (overrides) => {
      const { resolver } = nativeHarness();
      const profile = await resolver.resolveProviderProfileForWorkspace(
        WORKSPACE,
        input.requestedModel,
      );
      const legacy = jest
        .spyOn(resolver, 'resolveProviderProfileForWorkspace')
        .mockResolvedValue(profile);
      await expect(
        resolver.resolveExecutionProfile({ ...input, ...overrides }),
      ).resolves.toEqual({
        runtime: 'claude-sdk',
        model: input.requestedModel,
        providerProfile: profile,
      });
      expect(legacy).toHaveBeenCalledWith(WORKSPACE, input.requestedModel);
    },
  );

  it('checks a stored model only on the Claude branch', async () => {
    const { resolver } = nativeHarness();
    const stored = jest
      .spyOn(resolver, 'resolveStoredModel')
      .mockReturnValue('default');
    const legacy = jest
      .spyOn(resolver, 'resolveProviderProfileForWorkspace')
      .mockResolvedValue(undefined);
    await expect(
      resolver.resolveExecutionProfile({
        ...input,
        requestedModelIsStored: true,
        hostCapabilities: { nativeCodex: false },
      }),
    ).resolves.toEqual({
      runtime: 'claude-sdk',
      model: 'default',
      providerProfile: undefined,
    });
    expect(stored).toHaveBeenCalledWith(WORKSPACE, input.requestedModel);
    expect(legacy).toHaveBeenCalledWith(WORKSPACE, 'default');

    stored.mockClear();
    await expect(
      resolver.resolveExecutionProfile({
        ...input,
        requestedModelIsStored: true,
      }),
    ).resolves.toMatchObject({
      runtime: 'codex-app-server',
      seed: { model: input.requestedModel },
    });
    expect(stored).not.toHaveBeenCalled();
  });

  it('keeps other providers on the legacy path and preserves its refusal', async () => {
    const { resolver } = nativeHarness('missing-provider');
    await expect(
      resolver.resolveExecutionProfile(input),
    ).rejects.toBeInstanceOf(AuthRequiredError);
  });
});

describe('WorkspaceProviderProfileResolver — resolveStoredModel', () => {
  const CODEX = {
    authMethod: 'thirdParty',
    anthropicProviderId: 'openai-codex',
  };
  const FALLBACK_LOG =
    '[WorkspaceProviderProfileResolver] Stored model belongs to another provider — using the workspace provider default';
  const catalog = (ids: string[]) => ({
    models: ids.map((id) => ({ id, name: id })),
    timestamp: Date.now(),
  });

  it('replaces a Codex static id on Claude CLI with the default and logs it', () => {
    // The M3 case: Codex -> Claude must not send `gpt-6-luna` to Anthropic.
    const { resolver, logger } = createHarness({
      workspaceSettings: { authMethod: 'claudeCli' },
    });

    expect(resolver.resolveStoredModel(WORKSPACE, 'gpt-6-luna')).toBe(
      'default',
    );
    expect(logger.info).toHaveBeenCalledWith(FALLBACK_LOG, {
      storedModel: 'gpt-6-luna',
      providerId: 'anthropic',
      workspacePath: WORKSPACE,
    });
  });

  it('replaces an id from another provider cached catalogue on direct Anthropic', () => {
    const { resolver } = createHarness({
      workspaceSettings: { authMethod: 'apiKey' },
      configValues: {
        'provider.openai-codex.modelCatalog': catalog(['gpt-7-nova']),
      },
    });

    expect(resolver.resolveStoredModel(WORKSPACE, 'gpt-7-nova')).toBe(
      'default',
    );
  });

  it('replaces a Codex id on another third-party provider that does not offer it', () => {
    const { resolver } = createHarness({
      workspaceSettings: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'kimi-code',
      },
    });

    expect(resolver.resolveStoredModel(WORKSPACE, 'gpt-6-luna')).toBe(
      'default',
    );
  });

  it('keeps a Claude id without logging', () => {
    const { resolver, logger } = createHarness({
      workspaceSettings: { authMethod: 'apiKey' },
    });

    expect(resolver.resolveStoredModel(WORKSPACE, 'claude-opus-5-5')).toBe(
      'claude-opus-5-5',
    );
    expect(logger.info).not.toHaveBeenCalledWith(
      FALLBACK_LOG,
      expect.anything(),
    );
  });

  it('keeps a Claude id regardless of case', () => {
    const { resolver } = createHarness({
      workspaceSettings: { authMethod: 'claudeCli' },
    });

    expect(resolver.resolveStoredModel(WORKSPACE, 'Claude-Opus-5-5')).toBe(
      'Claude-Opus-5-5',
    );
  });

  it.each([
    ['claudeCli', 'opus[1m]'],
    ['claudeCli', 'sonnet[1m]'],
    ['claudeCli', 'opusplan'],
    ['apiKey', 'opus[1m]'],
    ['apiKey', 'Sonnet[1M]'],
  ])('keeps the SDK alias on %s: %s', (authMethod, alias) => {
    const { resolver } = createHarness({ workspaceSettings: { authMethod } });

    expect(resolver.resolveStoredModel(WORKSPACE, alias)).toBe(alias);
  });

  it.each(['default', 'opus', 'Sonnet', 'haiku'])(
    'keeps the alias %s on a third-party provider',
    (alias) => {
      const { resolver } = createHarness({ workspaceSettings: CODEX });

      expect(resolver.resolveStoredModel(WORKSPACE, alias)).toBe(alias);
    },
  );

  it('maps an empty stored model to default, as before', () => {
    const { resolver } = createHarness({
      workspaceSettings: { authMethod: 'claudeCli' },
    });

    expect(resolver.resolveStoredModel(WORKSPACE, '')).toBe('default');
  });

  it('keeps a model in the serving provider static list but not in its stale catalogue', () => {
    const { resolver } = createHarness({
      workspaceSettings: CODEX,
      configValues: {
        'provider.openai-codex.modelCatalog': catalog(['gpt-7-nova']),
      },
    });

    expect(resolver.resolveStoredModel(WORKSPACE, 'gpt-7-nova')).toBe(
      'gpt-7-nova',
    );
    expect(resolver.resolveStoredModel(WORKSPACE, 'gpt-6-luna')).toBe(
      'gpt-6-luna',
    );
  });

  it.each([
    ['openrouter', 'my-org/custom-model'],
    ['ollama', 'qwen3-coder:32b'],
  ])(
    'keeps a custom %s id missing from the cached catalogue',
    (providerId, model) => {
      const { resolver, logger } = createHarness({
        workspaceSettings: {
          authMethod: 'thirdParty',
          anthropicProviderId: providerId,
        },
        configValues: {
          [`provider.${providerId}.modelCatalog`]: catalog(['listed/model']),
        },
      });

      expect(resolver.resolveStoredModel(WORKSPACE, model)).toBe(model);
      expect(logger.info).not.toHaveBeenCalledWith(
        FALLBACK_LOG,
        expect.anything(),
      );
    },
  );

  it('passes the stored model through when no provider knows it', () => {
    expect(getAnthropicProvider('requesty')?.staticModels).toBeUndefined();
    const { resolver } = createHarness({
      workspaceSettings: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'requesty',
      },
    });

    expect(resolver.resolveStoredModel(WORKSPACE, 'any/model-id')).toBe(
      'any/model-id',
    );
  });

  it('checks against the provider of the given workspace, not the global one', () => {
    const { resolver } = createHarness({
      workspaceSettings: CODEX,
      settingsByPath: { [WORKSPACE]: { authMethod: 'claudeCli' } },
    });

    expect(resolver.resolveStoredModel(WORKSPACE, 'gpt-6-luna')).toBe(
      'default',
    );
    expect(resolver.resolveStoredModel('D:/projects/other', 'gpt-6-luna')).toBe(
      'gpt-6-luna',
    );
  });
});
