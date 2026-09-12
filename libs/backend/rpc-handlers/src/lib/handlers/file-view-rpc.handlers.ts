/**
 * FileViewRpcHandlers — `file:viewContent`, the contained read behind Ptah's
 * own read-only file viewer.
 *
 * This is the ONLY path by which agent-authored link bytes reach the renderer,
 * and it is deliberately narrow. It is not a general file reader: it refuses
 * anything outside the folders the user has open, anything that is not a
 * regular file, anything over {@link FILE_VIEW_MAX_BYTES}, and anything that
 * is not decodable text.
 *
 * Two rules govern what leaves this class:
 *
 *  1. **Every failure message is a fixed sentence from {@link FAILURE_MESSAGE}.**
 *     No `error.message`, no `errno`, no realpath, no stderr. A caller that was
 *     refused a file must not learn from the refusal whether it exists, where
 *     it resolved to, or why the filesystem said no.
 *  2. **The handler never rejects to the transport.** Every outcome is a
 *     `FileViewContentResult`, because a rejection would surface in the
 *     renderer as an opaque RPC error with no reason to branch on.
 *
 * Logging follows the same rule: `logger.warn` receives the reason only —
 * never a path and never content.
 */

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
  type FileViewContentResult,
  type FileViewFailureReason,
  type RpcMethodName,
} from '@ptah-extension/shared';

import { FileLinkRootPolicy } from './file-link-root-policy';
import { FileViewContentParamsSchema } from './file-view-rpc.schema';

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

/** Bytes inspected for a NUL before declaring a file binary. */
const BINARY_SNIFF_BYTES = 8000;

@injectable()
export class FileViewRpcHandlers {
  static readonly METHODS = [
    'file:viewContent',
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
      bytes = await readBounded(resolution.realPath, FILE_VIEW_MAX_BYTES);
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

    let externalOpenAllowed = false;
    if (lexicalPath !== undefined) {
      try {
        const external = await this.policy.resolveForExternalOpen({
          path: lexicalPath,
        });
        externalOpenAllowed = external.kind === 'file';
      } catch {
        // degradation-audit: optional-capability - offering an external open is
        // an affordance on top of an already-failed read; false hides the
        // button, which is the safe answer.
        externalOpenAllowed = false;
      }
    }

    return {
      success: false,
      reason,
      error: FAILURE_MESSAGE[reason],
      ...(lexicalPath !== undefined ? { absolutePath: lexicalPath } : {}),
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
      externalOpenAllowed,
    };
  }
}

/**
 * Read at most `maxBytes + 1` bytes, closing the handle in `finally`.
 *
 * The extra byte is the point: it is how the caller can tell "exactly at the
 * cap" from "grew past the cap since `stat`" without reading the whole file.
 */
async function readBounded(target: string, maxBytes: number): Promise<Buffer> {
  const handle = await fs.open(target, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes + 1, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

type DecodeResult =
  | {
      ok: true;
      content: string;
      encoding: 'utf-8' | 'utf-16le' | 'utf-16be';
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
    return decodeWith(bytes.subarray(3), 'utf-8');
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return decodeWith(bytes.subarray(2), 'utf-16le');
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeWith(bytes.subarray(2), 'utf-16be');
  }

  const sniffLength = Math.min(bytes.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < sniffLength; i += 1) {
    if (bytes[i] === 0x00) return { ok: false, reason: 'binary' };
  }

  return decodeWith(bytes, 'utf-8');
}

function decodeWith(
  bytes: Buffer,
  encoding: 'utf-8' | 'utf-16le' | 'utf-16be',
): DecodeResult {
  try {
    const content = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    return { ok: true, content, encoding };
  } catch {
    // degradation-audit: optional-capability - previewing this file is the
    // optional outcome; a fatal decode failure becomes a typed reason so the
    // viewer can say "not valid text" instead of rendering mojibake.
    return { ok: false, reason: 'unsupported-encoding' };
  }
}
