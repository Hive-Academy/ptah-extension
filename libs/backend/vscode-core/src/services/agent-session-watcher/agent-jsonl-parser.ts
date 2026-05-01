/**
 * Agent JSONL Parser (Wave C7a — TASK_2025_291)
 *
 * Pure, stateless helpers extracted from {@link AgentSessionWatcherService}.
 *
 * Responsibilities (all stateless):
 * - Parse structured content blocks from a Claude Agent JSONL message
 * - Extract the parent sessionId from the first line of an agent file
 * - Resolve the Claude CLI sessions directory for a given workspace path
 * - Pattern-match UUID-like session directory names
 * - Format an agent type into a human-readable description
 *
 * These helpers are **library-internal** — they are not exported from the
 * public barrel. They receive a {@link Logger} when logging is necessary;
 * nothing here owns mutable state.
 *
 * @packageDocumentation
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Logger } from '../../logging/logger';

/**
 * Content block from agent JSONL file - preserves interleaved structure.
 * TASK_2025_102: Changed from flat text to structured blocks for proper interleaving.
 */
export interface AgentContentBlock {
  /** Block type - text for narrative, tool_ref for tool position marker */
  type: 'text' | 'tool_ref';
  /** Text content (only for type: 'text') */
  text?: string;
  /** Tool use ID for correlation with SDK events (only for type: 'tool_ref') */
  toolUseId?: string;
  /** Tool name (only for type: 'tool_ref') */
  toolName?: string;
}

/**
 * Shape of a Claude Agent JSONL message (parsed from agent output files).
 */
export interface AgentJsonlMessage {
  type: string;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
    }>;
  };
}

/**
 * Extract structured content blocks from a JSONL message.
 *
 * TASK_2025_102: Returns both a concatenated summary string (legacy) and the
 * ordered structured blocks that preserve text/tool interleaving.
 *
 * @returns Object with summaryText (legacy) and contentBlocks (structured)
 */
export function extractContentBlocks(
  msg: AgentJsonlMessage,
  logger: Logger,
): {
  summaryText: string | null;
  contentBlocks: AgentContentBlock[];
} {
  // DIAGNOSTIC: Log what we're checking
  if (msg.type === 'assistant') {
    logger.debug('[AgentSessionWatcher] Found assistant message', {
      hasMessageContent: !!msg.message?.content,
      contentLength: msg.message?.content?.length,
      contentBlockTypes: msg.message?.content?.map(
        (b: { type: string }) => b.type,
      ),
    });
  }

  // Only process assistant messages with content
  if (msg.type !== 'assistant' || !msg.message?.content) {
    return { summaryText: null, contentBlocks: [] };
  }

  const textParts: string[] = [];
  const contentBlocks: AgentContentBlock[] = [];

  for (const block of msg.message.content) {
    if (block.type === 'text' && block.text) {
      textParts.push(block.text);
      contentBlocks.push({
        type: 'text',
        text: block.text,
      });
      // DIAGNOSTIC: Log text extraction
      logger.info('[AgentSessionWatcher] Extracted text block', {
        textLength: block.text.length,
        textPreview: block.text.slice(0, 50),
      });
    } else if (block.type === 'tool_use' && block.id) {
      // TASK_2025_102: Also capture tool_use blocks as position markers
      contentBlocks.push({
        type: 'tool_ref',
        toolUseId: block.id,
        toolName: block.name,
      });
      logger.info('[AgentSessionWatcher] Captured tool_use reference', {
        toolUseId: block.id,
        toolName: block.name,
      });
    }
  }

  return {
    summaryText: textParts.length > 0 ? textParts.join('\n') : null,
    contentBlocks,
  };
}

/**
 * Extract the parent sessionId from the first line of an agent file.
 *
 * Reads up to `firstLineBufferSize` bytes from the start of the file and
 * parses the first newline-terminated line as JSON. Returns the
 * `sessionId` field if present, otherwise `null`.
 */
