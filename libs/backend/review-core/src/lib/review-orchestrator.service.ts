import { inject, injectable } from 'tsyringe';
import { CandidateFindingSchema, VerifierVerdictSchema, type IGitHubReviewPort, type RepoIdentity } from '@ptah-extension/review-contracts';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { z } from 'zod';
import { REVIEW_CORE_TOKENS } from '../di/tokens';
import { ReviewQueueService, type ReviewQueueClaim } from './review-queue.service';
import { ReviewPolicyService } from './review-policy.service';
import type { IReviewRepository, ReviewStageRecord } from './persistence/review-repository.interface';
import type { IReviewSettingsStore } from './persistence/review-settings.store';
import { DiscoveryStageRunner } from './stages/discovery-stage.runner';
import { ContextStageRunner, resolveReviewRoots, type ReviewStageEnvironment } from './stages/context-stage.runner';
import { TriageStageRunner } from './stages/triage-stage.runner';
import { LensStageRunner } from './stages/lens-stage.runner';
import { VerificationStageRunner } from './stages/verification-stage.runner';
import { PublicationStageRunner } from './stages/publication-stage.runner';

const ContextSchema = z.object({ attemptRoot: z.string().min(1), baseSha: z.string().regex(/^[a-f0-9]{40}$/).optional(),
  incrementalScope: z.object({ headSha: z.string(), previousReviewedHeadSha: z.string().nullable(), changedPaths: z.array(z.string()),
    dependentPaths: z.array(z.string()), recheckFailureIds: z.array(z.string()), reviewPaths: z.array(z.string()),
    publishNewVerifiedRootsOnly: z.boolean() }).optional(), coverage: z.array(z.string()), promptInput: z.object({
  headSha: z.string(), title: z.string(), body: z.string(), diff: z.string(), comments: z.string(), fileContent: z.string(),
  deterministicEvidence: z.string(), repositoryRules: z.string(),
}) }).strict();
const VerificationSchema = z.array(z.object({ lens: z.string(), finding: CandidateFindingSchema,
  verification: z.enum(['cross-family', 'same-family-weaker', 'unavailable']),
  result: z.discriminatedUnion('status', [z.object({ status: z.literal('partial'), reason: z.string() }),
    z.object({ status: z.literal('completed'), family: z.string(), evidenceStrength: z.enum(['strong', 'weaker']).optional(), output: VerifierVerdictSchema })]),
}));
/** An attempt gets its own review window; drain's deadline only limits new claims. */
const REVIEW_ATTEMPT_WINDOW_MS = 30 * 60_000;

export class ReviewPollDisabledError extends Error {
  constructor() { super('Review repository is disabled'); }
}

@injectable()
export class ReviewOrchestratorService {
  private workerActive = false;
  constructor(
    @inject(DiscoveryStageRunner) private readonly discovery: DiscoveryStageRunner,
    @inject(ContextStageRunner) private readonly context: ContextStageRunner,
    @inject(TriageStageRunner) private readonly triage: TriageStageRunner,
    @inject(LensStageRunner) private readonly lenses: LensStageRunner,
    @inject(VerificationStageRunner) private readonly verification: VerificationStageRunner,
    @inject(PublicationStageRunner) private readonly publication: PublicationStageRunner,
    @inject(ReviewQueueService) private readonly queue: ReviewQueueService,
    @inject(ReviewPolicyService) private readonly policy: ReviewPolicyService,
    @inject(REVIEW_CORE_TOKENS.REVIEW_REPOSITORY) private readonly repository: IReviewRepository,
    @inject(REVIEW_CORE_TOKENS.GITHUB) private readonly github: IGitHubReviewPort,
    @inject(REVIEW_CORE_TOKENS.ENVIRONMENT) private readonly environment: ReviewStageEnvironment,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(REVIEW_CORE_TOKENS.SETTINGS_STORE) private readonly settingsStore: IReviewSettingsStore,
  ) {}

  async lastPollAt(repo: RepoIdentity): Promise<number | null> { return this.repository.getLastPollAt(repo); }

