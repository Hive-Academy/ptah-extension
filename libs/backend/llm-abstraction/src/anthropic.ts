/**
 * Anthropic Provider - Secondary Entry Point
 *
 * @packageDocumentation
 *
 * Import: `@ptah-extension/llm-abstraction/anthropic`
 *
 * Dependencies: @langchain/anthropic, @langchain/core, zod
 *
 * This provider uses Langchain's ChatAnthropic for Claude model access.
 * Requires an Anthropic API key.
 *
 * @example
 * ```typescript
 * import { createAnthropicProvider, AnthropicProvider } from '@ptah-extension/llm-abstraction/anthropic';
 *
 * const result = await createAnthropicProvider('sk-ant-api...', 'claude-3-5-sonnet-20241022');
 * if (result.isOk()) {
 *   const response = await result.value.getCompletion('You are helpful', 'Hello');
 * }
 * ```
 */

import { Result } from '@ptah-extension/shared';
import { AnthropicProvider } from './lib/providers/anthropic.provider';
import type {
  ILlmProvider,
  LlmProviderFactory,
} from './lib/interfaces/llm-provider.interface';
import { LlmProviderError } from './lib/errors/llm-provider.error';

// Re-export provider
export { AnthropicProvider };

/**
 * Factory function for creating AnthropicProvider
 *
 * @param apiKey - Anthropic API key (required, starts with 'sk-ant-')
 * @param model - Model name (e.g., 'claude-3-5-sonnet-20241022')
 * @returns Result containing provider instance or error
 */
export const createAnthropicProvider: LlmProviderFactory = (
  apiKey: string,
  model: string
): Result<ILlmProvider, LlmProviderError> => {
  try {
    if (!apiKey || apiKey.trim().length === 0) {
      return Result.err(
        new LlmProviderError(
          'API key is required for Anthropic provider',
          'API_KEY_MISSING',
          'anthropic'
        )
      );
    }

    const provider = new AnthropicProvider(apiKey, model);
    return Result.ok(provider);
  } catch (error) {
    return Result.err(LlmProviderError.fromError(error, 'anthropic'));
  }
};
