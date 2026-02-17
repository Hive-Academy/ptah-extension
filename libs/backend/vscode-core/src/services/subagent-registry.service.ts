/**
 * Subagent Registry Service
 *
 * TASK_2025_103: Subagent Resumption Feature
 *
 * Maintains an in-memory registry of subagent lifecycle states to enable
 * resumption of interrupted subagent executions. Tracks subagents from
 * SubagentStart hook through completion or interruption.
 *
 * Key responsibilities:
 * - Register subagents when SubagentStart hook fires
 * - Update status when SubagentStop hook fires (completed)
 * - Mark all running subagents as interrupted when session aborts
 * - Query resumable (interrupted, non-expired) subagents
 * - Automatic TTL cleanup (24 hours) to prevent memory leaks
 *
 * Integration points:
 * - SubagentHookHandler: calls register() and update()
 * - SessionLifecycleManager.endSession(): calls markAllInterrupted()
 * - SubagentRpcHandlers: calls get(), getResumable()
 *
 * @packageDocumentation
 */

import { injectable, inject } from 'tsyringe';
import type { Logger } from '../logging';
import { TOKENS } from '../di/tokens';
import type {
  SubagentRecord,
  SubagentStatus,
  FlatStreamEventUnion,
  AgentStartEvent,
  ToolResultEvent,
} from '@ptah-extension/shared';

/**
 * Input for registering a new subagent (status is set automatically)
 */
export type SubagentRegistration = Omit<
  SubagentRecord,
  'status' | 'interruptedAt'
>;

/**
 * Subagent Registry Service Implementation
 *
 * In-memory Map-based storage with lazy TTL cleanup.
 * Records are keyed by toolCallId for O(1) lookup.
 *
 * Memory characteristics:
 * - Map<string, SubagentRecord>
 * - ~500 bytes per record
 * - Max expected: ~100 subagents per session
 * - TTL cleanup: 24 hours (lazy, on access)
 *
 * Thread safety:
 * - JavaScript single-threaded execution
 * - All operations are synchronous (no race conditions)
 *
 * Pattern Reference: LicenseService (vscode-core)
 */
@injectable()
export class SubagentRegistryService {
  /**
   * In-memory registry keyed by toolCallId
   */
  private readonly registry = new Map<string, SubagentRecord>();

  /**
   * TTL for subagent records: 24 hours
   * After this time, records are automatically cleaned up
   */
  private static readonly TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Cleanup runs at most once per this interval
   */
  private static readonly CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Timestamp of last cleanup run
   */
  private lastCleanupAt = 0;

  constructor(
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger
  ) {
    this.logger.debug(
      '[SubagentRegistryService.constructor] Service initialized'
    );
  }

  /**
   * Register a new subagent when SubagentStart hook fires.
   *
   * Creates a new SubagentRecord with status='running' and stores it
   * in the registry keyed by toolCallId.
   *
   * @param registration - Subagent data from SubagentStart hook
   *
   * @example
   * ```typescript
   * registry.register({
   *   toolCallId: 'toolu_abc123',
   *   sessionId: 'sub-session-uuid',
   *   agentType: 'software-architect',
   *   startedAt: Date.now(),
   *   parentSessionId: 'parent-session-uuid',
   *   agentId: 'adcecb2',
   * });
   * ```
   */
  register(registration: SubagentRegistration): void {
    // Run lazy cleanup periodically
    this.lazyCleanup();

    const record: SubagentRecord = {
      ...registration,
      status: 'running' as SubagentStatus,
    };

    this.registry.set(registration.toolCallId, record);

    this.logger.info('[SubagentRegistryService.register] Subagent registered', {
      toolCallId: registration.toolCallId,
      sessionId: registration.sessionId,
      agentType: registration.agentType,
      agentId: registration.agentId,
      parentSessionId: registration.parentSessionId,
      registrySize: this.registry.size,
    });
  }

