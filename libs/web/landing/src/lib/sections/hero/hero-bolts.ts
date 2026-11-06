import type { BoltPoint, LightningBolt } from '../../shared/lightning/lightning-renderer';
import type { StrikeLook } from '../../shared/lightning/strike-envelope';

/** Frame-loop storage: written in place every frame, never reallocated. */
export interface Point {
  x: number;
  y: number;
}
export type Bolt = { -readonly [K in keyof LightningBolt]: LightningBolt[K] };

export function emptyBolt(): Bolt {
  return { from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, intensity: 0, core: 0, glow: 0, seed: 0 };
}

/** Writes the centre of `symbol`, relative to `box`, into `out`. */
export function center(symbol: HTMLElement, box: DOMRect, out: Point): void {
  const rect = symbol.getBoundingClientRect();
  out.x = rect.left - box.left + rect.width / 2;
  out.y = rect.top - box.top + rect.height / 2;
}

/** Points `bolt` from `from` to `to` with this frame's look. */
export function setBolt(bolt: Bolt, from: BoltPoint, to: BoltPoint, look: StrikeLook, seed: number): void {
  bolt.from = from;
  bolt.to = to;
  bolt.intensity = look.intensity;
  bolt.core = look.core;
  bolt.glow = look.glow;
  bolt.seed = seed;
}

/** Index of the point nearest `target`. */
export function nearestIndex(points: readonly BoltPoint[], target: BoltPoint): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < points.length; ++i) {
    const distance = Math.hypot(points[i].x - target.x, points[i].y - target.y);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}
