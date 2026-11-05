/**
 * FileViewRpcHandlers — contained reads behind Ptah's read-only viewers.
 *
 * `file:viewContent` is the text preview. It refuses anything outside the
 * folders the user has open, anything that is not a regular file, anything
 * over {@link FILE_VIEW_MAX_BYTES}, and anything that is not decodable text.
 *
 * `file:viewBinary` is the display-panel image and PDF read. It uses the same
 * root policy with the PDF ceiling, then sniffs magic bytes. SVG is refused.
 * The extension and any caller MIME are ignored.
 *
 * Two rules govern what leaves this class:
 *
 *  1. **Every failure message is a fixed sentence.** No `error.message`, no
 *     `errno`, no realpath, no stderr. A caller that was refused a file must
 *     not learn from the refusal where a symlink resolved.
 *  2. **The handler never rejects to the transport.** Every outcome is a
 *     result object, because a rejection would surface in the renderer as an
 *     opaque RPC error with no reason to branch on.
 *
 * Logging follows the same rule: `logger.warn` receives the reason only —
 * never a path and never content.
 */

import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { inject, injectable } from 'tsyringe';
import {
  TOKENS,
  type Logger,
  type RpcHandler,
} from '@ptah-extension/vscode-core';
import {
  FILE_VIEW_MAX_BYTES,
  type FileViewBinaryFailureReason,
  type FileViewBinaryResult,
  type FileViewContentResult,
  type FileViewFailureReason,
  type RpcMethodName,
} from '@ptah-extension/shared';

import {
  BINARY_SNIFF_BYTES,
  binaryPayloadWithinCap,
  fileViewBinaryCap,
  sniffFileViewBinary,
} from './file-view-binary';
import { FileLinkRootPolicy } from './file-link-root-policy';
import {
  FileViewBinaryParamsSchema,
  FileViewContentParamsSchema,
} from './file-view-rpc.schema';

/** One fixed, sanitized sentence per reason. */
const FAILURE_MESSAGE: Record<FileViewFailureReason, string> = {
  'invalid-request': 'That file request was not valid.',
  'unsupported-path': 'That path form is not supported.',
  'no-base-root': 'This link needs an open workspace to resolve against.',
  'root-not-open': 'That workspace is not open in Ptah.',
  'outside-roots': 'This file is outside the workspaces open in Ptah.',
  'not-found': 'That file no longer exists.',
  'not-a-file': 'That path is not a file.',
  'too-large': 'This file is too large to preview.',
  binary: 'This file is binary and cannot be previewed.',
  'unsupported-encoding': 'This file is not valid UTF-8 text.',
  unreadable: 'That file could not be read.',
};

/** Bytes inspected for a NUL before declaring a text file binary. */
const TEXT_BINARY_SNIFF_BYTES = 8000;

const BINARY_FAILURE_MESSAGE: Record<FileViewBinaryFailureReason, string> = {
  ...FAILURE_MESSAGE,
  'unsupported-type': 'This file type cannot be previewed.',
};

@injectable()
export class FileViewRpcHandlers {
  static readonly METHODS = [
    'file:viewContent',
    'file:viewBinary',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(FileLinkRootPolicy)
    private readonly policy: FileLinkRootPolicy,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod('file:viewContent', (params) =>
      this.viewContent(params),
    );
    this.rpcHandler.registerMethod('file:viewBinary', (params) =>
      this.viewBinary(params),
    );
  }

