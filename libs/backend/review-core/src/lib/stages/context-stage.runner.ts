import { inject, injectable } from 'tsyringe';
import type { IGitHubReviewPort, RepoIdentity } from '@ptah-extension/review-contracts';
import { REVIEW_CORE_TOKENS } from '../../di/tokens';
import { ReviewWorktreeService } from '../context/review-worktree.service';
import { ReviewContextService } from '../context/review-context.service';
import { ReviewDependenciesService } from '../context/review-dependencies.service';
import { ReviewChecksService } from '../context/review-checks.service';
import type { ReviewQueueClaim } from '../review-queue.service';
import type { ReviewPromptInput } from '../lanes/prompts/prompt-fence';

export interface ReviewStageEnvironment {
  repoRoot: string;
  attemptsRoot: string;
  settings(): Promise<unknown>;
  baseConfig(): Promise<unknown | null>;
  pullText?(prNumber: number): Promise<{ title?: string; body?: string }>;
}
export interface ContextStageResult { attemptRoot: string; promptInput: ReviewPromptInput; coverage: string[] }

@injectable()
export class ContextStageRunner {
  constructor(
    @inject(REVIEW_CORE_TOKENS.GITHUB) private readonly github: IGitHubReviewPort,
    @inject(REVIEW_CORE_TOKENS.ENVIRONMENT) private readonly environment: ReviewStageEnvironment,
    private readonly worktree: ReviewWorktreeService,
    private readonly context: ReviewContextService,
    private readonly dependencies: ReviewDependenciesService,
    private readonly checks: ReviewChecksService,
  ) {}

  async run(claim: ReviewQueueClaim): Promise<ContextStageResult> {
    const paths = await this.worktree.create(this.environment.repoRoot, this.environment.attemptsRoot, claim.attemptId, claim.headSha);
    const diff = await this.github.getDiff(claim.repo as RepoIdentity, claim.prNumber, claim.headSha);
    const source = await this.worktree.snapshot(paths.src, claim.headSha);
    const changedPaths = [...diff.patch.matchAll(/^diff --git a\/.+? b\/(.+)$/gm)].map((match) => match[1]);
    const context = await this.context.build(paths.src, changedPaths, []);
    const dependency = await this.dependencies.prepare(paths.src, context.changedLockfiles, false);
    const checks = await this.checks.run(paths.src, [], dependency.status === 'available');
    const text = await this.environment.pullText?.(claim.prNumber);
    return { attemptRoot: paths.root, coverage: [diff.truncated ? 'diff-truncated' : 'diff-complete',
      `dependencies:${dependency.status}`, ...checks.map((check) => `${check.name}:${check.status}`)],
      promptInput: { headSha: claim.headSha, title: text?.title ?? '', body: text?.body ?? '', diff: diff.patch, comments: '', fileContent: '',
        deterministicEvidence: JSON.stringify({ context, checks, sourceChecksum: source.checksum }), repositoryRules: '' } };
  }
}
