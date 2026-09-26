/**
 * MCP server `instructions` for the `initialize` result (TASK_2026_559 Batch 4).
 *
 * Some clients (Codex) read only the first ~512 characters of a server's
 * `instructions`, so the full ptah_* mandate cannot ship here. The text is
 * DERIVED from `PTAH_MCP_SUBSTITUTION_SECTION` — the substitution table rows
 * ("Instead of" → tool) and the "Fall back to …" line — so a change to the
 * table cannot leave the handshake text stale. Only the short glue around the
 * derived parts is written here.
 *
 * Rows are kept in table order until the next one would overflow the budget.
 * The tools of the rows that do not fit are named, in table order, while room
 * remains; any still unnamed are pointed to `tools/list` without a count.
 *
 * The string is the same for every host, but the tools are not: IDE-only tools
 * and namespaces that a host disables are absent from its `tools/list`. So every
 * mapping is conditional on the tool being listed, a fixed line allows the
 * built-in when it is not, and no line claims how many tools are present.
 * `ptah.help()` documents only the `execute_code` API and always closes the
 * text.
 *
 * The budget holds in UTF-16 characters and in UTF-8 bytes alike, and
 * truncation never splits a code point.
 *
 * The result is the same for every caller (byte-stable), so it is computed
 * once per process.
 */
import { PTAH_MCP_SUBSTITUTION_SECTION } from '@ptah-extension/agent-sdk';

/**
 * Codex's read window for server instructions. The text stays within this many
 * UTF-16 characters and this many UTF-8 bytes.
 */
export const MAX_SERVER_INSTRUCTIONS_CHARS = 512;

const HEADER = 'Prefer these ptah_* tools when listed in tools/list:';
const UNLISTED_FALLBACK = 'If a tool is not listed, use the built-in.';
const OMITTED_TOOLS_PREFIX = 'Also, if listed: ';
const HELP_CLOSING = 'execute_code API: ptah.help()';
const MORE_CLOSING = `More substitutions: see available ptah_* tools in tools/list. ${HELP_CLOSING}`;
const ELLIPSIS = '...';

/**
 * The "CALL THIS TOOL" cell: a tool name, optionally followed by its key
 * arguments (`ptah_ast_analyze { file }`). Group 1 is the name.
 */
const TOOL_CELL = /^([A-Za-z][A-Za-z0-9_]*)(?:\s*\{[^}]*\})?$/;
/** A Markdown table separator row, e.g. `|------|:---:|`. */
const TABLE_SEPARATOR = /^\|(\s*:?-+:?\s*\|)+$/;
const FALLBACK_LINE = /^Fall back to\b/;

interface Substitution {
  readonly insteadOf: string;
  readonly tool: string;
}

/**
 * Build the instructions from a substitution section. Pure; never throws.
 * A section with no parsable table or fallback line still yields a bounded
 * string that ends with `ptah.help()`.
 */
export function buildServerInstructionsFrom(section: string): string {
  const text = typeof section === 'string' ? section : '';
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const rows = parseSubstitutionRows(lines);
  const fallback = parseFallbackLine(lines);

  const closingFor = (unnamed: number): string =>
    unnamed === 0 ? HELP_CLOSING : MORE_CLOSING;

  // Reserve the fixed lines, the fallback line and the widest closing first,
  // so the rows only take what is left.
  const fixedSize =
    size(HEADER) +
    1 +
    size(UNLISTED_FALLBACK) +
    1 +
    size(MORE_CLOSING) +
    (fallback ? 1 : 0);
  const fallbackText = fallback
    ? truncateAtWord(
        fallback,
        Math.max(0, MAX_SERVER_INSTRUCTIONS_CHARS - fixedSize),
      )
    : '';

  const kept: string[] = [];
  let used = fixedSize + size(fallbackText);
  for (const row of rows) {
    const line = `${row.insteadOf} -> ${row.tool}`;
    if (used + size(line) + 1 > MAX_SERVER_INSTRUCTIONS_CHARS) break;
    kept.push(line);
    used += size(line) + 1;
  }

  const omitted = rows.slice(kept.length).map((row) => row.tool);
  const named: string[] = [];
  for (const tool of omitted) {
    const added =
      named.length === 0
        ? size(OMITTED_TOOLS_PREFIX) + size(tool) + 1
        : size(tool) + 2;
    if (used + added > MAX_SERVER_INSTRUCTIONS_CHARS) break;
    named.push(tool);
    used += added;
  }

  const parts = [HEADER, ...kept];
  if (fallbackText) parts.push(fallbackText);
  parts.push(UNLISTED_FALLBACK);
  if (named.length > 0) parts.push(OMITTED_TOOLS_PREFIX + named.join(', '));
  parts.push(closingFor(omitted.length - named.length));
  return parts.join('\n');
}

let cached: string | undefined;

/** The instructions for the shipped mandate, computed on first use. */
export function buildServerInstructions(): string {
  cached ??= buildServerInstructionsFrom(PTAH_MCP_SUBSTITUTION_SECTION);
  return cached;
}

/** The data rows of the first Markdown table (the rows after its separator). */
function parseSubstitutionRows(lines: readonly string[]): Substitution[] {
  const separator = lines.findIndex((line) => TABLE_SEPARATOR.test(line));
  if (separator < 0) return [];

  const rows: Substitution[] = [];
  for (const line of lines.slice(separator + 1)) {
    if (!line.startsWith('|')) break;
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|');
    if (cells.length < 2) continue;
    const insteadOf = plainText(cells[0]);
    const tool = TOOL_CELL.exec(plainText(cells[1]))?.[1];
    if (insteadOf && tool) rows.push({ insteadOf, tool });
  }
  return rows;
}

function parseFallbackLine(lines: readonly string[]): string {
  const line = lines.find((candidate) => FALLBACK_LINE.test(candidate));
  return line ? plainText(line) : '';
}

/** Strip Markdown emphasis and code marks, and collapse whitespace. */
function plainText(cell: string): string {
  return cell
    .replace(/\*\*|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Budget cost of a text: the larger of its UTF-16 length and UTF-8 bytes. */
function size(text: string): number {
  return Math.max(text.length, Buffer.byteLength(text, 'utf8'));
}

/**
 * Cut `text` to at most `max` characters and bytes, at a word boundary when
 * there is one, walking whole code points so a surrogate pair is never split.
 */
function truncateAtWord(text: string, max: number): string {
  if (size(text) <= max) return text;
  if (max <= ELLIPSIS.length) return '';
  const limit = max - ELLIPSIS.length;
  let cut = '';
  let chars = 0;
  let bytes = 0;
  for (const codePoint of text) {
    chars += codePoint.length;
    bytes += Buffer.byteLength(codePoint, 'utf8');
    if (Math.max(chars, bytes) > limit) break;
    cut += codePoint;
  }
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}${ELLIPSIS}`;
}
