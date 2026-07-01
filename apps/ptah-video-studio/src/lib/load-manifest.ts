/**
 * Manifest / artifact loading + Zod validation boundary.
 *
 * This is the single trust boundary (FR-1) between the capture side
 * (beats.json / durations.json / captions.json on disk) and the Remotion
 * compositions. Everything downstream of these parsers trusts the typed
 * shapes. The `SceneManifest` TS shape is imported types-only from the e2e
 * app via `@ptah-extension/showcase-manifest` (no runtime coupling); the Zod schema
 * here is the runtime guard that the loaded JSON actually matches it.
 */
import { z } from 'zod';
import type { SceneManifest } from '@ptah-extension/showcase-manifest';

export const beatSchema = z.object({
  tMs: z.number().nonnegative(),
  text: z.string(),
  scene: z.string(),
});

export const sceneManifestSchema = z.object({
  scene: z.string(),
  title: z.string(),
  recordStartMs: z.number(),
  durationMs: z.number().nonnegative(),
  res: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  beats: z.array(beatSchema),
});

// Compile-time assertion that the Zod schema stays in lockstep with the shared
// TS shape. If `@ptah-extension/showcase-manifest` changes, this fails to compile.
type _SchemaMatchesShared =
  z.infer<typeof sceneManifestSchema> extends SceneManifest
    ? SceneManifest extends z.infer<typeof sceneManifestSchema>
      ? true
      : never
    : never;
const _assertSchemaMatch: _SchemaMatchesShared = true;

export const durationClipSchema = z.object({
  index: z.number().int().positive(),
  beatTMs: z.number().nonnegative(),
  file: z.string(),
  sampleRate: z.number().positive().optional(),
  durationMs: z.number().nonnegative(),
  text: z.string().optional(),
});

export const durationsSchema = z.object({
  scene: z.string(),
  voice: z.string().optional(),
  speed: z.number().optional(),
  generatedAt: z.string().optional(),
  clips: z.array(durationClipSchema),
});

/** @remotion/captions `Caption` shape — validated defensively at the boundary. */
export const captionSchema = z.object({
  text: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  timestampMs: z.number().nullable(),
  confidence: z.number().nullable(),
});

export const captionsSchema = z.array(captionSchema);

export type Durations = z.infer<typeof durationsSchema>;
export type DurationClip = z.infer<typeof durationClipSchema>;
export type CaptionToken = z.infer<typeof captionSchema>;

/** Parse + validate a raw beats.json object. Throws on schema mismatch. */
export function parseManifest(raw: unknown): SceneManifest {
  return sceneManifestSchema.parse(raw) as SceneManifest;
}

export function parseDurations(raw: unknown): Durations {
  return durationsSchema.parse(raw);
}

export function parseCaptions(raw: unknown): CaptionToken[] {
  return captionsSchema.parse(raw);
}

/** Composition fps is fixed at 30 regardless of source webm fps. */
export const OUTPUT_FPS = 30;

export function msToFrames(ms: number, fps: number = OUTPUT_FPS): number {
  return Math.round((ms / 1000) * fps);
}
