/**
 * AuthManager — unit specs.
 *
 * The AuthManager is a thin orchestrator: it does NOT contain auth logic.
 * Tests here focus on the orchestration contract documented in the source
 * header:
 *   1. Concurrency guard — one configure call in flight at a time.
 *   2. Clean-slate wipe of auth env vars before every reconfiguration.
 *   3. Strategy selection via resolveStrategy(legacyMethod, provider).
 *   4. Delegation to the resolved strategy's configure() method.
 *   5. Active-strategy tracking for later teardown.
 *   6. Legacy method normalization ('openrouter' → 'thirdParty').
 *
 * No DI container is used — each IAuthStrategy is injected as a jest.Mocked
 * stub via the constructor, matching the pattern in
 * `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.spec.ts`
 * and the typed-mock style in
 * `libs/backend/agent-sdk/src/lib/copilot-provider/copilot-auth.service.spec.ts`.
 *
 * Source-under-test:
 *   `libs/backend/agent-sdk/src/lib/helpers/auth-manager.ts`
 */

import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type {
  AuthEnv,
  ProviderAmbientClaudeStatus,
} from '@ptah-extension/shared';
import type { WorkspaceScopeResolver } from '@ptah-extension/settings-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { SdkError } from '@ptah-extension/agent-sdk';
import { AuthManager } from './auth-manager';
import { ActiveProviderResolver } from './active-provider-resolver';
import type {
  AuthOperationContext,
  IAuthStrategy,
  AuthConfigureContext,
  AuthConfigureResult,
} from '../auth/auth-strategy.types';
import type { ProviderModelsService } from '../provider-models.service';

// ---------------------------------------------------------------------------
// Typed mock helpers
// ---------------------------------------------------------------------------

/**
 * `WorkspaceScopeResolver` is the single source AuthManager reads
 * `anthropicProviderId` from. Only `read` is exercised here; the stub returns
 * whatever provider id the test seeds (undefined → AuthManager falls back to
 * DEFAULT_PROVIDER_ID).
 */
type MockScopeResolver = {
  read: jest.Mock<unknown, [string]>;
};

function createMockScopeResolver(
  values: Record<string, unknown> = {},
): MockScopeResolver {
  return {
    read: jest.fn((key: string) => values[key]),
  };
}

function asResolver(mock: MockScopeResolver): WorkspaceScopeResolver {
  return mock as unknown as WorkspaceScopeResolver;
}

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

/** jest.Mocked<IAuthStrategy> factory with a configurable name. */
function createMockStrategy(name: string): jest.Mocked<IAuthStrategy> {
  return {
    name,
    configure: jest.fn<Promise<AuthConfigureResult>, [AuthConfigureContext]>(),
    teardown: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
  };
}

/**
 * Build a ProviderModelsService stub that only exposes `clearAllTierEnvVars`
 * — the single method AuthManager invokes on it. A full jest.Mocked of the
 * real class is unnecessary and noisy; this keeps the spec honest about what
 * it actually depends on.
 */
function createMockProviderModels(): jest.Mocked<
  Pick<ProviderModelsService, 'clearAllTierEnvVars'>
> {
  return {
    clearAllTierEnvVars: jest.fn<void, []>(),
  };
}

interface ManagerHarness {
  manager: AuthManager;
  /** The stored credential lookup (`authSecrets.getCredential`). */
  getCredential: jest.Mock<Promise<string | undefined>, [string]>;
  /** The ambient Claude CLI login read. */
  ambientRead: jest.Mock<Promise<ProviderAmbientClaudeStatus>, []>;
  logger: MockLogger;
  scopeResolver: MockScopeResolver;
  providerModels: jest.Mocked<
    Pick<ProviderModelsService, 'clearAllTierEnvVars'>
  >;
  authEnv: AuthEnv;
  strategies: {
    apiKey: jest.Mocked<IAuthStrategy>;
    oauthProxy: jest.Mocked<IAuthStrategy>;
    localNative: jest.Mocked<IAuthStrategy>;
    localProxy: jest.Mocked<IAuthStrategy>;
    cli: jest.Mocked<IAuthStrategy>;
  };
}

function makeManager(
  options: {
    config?: Record<string, unknown>;
    /** The Anthropic API key in SecretStorage. */
    storedApiKey?: string;
    /** What the ambient Claude CLI login reader answers (default signed-out). */
    ambientState?: 'connected' | 'signed-out';
  } = {},
): ManagerHarness {
  const logger = createMockLogger();
  const scopeResolver = createMockScopeResolver(options.config);
  const providerModels = createMockProviderModels();
  const authEnv: AuthEnv = {};

  const strategies = {
    apiKey: createMockStrategy('ApiKeyStrategy'),
    oauthProxy: createMockStrategy('OAuthProxyStrategy'),
    localNative: createMockStrategy('LocalNativeStrategy'),
    localProxy: createMockStrategy('LocalProxyStrategy'),
    cli: createMockStrategy('CliStrategy'),
  };

  const activeProviderResolver = new ActiveProviderResolver(
    asResolver(scopeResolver),
  );

  const getCredential = jest.fn(async (type: string) =>
    type === 'apiKey' ? options.storedApiKey : undefined,
  );
  const ambientRead = jest.fn(
    async (): Promise<ProviderAmbientClaudeStatus> => ({
      state: options.ambientState ?? 'signed-out',
      checkedAt: '2026-10-29T00:00:00.000Z',
    }),
  );

  const manager = new AuthManager(
    asLogger(logger),
    providerModels as unknown as ProviderModelsService,
    authEnv,
    strategies.apiKey,
    strategies.oauthProxy,
    strategies.localNative,
    strategies.localProxy,
    strategies.cli,
    activeProviderResolver,
    { getCredential },
    { read: ambientRead },
  );

  return {
    manager,
    getCredential,
    ambientRead,
    logger,
    scopeResolver,
    providerModels,
    authEnv,
    strategies,
  };
}

