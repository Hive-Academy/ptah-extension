/**
 * Session organization vocabulary (TASK_2026_580).
 *
 * The one definition of the values a session's organization record may hold:
 * priority, workflow status, task-link role and source, PR-link source and
 * state, who started the session, and the `session:list` sort and group keys.
 * The SQLite store, the RPC schemas, the MCP tool and the webview all read
 * these tuples, so a value is added here or nowhere.
 *
 * Plain types and constants only: NO Zod, NO I/O. Validation lives at each
 * boundary that accepts these values.
 */

/**
 * Session priorities, most urgent first.
 *
 * **The tuple order IS the sort order** (`TASK_ESTIMATES` rule): sorting by
 * priority sorts by tuple index. There is deliberately no numeric weight.
 */
export const SESSION_PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const;
export type SessionPriority = (typeof SESSION_PRIORITIES)[number];

/** Workflow statuses, in lifecycle order (also the `groupBy: 'status'` order). */
export const SESSION_WORKFLOW_STATUSES = [
  'active',
  'waiting',
  'in_review',
  'done',
  'archived',
] as const;
export type SessionWorkflowStatus = (typeof SESSION_WORKFLOW_STATUSES)[number];

/** A session has at most one `primary` task; any number of `related` ones. */
export const SESSION_TASK_LINK_ROLES = ['primary', 'related'] as const;
export type SessionTaskLinkRole = (typeof SESSION_TASK_LINK_ROLES)[number];

/** Who created a session-task link. */
export const SESSION_TASK_LINK_SOURCES = [
  'board-start',
  'agent',
  'user',
] as const;
export type SessionTaskLinkSource = (typeof SESSION_TASK_LINK_SOURCES)[number];

/** Who recorded a PR link. */
export const SESSION_PR_LINK_SOURCES = ['agent', 'user'] as const;
export type SessionPrLinkSource = (typeof SESSION_PR_LINK_SOURCES)[number];

/** Last known state of a linked pull request. */
export const SESSION_PR_STATES = ['open', 'draft', 'merged', 'closed'] as const;
export type SessionPrState = (typeof SESSION_PR_STATES)[number];

/** Whether the user or an agent started the session. */
export const SESSION_STARTED_BY = ['user', 'agent'] as const;
export type SessionStartedBy = (typeof SESSION_STARTED_BY)[number];

/** `session:list` sort keys. `lastActive` is the default. */
export const SESSION_LIST_SORTS = [
  'lastActive',
  'priority',
  'created',
  'name',
] as const;
export type SessionListSort = (typeof SESSION_LIST_SORTS)[number];

/** `session:list` group keys. `none` is the default. */
export const SESSION_LIST_GROUPS = [
  'none',
  'status',
  'task',
  'parent',
] as const;
export type SessionListGroup = (typeof SESSION_LIST_GROUPS)[number];

/**
 * Values a session without a stored organization row reads as. The store
 * inserts a row with these values on its first write.
 */
export const SESSION_ORGANIZATION_DEFAULTS: {
  readonly priority: SessionPriority;
  readonly status: SessionWorkflowStatus;
  readonly pinned: boolean;
  readonly startedBy: SessionStartedBy;
} = {
  priority: 'normal',
  status: 'active',
  pinned: false,
  startedBy: 'user',
};

/** One task linked to a session. */
export interface SessionTaskLinkSummary {
  taskId: string;
  role: SessionTaskLinkRole;
  source: SessionTaskLinkSource;
  /** Epoch ms the link was created. */
  createdAt: number;
  /** True when the linked task folder no longer exists in the task index. */
  missing: boolean;
}

/** One pull request linked to a session. */
export interface SessionPrLinkSummary {
  url: string;
  /** PR number, parsed from a GitHub PR URL; null when the URL does not match. */
  number: number | null;
  /** `owner/repo`, parsed from a GitHub PR URL; null when the URL does not match. */
  repo: string | null;
  state: SessionPrState | null;
  source: SessionPrLinkSource;
  /** Epoch ms the link was recorded. */
  createdAt: number;
}

/** The organization record of one session, as sent over the wire. */
export interface SessionOrganizationSummary {
  priority: SessionPriority;
  status: SessionWorkflowStatus;
  pinned: boolean;
  worktreePath: string | null;
  branch: string | null;
  parentSessionId: string | null;
  forkOfSessionId: string | null;
  startedBy: SessionStartedBy;
  tasks: SessionTaskLinkSummary[];
  prLinks: SessionPrLinkSummary[];
  /** Number of sessions whose `parentSessionId` is this session. */
  childCount: number;
  /** Epoch ms of the last write; null when no organization row exists. */
  updatedAt: number | null;
}
