import { Result } from '@ptah-extension/shared';
import { TemplateFileType } from './template.enums';

/**
 * Interface for TemplateProcessor
 * Responsible for loading and processing templates
 * Adapted from IMemoryBankTemplateProcessor
 */
export interface ITemplateProcessor {
  /**
   * Loads and processes a template for a specific template file type
   *
   * @param fileType - Type of template file to process
   * @param context - Context data to apply to the template
   * @returns Result containing the processed template content or an error
   */
  loadAndProcessTemplate(
    fileType: TemplateFileType,
    context: Record<string, unknown>
  ): Promise<Result<string>>;
}
