import { z } from 'zod';
import { Result } from '@ptah-extension/shared';
import {
  ILlmProvider,
  LlmCompletionConfig,
  LlmPromptInput,
} from '../interfaces/llm-provider.interface';
import { LlmProviderError } from '../errors/llm-provider.error';

/**
 * Abstract base class for all LLM providers.
 * Extended by the VS Code LM provider.
 *
 * Provides default implementations for context window and token counting.
 * Subclasses must implement getCompletion and getStructuredCompletion.
 */
export abstract class BaseLlmProvider implements ILlmProvider {
  abstract readonly name: string;
  protected defaultContextSize = 4096;

  /**
   * Get a text completion from the LLM provider.
   * Must be implemented by subclasses.
   * @param systemPrompt The system prompt to use
   * @param userPrompt The user prompt to use
   * @returns Promise resolving to a Result containing either the completion or an error
   */
  abstract getCompletion(
    systemPrompt: string,
    userPrompt: string
  ): Promise<Result<string, LlmProviderError>>;

  /**
   * Get a structured completion that conforms to a Zod schema.
   * Must be implemented by subclasses.
   * @param prompt The prompt to send
   * @param schema Zod schema defining expected output structure
   * @param completionConfig Optional completion parameters
   * @returns Promise resolving to a Result containing parsed object or error
   */
  abstract getStructuredCompletion<T extends z.ZodTypeAny>(
    prompt: LlmPromptInput,
    schema: T,
    completionConfig?: LlmCompletionConfig
  ): Promise<Result<z.infer<T>, LlmProviderError>>;

  /**
   * Get the maximum context window size for the model.
   * Default implementation returns the defaultContextSize.
   * Subclasses should override if they know the exact context window.
   * @returns Promise resolving to the context window size in tokens
   */
  async getContextWindowSize(): Promise<number> {
    return this.defaultContextSize;
  }

  /**
   * Count the number of tokens in a text string.
   * Default implementation uses simple approximation (text.length / 4).
   * Subclasses should override with provider-specific tokenizer if available.
   * @param text The text to count tokens for
   * @returns Promise resolving to the token count
   */
  async countTokens(text: string): Promise<number> {
    // Simple approximation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * List available models for this provider (optional).
   * Subclasses can implement this if the provider supports model listing.
   * @returns Promise resolving to a Result containing model IDs or error
   */
  async listModels?(): Promise<Result<string[], LlmProviderError>>;
}
