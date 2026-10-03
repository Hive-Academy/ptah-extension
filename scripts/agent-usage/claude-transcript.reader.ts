/**
 * Claude Code transcript reader for M (TASK_2026_597, component 10).
 *
 * Transcripts live under `<CLAUDE_CONFIG_DIR or ~/.claude>/projects/<project>/
 * *.jsonl`, subagent transcripts under `<session>/subagents/`. One assistant
 * API response carrying `message.usage` is one request; its context is
 * `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`.
 * Claude Code writes one line per content block of a response, each repeating
 * the same `message.id`. Input and cache fields are identical across those
 * lines, but `output_tokens` grows while the response streams, so a request
 * is counted once per id with the LAST line's usage (the rule
 * `session-usage-ledger.ts` uses).
 *
 * Read-only. Message text is tested for the lane contract marker while parsing
 * and never kept.
 */

import { homedir } from 'os';
import { join } from 'path';

import {
  asNumber,
  asObject,
  asString,
  collectJsonlFiles,
  outputChars,
  readJsonLines,
} from './jsonl-files';
import {
  hasLaneContractMarker,
  isoInstant,
  largerToolOutput,
  requestStats,
  type LaneMetrics,
  type SkippedSource,
  type ToolOutputSize,
} from './lane-metrics';

export interface ClaudeTranscriptSummary {
  readonly file: string;
  readonly id: string;
  /** `session` for a top-level transcript, `subagent` under `subagents/`. */
  readonly kind: 'session' | 'subagent';
  readonly cwd: string;
  readonly startedAt: string | null;
  readonly model: string;
  readonly requestInputs: readonly number[];
  readonly cached: number;
  readonly output: number;
  readonly compactions: number;
  readonly largestToolOutput: ToolOutputSize | null;
  readonly hasLaneMarker: boolean;
  readonly badLines: number;
}

/** `<CLAUDE_CONFIG_DIR or ~/.claude>/projects`. */
export function claudeProjectsDir(): string {
  const configDir = process.env['CLAUDE_CONFIG_DIR'];
  return join(
    configDir !== undefined && configDir.trim() !== ''
      ? configDir
      : join(homedir(), '.claude'),
    'projects',
  );
}

/** Text of a user message, string or block array; tool results excluded. */
function userTexts(content: unknown): string[] {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const block of content) {
    const part = asObject(block);
    if (part['type'] === 'text') {
      const text = asString(part['text']);
      if (text !== null) texts.push(text);
    }
  }
  return texts;
}

const USAGE_FIELDS = [
  'input_tokens',
  'cache_read_input_tokens',
  'cache_creation_input_tokens',
  'output_tokens',
] as const;

type UsageFields = Partial<Record<(typeof USAGE_FIELDS)[number], number>>;

