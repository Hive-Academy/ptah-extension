/**
 * Session handoff writer (TASK_2026_597 N8, decision 13).
 *
 * Writes a handoff document to `~/.ptah/handoffs/<sessionId>.md` and keeps
 * only the newest {@link SESSION_HANDOFF_RETENTION} handoff files. Never
 * writes inside a workspace.
 *
 * - The session id must match `UUID_REGEX`, and the resolved path must stay
 *   directly under the handoffs directory (F12).
 * - The write is atomic: a uniquely named temp file in the same directory,
 *   then a rename over the target. A failed write never leaves a partial
 *   handoff behind.
 * - A failure never throws: the result carries `path: null` and a short
 *   `writeError`, and the caller keeps the content in memory. Each distinct
 *   failure is WARNed once.
 *
 * Constructed directly (not through DI) so a spec can point it at a temp home
 * directory; it needs only a logger.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { Logger } from '@ptah-extension/vscode-core';
import { UUID_REGEX } from '@ptah-extension/shared';

/** Handoff files kept after a write, newest by modification time. */
export const SESSION_HANDOFF_RETENTION = 50;

const HANDOFF_EXTENSION = '.md';

export interface SessionHandoffWriteResult {
  /** Absolute path of the written file; `null` when nothing was written. */
  readonly path: string | null;
  /** Short failure text, safe to show; present when `path` is `null`. */
  readonly writeError?: string;
}

export interface SessionHandoffWriterOptions {
  /** Home directory the `.ptah/handoffs` folder lives under. Defaults to `os.homedir()`. */
  readonly homeDir?: string;
}

/** `~/.ptah/handoffs` for the given home directory. */
export function sessionHandoffsDirectory(
  homeDir: string = os.homedir(),
): string {
  return path.resolve(homeDir, '.ptah', 'handoffs');
}

/**
 * The handoff file for `sessionId` inside `handoffsDir`, or `null` when the id
 * is not a UUID or the resolved path would leave the directory.
 */
export function resolveSessionHandoffPath(
  handoffsDir: string,
  sessionId: string,
): string | null {
  if (!UUID_REGEX.test(sessionId)) return null;
  const root = path.resolve(handoffsDir);
  const target = path.resolve(root, `${sessionId}${HANDOFF_EXTENSION}`);
  // Directly under the root: one path segment, no traversal, same volume.
  const relative = path.relative(root, target);
  if (
    relative.length === 0 ||
    path.isAbsolute(relative) ||
    relative.startsWith('..') ||
    relative !== path.basename(target)
  ) {
    return null;
  }
  return target;
}

function isHandoffFileName(name: string): boolean {
  return (
    name.endsWith(HANDOFF_EXTENSION) &&
    UUID_REGEX.test(name.slice(0, -HANDOFF_EXTENSION.length))
  );
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)) return code;
  }
  return 'UNKNOWN';
}

export class SessionHandoffWriter {
  private readonly handoffsDir: string;

  /** Last failure warned about, so a repeating failure warns once. */
  private lastWarned: string | null = null;

  constructor(
    private readonly logger: Logger,
    options?: SessionHandoffWriterOptions,
  ) {
    this.handoffsDir = sessionHandoffsDirectory(options?.homeDir);
  }

  /** The directory handoffs are written to. */
  get directory(): string {
    return this.handoffsDir;
  }

  async write(
    sessionId: string,
    content: string,
  ): Promise<SessionHandoffWriteResult> {
    const target = resolveSessionHandoffPath(this.handoffsDir, sessionId);
    if (target === null) {
      // The id is untrusted input: it is never echoed to the log.
      return this.failure('invalid-id', 'Invalid session id', {});
    }

    const temp = path.join(
      this.handoffsDir,
      `.${sessionId}.${randomUUID()}.tmp`,
    );
    try {
      await fs.mkdir(this.handoffsDir, { recursive: true });
      await fs.writeFile(temp, content, { encoding: 'utf8', flag: 'wx' });
      await fs.rename(temp, target);
    } catch (error: unknown) {
      await this.removeTemp(temp);
      const code = errorCode(error);
      return this.failure(
        `write:${code}`,
        `Could not write the handoff file (${code})`,
        { sessionId, code },
      );
    }

    await this.prune(target);
    return { path: target };
  }

  /**
   * Delete all but the newest {@link SESSION_HANDOFF_RETENTION} handoff files.
   * Only `<uuid>.md` files are considered; the file just written is always
   * kept. A prune failure is WARNed once and never fails the write.
   */
  private async prune(justWritten: string): Promise<void> {
    try {
      const names = (await fs.readdir(this.handoffsDir)).filter(
        isHandoffFileName,
      );
      if (names.length <= SESSION_HANDOFF_RETENTION) return;

      const files = await Promise.all(
        names.map(async (name) => {
          const filePath = path.join(this.handoffsDir, name);
          try {
            return { filePath, mtimeMs: (await fs.stat(filePath)).mtimeMs };
          } catch {
            // degradation-audit: optional-capability - a file removed between
            // readdir and stat no longer needs pruning.
            return null;
          }
        }),
      );
      const ordered = files
        .filter(
          (file): file is { filePath: string; mtimeMs: number } =>
            file !== null,
        )
        .sort(
          (a, b) =>
            Number(b.filePath === justWritten) -
              Number(a.filePath === justWritten) ||
            b.mtimeMs - a.mtimeMs ||
            a.filePath.localeCompare(b.filePath),
        );
      for (const file of ordered.slice(SESSION_HANDOFF_RETENTION)) {
        await fs.rm(file.filePath, { force: true });
      }
    } catch (error: unknown) {
      const code = errorCode(error);
      this.warnOnce(
        `prune:${code}`,
        '[SessionHandoffWriter] Could not prune old handoff files',
        { code },
      );
    }
  }

  /**
   * Remove a temp file left by a failed write. A failure here is logged and
   * does not replace the write failure the caller reports.
   */
  private async removeTemp(temp: string): Promise<void> {
    try {
      await fs.rm(temp, { force: true });
    } catch (error: unknown) {
      this.logger.warn('[SessionHandoffWriter] Could not remove a temp file', {
        code: errorCode(error),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private failure(
    signature: string,
    writeError: string,
    context: Record<string, unknown>,
  ): SessionHandoffWriteResult {
    this.warnOnce(
      signature,
      '[SessionHandoffWriter] Handoff not written; keeping it in memory',
      { ...context, writeError },
    );
    return { path: null, writeError };
  }

  private warnOnce(
    signature: string,
    message: string,
    context: Record<string, unknown>,
  ): void {
    if (this.lastWarned === signature) return;
    this.lastWarned = signature;
    this.logger.warn(message, context);
  }
}
