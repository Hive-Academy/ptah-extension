/**
 * Image Namespace Builder
 *
 * Builds the ptah.image namespace providing image generation capabilities
 * via Google Gemini (native image generation) and Imagen APIs.
 *
 * Available methods:
 * - ptah.image.generate()    - Generate an image from a text prompt
 * - ptah.image.listModels()  - List available image generation models
 * - ptah.image.isAvailable() - Check if image generation is available
 */

import type { ImageNamespace } from '../types';
import type { ImageGenerationService } from '../services/image-generation.service';

/**
 * Dependencies required to build the image namespace
 */
export interface ImageNamespaceDependencies {
  imageGenerationService: ImageGenerationService;
}

/**
 * Build the ptah.image namespace with image generation capabilities
 */
export function buildImageNamespace(
  deps: ImageNamespaceDependencies
): ImageNamespace {
  return {
    /**
     * Generate an image from a text prompt
     * @param prompt - Text description of the image to generate
     * @param options - Optional generation parameters
     * @returns Generated image result with base64 data and metadata
     */
    generate: async (
      prompt: string,
      options?: {
        model?: string;
        aspectRatio?: string;
        numberOfImages?: number;
      }
    ) => {
      const result = await deps.imageGenerationService.generateImage(
        prompt,
        options
      );
      return result;
    },

    /**
     * List available image generation models
     * @returns Array of model descriptors with id, name, type, and description
     */
    listModels: () => {
      return [
        {
          id: 'gemini-2.5-flash-preview-06-25',
          name: 'Gemini 2.5 Flash (Native)',
          type: 'native' as const,
          description: 'Gemini native image generation via generateContent',
        },
        {
          id: 'imagen-4.0-generate-001',
          name: 'Imagen 4.0',
          type: 'imagen' as const,
          description: 'Dedicated Imagen API for photorealistic images',
        },
      ];
    },

    /**
     * Check whether image generation is available (API key configured)
     * @returns true if at least one image generation model is usable
     */
    isAvailable: async () => {
      return deps.imageGenerationService.isAvailable();
    },
  };
}
