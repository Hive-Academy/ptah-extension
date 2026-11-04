import { inject, injectable } from 'tsyringe';
import { RepoIdentitySchema, RepoReviewConfigV1Schema, type IGitHubReviewPort, type RepoIdentity } from '@ptah-extension/review-contracts';
import { REVIEW_CORE_TOKENS } from '../../di/tokens';
import { ReviewWorktreeService } from '../context/review-worktree.service';
import { ReviewContextService } from '../context/review-context.service';
import { IncrementalScopeService } from '../context/incremental-scope.service';
import type { IncrementalScope } from '../context/incremental-scope.service';
import type { IReviewRepository } from '../persistence/review-repository.interface';
import { ReviewDependenciesService } from '../context/review-dependencies.service';
import { ReviewChecksService } from '../context/review-checks.service';
import type { ReviewCheckDefinition } from '../context/review-checks.service';
import type { ReviewQueueClaim } from '../review-queue.service';
import type { ReviewPromptInput } from '../lanes/prompts/prompt-fence';
import { isAbsolute } from 'node:path';
import { z } from 'zod';

const ReviewRootsSchema = z.object({
  repoRoot: z.string().min(1).refine(isAbsolute),
  attemptsRoot: z.string().min(1).refine(isAbsolute),
}).strict();
export type ReviewRoots = z.infer<typeof ReviewRootsSchema>;

export class ReviewRepositoryUnavailableError extends Error {
  constructor() { super('Review repository is not configured'); }
}

export interface ReviewStageEnvironment {
  resolve(repo: RepoIdentity): Promise<ReviewRoots>;
  settings(): Promise<unknown>;
  baseConfig(repo: RepoIdentity, baseSha?: string): Promise<unknown | null>;
  pullText?(prNumber: number): Promise<{ title?: string; body?: string }>;
  redactionSecrets?(): Promise<string[]>;
}
export async function resolveReviewRoots(environment: ReviewStageEnvironment, repo: RepoIdentity): Promise<ReviewRoots> {
  const identity = RepoIdentitySchema.safeParse(repo);
  if (!identity.success) throw new ReviewRepositoryUnavailableError();
  const roots = await environment.resolve(identity.data);
  return ReviewRootsSchema.parse(roots);
}
export interface ContextStageResult { attemptRoot: string; baseSha?: string; promptInput: ReviewPromptInput; coverage: string[];
  incrementalScope?: IncrementalScope }

function changedExports(patch: string): string[] {
  const names = new Set<string>();
  for (const line of patch.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const match = /^\+\s*export\s+(?:(?:default|declare|async|abstract)\s+)*(?:class|function|interface|type|const|let|enum)\s+([A-Za-z_$][\w$]*)\b/.exec(line);
    if (match) names.add(match[1]);
    if (names.size >= 20) break;
  }
  return [...names];
}

function defaultChecks(changedPaths: readonly string[], enabled: { eslint: boolean; degradationAudit: boolean }): ReviewCheckDefinition[] {
  const source = changedPaths.filter((path) => /^(?:apps|libs)\/[^/]+(?:\/[^/]+)*\/src\/.*\.(?:ts|tsx|js|jsx)$/.test(path)).slice(0, 80);
  const checks: ReviewCheckDefinition[] = [];
  if (source.length && enabled.eslint) checks.push({ name: 'eslint', command: 'node',
    args: ['node_modules/eslint/bin/eslint.js', ...source], timeoutMs: 120_000, needsDependencies: true, scope: source });
  const audited = source.filter((path) => path.endsWith('.ts') && !/\.(?:spec|test)\.ts$/.test(path));
  if (audited.length && enabled.degradationAudit) checks.push({ name: 'degradation-audit', command: 'node',
    args: ['node_modules/ts-node/dist/bin.js', '--transpile-only', 'tools/degradation-audit/check-degradation.ts', '--changed-files', ...audited],
    timeoutMs: 120_000, needsDependencies: true, scope: audited });
  return checks;
}

