/**
 * The per-case safety cap (benchmark-design.md 4.4: a real-time cap of 120 s
 * per case aborts a hung case as `fail`, reason `safety-cap`) with the R11
 * mitigation: a capped case is retried once before it counts, so one slow CI
 * machine does not flip a deterministic case and break the R-C4 projection.
 * Every attempt's runtime is recorded.
 *
 * Used by offline suites in the runner parent and by host suites in the bench
 * host; it imports nothing but Node, so either side may load it.
 *
 * A JavaScript promise cannot be killed. On the cap the attempt's
 * `AbortSignal` fires and the attempt is abandoned: its later settlement is
 * observed and dropped, never left unhandled. A case that ignores the signal
 * may keep running in the background; suites pass the signal to every
 * cancellable call they make.
 */

/** Real-time cap per attempt (design 4.4). */
export const SAFETY_CAP_MS = 120_000;
/** Case `error` and abort reason for a capped case. */
export const SAFETY_CAP_ERROR = 'safety-cap';
/** One retry after a cap (R11). */
const MAX_ATTEMPTS = 2;

export type CaseRun<T> =
  | {
      readonly outcome: 'completed';
      readonly value: T;
      /** Runtime of the attempt that completed. */
      readonly latencyMs: number;
      readonly attempts: number;
      readonly attemptMs: readonly number[];
    }
  | {
      readonly outcome: typeof SAFETY_CAP_ERROR;
      /** Runtime of the last capped attempt. */
      readonly latencyMs: number;
      readonly attempts: number;
      readonly attemptMs: readonly number[];
    };

export interface CaseRunnerOptions {
  /** Default {@link SAFETY_CAP_MS}. */
  readonly capMs?: number;
  /** Monotonic clock in ms. Default `performance.now`. */
  readonly now?: () => number;
}

const CAPPED = Symbol('capped');

/**
 * Run one case under the safety cap. A capped attempt is retried once; a
 * second cap returns `outcome: 'safety-cap'`. Any other failure of an attempt
 * propagates unchanged and is not retried (it is not a timing problem).
 */
export async function runCaseWithSafetyCap<T>(
  run: (signal: AbortSignal) => Promise<T>,
  options: CaseRunnerOptions = {},
): Promise<CaseRun<T>> {
  const capMs = options.capMs ?? SAFETY_CAP_MS;
  if (!Number.isFinite(capMs) || capMs <= 0) {
    throw new RangeError(`safety cap must be a positive number, got ${capMs}`);
  }
  const now = options.now ?? (() => performance.now());
  const attemptMs: number[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const capped = new Promise<typeof CAPPED>((done) => {
      timer = setTimeout(() => done(CAPPED), capMs);
    });
    const started = now();
    // A synchronous throw becomes a rejection, so the timer is still cleared.
    const work = (async () => run(controller.signal))();
    try {
      const settled = await Promise.race([work, capped]);
      const elapsed = now() - started;
      attemptMs.push(elapsed);
      if (settled !== CAPPED) {
        return {
          outcome: 'completed',
          value: settled,
          latencyMs: elapsed,
          attempts: attempt,
          attemptMs,
        };
      }
      controller.abort(SAFETY_CAP_ERROR);
      // Abandoned: its later rejection must not surface as unhandled.
      work.catch(() => undefined);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    outcome: SAFETY_CAP_ERROR,
    latencyMs: attemptMs[attemptMs.length - 1] ?? 0,
    attempts: MAX_ATTEMPTS,
    attemptMs,
  };
}
