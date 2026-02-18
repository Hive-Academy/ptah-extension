/**
 * Image Generation Service
 *
 * Injectable service that uses the Google GenAI SDK (@google/genai) for image
 * generation, saving produced images into the workspace under
 * `.ptah/generated-images/`.
 *
 * Supports two generation backends:
 * - Gemini native models (generateContent with IMAGE response modality)
 * - Imagen models (dedicated generateImages API)
 *
 * API keys are retrieved from the VS Code SecretStorage via ILlmSecretsService.
 * No API key is embedded in this file.
 *
 * Note on the require() pattern:
 * The library tsconfig uses "module": "node16" and @google/genai has
 * "type": "module", causing TS1479/TS1541 errors with static ESM imports.
 * The package provides a CJS build at dist/node/index.cjs, so we use
 * require() to side-step the ESM/CJS interop issue – the same pattern used
 * in libs/backend/llm-abstraction/src/lib/providers/google-genai.provider.ts.
 */

import { injectable, inject } from 'tsyringe';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import type { ILlmSecretsService } from '@ptah-extension/llm-abstraction';

// ---------------------------------------------------------------------------
// Runtime import of @google/genai (ESM package with CJS fallback).
// Using require() because the library tsconfig uses "module": "node16"
// and @google/genai has "type": "module", causing TS1479/TS1541 with static imports.
// The package does provide a CJS build at dist/node/index.cjs.
// ---------------------------------------------------------------------------
let googleGenAiModule:
  | { GoogleGenAI: new (config: { apiKey: string }) => GoogleGenAIInstance }
  | undefined;
try {
  googleGenAiModule = require('@google/genai');
} catch {
  // @google/genai is not available – generateImage() will throw a descriptive error.
}

// ---------------------------------------------------------------------------
// Local type declaration for the GoogleGenAI instance returned by require().
// Kept local to avoid ESM import issues with @google/genai in a CJS context.
// ---------------------------------------------------------------------------
interface GoogleGenAIInstance {
  models: {
    generateContent(params: {
      model: string;
      contents: string;
      config?: Record<string, unknown>;
    }): Promise<{
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inlineData?: { data?: string; mimeType?: string };
            text?: string;
          }>;
        };
      }>;
    }>;
    generateImages(params: {
      model: string;
      prompt: string;
      config?: Record<string, unknown>;
    }): Promise<{
      generatedImages?: Array<{
        image?: { imageBytes?: string };
      }>;
    }>;
  };
}

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/**
 * Options controlling how images are generated.
 */
export interface ImageGenerationOptions {
  /**
   * Model identifier to use.
   * Defaults to 'gemini-2.5-flash-preview-06-25'.
   * Use an 'imagen-*' prefix to route to the Imagen API.
   */
  model?: string;

  /**
   * Aspect ratio for Imagen models (e.g., '1:1', '16:9', '9:16').
   * Defaults to '1:1'. Ignored for Gemini native models.
   */
  aspectRatio?: string;

  /**
   * Number of images to generate (1–4).
   * Defaults to 1. Only respected by the Imagen API.
   */
  numberOfImages?: number;
}

/**
 * Metadata for a single generated image that has been saved to disk.
 */
export interface GeneratedImage {
  /** Absolute path to the saved image file on disk. */
  path: string;

  /** MIME type of the image (e.g., 'image/png'). */
  mimeType: string;
}

/**
 * Result returned from a successful image generation request.
 */
export interface ImageGenerationResult {
  /** Array of images that were generated and saved. */
  images: GeneratedImage[];

  /** The model identifier that was used for generation. */
  model: string;
}

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'gemini-2.5-flash-preview-06-25';
const DEFAULT_ASPECT_RATIO = '1:1';
const DEFAULT_NUMBER_OF_IMAGES = 1;
const OUTPUT_DIR_RELATIVE = path.join('.ptah', 'generated-images');

// ---------------------------------------------------------------------------
// Service implementation
// ---------------------------------------------------------------------------

