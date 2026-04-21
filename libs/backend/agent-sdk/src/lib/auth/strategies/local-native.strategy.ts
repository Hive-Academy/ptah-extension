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
import {
  Logger,
  ConfigManager,
  TOKENS,
  IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import type {
  IAuthStrategy,
  AuthConfigureResult,
  AuthConfigureContext,
} from '../auth-strategy.types';
import { SDK_TOKENS } from '../../di/tokens';
import type { ProviderModelsService } from '../../provider-models.service';
import type { OllamaModelDiscoveryService } from '../../local-provider/ollama-model-discovery.service';
import type { OllamaCloudMetadataService } from '../../local-provider/ollama-cloud-metadata.service';
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
    @inject(SDK_TOKENS.SDK_OLLAMA_CLOUD_METADATA)
    private readonly cloudMetadata: OllamaCloudMetadataService,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private readonly authSecrets: IAuthSecretsService,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
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
    } catch (versionError) {
      this.sentryService.captureException(
        versionError instanceof Error
          ? versionError
          : new Error(String(versionError)),
        {
          errorSource: 'LocalNativeStrategy.configure',
          activeProvider: providerId,
        },
      );
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
      this.sentryService.captureException(
        modelError instanceof Error
          ? modelError
          : new Error(String(modelError)),
        {
          errorSource: 'LocalNativeStrategy.configure',
          activeProvider: providerId,
        },
      );
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

    // Step 5: For ollama-cloud, kick off a metadata refresh
    // (TASK_OLLAMA_CLOUD_KEY). Reads the optional API key from SecretStorage
    // via IAuthSecretsService.getProviderKey('ollama-cloud') — same slot the
    // auth UI writes to via auth:saveSettings, so saving/replacing/clearing the
    // key in the settings panel automatically triggers a fresh metadata fetch
    // here on the next sdkAdapter.reset() (which auth:saveSettings awaits) or
    // on the SecretStorage 'ptah.auth.*' change notification handled by
    // ConfigWatcher. Cache is also explicitly cleared to drop any stale tags
    // or pricing from a prior key. Inference is unaffected and proceeds
    // immediately via localhost:11434.
    if (providerId === 'ollama-cloud') {
      const apiKey = (
        (await this.authSecrets.getProviderKey('ollama-cloud')) ?? ''
      ).trim();
      if (apiKey.length > 0) {
        this.cloudMetadata.refresh(apiKey).then(
          () => {
            this.logger.debug(
              `[${this.name}] Ollama Cloud metadata refresh complete`,
            );
          },
          (err) => {
            this.logger.warn(
              `[${this.name}] Ollama Cloud metadata refresh failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          },
        );
      } else {
        // No key configured — drop any cached tags/pricing from a prior key.
        this.cloudMetadata.clearCache();
        this.logger.debug(
          `[${this.name}] No Ollama Cloud API key configured — skipping live metadata fetch (using static catalog + zero-cost pricing fallback)`,
        );
      }
    }

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
    // Clear Ollama Cloud metadata cache (TASK_OLLAMA_CLOUD_KEY)
    this.cloudMetadata.clearCache();
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
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'LocalNativeStrategy.stopProxyIfRunning' },
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
