/**
 * The one Windows-transient retry rule, in the two flavours this lib needs.
 *
 * Antivirus scanners, the Windows search indexer and an editor holding a file
 * open all produce EBUSY, EPERM, EACCES or ENOTEMPTY on an operation that would
 * succeed 50ms later (E21). Three attempts with backoff turns the overwhelming
 * majority of those into a success; the rest become a reported failure for ONE
 * entry instead of an exception that aborts a pass.
 *
 * **Why a SYNC variant exists.** The copy engine is async and uses
 * {@link withWindowsRetry}. Every PERSISTENCE write in this lib is synchronous
 * and has to stay that way: `ManagedManifestStore.save` runs inside the
 * reconciler's synchronous bookkeeping, `HarnessGitignoreWriter.apply` is a
 * pure read-modify-write, and `McpIntentStore.record`/`forget` are called from
 * synchronous RPC bookkeeping. Making them async would ripple through four
 * callers apiece to buy nothing — so the retry meets them where they are.
 * {@link withWindowsRetrySync} blocks the thread for at most 40ms + 80ms, and
 * only on the rare path where a write actually failed.
 */

/** Errors worth a second attempt: transient Windows sharing violations. */
export const RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  'EBUSY',
  'EPERM',
  'EACCES',
  'ENOTEMPTY',
]);

export const MAX_WRITE_ATTEMPTS = 3;

const RETRY_BASE_MS = 40;

export function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/** `CODE: message` when the error carries an errno code, the message otherwise. */
export function describeError(error: unknown): string {
  const code = errorCode(error);
  const message = error instanceof Error ? error.message : String(error);
  return code === undefined ? message : `${code}: ${message}`;
}

export function isRetryableError(error: unknown): boolean {
  const code = errorCode(error);
  return code !== undefined && RETRYABLE_ERROR_CODES.has(code);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Block the calling thread for `ms`.
 *
 * `Atomics.wait` on a private buffer rather than a spin loop: it parks the
 * thread instead of burning a core, and it is the only real sleep available to
 * synchronous Node code.
 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Run `operation`, retrying the Windows-transient failure codes. */
export async function withWindowsRetry<T>(
  operation: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    try {
      return await operation();
    } catch (error: unknown) {
      lastError = error;
      if (!isRetryableError(error)) throw error;
      if (attempt < MAX_WRITE_ATTEMPTS) await sleep(RETRY_BASE_MS * attempt);
    }
  }
  throw lastError;
}

/** {@link withWindowsRetry} for synchronous filesystem calls. */
export function withWindowsRetrySync<T>(operation: () => T): T {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    try {
      return operation();
    } catch (error: unknown) {
      lastError = error;
      if (!isRetryableError(error)) throw error;
      if (attempt < MAX_WRITE_ATTEMPTS) sleepSync(RETRY_BASE_MS * attempt);
    }
  }
  throw lastError;
}
