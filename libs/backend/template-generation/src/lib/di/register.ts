import { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
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
 * - FileSystemAdapter (singleton): File system operations adapter
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
  logger: Logger
): void {
  logger.info('[Template Generation] Registering services...');

  // Register all 8 services as singletons
  container.registerSingleton(TOKENS.FILE_SYSTEM_SERVICE, FileSystemAdapter);
  container.registerSingleton(TOKENS.TEMPLATE_MANAGER, TemplateManagerService);
  container.registerSingleton(
    TOKENS.CONTENT_PROCESSOR,
    ContentProcessorService
  );
  container.registerSingleton(
    TOKENS.CONTENT_GENERATOR,
    ContentGeneratorService
  );
  container.registerSingleton(
    TOKENS.TEMPLATE_PROCESSOR,
    TemplateProcessorService
  );
  container.registerSingleton(
    TOKENS.TEMPLATE_FILE_MANAGER,
    TemplateFileManagerService
  );
  container.registerSingleton(
    TOKENS.TEMPLATE_ORCHESTRATOR,
    TemplateOrchestratorService
  );
  container.registerSingleton(
    TOKENS.TEMPLATE_GENERATOR_SERVICE,
    TemplateGeneratorService
  );

  logger.info('[Template Generation] Services registered', {
    services: [
      'FILE_SYSTEM_SERVICE',
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
