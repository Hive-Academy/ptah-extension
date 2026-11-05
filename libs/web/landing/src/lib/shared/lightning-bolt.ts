/**
 * The hero's lightning, shared by every section below it: one jagged-bolt
 * generator and one three-layer amber stroke. Extracted unchanged from
 * sections/hero/hero-lightning.ts, which now delegates here.
 */
export interface BoltPoint {
  x: number;
  y: number;
}

// Normalized points let one flicker shape follow symbols as GSAP moves them.
export function generateBoltPath(
  start: BoltPoint,
  end: BoltPoint,
  random: () => number = Math.random,
): BoltPoint[] {
  let points = [start, end];
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const normal = length ? { x: -(end.y - start.y) / length, y: (end.x - start.x) / length } : { x: 0, y: 0 };
  for (let depth = 0; depth < 4; depth++) {
    const next: BoltPoint[] = [points[0]];
    for (let index = 0; index < points.length - 1; index++) {
      const left = points[index];
      const right = points[index + 1];
      const offset = (random() * 2 - 1) * length * 0.09 / (depth + 1);
      next.push({
        x: (left.x + right.x) / 2 + normal.x * offset,
        y: (left.y + right.y) / 2 + normal.y * offset,
      }, right);
    }
    points = next;
  }
  return points;
}

/**
 * Stroke layers of a canvas bolt (CSS px). Round 2 thinned them from
 * glow 8px/0.16/blur 20, body 2.8px/0.7/blur 9, core 1px/0.88/blur 2,
 * forks 1px/0.35/blur 7.
 */
export const BOLT_STROKES = {
  glow: { width: 4, alpha: 0.1, blur: 6 },
  body: { width: 1.6, alpha: 0.6, blur: 2 },
  core: { width: 0.9, alpha: 0.95, blur: 0 },
  fork: { width: 0.75, alpha: 0.3, blur: 2 },
} as const;

/**
 * Paints a normalized bolt `path` (x along, y across) from `from` to `to`:
 * amber glow, amber body, white-hot core and two short forks. `spread`
 * scales the sideways jag, so a long bolt fits a narrow gutter.
 */
export function paintBolt(
  context: CanvasRenderingContext2D,
  path: BoltPoint[],
  from: BoltPoint,
  to: BoltPoint,
  fade: number,
  spread = 1,
): void {
  const along = { x: to.x - from.x, y: to.y - from.y };
  const across = { x: -along.y * spread, y: along.x * spread };
  const map = (point: BoltPoint): BoltPoint => ({
    x: from.x + point.x * along.x + point.y * across.x,
    y: from.y + point.x * along.y + point.y * across.y,
  });
  const stroke = (points: BoltPoint[], width: number, color: string, alpha: number, blur: number): void => {
    context.beginPath();
    points.forEach((point, index) => {
      const mapped = map(point);
      if (index === 0) context.moveTo(mapped.x, mapped.y);
      else context.lineTo(mapped.x, mapped.y);
    });
    context.lineWidth = width;
    context.strokeStyle = color;
    context.globalAlpha = alpha * fade;
    context.shadowColor = color;
    context.shadowBlur = blur;
    context.stroke();
  };
  context.lineCap = 'round';
  context.lineJoin = 'round';
  // Thin and crisp: a narrow halo, a slim body and a hard white core.
  stroke(path, BOLT_STROKES.glow.width, '#f5a524', BOLT_STROKES.glow.alpha, BOLT_STROKES.glow.blur);
  stroke(path, BOLT_STROKES.body.width, '#ffbb4d', BOLT_STROKES.body.alpha, BOLT_STROKES.body.blur);
  stroke(path, BOLT_STROKES.core.width, '#fff9eb', BOLT_STROKES.core.alpha, BOLT_STROKES.core.blur);
  for (const index of [5, 11]) {
    const root = path[index];
    if (!root) continue;
    const tip = { x: root.x + 0.035, y: root.y + (index === 5 ? 0.055 : -0.05) };
    const { width, alpha, blur } = BOLT_STROKES.fork;
    stroke([root, { x: (root.x + tip.x) / 2, y: tip.y * 0.65 + root.y * 0.35 }, tip], width, '#ffbb4d', alpha, blur);
  }
  context.globalAlpha = 1;
  context.shadowBlur = 0;
}

/**
 * Deterministic random source (mulberry32) so a bolt drawn on the server and
 * on the client takes the same shape for the same seed.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
