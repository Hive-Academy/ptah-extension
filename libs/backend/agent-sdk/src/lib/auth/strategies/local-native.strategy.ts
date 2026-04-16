/**
 * Local Native Strategy - TASK_AUTH_REFACTOR Phase 2
 *
 * Handles authentication for local Anthropic-native providers:
 * - Ollama (local models, v0.14.0+ with native Anthropic Messages API)
 * - Ollama Cloud (cloud models via local Ollama proxy)
 *
 * These providers speak the Anthropic protocol natively - no translation proxy needed.
 *
 * Extracted from AuthManager.configureOllamaProvider().
 */

import { injectable, inject } from 'tsyringe';
import { Logger, ConfigManager, TOKENS } from '@ptah-extension/vscode-core';
import type {
  IAuthStrategy,
  AuthConfigureResult,
  AuthConfigureContext,
} from '../auth-strategy.types';
import { SDK_TOKENS } from '../../di/tokens';
import type { ProviderModelsService } from '../../provider-models.service';
import type { OllamaModelDiscoveryService } from '../../local-provider/ollama-model-discovery.service';
import type { ICopilotTranslationProxy } from '../../copilot-provider/copilot-provider.types';
import type { ITranslationProxy } from '../../openai-translation';
import type { LocalModelTranslationProxy } from '../../local-provider/local-model-translation-proxy';
import { OLLAMA_AUTH_TOKEN_PLACEHOLDER } from '../../local-provider';
import { getProviderBaseUrl } from '../../helpers/anthropic-provider-registry';

@injectable()
export class LocalNativeStrategy implements IAuthStrategy {
  readonly name = 'LocalNativeStrategy';

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private readonly config: ConfigManager,
    @inject(SDK_TOKENS.SDK_OLLAMA_DISCOVERY)
    private readonly ollamaDiscovery: OllamaModelDiscoveryService,
    @inject(SDK_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService,
    // Inject other proxies to stop them during cross-provider switching
    @inject(SDK_TOKENS.SDK_COPILOT_PROXY)
    private readonly copilotProxy: ICopilotTranslationProxy,
    @inject(SDK_TOKENS.SDK_CODEX_PROXY)
    private readonly codexProxy: ITranslationProxy,
    @inject(SDK_TOKENS.SDK_LM_STUDIO_PROXY)
    private readonly lmStudioProxy: LocalModelTranslationProxy,
  ) {}

  async configure(context: AuthConfigureContext): Promise<AuthConfigureResult> {
    const { providerId, authEnv } = context;

    this.logger.info(
      `[${this.name}] Configuring Ollama provider: ${providerId} (Anthropic-native)`,
    );

    // Step 1: Stop all other proxies to prevent cross-contamination
    await this.stopProxyIfRunning(this.copilotProxy, 'Copilot');
    await this.stopProxyIfRunning(this.codexProxy, 'Codex');
    await this.stopProxyIfRunning(this.lmStudioProxy, 'LM Studio');

    // Step 2: Get the base URL (custom or default from provider entry)
    const customUrl = this.config.get<string>(`provider.${providerId}.baseUrl`);
    const baseUrl = customUrl?.trim() || getProviderBaseUrl(providerId);

    // Step 2.5: Version check - verify Ollama v0.14.0+ for Anthropic API support
    try {
      const { version, supported } =
        await this.ollamaDiscovery.checkVersion(providerId);

      if (!supported) {
        this.logger.warn(
          `[${this.name}] Ollama v${version} does not support Anthropic Messages API. Minimum: v0.14.0.`,
        );
        return {
          configured: false,
          details: [],
          errorMessage: `Ollama v${version} is too old. Please upgrade to v0.14.0+ for Anthropic API support (download from ollama.com/download).`,
        };
      }

      this.logger.info(
        `[${this.name}] Ollama v${version} - Anthropic Messages API supported`,
      );
    } catch {
      this.logger.warn(
        `[${this.name}] Ollama server not reachable at ${baseUrl}. Ensure Ollama is running.`,
      );
      return {
        configured: false,
        details: [],
        errorMessage: `Ollama is not reachable at ${baseUrl}. Ensure Ollama is running.`,
      };
    }

    // Step 2.6: Model availability check (non-fatal)
    try {
      const models =
        providerId === 'ollama-cloud'
          ? await this.ollamaDiscovery.listCloudModels()
          : await this.ollamaDiscovery.listLocalModels();

      if (providerId === 'ollama-cloud' && models.length === 0) {
        this.logger.warn(
          `[${this.name}] Ollama Cloud: no cloud models found. Run "ollama signin" to authenticate with Ollama Cloud.`,
        );
      }
    } catch (modelError) {
      this.logger.warn(
        `[${this.name}] Failed to list Ollama models: ${
          modelError instanceof Error ? modelError.message : String(modelError)
        }`,
      );
      // Non-fatal: proceed with configuration even if model listing fails
    }

    // Step 3: Point SDK directly at Ollama (no proxy)
    authEnv.ANTHROPIC_BASE_URL = baseUrl;
    authEnv.ANTHROPIC_AUTH_TOKEN = OLLAMA_AUTH_TOKEN_PLACEHOLDER;
    process.env['ANTHROPIC_BASE_URL'] = baseUrl;
    process.env['ANTHROPIC_AUTH_TOKEN'] = OLLAMA_AUTH_TOKEN_PLACEHOLDER;

    // Step 4: Apply tier mappings and register dynamic model fetcher
    this.providerModels.switchActiveProvider(providerId);

    // Register the appropriate model fetcher (local vs cloud)
    if (providerId === 'ollama-cloud') {
      this.providerModels.registerDynamicFetcher(providerId, () =>
        this.ollamaDiscovery.listCloudModels(),
      );
    } else {
      this.providerModels.registerDynamicFetcher(providerId, () =>
        this.ollamaDiscovery.listLocalModels(),
      );
    }

    const providerName =
      providerId === 'ollama-cloud' ? 'Ollama Cloud' : 'Ollama';

    this.logger.info(
      `[${this.name}] Using ${providerName} (Anthropic-native at ${baseUrl})`,
    );
    this.logger.info(
      `[${this.name}] Set ANTHROPIC_BASE_URL=${baseUrl}, ANTHROPIC_AUTH_TOKEN=<ollama>`,
    );

    return {
      configured: true,
      details: [`${providerName} (Anthropic-native at ${baseUrl})`],
    };
  }

  async teardown(): Promise<void> {
    // Clear Ollama model discovery cache
    this.ollamaDiscovery.clearCache();
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
        `[${this.name}] Stopping ${proxyName} proxy (switching to Ollama provider)`,
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
