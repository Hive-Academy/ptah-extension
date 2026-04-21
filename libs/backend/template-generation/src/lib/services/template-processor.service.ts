import { injectable, inject } from 'tsyringe';
import { Result } from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { ITemplateProcessor, TemplateFileType } from '../interfaces';
import { IPtahTemplateManager } from '../interfaces/template-manager.interface';
import { TemplateProcessingError } from '../errors';

/**
 * Template Processor Service
 * Responsible for loading and processing templates
 * Adapted from roocode-generator MemoryBankTemplateProcessor
 */
@injectable()
export class TemplateProcessorService implements ITemplateProcessor {
  constructor(
    @inject(TOKENS.TEMPLATE_MANAGER)
    private readonly templateManager: IPtahTemplateManager,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
  ) {}

  /**
   * Loads and processes a template for a specific template file type
   *
   * @param fileType - Type of template file to process
   * @param context - Context data to apply to the template
   * @returns Result containing the processed template content or an error
   */
  public async loadAndProcessTemplate(
    fileType: TemplateFileType,
    context: Record<string, unknown>,
  ): Promise<Result<string>> {
    try {
      this.logger.debug(`Loading template for ${String(fileType)}...`);

      // Load the template using the template manager
      const templateResult = await this.templateManager.loadTemplate(
        String(fileType),
      );
      if (templateResult.isErr()) {
        const error = new TemplateProcessingError(
          'Failed to load template',
          String(fileType),
          { operation: 'loadTemplate' },
          templateResult.error,
        );
        this.logger.error(error.message, error);
        return Result.err(error);
      }

      // Process the template with the provided context
      this.logger.debug(`Processing template for ${String(fileType)}...`);
      const processResult = await this.templateManager.processTemplate(
        String(fileType),
        context,
      );

      if (processResult.isErr()) {
        const error = new TemplateProcessingError(
          'Failed to process template content',
          String(fileType),
          { operation: 'processTemplateContent' },
          processResult.error,
        );
        this.logger.error(error.message, error);
        return Result.err(error);
      }

      const templateContent = processResult.value;
      if (!templateContent) {
        const error = new TemplateProcessingError(
          'Processed template content is empty',
          String(fileType),
          { operation: 'checkProcessedContent' },
        );
        this.logger.error(error.message, error);
        return Result.err(error);
      }

      this.logger.debug(
        `Successfully processed template for ${String(fileType)}`,
      );
      return Result.ok(templateContent);
    } catch (error) {
      const wrappedError = new TemplateProcessingError(
        'Unexpected error during template processing',
        String(fileType),
        { operation: 'loadAndProcessTemplate' },
        error instanceof Error ? error : new Error(String(error)),
      );
      this.sentryService.captureException(
        error instanceof Error ? error : new Error(String(error)),
        { errorSource: 'TemplateProcessorService.loadAndProcessTemplate' },
      );
      this.logger.error(wrappedError.message, wrappedError);
      return Result.err(wrappedError);
    }
  }
}
