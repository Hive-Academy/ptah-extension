import { Result } from '@ptah-extension/shared';
import { TemplateFileType } from './template.enums';

/**
 * Project context for template generation
 * Uses workspace-intelligence ProjectContext
 */
export interface ProjectContext {
  projectName: string;
  projectDescription?: string;
  techStack?: string[];
  dependencies?: Record<string, string>;
  fileStructure?: Record<string, unknown>;
  codeInsights?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Interface for generating template content using LLM
 * Adapted from IMemoryBankContentGenerator
 */
export interface ITemplateContentGenerator {
  /**
   * Generates content for a template file using LLM
   * @param fileType - Type of template file to generate
   * @param context - Project context information
   * @param template - Template content to use for generation
   * @returns A Result containing the generated content or an error
   */
  generateContent(
    fileType: TemplateFileType,
    context: ProjectContext,
    template: string
  ): Promise<Result<string, Error>>;
}
