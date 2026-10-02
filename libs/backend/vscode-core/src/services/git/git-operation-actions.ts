import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  GIT_HOOK_TIMEOUT_MS,
  type GitConflictKind,
  type GitFileStatus,
  type GitOperationAbortResult,
  type GitOperationContinueResult,
  type GitOperationFailed,
  type GitRepoOperation,
  type GitRepoOperationKind,
} from '@ptah-extension/shared';
import type { Logger } from '../../logging';
import type { ExecGitBufferResult, ExecGitOptions } from '../../utils/exec-git';
import { GitCommitKillGuard } from './git-commit-runner';
import { thrownOutcome } from './git-mutation-outcome';
import type { GitRepoOperationReader } from './git-repo-operation.reader';
import { parseStatusV2Z } from './git-status-parser';
import type { GitRepoWriteLock, GitWriteRunner } from './git-write-lock';

/**
 * Where the conflict stages are written, under `rev-parse --git-path`: inside
 * the working tree's own git directory, so it is never a tracked or untracked
 * file and a linked worktree gets its own.
 */
const STAGE_DIR = 'ptah-merge';

/**
 * Nothing an abort or continue runs may open an editor or prompt: the commit
 * message (`GIT_EDITOR`), the rebase todo (`GIT_SEQUENCE_EDITOR`), the merge
 * message (`GIT_MERGE_AUTOEDIT`) and credentials all take their defaults.
 */
const NON_INTERACTIVE_ENV = {
  GIT_EDITOR: 'true',
  GIT_SEQUENCE_EDITOR: 'true',
  GIT_MERGE_AUTOEDIT: 'no',
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '',
};

/** Status without untracked files: only unmerged entries matter here. */
const STATUS_ARGS = ['status', '--porcelain=v2', '-z', '--untracked-files=no'];

/** Longest git error line handed back to the client. */
const MAX_ERROR_LINE = 300;

/** A full object id: SHA-1 (40) or SHA-256 (64) hex. */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** A file extension kept on the stage files so a merge tool highlights them. */
const SAFE_EXTENSION = /^\.[\w-]{1,16}$/;

/** Conflict kinds a three-way merge tool can open; the rest are not text merges. */
const MERGEABLE_KINDS: ReadonlySet<GitConflictKind> = new Set([
  'content',
  'add-add',
]);

type OperationAction = 'abort' | 'continue';

/**
 * Stage blobs of one conflicted path written to temp files for an external
 * merge tool, or why there are none. Backend-internal: the paths are absolute
 * and never go to the renderer.
 * - `ok` — `base` (stage 1, empty for an add/add conflict), `local` (stage 2,
 *   ours), `remote` (stage 3, theirs) and `result` (the working-tree file the
 *   tool writes).
 * - `invalid-path` — not a repository-relative path inside the working tree.
 * - `no-operation` — no merge, rebase or cherry-pick is in progress.
 * - `not-conflicted` — the path has no unmerged entry.
 * - `not-mergeable` — a delete/modify, symlink or submodule conflict.
 * - `failed` — git or the file system failed; `error` is sanitized.
 */
export type GitConflictStagesResult =
  | {
      status: 'ok';
      base: string;
      local: string;
      remote: string;
      result: string;
    }
  | { status: 'invalid-path' }
  | { status: 'no-operation' }
  | { status: 'not-conflicted' }
  | { status: 'not-mergeable'; conflictKind?: GitConflictKind }
  | { status: 'failed'; error: string };

export interface GitOperationActionsDeps {
  /** The service's cache-invalidating `execGit`. */
  readonly exec: GitWriteRunner;
  /** The service's `execGitBuffer`, for binary-safe blob reads. */
  readonly execBuffer: (
    args: string[],
    cwd: string,
    options?: ExecGitOptions,
  ) => Promise<ExecGitBufferResult>;
  /** The service's write lock; every action runs as one body inside it. */
  readonly writeLock: GitRepoWriteLock;
  /** Detects the operation from git's own marker files. */
  readonly operationReader: GitRepoOperationReader;
  readonly logger: Logger;
}

/** The working tree's status and the operation it is in, read inside the lock. */
interface RepoState {
  readonly files: GitFileStatus[];
  readonly operation: GitRepoOperation | undefined;
}

const READ_FAILED: GitOperationFailed = {
  status: 'failed',
  code: 'GIT_ERROR',
  error: 'Could not read the repository state.',
};

