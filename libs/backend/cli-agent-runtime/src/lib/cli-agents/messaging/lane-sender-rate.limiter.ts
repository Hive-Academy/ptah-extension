/**
 * Per-sender sliding-window rate limit for lane-to-lane messages (Component 15).
 *
 * Memory only. Each key holds the timestamps of the sender's accepted sends in
 * the current window; a key is dropped once its window empties or when the
 * lane expires (`forget`), so the map never outgrows the live senders. There
 * is no timer: windows are pruned on access.
 */

/** At most this many accepted sends per sender in one window. */
export const LANE_SENDER_RATE_LIMIT = 10;
/** Sliding window length in milliseconds. */
export const LANE_SENDER_RATE_WINDOW_MS = 60_000;

export class LaneSenderRateLimiter {
  private readonly sends = new Map<string, number[]>();

  constructor(
    private readonly limit = LANE_SENDER_RATE_LIMIT,
    private readonly windowMs = LANE_SENDER_RATE_WINDOW_MS,
  ) {}

  /** True when one more send now would exceed the limit. Does not record. */
  isLimited(senderId: string, now: number): boolean {
    return this.prune(senderId, now).length >= this.limit;
  }

  /** Count one accepted send. */
  record(senderId: string, now: number): void {
    const window = this.prune(senderId, now);
    window.push(now);
    this.sends.set(senderId, window);
  }

  /** Drop a sender's window (the lane expired). */
  forget(senderId: string): void {
    this.sends.delete(senderId);
  }

  /** Number of senders currently tracked (bounded-memory check). */
  get size(): number {
    return this.sends.size;
  }

  private prune(senderId: string, now: number): number[] {
    const kept = (this.sends.get(senderId) ?? []).filter((at) => now - at < this.windowMs);
    if (kept.length === 0) this.sends.delete(senderId);
    else this.sends.set(senderId, kept);
    return kept;
  }
}
