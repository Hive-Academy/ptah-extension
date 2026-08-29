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
  type GitHunkRef,
  type GitApplyHunksOperation,
  type GitApplyHunksFailure,
  type GitApplyHunksResult,
} from '@ptah-extension/shared';

/**
 * git's own binary heuristic: a NUL byte anywhere in the first 8000 bytes.
 */
const BINARY_SNIFF_BYTES = 8000;

/**
 * A unified-diff hunk header: `@@ -a[,b] +c[,d] @@[ section]`.
 *
 * Anchored at the start of a line. Every *body* line of a hunk is prefixed by
 * ' ', '+', '-' or '\', so a literal `@@` inside file content can never be
 * mistaken for a header.
 */
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** git's marker for a diff it declined to render as text. */
const BINARY_PATCH_MARKER = /^Binary files .* differ$/m;

/**
 * `git apply --verbose` announces a hunk that matched away from its recorded
 * line number. Only emitted under `--verbose`; plain `git apply` is silent
 * about offsets, which is why the write path always passes it.
 */
const APPLY_OFFSET_RE = /\(offset (-?\d+) lines?\)/g;

/** `git diff` flags shared by the read path and the write path. */
const DIFF_FLAGS = ['-U3', '--no-color', '--no-ext-diff'] as const;

/**
 * Does this argv change anything the read cache holds?
 *
 * Read commands must answer `false` or they invalidate the very entry they
 * were about to populate — hence the sub-command checks on `stash` (whose
 * `list` and `show` are reads) and `worktree` (whose `list` is a read).
 *
 * Over-answering `true` is safe: the worst case is a dropped cache entry and
 * one extra `for-each-ref`. Under-answering is not, so an unrecognised
 * sub-command of a mutating verb counts as a mutation.
 */
function isMutatingGitCommand(args: readonly string[]): boolean {
  const [command, sub] = args;
  switch (command) {
    case 'add':
    case 'apply':
    case 'checkout':
    case 'clean':
    case 'commit':
    case 'merge':
    case 'pull':
    case 'push':
    case 'rebase':
    case 'reset':
    case 'restore':
    case 'switch':
      return true;
    case 'stash':
      return sub !== 'list' && sub !== 'show';
    case 'worktree':
      return sub !== 'list';
    default:
      return false;
  }
}

/**
 * Read `%(upstream:track)` — the same field `git branch -vv` prints.
 *
 * git emits `[ahead 3, behind 2]`, `[ahead 3]`, `[behind 2]`, `[gone]`, or
 * the empty string. Empty means either "no upstream" or "in sync"; both are
 * 0/0, so the two need not be told apart here. `[gone]` (the upstream ref has
 * been deleted) is also 0/0 — there is nothing left to count against.
 *
 * The wording is stable because `exec-git` pins `LC_ALL=C` on every
 * invocation.
 */
function parseUpstreamTrack(raw: string): { ahead: number; behind: number } {
  const aheadMatch = /ahead (\d+)/.exec(raw);
  const behindMatch = /behind (\d+)/.exec(raw);
  return {
    ahead: aheadMatch ? Number.parseInt(aheadMatch[1], 10) : 0,
    behind: behindMatch ? Number.parseInt(behindMatch[1], 10) : 0,
  };
}

/**
 * Which operations are defined for each comparison.
 *
 * `worktree` compares index -> working tree: its changes can be promoted into
 * the index (stage) or thrown away (revert). `staged` compares HEAD -> index:
 * its only partial move is back out of the index (unstage). Discarding a
 * staged change outright is a two-step the user performs explicitly.
 */
const VALID_OPERATIONS: Readonly<
  Record<GitDiffComparison, readonly GitApplyHunksOperation[]>
> = {
  worktree: ['stage', 'revert'],
  staged: ['unstage'],
};

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

/**
 * The read *and write* slice of `IFileSystemProvider` the hunk-apply path
 * needs. Extends {@link WorktreeFileReader} with the one write used to restore
 * a worktree file after a failed reverse apply (AC7); nothing else on this
 * service ever writes through it.
 */
export interface WorktreeFileAccess extends WorktreeFileReader {
  writeFileBytes(filePath: string, content: Uint8Array): Promise<void>;
}

/** Request shape for {@link GitInfoService.diffFile}. */
export interface DiffFileRequest {
  /** Workspace-relative path, modified side. */
  path: string;
  comparison: GitDiffComparison;
  /** Pre-rename source path for staged renames; falls back to `path`. */
  originalPath?: string;
}

/** Request shape for {@link GitInfoService.applyHunks}. */
export interface ApplyHunksRequest extends DiffFileRequest {
  operation: GitApplyHunksOperation;
  /** Ordinals into the hunk array of the snapshot named by `snapshotToken`. */
  hunkIndices: number[];
  /** The token `diffFile` issued for the diff the user acted on. */
  snapshotToken: string;
}

