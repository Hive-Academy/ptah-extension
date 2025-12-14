/**
 * DI Registration for LLM Abstraction
 *
 * TASK_2025_071: DI Registration Standardization
 * Created: 2025-12-14
 *
 * This file centralizes all service registrations for the llm-abstraction library.
 * Following the standardized registration pattern established in agent-sdk and agent-generation.
 *
 * Pattern:
 * - Function signature: registerLlmAbstractionServices(container, logger)
 * - Uses injected container (no global import)
 * - Uses injected logger (no console.log)
 * - Logs registration start and completion
 *
 * @see libs/backend/agent-sdk/src/lib/di/register.ts - Pattern reference
 * @see apps/ptah-extension-vscode/src/di/container.ts - Orchestration point
 */

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
  // TASK_2025_071 Batch 7: Dependency validation - fail fast if prerequisites missing
  if (!container.isRegistered(TOKENS.LOGGER)) {
    throw new Error(
      '[LLM Abstraction] DEPENDENCY ERROR: TOKENS.LOGGER must be registered first.'
    );
  }

  logger.info('[LLM Abstraction] Registering services...');

  container.registerSingleton(TOKENS.PROVIDER_REGISTRY, ProviderRegistry);
  container.registerSingleton(TOKENS.LLM_SERVICE, LlmService);

  logger.info('[LLM Abstraction] Services registered', {
    services: ['PROVIDER_REGISTRY', 'LLM_SERVICE'],
  });
}
