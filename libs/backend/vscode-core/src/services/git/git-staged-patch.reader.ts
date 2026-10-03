import { GitCancelledError } from '../../utils/exec-git';
import type { Logger } from '../../logging';
import type { GitWriteRunner } from './git-write-lock';

/** The most staged-diff text handed to a reader such as the message generator. */
export const STAGED_PATCH_MAX_BYTES = 48 * 1024;

/** Last line of a patch cut at {@link STAGED_PATCH_MAX_BYTES}. */
export const STAGED_PATCH_TRUNCATED_NOTE = `[Staged diff truncated at ${STAGED_PATCH_MAX_BYTES / 1024} KiB; later changes are not shown.]\n`;

/**
 * `GitInfoService.readStagedPatch`'s answer.
 * - `patch` — the staged diff; when `truncated`, it stops at the last whole
 *   line within {@link STAGED_PATCH_MAX_BYTES} and ends with
 *   {@link STAGED_PATCH_TRUNCATED_NOTE}.
 * - `none` — nothing is staged.
 * - `failed` — git could not produce the diff (not a repository, git error).
 */
export type StagedPatchRead =
  | { readonly kind: 'patch'; readonly patch: string; readonly truncated: boolean }
  | { readonly kind: 'none' }
  | { readonly kind: 'failed' };

export interface GitStagedPatchReaderDeps {
  /** The service's read runner. */
  readonly exec: GitWriteRunner;
  readonly logger: Logger;
  /** The `git diff` flags the service's patch reads use. */
  readonly diffFlags: readonly string[];
}

/**
 * `git diff --cached` for one repository, bounded (TASK_2026_576 Component
 * 30). git is stopped as soon as the cap is passed, so a huge staged change
 * costs at most the cap plus one pipe chunk — never the whole diff.
 */
export class GitStagedPatchReader {
  constructor(private readonly deps: GitStagedPatchReaderDeps) {}

  async read(workspacePath: string): Promise<StagedPatchRead> {
    const { exec, logger, diffFlags } = this.deps;
    const stop = new AbortController();
    const kept: Buffer[] = [];
    let keptBytes = 0;
    let truncated = false;
    const onOutput = (stream: 'stdout' | 'stderr', chunk: string): void => {
      if (stream !== 'stdout' || truncated) return;
      const data = Buffer.from(chunk, 'utf8');
      kept.push(data);
      keptBytes += data.length;
      if (keptBytes > STAGED_PATCH_MAX_BYTES) {
        truncated = true;
        stop.abort();
      }
    };

    try {
      const { stdout, stderr, exitCode } = await exec(
        ['diff', '--cached', ...diffFlags],
        workspacePath,
        { signal: stop.signal, onOutput },
      );
      if (exitCode !== 0) {
        logger.warn('[GitStagedPatchReader] git diff --cached failed', {
          workspacePath,
          exitCode,
          stderr: stderr.trim(),
        });
        return { kind: 'failed' };
      }
      // A completed run's own stdout is authoritative (an observer that
      // missed nothing would match it anyway).
      if (stdout.length === 0) return { kind: 'none' };
      if (Buffer.byteLength(stdout, 'utf8') <= STAGED_PATCH_MAX_BYTES) {
        return { kind: 'patch', patch: stdout, truncated: false };
      }
      return this.truncatedPatch(Buffer.from(stdout, 'utf8'));
    } catch (error: unknown) {
      if (truncated && error instanceof GitCancelledError) {
        return this.truncatedPatch(Buffer.concat(kept));
      }
      logger.warn('[GitStagedPatchReader] git diff --cached failed', {
        workspacePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return { kind: 'failed' };
    }
  }

  /** The first whole lines within the cap, then the truncation note. */
  private truncatedPatch(data: Buffer): StagedPatchRead {
    const window = data.subarray(0, STAGED_PATCH_MAX_BYTES);
    const lastNewline = window.lastIndexOf(0x0a);
    const body = lastNewline >= 0 ? window.subarray(0, lastNewline + 1) : window;
    return {
      kind: 'patch',
      patch: body.toString('utf8') + STAGED_PATCH_TRUNCATED_NOTE,
      truncated: true,
    };
  }
}
