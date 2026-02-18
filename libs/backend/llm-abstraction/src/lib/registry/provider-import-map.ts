/**
 * Type-Safe Provider Import Map
 *
 * TASK_2025_073 - Batch 1, Task 1.4 (original)
 * TASK_2025_155 - Batch 1, Task 1.3 (removed anthropic/openrouter, native SDK migration)
 *
 * Provides compile-time verification for dynamic imports.
 *
 * This replaces the string literal switch statement in provider-registry.ts
 * with a type-checked import map, ensuring all imports resolve at build time.
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
 * - openai -> createOpenAIProvider
 * - google-genai -> createGoogleProvider
 * - vscode-lm -> createVsCodeLmProvider
 */
interface ProviderModule {
  createOpenAIProvider?: LlmProviderFactory;
  createGoogleProvider?: LlmProviderFactory;
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
 * Benefits over string literal imports:
 * - Compile-time verification of import paths (via package.json exports)
 * - Type safety for factory function extraction
 * - IDE autocomplete support
 * - Refactoring safety (renames tracked by TypeScript)
 *
 * @example
 * ```typescript
 * const factoryLoader = PROVIDER_IMPORT_MAP['openai'];
 * const factory = await factoryLoader();
 * const result = factory(apiKey, model);
 * ```
 */
export const PROVIDER_IMPORT_MAP: Record<
  LlmProviderName,
  () => Promise<LlmProviderFactory>
> = {
  /**
   * OpenAI (GPT) provider
   * Dependencies: openai (native SDK)
   */
  openai: async () => {
    const module = (await import(
      '@ptah-extension/llm-abstraction/openai'
    )) as ProviderModule;
    if (!module.createOpenAIProvider) {
      throw new Error('createOpenAIProvider not found in openai module');
    }
    return module.createOpenAIProvider;
  },

  /**
   * Google (Gemini) provider
   * Dependencies: @google/genai (native SDK)
   */
  'google-genai': async () => {
    const module = (await import(
      '@ptah-extension/llm-abstraction/google'
    )) as ProviderModule;
    if (!module.createGoogleProvider) {
      throw new Error('createGoogleProvider not found in google module');
    }
    return module.createGoogleProvider;
  },

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