/**
 * ImageGenerationService
 *
 * Provides image generation backed by the Google GenAI SDK.
 * Automatically routes to Gemini native or Imagen depending on the model name.
 * Generated images are written to `<workspaceRoot>/.ptah/generated-images/`.
 */
@injectable()
export class ImageGenerationService {
  /** Cached GoogleGenAI instance, invalidated when the API key changes. */
  private cachedAi: GoogleGenAIInstance | undefined;
  /** API key used to create the cached instance (for staleness detection). */
  private cachedApiKey: string | undefined;

  constructor(
    @inject(TOKENS.LLM_SECRETS_SERVICE)
    private readonly secretsService: ILlmSecretsService,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger
  ) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Check whether image generation is available.
   * Returns true when a Google GenAI API key is configured in SecretStorage.
   */
  async isAvailable(): Promise<boolean> {
    return this.secretsService.hasApiKey('google-genai');
  }

  /**
   * Generate one or more images from a text prompt.
   *
   * Routing logic:
   * - Models whose name starts with 'imagen-' use the Imagen generateImages API.
   * - All other models use Gemini native generateContent with IMAGE modality.
   *
   * @param prompt   Natural-language description of the desired image(s).
   * @param options  Optional model / aspect-ratio / count overrides.
   * @returns        Paths and MIME types of the saved image files.
   * @throws         Error when no Google GenAI API key is configured.
   * @throws         Error when image generation fails or returns no images.
   */
  async generateImage(
    prompt: string,
    options?: ImageGenerationOptions
  ): Promise<ImageGenerationResult> {
    const available = await this.isAvailable();
    if (!available) {
      throw new Error(
        'Google GenAI API key is not configured. ' +
          'Please add your API key in the Ptah settings.'
      );
    }

    if (!prompt?.trim()) {
      throw new Error('Image generation prompt cannot be empty.');
    }

    const apiKey = await this.secretsService.getApiKey('google-genai');
    if (!apiKey) {
      throw new Error(
        'Failed to retrieve Google GenAI API key from SecretStorage.'
      );
    }

    if (!googleGenAiModule) {
      throw new Error(
        '@google/genai package is not available. ' +
          'Please ensure it is installed as a dependency.'
      );
    }

    // Reuse the cached GoogleGenAI instance when the API key has not changed.
    if (!this.cachedAi || this.cachedApiKey !== apiKey) {
      this.cachedAi = new googleGenAiModule.GoogleGenAI({ apiKey });
      this.cachedApiKey = apiKey;
    }
    const ai = this.cachedAi;

    const resolvedModel = options?.model ?? DEFAULT_MODEL;
    const resolvedOptions = options
      ? {
          ...options,
          numberOfImages:
            options.numberOfImages !== undefined
              ? Math.max(1, Math.min(4, options.numberOfImages))
              : undefined,
        }
      : undefined;

    this.logger.info(
      '[ImageGenerationService.generateImage] Starting generation',
      {
        model: resolvedModel,
        promptLength: prompt.length,
      }
    );

    let rawImages: Array<{ data: string; mimeType: string }>;

    if (resolvedModel.startsWith('imagen-')) {
      rawImages = await this.generateWithImagen(
        ai,
        prompt,
        resolvedModel,
        resolvedOptions
      );
    } else {
      rawImages = await this.generateWithGeminiNative(
        ai,
        prompt,
        resolvedModel
      );
    }

    const savedImages = await this.saveImages(rawImages);

    this.logger.info(
      '[ImageGenerationService.generateImage] Generation complete',
      {
        model: resolvedModel,
        imageCount: savedImages.length,
      }
    );

    return { images: savedImages, model: resolvedModel };
  }

  // -------------------------------------------------------------------------
  // Private generation helpers
  // -------------------------------------------------------------------------

