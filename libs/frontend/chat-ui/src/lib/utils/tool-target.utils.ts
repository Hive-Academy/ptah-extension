import type { ExecutionStatus } from '@ptah-extension/shared';
import {
  isAgentDispatchTool,
  isBashToolInput,
  isEditToolInput,
  isGlobToolInput,
  isGrepToolInput,
  isReadToolInput,
  isTodoWriteToolInput,
  isWebFetchToolInput,
  isWebSearchToolInput,
  isWriteToolInput,
} from '@ptah-extension/shared';

/**
 * How a tool call is named and targeted in the UI. One definition shared by
 * the normal view's tool header and the compact session feed, so both read
 * a call the same way. Pure and total: unknown input shapes fall back to the
 * tool name and nothing here throws.
 */
export interface ToolTarget {
  /** Concise target for a one-line row (shortened path, pattern, command). */
  readonly short: string;
  /** Full target for a tooltip; empty when the input has no target. */
  readonly full: string;
  /**
   * What `short` names, before any cut: the Bash description when given,
   * else the command, path, pattern or summary. Empty when there is none.
   */
  readonly text: string;
  /** True when `full` is a file path (Read, Write, Edit). */
  readonly isPath: boolean;
  /**
   * Input keys this target names. The card body leaves them out of its
   * argument list; a Bash command still gets its own "Command" block, since
   * the header names it only when there is no description.
   */
  readonly keys: readonly string[];
}

/** Short facts from a call's input shown as header chips, and their keys. */
export interface ToolChips {
  /** `background`, `60 min`, `lines 1-60`, `in src/`, `84 lines`. */
  readonly chips: readonly string[];
  /** Input keys the chips present; the body's argument list skips them. */
  readonly keys: readonly string[];
}

export function describeToolTarget(
  toolName: string,
  toolInput: Readonly<Record<string, unknown>> | undefined,
): ToolTarget {
  if (
    isReadToolInput(toolInput) ||
    isWriteToolInput(toolInput) ||
    isEditToolInput(toolInput)
  ) {
    return {
      short: shortenToolPath(toolInput.file_path) || '...',
      full: toolInput.file_path,
      text: toolInput.file_path,
      isPath: true,
      keys: ['file_path'],
    };
  }
  if (isBashToolInput(toolInput)) {
    const command = toolInput.command;
    return {
      short:
        toolInput.description ||
        (command ? truncateToolText(command, 40) : '...'),
      full: command,
      text: toolInput.description || command,
      isPath: false,
      keys: ['command', 'description'],
    };
  }
  if (isGrepToolInput(toolInput) || isGlobToolInput(toolInput)) {
    return {
      short: truncateToolText(toolInput.pattern, 30) || '...',
      full: toolInput.pattern,
      text: toolInput.pattern,
      isPath: false,
      keys: ['pattern'],
    };
  }
  if (isWebFetchToolInput(toolInput)) {
    return {
      short: urlHostAndPath(toolInput.url) || '...',
      full: toolInput.url,
      text: toolInput.url,
      isPath: false,
      keys: ['url'],
    };
  }
  if (isWebSearchToolInput(toolInput)) {
    return {
      short: truncateToolText(toolInput.query, 40) || '...',
      full: toolInput.query,
      text: toolInput.query,
      isPath: false,
      keys: ['query'],
    };
  }
  if (isTodoWriteToolInput(toolInput)) {
    const total = toolInput.todos.length;
    const done = toolInput.todos.filter(
      (todo) => todo.status === 'completed',
    ).length;
    const summary = `${done} of ${total} done`;
    return {
      short: summary,
      full: summary,
      text: summary,
      isPath: false,
      keys: ['todos'],
    };
  }
  const description = toolInput?.['description'];
  if (isAgentDispatchTool(toolName) && typeof description === 'string') {
    return {
      short: truncateToolText(description, 40) || toolName,
      full: description,
      text: description,
      isPath: false,
      keys: ['description'],
    };
  }
  const summary = toolInput?.['__summary'];
  if (typeof summary === 'string') {
    return {
      short: truncateToolText(summary, 40) || toolName,
      full: summary,
      text: summary,
      isPath: false,
      keys: ['__summary'],
    };
  }
  return { short: toolName, full: '', text: '', isPath: false, keys: [] };
}

