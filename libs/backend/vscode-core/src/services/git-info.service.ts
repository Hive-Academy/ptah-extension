/**
 * Git Info Service
 *
 * Encapsulates all git CLI interactions for the Electron main process.
 * Uses cross-spawn for Windows compatibility. Zero new dependencies.
 */

import crossSpawn from 'cross-spawn';
import * as path from 'path';
import type { Logger } from '../logging';
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
} from '@ptah-extension/shared';

const GIT_TIMEOUT_MS = 10_000;

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

      const { exitCode, stderr } = await this.execGit(args, workspacePath);

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

      const { exitCode, stderr } = await this.execGit(args, workspacePath);

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

  // ==========================================================================
  // Source Control Operations
  // ==========================================================================

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

      // Separate tracked from untracked files by checking git status
      const { stdout: statusOutput } = await this.execGit(
        ['status', '--porcelain', '--', ...paths],
        workspacePath,
      );

      const untrackedPaths: string[] = [];
      const trackedPaths: string[] = [];

      for (const line of statusOutput.split('\n')) {
        if (!line.trim()) continue;
        // Untracked files start with '?? '
        if (line.startsWith('?? ')) {
          untrackedPaths.push(line.substring(3).trim());
        } else {
          // Extract the file path from the status line (skip 3-char status prefix)
          trackedPaths.push(line.substring(3).trim());
        }
      }

      // Discard tracked file changes
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

      // Remove untracked files
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

      // Parse commit hash from output like "[branch abc1234] commit message"
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
        // File doesn't exist in HEAD (new/untracked file) — return empty content
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
      // Gracefully return empty content on any failure
      return { content: '' };
    }
  }

  // ==========================================================================
  // PATH VALIDATION
  // ==========================================================================

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

    // Prevent path traversal: reject paths containing '..' segments
    const normalized = filePath.replace(/\\/g, '/');
    const segments = normalized.split('/');
    if (segments.some((s) => s === '..')) {
      throw new Error(
        `Path traversal detected: "${filePath}" contains '..' segments`,
      );
    }
  }

  // ==========================================================================
  // Branch, Checkout, Stash, Tag, Remote, Last-Commit
  // ==========================================================================

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
      // Detect the current branch (allow failure for detached HEAD)
      let current = '';
      try {
        const { stdout: symRefOut, exitCode: symRefCode } = await this.execGit(
          ['symbolic-ref', '--short', 'HEAD'],
          workspacePath,
        );
        if (symRefCode === 0) {
          current = symRefOut.trim();
        }
      } catch {
        // Detached HEAD — leave current as ''
      }

      // git for-each-ref format: refname TAB objectname:short TAB upstream:short TAB ahead-behind:upstream TAB objectname:short (commit time) TAB creatordate:unix
      const fmt =
        '%(refname:short)%09%(objectname:short)%09%(upstream:short)%09%(ahead-behind:upstream)%09%(creatordate:unix)';

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
            // Skip remote HEAD aliases (e.g. origin/HEAD)
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

      // Mark the currently checked-out branch in the local list.
      // `current` is the short branch name from symbolic-ref; detached HEAD
      // leaves it as '' so no branch matches and all stay false (correct).
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
        // Format: "N N" (ahead behind) — requires git >= 2.31
        const [aheadStr, behindStr] = aheadBehindRaw.split(' ');
        const parsedAhead = parseInt(aheadStr ?? '0', 10);
        const parsedBehind = parseInt(behindStr ?? '0', 10);
        if (!isNaN(parsedAhead)) ahead = parsedAhead;
        if (!isNaN(parsedBehind)) behind = parsedBehind;
      } else {
        // Fallback for git < 2.31: rev-list --left-right --count <upstream>...HEAD
        try {
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
        } catch {
          // Fallback failed — keep 0/0
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
      // Extract remote name: "origin/main" → remote = "origin"
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

        // Extract index from stash@{N}
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

        // Annotated tags: the dereferenced hash (*objectname) is non-empty and different
        const annotated = derefHash !== '' && derefHash !== objectHash;
        // For annotated tags, use the dereferenced (commit) hash; else use objectname
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

        // Format: "name<TAB>url (fetch|push)"
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

    // Reject refs that look like git flags or contain path-traversal segments.
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

      // Split on newlines — fields are in fixed positions; body is everything after line 6
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

  // ==========================================================================
  // REPOSITORY CHECKS
  // ==========================================================================

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
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const child = crossSpawn('git', args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill('SIGTERM');
          reject(
            new Error(`git ${args[0]} timed out after ${GIT_TIMEOUT_MS}ms`),
          );
        }
      }, GIT_TIMEOUT_MS);

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code: number | null) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve({ stdout, stderr, exitCode: code ?? 1 });
        }
      });

      child.on('error', (error: Error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(error);
        }
      });
    });
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
        // Ordinary changed entry: 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
        // 8 space-separated fields before the path. The path may contain spaces,
        // so we must use fixed-index slicing instead of taking the last field.
        const xy = line.substring(2, 4);
        const indexStatus = xy[0];
        const worktreeStatus = xy[1];

        const parts = line.split(' ');
        const filePath = parts.slice(8).join(' ');

        // Emit staged entry if index has a change
        if (indexStatus !== '.') {
          files.push({
            path: filePath,
            status: this.mapStatusCode(indexStatus),
            staged: true,
          });
        }

        // Emit unstaged entry if worktree has a change
        if (worktreeStatus !== '.') {
          files.push({
            path: filePath,
            status: this.mapStatusCode(worktreeStatus),
            staged: false,
          });
        }
      } else if (line.startsWith('2 ')) {
        // Rename/copy entry: 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\t<origPath>
        // The path and origPath are tab-separated. Before the tab, there are 9
        // space-separated fields before the path (fields 0-8, path starts at index 9).
        const xy = line.substring(2, 4);
        const indexStatus = xy[0];
        const worktreeStatus = xy[1];

        const tabIndex = line.indexOf('\t');
        const beforeTab = tabIndex >= 0 ? line.substring(0, tabIndex) : line;
        const beforeTabParts = beforeTab.split(' ');
        const filePath = beforeTabParts.slice(9).join(' ');

        // Emit staged entry if index has a change
        if (indexStatus !== '.') {
          files.push({
            path: filePath,
            status: this.mapStatusCode(indexStatus),
            staged: true,
          });
        }

        // Emit unstaged entry if worktree has a change
        if (worktreeStatus !== '.') {
          files.push({
            path: filePath,
            status: this.mapStatusCode(worktreeStatus),
            staged: false,
          });
        }
      } else if (line.startsWith('u ')) {
        // Unmerged entry: u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
        // 10 space-separated fields before the path. The path may contain spaces.
        const parts = line.split(' ');
        const filePath = parts.slice(10).join(' ');
        files.push({ path: filePath, status: 'M', staged: false });
      } else if (line.startsWith('? ')) {
        // Untracked entry — directories have a trailing '/'
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
