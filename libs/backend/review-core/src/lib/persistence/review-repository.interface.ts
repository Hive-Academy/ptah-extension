import type { IReviewQueueRepository } from '../review-queue.service';
import type { RepoIdentity } from '@ptah-extension/review-contracts';
import type { ReviewFailure } from '../review-failure';

export interface ReviewStageRecord {
  attemptId: string;
  stage: string;
  ordinal: number;
  state: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'skipped';
  startedAt: string | null;
  endedAt: string | null;
  outcome: string | null;
  errorSummary: string | null;
  artifactHash: string | null;
  artifactPath: string | null;
}

export interface ReviewAttemptRecord {
  attemptId: string;
  repoId: string;
  prNumber: number;
  headSha: string;
  attemptNumber: number;
  trigger: 'automatic' | 'manual';
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  queuedAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

/** A checkpoint is stored as a stage with a JSON outcome, keyed by attempt/stage/ordinal. */
export interface IReviewRepository extends IReviewQueueRepository {
  getLastReviewedHead(repo: RepoIdentity, prNumber: number): Promise<string | null>;
  getOpenFailures(repo: RepoIdentity, prNumber: number): Promise<Array<{ id: string; path: string }>>;
  getLastPollAt(repo: RepoIdentity): Promise<number | null>;
  recordPoll(repo: RepoIdentity, ok: boolean): Promise<void>;
  saveFailure(attemptId: string, failure: ReviewFailure): Promise<void>;
  getAttempt(attemptId: string): Promise<ReviewAttemptRecord | null>;
  getStages(attemptId: string): Promise<ReviewStageRecord[]>;
  saveStage(stage: ReviewStageRecord): Promise<void>;
  saveCheckpoint(attemptId: string, stage: string, ordinal: number, data: unknown): Promise<void>;
  getCheckpoint(attemptId: string, stage: string, ordinal: number): Promise<unknown | null>;
}
