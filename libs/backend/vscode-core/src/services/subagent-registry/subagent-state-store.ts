/**
 * Subagent State Store
 *
 * Library-internal helper that owns the subagent registry storage primitives
 * for {@link SubagentRegistryService}.
 *
 * Responsibilities:
 * - Own the primary in-memory Map<toolCallId, SubagentRecord>
 * - Own the `clearedToolCallIds` map (injected-context dedup) and the
 *   `pendingBackgroundToolCallIds` set (pre-marked background agents)
 * - TTL expiration checks + lazy cleanup sweeps
 *
 * This helper is **library-internal** — it is not `@injectable()`.
 * {@link SubagentRegistryService} owns a single instance and delegates to it.
 *
 * The existing service has no disk-backed persistence; `save()` / `load()`
 * are therefore intentionally absent here. Adding durable persistence in a
 * later wave is a pure surface change on this class.
 *
 * @packageDocumentation
 */

import type { Logger } from '../../logging';
import type { SubagentRecord } from '@ptah-extension/shared';

/**
 * TTL for subagent records: 24 hours.
 * After this time, records are automatically cleaned up.
 */
export const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Cleanup runs at most once per this interval.
 */
export const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * In-memory registry of subagent lifecycle records with lazy TTL cleanup.
 *
 * Preserves the exact read/write ordering of the original
 * {@link SubagentRegistryService}. Log messages and keys are byte-identical.
 */
export class SubagentStateStore {
  /**
   * In-memory registry keyed by toolCallId.
   */
  private readonly registry = new Map<string, SubagentRecord>();

  /**
   * Tracks toolCallIds that have been injected into context and removed from
   * the registry. Prevents registerFromHistoryEvents() from re-registering
   * these agents on session reload.
   *
   * Value is the timestamp when the ID was added; entries older than TTL_MS
   * are pruned during the lazy cleanup sweep.
   */
  private readonly clearedToolCallIds = new Map<string, number>();

  /**
   * Tracks toolCallIds that have been detected as background tasks by
   * SdkMessageTransformer BEFORE the SubagentStart hook fires.
   */
  private readonly pendingBackgroundToolCallIds = new Set<string>();

  /**
   * Human-legible teammate names captured from the Agent/Task tool's `name`
   * input by SdkMessageTransformer BEFORE the SubagentStart hook fires. Keyed
   * by the Task tool_use id (toolCallId). Consumed at register() time and
   * merged onto the SubagentRecord as `teammateName`.
   */
  private readonly pendingTeammateNames = new Map<string, string>();

  /**
   * Parent session IDs currently inside endSession()/disposeAllSessions()
   * teardown. While a session is in this set, 'completed' transitions for its
   * already-interrupted records are ignored — the SDK's graceful interrupt
   * fires SubagentStop for agents we just marked interrupted, and honoring
   * that stop would delete the record and lose resumability.
   */
  private readonly teardownSessionIds = new Set<string>();

  /**
   * Number of times each toolCallId's interrupted-agent context has been
   * injected into a chat:continue prompt. Bounds repeated injection so an
   * agent the model never resumes doesn't nag forever.
   */
  private readonly injectionAttempts = new Map<string, number>();

  /**
   * Timestamp of last cleanup run.
   */
  private lastCleanupAt = 0;

  constructor(private readonly logger: Logger) {}

  /** Get the record for a toolCallId without touching expiration state. */
  getRaw(toolCallId: string): SubagentRecord | undefined {
    return this.registry.get(toolCallId);
  }

  /** Whether the registry has an entry for this toolCallId. */
  has(toolCallId: string): boolean {
    return this.registry.has(toolCallId);
  }

  /** Set a record. */
  set(toolCallId: string, record: SubagentRecord): void {
    this.registry.set(toolCallId, record);
  }

  /** Delete a record; returns true if something was removed. */
  delete(toolCallId: string): boolean {
    this.injectionAttempts.delete(toolCallId);
    return this.registry.delete(toolCallId);
  }

  /** Iterable of [toolCallId, record] pairs. */
  entries(): IterableIterator<[string, SubagentRecord]> {
    return this.registry.entries();
  }

  /** Iterable of records. */
  values(): IterableIterator<SubagentRecord> {
    return this.registry.values();
  }

  /** Current registry size. */
  get size(): number {
    return this.registry.size;
  }

  /**
   * Wipe every piece of state this store owns.
   */
  clear(): void {
    this.registry.clear();
    this.clearedToolCallIds.clear();
    this.pendingBackgroundToolCallIds.clear();
    this.pendingTeammateNames.clear();
    this.teardownSessionIds.clear();
    this.injectionAttempts.clear();
  }

  /** Mark a parent session as being torn down. */
  beginTeardown(parentSessionId: string): void {
    this.teardownSessionIds.add(parentSessionId);
  }

  /** Clear the teardown marker for a parent session. */
  endTeardown(parentSessionId: string): void {
    this.teardownSessionIds.delete(parentSessionId);
  }

