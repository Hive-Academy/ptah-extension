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

import type { Logger, ConfigManager } from '@ptah-extension/vscode-core';
import type { AuthEnv } from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import {
  createMockConfigManager,
  type MockConfigManager,
} from '@ptah-extension/vscode-core/testing';

import { AuthManager } from './auth-manager';
import type {
  IAuthStrategy,
  AuthConfigureContext,
  AuthConfigureResult,
} from '../auth/auth-strategy.types';
import type { ProviderModelsService } from '../provider-models.service';

// ---------------------------------------------------------------------------
// Typed mock helpers
// ---------------------------------------------------------------------------

/**
 * `ConfigManager` is a concrete class with private fields, so a duck-type
 * mock is structurally incompatible. `createMockConfigManager()` returns a
 * `jest.Mocked<ConfigManager>` surface that satisfies the subset actually
 * used by AuthManager (`getWithDefault`). Bridge the private-field gap via
 * `unknown` — same idiom as the reference copilot spec.
 */
function asConfig(mock: MockConfigManager): ConfigManager {
  return mock as unknown as ConfigManager;
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
  logger: MockLogger;
  config: MockConfigManager;
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
  options: { config?: Record<string, unknown> } = {},
): ManagerHarness {
  const logger = createMockLogger();
  const config = createMockConfigManager({ values: options.config });
  const providerModels = createMockProviderModels();
  const authEnv: AuthEnv = {};

  const strategies = {
    apiKey: createMockStrategy('ApiKeyStrategy'),
    oauthProxy: createMockStrategy('OAuthProxyStrategy'),
    localNative: createMockStrategy('LocalNativeStrategy'),
    localProxy: createMockStrategy('LocalProxyStrategy'),
    cli: createMockStrategy('CliStrategy'),
  };

  const manager = new AuthManager(
    asLogger(logger),
    asConfig(config),
    providerModels as unknown as ProviderModelsService,
    authEnv,
    strategies.apiKey,
    strategies.oauthProxy,
    strategies.localNative,
    strategies.localProxy,
    strategies.cli,
  );

  return { manager, logger, config, providerModels, authEnv, strategies };
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
      // returns 'api-key' for it (authType=apiKey, requiresProxy=false).
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

    it("defaults to the registry default provider when 'thirdParty' has no configured id", async () => {
      const { manager, strategies, config } = makeManager();
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
      // Lookup went through getWithDefault, not raw get.
      expect(config.getWithDefault).toHaveBeenCalledWith(
        'anthropicProviderId',
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
      expect(result.errorMessage).toContain('No authentication configured yet');
    });
  });
});
