/**
 * SVG → `MarkArtwork` extraction for `vendor-brand-icons.mjs`.
 *
 * Each SVG is normalised with svgo (preset-default, shapes to paths, styles to
 * attributes, transforms applied, precision 2), then a second svgo pass runs
 * ONLY the custom `extractMarkArtwork` plugin over the normalised tree. The
 * plugin keeps painted paths with their inherited fill and records every
 * construct the binding-only renderer cannot draw faithfully as a problem;
 * any problem rejects the file.
 */

import { optimize } from 'svgo';
import { parseColour } from './colour.mjs';
import {
  Box,
  FLOAT_PRECISION,
  boxContains,
  compareStrings,
  formatNumber,
  numberOr,
  pathGeometry,
  rectToPath,
  rectangleBox,
  viewBoxBox,
} from './path-geometry.mjs';

/** Path data may bleed this fraction of the viewBox before it is rejected. */
const VIEWBOX_BLEED = 0.05;
/** A viewBox wider (or taller) than this is a wordmark: illegible in a square tile. */
const MAX_ASPECT = 3;

const NORMALIZE_CONFIG = {
  multipass: true,
  floatPrecision: FLOAT_PRECISION,
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          inlineStyles: { onlyMatchedOnce: false },
          convertColors: {
            currentColor: false,
            names2hex: true,
            rgb2hex: true,
            shorthex: false,
            shortname: false,
          },
          convertShapeToPath: { convertArcs: true },
          convertPathData: { applyTransforms: true },
        },
      },
    },
    'removeTitle',
    'convertStyleToAttrs',
  ],
};

/** Elements the extractor understands; clip and mask definitions are analysed, never painted. */
const SUPPORTED = new Set([
  'svg',
  'g',
  'a',
  'defs',
  'clipPath',
  'mask',
  'path',
  'rect',
]);
const IGNORED = new Set(['title', 'desc', 'metadata']);
const REJECTED_LABEL = {
  linearGradient: 'gradient',
  radialGradient: 'gradient',
  filter: 'filter',
  image: 'raster <image>',
  text: '<text>',
  pattern: 'pattern',
  use: '<use> reference',
  style: 'unresolved <style>',
};
/** Presentation properties read from a `style` attribute; layout-only properties are ignored. */
const STYLE_PROPS = new Set([
  'fill',
  'fill-opacity',
  'fill-rule',
  'opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'display',
  'visibility',
  'transform',
  'clip-path',
  'mask',
  'filter',
  'mix-blend-mode',
]);
/** SVG initial values: an unpainted-by-attribute path is filled black. */
const ROOT_STYLE = {
  fill: '#000000',
  fillRule: 'nonzero',
  fillOpacity: 1,
  opacity: 1,
  stroke: 'none',
  strokeWidth: 1,
  strokeOpacity: 1,
  visibility: 'visible',
  hidden: false,
  nonRendering: false,
  skip: false,
  clips: [],
};
// Whitespace only after a closing quote: no super-linear backtracking, same matches and captures.
const URL_REF_RE = /^url\(\s*['"]?#([^'")]+)(?:['"]\s*)?\)$/;

const inherit = (value, parent) =>
  value === undefined || value === 'inherit' ? parent : value;

function readAttributes(node) {
  const attrs = { ...node.attributes };
  for (const declaration of (node.attributes.style ?? '').split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const prop = declaration.slice(0, colon).trim().toLowerCase();
    if (STYLE_PROPS.has(prop)) {
      attrs[prop] = declaration
        .slice(colon + 1)
        .replace(/!important/i, '')
        .trim();
    }
  }
  return attrs;
}

function parseViewBox(attrs) {
  const parts = (attrs.viewBox ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    parts.length === 4 &&
    parts.every(Number.isFinite) &&
    parts[2] > 0 &&
    parts[3] > 0
  ) {
    return parts;
  }
  const w = numberOr(attrs.width, Number.NaN);
  const h = numberOr(attrs.height, Number.NaN);
  return w > 0 && h > 0 && !/%/.test(`${attrs.width}${attrs.height}`)
    ? [0, 0, w, h]
    : null;
}

/**
 * The region a `<clipPath>` or `<mask>` keeps, when it is exactly one
 * axis-aligned rectangle (for a mask: filled opaque white, so it passes
 * everything inside). `null` for any other shape — that clip or mask cannot be
 * expressed as plain path data.
 */
