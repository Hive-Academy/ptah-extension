import * as path from 'path';
import { stat } from 'fs/promises';
import type {
  GitFileStatus,
  GitRepoOperation,
  GitRepoOperationKind,
} from '@ptah-extension/shared';
import type { Logger } from '../../logging';
import type { ExecGitOptions } from '../../utils/exec-git';
import type { GitWriteRunner } from './git-write-lock';

export interface GitRepoOperationReaderDeps {
  /** The service's read runner. */
  readonly exec: GitWriteRunner;
  readonly logger: Logger;
}

/**
 * Marker files and directories git keeps while an operation is stopped, in
 * the order of {@link MarkerPaths}' fields.
 */
const MARKERS = [
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'rebase-merge',
  'rebase-apply',
] as const;

interface MarkerPaths {
  mergeHead: string;
  cherryPickHead: string;
  rebaseMerge: string;
  rebaseApply: string;
}

/** Present inside `rebase-apply` when `git am`, not a rebase, owns it. */
const AM_MARKER = 'applying';

/**
 * Which merge, rebase or cherry-pick is in progress in a working tree, and
 * which paths it left unmerged (TASK_2026_576 RC12).
 *
 * The marker locations come from `git rev-parse --git-path`, so they are the
 * working tree's own: a linked worktree's markers live in
 * `<common>/worktrees/<name>/`, not in the main checkout's `.git`. They never
 * change for a working tree, so they are resolved once per workspace (one
 * spawn) and every later status read only stats them — no spawn at all.
 */
export class GitRepoOperationReader {
  /** Resolved marker paths per workspace; bounded by the roots opened. */
  private readonly markerPaths = new Map<string, MarkerPaths>();

  constructor(private readonly deps: GitRepoOperationReaderDeps) {}

  /**
   * The operation in progress in `workspacePath`, with the `U` entries of
   * `files` as its conflicted paths. `undefined` when none is in progress or
   * when the markers could not be read — the status itself stays valid.
   * Unmerged entries with no marker (a conflicted `stash pop`) are not an
   * operation and give `undefined`.
   */
  async readRepoOperation(
    workspacePath: string,
    files: readonly GitFileStatus[],
    priority?: ExecGitOptions['priority'],
  ): Promise<GitRepoOperation | undefined> {
    try {
      const markers = await this.resolveMarkers(workspacePath, priority);
      if (!markers) return undefined;
      const kind = await detectKind(markers);
      if (!kind) return undefined;
      return {
        kind,
        conflictedPaths: files
          .filter((file) => file.status === 'U')
          .map((file) => file.path),
      };
    } catch (error: unknown) {
      // degradation-audit: optional-capability - the operation banner is
      // omitted; the status it decorates is still complete and correct.
      this.deps.logger.debug(
        `[GitRepoOperationReader] could not read the repository operation for ${workspacePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  private async resolveMarkers(
    workspacePath: string,
    priority: ExecGitOptions['priority'],
  ): Promise<MarkerPaths | null> {
    const cached = this.markerPaths.get(workspacePath);
    if (cached) return cached;

    const { stdout, exitCode } = await this.deps.exec(
      ['rev-parse', ...MARKERS.flatMap((marker) => ['--git-path', marker])],
      workspacePath,
      { priority },
    );
    if (exitCode !== 0) return null;
    // One line per `--git-path`, relative to the working directory or
    // absolute (a linked worktree). Paths are taken verbatim, never trimmed.
    const lines = stdout
      .split('\n')
      .slice(0, MARKERS.length)
      .map((line) => line.replace(/\r$/, ''));
    if (lines.length < MARKERS.length || lines.includes('')) return null;
    const [mergeHead, cherryPickHead, rebaseMerge, rebaseApply] = lines.map(
      (line) => path.resolve(workspacePath, line),
    );
    const resolved = { mergeHead, cherryPickHead, rebaseMerge, rebaseApply };
    this.markerPaths.set(workspacePath, resolved);
    return resolved;
  }
}

/**
 * A rebase wins over the others: an interactive rebase that stops on a
 * conflicted pick is still a rebase. `rebase-apply` with `applying` inside
 * belongs to `git am`, which is not one of the reported operations.
 */
async function detectKind(
  markers: MarkerPaths,
): Promise<GitRepoOperationKind | null> {
  const [mergeHead, cherryPickHead, rebaseMerge, rebaseApply] =
    await Promise.all([
      exists(markers.mergeHead),
      exists(markers.cherryPickHead),
      exists(markers.rebaseMerge),
      exists(markers.rebaseApply),
    ]);
  if (rebaseMerge) return 'rebase';
  if (
    rebaseApply &&
    !(await exists(path.join(markers.rebaseApply, AM_MARKER)))
  ) {
    return 'rebase';
  }
  if (mergeHead) return 'merge';
  if (cherryPickHead) return 'cherry-pick';
  return null;
}

/** True when `target` exists; a missing path is false, any other error throws. */
async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw error;
  }
}
