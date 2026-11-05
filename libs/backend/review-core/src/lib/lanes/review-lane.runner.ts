import { inject, injectable } from 'tsyringe';
import { OperatorSettingsSchema, RepoIdentitySchema, ShaSchema, type Lens, type RepoIdentity } from '@ptah-extension/review-contracts';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { z } from 'zod';
import { ReviewLaneAdmissionService, REVIEW_LANE_TOKENS, type IReviewLaneClock } from './review-lane-admission.service';
import { ReviewLaneSelector, type ReviewLaneCapability, type ReviewLaneKind } from './review-lane-selector';
import { ReviewOutputParser } from './review-output.parser';
import { REVIEW_CORE_TOKENS } from '../../di/tokens';
import type { ReviewStageEnvironment } from '../stages/context-stage.runner';
import { sanitizeReviewFailureMessage } from '../review-failure-sanitizer';

export interface IReviewLaneGateway {
  list(): Promise<{ lanes: ReviewLaneCapability[]; maxConcurrentAgents: number }>;
  spawn(input: { laneId: string; cwd: string; prompt: string; signal: AbortSignal }): Promise<void>;
}

/** The adapter owns creation and exact-SHA, read-only materialization of src. */
export interface IReviewLaneFiles {
  prepare(repo: RepoIdentity, attemptRoot: string, headSha: string, signal?: AbortSignal): Promise<string>;
  sourceChecksum(repo: RepoIdentity, attemptRoot: string, headSha: string, signal?: AbortSignal): Promise<string>;
  readOutput(attemptRoot: string, name: 'lane-output.json' | 'walkthrough.md'): Promise<string>;
  clearOutput(attemptRoot: string): Promise<void>;
}

export interface ReviewLaneRequest {
  repo: RepoIdentity;
  prKey: string;
  attemptId: string;
  attemptRoot: string;
  headSha: string;
  kind: ReviewLaneKind;
  prompt: string;
  runDeadlineMs: number;
  signal?: AbortSignal;
  lensAuthorFamily?: string;
  verifierBatch?: boolean;
}

export type ReviewLaneResult =
  | { status: 'completed'; family: string; limitCheck?: 'unavailable'; evidenceStrength?: 'strong' | 'weaker'; output: ReturnType<ReviewOutputParser['parseLens']> | ReturnType<ReviewOutputParser['parseVerdict']> | ReturnType<ReviewOutputParser['parseVerdictBatch']> }
  | { status: 'partial'; reason: string; limitCheck?: 'unavailable' };

@injectable()
export class ReviewLaneRunner {
  private readonly selector = new ReviewLaneSelector();
  private readonly parser = new ReviewOutputParser();

  constructor(
    @inject(REVIEW_LANE_TOKENS.GATEWAY) private readonly gateway: IReviewLaneGateway,
    @inject(REVIEW_LANE_TOKENS.FILES) private readonly files: IReviewLaneFiles,
    @inject(REVIEW_LANE_TOKENS.CLOCK) private readonly clock: IReviewLaneClock,
    @inject(REVIEW_LANE_TOKENS.ADMISSION) private readonly admission: ReviewLaneAdmissionService,
    @inject(TOKENS.LOGGER) private readonly logger: Pick<Logger, 'error'>,
    @inject(REVIEW_CORE_TOKENS.ENVIRONMENT) private readonly environment: ReviewStageEnvironment,
  ) {}

