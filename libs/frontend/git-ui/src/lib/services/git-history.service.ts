import { Injectable, inject } from '@angular/core';
import { rpcCall, VSCodeService } from '@ptah-extension/core';
import type { GitHistoryCommit, GitLogResult } from '@ptah-extension/shared';

const LOG_FAILED: GitLogResult = {
  status: 'unavailable',
  reason: 'git-failed',
};

function isCommit(value: unknown): value is GitHistoryCommit {
  if (typeof value !== 'object' || value === null) return false;
  const commit = value as Record<string, unknown>;
  return (
    typeof commit['sha'] === 'string' &&
    typeof commit['shortSha'] === 'string' &&
    typeof commit['subject'] === 'string' &&
    typeof commit['authorName'] === 'string' &&
    typeof commit['authorDate'] === 'string' &&
    typeof commit['parentCount'] === 'number' &&
    typeof commit['isRoot'] === 'boolean'
  );
}

/**
 * Narrow a `git:log` payload to the contract. Anything that does not match is
 * a failed read, never a partial list: the timeline shows Retry instead.
 */
function toLogResult(data: unknown): GitLogResult {
  if (typeof data !== 'object' || data === null) return LOG_FAILED;
  const result = data as Record<string, unknown>;
  if (result['status'] === 'unavailable') {
    return result['reason'] === 'not-a-repository'
      ? { status: 'unavailable', reason: 'not-a-repository' }
      : LOG_FAILED;
  }
  const mode = result['mode'];
  const commits = result['commits'];
  if (
    result['status'] !== 'ok' ||
    (mode !== 'since-base' && mode !== 'recent') ||
    !Array.isArray(commits) ||
    !commits.every(isCommit)
  ) {
    return LOG_FAILED;
  }
  const base = result['base'];
  const branch = result['branch'];
  return {
    status: 'ok',
    mode,
    base: typeof base === 'string' ? base : null,
    branch: typeof branch === 'string' ? branch : null,
    commits,
    truncated: result['truncated'] === true,
  };
}

/**
 * GitHistoryService — reads `git:log` for the history timeline. Stateless:
 * the timeline owns what it shows and drops an answer for a workspace that is
 * no longer active. A transport failure or a malformed payload resolves to
 * `{ status: 'unavailable', reason: 'git-failed' }`, so callers branch on one
 * shape and never on a thrown error.
 */
@Injectable({ providedIn: 'root' })
export class GitHistoryService {
  private readonly vscode = inject(VSCodeService);

  async readLog(workspaceRoot: string): Promise<GitLogResult> {
    try {
      const response = await rpcCall<GitLogResult>(this.vscode, 'git:log', {
        workspaceRoot,
      });
      return response.success ? toLogResult(response.data) : LOG_FAILED;
    } catch (error: unknown) {
      // degradation-audit: reported - the failure becomes the timeline's
      // error row with Retry.
      console.error('[GitHistoryService] git:log failed', error);
      return LOG_FAILED;
    }
  }
}
