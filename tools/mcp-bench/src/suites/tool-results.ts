/**
 * Reading tool results back as answers, and the corpus lookups the suites'
 * arguments need. Result texts are read tolerantly but never guessed: a text
 * without the shape the tool's formatter writes throws
 * `ToolResultParseError`, which the runner counts as an error, not as zero
 * hits. Answers are relativised against the run's corpus root
 * (`normalizePath`, case-insensitive on win32); the LSP tools print 0-based
 * lines, which are shifted to the truths' 1-based lines.
 */

import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { p50Latency } from '../metrics/cost-metrics';
import { type Answer, normalizePath } from '../metrics/retrieval-metrics';
import { classifyToolResult } from '../transport/call-recorder';
import type { McpToolCaller } from '../transport/mcp-client';
import {
  ToolResultParseError,
  type FailureEntry,
  type QuestionRecord,
} from './suite-runner';

const BUDGET_TRAILER = /\n?\[reduced: [^\]\n]*\]\s*$/;

/** A symbol-search hit with its normalized file path. */
export interface SymbolHit {
  readonly file: string;
  readonly symbolName: string;
}

/** A symbol answer plus the file/symbol pairs needed by lifecycle probes. */
export interface SymbolAnswer extends Answer {
  readonly symbolHits: readonly SymbolHit[];
}

/** The JSON body of a result, without the output-budget trailer. */
export function parseJsonResult(text: string): unknown {
  const body = text.replace(BUDGET_TRAILER, '').trim();
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new ToolResultParseError(
      `result is not JSON (${body.length} chars; a budget cut leaves it unparseable)`,
    );
  }
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ToolResultParseError(`${what} is not an object`);
  return value as Record<string, unknown>;
}

function stringArray(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))
    throw new ToolResultParseError(`${what} is not a list of strings`);
  return value;
}

export function answerOf(ranked: readonly string[]): Answer {
  return { ranked: [...new Set(ranked)], abstained: ranked.length === 0 };
}

function relativeTo(root: string): (path: string) => string {
  return (path) => normalizePath(path, { workspaceRoot: root });
}

/** `file:line` → `file`. */
export function fileOf(location: string): string {
  const match = /^(.*):\d+$/.exec(location);
  return match ? match[1] : location;
}

export function filesOnly(answer: Answer): Answer {
  return { ...answer, ranked: [...new Set(answer.ranked.map(fileOf))] };
}

/**
 * `ptah_code_search_symbols` hits. A hit carries `filePath` and a text that
 * ends `in <rel>:<start>-<end>` (the indexer's row text); it names the truth
 * location it covers when that location's line lies in the range (either line
 * base), else `<file>:<start + 1>`. `fileLevel` reduces every hit to its file.
 */
export function parseSymbolHits(
  text: string,
  root: string,
  truth: readonly string[],
  fileLevel: boolean,
): SymbolAnswer {
  const result = asRecord(parseJsonResult(text), 'symbol search result');
  if (!Array.isArray(result['hits']))
    throw new ToolResultParseError('symbol search result has no hits list');
  if (result['hits'].length === 0 && typeof result['error'] === 'string')
    throw new ToolResultParseError(`symbol search error: ${result['error']}`);
  const relative = relativeTo(root);
  const symbolHits = result['hits'].map((raw, index) => {
    const hit = asRecord(raw, `hit ${index}`);
    if (typeof hit['filePath'] !== 'string')
      throw new ToolResultParseError(`hit ${index} has no filePath`);
    if (typeof hit['symbolName'] !== 'string')
      throw new ToolResultParseError(`hit ${index} has no symbolName`);
    return { file: relative(hit['filePath']), symbolName: hit['symbolName'] };
  });
  const ranked = result['hits'].map((raw, index) => {
    const hit = asRecord(raw, `hit ${index}`);
    const file = symbolHits[index].file;
    if (fileLevel) return file;
    const range = /:(\d+)-(\d+)\s*$/.exec(String(hit['text'] ?? ''));
    if (!range) return file;
    const start = Number(range[1]);
    const end = Number(range[2]);
    const covered = truth.find((location) => {
      const line = Number(/:(\d+)$/.exec(location)?.[1] ?? Number.NaN);
      return fileOf(location) === file && line >= start && line <= end + 1;
    });
    return covered ?? `${file}:${start + 1}`;
  });
  return { ...answerOf(ranked), symbolHits };
}

/**
 * `ptah_lsp_references` / `ptah_lsp_definitions` (`formatLspLocations`): a
 * `Found: N` line and one `` `file:line[:col]` `` item per location, lines
 * 0-based. "Not available on this host (mechanism: none" is no lookup at all.
 */