  async run(request: ReviewLaneRequest): Promise<ReviewLaneResult> {
    if (request.signal?.aborted) return { status: 'partial', reason: 'aborted' };
    RepoIdentitySchema.parse(request.repo);
    ShaSchema.parse(request.headSha);
    z.string().min(1).max(128).parse(request.attemptId);
    if (!Number.isFinite(request.runDeadlineMs)) throw new Error('Invalid run deadline');
    const limit = 480_000;
    const deadline = Math.min(request.runDeadlineMs, this.clock.now() + limit);
    if (this.clock.now() >= deadline) return { status: 'partial', reason: 'deadline' };
    const capacity = z.object({
      lanes: z.array(z.object({ id: z.string().min(1), family: z.string().min(1), limitState: z.enum(['confirmed-room', 'unknown', 'at-limit']) }).strict()).max(100),
      maxConcurrentAgents: z.number().int().nonnegative(),
    }).strict().parse(await this.gateway.list());
    if (request.signal?.aborted) return { status: 'partial', reason: 'aborted' };
    if (this.clock.now() >= deadline) return { status: 'partial', reason: 'deadline' };
    const choice = this.selector.select([request.kind], capacity.lanes, request.lensAuthorFamily).selected[0];
    if (!choice) return { status: 'partial', reason: 'no-confirmed-room' };
    const operatorSettings = OperatorSettingsSchema.parse(await this.environment.settings());
    if (request.signal?.aborted) return { status: 'partial', reason: 'aborted' };
    if (this.clock.now() >= deadline) return { status: 'partial', reason: 'deadline' };
    const lease = this.admission.acquire(`${request.prKey}:${request.attemptId}`, deadline, capacity.maxConcurrentAgents, operatorSettings.laneCapPerPr);
    if (lease.status === 'partial') return { status: 'partial', reason: lease.reason };
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    request.signal?.addEventListener('abort', onAbort, { once: true });
    if (request.signal?.aborted) controller.abort();
    const timer = this.clock.setTimeout(() => controller.abort(), Math.max(0, deadline - this.clock.now()));
    try {
      const before = await this.files.prepare(request.repo, request.attemptRoot, request.headSha, controller.signal);
      if (controller.signal.aborted || this.clock.now() >= deadline) return { status: 'partial', reason: request.signal?.aborted ? 'aborted' : 'deadline' };
      await this.files.clearOutput(request.attemptRoot);
      let spawnError: unknown;
      try {
        await this.gateway.spawn({ laneId: choice.lane.id, cwd: request.attemptRoot, prompt: request.prompt, signal: controller.signal });
      } catch (error: unknown) { spawnError = error; }
      const after = await this.files.sourceChecksum(request.repo, request.attemptRoot, request.headSha, controller.signal);
      if (before !== after) throw new Error('Lane mutated source');
      if (controller.signal.aborted || this.clock.now() >= deadline) return { status: 'partial', reason: request.signal?.aborted ? 'aborted' : 'deadline' };
      if (spawnError !== undefined) throw spawnError;
      let raw: string;
      try {
        raw = (await this.files.readOutput(request.attemptRoot, 'lane-output.json')).replace(/^\uFEFF/, '');
      } catch (error: unknown) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
          throw new Error('output-missing');
        throw error;
      }
      if (!raw.trim()) throw new Error('output-missing');
      let output: ReturnType<ReviewOutputParser['parseLens']> | ReturnType<ReviewOutputParser['parseVerdict']> | ReturnType<ReviewOutputParser['parseVerdictBatch']>;
      try {
        output = request.kind === 'verifier'
          ? request.verifierBatch ? this.parser.parseVerdictBatch(raw, request.headSha, choice.lane.family)
            : this.parser.parseVerdict(raw, request.headSha, choice.lane.family)
          : this.parser.parseLens(raw, request.headSha, request.kind === 'triage' ? undefined : request.kind as Lens);
      } catch (error: unknown) {
        const detail = error instanceof z.ZodError ? error.issues.map((issue) => issue.path.join('.') || '<root>').join(', ') :
          error instanceof Error ? error.message : 'unknown';
        throw new Error(`output-invalid: ${sanitizeReviewFailureMessage(detail).slice(0, 160)}`);
      }
      if (request.kind === 'triage') {
        const walkthrough = (await this.files.readOutput(request.attemptRoot, 'walkthrough.md')).replace(/^\uFEFF/, '');
        if (!/^#{1,3} Observed behavior\s*$/mi.test(walkthrough) ||
            !/^#{1,3} Inferred risks\s*$/mi.test(walkthrough) ||
            !/^#{1,3} Risk map\s*$/mi.test(walkthrough))
          throw new Error('Triage walkthrough missing required headings');
      }
      return { status: 'completed', family: choice.lane.family,
        ...(choice.lane.limitState === 'unknown' ? { limitCheck: 'unavailable' as const } : {}),
        ...(request.kind === 'verifier' ? { evidenceStrength: choice.lane.family === request.lensAuthorFamily ? 'weaker' as const : 'strong' as const } : {}), output };
    } catch (error: unknown) {
      if (controller.signal.aborted || this.clock.now() >= deadline)
        return { status: 'partial', reason: request.signal?.aborted ? 'aborted' : 'deadline' };
      const failure = error instanceof Error ? error : new Error('Review lane failed');
      this.logger.error(new Error(failure.message === 'Lane mutated source' ? 'Lane mutated source' : 'Review lane failed'));
      const precise = /^(output-missing|output-invalid:|status-failed:|timeout|cancelled)/.test(failure.message);
      return { status: 'partial', reason: failure.message === 'Lane mutated source' ? 'source-mutated' :
        precise ? sanitizeReviewFailureMessage(failure.message) :
          `lane-failed: ${sanitizeReviewFailureMessage(choice.lane.id).slice(0, 80)}; ${sanitizeReviewFailureMessage(failure.name).slice(0, 40)}; ${sanitizeReviewFailureMessage(failure.message)}`,
        ...(choice.lane.limitState === 'unknown' ? { limitCheck: 'unavailable' as const } : {}) };
    } finally {
      this.clock.clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
      lease.release();
    }
  }
}