/**
 * Abort or continue the merge, rebase or cherry-pick in progress, and write a
 * conflicted path's stages for an external merge tool (TASK_2026_576
 * Requirement 11).
 *
 * - The operation is re-detected inside the write lock from git's marker
 *   files ({@link GitRepoOperationReader}); a caller never names it.
 * - Abort: `<kind> --abort`. Continue: merge → `commit --no-edit`, rebase and
 *   cherry-pick → `<kind> --continue`. Continue is refused, without running
 *   git, while any path is still unmerged.
 * - Both run with {@link GIT_HOOK_TIMEOUT_MS} and {@link NON_INTERACTIVE_ENV};
 *   a timed-out step is killed through {@link GitCommitKillGuard}, which
 *   recovers its own leftover `index.lock`.
 * - Stage files live in `<git-path ptah-merge>/<hash of path>/`. They are
 *   removed after an abort or continue git completed (or that stopped on a
 *   new step), and at the next status read that shows no operation
 *   ({@link releaseConflictStages}).
 */
export class GitOperationActions {
  /** Stage directory per workspace written in this process. */
  private readonly stageDirs = new Map<string, string>();

  constructor(private readonly deps: GitOperationActionsDeps) {}

  async abort(workspacePath: string): Promise<GitOperationAbortResult> {
    try {
      return await this.deps.writeLock.run(workspacePath, async () => {
        const state = await this.readState(workspacePath);
        if (!state) return READ_FAILED;
        if (!state.operation) return { status: 'no-operation' };
        const kind = state.operation.kind;
        const failure = await this.runStep(
          workspacePath,
          [kind, '--abort'],
          kind,
          'abort',
        );
        if (failure) return failure;
        await this.removeStageFiles(workspacePath);
        return { status: 'completed', kind };
      });
    } catch (error: unknown) {
      return this.threw(error, workspacePath, 'abort');
    }
  }

  async continue(workspacePath: string): Promise<GitOperationContinueResult> {
    try {
      return await this.deps.writeLock.run(workspacePath, async () => {
        const state = await this.readState(workspacePath);
        if (!state) return READ_FAILED;
        if (!state.operation) return { status: 'no-operation' };
        const { kind, conflictedPaths } = state.operation;
        if (conflictedPaths.length > 0) {
          return { status: 'conflicts-remain', kind, conflictedPaths };
        }
        const args =
          kind === 'merge' ? ['commit', '--no-edit'] : [kind, '--continue'];
        const failure = await this.runStep(
          workspacePath,
          args,
          kind,
          'continue',
        );
        const after = await this.readState(workspacePath);
        // A later step that conflicted makes git exit non-zero: that is the
        // operation moving on, not a failed continue.
        if (
          after?.operation &&
          (!failure || after.operation.conflictedPaths.length > 0)
        ) {
          await this.removeStageFiles(workspacePath);
          return {
            status: 'stopped',
            kind: after.operation.kind,
            conflictedPaths: after.operation.conflictedPaths,
          };
        }
        if (failure) return failure;
        await this.removeStageFiles(workspacePath);
        return { status: 'completed', kind };
      });
    } catch (error: unknown) {
      return this.threw(error, workspacePath, 'continue');
    }
  }

  /**
   * Write the base, local and remote stages of `relativePath` (a status path,
   * relative to the working-tree root) to temp files for a merge tool.
   */
  async materializeConflictStages(
    workspacePath: string,
    relativePath: string,
  ): Promise<GitConflictStagesResult> {
    if (!isInsideWorkTree(workspacePath, relativePath)) {
      return { status: 'invalid-path' };
    }
    try {
      return await this.deps.writeLock.run(workspacePath, () =>
        this.writeStages(workspacePath, relativePath),
      );
    } catch (error: unknown) {
      this.deps.logger.warn(
        `[GitOperationActions] could not write conflict stages in ${workspacePath}: ${errorText(error)}`,
      );
      return { status: 'failed', error: 'Could not prepare the merge files.' };
    }
  }

  /**
   * Remove the stage files this process wrote for `workspacePath`. Called
   * with each status read that shows no operation; does nothing (no spawn,
   * no file system call) when none were written.
   */
  async releaseConflictStages(workspacePath: string): Promise<void> {
    const dir = this.stageDirs.get(workspacePath);
    if (!dir) return;
    this.stageDirs.delete(workspacePath);
    await this.removeDir(dir);
  }