  /**
   * Generate images using Gemini native generateContent with IMAGE modality.
   * The response parts are scanned for `inlineData` entries containing base64
   * image data.
   */
  private async generateWithGeminiNative(
    ai: GoogleGenAIInstance,
    prompt: string,
    model: string
  ): Promise<Array<{ data: string; mimeType: string }>> {
    this.logger.debug(
      '[ImageGenerationService.generateWithGeminiNative] Calling API',
      {
        model,
      }
    );

    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: { responseModalities: ['TEXT', 'IMAGE'] },
    });

    const images: Array<{ data: string; mimeType: string }> = [];

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data && part.inlineData?.mimeType) {
        images.push({
          data: part.inlineData.data,
          mimeType: part.inlineData.mimeType,
        });
      }
    }

    if (images.length === 0) {
      throw new Error(
        `Gemini native image generation (model: ${model}) returned no images. ` +
          'The model may not support IMAGE modality, or the prompt was blocked.'
      );
    }

    return images;
  }

  /**
   * Generate images using the dedicated Imagen generateImages API.
   * Supports aspect ratio and multi-image requests (up to 4).
   */
  private async generateWithImagen(
    ai: GoogleGenAIInstance,
    prompt: string,
    model: string,
    options?: ImageGenerationOptions
  ): Promise<Array<{ data: string; mimeType: string }>> {
    const numberOfImages = options?.numberOfImages ?? DEFAULT_NUMBER_OF_IMAGES;
    const aspectRatio = options?.aspectRatio ?? DEFAULT_ASPECT_RATIO;

    this.logger.debug(
      '[ImageGenerationService.generateWithImagen] Calling API',
      {
        model,
        numberOfImages,
        aspectRatio,
      }
    );

    const response = await ai.models.generateImages({
      model,
      prompt,
      config: { numberOfImages, aspectRatio },
    });

    const images: Array<{ data: string; mimeType: string }> = [];

    for (const img of response.generatedImages ?? []) {
      if (img.image?.imageBytes) {
        images.push({
          data: img.image.imageBytes,
          mimeType: 'image/png',
        });
      }
    }

    if (images.length === 0) {
      throw new Error(
        `Imagen API (model: ${model}) returned no images. ` +
          'The prompt may have been blocked by safety filters.'
      );
    }

    return images;
  }

  // -------------------------------------------------------------------------
  // Private persistence helpers
  // -------------------------------------------------------------------------

  /**
   * Write base64-encoded image data to disk inside the active workspace.
   *
   * Files are placed at:
   *   `<workspaceRoot>/.ptah/generated-images/<timestamp>-<index>.<ext>`
   *
   * The `.ptah/generated-images/` directory is created recursively if it does
   * not yet exist.
   *
   * @param images  Array of raw base64 image data and MIME types.
   * @returns       Array of absolute disk paths and MIME types.
   * @throws        Error when no workspace folder is open.
   */
  private async saveImages(
    images: Array<{ data: string; mimeType: string }>
  ): Promise<GeneratedImage[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error(
        'No workspace folder is open. Generated images cannot be saved.'
      );
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const outputDir = path.join(workspaceRoot, OUTPUT_DIR_RELATIVE);

    // Ensure the output directory exists.
    await fs.promises.mkdir(outputDir, { recursive: true });

    const timestamp = Date.now();
    const saved: GeneratedImage[] = [];

    for (let i = 0; i < images.length; i++) {
      const { data, mimeType } = images[i];
      const ext =
        mimeType === 'image/jpeg'
          ? '.jpg'
          : mimeType === 'image/webp'
          ? '.webp'
          : '.png';
      const fileName = `${timestamp}-${i}${ext}`;
      const filePath = path.join(outputDir, fileName);

      await fs.promises.writeFile(filePath, Buffer.from(data, 'base64'));

      this.logger.debug('[ImageGenerationService.saveImages] Saved image', {
        filePath,
        mimeType,
      });

      saved.push({ path: filePath, mimeType });
    }

    return saved;
  }
}
