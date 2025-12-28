import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
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
  private readonly MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
  private readonly MAX_TEXT_FILE_SIZE = 1 * 1024 * 1024; // 1MB limit for text files to prevent context overflow

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
      this.SUPPORTED_IMAGES.has(path.extname(file).toLowerCase())
    );
  }

  /**
   * Process a list of files into content blocks
   * - Images are converted to base64 blocks
   * - Text files are read and wrapped in XML tags
   * - Folders are passed as references (agent will explore using its tools)
   */
  async processAttachments(
    files: readonly string[]
  ): Promise<UserMessageContentBlock[]> {
    const blocks: UserMessageContentBlock[] = [];

    for (const file of files) {
      try {
        const stats = await fs.stat(file);

        // Handle folders - pass path as reference for agent to explore
        if (stats.isDirectory()) {
          const folderBlock = this.processFolderReference(file);
          blocks.push(folderBlock);
          continue;
        }

        const ext = path.extname(file).toLowerCase();

        if (this.SUPPORTED_IMAGES.has(ext)) {
          const imageBlock = await this.processImage(file, stats.size, ext);
          if (imageBlock) blocks.push(imageBlock);
        } else {
          // Treat everything else as text (with size check)
          // We could add a binary check here if needed, but for now assuming non-image = text
          const textBlock = await this.processTextFile(file, stats.size);
          if (textBlock) blocks.push(textBlock);
        }
      } catch (error) {
        this.logger.warn(
          `[AttachmentProcessor] Failed to process file: ${file}`,
          error as Error
        );
      }
    }

    return blocks;
  }

  /**
   * Process folder reference - don't read contents, just pass path for agent to explore
   * The agent will use its tools (Read, Glob, Grep) to explore the folder as needed
   */
  private processFolderReference(folderPath: string): UserMessageContentBlock {
    this.logger.debug(
      `[AttachmentProcessor] Processing folder reference: ${folderPath}`
    );

    return {
      type: 'text',
      text: `<folder path="${folderPath}">\nThis is a folder reference. Please explore its contents using your tools (Read, Glob, Grep) as needed.\n</folder>`,
    };
  }

  private async processImage(
    filePath: string,
    size: number,
    ext: string
  ): Promise<UserMessageContentBlock | null> {
    if (size > this.MAX_IMAGE_SIZE) {
      this.logger.warn(
        `[AttachmentProcessor] Image too large (>5MB): ${filePath}`
      );
      return null;
    }

    try {
      const buffer = await fs.readFile(filePath);
      const base64 = buffer.toString('base64');
      const mediaType = this.getMediaType(ext);

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
        error as Error
      );
      return null;
    }
  }

  private async processTextFile(
    filePath: string,
    size: number
  ): Promise<UserMessageContentBlock | null> {
    if (size > this.MAX_TEXT_FILE_SIZE) {
      // Just log warning, maybe we want to truncate later, but for now skip
      this.logger.warn(
        `[AttachmentProcessor] Text file too large (>1MB): ${filePath}`
      );
      return null;
    }

    try {
      // Check for binary content (simple null byte check)
      const buffer = await fs.readFile(filePath);
      if (buffer.includes(0)) {
        this.logger.warn(
          `[AttachmentProcessor] Skipping binary file (null bytes detected): ${filePath}`
        );
        return null;
      }

      const content = buffer.toString('utf-8');

      // XML wrapping for clear context
      const xmlContent = `<document path="${filePath}">\n${content}\n</document>`;

      return {
        type: 'text',
        text: xmlContent,
      };
    } catch (error) {
      this.logger.error(
        `[AttachmentProcessor] Error reading text file: ${filePath}`,
        error as Error
      );
      return null;
    }
  }

  private getMediaType(ext: string): string {
    switch (ext) {
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.png':
        return 'image/png';
      case '.gif':
        return 'image/gif';
      case '.webp':
        return 'image/webp';
      default:
        return 'image/jpeg';
    }
  }
}