function rectangleOf(def, [, , vw, vh]) {
  const isMask = def.name === 'mask';
  const units = isMask
    ? def.attributes.maskContentUnits
    : def.attributes.clipPathUnits;
  if (units === 'objectBoundingBox' || def.attributes.transform) return null;
  const shapes = def.children.filter((child) => child.type === 'element');
  if (shapes.length !== 1 || shapes[0].attributes.transform) return null;
  const [shape] = shapes;
  const attrs = readAttributes(shape);
  if (isMask) {
    const fill = parseColour(attrs.fill ?? '#000000');
    const opaque =
      numberOr(attrs.opacity, 1) >= 1 &&
      numberOr(attrs['fill-opacity'], 1) >= 1;
    if (
      fill.kind !== 'rgb' ||
      fill.hex !== '#ffffff' ||
      fill.alpha < 1 ||
      !opaque
    )
      return null;
  }
  const size = (value, full) =>
    value === '100%' ? full : numberOr(value, Number.NaN);
  let d;
  if (shape.name === 'rect') {
    d = rectToPath({
      x: attrs.x,
      y: attrs.y,
      width: size(attrs.width, vw),
      height: size(attrs.height, vh),
    });
  } else if (shape.name === 'path') {
    d = attrs.d ?? '';
  } else {
    return null;
  }
  const box = rectangleBox(d, 1e-6 * Math.max(vw, vh));
  if (!box) return null;
  if (isMask && def.attributes.maskUnits === 'userSpaceOnUse') {
    const [mx, my, mw, mh] = ['x', 'y', 'width', 'height'].map((k) =>
      numberOr(def.attributes[k], Number.NaN),
    );
    if ([mx, my, mw, mh].every(Number.isFinite)) {
      box.minX = Math.max(box.minX, mx);
      box.minY = Math.max(box.minY, my);
      box.maxX = Math.min(box.maxX, mx + mw);
      box.maxY = Math.min(box.maxY, my + mh);
    }
  }
  return box;
}

/**
 * The custom svgo plugin (assumption A4: svgo 4 shape `{ name, fn: () => ({
 * element: { enter(node, parentNode) } }) }`) and the result it accumulates.
 */
