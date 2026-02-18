/**
 * Google GenAI Provider - Secondary Entry Point
 *
 * @packageDocumentation
 *
 * Import: `@ptah-extension/llm-abstraction/google`
 *
 * Dependencies: @google/genai, zod, zod-to-json-schema
 *
 * This provider uses the native @google/genai SDK for Gemini model access.
 * Supports text completion, structured output (JSON mode), and image generation.
 * Requires a Google API key.
 *
 * @example
 * ```typescript
 * import { createGoogleProvider, GoogleGenAIProvider } from '@ptah-extension/llm-abstraction/google';
 *
 * const result = createGoogleProvider('AIza...', 'gemini-2.5-flash');
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

// Re-export provider and image generation types
export { GoogleGenAIProvider };
export type {
  ImageGenOptions,
  ImageGenResult,
} from './lib/providers/google-genai.provider';

/**
 * Factory function for creating GoogleGenAIProvider.
 *
 * @param apiKey - Google API key (required)
 * @param model - Model name (e.g., 'gemini-2.5-flash', 'gemini-2.5-pro')
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
