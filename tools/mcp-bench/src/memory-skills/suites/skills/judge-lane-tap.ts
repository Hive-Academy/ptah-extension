/**
 * A pass-through observer of the lane runner for the judge agreement suites
 * (benchmark-design.md 4.3: "pinned model id and prompt SHA-256 recorded").
 *
 * It forwards every `run` call UNCHANGED to the runner it wraps (in the bench
 * host: the installed record/replay double, which in record mode wraps the
 * real `LaneRunnerService`) and returns its result untouched. It only notes
 * what the product sent and what came back: the lane, the sha256 of the
 * system prompt (the judge rubric rides `systemPromptAppend`,
 * `skill-judge.service.ts:171-177`) and of the clipped-half prompt, the model
 * the lane resolved (`LaneRun.lane.model`), the status and the raw text. It
 * never decides anything, so the judge it serves is still the product's.
 */

import { createHash } from 'node:crypto';

import type {
  LaneRunnerService,
  LaneRunRequest,
  LaneRunResult,
} from '@ptah-extension/skill-synthesis';

/** The consumed surface of the lane runner. */
export type LaneRunnerLike = Pick<LaneRunnerService, 'run'>;

export interface LaneCall {
  readonly laneId: string;
  readonly systemPromptSha256: string;
  readonly promptSha256: string;
  readonly status: LaneRunResult['status'] | 'threw';
  /** `LaneRun.lane.model` of an `ok` run; `null` otherwise. */
  readonly model: string | null;
  /** Raw assistant text of an `ok` run (bench data dir only, never a case). */
  readonly text: string | null;
  /** Failure or unavailability reason, or the thrown message. */
  readonly reason: string | null;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class LaneTap implements LaneRunnerLike {
  private readonly observed: LaneCall[] = [];

  constructor(private readonly inner: LaneRunnerLike) {}

  /** Every call so far, in order. */
  get calls(): readonly LaneCall[] {
    return this.observed;
  }

  async run(req: LaneRunRequest): Promise<LaneRunResult> {
    const base = {
      laneId: req.laneId,
      systemPromptSha256: sha256(req.systemPromptAppend ?? ''),
      promptSha256: sha256(req.prompt),
    };
    let result: LaneRunResult;
    try {
      result = await this.inner.run(req);
    } catch (error: unknown) {
      this.observed.push({
        ...base,
        status: 'threw',
        model: null,
        text: null,
        reason: errorMessage(error),
      });
      throw error;
    }
    this.observed.push({
      ...base,
      status: result.status,
      model: result.status === 'ok' ? result.run.lane.model : null,
      text: result.status === 'ok' ? result.run.text : null,
      reason:
        result.status === 'failed'
          ? result.failure.reason
          : result.status === 'unavailable'
            ? result.reason
            : null,
    });
    return result;
  }
}
