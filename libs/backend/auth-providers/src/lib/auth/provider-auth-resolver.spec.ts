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
  'resolveActiveProviderId' | 'getModelTiers'
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
  ensureProxy: jest.Mock;
  copilotAuthed: jest.Mock;
  copilotRestore: jest.Mock;
  /** Records the `(providerId, scope)` pairs the resolver read tiers for. */
  getModelTiers: jest.Mock;
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
  const providerModels: ProviderModelsSurface = {
    resolveActiveProviderId: jest.fn(() => opts.activeProviderId),
    getModelTiers,
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

  const resolver = new ProviderAuthResolver(
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
    getModelTiers,
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
