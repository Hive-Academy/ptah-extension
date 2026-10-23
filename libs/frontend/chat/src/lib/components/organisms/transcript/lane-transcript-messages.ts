import {
  createExecutionChatMessage,
  createExecutionNode,
  type ExecutionChatMessage,
  type ExecutionNode,
  type FlatStreamEventUnion,
} from '@ptah-extension/shared';

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
      messages.push(
        createExecutionChatMessage({
          id: `${laneId}:${node.id}`,
          role: 'assistant',
          timestamp: node.startTime ?? 0,
          streamingState: node,
        }),
      );
    } else {
      children.push(node);
    }
    previousTime = time;
  }
  flush();
  return [...messages, ...users].sort((a, b) => a.timestamp - b.timestamp);
}