@injectable()
export class ContextStageRunner {
  constructor(
    @inject(REVIEW_CORE_TOKENS.GITHUB) private readonly github: IGitHubReviewPort,
    @inject(REVIEW_CORE_TOKENS.ENVIRONMENT) private readonly environment: ReviewStageEnvironment,
    @inject(ReviewWorktreeService) private readonly worktree: ReviewWorktreeService,
    @inject(ReviewContextService) private readonly context: ReviewContextService,
    @inject(ReviewDependenciesService) private readonly dependencies: ReviewDependenciesService,
    @inject(ReviewChecksService) private readonly checks: ReviewChecksService,
    @inject(REVIEW_CORE_TOKENS.REVIEW_REPOSITORY) private readonly repository: IReviewRepository,
    @inject(IncrementalScopeService) private readonly incremental: IncrementalScopeService,
  ) {}

  async run(claim: ReviewQueueClaim, deadlineMs = Date.now() + 30 * 60_000, signal?: AbortSignal): Promise<ContextStageResult> {
    const remainingMs = Math.max(1, deadlineMs - Date.now());
    const workSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(remainingMs)]) : AbortSignal.timeout(remainingMs);
    const check = (): void => {
      if (workSignal.aborted) throw new Error('Review context aborted');
      if (Date.now() >= deadlineMs) throw new Error('Review context deadline reached');
    };
    check();
    const roots = await resolveReviewRoots(this.environment, claim.repo);
    check();
    const paths = await this.worktree.create(claim.repo, roots.repoRoot, roots.attemptsRoot, claim.attemptId, claim.headSha, workSignal);
    check();
    const diff = await this.github.getDiff(claim.repo as RepoIdentity, claim.prNumber, claim.headSha);
    check();
    const config = RepoReviewConfigV1Schema.parse(await this.environment.baseConfig(claim.repo, diff.baseSha) ?? { version: 1 });
    check();
    const source = await this.worktree.snapshot(claim.repo, paths.src, claim.headSha, workSignal);
    check();
    const previousHead = await this.repository.getLastReviewedHead(claim.repo, claim.prNumber);
    check();
    const openFailures = await this.repository.getOpenFailures(claim.repo, claim.prNumber);
    check();
    const incrementalDiff = previousHead ? previousHead === claim.headSha ? { patch: '', changedPaths: [] }
      : await this.context.diffSince(claim.repo, paths.src, previousHead, claim.headSha, workSignal) : null;
    check();
    const reviewPatch = incrementalDiff?.patch ?? diff.patch;
    const changedPaths = incrementalDiff?.changedPaths ?? [...diff.patch.matchAll(/^diff --git a\/.+? b\/(.+)$/gm)].map((match) => match[1]);
    const context = await this.context.build(claim.repo, paths.src, changedPaths, changedExports(reviewPatch), workSignal);
    check();
    const scope = this.incremental.plan({ headSha: claim.headSha, previousReviewedHeadSha: previousHead,
      newCommitPaths: [...context.changedPaths], touchedCallers: context.callers.map(({ path, outsideDiff }) => ({ path, outsideDiff })),
      openFailures });
    check();
    const dependency = await this.dependencies.prepare(claim.repo, paths.src, context.changedLockfiles, false, workSignal);
    check();
    const checks = await this.checks.run(claim.repo, paths.src, defaultChecks(context.changedPaths, config.checks), dependency.status === 'available', workSignal);
    check();
    const text = await this.environment.pullText?.(claim.prNumber);
    check();
    return { attemptRoot: paths.root, baseSha: diff.baseSha, incrementalScope: scope,
      coverage: [!incrementalDiff && diff.truncated ? 'diff-truncated' : 'diff-complete',
      `dependencies:${dependency.status}`, ...checks.map((check) => `${check.name}:${check.status}`)],
      promptInput: { headSha: claim.headSha, title: text?.title ?? '', body: text?.body ?? '', diff: reviewPatch, comments: '', fileContent: JSON.stringify(context.callers),
        deterministicEvidence: JSON.stringify({ context, checks, incrementalScope: scope, sourceChecksum: source.checksum }),
        repositoryRules: JSON.stringify({ include: config.include, exclude: config.exclude, pathInstructions: config.pathInstructions }) } };
  }
}
