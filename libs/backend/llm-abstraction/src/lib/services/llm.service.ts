import { injectable, inject } from 'tsyringe';
import { z } from 'zod';
import { Mutex } from 'async-mutex';
import { Result } from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  ILlmService,
  ILlmProvider,
  LlmCompletionConfig,
  LlmPromptInput,
} from '../interfaces/llm-provider.interface';
import { LlmProviderError } from '../errors/llm-provider.error';
import { ProviderRegistry } from '../registry/provider-registry';
import { LlmConfigurationService } from './llm-configuration.service';
import { LlmProviderName } from '../types/provider-types';

/**
 * Main LLM service for Ptah.
 * Orchestrates provider selection and LLM operations.
 *
 * API keys are managed via LlmSecretsService (VS Code SecretStorage).
 * Model defaults are configured via VS Code settings.
 *
 * Error Handling Pattern (TASK_2025_073 Batch 3):
 * - Public methods return Result<T, LlmProviderError>
 * - Internal methods may throw (caught at public boundary)
 * - All errors wrapped in LlmProviderError with appropriate codes
 *
 * Usage:
 * ```typescript
 * const llmService = container.resolve<LlmService>(TOKENS.LLM_SERVICE);
 *
 * // Set provider with default model
 * await llmService.setProviderByName('vscode-lm');
 *
 * // Or specify model explicitly
 * await llmService.setProvider('vscode-lm', 'claude-sonnet-4-20250514');
 *
 * // Simple completion
 * const result = await llmService.getCompletion(
 *   'You are a helpful assistant',
 *   'Explain TypeScript generics'
 * );
 *
 * // Structured completion with schema
 * const schema = z.object({
 *   summary: z.string(),
 *   keyPoints: z.array(z.string())
 * });
 * const structuredResult = await llmService.getStructuredCompletion(
 *   'Analyze this code...',
 *   schema
 * );
 * ```
 */
@injectable()
export class LlmService implements ILlmService {
  private currentProvider: ILlmProvider | null = null;
  private currentProviderName: LlmProviderName | null = null;
  private currentModel: string | null = null;
  private isInitialized = false;
  private readonly providerMutex = new Mutex();

  constructor(
    @inject(TOKENS.PROVIDER_REGISTRY)
    private readonly providerRegistry: ProviderRegistry,
    @inject(TOKENS.LLM_CONFIGURATION_SERVICE)
    private readonly configService: LlmConfigurationService,
    @inject(TOKENS.LOGGER) private readonly logger: Logger
  ) {
    this.logger.info('[LlmService.constructor] LlmService initialized');
    // Schedule eager initialization (non-blocking)
    void this.initializeDefaultProvider();
  }

