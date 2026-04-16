/**
 * Local Proxy Strategy - TASK_AUTH_REFACTOR Phase 2
 *
 * Handles authentication for local providers that require a translation proxy:
 * - LM Studio (OpenAI-compatible local server + translation proxy)
 *
 * These providers speak the OpenAI protocol and need a translation proxy
 * to convert between Anthropic Messages API and OpenAI Chat Completions API.
 *
 * Extracted from AuthManager.configureLocalProvider().
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
import type { LocalModelTranslationProxy } from '../../local-provider/local-model-translation-proxy';
import type { ICopilotTranslationProxy } from '../../copilot-provider/copilot-provider.types';
import type { ITranslationProxy } from '../../openai-translation';
import { LOCAL_PROXY_TOKEN_PLACEHOLDER } from '../../local-provider';

@injectable()
export class LocalProxyStrategy implements IAuthStrategy {
  readonly name = 'LocalProxyStrategy';

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_LM_STUDIO_PROXY)
    private readonly lmStudioProxy: LocalModelTranslationProxy,
    @inject(SDK_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService,
    // Inject other proxies to stop them during cross-provider switching
    @inject(SDK_TOKENS.SDK_COPILOT_PROXY)
    private readonly copilotProxy: ICopilotTranslationProxy,
    @inject(SDK_TOKENS.SDK_CODEX_PROXY)
    private readonly codexProxy: ITranslationProxy,
  ) {}

  async configure(context: AuthConfigureContext): Promise<AuthConfigureResult> {
    const { providerId, authEnv } = context;

    this.logger.info(`[${this.name}] Configuring local provider: LM Studio`);

    // Step 1: Stop other proxies to prevent cross-contamination
    await this.stopProxyIfRunning(this.copilotProxy, 'Copilot');
    await this.stopProxyIfRunning(this.codexProxy, 'Codex');

    // Step 2: Start the LM Studio translation proxy
    const proxy = this.lmStudioProxy;
    let proxyUrl: string;
    try {
      if (proxy.isRunning()) {
        proxyUrl = proxy.getUrl() ?? '';
        this.logger.info(
          `[${this.name}] LM Studio translation proxy already running at ${proxyUrl}`,
        );
      } else {
        const result = await proxy.start();
        proxyUrl = result.url;
        this.logger.info(
          `[${this.name}] LM Studio translation proxy started at ${proxyUrl}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `[${this.name}] Failed to start LM Studio translation proxy: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        configured: false,
        details: [],
        errorMessage:
          'LM Studio is not running. Start LM Studio and try again.',
      };
    }

    // Step 3: Point SDK at the proxy
    authEnv.ANTHROPIC_BASE_URL = proxyUrl;
    authEnv.ANTHROPIC_AUTH_TOKEN = LOCAL_PROXY_TOKEN_PLACEHOLDER;
    process.env['ANTHROPIC_BASE_URL'] = proxyUrl;
    process.env['ANTHROPIC_AUTH_TOKEN'] = LOCAL_PROXY_TOKEN_PLACEHOLDER;

    // Step 4: Apply tier mappings and register dynamic model fetcher
    this.providerModels.switchActiveProvider(providerId);
    this.providerModels.registerDynamicFetcher(providerId, () =>
      proxy.listModels(),
    );

    this.logger.info(
      `[${this.name}] Using LM Studio via translation proxy (${proxyUrl})`,
    );
    this.logger.info(
      `[${this.name}] Set ANTHROPIC_BASE_URL=${proxyUrl}, ANTHROPIC_AUTH_TOKEN=<proxy-managed>`,
    );

    return {
      configured: true,
      details: [`LM Studio (local via translation proxy at ${proxyUrl})`],
    };
  }

  async teardown(): Promise<void> {
    // Stop LM Studio proxy if running
    await this.stopProxyIfRunning(this.lmStudioProxy, 'LM Studio');
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
        `[${this.name}] Stopping ${proxyName} proxy (switching to LM Studio provider)`,
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
