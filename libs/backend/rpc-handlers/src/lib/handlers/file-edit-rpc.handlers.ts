/**
 * FileEditRpcHandlers — `file:saveContent`, the contained write behind Ptah's
 * spot editor.
 *
 * This is the write twin of `FileViewRpcHandlers` and it resolves through the
 * SAME policy (`FileLinkRootPolicy.resolveForView`), so it can only ever reach
 * a file the viewer could have shown: inside an open workspace folder or one of
 * its worktrees, lexically AND after `realpath`, a regular file, under
 * {@link FILE_VIEW_MAX_BYTES}. It never creates a file — a missing target is
 * `not-found`.
 *
 * The write is guarded three ways:
 *
 *  1. **Optimistic concurrency.** Unless `overwrite`, the sha256 of the bytes
 *     currently on disk must equal `expectedSha256` (the hash `file:viewContent`
 *     returned when the edit began). A mismatch is `conflict` and nothing is
 *     written.
 *  2. **Encoding.** Only UTF-8 text is editable. A UTF-16 or binary target is
 *     refused, and a UTF-8 byte-order mark found on disk is re-added, so a
 *     save never silently changes a file's encoding. Line separators are
 *     written exactly as `content` carries them.
 *  3. **Atomicity.** The new bytes go to a temp file in the target's own
 *     directory, are flushed, and then renamed over the target. A failure at
 *     any step removes the temp file and leaves the original untouched — a
 *     failed save never truncates.
 *
 * The rename lands on the RESOLVED path, so a symlink that stays inside the
 * open roots keeps pointing at its target instead of being replaced by a
 * regular file.
 *
 * The same two rules as the read path govern what leaves this class: every
 * failure message is a fixed sentence from {@link FAILURE_MESSAGE} (no
 * `error.message`, `errno`, path or realpath), and the handler never rejects
 * to the transport. `logger.warn` receives the reason or the error's `name`
 * only — never a path and never content.
 */

import { createHash, randomBytes } from 'node:crypto';
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
  type FileSaveContentResult,
  type FileSaveFailureReason,
  type FileViewFailureReason,
  type RpcMethodName,
} from '@ptah-extension/shared';

import { FileLinkRootPolicy } from './file-link-root-policy';
import { FileSaveContentParamsSchema } from './file-edit-rpc.schema';

/** One fixed, sanitized sentence per reason. */
const FAILURE_MESSAGE: Record<FileSaveFailureReason, string> = {
  conflict: 'This file changed on disk since it was opened.',
  'outside-roots': 'This file is outside the workspaces open in Ptah.',
  'not-found': 'That file no longer exists.',
  'not-a-file': 'That path is not a file.',
  'too-large': 'This file is too large to edit.',
  'invalid-request': 'That save request was not valid.',
  unwritable: 'That file could not be saved.',
};

/**
 * How a read-path refusal from the shared policy is reported by a save.
 *
 * The save contract has fewer reasons than the read path: path-form problems
 * are the caller's request being wrong, a workspace that is not open is the
 * same answer as "outside the open roots", and anything that means "the
 * filesystem said no" is `unwritable`.
 */
const SAVE_REASON_FOR_VIEW_REFUSAL: Record<
  FileViewFailureReason,
  FileSaveFailureReason
> = {
  'invalid-request': 'invalid-request',
  'unsupported-path': 'invalid-request',
  'no-base-root': 'invalid-request',
  'root-not-open': 'outside-roots',
  'outside-roots': 'outside-roots',
  'not-found': 'not-found',
  'not-a-file': 'not-a-file',
  'too-large': 'too-large',
  binary: 'unwritable',
  'unsupported-encoding': 'unwritable',
  unreadable: 'unwritable',
};

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** Bytes inspected for a NUL before declaring a file binary (as the read path). */
const BINARY_SNIFF_BYTES = 8000;

@injectable()
export class FileEditRpcHandlers {
  static readonly METHODS = [
    'file:saveContent',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(FileLinkRootPolicy)
    private readonly policy: FileLinkRootPolicy,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod('file:saveContent', (params) =>
      this.saveContent(params),
    );
  }

