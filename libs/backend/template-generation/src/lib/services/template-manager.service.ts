import path from 'path';
import { injectable, inject } from 'tsyringe';
import { Result } from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { FileSystemAdapter } from '../adapters/file-system.adapter';
import { IPtahTemplateManager } from '../interfaces/template-manager.interface';
import { TemplateProcessingError } from '../errors';

/**
 * Template Manager Service
 * Handles loading and processing of template files
 * Adapted from roocode-generator MemoryBankTemplateManager
 */
@injectable()
export class TemplateManagerService implements IPtahTemplateManager {
  protected readonly baseTemplateDir: string;
  protected readonly templateExt: string;

  constructor(
    @inject(TOKENS.FILE_SYSTEM_SERVICE) private readonly fileSystem: FileSystemAdapter,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    config?: { templateDir?: string; templateExt?: string }
  ) {
    this.baseTemplateDir = config?.templateDir ?? 'templates';
    this.templateExt = config?.templateExt ?? '.md';
  }

  /**
   * Gets the template path for a template file.
   * Constructs paths in the format: templates/template-generation/[name]-template.md
   *
   * @param name - Template name
   * @returns The full file path to the template
   */
  public getTemplatePath(name: string): string {
    return path.join(
      this.baseTemplateDir,
      'template-generation',
      `${name}-template${this.templateExt}`
    );
  }

  /**
   * Loads a template file by name
   *
   * @param name - Template name
   * @returns Result containing template content or error
   */
  public async loadTemplate(name: string): Promise<Result<string, Error>> {
    try {
      const templatePath = this.getTemplatePath(name);
      this.logger.debug(`Loading template from: ${templatePath}`);

      const readResult = await this.fileSystem.readFile(templatePath);

      if (readResult.isErr()) {
        const error = new TemplateProcessingError(
          `Failed to load template: ${name}`,
          name,
          { operation: 'loadTemplate', templatePath },
          readResult.error
        );
        this.logger.error(error.message, error);
        return Result.err(error);
      }

      if (!readResult.value) {
        const error = new TemplateProcessingError(
          `Template content is empty: ${name}`,
          name,
          { operation: 'loadTemplate', templatePath }
        );
        this.logger.error(error.message, error);
        return Result.err(error);
      }

      this.logger.debug(`Successfully loaded template: ${name}`);
      return Result.ok(readResult.value);
    } catch (error) {
      const wrappedError = new TemplateProcessingError(
        `Unexpected error loading template: ${name}`,
        name,
        { operation: 'loadTemplate' },
        error instanceof Error ? error : new Error(String(error))
      );
      this.logger.error(wrappedError.message, wrappedError);
      return Result.err(wrappedError);
    }
  }

  /**
   * Processes a template with context data
   * Simple mustache-style variable replacement: {{variableName}}
   *
   * @param name - Template name
   * @param context - Context data for template processing
   * @returns Result containing processed content or error
   */
  public async processTemplate(
    name: string,
    context: Record<string, unknown>
  ): Promise<Result<string, Error>> {
    try {
      // Load the template
      const loadResult = await this.loadTemplate(name);
      if (loadResult.isErr()) {
        return Result.err(loadResult.error);
      }

      let templateContent = loadResult.value;

      // Simple variable replacement: {{variableName}}
      for (const [key, value] of Object.entries(context)) {
        const placeholder = `{{${key}}}`;
        const replacementValue = String(value);
        templateContent = templateContent.replace(
          new RegExp(placeholder, 'g'),
          replacementValue
        );
      }

      this.logger.debug(`Successfully processed template: ${name}`);
      return Result.ok(templateContent);
    } catch (error) {
      const wrappedError = new TemplateProcessingError(
        `Unexpected error processing template: ${name}`,
        name,
        { operation: 'processTemplate' },
        error instanceof Error ? error : new Error(String(error))
      );
      this.logger.error(wrappedError.message, wrappedError);
      return Result.err(wrappedError);
    }
  }
}
