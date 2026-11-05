import type { IGitHubReviewPort } from '@ptah-extension/review-contracts';
import { ReviewPolicyService } from '../review-policy.service';
import { ReviewQueueService, type IReviewQueueRepository } from '../review-queue.service';
import { DiscoveryStageRunner } from './discovery-stage.runner';

const REVIEW_REPO = { owner: 'Hive-Academy', name: 'PtahCode' } as const;

const sha = 'a'.repeat(40);
const pull = { number: 7, headSha: sha, baseSha: 'b'.repeat(40), state: 'open' as const,
  draft: false, authorLogin: 'maintainer', headRepoId: 1, baseRepoId: 1, headIsFork: false };

describe('DiscoveryStageRunner', () => {
  it('only enqueues eligible heads and does not claim work', async () => {
    const enqueueDiscovered = jest.fn().mockResolvedValue({ attemptId: 'a' });
    const claimNext = jest.fn();
    const recordDraft = jest.fn().mockResolvedValue(undefined);
    const repository: IReviewQueueRepository = { enqueueDiscovered, recordDraft, claimNext,
      enqueueManual: jest.fn(), heartbeat: jest.fn(), release: jest.fn(), reconcileExpiredLeases: jest.fn() };
    const github: IGitHubReviewPort = {
      listOpenPulls: jest.fn().mockResolvedValue({ items: [pull, { ...pull, number: 8, draft: true }], nextPage: null, etag: null, notModified: false }),
      getPull: jest.fn(), getDiff: jest.fn(), listOwnIssueComments: jest.fn(), listOwnReviewsAndThreads: jest.fn(),
      upsertWalkthrough: jest.fn(), createCommentReview: jest.fn(), replyToFinding: jest.fn(),
    };
    const queue = new ReviewQueueService(repository, { now: () => new Date('2026-11-03T00:00:00Z') }, { info: jest.fn() });
    const runner = new DiscoveryStageRunner(github, queue, new ReviewPolicyService(), {
      resolve: async () => ({ repoRoot: '/repo', attemptsRoot: '/attempts' }),
      settings: async () => ({ repositories: [{ owner: 'Hive-Academy', name: 'PtahCode', enabled: true, dryRun: true, publicationPaused: false }],
        maintainerLogins: ['maintainer'], pollMinutes: 10, globalPublicationPaused: false, fallbackFamilies: [] }),
      baseConfig: async () => null,
    });
    expect(await runner.run(REVIEW_REPO)).toBe(1);
    expect(enqueueDiscovered).toHaveBeenCalledWith({ repo: REVIEW_REPO, prNumber: 7, headSha: sha }, '2026-11-03T00:00:00.000Z', true);
    expect(recordDraft).toHaveBeenCalledWith({ repo: REVIEW_REPO, prNumber: 8, headSha: sha }, '2026-11-03T00:00:00.000Z');
    expect(claimNext).not.toHaveBeenCalled();
  });
});
