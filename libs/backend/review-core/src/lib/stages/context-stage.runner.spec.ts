import { ReviewRepositoryUnavailableError } from './context-stage.runner';
import { ContextStageRunner } from './context-stage.runner';
import { ReviewWorktreeService } from '../context/review-worktree.service';
import { ReviewContextService } from '../context/review-context.service';
import { ReviewDependenciesService } from '../context/review-dependencies.service';
import { ReviewChecksService } from '../context/review-checks.service';
import type { IGitHubReviewPort } from '@ptah-extension/review-contracts';
import type { ReviewQueueClaim } from '../review-queue.service';

const claim: ReviewQueueClaim = {
  repo: { owner: 'Hive-Academy', name: 'PtahCode' }, prNumber: 1,
  headSha: 'a'.repeat(40), attemptId: 'attempt-1', trigger: 'poll',
  queuedAt: '2026-11-03T00:00:00Z', lease: { owner: 'worker', expiresAt: '2026-11-03T01:00:00Z' },
};

describe('ContextStageRunner repository resolution', () => {
  it('rejects an unconfigured repository before touching a worktree or GitHub', async () => {
    const github = Object.create(null) as IGitHubReviewPort;
    github.getDiff = jest.fn();
    const worktree = Object.create(ReviewWorktreeService.prototype) as ReviewWorktreeService;
    const create = jest.spyOn(worktree, 'create');
    const runner = new ContextStageRunner(
      github,
      { resolve: async () => { throw new ReviewRepositoryUnavailableError(); }, settings: async () => null, baseConfig: async () => null },
      worktree,
      Object.create(ReviewContextService.prototype) as ReviewContextService,
      Object.create(ReviewDependenciesService.prototype) as ReviewDependenciesService,
      Object.create(ReviewChecksService.prototype) as ReviewChecksService,
    );

    await expect(runner.run(claim)).rejects.toBeInstanceOf(ReviewRepositoryUnavailableError);
    expect(create).not.toHaveBeenCalled();
    expect(github.getDiff).not.toHaveBeenCalled();
  });
});
