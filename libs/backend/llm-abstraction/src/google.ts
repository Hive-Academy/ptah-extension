/**
 * Google GenAI Provider - Secondary Entry Point
 *
 * @packageDocumentation
 *
 * Import: `@ptah-extension/llm-abstraction/google`
 *
 * Dependencies: @langchain/google-genai, @langchain/core, zod
 *
 * This provider uses Langchain's ChatGoogleGenerativeAI for Gemini model access.
 * Requires a Google API key.
 *
 * @example
 * ```typescript
 * import { createGoogleProvider, GoogleGenAIProvider } from '@ptah-extension/llm-abstraction/google';
 *
 * const result = await createGoogleProvider('AIza...', 'gemini-1.5-pro');
 * if (result.isOk()) {
 *   const response = await result.value.getCompletion('You are helpful', 'Hello');
 * }
 * ```
 */

import { Result } from '@ptah-extension/shared';
import { GoogleGenAIProvider } from './lib/providers/google-genai.provider';
import type {
  ILlmProvider,
  LlmProviderFactory,
} from './lib/interfaces/llm-provider.interface';
import { LlmProviderError } from './lib/errors/llm-provider.error';

// Re-export provider
export { GoogleGenAIProvider };

/**
 * Factory function for creating GoogleGenAIProvider
 *
 * @param apiKey - Google API key (required)
 * @param model - Model name (e.g., 'gemini-1.5-pro', 'gemini-1.5-flash')
 * @returns Result containing provider instance or error
 */
export const createGoogleProvider: LlmProviderFactory = (
  apiKey: string,
  model: string
): Result<ILlmProvider, LlmProviderError> => {
  try {
    if (!apiKey || apiKey.trim().length === 0) {
      return Result.err(
        new LlmProviderError(
          'API key is required for Google GenAI provider',
          'API_KEY_MISSING',
          'google-genai'
        )
      );
    }

    const provider = new GoogleGenAIProvider(apiKey, model);
    return Result.ok(provider);
  } catch (error) {
    return Result.err(LlmProviderError.fromError(error, 'google-genai'));
  }
};
