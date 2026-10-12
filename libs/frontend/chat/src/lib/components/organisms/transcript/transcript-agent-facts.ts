import {
  isAgentDispatchTool,
  type ExecutionChatMessage,
  type ExecutionNode,
} from '@ptah-extension/shared';
// Type only: the `$agents` module is lazy (forbidden-eager, D6); the import is
// erased at compile time.
import type { TurnAgentFacts } from '@ptah-extension/shared/mcp-apps-contracts/surface';

type AgentNodeFact = TurnAgentFacts['nodes'][number];

/**
 * The `$agents` facts of every transcript turn (TASK_2026_623, D6-D8,
 * component 7), one entry per user message in transcript order. Index `i` is
 * the turn opened by the `i`-th user message, and `startedAt` is that
 * message's `timestamp` (D7, CLI lanes).
 *
 * A turn holds the trees of the assistant messages after its user message, up
 * to the next one. An assistant message before the first user message belongs
 * to no turn (same rule as `groupTurns`); other roles are skipped.
 *
 * Per tree, walked whole in execution-tree order (pre-order):
 * - `nodes` (N, D7): every foreground `agent` node, nested agents included.
 *   A background agent node (`isBackground`) is the Task tool's placeholder,
 *   whose values belong to its SDK record; it is not an N (R5 source table:
 *   "foreground subagent ExecutionNodes").
 * - `spawnToolCallIds` (R attribution, D7 and A3): the `toolCallId` of every
 *   agent-dispatch tool node (`Task`, `Agent`, ...) and every agent node,
 *   background ones included, first occurrence kept. A subagent record's
 *   `parentToolUseId` is the Task tool_use id (`SubagentRecord` docblock,
 *   `agent-monitor.store.ts`), which the tree carries on the Task tool node
 *   even when no agent node exists, so a record-only agent (R5.9(d)) still
 *   finds its turn. A record no tree carries belongs to no turn.
 *
 * Allow-list (R5.1, D6): each N copies only `id`, `toolCallId`, `agentId`,
 * `agentType`, `startTime`, `tokens` (`tokenUsage` input + output), `cost`,
 * `durationMs` (`duration`) and `status`. Prompt, description, summary,
 * content, tool input and output and errors are never read.
 *
 * Pure and per call: no module-level state, so each transcript projects its
 * own messages. N values come from the stored tree, so they rebuild on reload
 * (D8).
 */
export function collectTurnAgentFacts(
  messages: readonly ExecutionChatMessage[],
  activeTrees: readonly ExecutionNode[] = [],
): readonly TurnAgentFacts[] {
  const turns: TurnBuilder[] = [];
  const recordedTreeIds = new Set<string>();
  for (const message of messages) {
    if (message.role === 'user') {
      turns.push({
        startedAt: message.timestamp,
        nodes: [],
        spawnToolCallIds: new Set<string>(),
      });
      continue;
    }
    const turn = turns.at(-1);
    if (
      message.role !== 'assistant' ||
      turn === undefined ||
      message.streamingState === null
    ) {
      continue;
    }
    recordedTreeIds.add(message.streamingState.id);
    collectTree(message.streamingState, turn);
  }
  const activeTurn = turns.at(-1);
  if (activeTurn !== undefined) {
    for (const tree of activeTrees) {
      if (!recordedTreeIds.has(tree.id)) collectTree(tree, activeTurn);
    }
  }
  return turns.map((turn) => ({
    startedAt: turn.startedAt,
    nodes: turn.nodes,
    spawnToolCallIds: [...turn.spawnToolCallIds],
  }));
}

/** One turn while its messages are walked. */
interface TurnBuilder {
  readonly startedAt: number;
  readonly nodes: AgentNodeFact[];
  readonly spawnToolCallIds: Set<string>;
}

function collectTree(root: ExecutionNode, turn: TurnBuilder): void {
  const visit = (node: ExecutionNode): void => {
    const spawns =
      node.type === 'agent' ||
      (node.type === 'tool' &&
        node.toolName !== undefined &&
        isAgentDispatchTool(node.toolName));
    if (spawns && node.toolCallId !== undefined) {
      turn.spawnToolCallIds.add(node.toolCallId);
    }
    if (node.type === 'agent' && node.isBackground !== true) {
      turn.nodes.push(agentNodeFact(node));
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
}

/** The allow-listed fields of one agent node; absent values stay absent. */
function agentNodeFact(node: ExecutionNode): AgentNodeFact {
  const usage = node.tokenUsage;
  return {
    id: node.id,
    status: node.status,
    ...(node.toolCallId !== undefined && { toolCallId: node.toolCallId }),
    ...(node.agentId !== undefined && { agentId: node.agentId }),
    ...(node.agentType !== undefined && { agentType: node.agentType }),
    ...(node.startTime !== undefined && { startTime: node.startTime }),
    ...(usage !== undefined && { tokens: usage.input + usage.output }),
    ...(node.cost !== undefined && { cost: node.cost }),
    ...(node.duration !== undefined && { durationMs: node.duration }),
  };
}
