import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  MAX_IMAGE_SIZE_BYTES,
  resolveImageMediaType,
} from '@ptah-extension/shared';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  TextBlock,
  ToolResultBlock,
} from '../types/sdk-types/claude-sdk.types';

/**
 * User message content block - can be text, image, or tool result
 * Matches UserMessageContent array element type
 */
type UserMessageContentBlock =
  | TextBlock
  | {
      type: 'image';
      source: { type: 'base64'; media_type: string; data: string };
    }
  | ToolResultBlock;

/**
 * Service to process file attachments (images and text)
 * Converts them into SDK-compatible ContentBlocks
 */
@injectable()
export class AttachmentProcessorService {
  /** Anthropic per-image size cap; shared constant keeps backend/frontend in sync. */
  private readonly MAX_IMAGE_SIZE = MAX_IMAGE_SIZE_BYTES;

  /**
   * - Small files (< 5KB): Embed content directly (config files, small scripts)
   * - Large files (>= 5KB): Path reference - Claude uses Read tool on demand
   *
   * Benefits of path reference for large files:
   * - Token efficiency: Only reads when actually needed
   * - Selective reading: Can read specific lines with offset/limit
   * - Fresh content: Gets current file state, not stale snapshot
   * - Large file support: No context overflow issues
   */
  private readonly SMALL_FILE_THRESHOLD = 5 * 1024; // 5KB - embed directly
  private readonly MAX_TEXT_FILE_SIZE = 1 * 1024 * 1024; // 1MB absolute limit

  private readonly SUPPORTED_IMAGES = new Set([
    '.jpg',
    '.jpeg',
    '.png',
    '.gif',
    '.webp',
  ]);

  constructor(@inject(TOKENS.LOGGER) private logger: Logger) {}

  /**
   * Check if the file list contains any supported images
   */
  hasImages(files: readonly string[]): boolean {
    return files.some((file) =>
      this.SUPPORTED_IMAGES.has(path.extname(file).toLowerCase()),
    );
  }

  /**
   * Process a list of files into content blocks
   * - Images are converted to base64 blocks
   * - Text files are read and wrapped in XML tags
   * - Folders are passed as references (agent will explore using its tools)
   *
   * Appends a single <system-reminder> block at the end with consolidated
   * instructions for all referenced attachments. The frontend strips
   * <system-reminder> tags from the user bubble display.
   */
  async processAttachments(
    files: readonly string[],
  ): Promise<UserMessageContentBlock[]> {
    const blocks: UserMessageContentBlock[] = [];
    const folderPaths: string[] = [];
    const referencedFilePaths: string[] = [];

    for (const file of files) {
      try {
        const stats = await fs.stat(file);

        // Handle folders - pass path as reference for agent to explore
        if (stats.isDirectory()) {
          const folderBlock = this.processFolderReference(file);
          blocks.push(folderBlock);
          folderPaths.push(file);
          continue;
        }

        const ext = path.extname(file).toLowerCase();

        if (this.SUPPORTED_IMAGES.has(ext)) {
          const imageBlock = await this.processImage(file, stats.size);
          if (imageBlock) blocks.push(imageBlock);
        } else {
          // Treat everything else as text (with size check)
          // We could add a binary check here if needed, but for now assuming non-image = text
          const isLargeFile =
            stats.size >= this.SMALL_FILE_THRESHOLD ||
            stats.size > this.MAX_TEXT_FILE_SIZE;
          const textBlock = await this.processTextFile(file, stats.size);
          if (textBlock) {
            blocks.push(textBlock);
            if (isLargeFile) {
              referencedFilePaths.push(file);
            }
          }
        }
      } catch (error) {
        this.logger.warn(
          `[AttachmentProcessor] Failed to process file: ${file}`,
          error as Error,
        );
      }
    }

    // Append a single consolidated <system-reminder> for all referenced attachments
    const systemReminder = this.buildAttachmentReminder(
      folderPaths,
      referencedFilePaths,
    );
    if (systemReminder) {
      blocks.push(systemReminder);
    }

    return blocks;
  }

  /**
   * Process folder reference - don't read contents, just pass path for agent to explore.
   * The agent will use its tools (Read, Glob, Grep) to explore the folder as needed.
   * Description/instructions are consolidated in a single <system-reminder> block
   * appended by buildAttachmentReminder() to avoid repetition.
   */
  private processFolderReference(folderPath: string): UserMessageContentBlock {
    this.logger.debug(
      `[AttachmentProcessor] Processing folder reference: ${folderPath}`,
    );

    return {
      type: 'text',
      text: `<folder path="${folderPath}" />`,
    };
  }