export function parseLspLocations(text: string, root: string): Answer {
  if (/mechanism: none/.test(text))
    throw new ToolResultParseError('mechanism: none — no lookup ran');
  if (!/Found: \d+/.test(text))
    throw new ToolResultParseError('no "Found: N" line in the LSP result');
  const relative = relativeTo(root);
  const ranked: string[] = [];
  for (const match of text.matchAll(/`([^`\n]+?):(\d+)(?::\d+)?`/g))
    ranked.push(`${relative(match[1])}:${Number(match[2]) + 1}`);
  return answerOf(ranked);
}

/**
 * `ptah_get_dependents` / `ptah_get_dependencies` (`graphFileAnswer`): the
 * list under `key`. A file the graph cannot hold (`unsupported-language`) is
 * an explicit abstention, not an error.
 */
export function parseGraphList(
  text: string,
  key: 'dependents' | 'dependencies',
  root: string,
): Answer {
  const result = asRecord(parseJsonResult(text), 'graph result');
  if (result['status'] === 'unsupported-language')
    return { ranked: [], abstained: true };
  return answerOf(stringArray(result[key], key).map(relativeTo(root)));
}

/** `ptah_relevance_rank_files`: `[{ file, score, reasons }]`. */
export function parseRankedFiles(text: string, root: string): Answer {
  const result = parseJsonResult(text);
  if (!Array.isArray(result))
    throw new ToolResultParseError('relevance result is not a list');
  const relative = relativeTo(root);
  return answerOf(
    result.map((raw, index) => {
      const item = asRecord(raw, `ranked file ${index}`);
      if (typeof item['file'] !== 'string')
        throw new ToolResultParseError(`ranked file ${index} has no file`);
      return relative(item['file']);
    }),
  );
}

/** `ptah_get_symbol_index`: the files of the page whose symbols include `name`. */
export function parseSymbolIndex(
  text: string,
  name: string,
  root: string,
): Answer {
  const result = asRecord(parseJsonResult(text), 'symbol index page');
  if (!Array.isArray(result['files']))
    throw new ToolResultParseError('symbol index page has no files list');
  const relative = relativeTo(root);
  const ranked = result['files'].flatMap((raw, index) => {
    const entry = asRecord(raw, `symbol index entry ${index}`);
    if (typeof entry['file'] !== 'string')
      throw new ToolResultParseError(`symbol index entry ${index} has no file`);
    const symbols = Array.isArray(entry['symbols']) ? entry['symbols'] : [];
    return symbols.includes(name) ? [relative(entry['file'])] : [];
  });
  return answerOf(ranked);
}

/** `ptah_memory_search`: the `content` of each hit, in rank order. */
export function parseMemoryContents(text: string): string[] {
  const result = asRecord(parseJsonResult(text), 'memory result');
  if (!Array.isArray(result['hits']))
    throw new ToolResultParseError('memory result has no hits list');
  if (result['hits'].length === 0 && typeof result['error'] === 'string')
    throw new ToolResultParseError(`memory search error: ${result['error']}`);
  return result['hits'].map((raw, index) => {
    const hit = asRecord(raw, `memory hit ${index}`);
    if (typeof hit['content'] !== 'string')
      throw new ToolResultParseError(`memory hit ${index} has no content`);
    return hit['content'].trim();
  });
}

/** `ptah_search_files` (`formatSearchFiles`): `Found: …` then a numbered list. */
export function parseFileList(text: string, root: string): Answer {
  if (/Found: 0 files/.test(text)) return { ranked: [], abstained: true };
  if (!/Found: /.test(text))
    throw new ToolResultParseError(
      'no "Found:" line in the file search result',
    );
  const relative = relativeTo(root);
  const ranked = text.split(/\r?\n/u).flatMap((line) => {
    const prefix = /^\s*\d+\.\s+/u.exec(line);
    if (!prefix) return [];
    const path = line.slice(prefix[0].length).trimEnd();
    return path.length === 0 ? [] : [relative(path)];
  });
  return answerOf(ranked);
}

/** `file:line` locations anywhere in a text (the future `ptah_search_text`). */
export function parseTextLocations(text: string, root: string): Answer {
  const relative = relativeTo(root);
  const ranked: string[] = [];
  let start = 0;
  while (start < text.length) {
    if (isPathStop(text[start])) {
      start += 1;
      continue;
    }
    let end = start;
    while (end < text.length && !isPathStop(text[end])) end += 1;
    for (const [path, line] of runLocations(text, start, end)) {
      ranked.push(`${relative(path)}:${line}`);
    }
    start = end;
  }
  return answerOf(ranked);
}

/**
 * `path:line` pairs inside one run of path characters, scanned linearly. Same
 * matches as `/([^\s`'"|]+?):(\d+)(?=[:\s`|]|$)/g`: the path is non-empty and
 * ends at the first `:` that is followed by a full digit run and then by `:`,
 * whitespace, a backtick, `|` or the end of the text.
 */
function runLocations(
  text: string,
  start: number,
  end: number,
): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  let cursor = start;
  let colon = text.indexOf(':', cursor + 1);
  while (colon !== -1 && colon < end) {
    let digitsEnd = colon + 1;
    while (digitsEnd < end && isAsciiDigit(text[digitsEnd])) digitsEnd += 1;
    if (digitsEnd > colon + 1 && endsLocation(text[digitsEnd])) {
      found.push([text.slice(cursor, colon), text.slice(colon + 1, digitsEnd)]);
      cursor = digitsEnd;
      colon = text.indexOf(':', cursor + 1);
    } else {
      colon = text.indexOf(':', colon + 1);
    }
  }
  return found;
}

function isPathStop(char: string): boolean {
  return (
    char === '`' ||
    char === "'" ||
    char === '"' ||
    char === '|' ||
    /\s/.test(char)
  );
}

function isAsciiDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

function endsLocation(char: string | undefined): boolean {
  return (
    char === undefined ||
    char === ':' ||
    char === '`' ||
    char === '|' ||
    /\s/.test(char)
  );
}

/** Which of `names` the text mentions as a quoted name (structure tools vs Read). */
export function namesPresent(text: string, names: readonly string[]): Answer {
  const found = names.filter(
    (name) =>
      text.includes(`"${name}"`) ||
      new RegExp(`\\b${escapeRegExp(name)}\\b`).test(text),
  );
  return answerOf(found);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const lineCache = new Map<string, readonly string[]>();

/** 0-based column of `name` as a whole word on 1-based `line` of `file`, else 0. */
export function columnOf(
  root: string,
  file: string,
  line: number,
  name: string,
): number {
  const path = isAbsolute(file) ? file : join(root, file);
  let lines = lineCache.get(path);
  if (lines === undefined) {
    try {
      lines = readFileSync(path, 'utf8').split(/\r?\n/);
    } catch {
      lines = [];
    }
    lineCache.set(path, lines);
  }
  const index = new RegExp(`\\b${escapeRegExp(name)}\\b`).exec(
    lines[line - 1] ?? '',
  )?.index;
  return index ?? 0;
}

/**
 * Probes the relative form of a graph tool's `file` argument once per
 * question, apart from the scored (absolute) call, and keeps the outcome as a
 * finding: a rejected relative path is quoted, never hidden.
 */
export class RelativePathProbe {
  private accepted = 0;
  private rejected = 0;
  private inconclusive = 0;
  private sample: string | null = null;

  constructor(
    private readonly tool: string,
    private readonly root: string,
  ) {}

  async probe(file: string, caller: McpToolCaller): Promise<void> {
    const outcome = await caller.callTool(this.tool, { file });
    if (outcome.kind !== 'result') {
      this.rejected += 1;
      this.sample ??= `${outcome.kind}: ${outcome.kind === 'rpc-error' ? outcome.message : outcome.detail}`;
      return;
    }
    const errorClass = classifyToolResult(
      outcome.text,
      outcome.isError,
      this.root,
    ).errorClass;
    if (errorClass === 'building') this.inconclusive += 1;
    else if (
      errorClass !== null ||
      /"status"\s*:\s*"(failed|not-found|error)"/.test(outcome.text)
    ) {
      this.rejected += 1;
      this.sample ??= outcome.text.slice(0, 200);
    } else this.accepted += 1;
  }

  finding(): FailureEntry[] {
    if (this.accepted + this.rejected + this.inconclusive === 0) return [];
    return [
      {
        question: '(relative-path probe)',
        expected: [
          'a workspace-relative file is accepted (the schema allows it)',
        ],
        got: [
          `accepted ${this.accepted}, rejected ${this.rejected}, inconclusive (building) ${this.inconclusive}`,
          ...(this.sample === null ? [] : [`first rejection: ${this.sample}`]),
        ],
      },
    ];
  }
}

/**
 * Median of the tool's result tokens over native's per question (lower is
 * better), over the answered questions `keep` selects; `null` when none.
 */
export function tokenRatioP50<Q>(
  records: readonly QuestionRecord<Q>[],
  keep: (question: Q) => boolean,
): number | null {
  const values = records.flatMap((record) => {
    const native = record.natives.get('native');
    if (!keep(record.question) || !record.tool || !native) return [];
    const { error, tokens } = record.tool;
    return error === null && tokens !== null && native.tokens > 0
      ? [tokens / native.tokens]
      : [];
  });
  const value = p50Latency(values);
  return value === undefined ? null : Math.round(value * 10_000) / 10_000;
}
