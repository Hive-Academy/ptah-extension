import type { ExecutionNode } from '@ptah-extension/shared';
import {
  isEditToolInput,
  isReadToolInput,
  isWriteToolInput,
} from '@ptah-extension/shared';

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
  text: 'Plain text',
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
 * Highlight language id for a tool call's output:
 * - `mcp__*` tools render as markdown;
 * - Read, Write and Edit use the file's extension;
 * - Bash is `bash`; Grep, Glob and anything else are `text`;
 * - string output that parses as one JSON object or array is `json`.
 *   Output that only starts with `{` or `[` (JSONL, `[NX] ...` log lines,
 *   truncated streams) is not JSON and keeps the tool's language.
 */
export function detectToolLanguage(source: ToolLanguageSource): string {
  const { toolName, toolInput, toolOutput } = source;
  let language = 'text';
  if (toolName?.startsWith('mcp__')) {
    return 'markdown';
  }
  if (
    isReadToolInput(toolInput) ||
    isWriteToolInput(toolInput) ||
    isEditToolInput(toolInput)
  ) {
    language = getLanguageFromPath(toolInput.file_path);
  } else if (toolName === 'Bash') {
    language = 'bash';
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
