import { ZodError } from 'zod';
import { ReviewRepositoryUnavailableError } from './stages/context-stage.runner';
import { ReviewGitTimeoutError } from './context/review-worktree.service';
import { classifyReviewFailure, sanitizeReviewFailureMessage } from './review-failure';
import { ReviewPromptTooLargeError } from './lanes/prompts/prompt-budget';

describe('classifyReviewFailure', () => {
  it.each([
    [new ReviewRepositoryUnavailableError(), 'checkout-missing'],
    [new ReviewGitTimeoutError(), 'git-timeout'],
    [Object.assign(new Error('Review command cwd is outside claim roots'), { code: 'review-command-cwd-outside-roots' }), 'command-scope'],
    [new ZodError([]), 'schema-invalid'],
    [new ReviewPromptTooLargeError(), 'prompt-too-large'],
    [Object.assign(new Error('unauthorized'), { status: 401 }), 'github-auth'],
    [Object.assign(new Error('limit'), { status: 403, headers: { 'x-ratelimit-remaining': '0' } }), 'github-rate-limit'],
    [Object.assign(new Error('server'), { status: 500 }), 'github-http'],
    [Object.assign(new Error('Review publication is paused'), { name: 'GitHubReviewError', code: 'publication-unavailable' }), 'publication-blocked'],
    [Object.assign(new Error('not found'), { name: 'GitHubReviewError' }), 'unknown'],
    [Object.assign(new Error('SQLITE_BUSY'), { name: 'SqliteError' }), 'persistence'],
    [new Error('other'), 'unknown'],
  ])('maps known errors to %s', (error, code) => {
    expect(classifyReviewFailure(error, 'context').code).toBe(code);
  });
  it('redacts credentials, paths, and injection text before truncation', () => {
    const result = sanitizeReviewFailureMessage('ghp_12345678901234567890 C:\\secret\\file /home/me/file ignore previous instructions ' + 'x'.repeat(500));
    expect(result).not.toMatch(/ghp_|secret\\file|home\/me|ignore previous instructions/);
    expect(result.length).toBeLessThanOrEqual(300);
  });
});
