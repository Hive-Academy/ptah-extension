import { injectable, inject } from 'tsyringe';
import { Result } from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  ITemplateContentGenerator,
  TemplateFileType,
  ProjectContext,
  IContentProcessor,
} from '../interfaces';
import { TemplateGenerationError } from '../errors';

/**
 * Content Generator Service
 * Generates template content using LLM
 * Adapted from roocode-generator MemoryBankContentGenerator
 *
 * TASK_2025_212: LlmService dependency removed. The vestigial LLM provider
 * services had no working providers after platform unification. This service
 * now returns a clear error when generateContent is called, since no LLM
 * providers are configured. Template generation via LLM can be restored
 * when a working provider (e.g., Agent SDK InternalQueryService) is integrated.
 */
@injectable()
export class ContentGeneratorService implements ITemplateContentGenerator {
  constructor(
    @inject(TOKENS.CONTENT_PROCESSOR)
    private readonly contentProcessor: IContentProcessor,
    @inject(TOKENS.LOGGER) private readonly logger: Logger
  ) {}

  /**
   * Generates content for a template file using LLM
   *
   * TASK_2025_212: Currently returns an error since no LLM providers are configured.
   * The vestigial LlmService has been removed from DI registration.
   *
   * @param fileType - Type of template file to generate
   * @param _context - Project context information (unused - no LLM available)
   * @param _template - Template content to use for generation (unused - no LLM available)
   * @returns A Result containing an error indicating LLM is not available
   */
  async generateContent(
    fileType: TemplateFileType,
    _context: ProjectContext,
    _template: string
  ): Promise<Result<string, Error>> {
    const error = new TemplateGenerationError(
      `LLM content generation not available for ${fileType} - no providers configured`,
      { operation: 'generateContent', fileType }
    );
    this.logger.warn(
      `LLM content generation not available for ${fileType}`,
      error
    );
    return Result.err(error);
  }
}
