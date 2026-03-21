/**
 * Type-Safe Provider Import Map
 *
 * TASK_2025_209: VsCodeLmProvider removed (platform unification).
 * The import map is now empty. LLM calls go through Agent SDK (InternalQueryService)
 * or CLI adapters, not through the old provider registry.
 *
 * This file is kept for structural consistency with the registry module.
 *
 * @packageDocumentation
 */

import type { LlmProviderFactory } from '../interfaces/llm-provider.interface';

/**
 * Type-safe import map for provider modules
 *
 * @remarks
 * Currently empty after VsCodeLmProvider removal.
 * The provider registry pattern is retained for potential future use
 * with non-vscode.lm providers (e.g., direct Anthropic SDK).
 */
export const PROVIDER_IMPORT_MAP: Record<
  string,
  () => Promise<LlmProviderFactory>
> = {};