  private async saveContent(raw: unknown): Promise<FileSaveContentResult> {
    const parsed = FileSaveContentParamsSchema.safeParse(raw);
    if (!parsed.success) return this.refuse('invalid-request');
    const request = parsed.data;

    // A UTF-16 code unit encodes to at least one UTF-8 byte, so this cheap
    // length test can only refuse content that is genuinely over the cap.
    if (request.content.length > FILE_VIEW_MAX_BYTES) {
      return this.refuse('too-large');
    }

    let resolution;
    try {
      resolution = await this.policy.resolveForView({
        path: request.path,
        ...(request.workspaceRoot !== undefined
          ? { workspaceRoot: request.workspaceRoot }
          : {}),
      });
    } catch (error: unknown) {
      // The policy is not supposed to throw; if it does, the caller still gets
      // a reason rather than a transport rejection.
      this.logger.warn('[file:saveContent] policy failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
      return this.refuse('unwritable');
    }

    if (resolution.kind === 'rejected') {
      return this.refuse(SAVE_REASON_FOR_VIEW_REFUSAL[resolution.reason]);
    }
    // `resolveForView` is called without `allowDirectory`, so a directory has
    // already become `not-a-file`. This is belt-and-braces for the type.
    if (resolution.kind === 'directory') return this.refuse('not-a-file');

    const target = resolution.realPath;

    let current: { bytes: Buffer; mode: number };
    try {
      current = await readCurrent(target, FILE_VIEW_MAX_BYTES);
    } catch (error: unknown) {
      this.logger.warn('[file:saveContent] read failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
      return this.refuse(isMissing(error) ? 'not-found' : 'unwritable');
    }

    // The file grew past the cap between the policy's `stat` and this read.
    if (current.bytes.byteLength > FILE_VIEW_MAX_BYTES) {
      return this.refuse('too-large');
    }

    // Conflict is checked before the encoding so that a file which changed
    // into something uneditable reports `conflict`: the editor's Reload then
    // shows the viewer's own explanation of what the file became.
    if (
      !request.overwrite &&
      sha256Hex(current.bytes) !== request.expectedSha256
    ) {
      return this.refuse('conflict');
    }

    const encoding = classifyEditable(current.bytes);
    if (!encoding.editable) return this.refuse('unwritable');

    const body = Buffer.from(request.content, 'utf8');
    const next = encoding.bom ? Buffer.concat([UTF8_BOM, body]) : body;
    if (next.byteLength > FILE_VIEW_MAX_BYTES) return this.refuse('too-large');

    try {
      // A read-only file is not made writable by replacing it: on POSIX a
      // rename only needs write access to the DIRECTORY, so the file's own
      // permission is checked explicitly.
      await fs.access(target, fs.constants.W_OK);
      await writeAtomically(target, next, current.mode);
    } catch (error: unknown) {
      this.logger.warn('[file:saveContent] write failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
      return this.refuse('unwritable');
    }

    return { success: true, sha256: sha256Hex(next) };
  }

  private refuse(reason: FileSaveFailureReason): FileSaveContentResult {
    this.logger.warn('[file:saveContent] rejected', { reason });
    return { success: false, reason, error: FAILURE_MESSAGE[reason] };
  }
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Read at most `maxBytes + 1` bytes and the permission bits, closing the
 * handle in `finally`. The extra byte tells "at the cap" from "grew past it".
 */
async function readCurrent(
  target: string,
  maxBytes: number,
): Promise<{ bytes: Buffer; mode: number }> {
  const handle = await fs.open(target, 'r');
  try {
    const stat = await handle.stat();
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes + 1, 0);
    return { bytes: buffer.subarray(0, bytesRead), mode: stat.mode & 0o777 };
  } finally {
    await handle.close();
  }
}

/**
 * Whether the bytes on disk are UTF-8 text the editor may replace, and whether
 * they carry a BOM to re-add. The order matches the read path: BOM first
 * (UTF-16 text is full of NULs), then the binary sniff, then strict UTF-8.
 */
function classifyEditable(
  bytes: Buffer,
): { editable: true; bom: boolean } | { editable: false } {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { editable: false };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { editable: false };
  }

  const bom = bytes.subarray(0, UTF8_BOM.length).equals(UTF8_BOM);
  const text = bom ? bytes.subarray(UTF8_BOM.length) : bytes;

  if (!bom) {
    const sniffLength = Math.min(text.length, BINARY_SNIFF_BYTES);
    for (let i = 0; i < sniffLength; i += 1) {
      if (text[i] === 0x00) return { editable: false };
    }
  }

  try {
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(text);
  } catch {
    // degradation-audit: optional-capability - editing is the optional
    // outcome; bytes that are not valid UTF-8 are refused as uneditable
    // rather than overwritten with a re-encoded guess.
    return { editable: false };
  }
  return { editable: true, bom };
}

/**
 * Write `bytes` to a fresh temp file beside `target`, flush it, then rename it
 * over `target`.
 *
 * The temp file is opened with `wx` (exclusive create), so a name that
 * already exists — including a planted symlink — fails instead of being
 * followed. Any failure removes the temp file and rethrows; the target is only
 * ever touched by the final rename.
 */
async function writeAtomically(
  target: string,
  bytes: Buffer,
  mode: number,
): Promise<void> {
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomBytes(6).toString('hex')}.ptah-save`,
  );

  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(temp, 'wx', mode);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temp, target);
  } catch (error: unknown) {
    await discardTemp(handle, temp);
    throw error;
  }
}

async function discardTemp(
  handle: fs.FileHandle | undefined,
  temp: string,
): Promise<void> {
  try {
    await handle?.close();
  } catch {
    // degradation-audit: optional-capability - cleanup after a failed save;
    // the original error is what the caller reports, and the unlink below
    // still runs.
  }
  try {
    await fs.rm(temp, { force: true });
  } catch {
    // degradation-audit: optional-capability - a stray temp file is the only
    // cost of failing here; the target itself was never touched.
  }
}
