import { inject, injectable } from 'tsyringe';
import { ShaSchema, type RepoIdentity } from '@ptah-extension/review-contracts';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { REVIEW_CORE_TOKENS } from '../di/tokens';

export interface IReviewClock { now(): Date }
export interface ReviewQueueHead {
  repo: RepoIdentity;
  prNumber: number;
  headSha: string;
}
export interface ReviewQueueAttempt extends ReviewQueueHead {
  attemptId: string;
  trigger: 'poll' | 'manual';
  queuedAt: string;
}
export interface ReviewQueueLease {
  owner: string;
  expiresAt: string;
}
export interface ReviewQueueClaim extends ReviewQueueAttempt {
  lease: ReviewQueueLease;
}

/**
 * SQLite implementation must make every method atomic. A PR has at most one
 * active attempt; superseded attempts remain in history. Discovery dedupes
 * (repo, PR, SHA, poll), while manual attempts always get a new attempt ID.
 * claimNext orders claimable heads by latest queuedAt and excludes active PRs.
 * Expired leases are reclaimable only after reconcileExpiredLeases records an
 * interrupted stage; heartbeat/release compare the current lease owner.
 */
export interface IReviewQueueRepository {
  enqueueDiscovered(head: ReviewQueueHead, queuedAt: string): Promise<ReviewQueueAttempt>;
  recordDraft(head: ReviewQueueHead, queuedAt: string): Promise<void>;
  enqueueManual(head: ReviewQueueHead, attemptId: string, queuedAt: string): Promise<ReviewQueueAttempt>;
  claimNext(owner: string, now: string, expiresAt: string): Promise<ReviewQueueClaim | null>;
  heartbeat(attemptId: string, owner: string, now: string, expiresAt: string): Promise<boolean>;
  release(attemptId: string, owner: string, status: 'succeeded' | 'partial' | 'failed' | 'superseded', now: string): Promise<boolean>;
  reconcileExpiredLeases(now: string): Promise<number>;
}

@injectable()
export class ReviewQueueService {
  constructor(
    @inject(REVIEW_CORE_TOKENS.QUEUE_REPOSITORY) private readonly repository: IReviewQueueRepository,
    @inject(REVIEW_CORE_TOKENS.CLOCK) private readonly clock: IReviewClock,
    @inject(TOKENS.LOGGER) private readonly logger: Pick<Logger, 'info'>,
  ) {}

  /** Called by polling; repository supersedes older active heads transactionally. */
  discover(head: ReviewQueueHead): Promise<ReviewQueueAttempt> {
    this.validateHead(head);
    return this.repository.enqueueDiscovered(head, this.clock.now().toISOString());
  }

  recordDraft(head: ReviewQueueHead): Promise<void> {
    this.validateHead(head);
    return this.repository.recordDraft(head, this.clock.now().toISOString());
  }

  /** Caller supplies a unique ID; repository must enforce uniqueness atomically. */
  retry(head: ReviewQueueHead, attemptId: string): Promise<ReviewQueueAttempt> {
    this.validateHead(head);
    if (!attemptId.trim() || attemptId.length > 64) throw new Error('Invalid review attempt ID');
    return this.repository.enqueueManual(head, attemptId, this.clock.now().toISOString());
  }

  claim(owner: string, leaseMs: number): Promise<ReviewQueueClaim | null> {
    this.validateLease(owner, leaseMs);
    const now = this.clock.now();
    return this.repository.claimNext(owner, now.toISOString(), new Date(now.getTime() + leaseMs).toISOString());
  }

  heartbeat(attemptId: string, owner: string, leaseMs: number): Promise<boolean> {
    this.validateLease(owner, leaseMs);
    const now = this.clock.now();
    return this.repository.heartbeat(attemptId, owner, now.toISOString(), new Date(now.getTime() + leaseMs).toISOString());
  }

  release(attemptId: string, owner: string, status: 'succeeded' | 'partial' | 'failed' | 'superseded'): Promise<boolean> {
    if (!owner.trim()) throw new Error('Missing review lease owner');
    return this.repository.release(attemptId, owner, status, this.clock.now().toISOString());
  }

  /** Caller fetches current open heads; run independently of cron catch-up. */
  async reconcileStartup(heads: ReviewQueueHead[]): Promise<number> {
    await this.repository.reconcileExpiredLeases(this.clock.now().toISOString());
    const latest = new Map<string, ReviewQueueHead>();
    for (const head of heads) {
      this.validateHead(head);
      latest.set(`${head.repo.owner}/${head.repo.name}#${head.prNumber}`, head);
    }
    for (const head of latest.values()) await this.discover(head);
    this.logger.info(`Review startup reconciled ${latest.size} heads`);
    return latest.size;
  }

  private validateHead(head: ReviewQueueHead): void {
    if (head.repo.owner !== 'Hive-Academy' || head.repo.name !== 'PtahCode' ||
        !Number.isInteger(head.prNumber) || head.prNumber < 1 ||
        !ShaSchema.safeParse(head.headSha).success) throw new Error('Invalid review queue head');
  }

  private validateLease(owner: string, leaseMs: number): void {
    if (!owner.trim() || !Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 86_400_000) {
      throw new Error('Invalid review lease');
    }
  }
}
