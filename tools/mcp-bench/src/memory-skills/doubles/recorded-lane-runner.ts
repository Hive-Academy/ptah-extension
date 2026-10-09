/**
 * Record/replay double for `LaneRunnerService` (benchmark-design.md 6.2).
 *
 * The surface skill-synthesis consumes is `run()` only (batches.md
 * Assumptions: 10 call sites in 7 files), so the double is structurally
 * `Pick<LaneRunnerService, 'run'>` and the types are imported type-only from
 * `@ptah-extension/skill-synthesis` — allowed for the `type:tool` tag.
 *
 * Same key and miss semantics as `RecordedCuratorLlm`: the key is
 * `sha256('run' + canonical JSON of the request's model-facing fields)`; a
 * replay miss throws `CassetteMissError` and replay holds no real runner, so
 * it can never fall through to a live lane call.
 *
 * Keyed fields are `laneId`, `prompt`, `systemPromptAppend`, `cwd`,
 * `maxTurns`, `outputSchema` and `userInitiated`: everything the model call
 * itself depends on. Excluded are `signal` (not serialisable), and
 * `attempt`, `queueItemId`, `mcpServerRunning` and `mcpPort` — run-context
 * and host state that differ between the record host and CI, never reach the
 * model, and would make every cassette miss across machines.
 *
 * The `pause` hook runs once per call before the double acts; Batch 22's
 * scripted interleaving uses it to hold a run at a chosen point.
 */

import type {
  LaneRunRequest,
  LaneRunResult,
  LaneRunnerService,
} from '@ptah-extension/skill-synthesis';

import {
  CassetteRecordRefusalError,
  CassetteStore,
  CassetteUsage,
  cassetteKey,
  sha256Hex,
} from './cassette-store';

/** The consumed surface of the lane runner (batches.md Assumptions). */
export type LaneRunnerDouble = Pick<LaneRunnerService, 'run'>;

export interface RecordedLaneRunnerOptions {
  readonly store: CassetteStore;
  /** Model id written into every entry (design 6.2: a cassette set has one). */
  readonly model: string;
  /** The real runner to wrap. Required in record mode; refused in replay. */
  readonly inner?: LaneRunnerDouble;
  /** Test seam: awaited once per `run` call, before the double acts. */
  readonly pause?: () => void | Promise<void>;
  /**
   * Record-mode opt-in to persist a non-ok result (a transient lane failure
   * would otherwise replay forever). The double refuses the recording with
   * {@link CassetteRecordRefusalError} unless this is set.
   */
  readonly recordFailures?: boolean;
}

/** The cassette key of one `run` call. */
export function laneRunKey(req: LaneRunRequest): string {
  return cassetteKey('run', {
    laneId: req.laneId,
    prompt: req.prompt,
    systemPromptAppend: req.systemPromptAppend,
    cwd: req.cwd,
    maxTurns: req.maxTurns,
    outputSchema: req.outputSchema,
    userInitiated: req.userInitiated,
  });
}

export class RecordedLaneRunner implements LaneRunnerDouble {
  private readonly inner: LaneRunnerDouble | undefined;

  constructor(private readonly options: RecordedLaneRunnerOptions) {
    const mode = options.store.mode;
    if (mode === 'record' && !options.inner) {
      throw new Error('RecordedLaneRunner: record mode requires `inner`');
    }
    if (mode === 'replay' && options.inner) {
      throw new Error(
        'RecordedLaneRunner: replay mode refuses `inner` — a miss must ' +
          'surface as CassetteMissError, never as a live lane call',
      );
    }
    this.inner = options.inner;
  }

  async run(req: LaneRunRequest): Promise<LaneRunResult> {
    await this.options.pause?.();
    const key = laneRunKey(req);
    if (this.options.store.mode === 'replay') {
      return this.options.store.lookup('run', key).response as LaneRunResult;
    }
    if (!this.inner) {
      throw new Error('RecordedLaneRunner: record mode requires `inner`');
    }
    const response = await this.inner.run(req);
    if (response.status !== 'ok' && !this.options.recordFailures) {
      throw new CassetteRecordRefusalError(
        'run',
        key,
        `lane result status '${response.status}'`,
      );
    }
    this.options.store.record({
      key,
      method: 'run',
      model: this.options.model,
      promptSha: sha256Hex(req.prompt),
      response,
      usage: usageOf(response),
    });
    return response;
  }
}

/** Token spend of an `ok` run, when the lane reported one. */
function usageOf(result: LaneRunResult): CassetteUsage | undefined {
  if (result.status !== 'ok') {
    return undefined;
  }
  const usage = result.run.usage;
  if (
    usage.inputTokens === undefined &&
    usage.outputTokens === undefined &&
    usage.costUsd === undefined
  ) {
    return undefined;
  }
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
    costUsd: usage.costUsd,
  };
}
