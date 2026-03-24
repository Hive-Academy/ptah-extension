/**
 * DI Registration for LLM Abstraction (CLI Services)
 *
 * TASK_2025_071: DI Registration Standardization
 * Created: 2025-12-14
 *
 * TASK_2025_212: Removed vestigial LLM provider services (LlmSecretsService,
 * LlmConfigurationService, ProviderRegistry, LlmService) that produced startup
 * errors due to having no working providers after platform unification.
 *
 * Remaining registrations (CLI multi-agent support):
 * 1. CliDetectionService - needs LOGGER
 * 2. AgentProcessManager - needs LOGGER, CLI_DETECTION_SERVICE
 * 3. CliPluginSyncService - needs LOGGER, CLI_DETECTION_SERVICE
 *
 * @see libs/backend/agent-sdk/src/lib/di/register.ts - Pattern reference
 * @see apps/ptah-extension-vscode/src/di/container.ts - Orchestration point
 */

import { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { CliDetectionService } from '../services/cli-detection.service';
import { AgentProcessManager } from '../services/agent-process-manager.service';
import { CliPluginSyncService } from '../services/cli-skill-sync/cli-plugin-sync.service';

/**
 * Register CLI abstraction services in DI container
 *
 * TASK_2025_212: Vestigial LLM provider services removed.
 * Only CLI detection and agent process management services remain.
 *
 * Registers:
 * 1. CliDetectionService (singleton): Detects installed CLI agents (Gemini, Codex, Copilot)
 * 2. AgentProcessManager (singleton): Manages CLI agent child processes
 * 3. CliPluginSyncService (singleton): Syncs MCP plugins to CLI agents
 *
 * Prerequisites (must be registered before calling):
 * - TOKENS.LOGGER
 * - TOKENS.EXTENSION_CONTEXT
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
  ];

  for (const { token, name } of requiredTokens) {
    if (!container.isRegistered(token)) {
      throw new Error(
        `[LLM Abstraction] DEPENDENCY ERROR: TOKENS.${name} must be registered first.`
      );
    }
  }

  logger.info('[LLM Abstraction] Registering CLI services...');

  // 1. CliDetectionService - needs LOGGER
  container.registerSingleton(
    TOKENS.CLI_DETECTION_SERVICE,
    CliDetectionService
  );

  // 2. AgentProcessManager - needs LOGGER, CLI_DETECTION_SERVICE
  container.registerSingleton(
    TOKENS.AGENT_PROCESS_MANAGER,
    AgentProcessManager
  );

  // 3. CliPluginSyncService - needs LOGGER, CLI_DETECTION_SERVICE (TASK_2025_160)
  container.registerSingleton(
    TOKENS.CLI_PLUGIN_SYNC_SERVICE,
    CliPluginSyncService
  );

  logger.info('[LLM Abstraction] CLI services registered', {
    services: [
      'CLI_DETECTION_SERVICE',
      'AGENT_PROCESS_MANAGER',
      'CLI_PLUGIN_SYNC_SERVICE',
    ],
  });
}
