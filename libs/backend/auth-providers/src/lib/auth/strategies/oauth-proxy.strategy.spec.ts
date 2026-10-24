/**
 * OAuthProxyStrategy — unit specs.
 *
 * The OAuth proxy strategy multiplexes two sub-providers:
 *   - 'github-copilot' (default branch):
 *       * isAuthenticated() → if false, tryRestoreAuth() must succeed or we
 *         return a "not authenticated" error.
 *       * Starts copilotProxy, points SDK at its URL, injects the proxy
 *         auth-token placeholder.
 *       * Stops codexProxy before configuring (cross-contamination guard).
 *   - 'openai-codex':
 *       * isAuthenticated() → false returns a "run codex login" hint.
 *       * ensureTokensFresh() → false returns an "expired, re-auth" hint.
 *         This is the strategy's only real "expiry" branch; we cover both.
 *       * Starts codexProxy, stops copilotProxy first.
 *
 * teardown() stops both proxies and clears the codex auth cache.
 *
 * Source-under-test:
 *   `libs/backend/agent-sdk/src/lib/auth/strategies/oauth-proxy.strategy.ts`
 */

import 'reflect-metadata';

import type { Logger, SentryService } from '@ptah-extension/vscode-core';
import type { AuthEnv } from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import { createMockSentryService } from '@ptah-extension/vscode-core/testing';

import { OAuthProxyStrategy } from './oauth-proxy.strategy';
import type { AuthConfigureContext } from '../auth-strategy.types';
import { authOperationContextSchema } from '../auth-strategy.types';
import type {
  ICopilotAuthService,
  ICopilotTranslationProxy,
} from '../../providers/copilot/copilot-provider.types';
import { COPILOT_PROXY_TOKEN_PLACEHOLDER } from '../../providers/copilot/copilot-provider.types';
import type { ICodexAuthService } from '../../providers/codex/codex-provider.types';
import { CODEX_PROXY_TOKEN_PLACEHOLDER } from '../../providers/codex/codex-provider.types';
import type { ITranslationProxy } from '../../translation';
import type { ProviderModelsService } from '../../provider-models.service';

// ---------------------------------------------------------------------------
// Typed mock helpers
// ---------------------------------------------------------------------------

function asLogger(mock: MockLogger): Logger {
  const surface: Partial<Logger> = mock;
  return surface as Logger;
}

function createMockCopilotAuth(): jest.Mocked<ICopilotAuthService> {
  return {
    login: jest.fn().mockResolvedValue(false),
    tryRestoreAuth: jest.fn().mockResolvedValue(false),
    isAuthenticated: jest.fn().mockResolvedValue(false),
    getAuthState: jest.fn().mockResolvedValue(null),
    getHeaders: jest.fn().mockResolvedValue({}),
    logout: jest.fn().mockResolvedValue(undefined),
    // never calls these directly (it uses tryRestoreAuth + isAuthenticated),
    // so a no-op mock is sufficient to satisfy the interface.
    beginLogin: jest.fn().mockResolvedValue({
      deviceCode: 'mock-device',
      userCode: 'MOCK',
      verificationUri: 'https://github.com/login/device',
      interval: 5,
      expiresIn: 600,
    }),
    pollLogin: jest.fn().mockResolvedValue(false),
    cancelLogin: jest.fn(),
    listModels: jest.fn().mockResolvedValue([]),
  };
}

function createMockCopilotProxy(): jest.Mocked<ICopilotTranslationProxy> {
  return {
    start: jest
      .fn<Promise<{ port: number; url: string }>, []>()
      .mockResolvedValue({ port: 0, url: '' }),
    stop: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    isRunning: jest.fn<boolean, []>().mockReturnValue(false),
    getUrl: jest.fn<string | undefined, []>().mockReturnValue(undefined),
  };
}

