/** All rectangles use stage-local CSS pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type StatusGroupKey = 'inProgress' | 'waiting' | 'finished' | 'other';

export interface SceneGeometry {
  stage: Rect;
  streamViewport: Rect;
  streamContent: Rect;
  rows: Readonly<Record<string, Rect>>;
  dial: Rect;
  rootButton: Rect;
  cards: Readonly<Record<StatusGroupKey, Rect>>;
}

export interface Point { x: number; y: number }
export interface ConnectorPath { d: string; start: Point; end: Point }
export interface RibbonPath extends ConnectorPath {
  key: StatusGroupKey;
  /** Segment corners, retained for deterministic collision checks. */
  points: readonly Point[];
}
export interface ConnectorPaths {
  wires: readonly ConnectorPath[];
  ribbons: readonly RibbonPath[];
}

const cardKeys: readonly StatusGroupKey[] = ['inProgress', 'waiting', 'finished', 'other'];
const center = (rect: Rect): Point => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
const fmt = (n: number): string => Number(n.toFixed(2)).toString();
const xy = (p: Point): string => `${fmt(p.x)} ${fmt(p.y)}`;
const inflated = (r: Rect, gap = 12): Rect => ({ x: r.x - gap, y: r.y - gap, width: r.width + 2 * gap, height: r.height + 2 * gap });

/** Strict interior intersection; touching an edge is permitted. */
export function segmentIntersectsRect(a: Point, b: Point, r: Rect): boolean {
  if (a.x === b.x) return a.x > r.x && a.x < r.x + r.width && Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.height;
  if (a.y === b.y) return a.y > r.y && a.y < r.y + r.height && Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.width;
  // General segments are used only by the visibility check for direct curves.
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    if (x > r.x && x < r.x + r.width && y > r.y && y < r.y + r.height) return true;
  }
  return false;
}

function clear(points: readonly Point[], obstacles: readonly Rect[]): boolean {
  return points.slice(1).every((point, i) => obstacles.every((r) => !segmentIntersectsRect(points[i], point, r)));
}

function route(start: Point, end: Point, obstacles: readonly Rect[], stage: Rect): Point[] {
  const direct: Point[] = [start, { x: start.x, y: end.y }, end];
  if (clear(direct, obstacles)) return direct;

  // A small rectilinear visibility grid gives every card an unobstructed lane.
  const xs = [...new Set([0, stage.width, start.x, end.x, ...obstacles.flatMap((r) => [r.x, r.x + r.width])])]
    .filter((x) => x >= 0 && x <= stage.width).sort((a, b) => a - b);
  const ys = [...new Set([0, stage.height, start.y, end.y, ...obstacles.flatMap((r) => [r.y, r.y + r.height])])]
    .filter((y) => y >= 0 && y <= stage.height).sort((a, b) => a - b);
  const nodes = xs.flatMap((x) => ys.map((y) => ({ x, y })));
  const index = (p: Point): number => nodes.findIndex((n) => n.x === p.x && n.y === p.y);
  const source = index(start), goal = index(end);
  const distance = nodes.map(() => Infinity), previous = nodes.map(() => -1), visited = new Set<number>();
  distance[source] = 0;
  while (visited.size < nodes.length) {
    let current = -1;
    for (let i = 0; i < nodes.length; i++) if (!visited.has(i) && (current < 0 || distance[i] < distance[current])) current = i;
    if (current < 0 || distance[current] === Infinity || current === goal) break;
    visited.add(current);
    for (let next = 0; next < nodes.length; next++) {
      const a = nodes[current], b = nodes[next];
      if (visited.has(next) || (a.x !== b.x && a.y !== b.y) || !clear([a, b], obstacles)) continue;
      const cost = distance[current] + Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (cost < distance[next]) { distance[next] = cost; previous[next] = current; }
    }
  }
  if (distance[goal] === Infinity) return [];
  const points: Point[] = [];
  for (let at = goal; at >= 0; at = previous[at]) points.unshift(nodes[at]);
  return points.filter((p, i) => i === 0 || i === points.length - 1 ||
    (points[i - 1].x !== points[i + 1].x && points[i - 1].y !== points[i + 1].y));
}

