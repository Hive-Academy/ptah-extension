import { container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { TemplateManagerService } from '../services/template-manager.service';
import { ContentGeneratorService } from '../services/content-generator.service';
import { ContentProcessorService } from '../services/content-processor.service';
import { TemplateProcessorService } from '../services/template-processor.service';
import { TemplateFileManagerService } from '../services/template-file-manager.service';
import { TemplateOrchestratorService } from '../services/template-orchestrator.service';
import { TemplateGeneratorService } from '../services/template-generator.service';

/**
 * Registers template generation services in the DI container
 * Called during extension activation after vscode-core and other dependencies are registered
 */
export function registerTemplateGeneration(): void {
  // Register all template generation services as singletons
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
}
