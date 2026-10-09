import 'reflect-metadata';

import * as path from 'path';
import * as os from 'os';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  WorkspaceScopeResolver,
  type ISettingsStore,
} from '@ptah-extension/settings-core';
import type { ProviderProfile } from '@ptah-extension/shared';
import { ActiveProviderResolver } from './active-provider-resolver';
import { WorkspaceLlmResolver } from './workspace-llm-resolver';
import type { WorkspaceProviderProfileResolver } from './workspace-provider-profile-resolver';
import type { ProviderModelsService } from '../provider-models.service';
import type { ProviderQuotaStore } from './provider-quota.store';

const WS_A = path.join(os.tmpdir(), 'ptah-llm-ws-a');
const WS_B = path.join(os.tmpdir(), 'ptah-llm-ws-b');

function makeStore(data: Record<string, unknown>): ISettingsStore {
  return {
    readGlobal: <T>(key: string) => data[key] as T | undefined,
    writeGlobal: async (key: string, value: unknown) => {
      data[key] = value;
    },
    watchGlobal: () => ({ dispose: () => undefined }),
  } as unknown as ISettingsStore;
}

function profileFor(providerId: string, model: string): ProviderProfile {
  return {
    providerId,
    model,
    authEnv: {
      ANTHROPIC_AUTH_TOKEN: `${providerId}-key`,
      ANTHROPIC_DEFAULT_OPUS_MODEL: `${providerId}-opus`,
      ANTHROPIC_DEFAULT_SONNET_MODEL: `${providerId}-sonnet`,
    },
    baseUrl: `https://${providerId}.example/anthropic`,
  };
}

async function harness(options: {
  global: Record<string, unknown>;
  /** Workspace overrides for WS_A. */
  workspaceA?: Record<string, unknown>;
  /** The ACTIVE workspace — must never influence the result. */
  activePath?: string;
  catalogs?: Record<string, string[]>;
  cooldowns?: Record<string, number>;
  profile?: (path: string, model: string) => ProviderProfile | undefined;
}) {
  const store = makeStore({ ...options.global });
  const scope = new WorkspaceScopeResolver(store, {
    getActivePath: () => options.activePath,
    onDidChange: () => ({ dispose: () => undefined }),
  });
  for (const [key, value] of Object.entries(options.workspaceA ?? {})) {
    await scope.writeForPath(key, WS_A, value);
  }
  const buildProfileForPath = jest.fn(async (p: string, model: string) => {
    if (options.profile) return options.profile(p, model);
    const { providerId } = new ActiveProviderResolver(
      scope,
    ).resolveActiveAuthForPath(p);
    return profileFor(providerId, model);
  });
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
  const resolver = new WorkspaceLlmResolver(
    logger,
    scope,
    new ActiveProviderResolver(scope),
    { buildProfileForPath } as unknown as WorkspaceProviderProfileResolver,
    {
      getCachedModelIds: (id: string) => options.catalogs?.[id] ?? null,
    } as unknown as ProviderModelsService,
    {
      retryAfterMs: (id: string) => options.cooldowns?.[id] ?? 0,
    } as unknown as ProviderQuotaStore,
  );
  return { resolver, buildProfileForPath, logger };
}

const GLOBAL = {
  authMethod: 'thirdParty',
  anthropicProviderId: 'openrouter',
  'provider.thirdParty.openrouter.selectedModel': 'or-model',
  'provider.thirdParty.moonshot.selectedModel': 'global-kimi',
};

describe('WorkspaceLlmResolver', () => {
  it('resolves the workspace override provider with the model saved for it there, whatever workspace is active', async () => {
    const { resolver, buildProfileForPath } = await harness({
      global: GLOBAL,
      workspaceA: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'moonshot',
        'provider.thirdParty.moonshot.selectedModel': 'kimi-k2.5',
      },
      activePath: WS_B,
    });

    const snapshot = await resolver.resolveForPath(WS_A);

    expect(buildProfileForPath).toHaveBeenCalledWith(WS_A, 'kimi-k2.5');
    expect(snapshot.providerId).toBe('moonshot');
    expect(snapshot.model).toBe('kimi-k2.5');
    expect(snapshot.auth?.env.ANTHROPIC_AUTH_TOKEN).toBe('moonshot-key');
    expect(snapshot.auth?.baseUrl).toBe('https://moonshot.example/anthropic');
  });

  it('a workspace with NO override resolves the global provider and model explicitly — not the active workspace', async () => {
    // The active workspace (A) overrides to moonshot; B has no override.
    const { resolver } = await harness({
      global: GLOBAL,
      workspaceA: {
        authMethod: 'thirdParty',
        anthropicProviderId: 'moonshot',
      },
      activePath: WS_A,
    });

    const snapshot = await resolver.resolveForPath(WS_B);

    expect(snapshot.providerId).toBe('openrouter');
    expect(snapshot.model).toBe('or-model');
    expect(snapshot.auth?.env.ANTHROPIC_AUTH_TOKEN).toBe('openrouter-key');
  });

  it('a rootless caller resolves the global provider and model', async () => {
    const { resolver, buildProfileForPath } = await harness({
      global: GLOBAL,
      activePath: WS_A,
      workspaceA: { anthropicProviderId: 'moonshot' },
    });

    const snapshot = await resolver.resolveForPath(undefined);

    expect(buildProfileForPath).toHaveBeenCalledWith('', 'or-model');
    expect(snapshot.providerId).toBe('openrouter');
  });

  it('replaces a stale model the provider no longer lists with its tier mapping', async () => {
    const { resolver, logger } = await harness({
      global: {
        ...GLOBAL,
        'provider.thirdParty.openrouter.selectedModel': 'retired-model',
      },
      catalogs: { openrouter: ['openrouter-sonnet', 'other'] },
    });

    const snapshot = await resolver.resolveForPath(WS_B);

    // opus is not listed; sonnet is.
    expect(snapshot.model).toBe('openrouter-sonnet');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('keeps the model when the provider has no cached list', async () => {
    const { resolver } = await harness({ global: GLOBAL });

    expect((await resolver.resolveForPath(WS_B)).model).toBe('or-model');
  });

  it('keeps a requested model the provider offers, and ignores one it does not', async () => {
    const { resolver } = await harness({
      global: GLOBAL,
      catalogs: { openrouter: ['or-model', 'or-other'] },
    });

    expect(
      (await resolver.resolveForPath(WS_B, { requestedModel: 'or-other' }))
        .model,
    ).toBe('or-other');
    expect(
      (await resolver.resolveForPath(WS_B, { requestedModel: 'kimi-k2.5' }))
        .model,
    ).toBe('or-model');
  });

  it('reports a provider cooling down from a 429 so callers can stop', async () => {
    const { resolver } = await harness({
      global: GLOBAL,
      cooldowns: { openrouter: 30_000 },
    });

    expect((await resolver.resolveForPath(WS_B)).cooldownMs).toBe(30_000);
    const ok = await harness({ global: GLOBAL });
    expect((await ok.resolver.resolveForPath(WS_B)).cooldownMs).toBeUndefined();
  });

  it('with no isolated snapshot, returns the path model without auth', async () => {
    const { resolver } = await harness({
      global: GLOBAL,
      profile: () => undefined,
    });

    const snapshot = await resolver.resolveForPath(WS_B);

    expect(snapshot.model).toBe('or-model');
    expect(snapshot.auth).toBeUndefined();
  });
});
