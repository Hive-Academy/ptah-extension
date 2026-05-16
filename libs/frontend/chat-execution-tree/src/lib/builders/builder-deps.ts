/**
 * BuilderDeps — dependency bag passed to every pure builder function.
 *
 * Pure builder functions (`message-node.fn.ts`, `tool-node.fn.ts`,
 * `agent-node.fn.ts`) take this object as their first arg. Recursion
 * between builders happens by calling `deps.buildMessageNode` /
 * `deps.buildToolNode` / `deps.buildAgentNode` — closures wired by the
 * orchestrating `ExecutionTreeBuilderService` (lives in @ptah-extension/chat).
 *
 * Why callbacks instead of direct file imports? Direct imports between
 * the three .fn files would re-create module-level cycles. Callbacks keep
 * .fn files leaf-level: they import only this types file.
 */

import type {
  AgentStartEvent,
  ExecutionNode,
  MessageStartEvent,
  ToolStartEvent,
} from '@ptah-extension/shared';
import type { StreamingState } from '@ptah-extension/chat-types';
import type { AgentStatsService } from '../agent-stats.service';

/**
 * Minimal port for the background-agent flag lookup. Inverted-dependency
 * shape: the concrete `BackgroundAgentStore` lives in `@ptah-extension/chat`
 * and bundles with `ExecutionTreeBuilderService`. Typing this lib's
 * `BuilderDeps` against the structural port keeps the runtime graph
 * one-directional (chat → chat-execution-tree only) and lets specs supply
 * lightweight stubs without dragging the chat library in.
 */
export interface BackgroundAgentLookup {
  isBackgroundAgent(toolCallId: string): boolean;
}

export interface BuilderDeps {
  readonly backgroundAgentStore: BackgroundAgentLookup;
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
