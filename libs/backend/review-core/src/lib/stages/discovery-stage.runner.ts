import { inject, injectable } from 'tsyringe';
import type { IGitHubReviewPort, RepoIdentity } from '@ptah-extension/review-contracts';
import { REVIEW_CORE_TOKENS } from '../../di/tokens';
import { ReviewQueueService } from '../review-queue.service';
import { ReviewPolicyService } from '../review-policy.service';
import type { ReviewStageEnvironment } from './context-stage.runner';

export const REVIEW_REPO: RepoIdentity = { owner: 'Hive-Academy', name: 'PtahCode' };

/** The scheduler awaits only discovery and enqueue; no review lane runs here. */
@injectable()
export class DiscoveryStageRunner {
  constructor(
    @inject(REVIEW_CORE_TOKENS.GITHUB) private readonly github: IGitHubReviewPort,
    private readonly queue: ReviewQueueService,
    private readonly policy: ReviewPolicyService,
    @inject(REVIEW_CORE_TOKENS.ENVIRONMENT) private readonly environment: ReviewStageEnvironment,
  ) {}

  async run(): Promise<number> {
    let page = 1;
    let count = 0;
    do {
      const result = await this.github.listOpenPulls(REVIEW_REPO, undefined, page);
      const settings = await this.environment.settings();
      const baseConfig = await this.environment.baseConfig();
      for (const pull of result.items) {
        if (!this.policy.eligibility({ owner: REVIEW_REPO.owner, name: REVIEW_REPO.name,
          authorLogin: pull.authorLogin, state: pull.state, draft: pull.draft, headIsFork: pull.headIsFork,
          headRepoId: pull.headRepoId, baseRepoId: pull.baseRepoId, settings, baseConfig }).eligible) continue;
        await this.queue.discover({ repo: REVIEW_REPO, prNumber: pull.number, headSha: pull.headSha });
        count++;
      }
      if (result.nextPage === null) break;
      page = result.nextPage;
    } while (page <= 100);
    return count;
  }
}
