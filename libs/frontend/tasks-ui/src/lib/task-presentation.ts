import type { TaskStatus, TaskType } from '@ptah-extension/shared';

/** Human-readable column / badge label per status. */
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  in_review: 'In Review',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};

/** daisyui badge modifier per status — drives the small status pill colour. */
export const TASK_STATUS_BADGE: Record<TaskStatus, string> = {
  backlog: 'badge-ghost',
  in_progress: 'badge-info',
  in_review: 'badge-warning',
  blocked: 'badge-error',
  done: 'badge-success',
  cancelled: 'badge-neutral',
};

/** daisyui badge modifier per task type. `null` → unvalidated (warning). */
export function taskTypeBadge(type: TaskType | null): string {
  return type ? 'badge-outline' : 'badge-warning badge-outline';
}