/** Resolve with a delay so two concurrent calls can be observed overlapping. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('AuthManager', () => {
  // Preserve and restore process.env — clean-slate tests mutate it directly.
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_AUTH_TOKEN',
    ]) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    // Restore env in case any test leaked a key.
    for (const key of [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_AUTH_TOKEN',
    ]) {
      delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Strategy selection
  // -------------------------------------------------------------------------

  describe('configured identity', () => {
    it('reports the provider of the last successful configuration, and null after a failed one or a clear', async () => {
      const { manager, strategies } = makeManager();
      expect(manager.getConfiguredAuth()).toBeNull();

      strategies.apiKey.configure.mockResolvedValueOnce({
        configured: true,
        details: [],
      });
      await manager.configureAuthentication('apiKey');
      expect(manager.getConfiguredAuth()).toEqual({
        authMethod: 'apiKey',
        providerId: 'anthropic',
      });

      strategies.cli.configure.mockResolvedValueOnce({
        configured: false,
        details: [],
        errorMessage: 'not logged in',
      });
      await manager.configureAuthentication('claudeCli');
      expect(manager.getConfiguredAuth()).toBeNull();

      strategies.apiKey.configure.mockResolvedValueOnce({
        configured: true,
        details: [],
      });
      await manager.configureAuthentication('apiKey');
      manager.clearAuthentication();
      expect(manager.getConfiguredAuth()).toBeNull();
    });
  });

  describe('strategy selection', () => {
    it("routes 'apiKey' to the api-key strategy with anthropic provider id", async () => {
      const { manager, strategies } = makeManager();
      strategies.apiKey.configure.mockResolvedValueOnce({
        configured: true,
        details: ['API key from SecretStorage'],
      });

      await manager.configureAuthentication('apiKey');

      expect(strategies.apiKey.configure).toHaveBeenCalledTimes(1);
      const ctx = strategies.apiKey.configure.mock.calls[0][0];
      expect(ctx.providerId).toBe('anthropic');
      expect(ctx.authEnv).toBeDefined();
      // All other strategies sit idle.
      expect(strategies.oauthProxy.configure).not.toHaveBeenCalled();
      expect(strategies.cli.configure).not.toHaveBeenCalled();
      expect(strategies.localNative.configure).not.toHaveBeenCalled();
      expect(strategies.localProxy.configure).not.toHaveBeenCalled();
    });

    it("routes 'claudeCli' to the cli strategy with anthropic provider id", async () => {
      const { manager, strategies } = makeManager();
      strategies.cli.configure.mockResolvedValueOnce({
        configured: true,
        details: ['Claude CLI v1.0.0'],
      });

      await manager.configureAuthentication('claudeCli');

      expect(strategies.cli.configure).toHaveBeenCalledTimes(1);
      expect(strategies.cli.configure.mock.calls[0][0].providerId).toBe(
        'anthropic',
      );
      expect(strategies.apiKey.configure).not.toHaveBeenCalled();
    });

    it("routes 'thirdParty' with configured openrouter provider to api-key strategy", async () => {
      // OpenRouter is registered in ANTHROPIC_PROVIDERS; resolveStrategy
      // returns 'api-key' for it (authType=apiKey + requiresProxy:true falls
      // through to the api-key route; ApiKeyStrategy runs the proxy internally).
      const { manager, strategies } = makeManager({
        config: { anthropicProviderId: 'openrouter' },
      });
      strategies.apiKey.configure.mockResolvedValueOnce({
        configured: true,
        details: ['OpenRouter API key'],
      });

      await manager.configureAuthentication('thirdParty');

      expect(strategies.apiKey.configure).toHaveBeenCalledTimes(1);
      expect(strategies.apiKey.configure.mock.calls[0][0].providerId).toBe(
        'openrouter',
      );
    });

    it("routes 'thirdParty' with configured sakana provider to api-key strategy", async () => {
      // Sakana is apiKey + requiresProxy:true; resolveStrategy still returns
      // 'api-key' (the fallback covers apiKey+proxy) — the ApiKeyStrategy
      // starts the translation proxy internally, no separate route needed.
      const { manager, strategies } = makeManager({
        config: { anthropicProviderId: 'sakana' },
      });
      strategies.apiKey.configure.mockResolvedValueOnce({
        configured: true,
        details: ['Sakana (Fugu) API key'],
      });

      await manager.configureAuthentication('thirdParty');

      expect(strategies.apiKey.configure).toHaveBeenCalledTimes(1);
      expect(strategies.apiKey.configure.mock.calls[0][0].providerId).toBe(
        'sakana',
      );
      // Proxy strategies must NOT be engaged for Sakana — it routes api-key.
      expect(strategies.oauthProxy.configure).not.toHaveBeenCalled();
      expect(strategies.localProxy.configure).not.toHaveBeenCalled();
    });

    /**
     * TASK_2026_172 Issue 1 — the Claude Subscription tile.
     *
     * The tile persists `authMethod: 'thirdParty'` + `anthropicProviderId:
     * 'claude-cli'`. Its registry entry is `authType: 'none'` with no proxy,
     * which is byte-identical to Ollama's — so before the `nativeAuth`
     * short-circuit it landed on LocalNativeStrategy, which probes an Ollama
     * daemon on 127.0.0.1:11434 and then overwrites `ANTHROPIC_BASE_URL` with
     * `''` plus an Ollama placeholder token, destroying the ambient `~/.claude`
     * login the tile exists to use.
     */
    it("routes 'thirdParty' + claude-cli to the CLI strategy — never local-native", async () => {
      const { manager, strategies } = makeManager({
        config: { anthropicProviderId: 'claude-cli' },
      });
      strategies.cli.configure.mockResolvedValueOnce({
        configured: true,
        details: ['Claude CLI v2.0.0 (credentials managed by CLI)'],
      });

      await manager.configureAuthentication('thirdParty');

      expect(strategies.cli.configure).toHaveBeenCalledTimes(1);
      expect(strategies.cli.configure.mock.calls[0][0].providerId).toBe(
        'claude-cli',
      );
      // The regression: no Ollama probe, no proxy, no API key lookup.
      expect(strategies.localNative.configure).not.toHaveBeenCalled();
      expect(strategies.localProxy.configure).not.toHaveBeenCalled();
      expect(strategies.oauthProxy.configure).not.toHaveBeenCalled();
      expect(strategies.apiKey.configure).not.toHaveBeenCalled();
    });

    it('leaves ANTHROPIC_BASE_URL and the auth token untouched for the claude-cli tile', async () => {
      const { manager, strategies, authEnv } = makeManager({
        config: { anthropicProviderId: 'claude-cli' },
      });
      // CliStrategy writes nothing to authEnv — assert the orchestrator does
      // not inject anything either, so the SDK keeps its default credential
      // chain (`~/.claude`).
      strategies.cli.configure.mockImplementationOnce(async () => ({
        configured: true,
        details: [],
      }));

      await manager.configureAuthentication('thirdParty');

      expect(authEnv.ANTHROPIC_BASE_URL).toBeUndefined();
      expect(authEnv.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      expect(authEnv.ANTHROPIC_API_KEY).toBeUndefined();
      expect(process.env['ANTHROPIC_BASE_URL']).toBeUndefined();
      expect(process.env['ANTHROPIC_AUTH_TOKEN']).toBeUndefined();
    });

    it("routes 'thirdParty' + ollama to local-native — the claude-cli fix must not move local providers", async () => {
      const { manager, strategies } = makeManager({
        config: { anthropicProviderId: 'ollama' },
      });
      strategies.localNative.configure.mockResolvedValueOnce({
        configured: true,
        details: ['Ollama (Anthropic-native at http://127.0.0.1:11434)'],
      });

      await manager.configureAuthentication('thirdParty');

      expect(strategies.localNative.configure).toHaveBeenCalledTimes(1);
      expect(strategies.localNative.configure.mock.calls[0][0].providerId).toBe(
        'ollama',
      );
      expect(strategies.cli.configure).not.toHaveBeenCalled();
    });

    it("routes 'thirdParty' + ollama-cloud to local-native (keyless signin path preserved)", async () => {
      const { manager, strategies } = makeManager({
        config: { anthropicProviderId: 'ollama-cloud' },
      });
      strategies.localNative.configure.mockResolvedValueOnce({
        configured: true,
        details: ['Ollama Cloud'],
      });

      await manager.configureAuthentication('thirdParty');

      expect(strategies.localNative.configure.mock.calls[0][0].providerId).toBe(
        'ollama-cloud',
      );
      expect(strategies.cli.configure).not.toHaveBeenCalled();
    });

    it("routes 'thirdParty' + lm-studio to local-proxy", async () => {
      const { manager, strategies } = makeManager({
        config: { anthropicProviderId: 'lm-studio' },
      });
      strategies.localProxy.configure.mockResolvedValueOnce({
        configured: true,
        details: ['LM Studio via translation proxy'],
      });

      await manager.configureAuthentication('thirdParty');

      expect(strategies.localProxy.configure.mock.calls[0][0].providerId).toBe(
        'lm-studio',
      );
      expect(strategies.cli.configure).not.toHaveBeenCalled();
    });

    it.each(['github-copilot', 'openai-codex', 'kimi-code'])(
      "routes 'thirdParty' + %s to oauth-proxy",
      async (providerId) => {
        const { manager, strategies } = makeManager({
          config: { anthropicProviderId: providerId },
        });
        strategies.oauthProxy.configure.mockResolvedValueOnce({
          configured: true,
          details: [],
        });

        await manager.configureAuthentication('thirdParty');

        expect(
          strategies.oauthProxy.configure.mock.calls[0][0].providerId,
        ).toBe(providerId);
        expect(strategies.cli.configure).not.toHaveBeenCalled();
      },
    );

    it.each(['z-ai', 'requesty'])(
      "routes 'thirdParty' + %s to api-key",
      async (providerId) => {
        const { manager, strategies } = makeManager({
          config: { anthropicProviderId: providerId },
        });
        strategies.apiKey.configure.mockResolvedValueOnce({
          configured: true,
          details: [],
        });

        await manager.configureAuthentication('thirdParty');

        expect(strategies.apiKey.configure.mock.calls[0][0].providerId).toBe(
          providerId,
        );
        expect(strategies.cli.configure).not.toHaveBeenCalled();
      },
    );

    it("defaults to the registry default provider when 'thirdParty' has no configured id", async () => {
      const { manager, strategies, scopeResolver } = makeManager();
      strategies.apiKey.configure.mockResolvedValueOnce({
        configured: true,
        details: [],
      });

      await manager.configureAuthentication('thirdParty');

      // DEFAULT_PROVIDER_ID is 'openrouter' in the registry.
      expect(strategies.apiKey.configure).toHaveBeenCalledTimes(1);
      expect(strategies.apiKey.configure.mock.calls[0][0].providerId).toBe(
        'openrouter',
      );
      // Lookup went through the workspace scope resolver, not ConfigManager.
      expect(scopeResolver.read).toHaveBeenCalledWith(
        'anthropicProviderId',
        true,
      );
    });

    it('resolves the folder-scoped provider id from the workspace scope resolver', async () => {
      // The resolver returns the active folder's override; AuthManager must
      // route 'thirdParty' to that provider, not the global default.
      const { manager, strategies, scopeResolver } = makeManager({
        config: { anthropicProviderId: 'openrouter' },
      });
      strategies.apiKey.configure.mockResolvedValueOnce({
        configured: true,
        details: [],
      });

      await manager.configureAuthentication('thirdParty');

      expect(scopeResolver.read).toHaveBeenCalledWith(
        'anthropicProviderId',
        true,
      );
      expect(strategies.apiKey.configure.mock.calls[0][0].providerId).toBe(
        'openrouter',
      );
    });

    it("normalizes legacy 'openrouter' auth method to 'thirdParty'", async () => {
      const { manager, strategies, logger } = makeManager({
        config: { anthropicProviderId: 'openrouter' },
      });
      strategies.apiKey.configure.mockResolvedValueOnce({
        configured: true,
        details: [],
      });

      await manager.configureAuthentication('openrouter');

      expect(strategies.apiKey.configure).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Normalized auth method 'openrouter'"),
      );
    });

    it('self-resolves the scoped authMethod when called with no argument', async () => {
      const { manager, strategies } = makeManager({
        config: { authMethod: 'thirdParty', anthropicProviderId: 'openrouter' },
      });
      strategies.apiKey.configure.mockResolvedValueOnce({
        configured: true,
        details: [],
      });

      await manager.configureAuthentication();

      expect(strategies.apiKey.configure).toHaveBeenCalledTimes(1);
      expect(strategies.apiKey.configure.mock.calls[0][0].providerId).toBe(
        'openrouter',
      );
      expect(strategies.cli.configure).not.toHaveBeenCalled();
    });

    it('self-resolves a scoped claudeCli authMethod when called with no argument', async () => {
      const { manager, strategies } = makeManager({
        config: { authMethod: 'claudeCli' },
      });
      strategies.cli.configure.mockResolvedValueOnce({
        configured: true,
        details: [],
      });

      await manager.configureAuthentication();

      expect(strategies.cli.configure).toHaveBeenCalledTimes(1);
      expect(strategies.apiKey.configure).not.toHaveBeenCalled();
    });

    describe('default when no authMethod is configured', () => {
      const configured = { configured: true, details: [] };

      it('configures the connected Claude CLI login when no API key exists', async () => {
        const { manager, strategies, ambientRead } = makeManager({
          ambientState: 'connected',
        });
        strategies.cli.configure.mockResolvedValueOnce(configured);

        const result = await manager.configureAuthentication();

        expect(result.configured).toBe(true);
        expect(strategies.cli.configure).toHaveBeenCalledTimes(1);
        expect(strategies.apiKey.configure).not.toHaveBeenCalled();
        expect(ambientRead).toHaveBeenCalledTimes(1);
        // The synchronous readers (adapter, model service) agree.
        expect(manager.resolveActiveAuth()).toEqual({
          authMethod: 'claudeCli',
          providerId: 'anthropic',
        });
      });

      it('resolveActiveAuthWithDefault applies the default without configuring', async () => {
        const { manager, strategies, ambientRead } = makeManager({
          ambientState: 'connected',
        });

        await expect(manager.resolveActiveAuthWithDefault()).resolves.toEqual({
          authMethod: 'claudeCli',
          providerId: 'anthropic',
        });
        expect(ambientRead).toHaveBeenCalledTimes(1);
        expect(strategies.cli.configure).not.toHaveBeenCalled();
        expect(strategies.apiKey.configure).not.toHaveBeenCalled();
      });

      it('treats an unknown stored spelling like a missing one', async () => {
        const { manager, strategies } = makeManager({
          config: { authMethod: 'garbage' },
          ambientState: 'connected',
        });
        strategies.cli.configure.mockResolvedValueOnce(configured);

        await manager.configureAuthentication();

        expect(strategies.cli.configure).toHaveBeenCalledTimes(1);
      });

      it('keeps the API key when one is stored, without reading the login', async () => {
        const { manager, strategies, ambientRead } = makeManager({
          storedApiKey: 'test-stored-key',
          ambientState: 'connected',
        });
        strategies.apiKey.configure.mockResolvedValueOnce(configured);

        await manager.configureAuthentication();

        expect(strategies.apiKey.configure).toHaveBeenCalledTimes(1);
        expect(strategies.cli.configure).not.toHaveBeenCalled();
        expect(ambientRead).not.toHaveBeenCalled();
        expect(manager.resolveActiveAuth().authMethod).toBe('apiKey');
      });

      it('keeps the API key when ANTHROPIC_API_KEY is set', async () => {
        process.env['ANTHROPIC_API_KEY'] = 'test-env-key';
        const { manager, strategies, ambientRead } = makeManager({
          ambientState: 'connected',
        });
        strategies.apiKey.configure.mockResolvedValueOnce(configured);

        await manager.configureAuthentication();

        expect(strategies.apiKey.configure).toHaveBeenCalledTimes(1);
        expect(ambientRead).not.toHaveBeenCalled();
      });

      it('keeps an explicit apiKey with no key and a connected login', async () => {
        const { manager, strategies, getCredential, ambientRead } = makeManager(
          {
            config: { authMethod: 'apiKey' },
            ambientState: 'connected',
          },
        );
        strategies.apiKey.configure.mockResolvedValueOnce({
          configured: false,
          details: [],
        });

        await manager.configureAuthentication();

        expect(strategies.apiKey.configure).toHaveBeenCalledTimes(1);
        expect(strategies.cli.configure).not.toHaveBeenCalled();
        expect(getCredential).not.toHaveBeenCalled();
        expect(ambientRead).not.toHaveBeenCalled();
        expect(manager.resolveActiveAuth().authMethod).toBe('apiKey');
      });

      it('stays on apiKey when no key exists and the login is signed out', async () => {
        const { manager, strategies } = makeManager({
          ambientState: 'signed-out',
        });
        strategies.apiKey.configure.mockResolvedValueOnce({
          configured: false,
          details: [],
        });

        await manager.configureAuthentication();

        expect(strategies.apiKey.configure).toHaveBeenCalledTimes(1);
        expect(strategies.cli.configure).not.toHaveBeenCalled();
      });
    });

    it('falls back to apiKey when the raw method is unknown', async () => {
      const { manager, strategies, logger } = makeManager();
      strategies.apiKey.configure.mockResolvedValueOnce({
        configured: true,
        details: [],
      });

      await manager.configureAuthentication('totally-unknown-method');

      expect(strategies.apiKey.configure).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("→ 'apiKey'"),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Clean slate + delegation contract
  // -------------------------------------------------------------------------

  describe('clean slate and delegation', () => {
    it('clears auth env vars and tier env vars on every configure call', async () => {
      const { manager, strategies, providerModels, authEnv } = makeManager();
      // Pre-seed both the shared AuthEnv and process.env so we can observe
      // the wipe.
      authEnv.ANTHROPIC_API_KEY = 'leftover';
      authEnv.ANTHROPIC_BASE_URL = 'https://stale.example.com';
      authEnv.ANTHROPIC_AUTH_TOKEN = 'stale-token';
      process.env['ANTHROPIC_API_KEY'] = 'leftover';
      process.env['ANTHROPIC_BASE_URL'] = 'https://stale.example.com';
      process.env['ANTHROPIC_AUTH_TOKEN'] = 'stale-token';

      strategies.apiKey.configure.mockImplementationOnce(
        async (ctx): Promise<AuthConfigureResult> => {
          // When the strategy runs, the shared AuthEnv must already be blank.
          expect(ctx.authEnv.ANTHROPIC_API_KEY).toBeUndefined();
          expect(ctx.authEnv.ANTHROPIC_BASE_URL).toBeUndefined();
          expect(ctx.authEnv.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
          expect(process.env['ANTHROPIC_API_KEY']).toBeUndefined();
          return { configured: true, details: [] };
        },
      );

      await manager.configureAuthentication('apiKey');

      // Tier env vars wiped exactly once per configure call.
      expect(providerModels.clearAllTierEnvVars).toHaveBeenCalledTimes(1);
    });

    it('captures ANTHROPIC_API_KEY snapshot BEFORE wiping so strategy can restore', async () => {
      const { manager, strategies } = makeManager();
      process.env['ANTHROPIC_API_KEY'] = 'sk-ant-api-env-key';

      strategies.apiKey.configure.mockImplementationOnce(
        async (ctx): Promise<AuthConfigureResult> => {
          // Snapshot preserves the pre-wipe value for the strategy's fallback.
          expect(ctx.envSnapshot?.ANTHROPIC_API_KEY).toBe('sk-ant-api-env-key');
          // But the live env var was cleared.
          expect(process.env['ANTHROPIC_API_KEY']).toBeUndefined();
          return { configured: true, details: [] };
        },
      );

      await manager.configureAuthentication('apiKey');
      expect(strategies.apiKey.configure).toHaveBeenCalledTimes(1);
    });

    it('passes the same shared AuthEnv instance to every configure call', async () => {
      const { manager, strategies, authEnv } = makeManager();
      strategies.apiKey.configure.mockResolvedValue({
        configured: true,
        details: [],
      });

      await manager.configureAuthentication('apiKey');
      await manager.configureAuthentication('apiKey');

      expect(strategies.apiKey.configure.mock.calls[0][0].authEnv).toBe(
        authEnv,
      );
      expect(strategies.apiKey.configure.mock.calls[1][0].authEnv).toBe(
        authEnv,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Active strategy tracking + teardown ordering
  // -------------------------------------------------------------------------

  describe('active strategy tracking', () => {
    it('tears down the previously active strategy before switching to a new one', async () => {
      const { manager, strategies } = makeManager();
      strategies.apiKey.configure.mockResolvedValueOnce({
        configured: true,
        details: [],
      });
      strategies.cli.configure.mockResolvedValueOnce({
        configured: true,
        details: [],
      });

      await manager.configureAuthentication('apiKey');
      await manager.configureAuthentication('claudeCli');

      // apiKey was active → teardown fired on second configure.
      expect(strategies.apiKey.teardown).toHaveBeenCalledTimes(1);
      // cli replaces it — no teardown on cli yet.
      expect(strategies.cli.teardown).not.toHaveBeenCalled();
    });

    it('does NOT track an unsuccessful strategy as active (no teardown on next switch)', async () => {
      const { manager, strategies } = makeManager();
      strategies.apiKey.configure.mockResolvedValueOnce({
        configured: false,
        details: [],
        errorMessage: 'no key configured',
      });
      strategies.cli.configure.mockResolvedValueOnce({
        configured: true,
        details: [],
      });

      await manager.configureAuthentication('apiKey');
      await manager.configureAuthentication('claudeCli');

      // First attempt failed → it was never promoted to active → no teardown.
      expect(strategies.apiKey.teardown).not.toHaveBeenCalled();
    });

    it('swallows teardown errors and logs a warning (does not abort reconfigure)', async () => {
      const { manager, strategies, logger } = makeManager();
      strategies.apiKey.configure.mockResolvedValueOnce({
        configured: true,
        details: [],
      });
      strategies.apiKey.teardown.mockRejectedValueOnce(
        new Error('proxy stop failed'),
      );
      strategies.cli.configure.mockResolvedValueOnce({
        configured: true,
        details: [],
      });

      await manager.configureAuthentication('apiKey');
      await expect(
        manager.configureAuthentication('claudeCli'),
      ).resolves.toMatchObject({ configured: true });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to teardown previous strategy'),
      );
    });

    it('clearAuthentication() tears down the active strategy and clears env', async () => {
      const { manager, strategies, providerModels, authEnv } = makeManager();
      strategies.apiKey.configure.mockResolvedValueOnce({
        configured: true,
        details: [],
      });

      await manager.configureAuthentication('apiKey');
      authEnv.ANTHROPIC_API_KEY = 'sk-ant-api-seeded';
      process.env['ANTHROPIC_API_KEY'] = 'sk-ant-api-seeded';

      manager.clearAuthentication();

      expect(authEnv.ANTHROPIC_API_KEY).toBeUndefined();
      expect(process.env['ANTHROPIC_API_KEY']).toBeUndefined();
      expect(strategies.apiKey.teardown).toHaveBeenCalledTimes(1);
      expect(providerModels.clearAllTierEnvVars).toHaveBeenCalled();
    });

    it('clearAuthentication() is a no-op for teardown when no strategy is active', () => {
      const { manager, strategies, providerModels } = makeManager();

      manager.clearAuthentication();

      expect(strategies.apiKey.teardown).not.toHaveBeenCalled();
      expect(strategies.cli.teardown).not.toHaveBeenCalled();
      expect(providerModels.clearAllTierEnvVars).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Concurrency guard
  // -------------------------------------------------------------------------

  describe('concurrency guard', () => {
    it('coalesces overlapping configureAuthentication calls into one run', async () => {
      const { manager, strategies } = makeManager();
      const gate = deferred<AuthConfigureResult>();
      strategies.apiKey.configure.mockReturnValueOnce(gate.promise);

      // Two overlapping calls before the first resolves.
      const first = manager.configureAuthentication('apiKey');
      const second = manager.configureAuthentication('apiKey');

      // Only one strategy invocation observed.
      expect(strategies.apiKey.configure).toHaveBeenCalledTimes(1);

      gate.resolve({ configured: true, details: ['single run'] });
      const [firstResult, secondResult] = await Promise.all([first, second]);

      // Both callers receive the same result.
      expect(firstResult).toBe(secondResult);
      expect(firstResult.details).toEqual(['single run']);
    });

    it('releases the guard after completion so the next call runs fresh', async () => {
      const { manager, strategies } = makeManager();
      strategies.apiKey.configure
        .mockResolvedValueOnce({ configured: true, details: ['first'] })
        .mockResolvedValueOnce({ configured: true, details: ['second'] });

      const first = await manager.configureAuthentication('apiKey');
      const second = await manager.configureAuthentication('apiKey');

      expect(strategies.apiKey.configure).toHaveBeenCalledTimes(2);
      expect(first.details).toEqual(['first']);
      expect(second.details).toEqual(['second']);
    });

    it('releases the guard even if the underlying strategy throws', async () => {
      const { manager, strategies } = makeManager();
      strategies.apiKey.configure
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ configured: true, details: ['recovered'] });

      await expect(manager.configureAuthentication('apiKey')).rejects.toThrow(
        'boom',
      );
      // Second call is not blocked by the prior rejection.
      const recovery = await manager.configureAuthentication('apiKey');
      expect(recovery.details).toEqual(['recovered']);
    });
  });

  // -------------------------------------------------------------------------
  // Result propagation and logging
  // -------------------------------------------------------------------------

  describe('operation intent and keyed flights', () => {
    const context: AuthOperationContext = {
      providerId: 'openai-codex',
      reason: 'provider-selection',
      hostNativeCodex: true,
      normalizedHome: '/home/codex-a',
    };

    it.each([
      'startup',
      'provider-selection',
      'reauth',
      'auth-file-changed',
    ] as const)(
      'tears down managed Claude auth and process env on native provider switch for %s',
      async (reason) => {
        const { manager, strategies, authEnv, providerModels } = makeManager();
        strategies.apiKey.configure.mockResolvedValue({
          configured: true,
          details: [],
        });
        await manager.configureAuthentication('apiKey');
        authEnv.ANTHROPIC_API_KEY = 'test-key';
        process.env['ANTHROPIC_API_KEY'] = 'test-key';
        providerModels.clearAllTierEnvVars.mockClear();
        const result = await manager.configureAuthentication('thirdParty', {
          ...context,
          reason,
        });
        expect(result.configured).toBe(false);
        expect(manager.getConfiguredAuth()).toBeNull();
        expect(authEnv.ANTHROPIC_API_KEY).toBeUndefined();
        expect(process.env['ANTHROPIC_API_KEY']).toBeUndefined();
        expect(providerModels.clearAllTierEnvVars).toHaveBeenCalledTimes(1);
        expect(strategies.apiKey.teardown).toHaveBeenCalledTimes(1);
        expect(strategies.oauthProxy.configure).not.toHaveBeenCalled();
        await manager.configureAuthentication('apiKey');
        expect(strategies.apiKey.teardown).toHaveBeenCalledTimes(1);
      },
    );

    it.each([
      { ...context, reason: 'legacy-session-start' as const },
      { ...context, hostNativeCodex: false },
      { ...context, providerId: 'github-copilot' },
    ])(
      'delegates legacy and Copilot intent to the existing proxy strategy',
      async (intent) => {
        const { manager, strategies } = makeManager();
        strategies.oauthProxy.configure.mockResolvedValue({
          configured: true,
          details: [],
        });
        await manager.configureAuthentication('thirdParty', intent);
        expect(strategies.oauthProxy.configure).toHaveBeenCalledWith(
          expect.objectContaining({
            providerId: intent.providerId,
            operationContext: intent,
          }),
        );
      },
    );

    it.each([
      { normalizedHome: '/home/codex-b' },
      { reason: 'reauth' as const },
      { hostNativeCodex: true },
      { providerId: 'github-copilot' },
    ])(
      'serializes incompatible flights without sharing results: %j',
      async (change) => {
        const { manager, strategies } = makeManager();
        const gate = deferred<AuthConfigureResult>();
        strategies.oauthProxy.configure
          .mockReturnValueOnce(gate.promise)
          .mockResolvedValue({ configured: true, details: ['second'] });
        const intent = { ...context, hostNativeCodex: false };
        const first = manager.configureAuthentication('thirdParty', intent);
        const second = manager.configureAuthentication('thirdParty', {
          ...intent,
          ...change,
        });
        const duplicate = manager.configureAuthentication('thirdParty', {
          ...intent,
          ...change,
        });
        expect(strategies.oauthProxy.configure).toHaveBeenCalledTimes(1);
        gate.resolve({ configured: true, details: ['first'] });
        const results = await Promise.all([first, second, duplicate]);
        expect(results[0]).not.toBe(results[1]);
        expect(results[1]).toBe(results[2]);
        expect(strategies.oauthProxy.configure).toHaveBeenCalledTimes(
          'hostNativeCodex' in change ? 1 : 2,
        );
      },
    );

    it('runs queued legacy work after a failed operation and snapshots its intent', async () => {
      const { manager, strategies } = makeManager();
      const gate = deferred<AuthConfigureResult>();
      strategies.apiKey.configure.mockReturnValue(
        gate.promise.then(() => {
          throw new Error('failed');
        }),
      );
      strategies.oauthProxy.configure.mockResolvedValue({
        configured: true,
        details: ['legacy'],
      });
      const first = manager.configureAuthentication('apiKey');
      const failure = expect(first).rejects.toThrow('failed');
      const intent: AuthOperationContext = {
        ...context,
        reason: 'legacy-session-start',
      };
      const second = manager.configureAuthentication('thirdParty', intent);
      intent.providerId = 'github-copilot';
      gate.resolve({ configured: false, details: [] });
      await failure;
      expect((await second).details).toEqual(['legacy']);
      expect(strategies.oauthProxy.configure).toHaveBeenCalledWith(
        expect.objectContaining({ providerId: 'openai-codex' }),
      );
    });

    it('captures provider settings separately for overlapping context-free callers', async () => {
      const { manager, strategies, scopeResolver } = makeManager({
        config: { anthropicProviderId: 'openai-codex' },
      });
      const gate = deferred<AuthConfigureResult>();
      strategies.oauthProxy.configure
        .mockReturnValueOnce(gate.promise)
        .mockResolvedValueOnce({ configured: true, details: ['copilot'] });
      const first = manager.configureAuthentication('thirdParty');
      scopeResolver.read.mockImplementation((key) =>
        key === 'anthropicProviderId' ? 'github-copilot' : undefined,
      );
      const second = manager.configureAuthentication('thirdParty');
      expect(strategies.oauthProxy.configure).toHaveBeenCalledTimes(1);
      gate.resolve({ configured: true, details: ['codex'] });
      expect((await first).details).toEqual(['codex']);
      expect((await second).details).toEqual(['copilot']);
      expect(strategies.oauthProxy.configure).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ providerId: 'github-copilot' }),
      );
    });

    it('validates context before touching the shared environment', async () => {
      const { manager, providerModels } = makeManager();
      await expect(
        manager.configureAuthentication('thirdParty', {
          ...context,
          providerId: '',
        }),
      ).rejects.toThrow('Invalid auth operation context');
      expect(providerModels.clearAllTierEnvVars).not.toHaveBeenCalled();
    });

    it('honors native intent before checking the stale non-thirdParty auth method', async () => {
      const { manager, strategies } = makeManager();
      expect(
        (await manager.configureAuthentication('apiKey', context)).configured,
      ).toBe(false);
      expect(strategies.apiKey.configure).not.toHaveBeenCalled();
    });

    it('switches legacy proxy to native and back without stale proxy or Claude env', async () => {
      const { manager, strategies, authEnv } = makeManager({
        config: { anthropicProviderId: 'openai-codex' },
      });
      strategies.oauthProxy.configure.mockImplementation(async () => {
        authEnv.ANTHROPIC_BASE_URL = 'http://localhost:1234';
        process.env['ANTHROPIC_BASE_URL'] = 'http://localhost:1234';
        return { configured: true, details: [] };
      });
      await manager.configureAuthentication('thirdParty');
      await manager.configureAuthentication('thirdParty', context);
      expect(strategies.oauthProxy.teardown).toHaveBeenCalledTimes(1);
      expect(authEnv.ANTHROPIC_BASE_URL).toBeUndefined();
      expect(process.env['ANTHROPIC_BASE_URL']).toBeUndefined();
      expect(manager.getConfiguredAuth()).toBeNull();
      await manager.configureAuthentication('thirdParty');
      expect(strategies.oauthProxy.configure).toHaveBeenCalledTimes(2);
      expect(strategies.oauthProxy.teardown).toHaveBeenCalledTimes(1);
      expect(authEnv.ANTHROPIC_BASE_URL).toBe('http://localhost:1234');
    });

    it('rejects mismatched provider intent before disturbing auth', async () => {
      const { manager, strategies, providerModels } = makeManager();
      await expect(
        manager.configureAuthentication('apiKey', {
          ...context,
          hostNativeCodex: false,
        }),
      ).rejects.toBeInstanceOf(SdkError);
      expect(strategies.apiKey.configure).not.toHaveBeenCalled();
      expect(providerModels.clearAllTierEnvVars).not.toHaveBeenCalled();
    });
  });

  describe('result propagation', () => {
    it('returns the strategy result verbatim on success', async () => {
      const { manager, strategies, logger } = makeManager();
      strategies.apiKey.configure.mockResolvedValueOnce({
        configured: true,
        details: ['API key from SecretStorage'],
      });

      const result = await manager.configureAuthentication('apiKey');

      expect(result).toEqual({
        configured: true,
        details: ['API key from SecretStorage'],
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Authentication configured'),
      );
    });

    it('passes the strategy errorMessage through when configured=false with a message', async () => {
      const { manager, strategies, logger } = makeManager();
      strategies.apiKey.configure.mockResolvedValueOnce({
        configured: false,
        details: [],
        errorMessage: 'No API key configured.',
      });

      const result = await manager.configureAuthentication('apiKey');

      expect(result.configured).toBe(false);
      expect(result.errorMessage).toBe('No API key configured.');
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('No API key configured.'),
      );
    });

    it('injects a default helper message when strategy returns no errorMessage', async () => {
      const { manager, strategies } = makeManager();
      strategies.apiKey.configure.mockResolvedValueOnce({
        configured: false,
        details: [],
      });

      const result = await manager.configureAuthentication('apiKey');

      expect(result.configured).toBe(false);
      expect(result.errorMessage).toContain('No authentication configured');
      expect(result.errorMessage).not.toMatch(/Settings|tab/i);
    });
  });
});
