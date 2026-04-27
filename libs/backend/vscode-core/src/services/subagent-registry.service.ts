/**
 * Subagent Registry Service (coordinator — Wave C7a, TASK_2025_291)
 *
 * TASK_2025_103: Subagent Resumption Feature
 *
 * Maintains an in-memory registry of subagent lifecycle states to enable
 * resumption of interrupted subagent executions. Tracks subagents from
 * SubagentStart hook through completion or interruption.
 *
 * TASK_2025_291 Wave C7a: This class is now a thin coordinator. Persistence
 * primitives (the in-memory Map, cleared/pending sets, TTL expiration, lazy
 * cleanup) live in {@link SubagentStateStore}. History-based replay
 * registration lives in {@link SubagentHistoryRegistrar}. The public surface
 * of this class is unchanged.
 *
 * Key responsibilities (coordinator):
 * - Register subagents when SubagentStart hook fires
 * - Update status when SubagentStop hook fires (completed)
 * - Mark all running subagents as interrupted when session aborts
 * - Query resumable (interrupted, non-expired) subagents
 * - Automatic TTL cleanup (24 hours) to prevent memory leaks (delegated)
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
} from '@ptah-extension/shared';
import { SubagentStateStore } from './subagent-registry/subagent-state-store';
import { SubagentHistoryRegistrar } from './subagent-registry/subagent-history-registrar';

/**
 * Input for registering a new subagent (status is set automatically)
 */
export type SubagentRegistration = Omit<
  SubagentRecord,
  'status' | 'interruptedAt' | 'completedAt' | 'backgroundStartedAt'
>;

