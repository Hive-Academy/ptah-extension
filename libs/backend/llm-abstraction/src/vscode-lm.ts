/**
 * VS Code LM Provider - Secondary Entry Point
 *
 * @packageDocumentation
 *
 * Import: `@ptah-extension/llm-abstraction/vscode-lm`
 *
 * This provider has NO external dependencies (no Langchain).
 * Always available as the default/fallback provider.
 * Uses VS Code's native Language Model API.
 *
 * @example
 * ```typescript
 * import { createVsCodeLmProvider, VsCodeLmProvider } from '@ptah-extension/llm-abstraction/vscode-lm';
 *
 * const result = await createVsCodeLmProvider('', 'copilot/gpt-4o');
 * if (result.isOk()) {
 *   const response = await result.value.getCompletion('You are helpful', 'Hello');
 * }
 * ```
 */

import { Result } from '@ptah-extension/shared';
import {
  VsCodeLmProvider,
  type VsCodeModelSelector,
} from './lib/providers/vscode-lm.provider';
import type {
  ILlmProvider,
  LlmProviderFactory,
} from './lib/interfaces/llm-provider.interface';
import { LlmProviderError } from './lib/errors/llm-provider.error';

// Re-export provider and types
export { VsCodeLmProvider, type VsCodeModelSelector };

/**
 * Factory function for creating VsCodeLmProvider
 *
 * Note: This is an async factory because VS Code LM requires model selection.
 *
 * @param _apiKey - Ignored (VS Code LM doesn't need API key)
 * @param model - Model identifier in "vendor/family" format (e.g., "copilot/gpt-4o")
 * @returns Result containing provider instance or error
 */
export const createVsCodeLmProvider: LlmProviderFactory = async (
  _apiKey: string,
  model: string
): Promise<Result<ILlmProvider, LlmProviderError>> => {
  try {
    // Parse model string as vendor/family format
    let vendor: string | undefined;
    let family: string | undefined;

    if (model && model.includes('/')) {
      const parts = model.split('/');
      vendor = parts[0];
      family = parts[1];
    } else if (model) {
      // Assume model is just the family
      family = model;
    }

    const provider = new VsCodeLmProvider({ vendor, family });

    // Initialize provider (select model)
    const initResult = await provider.initialize();
    if (initResult.isErr()) {
      return Result.err(initResult.error!);
    }

    return Result.ok(provider);
  } catch (error) {
    return Result.err(LlmProviderError.fromError(error, 'vscode-lm'));
  }
};
