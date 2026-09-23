/**
 * Path-data geometry for `vendor-brand-icons.mjs`: exact bounding boxes (the
 * A4 probe, the viewBox bleed rule and the clip test need them), rectangle
 * recognition for clip and mask definitions, and `<rect>` to path conversion.
 * Pure functions; no I/O.
 */

/** Decimal places kept in every emitted number (matches svgo's floatPrecision). */
export const FLOAT_PRECISION = 2;

export const numberOr = (value, fallback) =>
  Number.isFinite(parseFloat(value)) ? parseFloat(value) : fallback;

export function formatNumber(n) {
  const scale = 10 ** FLOAT_PRECISION;
  const rounded = Math.round(n * scale) / scale;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

export class Box {
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;

  add(x, y) {
    this.minX = Math.min(this.minX, x);
    this.minY = Math.min(this.minY, y);
    this.maxX = Math.max(this.maxX, x);
    this.maxY = Math.max(this.maxY, y);
  }

  merge(other) {
    if (other.minX === Infinity) return;
    this.add(other.minX, other.minY);
    this.add(other.maxX, other.maxY);
  }

  get empty() {
    return this.minX === Infinity;
  }
}

/** The box of a parsed `min-x min-y width height` viewBox. */
export function viewBoxBox([vx, vy, vw, vh]) {
  const box = new Box();
  box.add(vx, vy);
  box.add(vx + vw, vy + vh);
  return box;
}

/** True when `outer` contains `inner`, with `slack` user units of tolerance. */
export function boxContains(outer, inner, slack) {
  return (
    inner.minX >= outer.minX - slack &&
    inner.minY >= outer.minY - slack &&
    inner.maxX <= outer.maxX + slack &&
    inner.maxY <= outer.maxY + slack
  );
}

const PARAM_COUNT = {
  m: 2,
  l: 2,
  t: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  a: 7,
  z: 0,
};

/** Splits path data into commands; arc flags may be written without separators (`a1 1 0 01-1 1`). */
function tokenizePath(d) {
  const commands = [];
  const numberRe = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
  let i = 0;
  const skip = () => {
    while (i < d.length && /[\s,]/.test(d[i])) i++;
  };
  const readNumber = () => {
    skip();
    numberRe.lastIndex = i;
    const match = numberRe.exec(d);
    if (!match) throw new Error(`number expected at offset ${i}`);
    i = numberRe.lastIndex;
    return Number(match[0]);
  };
  const readFlag = () => {
    skip();
    const flag = d[i++];
    if (flag !== '0' && flag !== '1')
      throw new Error(`arc flag expected at offset ${i - 1}`);
    return Number(flag);
  };
  skip();
  while (i < d.length) {
    const cmd = d[i++];
    const lower = cmd.toLowerCase();
    if (!(lower in PARAM_COUNT))
      throw new Error(`command expected at offset ${i - 1}`);
    const count = PARAM_COUNT[lower];
    let repeat = cmd;
    do {
      const args = [];
      for (let k = 0; k < count; k++) {
        args.push(
          lower === 'a' && (k === 3 || k === 4) ? readFlag() : readNumber(),
        );
      }
      commands.push({ cmd: repeat, args });
      // Extra coordinate pairs after a moveto are implicit linetos.
      if (lower === 'm') repeat = cmd === 'm' ? 'l' : 'L';
      skip();
    } while (count > 0 && i < d.length && /[\d+\-.]/.test(d[i]));
    skip();
  }
  return commands;
}

/** Parameters in (0, 1) where a 1-D cubic Bézier has an extremum. */
function cubicExtrema(p0, p1, p2, p3) {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b];
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const root = Math.sqrt(disc);
  return [(-b + root) / (2 * a), (-b - root) / (2 * a)];
}

function addCubic(box, x0, y0, x1, y1, x2, y2, x3, y3) {
  box.add(x3, y3);
  const at = (t, p0, p1, p2, p3) =>
    (1 - t) ** 3 * p0 +
    3 * (1 - t) ** 2 * t * p1 +
    3 * (1 - t) * t * t * p2 +
    t ** 3 * p3;
  for (const t of [
    ...cubicExtrema(x0, x1, x2, x3),
    ...cubicExtrema(y0, y1, y2, y3),
  ]) {
    if (t > 0 && t < 1) box.add(at(t, x0, x1, x2, x3), at(t, y0, y1, y2, y3));
  }
}

function addQuad(box, x0, y0, x1, y1, x2, y2) {
  // A quadratic is the cubic with control points two thirds of the way to its control point.
  addCubic(
    box,
    x0,
    y0,
    x0 + (2 / 3) * (x1 - x0),
    y0 + (2 / 3) * (y1 - y0),
    x2 + (2 / 3) * (x1 - x2),
    y2 + (2 / 3) * (y1 - y2),
    x2,
    y2,
  );
}

