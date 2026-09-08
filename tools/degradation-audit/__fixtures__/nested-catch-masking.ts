// Planted fixture for the degradation-audit self-test (Revision 1, S-2).
// The OUTER catch genuinely swallows `outerError` — no throw, no logging of
// ITS OWN error, just a literal return. The nested try/catch only logs an
// unrelated cleanup failure. Before the fix, the inner `.error(...)` call
// satisfied the outer catch's `hasErrorCall` check and this produced zero
// violations. It must now produce exactly one `catch-return-sentinel`.

export function fetchWithCleanup(path: string): string | null {
  try {
    return loadFile(path);
  } catch (outerError: unknown) {
    try {
      cleanupTemp();
    } catch (innerError: unknown) {
      logger.error('cleanup failed', innerError);
    }
    return null;
  }
}

declare function loadFile(path: string): string;
declare function cleanupTemp(): void;
declare const logger: { error: (...args: unknown[]) => void };
