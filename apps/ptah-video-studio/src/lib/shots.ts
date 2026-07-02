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
 * Motion profile: instead of a single fixed easeInOut over a constant duration,
 * each transition uses a *fast-attack, smooth-settle* ramp (a quintic ease-out
 * by default) so the camera snaps toward the target and then decelerates into
 * it — reads far more like real cinematography than a symmetric ease. Per-shot
 * overrides (`transMs`, `ease`) let an authored (or Director-emitted) shot pick
 * a longer/shorter move or a hard `cut` (instant hold-and-cut).
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

/**
 * Per-shot transition easing.
 *  - `ramp`   fast-attack / smooth-settle quintic ease-out (default; cinematic)
 *  - `smooth` symmetric easeInOut (the legacy profile — gentler, no snap)
 *  - `cut`    instant hold-and-cut (no interpolation; jumps at fromMs)
 */
export type ShotEase = 'ramp' | 'smooth' | 'cut';

export interface Shot {
  fromMs: number;
  focus?: FocusRect;
  captionPos?: 'top' | 'bottom';
  ring?: FocusRect;
  callout?: { text: string; pos: 'tl' | 'tr' | 'bl' | 'br' };
  /** Override the default transition duration for the move INTO this shot (ms). */
  transMs?: number;
  /** Override the easing profile for the move INTO this shot. */
  ease?: ShotEase;
}

const focusSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

// New fields are optional so existing shots.json files parse unchanged
// (backwards compatible — see hardening item in render-all.mjs).
export const shotSchema = z.object({
  fromMs: z.number().nonnegative(),
  focus: focusSchema.optional(),
  captionPos: z.enum(['top', 'bottom']).optional(),
  ring: focusSchema.optional(),
  callout: z
    .object({ text: z.string(), pos: z.enum(['tl', 'tr', 'bl', 'br']) })
    .optional(),
  transMs: z.number().positive().optional(),
  ease: z.enum(['ramp', 'smooth', 'cut']).optional(),
});

export const shotsFileSchema = z.object({
  scene: z.string(),
  shots: z.array(shotSchema),
});

export function parseShots(raw: unknown): Shot[] {
  return shotsFileSchema.parse(raw).shots as Shot[];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Symmetric ease-in-out (legacy `smooth` profile). */
const easeInOut = (k: number) =>
  k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;

/**
 * Quintic ease-out — the default `ramp` profile. Steep initial slope (fast
 * attack) then a long tail (smooth settle), which mimics a critically-damped
 * spring without the overshoot risk. `1 - (1-k)^5`.
 */
const easeOutQuint = (k: number) => 1 - Math.pow(1 - k, 5);

/** Default transition duration (ms) for the move into a shot. */
export const DEFAULT_TRANS_MS = 750;

/** Resolve a shot's easing curve function from its `ease` override. */
function easeFn(ease: ShotEase | undefined): (k: number) => number {
  switch (ease) {
    case 'smooth':
      return easeInOut;
    case 'cut':
      // Hold-and-cut: eased value is irrelevant (progress is forced to 1 in
      // focusAt), but returning a step keeps the fn total for any caller.
      return (k: number) => (k >= 1 ? 1 : 0);
    case 'ramp':
    default:
      return easeOutQuint;
  }
}

/** The shot active at nowMs (last shot whose fromMs has passed), or null. */
export function activeShot(shots: Shot[], nowMs: number): Shot | null {
  if (!shots || shots.length === 0) return null;
  let idx = -1;
  for (let i = 0; i < shots.length; i++) {
    if (nowMs >= shots[i].fromMs) idx = i;
  }
  return idx >= 0 ? shots[idx] : null;
}

/**
 * Eased camera focus at nowMs. Each shot transitions from the previous shot's
 * focus into its own over its `transMs` (default 750) using its `ease` profile
 * (default `ramp` = fast-attack / smooth-settle). A `cut` shot snaps instantly.
 *
 * `defaultTransMs` sets the fallback duration for shots without a `transMs`.
 */
export function focusAt(
  shots: Shot[],
  nowMs: number,
  defaultTransMs = DEFAULT_TRANS_MS,
): FocusRect {
  if (!shots || shots.length === 0) return FULL;
  let idx = 0;
  for (let i = 0; i < shots.length; i++) {
    if (nowMs >= shots[i].fromMs) idx = i;
  }
  const cur = shots[idx].focus ?? FULL;
  if (idx === 0) return cur;
  const prev = shots[idx - 1].focus ?? FULL;

  const shot = shots[idx];
  if (shot.ease === 'cut') return cur; // instant hold-and-cut

  const transMs = shot.transMs ?? defaultTransMs;
  const k = Math.max(0, Math.min(1, (nowMs - shot.fromMs) / transMs));
  const e = easeFn(shot.ease)(k);
  return {
    x: lerp(prev.x, cur.x, e),
    y: lerp(prev.y, cur.y, e),
    w: lerp(prev.w, cur.w, e),
    h: lerp(prev.h, cur.h, e),
  };
}

/**
 * Normalized camera velocity at nowMs — the rate of change of the focus rect,
 * in "focus units per second", mapped to 0..1 for driving motion blur. Sampled
 * as a finite difference of `focusAt` a frame apart. `cut` shots read as an
 * instantaneous spike on the cut frame and zero otherwise, which is fine — a
 * single-frame blur pop on a hard cut is imperceptible.
 *
 * @param dtMs  the sampling step (one frame; caller passes 1000/fps).
 */
export function cameraVelocity(
  shots: Shot[],
  nowMs: number,
  dtMs: number,
  defaultTransMs = DEFAULT_TRANS_MS,
): number {
  if (!shots || shots.length === 0 || dtMs <= 0) return 0;
  const a = focusAt(shots, Math.max(0, nowMs - dtMs), defaultTransMs);
  const b = focusAt(shots, nowMs, defaultTransMs);
  // Center + scale motion combined: pan (center delta) + zoom (size delta).
  const acx = a.x + a.w / 2;
  const acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2;
  const bcy = b.y + b.h / 2;
  const panDelta = Math.hypot(bcx - acx, bcy - acy);
  const zoomDelta = Math.abs(b.w - a.w) + Math.abs(b.h - a.h);
  const perSec = ((panDelta + zoomDelta) * 1000) / dtMs;
  // ~1.5 focus-units/sec is a very fast move; normalize to that ceiling.
  return Math.max(0, Math.min(1, perSec / 1.5));
}

/**
 * Map a focus rect to a CSS transform (scale + translate) over a card.
 *
 * `maxScale` caps how far the virtual camera can punch in. When capture res
 * exceeds output res (supersampling), the caller can raise this — the extra
 * source pixels stay crisp on the way in (see `dynamicMaxScale`).
 */
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

/**
 * Pick a sensible max punch-in scale for a given capture→output resolution
 * ratio. With supersampled footage (capture taller than output) the camera can
 * push past the nominal 2.4× and still resolve real pixels, so we allow up to
 * `ratio * 2.4`, hard-capped at ~3.2 to keep close-ups from feeling gimmicky.
 *
 * ratio === 1 (no supersampling) yields the original 2.4× exactly.
 */
export function dynamicMaxScale(
  captureHeight: number,
  outputHeight: number,
  base = 2.4,
  hardCap = 3.2,
): number {
  const ratio = outputHeight > 0 ? captureHeight / outputHeight : 1;
  const allowed = Math.max(1, ratio) * base;
  return Math.min(hardCap, Math.max(base, allowed));
}
