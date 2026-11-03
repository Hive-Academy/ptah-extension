import type {
  CodexHistoryReader,
  CodexHistoryTurn,
} from '@ptah-extension/codex-runtime';
import type {
  CarryOverTranscript,
  CarryOverTurn,
} from '../helpers/history/history.types';

/** The bounded native read `projectCodexCarryOverTranscript` projects. */
export type CodexCarryOverTail = Awaited<
  ReturnType<CodexHistoryReader['readHistoryTail']>
>;

type HistoryItem = CodexHistoryTurn['items'][number];
type UserContentPart = Extract<HistoryItem, { type: 'userMessage' }>['content'][number];

const TOOL_NAME_MAX_LENGTH = 64;

/**
 * Projects a native Codex tail to the carry-over transcript shape.
 *
 * Only prose and the names of tools are read. Tool inputs, outputs, commands,
 * diffs, MCP arguments, content items and reasoning are never touched, so none
 * of them can reach the carried prompt (AC 3.5, 3.6, 3.9). Codex keeps no
 * compaction summary text, so the transcript never starts at one (AC 3.8).
 */
export function projectCodexCarryOverTranscript(
  tail: CodexCarryOverTail,
): CarryOverTranscript {
  const turns: CarryOverTurn[] = [];
  for (const turn of tail.thread.turns) {
    for (const item of turn.items) {
      const piece = projectItem(item);
      if (!piece) continue;
      const previous = turns[turns.length - 1];
      if (previous && previous.role === piece.role) {
        turns[turns.length - 1] = {
          ...previous,
          text: `${previous.text}\n\n${piece.text}`,
        };
      } else {
        turns.push({ ...piece, compactionSummary: false });
      }
    }
  }
  return {
    turns,
    windowCoversWholeHistory: tail.coversWholeHistory,
    startsAtCompactionSummary: false,
  };
}

function projectItem(
  item: HistoryItem,
): { role: CarryOverTurn['role']; text: string } | null {
  const text = itemText(item);
  if (!text) return null;
  return { role: item.type === 'userMessage' ? 'user' : 'assistant', text };
}

/** Narrows past the unknown-item arm, whose `type` is never a known one. */
function isItem<K extends string>(
  item: HistoryItem,
  type: K,
): item is Extract<HistoryItem, { type: K }> {
  return item.type === type;
}

/** One item's carried text; `''` when the item carries nothing. */
function itemText(item: HistoryItem): string {
  if (isItem(item, 'userMessage')) return userText(item.content);
  // Both `commentary` and `final_answer` phases are assistant prose.
  if (isItem(item, 'agentMessage')) return item.text.trim();
  if (isItem(item, 'commandExecution')) return '[tool: shell]';
  if (isItem(item, 'fileChange')) return '[tool: apply_patch]';
  if (isItem(item, 'mcpToolCall')) return toolLine(item.tool);
  if (isItem(item, 'webSearch')) return '[tool: web_search]';
  if (isItem(item, 'collabAgentToolCall')) return toolLine(item.tool || 'agent');
  if (isItem(item, 'imageView')) return '[image omitted]';
  if (isItem(item, 'functionCallOutput')) return toolLine(item.name);
  if (isItem(item, 'dynamicToolCall')) return toolLine(item.tool);
  // reasoning, contextCompaction, hookPrompt and every other or unknown item
  // carry nothing over (AC 3.6).
  return '';
}

function userText(content: readonly UserContentPart[]): string {
  const parts: string[] = [];
  for (const part of content) {
    const text = userPart(part);
    if (text) parts.push(text);
  }
  return parts.join('\n').trim();
}

function userPart(part: UserContentPart): string {
  switch (part.type) {
    case 'text':
      return part.text.trim();
    case 'image':
    case 'localImage':
      return '[image omitted]';
    case 'mention':
    case 'skill':
      return `[file: ${baseName(part.path) ?? 'attachment'}]`;
    default:
      // audio and localAudio are dropped.
      return '';
  }
}

/** A protocol-supplied name cannot break the line or carry a multi-line payload. */
function toolLine(name: string): string {
  const singleLine = name
    .replace(/\s+/g, ' ')
    .replace(/[[\]]/g, '')
    .trim()
    .slice(0, TOOL_NAME_MAX_LENGTH)
    .trim();
  return `[tool: ${singleLine || 'tool'}]`;
}

/** Last non-empty segment of a `/` or `\` separated path. */
function baseName(path: string): string | undefined {
  const segments = path.split(/[\\/]/).filter((segment) => segment.trim() !== '');
  const last = segments[segments.length - 1]?.trim();
  return last ? last : undefined;
}