function createExtractor() {
  const styles = new WeakMap();
  const problems = new Set();
  const defs = new Map();
  const collected = [];
  let viewBox = null;

  function enter(node, parentNode) {
    const parent =
      parentNode.type === 'root'
        ? ROOT_STYLE
        : (styles.get(parentNode) ?? ROOT_STYLE);
    // Children of a clip/mask definition or of a rejected element are judged
    // through their parent, never on their own.
    if (parent.skip) {
      styles.set(node, parent);
      return;
    }
    const attrs = readAttributes(node);
    if (IGNORED.has(node.name)) {
      styles.set(node, { ...parent, nonRendering: true, skip: true });
      return;
    }
    if (!SUPPORTED.has(node.name)) {
      problems.add(
        REJECTED_LABEL[node.name] ?? `unsupported element <${node.name}>`,
      );
      styles.set(node, { ...parent, nonRendering: true, skip: true });
      return;
    }
    if (node.name === 'svg') {
      if (parentNode.type !== 'root') problems.add('nested <svg>');
      else viewBox = parseViewBox(attrs);
    }
    if (attrs.transform)
      problems.add(`transform svgo could not apply (<${node.name}>)`);
    if (attrs.filter && attrs.filter !== 'none') problems.add('filter');
    if (attrs['mix-blend-mode'] && attrs['mix-blend-mode'] !== 'normal')
      problems.add('blend mode');
    const clips = [...parent.clips];
    for (const kind of ['clip-path', 'mask']) {
      if (node.name === 'mask' || !attrs[kind] || attrs[kind] === 'none')
        continue;
      const ref = URL_REF_RE.exec(attrs[kind]);
      if (ref) clips.push({ kind, id: ref[1] });
      else problems.add(`unresolvable ${kind}`);
    }
    const isDefinition = node.name === 'clipPath' || node.name === 'mask';
    const style = {
      fill: inherit(attrs.fill, parent.fill),
      fillRule: inherit(attrs['fill-rule'], parent.fillRule),
      fillOpacity:
        attrs['fill-opacity'] === undefined
          ? parent.fillOpacity
          : numberOr(attrs['fill-opacity'], 1),
      opacity: parent.opacity * numberOr(attrs.opacity, 1),
      stroke: inherit(attrs.stroke, parent.stroke),
      strokeWidth:
        attrs['stroke-width'] === undefined
          ? parent.strokeWidth
          : numberOr(attrs['stroke-width'], 1),
      strokeOpacity:
        attrs['stroke-opacity'] === undefined
          ? parent.strokeOpacity
          : numberOr(attrs['stroke-opacity'], 1),
      visibility: inherit(attrs.visibility, parent.visibility),
      hidden: parent.hidden || attrs.display === 'none',
      nonRendering: parent.nonRendering || node.name === 'defs' || isDefinition,
      skip: isDefinition,
      clips,
    };
    styles.set(node, style);
    if (isDefinition && attrs.id) defs.set(attrs.id, node);
    const painted = node.name === 'path' || node.name === 'rect';
    if (
      !painted ||
      style.nonRendering ||
      style.hidden ||
      style.visibility !== 'visible'
    )
      return;
    collectPath(
      node.name === 'rect' ? rectToPath(attrs) : (attrs.d ?? ''),
      style,
    );
  }

  function collectPath(d, style) {
    if (d.trim() === '') return;
    const stroke = parseColour(style.stroke);
    const fill = parseColour(style.fill);
    if (
      stroke.kind !== 'none' &&
      style.strokeWidth > 0 &&
      style.strokeOpacity > 0
    ) {
      problems.add(fill.kind === 'none' ? 'stroke-only path' : 'stroked path');
      return;
    }
    if (fill.kind === 'none') return;
    if (fill.kind === 'paint-server')
      return void problems.add('gradient or pattern fill');
    if (fill.kind === 'invalid')
      return void problems.add(`unsupported colour "${style.fill}"`);
    const opacity =
      Math.round(style.opacity * style.fillOpacity * (fill.alpha ?? 1) * 100) /
      100;
    if (opacity <= 0) return;
    const path = {
      d: d.trim(),
      fill: fill.kind === 'current' ? null : fill.hex,
      ...(style.fillRule === 'evenodd' ? { fillRule: 'evenodd' } : {}),
      ...(opacity < 1 ? { opacity } : {}),
    };
    collected.push({ path, clips: style.clips });
  }

  /** A clip or mask is accepted only when it cuts nothing: it covers the viewBox or the clipped path. */
  function clipProblem({ kind, id }, pathBox) {
    const def = defs.get(id);
    if (!def || def.name !== (kind === 'mask' ? 'mask' : 'clipPath'))
      return `dangling ${kind}`;
    const rect = rectangleOf(def, viewBox);
    if (!rect) {
      return kind === 'mask'
        ? 'mask other than one opaque white rectangle'
        : 'clip-path other than one rectangle';
    }
    const slack = 0.005 * Math.max(viewBox[2], viewBox[3]);
    if (boxContains(rect, viewBoxBox(viewBox), slack)) return null;
    if (pathBox && boxContains(rect, pathBox, slack)) return null;
    return `${kind} that cuts the artwork`;
  }

  function result() {
    if (!viewBox) problems.add('no usable viewBox');
    const aspect = viewBox
      ? Math.max(viewBox[2] / viewBox[3], viewBox[3] / viewBox[2])
      : 1;
    if (aspect > MAX_ASPECT) {
      problems.add(
        `wordmark-shaped (${formatNumber(aspect)}:1), illegible in a square tile`,
      );
    }
    const box = new Box();
    for (const { path, clips } of collected) {
      let pathBox = null;
      try {
        pathBox = pathGeometry(path.d).box;
        box.merge(pathBox);
      } catch (error) {
        problems.add(
          `unparseable path data (${error instanceof Error ? error.message : String(error)})`,
        );
      }
      for (const ref of viewBox ? clips : []) {
        const problem = clipProblem(ref, pathBox);
        if (problem) problems.add(problem);
      }
    }
    if (viewBox && !box.empty) {
      const [vx, vy, vw, vh] = viewBox;
      const bx = VIEWBOX_BLEED * vw;
      const by = VIEWBOX_BLEED * vh;
      if (
        box.minX < vx - bx ||
        box.minY < vy - by ||
        box.maxX > vx + vw + bx ||
        box.maxY > vy + vh + by
      ) {
        problems.add('path data extends far outside the viewBox');
      }
    }
    if (collected.length === 0 && problems.size === 0)
      problems.add('no painted paths');
    if (problems.size > 0)
      return {
        ok: false,
        reason: [...problems].sort(compareStrings).join('; '),
      };
    const paths = collected.map(({ path }) => path);
    const artwork = {
      kind: 'fill',
      paths,
      viewBox: viewBox.map(formatNumber).join(' '),
    };
    return { ok: true, box, artwork };
  }

  const plugin = {
    name: 'extractMarkArtwork',
    fn: () => ({ element: { enter } }),
  };
  return { plugin, result };
}

/**
 * Normalises one SVG document and extracts its artwork:
 * `{ ok: true, artwork, box }` or `{ ok: false, reason }`.
 */
export function extractArtwork(svgText) {
  if (!/<svg[\s>]/.test(svgText))
    return { ok: false, reason: 'not an SVG document' };
  if (/<!ENTITY/i.test(svgText))
    return { ok: false, reason: 'declares XML entities' };
  const extractor = createExtractor();
  try {
    const normalised = optimize(svgText, NORMALIZE_CONFIG).data;
    optimize(normalised, { plugins: [extractor.plugin] });
  } catch (error) {
    return {
      ok: false,
      reason: `unparseable SVG (${error instanceof Error ? error.message : String(error)})`,
    };
  }
  return extractor.result();
}

/** A mono variant must be one colour; it is then painted in `currentColor`. */
export function toMono(extraction) {
  if (!extraction.ok) return extraction;
  const colours = new Set(
    extraction.artwork.paths.map((p) => p.fill).filter((fill) => fill !== null),
  );
  if (colours.size > 1)
    return { ok: false, reason: `mono variant uses ${colours.size} colours` };
  const paths = extraction.artwork.paths.map((path) => ({
    ...path,
    fill: null,
  }));
  return { ...extraction, artwork: { ...extraction.artwork, paths } };
}
