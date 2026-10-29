import type {
  ExecutionChatMessage,
  ExecutionNode,
} from '@ptah-extension/shared';
import type { AgentStatusWord } from '@ptah-extension/chat-ui';
import {
  buildTurnContexts,
  type TurnContext,
} from '../../../utils/turn-facts.utils';
import type { SessionAgent } from '../../../services/session-agents/session-agent-roster';
import {
  laneKey,
  parseLaneKey,
} from '../../molecules/compact-session/compact-lane-rows';
import {
  collectNestedAgentNodes,
  type AgentTreeFor,
} from './transcript-agent-facts';

/** Assistant message id → its place in its turn (`buildTurnContexts`). */
export type TurnContexts = ReadonlyMap<string, TurnContext>;

/** Turn id → the roster entries of the agents the turn spawned. */
export type TurnAgents = ReadonlyMap<string, readonly SessionAgent[]>;

export const NO_TURN_CONTEXTS: TurnContexts = new Map();
export const NO_TURN_AGENTS: TurnAgents = new Map();
export const NO_SESSION_AGENTS: readonly SessionAgent[] = [];

const NO_IDS: readonly string[] = [];

/** Agent statuses that keep their turn live (work still in flight). */
const LIVE_AGENT_STATUSES: ReadonlySet<AgentStatusWord | null> =
  new Set<AgentStatusWord | null>(['running', 'waiting', 'queued']);

function sameIds(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Same turn facts. Per-message metrics are cached per message object
 * (`turn-facts.utils.ts`), so an unchanged message yields the same metrics
 * object and identity comparison suffices.
 */
function sameContext(a: TurnContext, b: TurnContext): boolean {
  return (
    a.turnId === b.turnId &&
    a.startTs === b.startTs &&
    a.index === b.index &&
    a.count === b.count &&
    a.isFirstAssistant === b.isFirstAssistant &&
    a.isLastAssistant === b.isLastAssistant &&
    a.hasActivity === b.hasActivity &&
    a.settledEndTs === b.settledEndTs &&
    sameIds(a.assistantIds, b.assistantIds) &&
    sameIds(a.messages, b.messages)
  );
}

/**
 * Turn contexts of the rendered transcript with stable identities: a turn
 * whose facts did not change keeps its previous context objects, so only the
 * live turn's bubbles see a new `turn` input while a message streams.
 */
export class TranscriptTurnContexts {
  private previous: TurnContexts = NO_TURN_CONTEXTS;

  compute(messages: readonly ExecutionChatMessage[]): TurnContexts {
    const next = new Map(buildTurnContexts(messages));
    // An empty finalized assistant record still has a slot, but no visible
    // answer or log. Give the first visible assistant the turn header.
    const byId = new Map(messages.map((message) => [message.id, message]));
    for (const [id, context] of next) {
      const firstVisibleId = context.assistantIds.find((assistantId) => {
        const assistant = byId.get(assistantId);
        return !!(assistant?.rawContent?.trim() || assistant?.streamingState?.children?.length);
      });
      const shouldLead = id === firstVisibleId;
      if (context.isFirstAssistant !== shouldLead) {
        next.set(id, { ...context, isFirstAssistant: shouldLead });
      }
    }
    if (next.size === 0) {
      this.previous = NO_TURN_CONTEXTS;
      return NO_TURN_CONTEXTS;
    }
    const stable = new Map<string, TurnContext>();
    for (const [id, ctx] of next) {
      const prev = this.previous.get(id);
      stable.set(id, prev && sameContext(prev, ctx) ? prev : ctx);
    }
    this.previous = stable;
    return stable;
  }
}

/** Agent tool call ids per tree root; trees are immutable once built. */
const agentIdsCache = new WeakMap<ExecutionNode, readonly string[]>();
const cliLaneIdsCache = new WeakMap<ExecutionNode, readonly string[]>();

function collectAgentIds(node: ExecutionNode, into: string[]): void {
  if (node.type === 'agent' && node.toolCallId) into.push(node.toolCallId);
  // Replayed/history messages and partial fixtures can omit the children array.
  for (const child of node.children ?? []) collectAgentIds(child, into);
}

/** Tool call ids of every agent node in `root`, at any depth. */
function agentToolCallIds(
  root: ExecutionNode | null | undefined,
): readonly string[] {
  if (!root) return NO_IDS;
  const cached = agentIdsCache.get(root);
  if (cached) return cached;
  const ids: string[] = [];
  collectAgentIds(root, ids);
  const result = ids.length > 0 ? ids : NO_IDS;
  agentIdsCache.set(root, result);
  return result;
}

function spawnResultText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    return output.map((item: unknown) =>
      item && typeof item === 'object' && 'type' in item && item.type === 'text' &&
      'text' in item && typeof item.text === 'string' ? item.text : '').join('\n');
  }
  if (output && typeof output === 'object' && 'content' in output) {
    return spawnResultText(output.content);
  }
  return '';
}

function collectCliLaneIds(node: ExecutionNode, into: string[]): void {
  if (node.type === 'tool' && node.status === 'complete' && node.isError !== true &&
    /(^|__)ptah_agent_spawn$/.test(node.toolName ?? '')) {
    const id = /\*\*Agent ID:\*\*\s*(\S+)/.exec(spawnResultText(node.toolOutput))?.[1];
    if (id) into.push(id);
  }
  for (const child of node.children ?? []) collectCliLaneIds(child, into);
}

