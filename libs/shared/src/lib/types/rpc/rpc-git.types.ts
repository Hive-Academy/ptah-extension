/**
 * Git RPC Type Definitions: Git info and worktree types.
 */

/** Single file's git status */
export interface GitFileStatus {
  /** Relative path from workspace root */
  path: string;
  /** Git status code: M=modified, A=added, D=deleted, R=renamed, ??=untracked */
  status: 'M' | 'A' | 'D' | 'R' | 'C' | '??' | '!';
  /** Whether the change is staged (index) vs unstaged (worktree) */
  staged: boolean;
  /** Whether this entry is a directory (untracked directories from git status) */
  isDirectory?: boolean;
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
 */
export interface GitWorktreeChangedNotification {
  /** Whether a worktree was created or removed */
  action: 'created' | 'removed';
  /** Worktree name (for created) */
  name?: string;
  /** Worktree path (for removed, or the created path if available) */
  path?: string;
}

// ============================================================================
// Source Control RPC Types
// ============================================================================

/** Parameters for git:stage RPC method */
export interface GitStageParams {
  /** File paths to stage (relative to workspace root) */
  paths: string[];
}

/** Result from git:stage RPC method */
export interface GitStageResult {
  success: boolean;
  error?: string;
}

/** Parameters for git:unstage RPC method */
export interface GitUnstageParams {
  /** File paths to unstage (relative to workspace root) */
  paths: string[];
}

/** Result from git:unstage RPC method */
export interface GitUnstageResult {
  success: boolean;
  error?: string;
}

/** Parameters for git:discard RPC method */
export interface GitDiscardParams {
  /** File paths to discard changes for (relative to workspace root) */
  paths: string[];
}

/** Result from git:discard RPC method */
export interface GitDiscardResult {
  success: boolean;
  error?: string;
}

/** Parameters for git:commit RPC method */
export interface GitCommitParams {
  /** Commit message */
  message: string;
}

/** Result from git:commit RPC method */
export interface GitCommitResult {
  success: boolean;
  /** Abbreviated commit hash on success */
  commitHash?: string;
  error?: string;
}

/** Parameters for git:showFile RPC method */
export interface GitShowFileParams {
  /** Relative file path from workspace root */
  path: string;
}

/** Result from git:showFile RPC method */
export interface GitShowFileResult {
  /** File content from HEAD (empty string for new/untracked files) */
  content: string;
  /** Whether the file is binary */
  isBinary?: boolean;
}

// ============================================================================
// Branch, Checkout, Stash, Tag, Remote, and Last-Commit RPC Types
// ============================================================================

/** Single branch reference returned by git:branches */
export interface BranchRef {
  /** Short branch name, e.g. "main" or "origin/main" for remotes */
  name: string;
  /** Whether this is the currently checked-out branch */
  isCurrent: boolean;
  /** Whether this is a remote-tracking branch */
  isRemote: boolean;
  /** Remote name for remote-tracking branches, e.g. "origin" */
  remote?: string;
  /** Upstream tracking ref, null when no upstream is configured */
  upstream?: string | null;
  /** Commits ahead of upstream (0 when no upstream) */
  ahead: number;
  /** Commits behind upstream (0 when no upstream) */
  behind: number;
  /** Abbreviated commit hash of the branch tip */
  lastCommitHash?: string;
  /** Unix timestamp (ms) of the branch tip commit */
  lastCommitTime?: number;
}

/** Parameters for git:branches RPC method */
export interface GitBranchesParams {
  /** Whether to include remote-tracking branches in the result */
  includeRemote?: boolean;
}

/** Result from git:branches RPC method */
export interface GitBranchesResult {
  /** Short name of the currently checked-out branch */
  current: string;
  /** Local branches */
  local: BranchRef[];
  /** Remote-tracking branches (only populated when includeRemote=true) */
  remote: BranchRef[];
}

/** Parameters for git:checkout RPC method */
export interface GitCheckoutParams {
  /** Branch name to checkout or create */
  branch: string;
  /** Whether to create a new branch (-b flag) */
  createNew?: boolean;
  /** Force checkout even with a dirty working tree (--force flag) */
  force?: boolean;
}

/** Result from git:checkout RPC method */
export interface GitCheckoutResult {
  success: boolean;
  error?: string;
  /** True when working tree had uncommitted changes and force=false caused the checkout to abort */
  dirty?: boolean;
}

/** Single git stash entry */
export interface StashEntry {
  /** Zero-based stash index (the N in stash@{N}) */
  index: number;
  /** Stash message */
  message: string;
  /** Branch name the stash was created on */
  branch?: string;
  /** Unix timestamp (ms) of the stash creation */
  time?: number;
}

/** Parameters for git:stashList RPC method */
export type GitStashListParams = Record<string, never>;

/** Result from git:stashList RPC method */
export interface GitStashListResult {
  count: number;
  entries: StashEntry[];
}

/** Single tag reference */
export interface TagRef {
  /** Tag name */
  name: string;
  /** Abbreviated commit hash the tag points to */
  commit: string;
  /** Whether the tag is an annotated tag (vs lightweight) */
  annotated: boolean;
  /** Unix timestamp (ms) of the tag creation date */
  time?: number;
}

/** Parameters for git:tags RPC method */
export interface GitTagsParams {
  /** Maximum number of tags to return (default: 20) */
  limit?: number;
}

/** Result from git:tags RPC method */
export interface GitTagsResult {
  tags: TagRef[];
}

/** Single git remote */
export interface RemoteInfo {
  /** Remote name, e.g. "origin" */
  name: string;
  /** Fetch URL */
  fetchUrl: string;
  /** Push URL */
  pushUrl: string;
}

/** Parameters for git:remotes RPC method */
export type GitRemotesParams = Record<string, never>;

/** Result from git:remotes RPC method */
export interface GitRemotesResult {
  remotes: RemoteInfo[];
}

/** Parameters for git:lastCommit RPC method */
export interface GitLastCommitParams {
  /** Git ref to inspect (default: HEAD) */
  ref?: string;
}

/** Result from git:lastCommit RPC method */
export interface GitLastCommitResult {
  /** Full commit SHA */
  hash: string;
  /** Abbreviated commit hash */
  shortHash: string;
  /** Commit subject line */
  subject: string;
  /** Commit body (everything after the subject) */
  body: string;
  /** Author display name */
  author: string;
  /** Author email address */
  authorEmail: string;
  /** Commit Unix timestamp in milliseconds */
  time: number;
}
