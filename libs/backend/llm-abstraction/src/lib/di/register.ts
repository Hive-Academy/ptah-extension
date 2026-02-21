/**
 * DI Registration for LLM Abstraction
 *
 * TASK_2025_071: DI Registration Standardization
 * Created: 2025-12-14
 *
 * This file centralizes all service registrations for the llm-abstraction library.
 * Following the standardized registration pattern established in agent-sdk and agent-generation.
 *
 * Registration Order (dependency chain):
 * 1. LlmSecretsService - needs EXTENSION_CONTEXT, LOGGER
 * 2. LlmConfigurationService - needs CONFIG_MANAGER, LLM_SECRETS_SERVICE, LOGGER
 * 3. ProviderRegistry - needs LLM_SECRETS_SERVICE, LOGGER
 * 4. LlmService - needs PROVIDER_REGISTRY, LLM_CONFIGURATION_SERVICE, LOGGER
 *
 * @see libs/backend/agent-sdk/src/lib/di/register.ts - Pattern reference
 * @see apps/ptah-extension-vscode/src/di/container.ts - Orchestration point
 */

import { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { LlmService } from '../services/llm.service';
import { LlmSecretsService } from '../services/llm-secrets.service';
import { LlmConfigurationService } from '../services/llm-configuration.service';
import { ProviderRegistry } from '../registry/provider-registry';
import { CliDetectionService } from '../services/cli-detection.service';
import { AgentProcessManager } from '../services/agent-process-manager.service';

/**
 * Register LLM abstraction services in DI container
 *
 * Registers (in order):
 * 1. LlmSecretsService (singleton): API key management via VS Code SecretStorage
 * 2. LlmConfigurationService (singleton): Provider/model configuration from settings
 * 3. ProviderRegistry (singleton): Dynamic provider factory with lazy loading
 * 4. LlmService (singleton): Main LLM orchestration service
 *
 * Prerequisites (must be registered before calling):
 * - TOKENS.LOGGER
 * - TOKENS.EXTENSION_CONTEXT
 * - TOKENS.CONFIG_MANAGER
 *
 * @param container - TSyringe DI container
 * @param logger - Logger instance for registration logging
 */
export function registerLlmAbstractionServices(
  container: DependencyContainer,
  logger: Logger
): void {
  // Dependency validation - fail fast if prerequisites missing
  const requiredTokens = [
    { token: TOKENS.LOGGER, name: 'LOGGER' },
    { token: TOKENS.EXTENSION_CONTEXT, name: 'EXTENSION_CONTEXT' },
    { token: TOKENS.CONFIG_MANAGER, name: 'CONFIG_MANAGER' },
  ];

  for (const { token, name } of requiredTokens) {
    if (!container.isRegistered(token)) {
      throw new Error(
        `[LLM Abstraction] DEPENDENCY ERROR: TOKENS.${name} must be registered first.`
      );
    }
  }

  logger.info('[LLM Abstraction] Registering services...');

  // 1. LlmSecretsService - needs EXTENSION_CONTEXT, LOGGER
  container.registerSingleton(TOKENS.LLM_SECRETS_SERVICE, LlmSecretsService);

  // 2. LlmConfigurationService - needs CONFIG_MANAGER, LLM_SECRETS_SERVICE, LOGGER
  container.registerSingleton(
    TOKENS.LLM_CONFIGURATION_SERVICE,
    LlmConfigurationService
  );

  // 3. ProviderRegistry - needs LLM_SECRETS_SERVICE, LOGGER
  container.registerSingleton(TOKENS.PROVIDER_REGISTRY, ProviderRegistry);

  // 4. LlmService - needs PROVIDER_REGISTRY, LLM_CONFIGURATION_SERVICE, LOGGER
  container.registerSingleton(TOKENS.LLM_SERVICE, LlmService);

  // 5. CliDetectionService - needs LOGGER
  container.registerSingleton(
    TOKENS.CLI_DETECTION_SERVICE,
    CliDetectionService
  );

  // 6. AgentProcessManager - needs LOGGER, CLI_DETECTION_SERVICE
  container.registerSingleton(
    TOKENS.AGENT_PROCESS_MANAGER,
    AgentProcessManager
  );

  logger.info('[LLM Abstraction] Services registered', {
    services: [
      'LLM_SECRETS_SERVICE',
      'LLM_CONFIGURATION_SERVICE',
      'PROVIDER_REGISTRY',
      'LLM_SERVICE',
      'CLI_DETECTION_SERVICE',
      'AGENT_PROCESS_MANAGER',
    ],
  });
}
