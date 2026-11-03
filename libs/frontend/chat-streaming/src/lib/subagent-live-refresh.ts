import type { FlatStreamEventUnion } from '@ptah-extension/shared';

/** Consecutive failed live refreshes before the store warns (once). */
export const LIVE_REFRESH_WARN_AFTER = 3;
/** Missing-transcript reads retried at the lane interval before backing off. */
export const LIVE_REFRESH_MISSING_GRACE = 3;
const BACKOFF_BASE_MS = 5000;
const BACKOFF_MAX_MS = 60000;

interface LiveRefreshState {
  failures: number;
  missing: number;
  retryAt: number;
  warned: boolean;
  fingerprint?: string;
}

function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_MAX_MS);
}

function fingerprintOf(snapshot: readonly FlatStreamEventUnion[]): string {
  return `${snapshot.length}:${snapshot[snapshot.length - 1]?.id ?? ''}`;
}

/**
 * Per-agent bookkeeping for silent live history refreshes: exponential
 * backoff after failures or a transcript that stays missing, a single
 * warning when failures persist, and the fingerprint of the last merged
 * snapshot so an unchanged transcript is not merged again.
 */
export class SubagentLiveRefreshTracker {
  private readonly states = new Map<string, LiveRefreshState>();

  canRefresh(key: string, now: number): boolean {
    return now >= (this.states.get(key)?.retryAt ?? 0);
  }

  /**
   * A read succeeded: clears failure and missing counts. True when the
   * snapshot equals the last one merged for `key`.
   */
  unchanged(key: string, snapshot: readonly FlatStreamEventUnion[]): boolean {
    const state = this.state(key);
    state.failures = 0;
    state.missing = 0;
    state.retryAt = 0;
    state.warned = false;
    return state.fingerprint === fingerprintOf(snapshot);
  }

  /** Records the snapshot as merged; call only after the merge succeeded. */
  merged(key: string, snapshot: readonly FlatStreamEventUnion[]): void {
    this.state(key).fingerprint = fingerprintOf(snapshot);
  }

  /** Records a failure; true exactly once when the failures persist. */
  failed(key: string, now: number): boolean {
    const state = this.state(key);
    state.failures++;
    state.retryAt = now + backoffMs(state.failures);
    if (state.warned || state.failures < LIVE_REFRESH_WARN_AFTER) return false;
    state.warned = true;
    return true;
  }

  /**
   * Records a read that found no transcript. A starting agent's file appears
   * shortly, so the first few reads keep the lane interval; after that the
   * reads back off like failures, without a warning (an agent may never get
   * a transcript the reader can resolve).
   */
  missing(key: string, now: number): void {
    const state = this.state(key);
    state.missing++;
    const beyondGrace = state.missing - LIVE_REFRESH_MISSING_GRACE;
    if (beyondGrace > 0) state.retryAt = now + backoffMs(beyondGrace);
  }

  /** Forget the last snapshot, e.g. after the tree was rebuilt elsewhere. */
  reset(key: string): void {
    this.states.delete(key);
  }

  private state(key: string): LiveRefreshState {
    let state = this.states.get(key);
    if (!state) {
      state = { failures: 0, missing: 0, retryAt: 0, warned: false };
      this.states.set(key, state);
    }
    return state;
  }
}
