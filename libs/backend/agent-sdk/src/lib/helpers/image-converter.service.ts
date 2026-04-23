/**
 * Image Converter Service - Handles image file processing for SDK messages
 *
 * Responsibilities:
 * - Detects image files in file list
 * - Validates image size (max 5MB)
 * - Converts images to base64 ContentBlocks
 * - Handles read errors gracefully
 *
 * TASK_2025_062 Batch 3: Image Support
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  MAX_IMAGE_SIZE_BYTES,
  resolveImageMediaType,
} from '@ptah-extension/shared';
import {
  TextBlock,
  ToolResultBlock,
} from '../types/sdk-types/claude-sdk.types';
import * as fs from 'fs/promises';
import * as path from 'path';

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

/** Maximum allowed image size — shared with the rest of the codebase. */
const MAX_IMAGE_SIZE = MAX_IMAGE_SIZE_BYTES;

/** Supported image extensions (filter gate; sniffing is the real check). */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

@injectable()
export class ImageConverterService {
  constructor(@inject(TOKENS.LOGGER) private logger: Logger) {}

  /**
   * Convert text prompt and file paths into SDK content blocks
   * Returns content block array which can be used if images are present
   *
   * @param text - The user's prompt text
   * @param files - List of file paths to check for images
   */
  async convertToContentBlocks(
    text: string,
    files: readonly string[],
  ): Promise<UserMessageContentBlock[]> {
    const blocks: UserMessageContentBlock[] = [{ type: 'text', text }];

    if (!files || files.length === 0) {
      return blocks;
    }

    this.logger.debug(
      `[ImageConverter] Checking ${files.length} files for images`,
    );

    for (const file of files) {
      if (!file) continue;

      const ext = path.extname(file).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        try {
          // Validate size first
          const stats = await fs.stat(file);
          if (stats.size > MAX_IMAGE_SIZE) {
            this.logger.warn(
              `[ImageConverter] Skipping image ${path.basename(file)}: size ${(
                stats.size /
                1024 /
                1024
              ).toFixed(2)}MB exceeds limit 5MB`,
            );
            continue;
          }

          // Read, base64-encode, then sniff. The previous ext-based switch
          // had an `application/octet-stream` fallback that is actively
          // rejected by the Anthropic API; trusting the ext would also let
          // mislabeled files (e.g. a PNG renamed .jpg) through.
          const data = await fs.readFile(file);
          const base64 = data.toString('base64');
          const mediaType = resolveImageMediaType(undefined, base64);
          if (mediaType === null) {
            this.logger.warn(
              `[ImageConverter] Skipping image ${path.basename(
                file,
              )}: unrecognized magic bytes`,
            );
            continue;
          }

          blocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64,
            },
          });

          this.logger.debug(
            `[ImageConverter] Processed image: ${path.basename(file)}`,
          );
        } catch (err) {
          this.logger.warn(
            `[ImageConverter] Failed to process image ${file}`,
            err instanceof Error ? err : new Error(String(err)),
          );
        }
      }
    }

    return blocks;
  }

  /**
   * Check if any files in the list are images
   */
  hasImages(files: readonly string[]): boolean {
    if (!files || files.length === 0) return false;
    return files.some((f) =>
      IMAGE_EXTENSIONS.has(path.extname(f || '').toLowerCase()),
    );
  }
}
