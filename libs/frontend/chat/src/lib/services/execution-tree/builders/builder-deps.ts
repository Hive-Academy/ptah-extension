/**
 * BuilderDeps — dependency bag passed to every pure builder function.
 *
 * Pure builder functions (`message-node.fn.ts`, `tool-node.fn.ts`,
 * `agent-node.fn.ts`) take this object as their first arg. Recursion
 * between builders happens by calling `deps.buildMessageNode` /
 * `deps.buildToolNode` / `deps.buildAgentNode` — closures wired by the
 * orchestrating {@link ExecutionTreeBuilderService}.
 *
 * Why callbacks instead of direct file imports? Direct imports between
 * the three .fn files would re-create the module-level cycles the
 * Wave C7f split was supposed to eliminate. Callbacks keep .fn files
 * leaf-level: they import only this types file.
 */

import type {
  AgentStartEvent,
  ExecutionNode,
  MessageStartEvent,
  ToolStartEvent,
} from '@ptah-extension/shared';
import type { StreamingState } from '@ptah-extension/chat-types';
import type { BackgroundAgentStore } from '../../background-agent.store';
import type { AgentStatsService } from '../agent-stats.service';

export interface BuilderDeps {
  readonly backgroundAgentStore: BackgroundAgentStore;
  readonly agentStats: AgentStatsService;
  /**
   * Mutable Set tracking toolCallIds already logged as "unmatched" — keeps
   * console.debug from spamming hundreds of times during streaming rebuilds.
   * Cleared by ExecutionTreeBuilderService.clearCache() with no key.
   */
  readonly loggedUnmatchedToolCallIds: Set<string>;

  buildMessageNode(
    messageId: string,
    state: StreamingState,
    depth?: number,
  ): ExecutionNode | null;

  findMessageStartEvent(
    state: StreamingState,
    messageId: string,
  ): MessageStartEvent | undefined;

  buildToolNode(
    toolStart: ToolStartEvent,
    state: StreamingState,
    depth?: number,
  ): ExecutionNode;

  buildToolChildren(
    toolCallId: string,
    state: StreamingState,
    depth?: number,
  ): ExecutionNode[];

  collectTools(
    messageId: string,
    state: StreamingState,
    depth: number,
  ): ExecutionNode[];

  buildAgentNode(
    agentStart: AgentStartEvent,
    toolCallId: string,
    state: StreamingState,
    depth: number,
  ): ExecutionNode | null;

  buildInterleavedChildren(
    agentId: string,
    baseTimestamp: number,
    contentBlocks: Array<{
      type: 'text' | 'tool_ref';
      text?: string;
      toolUseId?: string;
      toolName?: string;
    }>,
    toolChildren: ExecutionNode[],
  ): ExecutionNode[];
}
