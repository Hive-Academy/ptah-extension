/**
 * Git Info Service
 *
 * Encapsulates all git CLI interactions for the Electron main process.
 * Uses cross-spawn for Windows compatibility. Zero new dependencies.
 *
 * TASK_2025_227: Git info bar + worktree management
 */

import crossSpawn from 'cross-spawn';
import * as path from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
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
  // Source Control Operations (TASK_2025_273)
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
