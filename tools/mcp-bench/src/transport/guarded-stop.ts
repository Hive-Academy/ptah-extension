/**
 * Stopping a bench host after something already failed, without ever losing a
 * guard verdict. A host's `stop()` rejects with a guard error when the run
 * touched (or held) the user's real state; that error voids the whole run, so
 * it must outrank whatever failed first. Every cleanup path in the runner goes
 * through {@link stopThenRethrow} or {@link runThenStop}.
 */

import {
  BenchHeldRealStateError,
  ConcurrentWriterError,
  RealStateChangedError,
} from './real-state-guard';

/** A guard error: the run is void (or the environment refused it), never a suite failure. */
export function isGuardError(error: unknown): boolean {
  return (
    error instanceof RealStateChangedError ||
    error instanceof BenchHeldRealStateError ||
    error instanceof ConcurrentWriterError
  );
}

/**
 * Stops the host after `error`, then rethrows. A guard error from `stop()`
 * wins: it is rethrown with `error` attached as its `cause` (and named in its
 * message). Any other stop failure is dropped in favour of `error`, which is
 * what the caller needs to report.
 */
export async function stopThenRethrow(
  stop: () => Promise<unknown>,
  error: unknown,
): Promise<never> {
  try {
    await stop();
  } catch (stopError: unknown) {
    if (isGuardError(stopError)) {
      const guard = stopError as Error;
      if (guard.cause === undefined) guard.cause = error;
      guard.message = `${guard.message} (raised while stopping the host after: ${error instanceof Error ? error.message : String(error)})`;
      throw guard;
    }
  }
  throw error;
}

/** Runs `body`, then stops the host; on a failure of `body`, {@link stopThenRethrow}. */
export async function runThenStop<T>(
  stop: () => Promise<unknown>,
  body: () => Promise<T>,
): Promise<T> {
  let value: T;
  try {
    value = await body();
  } catch (error: unknown) {
    return stopThenRethrow(stop, error);
  }
  await stop();
  return value;
}
