/**
 * Display labels for session organization values (TASK_2026_580).
 *
 * Kept apart from `SessionOrganizationChipsComponent` on purpose: the sidebar's
 * eager grouping helper needs these labels at first paint, while the chips,
 * filter bar and editor are deferred chunks. Importing the labels from the
 * component file would pull the whole component into the initial bundle.
 */
import type {
  SessionPriority,
  SessionWorkflowStatus,
} from '@ptah-extension/shared';

export const SESSION_PRIORITY_LABELS: Readonly<
  Record<SessionPriority, string>
> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

export const SESSION_STATUS_LABELS: Readonly<
  Record<SessionWorkflowStatus, string>
> = {
  active: 'Active',
  waiting: 'Waiting',
  in_review: 'In review',
  done: 'Done',
  archived: 'Archived',
};
