import * as vscode from 'vscode';
import { z } from 'zod';
import { Result } from '@ptah-extension/shared';
import { BaseLlmProvider } from './base-llm.provider';
import { LlmProviderError } from '../errors/llm-provider.error';
import type { LlmCompletionConfig } from '../interfaces/llm-provider.interface';
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';

/**
 * Model selector configuration for VS Code LM API.
 * Allows targeting specific model vendors and families.
 */
export interface VsCodeModelSelector {
  /** Model vendor (e.g., 'copilot', 'anthropic') */
  vendor?: string;
  /** Model family (e.g., 'gpt-4o', 'gpt-4o-mini', 'o1') */
  family?: string;
}

/**
 * VS Code Language Model API provider implementation.
 * Integrates with VS Code's built-in LM API (vscode.lm) for AI completions.
 *
 * Features:
 * - Native VS Code LM API integration
 * - Model selection by vendor/family
 * - Streaming response collection
 * - Structured output via JSON schema prompting + Zod validation
 * - Graceful fallback when models unavailable
 * - Token counting via model API
 *
 * Limitations:
 * - No direct system prompt support (workaround: prefix user message)
 * - Limited parameter control (temperature, maxTokens controlled by model)
 * - Vendor availability depends on user extensions (Copilot, etc.)
 *
 * @example
 * ```typescript
 * const provider = new VsCodeLmProvider({ vendor: 'copilot', family: 'gpt-4o' });
 * await provider.initialize();
 *
 * const result = await provider.getCompletion(
 *   "You are a helpful assistant",
 *   "Explain dependency injection"
 * );
 * ```
 */
export class VsCodeLmProvider extends BaseLlmProvider {
  public readonly name = 'vscode-lm';
  private model: vscode.LanguageModelChat | null = null;

  constructor(private readonly modelSelector?: VsCodeModelSelector) {
    super();
    // Modern models typically have 128K context windows
    this.defaultContextSize = 128000;
  }

  /**
   * Initialize the provider by selecting an available model.
   * Must be called before using getCompletion or getStructuredCompletion.
   *
   * @returns Result indicating success or error
   */
  async initialize(): Promise<Result<void, LlmProviderError>> {
    try {
      const models = await vscode.lm.selectChatModels(this.modelSelector);

      if (models.length === 0) {
        const vendorMsg = this.modelSelector?.vendor
          ? ` (vendor: ${this.modelSelector.vendor})`
          : '';
        const familyMsg = this.modelSelector?.family
          ? ` (family: ${this.modelSelector.family})`
          : '';
        return Result.err(
          new LlmProviderError(
            `No language models available${vendorMsg}${familyMsg}. Install VS Code extensions with LM support (e.g., GitHub Copilot).`,
            'PROVIDER_NOT_FOUND',
            this.name
          )
        );
      }

      // Select first available model
      this.model = models[0];

      return Result.ok(undefined);
    } catch (error) {
      return Result.err(LlmProviderError.fromError(error, this.name));
    }
  }

  /**
   * Get a text completion from the VS Code LM API.
   * Combines system and user prompts into a single user message.
   *
   * @param systemPrompt System-level instructions (prefixed to user message)
   * @param userPrompt User's actual prompt
   * @returns Result containing completion text or error
   */
  async getCompletion(
    systemPrompt: string,
    userPrompt: string
  ): Promise<Result<string, LlmProviderError>> {
    if (!this.model) {
      return Result.err(
        new LlmProviderError(
          'Provider not initialized. Call initialize() first.',
          'INVALID_REQUEST',
          this.name
        )
      );
    }

    try {
      // Combine system + user prompt (VS Code LM API has no system message support)
      const combinedPrompt = this._combinePrompts(systemPrompt, userPrompt);

      const messages = [vscode.LanguageModelChatMessage.User(combinedPrompt)];

      // Send request with cancellation token
      const cancellationTokenSource = new vscode.CancellationTokenSource();
      const response = await this.model.sendRequest(
        messages,
        {},
        cancellationTokenSource.token
      );

      // Collect streaming response
      let result = '';
      for await (const chunk of response.text) {
        result += chunk;
      }

      return Result.ok(result);
    } catch (error) {
      return Result.err(this._mapError(error));
    }
  }