export async function extractSessionIdFromFile(
  filePath: string,
  firstLineBufferSize: number,
): Promise<string | null> {
  try {
    const fd = await fs.promises.open(filePath, 'r');
    const buffer = Buffer.alloc(firstLineBufferSize);
    const { bytesRead } = await fd.read(buffer, 0, firstLineBufferSize, 0);
    await fd.close();

    if (bytesRead === 0) return null;

    const content = buffer.toString('utf-8', 0, bytesRead);
    const firstLine = content.split(/\r?\n/)[0];
    if (!firstLine) return null;

    const msg = JSON.parse(firstLine) as { sessionId?: string };
    return msg.sessionId || null;
  } catch {
    return null;
  }
}

/**
 * Find the Claude CLI sessions directory for a workspace.
 *
 * Replicates the escaping convention Claude CLI uses (`:` and `/\` → `-`)
 * and performs a chain of lookups against `~/.claude/projects/`:
 *   1. Exact match
 *   2. Case-insensitive match
 *   3. Normalized match (hyphens and underscores treated as equivalent)
 *   4. Partial match without leading hyphens
 *
 * Returns the absolute directory path on success or `null` if nothing
 * plausibly matches.
 */
export async function findSessionsDirectory(
  workspacePath: string,
): Promise<string | null> {
  const homeDir = os.homedir();
  const projectsDir = path.join(homeDir, '.claude', 'projects');

  try {
    await fs.promises.access(projectsDir);
  } catch {
    return null;
  }

  // Generate the escaped path pattern (replace : and /\ with -)
  const escapedPath = workspacePath.replace(/[:\\/]/g, '-');

  const dirs = await fs.promises.readdir(projectsDir);

  // Try exact match first
  if (dirs.includes(escapedPath)) {
    return path.join(projectsDir, escapedPath);
  }

  // Try lowercase match
  const lowerEscaped = escapedPath.toLowerCase();
  const lowerMatch = dirs.find((d) => d.toLowerCase() === lowerEscaped);
  if (lowerMatch) {
    return path.join(projectsDir, lowerMatch);
  }

  // Try normalized match: treat hyphens and underscores as equivalent.
  // Claude CLI may normalize path separators differently (e.g., replacing _ with -)
  const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, '-');
  const normalizedEscaped = normalize(escapedPath);
  const normalizedMatch = dirs.find((d) => normalize(d) === normalizedEscaped);
  if (normalizedMatch) {
    return path.join(projectsDir, normalizedMatch);
  }

  // Try without leading hyphen
  const withoutLeading = escapedPath.replace(/^-+/, '');
  const withoutLeadingLower = withoutLeading.toLowerCase();
  const normalizedWithoutLeading = normalize(withoutLeading);
  const partialMatch = dirs.find(
    (d) =>
      d.toLowerCase() === withoutLeadingLower ||
      d.toLowerCase().endsWith(withoutLeadingLower) ||
      normalize(d) === normalizedWithoutLeading ||
      normalize(d).endsWith(normalizedWithoutLeading),
  );
  if (partialMatch) {
    return path.join(projectsDir, partialMatch);
  }

  return null;
}

/**
 * Check if a directory name looks like a UUID or hex session identifier.
 * Matches both standard UUID format (with hyphens) and hex-only format.
 */
export function isUuidLike(name: string): boolean {
  return (
    /^[0-9a-f]{8}(-[0-9a-f]{4}){0,3}(-[0-9a-f]{12})?$/i.test(name) ||
    /^[0-9a-f]{12,64}$/i.test(name)
  );
}

/**
 * Format agent type into human-readable description.
 * TASK_2025_100: Matches the logic in execution-tree-builder.service.ts
 */
export function formatAgentDescription(agentType: string): string {
  // Convert kebab-case or camelCase to Title Case with spaces
  return agentType
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Utility delay function (shared between tail reader and coordinator).
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
