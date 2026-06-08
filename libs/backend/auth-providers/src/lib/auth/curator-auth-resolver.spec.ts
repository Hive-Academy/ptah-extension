import 'reflect-metadata';

import type {
  Logger,
  ConfigManager,
  IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import {
  createMockConfigManager,
  createMockAuthSecretsService,
  type MockConfigManager,
  type MockAuthSecretsService,
} from '@ptah-extension/vscode-core/testing';

import { CuratorAuthResolver } from './curator-auth-resolver';
import { CuratorAuthError } from './curator-auth.error';
import type { CuratorProxyManager } from './curator-proxy-manager';
import type { ProviderModelsService } from '../provider-models.service';
import type { ICopilotAuthService } from '../providers/copilot/copilot-provider.types';
import type { ICodexAuthService } from '../providers/codex/codex-provider.types';
import type { IOpenRouterAuthService } from '../providers/openrouter/openrouter-provider.types';
import { COPILOT_PROXY_TOKEN_PLACEHOLDER } from '../providers/copilot';

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}
function asConfig(mock: MockConfigManager): ConfigManager {
  return mock as unknown as ConfigManager;
}

type ProviderModelsSurface = Pick<
  ProviderModelsService,
  'resolveActiveProviderId'
>;
type ProxyManagerSurface = Pick<
  CuratorProxyManager,
  'ensureProxy' | 'isProxyProvider'
>;

interface Harness {
  resolver: CuratorAuthResolver;
  authSecrets: MockAuthSecretsService;
  config: MockConfigManager;
  ensureProxy: jest.Mock;
  copilotAuthed: jest.Mock;
  copilotRestore: jest.Mock;
}

function createHarness(opts: {
  activeProviderId: string;
  credentials?: Record<string, string>;
  providerKeys?: Record<string, string>;
  configValues?: Record<string, unknown>;
  proxyUrl?: string;
  copilotAuthed?: boolean;
}): Harness {
  const logger = createMockLogger();
  const config = createMockConfigManager({ values: opts.configValues ?? {} });
  const authSecrets = createMockAuthSecretsService({
    credentials: opts.credentials,
    providerKeys: opts.providerKeys,
  });

  const providerModels: ProviderModelsSurface = {
    resolveActiveProviderId: jest.fn(() => opts.activeProviderId),
  };

  const ensureProxy = jest.fn(async () => ({
    url: opts.proxyUrl ?? 'http://127.0.0.1:51234',
    token: COPILOT_PROXY_TOKEN_PLACEHOLDER,
  }));
  const proxyManager: ProxyManagerSurface = {
    ensureProxy,
    isProxyProvider: jest.fn(() => true),
  };

  const copilotAuthed = jest.fn(async () => opts.copilotAuthed ?? true);
  const copilotRestore = jest.fn(async () => false);
  const copilotAuth = {
    isAuthenticated: copilotAuthed,
    tryRestoreAuth: copilotRestore,
  } as unknown as ICopilotAuthService;
  const codexAuth = {
    isAuthenticated: jest.fn(async () => true),
    ensureTokensFresh: jest.fn(async () => true),
  } as unknown as ICodexAuthService;
  const openRouterAuth = {
    isAuthenticated: jest.fn(async () => true),
  } as unknown as IOpenRouterAuthService;

  const resolver = new CuratorAuthResolver(
    asLogger(logger),
    asConfig(config),
    authSecrets as unknown as IAuthSecretsService,
    providerModels as unknown as ProviderModelsService,
    proxyManager as unknown as CuratorProxyManager,
    copilotAuth,
    codexAuth,
    openRouterAuth,
  );

  return {
    resolver,
    authSecrets,
    config,
    ensureProxy,
    copilotAuthed,
    copilotRestore,
  };
}

