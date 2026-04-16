/**
 * OAuth Proxy Strategy - TASK_AUTH_REFACTOR Phase 2
 *
 * Handles authentication for OAuth-based providers that require a translation proxy:
 * - GitHub Copilot (VS Code GitHub OAuth + Copilot translation proxy)
 * - OpenAI Codex (file-based auth from ~/.codex/auth.json + Codex translation proxy)
 *
 * Extracted from AuthManager.configureCopilotOAuth() and configureCodexOAuth().
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type {
  IAuthStrategy,
  AuthConfigureResult,
  AuthConfigureContext,
} from '../auth-strategy.types';
import { SDK_TOKENS } from '../../di/tokens';
import type { ProviderModelsService } from '../../provider-models.service';
import type {
  ICopilotAuthService,
  ICopilotTranslationProxy,
} from '../../copilot-provider/copilot-provider.types';
import { COPILOT_PROXY_TOKEN_PLACEHOLDER } from '../../copilot-provider/copilot-provider.types';
import type { ICodexAuthService } from '../../codex-provider/codex-provider.types';
import { CODEX_PROXY_TOKEN_PLACEHOLDER } from '../../codex-provider/codex-provider.types';
import type { ITranslationProxy } from '../../openai-translation';
import { seedStaticModelPricing } from '../../helpers/anthropic-provider-registry';

@injectable()
export class OAuthProxyStrategy implements IAuthStrategy {
  readonly name = 'OAuthProxyStrategy';

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_COPILOT_AUTH)
    private readonly copilotAuth: ICopilotAuthService,
    @inject(SDK_TOKENS.SDK_COPILOT_PROXY)
    private readonly copilotProxy: ICopilotTranslationProxy,
    @inject(SDK_TOKENS.SDK_CODEX_AUTH)
    private readonly codexAuth: ICodexAuthService,
    @inject(SDK_TOKENS.SDK_CODEX_PROXY)
    private readonly codexProxy: ITranslationProxy,
    @inject(SDK_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService,
  ) {}

  async configure(context: AuthConfigureContext): Promise<AuthConfigureResult> {
    const { providerId, authEnv } = context;

    // Determine which OAuth sub-provider to configure
    if (providerId === 'openai-codex') {
      // Stop the Copilot proxy to prevent cross-contamination
      await this.stopProxyIfRunning(this.copilotProxy, 'Copilot');
      return this.configureCodexOAuth(providerId, authEnv);
    }

    // Default: GitHub Copilot flow
    await this.stopProxyIfRunning(this.codexProxy, 'Codex');
    return this.configureCopilotOAuth(providerId, authEnv);
  }

  async teardown(): Promise<void> {
    // Stop both proxies and clear Codex auth cache
    await this.stopProxyIfRunning(this.copilotProxy, 'Copilot');
    await this.stopProxyIfRunning(this.codexProxy, 'Codex');
    this.codexAuth.clearCache();
  }

  /**
   * Configure GitHub Copilot OAuth authentication.
   * Uses VS Code GitHub authentication and the Copilot translation proxy.
   */
  private async configureCopilotOAuth(
    providerId: string,
    authEnv: import('@ptah-extension/shared').AuthEnv,
  ): Promise<AuthConfigureResult> {
    this.logger.info(
      `[${this.name}] Configuring OAuth provider: GitHub Copilot`,
    );

    // Step 1: Check if already authenticated, if not try silent restore
    // IMPORTANT: Do NOT call copilotAuth.login() here. The full login()
    // triggers an interactive device code flow that blocks startup.
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

    // Step 2: Start the translation proxy
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

    // Step 3: Point SDK at the proxy
    authEnv.ANTHROPIC_BASE_URL = proxyUrl;
    authEnv.ANTHROPIC_AUTH_TOKEN = COPILOT_PROXY_TOKEN_PLACEHOLDER;
    process.env['ANTHROPIC_BASE_URL'] = proxyUrl;
    process.env['ANTHROPIC_AUTH_TOKEN'] = COPILOT_PROXY_TOKEN_PLACEHOLDER;

    // Step 4: Apply tier mappings and seed pricing
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
   * Uses file-based auth from ~/.codex/auth.json and the Codex translation proxy.
   */
  private async configureCodexOAuth(
    providerId: string,
    authEnv: import('@ptah-extension/shared').AuthEnv,
  ): Promise<AuthConfigureResult> {
    this.logger.info(`[${this.name}] Configuring OAuth provider: OpenAI Codex`);

    // Step 1: Verify Codex auth and ensure tokens are fresh
    const isAuthed = await this.codexAuth.isAuthenticated();
    if (!isAuthed) {
      this.logger.warn(
        `[${this.name}] OpenAI Codex not authenticated. Run \`codex login\` to authenticate.`,
      );
      return {
        configured: false,
        details: [],
        errorMessage:
          'OpenAI Codex is not authenticated. Run `codex login` in your terminal to set up authentication.',
      };
    }

    const tokensFresh = await this.codexAuth.ensureTokensFresh();
    if (!tokensFresh) {
      this.logger.warn(
        `[${this.name}] OpenAI Codex token refresh failed. Run \`codex login\` to re-authenticate.`,
      );
      return {
        configured: false,
        details: [],
        errorMessage:
          'OpenAI Codex token has expired. Run `codex login` in your terminal to re-authenticate.',
      };
    }

    // Step 2: Start the Codex translation proxy
    let proxyUrl: string;
    try {
      if (this.codexProxy.isRunning()) {
        proxyUrl = this.codexProxy.getUrl() ?? '';
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
          `[${this.name}] Codex translation proxy already running at ${proxyUrl}`,
        );
      } else {
        const result = await this.codexProxy.start();
        proxyUrl = result.url;
        this.logger.info(
          `[${this.name}] Codex translation proxy started at ${proxyUrl}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `[${this.name}] Failed to start Codex translation proxy: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        configured: false,
        details: [],
        errorMessage:
          'Failed to start Codex translation proxy. Check if the port is available.',
      };
    }

    // Step 3: Point SDK at the Codex proxy
    authEnv.ANTHROPIC_BASE_URL = proxyUrl;
    authEnv.ANTHROPIC_AUTH_TOKEN = CODEX_PROXY_TOKEN_PLACEHOLDER;
    process.env['ANTHROPIC_BASE_URL'] = proxyUrl;
    process.env['ANTHROPIC_AUTH_TOKEN'] = CODEX_PROXY_TOKEN_PLACEHOLDER;

    // Step 4: Apply tier mappings and seed pricing
    this.providerModels.switchActiveProvider(providerId);
    seedStaticModelPricing(providerId);

    this.logger.info(
      `[${this.name}] Using OpenAI Codex via translation proxy (${proxyUrl})`,
    );
    this.logger.info(
      `[${this.name}] Set ANTHROPIC_BASE_URL=${proxyUrl}, ANTHROPIC_AUTH_TOKEN=<proxy-managed>`,
    );

    return {
      configured: true,
      details: [`OpenAI Codex (OAuth via translation proxy at ${proxyUrl})`],
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
        this.logger.warn(
          `[${this.name}] Failed to stop ${proxyName} proxy: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}
