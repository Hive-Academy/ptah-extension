import { injectable, inject } from 'tsyringe';
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import { z } from 'zod';
import { Mutex } from 'async-mutex';
import { Result } from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  ILlmService,
  ILlmProvider,
  LlmCompletionConfig,
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
 * await llmService.setProviderByName('anthropic');
 *
 * // Or specify model explicitly
 * await llmService.setProvider('anthropic', 'claude-3-5-sonnet-20241022');
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
   * API key is retrieved automatically from SecretStorage.
   *
   * TASK_2025_073 Batch 2: Thread-safe provider switching with mutex lock
   *
   * @param providerName Provider name (anthropic, openai, google-genai, openrouter, vscode-lm)
   * @param model Model name to use
   * @returns Promise of Result indicating success or error
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
        return Result.err(result.error!);
      }

      this.currentProvider = result.value!;
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
   * This is a convenience method that uses LlmConfigurationService for model lookup.
   *
   * @param providerName Provider name (anthropic, openai, google-genai, openrouter, vscode-lm)
   * @returns Promise of Result indicating success or error
   */
  public async setProviderByName(
    providerName: LlmProviderName
  ): Promise<Result<void, LlmProviderError>> {
    const model = this.configService.getDefaultModel(providerName);
    this.logger.debug('[LlmService] setProviderByName', {
      providerName,
      model,
    });
    return this.setProvider(providerName, model);
  }

  /**
   * Initialize with the default provider from settings.
   * Uses the default provider and model from VS Code settings.
   *
   * @returns Promise of Result indicating success or error
   */
  public async initializeDefault(): Promise<Result<void, LlmProviderError>> {
    const defaultProvider = this.configService.getDefaultProvider();
    this.logger.debug('[LlmService] initializeDefault', {
      provider: defaultProvider,
    });
    return this.setProviderByName(defaultProvider);
  }

  /**
   * Check if a provider is currently set.
   */
  public hasProvider(): boolean {
    return this.currentProvider !== null;
  }

  /**
   * Get a text completion from the current LLM provider.
   *
   * TASK_2025_073 Batch 2: Uses ensureProvider() for error recovery
   *
   * @param systemPrompt System-level instruction
   * @param userPrompt User's actual prompt
   * @returns Result containing completion text or error
   */
  async getCompletion(
    systemPrompt: string,
    userPrompt: string
  ): Promise<Result<string, LlmProviderError>> {
    try {
      const providerResult = await this.ensureProvider();
      if (providerResult.isErr()) {
        this.logger.error('[LlmService.getCompletion] Failed to get provider', {
          error: providerResult.error!.message,
        });
        return Result.err(
          LlmProviderError.fromError(providerResult.error!, 'unknown')
        );
      }

      const provider = providerResult.value!;
      const completionResult = await provider.getCompletion(
        systemPrompt,
        userPrompt
      );

      if (completionResult.isErr()) {
        this.logger.error('[LlmService.getCompletion] Completion failed', {
          error: completionResult.error!.message,
        });
        return Result.err(completionResult.error!);
      }

      this.logger.debug('[LlmService.getCompletion] Successful', {
        chars: completionResult.value!.length,
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
   * TASK_2025_073 Batch 2: Uses ensureProvider() for error recovery
   *
   * @param prompt The prompt to send
   * @param schema Zod schema defining expected output structure
   * @param completionConfig Optional completion parameters
   * @returns Result containing parsed, type-safe object or error
   */
  async getStructuredCompletion<T extends z.ZodTypeAny>(
    prompt: BaseLanguageModelInput,
    schema: T,
    completionConfig?: LlmCompletionConfig
  ): Promise<Result<z.infer<T>, LlmProviderError>> {
    try {
      const providerResult = await this.ensureProvider();
      if (providerResult.isErr()) {
        this.logger.error(
          '[LlmService.getStructuredCompletion] Failed to get provider',
          {
            error: providerResult.error!.message,
          }
        );
        return Result.err(
          LlmProviderError.fromError(providerResult.error!, 'unknown')
        );
      }

      const provider = providerResult.value!;
      const result = await provider.getStructuredCompletion(
        prompt,
        schema,
        completionConfig
      );

      if (result.isErr()) {
        this.logger.error(
          '[LlmService.getStructuredCompletion] Completion failed',
          {
            error: result.error!.message,
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
   * TASK_2025_073 Batch 2: Uses ensureProvider() for error recovery
   *
   * @returns Context window size in tokens
   */
  async getModelContextWindow(): Promise<number> {
    const providerResult = await this.ensureProvider();
    if (providerResult.isErr()) {
      this.logger.error(
        '[LlmService.getModelContextWindow] Failed to get provider',
        {
          error: providerResult.error!.message,
        }
      );
      return 0;
    }
    return providerResult.value!.getContextWindowSize();
  }

  /**
   * Count tokens in a given text.
   *
   * TASK_2025_073 Batch 2: Uses ensureProvider() for error recovery
   *
   * @param text Text to count tokens for
   * @returns Token count
   */
  async countTokens(text: string): Promise<number> {
    const providerResult = await this.ensureProvider();
    if (providerResult.isErr()) {
      this.logger.error('[LlmService.countTokens] Failed to get provider', {
        error: providerResult.error!.message,
      });
      return 0;
    }
    return providerResult.value!.countTokens(text);
  }

  /**
   * Get the current LLM provider instance.
   *
   * TASK_2025_073 Batch 2: Fixed error code to PROVIDER_NOT_INITIALIZED
   *
   * @returns Result containing provider or error
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