  /** Whether a parent session is currently being torn down. */
  isInTeardown(parentSessionId: string): boolean {
    return this.teardownSessionIds.has(parentSessionId);
  }

  /** Increment and return the injection-attempt count for a toolCallId. */
  recordInjectionAttempt(toolCallId: string): number {
    const next = (this.injectionAttempts.get(toolCallId) ?? 0) + 1;
    this.injectionAttempts.set(toolCallId, next);
    return next;
  }

  /** Current injection-attempt count for a toolCallId. */
  getInjectionAttempts(toolCallId: string): number {
    return this.injectionAttempts.get(toolCallId) ?? 0;
  }

  /** Drop injection-attempt tracking for a toolCallId. */
  clearInjectionAttempts(toolCallId: string): void {
    this.injectionAttempts.delete(toolCallId);
  }

  /** Record a toolCallId as pre-marked background. */
  markPendingBackground(toolCallId: string): void {
    this.pendingBackgroundToolCallIds.add(toolCallId);
  }

  /** Current count of pending background ids (for logging). */
  get pendingBackgroundCount(): number {
    return this.pendingBackgroundToolCallIds.size;
  }

  /**
   * Consume a pending background id — returns whether the id was pre-marked,
   * and atomically removes it.
   */
  consumePendingBackground(toolCallId: string): boolean {
    const had = this.pendingBackgroundToolCallIds.has(toolCallId);
    if (had) {
      this.pendingBackgroundToolCallIds.delete(toolCallId);
    }
    return had;
  }

  /** Record a human-legible teammate name for a not-yet-registered toolCallId. */
  markPendingTeammateName(toolCallId: string, teammateName: string): void {
    this.pendingTeammateNames.set(toolCallId, teammateName);
  }

  /**
   * Consume a pending teammate name — returns the name if one was pre-marked,
   * and atomically removes it. Returns undefined when none was recorded.
   */
  consumePendingTeammateName(toolCallId: string): string | undefined {
    const name = this.pendingTeammateNames.get(toolCallId);
    if (name !== undefined) {
      this.pendingTeammateNames.delete(toolCallId);
    }
    return name;
  }

  /**
   * Peek at a pending teammate name WITHOUT consuming it. Used by emit sites
   * that may fire before the SubagentStart hook has registered the record, so
   * the name must remain available for the later consumePendingTeammateName().
   */
  peekPendingTeammateName(toolCallId: string): string | undefined {
    return this.pendingTeammateNames.get(toolCallId);
  }

  /** Remember that a toolCallId was injected into context and removed. */
  markInjected(toolCallId: string): void {
    this.clearedToolCallIds.set(toolCallId, Date.now());
  }

  /** Current size of cleared map (for logging). */
  get clearedCount(): number {
    return this.clearedToolCallIds.size;
  }

  /** Whether a toolCallId is in the injected set. */
  wasInjected(toolCallId: string): boolean {
    return this.clearedToolCallIds.has(toolCallId);
  }

  /**
   * Check if a record is expired (older than TTL).
   *
   * Background agents are exempt from TTL cleanup — they can run for extended
   * periods and must remain in the registry for permission auto-approval to
   * work correctly.
   */
  isExpired(record: SubagentRecord): boolean {
    if (record.isBackground || record.status === 'background') {
      return false;
    }
    const age = Date.now() - record.startedAt;
    return age > TTL_MS;
  }

  /**
   * Lazy TTL cleanup - runs at most once per CLEANUP_INTERVAL_MS.
   *
   * Pattern: Lazy cleanup on access (not timer-based) to avoid memory leaks
   * from orphaned timers if service is never disposed.
   */
  lazyCleanup(): void {
    const now = Date.now();
    if (now - this.lastCleanupAt < CLEANUP_INTERVAL_MS) {
      return; // Too soon since last cleanup
    }

    this.lastCleanupAt = now;
    this.cleanupExpired();
  }

  /**
   * Remove all expired records from the registry and clearedToolCallIds map.
   */
  private cleanupExpired(): void {
    const toRemove: string[] = [];

    for (const [toolCallId, record] of this.registry) {
      if (this.isExpired(record)) {
        toRemove.push(toolCallId);
      }
    }

    for (const toolCallId of toRemove) {
      this.registry.delete(toolCallId);
    }
    const now = Date.now();
    const clearedToRemove: string[] = [];
    for (const [toolCallId, timestamp] of this.clearedToolCallIds) {
      if (now - timestamp > TTL_MS) {
        clearedToRemove.push(toolCallId);
      }
    }
    for (const toolCallId of clearedToRemove) {
      this.clearedToolCallIds.delete(toolCallId);
    }

    const totalRemoved = toRemove.length + clearedToRemove.length;
    if (totalRemoved === 0) {
      return;
    }

    this.logger.info(
      '[SubagentRegistryService.cleanupExpired] Expired records removed',
      {
        registryRemoved: toRemove.length,
        clearedIdsRemoved: clearedToRemove.length,
        remainingRegistry: this.registry.size,
        remainingClearedIds: this.clearedToolCallIds.size,
      },
    );
  }
}