  private async writeStages(
    workspacePath: string,
    relativePath: string,
  ): Promise<GitConflictStagesResult> {
    const state = await this.readState(workspacePath);
    if (!state) return { status: 'failed', error: READ_FAILED.error };
    if (!state.operation) return { status: 'no-operation' };
    const entry = state.files.find(
      (file) => file.path === relativePath && file.status === 'U',
    );
    if (!entry) return { status: 'not-conflicted' };
    const conflictKind = entry.conflict?.kind;
    if (!conflictKind || !MERGEABLE_KINDS.has(conflictKind)) {
      return { status: 'not-mergeable', conflictKind };
    }
    const stages = await this.readStageIds(workspacePath, relativePath);
    if (!stages) return { status: 'failed', error: READ_FAILED.error };
    const local = stages.get(2);
    const remote = stages.get(3);
    if (!local || !remote) {
      return { status: 'not-mergeable', conflictKind };
    }
    const root = await this.gitPath(workspacePath, STAGE_DIR);
    if (!root) return { status: 'failed', error: READ_FAILED.error };

    const dir = path.join(
      root,
      createHash('sha256').update(relativePath).digest('hex').slice(0, 16),
    );
    await mkdir(dir, { recursive: true });
    this.stageDirs.set(workspacePath, root);
    const extension = path.extname(relativePath);
    const suffix = SAFE_EXTENSION.test(extension) ? extension : '';
    const files = {
      base: path.join(dir, `base${suffix}`),
      local: path.join(dir, `local${suffix}`),
      remote: path.join(dir, `remote${suffix}`),
    };
    const base = stages.get(1);
    await Promise.all([
      base
        ? this.writeBlob(workspacePath, base, files.base)
        : writeFile(files.base, ''),
      this.writeBlob(workspacePath, local, files.local),
      this.writeBlob(workspacePath, remote, files.remote),
    ]);
    return {
      status: 'ok',
      ...files,
      result: path.resolve(workspacePath, relativePath),
    };
  }

  /**
   * Object id per stage of `relativePath`'s unmerged entries
   * (`ls-files -u -z`); null when git failed or printed an id that is not one.
   */
  private async readStageIds(
    workspacePath: string,
    relativePath: string,
  ): Promise<Map<number, string> | null> {
    const run = await this.deps.exec(
      ['ls-files', '-u', '-z', '--', relativePath],
      workspacePath,
      // The path is a literal, never a pathspec pattern or magic.
      { env: { GIT_LITERAL_PATHSPECS: '1' } },
    );
    if (run.exitCode !== 0) return null;
    const stages = new Map<number, string>();
    // `<mode> SP <object> SP <stage> TAB <path> NUL`
    for (const record of run.stdout.split('\0')) {
      const tab = record.indexOf('\t');
      if (tab < 0 || record.slice(tab + 1) !== relativePath) continue;
      const [, objectId = '', stage] = record.slice(0, tab).split(' ');
      if (!OBJECT_ID.test(objectId)) return null;
      stages.set(Number(stage), objectId);
    }
    return stages;
  }

  private async writeBlob(
    workspacePath: string,
    objectId: string,
    target: string,
  ): Promise<void> {
    // `objectId` is validated hex: it can never be read as an option.
    const run = await this.deps.execBuffer(
      ['cat-file', 'blob', objectId],
      workspacePath,
    );
    if (run.exitCode !== 0) {
      throw new Error(`git cat-file exited with code ${run.exitCode}`);
    }
    await writeFile(target, run.stdout);
  }

  /**
   * Run one abort / continue step. `null` when git exited 0; otherwise the
   * failure, with git's own reason line sanitized.
   */
  private async runStep(
    workspacePath: string,
    args: string[],
    kind: GitRepoOperationKind,
    action: OperationAction,
  ): Promise<GitOperationFailed | null> {
    const guard = new GitCommitKillGuard(
      await this.gitPath(workspacePath, 'index.lock'),
      GIT_HOOK_TIMEOUT_MS,
    );
    try {
      const run = await this.deps.writeLock.execWrite(args, workspacePath, {
        timeoutMs: GIT_HOOK_TIMEOUT_MS,
        signal: guard.signal,
        onExit: guard.onExit,
        env: NON_INTERACTIVE_ENV,
      });
      if (run.code === 'LOCKED') {
        return { status: 'failed', kind, code: 'LOCKED', error: run.message };
      }
      if (run.exitCode === 0) return null;
      this.deps.logger.warn(
        `[GitOperationActions] ${kind} ${action} exited with code ${run.exitCode} in ${workspacePath}`,
      );
      const reason =
        gitReasonLine(run.stderr, workspacePath) ??
        gitReasonLine(run.stdout, workspacePath);
      return {
        status: 'failed',
        kind,
        code: 'GIT_ERROR',
        error: reason
          ? `Could not ${action} the ${kind}: ${reason}`
          : `Could not ${action} the ${kind}.`,
      };
    } catch (error: unknown) {
      if (!guard.reason) throw error;
      await guard.recoverIndexLock(this.deps.logger);
      return {
        status: 'failed',
        kind,
        code: guard.reason,
        error: `git did not finish the ${kind} ${action} within ${GIT_HOOK_TIMEOUT_MS / 60_000} minutes and was stopped.`,
      };
    } finally {
      guard.dispose();
    }
  }

