import { Result } from '@ptah-extension/shared';
import { BaseLlmProvider } from './base-llm.provider';
import { LlmProviderError } from '../errors/llm-provider.error';
import { LlmCompletionConfig } from '../interfaces/llm-provider.interface';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { z } from 'zod';
import { retryWithBackoff } from '@ptah-extension/shared';
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';

/**
 * Google Gemini provider implementation.
 * Supports Gemini Pro, Gemini Pro Vision models.
 *
 * Features:
 * - Large context window (32K tokens for Gemini Pro)
 * - Structured output via withStructuredOutput()
 * - Token counting approximation
 * - Automatic retry with exponential backoff
 */
export class GoogleGenAIProvider extends BaseLlmProvider {
  public readonly name = 'google-genai';
  private model: ChatGoogleGenerativeAI;

  constructor(
    private readonly apiKey: string,
    private readonly modelName: string,
    private readonly temperature = 0.7,
    private readonly maxOutputTokens?: number
  ) {
    super();
    this.defaultContextSize = 32000; // Gemini Pro context window

    // Initialize ChatGoogleGenerativeAI model
    this.model = new ChatGoogleGenerativeAI({
      apiKey: this.apiKey,
      model: this.modelName,
      temperature: this.temperature,
      maxOutputTokens: this.maxOutputTokens,
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

  override async getContextWindowSize(): Promise<number> {
    return this.defaultContextSize;
  }

  override async countTokens(text: string): Promise<number> {
    // Google Gemini doesn't provide easy token counting API
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
          bindOptions.maxOutputTokens = completionConfig.maxTokens;
        if (completionConfig.topP !== undefined)
          bindOptions.topP = completionConfig.topP;

        if (Object.keys(bindOptions).length > 0) {
          modelToInvoke = modelToInvoke.bind(
            bindOptions
          ) as ChatGoogleGenerativeAI;
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
          if (status === 429 || status === 500 || status === 503) {
            return true; // Retry on rate limit, server errors
          }
          return false;
        },
      };

      const response = await retryWithBackoff(
        () => structuredModel.invoke(prompt),
        RETRY_OPTIONS
      );

      return Result.ok(response) as unknown as Result<
        z.infer<T>,
        LlmProviderError
      >;
    } catch (error) {
      if (error instanceof LlmProviderError) {
        return Result.err(error);
      }
      return Result.err(LlmProviderError.fromError(error, this.name));
    }
  }
}