function createMockCodexAuth(): jest.Mocked<ICodexAuthService> {
  return {
    getAccountUsageEligibility: jest.fn().mockResolvedValue('supported'),
    isAuthenticated: jest.fn<Promise<boolean>, []>().mockResolvedValue(false),
    getHeaders: jest
      .fn<Promise<Record<string, string>>, []>()
      .mockResolvedValue({}),
    getApiEndpoint: jest.fn<string, []>().mockReturnValue(''),
    ensureTokensFresh: jest.fn<Promise<boolean>, []>().mockResolvedValue(false),
    clearCache: jest.fn<void, []>(),
    getTokenStatus: jest
      .fn<Promise<{ authenticated: boolean; stale: boolean }>, []>()
      .mockResolvedValue({ authenticated: false, stale: false }),
    startWatchingAuthFile: jest.fn<void, []>(),
    stopWatchingAuthFile: jest.fn<void, []>(),
    listModels: jest.fn().mockResolvedValue([]),
  };
}

function createMockTranslationProxy(): jest.Mocked<ITranslationProxy> {
  return {
    start: jest
      .fn<Promise<{ port: number; url: string }>, []>()
      .mockResolvedValue({ port: 0, url: '' }),
    stop: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    isRunning: jest.fn<boolean, []>().mockReturnValue(false),
    getUrl: jest.fn<string | undefined, []>().mockReturnValue(undefined),
  };
}

type ProviderModelsSurface = Pick<
  ProviderModelsService,
  'switchActiveProvider'
>;

function createMockProviderModels(): jest.Mocked<ProviderModelsSurface> {
  return { switchActiveProvider: jest.fn<void, [string]>() };
}

function makeContext(providerId: string): AuthConfigureContext {
  const authEnv: AuthEnv = {};
  return { providerId, authEnv };
}

interface Harness {
  strategy: OAuthProxyStrategy;
  logger: MockLogger;
  copilotAuth: jest.Mocked<ICopilotAuthService>;
  copilotProxy: jest.Mocked<ICopilotTranslationProxy>;
  codexAuth: jest.Mocked<ICodexAuthService>;
  codexProxy: jest.Mocked<ITranslationProxy>;
  providerModels: jest.Mocked<ProviderModelsSurface>;
}

function makeStrategy(): Harness {
  const logger = createMockLogger();
  const copilotAuth = createMockCopilotAuth();
  const copilotProxy = createMockCopilotProxy();
  const codexAuth = createMockCodexAuth();
  const codexProxy = createMockTranslationProxy();
  const providerModels = createMockProviderModels();
  const providerModelsSurface: Partial<ProviderModelsService> = providerModels;
  const sentry = createMockSentryService();

  const strategy = new OAuthProxyStrategy(
    asLogger(logger),
    copilotAuth,
    copilotProxy,
    codexAuth,
    codexProxy,
    providerModelsSurface as ProviderModelsService,
    sentry as SentryService,
  );

  return {
    strategy,
    logger,
    copilotAuth,
    copilotProxy,
    codexAuth,
    codexProxy,
    providerModels,
  };
}

