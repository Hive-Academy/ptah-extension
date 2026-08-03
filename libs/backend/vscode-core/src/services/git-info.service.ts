/**
 * Git Info Service
 *
 * Encapsulates all git CLI interactions for the Electron main process.
 * Uses cross-spawn for Windows compatibility. Zero new dependencies.
 */

import * as path from 'path';
import { createHash } from 'crypto';
import type { Logger } from '../logging';
import {
  execGit,
  execGitBuffer,
  WORKTREE_GIT_TIMEOUT_MS,
  type ExecGitOptions,
  type ExecGitResult,
  type ExecGitBufferResult,
} from '../utils/exec-git';
import {
  parseWorktreeList,
  type GitBranchInfo,
  type GitFileStatus,
  type GitInfoResult,
  type GitWorktreeInfo,
  type GitStageResult,
  type GitUnstageResult,
  type GitDiscardResult,
  type GitCommitResult,
  type GitShowFileResult,
  type GitPushResult,
  type BranchRef,
  type GitBranchesResult,
  type GitCheckoutResult,
  type StashEntry,
  type GitStashListResult,
  type TagRef,
  type GitTagsResult,
  type RemoteInfo,
  type GitRemotesResult,
  type GitLastCommitResult,
  type GitBlobRead,
  type GitReadErrorCode,
  type GitDiffComparison,
  type GitDiffFileResult,
  type DiffSideRef,
} from '@ptah-extension/shared';

/**
 * git's own binary heuristic: a NUL byte anywhere in the first 8000 bytes.
 */
const BINARY_SNIFF_BYTES = 8000;

/**
 * The slice of `IFileSystemProvider` the worktree side of a diff needs.
 *
 * Declared structurally rather than importing the port so this service keeps
 * its narrow surface — hosts pass their registered
 * `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` straight through.
 */
export interface WorktreeFileReader {
  readFileBytes(filePath: string): Promise<Uint8Array>;
  exists(filePath: string): Promise<boolean>;
}

/** Request shape for {@link GitInfoService.diffFile}. */
export interface DiffFileRequest {
  /** Workspace-relative path, modified side. */
  path: string;
  comparison: GitDiffComparison;
  /** Pre-rename source path for staged renames; falls back to `path`. */
  originalPath?: string;
}

export class GitInfoService {
  constructor(private readonly logger: Logger) {}

  async getGitInfo(workspacePath: string): Promise<GitInfoResult> {
    const isRepo = await this.isGitRepo(workspacePath);
    if (!isRepo) {
      return {
        isGitRepo: false,
        branch: { branch: '', upstream: null, ahead: 0, behind: 0 },
        files: [],
      };
    }

    try {
      const { stdout, exitCode } = await this.execGit(
        ['status', '--porcelain=v2', '--branch'],
        workspacePath,
      );

      if (exitCode !== 0) {
        this.logger.warn('[GitInfoService] git status exited with code', {
          exitCode,
          workspacePath,
        } as unknown as Error);
        return {
          isGitRepo: true,
          branch: { branch: '', upstream: null, ahead: 0, behind: 0 },
          files: [],
        };
      }

      const branch = this.parseBranchInfo(stdout);
      const files = this.parseFileStatus(stdout);

      return { isGitRepo: true, branch, files };
    } catch (error) {
      this.logger.error('[GitInfoService] getGitInfo failed', {
        workspacePath,
        error: error instanceof Error ? error.message : String(error),
      } as unknown as Error);
      return {
        isGitRepo: true,
        branch: { branch: '', upstream: null, ahead: 0, behind: 0 },
        files: [],
      };
    }
  }

  async getWorktrees(workspacePath: string): Promise<GitWorktreeInfo[]> {
    try {
      const { stdout, exitCode } = await this.execGit(
        ['worktree', 'list', '--porcelain'],
        workspacePath,
        { timeoutMs: WORKTREE_GIT_TIMEOUT_MS },
      );

      if (exitCode !== 0) {
        return [];
      }

      return parseWorktreeList(stdout);
    } catch (error) {
      this.logger.error('[GitInfoService] getWorktrees failed', {
        workspacePath,
        error: error instanceof Error ? error.message : String(error),
      } as unknown as Error);
      return [];
    }
  }

