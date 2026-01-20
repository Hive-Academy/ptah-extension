/**
 * Agent Correlation Service
 *
 * Correlates agent sessions to Task tool_uses using timestamp-based matching.
 * Extracted from SessionHistoryReaderService for single responsibility.
 *
 * Responsibilities:
 * - Build agent data map (filter warmup agents, extract timestamps)
 * - Extract Task tool_use blocks from messages
 * - Correlate agents to tasks by timestamp proximity
 * - Extract tool_result blocks from user messages
 *
 * @see TASK_2025_106 - Session History Reader Refactoring
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { isTaskToolInput } from '@ptah-extension/shared';
import type {
  SessionHistoryMessage,
  AgentSessionData,
  AgentDataMapEntry,
  TaskToolUse,
  ToolResultData,
  ContentBlock,
} from './history.types';

/**
 * Service for correlating agent sessions to Task tool invocations.
 *
 * Pattern: Injectable service with Logger dependency
 * @see libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:158-164
 */
@injectable()
export class AgentCorrelationService {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Build a map of agent sessions keyed by agentId.
   *
   * Filters out warmup agents by checking if the first message content is "warmup".
   * Extracts timestamp from first message that has one.
   * Defaults to Date.now() if no timestamp found.
   *
   * @param agentSessions - Array of agent session data from JSONL files
   * @returns Map of agentId to agent data entry
   */
  buildAgentDataMap(
    agentSessions: AgentSessionData[]
  ): Map<string, AgentDataMapEntry> {
    const map = new Map<string, AgentDataMapEntry>();

    for (const agent of agentSessions) {
      let slug: string | null = null;
      let timestamp: number | null = null;

      for (const msg of agent.messages) {
        if (msg.slug && !slug) slug = msg.slug;
        // Only extract timestamp from first message that has it
        if (msg.timestamp && timestamp === null) {
          timestamp = new Date(msg.timestamp).getTime();
        }
      }

      // Default to current time if no timestamp found
      if (timestamp === null) {
        timestamp = Date.now();
      }

      // Filter warmup agents by checking first message content
      // Warmup agents have first user message content = "Warmup"
      // Real agents have first user message content = actual task prompt
      const firstMsg = agent.messages[0];
      // Cast to unknown first since actual JSONL format has string content for user messages
      // but the JSONLMessage type expects ContentBlock[]
      const msgContent = firstMsg?.message?.content as unknown;
      let firstMsgContent = '';
      if (typeof msgContent === 'string') {
        firstMsgContent = msgContent.trim().toLowerCase();
      }
      const isWarmupAgent = firstMsgContent === 'warmup';

      if (isWarmupAgent) {
        this.logger.debug('[AgentCorrelation] Skipping warmup agent', {
          agentId: agent.agentId,
          messageCount: agent.messages.length,
          firstMsgContent: firstMsgContent.substring(0, 50),
        });
        continue;
      }

      map.set(agent.agentId, {
        agentId: agent.agentId,
        timestamp,
        executionMessages: agent.messages,
      });
    }

    return map;
  }

  /**
   * Extract Task tool_use blocks from assistant messages.
   *
   * Scans through messages looking for tool_use blocks with name='Task'.
   * Extracts the toolUseId, timestamp, and subagent_type from each.
   *
   * @param messages - Array of session history messages
   * @returns Array of task tool uses with timestamps
   */
  extractTaskToolUses(messages: SessionHistoryMessage[]): TaskToolUse[] {
    const tasks: TaskToolUse[] = [];

    for (const msg of messages) {
      if (msg.type !== 'assistant' || !msg.message?.content) continue;

      const timestamp = msg.timestamp
        ? new Date(msg.timestamp).getTime()
        : Date.now();

      const content = msg.message.content;
      if (!Array.isArray(content)) continue;

      for (const block of content as ContentBlock[]) {
        if (block.type === 'tool_use' && block.name === 'Task' && block.id) {
          let subagentType = 'unknown';
          if (block.input && isTaskToolInput(block.input)) {
            subagentType = block.input.subagent_type;
          }
          tasks.push({
            toolUseId: block.id,
            timestamp,
            subagentType,
          });
        }
      }
    }

    return tasks;
  }

  /**
   * Correlate agents to Task tool_uses by timestamp proximity.
   *
   * Uses a timestamp-based matching algorithm:
   * - Sort tasks and agents by timestamp
   * - For each task, find the agent with timestamp in window [-1s, +60s)
   * - Pick the closest match within the window
   * - Each agent can only be matched once
   *
   * Correlation window: agent.timestamp - task.timestamp >= -1000 && < 60000
   *
   * @param taskToolUses - Array of task tool uses extracted from messages
   * @param agentDataMap - Map of agent data built from agent sessions
   * @returns Map of toolUseId to agentId
   */
  correlateAgentsToTasks(
    taskToolUses: TaskToolUse[],
    agentDataMap: Map<string, AgentDataMapEntry>
  ): Map<string, string> {
    const map = new Map<string, string>();
    const usedAgents = new Set<string>();

    const sortedTasks = [...taskToolUses].sort(
      (a, b) => a.timestamp - b.timestamp
    );
    const sortedAgents = [...agentDataMap.values()].sort(
      (a, b) => a.timestamp - b.timestamp
    );

    for (const task of sortedTasks) {
      let bestMatch: string | null = null;
      let bestTimeDiff = Infinity;

      for (const agent of sortedAgents) {
        if (usedAgents.has(agent.agentId)) continue;

        const timeDiff = agent.timestamp - task.timestamp;
        // Correlation window: agent must start within -1s to +60s of task
        if (timeDiff >= -1000 && timeDiff < bestTimeDiff && timeDiff < 60000) {
          bestTimeDiff = timeDiff;
          bestMatch = agent.agentId;
        }
      }

      if (bestMatch) {
        map.set(task.toolUseId, bestMatch);
        usedAgents.add(bestMatch);
      } else {
        this.logger.warn('[AgentCorrelation] No agent found for task', {
          toolUseId: task.toolUseId,
          taskTimestamp: task.timestamp,
          subagentType: task.subagentType,
        });
      }
    }

    return map;
  }

  /**
   * Extract all tool_result blocks from user messages.
   *
   * Scans through user messages looking for tool_result blocks.
   * Extracts the content and error status for each, keyed by tool_use_id.
   *
   * @param messages - Array of session history messages
   * @returns Map of tool_use_id to tool result data
   */
  extractAllToolResults(
    messages: SessionHistoryMessage[]
  ): Map<string, ToolResultData> {
    const results = new Map<string, ToolResultData>();

    for (const msg of messages) {
      if (msg.type !== 'user' || !msg.message?.content) continue;

      const content = msg.message.content;
      if (!Array.isArray(content)) continue;

      for (const block of content as ContentBlock[]) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          let resultText = '';
          const blockContent = block.content;

          if (typeof blockContent === 'string') {
            resultText = blockContent;
          } else if (Array.isArray(blockContent)) {
            resultText = (blockContent as ContentBlock[])
              .filter((c) => c.type === 'text')
              .map((c) => c.text || '')
              .join('\n');
          }

          results.set(block.tool_use_id, {
            content: resultText,
            isError: block.is_error === true,
          });
        }
      }
    }

    return results;
  }
}