  /**
   * Initialize with default provider (vscode-lm, no API key needed)
   * Called automatically on construction for eager initialization.
   *
   * TASK_2025_073 Batch 2: Eager initialization to avoid nullable currentProvider
   */
  private async initializeDefaultProvider(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      const defaultProvider = this.configService.getDefaultProvider();
      const defaultModel = this.configService.getDefaultModel(defaultProvider);

      this.logger.debug('[LlmService.initializeDefaultProvider] Starting', {
        provider: defaultProvider,
        model: defaultModel,
      });

      const result = await this.setProvider(defaultProvider, defaultModel);

      if (result.isOk()) {
        this.isInitialized = true;
        this.logger.info(
          '[LlmService.initializeDefaultProvider] Default provider initialized',
          {
            provider: defaultProvider,
            model: defaultModel,
          }
        );
      } else {
        this.logger.warn(
          '[LlmService.initializeDefaultProvider] Failed to initialize default provider',
          {
            error: result.error?.message,
          }
        );
      }
    } catch (error) {
      this.logger.warn(
        '[LlmService.initializeDefaultProvider] Exception during initialization',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  /**
   * Ensure provider is available before operations
   * Attempts lazy initialization if not already initialized.
   *
   * TASK_2025_073 Batch 2: Error recovery logic
   */
  private async ensureProvider(): Promise<
    Result<ILlmProvider, LlmProviderError>
  > {
    if (this.currentProvider) {
      return Result.ok(this.currentProvider);
    }

    // Try to initialize if not done
    this.logger.debug(
      '[LlmService.ensureProvider] No provider available, attempting initialization'
    );
    await this.initializeDefaultProvider();

    if (this.currentProvider) {
      return Result.ok(this.currentProvider);
    }

    return Result.err(
      new LlmProviderError(
        'No LLM provider configured. Call setProvider() first or configure API keys.',
        'PROVIDER_NOT_INITIALIZED',
        'LlmService'
      )
    );
  }

  /**
   * Set the current LLM provider with a specific model.
   *
   * Uses mutex lock to prevent race conditions during provider switching.
   * Previous provider is preserved on error for recovery.
   * API key is retrieved automatically from SecretStorage.
   *
   * TASK_2025_073 Batch 2: Thread-safe provider switching with mutex lock
   *
   * @param providerName - Provider name (vscode-lm)
   * @param model - Model identifier to use (e.g., 'claude-sonnet-4-20250514')
   * @returns Promise of Result with void on success, or LlmProviderError on failure
   *
   * @example
   * ```typescript
   * const result = await llmService.setProvider('vscode-lm', 'claude-sonnet-4-20250514');
   * if (result.isErr()) {
   *   console.error('Failed to set provider:', result.error.message);
   * }
   * ```
   */
  public async setProvider(
    providerName: LlmProviderName,
    model: string
  ): Promise<Result<void, LlmProviderError>> {
    // Acquire lock to prevent concurrent provider switching
    return this.providerMutex.runExclusive(async () => {
      const previousProvider = this.currentProvider;
      const previousProviderName = this.currentProviderName;
      const previousModel = this.currentModel;

      this.logger.debug('[LlmService.setProvider] Acquiring lock', {
        providerName,
        model,
        hasPrevious: !!previousProvider,
      });

      const result = await this.providerRegistry.createProvider(
        providerName,
        model
      );

      if (result.isErr()) {
        // Preserve previous provider on error (don't leave in broken state)
        this.logger.warn(
          '[LlmService.setProvider] Provider creation failed, preserving previous',
          {
            providerName,
            model,
            error: result.error?.message,
            preservedProvider: previousProviderName,
            preservedModel: previousModel,
          }
        );
        const err = result.error ?? new LlmProviderError('Unknown provider creation error', 'UNKNOWN_ERROR', providerName);
        return Result.err(err);
      }

      this.currentProvider = result.value ?? null;
      this.currentProviderName = providerName;
      this.currentModel = model;

      this.logger.info(
        '[LlmService.setProvider] Provider switched successfully',
        {
          providerName,
          model,
        }
      );

      return Result.ok(undefined);
    });
  }

  /**
   * Set the current LLM provider using default model from settings.
   *
   * This is a convenience method that uses LlmConfigurationService for model lookup.
   * Default models are configured via VS Code settings or fall back to built-in defaults.
   *
   * @param providerName - Provider name (vscode-lm)
   * @returns Promise of Result with void on success, or LlmProviderError on failure
   *
   * @example
   * ```typescript
   * const result = await llmService.setProviderByName('vscode-lm');
   * // Uses default model from settings (e.g., 'claude-sonnet-4-20250514')
   * ```
   */
  public async setProviderByName(
    providerName: LlmProviderName
  ): Promise<Result<void, LlmProviderError>> {
    const model = this.configService.getDefaultModel(providerName);
    this.logger.debug(
      '[LlmService.setProviderByName] Starting provider switch',
      {
        providerName,
        model,
      }
    );
    return this.setProvider(providerName, model);
  }

  /**
   * Initialize with the default provider from settings.
   *
   * Uses the default provider and model from VS Code settings.
   * Falls back to 'vscode-lm' if no default provider is configured.
   *
   * @returns Promise of Result with void on success, or LlmProviderError on failure
   *
   * @example
   * ```typescript
   * const result = await llmService.initializeDefault();
   * if (result.isOk()) {
   *   console.log('LLM service initialized with default provider');
   * }
   * ```
   */
  public async initializeDefault(): Promise<Result<void, LlmProviderError>> {
    const defaultProvider = this.configService.getDefaultProvider();
    this.logger.debug(
      '[LlmService.initializeDefault] Starting initialization',
      {
        provider: defaultProvider,
      }
    );
    return this.setProviderByName(defaultProvider);
  }

  /**
   * Check if a provider is currently set.
   *
   * @returns true if a provider is configured and ready to use, false otherwise
   *
   * @example
   * ```typescript
   * if (llmService.hasProvider()) {
   *   const response = await llmService.getCompletion('system', 'user prompt');
   * } else {
   *   await llmService.setProvider('vscode-lm', 'claude-sonnet-4-20250514');
   * }
   * ```
   */
  public hasProvider(): boolean {
    return this.currentProvider !== null;
  }

  /**
   * Get a text completion from the current LLM provider.
   *
   * Automatically ensures provider is initialized before making the request.
   * If no provider is set, attempts lazy initialization with default provider.
   *
   * TASK_2025_073 Batch 2: Uses ensureProvider() for error recovery
   *
   * @param systemPrompt - System-level instruction (sets context/behavior)
   * @param userPrompt - User's actual prompt/question
   * @returns Result containing completion text on success, or LlmProviderError on failure
   *
   * @example
   * ```typescript
   * const result = await llmService.getCompletion(
   *   'You are a helpful TypeScript expert',
   *   'Explain generics in TypeScript'
   * );
   * if (result.isOk()) {
   *   console.log(result.value); // "Generics in TypeScript allow..."
   * }
   * ```
   */
  async getCompletion(
    systemPrompt: string,
    userPrompt: string
  ): Promise<Result<string, LlmProviderError>> {
    try {
      const providerResult = await this.ensureProvider();
      if (providerResult.isErr()) {
        this.logger.error('[LlmService.getCompletion] Failed to get provider', {
          error: providerResult.error?.message,
        });
        const providerErr = providerResult.error ?? new LlmProviderError('Failed to get provider', 'PROVIDER_NOT_INITIALIZED', 'LlmService');
        return Result.err(
          LlmProviderError.fromError(providerErr, 'unknown')
        );
      }

      const provider = providerResult.value;
      if (!provider) {
        return Result.err(new LlmProviderError('Provider is unexpectedly undefined', 'UNKNOWN_ERROR', 'LlmService'));
      }
      const completionResult = await provider.getCompletion(
        systemPrompt,
        userPrompt
      );

      if (completionResult.isErr()) {
        this.logger.error('[LlmService.getCompletion] Completion failed', {
          error: completionResult.error?.message,
        });
        const completionErr = completionResult.error ?? new LlmProviderError('Completion failed', 'UNKNOWN_ERROR', 'LlmService');
        return Result.err(completionErr);
      }

      this.logger.debug('[LlmService.getCompletion] Successful', {
        chars: completionResult.value?.length ?? 0,
      });
      return completionResult;
    } catch (error) {
      this.logger.error('[LlmService.getCompletion] Exception', {
        error: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof LlmProviderError) return Result.err(error);
      return Result.err(LlmProviderError.fromError(error, 'LlmService'));
    }
  }

  /**
   * Get a structured completion that conforms to a Zod schema.
   *
   * Uses provider-native JSON mode to enforce schema compliance.
   * Returns fully typed, validated object matching the provided Zod schema.
   * Automatically ensures provider is initialized before making the request.
   *
   * TASK_2025_073 Batch 2: Uses ensureProvider() for error recovery
   *
   * @param prompt - The prompt to send to the LLM
   * @param schema - Zod schema defining expected output structure
   * @param completionConfig - Optional completion parameters (temperature, maxTokens, etc.)
   * @returns Result containing parsed, type-safe object on success, or LlmProviderError on failure
   *
   * @example
   * ```typescript
   * const schema = z.object({
   *   summary: z.string(),
   *   keyPoints: z.array(z.string())
   * });
   * const result = await llmService.getStructuredCompletion(
   *   'Analyze this code...',
   *   schema
   * );
   * if (result.isOk()) {
   *   console.log(result.value.summary); // Fully typed!
   * }
   * ```
   */
  async getStructuredCompletion<T extends z.ZodTypeAny>(
    prompt: LlmPromptInput,
    schema: T,
    completionConfig?: LlmCompletionConfig
  ): Promise<Result<z.infer<T>, LlmProviderError>> {
    try {
      const providerResult = await this.ensureProvider();
      if (providerResult.isErr()) {
        this.logger.error(
          '[LlmService.getStructuredCompletion] Failed to get provider',
          {
            error: providerResult.error?.message,
          }
        );
        const providerErr = providerResult.error ?? new LlmProviderError('Failed to get provider', 'PROVIDER_NOT_INITIALIZED', 'LlmService');
        return Result.err(
          LlmProviderError.fromError(providerErr, 'unknown')
        );
      }

      const provider = providerResult.value;
      if (!provider) {
        return Result.err(new LlmProviderError('Provider is unexpectedly undefined', 'UNKNOWN_ERROR', 'LlmService'));
      }
      const result = await provider.getStructuredCompletion(
        prompt,
        schema,
        completionConfig
      );

      if (result.isErr()) {
        this.logger.error(
          '[LlmService.getStructuredCompletion] Completion failed',
          {
            error: result.error?.message,
          }
        );
      } else {
        this.logger.debug('[LlmService.getStructuredCompletion] Successful');
      }

      return result;
    } catch (error) {
      this.logger.error('[LlmService.getStructuredCompletion] Exception', {
        error: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof LlmProviderError) return Result.err(error);
      return Result.err(LlmProviderError.fromError(error, 'LlmService'));
    }
  }

  /**
   * Get the context window size for the current model.
   *
   * Returns the maximum number of tokens the model can process in a single request.
   * Returns 0 if no provider is configured or provider lookup fails.
   *
   * TASK_2025_073 Batch 2: Uses ensureProvider() for error recovery
   *
   * @returns Context window size in tokens (e.g., 200000 for Claude Sonnet 4)
   *
   * @example
   * ```typescript
   * const contextWindow = await llmService.getModelContextWindow();
   * console.log(`Model can process ${contextWindow} tokens`);
   * ```
   */
  async getModelContextWindow(): Promise<number> {
    const providerResult = await this.ensureProvider();
    if (providerResult.isErr()) {
      this.logger.error(
        '[LlmService.getModelContextWindow] Failed to get provider',
        {
          error: providerResult.error?.message,
        }
      );
      return 0;
    }
    const provider = providerResult.value;
    if (!provider) {
      return 0;
    }
    return provider.getContextWindowSize();
  }

  /**
   * Count tokens in a given text.
   *
   * Uses the current provider's tokenizer to accurately count tokens.
   * Useful for checking if text fits within context window.
   * Returns 0 if no provider is configured or counting fails.
   *
   * TASK_2025_073 Batch 2: Uses ensureProvider() for error recovery
   *
   * @param text - Text to count tokens for
   * @returns Token count (e.g., 150 tokens)
   *
   * @example
   * ```typescript
   * const tokenCount = await llmService.countTokens('Hello, world!');
   * const contextWindow = await llmService.getModelContextWindow();
   * if (tokenCount < contextWindow) {
   *   console.log('Text fits within context window');
   * }
   * ```
   */
  async countTokens(text: string): Promise<number> {
    const providerResult = await this.ensureProvider();
    if (providerResult.isErr()) {
      this.logger.error('[LlmService.countTokens] Failed to get provider', {
        error: providerResult.error?.message,
      });
      return 0;
    }
    const provider = providerResult.value;
    if (!provider) {
      return 0;
    }
    return provider.countTokens(text);
  }

  /**
   * Get the current LLM provider instance.
   *
   * Returns the low-level provider interface for advanced usage.
   * Most applications should use higher-level methods (getCompletion, getStructuredCompletion).
   *
   * TASK_2025_073 Batch 2: Fixed error code to PROVIDER_NOT_INITIALIZED
   *
   * @returns Result containing ILlmProvider instance on success, or Error on failure
   *
   * @example
   * ```typescript
   * const result = await llmService.getProvider();
   * if (result.isOk()) {
   *   const provider = result.value;
   *   // Use low-level provider API directly
   * }
   * ```
   */
  async getProvider(): Promise<Result<ILlmProvider, Error>> {
    if (!this.currentProvider) {
      const message = 'No LLM provider configured. Call setProvider() first.';
      this.logger.error('[LlmService.getProvider] No provider configured');
      return Result.err(
        new LlmProviderError(message, 'PROVIDER_NOT_INITIALIZED', 'LlmService')
      );
    }
    return Result.ok(this.currentProvider);
  }
}
