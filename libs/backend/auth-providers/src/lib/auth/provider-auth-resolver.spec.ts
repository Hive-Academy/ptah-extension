import 'reflect-metadata';

import type {
  Logger,
  ConfigManager,
  IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import {
  getAnthropicProvider,
  type ProviderTierScope,
} from '@ptah-extension/shared';
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

import { ProviderAuthResolver } from './provider-auth-resolver';
import { ProviderAuthError } from './provider-auth.error';
import { ProviderQuotaError } from './provider-quota.error';
import {
  ProviderQuotaStore,
  PROVIDER_QUOTA_DEFAULT_COOLDOWN_MS,
} from './provider-quota.store';
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
  'resolveActiveProviderId' | 'getModelTiers' | 'getLiveDerivedTiers'
>;

type TierMap = Partial<Record<'sonnet' | 'opus' | 'haiku', string>>;
type ProxyManagerSurface = Pick<
  CuratorProxyManager,
  'ensureProxy' | 'isProxyProvider'
>;

interface Harness {
  resolver: ProviderAuthResolver;
  authSecrets: MockAuthSecretsService;
  config: MockConfigManager;
  /** This harness's OWN quota store — never the process-wide singleton. */
  quota: ProviderQuotaStore;
  ensureProxy: jest.Mock;
  copilotAuthed: jest.Mock;
  copilotRestore: jest.Mock;
  /** Records the `(providerId, scope)` pairs the resolver read tiers for. */
  getModelTiers: jest.Mock;
  /** Records which providers the resolver asked for a live-catalogue derivation. */
  getLiveDerivedTiers: jest.Mock;
}

function createHarness(opts: {
  activeProviderId: string;
  credentials?: Record<string, string>;
  providerKeys?: Record<string, string>;
  configValues?: Record<string, unknown>;
  proxyUrl?: string;
  copilotAuthed?: boolean;
  /**
   * Persisted tier overrides, keyed by provider id then scope. A scope with
   * no entry reads back as all-nulls, which is what a lane sees before the
   * user has pinned anything.
   */
  tierOverrides?: Record<string, Partial<Record<ProviderTierScope, TierMap>>>;
  /**
   * What `ProviderModelsService.getLiveDerivedTiers` returns per provider — the
   * tiers that provider's OWN catalogue implies. Absent means `{}`, which is
   * what a provider with no catalogue on hand yields and what every case
   * written before TASK_2026_262 assumed.
   */
  derivedTiers?: Record<string, TierMap>;
  /**
   * Providers already cooling down from a 429 when the case starts, keyed by
   * registry id. The value is the raw `retry-after` header the upstream sent,
   * or `undefined` for the normal bare case.
   */
  rateLimited?: Record<string, string | undefined>;
}): Harness {
  const logger = createMockLogger();
  const config = createMockConfigManager({ values: opts.configValues ?? {} });
  const authSecrets = createMockAuthSecretsService({
    credentials: opts.credentials,
    providerKeys: opts.providerKeys,
  });

  const getModelTiers = jest.fn(
    (providerId: string, scope: ProviderTierScope) => {
      const overrides = opts.tierOverrides?.[providerId]?.[scope] ?? {};
      return {
        sonnet: overrides.sonnet ?? null,
        opus: overrides.opus ?? null,
        haiku: overrides.haiku ?? null,
      };
    },
  );
  const getLiveDerivedTiers = jest.fn(
    (providerId: string) => opts.derivedTiers?.[providerId] ?? {},
  );
  const providerModels: ProviderModelsSurface = {
    resolveActiveProviderId: jest.fn(() => opts.activeProviderId),
    getModelTiers,
    getLiveDerivedTiers,
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

  // A fresh store per harness. The production one is a module singleton and a
  // shared instance across cases would make the quota specs order-dependent.
  const quota = new ProviderQuotaStore();
  for (const [providerId, retryAfter] of Object.entries(
    opts.rateLimited ?? {},
  )) {
    quota.recordRateLimit(providerId, retryAfter);
  }

  const resolver = new ProviderAuthResolver(
    asLogger(logger),
    asConfig(config),
    authSecrets as unknown as IAuthSecretsService,
    providerModels as unknown as ProviderModelsService,
    proxyManager as unknown as CuratorProxyManager,
    copilotAuth,
    codexAuth,
    openRouterAuth,
    quota,
  );

  return {
    resolver,
    authSecrets,
    config,
    quota,
    ensureProxy,
    copilotAuthed,
    copilotRestore,
    getModelTiers,
    getLiveDerivedTiers,
  };
}

describe('ProviderAuthResolver.resolve', () => {
  it('returns null for an empty provider id (ride the active provider)', async () => {
    const { resolver } = createHarness({ activeProviderId: 'anthropic' });
    await expect(resolver.resolve('')).resolves.toBeNull();
  });

  it('returns null when the requested provider IS the active provider', async () => {
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

  it('api-key (Anthropic direct) throws ProviderAuthError when key missing', async () => {
    const { resolver } = createHarness({ activeProviderId: 'moonshot' });
    await expect(resolver.resolve('anthropic')).rejects.toBeInstanceOf(
      ProviderAuthError,
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
    expect(result?.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe(
      getAnthropicProvider('moonshot')?.defaultTiers?.sonnet,
    );
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

  it('third-party api-key throws ProviderAuthError when provider key missing', async () => {
    const { resolver } = createHarness({ activeProviderId: 'anthropic' });
    await expect(resolver.resolve('moonshot')).rejects.toBeInstanceOf(
      ProviderAuthError,
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

  it('proxy class throws ProviderAuthError when unauthenticated', async () => {
    const { resolver, ensureProxy } = createHarness({
      activeProviderId: 'anthropic',
      copilotAuthed: false,
    });
    await expect(resolver.resolve('github-copilot')).rejects.toBeInstanceOf(
      ProviderAuthError,
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

  /**
   * TASK_2026_172 Issue 1. `resolve()` routes off `resolveStrategy`, so the
   * claude-cli misroute reached the curator too: the provider fell into
   * `resolveLocalNative`, whose `getProviderBaseUrl('claude-cli')` returns the
   * entry's empty `baseUrl` — i.e. the curator ran with
   * `ANTHROPIC_BASE_URL: ''`, which overrides the ambient `~/.claude` login
   * rather than inheriting it. The `nativeAuth` route sends it to
   * `resolveCli()` instead, which is the empty-env path.
   */
  it("curator on the 'claude-cli' provider inherits the ambient login (empty auth env, no tier overrides)", async () => {
    const { resolver } = createHarness({ activeProviderId: 'moonshot' });
    const result = await resolver.resolve('claude-cli');

    expect(result).not.toBeNull();
    expect(result?.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(result?.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(result?.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(result?.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
    expect(result?.baseUrl).toBeUndefined();
  });

  it("curator on 'ollama' still gets the local base url — the claude-cli fix is scoped to nativeAuth", async () => {
    const { resolver } = createHarness({ activeProviderId: 'anthropic' });
    const result = await resolver.resolve('ollama');

    expect(result?.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:11434');
    expect(result?.baseUrl).toBe('http://127.0.0.1:11434');
  });
});

describe('ProviderAuthResolver.buildLaneEnv', () => {
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
    const env = resolver.buildLaneEnv({
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
    const env = resolver.buildLaneEnv({}) as Record<string, string | undefined>;
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(env['ANTHROPIC_AUTH_TOKEN']).toBeUndefined();
    expect(env['ANTHROPIC_BASE_URL']).toBeUndefined();
  });

  // ── The nine tier-METADATA vars (the other half of TASK_2026_159) ──────────
  //
  // 159 stripped the three `_MODEL` vars and left the nine `_NAME` /
  // `_DESCRIPTION` / `_SUPPORTED_CAPABILITIES` vars that
  // `ProviderModelsService.applyTierMetadata` writes for the CHAT provider.
  // `_SUPPORTED_CAPABILITIES` is an SDK ALLOWLIST, so leaving it in place let
  // the chat provider's capability list gate the curator provider's features.
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
  ] as const;

  /** Ambient env carrying a chat-provider value on every stripped key. */
  function chatAmbientEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...ORIGINAL_ENV,
      ANTHROPIC_API_KEY: 'chat-key',
      ANTHROPIC_AUTH_TOKEN: 'chat-token',
      ANTHROPIC_BASE_URL: 'http://chat-proxy',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'chat-opus',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'chat-sonnet',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'chat-haiku',
    };
    for (const key of TIER_METADATA_KEYS) env[key] = `chat-${key}`;
    return env;
  }

  it("strips the chat provider's nine tier-metadata vars", () => {
    process.env = chatAmbientEnv();
    const { resolver } = createHarness({ activeProviderId: 'ollama-cloud' });
    const env = resolver.buildLaneEnv({}) as Record<string, string | undefined>;

    for (const key of TIER_METADATA_KEYS) {
      expect([key, env[key]]).toEqual([key, undefined]);
    }
  });

  it("strips the chat provider's _SUPPORTED_CAPABILITIES allowlist", () => {
    process.env = chatAmbientEnv();
    const { resolver } = createHarness({ activeProviderId: 'ollama-cloud' });
    const env = resolver.buildLaneEnv({
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'curator-haiku',
    }) as Record<string, string | undefined>;

    // The curator's OWN tier value survives; the chat provider's allowlist for
    // that same tier does not ride along with it.
    expect(env['ANTHROPIC_DEFAULT_HAIKU_MODEL']).toBe('curator-haiku');
    expect(
      env['ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES'],
    ).toBeUndefined();
  });

  // ── The `undefined`-PRESENCE contract ─────────────────────────────────────
  //
  // The strip only survives `sdk-query-runner.service.ts`'s
  // `{ ...process.env, ...buildTierEnvDefaults(authEnv), ...authEnv }` because
  // every stripped key is an own enumerable property whose value is
  // `undefined`, and that last spread therefore blanks the ambient value. If a
  // future refactor drops undefined-valued keys from this return — a JSON
  // round-trip, `Object.fromEntries(...filter(Boolean))`, a Zod `.parse()`, a
  // `structuredClone` across IPC — the key vanishes from the spread and the
  // chat provider's `process.env` value survives untouched.
  //
  // `toBeUndefined()` CANNOT catch that: it passes for an absent key too.
  // These two tests use `hasOwnProperty` and the re-spread itself.
  describe('the undefined-presence contract', () => {
    it('keeps every stripped key PRESENT with an undefined value', () => {
      process.env = chatAmbientEnv();
      const { resolver } = createHarness({ activeProviderId: 'ollama-cloud' });
      const env = resolver.buildLaneEnv({}) as Record<
        string,
        string | undefined
      >;

      const stripped = [
        'ANTHROPIC_API_KEY',
        'ANTHROPIC_AUTH_TOKEN',
        'ANTHROPIC_BASE_URL',
        'ANTHROPIC_DEFAULT_OPUS_MODEL',
        'ANTHROPIC_DEFAULT_SONNET_MODEL',
        'ANTHROPIC_DEFAULT_HAIKU_MODEL',
        ...TIER_METADATA_KEYS,
      ];

      for (const key of stripped) {
        expect([
          key,
          Object.prototype.hasOwnProperty.call(env, key),
          env[key],
        ]).toEqual([key, true, undefined]);
      }
    });

    it('survives a later re-spread of ambient process.env', () => {
      process.env = chatAmbientEnv();
      const { resolver } = createHarness({ activeProviderId: 'ollama-cloud' });
      const curatorEnv = resolver.buildLaneEnv({}) as Record<
        string,
        string | undefined
      >;

      // Exactly the shape `sdk-query-runner.service.ts` builds: the FULL
      // ambient env re-spread first, the curator env last.
      const subprocessEnv: Record<string, string | undefined> = {
        ...process.env,
        ...curatorEnv,
      };

      expect(subprocessEnv['ANTHROPIC_API_KEY']).toBeUndefined();
      expect(subprocessEnv['ANTHROPIC_AUTH_TOKEN']).toBeUndefined();
      for (const key of TIER_METADATA_KEYS) {
        expect([key, subprocessEnv[key]]).toEqual([key, undefined]);
      }
    });

    it('a filtered copy does NOT survive it — this is what the contract guards', () => {
      process.env = chatAmbientEnv();
      const { resolver } = createHarness({ activeProviderId: 'ollama-cloud' });
      const curatorEnv = resolver.buildLaneEnv({}) as Record<
        string,
        string | undefined
      >;

      // The refactor the comment at `buildLaneEnv` warns about, applied
      // here so the failure mode is demonstrated rather than only described.
      const filtered = Object.fromEntries(
        Object.entries(curatorEnv).filter(([, value]) => value !== undefined),
      );
      const subprocessEnv: Record<string, string | undefined> = {
        ...process.env,
        ...filtered,
      };

      expect(subprocessEnv['ANTHROPIC_API_KEY']).toBe('chat-key');
      expect(
        subprocessEnv['ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES'],
      ).toBe('chat-ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES');
    });
  });
});

describe('ProviderAuthResolver — curator tier mapping (TASK_2026_159)', () => {
  const ORIGINAL_ENV = process.env;

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("prefers the user's persisted haiku override over the provider entry default", async () => {
    const { resolver } = createHarness({
      activeProviderId: 'anthropic',
      providerKeys: { moonshot: 'moon-key' },
      tierOverrides: {
        moonshot: { mainAgent: { haiku: 'kimi-k2-turbo-preview' } },
      },
    });
    const result = await resolver.resolve('moonshot');

    expect(result?.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe(
      'kimi-k2-turbo-preview',
    );
    expect(result?.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).not.toBe(
      getAnthropicProvider('moonshot')?.defaultTiers?.haiku,
    );
  });

  it('still falls back to the provider entry default for tiers the user has not overridden', async () => {
    const { resolver } = createHarness({
      activeProviderId: 'anthropic',
      providerKeys: { moonshot: 'moon-key' },
      tierOverrides: {
        moonshot: { mainAgent: { haiku: 'kimi-k2-turbo-preview' } },
      },
    });
    const result = await resolver.resolve('moonshot');

    expect(result?.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe(
      getAnthropicProvider('moonshot')?.defaultTiers?.sonnet,
    );
  });

  it("does not leak the CHAT provider's haiku mapping into a curator on a provider that has none", async () => {
    process.env = {
      ...ORIGINAL_ENV,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'ministral-3:cloud',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'kimi-k2.5:cloud',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v3.2:cloud',
    };
    expect(getAnthropicProvider('lm-studio')?.defaultTiers).toBeUndefined();

    const { resolver } = createHarness({ activeProviderId: 'ollama-cloud' });
    const result = await resolver.resolve('lm-studio');

    expect(result?.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
    expect(result?.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
    expect(result?.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
  });

  it('gives a tier-less provider a haiku mapping once the user overrides it', async () => {
    const { resolver } = createHarness({
      activeProviderId: 'ollama-cloud',
      tierOverrides: { 'lm-studio': { mainAgent: { haiku: 'qwen3-4b' } } },
    });
    const result = await resolver.resolve('lm-studio');

    expect(result?.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('qwen3-4b');
  });
});

/**
 * TASK_2026_180 B1.3. The port widened by one OPTIONAL `scope` parameter so
 * background lanes can read their own persisted tier mapping without a second
 * resolver and without the pre-existing curator call site changing at all.
 */
describe('ProviderAuthResolver — tier scope (TASK_2026_180)', () => {
  const ORIGINAL_ENV = process.env;

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("defaults to the 'mainAgent' scope when the caller passes none", async () => {
    const { resolver, getModelTiers } = createHarness({
      activeProviderId: 'anthropic',
      providerKeys: { moonshot: 'moon-key' },
    });

    await resolver.resolve('moonshot');

    expect(getModelTiers).toHaveBeenCalledWith('moonshot', 'mainAgent');
  });

  it("forwards an explicit 'lane' scope to the tier lookup", async () => {
    const { resolver, getModelTiers } = createHarness({
      activeProviderId: 'anthropic',
      providerKeys: { moonshot: 'moon-key' },
    });

    await resolver.resolve('moonshot', 'lane');

    expect(getModelTiers).toHaveBeenCalledWith('moonshot', 'lane');
    expect(getModelTiers).not.toHaveBeenCalledWith('moonshot', 'mainAgent');
  });

  it("reads the lane mapping, not the user's mainAgent remap", async () => {
    const { resolver } = createHarness({
      activeProviderId: 'anthropic',
      providerKeys: { moonshot: 'moon-key' },
      tierOverrides: {
        moonshot: {
          mainAgent: { haiku: 'foreground-haiku' },
          lane: { haiku: 'background-haiku' },
        },
      },
    });

    const result = await resolver.resolve('moonshot', 'lane');

    expect(result?.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('background-haiku');
  });

  /**
   * The "haiku tier of the selected provider" semantics, with no hardcoded
   * model id: an install that has never touched the lane pickers persists
   * nothing on the lane scope, so every tier falls through to the provider
   * entry's own `defaultTiers`.
   */
  it("falls back to the provider entry's defaultTiers when the lane scope is empty", async () => {
    const { resolver } = createHarness({
      activeProviderId: 'anthropic',
      providerKeys: { moonshot: 'moon-key' },
      tierOverrides: { moonshot: { mainAgent: { haiku: 'foreground-haiku' } } },
    });

    const result = await resolver.resolve('moonshot', 'lane');
    const defaults = getAnthropicProvider('moonshot')?.defaultTiers;

    expect(result?.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe(defaults?.haiku);
    expect(result?.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe(defaults?.sonnet);
    expect(result?.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).not.toBe(
      'foreground-haiku',
    );
  });

  /**
   * Risk R7. `getActiveProviderId` matches registry entries by hostname
   * SUBSTRING of `ANTHROPIC_BASE_URL`, ignoring port, so a local-proxy lane can
   * be identified as another provider entirely. Fixing that matcher is a
   * tracked follow-up; the mitigation carried here is that a lane always
   * leaves with explicit `ANTHROPIC_DEFAULT_*_MODEL` values, so downstream tier
   * resolution never has to consult the match at all.
   */
  it('leaves a proxy-class lane with explicit tier model values (R7 mitigation)', async () => {
    const { resolver } = createHarness({
      activeProviderId: 'anthropic',
      proxyUrl: 'http://127.0.0.1:60001',
      tierOverrides: {
        'github-copilot': {
          lane: { haiku: 'lane-haiku', sonnet: 'lane-sonnet' },
        },
      },
    });

    const result = await resolver.resolve('github-copilot', 'lane');

    expect(result?.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:60001');
    expect(result?.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('lane-haiku');
    expect(result?.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('lane-sonnet');
  });

  /**
   * Risk R2, asserted end-to-end through `resolve` rather than only on
   * `buildLaneEnv`: the strip that keeps the user's foreground credentials out
   * of a background lane is carried by keys that are PRESENT with the value
   * `undefined`. `toBeUndefined()` alone passes for an absent key too, which is
   * exactly the regression this guards.
   */
  it('returns the unused chat auth keys PRESENT-with-undefined on a lane resolve', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      ANTHROPIC_API_KEY: 'foreground-key',
      ANTHROPIC_AUTH_TOKEN: 'foreground-token',
      ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES: 'foreground-caps',
    };
    const { resolver } = createHarness({
      activeProviderId: 'anthropic',
      providerKeys: { moonshot: 'moon-key' },
    });

    const result = await resolver.resolve('moonshot', 'lane');
    const env = result?.env as Record<string, string | undefined>;

    // Keys the lane itself supplies carry the LANE's value, never the
    // foreground one.
    expect(env['ANTHROPIC_AUTH_TOKEN']).toBe('moon-key');

    // Every key the lane does not supply is blanked by presence, not absence.
    for (const key of [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
    ]) {
      expect([
        key,
        Object.prototype.hasOwnProperty.call(env, key),
        env[key],
      ]).toEqual([key, true, undefined]);
    }
  });

  /** A lane builds a snapshot. It never repoints the live chat session. */
  it('does not mutate process.env while resolving a lane', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      ANTHROPIC_API_KEY: 'foreground-key',
      ANTHROPIC_BASE_URL: 'https://foreground.example',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'foreground-haiku',
    };
    const before = { ...process.env };
    const { resolver } = createHarness({
      activeProviderId: 'anthropic',
      providerKeys: { moonshot: 'moon-key' },
      tierOverrides: { moonshot: { lane: { haiku: 'lane-haiku' } } },
    });

    await resolver.resolve('moonshot', 'lane');

    expect({ ...process.env }).toEqual(before);
  });
});

/**
 * TASK_2026_262 Batch 2, task 2.2 — the link the chat-path fix could NOT reach.
 *
 * Batch 1 closed the foreground gap by giving `applyPersistedTiers` a third
 * precedence link and writing the result into the global `authEnv` +
 * `process.env`. `buildLaneEnv` blanks every one of `ALL_TIER_ENV_KEYS` out of
 * the ambient env on purpose, so that fix arrives here only to be deleted — a
 * background lane pinned to a provider with no `defaultTiers` still had no tier
 * mapping at all, and `SdkQueryRunner` resolves the lane's model against THIS
 * env (`sdk-query-runner.service.ts:292-295`). These lock in that the resolved
 * provider's own catalogue now supplies it, without weakening the strip.
 */
describe('ProviderAuthResolver — live-catalogue tiers for a lane (TASK_2026_262)', () => {
  const ORIGINAL_ENV = process.env;

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  /** The case lanes exist for: background work moved off the paid quota. */
  it('gives a lane on a no-defaultTiers provider a tier mapping from that provider’s own catalogue', async () => {
    expect(getAnthropicProvider('lm-studio')?.defaultTiers).toBeUndefined();

    const { resolver } = createHarness({
      activeProviderId: 'anthropic',
      derivedTiers: {
        'lm-studio': {
          opus: 'qwen3-coder-30b',
          sonnet: 'qwen3-coder-30b',
          haiku: 'gemma-3-12b',
        },
      },
    });

    const result = await resolver.resolve('lm-studio', 'lane');

    // `resolveLaneModel` returns the bare alias for a lane that names a
    // provider; this is the value that alias now resolves through.
    expect(result?.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('gemma-3-12b');
    expect(result?.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('qwen3-coder-30b');
  });

  it('lets the lane-scoped user override outrank the catalogue, and the registry map outrank it too', async () => {
    // Same precedence as the chat path and the profile resolver:
    // user tier > registry defaultTiers > live catalogue. One order, three
    // writers.
    const { resolver } = createHarness({
      activeProviderId: 'anthropic',
      providerKeys: { moonshot: 'moon-key' },
      tierOverrides: { moonshot: { lane: { haiku: 'lane-haiku' } } },
      derivedTiers: {
        moonshot: { haiku: 'catalogue-haiku', sonnet: 'catalogue-sonnet' },
      },
    });

    const result = await resolver.resolve('moonshot', 'lane');

    expect(result?.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('lane-haiku');
    expect(result?.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe(
      getAnthropicProvider('moonshot')?.defaultTiers?.sonnet,
    );
  });

  it('never reaches for a catalogue when the static data already covers every tier', async () => {
    // Bounded work, and the reason the derivation is consulted lazily: moonshot
    // declares all three tiers, so there is no hole to fill.
    const { resolver, getLiveDerivedTiers } = createHarness({
      activeProviderId: 'anthropic',
      providerKeys: { moonshot: 'moon-key' },
    });

    await resolver.resolve('moonshot', 'lane');

    expect(getLiveDerivedTiers).not.toHaveBeenCalled();
  });

  it('still leaves the tier absent when the provider has no catalogue either', async () => {
    // `{}` is a complete answer. The pre-262 behaviour is exactly what an
    // unreadable catalogue degrades to — never a fabricated id.
    const { resolver } = createHarness({ activeProviderId: 'anthropic' });

    const result = await resolver.resolve('lm-studio', 'lane');

    expect(result?.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
  });

  it('derives from the RESOLVED provider, never the active chat one', async () => {
    // The whole point of the strip. If this ever reads the chat provider's
    // catalogue, a lane pinned to LM Studio gets OpenRouter's model ids.
    const { resolver, getLiveDerivedTiers } = createHarness({
      activeProviderId: 'openrouter',
      derivedTiers: {
        openrouter: { haiku: 'anthropic/claude-haiku-4.5' },
        'lm-studio': { haiku: 'gemma-3-12b' },
      },
    });

    const result = await resolver.resolve('lm-studio', 'lane');

    expect(result?.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('gemma-3-12b');
    expect(getLiveDerivedTiers).toHaveBeenCalledWith('lm-studio');
    expect(getLiveDerivedTiers).not.toHaveBeenCalledWith('openrouter');
  });
});

/**
 * The quota gate (TASK_2026_306 defect B).
 *
 * The load-bearing case is the FIRST one. `resolve()` answers `null` early for
 * an empty provider id and for a requested id that IS the active provider, and
 * background lanes hit both: every lane ships `provider: ''`, and the run that
 * produced this task had the exhausted subscription as the active provider. A
 * gate below those returns compiles, reads correctly, and does nothing at all
 * on the only path that mattered.
 */
describe('ProviderAuthResolver.resolve — the quota gate', () => {
  it('gates an INHERITING caller when the ACTIVE provider is cooling down (R1)', async () => {
    // `provider: ''` + an exhausted active provider. If this passes with the
    // check placed below the early returns, the check is not being reached.
    const { resolver } = createHarness({
      activeProviderId: 'openai-codex',
      rateLimited: { 'openai-codex': undefined },
    });

    await expect(resolver.resolve('')).rejects.toBeInstanceOf(
      ProviderQuotaError,
    );
  });

  it('gates a caller that NAMES the active provider while it is cooling down', async () => {
    // The second early return. Same reasoning: "you are already on it" is not
    // an answer when "it" is rate-limited.
    const { resolver } = createHarness({
      activeProviderId: 'openai-codex',
      rateLimited: { 'openai-codex': undefined },
    });

    await expect(resolver.resolve('openai-codex')).rejects.toBeInstanceOf(
      ProviderQuotaError,
    );
  });

  it('gates a NON-active provider the caller asked for by id', async () => {
    const { resolver } = createHarness({
      activeProviderId: 'anthropic',
      rateLimited: { 'lm-studio': undefined },
    });

    await expect(resolver.resolve('lm-studio', 'lane')).rejects.toBeInstanceOf(
      ProviderQuotaError,
    );
  });

  it('throws rather than returning null — a null would ride the exhausted quota', async () => {
    // This is the distinction the whole defect turns on: `null` means "usable,
    // inherit", and inheriting an exhausted provider is the failure.
    const { resolver } = createHarness({
      activeProviderId: 'openai-codex',
      rateLimited: { 'openai-codex': undefined },
    });

    const error = await resolver.resolve('').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderQuotaError);
    expect((error as ProviderQuotaError).name).toBe('ProviderQuotaError');
    expect((error as ProviderQuotaError).providerId).toBe('openai-codex');
    expect((error as ProviderQuotaError).retryAfterMs).toBeGreaterThan(0);
    expect((error as ProviderQuotaError).retryAfterMs).toBeLessThanOrEqual(
      PROVIDER_QUOTA_DEFAULT_COOLDOWN_MS,
    );
  });

  it('carries the upstream retry-after when one arrived, not the default', async () => {
    const { resolver } = createHarness({
      activeProviderId: 'openai-codex',
      rateLimited: { 'openai-codex': '90' },
    });

    const error = (await resolver
      .resolve('')
      .catch((e: unknown) => e)) as ProviderQuotaError;
    expect(error.retryAfterMs).toBeGreaterThan(80_000);
    expect(error.retryAfterMs).toBeLessThanOrEqual(90_000);
  });

  it('names no provider in the message — the id travels on the error', async () => {
    // The reason string is written verbatim to `skill_synthesis_queue.reason`
    // and read by a user. It must be short, honest, and must not say "timed
    // out" — that is the misclassification this whole task removes.
    const { resolver } = createHarness({
      activeProviderId: 'openai-codex',
      rateLimited: { 'openai-codex': undefined },
    });

    const error = (await resolver
      .resolve('')
      .catch((e: unknown) => e)) as ProviderQuotaError;
    expect(error.message).not.toMatch(/timed out/i);
    expect(error.message).not.toContain('openai-codex');
    expect(error.message).toMatch(/quota/i);
  });

  it('lets a DIFFERENT provider through while one is cooling down', async () => {
    // The gate is per provider. Gating everything would take out background
    // work on providers that are perfectly healthy.
    const { resolver } = createHarness({
      activeProviderId: 'anthropic',
      providerKeys: { moonshot: 'moon-key' },
      rateLimited: { 'lm-studio': undefined },
    });

    await expect(resolver.resolve('moonshot', 'lane')).resolves.not.toBeNull();
  });

  it('re-opens once the cooldown expires', async () => {
    const { resolver, quota } = createHarness({
      activeProviderId: 'openai-codex',
      rateLimited: { 'openai-codex': undefined },
    });
    await expect(resolver.resolve('')).rejects.toBeInstanceOf(
      ProviderQuotaError,
    );

    jest
      .spyOn(Date, 'now')
      .mockReturnValue(Date.now() + PROVIDER_QUOTA_DEFAULT_COOLDOWN_MS + 1_000);
    try {
      expect(quota.retryAfterMs('openai-codex')).toBe(0);
      await expect(resolver.resolve('')).resolves.toBeNull();
    } finally {
      jest.spyOn(Date, 'now').mockRestore();
    }
  });

  it('re-opens immediately once the provider answers again', async () => {
    const { resolver, quota } = createHarness({
      activeProviderId: 'openai-codex',
      rateLimited: { 'openai-codex': undefined },
    });
    await expect(resolver.resolve('')).rejects.toBeInstanceOf(
      ProviderQuotaError,
    );

    quota.recordSuccess('openai-codex');

    await expect(resolver.resolve('')).resolves.toBeNull();
  });

  it('is inert when nothing is cooling down', async () => {
    const { resolver } = createHarness({ activeProviderId: 'openai-codex' });
    await expect(resolver.resolve('')).resolves.toBeNull();
    await expect(resolver.resolve('openai-codex')).resolves.toBeNull();
  });
});
