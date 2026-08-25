import * as zlib from 'zlib';

/**
 * A dependency-free PNG reader, sufficient for Playwright screenshots.
 *
 * `TASK_2026_222` needs to answer "is this marker actually visible" from the
 * pixels a real Electron window painted, not from the CSS that was supposed to
 * paint them. `getComputedStyle` cannot answer it: it reports the declared
 * colour, which is exactly the thing under suspicion — a rule whose custom
 * property never resolves still computes to a perfectly plausible colour.
 *
 * Playwright hands screenshots back as a PNG `Buffer` and ships no decoder, and
 * the workspace has no direct image dependency (`sharp` is present only
 * transitively, through Remotion). A PNG is zlib-deflated filtered scanlines,
 * so decoding the one variant Chromium emits — 8-bit, non-interlaced, RGB or
 * RGBA — is a small, exact piece of code rather than a reason to add a package.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  /** Row-major RGBA, 4 bytes per pixel. */
  readonly data: Uint8Array;
}

/** One pixel as 8-bit RGBA. */
export type Rgba = readonly [number, number, number, number];

/**
 * Decode an 8-bit non-interlaced RGB/RGBA PNG.
 *
 * Throws — rather than guessing — on any other variant, so a future Chromium
 * that starts emitting 16-bit or palette screenshots produces a clear failure
 * instead of silently wrong colours.
 */
export function decodePng(buffer: Buffer): DecodedPng {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (buffer[i] !== PNG_SIGNATURE[i]) {
      throw new Error('[png-pixels] Not a PNG buffer.');
    }
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatParts: Buffer[] = [];

  let offset = PNG_SIGNATURE.length;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;

    if (type === 'IHDR') {
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      bitDepth = buffer[dataStart + 8];
      colorType = buffer[dataStart + 9];
      interlace = buffer[dataStart + 12];
    } else if (type === 'IDAT') {
      idatParts.push(buffer.subarray(dataStart, dataStart + length));
    } else if (type === 'IEND') {
      break;
    }

    // 4 length + 4 type + data + 4 CRC
    offset = dataStart + length + 4;
  }

  if (
    bitDepth !== 8 ||
    interlace !== 0 ||
    (colorType !== 2 && colorType !== 6)
  ) {
    throw new Error(
      `[png-pixels] Unsupported PNG: bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}. ` +
        'Only 8-bit non-interlaced RGB/RGBA is handled.',
    );
  }

  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idatParts));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const previous = new Uint8Array(stride);
  const current = new Uint8Array(stride);

  let readAt = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[readAt++];
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[readAt + x];
      const left = x >= channels ? current[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      current[x] = unfilterByte(filter, rawByte, left, up, upLeft);
    }
    readAt += stride;

    for (let x = 0; x < width; x++) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      out[to] = current[from];
      out[to + 1] = current[from + 1];
      out[to + 2] = current[from + 2];
      out[to + 3] = channels === 4 ? current[from + 3] : 255;
    }
    previous.set(current);
  }

  return { width, height, data: out };
}

function unfilterByte(
  filter: number,
  value: number,
  left: number,
  up: number,
  upLeft: number,
): number {
  switch (filter) {
    case 0:
      return value & 0xff;
    case 1:
      return (value + left) & 0xff;
    case 2:
      return (value + up) & 0xff;
    case 3:
      return (value + ((left + up) >> 1)) & 0xff;
    case 4:
      return (value + paeth(left, up, upLeft)) & 0xff;
    default:
      throw new Error(`[png-pixels] Unknown PNG filter type ${filter}.`);
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function pixelAt(png: DecodedPng, x: number, y: number): Rgba {
  const cx = Math.min(png.width - 1, Math.max(0, Math.round(x)));
  const cy = Math.min(png.height - 1, Math.max(0, Math.round(y)));
  const at = (cy * png.width + cx) * 4;
  return [
    png.data[at],
    png.data[at + 1],
    png.data[at + 2],
    png.data[at + 3],
  ] as const;
}

/** WCAG 2.x relative luminance of an opaque sRGB colour. */
export function relativeLuminance(rgba: Rgba): number {
  const channel = (raw: number): number => {
    const c = raw / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel(rgba[0]) +
    0.7152 * channel(rgba[1]) +
    0.0722 * channel(rgba[2])
  );
}

/**
 * WCAG 2.x contrast ratio, 1..21. Used against SC 1.4.11 (non-text contrast),
 * whose threshold for a graphical object carrying meaning is 3:1 — the marker
 * is a UI indicator, not text, so 4.5:1 would be the wrong bar.
 */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export function formatRgba(rgba: Rgba): string {
  return `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${rgba[3]})`;
}
