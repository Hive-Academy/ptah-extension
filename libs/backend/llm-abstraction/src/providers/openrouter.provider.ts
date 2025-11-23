import { Result } from '@ptah-extension/shared';
import { BaseLlmProvider } from './base-llm.provider';
import { LlmProviderError } from '../errors/llm-provider.error';
import { LlmCompletionConfig } from '../interfaces/llm-provider.interface';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { retryWithBackoff } from '@ptah-extension/shared';
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';

/**
 * OpenRouter provider implementation.
 * OpenRouter provides access to multiple models (Claude, GPT-4, Llama, etc.)
 * via a unified API compatible with OpenAI SDK.
 *
 * Features:
 * - Access to multiple model providers
 * - OpenAI-compatible API
 * - Structured output via withStructuredOutput()
 * - Automatic retry with exponential backoff
 */
export class OpenRouterProvider extends BaseLlmProvider {
  public readonly name = 'openrouter';
  private model: ChatOpenAI;

  constructor(
    private readonly apiKey: string,
    private readonly modelName: string,
    private readonly temperature: number = 0.7,
    private readonly maxTokens?: number
  ) {
    super();
    this.defaultContextSize = 8192; // Default, varies by model

    // Initialize ChatOpenAI model with OpenRouter base URL
    this.model = new ChatOpenAI({
      openAIApiKey: this.apiKey,
      modelName: this.modelName,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      configuration: {
        baseURL: 'https://openrouter.ai/api/v1',
      },
    });
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
    // OpenRouter doesn't provide direct token counting
    // Use approximation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  async getStructuredCompletion<T extends z.ZodTypeAny>(
    prompt: BaseLanguageModelInput,
    schema: T,
    completionConfig?: LlmCompletionConfig
  ): Promise<Result<z.infer<T>, LlmProviderError>> {
    try {
      // Apply per-call configurations if any
      let modelToInvoke = this.model;
      if (completionConfig) {
        const bindOptions: any = {};
        if (completionConfig.temperature !== undefined)
          bindOptions.temperature = completionConfig.temperature;
        if (completionConfig.maxTokens !== undefined)
          bindOptions.maxTokens = completionConfig.maxTokens;
        if (completionConfig.topP !== undefined)
          bindOptions.topP = completionConfig.topP;

        if (Object.keys(bindOptions).length > 0) {
          modelToInvoke = modelToInvoke.bind(bindOptions) as ChatOpenAI;
        }
      }

      const structuredModel = modelToInvoke.withStructuredOutput(schema, {
        name:
          schema.description || `extract_${schema.constructor?.name || 'data'}`,
      });

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
            status === 503
          ) {
            return true; // Retry on rate limit, server errors
          }
          return false;
        },
      };

      const response = await retryWithBackoff(
        () => structuredModel.invoke(prompt),
        RETRY_OPTIONS
      );

      return Result.ok(response);
    } catch (error) {
      if (error instanceof LlmProviderError) {
        return Result.err(error);
      }
      return Result.err(LlmProviderError.fromError(error, this.name));
    }
  }
}