  /**
   * Update an existing subagent's status and optional fields.
   *
   * Typically called when SubagentStop hook fires to mark as 'completed'.
   *
   * FIX (TASK_2025_103 QA): Completed subagents are now deleted immediately
   * instead of being kept for 24 hours. Only interrupted subagents are kept
   * for potential resumption. This prevents memory accumulation.
   *
   * @param toolCallId - The subagent's toolCallId
   * @param updates - Fields to update (status, interruptedAt)
   *
   * @example
   * ```typescript
   * // Mark as completed (deletes record immediately)
   * registry.update('toolu_abc123', { status: 'completed' });
   *
   * // Mark as interrupted (keeps record for resume)
   * registry.update('toolu_abc123', {
   *   status: 'interrupted',
   *   interruptedAt: Date.now()
   * });
   * ```
   */
  update(
    toolCallId: string,
    updates: Partial<Pick<SubagentRecord, 'status' | 'interruptedAt'>>
  ): void {
    const record = this.registry.get(toolCallId);
    if (!record) {
      this.logger.debug(
        '[SubagentRegistryService.update] Subagent not found by toolCallId (will try agentId fallback)',
        { toolCallId }
      );
      return;
    }

    // FIX: If marking as 'completed', delete immediately to prevent memory accumulation
    // Completed subagents cannot be resumed, so there's no reason to keep them
    if (updates.status === 'completed') {
      this.registry.delete(toolCallId);
      this.logger.debug(
        '[SubagentRegistryService.update] Subagent completed and removed',
        {
          toolCallId,
          agentType: record.agentType,
        }
      );
      return;
    }

    // Apply updates for non-completed status (e.g., 'interrupted', 'running')
    if (updates.status !== undefined) {
      record.status = updates.status;
    }
    if (updates.interruptedAt !== undefined) {
      record.interruptedAt = updates.interruptedAt;
    }

    this.logger.debug('[SubagentRegistryService.update] Subagent updated', {
      toolCallId,
      newStatus: updates.status,
      agentType: record.agentType,
    });
  }

  /**
   * Get a specific subagent record by toolCallId.
   *
   * Returns null if not found or expired.
   *
   * @param toolCallId - The subagent's toolCallId
   * @returns SubagentRecord or null
   *
   * @example
   * ```typescript
   * const record = registry.get('toolu_abc123');
   * if (record && record.status === 'interrupted') {
   *   // Can resume this subagent
   * }
   * ```
   */
  get(toolCallId: string): SubagentRecord | null {
    // Run lazy cleanup periodically
    this.lazyCleanup();

    const record = this.registry.get(toolCallId);
    if (!record) {
      return null;
    }

    // Check if expired
    if (this.isExpired(record)) {
      this.registry.delete(toolCallId);
      this.logger.debug(
        '[SubagentRegistryService.get] Record expired, removed',
        {
          toolCallId,
          agentType: record.agentType,
        }
      );
      return null;
    }

    return record;
  }

  /**
   * Get all resumable subagents (status='interrupted', within TTL).
   *
   * Returns subagents that can be resumed via SDK's resume parameter.
   *
   * @returns Array of resumable SubagentRecords
   *
   * @example
   * ```typescript
   * const resumable = registry.getResumable();
   * console.log(`${resumable.length} agents can be resumed`);
   * ```
   */
  getResumable(): SubagentRecord[] {
    // Run lazy cleanup periodically
    this.lazyCleanup();

    const resumable: SubagentRecord[] = [];

    for (const record of this.registry.values()) {
      if (record.status === 'interrupted' && !this.isExpired(record)) {
        resumable.push(record);
      }
    }

    this.logger.debug('[SubagentRegistryService.getResumable] Query result', {
      totalRecords: this.registry.size,
      resumableCount: resumable.length,
    });

    return resumable;
  }

  /**
   * Get resumable subagents filtered by parent session ID.
   *
   * @param parentSessionId - Filter by parent session
   * @returns Array of resumable SubagentRecords for the session
   *
   * @example
   * ```typescript
   * const sessionResumable = registry.getResumableBySession('session-uuid');
   * ```
   */
  getResumableBySession(parentSessionId: string): SubagentRecord[] {
    return this.getResumable().filter(
      (record) => record.parentSessionId === parentSessionId
    );
  }

  /**
   * Mark all running subagents as interrupted for a session.
   *
   * CRITICAL: Called by SessionLifecycleManager.endSession() when session aborts.
   * This is the key mechanism for detecting interrupted subagents since
   * SubagentStop hook doesn't fire on abort.
   *
   * @param parentSessionId - The parent session ID that was aborted
   *
   * @example
   * ```typescript
   * // In SessionLifecycleManager.endSession():
   * if (session.aborted) {
   *   this.subagentRegistry.markAllInterrupted(sessionId);
   * }
   * ```
   */
  markAllInterrupted(parentSessionId: string): void {
    const interruptedAt = Date.now();
    let interruptedCount = 0;

    for (const record of this.registry.values()) {
      if (
        record.parentSessionId === parentSessionId &&
        record.status === 'running'
      ) {
        record.status = 'interrupted';
        record.interruptedAt = interruptedAt;
        interruptedCount++;

        this.logger.debug(
          '[SubagentRegistryService.markAllInterrupted] Subagent interrupted',
          {
            toolCallId: record.toolCallId,
            agentType: record.agentType,
            agentId: record.agentId,
          }
        );
      }
    }

    if (interruptedCount > 0) {
      this.logger.info(
        '[SubagentRegistryService.markAllInterrupted] Session subagents interrupted',
        {
          parentSessionId,
          interruptedCount,
        }
      );
    }
  }