/** Everything one request sent: fresh input plus cache reads and writes. */
function requestContext(usage: UsageFields): number {
  return (
    (usage.input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  );
}

/** Summarise one transcript. A line that does not parse is counted. */
export function readClaudeTranscript(file: string): ClaudeTranscriptSummary {
  const { records, badLines } = readJsonLines(file);
  const segments = file.split(/[\\/]/);
  // Insertion order = order of each response's first line.
  const usageById = new Map<string, UsageFields>();
  let firstRequestSeen = false;
  const toolNames: Record<string, string> = {};
  const firstRequestUserTexts: string[] = [];
  const requestInputs: number[] = [];
  let cwd = '';
  let startedAt: string | null = null;
  let model = '';
  let cached = 0;
  let output = 0;
  let compactions = 0;
  let largestToolOutput: ToolOutputSize | null = null;

  for (const [index, raw] of records.entries()) {
    const record = asObject(raw);
    const type = asString(record['type']);
    if (!cwd) cwd = asString(record['cwd']) ?? '';
    if (startedAt === null) {
      const stamp = asString(record['timestamp']);
      if (stamp !== null) startedAt = isoInstant(Date.parse(stamp));
    }
    if (type === 'system' && record['subtype'] === 'compact_boundary') {
      compactions++;
      continue;
    }
    const message = asObject(record['message']);

    if (type === 'user') {
      const content = message['content'];
      // A zero-usage assistant line (`<synthetic>`) is not a request and
      // does not close the first-request window.
      if (!firstRequestSeen) {
        firstRequestUserTexts.push(...userTexts(content));
      }
      if (Array.isArray(content)) {
        for (const block of content) {
          const part = asObject(block);
          if (part['type'] !== 'tool_result') continue;
          const useId = asString(part['tool_use_id']);
          largestToolOutput = largerToolOutput(largestToolOutput, {
            tool: (useId !== null ? toolNames[useId] : undefined) ?? '?',
            chars: outputChars(part['content']),
          });
        }
      }
      continue;
    }
    if (type !== 'assistant') continue;

    const content = message['content'];
    if (Array.isArray(content)) {
      for (const block of content) {
        const part = asObject(block);
        const id = asString(part['id']);
        if (part['type'] === 'tool_use' && id !== null) {
          toolNames[id] = asString(part['name']) ?? '?';
        }
      }
    }
    const usage = asObject(message['usage']);
    if (Object.keys(usage).length === 0) continue;
    model = asString(message['model']) || model;
    // Last line wins per field: later lines of one response carry the final
    // `output_tokens`; a field a later line omits keeps its earlier value.
    const key = asString(message['id']) ?? `#line-${index}`;
    const merged: UsageFields = { ...(usageById.get(key) ?? {}) };
    for (const field of USAGE_FIELDS) {
      if (typeof usage[field] === 'number')
        merged[field] = asNumber(usage[field]);
    }
    usageById.set(key, merged);
    if (requestContext(merged) > 0) firstRequestSeen = true;
  }

  for (const usage of usageById.values()) {
    requestInputs.push(requestContext(usage));
    cached += usage.cache_read_input_tokens ?? 0;
    output += usage.output_tokens ?? 0;
  }

  const leaf = segments[segments.length - 1] ?? file;
  return {
    file,
    id: leaf.replace(/\.jsonl$/, '').slice(0, 24),
    kind: segments.includes('subagents') ? 'subagent' : 'session',
    cwd:
      (cwd || segments[segments.length - 2] || '').split(/[\\/]/).pop() ?? '',
    startedAt,
    model,
    requestInputs,
    cached,
    output,
    compactions,
    largestToolOutput,
    hasLaneMarker: hasLaneContractMarker(firstRequestUserTexts),
    badLines,
  };
}

export interface ClaudeStoreReport {
  readonly projectsDir: string;
  readonly transcripts: ClaudeTranscriptSummary[];
  readonly skipped: SkippedSource[];
}

/** Read every transcript modified since `modifiedSinceMs`. */
export function readClaudeStore(
  projectsDir: string,
  modifiedSinceMs?: number,
): ClaudeStoreReport {
  const skipped: SkippedSource[] = [];
  const files = collectJsonlFiles(projectsDir, { modifiedSinceMs });
  if (files.length === 0) {
    skipped.push({
      vendor: 'claude',
      location: projectsDir,
      reason: 'absent or no transcripts in window',
    });
  }
  const transcripts: ClaudeTranscriptSummary[] = [];
  for (const file of files) {
    let summary: ClaudeTranscriptSummary;
    try {
      summary = readClaudeTranscript(file);
    } catch (error) {
      skipped.push({
        vendor: 'claude',
        location: file,
        reason: `unreadable (${error instanceof Error ? error.name : 'error'})`,
      });
      continue;
    }
    if (summary.badLines > 0) {
      skipped.push({
        vendor: 'claude',
        location: file,
        reason: `${summary.badLines} unparseable line(s) skipped`,
      });
    }
    if (summary.requestInputs.length > 0) transcripts.push(summary);
  }
  return { projectsDir, transcripts, skipped };
}

/** The `--lanes` row for one transcript. */
export function claudeLaneMetrics(
  summary: ClaudeTranscriptSummary,
): LaneMetrics {
  const stats = requestStats(summary.requestInputs);
  return {
    vendor: 'claude',
    id: summary.id,
    startedAt: summary.startedAt,
    isPtahLane: summary.hasLaneMarker,
    model: summary.model,
    effort: '',
    requests: stats.requests,
    firstInput: stats.firstInput,
    peakInput: stats.peakInput,
    totalInput: stats.totalInput,
    cached: summary.cached,
    output: summary.output,
    largestToolOutput: summary.largestToolOutput,
    compactions: summary.compactions,
  };
}