  private async readState(workspacePath: string): Promise<RepoState | null> {
    const run = await this.deps.exec(STATUS_ARGS, workspacePath);
    if (run.exitCode !== 0) return null;
    const files = parseStatusV2Z(run.stdout).files;
    const operation = await this.deps.operationReader.readRepoOperation(
      workspacePath,
      files,
    );
    return { files, operation };
  }

  /** `rev-parse --git-path <name>`, absolute; null when git cannot say. */
  private async gitPath(
    workspacePath: string,
    name: string,
  ): Promise<string | null> {
    const run = await this.deps.exec(
      ['rev-parse', '--git-path', name],
      workspacePath,
    );
    if (run.exitCode !== 0) return null;
    // Taken verbatim minus the line ending, never trimmed.
    let line = run.stdout;
    if (line.endsWith('\n')) line = line.slice(0, -1);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    return line ? path.resolve(workspacePath, line) : null;
  }

  /** Remove every stage file of `workspacePath`, written by any process. */
  private async removeStageFiles(workspacePath: string): Promise<void> {
    const known = this.stageDirs.get(workspacePath);
    this.stageDirs.delete(workspacePath);
    const dir = known ?? (await this.gitPath(workspacePath, STAGE_DIR));
    if (dir) await this.removeDir(dir);
  }

  private async removeDir(dir: string): Promise<void> {
    try {
      await rm(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch (error: unknown) {
      // degradation-audit: optional-capability - leftover merge temp files in
      // the git directory are harmless; the next end of an operation retries.
      this.deps.logger.debug(
        `[GitOperationActions] could not remove ${dir}: ${errorText(error)}`,
      );
    }
  }

  private threw(
    error: unknown,
    workspacePath: string,
    action: OperationAction,
  ): GitOperationFailed {
    const outcome = thrownOutcome(error);
    this.deps.logger.error(
      `[GitOperationActions] ${action} failed in ${workspacePath}: ${outcome.error ?? ''}`,
      error instanceof Error ? error : undefined,
    );
    return {
      status: 'failed',
      code: outcome.code ?? 'GIT_ERROR',
      error: `Could not ${action} the operation.`,
    };
  }
}

/**
 * True when `relativePath` is a plain relative path that stays inside
 * `workspacePath`: not absolute, no NUL, no `..` segment.
 */
function isInsideWorkTree(
  workspacePath: string,
  relativePath: string,
): boolean {
  if (!relativePath || relativePath.includes('\0')) return false;
  if (path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
    return false;
  }
  const segments = relativePath.replaceAll('\\', '/').split('/');
  if (segments.includes('..')) return false;
  const inside = path.relative(
    workspacePath,
    path.resolve(workspacePath, relativePath),
  );
  return inside !== '' && !inside.startsWith('..') && !path.isAbsolute(inside);
}

/**
 * git's own reason from its output: the first `error:` / `fatal:` line, else
 * the first line that is not a hint. The workspace path is replaced by `.`
 * and the line is capped at {@link MAX_ERROR_LINE}.
 */
function gitReasonLine(output: string, workspacePath: string): string | null {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('hint:'));
  const tagged = lines.find(
    (line) => line.startsWith('error:') || line.startsWith('fatal:'),
  );
  const chosen = tagged
    ? tagged.slice(tagged.indexOf(':') + 1).trim()
    : lines[0];
  if (!chosen) return null;
  // git prints Windows paths with forward slashes.
  const text = chosen
    .replaceAll(workspacePath, '.')
    .replaceAll(workspacePath.replaceAll('\\', '/'), '.');
  return text.length > MAX_ERROR_LINE
    ? `${text.slice(0, MAX_ERROR_LINE)}…`
    : text;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
