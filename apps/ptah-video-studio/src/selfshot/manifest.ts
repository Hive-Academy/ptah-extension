/**
 * Self-shot beats manifest — the authoring contract (one JSON per video).
 *
 * This is the FOUNDER-FACING schema: it references his own recording(s) by
 * filename and lays out a `beats[]` timeline over them. A beat's `at` (and
 * optional `until`) may be a raw seconds offset OR a transcript WORD ANCHOR
 * ({ word, occurrence }) that `scripts/lib/selfshot-resolve.mjs` turns into a
 * millisecond timestamp using `words.json` (whisper output). Nothing here is
 * consumed by the Remotion compositions directly — the render script resolves
 * this manifest into the numeric `ResolvedSelfShotProps` shape (see
 * `resolved.ts`) that the compositions actually read.
 *
 * SOURCE OF TRUTH. `scripts/lib/selfshot-resolve.mjs` is plain `.mjs` and cannot
 * import this TS/zod schema, so it re-implements a structural validator by hand.
 * Keep the two in lockstep when a field changes (same discipline as
 * `shots.ts` ↔ `render-all.mjs:validateShotsFile`).
 */
import { z } from 'zod';

/** A point on the timeline: seconds (number) OR a transcript word anchor. */
export const anchorSchema = z.union([
  z.number().nonnegative(),
  z.object({
    /** The transcript word to anchor to (matched case-insensitively, punctuation-stripped). */
    word: z.string().min(1),
    /** Which occurrence of that word (1-based; default 1). */
    occurrence: z.number().int().positive().optional(),
    /** ms nudge applied after resolving the word's start (can be negative). */
    offsetMs: z.number().optional(),
  }),
]);
export type Anchor = z.infer<typeof anchorSchema>;

/** The four Hybrid layout states (also used to seed screen-demo/ talking-head). */
export const layoutStateSchema = z.enum([
  'camera-full',
  'screen-full-with-bubble',
  'side-by-side',
  'screen-only',
]);
export type LayoutState = z.infer<typeof layoutStateSchema>;

const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

const cornerSchema = z.enum(['tl', 'tr', 'bl', 'br']);

/** Fields shared by every beat. */
const beatCommon = {
  at: anchorSchema,
  /** Optional end of the beat's effect; else a per-type default duration is used. */
  until: anchorSchema.optional(),
  /** Explicit visible duration (ms). Wins over `until`. */
  durationMs: z.number().positive().optional(),
  /** Free-form note for the author; ignored by the renderer. */
  note: z.string().optional(),
};

export const beatSchema = z.discriminatedUnion('type', [
  // Hybrid layout state machine: switch the on-screen composition.
  z.object({
    type: z.literal('layout-switch'),
    ...beatCommon,
    layout: layoutStateSchema,
  }),
  // Lower-third intro card (name / title / handle).
  z.object({
    type: z.literal('lower-third'),
    ...beatCommon,
    title: z.string(),
    subtitle: z.string().optional(),
  }),
  // Keyword pop-up chip.
  z.object({
    type: z.literal('keyword'),
    ...beatCommon,
    text: z.string(),
    corner: cornerSchema.optional(),
  }),
  // Stat callout card (big number + label).
  z.object({
    type: z.literal('stat'),
    ...beatCommon,
    value: z.string(),
    label: z.string(),
    corner: cornerSchema.optional(),
  }),
  // B-roll cutaway (an existing showcase mp4), full-screen or PiP.
  z.object({
    type: z.literal('broll'),
    ...beatCommon,
    /** Filename in the ingest dir OR a showcase scene slug (resolved to its out mp4). */
    src: z.string(),
    layout: z.enum(['full', 'pip']).optional(),
    corner: cornerSchema.optional(),
  }),
  // Amber highlight ring on a screen region (no camera move).
  z.object({
    type: z.literal('highlight'),
    ...beatCommon,
    rect: rectSchema,
    /** Optional floating label near the ring. */
    label: z.string().optional(),
  }),
  // Virtual-camera punch-in on a screen region (zoom + pan), optional ring.
  z.object({
    type: z.literal('zoom'),
    ...beatCommon,
    rect: rectSchema,
    ring: z.boolean().optional(),
    transMs: z.number().positive().optional(),
    ease: z.enum(['ramp', 'smooth', 'cut']).optional(),
  }),
]);
export type Beat = z.infer<typeof beatSchema>;

export const selfShotModeSchema = z.enum([
  'talking-head',
  'screen-demo',
  'hybrid',
]);
export type SelfShotMode = z.infer<typeof selfShotModeSchema>;

export const selfShotManifestSchema = z.object({
  /** Output slug — names the render files. Defaults to the ingest folder name. */
  slug: z.string().optional(),
  mode: selfShotModeSchema,
  /** Input recordings (filenames relative to the ingest dir). */
  input: z.object({
    cameraVideo: z.string().optional(),
    screenVideo: z.string().optional(),
    /** Separate voice track; when present the video audio is muted. */
    audio: z.string().optional(),
  }),
  /** Screen-recording geometry override (else probed / assumed full-frame). */
  screenSource: z
    .object({
      width: z.number().positive(),
      height: z.number().positive(),
      contentHeight: z.number().positive(),
    })
    .optional(),
  /** Circular camera bubble for screen-demo / hybrid screen layouts. */
  bubble: z
    .object({
      enabled: z.boolean().optional(),
      corner: cornerSchema.optional(),
      /** Diameter as a fraction of frame height (default 0.24). */
      sizePct: z.number().positive().optional(),
    })
    .optional(),
  /** Branded end card. `enabled: false` omits it. */
  endCard: z
    .object({
      enabled: z.boolean().optional(),
      durationMs: z.number().positive().optional(),
      headline: z.string().optional(),
    })
    .optional(),
  /** Music-bed filename (in the ingest dir or assets/music/); ducked under VO. */
  music: z.string().optional(),
  beats: z.array(beatSchema),
});
export type SelfShotManifest = z.infer<typeof selfShotManifestSchema>;

/** Parse + validate a raw beats manifest object. Throws on schema mismatch. */
export function parseSelfShotManifest(raw: unknown): SelfShotManifest {
  return selfShotManifestSchema.parse(raw);
}
