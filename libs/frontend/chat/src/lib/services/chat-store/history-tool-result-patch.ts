import type {
  ExecutionChatMessage,
  ExecutionNode,
  ToolResultEvent,
} from '@ptah-extension/shared';

function patchNode(node: ExecutionNode, event: ToolResultEvent): ExecutionNode {
  let children: readonly ExecutionNode[] = node.children;
  for (let index = 0; index < children.length; index++) {
    const patched = patchNode(children[index], event);
    if (patched !== children[index]) {
      if (children === node.children) children = [...children];
      (children as ExecutionNode[])[index] = patched;
    }
  }

  if (node.toolCallId === event.toolCallId && node.type === 'tool') {
    if (
      node.status !== 'complete' ||
      node.toolOutput !== event.output ||
      node.isError !== event.isError ||
      node.isPermissionRequest !== event.isPermissionRequest
    ) {
      return {
        ...node,
        children,
        status: 'complete',
        toolOutput: event.output,
        isError: event.isError,
        isPermissionRequest: event.isPermissionRequest,
      };
    }
  }
  if (node.toolCallId === event.toolCallId && node.type === 'agent' && node.status !== 'complete') {
    return { ...node, children, status: 'complete' };
  }
  return children === node.children ? node : { ...node, children };
}

/** Patch finalized tool and Task agent nodes, preserving identities on unchanged paths. */
export function patchHistoryToolResult(
  messages: readonly ExecutionChatMessage[],
  event: ToolResultEvent,
): readonly ExecutionChatMessage[] {
  let result: ExecutionChatMessage[] | undefined;
  messages.forEach((message, index) => {
    if (!message.streamingState) return;
    const tree = patchNode(message.streamingState, event);
    if (tree === message.streamingState) return;
    result ??= [...messages];
    result[index] = { ...message, streamingState: tree };
  });
  return result ?? messages;
}
