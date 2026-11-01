/**
 * OAuth Proxy Strategy
 *
 * Handles authentication for OAuth-based providers that require a translation proxy:
 * - GitHub Copilot (VS Code GitHub OAuth + Copilot translation proxy)
 * - OpenAI Codex (native runtime only; legacy OAuth proxy requests fail)
 * - Kimi Code (Kimi Code CLI login from ~/.kimi-code, stored API key as a
 *   fallback, Kimi Code Messages relay proxy)
 *
 * Extracted from AuthManager.configureCopilotOAuth() and configureCodexOAuth().
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import type {
  IAuthStrategy,
  AuthConfigureResult,
  AuthConfigureContext,
} from '../auth-strategy.types';
import { resolveCodexProxyPolicy } from '../codex-proxy-policy';
import { AUTH_PROVIDERS_TOKENS } from '../../di/tokens';
import type { ProviderModelsService } from '../../provider-models.service';
import type {
  ICopilotAuthService,
  ICopilotTranslationProxy,
} from '../../providers/copilot/copilot-provider.types';
import { COPILOT_PROXY_TOKEN_PLACEHOLDER } from '../../providers/copilot/copilot-provider.types';
import type { ICodexAuthService } from '../../providers/codex/codex-provider.types';
import type { IKimiCodeAuthService } from '../../providers/kimi-code/kimi-code-provider.types';
import {
  KIMI_CODE_PROVIDER_ID,
  kimiCodeUnavailableMessage,
} from '../../providers/kimi-code/kimi-code-provider.types';
import type { ITranslationProxy } from '../../translation';
import {
  KIMI_CODE_PROXY_TOKEN_PLACEHOLDER,
  seedStaticModelPricing,
  type AuthEnv,
} from '@ptah-extension/shared';

@injectable()
export class OAuthProxyStrategy implements IAuthStrategy {
  readonly name = 'OAuthProxyStrategy';

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_COPILOT_AUTH)
    private readonly copilotAuth: ICopilotAuthService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_COPILOT_PROXY)
    private readonly copilotProxy: ICopilotTranslationProxy,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH)
    private readonly codexAuth: ICodexAuthService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_PROXY)
    private readonly codexProxy: ITranslationProxy,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_KIMI_CODE_AUTH)
    private readonly kimiCodeAuth: IKimiCodeAuthService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_KIMI_CODE_PROXY)
    private readonly kimiCodeProxy: ITranslationProxy,
  ) {}

  async configure(context: AuthConfigureContext): Promise<AuthConfigureResult> {
    const { providerId, authEnv } = context;
    if (providerId === KIMI_CODE_PROVIDER_ID) {
      await this.stopProxyIfRunning(this.codexProxy, 'Codex');
      this.codexAuth.stopWatchingAuthFile();
      return this.configureKimiCode(providerId, authEnv);
    }
    await this.stopKimiCode();
    if (providerId === 'openai-codex') {
      return this.configureCodexOAuth(context);
    }
    await this.stopProxyIfRunning(this.codexProxy, 'Codex');
    this.codexAuth.stopWatchingAuthFile();
    return this.configureCopilotOAuth(providerId, authEnv);
  }

  async teardown(): Promise<void> {
    await this.stopProxyIfRunning(this.copilotProxy, 'Copilot');
    await this.stopProxyIfRunning(this.codexProxy, 'Codex');
    this.codexAuth.stopWatchingAuthFile();
    this.codexAuth.clearCache();
    await this.stopKimiCode();
    this.kimiCodeAuth.clearCache();
  }

  private async stopKimiCode(): Promise<void> {
    await this.stopProxyIfRunning(this.kimiCodeProxy, 'Kimi Code');
    this.kimiCodeAuth.stopWatching();
  }

  /**
   * Configure Kimi Code: the Kimi Code CLI login first, the stored Kimi Code
   * API key as a fallback, both served through the Kimi Code proxy so a
   * 15-minute OAuth token stays fresh for sessions of any length.
   */
  private async configureKimiCode(
    providerId: string,
    authEnv: AuthEnv,
  ): Promise<AuthConfigureResult> {
    await this.stopProxyIfRunning(this.copilotProxy, 'Copilot');
    this.logger.info(`[${this.name}] Configuring OAuth provider: Kimi Code`);
    // Watch first, so a later `kimi login` re-initializes the adapter even
    // when no credential exists yet.
    this.kimiCodeAuth.startWatching();
    // A failed refresh is not fatal: the stored key may still serve.
    await this.kimiCodeAuth.ensureFresh();
    const status = await this.kimiCodeAuth.getStatus();
    if (status.credentialSource === 'none') {
      this.logger.warn(
        `[${this.name}] Kimi Code has no CLI login and no stored API key`,
      );
      return {
        configured: false,
        details: [],
        errorMessage: kimiCodeUnavailableMessage(
          status.stale ? 'stale' : 'signed-out',
        ),
      };
    }

    let proxyUrl: string;
    try {
      const running = this.kimiCodeProxy.isRunning()
        ? this.kimiCodeProxy.getUrl()
        : undefined;
      proxyUrl = running ?? (await this.kimiCodeProxy.start()).url;
    } catch (error) {
      this.sentryService.captureException(
        error instanceof Error ? error : new Error(String(error)),
        {
          errorSource: 'OAuthProxyStrategy.configureKimiCode',
          activeProvider: providerId,
        },
      );
      this.logger.error(
        `[${this.name}] Failed to start Kimi Code proxy`,
        error instanceof Error ? error : new Error(String(error)),
      );
      return {
        configured: false,
        details: [],
        errorMessage:
          'Failed to start Kimi Code proxy. Check if a local port is available.',
      };
    }
    authEnv.ANTHROPIC_BASE_URL = proxyUrl;
    authEnv.ANTHROPIC_AUTH_TOKEN = KIMI_CODE_PROXY_TOKEN_PLACEHOLDER;
    authEnv.ANTHROPIC_API_KEY = '';
    process.env['ANTHROPIC_BASE_URL'] = proxyUrl;
    process.env['ANTHROPIC_AUTH_TOKEN'] = KIMI_CODE_PROXY_TOKEN_PLACEHOLDER;
    delete process.env['ANTHROPIC_API_KEY'];
    this.providerModels.switchActiveProvider(providerId);
    seedStaticModelPricing(providerId);

    const source =
      status.credentialSource === 'cli-login'
        ? 'Kimi Code CLI sign-in'
        : 'Kimi Code API key';
    this.logger.info(
      `[${this.name}] Using Kimi Code via proxy (${proxyUrl}); credential source: ${status.credentialSource}`,
    );
    return {
      configured: true,
      details: [`Kimi Code (${source} via local proxy at ${proxyUrl})`],
    };
  }

  /**
   * Configure GitHub Copilot OAuth authentication.
   * Uses VS Code GitHub authentication and the Copilot translation proxy.
   */
  private async configureCopilotOAuth(
    providerId: string,
    authEnv: AuthEnv,
  ): Promise<AuthConfigureResult> {
    this.logger.info(
      `[${this.name}] Configuring OAuth provider: GitHub Copilot`,
    );
    const isAuthed = await this.copilotAuth.isAuthenticated();
    if (!isAuthed) {
      this.logger.info(
        `[${this.name}] GitHub Copilot not authenticated, attempting silent restore...`,
      );
      const restored = await this.copilotAuth.tryRestoreAuth();
      if (!restored) {
        this.logger.info(
          `[${this.name}] GitHub Copilot silent restore failed - user can connect via Settings`,
        );
        return {
          configured: false,
          details: [],
          errorMessage:
            'GitHub Copilot is not authenticated. Connect via Settings > Authentication.',
        };
      }
    }
    let proxyUrl: string;
    try {
      if (this.copilotProxy.isRunning()) {
        proxyUrl = this.copilotProxy.getUrl() ?? '';
        if (!proxyUrl) {
          this.logger.error(
            `[${this.name}] Proxy reports running but returned no URL`,
          );
          return {
            configured: false,
            details: [],
            errorMessage: 'Translation proxy URL unavailable. Try restarting.',
          };
        }
        this.logger.info(
          `[${this.name}] Translation proxy already running at ${proxyUrl}`,
        );
      } else {
        const result = await this.copilotProxy.start();
        proxyUrl = result.url;
        this.logger.info(
          `[${this.name}] Translation proxy started at ${proxyUrl}`,
        );
      }
    } catch (error) {
      this.sentryService.captureException(
        error instanceof Error ? error : new Error(String(error)),
        {
          errorSource: 'OAuthProxyStrategy.configureCopilotOAuth',
          activeProvider: providerId,
        },
      );
      this.logger.error(
        `[${this.name}] Failed to start translation proxy: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        configured: false,
        details: [],
        errorMessage:
          'Failed to start Copilot translation proxy. Check if the port is available.',
      };
    }
    authEnv.ANTHROPIC_BASE_URL = proxyUrl;
    authEnv.ANTHROPIC_AUTH_TOKEN = COPILOT_PROXY_TOKEN_PLACEHOLDER;
    process.env['ANTHROPIC_BASE_URL'] = proxyUrl;
    process.env['ANTHROPIC_AUTH_TOKEN'] = COPILOT_PROXY_TOKEN_PLACEHOLDER;
    this.providerModels.switchActiveProvider(providerId);
    seedStaticModelPricing(providerId);

    this.logger.info(
      `[${this.name}] Using GitHub Copilot via translation proxy (${proxyUrl})`,
    );
    this.logger.info(
      `[${this.name}] Set ANTHROPIC_BASE_URL=${proxyUrl}, ANTHROPIC_AUTH_TOKEN=<proxy-managed>`,
    );

    return {
      configured: true,
      details: [`GitHub Copilot (OAuth via translation proxy at ${proxyUrl})`],
    };
  }

  /**
   * Configure OpenAI Codex OAuth authentication.
   * Native authentication is owned by the runtime. Legacy requests fail explicitly.
   */
  private async configureCodexOAuth(
    context: AuthConfigureContext,
  ): Promise<AuthConfigureResult> {
    const { operationContext } = context;
    if (resolveCodexProxyPolicy(operationContext) === 'native-return') {
      return {
        configured: false,
        details: ['Codex authentication is owned by the native runtime.'],
      };
    }

    await this.stopProxyIfRunning(this.copilotProxy, 'Copilot');
    return {
      configured: false,
      details: [],
      errorMessage: 'Codex chat requires a host with the native Codex runtime.',
    };
  }

  /**
   * Stop a translation proxy if it's running.
   */
  private async stopProxyIfRunning(
    proxy: { isRunning(): boolean; stop(): Promise<void> },
    proxyName: string,
  ): Promise<void> {
    if (proxy.isRunning()) {
      this.logger.info(
        `[${this.name}] Stopping ${proxyName} proxy (switching to different provider)`,
      );
      try {
        await proxy.stop();
      } catch (error) {
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'OAuthProxyStrategy.stopProxyIfRunning' },
        );
        this.logger.warn(
          `[${this.name}] Failed to stop ${proxyName} proxy: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}