/** SVG arc via the endpoint-to-centre conversion (SVG 1.1 F.6.5), sampled. */
function addArc(box, x1, y1, rxIn, ryIn, angle, largeArc, sweep, x2, y2) {
  box.add(x2, y2);
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if ((x1 === x2 && y1 === y2) || rx === 0 || ry === 0) return;
  const phi = (angle * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  const coef =
    (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * yp) / ry;
  const cyp = (-coef * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angleBetween = (ux, uy, vx, vy) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const start = angleBetween(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let delta = angleBetween(
    (xp - cxp) / rx,
    (yp - cyp) / ry,
    (-xp - cxp) / rx,
    (-yp - cyp) / ry,
  );
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  for (let k = 0; k <= 64; k++) {
    const t = start + (delta * k) / 64;
    const px = rx * Math.cos(t);
    const py = ry * Math.sin(t);
    box.add(cos * px - sin * py + cx, sin * px + cos * py + cy);
  }
}

/**
 * Exact bounding box of path data, plus the facts the rectangle test needs:
 * whether every segment is an axis-aligned line, the subpath count and the
 * visited vertices. Throws on malformed data.
 */
export function pathGeometry(d) {
  const box = new Box();
  const vertices = [];
  let straight = true;
  let subpaths = 0;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let lastCubic = null;
  let lastQuad = null;
  for (const { cmd, args } of tokenizePath(d)) {
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    const upper = cmd.toUpperCase();
    let nextCubic = null;
    let nextQuad = null;
    if (upper === 'M') {
      x = args[0] + ox;
      y = args[1] + oy;
      startX = x;
      startY = y;
      subpaths++;
      box.add(x, y);
      vertices.push([x, y]);
    } else if (
      upper === 'L' ||
      upper === 'H' ||
      upper === 'V' ||
      upper === 'Z'
    ) {
      const nx = upper === 'Z' ? startX : upper === 'V' ? x : args[0] + ox;
      const ny =
        upper === 'Z'
          ? startY
          : upper === 'H'
            ? y
            : upper === 'V'
              ? args[0] + oy
              : args[1] + oy;
      if (Math.abs(nx - x) > 1e-9 && Math.abs(ny - y) > 1e-9) straight = false;
      box.add(nx, ny);
      vertices.push([nx, ny]);
      x = nx;
      y = ny;
    } else if (upper === 'C' || upper === 'S') {
      straight = false;
      const [c1x, c1y] =
        upper === 'C'
          ? [args[0] + ox, args[1] + oy]
          : lastCubic
            ? [2 * x - lastCubic[0], 2 * y - lastCubic[1]]
            : [x, y];
      const rest = upper === 'C' ? args.slice(2) : args;
      const [c2x, c2y, ex, ey] = [
        rest[0] + ox,
        rest[1] + oy,
        rest[2] + ox,
        rest[3] + oy,
      ];
      addCubic(box, x, y, c1x, c1y, c2x, c2y, ex, ey);
      nextCubic = [c2x, c2y];
      x = ex;
      y = ey;
    } else if (upper === 'Q' || upper === 'T') {
      straight = false;
      const [cx, cy] =
        upper === 'Q'
          ? [args[0] + ox, args[1] + oy]
          : lastQuad
            ? [2 * x - lastQuad[0], 2 * y - lastQuad[1]]
            : [x, y];
      const [ex, ey] =
        upper === 'Q'
          ? [args[2] + ox, args[3] + oy]
          : [args[0] + ox, args[1] + oy];
      addQuad(box, x, y, cx, cy, ex, ey);
      nextQuad = [cx, cy];
      x = ex;
      y = ey;
    } else {
      straight = false;
      const [ex, ey] = [args[5] + ox, args[6] + oy];
      addArc(box, x, y, args[0], args[1], args[2], args[3], args[4], ex, ey);
      x = ex;
      y = ey;
    }
    lastCubic = nextCubic;
    lastQuad = nextQuad;
  }
  return { box, straight, subpaths, vertices };
}

/**
 * The box of path data that is exactly one axis-aligned rectangle, else
 * `null`. `eps` is the corner-matching tolerance in user units.
 */
export function rectangleBox(d, eps) {
  let geometry;
  try {
    geometry = pathGeometry(d);
  } catch {
    return null;
  }
  const { box, straight, subpaths, vertices } = geometry;
  if (!straight || subpaths !== 1 || box.empty) return null;
  const near = (a, b) => Math.abs(a - b) < eps;
  const onCorner = ([px, py]) =>
    (near(px, box.minX) || near(px, box.maxX)) &&
    (near(py, box.minY) || near(py, box.maxY));
  return vertices.every(onCorner) ? box : null;
}

/** A `<rect>` as path data, including rounded corners (svgo converts only square ones). */
export function rectToPath(attrs) {
  const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) =>
    numberOr(attrs[k], 0),
  );
  if (w <= 0 || h <= 0) return '';
  let rx = numberOr(attrs.rx, NaN);
  let ry = numberOr(attrs.ry, NaN);
  if (Number.isNaN(rx)) rx = Number.isNaN(ry) ? 0 : ry;
  if (Number.isNaN(ry)) ry = rx;
  rx = Math.min(rx, w / 2);
  ry = Math.min(ry, h / 2);
  const f = formatNumber;
  if (rx <= 0 || ry <= 0)
    return `M${f(x)} ${f(y)}H${f(x + w)}V${f(y + h)}H${f(x)}Z`;
  const arc = (ex, ey) => `A${f(rx)} ${f(ry)} 0 0 1 ${f(ex)} ${f(ey)}`;
  return [
    `M${f(x + rx)} ${f(y)}H${f(x + w - rx)}`,
    arc(x + w, y + ry),
    `V${f(y + h - ry)}`,
    arc(x + w - rx, y + h),
    `H${f(x + rx)}`,
    arc(x, y + h - ry),
    `V${f(y + ry)}`,
    arc(x + rx, y),
    'Z',
  ].join('');
}
