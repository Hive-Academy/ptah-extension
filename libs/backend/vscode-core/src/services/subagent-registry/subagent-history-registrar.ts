/**
 * Subagent History Registrar
 *
 * Library-internal helper that handles history-based replay registration
 * for {@link SubagentRegistryService}.
 *
 * Responsibilities:
 * - Parse `FlatStreamEventUnion[]` loaded from session history (JSONL) and
 *   register agents that started but never completed as `'interrupted'`.
 * - Skip agents that were already injected into context (via
 *   {@link SubagentStateStore.wasInjected}).
 * - Skip agents that were superseded by a later successful resume.
 *
 * This helper is **library-internal** — it is not `@injectable()`.
 * {@link SubagentRegistryService} owns a single instance and delegates to it.
 *
 * @packageDocumentation
 */

import type { Logger } from '../../logging';
import type {
  FlatStreamEventUnion,
  AgentStartEvent,
  ToolResultEvent,
  SubagentRecord,
  SubagentStatus,
} from '@ptah-extension/shared';
import type { SubagentStateStore } from './subagent-state-store';

/**
 * Registers incomplete/interrupted agents into the shared
 * {@link SubagentStateStore} by replaying session-history events.
 *
 * Preserves the exact algorithm, log messages, and skip conditions of the
 * original `SubagentRegistryService.registerFromHistoryEvents()`.
 */
export class SubagentHistoryRegistrar {
  constructor(
    private readonly store: SubagentStateStore,
    private readonly logger: Logger,
  ) {}

  /**
   * Register incomplete/interrupted agents from loaded session history.
   *
   * When loading a session from JSONL history (cold load), SDK hooks don't
   * fire, so the registry is empty. This method parses history events to
   * detect agents that started but never completed, and registers them as
   * 'interrupted' for potential resumption.
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
   */
  register(events: FlatStreamEventUnion[], parentSessionId: string): number {
    this.store.lazyCleanup();
    const agentStartEvents: AgentStartEvent[] = events.filter(
      (e): e is AgentStartEvent => e.eventType === 'agent_start',
    );

    if (agentStartEvents.length === 0) {
      this.logger.debug(
        '[SubagentRegistryService.registerFromHistoryEvents] No agent_start events found',
        { parentSessionId, eventCount: events.length },
      );
      return 0;
    }
    const completedToolCallIds = new Set<string>(
      events
        .filter((e): e is ToolResultEvent => e.eventType === 'tool_result')
        .map((e) => e.toolCallId),
    );
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
        completedToolCallIds.has(tcId),
      );
      if (hasCompleted) {
        for (const tcId of toolCallIds) {
          if (!completedToolCallIds.has(tcId)) {
            supersededToolCallIds.add(tcId);
            this.logger.debug(
              '[SubagentRegistryService.registerFromHistoryEvents] Marking toolCallId as superseded',
              {
                toolCallId: tcId,
                agentId,
                reason: 'agent has a completed resume',
              },
            );
          }
        }
      }
    }
    let registeredCount = 0;

    for (const agentStart of agentStartEvents) {
      const { toolCallId, agentType, agentId, sessionId, timestamp } =
        agentStart;
      if (this.store.has(toolCallId)) {
        this.logger.debug(
          '[SubagentRegistryService.registerFromHistoryEvents] Agent already registered, skipping',
          { toolCallId, agentType },
        );
        continue;
      }
      if (this.store.wasInjected(toolCallId)) {
        this.logger.debug(
          '[SubagentRegistryService.registerFromHistoryEvents] Agent already injected into context, skipping',
          { toolCallId, agentType },
        );
        continue;
      }
      if (completedToolCallIds.has(toolCallId)) {
        this.logger.debug(
          '[SubagentRegistryService.registerFromHistoryEvents] Agent completed, skipping',
          { toolCallId, agentType },
        );
        continue;
      }
      if (supersededToolCallIds.has(toolCallId)) {
        this.logger.debug(
          '[SubagentRegistryService.registerFromHistoryEvents] Agent superseded by successful resume, skipping',
          { toolCallId, agentType, agentId },
        );
        continue;
      }
      if (!agentId) {
        this.logger.debug(
          '[SubagentRegistryService.registerFromHistoryEvents] Skipping agent without agentId (no transcript for resume)',
          { toolCallId, agentType },
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

      this.store.set(toolCallId, record);
      registeredCount++;

      this.logger.debug(
        '[SubagentRegistryService.registerFromHistoryEvents] Registered interrupted agent',
        {
          toolCallId,
          agentType,
          agentId: record.agentId,
          parentSessionId,
        },
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
          registrySize: this.store.size,
        },
      );
    }

    return registeredCount;
  }
}
