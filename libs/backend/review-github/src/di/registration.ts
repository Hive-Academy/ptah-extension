import type { DependencyContainer } from 'tsyringe';
import { GithubReviewAdapter } from '../lib/github-review.adapter';
import { REVIEW_GITHUB_TOKENS } from './tokens';

export function registerReviewGithubServices(container: DependencyContainer): void {
  container.registerInstance(REVIEW_GITHUB_TOKENS.FETCH, fetch);
  container.registerSingleton(REVIEW_GITHUB_TOKENS.REVIEW_PORT, GithubReviewAdapter);
}
