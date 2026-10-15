import type { ExecutionNode } from '@ptah-extension/shared';

/**
 * One assistant message's top-level children, split into the collapsible
 * work log and the answer shown under it (design-spec §3.1).
 */
export interface TurnMessageSplit {
  /** Children rendered inside the work log, in tree order. */
  readonly log: readonly ExecutionNode[];
  /** Children rendered as the answer, in tree order. */
  readonly answer: readonly ExecutionNode[];
  /** True when the root has any non-text child (tool, agent, thinking, system). */
  readonly hasActivity: boolean;
  /** One-line text of the newest log row, or `null` when the log is empty. */
  readonly peek: string | null;
}

export interface TurnMessageSplitOptions {
  /** The message is the last assistant message of its turn. */
  readonly isLastAssistant: boolean;
  /** The message is still streaming. */
  readonly streaming: boolean;
}

/** The visible label of the thinking log row (`ptah-thinking-block`). */
const THINKING_PEEK = 'Extended Thinking';

const EMPTY: readonly ExecutionNode[] = [];

type SplitKey = 'last' | 'last-streaming' | 'other' | 'other-streaming';

/**
 * Results per root and option set. Keyed by root identity so a bubble's
 * `computed` gets the same arrays back for an unchanged tree and
 * `@for ... track child.id` does not re-render rows.
 */
const splitCache = new WeakMap<
  ExecutionNode,
  Partial<Record<SplitKey, TurnMessageSplit>>
>();

/** A child that belongs to the work log rather than to the answer text. */
function isActivityNode(node: ExecutionNode): boolean {
  return node.type !== 'text';
}

/** True when the root has any non-text top-level child. */
export function rootHasActivity(
  root: ExecutionNode | null | undefined,
): boolean {
  // Replayed/history messages and partial fixtures can omit the tree.
  return Array.isArray(root?.children) && root.children.some(isActivityNode);
}

/**
 * Split an assistant message's root into work log and answer.
 *
 * - No non-text child: the whole root is answer, `hasActivity` is false.
 * - Last assistant message of a settled turn: the text children after the last
 *   non-text child are the answer; everything before them is log.
 * - Otherwise (streaming, or an earlier message of the turn): everything is log.
 *
 * Pure; memoized by `root` identity and option set.
 */
export function splitTurnMessage(
  root: ExecutionNode,
  opts: TurnMessageSplitOptions,
): TurnMessageSplit {
  const key = splitKey(opts);
  const cached = splitCache.get(root);
  const hit = cached?.[key];
  if (hit) return hit;

  const result = computeSplit(root, opts);
  if (cached) {
    cached[key] = result;
  } else {
    splitCache.set(root, { [key]: result });
  }
  return result;
}

function splitKey(opts: TurnMessageSplitOptions): SplitKey {
  if (opts.isLastAssistant) {
    return opts.streaming ? 'last-streaming' : 'last';
  }
  return opts.streaming ? 'other-streaming' : 'other';
}

function computeSplit(
  root: ExecutionNode,
  opts: TurnMessageSplitOptions,
): TurnMessageSplit {
  // Replayed/history messages and partial fixtures can omit the children array.
  const children = root.children ?? EMPTY;
  let lastActivity = -1;
  for (let i = children.length - 1; i >= 0; i--) {
    if (isActivityNode(children[i])) {
      lastActivity = i;
      break;
    }
  }

  if (lastActivity === -1) {
    return { log: EMPTY, answer: children, hasActivity: false, peek: null };
  }

  const splitAnswer = opts.isLastAssistant && !opts.streaming;
  const log = splitAnswer ? children.slice(0, lastActivity + 1) : children;
  const answer = splitAnswer ? children.slice(lastActivity + 1) : EMPTY;
  return {
    log,
    answer,
    hasActivity: true,
    peek: peekOf(log[log.length - 1]),
  };
}

/** The one-line text of a log row. */
function peekOf(node: ExecutionNode | undefined): string | null {
  if (!node) return null;
  switch (node.type) {
    case 'tool':
      return node.toolName || null;
    case 'agent':
      return node.agentDescription || node.agentType || null;
    case 'thinking':
      return THINKING_PEEK;
    default:
      return firstLine(node.content);
  }
}

function firstLine(content: string | null): string | null {
  if (!content) return null;
  const line = content.split(/\r?\n/).find((part) => part.trim() !== '');
  return line ? line.trim() : null;
}