  async addWorktree(
    workspacePath: string,
    params: { branch: string; path?: string; createBranch?: boolean },
  ): Promise<{ success: boolean; worktreePath?: string; error?: string }> {
    try {
      const worktreePath =
        params.path || path.join(path.dirname(workspacePath), params.branch);

      const args = ['worktree', 'add'];
      if (params.createBranch) {
        args.push('-b', params.branch, worktreePath);
      } else {
        args.push(worktreePath, params.branch);
      }

      const { exitCode, stderr } = await this.execGit(args, workspacePath, {
        timeoutMs: WORKTREE_GIT_TIMEOUT_MS,
      });

      if (exitCode !== 0) {
        return {
          success: false,
          error: stderr.trim() || 'Failed to add worktree',
        };
      }

      return { success: true, worktreePath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[GitInfoService] addWorktree failed', {
        workspacePath,
        branch: params.branch,
        error: message,
      } as unknown as Error);
      return { success: false, error: message };
    }
  }

  async removeWorktree(
    workspacePath: string,
    worktreePath: string,
    force?: boolean,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const args = ['worktree', 'remove'];
      if (force) {
        args.push('--force');
      }
      args.push(worktreePath);

      const { exitCode, stderr } = await this.execGit(args, workspacePath, {
        timeoutMs: WORKTREE_GIT_TIMEOUT_MS,
      });

      if (exitCode !== 0) {
        return {
          success: false,
          error: stderr.trim() || 'Failed to remove worktree',
        };
      }

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[GitInfoService] removeWorktree failed', {
        workspacePath,
        worktreePath,
        error: message,
      } as unknown as Error);
      return { success: false, error: message };
    }
  }

  /**
   * Stage files in the git index.
   * Runs: git add -- <paths...>
   */
  async stageFiles(
    workspacePath: string,
    paths: string[],
  ): Promise<GitStageResult> {
    try {
      this.validatePaths(paths);

      const { exitCode, stderr } = await this.execGit(
        ['add', '--', ...paths],
        workspacePath,
      );

      if (exitCode !== 0) {
        return {
          success: false,
          error: stderr.trim() || 'Failed to stage files',
        };
      }

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[GitInfoService] stageFiles failed', {
        workspacePath,
        paths,
        error: message,
      } as unknown as Error);
      return { success: false, error: message };
    }
  }

  /**
   * Unstage files from the git index.
   * Runs: git reset HEAD -- <paths...>
   */
  async unstageFiles(
    workspacePath: string,
    paths: string[],
  ): Promise<GitUnstageResult> {
    try {
      this.validatePaths(paths);

      const { exitCode, stderr } = await this.execGit(
        ['reset', 'HEAD', '--', ...paths],
        workspacePath,
      );

      if (exitCode !== 0) {
        return {
          success: false,
          error: stderr.trim() || 'Failed to unstage files',
        };
      }

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[GitInfoService] unstageFiles failed', {
        workspacePath,
        paths,
        error: message,
      } as unknown as Error);
      return { success: false, error: message };
    }
  }

  /**
   * Discard working tree changes for files.
   * For tracked files: git checkout -- <paths...>
   * For untracked files: git clean -f -- <paths...>
   *
   * WARNING: This is a destructive operation that cannot be undone.
   */
  async discardChanges(
    workspacePath: string,
    paths: string[],
  ): Promise<GitDiscardResult> {
    try {
      this.validatePaths(paths);
      const { stdout: statusOutput } = await this.execGit(
        ['status', '--porcelain', '--', ...paths],
        workspacePath,
      );

      const untrackedPaths: string[] = [];
      const trackedPaths: string[] = [];

      for (const line of statusOutput.split('\n')) {
        if (!line.trim()) continue;
        if (line.startsWith('?? ')) {
          untrackedPaths.push(line.substring(3).trim());
        } else {
          trackedPaths.push(line.substring(3).trim());
        }
      }
      if (trackedPaths.length > 0) {
        const { exitCode, stderr } = await this.execGit(
          ['checkout', '--', ...trackedPaths],
          workspacePath,
        );

        if (exitCode !== 0) {
          return {
            success: false,
            error: stderr.trim() || 'Failed to discard tracked file changes',
          };
        }
      }
      if (untrackedPaths.length > 0) {
        this.logger.warn(
          '[GitInfoService] Removing untracked files via git clean (irreversible)',
          {
            workspacePath,
            paths: untrackedPaths,
          } as unknown as Error,
        );

        const { exitCode, stderr } = await this.execGit(
          ['clean', '-f', '--', ...untrackedPaths],
          workspacePath,
        );

        if (exitCode !== 0) {
          return {
            success: false,
            error: stderr.trim() || 'Failed to remove untracked files',
          };
        }
      }

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[GitInfoService] discardChanges failed', {
        workspacePath,
        paths,
        error: message,
      } as unknown as Error);
      return { success: false, error: message };
    }
  }

  /**
   * Create a commit with the given message.
   * Runs: git commit -m "<message>"
   * Parses the commit hash from the output.
   */
  async commit(
    workspacePath: string,
    message: string,
  ): Promise<GitCommitResult> {
    try {
      const trimmedMessage = message.trim();
      if (!trimmedMessage) {
        return { success: false, error: 'Commit message cannot be empty' };
      }

      const { stdout, exitCode, stderr } = await this.execGit(
        ['commit', '-m', trimmedMessage],
        workspacePath,
      );

      if (exitCode !== 0) {
        return {
          success: false,
          error: stderr.trim() || 'Failed to create commit',
        };
      }
      const hashMatch = stdout.match(/\[[\w/.-]+ ([0-9a-f]+)\]/);
      const commitHash = hashMatch?.[1];

      return { success: true, commitHash };
    } catch (error) {
      const message_ = error instanceof Error ? error.message : String(error);
      this.logger.error('[GitInfoService] commit failed', {
        workspacePath,
        error: message_,
      } as unknown as Error);
      return { success: false, error: message_ };
    }
  }

  /**
   * Push the current branch to its upstream remote.
   * Runs: git push
   * Uses the longer worktree timeout since push is a network operation.
   */
  async push(workspacePath: string): Promise<GitPushResult> {
    try {
      const { exitCode, stderr } = await this.execGit(['push'], workspacePath, {
        timeoutMs: WORKTREE_GIT_TIMEOUT_MS,
      });

      if (exitCode !== 0) {
        return { success: false, error: stderr.trim() || 'git push failed' };
      }

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[GitInfoService] push failed', {
        workspacePath,
        error: message,
      } as unknown as Error);
      return { success: false, error: message };
    }
  }

  /**
   * Show file content from HEAD.
   * Runs: git show HEAD:<relativePath>
   * Returns empty content for new/untracked files.
   */
  async showFile(
    workspacePath: string,
    relativePath: string,
  ): Promise<GitShowFileResult> {
    try {
      if (!relativePath || !relativePath.trim()) {
        return { content: '' };
      }

      this.validatePathSegment(relativePath);

      const { stdout, exitCode } = await this.execGit(
        ['show', `HEAD:${relativePath}`],
        workspacePath,
      );

      if (exitCode !== 0) {
        return { content: '' };
      }

      return { content: stdout };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[GitInfoService] showFile failed', {
        workspacePath,
        relativePath,
        error: message,
      } as unknown as Error);
      return { content: '' };
    }
  }

  /**
   * Read one side of a diff — the blob at `<rev>:<relativePath>`.
   *
   * `rev` is the revision half of a git object spec: `'HEAD'` for the last
   * commit, `''` for the index.
   *
   * Unlike {@link showFile}, a failed read is never flattened to empty
   * content. "The path does not exist at this revision" (`absent`) and "the
   * read could not be performed" (`error`) are distinct outcomes, because
   * rendering the second as the first is what makes a genuinely-empty tracked
   * file indistinguishable from a brand-new one.
   *
   * Classification is by exit code, never by message text — git's stderr
   * wording is localized, and `git show` exits 128 both for a missing path and
   * for a broken repository.
   *
   * ```
   * git show <rev>:<path>
   *   exit 0    -> 'content' (or 'binary' when the bytes contain NUL)
   *   exit != 0 -> git rev-parse --verify --quiet <rev>:<path>
   *                  exit 0     -> 'error' (object resolves, show failed)
   *                  exit 1     -> 'absent'
   *                  otherwise  -> 'error', classified by pre-flight probes
   * ```
   *
   * Note on the probe command: the plan specified `git cat-file -e`, but that
   * exits **128** (not 1) for a missing path on current git — it only reports
   * 1 for a bare object name. `rev-parse --verify --quiet` yields the exact
   * 0 / 1 / 128 partition the ladder needs.
   *
   * Costs zero extra spawns on the happy path.
   */
  async readBlob(
    workspacePath: string,
    rev: string,
    relativePath: string,
  ): Promise<GitBlobRead> {
    this.validatePathSegment(relativePath);
    const spec = `${rev}:${relativePath}`;

    try {
      const show = await this.execGitBuffer(['show', spec], workspacePath);

      if (show.exitCode === 0) {
        if (show.stdout.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
          return { outcome: 'binary', byteLength: show.stdout.byteLength };
        }
        return { outcome: 'content', content: show.stdout.toString('utf8') };
      }

      const probe = await this.execGit(
        ['rev-parse', '--verify', '--quiet', spec],
        workspacePath,
      );

      if (probe.exitCode === 1) {
        return { outcome: 'absent' };
      }

      // Raw stderr and the absolute workspace path stay in the log; only a
      // code and a workspace-relative message cross the RPC boundary.
      this.logger.error('[GitInfoService] readBlob failed', {
        workspacePath,
        rev,
        relativePath,
        showExitCode: show.exitCode,
        revParseExitCode: probe.exitCode,
        stderr: show.stderr,
      } as unknown as Error);

      return this.gitReadError(
        await this.probeReadErrorCode(workspacePath),
        relativePath,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[GitInfoService] readBlob threw', {
        workspacePath,
        rev,
        relativePath,
        error: message,
      } as unknown as Error);
      return this.gitReadError(this.classifyExecError(error), relativePath);
    }
  }

  /**
   * Resolve both sides of a file diff for one of the two Source Control rows.
   *
   * Side resolution is derived from whether each side's object actually
   * exists, not from a parsed status code, so every row of the design's
   * resolution table falls out of the same two reads:
   *
   * | status        | comparison | originalRef      | modifiedRef |
   * |---------------|------------|------------------|-------------|
   * | `M` unstaged  | worktree   | index            | worktree    |
   * | `M` staged    | staged     | commit(HEAD)     | index       |
   * | `??` untracked| worktree   | absent           | worktree    |
   * | `A` staged    | staged     | absent           | index       |
   * | `D` unstaged  | worktree   | index            | absent      |
   * | `D` staged    | staged     | commit(HEAD)     | absent      |
   * | `R` staged    | staged     | commit @ origPath| index       |
   * | no commits    | staged     | absent           | index       |
   *
   * `HEAD ↔ worktree` is deliberately not offered: it maps to no UI row.
   * A worktree deletion's original side is the **index**, not HEAD — the two
   * coincide only when nothing is staged.
   */
  async diffFile(
    workspacePath: string,
    request: DiffFileRequest,
    fileReader: WorktreeFileReader,
  ): Promise<GitDiffFileResult> {
    const modifiedPath = request.path;
    const originalPath = request.originalPath ?? request.path;

    this.validatePathSegment(modifiedPath);
    this.validatePathSegment(originalPath);

    const comparison = request.comparison;

    try {
      let original: GitBlobRead;
      let originalRef: DiffSideRef;
      let modified: GitBlobRead;
      let modifiedRef: DiffSideRef;

      if (comparison === 'staged') {
        const headSha = await this.resolveHeadSha(workspacePath);
        if (headSha === null) {
          // Repository with zero commits: HEAD does not resolve, so the
          // original side is genuinely absent rather than unreadable.
          original = { outcome: 'absent' };
          originalRef = { kind: 'absent' };
        } else {
          original = await this.readBlob(workspacePath, 'HEAD', originalPath);
          originalRef =
            original.outcome === 'absent'
              ? { kind: 'absent' }
              : { kind: 'commit', sha: headSha };
        }

        modified = await this.readBlob(workspacePath, '', modifiedPath);
        modifiedRef =
          modified.outcome === 'absent'
            ? { kind: 'absent' }
            : { kind: 'index' };
      } else {
        original = await this.readBlob(workspacePath, '', originalPath);
        originalRef =
          original.outcome === 'absent'
            ? { kind: 'absent' }
            : { kind: 'index' };

        modified = await this.readWorktreeBlob(
          workspacePath,
          modifiedPath,
          fileReader,
        );
        modifiedRef =
          modified.outcome === 'absent'
            ? { kind: 'absent' }
            : { kind: 'worktree' };
      }

      return {
        path: modifiedPath,
        originalPath,
        comparison,
        original,
        modified,
        originalRef,
        modifiedRef,
        snapshotToken: this.computeSnapshotToken({
          comparison,
          path: modifiedPath,
          originalPath,
          originalRef,
          modifiedRef,
          original,
          modified,
        }),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[GitInfoService] diffFile failed', {
        workspacePath,
        path: modifiedPath,
        originalPath,
        comparison,
        error: message,
      } as unknown as Error);

      const failure = this.gitReadError(
        this.classifyExecError(error),
        modifiedPath,
      );
      const absent: DiffSideRef = { kind: 'absent' };

      return {
        path: modifiedPath,
        originalPath,
        comparison,
        original: failure,
        modified: failure,
        originalRef: absent,
        modifiedRef: absent,
        snapshotToken: this.computeSnapshotToken({
          comparison,
          path: modifiedPath,
          originalPath,
          originalRef: absent,
          modifiedRef: absent,
          original: failure,
          modified: failure,
        }),
      };
    }
  }

  /**
   * Read the working-tree side of a diff through the platform file system
   * port. A missing file is `absent` — that is what makes a deleted file
   * render as a diff instead of raising an error.
   */
  private async readWorktreeBlob(
    workspacePath: string,
    relativePath: string,
    fileReader: WorktreeFileReader,
  ): Promise<GitBlobRead> {
    const absolutePath = path.join(workspacePath, relativePath);

    try {
      if (!(await fileReader.exists(absolutePath))) {
        return { outcome: 'absent' };
      }

      const bytes = await fileReader.readFileBytes(absolutePath);
      const buffer = Buffer.from(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );

      if (buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
        return { outcome: 'binary', byteLength: buffer.byteLength };
      }
      return { outcome: 'content', content: buffer.toString('utf8') };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[GitInfoService] worktree read failed', {
        workspacePath,
        relativePath,
        error: message,
      } as unknown as Error);
      return this.gitReadError(this.classifyExecError(error), relativePath);
    }
  }

  /**
   * Full SHA of HEAD, or null when HEAD does not resolve (repository with no
   * commits, or an unborn branch). Rejections propagate — a missing git binary
   * must not be misreported as "no commits".
   */
  private async resolveHeadSha(workspacePath: string): Promise<string | null> {
    const { stdout, exitCode } = await this.execGit(
      ['rev-parse', '--verify', '--quiet', 'HEAD'],
      workspacePath,
    );
    if (exitCode !== 0) return null;
    const sha = stdout.trim();
    return sha.length > 0 ? sha : null;
  }

  /**
   * Pre-flight probes, run only once a read has already failed, to turn an
   * opaque non-zero exit into a specific cause.
   */
  private async probeReadErrorCode(
    workspacePath: string,
  ): Promise<GitReadErrorCode> {
    try {
      if (!(await this.isGitRepo(workspacePath))) return 'not-a-repo';
      if ((await this.resolveHeadSha(workspacePath)) === null) {
        return 'no-commits';
      }
      return 'unknown';
    } catch (error: unknown) {
      return this.classifyExecError(error);
    }
  }

  /** Map a thrown spawn/timeout failure onto a read error code. */
  private classifyExecError(error: unknown): GitReadErrorCode {
    if (!(error instanceof Error)) return 'unknown';
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return 'git-missing';
    if (code === 'EACCES' || code === 'EPERM') return 'permission-denied';
    if (/timed out after \d+ms/.test(error.message)) return 'timeout';
    return 'unknown';
  }

  /**
   * Build the user-facing failure payload. The message carries the
   * workspace-relative path and the code and nothing else — never stderr,
   * never an absolute path.
   */
  private gitReadError(
    code: GitReadErrorCode,
    relativePath: string,
  ): GitBlobRead {
    return {
      outcome: 'error',
      code,
      message: `Could not read "${relativePath}" from git (${code}).`,
    };
  }

  /**
   * sha256 over the exact content of both sides plus their ref identity.
   *
   * Every component is length-prefixed so no combination of paths or content
   * can be rearranged into the same digest. Opaque to the client; it exists so
   * a later write can prove it applies to the snapshot the user was shown.
   */
  private computeSnapshotToken(input: {
    comparison: GitDiffComparison;
    path: string;
    originalPath: string;
    originalRef: DiffSideRef;
    modifiedRef: DiffSideRef;
    original: GitBlobRead;
    modified: GitBlobRead;
  }): string {
    const hash = createHash('sha256');
    const field = (value: string): void => {
      hash.update(`${Buffer.byteLength(value, 'utf8')}\0`, 'utf8');
      hash.update(value, 'utf8');
    };

    field(input.comparison);
    field(input.originalPath);
    field(input.path);
    field(this.describeRef(input.originalRef));
    field(this.describeRef(input.modifiedRef));
    field(this.describeBlob(input.original));
    field(this.describeBlob(input.modified));

    return hash.digest('hex');
  }

  private describeRef(ref: DiffSideRef): string {
    return ref.kind === 'commit' ? `commit:${ref.sha}` : ref.kind;
  }

  private describeBlob(blob: GitBlobRead): string {
    switch (blob.outcome) {
      case 'content':
        return `content:${blob.content}`;
      case 'binary':
        return `binary:${blob.byteLength}`;
      case 'absent':
        return 'absent';
      case 'error':
        return `error:${blob.code}`;
    }
  }

  /**
   * Validate an array of paths: must be non-empty, no path traversal.
   * Throws on invalid input.
   */
  private validatePaths(paths: string[]): void {
    if (!paths || paths.length === 0) {
      throw new Error('paths must be a non-empty array');
    }

    for (const p of paths) {
      this.validatePathSegment(p);
    }
  }

  /**
   * Validate a single path: must be non-empty, no '..' segments.
   * Throws on invalid input.
   */
  private validatePathSegment(filePath: string): void {
    if (!filePath || !filePath.trim()) {
      throw new Error('path must be a non-empty string');
    }
    const normalized = filePath.replace(/\\/g, '/');
    const segments = normalized.split('/');
    if (segments.some((s) => s === '..')) {
      throw new Error(
        `Path traversal detected: "${filePath}" contains '..' segments`,
      );
    }
  }

  /**
   * List local (and optionally remote) branches with ahead/behind counts.
   *
   * Uses `%(ahead-behind:upstream)` (requires git >= 2.31). When that field
   * is empty but an upstream is configured, falls back to a per-branch
   * `git rev-list --left-right --count` call. When no upstream is set,
   * ahead/behind default to 0.
   */
  async getBranches(
    workspacePath: string,
    includeRemote = false,
  ): Promise<GitBranchesResult> {
    const empty: GitBranchesResult = {
      current: '',
      local: [],
      remote: [],
    };
    try {
      let current = '';

      const { stdout: symRefOut, exitCode: symRefCode } = await this.execGit(
        ['symbolic-ref', '--short', 'HEAD'],
        workspacePath,
      );
      if (symRefCode === 0) {
        current = symRefOut.trim();
      }
      const fmt =
        '%(refname:short)%09%(objectname:short)%09%(upstream:short)%09%09%(creatordate:unix)';

      const localArgs = ['for-each-ref', `--format=${fmt}`, 'refs/heads/'];
      const { stdout: localOut, exitCode: localExit } = await this.execGit(
        localArgs,
        workspacePath,
      );

      if (localExit !== 0) {
        return empty;
      }

      const local: BranchRef[] = [];
      for (const line of localOut.split('\n')) {
        const parsed = await this.parseBranchRefLine(
          line,
          false,
          workspacePath,
        );
        if (parsed) local.push(parsed);
      }

      const remote: BranchRef[] = [];
      if (includeRemote) {
        const remoteArgs = ['for-each-ref', `--format=${fmt}`, 'refs/remotes/'];
        const { stdout: remoteOut, exitCode: remoteExit } = await this.execGit(
          remoteArgs,
          workspacePath,
        );

        if (remoteExit === 0) {
          for (const line of remoteOut.split('\n')) {
            const shortName = line.split('\t')[0];
            if (shortName.endsWith('/HEAD')) continue;
            const parsed = await this.parseBranchRefLine(
              line,
              true,
              workspacePath,
            );
            if (parsed) remote.push(parsed);
          }
        }
      }
      for (const b of local) {
        b.isCurrent = b.name === current;
      }

      return { current, local, remote };
    } catch (error) {
      this.logger.error('[GitInfoService] getBranches failed', {
        workspacePath,
        error: error instanceof Error ? error.message : String(error),
      } as unknown as Error);
      return empty;
    }
  }

  /**
   * Parse a single `for-each-ref` formatted line into a `BranchRef`.
   * Format: refname:short TAB objectname:short TAB upstream:short TAB ahead-behind:upstream TAB creatordate:unix
   */
  private async parseBranchRefLine(
    line: string,
    isRemote: boolean,
    workspacePath: string,
  ): Promise<BranchRef | null> {
    const trimmed = line.trim();
    if (!trimmed) return null;

    const parts = trimmed.split('\t');
    const name = parts[0] ?? '';
    const lastCommitHash = parts[1] ?? '';
    const upstream = parts[2] ?? '';
    const aheadBehindRaw = parts[3] ?? '';
    const creatorDateRaw = parts[4] ?? '';

    if (!name) return null;

    let ahead = 0;
    let behind = 0;

    if (upstream) {
      if (aheadBehindRaw) {
        const [aheadStr, behindStr] = aheadBehindRaw.split(' ');
        const parsedAhead = parseInt(aheadStr ?? '0', 10);
        const parsedBehind = parseInt(behindStr ?? '0', 10);
        if (!isNaN(parsedAhead)) ahead = parsedAhead;
        if (!isNaN(parsedBehind)) behind = parsedBehind;
      } else {
        const { stdout: rlOut, exitCode: rlCode } = await this.execGit(
          ['rev-list', '--left-right', '--count', `${upstream}...${name}`],
          workspacePath,
        );
        if (rlCode === 0) {
          const [behindStr, aheadStr] = rlOut.trim().split('\t');
          const parsedBehind = parseInt(behindStr ?? '0', 10);
          const parsedAhead = parseInt(aheadStr ?? '0', 10);
          if (!isNaN(parsedBehind)) behind = parsedBehind;
          if (!isNaN(parsedAhead)) ahead = parsedAhead;
        }
      }
    }

    const lastCommitTime = creatorDateRaw
      ? parseInt(creatorDateRaw, 10) * 1000
      : undefined;

    const ref: BranchRef = {
      name,
      isCurrent: false, // set by caller if needed
      isRemote,
      upstream: upstream || undefined,
      ahead,
      behind,
      lastCommitHash: lastCommitHash || undefined,
      lastCommitTime: isNaN(lastCommitTime ?? NaN) ? undefined : lastCommitTime,
    };

    if (isRemote) {
      const slashIdx = name.indexOf('/');
      if (slashIdx !== -1) {
        ref.remote = name.substring(0, slashIdx);
      }
    }

    return ref;
  }

  /**
   * Checkout a branch, creating it if requested.
   *
   * Security: `validatePathSegment(branch)` is called before any git operation.
   * Dirty-tree guard: if `force` is not set and the working tree has changes,
   * returns `{ success: false, dirty: true }` without running checkout.
   */
  async checkout(
    workspacePath: string,
    branch: string,
    createNew?: boolean,
    force?: boolean,
  ): Promise<GitCheckoutResult> {
    try {
      try {
        this.validatePathSegment(branch);
      } catch {
        return { success: false, error: 'Invalid branch name' };
      }

      if (!force) {
        const { stdout: statusOut, exitCode: statusCode } = await this.execGit(
          ['status', '--porcelain'],
          workspacePath,
        );
        if (statusCode === 0 && statusOut.trim()) {
          return { success: false, dirty: true };
        }
      }

      const args = ['checkout'];
      if (force) args.push('--force');
      if (createNew) args.push('-b');
      args.push(branch);

      const { exitCode, stderr } = await this.execGit(args, workspacePath);
      if (exitCode !== 0) {
        return { success: false, error: stderr.trim() || 'checkout failed' };
      }

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[GitInfoService] checkout failed', {
        workspacePath,
        branch,
        error: message,
      } as unknown as Error);
      return { success: false, error: message };
    }
  }

  /**
   * List all stash entries.
   * Runs: git stash list --format=%gd%x09%s%x09%ct
   * Tab (%x09) is used as the field separator — it cannot appear in stash
   * messages entered via the CLI, so there is no collision with message content.
   */
  async stashList(workspacePath: string): Promise<GitStashListResult> {
    try {
      const { stdout, exitCode } = await this.execGit(
        ['stash', 'list', '--format=%gd%x09%s%x09%ct'],
        workspacePath,
      );

      if (exitCode !== 0) {
        return { count: 0, entries: [] };
      }

      const entries: StashEntry[] = [];
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const parts = trimmed.split('\t');
        const ref = parts[0] ?? '';
        const message = parts[1] ?? '';
        const timeRaw = parts[2] ?? '';
        const indexMatch = ref.match(/stash@\{(\d+)\}/);
        const index = indexMatch ? parseInt(indexMatch[1], 10) : 0;
        const time = timeRaw ? parseInt(timeRaw, 10) * 1000 : undefined;

        entries.push({ index, message, time });
      }

      return { count: entries.length, entries };
    } catch (error) {
      this.logger.error('[GitInfoService] stashList failed', {
        workspacePath,
        error: error instanceof Error ? error.message : String(error),
      } as unknown as Error);
      return { count: 0, entries: [] };
    }
  }

  /**
   * List tags sorted by creation date (newest first), limited to `limit` entries.
   * Runs: git tag --sort=-creatordate --format=...
   */
  async getTags(workspacePath: string, limit = 20): Promise<GitTagsResult> {
    try {
      const fmt =
        '%(refname:short)%09%(objectname:short)%09%(*objectname:short)%09%(creatordate:unix)';
      const { stdout, exitCode } = await this.execGit(
        ['tag', '--sort=-creatordate', `--format=${fmt}`],
        workspacePath,
      );

      if (exitCode !== 0) {
        return { tags: [] };
      }

      const tags: TagRef[] = [];
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const parts = trimmed.split('\t');
        const name = parts[0] ?? '';
        const objectHash = parts[1] ?? '';
        const derefHash = parts[2] ?? ''; // non-empty only for annotated tags
        const creatorDateRaw = parts[3] ?? '';

        if (!name) continue;
        const annotated = derefHash !== '' && derefHash !== objectHash;
        const commit = annotated ? derefHash : objectHash;
        const time = creatorDateRaw
          ? parseInt(creatorDateRaw, 10) * 1000
          : undefined;

        tags.push({
          name,
          commit,
          annotated,
          time: isNaN(time ?? NaN) ? undefined : time,
        });

        if (tags.length >= limit) break;
      }

      return { tags };
    } catch (error) {
      this.logger.error('[GitInfoService] getTags failed', {
        workspacePath,
        error: error instanceof Error ? error.message : String(error),
      } as unknown as Error);
      return { tags: [] };
    }
  }

  /**
   * List all configured remotes with their fetch and push URLs.
   * Runs: git remote -v
   */
  async getRemotes(workspacePath: string): Promise<GitRemotesResult> {
    try {
      const { stdout, exitCode } = await this.execGit(
        ['remote', '-v'],
        workspacePath,
      );

      if (exitCode !== 0) {
        return { remotes: [] };
      }

      const remoteMap = new Map<string, RemoteInfo>();

      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const tabIdx = trimmed.indexOf('\t');
        if (tabIdx === -1) continue;

        const remoteName = trimmed.substring(0, tabIdx);
        const rest = trimmed.substring(tabIdx + 1);

        const fetchMatch = rest.match(/^(.+)\s+\(fetch\)$/);
        const pushMatch = rest.match(/^(.+)\s+\(push\)$/);

        if (!remoteMap.has(remoteName)) {
          remoteMap.set(remoteName, {
            name: remoteName,
            fetchUrl: '',
            pushUrl: '',
          });
        }

        const info = remoteMap.get(remoteName)!;
        if (fetchMatch) {
          info.fetchUrl = fetchMatch[1].trim();
        } else if (pushMatch) {
          info.pushUrl = pushMatch[1].trim();
        }
      }

      return { remotes: Array.from(remoteMap.values()) };
    } catch (error) {
      this.logger.error('[GitInfoService] getRemotes failed', {
        workspacePath,
        error: error instanceof Error ? error.message : String(error),
      } as unknown as Error);
      return { remotes: [] };
    }
  }

  /**
   * Get the last commit for a given ref (defaults to HEAD).
   * Runs: git log -1 --format='%H%n%h%n%s%n%an%n%ae%n%ct%n%b' <ref>
   *
   * Security: `ref` is validated via `validatePathSegment` before being passed
   * to execGit. This prevents git flag injection (e.g. --upload-pack=...) from
   * a crafted frontend request, consistent with the guard applied to `checkout`.
   */
  async getLastCommit(
    workspacePath: string,
    ref = 'HEAD',
  ): Promise<GitLastCommitResult> {
    const emptyResult: GitLastCommitResult = {
      hash: '',
      shortHash: '',
      subject: '',
      body: '',
      author: '',
      authorEmail: '',
      time: 0,
    };
    try {
      this.validatePathSegment(ref);
    } catch {
      return emptyResult;
    }

    try {
      const { stdout, exitCode } = await this.execGit(
        ['log', '-1', '--format=%H%n%h%n%s%n%an%n%ae%n%ct%n%b', ref],
        workspacePath,
      );

      if (exitCode !== 0 || !stdout.trim()) {
        return emptyResult;
      }
      const lines = stdout.split('\n');
      const hash = lines[0]?.trim() ?? '';
      const shortHash = lines[1]?.trim() ?? '';
      const subject = lines[2]?.trim() ?? '';
      const author = lines[3]?.trim() ?? '';
      const authorEmail = lines[4]?.trim() ?? '';
      const ctRaw = lines[5]?.trim() ?? '';
      const body = lines.slice(6).join('\n').trim();

      const time = ctRaw ? parseInt(ctRaw, 10) * 1000 : 0;

      return {
        hash,
        shortHash,
        subject,
        body,
        author,
        authorEmail,
        time: isNaN(time) ? 0 : time,
      };
    } catch (error) {
      this.logger.error('[GitInfoService] getLastCommit failed', {
        workspacePath,
        ref,
        error: error instanceof Error ? error.message : String(error),
      } as unknown as Error);
      return emptyResult;
    }
  }

  async isGitRepo(workspacePath: string): Promise<boolean> {
    try {
      const { stdout, exitCode } = await this.execGit(
        ['rev-parse', '--is-inside-work-tree'],
        workspacePath,
      );
      return exitCode === 0 && stdout.trim() === 'true';
    } catch {
      return false;
    }
  }

  private execGit(
    args: string[],
    cwd: string,
    options?: ExecGitOptions,
  ): Promise<ExecGitResult> {
    return execGit(args, cwd, options);
  }

  private execGitBuffer(
    args: string[],
    cwd: string,
    options?: ExecGitOptions,
  ): Promise<ExecGitBufferResult> {
    return execGitBuffer(args, cwd, options);
  }

  /**
   * Parse branch info from git status --porcelain=v2 --branch output.
   * Lines starting with # contain branch metadata:
   *   # branch.oid <commit>
   *   # branch.head <branch-name>
   *   # branch.upstream <upstream>
   *   # branch.ab +<ahead> -<behind>
   */
  private parseBranchInfo(output: string): GitBranchInfo {
    const info: GitBranchInfo = {
      branch: '',
      upstream: null,
      ahead: 0,
      behind: 0,
    };

    const lines = output.split('\n');
    for (const line of lines) {
      if (line.startsWith('# branch.head ')) {
        const head = line.substring('# branch.head '.length);
        info.branch = head === '(detached)' ? 'HEAD' : head;
      } else if (line.startsWith('# branch.upstream ')) {
        info.upstream = line.substring('# branch.upstream '.length);
      } else if (line.startsWith('# branch.ab ')) {
        const match = line.match(/# branch\.ab \+(\d+) -(\d+)/);
        if (match) {
          info.ahead = parseInt(match[1], 10);
          info.behind = parseInt(match[2], 10);
        }
      }
    }

    return info;
  }

  /**
   * Parse file status from git status --porcelain=v2 output.
   *
   * Format for ordinary changed entries (type 1):
   *   1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
   *
   * Format for renamed/copied entries (type 2):
   *   2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path><tab><origPath>
   *
   * Format for unmerged entries:
   *   u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
   *
   * Format for untracked entries:
   *   ? <path>
   *
   * XY field: X=index status, Y=worktree status
   */
  private parseFileStatus(output: string): GitFileStatus[] {
    const files: GitFileStatus[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      if (line.startsWith('1 ')) {
        const xy = line.substring(2, 4);
        const indexStatus = xy[0];
        const worktreeStatus = xy[1];

        const parts = line.split(' ');
        const filePath = parts.slice(8).join(' ');
        if (indexStatus !== '.') {
          files.push({
            path: filePath,
            status: this.mapStatusCode(indexStatus),
            staged: true,
          });
        }
        if (worktreeStatus !== '.') {
          files.push({
            path: filePath,
            status: this.mapStatusCode(worktreeStatus),
            staged: false,
          });
        }
      } else if (line.startsWith('2 ')) {
        const xy = line.substring(2, 4);
        const indexStatus = xy[0];
        const worktreeStatus = xy[1];

        const tabIndex = line.indexOf('\t');
        const beforeTab = tabIndex >= 0 ? line.substring(0, tabIndex) : line;
        const beforeTabParts = beforeTab.split(' ');
        const filePath = beforeTabParts.slice(9).join(' ');
        // The post-tab segment is the pre-rename source path. Discarding it
        // makes a staged rename undiffable: the original side must be read at
        // HEAD under the OLD path, which exists nowhere else in this output.
        const origPath =
          tabIndex >= 0 ? line.substring(tabIndex + 1) : undefined;
        if (indexStatus !== '.') {
          files.push({
            path: filePath,
            status: this.mapStatusCode(indexStatus),
            staged: true,
            ...(origPath && { origPath }),
          });
        }
        if (worktreeStatus !== '.') {
          files.push({
            path: filePath,
            status: this.mapStatusCode(worktreeStatus),
            staged: false,
            ...(origPath && { origPath }),
          });
        }
      } else if (line.startsWith('u ')) {
        const parts = line.split(' ');
        const filePath = parts.slice(10).join(' ');
        files.push({ path: filePath, status: 'M', staged: false });
      } else if (line.startsWith('? ')) {
        const rawPath = line.substring(2);
        const isDir = rawPath.endsWith('/');
        const filePath = isDir ? rawPath.slice(0, -1) : rawPath;
        files.push({
          path: filePath,
          status: '??',
          staged: false,
          ...(isDir && { isDirectory: true }),
        });
      }
    }

    return files;
  }

  private mapStatusCode(code: string): GitFileStatus['status'] {
    switch (code) {
      case 'M':
        return 'M';
      case 'A':
        return 'A';
      case 'D':
        return 'D';
      case 'R':
        return 'R';
      case 'C':
        return 'C';
      default:
        return 'M';
    }
  }
}
