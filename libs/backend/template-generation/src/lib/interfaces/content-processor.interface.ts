import { Result } from '@ptah-extension/shared';

/**
 * Message content type (string or array of content blocks)
 */
export type MessageContent =
  | string
  | Array<{ type: string; [key: string]: unknown }>;

/**
 * Interface for content processing utilities
 * Adapted from IContentProcessor
 */
export interface IContentProcessor {
  /**
   * Strips markdown code block syntax from content
   * @param content - Content to process
   * @returns Result containing stripped content or error
   */
  stripMarkdownCodeBlock(content: MessageContent): Result<string>;

  /**
   * Removes HTML comments (<!-- ... -->) from the content.
   * @param content - The input string content.
   * @returns A Result containing the content with comments removed or an Error.
   */
  stripHtmlComments(content: string): Result<string, Error>;

  /**
   * Processes a template with context data
   * @param template - Template string
   * @param data - Context data for template processing
   * @returns Result containing processed template or error
   */
  processTemplate(
    template: string,
    data: Record<string, unknown>
  ): Promise<Result<string>>;
}
