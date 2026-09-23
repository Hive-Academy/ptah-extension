/**
 * Colour parsing and WCAG contrast for `vendor-brand-icons.mjs`. Pure
 * functions; no I/O.
 */

/** svgo's convertColors turns other names into hex; these two survive as keywords. */
const NAMED_COLOURS = { black: '#000000', white: '#ffffff' };

/**
 * Classifies an SVG paint value: `none`, `current` (currentColor),
 * `paint-server` (a gradient or pattern reference), `rgb` with a lowercase
 * `#rrggbb` hex and an alpha, or `invalid`.
 */
export function parseColour(raw) {
  const value = raw.trim().toLowerCase();
  if (value === 'none' || value === 'transparent') return { kind: 'none' };
  if (value === 'currentcolor') return { kind: 'current' };
  if (value.startsWith('url(')) return { kind: 'paint-server' };
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value);
  if (hex) {
    const digits =
      hex[1].length <= 4 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    const alpha = digits.length === 8 ? parseInt(digits.slice(6), 16) / 255 : 1;
    return { kind: 'rgb', hex: `#${digits.slice(0, 6)}`, alpha };
  }
  const rgb =
    /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(
      value,
    );
  if (rgb) {
    const channel = (n) =>
      Math.max(0, Math.min(255, Math.round(Number(n))))
        .toString(16)
        .padStart(2, '0');
    const alpha =
      rgb[4] === undefined
        ? 1
        : rgb[4].endsWith('%')
          ? parseFloat(rgb[4]) / 100
          : Number(rgb[4]);
    return {
      kind: 'rgb',
      hex: `#${channel(rgb[1])}${channel(rgb[2])}${channel(rgb[3])}`,
      alpha,
    };
  }
  const fn =
    /^color\(\s*(srgb|display-p3)\s+([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+%?)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/.exec(
      value,
    );
  if (fn) {
    const unit = (s) => (s.endsWith('%') ? parseFloat(s) / 100 : Number(s));
    const channels = [fn[2], fn[3], fn[4]].map(unit);
    const srgb = fn[1] === 'display-p3' ? displayP3ToSrgb(channels) : channels;
    const hexDigits = srgb
      .map((c) =>
        Math.round(Math.max(0, Math.min(1, c)) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('');
    return {
      kind: 'rgb',
      hex: `#${hexDigits}`,
      alpha: fn[5] === undefined ? 1 : unit(fn[5]),
    };
  }
  if (NAMED_COLOURS[value])
    return { kind: 'rgb', hex: NAMED_COLOURS[value], alpha: 1 };
  return { kind: 'invalid' };
}

/** Display P3 → sRGB (both use the sRGB transfer curve; linear-light matrix from CSS Color 4). */
function displayP3ToSrgb(rgb) {
  const toLinear = (c) =>
    Math.abs(c) <= 0.04045
      ? c / 12.92
      : Math.sign(c) * ((Math.abs(c) + 0.055) / 1.055) ** 2.4;
  const toGamma = (c) =>
    Math.abs(c) <= 0.0031308
      ? 12.92 * c
      : Math.sign(c) * (1.055 * Math.abs(c) ** (1 / 2.4) - 0.055);
  const [r, g, b] = rgb.map(toLinear);
  return [
    1.2249401 * r - 0.2249404 * g,
    -0.0420569 * r + 1.0420571 * g,
    -0.0196376 * r - 0.0786361 * g + 1.0982735 * b,
  ].map(toGamma);
}

const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function luminance([r, g, b]) {
  const linear = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * True when at least one fill, composited at its opacity over the backdrop,
 * reaches `threshold`. A `currentColor` fill (`null`) follows the theme's text
 * colour and always passes.
 */
export function readableOn(artwork, backdropHex, threshold) {
  const backdrop = toRgb(backdropHex);
  return artwork.paths.some((path) => {
    if (path.fill === null) return true;
    const alpha = path.opacity ?? 1;
    const colour = toRgb(path.fill).map(
      (c, i) => alpha * c + (1 - alpha) * backdrop[i],
    );
    return contrastRatio(colour, backdrop) >= threshold;
  });
}