/**
 * **Every method on this service assumes `workspacePath` is the git repository
 * top level.** It is not merely the process cwd for the subprocess: `readBlob`
 * addresses objects with root-relative `rev:path` specs, `readWorktreeBlob`
 * joins `workspacePath + path`, and `applyHunks` hands `git apply` a patch
 * whose `a/`…`b/` names `git diff` emitted relative to the top level.
 *
 * Opening a **subdirectory** of a repository as the workspace folder is
 * therefore unsupported. It fails safely rather than corrupting: `git diff`
 * still emits root-relative paths while `git apply` resolves them against cwd,
 * so the patch simply does not apply and the guards in {@link
 * GitInfoService.applyHunks} refuse before writing. Undocumented, that safe
 * failure reads as a bug to whoever hits it — hence this note.
 *
 * Removing the assumption (rather than stating it) means resolving the top
 * level once via `git rev-parse --show-toplevel` and using it as the cwd for
 * every invocation. That is a larger change and is deliberately not made here.
 */
export class GitInfoService {
  constructor(private readonly logger: Logger) {}

  /**
   * Settled results of the cheap-to-invalidate read methods, held until
   * {@link invalidateReadCache} drops them. Keys are
   * `${method}|${workspacePath}|${variant}`, so two workspace folders never
   * share an entry and invalidating one leaves the other intact.
   *
   * `getGitInfo` is deliberately NOT in here — it is the working-tree status
   * walk and the git watcher's own source of truth, so a settled entry would
   * make the watcher push status it had already superseded. It gets in-flight
   * coalescing only, which cannot be stale by construction: a concurrent
   * identical request is asking about the same instant.
   */
  private readonly readCache = new Map<string, unknown>();

  /**
   * Computations currently running, keyed as {@link readCache}. Concurrent
   * identical callers await the same promise instead of spawning a second
   * git process.
   */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  /**
   * Bumped by every {@link invalidateReadCache}. A computation that was
   * already running when the invalidation happened must not write its
   * pre-change value back into the freshly cleared cache, so every write-back
   * is conditional on this still being the generation it started under. Same
   * idiom as the `auth:getAuthStatus` cache (TASK_2026_342).
   */
  private cacheGeneration = 0;

  /**
   * Drop cached git reads.
   *
   * Called by every repo-mutating method on this service, and by
   * `GitWatcherService.fetchAndPush` for changes made outside Ptah (a `git
   * checkout` in a terminal) — so the status the watcher pushes and the branch
   * list the renderer asks for next describe the same instant.
   *
   * With no `workspacePath`, every workspace is dropped.
   */
  invalidateReadCache(workspacePath?: string): void {
    this.cacheGeneration++;
    if (!workspacePath) {
      this.readCache.clear();
      this.inFlight.clear();
      return;
    }
    const suffix = `|${workspacePath}|`;
    for (const key of [...this.readCache.keys()]) {
      if (key.includes(suffix)) this.readCache.delete(key);
    }
    for (const key of [...this.inFlight.keys()]) {
      if (key.includes(suffix)) this.inFlight.delete(key);
    }
  }

