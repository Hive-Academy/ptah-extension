import { inject, injectable } from 'tsyringe';
import type { IGitHubReviewPort } from '@ptah-extension/review-contracts';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { z } from 'zod';
import { REVIEW_CORE_TOKENS } from '../di/tokens';
import { ReviewQueueService, type ReviewQueueClaim } from './review-queue.service';
import { ReviewPolicyService } from './review-policy.service';
import type { IReviewRepository, ReviewStageRecord } from './persistence/review-repository.interface';
import { DiscoveryStageRunner } from './stages/discovery-stage.runner';
import { ContextStageRunner, type ContextStageResult, type ReviewStageEnvironment } from './stages/context-stage.runner';
import { TriageStageRunner } from './stages/triage-stage.runner';
import { LensStageRunner } from './stages/lens-stage.runner';
import { VerificationStageRunner } from './stages/verification-stage.runner';

const ContextSchema = z.object({ attemptRoot: z.string().min(1), coverage: z.array(z.string()), promptInput: z.object({
  headSha: z.string(), title: z.string(), body: z.string(), diff: z.string(), comments: z.string(), fileContent: z.string(),
  deterministicEvidence: z.string(), repositoryRules: z.string(),
}) }).strict();

@injectable()
export class ReviewOrchestratorService {
  private workerActive = false;
  constructor(
    private readonly discovery: DiscoveryStageRunner,
    private readonly context: ContextStageRunner,
    private readonly triage: TriageStageRunner,
    private readonly lenses: LensStageRunner,
    private readonly verification: VerificationStageRunner,
    private readonly queue: ReviewQueueService,
    private readonly policy: ReviewPolicyService,
    @inject(REVIEW_CORE_TOKENS.REVIEW_REPOSITORY) private readonly repository: IReviewRepository,
    @inject(REVIEW_CORE_TOKENS.GITHUB) private readonly github: IGitHubReviewPort,
    @inject(REVIEW_CORE_TOKENS.ENVIRONMENT) private readonly environment: ReviewStageEnvironment,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
  ) {}

  /** Bind this to cron's named handler job. It only discovers and enqueues. */
  async discoveryHandler(): Promise<{ summary: string }> {
    const count = await this.discovery.run();
    return { summary: `Enqueued ${count} review heads` };
  }

  async startupPoll(lastDiscoveryAt: number | null): Promise<number> {
    await this.queue.reconcileStartup([]);
    if (lastDiscoveryAt !== null && Date.now() - lastDiscoveryAt < 48 * 60 * 60 * 1000) return 0;
    const count = await this.discovery.run();
    return count;
  }

  /** Host starts this detached from cron and owns its lifetime. */
  async drain(owner: string, deadlineMs: number): Promise<number> {
    if (this.workerActive) return 0;
    this.workerActive = true;
    let count = 0;
    try {
      while (Date.now() < deadlineMs) {
        const claim = await this.queue.claim(owner, 60_000);
        if (!claim) break;
        await this.process(claim, deadlineMs);
        count++;
      }
      return count;
    } finally { this.workerActive = false; }
  }

  private async process(claim: ReviewQueueClaim, deadline: number): Promise<void> {
    let status: 'succeeded' | 'partial' | 'failed' | 'superseded' = 'succeeded';
    try {
      if (!await this.guard(claim)) { status = 'superseded'; return; }
      const context = await this.stage(claim, 'context', 0, ContextSchema, () => this.context.run(claim));
      if (!context) { status = 'partial'; return; }
      if (!await this.guard(claim)) { status = 'superseded'; return; }
      const triage = await this.stage(claim, 'triage', 1, z.unknown(), () => this.triage.run(claim, context, deadline));
      if (!triage) { status = 'partial'; return; }
      if (!triage || (typeof triage === 'object' && triage !== null && 'status' in triage && triage.status === 'partial')) status = 'partial';
      if (!await this.guard(claim)) { status = 'superseded'; return; }
      const lensResults = await this.lenses.run(claim, context, deadline);
      if (lensResults.some((entry) => entry.result.status === 'partial')) status = 'partial';
      if (!await this.guard(claim)) { status = 'superseded'; return; }
      const verdicts = await this.stage(claim, 'verification', 3, z.unknown(), () => this.verification.run(claim, context, lensResults, deadline));
      if (!Array.isArray(verdicts) || verdicts.some((entry) => entry.verification === 'unavailable')) status = 'partial';
    } catch (error: unknown) {
      status = 'failed';
      this.logger.error('Review attempt failed', error instanceof Error ? error : new Error(String(error)));
    } finally { await this.queue.release(claim.attemptId, claim.lease.owner, status); }
  }

  private async guard(claim: ReviewQueueClaim): Promise<boolean> {
    const pull = await this.github.getPull(claim.repo, claim.prNumber);
    if (pull.headSha !== claim.headSha) return false;
    const eligible = this.policy.eligibility({ owner: claim.repo.owner, name: claim.repo.name, authorLogin: pull.authorLogin,
      state: pull.state, draft: pull.draft, headIsFork: pull.headIsFork, headRepoId: pull.headRepoId,
      baseRepoId: pull.baseRepoId, settings: await this.environment.settings(), baseConfig: await this.environment.baseConfig() });
    return eligible.eligible;
  }

  private async stage<T>(claim: ReviewQueueClaim, name: string, ordinal: number, schema: z.ZodType<T>, run: () => Promise<T>): Promise<T | null> {
    const prior = (await this.repository.getStages(claim.attemptId)).find((row) => row.stage === name && row.ordinal === ordinal);
    if (prior?.state === 'completed') return schema.parse(await this.repository.getCheckpoint(claim.attemptId, name, ordinal));
    if (prior?.state === 'running' || prior?.state === 'interrupted') {
      await this.repository.saveStage({ ...prior, state: 'interrupted', endedAt: new Date().toISOString(), outcome: 'interrupted' });
      return null;
    }
    const startedAt = new Date().toISOString();
    const row: ReviewStageRecord = { attemptId: claim.attemptId, stage: name, ordinal, state: 'running', startedAt,
      endedAt: null, outcome: null, errorSummary: null, artifactHash: null, artifactPath: null };
    await this.repository.saveStage(row);
    try {
      const value = await run();
      await this.repository.saveCheckpoint(claim.attemptId, name, ordinal, value);
      await this.repository.saveStage({ ...row, state: 'completed', endedAt: new Date().toISOString(), outcome: 'completed' });
      return value;
    } catch (error: unknown) {
      await this.repository.saveStage({ ...row, state: 'failed', endedAt: new Date().toISOString(), errorSummary: error instanceof Error ? error.message : 'Unknown stage error' });
      throw error;
    }
  }
}
