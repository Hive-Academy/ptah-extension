import { Result } from '@ptah-extension/shared';

/**
 * Core template manager interface
 */
export interface ITemplateManager {
  /**
   * Loads a template by name
   * @param name - Template name
   * @returns Result containing template content or error
   */
  loadTemplate(name: string): Promise<Result<string, Error>>;

  /**
   * Processes a template with context data
   * @param name - Template name
   * @param context - Context data for template processing
   * @returns Result containing processed content or error
   */
  processTemplate(
    name: string,
    context: Record<string, unknown>
  ): Promise<Result<string, Error>>;
}

/**
 * Interface for TemplateManager
 * Ptah-specific template management
 * Adapted from IMemoryBankTemplateManager
 */
export interface IPtahTemplateManager extends ITemplateManager {
  /**
   * Gets the template path for a template file.
   *
   * @param name - Template name
   * @returns The full file path to the template
   */
  getTemplatePath(name: string): string;
}
