/**
 * Git RPC Type Definitions
 * TASK_2025_227 Phase 1: Git info and worktree types
 */

/** Single file's git status */
export interface GitFileStatus {
  /** Relative path from workspace root */
  path: string;
  /** Git status code: M=modified, A=added, D=deleted, R=renamed, ??=untracked */
  status: 'M' | 'A' | 'D' | 'R' | 'C' | '??' | '!';
  /** Whether the change is staged (index) vs unstaged (worktree) */
  staged: boolean;
}

/** Branch ahead/behind information */
export interface GitBranchInfo {
  /** Current branch name (or HEAD if detached) */
  branch: string;
  /** Upstream tracking branch (e.g., "origin/main"), null if none */
  upstream: string | null;
  /** Number of commits ahead of upstream */
  ahead: number;
  /** Number of commits behind upstream */
  behind: number;
}

/** Parameters for git:info RPC method */
export type GitInfoParams = Record<string, never>;

/** Response from git:info RPC method */
export interface GitInfoResult {
  /** Branch and tracking info */
  branch: GitBranchInfo;
  /** All changed files with their status */
  files: GitFileStatus[];
  /** Whether the workspace is inside a git repository */
  isGitRepo: boolean;
}

/** Parameters for git:worktrees RPC method */
export type GitWorktreesParams = Record<string, never>;

/** Single worktree entry */
export interface GitWorktreeInfo {
  /** Absolute path to the worktree directory */
  path: string;
  /** Branch checked out in this worktree */
  branch: string;
  /** HEAD commit hash (abbreviated) */
  head: string;
  /** Whether this is the main worktree */
  isMain: boolean;
  /** Whether the worktree is bare */
  isBare: boolean;
}

/** Response from git:worktrees RPC method */
export interface GitWorktreesResult {
  worktrees: GitWorktreeInfo[];
}

/** Parameters for git:addWorktree RPC method */
export interface GitAddWorktreeParams {
  /** Branch name to checkout in the new worktree */
  branch: string;
  /** Optional custom path for the worktree directory (defaults to ../<branch>) */
  path?: string;
  /** Whether to create a new branch (vs checkout existing) */
  createBranch?: boolean;
}

/** Response from git:addWorktree RPC method */
export interface GitAddWorktreeResult {
  success: boolean;
  /** Absolute path to the created worktree */
  worktreePath?: string;
  error?: string;
}

/** Parameters for git:removeWorktree RPC method */
export interface GitRemoveWorktreeParams {
  /** Absolute path to the worktree to remove */
  path: string;
  /** Whether to force removal (--force flag) */
  force?: boolean;
}

/** Response from git:removeWorktree RPC method */
export interface GitRemoveWorktreeResult {
  success: boolean;
  error?: string;
}

/**
 * Notification payload for git:worktreeChanged push messages.
 * Sent from the backend to the frontend when the SDK creates or removes a worktree.
 * The frontend WorktreeService listens for this to refresh its worktree list.
 *
 * This is a push notification (backend -> frontend), NOT a request/response RPC method.
 * It does not go in RpcMethodRegistry or RPC_METHOD_NAMES. The backend posts it as
 * a webview message with type 'git:worktreeChanged', and the frontend listens for
 * it on the message event handler.
 *
 * TASK_2025_236
 */
export interface GitWorktreeChangedNotification {
  /** Whether a worktree was created or removed */
  action: 'created' | 'removed';
  /** Worktree name (for created) */
  name?: string;
  /** Worktree path (for removed, or the created path if available) */
  path?: string;
}
