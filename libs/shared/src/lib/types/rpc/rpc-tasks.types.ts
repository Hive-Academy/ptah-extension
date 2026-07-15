/**
 * `tasks:` RPC namespace contracts (TASK_2026_157).
 *
 * Compile-time HALF of the dual registration. The runtime half is the
 * `'tasks:'` prefix in `ALLOWED_METHOD_PREFIXES`
 * (`libs/backend/vscode-core/src/messaging/rpc-handler.ts`) — neither alone
 * is sufficient; missing the runtime prefix crashes silently.
 *
 * `TasksChangedNotification` is a push payload (raw webview message), NOT an
 * RPC method — it mirrors `GitWorktreeChangedNotification`.
 */

import type {
  TaskSpecSummary,
  TaskSpecDetail,
  TaskStatus,
  TaskType,
} from '../task-spec.types';

/** Workspace scoping — same convention as GitWorkspaceScopedParams. */
export interface TasksWorkspaceScopedParams {
  workspaceRoot?: string;
}

export interface TasksListParams extends TasksWorkspaceScopedParams {
  status?: TaskStatus[];
  type?: TaskType[];
}
export interface TasksListResult {
  tasks: TaskSpecSummary[];
  excludedCount: number;
  specsDirExists: boolean;
}

export interface TasksGetParams extends TasksWorkspaceScopedParams {
  taskId: string;
}
export interface TasksGetResult {
  task: TaskSpecDetail | null;
}

export interface TasksCreateParams extends TasksWorkspaceScopedParams {
  title: string;
  type: TaskType;
  description?: string;
  dependsOn?: string[];
  executor?: string;
}
export interface TasksCreateResult {
  success: boolean;
  task?: TaskSpecSummary;
  error?: {
    code: 'TASK_FOLDER_EXISTS' | 'WRITE_FAILED' | 'INVALID_PARAMS';
    message: string;
  };
}

export interface TasksUpdateStatusParams extends TasksWorkspaceScopedParams {
  taskId: string;
  status: TaskStatus;
}
export interface TasksUpdateStatusResult {
  success: boolean;
  task?: TaskSpecSummary;
  error?: {
    code: 'TASK_NOT_FOUND' | 'TASK_EXCLUDED' | 'WRITE_FAILED';
    message: string;
  };
}

export type TasksGenerateRegistryParams = TasksWorkspaceScopedParams;
export interface TasksGenerateRegistryResult {
  success: boolean;
  includedCount: number;
  excludedCount: number;
  /** workspace-relative: '.ptah/specs/registry.md' (no abs-path leakage, R4.4). */
  registryPath: string;
}

export type TasksBoardParams = TasksWorkspaceScopedParams;
export interface TasksBoardResult {
  /** all six status keys always present. */
  columns: Record<TaskStatus, TaskSpecSummary[]>;
  excludedCount: number;
  specsDirExists: boolean;
}

export type TasksReindexParams = TasksWorkspaceScopedParams;
export interface TasksReindexResult {
  success: boolean;
  indexedCount: number;
  excludedCount: number;
  durationMs: number;
}

/**
 * Push notification payload for 'tasks:changed' webview messages.
 * NOT an RPC method — mirrors GitWorktreeChangedNotification's pattern.
 */
export interface TasksChangedNotification {
  workspaceRoot: string;
  reason: 'watcher' | 'write' | 'reindex';
  folderNames?: string[];
}
