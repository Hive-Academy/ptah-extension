import OpenAI from 'openai';
import { Result } from '@ptah-extension/shared';
import { retryWithBackoff } from '@ptah-extension/shared';
import { z } from 'zod';
import { BaseLlmProvider } from './base-llm.provider';
import { LlmProviderError } from '../errors/llm-provider.error';
import {
  LlmCompletionConfig,
  LlmPromptInput,
} from '../interfaces/llm-provider.interface';

/**
 * Extract error status from an unknown error object.
 * Uses bracket notation for index signature access (noPropertyAccessFromIndexSignature).
 */
function getErrorStatus(error: unknown): number | undefined {
  if (error == null || typeof error !== 'object') return undefined;
  const err = error as Record<string, unknown>;
  const directStatus = err['status'];
  if (typeof directStatus === 'number') return directStatus;

  const response = err['response'];
  if (response != null && typeof response === 'object') {
    const respStatus = (response as Record<string, unknown>)['status'];
    if (typeof respStatus === 'number') return respStatus;
  }
  return undefined;
}

/**
 * Extract OpenAI-specific error code from an unknown error object.
 */
function getOaiErrorCode(error: unknown): string | undefined {
  if (error == null || typeof error !== 'object') return undefined;
  const err = error as Record<string, unknown>;

  // Check response.data.error.code
  const response = err['response'];
  if (response != null && typeof response === 'object') {
    const data = (response as Record<string, unknown>)['data'];
    if (data != null && typeof data === 'object') {
      const errorObj = (data as Record<string, unknown>)['error'];
      if (errorObj != null && typeof errorObj === 'object') {
        const code = (errorObj as Record<string, unknown>)['code'];
        if (typeof code === 'string') return code;
      }
    }
  }

  // Check error.error.code
  const directError = err['error'];
  if (directError != null && typeof directError === 'object') {
    const code = (directError as Record<string, unknown>)['code'];
    if (typeof code === 'string') return code;
  }

  return undefined;
}

/** Retry configuration for transient API errors. */
const RETRY_OPTIONS = {
  retries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  factor: 2,
  shouldRetry: (error: unknown): boolean => {
    const status = getErrorStatus(error);
    if (
      status === 429 ||
      status === 500 ||
      status === 502 ||
      status === 503 ||
      status === 504
    ) {
      return true;
    }
    const oaiErrorCode = getOaiErrorCode(error);
    return (
      oaiErrorCode === 'rate_limit_exceeded' ||
      oaiErrorCode === 'insufficient_quota'
    );
  },
};

/**
 * OpenAI GPT provider implementation using the native openai SDK.
 *
 * Supports GPT-4o, GPT-4 Turbo, GPT-3.5 Turbo, and other OpenAI models.
 *
 * Features:
 * - Variable context windows (4K-128K depending on model)
 * - Structured output via native JSON Schema mode (response_format)
 * - Token counting approximation (~4 chars per token)
 * - Automatic retry with exponential backoff
 */
export class OpenAIProvider extends BaseLlmProvider {
  public readonly name = 'openai';
  private client: OpenAI;

  constructor(
    private readonly apiKey: string,
    private readonly modelName: string,
    private readonly temperature = 0.7,
    private readonly maxTokens?: number
  ) {
    super();

    this.defaultContextSize = this._getDefaultContextSizeForModel(modelName);

    this.client = new OpenAI({ apiKey: this.apiKey });
  }

  /**
   * Get default context window size for known OpenAI models.
   */
  private _getDefaultContextSizeForModel(modelName: string): number {
    if (modelName.includes('gpt-4o')) return 128000;
    if (modelName.includes('gpt-4-turbo')) return 128000;
    if (modelName.includes('gpt-4-32k')) return 32768;
    if (
      modelName.includes('gpt-4') &&
      !modelName.includes('gpt-4-turbo') &&
      !modelName.includes('gpt-4-32k') &&
      !modelName.includes('gpt-4o')
    )
      return 8192;
    if (modelName.includes('gpt-3.5-turbo-16k')) return 16385;
    if (modelName.includes('gpt-3.5-turbo-0125')) return 16385;
    if (modelName.includes('gpt-3.5-turbo-1106')) return 16385;
    if (modelName.includes('gpt-3.5-turbo-instruct')) return 4096;
    if (modelName.includes('gpt-3.5-turbo')) return 4096;
    if (modelName.includes('o1')) return 200000;
    if (modelName.includes('o3')) return 200000;
    return 4096; // Fallback for unknown models
  }

