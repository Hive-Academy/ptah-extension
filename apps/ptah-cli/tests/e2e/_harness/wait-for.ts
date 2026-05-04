/**
 * Async polling helpers for the e2e harness.
 *
 * Predicate-driven only — never `setTimeout(resolve, N)` to wait for events.
 * The `waitFor` helper runs the predicate at `intervalMs` cadence (default 50)
 * until it returns a truthy value or the timeout elapses. `withTimeout` races
 * an arbitrary promise against a wall-clock deadline so a hung child process
 * surfaces as a labelled error instead of a Jest watchdog timeout.
 */

export interface WaitForOptions {
  timeoutMs?: number;
  intervalMs?: number;
  label?: string;
}

export async function waitFor<T>(
  predicate: () => T | Promise<T>,
  opts: WaitForOptions = {},
): Promise<NonNullable<T>> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const intervalMs = opts.intervalMs ?? 50;
  const label = opts.label ?? 'predicate';
  const deadline = Date.now() + timeoutMs;

  // First evaluation synchronously — avoids a 50ms penalty when the
  // predicate is already true (common when racing emitters).
  const initial = await predicate();
  if (initial) return initial as NonNullable<T>;

  return new Promise<NonNullable<T>>((resolve, reject) => {
    const tick = async (): Promise<void> => {
      try {
        const value = await predicate();
        if (value) {
          resolve(value as NonNullable<T>);
          return;
        }
      } catch (err) {
        reject(err);
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`waitFor(${label}) timed out after ${timeoutMs}ms`));
        return;
      }
      setTimeout(tick, intervalMs);
    };
    setTimeout(tick, intervalMs);
  });
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`withTimeout(${label}) exceeded ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
