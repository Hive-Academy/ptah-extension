import { container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { LlmService } from '../services/llm.service';
import { ProviderRegistry } from '../registry/provider-registry';

/**
 * Register LLM abstraction services in the DI container.
 * Called during extension activation.
 *
 * Registers:
 * - ProviderRegistry (singleton): Factory for creating LLM providers
 * - LlmService (singleton): Main LLM orchestration service
 *
 * @example
 * ```typescript
 * import { registerLlmAbstraction } from '@ptah-extension/llm-abstraction';
 *
 * // In activation.ts
 * registerLlmAbstraction();
 *
 * // Resolve services
 * const llmService = container.resolve<LlmService>(TOKENS.LLM_SERVICE);
 * ```
 */
export function registerLlmAbstraction(): void {
  container.registerSingleton(TOKENS.PROVIDER_REGISTRY, ProviderRegistry);
  container.registerSingleton(TOKENS.LLM_SERVICE, LlmService);

  console.log('[LLM Abstraction] Services registered');
}
