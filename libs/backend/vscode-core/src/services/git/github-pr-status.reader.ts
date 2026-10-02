import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import type { ChildProcess } from 'node:child_process';
import crossSpawn from 'cross-spawn';
import {
  killProcessTree,
  type IProcessSpawner,
  type SpawnedProcessHandle,
} from '@ptah-extension/platform-core';
import type {
  GitPrChecksSummary,
  GitPrInfo,
  GitPrStatusResult,
} from '@ptah-extension/shared';
import type { Logger } from '../../logging';
import { assertSafeRef } from './git-ref-guard';

export const DEFAULT_GH_PR_TIMEOUT_MS = 15_000;
export const DEFAULT_GH_PR_CACHE_TTL_MS = 60_000;

export const GH_PR_VIEW_JSON_FIELDS = [
  'number',
  'title',
  'url',
  'state',
  'isDraft',
  'statusCheckRollup',
  'reviewDecision',
  'headRefName',
].join(',');

export const GH_NON_INTERACTIVE_ENV: NodeJS.ProcessEnv = {
  GH_PROMPT_DISABLED: '1',
  GH_NO_UPDATE_NOTIFIER: '1',
  NO_COLOR: '1',
  GIT_TERMINAL_PROMPT: '0',
  GH_PAGER: 'cat',
};

export interface GitHubPrStatusReaderDeps {
  readonly spawner?: IProcessSpawner;
  readonly logger?: Logger;
  readonly timeoutMs?: number;
  readonly cacheTtlMs?: number;
  readonly now?: () => number;
}

interface CacheEntry {
  readonly expiresAt: number;
  readonly result: GitPrStatusResult;
}

function repoKey(workspacePath: string): string {
  return workspacePath.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
}

export function sanitizePrUrl(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') {
      return url;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

interface RawCheckItem {
  readonly conclusion?: unknown;
  readonly status?: unknown;
  readonly state?: unknown;
}

interface RawPrPayload {
  readonly number?: unknown;
  readonly title?: unknown;
  readonly state?: unknown;
  readonly isDraft?: unknown;
  readonly reviewDecision?: unknown;
  readonly url?: unknown;
  readonly headRefName?: unknown;
  readonly statusCheckRollup?: unknown;
}

export function summarizeStatusCheckRollup(
  rollup: unknown,
): GitPrChecksSummary {
  if (!Array.isArray(rollup)) {
    return { passing: 0, failing: 0, pending: 0, total: 0 };
  }
  let passing = 0;
  let failing = 0;
  let pending = 0;

  for (const item of rollup) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as RawCheckItem;
    const conclusion =
      typeof raw.conclusion === 'string' ? raw.conclusion.toUpperCase() : '';
    const status =
      typeof raw.status === 'string' ? raw.status.toUpperCase() : '';
    const state = typeof raw.state === 'string' ? raw.state.toUpperCase() : '';

    if (
      conclusion === 'FAILURE' ||
      conclusion === 'TIMED_OUT' ||
      conclusion === 'ACTION_REQUIRED' ||
      conclusion === 'STARTUP_FAILURE' ||
      conclusion === 'CANCELLED' ||
      state === 'FAILURE' ||
      state === 'ERROR'
    ) {
      failing += 1;
    } else if (
      conclusion === 'SUCCESS' ||
      conclusion === 'NEUTRAL' ||
      conclusion === 'SKIPPED' ||
      state === 'SUCCESS'
    ) {
      passing += 1;
    } else if (
      status === 'IN_PROGRESS' ||
      status === 'QUEUED' ||
      status === 'PENDING' ||
      status === 'WAITING' ||
      state === 'PENDING' ||
      state === 'EXPECTED' ||
      (!conclusion && status !== 'COMPLETED')
    ) {
      pending += 1;
    }
  }

  return { passing, failing, pending, total: passing + failing + pending };
}

