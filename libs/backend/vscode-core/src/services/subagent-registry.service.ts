/**
 * Subagent Registry Service (coordinator)
 *
 * Maintains an in-memory registry of subagent lifecycle states to enable
 * resumption of interrupted subagent executions. Tracks subagents from
 * SubagentStart hook through completion or interruption.
 *
 * This class is a thin coordinator. Persistence primitives (the in-memory
 * Map, cleared/pending sets, TTL expiration, lazy cleanup) live in
 * {@link SubagentStateStore}. History-based replay registration lives in
 * {@link SubagentHistoryRegistrar}.
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
    this.store.lazyCleanup();
    this.removeSupersededInterrupted(registration);
    const isPendingBackground = this.store.consumePendingBackground(
      registration.toolCallId,
    );
    // Prefer a name already on the registration (e.g. history replay); otherwise
    // consume the pending name captured from the Task tool_use before the hook.
    const teammateName =
      registration.teammateName ??
      this.store.consumePendingTeammateName(registration.toolCallId);

    const record: SubagentRecord = {
      ...registration,
      status: isPendingBackground
        ? ('background' as SubagentStatus)
        : ('running' as SubagentStatus),
      ...(isPendingBackground && {
        isBackground: true,
        backgroundStartedAt: Date.now(),
      }),
      ...(teammateName ? { teammateName } : {}),
    };

    this.store.set(registration.toolCallId, record);

    this.logger.info('[SubagentRegistryService.register] Subagent registered', {
      toolCallId: registration.toolCallId,
      sessionId: registration.sessionId,
      agentType: registration.agentType,
      agentId: registration.agentId,
      teammateName,
      parentSessionId: registration.parentSessionId,
      registrySize: this.store.size,
    });
  }

  /**
   * Pre-mark a human-legible teammate name for a not-yet-registered toolCallId.
   *
   * Called by SdkMessageTransformer when it observes the Agent/Task tool_use
   * `name` input, which is present BEFORE the SubagentStart hook fires. The
   * subsequent register() call consumes this name and stores it on the record
   * as teammateName.
   *
   * @param toolCallId - The Task tool_use ID that will spawn a named teammate
   * @param teammateName - The human-legible name from the tool_use input
   */
  markPendingTeammateName(toolCallId: string, teammateName: string): void {
    this.store.markPendingTeammateName(toolCallId, teammateName);
    this.logger.debug(
      '[SubagentRegistryService.markPendingTeammateName] Marked toolCallId with teammate name',
      { toolCallId, teammateName },
    );
  }

  /**
   * Peek at a pending teammate name for a not-yet-registered toolCallId WITHOUT
   * consuming it. Emit sites use this to populate `teammateName` on identity
   * events during the window between observing the Task tool_use `name` input
   * and the SubagentStart hook registering the record — without stealing the
   * name from the eventual register() consumption.
   *
   * @param toolCallId - The Task tool_use ID to look up
   * @returns The pending teammate name, or undefined when none was recorded
   */
  peekPendingTeammateName(toolCallId: string): string | undefined {
    return this.store.peekPendingTeammateName(toolCallId);
  }

  /**
   * Look up a SubagentRecord by its human-legible teammate name.
   *
   * Returns the first running match (most relevant for live steering); if no
   * running match exists, returns the first match of any status. Returns null
   * when no record carries the name.
   *
   * @param teammateName - The human-legible teammate name to resolve
   * @returns The matching SubagentRecord, or null if not found
   */
  getByName(teammateName: string): SubagentRecord | null {
    let fallback: SubagentRecord | null = null;

    for (const record of this.store.values()) {
      if (record.teammateName === teammateName) {
        if (record.status === 'running') {
          return record;
        }
        if (!fallback) {
          fallback = record;
        }
      }
    }

    return fallback;
  }

  /**
   * Look up the Task tool's toolCallId by the teammate's human-legible name.
   *
   * Mirrors {@link getToolCallIdByAgentId} but keys on the coordinator-supplied
   * name rather than the SDK short-hex agentId. Returns the first running match,
   * else the first match of any status, else null.
   *
   * @param teammateName - The human-legible teammate name to resolve
   * @returns The Task tool's toolCallId, or null if not found
   */
  getToolCallIdByName(teammateName: string): string | null {
    let fallback: string | null = null;

    for (const [toolCallId, record] of this.store.entries()) {
      if (record.teammateName === teammateName) {
        if (record.status === 'running') {
          return toolCallId;
        }
        if (!fallback) {
          fallback = toolCallId;
        }
      }
    }

    return fallback;
  }

  /**
   * When a new registration shares an agentId with an existing interrupted
   * record, the interrupted agent is being resumed — drop the stale record
   * so it is no longer reported as resumable.
   */
  private removeSupersededInterrupted(
    registration: SubagentRegistration,
  ): void {
    if (!registration.agentId) {
      return;
    }

    const toRemove: string[] = [];
    for (const [toolCallId, record] of this.store.entries()) {
      if (
        toolCallId !== registration.toolCallId &&
        record.agentId === registration.agentId &&
        record.status === 'interrupted'
      ) {
        toRemove.push(toolCallId);
      }
    }

    for (const toolCallId of toRemove) {
      this.store.markInjected(toolCallId);
      this.store.delete(toolCallId);
      this.logger.info(
        '[SubagentRegistryService.register] Removed interrupted record superseded by live resume',
        {
          supersededToolCallId: toolCallId,
          agentId: registration.agentId,
          newToolCallId: registration.toolCallId,
        },
      );
    }
  }

  /**
   * Update an existing subagent's status and optional fields.
   *
   * Typically called when SubagentStop hook fires to mark as 'completed'.
   *
   * Completed subagents are deleted immediately instead of being kept for
   * 24 hours. Only interrupted subagents are kept for potential resumption.
   * This prevents memory accumulation.
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
    if (
      updates.status === 'completed' ||
      updates.status === 'background_completed'
    ) {
      if (
        record.status === 'interrupted' &&
        this.store.isInTeardown(record.parentSessionId)
      ) {
        this.logger.info(
          '[SubagentRegistryService.update] Ignoring completed status during session teardown — keeping interrupted record for resume',
          {
            toolCallId,
            agentType: record.agentType,
            parentSessionId: record.parentSessionId,
          },
        );
        return;
      }
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
    this.store.lazyCleanup();

    const record = this.store.getRaw(toolCallId);
    if (!record) {
      return null;
    }
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
   * Look up a SubagentRecord by its SDK task_id.
   *
   * Used by SubagentMessageDispatcher to resolve a taskId from the frontend
   * into the registry record for routing subagent:stop calls.
   *
   * @param taskId - The SDK task_id from SDKTaskStartedMessage
   * @returns The matching SubagentRecord, or undefined if not found
   */
  findByTaskId(taskId: string): SubagentRecord | undefined {
    for (const record of this.store.values()) {
      if (record.taskId === taskId) {
        return record;
      }
    }
    return undefined;
  }

  /**
   * Associate an SDK task_id with a toolCallId entry.
   *
   * Called when SdkMessageTransformer receives task_started so that later
   * stop/interrupt calls can look up the SDK taskId from the registry.
   *
   * @param toolCallId - The Task tool_use ID (registry key)
   * @param taskId - The SDK task_id to associate
   */
  setTaskId(toolCallId: string, taskId: string): void {
    const record = this.store.getRaw(toolCallId);
    if (!record) {
      this.logger.debug(
        '[SubagentRegistryService.setTaskId] Record not found, cannot set taskId',
        { toolCallId, taskId },
      );
      return;
    }
    this.store.set(toolCallId, { ...record, taskId });
  }

  /**
   * Get all resumable subagents (status='interrupted', within TTL).
   *
   * Returns subagents that can be resumed via SDK's resume parameter.
   */
  getResumable(): SubagentRecord[] {
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
   * Used by the frontend to show confirmation before interrupting.
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
   * Mark a parent session as being torn down.
   *
   * While in teardown, 'completed' updates for records already marked
   * 'interrupted' are ignored — the SDK's graceful interrupt fires
   * SubagentStop for agents that endSession() just marked interrupted, and
   * honoring that stop would delete the record and lose resumability.
   *
   * Callers MUST pair this with endSessionTeardown() (try/finally).
   *
   * @param parentSessionId - The parent session ID entering teardown
   */
  beginSessionTeardown(parentSessionId: string): void {
    this.store.beginTeardown(parentSessionId);
  }

  /**
   * Clear the teardown marker set by beginSessionTeardown().
   *
   * @param parentSessionId - The parent session ID leaving teardown
   */
  endSessionTeardown(parentSessionId: string): void {
    this.store.endTeardown(parentSessionId);
  }

  /**
   * Increment and return the number of times a record's interrupted-agent
   * context has been injected into a chat:continue prompt.
   *
   * @param toolCallId - The subagent's toolCallId
   * @returns The attempt count after incrementing
   */
  recordInjectionAttempt(toolCallId: string): number {
    return this.store.recordInjectionAttempt(toolCallId);
  }

  /**
   * Current injection-attempt count for a record.
   *
   * @param toolCallId - The subagent's toolCallId
   * @returns Number of prior injection attempts
   */
  getInjectionAttempts(toolCallId: string): number {
    return this.store.getInjectionAttempts(toolCallId);
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
        !record.isCliAgent // CLI agents run independently of parent session
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
   * Update parentSessionId for all records matching the old tab ID.
   *
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
   * Look up the Task tool's toolCallId by the sub-agent's short hex ID
   * (agentId).
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
        if (record.status === 'running') {
          return toolCallId;
        }
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
   * Pre-mark a toolCallId as a background task.
   *
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
   * Mark a toolCallId as having been injected into context.
   *
   * Call this BEFORE remove() so the ID is recorded before the registry
   * entry is deleted.
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
   * Check if a toolCallId was previously injected into context and should
   * not be re-registered from history.
   *
   * @param toolCallId - The toolCallId to check
   * @returns true if the toolCallId was previously injected
   */
  wasInjected(toolCallId: string): boolean {
    return this.store.wasInjected(toolCallId);
  }

  /**
   * Prune subagent entries scoped to a parent session.
   *
   * Invoked from `SdkMessageTransformer` on `compact_boundary` to drop any
   * pre-compaction subagent records for the active session. After compaction,
   * the displayed message stream is sliced past the boundary, so pre-boundary
   * subagents must not continue counting in the AGENTS header (registry was
   * the cause of the "AGENTS 4" stale counter screenshot).
   *
   * Public, idempotent (no-op if no entries match), returns nothing.
   * Excludes background agents — they outlive compaction by design.
   *
   * @param parentSessionId - The parent session ID to prune subagents for
   */
  pruneSession(parentSessionId: string): void {
    if (!parentSessionId) {
      return;
    }

    const toRemove: string[] = [];
    for (const [toolCallId, record] of this.store.entries()) {
      if (
        record.parentSessionId === parentSessionId &&
        !record.isBackground &&
        record.status !== 'background'
      ) {
        toRemove.push(toolCallId);
      }
    }

    for (const toolCallId of toRemove) {
      this.store.delete(toolCallId);
    }

    if (toRemove.length > 0) {
      this.logger.info(
        '[SubagentRegistryService.pruneSession] Pruned pre-boundary subagents',
        {
          parentSessionId,
          prunedCount: toRemove.length,
          remainingRegistry: this.store.size,
        },
      );
    }
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
