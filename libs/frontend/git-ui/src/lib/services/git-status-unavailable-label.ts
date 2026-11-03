import type { GitStatusUnavailableReason } from '@ptah-extension/shared';

/** Wording for each reason a status read failed, completing "Git status is unavailable (…)". */
const STATUS_UNAVAILABLE_LABELS: Readonly<
  Record<GitStatusUnavailableReason, string>
> = {
  'output-too-large': 'the status output is too large to read',
  timeout: 'git timed out',
  locked: 'another git process is using this repository',
  error: 'git reported an error',
  'root-unavailable': 'this worktree is no longer available',
};

/** Human wording for a status-unavailable reason (review shell, source control). */
export function statusUnavailableLabel(
  reason: GitStatusUnavailableReason,
): string {
  return STATUS_UNAVAILABLE_LABELS[reason];
}

/** Fixed notice text; never includes git's raw diagnostic output. */
export function statusUnavailableNoticeTitle(reason: GitStatusUnavailableReason): string {
  return `Git status is unavailable (${statusUnavailableLabel(reason)})`;
}