  async pollAndRecord(repo: RepoIdentity): Promise<number> {
    const settings = await this.settingsStore.getSettings();
    if (!settings?.repositories.some((entry) => entry.enabled && entry.owner === repo.owner && entry.name === repo.name))
      throw new ReviewPollDisabledError();
    try {
      await this.environment.resolve(repo);
      const count = await this.discovery.run(repo);
      await this.repository.recordPoll(repo, true);
      return count;
    } catch (error: unknown) {
      await this.repository.recordPoll(repo, false);
      throw error;
    }
  }

  /** Bind this to cron's named handler job. It only discovers and enqueues. */
  async discoveryHandler(): Promise<{ summary: string }> {
    const count = await this.discovery.run();
    return { summary: `Enqueued ${count} review heads` };
  }

  async startupPoll(lastDiscoveryAt: number | null, repo?: RepoIdentity): Promise<number> {
    await this.queue.reconcileStartup([]);
    if (lastDiscoveryAt !== null && Date.now() - lastDiscoveryAt < 48 * 60 * 60 * 1000) return 0;
    const count = repo ? await this.pollAndRecord(repo) : await this.discovery.run();
    return count;
  }

  /** Host starts this detached from cron and owns its lifetime. */
  async drain(owner: string, deadlineMs: number, signal?: AbortSignal): Promise<number> {
    if (this.workerActive) return 0;
    this.workerActive = true;
    let count = 0;
    try {
      while (!signal?.aborted && Date.now() < deadlineMs) {
        const claim = await this.queue.claim(owner, 60_000);
        if (!claim) break;
        await this.process(claim, signal);
        count++;
      }
      return count;
    } finally { this.workerActive = false; }
  }

  private async process(claim: ReviewQueueClaim, signal?: AbortSignal): Promise<void> {
    let status: 'succeeded' | 'partial' | 'failed' | 'superseded' = 'succeeded';
    let attemptDeadline = Date.now() + REVIEW_ATTEMPT_WINDOW_MS;
    const pendingHeartbeats = new Set<Promise<void>>();
    const heartbeat = setInterval(() => {
      if (signal?.aborted) return;
      const pending = this.queue.heartbeat(claim.attemptId, claim.lease.owner, 60_000).then((renewed) => {
        if (renewed) attemptDeadline = Date.now() + REVIEW_ATTEMPT_WINDOW_MS;
      }).catch(() => {
        this.logger.error('Review lease heartbeat failed', new Error('Review lease heartbeat failed'));
      });
      pendingHeartbeats.add(pending);
      void pending.finally(() => pendingHeartbeats.delete(pending));
    }, 20_000);
    heartbeat.unref();
    try {
      if (signal?.aborted) { status = 'partial'; return; }
      if (!await this.guard(claim, signal)) { status = signal?.aborted ? 'partial' : 'superseded'; return; }
      const context = await this.stage(claim, 'context', 0, ContextSchema, () => this.context.run(claim, attemptDeadline, signal), signal);
      if (!context) { status = 'partial'; return; }
      if (signal?.aborted) { status = 'partial'; return; }
      if (!await this.guard(claim, signal)) { status = signal?.aborted ? 'partial' : 'superseded'; return; }
      const triage = await this.stage(claim, 'triage', 1, z.unknown(), () => this.triage.run(claim, context, attemptDeadline, signal), signal);
      if (!triage) { status = 'partial'; return; }
      if (typeof triage === 'object' && 'status' in triage && triage.status === 'partial' &&
          'reason' in triage && triage.reason === 'deadline') { status = 'partial'; return; }
      if (!triage || (typeof triage === 'object' && triage !== null && 'status' in triage && triage.status === 'partial')) status = 'partial';
      if (signal?.aborted) { status = 'partial'; return; }
      if (!await this.guard(claim, signal)) { status = signal?.aborted ? 'partial' : 'superseded'; return; }
      const lensResults = await this.lenses.run(claim, context, attemptDeadline, signal);
      if (lensResults.some((entry) => entry.result.status === 'partial')) status = 'partial';
      if (lensResults.length > 0 && lensResults.every((entry) => entry.result.status === 'partial' && entry.result.reason === 'deadline')) return;
      if (signal?.aborted) { status = 'partial'; return; }
      if (!await this.guard(claim, signal)) { status = signal?.aborted ? 'partial' : 'superseded'; return; }
      const verdicts = await this.stage(claim, 'verification', 3, VerificationSchema, () => this.verification.run(claim, context, lensResults, attemptDeadline, signal), signal);
      if (!verdicts) { status = 'partial'; return; }
      if (verdicts.some((entry) => entry.verification === 'unavailable')) status = 'partial';
      if (signal?.aborted) { status = 'partial'; return; }
      if (!await this.guard(claim, signal)) { status = signal?.aborted ? 'partial' : 'superseded'; return; }
      const publication = await this.stage(claim, 'publication', 4, z.object({ artifactPath: z.string(), exportPath: z.string(),
        acceptedCount: z.number(), suppressedCount: z.number() }), () => this.publication.run(claim, context, lensResults, verdicts, signal), signal);
      if (!publication) status = 'partial';
    } catch (error: unknown) {
      status = 'failed';
      this.logger.error('Review attempt failed', error instanceof Error ? error : new Error(String(error)));
    } finally {
      clearInterval(heartbeat);
      await Promise.allSettled(pendingHeartbeats);
      if (!signal?.aborted) await this.queue.release(claim.attemptId, claim.lease.owner, status);
    }
  }

