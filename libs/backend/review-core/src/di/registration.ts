import type { DependencyContainer } from 'tsyringe';
import { ReviewPolicyService } from '../lib/review-policy.service';
import { ReviewQueueService } from '../lib/review-queue.service';
import { SqliteReviewRepository } from '../lib/persistence/sqlite-review.repository';
import { ReviewLaneAdmissionService, REVIEW_LANE_TOKENS } from '../lib/lanes/review-lane-admission.service';
import { ReviewLaneRunner } from '../lib/lanes/review-lane.runner';
import { REVIEW_CORE_TOKENS } from './tokens';

/**
 * The host registers REVIEW_LANE_TOKENS.GATEWAY and REVIEW_LANE_TOKENS.FILES (P1-16)
 * before it resolves ReviewLaneRunner.
 */
export function registerReviewCore(container: DependencyContainer): void {
  container.registerSingleton(SqliteReviewRepository);
  container.register(REVIEW_CORE_TOKENS.REVIEW_REPOSITORY, { useToken: SqliteReviewRepository });
  container.register(REVIEW_CORE_TOKENS.QUEUE_REPOSITORY, { useToken: SqliteReviewRepository });
  container.register(REVIEW_CORE_TOKENS.CLOCK, { useValue: { now: () => new Date() } });
  container.registerSingleton(ReviewPolicyService);
  container.register(REVIEW_CORE_TOKENS.POLICY_SERVICE, { useToken: ReviewPolicyService });
  container.registerSingleton(ReviewQueueService);
  container.register(REVIEW_CORE_TOKENS.QUEUE_SERVICE, { useToken: ReviewQueueService });
  container.register(REVIEW_LANE_TOKENS.CLOCK, {
    useValue: {
      now: () => Date.now(),
      setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
      clearTimeout: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
    },
  });
  container.registerSingleton(ReviewLaneAdmissionService);
  container.register(REVIEW_LANE_TOKENS.ADMISSION, { useToken: ReviewLaneAdmissionService });
  container.registerSingleton(ReviewLaneRunner);
}
