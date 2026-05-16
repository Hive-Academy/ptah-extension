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
 */

import { injectable } from 'tsyringe';

interface UsageSnapshot {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

@injectable()
export class LiveUsageTracker {
  private readonly snapshotBySession: Map<string, UsageSnapshot> = new Map();

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
   * Read the most recent cumulative pre-compaction tokens for a session,
   * summing input + output + cache_read + cache_creation. Returns 0 when no
   * usage has been observed yet.
   */
  getCumulativeTokens(sessionId: string): number {
    const snap = this.snapshotBySession.get(sessionId);
    if (!snap) {
      return 0;
    }
    return snap.input + snap.output + snap.cacheRead + snap.cacheCreation;
  }

  /**
   * Drop the cached snapshot for a session. Called at session deletion and at
   * `compact_boundary` to prevent unbounded growth and avoid re-poisoning
   * post-boundary cumulative reads.
   */
  clearSessionTokenSnapshot(sessionId: string): void {
    this.snapshotBySession.delete(sessionId);
  }
}