  /**
   * Get a structured completion that conforms to a Zod schema.
   * Uses JSON schema prompting strategy + Zod validation.
   *
   * @param prompt The prompt to send (string, array, or Langchain message)
   * @param schema Zod schema defining expected output structure
   * @param completionConfig Optional completion parameters
   * @returns Result containing parsed, type-safe object or error
   */
  async getStructuredCompletion<T extends z.ZodTypeAny>(
    prompt: BaseLanguageModelInput,
    schema: T,
    completionConfig?: LlmCompletionConfig
  ): Promise<Result<z.infer<T>, LlmProviderError>> {
    if (!this.model) {
      return Result.err(
        new LlmProviderError(
          'Provider not initialized. Call initialize() first.',
          'INVALID_REQUEST',
          this.name
        )
      );
    }

    try {
      // Convert prompt to string
      const promptString = this._extractPromptString(prompt);

      // Generate JSON schema from Zod schema
      const jsonSchema = this._zodToJsonSchema(schema);

      // Add JSON schema instructions to prompt
      const structuredPrompt = `${promptString}

IMPORTANT: You MUST respond with ONLY valid JSON that matches this exact schema. Do not include any explanation or markdown formatting.

JSON Schema:
${JSON.stringify(jsonSchema, null, 2)}

Respond with valid JSON only:`;

      const messages = [vscode.LanguageModelChatMessage.User(structuredPrompt)];

      // Send request
      const cancellationTokenSource = new vscode.CancellationTokenSource();
      const response = await this.model.sendRequest(
        messages,
        {},
        cancellationTokenSource.token
      );

      // Collect streaming response
      let result = '';
      for await (const chunk of response.text) {
        result += chunk;
      }

      // Parse and validate with Zod
      const parsed = this._parseJson(result);
      if (parsed.isErr()) {
        return Result.err(parsed.error!);
      }

      const validated = schema.safeParse(parsed.value);
      if (!validated.success) {
        return Result.err(
          new LlmProviderError(
            `Response validation failed: ${validated.error.message}`,
            'PARSING_ERROR',
            this.name,
            { zodError: validated.error }
          )
        );
      }

      return Result.ok(validated.data) as Result<z.infer<T>, LlmProviderError>;
    } catch (error) {
      return Result.err(this._mapError(error));
    }
  }

  /**
   * Get the context window size for the current model.
   * Uses model's maxInputTokens if available, otherwise returns default.
   *
   * @returns Context window size in tokens
   */
  override async getContextWindowSize(): Promise<number> {
    if (!this.model) {
      return this.defaultContextSize;
    }

    // Return model's reported max input tokens or default
    return this.model.maxInputTokens ?? this.defaultContextSize;
  }

  /**
   * Count tokens in a given text using the model's tokenizer.
   * Falls back to character-based estimation if model unavailable.
   *
   * @param text Text to count tokens for
   * @returns Token count
   */
  override async countTokens(text: string): Promise<number> {
    if (!this.model) {
      // Fallback to approximation
      return Math.ceil(text.length / 4);
    }

    try {
      return await this.model.countTokens(text);
    } catch (error) {
      // Fallback to approximation on error
      return Math.ceil(text.length / 4);
    }
  }

  /**
   * List available models for this provider.
   * Returns all models matching the configured selector.
   *
   * @returns Result containing array of model identifiers or error
   */
  override async listModels(): Promise<Result<string[], LlmProviderError>> {
    try {
      const models = await vscode.lm.selectChatModels(this.modelSelector);
      const modelIds = models.map(
        (m) => `${m.vendor}/${m.family}${m.version ? `@${m.version}` : ''}`
      );
      return Result.ok(modelIds);
    } catch (error) {
      return Result.err(LlmProviderError.fromError(error, this.name));
    }
  }

