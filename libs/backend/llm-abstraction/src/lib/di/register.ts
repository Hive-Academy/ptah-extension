import { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { LlmService } from '../services/llm.service';
import { ProviderRegistry } from '../registry/provider-registry';

/**
 * Register LLM abstraction services in DI container
 *
 * Registers:
 * - ProviderRegistry (singleton): Factory for creating LLM providers
 * - LlmService (singleton): Main LLM orchestration service
 *
 * @param container - TSyringe DI container
 * @param logger - Logger instance for registration logging
 *
 * @example
 * ```typescript
 * import { registerLlmAbstractionServices } from '@ptah-extension/llm-abstraction';
 *
 * // In container.ts
 * registerLlmAbstractionServices(container, logger);
 *
 * // Resolve services
 * const llmService = container.resolve<LlmService>(TOKENS.LLM_SERVICE);
 * ```
 */
export function registerLlmAbstractionServices(
  container: DependencyContainer,
  logger: Logger
): void {
  logger.info('[LLM Abstraction] Registering services...');

  container.registerSingleton(TOKENS.PROVIDER_REGISTRY, ProviderRegistry);
  container.registerSingleton(TOKENS.LLM_SERVICE, LlmService);

  logger.info('[LLM Abstraction] Services registered', {
    services: ['PROVIDER_REGISTRY', 'LLM_SERVICE'],
  });
}
