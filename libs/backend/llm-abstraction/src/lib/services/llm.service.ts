import { injectable, inject } from 'tsyringe';
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import { z } from 'zod';
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
import { LlmProviderName } from './llm-secrets.service';

/**
 * Main LLM service for Ptah.
 * Orchestrates provider selection and LLM operations.
 *
 * API keys are managed via LlmSecretsService (VS Code SecretStorage).
 * Model defaults are configured via VS Code settings.
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

  constructor(
    @inject(TOKENS.PROVIDER_REGISTRY)
    private readonly providerRegistry: ProviderRegistry,
    @inject(TOKENS.LLM_CONFIGURATION_SERVICE)
    private readonly configService: LlmConfigurationService,
    @inject(TOKENS.LOGGER) private readonly logger: Logger
  ) {
    this.logger.info('LlmService initialized');
  }

  /**
   * Set the current LLM provider with a specific model.
   * API key is retrieved automatically from SecretStorage.
   *
   * @param providerName Provider name (anthropic, openai, google-genai, openrouter, vscode-lm)
   * @param model Model name to use
   * @returns Promise of Result indicating success or error
   */
  public async setProvider(
    providerName: LlmProviderName,
    model: string
  ): Promise<Result<void, LlmProviderError>> {
    this.logger.debug('[LlmService] setProvider', { providerName, model });

    const result = await this.providerRegistry.createProvider(
      providerName,
      model
    );

    if (result.isErr()) {
      this.logger.error(
        `[LlmService] Failed to set provider '${providerName}': ${
          result.error!.message
        }`
      );
      return Result.err(result.error!);
    }

    this.currentProvider = result.value!;
    this.logger.info(
      `[LlmService] Provider set to '${providerName}' with model '${model}'`
    );
    return Result.ok(undefined);
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
   * @param systemPrompt System-level instruction
   * @param userPrompt User's actual prompt
   * @returns Result containing completion text or error
   */
  async getCompletion(
    systemPrompt: string,
    userPrompt: string
  ): Promise<Result<string, LlmProviderError>> {
    try {
      const providerResult = await this.getProvider();
      if (providerResult.isErr()) {
        this.logger.error(
          `Failed to get LLM provider: ${providerResult.error!.message}`
        );
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
        this.logger.error(
          `LLM completion failed: ${completionResult.error!.message}`
        );
        return Result.err(completionResult.error!);
      }

      this.logger.debug(
        `LLM completion successful (${completionResult.value!.length} chars)`
      );
      return completionResult;
    } catch (error) {
      this.logger.error(
        `Error getting completion: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      if (error instanceof LlmProviderError) return Result.err(error);
      return Result.err(LlmProviderError.fromError(error, 'LlmService'));
    }
  }

  /**
   * Get a structured completion that conforms to a Zod schema.
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
      const providerResult = await this.getProvider();
      if (providerResult.isErr()) {
        this.logger.error(
          `Failed to get LLM provider for structured completion: ${
            providerResult.error!.message
          }`
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
          `Structured completion failed: ${result.error!.message}`
        );
      } else {
        this.logger.debug('Structured completion successful');
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Error getting structured completion: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      if (error instanceof LlmProviderError) return Result.err(error);
      return Result.err(LlmProviderError.fromError(error, 'LlmService'));
    }
  }

  /**
   * Get the context window size for the current model.
   * @returns Context window size in tokens
   */
  async getModelContextWindow(): Promise<number> {
    const providerResult = await this.getProvider();
    if (providerResult.isErr()) {
      this.logger.error(
        `Failed to get LLM provider for context window size: ${
          providerResult.error!.message
        }`
      );
      return 0;
    }
    return providerResult.value!.getContextWindowSize();
  }

  /**
   * Count tokens in a given text.
   * @param text Text to count tokens for
   * @returns Token count
   */
  async countTokens(text: string): Promise<number> {
    const providerResult = await this.getProvider();
    if (providerResult.isErr()) {
      this.logger.error(
        `Failed to get LLM provider for token counting: ${
          providerResult.error!.message
        }`
      );
      return 0;
    }
    return providerResult.value!.countTokens(text);
  }

  /**
   * Get the current LLM provider instance.
   * @returns Result containing provider or error
   */
  async getProvider(): Promise<Result<ILlmProvider, Error>> {
    if (!this.currentProvider) {
      const message = 'No LLM provider configured. Call setProvider() first.';
      this.logger.error(message);
      return Result.err(
        new LlmProviderError(message, 'PROVIDER_NOT_FOUND', 'LlmService')
      );
    }
    return Result.ok(this.currentProvider);
  }
}
