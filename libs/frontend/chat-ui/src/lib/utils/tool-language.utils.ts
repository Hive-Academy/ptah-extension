import type { ExecutionNode } from '@ptah-extension/shared';
import {
  isEditToolInput,
  isReadToolInput,
  isWriteToolInput,
} from '@ptah-extension/shared';
import { toolOutputPlainText } from './tool-text.utils';

/**
 * Which highlight language a tool's output or file is shown in, and the
 * human label for it. One definition shared by the code output block and the
 * tool header, so both name a file's language the same way. Pure and total:
 * unknown extensions and tools fall back to `text` and nothing here throws.
 */

/** File extension (with the dot, lower case) to highlight language id. */
const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.json': 'json',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.py': 'python',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
  '.md': 'markdown',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.xml': 'xml',
  '.sql': 'sql',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
};

/** Highlight language id to the label shown in a language pill. */
const LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  typescript: 'TypeScript',
  tsx: 'TSX',
  javascript: 'JavaScript',
  jsx: 'JSX',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  python: 'Python',
  java: 'Java',
  go: 'Go',
  rust: 'Rust',
  markdown: 'Markdown',
  yaml: 'YAML',
  xml: 'XML',
  sql: 'SQL',
  bash: 'Bash',
  text: 'Text',
};

/** The tool facts language detection reads. */
export type ToolLanguageSource = Pick<
  ExecutionNode,
  'toolName' | 'toolInput' | 'toolOutput'
>;

/** Highlight language id for a file path, from its extension; `text` when unknown. */
export function getLanguageFromPath(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/');
  const ext = '.' + normalized.split('.').pop()?.toLowerCase();
  return LANGUAGE_BY_EXTENSION[ext] || 'text';
}

/**
 * Markdown syntax that changes how text renders: a heading, a list item, a
 * code fence, `**bold**` or a `[link](url)` (a table separator row is
 * `isTableSeparatorRow`). Text with none of these renders as plain text,
 * which keeps its line breaks (markdown would join single newlines into one
 * paragraph).
 *
 * Every pattern runs in linear time: line-start patterns use `[ \t]` (never
 * `\s`, which would cross lines under `/m`) with a CommonMark `{0,3}` indent,
 * and the inline ones exclude their own opening delimiter from the spans
 * they repeat, so a failed match never rescans the same text.
 */
const MARKDOWN_SIGNALS: readonly RegExp[] = [
  /^#{1,6}[ \t]+\S/m,
  /^[ \t]{0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+\S/m,
  /^[ \t]{0,3}(?:```|~~~)/m,
  /\*\*[^*\n]+\*\*/,
  /\[[^[\]\n]+\]\([^)[\s]+\)/,
];

/** One cell of a table separator row: `---`, `:---`, `---:` or `:---:`. */
const TABLE_SEPARATOR_CELL = /^:?-{3,}:?$/;

/**
 * Whether a line is a table separator row (`| --- | :---: |`): two or more
 * separator cells split by `|`, with optional outer pipes.
 */
function isTableSeparatorRow(line: string): boolean {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|')) row = row.slice(0, -1);
  const cells = row.split('|');
  return (
    cells.length >= 2 &&
    cells.every((cell) => TABLE_SEPARATOR_CELL.test(cell.trim()))
  );
}

/** Whether text uses markdown syntax (`MARKDOWN_SIGNALS`, a table separator row). */
export function looksLikeMarkdown(text: string): boolean {
  return (
    MARKDOWN_SIGNALS.some((signal) => signal.test(text)) ||
    text.split('\n').some(isTableSeparatorRow)
  );
}

/**
 * Highlight language id for a tool call's output:
 * - `mcp__*` tools are `markdown` when their displayed text uses markdown
 *   syntax (`looksLikeMarkdown`), otherwise `text`, so a plain-text result
 *   keeps its line breaks;
 * - Read, Write and Edit use the file's extension;
 * - Bash, PowerShell, Grep, Glob and anything else are `text`: command
 *   output is not shell code, so it is not highlighted as such;
 * - string output that parses as one JSON object or array is `json`.
 *   Output that only starts with `{` or `[` (JSONL, `[NX] ...` log lines,
 *   truncated streams) is not JSON and keeps the tool's language.
 */
export function detectToolLanguage(source: ToolLanguageSource): string {
  const { toolName, toolInput, toolOutput } = source;
  let language = 'text';
  if (toolName?.startsWith('mcp__')) {
    return looksLikeMarkdown(toolOutputPlainText(toolOutput))
      ? 'markdown'
      : 'text';
  }
  if (
    isReadToolInput(toolInput) ||
    isWriteToolInput(toolInput) ||
    isEditToolInput(toolInput)
  ) {
    language = getLanguageFromPath(toolInput.file_path);
  }
  const str = typeof toolOutput === 'string' ? toolOutput : '';
  const trimmed = str.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed !== null && typeof parsed === 'object') {
        language = 'json';
      }
    } catch {
      // Starting with { or [ does not make the whole output one JSON
      // document. Callers run this inside computeds, so an escaping throw
      // would re-fire on every change detection. Not JSON: keep the
      // language detected from the tool.
    }
  }
  return language;
}

/** Label for a highlight language id ("TypeScript", "Plain text"); the id itself when unmapped. */
export function getLanguageLabel(language: string): string {
  return LANGUAGE_LABELS[language] ?? language;
}
