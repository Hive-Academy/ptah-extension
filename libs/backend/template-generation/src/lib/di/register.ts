/**
 * DI Registration for Template Generation
 *
 * TASK_2025_071: DI Registration Standardization
 * Created: 2025-12-14
 *
 * This file centralizes all service registrations for the template-generation library.
 * Following the standardized registration pattern established in agent-sdk and agent-generation.
 *
 * Pattern:
 * - Function signature: registerTemplateGenerationServices(container, logger)
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
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { TemplateManagerService } from '../services/template-manager.service';
import { ContentGeneratorService } from '../services/content-generator.service';
import { ContentProcessorService } from '../services/content-processor.service';
import { TemplateProcessorService } from '../services/template-processor.service';
import { TemplateFileManagerService } from '../services/template-file-manager.service';
import { TemplateOrchestratorService } from '../services/template-orchestrator.service';
import { TemplateGeneratorService } from '../services/template-generator.service';
import { FileSystemAdapter } from '../adapters/file-system.adapter';

/**
 * Register template generation services in DI container
 *
 * Registers:
 * - FileSystemAdapter (singleton): File system operations adapter (TEMPLATE_FILE_SYSTEM_ADAPTER token)
 * - TemplateManagerService (singleton): Template loading and caching
 * - ContentProcessorService (singleton): Content processing and transformation
 * - ContentGeneratorService (singleton): Content generation orchestration
 * - TemplateProcessorService (singleton): Template interpolation and validation
 * - TemplateFileManagerService (singleton): Template file I/O operations
 * - TemplateOrchestratorService (singleton): High-level template orchestration
 * - TemplateGeneratorService (singleton): Main template generation service
 *
 * @param container - TSyringe DI container
 * @param logger - Logger instance for registration logging
 *
 * @example
 * ```typescript
 * import { registerTemplateGenerationServices } from '@ptah-extension/template-generation';
 *
 * // In container.ts
 * registerTemplateGenerationServices(container, logger);
 *
 * // Resolve services
 * const templateGenerator = container.resolve<TemplateGeneratorService>(TOKENS.TEMPLATE_GENERATOR_SERVICE);
 * ```
 */
export function registerTemplateGenerationServices(
  container: DependencyContainer,
  logger: Logger,
): void {
  // TASK_2025_071 Batch 7: Dependency validation - fail fast if prerequisites missing
  if (!container.isRegistered(TOKENS.LOGGER)) {
    throw new Error(
      '[Template Generation] DEPENDENCY ERROR: TOKENS.LOGGER must be registered first.',
    );
  }

  // FileSystemAdapter depends on the platform-layer FILE_SYSTEM_PROVIDER
  if (!container.isRegistered(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)) {
    throw new Error(
      '[Template Generation] DEPENDENCY ERROR: PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER must be registered before template-generation. ' +
        'Ensure the platform layer (VS Code or Electron) is registered BEFORE registerTemplateGenerationServices in container.ts.',
    );
  }

  logger.info('[Template Generation] Registering services...');

  // Register all 8 services as singletons
  // TASK_2025_071 Batch 5: Use dedicated token to avoid collision with workspace-intelligence's FileSystemService
  // FileSystemAdapter wraps workspace-intelligence's FileSystemService (which uses TOKENS.FILE_SYSTEM_SERVICE)
  container.registerSingleton(
    TOKENS.TEMPLATE_FILE_SYSTEM_ADAPTER,
    FileSystemAdapter,
  );
  container.registerSingleton(TOKENS.TEMPLATE_MANAGER, TemplateManagerService);
  container.registerSingleton(
    TOKENS.CONTENT_PROCESSOR,
    ContentProcessorService,
  );
  container.registerSingleton(
    TOKENS.CONTENT_GENERATOR,
    ContentGeneratorService,
  );
  container.registerSingleton(
    TOKENS.TEMPLATE_PROCESSOR,
    TemplateProcessorService,
  );
  container.registerSingleton(
    TOKENS.TEMPLATE_FILE_MANAGER,
    TemplateFileManagerService,
  );
  container.registerSingleton(
    TOKENS.TEMPLATE_ORCHESTRATOR,
    TemplateOrchestratorService,
  );
  container.registerSingleton(
    TOKENS.TEMPLATE_GENERATOR_SERVICE,
    TemplateGeneratorService,
  );

  logger.info('[Template Generation] Services registered', {
    services: [
      'TEMPLATE_FILE_SYSTEM_ADAPTER',
      'TEMPLATE_MANAGER',
      'CONTENT_PROCESSOR',
      'CONTENT_GENERATOR',
      'TEMPLATE_PROCESSOR',
      'TEMPLATE_FILE_MANAGER',
      'TEMPLATE_ORCHESTRATOR',
      'TEMPLATE_GENERATOR_SERVICE',
    ],
  });
}
