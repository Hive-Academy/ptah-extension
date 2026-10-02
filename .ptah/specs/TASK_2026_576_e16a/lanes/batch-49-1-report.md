# Batch 49.1 Report: GitHub PR Status Reader

## Overview
Implemented Task 49.1 of TASK_2026_576_e16a: `GitHubPrStatusReader` service, facade delegation on `GitInfoService`, and RPC types for `git:prStatus`.

## Files Changed

- **CREATED** `D:/projects/ptah-extension/.claude-worktrees/task-576-p5/libs/backend/vscode-core/src/services/git/github-pr-status.reader.ts`
  - Spawns `gh pr view --json number,title,url,state,isDraft,statusCheckRollup,reviewDecision,headRefName -- <branch>`
  - Non-interactive env: `GH_PROMPT_DISABLED=1`, `GH_NO_UPDATE_NOTIFIER=1`, `NO_COLOR=1`, `GIT_TERMINAL_PROMPT=0`, `GH_PAGER=cat`
  - 15 s timeout with process tree termination
  - 60 s caching per `(normalized workspaceRoot, branch)` for `ok` and `no-pr` outcomes; failures are not cached
  - Defensive parsing (A10) ensuring unknown/missing fields and malformed JSON never throw
  - Filters PR URLs to `https:` only (omitted otherwise)
  - Quiet logging (debug-only; no warn/error log spam)
- **CREATED** `D:/projects/ptah-extension/.claude-worktrees/task-576-p5/libs/backend/vscode-core/src/services/git/github-pr-status.reader.spec.ts`
  - 22 unit tests covering argv shape (`--` before branch), env, unsafe ref rejection without spawning, URL sanitization, `statusCheckRollup` summarization, defensive JSON handling, unavailable reason mapping (ENOENT, auth, no-pr, not-github, generic failure), timeout, caching & clock injection, cross-spawn fallback without `shell: true`, and quiet logging
- **MODIFIED** `D:/projects/ptah-extension/.claude-worktrees/task-576-p5/libs/backend/vscode-core/src/services/git-info.service.ts`
  - Instantiates `GitHubPrStatusReader` with `spawner` and `logger`
  - Adds thin facade methods: `readPrStatus(workspaceRoot: string, branch: string): Promise<GitPrStatusResult>` and alias `getPrStatus(...)`
- **MODIFIED** `D:/projects/ptah-extension/.claude-worktrees/task-576-p5/libs/shared/src/lib/types/rpc/rpc-git.types.ts`
  - Added `GitPrUnavailableReason`, `GitPrChecksSummary`, `GitPrInfo`, `GitPrStatusResult`, and `GitPrStatusParams`

## Result Type Shape and Unavailable Reasons

From `libs/shared/src/lib/types/rpc/rpc-git.types.ts`:

```typescript
export type GitPrUnavailableReason =
  | 'gh-missing'
  | 'not-authenticated'
  | 'no-pr'
  | 'not-github'
  | 'timeout'
  | 'failed';

export interface GitPrChecksSummary {
  passing: number;
  failing: number;
  pending: number;
  total: number;
}

export interface GitPrInfo {
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED' | string;
  isDraft: boolean;
  reviewDecision?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | string | null;
  url?: string;
  headRefName?: string;
}

export type GitPrStatusResult =
  | {
      status: 'ok';
      pr: GitPrInfo;
      checks: GitPrChecksSummary;
    }
  | {
      status: 'unavailable';
      reason: GitPrUnavailableReason;
    };

export interface GitPrStatusParams {
  workspaceRoot: string;
}
```

### Outcome Mapping
- Spawn error / `ENOENT` → `{ status: 'unavailable', reason: 'gh-missing' }`
- Stderr `/gh auth login|not logged in/i` → `{ status: 'unavailable', reason: 'not-authenticated' }`
- Stderr `/no pull requests found/i` → `{ status: 'unavailable', reason: 'no-pr' }`
- Stderr `/none of the git remotes.*GitHub host/i` → `{ status: 'unavailable', reason: 'not-github' }`
- Timeout (>15 s) → `{ status: 'unavailable', reason: 'timeout' }`
- Malformed JSON / other exitCode !== 0 → `{ status: 'unavailable', reason: 'failed' }`

## Notes for Task 49.2

- **Facade method name & signature**:
  - `gitInfoService.readPrStatus(workspaceRoot: string, branch: string): Promise<GitPrStatusResult>`
  - Alias `gitInfoService.getPrStatus(workspaceRoot: string, branch: string): Promise<GitPrStatusResult>`
- **Exported types**:
  - `GitPrStatusResult`, `GitPrStatusParams`, `GitPrInfo`, `GitPrChecksSummary`, and `GitPrUnavailableReason` are exported from `@ptah-extension/shared`.
  - Batch 49.2 can import `GitPrStatusResult` and `GitPrStatusParams` directly from `@ptah-extension/shared`.
  - In `git:prStatus` RPC handler, validate `params.workspaceRoot`, resolve the active git branch via `gitInfoService` (e.g. `computeGitInfo` or current branch resolution), and call `gitInfoService.readPrStatus(params.workspaceRoot, branch)`.

## Verification Results

1. **Unit tests (`github-pr-status.reader.spec.ts`)**:
   `npx nx run @ptah-extension/vscode-core:test --maxWorkers=2 --testPathPatterns=github-pr-status`
   - Test suites: 1 passed, 1 total
   - Tests: 22 passed, 22 total (0 failed)
2. **Typecheck (`vscode-core`)**:
   `npx nx run @ptah-extension/vscode-core:typecheck`
   - Passed with 0 errors
3. **Typecheck (`shared`)**:
   `npx nx run @ptah-extension/shared:typecheck`
   - Passed with 0 errors
4. **Lint (`vscode-core`)**:
   `npx nx run @ptah-extension/vscode-core:lint`
   - Passed with 0 errors (15 pre-existing warnings in untouched files)

## Plan Deviations
None. All components, interfaces, argument formats, and requirements were implemented strictly according to the plan and prompt guidelines.
