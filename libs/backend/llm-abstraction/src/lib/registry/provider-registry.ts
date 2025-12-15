/**
 * Provider Registry with Dynamic Loading
 *
 * This registry uses dynamic imports to load providers on-demand.
 * This enables tree-shaking - unused providers are not bundled.
 *
 * @packageDocumentation
 */

import { injectable, inject } from 'tsyringe';
import { Result } from '@ptah-extension/shared';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import {
  ILlmProvider,
  LlmProviderFactory,
} from '../interfaces/llm-provider.interface';
import { LlmProviderError } from '../errors/llm-provider.error';
import {
  LlmProviderName,
  SUPPORTED_PROVIDERS,
  isValidProviderName,
} from '../types/provider-types';
import type { ILlmSecretsService } from '../services/llm-secrets.service';
import { PROVIDER_IMPORT_MAP } from './provider-import-map';

// NO STATIC PROVIDER IMPORTS - they are loaded dynamically

/**
 * Default timeout for provider creation (30 seconds)
 * TASK_2025_073 Batch 3: Timeout protection for provider initialization
 */
const PROVIDER_CREATION_TIMEOUT_MS = 30000;

/**
 * Registry to manage LLM provider factories with dynamic loading.
 * Creates provider instances on-demand, loading provider modules only when needed.
 *
 * Supported providers:
 * - vscode-lm (VS Code Language Model API - no API key needed)
 * - anthropic (Claude)
 * - openai (GPT-4, GPT-3.5-turbo)
 * - google-genai (Gemini)
 * - openrouter (Multi-provider access)
 *
 * Error Handling Pattern (TASK_2025_073 Batch 3):
 * - Public methods return Result<T, LlmProviderError>
 * - Internal methods may throw (caught at public boundary)
 * - All errors wrapped in LlmProviderError with appropriate codes
 */
@injectable()
export class ProviderRegistry {
  /**
   * Cache of loaded factory functions.
   * Factories are loaded once and reused for subsequent provider creations.
   */
  private readonly loadedFactories = new Map<
    LlmProviderName,
    LlmProviderFactory
  >();

  constructor(
    @inject(TOKENS.LLM_SECRETS_SERVICE)
    private readonly secrets: ILlmSecretsService,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger
  ) {
    this.logger.info('[ProviderRegistry] Initialized (lazy loading mode)');
  }