  private async viewContent(raw: unknown): Promise<FileViewContentResult> {
    const parsed = FileViewContentParamsSchema.safeParse(raw);
    if (!parsed.success) return this.refuse('invalid-request');

    let resolution;
    try {
      resolution = await this.policy.resolveForView(parsed.data);
    } catch (error: unknown) {
      // The policy is not supposed to throw; if it does, the caller still gets
      // a reason rather than a transport rejection.
      this.logger.warn('[file:viewContent] policy failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
      return this.refuse('unreadable');
    }

    if (resolution.kind === 'rejected') {
      return this.refuse(
        resolution.reason,
        resolution.lexicalPath,
        resolution.sizeBytes,
      );
    }
    // `resolveForView` is called without `allowDirectory`, so a directory has
    // already become `not-a-file`. This is belt-and-braces for the type.
    if (resolution.kind === 'directory') return this.refuse('not-a-file');

    let bytes: Buffer;
    try {
      const handle = await fs.open(resolution.realPath, 'r');
      try {
        const verification = await verifyOpenedFile(handle, resolution.realPath, resolution.root);
        if (!verification.ok) {
          this.logger.warn('[file:viewContent] verification refused', { reason: verification.code });
          return this.refuse(verification.reason);
        }
        const stat = verification.stat;
        if (!stat.isFile()) return this.refuse('not-a-file');
        if (stat.size > FILE_VIEW_MAX_BYTES)
          return this.refuse('too-large', resolution.lexicalPath, stat.size);
        bytes = await readBounded(handle, FILE_VIEW_MAX_BYTES);
      } finally {
        await handle.close();
      }
    } catch (error: unknown) {
      this.logger.warn('[file:viewContent] read failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
      return this.refuse('unreadable');
    }

    // The file grew between `stat` and `open`.
    if (bytes.byteLength > FILE_VIEW_MAX_BYTES) {
      return this.refuse('too-large', resolution.lexicalPath, bytes.byteLength);
    }

    const decoded = decodeText(bytes);
    if (!decoded.ok) {
      return this.refuse(
        decoded.reason,
        resolution.lexicalPath,
        bytes.byteLength,
      );
    }

    return {
      success: true,
      absolutePath: resolution.lexicalPath,
      workspaceRoot: resolution.root,
      relativePath: path
        .relative(resolution.root, resolution.lexicalPath)
        .replace(/\\/g, '/'),
      content: decoded.content,
      sizeBytes: bytes.byteLength,
      encoding: decoded.encoding,
      // Hash the raw bytes, BOM included: the save path compares against the
      // bytes it finds on disk, not against the decoded text.
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bom: decoded.bom,
    };
  }

  private async viewBinary(raw: unknown): Promise<FileViewBinaryResult> {
    const parsed = FileViewBinaryParamsSchema.safeParse(raw);
    if (!parsed.success) return this.refuseBinary('invalid-request');

    let resolution;
    try {
      resolution = await this.policy.resolveForView(parsed.data, {
        maxBytes: fileViewBinaryCap('application/pdf'),
      });
    } catch (error: unknown) {
      this.logger.warn('[file:viewBinary] policy failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
      return this.refuseBinary('unreadable');
    }

    if (resolution.kind === 'rejected') {
      return this.refuseBinary(
        resolution.reason,
        resolution.lexicalPath,
        resolution.sizeBytes,
      );
    }
    if (resolution.kind === 'directory') return this.refuseBinary('not-a-file');

    let bytes: Buffer;
    let mime: ReturnType<typeof sniffFileViewBinary>;
    try {
      const handle = await fs.open(resolution.realPath, 'r');
      try {
        const verification = await verifyOpenedFile(handle, resolution.realPath, resolution.root);
        if (!verification.ok) {
          this.logger.warn('[file:viewBinary] verification refused', { reason: verification.code });
          return this.refuseBinary(verification.reason);
        }
        const stat = verification.stat;
        if (!stat.isFile()) return this.refuseBinary('not-a-file');
        // The larger of the checked size and the open handle's size: a file
        // that was over the cap when it was checked stays refused.
        const size = Math.max(stat.size, resolution.sizeBytes);
        if (size > fileViewBinaryCap('application/pdf'))
          return this.refuseBinary('too-large', resolution.lexicalPath, size);
        const header = await readPrefix(handle, BINARY_SNIFF_BYTES);
        mime = sniffFileViewBinary(header);
        if (mime === null)
          return this.refuseBinary('unsupported-type', resolution.lexicalPath, size);
        if (!binaryPayloadWithinCap(size, mime))
          return this.refuseBinary('too-large', resolution.lexicalPath, size);
        bytes = await readBounded(handle, fileViewBinaryCap(mime));
      } finally {
        await handle.close();
      }
    } catch (error: unknown) {
      this.logger.warn('[file:viewBinary] read failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
      return this.refuseBinary('unreadable');
    }

    if (!binaryPayloadWithinCap(bytes.byteLength, mime)) {
      return this.refuseBinary(
        'too-large',
        resolution.lexicalPath,
        bytes.byteLength,
      );
    }

    // The signature and payload came from the same verified handle.
    if (sniffFileViewBinary(bytes) !== mime) {
      return this.refuseBinary(
        'unsupported-type',
        resolution.lexicalPath,
        bytes.byteLength,
      );
    }

    return {
      success: true,
      absolutePath: resolution.lexicalPath,
      workspaceRoot: resolution.root,
      relativePath: path
        .relative(resolution.root, resolution.lexicalPath)
        .replace(/\\/g, '/'),
      mime,
      kind: mime === 'application/pdf' ? 'pdf' : 'image',
      sizeBytes: bytes.byteLength,
      dataBase64: bytes.toString('base64'),
    };
  }

  /**
   * Build a refusal, and decide whether the path may be offered to an external
   * editor instead.
   *
   * `externalOpenAllowed` is computed through the EXTERNAL-LINK policy, so it
   * carries the credential deny-list with it: a refusal for a path under
   * `~/.ssh` reports `false` and the UI offers no Open In affordance. It is
   * evaluated only when a lexical path survived the refusal — a symlink escape
   * deliberately omits one.
   */
  private async refuse(
    reason: FileViewFailureReason,
    lexicalPath?: string,
    sizeBytes?: number,
  ): Promise<FileViewContentResult> {
    this.logger.warn('[file:viewContent] rejected', { reason });
    return {
      success: false,
      reason,
      error: FAILURE_MESSAGE[reason],
      ...(lexicalPath !== undefined ? { absolutePath: lexicalPath } : {}),
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
      externalOpenAllowed: await this.externalOpenAllowedFor(lexicalPath),
    };
  }

  private async refuseBinary(
    reason: FileViewBinaryFailureReason,
    lexicalPath?: string,
    sizeBytes?: number,
  ): Promise<FileViewBinaryResult> {
    this.logger.warn('[file:viewBinary] rejected', { reason });
    return {
      success: false,
      reason,
      error: BINARY_FAILURE_MESSAGE[reason],
      ...(lexicalPath !== undefined ? { absolutePath: lexicalPath } : {}),
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
      externalOpenAllowed: await this.externalOpenAllowedFor(lexicalPath),
    };
  }

  private async externalOpenAllowedFor(
    lexicalPath: string | undefined,
  ): Promise<boolean> {
    if (lexicalPath === undefined) return false;
    try {
      const external = await this.policy.resolveForExternalOpen({
        path: lexicalPath,
      });
      return external.kind === 'file';
    } catch {
      // degradation-audit: optional-capability - offering an external open is
      // an affordance on top of an already-failed read; false hides the
      // button, which is the safe answer.
      return false;
    }
  }
}

/** Read at most `count` bytes from the start of `target`. */
async function readPrefix(handle: fs.FileHandle, count: number): Promise<Buffer> {
    const buffer = Buffer.alloc(count);
    const { bytesRead } = await handle.read(buffer, 0, count, 0);
    return buffer.subarray(0, bytesRead);
}

/**
 * Read at most `maxBytes + 1` bytes, closing the handle in `finally`.
 *
 * The extra byte is the point: it is how the caller can tell "exactly at the
 * cap" from "grew past the cap since `stat`" without reading the whole file.
 */
async function readBounded(handle: fs.FileHandle, maxBytes: number): Promise<Buffer> {
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes + 1, 0);
    return buffer.subarray(0, bytesRead);
}

type OpenedFileVerification =
  | { ok: true; stat: Stats }
  | { ok: false; reason: 'outside-roots' | 'unreadable'; code: string };

/** Bind the opened inode to a currently contained pathname before reading. */
async function verifyOpenedFile(
  handle: fs.FileHandle,
  target: string,
  root: string,
): Promise<OpenedFileVerification> {
  const opened = await handle.stat();
  const [realTarget, realRoot] = await Promise.all([fs.realpath(target), fs.realpath(root)]);
  const relative = path.relative(realRoot, realTarget);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    return { ok: false, reason: 'outside-roots', code: 'escaped-root' };
  const current = await fs.stat(realTarget);
  const hasIdentity = (stat: Stats): boolean =>
    Number.isSafeInteger(stat.dev) && stat.dev >= 0 &&
    Number.isSafeInteger(stat.ino) && stat.ino > 0;
  if (!hasIdentity(opened) || !hasIdentity(current))
    return { ok: false, reason: 'unreadable', code: 'identity-unavailable' };
  if (opened.dev !== current.dev || opened.ino !== current.ino)
    return { ok: false, reason: 'outside-roots', code: 'identity-mismatch' };
  return { ok: true, stat: opened };
}

type DecodeResult =
  | {
      ok: true;
      content: string;
      encoding: 'utf-8' | 'utf-16le' | 'utf-16be';
      bom: boolean;
    }
  | { ok: false; reason: 'binary' | 'unsupported-encoding' };

/**
 * Decode in a fixed order: BOM, then binary sniff, then strict UTF-8.
 *
 * The BOM check runs FIRST because UTF-16 text is full of NUL bytes — sniffing
 * before it would classify every UTF-16 document as binary.
 */
function decodeText(bytes: Buffer): DecodeResult {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return decodeWith(bytes.subarray(3), 'utf-8', true);
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return decodeWith(bytes.subarray(2), 'utf-16le', true);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeWith(bytes.subarray(2), 'utf-16be', true);
  }

  const sniffLength = Math.min(bytes.length, TEXT_BINARY_SNIFF_BYTES);
  for (let i = 0; i < sniffLength; i += 1) {
    if (bytes[i] === 0x00) return { ok: false, reason: 'binary' };
  }

  return decodeWith(bytes, 'utf-8', false);
}

function decodeWith(
  bytes: Buffer,
  encoding: 'utf-8' | 'utf-16le' | 'utf-16be',
  bom: boolean,
): DecodeResult {
  try {
    // `ignoreBOM: true` keeps the decoder from stripping a SECOND BOM: the
    // leading one has already been sliced off above, and anything left is
    // content the save path must round-trip byte-for-byte.
    const content = new TextDecoder(encoding, {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    return { ok: true, content, encoding, bom };
  } catch {
    // degradation-audit: optional-capability - previewing this file is the
    // optional outcome; a fatal decode failure becomes a typed reason so the
    // viewer can say "not valid text" instead of rendering mojibake.
    return { ok: false, reason: 'unsupported-encoding' };
  }
}
