import type { ExecutionNode } from '@ptah-extension/shared';

/**
 * MessageSummary - Extracted metadata from an ExecutionNode tree
 * for display in the collapsed message header.
 */
export interface MessageSummary {
  /** First ~80 chars of agent's text response, truncated at word boundary */
  readonly title: string;
  /** Longer excerpt (~300 chars) for card-like collapsed display, null when title covers full text */
  readonly description: string | null;
  /** Count of unique file paths referenced in tool calls */
  readonly filesChanged: number;
  /** Total number of tool invocations */
  readonly toolCount: number;
  /** Total cost in USD (from message-level, not re-aggregated) */
  readonly cost: number | null | undefined;
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

/** A `ptah-ui` fence through its closing line, or through the end of streamed text. */
const PTAH_UI_FENCE =
  /^```ptah-ui(?:[ \t]+(\S+)[^\n]*)?(?:\r?\n|(?![\s\S]))([\s\S]*?)(?:^```[ \t\r]*$|(?![\s\S]))/gm;

/**
 * A ptah-ui fence is rendered as structured UI below the collapsed header, so
 * its transport syntax must not become the message preview. When only fences
 * remain, prefer the display title (the grammar allows `title` only as the
 * first body line); keep a stable label for untitled displays.
 */
function summaryText(text: string): string {
  let fenced = false;
  let displayTitle: string | undefined;
  const prose = text.replace(
    PTAH_UI_FENCE,
    (_fence, kind: string | undefined, body: string) => {
      fenced = true;
      if (displayTitle === undefined && kind === 'display') {
        const first = body.split(/\r?\n/).find((line) => line.trim() !== '');
        displayTitle = first && /^title[ \t]+(.+?)[ \t]*$/.exec(first)?.[1];
      }
      return ' ';
    },
  );
  const collapsed = prose.replace(/(?<!`)`([^`]+)`(?!`)/g, '$1').replace(/\s+/g, ' ').trim();
  if (!fenced || collapsed) return collapsed;
  return displayTitle ? `Display: ${displayTitle}` : 'Display';
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
  state: { rawText: string; files: Set<string>; toolCount: number },
): void {
  if (node.type === 'text' && !state.rawText && node.content) {
    state.rawText = node.content.trim();
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
  for (const child of node.children ?? []) {
    walkNode(child, state);
  }
}

/** Count tools and distinct file paths across lane execution roots. */
export function summarizeExecutionNodes(
  nodes: readonly ExecutionNode[],
): Pick<MessageSummary, 'toolCount' | 'filesChanged'> {
  const state = { rawText: '', files: new Set<string>(), toolCount: 0 };
  for (const node of nodes) walkNode(node, state);
  return { toolCount: state.toolCount, filesChanged: state.files.size };
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
  messageCost?: number | null,
  messageDuration?: number,
): MessageSummary {
  const state = { rawText: '', files: new Set<string>(), toolCount: 0 };

  if (rootNode) {
    walkNode(rootNode, state);
  }

  const rawText = summaryText(state.rawText);

  return {
    title: rawText ? truncateAtWordBoundary(rawText, 80) : 'Assistant response',
    description:
      rawText.length > 80 ? truncateAtWordBoundary(rawText, 300) : null,
    filesChanged: state.files.size,
    toolCount: state.toolCount,
    cost: messageCost,
    duration: messageDuration,
  };
}
