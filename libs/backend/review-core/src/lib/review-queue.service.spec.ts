import { ReviewQueueService, type IReviewQueueRepository, type ReviewQueueAttempt, type ReviewQueueClaim, type ReviewQueueHead } from './review-queue.service';

const head = (sha: string): ReviewQueueHead => ({ repo: { owner: 'Hive-Academy', name: 'PtahCode' }, prNumber: 42, headSha: sha });
const first = head('a'.repeat(40));
const second = head('b'.repeat(40));
const logger = { info: jest.fn() };

class FakeRepository implements IReviewQueueRepository {
  attempts: Array<ReviewQueueAttempt & { status: 'queued' | 'running' | 'superseded' | 'done'; leaseOwner?: string }> = [];
  expired = 0;
  async recordDraft(): Promise<void> { return; }
  async enqueueDiscovered(value: ReviewQueueHead, queuedAt: string): Promise<ReviewQueueAttempt> {
    const existing = this.attempts.find((attempt) => attempt.headSha === value.headSha && attempt.trigger === 'poll');
    if (existing) return existing;
    for (const attempt of this.attempts) if (attempt.prNumber === value.prNumber && attempt.status !== 'done') attempt.status = 'superseded';
    const attempt = { ...value, attemptId: `poll-${this.attempts.length}`, trigger: 'poll' as const, queuedAt, status: 'queued' as const };
    this.attempts.push(attempt);
    return attempt;
  }
  async enqueueManual(value: ReviewQueueHead, attemptId: string, queuedAt: string): Promise<ReviewQueueAttempt> {
    if (this.attempts.some((a) => a.attemptId === attemptId)) throw new Error('Duplicate attempt');
    const attempt = { ...value, attemptId, trigger: 'manual' as const, queuedAt, status: 'queued' as const };
    this.attempts.push(attempt);
    return attempt;
  }
  async claimNext(owner: string, _now: string, expiresAt: string): Promise<ReviewQueueClaim | null> {
    const attempt = [...this.attempts].reverse().find((a) => a.status === 'queued');
    if (!attempt) return null;
    attempt.status = 'running'; attempt.leaseOwner = owner;
    return { ...attempt, lease: { owner, expiresAt } };
  }
  async heartbeat(attemptId: string, owner: string): Promise<boolean> {
    return this.attempts.some((a) => a.attemptId === attemptId && a.leaseOwner === owner && a.status === 'running');
  }
  async release(attemptId: string, owner: string): Promise<boolean> {
    const attempt = this.attempts.find((a) => a.attemptId === attemptId && a.leaseOwner === owner && a.status === 'running');
    if (!attempt) return false;
    attempt.status = 'done'; return true;
  }
  async reconcileExpiredLeases(): Promise<number> { this.expired++; return 0; }
}

describe('ReviewQueueService', () => {
  it('dedupes discovery, supersedes an old head, and claims newest', async () => {
    const repo = new FakeRepository();
    const queue = new ReviewQueueService(repo, { now: () => new Date('2026-01-01T00:00:00Z') }, logger);
    expect(await queue.discover(first)).toEqual(await queue.discover(first));
    expect(repo.attempts).toHaveLength(1);
    await queue.discover(second);
    expect(repo.attempts[0].status).toBe('superseded');
    expect((await queue.claim('worker', 1000))?.headSha).toBe(second.headSha);
  });
  it('keeps manual attempts distinct and protects lease ownership', async () => {
    const repo = new FakeRepository();
    const queue = new ReviewQueueService(repo, { now: () => new Date('2026-01-01T00:00:00Z') }, logger);
    await queue.retry(first, 'manual-1');
    await queue.retry(first, 'manual-2');
    expect(repo.attempts.map((a) => a.attemptId)).toEqual(['manual-1', 'manual-2']);
    const claim = await queue.claim('worker', 1000);
    expect(claim?.lease.expiresAt).toBe('2026-01-01T00:00:01.000Z');
    expect(await queue.heartbeat('manual-2', 'other', 1000)).toBe(false);
    expect(await queue.release('manual-2', 'other', 'succeeded')).toBe(false);
  });
  it('reconciles startup heads regardless of cron window', async () => {
    const repo = new FakeRepository();
    const queue = new ReviewQueueService(repo, { now: () => new Date('2026-01-01T00:00:00Z') }, logger);
    expect(await queue.reconcileStartup([first])).toBe(1);
    expect(repo.expired).toBe(1);
    expect(repo.attempts).toHaveLength(1);
  });
  it('queues only the latest supplied head for each PR after an outage', async () => {
    const repo = new FakeRepository();
    const queue = new ReviewQueueService(repo, { now: () => new Date('2026-01-01T00:00:00Z') }, logger);
    expect(await queue.reconcileStartup([first, second])).toBe(1);
    expect(repo.attempts.map((attempt) => attempt.headSha)).toEqual([second.headSha]);
  });
});