function roundedPath(points: readonly Point[]): string {
  let d = `M ${xy(points[0])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const before = points[i - 1], corner = points[i], after = points[i + 1];
    const lead = Math.min(6, Math.hypot(corner.x - before.x, corner.y - before.y) / 2);
    const tail = Math.min(6, Math.hypot(after.x - corner.x, after.y - corner.y) / 2);
    const incoming = { x: corner.x + Math.sign(before.x - corner.x) * lead, y: corner.y + Math.sign(before.y - corner.y) * lead };
    const outgoing = { x: corner.x + Math.sign(after.x - corner.x) * tail, y: corner.y + Math.sign(after.y - corner.y) * tail };
    d += ` L ${xy(incoming)} Q ${xy(corner)} ${xy(outgoing)}`;
  }
  return `${d} L ${xy(points[points.length - 1])}`;
}

export function getConnectorPaths(geometry: SceneGeometry | null): ConnectorPaths {
  if (!geometry || geometry.stage.width < 340 || geometry.stage.height <= 0 || geometry.dial.width <= 0) return { wires: [], ribbons: [] };
  const { stage, dial, streamViewport, rows, cards } = geometry;
  const stacked = stage.width < 960;
  const dialCenter = center(dial), radius = dial.width / 2;
  const visible = Object.entries(rows).filter(([, row]) => row.width > 0 && row.height > 0 &&
    row.y >= streamViewport.y && row.y + row.height <= streamViewport.y + streamViewport.height &&
    row.x >= geometry.streamContent.x && row.x + row.width <= geometry.streamContent.x + geometry.streamContent.width);
  const wires: ConnectorPath[] = visible.map(([, row], i) => {
    const start = { x: row.x + row.width + (stacked ? 3 : 0), y: row.y + row.height / 2 };
    const end = stacked
      ? { x: dialCenter.x + radius * 0.65 * (i - (visible.length - 1) / 2) / Math.max(1, visible.length - 1), y: dial.y + 5 }
      : { x: dial.x + 4, y: dialCenter.y + (i - (visible.length - 1) / 2) * 4 };
    const gutterX = Math.min(stage.width - 8, streamViewport.x + streamViewport.width + 16);
    const gutterY = streamViewport.y + streamViewport.height + 12 + i * 2;
    const d = stacked
      ? `M ${xy(start)} L ${fmt(gutterX)} ${fmt(start.y)} L ${fmt(gutterX)} ${fmt(gutterY)} C ${fmt(gutterX)} ${fmt(gutterY + 22)} ${fmt(end.x)} ${fmt(end.y - 28)} ${xy(end)}`
      : `M ${xy(start)} C ${fmt(start.x + 38)} ${fmt(start.y)} ${fmt(end.x - 36)} ${fmt(end.y)} ${xy(end)}`;
    return { d, start, end };
  });
  const ribbons: RibbonPath[] = cardKeys.flatMap((key, i) => {
    const card = cards[key];
    if (!card || card.width <= 0 || card.height <= 0) return [];
    const start = stacked
      ? { x: dialCenter.x + radius * [-0.65, 0.65, -0.35, 0.35][i], y: dial.y + dial.height - 6 }
      : { x: dial.x + dial.width - 5, y: dialCenter.y + radius * 0.27 * (i - 1.5) };
    const end = stacked ? { x: card.x + card.width / 2, y: card.y } : { x: card.x, y: card.y + card.height / 2 };
    const obstacles = cardKeys.filter((other) => other !== key).map((other) => inflated(cards[other]));
    const points = route(start, end, obstacles, stage);
    if (!points.length) return [];
    return [{ key, start, end, points, d: roundedPath(points) }];
  });
  return { wires, ribbons };
}