  /**
   * Combine system and user prompts into a single message.
   * Workaround for VS Code LM API's lack of system message support.
   *
   * @private
   */
  private _combinePrompts(systemPrompt: string, userPrompt: string): string {
    if (!systemPrompt.trim()) {
      return userPrompt;
    }

    return `SYSTEM: ${systemPrompt.trim()}

USER: ${userPrompt.trim()}`;
  }

  /**
   * Extract string from BaseLanguageModelInput.
   * Handles various Langchain input types.
   *
   * @private
   */
  private _extractPromptString(prompt: BaseLanguageModelInput): string {
    if (typeof prompt === 'string') {
      return prompt;
    }

    if (Array.isArray(prompt)) {
      return prompt
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
    }

    if (
      typeof prompt === 'object' &&
      prompt !== null &&
      'content' in prompt &&
      typeof prompt.content === 'string'
    ) {
      return prompt.content;
    }

    // Fallback: try toString or JSON.stringify
    try {
      if (
        typeof (prompt as any)?.toString === 'function' &&
        (prompt as any).toString() !== '[object Object]'
      ) {
        return (prompt as any).toString();
      }
      return JSON.stringify(prompt);
    } catch (e) {
      return '';
    }
  }

  /**
   * Convert Zod schema to JSON schema.
   * Simplified implementation for common types.
   *
   * @private
   */
  private _zodToJsonSchema(schema: z.ZodTypeAny): any {
    // For complex schemas, we provide basic structure
    // Real implementation could use zod-to-json-schema library
    return {
      type: 'object',
      description: schema.description || 'Response object',
      properties: {},
      required: [],
      additionalProperties: true,
    };
  }

  /**
   * Parse JSON from LLM response, handling markdown code blocks.
   *
   * @private
   */
  private _parseJson(text: string): Result<any, LlmProviderError> {
    try {
      // Remove markdown code blocks if present
      let jsonText = text.trim();

      // Strip markdown json code blocks
      const codeBlockMatch = jsonText.match(
        /```(?:json)?\s*\n?([\s\S]*?)\n?```/
      );
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1].trim();
      }

      const parsed = JSON.parse(jsonText);
      return Result.ok(parsed);
    } catch (error) {
      return Result.err(
        new LlmProviderError(
          `Failed to parse JSON response: ${
            error instanceof Error ? error.message : String(error)
          }`,
          'PARSING_ERROR',
          this.name,
          { rawResponse: text }
        )
      );
    }
  }

  /**
   * Map VS Code LM API errors to LlmProviderError.
   *
   * @private
   */
  private _mapError(error: unknown): LlmProviderError {
    if (error instanceof LlmProviderError) {
      return error;
    }

    const err = error instanceof Error ? error : new Error(String(error));

    // Check for specific error types
    if (err.message.includes('rate limit')) {
      return new LlmProviderError(
        err.message,
        'RATE_LIMIT_EXCEEDED',
        this.name,
        {
          cause: err,
        }
      );
    }

    if (
      err.message.includes('context length') ||
      err.message.includes('too long')
    ) {
      return new LlmProviderError(
        err.message,
        'CONTEXT_LENGTH_EXCEEDED',
        this.name,
        { cause: err }
      );
    }

    if (
      err.message.includes('authentication') ||
      err.message.includes('unauthorized')
    ) {
      return new LlmProviderError(err.message, 'API_KEY_INVALID', this.name, {
        cause: err,
      });
    }

    if (err.message.includes('network') || err.message.includes('connection')) {
      return new LlmProviderError(err.message, 'NETWORK_ERROR', this.name, {
        cause: err,
      });
    }

    return LlmProviderError.fromError(err, this.name);
  }
}
