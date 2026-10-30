/**
 * Strict parser for a review run's deliverable (Req 7).
 *
 * Deliverable format (one line each, matched case-insensitively; a leading
 * `-` or `*` bullet and `**bold**` markers around the label or value are
 * allowed; anything else on other lines is ignored):
 *
 *   Reviewed-Run: <runId>
 *   Verdict: APPROVED | REVISE | REJECTED
 *
 * - Exactly one distinct reviewed run is required. `<runId>` is 1-200 chars of
 *   `A-Z a-z 0-9 : . _ | -`, optionally wrapped in backticks, and nothing else
 *   may follow it on the line (for example a bare agent id
 *   `Reviewed-Run: 3f2a9c1e`, or `- **Reviewed-Run:** `subagent:agent-7``).
 *   The recorder resolves a bare agent id to that agent's run.
 * - One or more verdict lines are required and all must agree. The verdict
 *   label may also be a markdown heading (`## Verdict: REVISE`). Text after the
 *   verdict word is ignored.
 * - Conflicting verdicts or more than one distinct reviewed run are
 *   `ambiguous`; a reviewed run equal to the reviewer is `self-review`.
 * - Text longer than {@link REVIEW_DELIVERABLE_MAX_CHARS} is refused unread
 *   (`too-large`): the host reads at most
 *   {@link REVIEW_DELIVERABLE_MAX_FILES} files of
 *   {@link REVIEW_DELIVERABLE_MAX_FILE_CHARS} each.
 *
 * Free-form praise or the mere existence of a file is never a verdict. The
 * parser returns identifiers and a verdict only; callers must not log or
 * persist the text.
 */

export type ReviewVerdict = 'approved' | 'revise' | 'rejected';

export type ReviewCaptureRefusal =
  'no-target' | 'no-verdict' | 'ambiguous' | 'self-review' | 'too-large';

export type ReviewDeliverableParse =
  | { readonly reviewedRunId: string; readonly verdict: ReviewVerdict }
  | { readonly refusal: ReviewCaptureRefusal };

/** Most review deliverable files the host reads for one review run. */
export const REVIEW_DELIVERABLE_MAX_FILES = 3;
/** Largest single review deliverable file the host reads. */
export const REVIEW_DELIVERABLE_MAX_FILE_CHARS = 64 * 1024;
/** The most text the parser accepts for one review run. */
export const REVIEW_DELIVERABLE_MAX_CHARS =
  REVIEW_DELIVERABLE_MAX_FILES * REVIEW_DELIVERABLE_MAX_FILE_CHARS;

const REVIEWED_RUN_LINE =
  /^\s*(?:[-*]\s*)?(?:\*\*)?Reviewed-Run(?:\*\*)?\s*:\s*(?:\*\*)?\s*`?([A-Za-z0-9:._|-]{1,200})`?\s*(?:\*\*)?\s*$/i;

const VERDICT_LINE =
  /^\s*(?:[-*]\s*)?(?:#{1,6}\s*)?(?:\*\*)?Verdict(?:\*\*)?\s*:\s*(?:\*\*)?\s*(APPROVED|REVISE|REJECTED)\b/i;

const VERDICT_BY_WORD: Readonly<Record<string, ReviewVerdict>> = {
  APPROVED: 'approved',
  REVISE: 'revise',
  REJECTED: 'rejected',
};

export function parseReviewDeliverable(
  text: string,
  reviewerRunId: string,
): ReviewDeliverableParse {
  if (text.length > REVIEW_DELIVERABLE_MAX_CHARS)
    return { refusal: 'too-large' };
  const reviewedRuns = new Set<string>();
  const verdicts = new Set<ReviewVerdict>();
  for (const line of text.split(/\r?\n/)) {
    const run = REVIEWED_RUN_LINE.exec(line);
    if (run) {
      reviewedRuns.add(run[1]);
      continue;
    }
    const word = VERDICT_LINE.exec(line)?.[1].toUpperCase();
    const verdict = word === undefined ? undefined : VERDICT_BY_WORD[word];
    if (verdict) verdicts.add(verdict);
  }
  if (reviewedRuns.size === 0) return { refusal: 'no-target' };
  if (verdicts.size === 0) return { refusal: 'no-verdict' };
  if (reviewedRuns.size > 1 || verdicts.size > 1)
    return { refusal: 'ambiguous' };
  const [reviewedRunId] = reviewedRuns;
  const [verdict] = verdicts;
  if (reviewedRunId === reviewerRunId) return { refusal: 'self-review' };
  return { reviewedRunId, verdict };
}
