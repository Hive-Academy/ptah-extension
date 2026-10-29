import type {
  ExecutionChatMessage,
  ExecutionNode,
} from '@ptah-extension/shared';

/**
 * Plain text of a chat message, as the user reads it.
 *
 * Assistant messages with an execution tree yield the content of their
 * `text` and `message` nodes (depth first, joined by blank lines); every
 * other message yields its `rawContent`. Empty string when there is none.
 */
export function extractMessageText(message: ExecutionChatMessage): string {
  if (message.role === 'assistant' && message.streamingState) {
    return extractTextFromNode(message.streamingState);
  }
  return message.rawContent || '';
}

function extractTextFromNode(node: ExecutionNode): string {
  const parts: string[] = [];
  if (node.content && (node.type === 'text' || node.type === 'message')) {
    parts.push(node.content);
  }
  for (const child of node.children) {
    const childContent = extractTextFromNode(child);
    if (childContent) {
      parts.push(childContent);
    }
  }

  return parts.join('\n\n');
}