  /**
   * Remove a specific subagent from the registry.
   *
   * Called when a subagent is successfully resumed (to prevent double-resume)
   * or when cleanup is needed.
   *
   * @param toolCallId - The subagent's toolCallId to remove
   *
   * @example
   * ```typescript
   * // After successful resume
   * registry.remove('toolu_abc123');
   * ```
   */
  remove(toolCallId: string): void {
    const deleted = this.registry.delete(toolCallId);
    if (deleted) {
      this.logger.debug('[SubagentRegistryService.remove] Subagent removed', {
        toolCallId,
      });
    }
  }

  /**
   * Remove all subagents for a parent session.
   *
   * Called when a session is permanently deleted (not just aborted).
   *
   * @param parentSessionId - The parent session ID to remove subagents for
   *
   * @example
   * ```typescript
   * // In session deletion handler
   * registry.removeBySessionId('session-uuid');
   * ```
   */
  removeBySessionId(parentSessionId: string): void {
    const toRemove: string[] = [];

    for (const [toolCallId, record] of this.registry) {
      if (record.parentSessionId === parentSessionId) {
        toRemove.push(toolCallId);
      }
    }

    for (const toolCallId of toRemove) {
      this.registry.delete(toolCallId);
    }

    if (toRemove.length > 0) {
      this.logger.info(
        '[SubagentRegistryService.removeBySessionId] Session subagents removed',
        {
          parentSessionId,
          removedCount: toRemove.length,
        }
      );
    }
  }

  /**
   * Get total count of records in registry (for diagnostics).
   *
   * @returns Number of records in registry
   */
  get size(): number {
    return this.registry.size;
  }

  /**
   * Clear all records (for testing/cleanup).
   */
  clear(): void {
    this.registry.clear();
    this.logger.debug('[SubagentRegistryService.clear] Registry cleared');
  }

  /**
   * Check if a record is expired (older than TTL).
   *
   * @param record - The record to check
   * @returns true if expired
   */
  private isExpired(record: SubagentRecord): boolean {
    const age = Date.now() - record.startedAt;
    return age > SubagentRegistryService.TTL_MS;
  }

  /**
   * Lazy TTL cleanup - runs at most once per CLEANUP_INTERVAL_MS.
   *
   * Pattern: Lazy cleanup on access (not timer-based) to avoid
   * memory leaks from orphaned timers if service is never disposed.
   */
  private lazyCleanup(): void {
    const now = Date.now();
    if (
      now - this.lastCleanupAt <
      SubagentRegistryService.CLEANUP_INTERVAL_MS
    ) {
      return; // Too soon since last cleanup
    }

    this.lastCleanupAt = now;
    this.cleanupExpired();
  }

  /**
   * Remove all expired records from the registry.
   */
  private cleanupExpired(): void {
    const toRemove: string[] = [];

    for (const [toolCallId, record] of this.registry) {
      if (this.isExpired(record)) {
        toRemove.push(toolCallId);
      }
    }

    if (toRemove.length === 0) {
      return;
    }

    for (const toolCallId of toRemove) {
      this.registry.delete(toolCallId);
    }

    this.logger.info(
      '[SubagentRegistryService.cleanupExpired] Expired records removed',
      {
        removedCount: toRemove.length,
        remainingCount: this.registry.size,
      }
    );
  }

  // ============================================================================
  // HISTORY-BASED REGISTRATION (TASK_2025_109)
  // ============================================================================