  private async processImage(
    filePath: string,
    size: number,
  ): Promise<UserMessageContentBlock | null> {
    if (size > this.MAX_IMAGE_SIZE) {
      this.logger.warn(
        `[AttachmentProcessor] Image too large (>5MB): ${filePath}`,
      );
      return null;
    }

    try {
      const buffer = await fs.readFile(filePath);
      const base64 = buffer.toString('base64');
      // Sniff magic bytes rather than trusting the extension — the Anthropic
      // API rejects anything outside jpeg/png/gif/webp, and files on disk can
      // be mislabeled (e.g. .jpg extension on a WebP payload).
      const mediaType = resolveImageMediaType(undefined, base64);
      if (mediaType === null) {
        this.logger.warn(
          `[AttachmentProcessor] Skipping image with unrecognized magic bytes: ${filePath}`,
        );
        return null;
      }

      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: base64,
        },
      };
    } catch (error) {
      this.logger.error(
        `[AttachmentProcessor] Error reading image: ${filePath}`,
        error as Error,
      );
      return null;
    }
  }

  /**
   * Process text file with hybrid approach:
   * - Small files (< 5KB): Embed content directly
   * - Large files (>= 5KB): Path reference for Claude to read on demand
   */
  private async processTextFile(
    filePath: string,
    size: number,
  ): Promise<UserMessageContentBlock | null> {
    // For files exceeding absolute max, use path reference (Claude can still read with offset/limit)
    if (size > this.MAX_TEXT_FILE_SIZE) {
      this.logger.info(
        `[AttachmentProcessor] Large file (>${
          this.MAX_TEXT_FILE_SIZE / 1024
        }KB), using path reference: ${filePath}`,
      );
      return this.processFileReference(filePath, size);
    }

    if (size >= this.SMALL_FILE_THRESHOLD) {
      this.logger.debug(
        `[AttachmentProcessor] File >= ${
          this.SMALL_FILE_THRESHOLD / 1024
        }KB, using path reference: ${filePath}`,
      );
      return this.processFileReference(filePath, size);
    }

    // Small files (< 5KB) - embed content directly
    try {
      // Check for binary content (simple null byte check)
      const buffer = await fs.readFile(filePath);
      if (buffer.includes(0)) {
        this.logger.warn(
          `[AttachmentProcessor] Skipping binary file (null bytes detected): ${filePath}`,
        );
        return null;
      }

      const content = buffer.toString('utf-8');

      this.logger.debug(
        `[AttachmentProcessor] Small file (${(size / 1024).toFixed(
          1,
        )}KB), embedding content: ${filePath}`,
      );

      // XML wrapping for clear context
      const xmlContent = `<file path="${filePath}" size="${size}" embedded="true">\n${content}\n</file>`;

      return {
        type: 'text',
        text: xmlContent,
      };
    } catch (error) {
      this.logger.error(
        `[AttachmentProcessor] Error reading text file: ${filePath}`,
        error as Error,
      );
      return null;
    }
  }

  /**
   * Process file as path reference - Claude will use Read tool to access content.
   * This is more token-efficient for large files and allows selective reading.
   * Description/instructions are consolidated in a single <system-reminder> block
   * appended by buildAttachmentReminder() to avoid repetition.
   */
  private processFileReference(
    filePath: string,
    size: number,
  ): UserMessageContentBlock {
    const sizeKB = (size / 1024).toFixed(1);
    const ext = path.extname(filePath).toLowerCase();

    return {
      type: 'text',
      text: `<file path="${filePath}" size="${size}" sizeKB="${sizeKB}" extension="${ext}" />`,
    };
  }

  /**
   * Build a single consolidated <system-reminder> block for all referenced attachments.
   * Contains instructions for using Glob/Read tools. The frontend strips
   * <system-reminder> tags from user bubble display so these instructions
   * are only visible to the LLM.
   */
  private buildAttachmentReminder(
    folderPaths: string[],
    referencedFilePaths: string[],
  ): UserMessageContentBlock | null {
    if (folderPaths.length === 0 && referencedFilePaths.length === 0) {
      return null;
    }

    const lines: string[] = [];

    if (folderPaths.length > 0) {
      lines.push(
        'The above folders are attached for reference. Use Glob to list files and Read to examine contents as needed.',
      );
      for (const fp of folderPaths) {
        lines.push(`Example: Glob pattern "${fp}/**/*" to see all files.`);
      }
    }

    if (referencedFilePaths.length > 0) {
      lines.push(
        'The above files are attached for reference. Use the Read tool to examine their contents when needed.',
      );
      lines.push(
        'You can read specific sections using offset and limit parameters for large files.',
      );
    }

    return {
      type: 'text',
      text: `<system-reminder>\n${lines.join('\n')}\n</system-reminder>`,
    };
  }
}
