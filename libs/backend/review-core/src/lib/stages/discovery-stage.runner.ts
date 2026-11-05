import { inject, injectable } from 'tsyringe';
import type { IGitHubReviewPort, RepoIdentity } from '@ptah-extension/review-contracts';
import { REVIEW_CORE_TOKENS } from '../../di/tokens';
import { ReviewQueueService } from '../review-queue.service';
import { ReviewPolicyService } from '../review-policy.service';
import type { ReviewStageEnvironment } from './context-stage.runner';


/** The scheduler awaits only discovery and enqueue; no review lane runs here. */
@injectable()
export class DiscoveryStageRunner {
  constructor(
    @inject(REVIEW_CORE_TOKENS.GITHUB) private readonly github: IGitHubReviewPort,
    @inject(ReviewQueueService) private readonly queue: ReviewQueueService,
    @inject(ReviewPolicyService) private readonly policy: ReviewPolicyService,
    @inject(REVIEW_CORE_TOKENS.ENVIRONMENT) private readonly environment: ReviewStageEnvironment,
  ) {}

  async run(repo: RepoIdentity): Promise<number> {
    let page = 1;
    let count = 0;
    do {
      const result = await this.github.listOpenPulls(repo, undefined, page);
      const settings = await this.environment.settings();
      for (const pull of result.items) {
        const baseConfig = await this.environment.baseConfig(repo, pull.baseSha);
        const decision = this.policy.eligibility({ owner: repo.owner, name: repo.name,
          authorLogin: pull.authorLogin, state: pull.state, draft: pull.draft, headIsFork: pull.headIsFork,
          headRepoId: pull.headRepoId, baseRepoId: pull.baseRepoId, settings, baseConfig });
        if (decision.reason === 'draft') await this.queue.recordDraft({ repo, prNumber: pull.number, headSha: pull.headSha });
        if (!decision.eligible) continue;
        const attempt = await this.queue.discover({ repo, prNumber: pull.number, headSha: pull.headSha });
        if (!attempt.skipped) count++;
      }
      if (result.nextPage === null) break;
      page = result.nextPage;
    } while (page <= 100);
    return count;
  }
}
