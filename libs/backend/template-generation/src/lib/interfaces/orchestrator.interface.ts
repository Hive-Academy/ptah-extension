import { Result } from '@ptah-extension/shared';
import { ProjectContext } from './content-generator.interface';

/**
 * Project configuration for template generation
 */
export interface ProjectConfig {
  name: string;
  description?: string;
  baseDir: string;
  templateGeneration?: {
    outputDir?: string;
    enabledTypes?: string[];
  };
}

/**
 * Interface for TemplateOrchestrator
 * Responsible for coordinating the template generation process
 * Adapted from IMemoryBankOrchestrator
 */
export interface ITemplateOrchestrator {
  /**
   * Orchestrates the generation of template files
   *
   * @param projectContext - Structured project context data
   * @param config - Project configuration
   * @returns Result indicating success or failure
   */
  orchestrateGeneration(
    projectContext: ProjectContext,
    config: ProjectConfig
  ): Promise<Result<void, Error>>;
}
