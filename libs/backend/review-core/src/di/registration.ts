import type { DependencyContainer } from 'tsyringe';
import { ReviewPolicyService } from '../lib/review-policy.service';
import { ReviewQueueService } from '../lib/review-queue.service';
import { SqliteReviewRepository } from '../lib/persistence/sqlite-review.repository';
import { ReviewQueryRepository } from '../lib/persistence/review-query.repository';
import { ReviewSettingsStore } from '../lib/persistence/review-settings.store';
import { ReviewArtifactReader } from '../lib/persistence/review-artifact.reader';
import { ReviewLaneAdmissionService, REVIEW_LANE_TOKENS } from '../lib/lanes/review-lane-admission.service';
import { ReviewLaneRunner } from '../lib/lanes/review-lane.runner';
import { ReviewWorktreeService } from '../lib/context/review-worktree.service';
import { ReviewContextService } from '../lib/context/review-context.service';
import { IncrementalScopeService } from '../lib/context/incremental-scope.service';
import { ReviewDependenciesService } from '../lib/context/review-dependencies.service';
import { ReviewChecksService } from '../lib/context/review-checks.service';
import { REVIEW_CORE_TOKENS } from './tokens';
import { DiscoveryStageRunner } from '../lib/stages/discovery-stage.runner';
import { ContextStageRunner } from '../lib/stages/context-stage.runner';
import { TriageStageRunner } from '../lib/stages/triage-stage.runner';
import { LensStageRunner } from '../lib/stages/lens-stage.runner';
import { VerificationStageRunner } from '../lib/stages/verification-stage.runner';
import { ReviewOrchestratorService } from '../lib/review-orchestrator.service';
import { PublicationStageRunner } from '../lib/stages/publication-stage.runner';
import { ReviewArtifactWriter, type ReviewArtifactFileSystem } from '../lib/lanes/review-artifact.writer';
import { PublicationOutboxService } from '../lib/publication/publication-outbox.service';
import { PublicationOutboxRepository } from '../lib/publication/publication-outbox.repository';
import { PERSISTENCE_TOKENS, type SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import { ReviewPublicationService } from '../lib/publication/review-publication.service';

/**
 * The host registers REVIEW_LANE_TOKENS.GATEWAY, REVIEW_LANE_TOKENS.FILES,
 * REVIEW_CONTEXT_TOKENS.COMMAND_RUNNER and REVIEW_CONTEXT_TOKENS.FILES (P1-16)
 * before it resolves the lane runner or the context services.
 */
export function registerReviewCore(container: DependencyContainer): void {
  container.registerSingleton(SqliteReviewRepository);
  container.registerSingleton(ReviewQueryRepository);
  container.register(REVIEW_CORE_TOKENS.QUERY_REPOSITORY, { useToken: ReviewQueryRepository });
  container.registerSingleton(ReviewSettingsStore);
  container.register(REVIEW_CORE_TOKENS.SETTINGS_STORE, { useToken: ReviewSettingsStore });
  container.registerSingleton(ReviewArtifactReader);
  container.register(REVIEW_CORE_TOKENS.ARTIFACT_READER, { useToken: ReviewArtifactReader });
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
  container.registerSingleton(ReviewWorktreeService);
  container.registerSingleton(ReviewContextService);
  container.registerSingleton(IncrementalScopeService);
  container.registerSingleton(ReviewDependenciesService);
  container.registerSingleton(ReviewChecksService);
  container.registerSingleton(DiscoveryStageRunner);
  container.registerSingleton(ContextStageRunner);
  container.registerSingleton(TriageStageRunner);
  container.registerSingleton(LensStageRunner);
  container.registerSingleton(VerificationStageRunner);
  container.register(REVIEW_CORE_TOKENS.ARTIFACT_WRITER, { useFactory: (provider) =>
    new ReviewArtifactWriter(provider.resolve<ReviewArtifactFileSystem>(REVIEW_CORE_TOKENS.ARTIFACT_FILES)) });
  container.registerSingleton(PublicationOutboxService);
  container.register(PublicationOutboxRepository, { useFactory: (provider) =>
    new PublicationOutboxRepository(provider.resolve<SqliteConnectionService>(PERSISTENCE_TOKENS.SQLITE_CONNECTION).db) });
  container.registerSingleton(ReviewPublicationService);
  container.registerSingleton(PublicationStageRunner);
  container.registerSingleton(ReviewOrchestratorService);
  container.register(REVIEW_CORE_TOKENS.ORCHESTRATOR, { useToken: ReviewOrchestratorService });
}