/** Input keys whose short string value is shown as a chip as-is. */
const ENUM_CHIP_KEYS = new Set([
  'glob',
  'type',
  'output_mode',
  'subagent_type',
  'model',
]);
/** Longest string value shown as an enum chip. */
const ENUM_CHIP_MAX_CHARS = 40;

/**
 * The header chips of a call (shared rule: booleans, numbers and short enums
 * become chips; everything else stays in the body). A true boolean shows its
 * key, a false one nothing; `timeout` gets a unit; a Read range reads
 * `lines 1-60`; a search `path` reads `in src/`; Write adds its line count.
 * `__parseError` is consumed because the header's warning shows it.
 */
export function describeToolChips(
  toolName: string,
  toolInput: Readonly<Record<string, unknown>> | undefined,
): ToolChips {
  if (!toolInput) return { chips: [], keys: [] };
  const chips: string[] = [];
  const keys: string[] = [];
  const take = (key: string, chip?: string): void => {
    keys.push(key);
    if (chip) chips.push(chip);
  };

  for (const [key, chip] of readRangeChips(toolInput)) take(key, chip);
  const lineChip = writeLineChip(toolInput);
  if (lineChip) chips.push(lineChip);

  const isSearch = isGrepToolInput(toolInput) || isGlobToolInput(toolInput);
  for (const [key, value] of Object.entries(toolInput)) {
    if (keys.includes(key)) continue;
    const entry = chipForEntry(key, value, isSearch);
    if (entry.consumed) take(key, entry.chip);
  }
  return { chips, keys };
}

/** Whether an input entry is presented in the header, and its chip if any. */
interface ChipEntry {
  readonly consumed: boolean;
  readonly chip?: string;
}

const NOT_CONSUMED: ChipEntry = { consumed: false };

/** A Read range as `[key, chip]` pairs: `lines 1-60`, or `from line 40`. */
function readRangeChips(
  toolInput: Readonly<Record<string, unknown>>,
): ReadonlyArray<readonly [string, string | undefined]> {
  if (!isReadToolInput(toolInput)) return [];
  const offset = toolInput['offset'];
  const limit = toolInput['limit'];
  const from = typeof offset === 'number' ? offset : 1;
  if (typeof limit === 'number') {
    return [
      ['offset', undefined],
      ['limit', `lines ${from}-${from + limit - 1}`],
    ];
  }
  if (typeof offset === 'number') return [['offset', `from line ${from}`]];
  return [];
}

/** A Write call's line count (`84 lines`); undefined for other tools or empty content. */
function writeLineChip(
  toolInput: Readonly<Record<string, unknown>>,
): string | undefined {
  if (!isWriteToolInput(toolInput)) return undefined;
  const lines = countLines(toolInput.content);
  if (lines === 0) return undefined;
  return `${lines} line${lines === 1 ? '' : 's'}`;
}

/** The header chip for one input entry (the rule in `describeToolChips`). */
function chipForEntry(
  key: string,
  value: unknown,
  isSearch: boolean,
): ChipEntry {
  if (key === '__parseError') return { consumed: true };
  if (typeof value === 'boolean') {
    return { consumed: true, chip: booleanChip(key, value) };
  }
  if (typeof value === 'number') {
    const chip = key === 'timeout' ? formatTimeout(value) : `${key} ${value}`;
    return { consumed: true, chip };
  }
  if (typeof value === 'string') return stringChip(key, value, isSearch);
  return NOT_CONSUMED;
}

/** A true flag shows its key (`run_in_background` reads `background`); false shows nothing. */
function booleanChip(key: string, value: boolean): string | undefined {
  if (!value) return undefined;
  return key === 'run_in_background' ? 'background' : key;
}

/** A search `path` reads `in src/`; a short enum value is shown as-is. */
function stringChip(key: string, value: string, isSearch: boolean): ChipEntry {
  if (isSearch && key === 'path') {
    return { consumed: true, chip: value ? `in ${value}` : undefined };
  }
  if (ENUM_CHIP_KEYS.has(key) && value.length <= ENUM_CHIP_MAX_CHARS) {
    return { consumed: true, chip: value };
  }
  return NOT_CONSUMED;
}

