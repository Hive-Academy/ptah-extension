import path from 'path';
import { injectable, inject } from 'tsyringe';
import { Result } from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import {
  ITemplateOrchestrator,
  ITemplateProcessor,
  ITemplateContentGenerator,
  ITemplateFileManager,
  TemplateFileType,
  ProjectContext,
  ProjectConfig,
} from '../interfaces';
import { TemplateGenerationError } from '../errors';

/**
 * Template Orchestrator Service
 * Orchestrates the template generation process
 * Coordinates template processing, content generation, and file operations
 * Adapted from roocode-generator MemoryBankOrchestrator
 */
@injectable()
export class TemplateOrchestratorService implements ITemplateOrchestrator {
  constructor(
    @inject(TOKENS.TEMPLATE_PROCESSOR)
    private readonly templateProcessor: ITemplateProcessor,
    @inject(TOKENS.CONTENT_GENERATOR)
    private readonly contentGenerator: ITemplateContentGenerator,
    @inject(TOKENS.TEMPLATE_FILE_MANAGER)
    private readonly fileManager: ITemplateFileManager,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
  ) {}

  /**
   * Helper method to create and log generation errors
   */
  private _handleGenerationError(
    message: string,
    operation: string,
    cause?: Error,
    additionalContext?: Record<string, unknown>,
  ): Result<never, Error> {
    const error = new TemplateGenerationError(
      message,
      { ...additionalContext, operation },
      cause,
    );
    this.logger.error(error.message, error);
    return Result.err(error);
  }

  /**
   * Helper method for wrapping errors caught in catch blocks
   */
  private _wrapCaughtError(
    message: string,
    operation: string,
    caughtError: unknown,
    additionalContext?: Record<string, unknown>,
  ): Result<never, Error> {
    const cause =
      caughtError instanceof Error
        ? caughtError
        : new Error(String(caughtError));
    return this._handleGenerationError(
      message,
      operation,
      cause,
      additionalContext,
    );
  }

  /**
   * Orchestrates the generation of template files
   *
   * @param projectContext - Structured project context data
   * @param config - Project configuration
   * @returns Result indicating success or failure
   */
  async orchestrateGeneration(
    projectContext: ProjectContext,
    config: ProjectConfig,
  ): Promise<Result<void, Error>> {
    const resolvedOutputDir: string =
      config.templateGeneration?.outputDir || './generated-templates';
    this.logger.debug(
      `Resolved template output directory: ${resolvedOutputDir}`,
    );

    const errors: { fileType: string; error: Error; phase: string }[] = [];
    const baseDir = config.baseDir ?? '.';

    try {
      // Create the generated-templates directory structure
      this.logger.info('Creating template directory structure...');
      const dirResult = await this.fileManager.createTemplateDirectory(baseDir);

      if (dirResult.isErr()) {
        return this._handleGenerationError(
          'Failed to create template directory structure',
          'createTemplateDirectory',
          dirResult.error || new Error('Unknown directory creation error'),
          { targetDir: resolvedOutputDir },
        );
      }

      // Step 1: Generate LLM-based files
      this.logger.info('Generating LLM-based template files...');
      const dynamicFileTypes = Object.values(TemplateFileType);
      let successCount = 0;

      for (const fileType of dynamicFileTypes) {
        const fileTypeStr = String(fileType);
        this.logger.debug(`Generating ${fileTypeStr}...`);

        // Process template and generate content using LLM
        const templateResult =
          await this.templateProcessor.loadAndProcessTemplate(fileType, {
            projectName: config.name || 'Unnamed Project',
            projectDescription:
              config.description || 'Project description not available',
          });

        if (templateResult.isErr()) {
          errors.push({
            fileType: fileTypeStr,
            error:
              templateResult.error ||
              new Error('Unknown template processing error'),
            phase: 'template-processing',
          });
          continue;
        }

        if (!templateResult.value) {
          errors.push({
            fileType: fileTypeStr,
            error: new Error('Template result is undefined'),
            phase: 'template-processing',
          });
          continue;
        }

        const contentResult = await this.contentGenerator.generateContent(
          fileType,
          projectContext,
          templateResult.value,
        );

        if (contentResult.isErr()) {
          errors.push({
            fileType: fileTypeStr,
            error:
              contentResult.error ||
              new Error('Unknown content generation error'),
            phase: 'content-generation',
          });
          continue;
        }

        if (!contentResult.value) {
          errors.push({
            fileType: fileTypeStr,
            error: new Error('Generated content is undefined'),
            phase: 'content-generation',
          });
          continue;
        }

        // Write the generated content
        const outputFilePath = path.join(
          resolvedOutputDir,
          `${fileTypeStr}.md`,
        );
        const writeResult = await this.fileManager.writeTemplateFile(
          outputFilePath,
          contentResult.value,
        );

        if (writeResult.isErr()) {
          errors.push({
            fileType: fileTypeStr,
            error: writeResult.error || new Error('Unknown file writing error'),
            phase: 'file-writing',
          });
          continue;
        }

        successCount++;
        this.logger.info(`Generated ${fileTypeStr} at ${outputFilePath}`);
      }

      // Report generation summary
      if (errors.length > 0) {
        const errorSummary = errors
          .map((e) => `${e.fileType} (${e.phase}): ${e.error.message}`)
          .join('\n- ');

        if (successCount === 0) {
          return this._handleGenerationError(
            `Template generation failed with ${errors.length} errors:\n- ${errorSummary}`,
            'orchestrateGeneration',
            new Error(errorSummary),
            {
              errors: errors.map((e) => ({
                fileType: e.fileType,
                phase: e.phase,
              })),
            },
          );
        }

        // Log warnings but continue if at least one file was generated
        this.logger.warn(
          `Template generation completed with ${errors.length} errors:\n- ${errorSummary}`,
        );
      }

      return Result.ok(undefined);
    } catch (error) {
      this.sentryService.captureException(
        error instanceof Error ? error : new Error(String(error)),
        { errorSource: 'TemplateOrchestratorService.orchestrateGeneration' },
      );
      return this._wrapCaughtError(
        'Unexpected error during template generation',
        'orchestrateGeneration',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
}
