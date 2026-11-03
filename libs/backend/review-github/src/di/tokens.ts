export const REVIEW_GITHUB_TOKENS = {
  REVIEW_PORT: Symbol.for('ReviewGitHubPort'),
  FETCH: Symbol.for('ReviewGitHubFetch'),
} as const;

/** Host settings store the bot credential under this secret-storage key. */
export const REVIEW_GITHUB_TOKEN_KEY = 'ptah.review.githubToken';
