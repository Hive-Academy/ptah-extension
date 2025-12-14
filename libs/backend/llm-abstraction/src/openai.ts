/**
 * OpenAI Provider - Secondary Entry Point
 *
 * @packageDocumentation
 *
 * Import: `@ptah-extension/llm-abstraction/openai`
 *
 * Dependencies: @langchain/openai, @langchain/core, zod, openai
 *
 * This provider uses Langchain's ChatOpenAI for GPT model access.
 * Requires an OpenAI API key.
 *
 * @example
 * ```typescript
 * import { createOpenAIProvider, OpenAIProvider } from '@ptah-extension/llm-abstraction/openai';
 *
 * const result = await createOpenAIProvider('sk-...', 'gpt-4-turbo');
 * if (result.isOk()) {
 *   const response = await result.value.getCompletion('You are helpful', 'Hello');
 * }
 * ```
 */

import { Result } from '@ptah-extension/shared';
import { OpenAIProvider } from './lib/providers/openai.provider';
import type {
  ILlmProvider,
  LlmProviderFactory,
} from './lib/interfaces/llm-provider.interface';
import { LlmProviderError } from './lib/errors/llm-provider.error';

// Re-export provider
export { OpenAIProvider };

/**
 * Factory function for creating OpenAIProvider
 *
 * @param apiKey - OpenAI API key (required, starts with 'sk-')
 * @param model - Model name (e.g., 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo')
 * @returns Result containing provider instance or error
 */
export const createOpenAIProvider: LlmProviderFactory = (
  apiKey: string,
  model: string
): Result<ILlmProvider, LlmProviderError> => {
  try {
    if (!apiKey || apiKey.trim().length === 0) {
      return Result.err(
        new LlmProviderError(
          'API key is required for OpenAI provider',
          'API_KEY_MISSING',
          'openai'
        )
      );
    }

    const provider = new OpenAIProvider(apiKey, model);
    return Result.ok(provider);
  } catch (error) {
    return Result.err(LlmProviderError.fromError(error, 'openai'));
  }
};
