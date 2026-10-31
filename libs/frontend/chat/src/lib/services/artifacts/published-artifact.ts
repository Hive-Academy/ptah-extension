import type { ExecutionNode } from '@ptah-extension/shared';

/**
 * What a completed `ptah_artifact_publish` tool call in the transcript says
 * it published. `result` is the parsed tool result object, unvalidated: pass
 * it to `ArtifactStore.adoptPublishResult`, which validates it against
 * `ArtifactPublishResultSchema` before it becomes a record.
 */
export interface PublishedArtifact {
  readonly id: string;
  readonly title: string;
  readonly result: Readonly<Record<string, unknown>>;
}

const PUBLISH_TOOL_NAME = /^(?:mcp__ptah__)?ptah_artifact_publish$/;
const DEFAULT_TITLE = 'Artifact';
/** Node ids already reported as malformed; turns are re-walked on every change. */
const reportedMalformed = new Set<string>();

/** Logs once per node that a completed publish call returned no usable result. */
function reportMalformed(node: ExecutionNode, reason: string): void {
  if (reportedMalformed.has(node.id)) return;
  reportedMalformed.add(node.id);
  console.warn(
    `[published-artifact] ${reason} (tool node ${node.id}); no card is shown.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The text of a tool output: a plain string, or the first MCP `text` content part. */
function outputText(output: unknown): string | null {
  if (typeof output === 'string') return output;
  const content = Array.isArray(output)
    ? output
    : isRecord(output)
      ? output['content']
      : null;
  if (!Array.isArray(content)) return null;
  const part: unknown = content.find(
    (entry: unknown) => isRecord(entry) && entry['type'] === 'text',
  );
  return isRecord(part) && typeof part['text'] === 'string'
    ? part['text']
    : null;
}

/**
 * The artifact a transcript tool node published, or `null` when the node is
 * not a complete, successful `ptah_artifact_publish` call or its result does
 * not name an artifact id.
 */
export function publishedArtifactFromNode(
  node: ExecutionNode,
): PublishedArtifact | null {
  if (node.isError || node.status !== 'complete') return null;
  if (!PUBLISH_TOOL_NAME.test(node.toolName ?? '')) return null;
  const text = outputText(node.toolOutput);
  if (text === null) {
    reportMalformed(node, 'publish result has no text output');
    return null;
  }
  let result: unknown;
  try {
    result = JSON.parse(text);
  } catch {
    // degradation-audit: reported — a non-JSON tool result names no artifact; it is logged and the caller shows none.
    reportMalformed(node, 'publish result is not JSON');
    return null;
  }
  if (!isRecord(result) || typeof result['id'] !== 'string') {
    reportMalformed(node, 'publish result names no artifact id');
    return null;
  }
  const title =
    typeof result['title'] === 'string' ? result['title'] : DEFAULT_TITLE;
  return { id: result['id'], title, result };
}