  /**
   * Create a provider instance with timeout protection.
   * Only loads the provider module when actually needed.
   *
   * TASK_2025_073 Batch 3: Added timeout protection (30s default)
   *
   * @param providerName - Name of the provider
   * @param model - Model name to use
   * @param timeoutMs - Optional timeout in milliseconds (default: 30000)
   * @returns Result containing provider instance or error
   */
  public async createProvider(
    providerName: LlmProviderName,
    model: string,
    timeoutMs: number = PROVIDER_CREATION_TIMEOUT_MS
  ): Promise<Result<ILlmProvider, LlmProviderError>> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(
          new LlmProviderError(
            `Provider creation timed out after ${timeoutMs}ms`,
            'PROVIDER_TIMEOUT',
            providerName
          )
        );
      }, timeoutMs);
    });

    try {
      const creationPromise = this.createProviderInternal(providerName, model);
      return await Promise.race([creationPromise, timeoutPromise]);
    } catch (error) {
      if (error instanceof LlmProviderError) {
        return Result.err(error);
      }
      return Result.err(LlmProviderError.fromError(error, providerName));
    }
  }

  /**
   * Internal provider creation logic (extracted for timeout wrapper).
   *
   * TASK_2025_073 Batch 3: Extracted to enable timeout wrapping
   *
   * @param providerName - Name of the provider
   * @param model - Model name to use
   * @returns Result containing provider instance or error
   */
  private async createProviderInternal(
    providerName: LlmProviderName,
    model: string
  ): Promise<Result<ILlmProvider, LlmProviderError>> {
    this.logger.debug('[ProviderRegistry.createProviderInternal] Starting', {
      provider: providerName,
      model,
    });

    // Validate provider name
    if (!this.isValidProvider(providerName)) {
      const msg = `LLM provider '${providerName}' not found. Available: ${SUPPORTED_PROVIDERS.join(
        ', '
      )}`;
      this.logger.warn(
        '[ProviderRegistry.createProviderInternal] Invalid provider',
        { providerName }
      );
      return Result.err(
        new LlmProviderError(msg, 'PROVIDER_NOT_FOUND', 'ProviderRegistry')
      );
    }

    // Check API key (except vscode-lm)
    if (providerName !== 'vscode-lm') {
      const hasKey = await this.secrets.hasApiKey(providerName);
      if (!hasKey) {
        const msg = `No API key configured for ${providerName}. Store API keys using SecretStorage.`;
        this.logger.warn(
          '[ProviderRegistry.createProviderInternal] Missing API key',
          {
            providerName,
          }
        );
        return Result.err(
          new LlmProviderError(msg, 'API_KEY_MISSING', providerName)
        );
      }
    }

    // Get or dynamically load factory
    const factoryResult = await this.getOrLoadFactory(providerName);
    if (factoryResult.isErr()) {
      return Result.err(factoryResult.error!);
    }

    // Get API key and invoke factory
    const apiKey = await this.getApiKeyForProvider(providerName);
    const factory = factoryResult.value!;

    try {
      const result = factory(apiKey, model);
      // Handle both sync and async factories
      const providerResult = result instanceof Promise ? await result : result;

      if (providerResult.isOk()) {
        this.logger.info(
          '[ProviderRegistry.createProviderInternal] Provider created successfully',
          {
            provider: providerName,
            model,
          }
        );
      }

      return providerResult;
    } catch (error) {
      this.logger.error(
        '[ProviderRegistry.createProviderInternal] Provider creation failed',
        {
          provider: providerName,
          error,
        }
      );
      return Result.err(LlmProviderError.fromError(error, providerName));
    }
  }

  /**
   * Get list of providers that have API keys configured.
   * @returns Array of provider names with configured keys
   */
  public async getAvailableProviders(): Promise<LlmProviderName[]> {
    return this.secrets.getConfiguredProviders();
  }

  /**
   * Check if a specific provider is available (has API key configured).
   * @param providerName - Provider name to check
   * @returns true if provider is available
   */
  public async isProviderAvailable(
    providerName: LlmProviderName
  ): Promise<boolean> {
    return this.secrets.hasApiKey(providerName);
  }

  /**
   * Get list of all supported providers (regardless of API key configuration).
   * @returns Array of all supported provider names
   */
  public getSupportedProviders(): readonly LlmProviderName[] {
    return SUPPORTED_PROVIDERS;
  }

  /**
   * Check if a provider name is valid/supported.
   */
  private isValidProvider(name: string): name is LlmProviderName {
    return isValidProviderName(name);
  }

  /**
   * Get cached factory or dynamically load it.
   */
  private async getOrLoadFactory(
    providerName: LlmProviderName
  ): Promise<Result<LlmProviderFactory, LlmProviderError>> {
    // Return cached factory if available
    if (this.loadedFactories.has(providerName)) {
      this.logger.debug('[ProviderRegistry] Using cached factory', {
        provider: providerName,
      });
      return Result.ok(this.loadedFactories.get(providerName)!);
    }

    // Dynamically load factory
    try {
      this.logger.debug('[ProviderRegistry] Dynamically loading provider', {
        provider: providerName,
      });

      const factory = await this.loadProviderFactory(providerName);
      this.loadedFactories.set(providerName, factory);

      this.logger.info('[ProviderRegistry] Provider module loaded', {
        provider: providerName,
      });

      return Result.ok(factory);
    } catch (error) {
      this.logger.error('[ProviderRegistry] Failed to load provider module', {
        provider: providerName,
        error,
      });
      return Result.err(LlmProviderError.fromError(error, providerName));
    }
  }

  /**
   * Dynamically load a provider factory module using the type-safe import map.
   * Providers are only loaded when needed, enabling tree-shaking.
   *
   * @param providerName - Provider to load
   * @returns Factory function for creating provider instances
   * @throws Error if provider module fails to load or factory not found
   */
  private async loadProviderFactory(
    providerName: LlmProviderName
  ): Promise<LlmProviderFactory> {
    const factoryLoader = PROVIDER_IMPORT_MAP[providerName];

    if (!factoryLoader) {
      throw new Error(`No import map entry for provider: ${providerName}`);
    }

    return factoryLoader();
  }

  /**
   * Get API key for provider with SecretStorage error handling.
   *
   * TASK_2025_073 Batch 3: Wrap SecretStorage calls in try/catch
   *
   * @param providerName - Provider to get API key for
   * @returns API key string (empty string if vscode-lm or SecretStorage fails)
   * @throws LlmProviderError if SecretStorage access fails
   */
  private async getApiKeyForProvider(
    providerName: LlmProviderName
  ): Promise<string> {
    // VS Code LM doesn't need API key
    if (providerName === 'vscode-lm') {
      return '';
    }

    try {
      const apiKey = await this.secrets.getApiKey(providerName);
      return apiKey ?? '';
    } catch (error) {
      this.logger.error(
        '[ProviderRegistry.getApiKeyForProvider] SecretStorage error',
        {
          providerName,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw new LlmProviderError(
        `Failed to retrieve API key for ${providerName}: SecretStorage error`,
        'SECRET_STORAGE_ERROR',
        providerName,
        { cause: error }
      );
    }
  }
}
