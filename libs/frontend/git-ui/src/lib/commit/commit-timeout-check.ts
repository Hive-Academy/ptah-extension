/**
 * Judging a commit whose `git:commit` reply timed out (TASK_2026_576 P5
 * MOD-1, SER-1): git may still have made it, so it counts as made only when
 * a fresh HEAD read proves it.
 */

/**
 * What a fresh HEAD read says about a commit that timed out:
 * - `landed` — HEAD moved and the new HEAD's subject is this message's.
 * - `not-found` — HEAD did not move.
 * - `other-commit` — HEAD moved, but to a commit with another subject.
 * - `unknown` — HEAD could not be read for the commit's workspace.
 */
export type CommitCheck = 'landed' | 'not-found' | 'other-commit' | 'unknown';

type UnprovenCheck = Exclude<CommitCheck, 'landed'>;

/** What a timed-out commit reads as while git may still be running it. */
export const UNCONFIRMED_TEXT: Record<UnprovenCheck, string> = {
  'not-found':
    'Git did not answer in time and no new commit shows yet. It may still be running: cancel it, or commit again once it has stopped.',
  'other-commit':
    'Git did not answer in time and the newest commit is not this one. It may still be running: cancel it, or check the history before committing again.',
  unknown:
    'Git did not answer in time and the status could not be checked. The commit may still complete: cancel it, or check the status before committing again.',
};

/** What a timed-out commit that git says is no longer running reads as. */
export const ENDED_TEXT: Record<UnprovenCheck, string> = {
  'not-found': 'Commit failed: git stopped without making the commit.',
  'other-commit':
    'Git stopped, but the newest commit is not this one — check the history before committing again.',
  unknown:
    'Git stopped, but the status could not be checked — check it before committing again.',
};

/**
 * What a commit that timed out is judged against: HEAD when it started and
 * the subject it would get. Only a moved HEAD carrying that subject counts
 * as this commit; a changed staged set proves nothing.
 */
export interface CommitBaseline {
  /** Null when HEAD was never read for this workspace: nothing can be proven. */
  readonly headHash: string | null;
  /** The first line of the submitted message, trimmed. */
  readonly subject: string;
}

/** The first line of a commit message, trimmed: the subject git gives it. */
export function subjectOf(message: string): string {
  return message.split(/\r?\n/, 1)[0].trim();
}

/** Judge a freshly read HEAD of the commit's workspace against the baseline. */
export function judgeHead(
  baseline: CommitBaseline,
  head: { readonly hash: string; readonly subject: string },
): CommitCheck {
  if (baseline.headHash === null) return 'unknown';
  if (head.hash === baseline.headHash) return 'not-found';
  return head.subject.trim() === baseline.subject ? 'landed' : 'other-commit';
}
