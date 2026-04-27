/**
 * Unit tests for image-media-type utilities.
 *
 * Covers:
 *   - normalizeMediaType: casing, parameters, jpg→jpeg alias, null/undefined.
 *   - toAllowedMediaType: happy paths + rejected values (svg, bmp, ico, jfif, '').
 *   - sniffMediaType: tiny magic-byte fixtures for PNG / JPEG / GIF / WebP.
 *   - resolveImageMediaType: sniff wins over claimed; allowlist fallback.
 */

import {
  ALLOWED_IMAGE_MEDIA_TYPES,
  normalizeMediaType,
  resolveImageMediaType,
  sniffMediaType,
  toAllowedMediaType,
} from './image-media-type';

/** Build a base64 string from the given byte array. */
function bytesToBase64(bytes: number[]): string {
  const arr = new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < arr.length; i += 1) {
    binary += String.fromCharCode(arr[i] as number);
  }
  // `btoa` exists in jsdom; fall back to Buffer when running under Node.
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  return Buffer.from(arr).toString('base64');
}

// 16-byte fixtures — only the signature bytes matter; the rest are padding.
const PNG_BYTES = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52,
];

const JPEG_BYTES = [
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x00, 0x00, 0x01,
];

const GIF_BYTES = [
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  0xff, 0xff, 0xff,
];

const WEBP_BYTES = [
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56,
  0x50, 0x38, 0x20,
];

const GARBAGE_BYTES = [
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
  0x0d, 0x0e, 0x0f,
];

describe('image-media-type', () => {
  describe('ALLOWED_IMAGE_MEDIA_TYPES', () => {
    it('matches the Anthropic allowlist exactly', () => {
      expect([...ALLOWED_IMAGE_MEDIA_TYPES].sort()).toEqual(
        ['image/gif', 'image/jpeg', 'image/png', 'image/webp'].sort(),
      );
    });
  });

  describe('normalizeMediaType', () => {
    it('lowercases', () => {
      expect(normalizeMediaType('IMAGE/PNG')).toBe('image/png');
    });

    it('strips parameters after semicolon', () => {
      expect(normalizeMediaType('image/jpeg; charset=binary')).toBe(
        'image/jpeg',
      );
      expect(normalizeMediaType('image/png;something=else')).toBe('image/png');
    });

    it('maps image/jpg to image/jpeg', () => {
      expect(normalizeMediaType('image/jpg')).toBe('image/jpeg');
      expect(normalizeMediaType('IMAGE/JPG')).toBe('image/jpeg');
      expect(normalizeMediaType(' image/jpg ; q=1 ')).toBe('image/jpeg');
    });

    it('returns empty string for blank/null/undefined', () => {
      expect(normalizeMediaType('')).toBe('');
      expect(normalizeMediaType('   ')).toBe('');
      expect(normalizeMediaType(null)).toBe('');
      expect(normalizeMediaType(undefined)).toBe('');
    });
  });

  describe('toAllowedMediaType', () => {
    it('accepts each allowlisted type', () => {
      for (const allowed of ALLOWED_IMAGE_MEDIA_TYPES) {
        expect(toAllowedMediaType(allowed)).toBe(allowed);
      }
    });

    it('accepts jpg alias as jpeg', () => {
      expect(toAllowedMediaType('image/jpg')).toBe('image/jpeg');
    });

    it('accepts types with parameters', () => {
      expect(toAllowedMediaType('image/png; charset=binary')).toBe('image/png');
    });

    it('rejects svg, bmp, ico, jfif, empty', () => {
      expect(toAllowedMediaType('image/svg+xml')).toBeNull();
      expect(toAllowedMediaType('image/bmp')).toBeNull();
      expect(toAllowedMediaType('image/x-icon')).toBeNull();
      expect(toAllowedMediaType('image/jfif')).toBeNull();
      expect(toAllowedMediaType('')).toBeNull();
      expect(toAllowedMediaType(null)).toBeNull();
      expect(toAllowedMediaType(undefined)).toBeNull();
    });

    it('rejects non-image types', () => {
      expect(toAllowedMediaType('text/plain')).toBeNull();
      expect(toAllowedMediaType('application/octet-stream')).toBeNull();
    });
  });

  describe('sniffMediaType', () => {
    it('detects PNG', () => {
      expect(sniffMediaType(bytesToBase64(PNG_BYTES))).toBe('image/png');
    });

    it('detects JPEG', () => {
      expect(sniffMediaType(bytesToBase64(JPEG_BYTES))).toBe('image/jpeg');
    });

    it('detects GIF', () => {
      expect(sniffMediaType(bytesToBase64(GIF_BYTES))).toBe('image/gif');
    });

    it('detects WebP', () => {
      expect(sniffMediaType(bytesToBase64(WEBP_BYTES))).toBe('image/webp');
    });

    it('returns null for random garbage', () => {
      expect(sniffMediaType(bytesToBase64(GARBAGE_BYTES))).toBeNull();
    });

    it('returns null for empty input', () => {
      expect(sniffMediaType('')).toBeNull();
    });

    it('returns null for very short input', () => {
      // Only two bytes — cannot match any 3+ byte signature.
      expect(sniffMediaType(bytesToBase64([0xff, 0xd8]))).toBeNull();
    });

    it('ignores whitespace in base64 input', () => {
      const clean = bytesToBase64(PNG_BYTES);
      const wrapped = clean.replace(/(.{4})/g, '$1\n');
      expect(sniffMediaType(wrapped)).toBe('image/png');
    });
  });

  describe('resolveImageMediaType', () => {
    it('returns sniffed type when claimed is also valid and matches', () => {
      expect(resolveImageMediaType('image/png', bytesToBase64(PNG_BYTES))).toBe(
        'image/png',
      );
    });

    it('lets sniff override a wrong but allowlisted claim', () => {
      // Claimed jpeg, actual bytes are PNG — trust the bytes.
      expect(
        resolveImageMediaType('image/jpeg', bytesToBase64(PNG_BYTES)),
      ).toBe('image/png');
    });

    it('lets sniff recover from an invalid claim', () => {
      expect(
        resolveImageMediaType('image/svg+xml', bytesToBase64(PNG_BYTES)),
      ).toBe('image/png');
      expect(resolveImageMediaType('', bytesToBase64(JPEG_BYTES))).toBe(
        'image/jpeg',
      );
    });

    it('falls back to allowlist when data is empty but claim is valid', () => {
      expect(resolveImageMediaType('image/webp', '')).toBe('image/webp');
      expect(resolveImageMediaType('image/jpg', '')).toBe('image/jpeg');
    });

    it('returns null when both claim and data are unusable', () => {
      expect(resolveImageMediaType('image/svg+xml', '')).toBeNull();
      expect(resolveImageMediaType(null, '')).toBeNull();
      expect(
        resolveImageMediaType('image/bmp', bytesToBase64(GARBAGE_BYTES)),
      ).toBeNull();
    });
  });
});
