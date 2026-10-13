import type {
  NodeRetentionField,
  NodeRetentionNotice,
} from '@ptah-extension/shared';

/**
 * Text processing shared by the tool-call body blocks (code-output,
 * tool-input-display, tool-output-display), so the displayed text, the
 * wrapped-row estimate and the retention notice are defined once.
 */

/** Approximate characters per wrapped row at the panel's width. */
const WRAP_CHARS = 100;

/** Remove `<system-reminder>` blocks the CLI adds to tool payloads, and trim. */
export function stripSystemReminders(content: string): string {
  return content
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .trim();
}

/** Remove ANSI colour and style sequences (`\x1b[32m`) from CLI output. */
export function stripAnsiCodes(content: string): string {
  // eslint-disable-next-line no-control-regex
  return content.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * A tool output as the body displays it: MCP text blocks extracted
 * (`[{type: "text", text}]`), system reminders, ANSI codes and the CLI's
 * `N→` line-number prefixes stripped. Non-string output is pretty JSON.
 */
export function toolOutputPlainText(output: unknown): string {
  if (!output) return '';
  let text =
    typeof output === 'string' ? output : JSON.stringify(output, null, 2);
  text = extractMcpText(text);
  text = stripSystemReminders(text);
  text = stripAnsiCodes(text);
  return stripLineNumbers(text);
}

/**
 * Whether lines exceed `limit` wrapped rows. Estimated, not measured (no
 * observer per tool row): each line counts `max(1, ceil(length / 100))`.
 * Line terminators are CRLF, CR or LF; a trailing one starts no extra line.
 */
export function exceedsWrappedRows(text: string, limit: number): boolean {
  const lines = text.replace(/(?:\r\n|\r|\n)$/, '').split(/\r\n|\r|\n/);
  let rows = 0;
  for (const line of lines) {
    rows += Math.max(1, Math.ceil(line.length / WRAP_CHARS));
    if (rows > limit) return true;
  }
  return false;
}

/** Rows visible inside the collapsed 9.6em output limit (11px text, 1.4 line height). */
const COLLAPSED_ROWS = 6;

/**
 * Whether an output block collapses (`exceedsWrappedRows` past
 * `COLLAPSED_ROWS`), so its last lines are out of view until expanded.
 */
export function toolOutputCollapses(text: string): boolean {
  return exceedsWrappedRows(text, COLLAPSED_ROWS);
}

/**
 * The truncation notice for a node's input or output, or null when that
 * field was not capped. The copy names the recovery honestly: the bytes are
 * in the session's SDK transcript and come back when the session is
 * reopened, and that reload is itself partial.
 */
export function toolRetentionMessage(
  retention: NodeRetentionNotice | undefined,
  field: NodeRetentionField,
): string | null {
  if (!retention?.capped.includes(field)) return null;
  const noun = field === 'toolInput' ? 'Input' : 'Output';
  const recovery =
    "The full text is in this session's transcript on disk — reopen the " +
    'session to reload it (a reload drops anything before the last compaction).';

  if (retention.foldFailed) {
    const reason = retention.reason ?? 'it could not be converted to text';
    return `${noun} could not be preserved (${reason}). ${recovery}`;
  }
  return (
    `${noun} truncated — ${retention.droppedChars.toLocaleString()} ` +
    `characters were dropped from this tool call to bound the transcript. ${recovery}`
  );
}

/**
 * True when the displayed output already carries the error as a whole
 * message: after the same normalisation (reminders, ANSI, line endings,
 * surrounding whitespace) the output equals the error, or ends with it on a
 * line of its own. An incidental mention elsewhere, or an empty error, is
 * not a match, so the caller keeps its separate error block.
 */
export function outputShowsError(
  displayedOutput: string,
  error: string,
): boolean {
  const normalize = (text: string): string =>
    stripAnsiCodes(stripSystemReminders(text)).replace(/\r\n?/g, '\n').trim();
  const message = normalize(error);
  if (!message) return false;
  const output = normalize(displayedOutput);
  if (output === message) return true;
  return output.endsWith(`\n${message}`);
}

/** Drop the CLI's `     N→` line-number prefix from each line. */
function stripLineNumbers(content: string): string {
  return content
    .split('\n')
    .map((line) => {
      const match = /^\s*\d+→(.*)$/.exec(line);
      return match ? match[1] : line;
    })
    .join('\n');
}

/** `[{type: "text", text: "..."}, ...]` -> the texts joined by newlines. */
function extractMcpText(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith('[')) return content;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return content;
    const isMcpContent = parsed.every(
      (item: unknown) =>
        typeof item === 'object' &&
        item !== null &&
        'type' in item &&
        (item as { type: unknown }).type === 'text' &&
        'text' in item,
    );
    if (!isMcpContent) return content;
    return parsed
      .map((item: { text: unknown }) => String(item.text))
      .join('\n');
  } catch {
    return content;
  }
}
