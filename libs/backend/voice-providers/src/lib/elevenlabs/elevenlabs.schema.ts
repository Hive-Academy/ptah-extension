/**
 * Zod response schemas for the ElevenLabs HTTP boundary (R4). `looseObject`
 * keeps unknown vendor fields while still asserting the fields we consume — so
 * genuine drift (a renamed/removed field we depend on) fails loudly and locally
 * instead of surfacing as `undefined` deep in the adapters.
 *
 * These are parsed ONLY at the `fetch` boundary; internal types are trusted
 * past that point.
 */
import { z } from 'zod';

/** GET /v1/voices — only the fields the voice picker needs. */
export const VoicesResponseSchema = z.looseObject({
  voices: z.array(
    z.looseObject({
      voice_id: z.string(),
      name: z.string(),
      category: z.string().optional(),
    }),
  ),
});
export type ElevenLabsVoicesResponse = z.infer<typeof VoicesResponseSchema>;

/** POST /v1/speech-to-text (Scribe). */
export const SttResponseSchema = z.looseObject({
  text: z.string(),
  language_code: z.string().optional(),
});
export type ElevenLabsSttResponse = z.infer<typeof SttResponseSchema>;

/**
 * Best-effort error-body shape. Parsed ONLY to categorize an HTTP failure
 * (e.g. `detail.status === 'quota_exceeded'`). The parsed value is NEVER
 * forwarded to a caller, a log, or a thrown message (R6).
 */
export const ErrorBodySchema = z.looseObject({
  detail: z
    .looseObject({
      status: z.string().optional(),
      message: z.string().optional(),
    })
    .optional(),
});

/** Categorization-only detail extracted from an error body (never forwarded). */
export type ElevenLabsErrorDetail =
  | { status?: string; message?: string }
  | undefined;