  /**
   * In-flight coalescing only — no settled entry. For reads that must always
   * reflect the current instant but need not run twice concurrently.
   */
  private coalesce<T>(key: string, compute: () => Promise<T>): Promise<T> {
    const running = this.inFlight.get(key);
    if (running) return running as Promise<T>;

    const promise = compute().finally(() => {
      // Delete by IDENTITY: an invalidated computation settling must not
      // evict the newer one that has already claimed this key.
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  /** In-flight coalescing plus a settled entry held until invalidation. */
  private cachedRead<T>(key: string, compute: () => Promise<T>): Promise<T> {
    if (this.readCache.has(key)) {
      return Promise.resolve(this.readCache.get(key) as T);
    }
    const generation = this.cacheGeneration;
    return this.coalesce(key, async () => {
      const value = await compute();
      if (generation === this.cacheGeneration) {
        this.readCache.set(key, value);
      }
      return value;
    });
  }

  async getGitInfo(workspacePath: string): Promise<GitInfoResult> {
    return this.coalesce(`info|${workspacePath}|`, () =>
      this.computeGitInfo(workspacePath),
    );
  }

  private async computeGitInfo(workspacePath: string): Promise<GitInfoResult> {
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
   *   exit 128  -> git rev-parse --verify --quiet <rev>:<path>
   *                  exit 0     -> 'error'/'submodule' (a gitlink: the spec
   *                                resolves, but to a commit, not a blob)
   *                  exit 1     -> 'absent'
   *                  otherwise  -> 'error', classified by pre-flight probes
   *   other     -> git rev-parse --verify --quiet <rev>:<path>
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

      // A gitlink. `git show` exits 128 because the entry resolves to a commit
      // object rather than a blob, while `rev-parse --verify` on the very same
      // spec exits 0 because that commit is a perfectly good object. That pair
      // is what separates a submodule from a missing or unreadable blob, and
      // the ladder already has both halves — no extra spawn, no message
      // sniffing.
      if (show.exitCode === 128 && probe.exitCode === 0) {
        return this.gitReadError('submodule', relativePath);
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

      // Read after both sides, so the token below covers the patch bytes that
      // were current at the *end* of this read rather than the start of it.
      const patch = await this.readPatch(
        workspacePath,
        comparison,
        modifiedPath,
        originalPath,
      );

      return {
        path: modifiedPath,
        originalPath,
        comparison,
        original,
        modified,
        originalRef,
        modifiedRef,
        patch,
        hunks: this.parseHunkRefs(patch),
        snapshotToken: this.computeSnapshotToken({
          comparison,
          path: modifiedPath,
          originalPath,
          originalRef,
          modifiedRef,
          original,
          modified,
          patch,
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
        patch: null,
        hunks: [],
        snapshotToken: this.computeSnapshotToken({
          comparison,
          path: modifiedPath,
          originalPath,
          originalRef: absent,
          modifiedRef: absent,
          original: failure,
          modified: failure,
          patch: null,
        }),
      };
    }
  }

  /**
   * git's own unified diff for one comparison of one path, verbatim.
   *
   * Returns `null` when git produced nothing — an untracked file (which
   * `git diff` does not report at all), an unchanged path, or a failed
   * invocation. `null` is what makes "there are no hunks to select" a first
   * class outcome instead of an empty-string special case.
   *
   * **A staged rename must be asked for by BOTH paths.** With only the
   * post-rename pathspec, git loses the rename pairing and emits a
   * `new file mode` block whose every line is an addition — the exact
   * "fabricated whole-file addition" hazard A3 exists to prevent, except
   * arriving through the patch rather than through a failed read. Verified
   * against git 2.54.0.
   */
  private async readPatch(
    workspacePath: string,
    comparison: GitDiffComparison,
    modifiedPath: string,
    originalPath: string,
  ): Promise<string | null> {
    const pathspec =
      originalPath === modifiedPath
        ? [modifiedPath]
        : [originalPath, modifiedPath];

    const args = [
      'diff',
      ...(comparison === 'staged' ? ['--cached'] : []),
      ...DIFF_FLAGS,
      '--',
      ...pathspec,
    ];

    const { stdout, stderr, exitCode } = await this.execGit(
      args,
      workspacePath,
    );

    if (exitCode !== 0) {
      this.logger.error('[GitInfoService] readPatch failed', {
        workspacePath,
        comparison,
        modifiedPath,
        originalPath,
        exitCode,
        stderr,
      } as unknown as Error);
      return null;
    }

    return stdout.length > 0 ? stdout : null;
  }

  /**
   * Split a patch into its file-header block and its hunk blocks, preserving
   * every byte.
   *
   * Segments retain their `\n` terminator, so concatenating any subset of them
   * yields a well-formed patch. Splitting on `\n` and re-joining does NOT:
   * the terminator of every block except the last is silently dropped, and
   * `git apply` answers `corrupt patch at <stdin>:N`. That failure was
   * reproduced against real git before this helper was written.
   *
   * A trailing `\n` is added when absent so the invariant holds unconditionally.
   * This never changes meaning: "the file has no final newline" is carried by
   * the `\ No newline at end of file` marker line, not by the patch stream's
   * own termination.
   */
  private splitPatch(patch: string): { header: string; hunks: string[] } {
    const normalized = patch.endsWith('\n') ? patch : `${patch}\n`;
    const segments = normalized.match(/[^\n]*\n/g) ?? [];

    const header: string[] = [];
    const hunks: string[][] = [];
    let current: string[] | null = null;

    for (const segment of segments) {
      if (HUNK_HEADER_RE.test(segment)) {
        current = [segment];
        hunks.push(current);
      } else if (current) {
        // Body lines, and any `\ No newline at end of file` marker, belong to
        // the hunk they follow.
        current.push(segment);
      } else {
        header.push(segment);
      }
    }

    return {
      header: header.join(''),
      hunks: hunks.map((lines) => lines.join('')),
    };
  }

  /** Parse the `@@` headers of a patch. Positions only — never the bodies. */
  private parseHunkRefs(patch: string | null): GitHunkRef[] {
    if (patch === null) return [];

    return this.splitPatch(patch).hunks.map((block, index) => {
      const headerLine = block.slice(0, block.indexOf('\n'));
      const match = HUNK_HEADER_RE.exec(headerLine);
      // Unreachable: splitPatch only opens a block on a line this matches.
      /* istanbul ignore next */
      if (!match) {
        throw new Error(`Unparseable hunk header: ${headerLine}`);
      }
      return {
        index,
        originalStart: Number(match[1]),
        // git omits `,b` when the side spans exactly one line.
        originalLines: match[2] === undefined ? 1 : Number(match[2]),
        modifiedStart: Number(match[3]),
        modifiedLines: match[4] === undefined ? 1 : Number(match[4]),
        header: headerLine,
      };
    });
  }

  /**
   * Apply a selection of hunks from the diff the user is looking at.
   *
   * **git generates the patch and git consumes the patch.** Nothing here
   * composes diff text: the selected `@@` blocks are copied byte for byte out
   * of `git diff`'s own output, hunk headers included. Later hunks therefore
   * carry `+`-side start lines that are stale relative to a partially applied
   * file; that is correct and deliberate — `git apply` resolves them by
   * context, exactly as `git add -p` does. `--recount` and `--unidiff-zero`
   * are consequently NOT passed, and there is no line-ending code of our own:
   * `git diff` emits in index (LF) space and `git apply` converts back on the
   * way out, which is what makes this safe under `core.autocrlf`.
   *
   * | comparison | operation | apply invocation          |
   * | ---------- | --------- | ------------------------- |
   * | `worktree` | `stage`   | `git apply --cached -`    |
   * | `worktree` | `revert`  | `git apply -R -`          |
   * | `staged`   | `unstage` | `git apply --cached -R -` |
   *
   * Every refusal below happens before the user's selection is written, and
   * every failure path from the restore point onwards puts the pre-operation
   * state back (AC7) — including the pre-write offset guard, which is only
   * reachable when someone else wrote to the repository in the meantime.
   */
  async applyHunks(
    workspacePath: string,
    request: ApplyHunksRequest,
    fileSystem: WorktreeFileAccess,
  ): Promise<GitApplyHunksResult> {
    const modifiedPath = request.path;
    const originalPath = request.originalPath ?? request.path;
    const { comparison, operation } = request;

    try {
      // [NFR-8] Both paths, not just the modified one — a staged rename is
      // read and applied under its pre-rename path as well.
      this.validatePathSegment(modifiedPath);
      this.validatePathSegment(originalPath);

      // [AC12] The matrix is enforced here, not only in the Zod schema: the
      // schema can prove `operation` is one of three strings, but only this
      // check knows that `unstage` is meaningless against a worktree diff.
      if (!VALID_OPERATIONS[comparison].includes(operation)) {
        return this.applyFailure(
          'INVALID_OPERATION',
          `"${operation}" is not available for ${comparison} changes.`,
        );
      }

      if (!(await this.isGitRepo(workspacePath))) {
        return this.applyFailure(
          'NOT_A_REPO',
          'This folder is not a git repository.',
        );
      }

      // [AC6] The one guard this whole batch turns on.
      //
      // The snapshot is re-derived by calling `diffFile` — the very method
      // that issued the client's token — so there is no second hashing
      // implementation that could drift from the first and quietly certify a
      // stale diff. The client's token is compared, never trusted, and never
      // cached: two calls to `diffFile` a millisecond apart re-read git both
      // times.
      const before = await this.diffFile(
        workspacePath,
        {
          path: modifiedPath,
          comparison,
          originalPath: request.originalPath,
        },
        fileSystem,
      );

      if (before.snapshotToken !== request.snapshotToken) {
        this.logger.warn(
          '[GitInfoService] applyHunks refused a stale snapshot',
          {
            workspaceRoot: workspacePath,
            path: modifiedPath,
            comparison,
            operation,
            clientToken: request.snapshotToken,
            currentToken: before.snapshotToken,
          },
        );
        return this.applyFailure(
          'STALE_SNAPSHOT',
          'This file changed since the diff was opened. Nothing was changed — reload the diff and try again.',
        );
      }

      if (before.patch === null || before.hunks.length === 0) {
        // [AC10] Binary is the expected reason for a hunkless diff, but not
        // the only one: an untracked file produces no `git diff` output at
        // all, and calling that "binary" would be a user-visible lie.
        const isBinary =
          before.original.outcome === 'binary' ||
          before.modified.outcome === 'binary' ||
          (before.patch !== null && BINARY_PATCH_MARKER.test(before.patch));

        return isBinary
          ? this.applyFailure(
              'BINARY_UNSUPPORTED',
              'Binary files have no hunks to stage or revert.',
            )
          : this.applyFailure(
              'APPLY_FAILED',
              'git reports no applicable changes for this file.',
            );
      }

      const selection = this.normalizeHunkSelection(
        request.hunkIndices,
        before.hunks.length,
      );
      if (selection === null) {
        return this.applyFailure(
          'APPLY_FAILED',
          'The selected hunks are not part of this diff.',
        );
      }

      const { header, hunks } = this.splitPatch(before.patch);

      // A pathspec naming one file (or a rename's two names) yields exactly
      // one `diff --git` block. Anything else means the patch is not the shape
      // the reassembly assumes, so refuse rather than guess which block the
      // ordinals index into.
      const fileBlocks = header.match(/^diff --git /gm)?.length ?? 0;
      if (fileBlocks !== 1) {
        this.logger.error(
          '[GitInfoService] applyHunks got an unexpected patch shape',
          {
            workspaceRoot: workspacePath,
            path: modifiedPath,
            originalPath,
            comparison,
            fileBlocks,
          },
        );
        return this.applyFailure(
          'UNKNOWN',
          'This diff cannot be applied hunk by hunk.',
        );
      }

      // Ascending order is required by `git apply`, and `normalizeHunkSelection`
      // guarantees it.
      const patch = header + selection.map((index) => hunks[index]).join('');
      const applyArgs = this.applyArgsFor(operation);
      const worktreeFile = path.join(workspacePath, modifiedPath);

      // [AC7] Establish the restore point BEFORE the dry run, so there is no
      // ordering in which a write can happen without one.
      let indexRestoreTree: string | null = null;
      let worktreeRestoreBytes: Uint8Array | null = null;

      if (operation === 'revert') {
        if (!(await fileSystem.exists(worktreeFile))) {
          return this.applyFailure(
            'APPLY_FAILED',
            'This file is no longer in the working tree.',
          );
        }
        worktreeRestoreBytes = await fileSystem.readFileBytes(worktreeFile);
      } else {
        indexRestoreTree = await this.writeIndexTree(workspacePath);
        if (indexRestoreTree === null) {
          return this.applyFailure(
            'APPLY_FAILED',
            'Could not create a restore point for the index. Nothing was changed.',
          );
        }
      }

      // [AC7] Dry run first. `--verbose` is not cosmetic: it is the only mode
      // in which git reports the line offset a hunk matched at, and that
      // report is the next guard.
      const check = await this.execGit(
        [...applyArgs, '--check', '--verbose', '-'],
        workspacePath,
        { stdin: patch },
      );

      if (check.exitCode !== 0) {
        this.logger.error(
          '[GitInfoService] applyHunks --check refused the patch',
          {
            workspaceRoot: workspacePath,
            path: modifiedPath,
            comparison,
            operation,
            exitCode: check.exitCode,
            stderr: check.stderr,
          },
        );
        return this.applyFailure(
          'APPLY_FAILED',
          'git could not apply the selected changes. Nothing was changed.',
        );
      }

      // The catastrophic case this batch exists to prevent is not a patch that
      // FAILS to apply — it is one that applies cleanly at a shifted offset,
      // moving lines the user never looked at. `--check` alone returns 0 for
      // exactly that case (reproduced against git 2.54.0). With the snapshot
      // token verified above, a non-zero offset is impossible; if one appears
      // anyway, an invariant has broken and the only safe move is to refuse
      // before writing the user's selection.
      //
      // `--check` is a dry run, so *this service* has written nothing — but the
      // only way to reach here is an external write landing between the token
      // match and the dry run, and that write is still on disk. Restoring is
      // what makes the message below true about the FILE and not merely about
      // our own actions; guard 3 below has always done the same.
      const checkOffsets = this.parseApplyOffsets(check.stderr);
      if (checkOffsets.some((offset) => offset !== 0)) {
        const restored = await this.restoreAfterFailedApply(
          workspacePath,
          worktreeFile,
          indexRestoreTree,
          worktreeRestoreBytes,
          fileSystem,
        );
        this.logger.error(
          '[GitInfoService] applyHunks refused an offset match',
          {
            workspaceRoot: workspacePath,
            path: modifiedPath,
            comparison,
            operation,
            offsets: checkOffsets,
            stderr: check.stderr,
            restored,
          },
        );
        return this.applyFailure(
          'APPLY_FAILED',
          restored
            ? 'The selected changes no longer line up with this file. The previous state was restored.'
            : 'The selected changes no longer line up with this file, and restoring the previous state also failed. Check the repository before continuing.',
        );
      }

      const applied = await this.execGit(
        [...applyArgs, '--verbose', '-'],
        workspacePath,
        { stdin: patch },
      );

      if (applied.exitCode !== 0) {
        const restored = await this.restoreAfterFailedApply(
          workspacePath,
          worktreeFile,
          indexRestoreTree,
          worktreeRestoreBytes,
          fileSystem,
        );
        this.logger.error(
          '[GitInfoService] applyHunks failed after --check passed',
          {
            workspaceRoot: workspacePath,
            path: modifiedPath,
            comparison,
            operation,
            exitCode: applied.exitCode,
            stderr: applied.stderr,
            restored,
          },
        );
        return this.applyFailure(
          'APPLY_FAILED',
          restored
            ? 'git could not apply the selected changes. The file was restored to its previous state.'
            : 'git could not apply the selected changes, and restoring the previous state also failed. Check the repository before continuing.',
        );
      }

      // The dry run inspected the pre-image a moment ago; this re-checks the
      // one it was actually written against. An offset appearing only here
      // means the repository moved between the two invocations, so the write
      // landed somewhere the user never saw — undo it.
      const appliedOffsets = this.parseApplyOffsets(applied.stderr);
      if (appliedOffsets.some((offset) => offset !== 0)) {
        const restored = await this.restoreAfterFailedApply(
          workspacePath,
          worktreeFile,
          indexRestoreTree,
          worktreeRestoreBytes,
          fileSystem,
        );
        this.logger.error(
          '[GitInfoService] applyHunks rolled back an offset apply',
          {
            workspaceRoot: workspacePath,
            path: modifiedPath,
            comparison,
            operation,
            offsets: appliedOffsets,
            stderr: applied.stderr,
            restored,
          },
        );
        return this.applyFailure(
          'APPLY_FAILED',
          restored
            ? 'The selected changes no longer line up with this file. The previous state was restored.'
            : 'The selected changes no longer line up with this file, and restoring the previous state also failed. Check the repository before continuing.',
        );
      }

      const after = await this.diffFile(
        workspacePath,
        {
          path: modifiedPath,
          comparison,
          originalPath: request.originalPath,
        },
        fileSystem,
      );

      // [R-1] Enough to reconstruct exactly what was applied, to which
      // snapshot, and what git said about it.
      this.logger.info('[GitInfoService] applyHunks applied', {
        workspaceRoot: workspacePath,
        path: modifiedPath,
        originalPath,
        comparison,
        operation,
        hunkIndices: selection,
        hunkCount: before.hunks.length,
        snapshotToken: request.snapshotToken,
        nextSnapshotToken: after.snapshotToken,
        patchSha256: createHash('sha256').update(patch, 'utf8').digest('hex'),
        patchByteLength: Buffer.byteLength(patch, 'utf8'),
        exitCode: applied.exitCode,
        offsets: appliedOffsets,
        stderr: applied.stderr,
      });

      return { success: true, snapshotToken: after.snapshotToken };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[GitInfoService] applyHunks threw', {
        workspaceRoot: workspacePath,
        path: modifiedPath,
        originalPath,
        comparison,
        operation,
        error: message,
      });
      return this.applyFailure(
        'UNKNOWN',
        'The selected changes could not be applied.',
      );
    }
  }

  /** A refusal. Never carries a snapshot token — see {@link GitApplyHunksResult}. */
  private applyFailure(
    code: GitApplyHunksFailure,
    message: string,
  ): GitApplyHunksResult {
    return { success: false, code, message };
  }

  /** The `git apply` invocation for one cell of the operation matrix. */
  private applyArgsFor(operation: GitApplyHunksOperation): string[] {
    switch (operation) {
      case 'stage':
        return ['apply', '--cached'];
      case 'unstage':
        return ['apply', '--cached', '-R'];
      case 'revert':
        return ['apply', '-R'];
    }
  }

  /**
   * De-duplicate and order a hunk selection, or reject it.
   *
   * Ascending order is a hard requirement of `git apply`, not a tidiness
   * preference. An out-of-range ordinal cannot occur once the snapshot token
   * has matched — the patch is provably the same one the client indexed — so
   * it is treated as an incoherent request and refused.
   */
  private normalizeHunkSelection(
    indices: number[],
    total: number,
  ): number[] | null {
    if (indices.length === 0) return null;
    const unique = [...new Set(indices)];
    if (
      unique.some(
        (index) => !Number.isInteger(index) || index < 0 || index >= total,
      )
    ) {
      return null;
    }
    return unique.sort((a, b) => a - b);
  }

  /**
   * Capture the current index as a tree object, for use as a rollback target.
   *
   * `git write-tree` writes tree objects only — it never moves a ref, never
   * touches the working tree, and fails outright on an unmerged index, which
   * is the case where a rollback could not be honoured anyway.
   */
  private async writeIndexTree(workspacePath: string): Promise<string | null> {
    const { stdout, stderr, exitCode } = await this.execGit(
      ['write-tree'],
      workspacePath,
    );

    if (exitCode !== 0) {
      this.logger.error('[GitInfoService] write-tree failed', {
        workspacePath,
        exitCode,
        stderr,
      });
      return null;
    }

    const tree = stdout.trim();
    return /^[0-9a-f]{40,64}$/.test(tree) ? tree : null;
  }

  /** Restore the pre-operation state after a write that failed mid-flight. */
  private async restoreAfterFailedApply(
    workspacePath: string,
    worktreeFile: string,
    indexRestoreTree: string | null,
    worktreeRestoreBytes: Uint8Array | null,
    fileSystem: WorktreeFileAccess,
  ): Promise<boolean> {
    try {
      if (indexRestoreTree !== null) {
        const { exitCode, stderr } = await this.execGit(
          ['read-tree', indexRestoreTree],
          workspacePath,
        );
        if (exitCode !== 0) {
          this.logger.error('[GitInfoService] index rollback failed', {
            workspacePath,
            tree: indexRestoreTree,
            exitCode,
            stderr,
          });
          return false;
        }
        return true;
      }

      if (worktreeRestoreBytes !== null) {
        await fileSystem.writeFileBytes(worktreeFile, worktreeRestoreBytes);
        return true;
      }

      return false;
    } catch (error: unknown) {
      this.logger.error('[GitInfoService] rollback threw', {
        workspacePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Every line offset `git apply --verbose` reported, in order.
   *
   * Plain `git apply` says nothing about offsets, so a forensic log that never
   * passes `--verbose` records an empty list forever and proves nothing.
   */
  private parseApplyOffsets(stderr: string): number[] {
    return [...stderr.matchAll(APPLY_OFFSET_RE)].map((match) =>
      Number(match[1]),
    );
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
    // An untracked *directory* row is clickable in Source Control, and its
    // worktree side reads the directory itself. Node answers `EISDIR`; the VS
    // Code file-system port answers `FileIsADirectory` for the same thing.
    // Without this the row reports only that the read failed, never why.
    if (code === 'EISDIR' || code === 'FileIsADirectory') {
      return 'is-a-directory';
    }
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
   * sha256 over the exact content of both sides, their ref identity, and the
   * patch bytes derived from them.
   *
   * Every component is length-prefixed so no combination of paths or content
   * can be rearranged into the same digest. Opaque to the client; it exists so
   * a later write can prove it applies to the snapshot the user was shown.
   *
   * **There is exactly one implementation and it has exactly two call sites,
   * both inside {@link diffFile}.** `applyHunks` establishes its "is this
   * still the snapshot the user saw?" answer by calling `diffFile` itself, not
   * by recomputing the digest alongside it — so the two can never drift, which
   * is the failure that would silently defeat AC6.
   *
   * The patch field is what closes the residual window between reading the two
   * sides and asking git for the diff: without it a token could certify blobs
   * from time T while the patch was generated at T+delta, and a write landing
   * in that gap would be applied from bytes the user never saw.
   */
  private computeSnapshotToken(input: {
    comparison: GitDiffComparison;
    path: string;
    originalPath: string;
    originalRef: DiffSideRef;
    modifiedRef: DiffSideRef;
    original: GitBlobRead;
    modified: GitBlobRead;
    patch: string | null;
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
    field(input.patch === null ? 'patch:absent' : `patch:${input.patch}`);

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
   * **One `for-each-ref` invocation, whatever the branch count.** Local and
   * remote refs are listed by the same command (told apart by `%(refname)`,
   * not by which command produced them), the current branch comes from
   * `%(HEAD)`, and ahead/behind come from `%(upstream:track)`.
   *
   * This replaced a per-branch `git rev-list --left-right --count` fan-out
   * (TASK_2026_343). The old code carried `%09%09` where it meant to carry
   * `%(ahead-behind:upstream)`, so that field was ALWAYS empty and every
   * upstream-tracking branch took the fallback — sequentially. Measured in
   * this repository (156 local branches, 113 with an upstream), 20 of those
   * spawns cost 4.1 s against 0.29 s for the single `for-each-ref` that now
   * replaces all of them.
   *
   * **`%(ahead-behind:upstream)` is deliberately NOT used.** Verified against
   * git 2.54: if any ref in the result set lacks an upstream, git aborts the
   * whole command with `fatal: failed to find 'upstream'`, and wrapping it in
   * `%(if)%(upstream)%(then)…%(end)` does not help because the atom resolves
   * before the conditional. `%(upstream:track)` is empty rather than fatal for
   * an untracked branch, and `exec-git` pins `LC_ALL=C` so its wording is
   * stable.
   *
   * Results are cached per `(workspacePath, includeRemote)` until
   * {@link invalidateReadCache} fires; concurrent identical calls share one
   * invocation.
   */
  async getBranches(
    workspacePath: string,
    includeRemote = false,
  ): Promise<GitBranchesResult> {
    return this.cachedRead(
      `branches|${workspacePath}|${includeRemote ? 'remote' : 'local'}`,
      () => this.computeBranches(workspacePath, includeRemote),
    );
  }

  /**
   * Tab-separated `for-each-ref` fields, in order.
   *
   * `%(HEAD)` is placed in the INTERIOR on purpose: it renders as a single
   * space for every non-current ref, and a leading or trailing space would be
   * eaten by the per-line `trim()`, silently shifting every field.
   */
  private static readonly BRANCH_REF_FORMAT = [
    '%(refname)',
    '%(refname:short)',
    '%(HEAD)',
    '%(objectname:short)',
    '%(upstream:short)',
    '%(upstream:track)',
    '%(creatordate:unix)',
  ].join('%09');

  private async computeBranches(
    workspacePath: string,
    includeRemote: boolean,
  ): Promise<GitBranchesResult> {
    const empty: GitBranchesResult = { current: '', local: [], remote: [] };
    try {
      const patterns = includeRemote
        ? ['refs/heads/', 'refs/remotes/']
        : ['refs/heads/'];
      const { stdout, exitCode } = await this.execGit(
        [
          'for-each-ref',
          `--format=${GitInfoService.BRANCH_REF_FORMAT}`,
          ...patterns,
        ],
        workspacePath,
      );

      if (exitCode !== 0) {
        return empty;
      }

      const local: BranchRef[] = [];
      const remote: BranchRef[] = [];
      let current = '';

      for (const line of stdout.split('\n')) {
        const parsed = this.parseBranchRefLine(line);
        if (!parsed) continue;
        if (parsed.isRemote) {
          remote.push(parsed);
        } else {
          local.push(parsed);
          if (parsed.isCurrent) current = parsed.name;
        }
      }

      // No ref carries `*` on an unborn branch (nothing to list yet) or a
      // detached HEAD. `symbolic-ref` answers the first and exits non-zero on
      // the second, which is the correct empty answer either way. One extra
      // spawn, only in those two states.
      if (!current) {
        const { stdout: symRefOut, exitCode: symRefCode } = await this.execGit(
          ['symbolic-ref', '--short', 'HEAD'],
          workspacePath,
        );
        if (symRefCode === 0) current = symRefOut.trim();
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
   * Parse one {@link GitInfoService.BRANCH_REF_FORMAT} line into a `BranchRef`.
   *
   * Local vs remote is decided by the FULL `%(refname)`, never by the short
   * name: a local branch may legitimately be called `origin/foo`, whose short
   * form is indistinguishable from a remote-tracking ref.
   */
  private parseBranchRefLine(line: string): BranchRef | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    const parts = trimmed.split('\t');
    const fullRef = parts[0] ?? '';
    const name = parts[1] ?? '';
    const headMarker = parts[2] ?? '';
    const lastCommitHash = parts[3] ?? '';
    const upstream = parts[4] ?? '';
    const trackRaw = parts[5] ?? '';
    const creatorDateRaw = parts[6] ?? '';

    if (!name) return null;

    const isRemote = fullRef.startsWith('refs/remotes/');
    // `refs/remotes/<remote>/HEAD` is a symref onto the remote's default
    // branch, not a branch of its own.
    if (isRemote && name.endsWith('/HEAD')) return null;

    const { ahead, behind } = parseUpstreamTrack(trackRaw);

    const lastCommitTime = creatorDateRaw
      ? parseInt(creatorDateRaw, 10) * 1000
      : undefined;

    const ref: BranchRef = {
      name,
      isCurrent: !isRemote && headMarker === '*',
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
    return this.cachedRead(`stash|${workspacePath}|`, () =>
      this.computeStashList(workspacePath),
    );
  }

  private async computeStashList(
    workspacePath: string,
  ): Promise<GitStashListResult> {
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
    return this.cachedRead(`tags|${workspacePath}|${limit}`, () =>
      this.computeTags(workspacePath, limit),
    );
  }

  private async computeTags(
    workspacePath: string,
    limit: number,
  ): Promise<GitTagsResult> {
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
    return this.cachedRead(`remotes|${workspacePath}|`, () =>
      this.computeRemotes(workspacePath),
    );
  }

  private async computeRemotes(
    workspacePath: string,
  ): Promise<GitRemotesResult> {
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
    return this.cachedRead(`lastCommit|${workspacePath}|${ref}`, () =>
      this.computeLastCommit(workspacePath, ref),
    );
  }

  private async computeLastCommit(
    workspacePath: string,
    ref: string,
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

  /**
   * The one place this service spawns git for text output — and therefore the
   * one place cache invalidation has to live.
   *
   * Deriving "did that change the repository?" from the argv, rather than
   * asking each mutating method to remember to invalidate, is what keeps a
   * future method from silently serving a stale branch list: a new call site
   * gets the behaviour by construction. See {@link isMutatingGitCommand}.
   */
  private async execGit(
    args: string[],
    cwd: string,
    options?: ExecGitOptions,
  ): Promise<ExecGitResult> {
    const result = await execGit(args, cwd, options);
    if (isMutatingGitCommand(args)) this.invalidateReadCache(cwd);
    return result;
  }

  private async execGitBuffer(
    args: string[],
    cwd: string,
    options?: ExecGitOptions,
  ): Promise<ExecGitBufferResult> {
    const result = await execGitBuffer(args, cwd, options);
    if (isMutatingGitCommand(args)) this.invalidateReadCache(cwd);
    return result;
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
