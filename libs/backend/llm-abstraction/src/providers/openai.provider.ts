import { Result } from '@ptah-extension/shared';
import { BaseLlmProvider } from './base-llm.provider';
import { LlmProviderError } from '../errors/llm-provider.error';
import { LlmCompletionConfig } from '../interfaces/llm-provider.interface';
import { ChatOpenAI, type ChatOpenAICallOptions } from '@langchain/openai';
import { z } from 'zod';
import { retryWithBackoff } from '@ptah-extension/shared';
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import { type Runnable } from '@langchain/core/runnables';

/**
 * OpenAI GPT provider implementation.
 * Supports GPT-4, GPT-3.5-turbo, and other OpenAI models.
 *
 * Features:
 * - Variable context windows (4K-128K depending on model)
 * - Structured output via withStructuredOutput()
 * - Token counting via model's getNumTokens()
 * - Automatic retry with exponential backoff
 */
export class OpenAIProvider extends BaseLlmProvider {
  public readonly name = 'openai';
  private model: ChatOpenAI;

  constructor(
    private readonly apiKey: string,
    private readonly modelName: string,
    private readonly temperature: number = 0.7,
    private readonly maxTokens?: number
  ) {
    super();

    // Set context size based on model
    this.defaultContextSize = this._getDefaultContextSizeForModel(modelName);

    // Initialize ChatOpenAI model
    this.model = new ChatOpenAI({
      openAIApiKey: this.apiKey,
      modelName: this.modelName,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
    });
  }

  /**
   * Get default context window size for known OpenAI models.
   * @private
   */
  private _getDefaultContextSizeForModel(modelName: string): number {
    if (modelName.includes('gpt-4-turbo')) return 128000;
    if (modelName.includes('gpt-4-32k')) return 32768;
    if (
      modelName.includes('gpt-4') &&
      !modelName.includes('gpt-4-turbo') &&
      !modelName.includes('gpt-4-32k')
    )
      return 8192;
    if (modelName.includes('gpt-3.5-turbo-16k')) return 16385;
    if (modelName.includes('gpt-3.5-turbo-0125')) return 16385;
    if (modelName.includes('gpt-3.5-turbo-1106')) return 16385;
    if (modelName.includes('gpt-3.5-turbo-instruct')) return 4096;
    if (modelName.includes('gpt-3.5-turbo')) return 4096;
    return 4096; // Fallback for unknown models
  }

  async getCompletion(
    systemPrompt: string,
    userPrompt: string
  ): Promise<Result<string, LlmProviderError>> {
    try {
      const response = await this.model.predict(
        `${systemPrompt}\n\nUser Input: ${userPrompt}`
      );
      return Result.ok(response);
    } catch (error) {
      return Result.err(LlmProviderError.fromError(error, this.name));
    }
  }

  async getContextWindowSize(): Promise<number> {
    return this.defaultContextSize;
  }

  async countTokens(text: string): Promise<number> {
    try {
      // Use the model's built-in getNumTokens method
      const tokenCount = await this.model.getNumTokens(text);
      return tokenCount;
    } catch (error) {
      // Fallback to approximation if getNumTokens fails
      return Math.ceil(text.length / 4);
    }
  }

