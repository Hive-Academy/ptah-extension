import {
  createExecutionChatMessage,
  createExecutionNode,
  type ExecutionChatMessage,
  type ExecutionNode,
  type FlatStreamEventUnion,
} from '@ptah-extension/shared';

/**
 * One node for two trees of the same message: children by id in first-seen
 * order; the later tree's copy of a child, its status and its stats win
 * (it carries the newer results).
 */
function mergeMessageNodes(
  earlier: ExecutionNode,
  later: ExecutionNode,
): ExecutionNode {
  const children = new Map<string, ExecutionNode>();
  for (const child of earlier.children ?? []) children.set(child.id, child);
  for (const child of later.children ?? []) children.set(child.id, child);
  return {
    ...earlier,
    status: later.status,
    children: [...children.values()],
    tokenUsage: later.tokenUsage ?? earlier.tokenUsage,
    cost: later.cost ?? earlier.cost,
    duration: later.duration ?? earlier.duration,
  };
}

/** Adapt lane trees to the same message contract as the main transcript. */
export function laneTranscriptMessages(
  laneId: string,
  nodes: readonly ExecutionNode[],
  events: readonly FlatStreamEventUnion[] = [],
): ExecutionChatMessage[] {
  const starts = events.filter(
    (event) => event.eventType === 'message_start' && event.role === 'user',
  );
  const userIds = new Set(starts.map((event) => event.messageId));
  const textByUser = new Map<string, ExecutionNode[]>();
  for (const node of nodes) {
    if (node.type !== 'text') continue;
    const separator = node.id.lastIndexOf('-text-');
    if (separator < 0) continue;
    const messageId = node.id.slice(0, separator);
    if (!userIds.has(messageId)) continue;
    const text = textByUser.get(messageId) ?? [];
    text.push(node);
    textByUser.set(messageId, text);
  }
  const deltasByUser = new Map<string, string[]>();
  for (const event of events) {
    if (event.eventType !== 'text_delta' || !userIds.has(event.messageId))
      continue;
    const deltas = deltasByUser.get(event.messageId) ?? [];
    deltas.push(event.delta);
    deltasByUser.set(event.messageId, deltas);
  }
  const userTextIds = new Set<string>();
  const users: ExecutionChatMessage[] = [];
  const seen = new Set<string>();
  for (const event of starts) {
    if (seen.has(event.messageId)) continue;
    seen.add(event.messageId);
    const text = textByUser.get(event.messageId) ?? [];
    for (const node of text) userTextIds.add(node.id);
    const content = text.length
      ? text.map((node) => node.content ?? '').join('\n\n')
      : (deltasByUser.get(event.messageId) ?? []).join('');
    if (content)
      users.push(
        createExecutionChatMessage({
          id: `${laneId}:user:${event.messageId}`,
          role: 'user',
          timestamp: event.timestamp,
          rawContent: content,
        }),
      );
  }
  users.sort((a, b) => a.timestamp - b.timestamp);

  const messages: ExecutionChatMessage[] = [];
  /** Emitted SDK message node per id, with its position in `messages`. */
  const emitted = new Map<string, { index: number; node: ExecutionNode }>();
  let children: ExecutionNode[] = [];
  const flush = () => {
    if (!children.length) return;
    const root = createExecutionNode({
      id: `${laneId}:message:${children[0].id}`,
      type: 'message',
      status: children.some((node) => node.status === 'streaming')
        ? 'streaming'
        : 'complete',
      startTime: children[0].startTime,
      children,
    });
    messages.push(
      createExecutionChatMessage({
        id: root.id,
        role: 'assistant',
        timestamp: root.startTime ?? 0,
        streamingState: root,
      }),
    );
    children = [];
  };
  let previousTime = -Infinity;
  let userIndex = 0;
  for (const node of nodes) {
    if (userTextIds.has(node.id)) {
      flush();
      continue;
    }
    const time = node.startTime ?? previousTime;
    while (userIndex < users.length && users[userIndex].timestamp <= time) {
      if (users[userIndex].timestamp > previousTime) flush();
      userIndex++;
    }
    if (node.type === 'message') {
      flush();
      const previous = emitted.get(node.id);
      if (previous) {
        // A message that streams on after its agent finalized comes back as
        // a second tree with the same id (the store replays its
        // message_start). One message id is one bubble.
        const merged = mergeMessageNodes(previous.node, node);
        emitted.set(node.id, { index: previous.index, node: merged });
        messages[previous.index] = createExecutionChatMessage({
          id: `${laneId}:${node.id}`,
          role: 'assistant',
          timestamp: merged.startTime ?? 0,
          streamingState: merged,
        });
      } else {
        emitted.set(node.id, { index: messages.length, node });
        messages.push(
          createExecutionChatMessage({
            id: `${laneId}:${node.id}`,
            role: 'assistant',
            timestamp: node.startTime ?? 0,
            streamingState: node,
          }),
        );
      }
    } else {
      children.push(node);
    }
    previousTime = time;
  }
  flush();
  return [...messages, ...users].sort((a, b) => a.timestamp - b.timestamp);
}
