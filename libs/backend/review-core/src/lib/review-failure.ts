import { ZodError } from 'zod';
import { ReviewRepositoryUnavailableError } from './stages/context-stage.runner';
import { ReviewGitTimeoutError } from './context/review-worktree.service';
import { ReviewGitHeadMissingError, ReviewGitWorktreeError } from './context/review-worktree.service';
import { sanitizeReviewFailureMessage } from './review-failure-sanitizer';
export { sanitizeReviewFailureMessage } from './review-failure-sanitizer';

export const REVIEW_FAILURE_CODES = ['checkout-missing', 'head-missing', 'git-timeout', 'git-failed', 'command-scope', 'github-auth', 'github-rate-limit', 'github-http', 'lane-unavailable', 'lane-timeout', 'lane-failed', 'prompt-too-large', 'schema-invalid', 'persistence', 'unknown'] as const;
export type ReviewFailureCode = typeof REVIEW_FAILURE_CODES[number];
export const REVIEW_FAILURE_STAGES = ['discovery', 'context', 'lanes', 'verification', 'publication', 'other'] as const;
export type ReviewFailureStage = typeof REVIEW_FAILURE_STAGES[number];
export interface ReviewFailure { stage: ReviewFailureStage; code: ReviewFailureCode; message: string }

export function classifyReviewFailure(error: unknown, stage: ReviewFailureStage): ReviewFailure {
  const detail = error instanceof Error ? error.message : 'Review attempt failed';
  const named = error !== null && typeof error === 'object' && 'name' in error && typeof error.name === 'string' ? error.name : '';
  const status = error !== null && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : null;
  const headers = error !== null && typeof error === 'object' && 'headers' in error && error.headers !== null && typeof error.headers === 'object' ? error.headers : null;
  const rateLimited = headers !== null && ('x-ratelimit-remaining' in headers || 'retry-after' in headers || 'x-rate-limit-remaining' in headers);
  let code: ReviewFailureCode = 'unknown';
  if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'prompt-too-large') code = 'prompt-too-large';
  else if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'review-command-cwd-outside-roots') code = 'command-scope';
  else if (error instanceof ReviewRepositoryUnavailableError) code = 'checkout-missing';
  else if (error instanceof ReviewGitHeadMissingError) code = 'head-missing';
  else if (error instanceof ReviewGitTimeoutError) code = 'git-timeout';
  else if (error instanceof ReviewGitWorktreeError) code = 'git-failed';
  else if (error instanceof ZodError) code = 'schema-invalid';
  else if (named.startsWith('Sqlite') || /SQLITE_/i.test(detail)) code = 'persistence';
  else if (status === 429 || (status === 403 && rateLimited)) code = 'github-rate-limit';
  else if (status === 401 || status === 403) code = 'github-auth';
  else if (status !== null && status >= 400) code = 'github-http';
  else if (named.includes('Lane') || stage === 'lanes') code = /timeout|timed out/i.test(detail) ? 'lane-timeout' : /unavailable|at limit/i.test(detail) ? 'lane-unavailable' : 'lane-failed';
  else if (named.includes('Git') || /git (?:command|process) failed/i.test(detail)) code = 'git-failed';
  return { stage, code, message: sanitizeReviewFailureMessage(detail) };
}
