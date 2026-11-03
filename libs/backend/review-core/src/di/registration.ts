import type { DependencyContainer } from 'tsyringe';
import { ReviewPolicyService } from '../lib/review-policy.service';
import { ReviewQueueService } from '../lib/review-queue.service';
import { SqliteReviewRepository } from '../lib/persistence/sqlite-review.repository';
import { REVIEW_CORE_TOKENS } from './tokens';

/** The host registers QUEUE_REPOSITORY before resolving the queue service. */
export function registerReviewCore(container: DependencyContainer): void {
  container.registerSingleton(SqliteReviewRepository);
  container.register(REVIEW_CORE_TOKENS.REVIEW_REPOSITORY, { useToken: SqliteReviewRepository });
  container.register(REVIEW_CORE_TOKENS.QUEUE_REPOSITORY, { useToken: SqliteReviewRepository });
  container.register(REVIEW_CORE_TOKENS.CLOCK, { useValue: { now: () => new Date() } });
  container.registerSingleton(ReviewPolicyService);
  container.register(REVIEW_CORE_TOKENS.POLICY_SERVICE, { useToken: ReviewPolicyService });
  container.registerSingleton(ReviewQueueService);
  container.register(REVIEW_CORE_TOKENS.QUEUE_SERVICE, { useToken: ReviewQueueService });
}