describe('OAuthProxyStrategy', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  it('exposes the documented strategy name', () => {
    const { strategy } = makeStrategy();
    expect(strategy.name).toBe('OAuthProxyStrategy');
  });

  // -------------------------------------------------------------------------
  // GitHub Copilot branch
  // -------------------------------------------------------------------------

  describe('GitHub Copilot flow', () => {
    it.each([undefined, false, true])(
      'happy path with hostNativeCodex=%s: starts proxy, sets env, and reports success',
      async (hostNativeCodex) => {
        const harness = makeStrategy();
        harness.copilotAuth.isAuthenticated.mockResolvedValueOnce(true);
        harness.copilotProxy.isRunning.mockReturnValueOnce(false); // not yet running
        harness.copilotProxy.start.mockResolvedValueOnce({
          port: 9321,
          url: 'http://127.0.0.1:9321',
        });

        const ctx = makeContext('github-copilot');
        if (hostNativeCodex !== undefined) {
          ctx.operationContext = authOperationContextSchema.parse({
            providerId: 'github-copilot',
            reason: 'provider-selection',
            hostNativeCodex,
          });
        }
        const result = await harness.strategy.configure(ctx);

        // Codex proxy stopped first to prevent cross-contamination.
        // (Guarded by isRunning() → default false, so stop() isn't invoked here.)
        expect(harness.codexProxy.stop).not.toHaveBeenCalled();

        expect(harness.copilotAuth.tryRestoreAuth).not.toHaveBeenCalled();
        expect(harness.copilotProxy.start).toHaveBeenCalledTimes(1);
        expect(ctx.authEnv.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:9321');
        expect(ctx.authEnv.ANTHROPIC_AUTH_TOKEN).toBe(
          COPILOT_PROXY_TOKEN_PLACEHOLDER,
        );
        expect(process.env['ANTHROPIC_BASE_URL']).toBe('http://127.0.0.1:9321');
        expect(
          harness.providerModels.switchActiveProvider,
        ).toHaveBeenCalledWith('github-copilot');

        expect(result.configured).toBe(true);
        expect(result.details[0]).toContain('GitHub Copilot');
        expect(result.details[0]).toContain('http://127.0.0.1:9321');

        // cleanup the env var we set
        delete process.env['ANTHROPIC_BASE_URL'];
        delete process.env['ANTHROPIC_AUTH_TOKEN'];
      },
    );

    it('attempts silent restore when not authed and succeeds', async () => {
      const harness = makeStrategy();
      harness.copilotAuth.isAuthenticated.mockResolvedValueOnce(false);
      harness.copilotAuth.tryRestoreAuth.mockResolvedValueOnce(true);
      harness.copilotProxy.isRunning.mockReturnValue(false);
      harness.copilotProxy.start.mockResolvedValueOnce({
        port: 9322,
        url: 'http://127.0.0.1:9322',
      });

      const result = await harness.strategy.configure(
        makeContext('github-copilot'),
      );

      expect(harness.copilotAuth.tryRestoreAuth).toHaveBeenCalledTimes(1);
      // IMPORTANT: source doc explicitly warns NOT to call login() here.
      expect(harness.copilotAuth.login).not.toHaveBeenCalled();
      expect(result.configured).toBe(true);

      delete process.env['ANTHROPIC_BASE_URL'];
      delete process.env['ANTHROPIC_AUTH_TOKEN'];
    });

    it('auth-required: silent restore fails → returns "Connect via Settings" error', async () => {
      const harness = makeStrategy();
      harness.copilotAuth.isAuthenticated.mockResolvedValueOnce(false);
      harness.copilotAuth.tryRestoreAuth.mockResolvedValueOnce(false);

      const result = await harness.strategy.configure(
        makeContext('github-copilot'),
      );

      expect(result.configured).toBe(false);
      expect(result.errorMessage).toBe(
        'GitHub Copilot is not authenticated. Connect via Settings > Authentication.',
      );
      // No proxy start attempted on auth failure.
      expect(harness.copilotProxy.start).not.toHaveBeenCalled();
    });

    it('reuses an already-running proxy (no second start) but still points SDK at its URL', async () => {
      const harness = makeStrategy();
      harness.copilotAuth.isAuthenticated.mockResolvedValueOnce(true);
      harness.copilotProxy.isRunning.mockReturnValue(true);
      harness.copilotProxy.getUrl.mockReturnValue('http://127.0.0.1:9999');

      const ctx = makeContext('github-copilot');
      const result = await harness.strategy.configure(ctx);

      expect(harness.copilotProxy.start).not.toHaveBeenCalled();
      expect(ctx.authEnv.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:9999');
      expect(result.configured).toBe(true);

      delete process.env['ANTHROPIC_BASE_URL'];
      delete process.env['ANTHROPIC_AUTH_TOKEN'];
    });

    it('returns a restart hint when the running proxy cannot report its URL', async () => {
      const harness = makeStrategy();
      harness.copilotAuth.isAuthenticated.mockResolvedValueOnce(true);
      harness.copilotProxy.isRunning.mockReturnValue(true);
      harness.copilotProxy.getUrl.mockReturnValue(undefined);

      const result = await harness.strategy.configure(
        makeContext('github-copilot'),
      );

      expect(result.configured).toBe(false);
      expect(result.errorMessage).toContain('Try restarting');
    });

    it('returns a "port" error when proxy.start() throws', async () => {
      const harness = makeStrategy();
      harness.copilotAuth.isAuthenticated.mockResolvedValueOnce(true);
      harness.copilotProxy.isRunning.mockReturnValue(false);
      harness.copilotProxy.start.mockRejectedValueOnce(new Error('EADDRINUSE'));

      const result = await harness.strategy.configure(
        makeContext('github-copilot'),
      );

      expect(result.configured).toBe(false);
      expect(result.errorMessage).toBe(
        'Failed to start Copilot translation proxy. Check if the port is available.',
      );
    });

    it('stops a running codex proxy before configuring Copilot', async () => {
      const harness = makeStrategy();
      harness.codexProxy.isRunning.mockReturnValue(true);
      harness.copilotAuth.isAuthenticated.mockResolvedValueOnce(true);
      harness.copilotProxy.isRunning.mockReturnValue(false);
      harness.copilotProxy.start.mockResolvedValueOnce({
        port: 1,
        url: 'http://127.0.0.1:1',
      });

      await harness.strategy.configure(makeContext('github-copilot'));

      expect(harness.codexProxy.stop).toHaveBeenCalledTimes(1);

      delete process.env['ANTHROPIC_BASE_URL'];
      delete process.env['ANTHROPIC_AUTH_TOKEN'];
    });
  });

  // -------------------------------------------------------------------------
  // OpenAI Codex branch
  // -------------------------------------------------------------------------

  describe('OpenAI Codex flow', () => {
    it.each(['startup', 'provider-selection', 'reauth', 'auth-file-changed'])(
      'native %s leaves Claude auth, proxies, watchers and models untouched',
      async (reason) => {
        const harness = makeStrategy();
        harness.copilotProxy.isRunning.mockReturnValue(true);
        harness.codexProxy.isRunning.mockReturnValue(true);
        const authEnv: AuthEnv = {
          ANTHROPIC_API_KEY: 'test-claude-key',
          ANTHROPIC_AUTH_TOKEN: 'test-claude-token',
          ANTHROPIC_BASE_URL: 'http://127.0.0.1:9321',
        };
        Object.assign(process.env, authEnv);
        const envBefore = { ...process.env };
        const authBefore = { ...authEnv };

        const result = await harness.strategy.configure({
          providerId: 'openai-codex',
          authEnv,
          operationContext: authOperationContextSchema.parse({
            providerId: 'openai-codex',
            hostNativeCodex: true,
            reason,
            normalizedHome: 'D:/codex-test-home',
          }),
        });

        expect(result).toEqual({
          configured: false,
          details: ['Codex authentication is owned by the native runtime.'],
        });
        expect(authEnv).toEqual(authBefore);
        expect(process.env).toEqual(envBefore);
        for (const proxy of [harness.codexProxy, harness.copilotProxy]) {
          expect(proxy.start).not.toHaveBeenCalled();
          expect(proxy.stop).not.toHaveBeenCalled();
          expect(proxy.isRunning).not.toHaveBeenCalled();
          expect(proxy.getUrl).not.toHaveBeenCalled();
        }
        expect(harness.codexAuth.isAuthenticated).not.toHaveBeenCalled();
        expect(harness.codexAuth.ensureTokensFresh).not.toHaveBeenCalled();
        expect(harness.codexAuth.startWatchingAuthFile).not.toHaveBeenCalled();
        expect(harness.codexAuth.stopWatchingAuthFile).not.toHaveBeenCalled();
        expect(harness.codexAuth.clearCache).not.toHaveBeenCalled();
        expect(harness.copilotAuth.isAuthenticated).not.toHaveBeenCalled();
        expect(
          harness.providerModels.switchActiveProvider,
        ).not.toHaveBeenCalled();
      },
    );

    it.each([
      { reason: 'startup', hostNativeCodex: false },
      { reason: 'provider-selection', hostNativeCodex: false },
      { reason: 'reauth', hostNativeCodex: false },
      { reason: 'auth-file-changed', hostNativeCodex: false },
      { reason: 'legacy-session-start', hostNativeCodex: true },
      { reason: 'legacy-session-start', hostNativeCodex: false },
      { reason: 'startup' },
    ])('keeps the translation proxy flow for %j', async (operation) => {
      const harness = makeStrategy();
      harness.copilotProxy.isRunning.mockReturnValue(true);
      harness.codexAuth.isAuthenticated.mockResolvedValue(true);
      harness.codexAuth.ensureTokensFresh.mockResolvedValue(true);
      harness.codexProxy.start.mockResolvedValue({
        port: 9401,
        url: 'http://127.0.0.1:9401',
      });
      const context = makeContext('openai-codex');
      context.operationContext = authOperationContextSchema.parse({
        providerId: 'openai-codex',
        ...operation,
      });

      const result = await harness.strategy.configure(context);

      expect(result.configured).toBe(true);
      expect(harness.copilotProxy.stop).toHaveBeenCalledTimes(1);
      expect(harness.codexAuth.startWatchingAuthFile).toHaveBeenCalledTimes(1);
      expect(harness.codexAuth.isAuthenticated).toHaveBeenCalledTimes(1);
      expect(harness.codexAuth.ensureTokensFresh).toHaveBeenCalledTimes(1);
      expect(harness.codexProxy.start).toHaveBeenCalledTimes(1);
      expect(context.authEnv).toEqual({
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:9401',
        ANTHROPIC_AUTH_TOKEN: CODEX_PROXY_TOKEN_PLACEHOLDER,
      });
      expect(process.env['ANTHROPIC_BASE_URL']).toBe(
        context.authEnv.ANTHROPIC_BASE_URL,
      );
      expect(process.env['ANTHROPIC_AUTH_TOKEN']).toBe(
        CODEX_PROXY_TOKEN_PLACEHOLDER,
      );
      expect(harness.providerModels.switchActiveProvider).toHaveBeenCalledWith(
        'openai-codex',
      );
    });

    it('happy path: authed + tokens fresh → starts codex proxy and sets env', async () => {
      const harness = makeStrategy();
      harness.codexAuth.isAuthenticated.mockResolvedValueOnce(true);
      harness.codexAuth.ensureTokensFresh.mockResolvedValueOnce(true);
      harness.codexProxy.isRunning.mockReturnValue(false);
      harness.codexProxy.start.mockResolvedValueOnce({
        port: 9401,
        url: 'http://127.0.0.1:9401',
      });

      const ctx = makeContext('openai-codex');
      const result = await harness.strategy.configure(ctx);

      expect(harness.codexAuth.isAuthenticated).toHaveBeenCalledTimes(1);
      expect(harness.codexAuth.ensureTokensFresh).toHaveBeenCalledTimes(1);
      expect(harness.codexProxy.start).toHaveBeenCalledTimes(1);
      expect(ctx.authEnv.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:9401');
      expect(ctx.authEnv.ANTHROPIC_AUTH_TOKEN).toBe(
        CODEX_PROXY_TOKEN_PLACEHOLDER,
      );
      expect(harness.providerModels.switchActiveProvider).toHaveBeenCalledWith(
        'openai-codex',
      );
      expect(result.configured).toBe(true);
      expect(result.details[0]).toContain('OpenAI Codex');

      delete process.env['ANTHROPIC_BASE_URL'];
      delete process.env['ANTHROPIC_AUTH_TOKEN'];
    });

    it('auth-required: not authenticated → returns `codex login` hint', async () => {
      const harness = makeStrategy();
      harness.codexAuth.isAuthenticated.mockResolvedValueOnce(false);

      const result = await harness.strategy.configure(
        makeContext('openai-codex'),
      );

      expect(result.configured).toBe(false);
      expect(result.errorMessage).toContain('`codex login`');
      // ensureTokensFresh short-circuited.
      expect(harness.codexAuth.ensureTokensFresh).not.toHaveBeenCalled();
      expect(harness.codexProxy.start).not.toHaveBeenCalled();
    });

    it('expiry: authed but tokens stale → returns re-auth hint', async () => {
      const harness = makeStrategy();
      harness.codexAuth.isAuthenticated.mockResolvedValueOnce(true);
      harness.codexAuth.ensureTokensFresh.mockResolvedValueOnce(false);

      const result = await harness.strategy.configure(
        makeContext('openai-codex'),
      );

      expect(result.configured).toBe(false);
      expect(result.errorMessage).toContain('token has expired');
      expect(harness.codexProxy.start).not.toHaveBeenCalled();
    });

    it('stops a running copilot proxy before configuring Codex', async () => {
      const harness = makeStrategy();
      harness.copilotProxy.isRunning.mockReturnValue(true);
      harness.codexAuth.isAuthenticated.mockResolvedValueOnce(true);
      harness.codexAuth.ensureTokensFresh.mockResolvedValueOnce(true);
      harness.codexProxy.isRunning.mockReturnValue(false);
      harness.codexProxy.start.mockResolvedValueOnce({
        port: 1,
        url: 'http://127.0.0.1:1',
      });

      await harness.strategy.configure(makeContext('openai-codex'));

      expect(harness.copilotProxy.stop).toHaveBeenCalledTimes(1);

      delete process.env['ANTHROPIC_BASE_URL'];
      delete process.env['ANTHROPIC_AUTH_TOKEN'];
    });

    it('returns a port-availability error when codex proxy fails to start', async () => {
      const harness = makeStrategy();
      harness.codexAuth.isAuthenticated.mockResolvedValueOnce(true);
      harness.codexAuth.ensureTokensFresh.mockResolvedValueOnce(true);
      harness.codexProxy.isRunning.mockReturnValue(false);
      harness.codexProxy.start.mockRejectedValueOnce(new Error('EADDRINUSE'));

      const result = await harness.strategy.configure(
        makeContext('openai-codex'),
      );

      expect(result.configured).toBe(false);
      expect(result.errorMessage).toContain(
        'Failed to start Codex translation proxy',
      );
    });
  });

  // -------------------------------------------------------------------------
  // teardown()
  // -------------------------------------------------------------------------

  describe('teardown()', () => {
    it('stops both proxies (when running) and clears the codex auth cache', async () => {
      const harness = makeStrategy();
      harness.copilotProxy.isRunning.mockReturnValue(true);
      harness.codexProxy.isRunning.mockReturnValue(true);

      await harness.strategy.teardown();

      expect(harness.copilotProxy.stop).toHaveBeenCalledTimes(1);
      expect(harness.codexProxy.stop).toHaveBeenCalledTimes(1);
      expect(harness.codexAuth.clearCache).toHaveBeenCalledTimes(1);
    });

    it('skips stopping proxies that are not running but still clears codex cache', async () => {
      const harness = makeStrategy();
      harness.copilotProxy.isRunning.mockReturnValue(false);
      harness.codexProxy.isRunning.mockReturnValue(false);

      await harness.strategy.teardown();

      expect(harness.copilotProxy.stop).not.toHaveBeenCalled();
      expect(harness.codexProxy.stop).not.toHaveBeenCalled();
      expect(harness.codexAuth.clearCache).toHaveBeenCalledTimes(1);
    });
  });
});
