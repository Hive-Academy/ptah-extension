/**
 * `file:viewBinary` — bounded raster-image and PDF bytes for the display panel.
 *
 * Distinct from `file:viewContent`, which stays a text preview and still
 * refuses binary. The renderer does not choose the MIME type: the handler
 * sniffs magic bytes and returns one allowlisted type, or a fixed refusal.
 *
 * SVG is intentionally absent. It is XML and has no safe raster signature.
 *
 * Payload encoding is standard base64 (RFC 4648), with no `data:` prefix.
 * The shared RPC envelope is a JSON-safe object (VS Code `postMessage` and
 * the Electron IPC reply both carry `data` that way). A `Buffer` would not
 * survive the VS Code path. Batch 3 decodes `dataBase64` into a `Blob` and
 * a `blob:` URL: `<img>` for `kind: 'image'`, and for `kind: 'pdf'` Chromium's
 * built-in viewer first (D1) with a pdf.js fallback when CSP blocks it.
 */

import type { FileViewFailureReason } from './rpc-misc.types';

/**
 * Stat ceiling for `file:viewBinary` (25 MiB). Also the PDF body ceiling.
 *
 * Anything larger is refused before the body is read. Base64 expands by 4/3,
 * so a file at this cap is about 33 MiB on the wire.
 */
export const FILE_VIEW_BINARY_PDF_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Raster-image ceiling (15 MiB), applied after the magic-byte sniff.
 *
 * A file between this and {@link FILE_VIEW_BINARY_PDF_MAX_BYTES} is still
 * read only when the signature is `application/pdf`. An image in that range
 * is refused from the stat size without reading the body.
 */
export const FILE_VIEW_BINARY_IMAGE_MAX_BYTES = 15 * 1024 * 1024;

/** MIME types `file:viewBinary` will return. Extension and caller MIME are ignored. */
export type FileViewBinaryMime =
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/webp'
  | 'image/bmp'
  | 'application/pdf';

/** Why `file:viewBinary` refused. Text-only reasons stay in the map so a policy reason still has copy. */
export type FileViewBinaryFailureReason =
  | FileViewFailureReason
  | 'unsupported-type';

export interface FileViewBinaryParams {
  /** Decoded filesystem path: relative, POSIX absolute or drive absolute. Never a URL. */
  path: string;
  /** Originating session's workspace (tab partition root). Base-selection hint only. */
  workspaceRoot?: string;
  /** Absolute path of the document that contained the link. */
  documentPath?: string;
}

export type FileViewBinaryResult =
  | {
      success: true;
      /** Lexical path inside an authorized root. Never the realpath. */
      absolutePath: string;
      workspaceRoot: string;
      relativePath: string;
      mime: FileViewBinaryMime;
      /** `pdf` is the D1 branch (blob URL, then pdf.js). `image` is an `<img>`. */
      kind: 'image' | 'pdf';
      sizeBytes: number;
      /** Standard base64 of the raw file bytes. No data-URL prefix. */
      dataBase64: string;
    }
  | {
      success: false;
      reason: FileViewBinaryFailureReason;
      error: string;
      /**
       * Lexical path when disclosing it is safe (the same rule as
       * `file:viewContent`). A symlink escape omits it, so the real target
       * is never disclosed and never offered for external open.
       */
      absolutePath?: string;
      sizeBytes?: number;
      externalOpenAllowed: boolean;
    };
