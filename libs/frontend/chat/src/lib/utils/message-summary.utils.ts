import type { ExecutionNode } from '@ptah-extension/shared';

/**
 * MessageSummary - Extracted metadata from an ExecutionNode tree
 * for display in the collapsed message header.
 */
export interface MessageSummary {
  /** First ~80 chars of agent's text response, truncated at word boundary */
  readonly title: string;
  /** Count of unique file paths referenced in tool calls */
  readonly filesChanged: number;
  /** Total number of tool invocations */
  readonly toolCount: number;
  /** Total cost in USD (from message-level, not re-aggregated) */
  readonly cost: number | undefined;
  /** Total duration in ms (from message-level, not re-aggregated) */
  readonly duration: number | undefined;
}

/**
 * Truncate text at a word boundary, appending '...' if truncated.
 * Avoids cutting words in the middle.
 */
function truncateAtWordBoundary(text: string, maxLength: number): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  const truncated = cleaned.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > 0) {
    return truncated.slice(0, lastSpace) + '...';
  }

  return truncated + '...';
}

/** Known tool input keys that contain file paths */
const FILE_PATH_KEYS = ['file_path', 'notebook_path', 'filePath'] as const;

/**
 * DFS walk of the ExecutionNode tree.
 * Collects first text content for title, counts tools, and gathers unique file paths.
 *
 * Checks multiple tool input keys (file_path, notebook_path, filePath) to cover
 * Edit/Write/Read, NotebookEdit, and LSP tools. Bash tool invocations are counted
 * as tools but not as file changes (no deterministic file path in command string).
 */
function walkNode(
  node: ExecutionNode,
  state: { title: string; files: Set<string>; toolCount: number },
): void {
  if (node.type === 'text' && !state.title && node.content) {
    state.title = truncateAtWordBoundary(node.content, 80);
  }

  if (node.type === 'tool') {
    state.toolCount++;
    if (node.toolInput) {
      for (const key of FILE_PATH_KEYS) {
        const value = node.toolInput[key];
        if (typeof value === 'string' && value.length > 0) {
          state.files.add(value);
          break;
        }
      }
    }
  }

  // Defensive: node.children may be undefined for malformed/partial session data
  for (const child of node.children ?? []) {
    walkNode(child, state);
  }
}

/**
 * Extract summary metadata from an ExecutionNode tree.
 * Walks the tree recursively to find text content and count tools/files.
 *
 * Pure function with O(n) tree traversal where n = total nodes.
 * Handles null/undefined gracefully.
 *
 * @param rootNode - The root ExecutionNode (message.streamingState)
 * @param messageCost - Cost from ExecutionChatMessage.cost
 * @param messageDuration - Duration from ExecutionChatMessage.duration
 * @returns MessageSummary with extracted metadata
 */
export function extractMessageSummary(
  rootNode: ExecutionNode | null,
  messageCost?: number,
  messageDuration?: number,
): MessageSummary {
  const state = { title: '', files: new Set<string>(), toolCount: 0 };

  if (rootNode) {
    walkNode(rootNode, state);
  }

  return {
    title: state.title || 'Assistant response',
    filesChanged: state.files.size,
    toolCount: state.toolCount,
    cost: messageCost,
    duration: messageDuration,
  };
}
