/**
 * RepeatedWarningLimiter — at most one warning per key per interval.
 *
 * A caller that repeats the same refused request every few seconds (a stale
 * worktree root, a probe of an unregistered RPC method) would otherwise write
 * one WARN line per call and turn the log into a storm (main-loop freeze
 * fix-13: 3,453 method-not-found and 3,208 `GIT_ROOT_UNAVAILABLE` lines in 15
 * minutes). The first warning for a key is always written. Repeats inside the
 * interval are counted, not written, and the next written warning for that key
 * carries the count, so the log still records that the calls kept coming.
 */

/** One minute: a repeat source shows up once per minute with its count. */
export const DEFAULT_REPEATED_WARNING_INTERVAL_MS = 60_000;
/** Keys tracked at once; the least recently written key is dropped first. */
export const MAX_TRACKED_WARNING_KEYS = 256;

interface WarningWindow {
  readonly writtenAt: number;
  suppressed: number;
}

export interface RepeatedWarningLimiterOptions {
  readonly intervalMs?: number;
  readonly maxKeys?: number;
  /** Clock; defaults to `Date.now`. */
  readonly now?: () => number;
}

export class RepeatedWarningLimiter {
  private readonly windows = new Map<string, WarningWindow>();
  private readonly intervalMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(options: RepeatedWarningLimiterOptions = {}) {
    this.intervalMs =
      options.intervalMs ?? DEFAULT_REPEATED_WARNING_INTERVAL_MS;
    this.maxKeys = options.maxKeys ?? MAX_TRACKED_WARNING_KEYS;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Whether the warning for `key` should be written now.
   *
   * @returns `null` when the warning is suppressed; otherwise the number of
   *   warnings for `key` suppressed since the last written one (0 the first
   *   time).
   */
  admit(key: string): number | null {
    const now = this.now();
    const window = this.windows.get(key);
    if (window && now - window.writtenAt < this.intervalMs) {
      window.suppressed += 1;
      return null;
    }
    const suppressed = window?.suppressed ?? 0;
    // Delete before set so the key moves to the end of the insertion order,
    // which makes the first key the least recently written one.
    this.windows.delete(key);
    this.windows.set(key, { writtenAt: now, suppressed: 0 });
    if (this.windows.size > this.maxKeys) {
      const oldest = this.windows.keys().next().value;
      if (oldest !== undefined) this.windows.delete(oldest);
    }
    return suppressed;
  }
}
