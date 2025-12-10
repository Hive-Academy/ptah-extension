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
import { ContentBlock } from './session-lifecycle-manager';
import * as fs from 'fs/promises';
import * as path from 'path';

/** Maximum allowed image size (5MB) - matches Claude API limits */
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

/** Supported image extensions */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

@injectable()
export class ImageConverterService {
  constructor(@inject(TOKENS.LOGGER) private logger: Logger) {}

  /**
   * Convert text prompt and file paths into SDK ContentBlocks
   * Returns generic ContentBlock array which can be used if images are present
   *
   * @param text - The user's prompt text
   * @param files - List of file paths to check for images
   */
  async convertToContentBlocks(
    text: string,
    files: readonly string[]
  ): Promise<ContentBlock[]> {
    const blocks: ContentBlock[] = [{ type: 'text', text }];

    if (!files || files.length === 0) {
      return blocks;
    }

    this.logger.debug(
      `[ImageConverter] Checking ${files.length} files for images`
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
              ).toFixed(2)}MB exceeds limit 5MB`
            );
            continue;
          }

          // Read and convert
          const data = await fs.readFile(file);
          const mediaType = this.getMediaType(ext);

          blocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: data.toString('base64'),
            },
          });

          this.logger.debug(
            `[ImageConverter] Processed image: ${path.basename(file)}`
          );
        } catch (err) {
          this.logger.warn(
            `[ImageConverter] Failed to process image ${file}`,
            err instanceof Error ? err : new Error(String(err))
          );
        }
      }
    }

    return blocks;
  }

  /**
   * Map extension to MIME type
   */
  private getMediaType(ext: string): string {
    switch (ext) {
      case '.png':
        return 'image/png';
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.gif':
        return 'image/gif';
      case '.webp':
        return 'image/webp';
      default:
        return 'application/octet-stream';
    }
  }

  /**
   * Check if any files in the list are images
   */
  hasImages(files: readonly string[]): boolean {
    if (!files || files.length === 0) return false;
    return files.some((f) =>
      IMAGE_EXTENSIONS.has(path.extname(f || '').toLowerCase())
    );
  }
}
