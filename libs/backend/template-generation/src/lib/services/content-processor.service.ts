import { injectable, inject } from 'tsyringe';
import { Result } from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { IContentProcessor, MessageContent } from '../interfaces';

/**
 * Content Processor Service
 * Provides utilities for processing and cleaning template content
 * Adapted from roocode-generator ContentProcessor
 */
@injectable()
export class ContentProcessorService implements IContentProcessor {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Strips markdown code block syntax from content
   * Handles both string and array content types
   *
   * @param content - Content to process (string or content blocks)
   * @returns Result containing stripped content or error
   */
  stripMarkdownCodeBlock(content: MessageContent): Result<string> {
    try {
      // Convert content to string if it's an array
      const contentStr =
        typeof content === 'string' ? content : JSON.stringify(content);

      // Check if content is wrapped in markdown code blocks
      const codeBlockRegex = /^```[a-z]*\n([\s\S]*?)\n```$/gm;
      const match = codeBlockRegex.exec(contentStr);

      if (match && match[1]) {
        // Content was wrapped in code blocks, return inner content
        return Result.ok(match[1].trim());
      }

      // No code blocks found, return as-is
      return Result.ok(contentStr);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Failed to strip markdown code block', err);
      return Result.err(err);
    }
  }

  /**
   * Removes HTML comments (<!-- ... -->) from the content.
   * @param content - The input string content.
   * @returns A Result containing the content with comments removed or an Error.
   */
  stripHtmlComments(content: string): Result<string, Error> {
    try {
      const commentRegex = /<!--[\s\S]*?-->/g;
      const stripped = content.replace(commentRegex, '');
      return Result.ok(stripped);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Failed to strip HTML comments', err);
      return Result.err(err);
    }
  }

  /**
   * Processes a template with context data
   * Simple mustache-style variable replacement: {{variableName}}
   *
   * @param template - Template string
   * @param data - Context data for template processing
   * @returns Result containing processed template or error
   */
  async processTemplate(
    template: string,
    data: Record<string, unknown>,
  ): Promise<Result<string>> {
    try {
      let processed = template;

      // Simple variable replacement: {{variableName}}
      // Use function replacement so $, $&, $1... in the value are treated as literals.
      for (const [key, value] of Object.entries(data)) {
        const placeholder = `{{${key}}}`;
        const replacementValue = String(value);
        processed = processed.replace(
          new RegExp(placeholder, 'g'),
          () => replacementValue,
        );
      }

      return Result.ok(processed);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Failed to process template', err);
      return Result.err(err);
    }
  }
}