/**
 * Subagent Registry Service Implementation (coordinator)
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
  private readonly store: SubagentStateStore;
  private readonly historyRegistrar: SubagentHistoryRegistrar;

  constructor(
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
  ) {
    this.store = new SubagentStateStore(logger);
    this.historyRegistrar = new SubagentHistoryRegistrar(this.store, logger);
    this.logger.debug(
      '[SubagentRegistryService.constructor] Service initialized',
    );
  }

  /**
   * Register a new subagent when SubagentStart hook fires.
   *
   * Creates a new SubagentRecord with status='running' and stores it
   * in the registry keyed by toolCallId.
   *
   * @param registration - Subagent data from SubagentStart hook
   */
  register(registration: SubagentRegistration): void {
    // Run lazy cleanup periodically
    this.store.lazyCleanup();

    // TASK_2025_217: Check if this toolCallId was pre-marked as background
    // by SdkMessageTransformer (detected run_in_background: true in Task input).
    // This eliminates the race condition where the agent starts executing tools
    // before the background_agent_started stream event arrives.
    const isPendingBackground = this.store.consumePendingBackground(
      registration.toolCallId,
    );

    const record: SubagentRecord = {
      ...registration,
      status: isPendingBackground
        ? ('background' as SubagentStatus)
        : ('running' as SubagentStatus),
      ...(isPendingBackground && {
        isBackground: true,
        backgroundStartedAt: Date.now(),
      }),
    };

    this.store.set(registration.toolCallId, record);

    this.logger.info('[SubagentRegistryService.register] Subagent registered', {
      toolCallId: registration.toolCallId,
      sessionId: registration.sessionId,
      agentType: registration.agentType,
      agentId: registration.agentId,
      parentSessionId: registration.parentSessionId,
      registrySize: this.store.size,
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
   */
  update(
    toolCallId: string,
    updates: Partial<
      Pick<
        SubagentRecord,
        | 'status'
        | 'interruptedAt'
        | 'isBackground'
        | 'isCliAgent'
        | 'outputFilePath'
        | 'backgroundStartedAt'
        | 'completedAt'
      >
    >,
  ): void {
    const record = this.store.getRaw(toolCallId);
    if (!record) {
      this.logger.debug(
        '[SubagentRegistryService.update] Subagent not found by toolCallId — caller should use getToolCallIdByAgentId() fallback',
        { toolCallId },
      );
      return;
    }

    // FIX: If marking as 'completed' or 'background_completed', delete immediately
    // to prevent memory accumulation. Completed subagents cannot be resumed.
    if (
      updates.status === 'completed' ||
      updates.status === 'background_completed'
    ) {
      this.store.delete(toolCallId);
      this.logger.debug(
        '[SubagentRegistryService.update] Subagent completed and removed',
        {
          toolCallId,
          agentType: record.agentType,
          status: updates.status,
        },
      );
      return;
    }

    // Apply updates for non-completed status (e.g., 'interrupted', 'running', 'background')
    if (updates.status !== undefined) {
      record.status = updates.status;
    }
    if (updates.interruptedAt !== undefined) {
      record.interruptedAt = updates.interruptedAt;
    }
    if (updates.isBackground !== undefined) {
      (record as { isBackground?: boolean }).isBackground =
        updates.isBackground;
    }
    if (updates.isCliAgent !== undefined) {
      (record as { isCliAgent?: boolean }).isCliAgent = updates.isCliAgent;
    }
    if (updates.outputFilePath !== undefined) {
      (record as { outputFilePath?: string }).outputFilePath =
        updates.outputFilePath;
    }
    if (updates.backgroundStartedAt !== undefined) {
      (record as { backgroundStartedAt?: number }).backgroundStartedAt =
        updates.backgroundStartedAt;
    }
    if (updates.completedAt !== undefined) {
      (record as { completedAt?: number }).completedAt = updates.completedAt;
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
   */
  get(toolCallId: string): SubagentRecord | null {
    // Run lazy cleanup periodically
    this.store.lazyCleanup();

    const record = this.store.getRaw(toolCallId);
    if (!record) {
      return null;
    }

    // Check if expired
    if (this.store.isExpired(record)) {
      this.store.delete(toolCallId);
      this.logger.debug(
        '[SubagentRegistryService.get] Record expired, removed',
        {
          toolCallId,
          agentType: record.agentType,
        },
      );
      return null;
    }

    return record;
  }

  /**
   * Get all resumable subagents (status='interrupted', within TTL).
   *
   * Returns subagents that can be resumed via SDK's resume parameter.
   */
  getResumable(): SubagentRecord[] {
    // Run lazy cleanup periodically
    this.store.lazyCleanup();

    const resumable: SubagentRecord[] = [];

    for (const record of this.store.values()) {
      if (record.status === 'interrupted' && !this.store.isExpired(record)) {
        resumable.push(record);
      }
    }

    this.logger.debug('[SubagentRegistryService.getResumable] Query result', {
      totalRecords: this.store.size,
      resumableCount: resumable.length,
    });

    return resumable;
  }

  /**
   * Get all background agents, optionally filtered by parent session ID.
   *
   * Background agents have status 'background' and are still running
   * independently of the main agent's turn.
   *
   * @param parentSessionId - Optional filter by parent session
   * @returns Array of background SubagentRecords
   */
  getBackgroundAgents(parentSessionId?: string): SubagentRecord[] {
    const background: SubagentRecord[] = [];

    for (const record of this.store.values()) {
      if (record.status === 'background' && !this.store.isExpired(record)) {
        if (!parentSessionId || record.parentSessionId === parentSessionId) {
          background.push(record);
        }
      }
    }

    return background;
  }

  /**
   * Get resumable subagents filtered by parent session ID.
   *
   * @param parentSessionId - Filter by parent session
   * @returns Array of resumable SubagentRecords for the session
   */
  getResumableBySession(parentSessionId: string): SubagentRecord[] {
    return this.getResumable().filter(
      (record) => record.parentSessionId === parentSessionId,
    );
  }

  /**
   * Get all running (non-background) subagents for a session.
   *
   * TASK_2025_185: Used by frontend to show confirmation before interrupting.
   * Returns agents that are actively running and would be killed by an abort.
   *
   * @param parentSessionId - The parent session ID to query
   * @returns Array of running SubagentRecords (excludes background agents)
   */
  getRunningBySession(parentSessionId: string): SubagentRecord[] {
    const running: SubagentRecord[] = [];

    for (const record of this.store.values()) {
      if (
        record.parentSessionId === parentSessionId &&
        record.status === 'running' &&
        !record.isBackground
      ) {
        running.push(record);
      }
    }

    this.logger.debug(
      '[SubagentRegistryService] getRunningBySession query result',
      {
        parentSessionId,
        totalRecords: this.store.size,
        runningCount: running.length,
      },
    );

    return running;
  }

  /**
   * Mark all running subagents as interrupted for a session.
   *
   * CRITICAL: Called by SessionLifecycleManager.endSession() when session aborts.
   * This is the key mechanism for detecting interrupted subagents since
   * SubagentStop hook doesn't fire on abort.
   *
   * @param parentSessionId - The parent session ID that was aborted
   */
  markAllInterrupted(parentSessionId: string): void {
    const interruptedAt = Date.now();
    let interruptedCount = 0;

    for (const record of this.store.values()) {
      if (
        record.parentSessionId === parentSessionId &&
        record.status === 'running' &&
        !record.isBackground && // Background agents outlive the session turn
        !record.isCliAgent // TASK_2025_186: CLI agents run independently of parent session
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
          },
        );
      }
    }

    if (interruptedCount > 0) {
      this.logger.info(
        '[SubagentRegistryService.markAllInterrupted] Session subagents interrupted',
        {
          parentSessionId,
          interruptedCount,
        },
      );
    }
  }

  /**
   * TASK_2025_186: Update parentSessionId for all records matching the old tab ID.
   * Called when the real SDK session UUID is resolved, so that
   * markParentSubagentsAsCliAgent() and markAllInterrupted() can find
   * records by either the tab ID or the real UUID.
   *
   * @param tabId - The temporary tab ID used during session creation
   * @param realSessionId - The real SDK session UUID
   */
  resolveParentSessionId(tabId: string, realSessionId: string): void {
    let updatedCount = 0;

    for (const record of this.store.values()) {
      if (record.parentSessionId === tabId) {
        (record as { parentSessionId: string }).parentSessionId = realSessionId;
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      this.logger.debug(
        '[SubagentRegistryService.resolveParentSessionId] Updated records',
        { tabId, realSessionId, updatedCount },
      );
    }
  }

  /**
   * TASK_2025_213 (Bug 2): Look up the Task tool's toolCallId by the
   * sub-agent's short hex ID (agentId).
   *
   * The SDK's canUseTool callback provides agentID (e.g., "a329b32") when
   * the tool runs inside a subagent. The frontend needs the Task tool's
   * toolCallId (e.g., "toolu_Task456") to identify the agent ExecutionNode.
   * This method bridges that gap by scanning the registry for a matching
   * agentId and returning the corresponding toolCallId.
   *
   * Returns the first running match (most relevant for permission denies).
   * If no running match, returns the first match of any status.
   *
   * @param agentId - The sub-agent's short hex ID from SDK (e.g., "a329b32")
   * @returns The Task tool's toolCallId, or null if not found
   */
  getToolCallIdByAgentId(agentId: string): string | null {
    let fallback: string | null = null;

    for (const [toolCallId, record] of this.store.entries()) {
      if (record.agentId === agentId) {
        // Prefer running agents (most relevant for in-flight permission denies)
        if (record.status === 'running') {
          return toolCallId;
        }
        // Keep first match as fallback
        if (!fallback) {
          fallback = toolCallId;
        }
      }
    }

    return fallback;
  }

  /**
   * Remove a specific subagent from the registry.
   *
   * Called when a subagent is successfully resumed (to prevent double-resume)
   * or when cleanup is needed.
   *
   * @param toolCallId - The subagent's toolCallId to remove
   */
  remove(toolCallId: string): void {
    const deleted = this.store.delete(toolCallId);
    if (deleted) {
      this.logger.debug('[SubagentRegistryService.remove] Subagent removed', {
        toolCallId,
      });
    }
  }

  /**
   * TASK_2025_217: Pre-mark a toolCallId as a background task.
   * Called by SdkMessageTransformer when it detects run_in_background: true
   * in a Task tool_use input. The subsequent register() call will auto-set
   * isBackground: true and status: 'background' on the SubagentRecord.
   *
   * @param toolCallId - The Task tool_use ID that will run in background
   */
  markPendingBackground(toolCallId: string): void {
    this.store.markPendingBackground(toolCallId);
    this.logger.debug(
      '[SubagentRegistryService.markPendingBackground] Marked toolCallId as pending background',
      { toolCallId, pendingCount: this.store.pendingBackgroundCount },
    );
  }

  /**
   * TASK_2025_213 (Bug 1): Mark a toolCallId as having been injected into
   * context. Call this BEFORE remove() so the ID is recorded before the
   * registry entry is deleted.
   *
   * @param toolCallId - The toolCallId that was injected into context
   */
  markAsInjected(toolCallId: string): void {
    this.store.markInjected(toolCallId);
    this.logger.debug(
      '[SubagentRegistryService.markAsInjected] Marked toolCallId as injected',
      { toolCallId, clearedMapSize: this.store.clearedCount },
    );
  }

  /**
   * TASK_2025_213 (Bug 1): Check if a toolCallId was previously injected
   * into context and should not be re-registered from history.
   *
   * @param toolCallId - The toolCallId to check
   * @returns true if the toolCallId was previously injected
   */
  wasInjected(toolCallId: string): boolean {
    return this.store.wasInjected(toolCallId);
  }

  /**
   * Remove all subagents for a parent session.
   *
   * Called when a session is permanently deleted (not just aborted).
   *
   * @param parentSessionId - The parent session ID to remove subagents for
   */
  removeBySessionId(parentSessionId: string): void {
    const toRemove: string[] = [];

    for (const [toolCallId, record] of this.store.entries()) {
      if (record.parentSessionId === parentSessionId) {
        toRemove.push(toolCallId);
      }
    }

    for (const toolCallId of toRemove) {
      this.store.delete(toolCallId);
    }

    if (toRemove.length > 0) {
      this.logger.info(
        '[SubagentRegistryService.removeBySessionId] Session subagents removed',
        {
          parentSessionId,
          removedCount: toRemove.length,
        },
      );
    }
  }

  /**
   * Get total count of records in registry (for diagnostics).
   *
   * @returns Number of records in registry
   */
  get size(): number {
    return this.store.size;
  }

  /**
   * Clear all records (for testing/cleanup).
   */
  clear(): void {
    this.store.clear();
    this.logger.debug('[SubagentRegistryService.clear] Registry cleared', {
      clearedToolCallIdsAlsoCleared: true,
    });
  }

  // ============================================================================
  // HISTORY-BASED REGISTRATION (TASK_2025_109)
  // ============================================================================

  /**
   * Register incomplete/interrupted agents from loaded session history.
   *
   * Delegates to {@link SubagentHistoryRegistrar}; see its docs for the
   * algorithm. The public signature, return value, and log messages are
   * unchanged.
   *
   * @param events - Array of FlatStreamEventUnion from session history
   * @param parentSessionId - The parent session ID these events belong to
   * @returns Number of interrupted agents registered
   */
  registerFromHistoryEvents(
    events: FlatStreamEventUnion[],
    parentSessionId: string,
  ): number {
    return this.historyRegistrar.register(events, parentSessionId);
  }
}
