/**
 * LiveUsageTracker — Per-session live cumulative token snapshot.
 *
 * Extracted from `SdkMessageTransformer` to break a
 * circular DI: `SessionLifecycleManager → SdkQueryOptionsBuilder →
 * CompactionHookHandler → SdkMessageTransformer → SessionLifecycleManager`.
 *
 * The transformer (writer) records cumulative usage from `message_start.usage`
 * and `message_delta.usage` events. The PreCompact hook handler (reader)
 * samples the cumulative total at compaction firing time to enrich the
 * `compaction_start` notification with `preTokens`.
 *
 * Both writer and reader now depend on this orthogonal tracker instead of on
 * each other, eliminating the cycle without weakening A1/A2 semantics from
 *
 * Cumulative semantics: each field is monotonic within a turn (Anthropic API
 * delivers monotonic counts), so `recordSessionUsage` keeps the max of
 * previous and incoming values per field. Cross-turn aggregation is the
 * concern of downstream stats services, not this tracker.
 *
 * ## The resume baseline is a SECOND slot, not a seeded snapshot (TASK_2026_374)
 *
 * A session RESUMED from JSONL has streamed nothing in this process, so the
 * live map holds nothing and `getCumulativeTokens` answered 0. A manual
 * `/compact` on such a session published `preTokens: 0`, and the frontend
 * computed its pre/post delta from a zero baseline.
 *
 * The fix does NOT route the resumed figure through `recordSessionUsage`. That
 * method keeps a per-field MAX, so a value written there outranks every real
 * frame that arrives afterwards and can never be corrected downwards — the
 * historical number would win over live evidence for the rest of the session,
 * which is exactly the "live" guarantee this class exists to make.
 * {@link seedResumedSession} therefore writes a separate slot that
 * {@link getCumulativeTokens} consults ONLY when the live map has never been
 * written for that session. A live frame always wins the moment one exists.
 */

import { injectable } from 'tsyringe';

interface UsageSnapshot {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

/**
 * Resume baselines held at once.
 *
 * A bound is required rather than tidy: `session:stats-batch` reads history for
 * a whole session list in one call, so the write side is not one entry per
 * active session. Insertion-ordered, oldest evicted — the retention RULE is
 * {@link LiveUsageTracker.clearSessionTokenSnapshot}; this is only the leak
 * guard behind it, in a process that stays up for days.
 */
const RESUME_BASELINE_LIMIT = 64;

@injectable()
export class LiveUsageTracker {
  private readonly snapshotBySession: Map<string, UsageSnapshot> = new Map();
  private readonly resumeBaselineBySession: Map<string, number> = new Map();

  /**
   * Record a cumulative usage frame for a session. Each field is replaced only
   * when the incoming value is greater than the prior value. No-op when
   * `sessionId` is empty (defensive against compact_boundary edge cases).
   */
  recordSessionUsage(
    sessionId: string,
    fields: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheCreation?: number;
    },
  ): void {
    if (!sessionId) {
      return;
    }
    const prev: UsageSnapshot = this.snapshotBySession.get(sessionId) ?? {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 0,
    };
    const next: UsageSnapshot = {
      input: Math.max(prev.input, fields.input ?? prev.input),
      output: Math.max(prev.output, fields.output ?? prev.output),
      cacheRead: Math.max(prev.cacheRead, fields.cacheRead ?? prev.cacheRead),
      cacheCreation: Math.max(
        prev.cacheCreation,
        fields.cacheCreation ?? prev.cacheCreation,
      ),
    };
    this.snapshotBySession.set(sessionId, next);
  }

  /**
   * Record what a session's transcript on disk says its last request cost, for
   * a session this process has not yet seen stream.
   *
   * `tokens` must be ONE request's frame — `input + output + cache_read +
   * cache_creation` of the last message after the last compaction boundary —
   * because that is the same quantity `recordSessionUsage` observes and the
   * only one comparable with it. A cross-turn SUM (what
   * `SessionHistoryReaderService`'s aggregate stats and
   * `SessionMetadataStore.totalTokens` both hold) is a different measurement
   * entirely: with prompt caching the summed `cache_read` of a long session runs
   * into the millions, so publishing it as `preTokens` would be a more
   * confidently wrong answer than 0.
   *
   * Non-positive values and a blank id are ignored — neither is evidence.
   */
  seedResumedSession(sessionId: string, tokens: number): void {
    if (!sessionId || !Number.isFinite(tokens) || tokens <= 0) {
      return;
    }
    // Delete-then-set keeps Map insertion order acting as recency, so the
    // eviction below drops the least recently SEEDED session.
    this.resumeBaselineBySession.delete(sessionId);
    this.resumeBaselineBySession.set(sessionId, Math.floor(tokens));
    while (this.resumeBaselineBySession.size > RESUME_BASELINE_LIMIT) {
      const oldest = this.resumeBaselineBySession.keys().next();
      if (oldest.done) break;
      this.resumeBaselineBySession.delete(oldest.value);
    }
  }

  /**
   * Read the most recent cumulative pre-compaction tokens for a session,
   * summing input + output + cache_read + cache_creation.
   *
   * A live snapshot always wins, even if it happens to sum to 0: once this
   * process has observed a frame for the session, that observation IS the
   * answer. The resume baseline answers only when nothing was ever observed,
   * and 0 only when neither source knows anything.
   */
  getCumulativeTokens(sessionId: string): number {
    const snap = this.snapshotBySession.get(sessionId);
    if (!snap) {
      return this.resumeBaselineBySession.get(sessionId) ?? 0;
    }
    return snap.input + snap.output + snap.cacheRead + snap.cacheCreation;
  }

  /**
   * Drop the cached snapshot for a session. Called at session deletion and at
   * `compact_boundary` to prevent unbounded growth and avoid re-poisoning
   * post-boundary cumulative reads.
   *
   * The resume baseline goes with it, and must: it describes the transcript
   * BEFORE the compaction, so leaving it behind would let a post-boundary read
   * be answered with the pre-boundary figure — the re-poisoning this method
   * exists to prevent, arriving through the second slot instead of the first.
   */
  clearSessionTokenSnapshot(sessionId: string): void {
    this.snapshotBySession.delete(sessionId);
    this.resumeBaselineBySession.delete(sessionId);
  }
}
