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
 * - openai (GPT-4o via native OpenAI SDK)
 * - google-genai (Gemini via native @google/genai SDK)
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
   *
   * Only loads the provider module when actually needed (lazy loading).
   * Provider factories are cached for subsequent creations.
   * Automatically retrieves API keys from SecretStorage.
   * Times out after 30 seconds if provider creation hangs.
   *
   * TASK_2025_073 Batch 3: Added timeout protection (30s default)
   *
   * @param providerName - Name of the provider (openai, google-genai, vscode-lm)
   * @param model - Model identifier to use (e.g., 'gpt-4o', 'gemini-2.5-flash')
   * @param timeoutMs - Optional timeout in milliseconds (default: 30000)
   * @returns Result containing ILlmProvider instance on success, or LlmProviderError on failure
   *
   * @example
   * ```typescript
   * const result = await registry.createProvider('openai', 'gpt-4o');
   * if (result.isOk()) {
   *   const provider = result.value;
   *   await provider.getCompletion('system', 'user prompt');
   * }
   * ```
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
   *
   * Checks SecretStorage for configured API keys.
   * vscode-lm is always included (no API key needed).
   *
   * @returns Array of provider names with configured keys (e.g., ['vscode-lm', 'openai'])
   *
   * @example
   * ```typescript
   * const available = await registry.getAvailableProviders();
   * console.log(`Available providers: ${available.join(', ')}`);
   * ```
   */
  public async getAvailableProviders(): Promise<LlmProviderName[]> {
    return this.secrets.getConfiguredProviders();
  }

  /**
   * Check if a specific provider is available (has API key configured).
   *
   * Checks SecretStorage for the provider's API key.
   * vscode-lm always returns true (no API key needed).
   *
   * @param providerName - Provider name to check (openai, google-genai, vscode-lm)
   * @returns true if provider is available, false otherwise
   *
   * @example
   * ```typescript
   * if (await registry.isProviderAvailable('openai')) {
   *   await registry.createProvider('openai', 'gpt-4o');
   * } else {
   *   console.error('OpenAI API key not configured');
   * }
   * ```
   */
  public async isProviderAvailable(
    providerName: LlmProviderName
  ): Promise<boolean> {
    return this.secrets.hasApiKey(providerName);
  }

  /**
   * Get list of all supported providers (regardless of API key configuration).
   *
   * Returns all providers supported by the registry, even if API keys are not configured.
   *
   * @returns Readonly array of all supported provider names
   *
   * @example
   * ```typescript
   * const supported = registry.getSupportedProviders();
   * console.log(`Supported: ${supported.join(', ')}`);
   * // "Supported: openai, google-genai, vscode-lm"
   * ```
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
      this.logger.debug(
        '[ProviderRegistry.getOrLoadFactory] Using cached factory',
        {
          provider: providerName,
        }
      );
      return Result.ok(this.loadedFactories.get(providerName)!);
    }

    // Dynamically load factory
    try {
      this.logger.debug(
        '[ProviderRegistry.getOrLoadFactory] Dynamically loading provider',
        {
          provider: providerName,
        }
      );

      const factory = await this.loadProviderFactory(providerName);
      this.loadedFactories.set(providerName, factory);

      this.logger.info(
        '[ProviderRegistry.getOrLoadFactory] Provider module loaded successfully',
        {
          provider: providerName,
        }
      );

      return Result.ok(factory);
    } catch (error) {
      this.logger.error(
        '[ProviderRegistry.getOrLoadFactory] Failed to load provider module',
        {
          provider: providerName,
          error,
        }
      );
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
