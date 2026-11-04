/**
 * Magic-byte sniff for `file:viewBinary`.
 *
 * The extension and any caller-supplied MIME are ignored. SVG is not in the
 * allowlist: it has no raster signature, and a file that merely starts with
 * `<svg` stays `null`.
 */

import {
  FILE_VIEW_BINARY_IMAGE_MAX_BYTES,
  FILE_VIEW_BINARY_PDF_MAX_BYTES,
  type FileViewBinaryMime,
} from '@ptah-extension/shared';

/** Longest signature below is the 8-byte PNG header; 16 covers WebP's RIFF box. */
export const BINARY_SNIFF_BYTES = 16;

/** BITMAPFILEHEADER is 14 bytes. A bare `BM` prefix is not a BMP. */
const BMP_HEADER_BYTES = 14;

const PNG_SIGNATURE = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
const GIF87_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] as const;
const GIF89_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] as const;
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d] as const; // %PDF-

function startsWith(bytes: Buffer, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[i] !== signature[i]) return false;
  }
  return true;
}

function isWebp(bytes: Buffer): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

function isBmp(bytes: Buffer): boolean {
  return (
    bytes.length >= BMP_HEADER_BYTES && bytes[0] === 0x42 && bytes[1] === 0x4d
  );
}

/**
 * Allowlisted MIME for `bytes`, or `null` when the prefix matches nothing.
 *
 * Signatures are required at offset 0. A PDF whose header is not at the
 * start is refused: accepting a scan of the first kilobyte would also accept
 * a polyglot that hides `%PDF-` behind another payload.
 */
export function sniffFileViewBinary(bytes: Buffer): FileViewBinaryMime | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(bytes, JPEG_SIGNATURE)) return 'image/jpeg';
  if (startsWith(bytes, GIF87_SIGNATURE) || startsWith(bytes, GIF89_SIGNATURE)) {
    return 'image/gif';
  }
  if (startsWith(bytes, PDF_SIGNATURE)) return 'application/pdf';
  if (isWebp(bytes)) return 'image/webp';
  if (isBmp(bytes)) return 'image/bmp';
  return null;
}

/** Inclusive body ceiling for a sniffed type. */
export function fileViewBinaryCap(mime: FileViewBinaryMime): number {
  return mime === 'application/pdf'
    ? FILE_VIEW_BINARY_PDF_MAX_BYTES
    : FILE_VIEW_BINARY_IMAGE_MAX_BYTES;
}

export function binaryPayloadWithinCap(
  byteLength: number,
  mime: FileViewBinaryMime,
): boolean {
  return byteLength <= fileViewBinaryCap(mime);
}