function cliLaneIds(root: ExecutionNode | null | undefined): readonly string[] {
  if (!root) return NO_IDS;
  const cached = cliLaneIdsCache.get(root);
  if (cached) return cached;
  const ids: string[] = [];
  collectCliLaneIds(root, ids);
  const result = ids.length > 0 ? ids : NO_IDS;
  cliLaneIdsCache.set(root, result);
  return result;
}

/** Turn id → the roster keys of the agents its trees spawned. */
export type TurnAgentKeys = ReadonlyMap<string, ReadonlySet<string>>;

export const NO_TURN_AGENT_KEYS: TurnAgentKeys = new Map();

/**
 * The roster keys each turn owns: `laneKey('subagent' | 'background',
 * node.toolCallId)` of every agent node in the turn's trees. The agent node's
 * `toolCallId` is the roster's `SubagentRecord.parentToolUseId` (the key
 * `openSubagentLane` already resolves through `findAgentNode`). Successful
 * `ptah_agent_spawn` tool results link CLI lanes to the same turn by agent id.
 * CLI lanes spawned via `execute_code` have no spawn tool node and remain
 * sidebar-only. When `treeFor` is supplied, nested agents in each
 * top-level agent's store tree keep that same turn. Turns without an agent
 * have no entry and do not read the store.
 */
export function turnAgentKeysOf(
  messages: readonly ExecutionChatMessage[],
  contexts: TurnContexts,
  treeFor?: AgentTreeFor,
): TurnAgentKeys {
  if (contexts.size === 0) return NO_TURN_AGENT_KEYS;
  const keysByTurn = new Map<string, Set<string>>();
  for (const message of messages) {
    const ctx = contexts.get(message.id);
    if (!ctx) continue;
    const ids = agentToolCallIds(message.streamingState);
    const cliIds = cliLaneIds(message.streamingState);
    if (ids.length === 0 && cliIds.length === 0) continue;
    let keys = keysByTurn.get(ctx.turnId);
    if (!keys) {
      keys = new Set<string>();
      keysByTurn.set(ctx.turnId, keys);
    }
    for (const id of ids) {
      keys.add(laneKey('subagent', id));
      keys.add(laneKey('background', id));
    }
    for (const id of cliIds) keys.add(laneKey('cli', id));
  }
  if (treeFor) {
    for (const keys of keysByTurn.values()) {
      const agentIds: string[] = [];
      for (const key of keys) {
        const lane = parseLaneKey(key);
        if (lane?.kind === 'subagent') agentIds.push(lane.id);
      }
      for (const node of collectNestedAgentNodes(agentIds, treeFor)) {
        if (!node.toolCallId) continue;
        keys.add(laneKey('subagent', node.toolCallId));
        keys.add(laneKey('background', node.toolCallId));
      }
    }
  }
  return keysByTurn.size === 0 ? NO_TURN_AGENT_KEYS : keysByTurn;
}

/**
 * The roster entries each turn owns, in roster (dock) order. A turn whose
 * entries are unchanged keeps its previous array, so its bubble's `agents`
 * input does not change while another message streams.
 */
export function turnAgentsOf(
  keysByTurn: TurnAgentKeys,
  roster: readonly SessionAgent[],
  previous: TurnAgents,
): TurnAgents {
  if (keysByTurn.size === 0) return NO_TURN_AGENTS;
  const result = new Map<string, readonly SessionAgent[]>();
  for (const [turnId, keys] of keysByTurn) {
    const agents = roster.filter((agent) => keys.has(agent.key));
    if (agents.length === 0) continue;
    const prev = previous.get(turnId);
    result.set(turnId, prev && sameIds(prev, agents) ? prev : agents);
  }
  return result.size === 0 ? NO_TURN_AGENTS : result;
}

/**
 * Work-log open state of a turn (§3.1), shared by the main transcript and the
 * lane transcript: the user's choice, else open while the turn streams in
 * `full` mode, else `null` (the bubble's own rule).
 */
export function turnLogOpenOf(
  chosen: boolean | undefined,
  viewMode: 'full' | 'compact',
  streaming: boolean,
): boolean | null {
  if (chosen !== undefined) return chosen;
  return viewMode === 'full' && streaming ? true : null;
}

/** Turn ids with a message at or past `streamingBoundary` (still streaming). */
export function streamingTurnIdsOf(
  messages: readonly ExecutionChatMessage[],
  streamingBoundary: number,
  contexts: TurnContexts,
): ReadonlySet<string> {
  const streaming = new Set<string>();
  for (let i = streamingBoundary; i < messages.length; i++) {
    const ctx = contexts.get(messages[i].id);
    if (ctx) streaming.add(ctx.turnId);
  }
  return streaming;
}

/**
 * Turn ids that are live: the turn is still streaming, or one of its
 * turn-scoped agents is still running, waiting or queued.
 */
export function liveTurnIdsOf(
  streamingTurnIds: ReadonlySet<string>,
  turnAgents: TurnAgents,
): ReadonlySet<string> {
  const live = new Set<string>(streamingTurnIds);
  for (const [turnId, agents] of turnAgents) {
    if (agents.some((agent) => agent.kind !== 'cli' && LIVE_AGENT_STATUSES.has(agent.status))) {
      live.add(turnId);
    }
  }
  return live;
}