describe('CuratorAuthResolver.resolve', () => {
  it('returns null for an empty curator provider id', async () => {
    const { resolver } = createHarness({ activeProviderId: 'anthropic' });
    await expect(resolver.resolve('')).resolves.toBeNull();
  });

  it('returns null when curator provider equals the active provider', async () => {
    const { resolver } = createHarness({ activeProviderId: 'moonshot' });
    await expect(resolver.resolve('moonshot')).resolves.toBeNull();
  });

  it('api-key (Anthropic direct) sets ANTHROPIC_API_KEY and no base url', async () => {
    const { resolver } = createHarness({
      activeProviderId: 'moonshot',
      credentials: { apiKey: 'sk-ant-curator' },
    });
    const result = await resolver.resolve('anthropic');
    expect(result).not.toBeNull();
    expect(result?.env.ANTHROPIC_API_KEY).toBe('sk-ant-curator');
    expect(result?.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(result?.baseUrl).toBeUndefined();
  });

  it('api-key (Anthropic direct) throws CuratorAuthError when key missing', async () => {
    const { resolver } = createHarness({ activeProviderId: 'moonshot' });
    await expect(resolver.resolve('anthropic')).rejects.toBeInstanceOf(
      CuratorAuthError,
    );
  });

  it('third-party api-key sets base url + provider auth env var + tier envs', async () => {
    const { resolver } = createHarness({
      activeProviderId: 'anthropic',
      providerKeys: { moonshot: 'moon-key' },
    });
    const result = await resolver.resolve('moonshot');
    expect(result).not.toBeNull();
    expect(result?.env.ANTHROPIC_BASE_URL).toBe(
      'https://api.moonshot.ai/anthropic/',
    );
    expect(result?.env.ANTHROPIC_AUTH_TOKEN).toBe('moon-key');
    expect(result?.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('kimi-k2.5');
    expect(result?.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('third-party api-key honors a provider.<id>.baseUrl override', async () => {
    const { resolver } = createHarness({
      activeProviderId: 'anthropic',
      providerKeys: { moonshot: 'moon-key' },
      configValues: { 'provider.moonshot.baseUrl': 'https://custom.example/' },
    });
    const result = await resolver.resolve('moonshot');
    expect(result?.env.ANTHROPIC_BASE_URL).toBe('https://custom.example/');
    expect(result?.baseUrl).toBe('https://custom.example/');
  });

  it('third-party api-key throws CuratorAuthError when provider key missing', async () => {
    const { resolver } = createHarness({ activeProviderId: 'anthropic' });
    await expect(resolver.resolve('moonshot')).rejects.toBeInstanceOf(
      CuratorAuthError,
    );
  });

  it('proxy class calls ensureProxy and sets proxy url + placeholder token', async () => {
    const { resolver, ensureProxy } = createHarness({
      activeProviderId: 'anthropic',
      proxyUrl: 'http://127.0.0.1:60001',
    });
    const result = await resolver.resolve('github-copilot');
    expect(ensureProxy).toHaveBeenCalledWith('github-copilot');
    expect(result?.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:60001');
    expect(result?.env.ANTHROPIC_AUTH_TOKEN).toBe(
      COPILOT_PROXY_TOKEN_PLACEHOLDER,
    );
    expect(result?.baseUrl).toBe('http://127.0.0.1:60001');
  });

  it('proxy class throws CuratorAuthError when unauthenticated', async () => {
    const { resolver, ensureProxy } = createHarness({
      activeProviderId: 'anthropic',
      copilotAuthed: false,
    });
    await expect(resolver.resolve('github-copilot')).rejects.toBeInstanceOf(
      CuratorAuthError,
    );
    expect(ensureProxy).not.toHaveBeenCalled();
  });

  it('CLI provider yields an empty auth env (no base url / token)', async () => {
    const { resolver } = createHarness({ activeProviderId: 'anthropic' });
    const result = await resolver.resolve('claudeCli');
    expect(result).not.toBeNull();
    expect(result?.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(result?.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(result?.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });
});

describe('CuratorAuthResolver.buildCuratorEnv', () => {
  const ORIGINAL_ENV = process.env;

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('strips the three chat auth vars and preserves PATH', () => {
    process.env = {
      ...ORIGINAL_ENV,
      PATH: '/usr/local/bin:/usr/bin',
      ANTHROPIC_API_KEY: 'chat-key',
      ANTHROPIC_AUTH_TOKEN: 'chat-token',
      ANTHROPIC_BASE_URL: 'http://chat-proxy',
    };
    const { resolver } = createHarness({ activeProviderId: 'anthropic' });
    const env = resolver.buildCuratorEnv({
      ANTHROPIC_API_KEY: 'curator-key',
    }) as Record<string, string | undefined>;

    expect(env['PATH']).toBe('/usr/local/bin:/usr/bin');
    expect(env['ANTHROPIC_API_KEY']).toBe('curator-key');
    expect(env['ANTHROPIC_AUTH_TOKEN']).toBeUndefined();
    expect(env['ANTHROPIC_BASE_URL']).toBeUndefined();
  });

  it('leaves all three chat auth vars undefined for the CLI case', () => {
    process.env = {
      ...ORIGINAL_ENV,
      ANTHROPIC_API_KEY: 'chat-key',
      ANTHROPIC_AUTH_TOKEN: 'chat-token',
      ANTHROPIC_BASE_URL: 'http://chat-proxy',
    };
    const { resolver } = createHarness({ activeProviderId: 'anthropic' });
    const env = resolver.buildCuratorEnv({}) as Record<
      string,
      string | undefined
    >;
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(env['ANTHROPIC_AUTH_TOKEN']).toBeUndefined();
    expect(env['ANTHROPIC_BASE_URL']).toBeUndefined();
  });
});
