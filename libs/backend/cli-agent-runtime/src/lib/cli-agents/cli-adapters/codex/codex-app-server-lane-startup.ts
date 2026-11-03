const STARTUP_TIMEOUT_MS = 30_000;

/** Bound both context open and turn start; never leave a timer after settlement. */
export async function withCodexLaneStartupTimeout<T>(
  operation: Promise<T>,
  abort: AbortController,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abort.abort();
          reject(new Error('Codex App Server startup timed out after 30s'));
        }, STARTUP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
