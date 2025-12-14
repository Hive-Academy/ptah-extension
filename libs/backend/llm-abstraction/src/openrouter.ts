/**
 * OpenRouter Provider - Secondary Entry Point
 *
 * @packageDocumentation
 *
 * Import: `@ptah-extension/llm-abstraction/openrouter`
 *
 * Dependencies: @langchain/openai, @langchain/core, zod
 *
 * This provider uses Langchain's ChatOpenAI with OpenRouter's API endpoint.
 * Provides access to 200+ models from multiple providers.
 * Requires an OpenRouter API key.
 *
 * @example
 * ```typescript
 * import { createOpenRouterProvider, OpenRouterProvider } from '@ptah-extension/llm-abstraction/openrouter';
 *
 * const result = await createOpenRouterProvider('sk-or-...', 'anthropic/claude-3-5-sonnet');
 * if (result.isOk()) {
 *   const response = await result.value.getCompletion('You are helpful', 'Hello');
 * }
 * ```
 */

import { Result } from '@ptah-extension/shared';
import { OpenRouterProvider } from './lib/providers/openrouter.provider';
import type {
  ILlmProvider,
  LlmProviderFactory,
} from './lib/interfaces/llm-provider.interface';
import { LlmProviderError } from './lib/errors/llm-provider.error';

// Re-export provider
export { OpenRouterProvider };

/**
 * Factory function for creating OpenRouterProvider
 *
 * @param apiKey - OpenRouter API key (required, starts with 'sk-or-')
 * @param model - Model name in "provider/model" format (e.g., 'anthropic/claude-3-5-sonnet')
 * @returns Result containing provider instance or error
 */
export const createOpenRouterProvider: LlmProviderFactory = (
  apiKey: string,
  model: string
): Result<ILlmProvider, LlmProviderError> => {
  try {
    if (!apiKey || apiKey.trim().length === 0) {
      return Result.err(
        new LlmProviderError(
          'API key is required for OpenRouter provider',
          'API_KEY_MISSING',
          'openrouter'
        )
      );
    }

    const provider = new OpenRouterProvider(apiKey, model);
    return Result.ok(provider);
  } catch (error) {
    return Result.err(LlmProviderError.fromError(error, 'openrouter'));
  }
};
