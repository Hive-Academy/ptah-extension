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
   * Timestamp of last cleanup run.
   */
  private lastCleanupAt = 0;

  constructor(private readonly logger: Logger) {}

  // ==========================================================================
  // Registry CRUD
  // ==========================================================================

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
  }

  // ==========================================================================
  // Pending background ids
  // ==========================================================================

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

  // ==========================================================================
  // Cleared (injected) tool call ids
  // ==========================================================================

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

  // ==========================================================================
  // TTL + lazy cleanup
  // ==========================================================================

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

    // Also prune expired entries from clearedToolCallIds.
    // Uses the same TTL_MS (24h) as the registry records.
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
