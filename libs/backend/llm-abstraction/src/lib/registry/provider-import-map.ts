/**
 * Type-Safe Provider Import Map
 *
 * Provides compile-time verification for dynamic imports.
 * SDK-only migration: Only VS Code Language Model provider is supported.
 *
 * @packageDocumentation
 */

import type { LlmProviderName } from '../types/provider-types';
import type { LlmProviderFactory } from '../interfaces/llm-provider.interface';

/**
 * Provider module structure
 *
 * @remarks
 * Each secondary entry point exports a factory function with this naming pattern:
 * - vscode-lm -> createVsCodeLmProvider
 */
interface ProviderModule {
  createVsCodeLmProvider?: LlmProviderFactory;
}

/**
 * Type-safe import map for provider modules
 *
 * @remarks
 * Each entry is a lazy loader function that:
 * 1. Dynamically imports the secondary entry point
 * 2. Extracts the factory function from the module
 * 3. Returns the factory for provider creation
 *
 * @example
 * ```typescript
 * const factoryLoader = PROVIDER_IMPORT_MAP['vscode-lm'];
 * const factory = await factoryLoader();
 * const result = factory(apiKey, model);
 * ```
 */
export const PROVIDER_IMPORT_MAP: Record<
  LlmProviderName,
  () => Promise<LlmProviderFactory>
> = {
  /**
   * VS Code Language Model API provider
   * Dependencies: vscode (no external LLM dependencies)
   */
  'vscode-lm': async () => {
    const module = (await import(
      '@ptah-extension/llm-abstraction/vscode-lm'
    )) as ProviderModule;
    if (!module.createVsCodeLmProvider) {
      throw new Error('createVsCodeLmProvider not found in vscode-lm module');
    }
    return module.createVsCodeLmProvider;
  },
};
