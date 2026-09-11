/**
 * CompactionBoundaryGenerationRegistry
 *
 * Process-local, per-session registry that tracks observed compact-boundary
 * counts and a single pending expected count. It exists so that
 * `chat:resume` can verify, with one immutable parse, whether the JSONL it
 * just read already contains the boundary that a freshly-completed compaction
 * promised.
 *
 * Design constraints (TASK_2026_414):
 * - No timestamps, TTLs, delay constants, or slack.
 * - Bounded number of sessions; never grows without limit.
 * - Expectation is recorded only after a compact_boundary message resolves to
 *   a real session id.
 * - A baseline-absent expectation is explicitly unverified and stays stale
 *   regardless of any historical boundary count.
 * - The reader captures any pending expectation BEFORE it observes the count
 *   from the current parse, and consumes the expectation after the response.
 */

import { injectable } from 'tsyringe';

export interface VerifiedExpectation {
  readonly kind: 'verified';
  readonly expectedCount: number;
}

export interface UnverifiedExpectation {
  readonly kind: 'unverified';
}

export type PendingExpectation = VerifiedExpectation | UnverifiedExpectation;

interface CompactionBoundaryEntry {
  /**
   * True once this session's compact-boundary baseline has been observed by a
   * real history parse. False means the registry has no baseline for the
   * session and cannot verify an expectation.
   */
  baselineObserved: boolean;
  /** Latest observed compact-boundary count from a full history parse. */
  observedCount: number;
  /** Pending expectation, or null when none. */
  pendingExpectation: PendingExpectation | null;
  /**
   * Boundary generation that has already been persisted and observed before
   * its matching streamed compact_boundary reaches the transformer. The stream
   * side records this as fulfilled rather than expecting an additional boundary.
   */
  observedUnclaimedBoundaryId: string | null;
}

@injectable()
export class CompactionBoundaryGenerationRegistry {
  private readonly entries = new Map<string, CompactionBoundaryEntry>();
  /**
   * A bounded set of expectations rejected because every primary slot was
   * pending. They are deliberately unverified: retaining the session id makes
   * the later resume stale rather than silently treating it as expectationless.
   */
  private readonly overflowUnverifiedSessions = new Map<string, true>();

  /**
   * Only reached if both bounded stores are full of pending expectations.
   * From then on an unknown compaction check fails stale conservatively. There
   * is no safe per-session fact left to retain without making memory unbounded.
   */
  private overflowSaturated = false;

  constructor(private readonly maxEntries = 256) {}

  /**
   * Record that a streamed compaction boundary completed for `sessionId`.
   *
   * A history read can observe the persisted boundary before this transformer
   * call. `observedUnclaimedBoundaryId` is an ordering fact, not a clock:
   * claim that observed generation instead of expecting a fictitious next one.
   * Otherwise, a known baseline yields the next expected generation; without a
   * baseline the expectation remains explicitly unverified.
   */
  recordExpectedBoundary(sessionId: string, boundaryId?: string): void {
    const entry = this.ensureEntry(sessionId);
    if (!entry) {
      this.recordOverflowUnverifiedExpectation(sessionId);
      return;
    }
    if (
      boundaryId !== undefined &&
      entry.observedUnclaimedBoundaryId === boundaryId
    ) {
      entry.observedUnclaimedBoundaryId = null;
      entry.pendingExpectation = null;
      return;
    }
    if (entry.baselineObserved) {
      entry.pendingExpectation = {
        kind: 'verified',
        expectedCount: entry.observedCount + 1,
      };
    } else {
      entry.pendingExpectation = { kind: 'unverified' };
    }
  }

  /**
   * Read any pending expectation for `sessionId`. The caller must capture this
   * BEFORE observing the current parse so the observed count is not influenced
   * by a same-loop observation. Non-consuming.
   */
  capturePendingExpectation(sessionId: string): PendingExpectation | undefined {
    const entry = this.entries.get(sessionId);
    if (entry?.pendingExpectation) {
      return entry.pendingExpectation;
    }
    if (
      this.overflowUnverifiedSessions.has(sessionId) ||
      this.overflowSaturated
    ) {
      return { kind: 'unverified' };
    }
    return undefined;
  }

  /**
   * Record the observed compact-boundary count from a successful full parse and
   * mark the baseline as observed. A count advance with no pending expectation
   * is retained as an unclaimed persisted generation for a later streamed
   * boundary to claim.
   */
  observeBoundaryCount(
    sessionId: string,
    count: number,
    latestBoundaryId?: string,
  ): void {
    const entry = this.ensureEntry(sessionId);
    if (!entry) return;
    const previousCount = entry.observedCount;
    const hadBaseline = entry.baselineObserved;
    entry.baselineObserved = true;
    entry.observedCount = count;
    if (
      hadBaseline &&
      entry.pendingExpectation === null &&
      count > previousCount &&
      latestBoundaryId !== undefined
    ) {
      entry.observedUnclaimedBoundaryId = latestBoundaryId;
    }
  }

  /**
   * Consume the pending expectation after the response is ready or exhausted.
   */
  consumeExpectation(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry) {
      entry.pendingExpectation = null;
    }
    this.overflowUnverifiedSessions.delete(sessionId);
  }

  /** Test-only inspection. */
  inspect(
    sessionId: string,
  ): Omit<
    CompactionBoundaryEntry,
    'observedUnclaimedBoundaryId'
  > | undefined {
    const entry = this.entries.get(sessionId);
    if (!entry) return undefined;
    const {
      observedUnclaimedBoundaryId: _unclaimed,
      ...inspection
    } = entry;
    return inspection;
  }

  private ensureEntry(
    sessionId: string,
  ): CompactionBoundaryEntry | undefined {
    let entry = this.entries.get(sessionId);
    if (!entry) {
      this.evictOldestNonPendingEntry();
      if (this.entries.size >= this.maxEntries) {
        return undefined;
      }
      entry = {
        baselineObserved: false,
        observedCount: 0,
        pendingExpectation: null,
        observedUnclaimedBoundaryId: null,
      };
    } else {
      // Refresh LRU position.
      this.entries.delete(sessionId);
    }
    this.entries.set(sessionId, entry);
    return entry;
  }

  private evictOldestNonPendingEntry(): void {
    while (this.entries.size >= this.maxEntries) {
      const evictable = [...this.entries.entries()].find(
        ([, entry]) => entry.pendingExpectation === null,
      );
      if (!evictable) {
        return;
      }
      this.entries.delete(evictable[0]);
    }
  }

  private recordOverflowUnverifiedExpectation(sessionId: string): void {
    if (this.overflowSaturated) return;

    this.overflowUnverifiedSessions.delete(sessionId);
    this.overflowUnverifiedSessions.set(sessionId, true);
    if (this.overflowUnverifiedSessions.size > this.maxEntries) {
      // Do not evict an active fail-stale marker. A single conservative mode is
      // bounded and safe; dropping the marker would make the next resume ready.
      this.overflowSaturated = true;
      this.overflowUnverifiedSessions.clear();
    }
  }
}