  /**
   * Register incomplete/interrupted agents from loaded session history.
   *
   * TASK_2025_109: When loading a session from JSONL history (cold load),
   * SDK hooks don't fire, so the registry is empty. This method parses
   * history events to detect agents that started but never completed,
   * and registers them as 'interrupted' for potential resumption.
   *
   * Algorithm:
   * 1. Find all agent_start events (indicates agent spawned)
   * 2. Find all tool_result events (indicates tool completed)
   * 3. For each agent_start, check if there's a tool_result with same toolCallId
   * 4. If no tool_result found, agent is interrupted - register it
   *
   * @param events - Array of FlatStreamEventUnion from session history
   * @param parentSessionId - The parent session ID these events belong to
   * @returns Number of interrupted agents registered
   *
   * @example
   * ```typescript
   * const { events } = await historyReader.readSessionHistory(sessionId, workspacePath);
   * const registeredCount = subagentRegistry.registerFromHistoryEvents(events, sessionId);
   * console.log(`Registered ${registeredCount} interrupted agents from history`);
   * ```
   */
  registerFromHistoryEvents(
    events: FlatStreamEventUnion[],
    parentSessionId: string
  ): number {
    // Run lazy cleanup periodically
    this.lazyCleanup();

    // Step 1: Collect all agent_start events
    const agentStartEvents: AgentStartEvent[] = events.filter(
      (e): e is AgentStartEvent => e.eventType === 'agent_start'
    );

    if (agentStartEvents.length === 0) {
      this.logger.debug(
        '[SubagentRegistryService.registerFromHistoryEvents] No agent_start events found',
        { parentSessionId, eventCount: events.length }
      );
      return 0;
    }

    // Step 2: Collect all tool_result toolCallIds for quick lookup
    const completedToolCallIds = new Set<string>(
      events
        .filter((e): e is ToolResultEvent => e.eventType === 'tool_result')
        .map((e) => e.toolCallId)
    );

    // Step 2b: Build superseded set — when the same agentId was spawned multiple
    // times (initial + resume(s)), any earlier toolCallId that has a later successful
    // resume is "superseded" and should NOT appear as interrupted.
    // Algorithm: group toolCallIds by agentId, if ANY has a tool_result, all OTHERS
    // without a tool_result are superseded (not truly interrupted — they were retried).
    const agentIdToToolCallIds = new Map<string, string[]>();
    for (const agentStart of agentStartEvents) {
      if (!agentStart.agentId) continue;
      const existing = agentIdToToolCallIds.get(agentStart.agentId) ?? [];
      existing.push(agentStart.toolCallId);
      agentIdToToolCallIds.set(agentStart.agentId, existing);
    }

    const supersededToolCallIds = new Set<string>();
    for (const [agentId, toolCallIds] of agentIdToToolCallIds) {
      if (toolCallIds.length <= 1) continue;

      const hasCompleted = toolCallIds.some((tcId) =>
        completedToolCallIds.has(tcId)
      );
      if (hasCompleted) {
        // All non-completed toolCallIds for this agent are superseded
        for (const tcId of toolCallIds) {
          if (!completedToolCallIds.has(tcId)) {
            supersededToolCallIds.add(tcId);
            this.logger.debug(
              '[SubagentRegistryService.registerFromHistoryEvents] Marking toolCallId as superseded',
              {
                toolCallId: tcId,
                agentId,
                reason: 'agent has a completed resume',
              }
            );
          }
        }
      }
    }

    // Step 3: Find agent_start events without corresponding tool_result
    let registeredCount = 0;

    for (const agentStart of agentStartEvents) {
      const { toolCallId, agentType, agentId, sessionId, timestamp } =
        agentStart;

      // Skip if already registered (avoid duplicates on multiple loads)
      if (this.registry.has(toolCallId)) {
        this.logger.debug(
          '[SubagentRegistryService.registerFromHistoryEvents] Agent already registered, skipping',
          { toolCallId, agentType }
        );
        continue;
      }

      // Check if agent completed (has tool_result)
      if (completedToolCallIds.has(toolCallId)) {
        this.logger.debug(
          '[SubagentRegistryService.registerFromHistoryEvents] Agent completed, skipping',
          { toolCallId, agentType }
        );
        continue;
      }

      // Skip superseded agents (earlier interrupted attempts that were successfully resumed later)
      if (supersededToolCallIds.has(toolCallId)) {
        this.logger.debug(
          '[SubagentRegistryService.registerFromHistoryEvents] Agent superseded by successful resume, skipping',
          { toolCallId, agentType, agentId }
        );
        continue;
      }

      // Agent started but never completed - register as interrupted
      // Skip agents without a real agentId — without it, the SDK can't find
      // the subagent's transcript file for resumption. The toolCallId fallback
      // (e.g., "YT1Fw2p") doesn't match any file on disk.
      if (!agentId) {
        this.logger.debug(
          '[SubagentRegistryService.registerFromHistoryEvents] Skipping agent without agentId (no transcript for resume)',
          { toolCallId, agentType }
        );
        continue;
      }

      const record: SubagentRecord = {
        toolCallId,
        sessionId: sessionId, // Parent session ID (from event context, not subagent's own)
        agentType: agentType,
        status: 'interrupted' as SubagentStatus,
        startedAt: timestamp,
        interruptedAt: timestamp, // Use start time as approximate interrupt time
        parentSessionId,
        agentId, // Real agent ID from correlated agent file (e.g., "a329b32")
      };

      this.registry.set(toolCallId, record);
      registeredCount++;

      this.logger.debug(
        '[SubagentRegistryService.registerFromHistoryEvents] Registered interrupted agent',
        {
          toolCallId,
          agentType,
          agentId: record.agentId,
          parentSessionId,
        }
      );
    }

    if (registeredCount > 0) {
      this.logger.info(
        '[SubagentRegistryService.registerFromHistoryEvents] Registered interrupted agents from history',
        {
          parentSessionId,
          registeredCount,
          totalAgentStarts: agentStartEvents.length,
          completedCount: agentStartEvents.length - registeredCount,
          registrySize: this.registry.size,
        }
      );
    }

    return registeredCount;
  }
}