const MCP_PREFIX = 'mcp__';
const MCP_SEPARATOR = '__';

/**
 * An MCP tool from another server split into its server and tool names
 * (`mcp__orchestrator__ListAgents` -> `orchestrator`, `ListAgents`); null for
 * built-in tools and the Ptah server, which has its own gold treatment. The
 * server name ends at the first `__` after its first character, so
 * `mcp__a__b__c` is server `a`, tool `b__c`; both parts are non-empty.
 */
export function splitMcpToolName(
  toolName: string,
): { readonly server: string; readonly tool: string } | null {
  if (isPtahMcpToolName(toolName)) return null;
  if (!toolName.startsWith(MCP_PREFIX)) return null;
  const rest = toolName.slice(MCP_PREFIX.length);
  const separator = rest.indexOf(MCP_SEPARATOR, 1);
  if (separator < 0) return null;
  const tool = rest.slice(separator + MCP_SEPARATOR.length);
  if (!tool) return null;
  return { server: rest.slice(0, separator), tool };
}

/** `3600000` -> `60 min`, `90000` -> `90 s`, `500` -> `500 ms`. */
export function formatTimeout(ms: number): string {
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000} min`;
  if (ms >= 1000) return `${Math.round(ms / 1000)} s`;
  return `${ms} ms`;
}

/** Lines in a text; CRLF, CR or LF end a line, a trailing one adds none. */
export function countLines(text: string): number {
  if (!text) return 0;
  return text.replace(/(?:\r\n|\r|\n)$/, '').split(/\r\n|\r|\n/).length;
}

/** `https://example.com/docs/a?q=1` -> `example.com/docs/a`; the input when unparsable. */
function urlHostAndPath(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return truncateToolText(parsed.host + path, 60);
  } catch {
    return truncateToolText(url, 40);
  }
}

/**
 * True when a label only repeats the tool's name (`ListAgents` beside the
 * `ListAgents` badge), compared without case or punctuation against the raw
 * name, its display name and the last `__` segment of an MCP name.
 */
export function isJustToolName(label: string, toolName: string): boolean {
  const normalize = (value: string): string =>
    value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const candidate = normalize(label);
  if (!candidate) return true;
  const names = [
    toolName,
    displayToolName(toolName),
    toolName.split('__').pop(),
  ];
  return names.some(
    (name) => name !== undefined && normalize(name) === candidate,
  );
}

/**
 * Ptah MCP server tool, in both naming conventions: `mcp__ptah*` (ptah-cli)
 * and `ptah-ptah_*` (Copilot).
 */
export function isPtahMcpToolName(toolName: string): boolean {
  return toolName.startsWith('mcp__ptah') || toolName.startsWith('ptah-ptah_');
}

/**
 * The name a user reads for a tool. Ptah MCP tools show their short name
 * (`mcp__ptah__workspace_analyze` -> `workspace analyze`,
 * `ptah-ptah_search_files` -> `search files`); others are unchanged.
 */
export function displayToolName(toolName: string): string {
  const mcpMatch = toolName.match(/^mcp__ptah__(.+)$/);
  if (mcpMatch) return mcpMatch[1].replace(/_/g, ' ');
  const cliMatch = toolName.match(/^ptah-\w+?_(.+)$/);
  if (cliMatch) return cliMatch[1].replace(/_/g, ' ');
  return toolName;
}

/** DaisyUI badge colour for a tool call's status, as in the normal view. */
export function toolStatusBadgeClass(status: ExecutionStatus): string {
  if (status === 'complete') return 'badge-success';
  if (status === 'streaming') return 'badge-info';
  if (status === 'error') return 'badge-error';
  return 'badge-ghost';
}

/** `a/b/c/d.ts` -> `.../c/d.ts`; paths of two segments or fewer unchanged. */
export function shortenToolPath(path: string | undefined): string {
  if (!path) return '';
  const parts = path.replace(/\\/g, '/').split('/');
  if (parts.length <= 2) return path;
  return '.../' + parts.slice(-2).join('/');
}

/** Cut to `maxLen` characters with a trailing `...` when longer. */
export function truncateToolText(
  value: string | undefined,
  maxLen: number,
): string {
  if (!value) return '';
  return value.length > maxLen ? value.substring(0, maxLen) + '...' : value;
}