  async getStructuredCompletion<T extends z.ZodTypeAny>(
    prompt: BaseLanguageModelInput,
    schema: T,
    completionConfig?: LlmCompletionConfig
  ): Promise<Result<z.infer<T>, LlmProviderError>> {
    // Validate input token count
    const promptAsStringForValidation =
      typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
    const validationResult = await this._validateInputTokens(
      promptAsStringForValidation,
      completionConfig
    );
    if (validationResult.isErr()) {
      return Result.err(validationResult.error!);
    }

    // Create structured model with optional bind options
    let runnableToInvoke: Runnable<
      BaseLanguageModelInput,
      z.infer<T>
    > = this.model.withStructuredOutput(schema, {
      name:
        schema.description || `extract_${schema.constructor?.name || 'data'}`,
    });

    const bindOptions: any = {};
    const runtimeCallOptions: Partial<ChatOpenAICallOptions> = {};

    if (completionConfig) {
      if (completionConfig.temperature !== undefined)
        bindOptions.temperature = completionConfig.temperature;
      if (completionConfig.maxTokens !== undefined)
        bindOptions.maxTokens = completionConfig.maxTokens;
      if (completionConfig.topP !== undefined)
        bindOptions.topP = completionConfig.topP;
      if (completionConfig.presencePenalty !== undefined)
        bindOptions.presencePenalty = completionConfig.presencePenalty;
      if (completionConfig.frequencyPenalty !== undefined)
        bindOptions.frequencyPenalty = completionConfig.frequencyPenalty;
      if (
        completionConfig.stopSequences &&
        completionConfig.stopSequences.length > 0
      ) {
        runtimeCallOptions.stop = completionConfig.stopSequences;
      }
    }

    if (Object.keys(bindOptions).length > 0) {
      runnableToInvoke = runnableToInvoke.bind(bindOptions);
    }

    // Perform call with retry
    try {
      const response = await this._performStructuredCallWithRetry(
        runnableToInvoke,
        prompt,
        runtimeCallOptions
      );
      return Result.ok(response);
    } catch (error) {
      if (error instanceof LlmProviderError) {
        return Result.err(error);
      }
      return Result.err(LlmProviderError.fromError(error, this.name));
    }
  }

  /**
   * Validate that input tokens don't exceed context window.
   * @private
   */
  private async _validateInputTokens(
    prompt: string,
    completionConfig?: LlmCompletionConfig
  ): Promise<Result<void, LlmProviderError>> {
    try {
      const currentInputTokens = await this.countTokens(prompt);
      const maxOutputTokens =
        completionConfig?.maxTokens ?? this.maxTokens ?? 2048;
      const modelContextWindow = this.defaultContextSize;

      // Apply token margin override if provided
      const tokenMargin = completionConfig?.tokenMarginOverride ?? 1.0;
      const availableForInput = Math.floor(
        (modelContextWindow - maxOutputTokens) * tokenMargin
      );

      if (currentInputTokens > availableForInput) {
        const errorMsg = `Input prompt (${currentInputTokens} tokens) for OpenAI structured completion exceeds model's available input token limit (${availableForInput} tokens). Model: ${this.modelName}, Total Context: ${modelContextWindow}, Reserved for Output: ${maxOutputTokens}.`;
        return Result.err(
          new LlmProviderError(errorMsg, 'CONTEXT_LENGTH_EXCEEDED', this.name)
        );
      }
      return Result.ok(undefined);
    } catch (validationError) {
      const message = `Error during pre-call token validation in OpenAIProvider: ${
        validationError instanceof Error
          ? validationError.message
          : String(validationError)
      }`;
      return Result.err(
        new LlmProviderError(message, 'UNKNOWN_ERROR', this.name, {
          cause: validationError,
        })
      );
    }
  }

  /**
   * Perform structured call with automatic retry on transient errors.
   * @private
   */
  private async _performStructuredCallWithRetry<TOutput>(
    structuredModel: Runnable<BaseLanguageModelInput, TOutput>,
    prompt: BaseLanguageModelInput,
    callOptions?: Partial<ChatOpenAICallOptions>
  ): Promise<TOutput> {
    const RETRY_OPTIONS = {
      retries: 3,
      initialDelay: 1000,
      maxDelay: 30000,
      factor: 2,
      shouldRetry: (error: any): boolean => {
        const status = error?.status ?? error?.response?.status;
        if (
          status === 429 ||
          status === 500 ||
          status === 502 ||
          status === 503 ||
          status === 504
        ) {
          return true; // Retry on rate limit, server errors
        }
        const oaiErrorData = error?.response?.data?.error || error?.error;
        const oaiErrorCode = oaiErrorData?.code;
        if (
          oaiErrorCode === 'rate_limit_exceeded' ||
          oaiErrorCode === 'insufficient_quota'
        ) {
          return true;
        }
        return false;
      },
    };

    return retryWithBackoff(async () => {
      const response = await structuredModel.invoke(prompt, callOptions);
      return response;
    }, RETRY_OPTIONS);
  }
}
