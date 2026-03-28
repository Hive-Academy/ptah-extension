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
import type {
  GitBranchInfo,
  GitFileStatus,
  GitInfoResult,
  GitWorktreeInfo,
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

      return this.parseWorktreeList(stdout);
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
        // Untracked entry
        const filePath = line.substring(2);
        files.push({ path: filePath, status: '??', staged: false });
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

  /**
   * Parse git worktree list --porcelain output.
   *
   * Format (blocks separated by blank lines):
   *   worktree <path>
   *   HEAD <sha>
   *   branch refs/heads/<name>
   *   [bare]
   */
  private parseWorktreeList(output: string): GitWorktreeInfo[] {
    const worktrees: GitWorktreeInfo[] = [];
    const blocks = output.trim().split('\n\n');

    for (const block of blocks) {
      if (!block.trim()) continue;

      const lines = block.trim().split('\n');
      let wtPath = '';
      let head = '';
      let branch = '';
      let isBare = false;

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          wtPath = line.substring('worktree '.length);
        } else if (line.startsWith('HEAD ')) {
          head = line.substring('HEAD '.length).substring(0, 8);
        } else if (line.startsWith('branch ')) {
          const ref = line.substring('branch '.length);
          // Strip refs/heads/ prefix
          branch = ref.startsWith('refs/heads/')
            ? ref.substring('refs/heads/'.length)
            : ref;
        } else if (line.trim() === 'bare') {
          isBare = true;
        } else if (line.trim() === 'detached') {
          branch = 'HEAD (detached)';
        }
      }

      if (wtPath) {
        worktrees.push({
          path: wtPath,
          head,
          branch: branch || 'HEAD',
          isMain: worktrees.length === 0,
          isBare,
        });
      }
    }

    return worktrees;
  }
}