  /**
   * Get a text completion from OpenAI.
   * Uses the chat completions API with system and user messages.
   */
  async getCompletion(
    systemPrompt: string,
    userPrompt: string
  ): Promise<Result<string, LlmProviderError>> {
    try {
      const response = await retryWithBackoff(
        () =>
          this.client.chat.completions.create({
            model: this.modelName,
            messages: [
              { role: 'system' as const, content: systemPrompt },
              { role: 'user' as const, content: userPrompt },
            ],
            temperature: this.temperature,
            max_tokens: this.maxTokens,
          }),
        RETRY_OPTIONS
      );

      const content = response.choices[0]?.message?.content;
      if (content === undefined || content === null) {
        return Result.err(
          new LlmProviderError(
            'OpenAI returned empty response',
            'PARSING_ERROR',
            this.name
          )
        );
      }

      return Result.ok(content);
    } catch (error) {
      return Result.err(LlmProviderError.fromError(error, this.name));
    }
  }

  override async getContextWindowSize(): Promise<number> {
    return this.defaultContextSize;
  }

  override async countTokens(text: string): Promise<number> {
    // Approximation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Get a structured completion that conforms to a Zod schema.
   * Uses OpenAI's native JSON Schema response format for structured output.
   *
   * @param prompt The prompt to send (string or message array)
   * @param schema Zod schema defining expected output structure
   * @param completionConfig Optional completion parameters
   * @returns Result containing parsed, type-safe object or error
   */
  async getStructuredCompletion<T extends z.ZodTypeAny>(
    prompt: LlmPromptInput,
    schema: T,
    completionConfig?: LlmCompletionConfig
  ): Promise<Result<z.infer<T>, LlmProviderError>> {
    // Validate input token count
    const promptString = this._extractPromptString(prompt);
    const validationResult = await this._validateInputTokens(
      promptString,
      completionConfig
    );
    if (validationResult.isErr()) {
      return Result.err(validationResult.error!);
    }

    try {
      // Build messages from prompt
      const messages = this._buildMessages(prompt);

      // Convert Zod schema to JSON Schema using Zod v4 built-in conversion
      const jsonSchema = z.toJSONSchema(schema);

      // Build completion config overrides
      const temperature = completionConfig?.temperature ?? this.temperature;
      const maxTokens = completionConfig?.maxTokens ?? this.maxTokens;

      const response = await retryWithBackoff(
        () =>
          this.client.chat.completions.create({
            model: this.modelName,
            messages,
            temperature,
            max_tokens: maxTokens,
            top_p: completionConfig?.topP,
            presence_penalty: completionConfig?.presencePenalty,
            frequency_penalty: completionConfig?.frequencyPenalty,
            stop: completionConfig?.stopSequences,
            response_format: {
              type: 'json_schema' as const,
              json_schema: {
                name: schema.description ?? 'result',
                schema: jsonSchema as Record<string, unknown>,
                strict: true,
              },
            },
          }),
        RETRY_OPTIONS
      );

      const content = response.choices[0]?.message?.content;
      if (content === undefined || content === null) {
        return Result.err(
          new LlmProviderError(
            'OpenAI returned empty structured response',
            'PARSING_ERROR',
            this.name
          )
        );
      }

      // Parse JSON and validate against Zod schema
      const parsed = JSON.parse(content);
      const validated = schema.parse(parsed);

      return Result.ok(validated);
    } catch (error) {
      if (error instanceof LlmProviderError) {
        return Result.err(error);
      }
      if (error instanceof z.ZodError) {
        return Result.err(
          new LlmProviderError(
            `Schema validation failed: ${error.message}`,
            'PARSING_ERROR',
            this.name,
            { zodIssues: error.issues }
          )
        );
      }
      if (error instanceof SyntaxError) {
        return Result.err(
          new LlmProviderError(
            `Failed to parse JSON response: ${error.message}`,
            'PARSING_ERROR',
            this.name
          )
        );
      }
      return Result.err(LlmProviderError.fromError(error, this.name));
    }
  }

  /**
   * Validate that input tokens don't exceed context window.
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
   * Build OpenAI chat messages from LlmPromptInput.
   */
  private _buildMessages(
    prompt: LlmPromptInput
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    if (typeof prompt === 'string') {
      return [{ role: 'user', content: prompt }];
    }

    return prompt.map((msg) => ({
      role: (msg.role === 'system'
        ? 'system'
        : msg.role === 'assistant'
          ? 'assistant'
          : 'user') as 'system' | 'user' | 'assistant',
      content: msg.content,
    }));
  }

  /**
   * Extract a string prompt from LlmPromptInput.
   * Used for token counting validation.
   */
  private _extractPromptString(prompt: LlmPromptInput): string {
    if (typeof prompt === 'string') {
      return prompt;
    }
    return prompt.map((msg) => `${msg.role}: ${msg.content}`).join('\n');
  }
}
