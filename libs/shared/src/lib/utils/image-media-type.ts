/**
 * Image media type validation and normalization
 *
 * The Anthropic API accepts only four image media types for base64 image
 * content blocks: image/jpeg, image/png, image/gif, image/webp. Anything else
 * (svg, bmp, ico, jfif, empty strings, clipboard-mislabeled types) causes:
 *
 *   messages.N.content.M.image.source.base64.media_type:
 *     Input should be 'image/jpeg', 'image/png', 'image/gif' or 'image/webp'
 *
 * This module is shared between backend (Node) and frontend (browser). It must
 * therefore stay zero-dependency: no `Buffer`, no `fs`, no `path`. Base64
 * decoding uses a small inline decoder so the same code path works in both.
 */

export const ALLOWED_IMAGE_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

export type AllowedImageMediaType = (typeof ALLOWED_IMAGE_MEDIA_TYPES)[number];

/** Anthropic's per-image size limit (5 MB of decoded bytes). */
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

const ALLOWED_SET: ReadonlySet<string> = new Set(ALLOWED_IMAGE_MEDIA_TYPES);

/**
 * Normalize a media-type string: lowercase, trim, strip parameters after ';',
 * and collapse the common 'image/jpg' alias to 'image/jpeg'. Returns '' for
 * null/undefined/blank input.
 */
export function normalizeMediaType(input: string | null | undefined): string {
  if (input === null || input === undefined) {
    return '';
  }
  const raw = input.trim().toLowerCase();
  if (raw === '') {
    return '';
  }
  const semiIdx = raw.indexOf(';');
  const base = (semiIdx >= 0 ? raw.slice(0, semiIdx) : raw).trim();
  if (base === 'image/jpg') {
    return 'image/jpeg';
  }
  return base;
}

/**
 * Allowlist check. Returns the normalized value if it is one of the four
 * Anthropic-accepted image media types, otherwise null.
 */
export function toAllowedMediaType(
  input: string | null | undefined,
): AllowedImageMediaType | null {
  const normalized = normalizeMediaType(input);
  if (ALLOWED_SET.has(normalized)) {
    return normalized as AllowedImageMediaType;
  }
  return null;
}

/**
 * Decode the first `byteCount` bytes of a base64 string into a Uint8Array.
 *
 * Browser-safe: uses `atob` when available, and falls back to Node `Buffer`
 * only if `atob` is missing. Whitespace is stripped before decoding so that
 * wrapped/padded base64 still works. Returns an empty array when decoding
 * fails or the input is empty.
 */
function decodeBase64Prefix(base64: string, byteCount: number): Uint8Array {
  if (!base64 || byteCount <= 0) {
    return new Uint8Array(0);
  }

  // Strip whitespace and take enough characters to cover `byteCount` bytes.
  // 4 base64 chars encode 3 bytes, so we need ceil(byteCount / 3) * 4 chars.
  const cleaned = base64.replace(/\s+/g, '');
  if (cleaned === '') {
    return new Uint8Array(0);
  }
  const neededChars = Math.min(cleaned.length, Math.ceil(byteCount / 3) * 4);
  // Must align to a multiple of 4 for atob; pad with '=' if short.
  let slice = cleaned.slice(0, neededChars);
  const mod = slice.length % 4;
  if (mod !== 0) {
    slice = slice + '='.repeat(4 - mod);
  }

  try {
    const atobFn: ((input: string) => string) | undefined =
      typeof atob === 'function' ? atob : undefined;
    if (atobFn) {
      const binary = atobFn(slice);
      const len = Math.min(binary.length, byteCount);
      const out = new Uint8Array(len);
      for (let i = 0; i < len; i += 1) {
        out[i] = binary.charCodeAt(i) & 0xff;
      }
      return out;
    }
  } catch {
    return new Uint8Array(0);
  }

  // Node fallback — only reached if `atob` is unavailable. We deliberately
  // avoid importing `buffer` so bundlers don't pull it into browser builds;
  // the global `Buffer` is used when the runtime already exposes it.
  const globalBuffer:
    | { from(data: string, encoding: string): Uint8Array }
    | undefined = (
    globalThis as {
      Buffer?: { from(data: string, encoding: string): Uint8Array };
    }
  ).Buffer;
  if (globalBuffer) {
    try {
      const bytes = globalBuffer.from(slice, 'base64');
      return bytes.slice(0, byteCount);
    } catch {
      return new Uint8Array(0);
    }
  }

  return new Uint8Array(0);
}

/**
 * Inspect the magic bytes of base64 image data and return the detected media
 * type, or null if no known signature matches.
 *
 *   PNG   89 50 4E 47 0D 0A 1A 0A
 *   JPEG  FF D8 FF
 *   GIF   47 49 46 38 (GIF87a / GIF89a)
 *   WebP  RIFF....WEBP  (bytes 0..3 = 52 49 46 46, bytes 8..11 = 57 45 42 50)
 */
export function sniffMediaType(base64: string): AllowedImageMediaType | null {
  if (!base64) {
    return null;
  }

  const bytes = decodeBase64Prefix(base64, 16);
  if (bytes.length < 3) {
    return null;
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  // GIF: 47 49 46 38 (GIF87a / GIF89a — we only check the common 4-byte prefix)
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return 'image/gif';
  }

  // WebP: RIFF ???? WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

/**
 * Resolve the final media type for an image block.
 *
 * Precedence:
 *   1. Magic-byte sniff — if data decodes to a known signature, trust it.
 *      Clients routinely mislabel clipboard pastes and drag-drop payloads.
 *   2. Allowlist the claimed media type — used when data is absent or the
 *      sniff is inconclusive (unknown containers should not silently pass).
 *
 * Returns null if neither path yields a value in ALLOWED_IMAGE_MEDIA_TYPES.
 */
export function resolveImageMediaType(
  claimed: string | null | undefined,
  base64: string,
): AllowedImageMediaType | null {
  const sniffed = sniffMediaType(base64);
  if (sniffed !== null) {
    return sniffed;
  }
  return toAllowedMediaType(claimed);
}
