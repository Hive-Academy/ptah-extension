import { inject, injectable } from 'tsyringe';
import { ShaSchema, type Lens } from '@ptah-extension/review-contracts';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { z } from 'zod';
import { ReviewLaneAdmissionService, REVIEW_LANE_TOKENS, type IReviewLaneClock } from './review-lane-admission.service';
import { ReviewLaneSelector, type ReviewLaneCapability, type ReviewLaneKind } from './review-lane-selector';
import { ReviewOutputParser } from './review-output.parser';

export interface IReviewLaneGateway {
  list(): Promise<{ lanes: ReviewLaneCapability[]; maxConcurrentAgents: number }>;
  spawn(input: { laneId: string; cwd: string; prompt: string; signal: AbortSignal }): Promise<string>;
}

/** The adapter owns creation and exact-SHA, read-only materialization of src. */
export interface IReviewLaneFiles {
  prepare(attemptRoot: string, headSha: string): Promise<void>;
  sourceChecksum(attemptRoot: string): Promise<string>;
}

export interface ReviewLaneRequest {
  prKey: string;
  attemptId: string;
  attemptRoot: string;
  headSha: string;
  kind: ReviewLaneKind;
  prompt: string;
  runDeadlineMs: number;
  lensAuthorFamily?: string;
}

export type ReviewLaneResult =
  | { status: 'completed'; family: string; output: ReturnType<ReviewOutputParser['parseLens']> | ReturnType<ReviewOutputParser['parseVerdict']> }
  | { status: 'partial'; reason: string };

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
  ) {}

  async run(request: ReviewLaneRequest): Promise<ReviewLaneResult> {
    ShaSchema.parse(request.headSha);
    z.string().min(1).max(128).parse(request.attemptId);
    if (!Number.isFinite(request.runDeadlineMs)) throw new Error('Invalid run deadline');
    const limit = request.kind === 'triage' ? 180_000 : request.kind === 'verifier' ? 300_000 : 480_000;
    const deadline = Math.min(request.runDeadlineMs, this.clock.now() + limit);
    if (this.clock.now() >= deadline) return { status: 'partial', reason: 'deadline' };
    const capacity = z.object({
      lanes: z.array(z.object({ id: z.string().min(1), family: z.string().min(1), limitState: z.enum(['confirmed-room', 'unknown', 'at-limit']) }).strict()).max(100),
      maxConcurrentAgents: z.number().int().nonnegative(),
    }).strict().parse(await this.gateway.list());
    if (this.clock.now() >= deadline) return { status: 'partial', reason: 'deadline' };
    const choice = this.selector.select([request.kind], capacity.lanes, request.lensAuthorFamily).selected[0];
    if (!choice) return { status: 'partial', reason: 'no-confirmed-room' };
    const lease = this.admission.acquire(`${request.prKey}:${request.attemptId}`, deadline, capacity.maxConcurrentAgents);
    if (lease.status === 'partial') return { status: 'partial', reason: lease.reason };
    const controller = new AbortController();
    const timer = this.clock.setTimeout(() => controller.abort(), Math.max(0, deadline - this.clock.now()));
    try {
      await this.files.prepare(request.attemptRoot, request.headSha);
      const before = await this.files.sourceChecksum(request.attemptRoot);
      if (controller.signal.aborted || this.clock.now() >= deadline) return { status: 'partial', reason: 'deadline' };
      let raw: string | undefined;
      let spawnError: unknown;
      try {
        raw = await this.gateway.spawn({ laneId: choice.lane.id, cwd: request.attemptRoot, prompt: request.prompt, signal: controller.signal });
      } catch (error: unknown) { spawnError = error; }
      const after = await this.files.sourceChecksum(request.attemptRoot);
      if (before !== after) throw new Error('Lane mutated source');
      if (controller.signal.aborted || this.clock.now() >= deadline) return { status: 'partial', reason: 'deadline' };
      if (spawnError !== undefined) throw spawnError;
      if (raw === undefined) throw new Error('Lane returned no output');
      const output = request.kind === 'verifier'
        ? this.parser.parseVerdict(raw, request.headSha, choice.lane.family)
        : this.parser.parseLens(raw, request.headSha, request.kind === 'triage' ? undefined : request.kind as Lens);
      return { status: 'completed', family: choice.lane.family, output };
    } catch (error: unknown) {
      const failure = error instanceof Error ? error : new Error('Review lane failed');
      this.logger.error(new Error(failure.message === 'Lane mutated source' ? 'Lane mutated source' : 'Review lane failed'));
      return { status: 'partial', reason: failure.message === 'Lane mutated source' ? 'source-mutated' : 'lane-failed' };
    } finally {
      this.clock.clearTimeout(timer);
      lease.release();
    }
  }
}
