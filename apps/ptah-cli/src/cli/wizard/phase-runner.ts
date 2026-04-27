/**
 * `runPhase` — dual-mode phase runner.
 *
 * TASK_2026_104 Sub-batch B9c. The single most-complex new abstraction in
 * batch B9; consumed by the upcoming `setup.ts` orchestrator (B9d).
 *
 * Two execution shapes share one emission contract:
 *
 *   sync             — `await fn.run()` resolves with the result. Success
 *                      emits `setup.phase.complete { phase, percent: 100 }`,
 *                      failure runs `rollback?` then emits
 *                      `setup.phase.error { phase, error }`.
 *
 *   async-broadcast  — `fn.run()` returns a synchronous accept ack (e.g.
 *                      `wizard:submit-selection` returns `{ success: true }`).
 *                      The actual completion arrives as an EventEmitter event
 *                      on `fn.adapter` whose name matches `fn.completionEvent`.
 *                      We register the listener BEFORE calling `fn.run()` to
 *                      avoid a race; we also race the wait against
 *                      `setTimeout(timeoutMs)`. Progress events listed in
 *                      `fn.progressEvents` are forwarded as
 *                      `setup.phase.progress { phase, ...payload }`.
 *
 * Both shapes:
 *   - Emit `setup.phase.start { phase }` synchronously before `run()`.
 *   - Always detach every listener in `finally`. (Listener-leak risk is the
 *     primary correctness concern — see spec § B9c risk.)
 *   - Run `rollback` (if provided) on failure. Rollback throwing must NOT
 *     mask the original error — we catch + log and continue.
 *   - Return a `PhaseResult { phase, status, duration_ms, result?, error? }`.
 *     The runner NEVER throws — orchestrator code reads `status` to decide
 *     whether to halt the pipeline.
 */

import type { EventEmitter } from 'events';

import type { Formatter } from '../output/formatter.js';

/** Result envelope for a single `runPhase` invocation. */
export interface PhaseResult<T = unknown> {
  /** Phase name (matches the `name` argument). */
  phase: string;
  /** Outcome — `'skipped'` is reserved for the orchestrator (not produced here). */
  status: 'completed' | 'failed' | 'skipped';
  /** Wall-clock duration from `runPhase` entry to settle. */
  duration_ms: number;
  /** Raw result from `fn.run()` / `extractResult(...)` on success. */
  result?: T;
  /** Failure message (`Error.message` or stringified value). */
  error?: string;
}

/**
 * Discriminated union describing the two execution shapes. Consumers narrow
 * via `fn.kind`.
 */
export type PhaseFn<T> =
  | {
      kind: 'sync';
      /** Returns the phase result directly. */
      run: () => Promise<T>;
    }
  | {
      kind: 'async-broadcast';
      /**
       * Returns the synchronous accept ack (the value is discarded — the
       * real result arrives via `completionEvent`).
       */
      run: () => Promise<unknown>;
      /** Event name on `adapter` that signals the phase has finished. */
      completionEvent: string;
      /** Event names whose payloads are forwarded as `setup.phase.progress`. */
      progressEvents?: string[];
      /** Failure timeout (ms). On timeout, the phase is treated as failed. */
      timeoutMs: number;
      /** EventEmitter instance to attach listeners to (typically `ctx.pushAdapter`). */
      adapter: EventEmitter;
      /** Project the completion payload onto the typed result `T`. */
      extractResult: (completionPayload: unknown) => T;
      /**
       * Inspect the completion payload. Return `null` on success or an error
       * message string on logical failure (e.g. `payload.success === false`).
       */
      isFailure: (completionPayload: unknown) => string | null;
    };

/** Cross-mode options shared by both branches. */
export interface RunPhaseOptions {
  /** Output channel for `setup.phase.{start,progress,complete,error}`. */
  formatter: Formatter;
  /**
   * Optional rollback closure. Invoked on failure (sync exception, async-
   * broadcast timeout, or `isFailure` returning non-null). Rollback errors
   * are logged but never re-thrown; they MUST NOT mask the original error.
   */
  rollback?: () => Promise<void>;
}

/**
 * Run a single phase and emit lifecycle notifications. Never throws — wraps
 * every failure as `{ status: 'failed', error }`.
 */
export async function runPhase<T>(
  name: string,
  fn: PhaseFn<T>,
  opts: RunPhaseOptions,
): Promise<PhaseResult<T>> {
  const startTs = Date.now();
  await opts.formatter.writeNotification('setup.phase.start', { phase: name });

  try {
    if (fn.kind === 'sync') {
      const result = await fn.run();
      const durationMs = Date.now() - startTs;
      await opts.formatter.writeNotification('setup.phase.complete', {
        phase: name,
        percent: 100,
      });
      return {
        phase: name,
        status: 'completed',
        duration_ms: durationMs,
        result,
      };
    }
    return await runAsyncBroadcast(name, fn, opts, startTs);
  } catch (error) {
    return await failPhase(name, opts, startTs, error);
  }
}

