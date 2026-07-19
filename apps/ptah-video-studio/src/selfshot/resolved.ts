/**
 * Resolved self-shot props — the numeric shape the compositions actually read.
 *
 * `scripts/selfshot-render.mjs` turns an authored beats manifest (`manifest.ts`,
 * word anchors + seconds) into THIS: every time is an absolute millisecond on
 * the composition clock, word anchors are resolved, zoom/highlight beats are
 * lowered to a `Shot[]` camera track, and overlay beats to `overlays[]`. The
 * TalkingHead / ScreenDemo / Hybrid compositions consume only this — same
 * "resolve in the script, render dumb" split as ShowcaseVideo's render-all.
 *
 * The zod schema is the runtime trust boundary (Remotion loads props JSON from
 * disk); keep it in lockstep with the render script's output object.
 */
import { z } from 'zod';
import { captionSchema, type CaptionToken } from '../lib/load-manifest';
import { shotSchema, type Shot } from '../lib/shots';
import { layoutStateSchema, selfShotModeSchema } from './manifest';

const cornerSchema = z.enum(['tl', 'tr', 'bl', 'br']);

/** An overlay resolved to an absolute [atMs, atMs+durationMs] window. */
export const resolvedOverlaySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('lower-third'),
    atMs: z.number().nonnegative(),
    durationMs: z.number().positive(),
    title: z.string(),
    subtitle: z.string().optional(),
  }),
  z.object({
    type: z.literal('keyword'),
    atMs: z.number().nonnegative(),
    durationMs: z.number().positive(),
    text: z.string(),
    corner: cornerSchema.optional(),
  }),
  z.object({
    type: z.literal('stat'),
    atMs: z.number().nonnegative(),
    durationMs: z.number().positive(),
    value: z.string(),
    label: z.string(),
    corner: cornerSchema.optional(),
  }),
  z.object({
    type: z.literal('broll'),
    atMs: z.number().nonnegative(),
    durationMs: z.number().positive(),
    /** staticFile-relative name of the b-roll mp4 (staged into the public dir). */
    src: z.string(),
    layout: z.enum(['full', 'pip']),
    corner: cornerSchema.optional(),
  }),
]);
export type ResolvedOverlay = z.infer<typeof resolvedOverlaySchema>;

export const resolvedLayoutSchema = z.object({
  atMs: z.number().nonnegative(),
  layout: layoutStateSchema,
});
export type ResolvedLayout = z.infer<typeof resolvedLayoutSchema>;

export const sourceInfoSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  contentHeight: z.number().positive(),
});

export const bubbleSchema = z.object({
  corner: cornerSchema,
  sizePct: z.number().positive(),
});

export const endCardSchema = z.object({
  atMs: z.number().nonnegative(),
  durationMs: z.number().positive(),
  headline: z.string().optional(),
});

export const resolvedSelfShotSchema = z.object({
  slug: z.string(),
  mode: selfShotModeSchema,
  fps: z.number().positive(),
  res: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  /** Body length (ms) BEFORE the end card. */
  bodyMs: z.number().nonnegative(),
  /** Total length (ms) INCLUDING the end card. */
  durationMs: z.number().positive(),
  /** staticFile-relative media names (public dir = staged ingest dir). */
  cameraSrc: z.string().optional(),
  screenSrc: z.string().optional(),
  audioSrc: z.string().optional(),
  /** When true, the primary video plays muted (a separate audio track drives sound). */
  muteVideo: z.boolean().optional(),
  screenSource: sourceInfoSchema.optional(),
  captions: z.array(captionSchema),
  shots: z.array(shotSchema),
  overlays: z.array(resolvedOverlaySchema),
  layouts: z.array(resolvedLayoutSchema),
  bubble: bubbleSchema.optional(),
  endCard: endCardSchema.optional(),
  music: z.string().optional(),
  whoosh: z.string().optional(),
});
export type ResolvedSelfShotProps = z.infer<typeof resolvedSelfShotSchema>;

export type { CaptionToken, Shot };

export function parseResolvedSelfShot(raw: unknown): ResolvedSelfShotProps {
  return resolvedSelfShotSchema.parse(raw);
}
