/**
 * Shot / camera model — the spatial layer that turns a flat screen recording
 * into motion graphics.
 *
 * A `Shot` targets a normalized region of the CONTENT (0..1 over the cropped
 * capture) at a wall-clock time. The composition runs a virtual camera that
 * eases from shot to shot (zoom + pan), optionally drawing a highlight ring on
 * a region and a floating callout, and can move the caption to the top so it
 * never covers a close-up.
 *
 * For designed scenes the Director will emit these from the bounding boxes of
 * the elements it already spotlights; for reverse-engineered clips they are
 * hand-authored per scene in shots.json.
 */
import { z } from 'zod';

export interface FocusRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL: FocusRect = { x: 0, y: 0, w: 1, h: 1 };

export interface Shot {
  fromMs: number;
  focus?: FocusRect;
  captionPos?: 'top' | 'bottom';
  ring?: FocusRect;
  callout?: { text: string; pos: 'tl' | 'tr' | 'bl' | 'br' };
}

const focusSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

export const shotSchema = z.object({
  fromMs: z.number().nonnegative(),
  focus: focusSchema.optional(),
  captionPos: z.enum(['top', 'bottom']).optional(),
  ring: focusSchema.optional(),
  callout: z
    .object({ text: z.string(), pos: z.enum(['tl', 'tr', 'bl', 'br']) })
    .optional(),
});

export const shotsFileSchema = z.object({
  scene: z.string(),
  shots: z.array(shotSchema),
});

export function parseShots(raw: unknown): Shot[] {
  return shotsFileSchema.parse(raw).shots as Shot[];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (k: number) =>
  k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;

/** The shot active at nowMs (last shot whose fromMs has passed), or null. */
export function activeShot(shots: Shot[], nowMs: number): Shot | null {
  if (!shots || shots.length === 0) return null;
  let idx = -1;
  for (let i = 0; i < shots.length; i++) {
    if (nowMs >= shots[i].fromMs) idx = i;
  }
  return idx >= 0 ? shots[idx] : null;
}

/** Eased camera focus at nowMs (transitions into each shot over transMs). */
export function focusAt(
  shots: Shot[],
  nowMs: number,
  transMs = 750,
): FocusRect {
  if (!shots || shots.length === 0) return FULL;
  let idx = 0;
  for (let i = 0; i < shots.length; i++) {
    if (nowMs >= shots[i].fromMs) idx = i;
  }
  const cur = shots[idx].focus ?? FULL;
  if (idx === 0) return cur;
  const prev = shots[idx - 1].focus ?? FULL;
  const k = Math.max(0, Math.min(1, (nowMs - shots[idx].fromMs) / transMs));
  const e = easeInOut(k);
  return {
    x: lerp(prev.x, cur.x, e),
    y: lerp(prev.y, cur.y, e),
    w: lerp(prev.w, cur.w, e),
    h: lerp(prev.h, cur.h, e),
  };
}

/** Map a focus rect to a CSS transform (scale + translate) over a card. */
export function focusToTransform(
  f: FocusRect,
  cardW: number,
  cardH: number,
  maxScale = 2.4,
): { scale: number; tx: number; ty: number } {
  let s = Math.min(1 / Math.max(f.w, 1e-3), 1 / Math.max(f.h, 1e-3));
  s = Math.max(1, Math.min(maxScale, s));
  const cx = (f.x + f.w / 2) * cardW;
  const cy = (f.y + f.h / 2) * cardH;
  return { scale: s, tx: cardW / 2 - s * cx, ty: cardH / 2 - s * cy };
}
