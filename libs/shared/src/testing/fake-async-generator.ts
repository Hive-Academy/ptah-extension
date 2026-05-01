/**
 * Generic AbortSignal-aware async generator for tests.
 *
 * Pattern generalized from
 * `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.spec.ts:13-42`
 * which was hand-rolled for `CodexThreadEvent`. This version accepts any `T[]`
 * and an optional AbortSignal / inter-item delay so downstream specs can
 * simulate streaming + cancellation without reimplementing the shape.
 */

export interface FakeAsyncGeneratorOptions {
  /** Optional abort signal; `next()` throws `AbortError` if aborted. */
  signal?: AbortSignal;
  /** Optional cooperative delay between items (milliseconds). Default `0`. */
  delayMs?: number;
}

/**
 * Error name used when the generator is aborted via the provided signal.
 * Matches the `NodeJS` convention so existing `err.name === 'AbortError'`
 * checks keep working.
 */
const ABORT_ERROR_NAME = 'AbortError';

function makeAbortError(): Error {
  return Object.assign(new Error('Aborted'), { name: ABORT_ERROR_NAME });
}

/**
 * Create an AbortSignal-aware async generator that yields `items` in order.
 *
 * - If the signal is already aborted, the generator throws on the first `next()`.
 * - If the signal aborts mid-iteration, the next `next()` call throws `AbortError`.
 * - `return()` and `throw()` behave per the async-iterator protocol so
 *   consumers can use `for await ... of` safely.
 */
export function createFakeAsyncGenerator<T>(
  items: readonly T[],
  opts: FakeAsyncGeneratorOptions = {},
): AsyncGenerator<T> {
  const { signal, delayMs = 0 } = opts;
  let index = 0;
  let done = false;

  const self = {
    [Symbol.asyncIterator](): AsyncGenerator<T> {
      return self as AsyncGenerator<T>;
    },

    async next(): Promise<IteratorResult<T>> {
      if (done) {
        return { done: true, value: undefined as never };
      }
      if (signal?.aborted) {
        done = true;
        throw makeAbortError();
      }
      if (delayMs > 0) {
        await waitWithAbort(delayMs, signal);
      }
      if (index < items.length) {
        const value = items[index++] as T;
        return { done: false, value };
      }
      done = true;
      return { done: true, value: undefined as never };
    },

    async return(value?: T): Promise<IteratorResult<T>> {
      done = true;
      return { done: true, value: value as T };
    },

    async throw(err?: unknown): Promise<IteratorResult<T>> {
      done = true;
      throw err instanceof Error ? err : new Error(String(err));
    },

    [Symbol.asyncDispose](): PromiseLike<void> {
      done = true;
      return Promise.resolve();
    },
  } as AsyncGenerator<T>;
  return self;
}

/**
 * Wait `ms` milliseconds but reject early if `signal` aborts during the wait.
 * Exported internal helper used only by `createFakeAsyncGenerator`.
 */
function waitWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeAbortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(makeAbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
