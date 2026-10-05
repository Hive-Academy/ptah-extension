/**
 * `--subagents` view of the measurement tool M (TASK_2026_597, Task 36.1).
 *
 * Reduces each Claude Code subagent transcript (`<session>/subagents/*.jsonl`)
 * to the numbers decision 9 measures:
 *
 * - N3/N4: the start prefix, i.e. the context of the subagent's first request
 *   (`input + cache_read + cache_creation`), summarised per agent type.
 * - N1: every request that follows the previous request of the SAME subagent
 *   by more than {@link RESUME_GAP_MS}. With a 5-minute prompt cache such a
 *   request finds the cache expired and pays `cache_creation` again.
 *
 * Requests come from the Claude reader after its per-`message.id` dedupe (last
 * line wins). A response that never carried usage is skipped and counted by
 * the reader, never read as 0. Tokens only: M holds no pricing.
 */

import type {
  ClaudeRequest,
  ClaudeTranscriptSummary,
} from './claude-transcript.reader';
import { isoInstant, requestStats } from './lane-metrics';

/** Default prompt cache TTL: a gap longer than this is a cold resume. */
export const RESUME_GAP_MS = 300_000;

/** A request sent more than {@link RESUME_GAP_MS} after the previous one. */
export interface LateRequest {
  /** When the late request was sent (UTC ISO-8601). */
  readonly at: string | null;
  readonly gapSeconds: number;
  readonly cacheCreation: number;
  readonly cacheRead: number;
}

/** One subagent, reduced to the numbers `--subagents` prints. */
export interface SubagentMetrics {
  readonly id: string;
  /** Parent session id: the directory that holds `subagents/`. */
  readonly sessionId: string;
  /** From the sibling `.meta.json`; `?` when unknown. */
  readonly agentType: string;
  readonly startedAt: string | null;
  readonly model: string;
  readonly requests: number;
  /** Context of the first request: input + cache_read + cache_creation. */
  readonly prefix: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
  readonly output: number;
  readonly lateRequests: readonly LateRequest[];
}

/** A request is one with a positive context, as in `requestStats`. */
const contextOf = (r: ClaudeRequest): number =>
  r.input + r.cacheRead + r.cacheCreation;

/** Parent session id of a `<session>/subagents/<file>.jsonl` path. */
function parentSessionId(file: string): string {
  const segments = file.split(/[\\/]/);
  const at = segments.lastIndexOf('subagents');
  return at > 0 ? (segments[at - 1] ?? '?') : '?';
}

/** The `--subagents` row for one subagent transcript. */
export function claudeSubagentMetrics(
  summary: ClaudeTranscriptSummary,
): SubagentMetrics {
  const requests = summary.requests.filter((r) => contextOf(r) > 0);
  const lateRequests: LateRequest[] = [];
  let cacheRead = 0;
  let cacheCreation = 0;
  let output = 0;
  let previousAtMs: number | null = null;
  for (const request of requests) {
    cacheRead += request.cacheRead;
    cacheCreation += request.cacheCreation;
    output += request.output;
    if (
      request.atMs !== null &&
      previousAtMs !== null &&
      request.atMs - previousAtMs > RESUME_GAP_MS
    ) {
      lateRequests.push({
        at: isoInstant(request.atMs),
        gapSeconds: Math.round((request.atMs - previousAtMs) / 1000),
        cacheCreation: request.cacheCreation,
        cacheRead: request.cacheRead,
      });
    }
    // A request without a timestamp breaks the chain: the next gap is unknown.
    previousAtMs = request.atMs;
  }
  return {
    id: summary.id,
    sessionId: parentSessionId(summary.file),
    agentType: summary.agentType ?? '?',
    startedAt: summary.startedAt,
    model: summary.model,
    requests: requests.length,
    prefix: requestStats(requests.map(contextOf)).firstInput,
    cacheRead,
    cacheCreation,
    output,
    lateRequests,
  };
}

export interface SubagentFilter {
  /** Keep subagents started at or after this epoch-ms. */
  readonly sinceMs?: number;
  /** Keep subagents started before this epoch-ms. */
  readonly untilMs?: number;
  /** Keep subagents whose parent session id starts with one of these. */
  readonly sessions?: readonly string[];
}

/**
 * Subagent rows with at least one request that pass the filter. A start-time
 * bound drops a subagent whose start time is unknown.
 */
export function selectSubagents(
  transcripts: readonly ClaudeTranscriptSummary[],
  filter: SubagentFilter = {},
): SubagentMetrics[] {
  const { sinceMs, untilMs, sessions } = filter;
  return transcripts
    .filter((t) => t.kind === 'subagent')
    .map(claudeSubagentMetrics)
    .filter((row) => {
      if (row.requests === 0) return false;
      if (sessions && !sessions.some((s) => row.sessionId.startsWith(s))) {
        return false;
      }
      if (sinceMs === undefined && untilMs === undefined) return true;
      const started = row.startedAt === null ? NaN : Date.parse(row.startedAt);
      if (Number.isNaN(started)) return false;
      return (
        (sinceMs === undefined || started >= sinceMs) &&
        (untilMs === undefined || started < untilMs)
      );
    })
    .sort((a, b) => {
      const x = startKey(a);
      const y = startKey(b);
      return x === y ? 0 : x - y;
    });
}

