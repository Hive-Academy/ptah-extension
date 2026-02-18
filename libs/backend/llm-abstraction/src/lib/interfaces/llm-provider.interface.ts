import { Result } from '@ptah-extension/shared';
import { z } from 'zod';
import { LlmProviderError } from '../errors/llm-provider.error';

/**
 * Native prompt input type replacing Langchain's LlmPromptInput.
 * Supports plain string prompts or structured message arrays.
 */
export type LlmPromptInput = string | Array<{ role: string; content: string }>;

/**
 * LLM completion configuration options.
 * Controls response generation parameters.
 */
export interface LlmCompletionConfig {
  /** Temperature for response generation (0-1) */
  temperature?: number;
  /** Maximum tokens for completion/output */
  maxTokens?: number;
  /** Stop sequences for completion */
  stopSequences?: string[];
  /** Top P sampling (0-1) */
  topP?: number;
  /** Presence penalty (-2.0 to 2.0) */
  presencePenalty?: number;
  /** Frequency penalty (-2.0 to 2.0) */
  frequencyPenalty?: number;
  /** Multiplier for available input tokens (e.g., 2.0 doubles the limit) */
  tokenMarginOverride?: number;
}

/**
 * Core LLM provider abstraction interface.
 * Implemented by all provider adapters (OpenAI, Google, VS Code LM).
 */
export interface ILlmProvider {
  readonly name: string;

  /**
   * Get a text completion from the LLM.
   * @param systemPrompt System-level instruction
   * @param userPrompt User's actual prompt
   * @returns Result containing completion text or error
   */
  getCompletion(
    systemPrompt: string,
    userPrompt: string
  ): Promise<Result<string, LlmProviderError>>;

  /**
   * Get a structured completion that conforms to a Zod schema.
   * Uses provider-native JSON mode for structured output.
   * @param prompt The prompt to send
   * @param schema Zod schema defining expected output structure
   * @param completionConfig Optional completion parameters
   * @returns Result containing parsed, type-safe object or error
   */
  getStructuredCompletion<T extends z.ZodTypeAny>(
    prompt: LlmPromptInput,
    schema: T,
    completionConfig?: LlmCompletionConfig
  ): Promise<Result<z.infer<T>, LlmProviderError>>;

  /**
   * List available models for this provider (optional).
   * @returns Result containing array of model IDs or error
   */
  listModels?(): Promise<Result<string[], LlmProviderError>>;

  /**
   * Get the context window size for the current model.
   * @returns Context window size in tokens
   */
  getContextWindowSize(): Promise<number>;

  /**
   * Count tokens in a given text.
   * @param text Text to count tokens for
   * @returns Token count
   */
  countTokens(text: string): Promise<number>;
}

/**
 * Main LLM service interface.
 * Orchestrates provider selection and LLM operations.
 */
export interface ILlmService {
  /**
   * Get a text completion using the configured provider.
   * @param systemPrompt System-level instruction
   * @param userPrompt User's actual prompt
   * @returns Result containing completion text or error
   */
  getCompletion(
    systemPrompt: string,
    userPrompt: string
  ): Promise<Result<string, LlmProviderError>>;

  /**
   * Get a structured completion that conforms to a Zod schema.
   * @param prompt The prompt to send
   * @param schema Zod schema defining expected output structure
   * @param completionConfig Optional completion parameters
   * @returns Result containing parsed, type-safe object or error
   */
  getStructuredCompletion<T extends z.ZodTypeAny>(
    prompt: LlmPromptInput,
    schema: T,
    completionConfig?: LlmCompletionConfig
  ): Promise<Result<z.infer<T>, LlmProviderError>>;

  /**
   * Get the context window size for the current model.
   * @returns Context window size in tokens
   */
  getModelContextWindow(): Promise<number>;

  /**
   * Count tokens in a given text.
   * @param text Text to count tokens for
   * @returns Token count
   */
  countTokens(text: string): Promise<number>;

  /**
   * Get the current LLM provider instance.
   * @returns Result containing provider or error
   */
  getProvider(): Promise<Result<ILlmProvider, Error>>;
}

/**
 * Factory function type for creating LLM providers.
 * Can be synchronous or asynchronous (e.g., VS Code LM provider requires async initialization).
 * @param apiKey API key for the provider (may be empty for providers that don't need it)
 * @param model Model name to use
 * @returns Result containing provider instance or error (or Promise of Result for async factories)
 */
export type LlmProviderFactory = (
  apiKey: string,
  model: string
) =>
  | Result<ILlmProvider, LlmProviderError>
  | Promise<Result<ILlmProvider, LlmProviderError>>;
