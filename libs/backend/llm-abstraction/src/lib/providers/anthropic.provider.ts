import { Result } from '@ptah-extension/shared';
import { BaseLlmProvider } from './base-llm.provider';
import { LlmProviderError } from '../errors/llm-provider.error';
import { LlmCompletionConfig } from '../interfaces/llm-provider.interface';
import { ChatAnthropic, type AnthropicInput } from '@langchain/anthropic';
import { z } from 'zod';
import { retryWithBackoff } from '@ptah-extension/shared';
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';

type AnthropicTokenCountResponse = {
  total_tokens: number;
};

/**
 * Anthropic Claude provider implementation.
 * Supports Claude 3.5 Sonnet, Claude 3 Opus, Claude 3 Haiku models.
 *
 * Features:
 * - Large context window (100K tokens)
 * - Structured output via withStructuredOutput()
 * - Token counting via Anthropic API
 * - Automatic retry with exponential backoff
 */
export class AnthropicProvider extends BaseLlmProvider {
  public readonly name = 'anthropic';
  private model: ChatAnthropic;

  constructor(
    private readonly apiKey: string,
    private readonly modelName: string,
    private readonly temperature = 0.7,
    private readonly maxTokens?: number
  ) {
    super();
    this.defaultContextSize = 100000; // Claude has a large context window

    // Initialize ChatAnthropic model
    this.model = new ChatAnthropic({
      apiKey: this.apiKey,
      modelName: this.modelName,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
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
    try {
      const response = await fetch(
        'https://api.anthropic.com/v1/messages/count_tokens',
        {
          method: 'POST',
          headers: {
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.modelName,
            text: text,
          }),
        }
      );

      if (!response.ok) {
        // Fall back to approximation if API fails
        return Math.ceil(text.length / 4);
      }

      const data = (await response.json()) as AnthropicTokenCountResponse;
      const tokenCount = data?.total_tokens || Math.ceil(text.length / 4);
      return tokenCount;
    } catch (error) {
      // Fall back to approximation on error
      return Math.ceil(text.length / 4);
    }
  }

  async getStructuredCompletion<T extends z.ZodTypeAny>(
    prompt: BaseLanguageModelInput,
    schema: T,
    completionConfig?: LlmCompletionConfig
  ): Promise<Result<z.infer<T>, LlmProviderError>> {
    // Validate input token count
    const validationResult = await this._validateInputTokens(
      prompt,
      completionConfig
    );
    if (validationResult.isErr()) {
      return Result.err(validationResult.error!);
    }

    // Perform structured call with retry
    const callResult = await this._performStructuredCallWithRetry(
      prompt,
      schema,
      completionConfig
    );
    if (callResult.isErr()) {
      return Result.err(callResult.error!);
    }
    return Result.ok(callResult.value);
  }

  /**
   * Validate that input tokens don't exceed context window.
   * @private
   */
  private async _validateInputTokens(
    prompt: BaseLanguageModelInput,
    completionConfig?: LlmCompletionConfig
  ): Promise<Result<void, LlmProviderError>> {
    // Extract string from prompt for token counting
    let promptStringForTokenCount: string;
    if (typeof prompt === 'string') {
      promptStringForTokenCount = prompt;
    } else if (Array.isArray(prompt)) {
      promptStringForTokenCount = prompt
        .map((msgLike) => {
          if (typeof msgLike === 'string') return msgLike;
          if (
            Array.isArray(msgLike) &&
            msgLike.length === 2 &&
            typeof msgLike[1] === 'string'
          )
            return msgLike[1];
          if (
            typeof msgLike === 'object' &&
            msgLike !== null &&
            'content' in msgLike &&
            typeof msgLike.content === 'string'
          )
            return msgLike.content;
          return '';
        })
        .filter((content) => !!content)
        .join('\n');
    } else if (
      typeof prompt === 'object' &&
      prompt !== null &&
      'content' in prompt &&
      typeof prompt.content === 'string'
    ) {
      promptStringForTokenCount = prompt.content;
    } else {
      try {
        if (typeof (prompt as any)?.toChatMessages === 'function') {
          const messages = (prompt as any).toChatMessages();
          promptStringForTokenCount = messages
            .map((m: any) => (typeof m.content === 'string' ? m.content : ''))
            .filter((c: string) => !!c)
            .join('\n');
        } else if (
          typeof (prompt as any)?.toString === 'function' &&
          (prompt as any).toString() !== '[object Object]'
        ) {
          promptStringForTokenCount = (prompt as any).toString();
        } else {
          promptStringForTokenCount = JSON.stringify(prompt);
        }
      } catch (e) {
        promptStringForTokenCount = '';
      }
    }

    try {
      const currentInputTokens = await this.countTokens(
        promptStringForTokenCount
      );
      const maxOutputTokensForThisCall =
        completionConfig?.maxTokens ?? this.maxTokens ?? 2048;
      const limit = this.defaultContextSize;

      // Apply token margin override if provided
      const tokenMargin = completionConfig?.tokenMarginOverride ?? 1.0;
      const availableForInput = Math.floor(
        (limit - maxOutputTokensForThisCall) * tokenMargin
      );

      if (currentInputTokens > availableForInput) {
        const errorMsg = `Input (${currentInputTokens} tokens) for Anthropic structured completion exceeds model's available input token limit (${availableForInput}). Model: ${this.modelName}, Total Context: ${limit}, Reserved for Output: ${maxOutputTokensForThisCall}.`;
        return Result.err(
          new LlmProviderError(errorMsg, 'CONTEXT_LENGTH_EXCEEDED', this.name)
        );
      }
      return Result.ok(undefined);
    } catch (validationError) {
      const message = `Error during pre-call token validation in AnthropicProvider: ${
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
  private async _performStructuredCallWithRetry<T extends z.ZodTypeAny>(
    prompt: BaseLanguageModelInput,
    schema: T,
    completionConfig?: LlmCompletionConfig
  ): Promise<Result<z.infer<T>, LlmProviderError>> {
    try {
      let modelToInvoke = this.model;

      // Apply per-call configurations if any
      const bindOptions: Partial<AnthropicInput> = {};
      if (completionConfig) {
        if (completionConfig.temperature !== undefined)
          bindOptions.temperature = completionConfig.temperature;
        if (completionConfig.maxTokens !== undefined)
          bindOptions.maxTokens = completionConfig.maxTokens;
        if (completionConfig.topP !== undefined)
          bindOptions.topP = completionConfig.topP;
      }

      if (Object.keys(bindOptions).length > 0) {
        modelToInvoke = modelToInvoke.bind(bindOptions) as ChatAnthropic;
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
            status === 503 ||
            status === 529
          ) {
            return true; // Retry on rate limit, server errors, overload
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
      const err = error instanceof Error ? error : new Error(String(error));
      if (error instanceof LlmProviderError) {
        return Result.err(error);
      }
      return Result.err(LlmProviderError.fromError(err, this.name));
    }
  }
}