/** Start instant for ordering; an unknown start sorts last. */
function startKey(row: SubagentMetrics): number {
  const ms = row.startedAt === null ? NaN : Date.parse(row.startedAt);
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/** Min, median and max of a sample; the median of an even count is the mean of the middle two. */
export interface Spread {
  readonly count: number;
  readonly min: number;
  readonly median: number;
  readonly max: number;
}

export function spread(values: readonly number[]): Spread | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? (sorted[mid] ?? 0)
      : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return {
    count: sorted.length,
    min: sorted[0] ?? 0,
    median,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

export interface SubagentSummary {
  readonly subagents: number;
  readonly prefixAll: Spread | null;
  /** Per agent type, most subagents first. */
  readonly prefixByType: readonly {
    readonly agentType: string;
    readonly prefix: Spread;
  }[];
  /** N1: requests after a gap of more than {@link RESUME_GAP_MS}. */
  readonly lateResumes: {
    readonly count: number;
    readonly cacheCreationSum: number;
    readonly cacheCreation: Spread | null;
  };
}

export function summariseSubagents(
  rows: readonly SubagentMetrics[],
): SubagentSummary {
  const byType = new Map<string, number[]>();
  for (const row of rows) {
    const prefixes = byType.get(row.agentType) ?? [];
    prefixes.push(row.prefix);
    byType.set(row.agentType, prefixes);
  }
  const prefixByType = [...byType]
    .flatMap(([agentType, prefixes]) => {
      const prefix = spread(prefixes);
      return prefix === null ? [] : [{ agentType, prefix }];
    })
    .sort(
      (a, b) =>
        b.prefix.count - a.prefix.count ||
        a.agentType.localeCompare(b.agentType),
    );
  const late = rows.flatMap((row) =>
    row.lateRequests.map((r) => r.cacheCreation),
  );
  return {
    subagents: rows.length,
    prefixAll: spread(rows.map((row) => row.prefix)),
    prefixByType,
    lateResumes: {
      count: late.length,
      cacheCreationSum: late.reduce((sum, n) => sum + n, 0),
      cacheCreation: spread(late),
    },
  };
}

export const SUBAGENT_TABLE_HEADER = [
  'started (UTC)'.padEnd(16),
  'session'.padEnd(8),
  'subagent'.padEnd(24),
  'type'.padEnd(24),
  'model'.padEnd(22),
  'reqs'.padStart(5),
  'prefix'.padStart(8),
  'cache_read'.padStart(11),
  'cache_write'.padStart(11),
  'output'.padStart(8),
  'late'.padStart(5),
].join(' ');

/** One fixed-width line per subagent; the header is {@link SUBAGENT_TABLE_HEADER}. */
export function formatSubagentRow(row: SubagentMetrics): string {
  const started = row.startedAt
    ? row.startedAt.slice(0, 16).replace('T', ' ')
    : '-';
  return [
    started.padEnd(16),
    row.sessionId.slice(0, 8).padEnd(8),
    row.id.padEnd(24).slice(0, 24),
    row.agentType.padEnd(24).slice(0, 24),
    (row.model || '?').padEnd(22).slice(0, 22),
    String(row.requests).padStart(5),
    String(row.prefix).padStart(8),
    String(row.cacheRead).padStart(11),
    String(row.cacheCreation).padStart(11),
    String(row.output).padStart(8),
    String(row.lateRequests.length).padStart(5),
  ].join(' ');
}

const formatSpread = (s: Spread | null): string =>
  s === null
    ? 'n=0'
    : `n=${s.count} min=${s.min} median=${Math.round(s.median)} max=${s.max}`;

/** The summary lines printed under the table. */
export function formatSubagentSummary(summary: SubagentSummary): string[] {
  const lines = [
    `subagents=${summary.subagents}`,
    `start prefix (all types): ${formatSpread(summary.prefixAll)}`,
    'start prefix by agent type:',
    ...summary.prefixByType.map(
      ({ agentType, prefix }) =>
        `  ${agentType.padEnd(32).slice(0, 32)} ${formatSpread(prefix)}`,
    ),
  ];
  const late = summary.lateResumes;
  lines.push(
    `resumes after > ${RESUME_GAP_MS / 60_000} min: count=${late.count} cache_write sum=${late.cacheCreationSum} median=${late.cacheCreation === null ? '-' : Math.round(late.cacheCreation.median)}`,
  );
  return lines;
}
