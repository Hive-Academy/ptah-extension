/**
 * `ptah_agent_wait` — block until spawned lanes end (TASK_2026_597, D13).
 *
 * One blocking call replaces a `ptah_agent_status` polling loop. The wait
 * itself is `AgentProcessManager.waitForAgents`, which settles on the
 * `agent:exited` event; this module owns the tool definition and the reply.
 *
 * The reply reports, per lane: status, exit code, duration, why it stopped,
 * the declared deliverables as checked on disk now, and the last output
 * lines. The whole reply is at most {@link WAIT_SUMMARY_MAX_CHARS} chars, so
 * it is never spooled; the full output stays readable through
 * `ptah_agent_read`. A timeout is a partial result, never an error.
 *
 * Served as `ptah_agent_wait` (HTTP, `protocol-dispatcher.ts`) and
 * `agent_wait` (stdio, `agent-tool.dispatcher.ts`).
 */
import { stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import type {
  AgentWaitEntry,
  AgentWaitMode,
  AgentWaitResult,
} from '@ptah-extension/cli-agent-runtime';
import type { AgentOutput, AgentProcessInfo } from '@ptah-extension/shared';
import type { MCPToolDefinition } from '../types';
import {
  DEFAULT_AGENT_WAIT_TIMEOUT_SEC,
  MAX_WAIT_AGENT_IDS,
  MAX_WAIT_TIMEOUT_SEC,
  WAIT_SUMMARY_MAX_CHARS,
  type AgentWaitArgs,
} from './wait-tools-args.schema';

/** The one tool name. Exported so the dispatchers and their specs agree on it. */
export const AGENT_WAIT_TOOL_NAME = 'ptah_agent_wait';

/** Output lines read per ended lane for the reply. */
const LAST_LINES_READ = 12;
/** Longest single output or deliverable line kept in the reply. */
const MAX_LINE_CHARS = 200;
/** Deliverables listed per lane; the rest are counted. */
const MAX_DELIVERABLES_LISTED = 5;

/** Size and mtime of one file, or `undefined` when it cannot be read. */
export type FileStat = { readonly size: number; readonly mtimeMs: number };

export interface AgentWaitDependencies {
  /** `AgentProcessManager.waitForAgents`, already scoped to the caller. */
  waitForAgents(
    agentIds: readonly string[],
    mode: AgentWaitMode,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentWaitResult>;
  /**
   * Ends the wait early when it fires (TASK_2026_614, E.3): the reply is then
   * the partial result, headed "WAIT CANCELLED". Omit it for a wait that ends
   * only on the lanes or the timeout.
   */
  signal?: AbortSignal;
  /** `ptah.agent.read`: the parsed tail of one lane's output. */
  readOutput(agentId: string, tail: number): Promise<AgentOutput>;
  /** File check for deliverables. Default: `fs.stat`, `undefined` on any failure. */
  statFile?: (path: string) => Promise<FileStat | undefined>;
  /** Clock (epoch ms) for a running lane's duration. Default `Date.now`. */
  now?: () => number;
}

export function buildAgentWaitTool(): MCPToolDefinition {
  return {
    name: AGENT_WAIT_TOOL_NAME,
    description:
      'Block until spawned agent lanes end, instead of polling ptah_agent_status. ' +
      'mode "all" (default) returns when every lane has ended; "any" when the first one has. ' +
      `timeoutSec (0-${MAX_WAIT_TIMEOUT_SEC}, default ${DEFAULT_AGENT_WAIT_TIMEOUT_SEC}) bounds the wait; ` +
      'on timeout the reply is a PARTIAL result (not an error) and the call is safe to repeat. ' +
      'Per lane it reports status, exit code, duration, why it stopped, the declared deliverables ' +
      `checked on disk, and the last output lines, in at most ${WAIT_SUMMARY_MAX_CHARS} chars. ` +
      'Read the full output with ptah_agent_read.',
    inputSchema: {
      type: 'object',
      properties: {
        agentIds: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: MAX_WAIT_AGENT_IDS,
          description: 'Agent ids returned by ptah_agent_spawn.',
        },
        mode: {
          type: 'string',
          enum: ['any', 'all'],
          description: 'Return when any lane ends, or when all have (default).',
        },
        timeoutSec: {
          type: 'integer',
          minimum: 0,
          maximum: MAX_WAIT_TIMEOUT_SEC,
          description: `Longest wait in seconds (default ${DEFAULT_AGENT_WAIT_TIMEOUT_SEC}).`,
        },
      },
      required: ['agentIds'],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  };
}

/**
 * Run one wait and render its reply. `args` is the parsed
 * `AgentWaitArgsSchema` value; the caller validates at the boundary.
 */
export async function runAgentWait(
  args: AgentWaitArgs,
  deps: AgentWaitDependencies,
): Promise<string> {
  const result = await deps.waitForAgents(
    args.agentIds,
    args.mode,
    args.timeoutSec * 1000,
    deps.signal,
  );
  const statFile = deps.statFile ?? statOrUndefined;
  const now = (deps.now ?? Date.now)();
  const lanes = await Promise.all(
    result.entries.map((entry) => describeEntry(entry, deps, statFile, now)),
  );
  return formatAgentWaitSummary(result, args.timeoutSec, lanes);
}

/** What the reply says about one lane, before the size budget is applied. */
export interface LaneSummary {
  /** One-line headline: id, CLI, status, exit code, duration, stop reason. */
  readonly head: string;
  /** Deliverable lines, already capped. */
  readonly details: readonly string[];
  /** Last output lines, oldest first. Dropped oldest-first to fit the budget. */
  readonly lastLines: readonly string[];
}

/**
 * Render the reply within {@link WAIT_SUMMARY_MAX_CHARS}. Each lane gets an
 * equal share of what the header and footer leave; within a share the head
 * and deliverables come first and the output lines fill the rest, newest
 * kept.
 */
export function formatAgentWaitSummary(
  result: AgentWaitResult,
  timeoutSec: number,
  lanes: readonly LaneSummary[],
): string {
  const header = headerOf(result, timeoutSec);
  const footer =
    'Full output: ptah_agent_read {"agentId": "<id>"}. Lane statuses: ptah_agent_status.';
  // One blank-line join ("\n\n") between each of the lanes + 2 parts.
  const room =
    WAIT_SUMMARY_MAX_CHARS -
    header.length -
    footer.length -
    2 * (lanes.length + 1);
  const share = Math.max(0, Math.floor(room / Math.max(1, lanes.length)));
  const blocks = lanes.map((lane) => renderLane(lane, share));
  const text = [header, ...blocks, footer].join('\n\n');
  return text.length <= WAIT_SUMMARY_MAX_CHARS
    ? text
    : `${text.slice(0, WAIT_SUMMARY_MAX_CHARS - 1)}…`;
}

function headerOf(result: AgentWaitResult, timeoutSec: number): string {
  const known = result.entries.filter(
    (e): e is Extract<AgentWaitEntry, { info: AgentProcessInfo }> =>
      'info' in e,
  );
  const running = known.filter((e) => e.state === 'running').length;
  const ended = known.length - running;
  if (result.cancelled) {
    return (
      `WAIT CANCELLED after ${formatDuration(result.waitedMs)} waiting for ${result.mode}: ` +
      `${ended} of ${known.length} known lane(s) ended, ${running} still running. ` +
      'Partial result; the lanes themselves were not stopped.'
    );
  }
  if (result.timedOut) {
    return (
      `TIMED OUT after ${timeoutSec}s waiting for ${result.mode}: ${ended} of ${known.length} ` +
      `known lane(s) ended, ${running} still running. Partial result; call ptah_agent_wait ` +
      'again to keep waiting.'
    );
  }
  return `Wait (${result.mode}) done after ${formatDuration(result.waitedMs)}: ${ended} of ${known.length} known lane(s) ended, ${running} still running.`;
}

function renderLane(lane: LaneSummary, share: number): string {
  const fixed = [lane.head, ...lane.details].join('\n');
  if (fixed.length >= share) {
    return share > 1 ? `${fixed.slice(0, share - 1)}…` : fixed.slice(0, share);
  }
  const kept: string[] = [];
  let used = fixed.length + '\n  Last lines:'.length;
  for (let i = lane.lastLines.length - 1; i >= 0; i--) {
    const line = `\n    ${lane.lastLines[i]}`;
    if (used + line.length > share) break;
    kept.unshift(line);
    used += line.length;
  }
  return kept.length === 0 ? fixed : `${fixed}\n  Last lines:${kept.join('')}`;
}

async function describeEntry(
  entry: AgentWaitEntry,
  deps: AgentWaitDependencies,
  statFile: (path: string) => Promise<FileStat | undefined>,
  now: number,
): Promise<LaneSummary> {
  if (entry.state === 'not_found') {
    return {
      head: `[${entry.agentId}] not found: this host holds no record under that id.`,
      details: [],
      lastLines: [],
    };
  }
  if (entry.state === 'other_workspace') {
    return {
      head: `[${entry.agentId}] belongs to another workspace; wait for it from that workspace.`,
      details: [],
      lastLines: [],
    };
  }
  const { info } = entry;
  const exit = info.exitCode === undefined ? '' : `, exit ${info.exitCode}`;
  const head =
    `[${entry.agentId}] ${info.displayName ?? info.cli}: ${info.status}${exit}, ` +
    `${formatDuration(durationOf(info, now))}, ${stopReasonOf(info)}`;
  const [details, lastLines] = await Promise.all([
    deliverableLines(info, statFile),
    entry.state === 'exited' ? lastLinesOf(entry.agentId, deps) : [],
  ]);
  return { head: cap(head), details, lastLines };
}

/** Why the lane is where it is, in words the orchestrator can act on. */
function stopReasonOf(info: AgentProcessInfo): string {
  switch (info.status) {
    case 'running':
      return 'still running';
    case 'completed':
      return 'ended normally';
    case 'failed':
      return info.exitCode === undefined
        ? 'failed'
        : `failed with exit code ${info.exitCode}`;
    case 'timeout':
      return 'no output for the inactivity window, treated as hung and killed';
    case 'stopped':
      switch (info.stopReason) {
        case 'tool-call-budget':
          return 'stopped by the lane budget guard: tool-call budget reached';
        case 'repeat-call':
          return 'stopped by the lane budget guard: repeated identical call';
        default:
          return 'stopped on request';
      }
  }
}

function durationOf(info: AgentProcessInfo, now: number): number {
  const start = Date.parse(info.startedAt);
  const end = info.completedAt ? Date.parse(info.completedAt) : now;
  return Number.isFinite(start) && Number.isFinite(end)
    ? Math.max(0, end - start)
    : 0;
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

/**
 * The declared deliverables as they are on disk now, resolved the way the
 * lane completion signal resolves them (`lane-completion-notifier.service.ts`):
 * relative to `taskFolder` when set, else to the working directory.
 */
async function deliverableLines(
  info: AgentProcessInfo,
  statFile: (path: string) => Promise<FileStat | undefined>,
): Promise<string[]> {
  const declared = info.deliverables ?? [];
  if (declared.length === 0) return [];
  const startedMs = Date.parse(info.startedAt);
  const listed = declared.slice(0, MAX_DELIVERABLES_LISTED);
  const lines = await Promise.all(
    listed.map(async (entry) => {
      const path = resolveDeliverable(info, entry);
      const found = await statFile(path);
      let state: string;
      if (!found) state = 'MISSING';
      else if (found.size === 0) state = 'EMPTY';
      else {
        const stale =
          Number.isFinite(startedMs) && found.mtimeMs < startedMs
            ? ' (NOT written by this run)'
            : '';
        state = `${found.size} bytes${stale}`;
      }
      return cap(`  - ${path}: ${state}`);
    }),
  );
  const more = declared.length - listed.length;
  return [
    '  Deliverables:',
    ...lines,
    ...(more > 0 ? [`  - ...and ${more} more`] : []),
  ];
}

function resolveDeliverable(info: AgentProcessInfo, entry: string): string {
  if (isAbsolute(entry)) return resolve(entry);
  const { taskFolder, workingDirectory } = info;
  if (!taskFolder) return resolve(workingDirectory, entry);
  const base = isAbsolute(taskFolder)
    ? taskFolder
    : resolve(workingDirectory, taskFolder);
  return resolve(base, entry);
}

async function lastLinesOf(
  agentId: string,
  deps: AgentWaitDependencies,
): Promise<string[]> {
  let output: AgentOutput;
  try {
    output = await deps.readOutput(agentId, LAST_LINES_READ);
  } catch (error: unknown) {
    // degradation-audit: optional-capability - the record can expire between
    // the wait and this read; the lane's status is already in the reply and
    // ptah_agent_read reports the expiry itself, so the tail is omitted.
    void error;
    return [];
  }
  const text = output.stdout.trim() ? output.stdout : output.stderr;
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-LAST_LINES_READ)
    .map(cap);
}

function cap(line: string): string {
  return line.length <= MAX_LINE_CHARS
    ? line
    : `${line.slice(0, MAX_LINE_CHARS - 1)}…`;
}

async function statOrUndefined(path: string): Promise<FileStat | undefined> {
  try {
    const found = await stat(path);
    return { size: found.size, mtimeMs: found.mtimeMs };
  } catch (error: unknown) {
    // degradation-audit: optional-capability - a deliverable that cannot be
    // read is reported as MISSING, exactly as the lane completion signal does;
    // for every next step the orchestrator takes the two are the same.
    void error;
    return undefined;
  }
}