export class GitHubPrStatusReader {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly deps: GitHubPrStatusReaderDeps = {}) {}

  async read(
    workspaceRoot: string,
    branch: string,
  ): Promise<GitPrStatusResult> {
    assertSafeRef(branch);

    const now = (this.deps.now ?? Date.now)();
    const cacheKey = `${repoKey(workspaceRoot)}::${branch}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.result;
    }

    const result = await this.fetchStatus(workspaceRoot, branch);

    if (
      result.status === 'ok' ||
      (result.status === 'unavailable' && result.reason === 'no-pr')
    ) {
      const ttl = this.deps.cacheTtlMs ?? DEFAULT_GH_PR_CACHE_TTL_MS;
      this.cache.set(cacheKey, { expiresAt: now + ttl, result });
    }

    return result;
  }

  /**
   * Drop cached results so the next read asks `gh` again: every branch of
   * `workspaceRoot`, or the whole cache when it is omitted. A push changes
   * the checks GitHub reports, so a cached `ok` would show pre-push checks.
   */
  invalidate(workspaceRoot?: string): void {
    if (workspaceRoot === undefined) {
      this.cache.clear();
      return;
    }
    const prefix = `${repoKey(workspaceRoot)}::`;
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  private fetchStatus(
    workspaceRoot: string,
    branch: string,
  ): Promise<GitPrStatusResult> {
    return new Promise((resolve) => {
      let settled = false;
      let timedOut = false;
      const timeoutMs = this.deps.timeoutMs ?? DEFAULT_GH_PR_TIMEOUT_MS;

      const timerRef: { current?: ReturnType<typeof setTimeout> } = {};

      const settle = (result: GitPrStatusResult): void => {
        if (settled) return;
        settled = true;
        if (timerRef.current) clearTimeout(timerRef.current);
        resolve(result);
      };

      const args = [
        'pr',
        'view',
        '--json',
        GH_PR_VIEW_JSON_FIELDS,
        '--',
        branch,
      ];
      const env = { ...process.env, ...GH_NON_INTERACTIVE_ENV };

      let handle: SpawnedProcessHandle | ChildProcess;
      try {
        if (this.deps.spawner) {
          handle = this.deps.spawner.spawnProcess({
            command: 'gh',
            args,
            cwd: workspaceRoot,
            env,
          });
        } else {
          handle = crossSpawn('gh', args, {
            cwd: workspaceRoot,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
        }
      } catch (error: unknown) {
        this.deps.logger?.debug?.('[GitHubPrStatusReader] Failed to spawn gh', {
          error,
        });
        const err = error as { code?: string; message?: string };
        if (err?.code === 'ENOENT' || err?.message?.includes('ENOENT')) {
          settle({ status: 'unavailable', reason: 'gh-missing' });
        } else {
          settle({ status: 'unavailable', reason: 'failed' });
        }
        return;
      }

      const getPid = async (): Promise<number | undefined> => {
        if (handle.pid) return handle.pid;
        if ('whenSpawned' in handle && handle.whenSpawned) {
          try {
            const pid = await handle.whenSpawned;
            return pid ?? undefined;
          } catch {
            return undefined;
          }
        }
        return undefined;
      };

      const terminate = (): void => {
        try {
          handle.kill('SIGTERM');
        } catch {
          // Process might already be dead
        }
        void getPid().then((pid) => {
          if (pid !== undefined) {
            void killProcessTree(pid).catch(() => undefined);
          }
        });
      };

      timerRef.current = setTimeout(() => {
        timedOut = true;
        this.deps.logger?.debug?.(
          '[GitHubPrStatusReader] gh pr view timed out',
          {
            workspaceRoot,
            branch,
            timeoutMs,
          },
        );
        terminate();
        const forceTimer = setTimeout(() => {
          settle({ status: 'unavailable', reason: 'timeout' });
        }, 1000);
        forceTimer.unref?.();
      }, timeoutMs);
      timerRef.current.unref?.();

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      handle.stdout?.on('data', (chunk: Buffer | string) => {
        stdoutChunks.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8'),
        );
      });

      handle.stderr?.on('data', (chunk: Buffer | string) => {
        stderrChunks.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8'),
        );
      });

      handle.on('error', (error: Error & { code?: string }) => {
        this.deps.logger?.debug?.('[GitHubPrStatusReader] Process error', {
          error: error.message,
        });
        if (error.code === 'ENOENT' || error.message?.includes('ENOENT')) {
          settle({ status: 'unavailable', reason: 'gh-missing' });
        } else {
          settle({ status: 'unavailable', reason: 'failed' });
        }
      });

      handle.on('close', (code: number | null) => {
        if (timedOut) {
          settle({ status: 'unavailable', reason: 'timeout' });
          return;
        }

        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        const stderr = Buffer.concat(stderrChunks).toString('utf8');

        if (code !== 0) {
          this.deps.logger?.debug?.('[GitHubPrStatusReader] gh exit non-zero', {
            code,
            stderr: stderr.trim(),
          });
          if (/(?:gh auth login|not logged in)/i.test(stderr)) {
            settle({ status: 'unavailable', reason: 'not-authenticated' });
            return;
          }
          if (/no pull requests found/i.test(stderr)) {
            settle({ status: 'unavailable', reason: 'no-pr' });
            return;
          }
          const lowerStderr = stderr.toLowerCase();
          if (
            lowerStderr.includes('none of the git remotes') &&
            lowerStderr.includes('github host')
          ) {
            settle({ status: 'unavailable', reason: 'not-github' });
            return;
          }
          if (
            /gh: command not found|is not recognized as an internal or external command/i.test(
              stderr,
            )
          ) {
            settle({ status: 'unavailable', reason: 'gh-missing' });
            return;
          }
          settle({ status: 'unavailable', reason: 'failed' });
          return;
        }

        try {
          const data = JSON.parse(stdout);
          if (!data || typeof data !== 'object') {
            settle({ status: 'unavailable', reason: 'failed' });
            return;
          }
          const raw = data as RawPrPayload;
          const url = sanitizePrUrl(raw.url);
          const pr: GitPrInfo = {
            number: typeof raw.number === 'number' ? raw.number : 0,
            title: typeof raw.title === 'string' ? raw.title : '',
            state: typeof raw.state === 'string' ? raw.state : 'OPEN',
            isDraft: Boolean(raw.isDraft),
            ...(raw.reviewDecision !== undefined
              ? {
                  reviewDecision:
                    raw.reviewDecision === null
                      ? null
                      : String(raw.reviewDecision),
                }
              : {}),
            ...(url ? { url } : {}),
            ...(typeof raw.headRefName === 'string'
              ? { headRefName: raw.headRefName }
              : {}),
          };
          const checks = summarizeStatusCheckRollup(raw.statusCheckRollup);
          settle({ status: 'ok', pr, checks });
        } catch {
          this.deps.logger?.debug?.(
            '[GitHubPrStatusReader] Malformed JSON from gh pr view',
            {
              stdout,
            },
          );
          settle({ status: 'unavailable', reason: 'failed' });
        }
      });
    });
  }
}