  private async guard(claim: ReviewQueueClaim, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false;
    await resolveReviewRoots(this.environment, claim.repo);
    if (signal?.aborted) return false;
    const pull = await this.github.getPull(claim.repo, claim.prNumber);
    if (signal?.aborted) return false;
    if (pull.headSha !== claim.headSha) return false;
    const settings = await this.environment.settings();
    if (signal?.aborted) return false;
    const baseConfig = await this.environment.baseConfig(claim.repo, pull.baseSha);
    if (signal?.aborted) return false;
    const eligible = this.policy.eligibility({ owner: claim.repo.owner, name: claim.repo.name, authorLogin: pull.authorLogin,
      state: pull.state, draft: pull.draft, headIsFork: pull.headIsFork, headRepoId: pull.headRepoId,
      baseRepoId: pull.baseRepoId, settings, baseConfig });
    return eligible.eligible;
  }

  private async stage<T>(claim: ReviewQueueClaim, name: string, ordinal: number, schema: z.ZodType<T>, run: () => Promise<T>, signal?: AbortSignal): Promise<T | null> {
    if (signal?.aborted) return null;
    const prior = (await this.repository.getStages(claim.attemptId)).find((row) => row.stage === name && row.ordinal === ordinal);
    if (signal?.aborted) return null;
    if (prior?.state === 'completed') return signal?.aborted ? null : schema.parse(await this.repository.getCheckpoint(claim.attemptId, name, ordinal));
    const startedAt = new Date().toISOString();
    const row: ReviewStageRecord = { attemptId: claim.attemptId, stage: name, ordinal, state: 'running', startedAt,
      endedAt: null, outcome: null, errorSummary: null, artifactHash: null, artifactPath: null };
    await this.repository.saveStage(row);
    try {
      if (signal?.aborted) return null;
      const value = await run();
      if (signal?.aborted) return null;
      await this.repository.saveCheckpoint(claim.attemptId, name, ordinal, value);
      if (signal?.aborted) return null;
      const artifactPath = typeof value === 'object' && value !== null && 'artifactPath' in value && typeof value.artifactPath === 'string'
        ? value.artifactPath : null;
      await this.repository.saveStage({ ...row, state: 'completed', endedAt: new Date().toISOString(), outcome: 'completed', artifactPath });
      return value;
    } catch (error: unknown) {
      if (!signal?.aborted) await this.repository.saveStage({ ...row, state: 'failed', endedAt: new Date().toISOString(), errorSummary: error instanceof Error ? error.message : 'Unknown stage error' });
      throw error;
    }
  }
}
