import { Result } from '@ptah-extension/shared';
import { retryWithBackoff } from '@ptah-extension/shared';
import { z } from 'zod';
import { BaseLlmProvider } from './base-llm.provider';
import { LlmProviderError } from '../errors/llm-provider.error';
import {
  LlmCompletionConfig,
  LlmPromptInput,
} from '../interfaces/llm-provider.interface';

// Runtime import of @google/genai (ESM package with CJS fallback).
// Using require() because the library tsconfig uses "module": "node16"
// and @google/genai has "type": "module", causing TS1479/TS1541 with static imports.
// The package does provide a CJS build at dist/node/index.cjs.

const googleGenAiModule = require('@google/genai');
const GoogleGenAI: new (config: { apiKey: string }) => GoogleGenAIInstance =
  googleGenAiModule.GoogleGenAI;

/**
 * Typed interface for the GoogleGenAI instance used at runtime.
 * Defined locally to avoid ESM import issues with @google/genai in CJS context.
 */
interface GoogleGenAIInstance {
  models: {
    generateContent(params: {
      model: string;
      contents: string;
      config?: Record<string, unknown>;
    }): Promise<{
      text?: string | null;
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

/**
 * Options for image generation via Google Gemini or Imagen models.
 */
export interface ImageGenOptions {
  /** Model to use (e.g., 'gemini-2.5-flash-image', 'imagen-4.0-generate-001') */
  model?: string;
  /** Aspect ratio (e.g., '1:1', '16:9', '9:16') */
  aspectRatio?: string;
  /** Number of images to generate (1-4) */
  numberOfImages?: number;
}

/**
 * Result of image generation containing generated image data.
 */
export interface ImageGenResult {
  /** Array of generated images with base64 data and MIME type */
  images: Array<{ data: string; mimeType: string }>;
  /** Model used for generation */
  model: string;
}

/**
 * Extract error status from an unknown error object.
 * Uses bracket notation for index signature access (noPropertyAccessFromIndexSignature).
 */
function getErrorStatus(error: unknown): number | undefined {
  if (error == null || typeof error !== 'object') return undefined;
  const err = error as Record<string, unknown>;
  const directStatus = err['status'];
  if (typeof directStatus === 'number') return directStatus;

  const response = err['response'];
  if (response != null && typeof response === 'object') {
    const respStatus = (response as Record<string, unknown>)['status'];
    if (typeof respStatus === 'number') return respStatus;
  }
  return undefined;
}

/** Retry configuration for transient API errors. */
const RETRY_OPTIONS = {
  retries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  factor: 2,
  shouldRetry: (error: unknown): boolean => {
    const status = getErrorStatus(error);
    return status === 429 || status === 500 || status === 502 || status === 503;
  },
};

/**
 * Google Gemini provider implementation using the native @google/genai SDK.
 *
 * Supports Gemini 2.5 Flash/Pro models for text, structured output, and image generation.
 *
 * Features:
 * - Large context window (1M tokens for Gemini 2.5 Flash)
 * - Structured output via native JSON mode (responseMimeType + responseSchema)
 * - Image generation via Gemini native (generateContent) and Imagen (generateImages)
 * - Token counting approximation
 * - Automatic retry with exponential backoff
 */
export class GoogleGenAIProvider extends BaseLlmProvider {
  public readonly name = 'google-genai';
  private ai: GoogleGenAIInstance;

  constructor(
    private readonly apiKey: string,
    private readonly modelName: string,
    private readonly temperature = 0.7,
    private readonly maxOutputTokens?: number
  ) {
    super();
    this.defaultContextSize = 1048576; // Gemini 2.5 Flash context window (1M tokens)

    this.ai = new GoogleGenAI({ apiKey: this.apiKey });
  }

  /**
   * Get a text completion from Google Gemini.
   * Uses generateContent with system instruction and user content.
   */
  async getCompletion(
    systemPrompt: string,
    userPrompt: string
  ): Promise<Result<string, LlmProviderError>> {
    try {
      const response = await retryWithBackoff(
        () =>
          this.ai.models.generateContent({
            model: this.modelName,
            contents: userPrompt,
            config: {
              systemInstruction: systemPrompt,
              temperature: this.temperature,
              maxOutputTokens: this.maxOutputTokens,
            },
          }),
        RETRY_OPTIONS
      );

      const text = response.text;
      if (text === undefined || text === null) {
        return Result.err(
          new LlmProviderError(
            'Google Gemini returned empty response',
            'PARSING_ERROR',
            this.name
          )
        );
      }

      return Result.ok(text);
    } catch (error) {
      return Result.err(LlmProviderError.fromError(error, this.name));
    }
  }

  override async getContextWindowSize(): Promise<number> {
    return this.defaultContextSize;
  }

  override async countTokens(text: string): Promise<number> {
    // Approximation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Get a structured completion that conforms to a Zod schema.
   * Uses Gemini's native JSON mode with responseMimeType and responseSchema.
   *
   * @param prompt The prompt to send (string or message array)
   * @param schema Zod schema defining expected output structure
   * @param completionConfig Optional completion parameters
   * @returns Result containing parsed, type-safe object or error
   */
  async getStructuredCompletion<T extends z.ZodTypeAny>(
    prompt: LlmPromptInput,
    schema: T,
    completionConfig?: LlmCompletionConfig
  ): Promise<Result<z.infer<T>, LlmProviderError>> {
    try {
      const promptString = this._extractPromptString(prompt);

      // Convert Zod schema to JSON Schema using Zod v4 built-in conversion
      const jsonSchema = z.toJSONSchema(schema);

      // Build config with optional overrides
      const temperature = completionConfig?.temperature ?? this.temperature;
      const maxOutputTokens =
        completionConfig?.maxTokens ?? this.maxOutputTokens;

      const response = await retryWithBackoff(
        () =>
          this.ai.models.generateContent({
            model: this.modelName,
            contents: promptString,
            config: {
              temperature,
              maxOutputTokens,
              topP: completionConfig?.topP,
              stopSequences: completionConfig?.stopSequences,
              responseMimeType: 'application/json',
              responseSchema: jsonSchema as Record<string, unknown>,
            },
          }),
        RETRY_OPTIONS
      );

      const text = response.text;
      if (text === undefined || text === null) {
        return Result.err(
          new LlmProviderError(
            'Google Gemini returned empty structured response',
            'PARSING_ERROR',
            this.name
          )
        );
      }

      // Parse JSON and validate against Zod schema
      const parsed = JSON.parse(text);
      const validated = schema.parse(parsed);

      return Result.ok(validated);
    } catch (error) {
      if (error instanceof LlmProviderError) {
        return Result.err(error);
      }
      if (error instanceof z.ZodError) {
        return Result.err(
          new LlmProviderError(
            `Schema validation failed: ${error.message}`,
            'PARSING_ERROR',
            this.name,
            { zodIssues: error.issues }
          )
        );
      }
      if (error instanceof SyntaxError) {
        return Result.err(
          new LlmProviderError(
            `Failed to parse JSON response: ${error.message}`,
            'PARSING_ERROR',
            this.name
          )
        );
      }
      return Result.err(LlmProviderError.fromError(error, this.name));
    }
  }

  /**
   * Generate images using Google Gemini native or Imagen models.
   *
   * Routes to the appropriate API based on the model name:
   * - `gemini-*` models use generateContent with IMAGE response modality
   * - `imagen-*` models use the dedicated generateImages API
   *
   * @param prompt Text description of the image to generate
   * @param options Image generation options (model, aspectRatio, numberOfImages)
   * @returns Result containing generated image data or error
   */
  async generateImage(
    prompt: string,
    options?: ImageGenOptions
  ): Promise<Result<ImageGenResult, LlmProviderError>> {
    const model = options?.model ?? 'gemini-2.5-flash-image';

    try {
      if (model.startsWith('imagen-')) {
        return await this._generateWithImagen(prompt, model, options);
      }
      return await this._generateWithGeminiNative(prompt, model);
    } catch (error) {
      if (error instanceof LlmProviderError) {
        return Result.err(error);
      }
      return Result.err(LlmProviderError.fromError(error, this.name));
    }
  }

  /**
   * Generate images using Gemini native model (generateContent with IMAGE modality).
   * Supports conversational image editing and text+image output.
   */
  private async _generateWithGeminiNative(
    prompt: string,
    model: string
  ): Promise<Result<ImageGenResult, LlmProviderError>> {
    const response = await retryWithBackoff(
      () =>
        this.ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseModalities: ['TEXT', 'IMAGE'],
          },
        }),
      RETRY_OPTIONS
    );

    const images: Array<{ data: string; mimeType: string }> = [];

    if (response.candidates && response.candidates.length > 0) {
      const parts = response.candidates[0].content?.parts ?? [];
      for (const part of parts) {
        if (part.inlineData?.data && part.inlineData?.mimeType) {
          images.push({
            data: part.inlineData.data,
            mimeType: part.inlineData.mimeType,
          });
        }
      }
    }

    if (images.length === 0) {
      return Result.err(
        new LlmProviderError(
          'Gemini native image generation returned no images',
          'PARSING_ERROR',
          this.name
        )
      );
    }

    return Result.ok({ images, model });
  }

  /**
   * Generate images using the dedicated Imagen API (generateImages).
   * Best for photorealistic image generation.
   */
  private async _generateWithImagen(
    prompt: string,
    model: string,
    options?: ImageGenOptions
  ): Promise<Result<ImageGenResult, LlmProviderError>> {
    const response = await retryWithBackoff(
      () =>
        this.ai.models.generateImages({
          model,
          prompt,
          config: {
            numberOfImages: options?.numberOfImages ?? 1,
            aspectRatio: options?.aspectRatio ?? '1:1',
          },
        }),
      RETRY_OPTIONS
    );

    const images: Array<{ data: string; mimeType: string }> = [];

    if (response.generatedImages) {
      for (const img of response.generatedImages) {
        if (img.image?.imageBytes) {
          images.push({
            data: img.image.imageBytes,
            mimeType: 'image/png',
          });
        }
      }
    }

    if (images.length === 0) {
      return Result.err(
        new LlmProviderError(
          'Imagen API returned no images',
          'PARSING_ERROR',
          this.name
        )
      );
    }

    return Result.ok({ images, model });
  }

  /**
   * Extract a string prompt from LlmPromptInput.
   * Converts message arrays to a single concatenated string.
   */
  private _extractPromptString(prompt: LlmPromptInput): string {
    if (typeof prompt === 'string') {
      return prompt;
    }
    return prompt.map((msg) => `${msg.role}: ${msg.content}`).join('\n');
  }
}
