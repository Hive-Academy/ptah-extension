export type GitHubReviewErrorCode =
  | 'missing-token' | 'authentication' | 'permission' | 'rate-limit'
  | 'malformed-response' | 'http' | 'timeout' | 'publication-unavailable';

export class GitHubReviewError extends Error {
  constructor(
    readonly code: GitHubReviewErrorCode,
    message: string,
    readonly retryAt?: Date,
  ) {
    super(message);
    this.name = 'GitHubReviewError';
  }
}