// ---------------------------------------------------------------------------
// async-broadcast branch — extracted for readability.
// ---------------------------------------------------------------------------

async function runAsyncBroadcast<T>(
  name: string,
  fn: Extract<PhaseFn<T>, { kind: 'async-broadcast' }>,
  opts: RunPhaseOptions,
  startTs: number,
): Promise<PhaseResult<T>> {
  const adapter = fn.adapter;
  const progressEvents = fn.progressEvents ?? [];

  // Capture the completion payload via a deferred promise. The listener is
  // registered BEFORE `fn.run()` to avoid a race where `run()` triggers the
  // broadcast synchronously (in tests via `emit()` from a microtask).
  let completionListener: ((payload: unknown) => void) | undefined;
  const completionPromise = new Promise<unknown>((resolve) => {
    completionListener = (payload: unknown): void => {
      resolve(payload);
    };
    adapter.once(fn.completionEvent, completionListener);
  });

  // Forward progress events as `setup.phase.progress { phase, ...payload }`.
  // We track each (event, listener) pair so `finally` can detach exactly the
  // listeners we registered (never `removeAllListeners` — sibling phases may
  // share the same emitter).
  const progressListeners: Array<{
    event: string;
    listener: (payload: unknown) => void;
  }> = [];
  for (const event of progressEvents) {
    const listener = (payload: unknown): void => {
      const merged = mergeProgress(name, payload);
      // Fire-and-forget — formatter writes are serial via `StdoutWriter`.
      void opts.formatter.writeNotification('setup.phase.progress', merged);
    };
    adapter.on(event, listener);
    progressListeners.push({ event, listener });
  }

  // Timeout handle is captured so `finally` can clear it on success.
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(
        new Error(
          `Phase '${name}' timed out after ${fn.timeoutMs}ms waiting for '${fn.completionEvent}'`,
        ),
      );
    }, fn.timeoutMs);
  });

  try {
    // Submit the request — the synchronous accept resolves quickly; the real
    // completion arrives via the event listener attached above.
    await fn.run();

    const completionPayload = await Promise.race<unknown>([
      completionPromise,
      timeoutPromise,
    ]);

    // Inspect the payload — `isFailure` returns null on success, string on
    // logical failure (e.g. `payload.success === false`).
    const failureMessage = fn.isFailure(completionPayload);
    if (failureMessage !== null) {
      throw new Error(failureMessage);
    }

    const result = fn.extractResult(completionPayload);
    const durationMs = Date.now() - startTs;
    await opts.formatter.writeNotification('setup.phase.complete', {
      phase: name,
      percent: 100,
    });
    return {
      phase: name,
      status: 'completed',
      duration_ms: durationMs,
      result,
    };
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
    if (completionListener) {
      adapter.off(fn.completionEvent, completionListener);
    }
    for (const { event, listener } of progressListeners) {
      adapter.off(event, listener);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers — module-private.
// ---------------------------------------------------------------------------

/**
 * Build a `setup.phase.progress` payload by merging the phase name with the
 * raw progress payload. Object payloads are spread in; non-object payloads
 * are placed under a `data` key so the notification stays object-shaped.
 */
function mergeProgress(
  phase: string,
  payload: unknown,
): Record<string, unknown> {
  if (
    payload !== null &&
    typeof payload === 'object' &&
    !Array.isArray(payload)
  ) {
    return { phase, ...(payload as Record<string, unknown>) };
  }
  return { phase, data: payload };
}

/**
 * Common failure path — invoke rollback (catching), emit error notification,
 * return a failed `PhaseResult`. Rollback failures are logged to stderr but
 * never re-thrown so the original error remains the surface failure.
 */
async function failPhase<T>(
  name: string,
  opts: RunPhaseOptions,
  startTs: number,
  error: unknown,
): Promise<PhaseResult<T>> {
  const message = error instanceof Error ? error.message : String(error);

  if (opts.rollback) {
    try {
      await opts.rollback();
    } catch (rollbackError) {
      const rollbackMessage =
        rollbackError instanceof Error
          ? rollbackError.message
          : String(rollbackError);
      // Surface to stderr so CI logs see it; never throw — must not mask the
      // original error (spec § B9c sub-task 1).
      process.stderr.write(
        `[ptah] phase '${name}' rollback failed: ${rollbackMessage}\n`,
      );
    }
  }

  const durationMs = Date.now() - startTs;
  await opts.formatter.writeNotification('setup.phase.error', {
    phase: name,
    error: message,
  });
  return {
    phase: name,
    status: 'failed',
    duration_ms: durationMs,
    error: message,
  };
}
