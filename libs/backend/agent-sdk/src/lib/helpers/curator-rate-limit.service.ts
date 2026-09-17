import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';

const HOUR_MS = 3_600_000;

interface BucketState {
  windowStartMs: number;
  count: number;
}

export type RateLimitDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly resetAt: number;
      readonly usedThisWindow: number;
      readonly limit: number;
    };

export interface RateLimitSnapshot {
  readonly windowStartMs: number;
  readonly count: number;
}

@injectable()
export class CuratorRateLimitService {
  private readonly buckets = new Map<string, BucketState>();

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  tryAcquire(key: string, maxPerHour: number): RateLimitDecision {
    if (!Number.isFinite(maxPerHour) || maxPerHour <= 0) {
      return { allowed: true };
    }
    const now = Date.now();
    const currentWindow = Math.floor(now / HOUR_MS) * HOUR_MS;
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.windowStartMs !== currentWindow) {
      bucket = { windowStartMs: currentWindow, count: 0 };
      this.buckets.set(key, bucket);
    }
    if (bucket.count >= maxPerHour) {
      this.logger.debug('[CuratorRateLimitService] bucket exhausted', {
        key,
        count: bucket.count,
        limit: maxPerHour,
        resetAt: currentWindow + HOUR_MS,
      });
      return {
        allowed: false,
        resetAt: currentWindow + HOUR_MS,
        usedThisWindow: bucket.count,
        limit: maxPerHour,
      };
    }
    bucket.count++;
    return { allowed: true };
  }

  /**
   * Give back one slot acquired in the CURRENT window, for a caller whose work
   * was deferred without dispatching (TASK_2026_437 C14 f: a curation pass held
   * by the network back-off). A slot from a window that has already rolled over
   * is not returned — that window's budget no longer exists — and a bucket is
   * never taken below zero.
   */
  refund(key: string): void {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.count <= 0) return;
    const currentWindow = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
    if (bucket.windowStartMs !== currentWindow) return;
    bucket.count--;
  }

  snapshot(key: string): RateLimitSnapshot | null {
    const bucket = this.buckets.get(key);
    if (!bucket) {
      return null;
    }
    return { windowStartMs: bucket.windowStartMs, count: bucket.count };
  }
}
