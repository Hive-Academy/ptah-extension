/**
 * Local Native Strategy
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
import { AUTH_PROVIDERS_TOKENS } from '../../di/tokens';
import type { ProviderModelsService } from '../../provider-models.service';
import type { OllamaModelDiscoveryService } from '../../providers/local/ollama-model-discovery.service';
import type { OllamaCloudMetadataService } from '../../providers/local/ollama-cloud-metadata.service';
import type { ICopilotTranslationProxy } from '../../providers/copilot/copilot-provider.types';
import type { ITranslationProxy } from '../../translation';
import type { LocalModelTranslationProxy } from '../../providers/local/local-model-translation-proxy';
import { OLLAMA_AUTH_TOKEN_PLACEHOLDER } from '../../providers/local';
import { getProviderBaseUrl } from '@ptah-extension/shared';

@injectable()
export class LocalNativeStrategy implements IAuthStrategy {
  readonly name = 'LocalNativeStrategy';

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private readonly config: ConfigManager,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_OLLAMA_DISCOVERY)
    private readonly ollamaDiscovery: OllamaModelDiscoveryService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_COPILOT_PROXY)
    private readonly copilotProxy: ICopilotTranslationProxy,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_PROXY)
    private readonly codexProxy: ITranslationProxy,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_LM_STUDIO_PROXY)
    private readonly lmStudioProxy: LocalModelTranslationProxy,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_OLLAMA_CLOUD_METADATA)
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
    await this.stopProxyIfRunning(this.copilotProxy, 'Copilot');
    await this.stopProxyIfRunning(this.codexProxy, 'Codex');
    await this.stopProxyIfRunning(this.lmStudioProxy, 'LM Studio');
    const customUrl = this.config.get<string>(`provider.${providerId}.baseUrl`);
    const baseUrl = customUrl?.trim() || getProviderBaseUrl(providerId);
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
    }
    authEnv.ANTHROPIC_BASE_URL = baseUrl;
    authEnv.ANTHROPIC_AUTH_TOKEN = OLLAMA_AUTH_TOKEN_PLACEHOLDER;
    process.env['ANTHROPIC_BASE_URL'] = baseUrl;
    process.env['ANTHROPIC_AUTH_TOKEN'] = OLLAMA_AUTH_TOKEN_PLACEHOLDER;
    this.providerModels.switchActiveProvider(providerId);
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
        this.cloudMetadata.clearCache();
        this.logger.debug(
          `[${this.name}] No Ollama Cloud API key configured â€” skipping live metadata fetch (using static catalog + zero-cost pricing fallback)`,
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
    this.ollamaDiscovery.clearCache();
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
