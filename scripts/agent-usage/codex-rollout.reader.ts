/**
 * Codex rollout reader for M (TASK_2026_597, component 10).
 *
 * Codex writes one rollout per thread under `<CODEX_HOME>/sessions/YYYY/MM/DD/
 * rollout-<local timestamp>-<thread id>.jsonl`, `CODEX_HOME` defaulting to
 * `~/.codex` (`codexHomeDir`). A resumed thread appends to the same file, so
 * one file is one lane however many turns it took. The records used here:
 *
 * - `session_meta` — `originator`, `source`, `cwd` (R1.2 lane identification);
 * - `turn_context` — `model`, `effort` per turn;
 * - `event_msg` / `task_started` — a turn boundary (first turn, then resumes);
 * - `event_msg` / `token_count` — `info.last_token_usage.input_tokens` is the
 *   size of one request, `info.total_token_usage` the running thread total;
 * - `response_item` messages — the first request's user messages are tested
 *   for the lane contract marker; any developer or user part that holds the
 *   `## Role: <name>` header `renderRoleBlock` emits is a role part, counted
 *   for the AS6 `--resumed` report (with the turn it was recorded in);
 * - `compacted` records — when one carries `replacement_history`, that is the
 *   history from then on, so M checks whether the role survived in it; a
 *   compaction without it is a summary, which drops the role;
 * - tool call / output pairs (by `call_id`) for the largest single output;
 * - `compacted` records and `context_compacted` events for compactions.
 *
 * Read-only: nothing here writes to the user's store. Message text is tested
 * and hashed while parsing and never kept.
 */

import { createHash } from 'crypto';
import { basename, join } from 'path';

import { codexHomeDir } from '../../libs/backend/harness-sync/src/lib/targets/mcp/codex-home';
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
  hasRoleBlockHeader,
  isoInstant,
  isPtahCodexLane,
  largerToolOutput,
  requestStats,
  type LaneMetrics,
  type SkippedSource,
  type ToolOutputSize,
} from './lane-metrics';

export interface CodexTokenTotals {
  readonly input: number;
  readonly cached: number;
  readonly output: number;
  readonly reasoning: number;
  readonly total: number;
}

/** AS6: where the role block appears in the thread. */
export interface CodexRoleOccurrences {
  /** Role parts recorded across the whole rollout, any channel. */
  readonly parts: number;
  /** Of those, how many were recorded in a resumed turn (turn 2 or later). */
  readonly partsInResumedTurns: number;
  /** Role parts whose text repeats an earlier role part exactly. */
  readonly duplicateParts: number;
  /**
   * Role parts recorded in a resumed turn while an earlier copy was still in
   * the history: the resumed request then carries the role twice.
   */
  readonly reinjectedWhileInHistory: number;
  /** Role parts found in a user message rather than a developer message. */
  readonly userChannelParts: number;
  /**
   * Developer parts that are neither a Codex `<tag>` block nor a role block.
   * Non-zero with no role part means the role may be in a shape M does not
   * recognise.
   */
  readonly untaggedDeveloperParts: number;
  /** Resumed turns that started with no role left in the history. */
  readonly resumesWithoutRole: number;
}

export interface CodexRolloutSummary {
  readonly file: string;
  /** The rollout's local start timestamp, from its file name. */
  readonly id: string;
  readonly originator: string | null;
  readonly source: string | null;
  /** Last path segment of `session_meta.cwd`. */
  readonly cwd: string;
  readonly model: string;
  readonly effort: string;
  /** `task_started` events: 1 for a fresh lane, more once resumed. */
  readonly turns: number;
  /** Input size of every request, in order. */
  readonly requestInputs: readonly number[];
  /** Last `total_token_usage`, or null when the rollout has none. */
  readonly totals: CodexTokenTotals | null;
  readonly compactions: number;
  readonly toolCalls: Readonly<Record<string, number>>;
  readonly toolOutputChars: Readonly<Record<string, number>>;
  readonly largestToolOutput: ToolOutputSize | null;
  readonly hasLaneMarker: boolean;
  readonly role: CodexRoleOccurrences;
  /** `rate_limits.primary.used_percent` at the first and last event. */
  readonly rateLimitPctStart: number | null;
  readonly rateLimitPctEnd: number | null;
  readonly badLines: number;
}

/** `<CODEX_HOME>/sessions`, honouring `CODEX_HOME`. */
export function codexSessionsDir(): string {
  return join(codexHomeDir(), 'sessions');
}

/** `rollout-2026-10-03T13-26-45-<uuid>.jsonl` → `2026-10-03T13-26-45`. */
export function rolloutIdFromFileName(file: string): string {
  const name = basename(file);
  const match = /^rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/.exec(name);
  return match?.[1] ?? name.replace(/\.jsonl$/, '');
}

/** Text parts of a `response_item` message, whatever their part type. */
function messageTexts(payload: Record<string, unknown>): string[] {
  const content = payload['content'];
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const part of content) {
    const text = asString(asObject(part)['text']);
    if (text !== null) texts.push(text);
  }
  return texts;
}

/** A Codex-injected block: `<permissions ...>`, `<skills_instructions>`, ... */
function isCodexTagBlock(text: string): boolean {
  return text.trimStart().startsWith('<');
}

/** True when any message item of a `replacement_history` holds a role block. */
function historyHoldsRole(history: readonly unknown[]): boolean {
  return history.some((item) =>
    messageTexts(asObject(item)).some(hasRoleBlockHeader),
  );
}

/** Summarise one rollout file. A line that does not parse is counted. */
export function readCodexRollout(file: string): CodexRolloutSummary {
  const { records, badLines } = readJsonLines(file);

  let originator: string | null = null;
  let source: string | null = null;
  let cwd = '';
  let model = '';
  let effort = '';
  let turns = 0;
  let turnContexts = 0;
  let compactions = 0;
  let totals: CodexTokenTotals | null = null;
  let previousTotalTokens = -1;
  let largestToolOutput: ToolOutputSize | null = null;
  let rateLimitPctStart: number | null = null;
  let rateLimitPctEnd: number | null = null;
  const requestInputs: number[] = [];
  const firstRequestUserTexts: string[] = [];
  const toolCalls: Record<string, number> = {};
  const toolOutputChars: Record<string, number> = {};
  const pendingCalls: Record<string, string> = {};
  const roleHashes = new Set<string>();
  let roleParts = 0;
  let rolePartsInResumedTurns = 0;
  let duplicateRoleParts = 0;
  let reinjectedWhileInHistory = 0;
  let userChannelParts = 0;
  let untaggedDeveloperParts = 0;
  let resumesWithoutRole = 0;
  let roleInHistory = false;

  for (const raw of records) {
    const record = asObject(raw);
    const type = asString(record['type']);
    const payload = asObject(record['payload']);
    const payloadType = asString(payload['type']);

    if (type === 'session_meta') {
      originator = asString(payload['originator']);
      source = asString(payload['source']);
      cwd = (asString(payload['cwd']) ?? '').split(/[\\/]/).pop() ?? '';
      continue;
    }
    if (type === 'turn_context') {
      turnContexts++;
      model = asString(payload['model']) || model;
      effort = asString(payload['effort']) || effort;
      continue;
    }
    if (type === 'compacted') {
      compactions++;
      const history = payload['replacement_history'];
      roleInHistory = Array.isArray(history) && historyHoldsRole(history);
      continue;
    }
    if (type === 'event_msg') {
      if (payloadType === 'task_started') {
        turns++;
        if (turns >= 2 && !roleInHistory) resumesWithoutRole++;
      }
      if (payloadType === 'context_compacted') compactions++;
      if (payloadType === 'token_count') {
        const used = asObject(asObject(payload['rate_limits'])['primary'])[
          'used_percent'
        ];
        if (typeof used === 'number') {
          if (rateLimitPctStart === null) rateLimitPctStart = used;
          rateLimitPctEnd = used;
        }
        const info = asObject(payload['info']);
        const total = asObject(info['total_token_usage']);
        if (Object.keys(total).length === 0) continue;
        const totalTokens = asNumber(total['total_tokens']);
        // Codex re-emits an unchanged `token_count` when only the rate limits
        // move. Same running total = same request; count it once.
        if (totalTokens > 0 && totalTokens === previousTotalTokens) continue;
        previousTotalTokens = totalTokens;
        totals = {
          input: asNumber(total['input_tokens']),
          cached: asNumber(total['cached_input_tokens']),
          output: asNumber(total['output_tokens']),
          reasoning: asNumber(total['reasoning_output_tokens']),
          total: totalTokens,
        };
        const requestInput = asNumber(
          asObject(info['last_token_usage'])['input_tokens'],
        );
        if (requestInput > 0) requestInputs.push(requestInput);
      }
      continue;
    }
    if (type !== 'response_item') continue;

    if (payloadType === 'message') {
      const role = asString(payload['role']);
      if (role === 'user' && requestInputs.length === 0) {
        // Only the first request's user messages decide R1.2; the text is
        // tested at the end and dropped with this function's scope.
        firstRequestUserTexts.push(...messageTexts(payload));
      }
      if (role !== 'developer' && role !== 'user') continue;
      for (const text of messageTexts(payload)) {
        if (!hasRoleBlockHeader(text)) {
          if (role === 'developer' && text.trim() && !isCodexTagBlock(text)) {
            untaggedDeveloperParts++;
          }
          continue;
        }
        roleParts++;
        if (role === 'user') userChannelParts++;
        if (turns >= 2) {
          rolePartsInResumedTurns++;
          if (roleInHistory) reinjectedWhileInHistory++;
        }
        const hash = createHash('sha256').update(text).digest('hex');
        if (roleHashes.has(hash)) duplicateRoleParts++;
        roleHashes.add(hash);
        roleInHistory = true;
      }
      continue;
    }
    if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
      const name = asString(payload['name']) ?? '?';
      toolCalls[name] = (toolCalls[name] ?? 0) + 1;
      const callId = asString(payload['call_id']);
      if (callId !== null) pendingCalls[callId] = name;
      continue;
    }
    if (
      payloadType === 'function_call_output' ||
      payloadType === 'custom_tool_call_output'
    ) {
      const callId = asString(payload['call_id']);
      const name = (callId !== null ? pendingCalls[callId] : undefined) ?? '?';
      const chars = outputChars(payload['output']);
      toolOutputChars[name] = (toolOutputChars[name] ?? 0) + chars;
      largestToolOutput = largerToolOutput(largestToolOutput, {
        tool: name,
        chars,
      });
    }
  }

  return {
    file,
    id: rolloutIdFromFileName(file),
    originator,
    source,
    cwd,
    model,
    effort,
    // Older rollouts have no `task_started`; one `turn_context` per turn then.
    turns: turns > 0 ? turns : turnContexts,
    requestInputs,
    totals,
    compactions,
    toolCalls,
    toolOutputChars,
    largestToolOutput,
    hasLaneMarker: hasLaneContractMarker(firstRequestUserTexts),
    role: {
      parts: roleParts,
      partsInResumedTurns: rolePartsInResumedTurns,
      duplicateParts: duplicateRoleParts,
      reinjectedWhileInHistory,
      userChannelParts,
      untaggedDeveloperParts,
      resumesWithoutRole,
    },
    rateLimitPctStart,
    rateLimitPctEnd,
    badLines,
  };
}

export interface CodexStoreFilter {
  /** Keep rollouts modified at or after this epoch-ms. */
  readonly modifiedSinceMs?: number;
  /** Keep rollouts started on this local date (`YYYY-MM-DD`, file name). */
  readonly date?: string;
}

export interface CodexStoreReport {
  readonly sessionsDir: string;
  readonly rollouts: CodexRolloutSummary[];
  readonly skipped: SkippedSource[];
}

/** Read every rollout under `sessionsDir`. A missing store is a skipped source. */
export function readCodexStore(
  sessionsDir: string,
  filter: CodexStoreFilter = {},
): CodexStoreReport {
  const skipped: SkippedSource[] = [];
  const files = collectJsonlFiles(sessionsDir, {
    // A date filter selects by start date, whatever the modification time.
    modifiedSinceMs: filter.date ? undefined : filter.modifiedSinceMs,
    nameFilter: filter.date
      ? (name) => name.startsWith(`rollout-${filter.date}T`)
      : undefined,
  });
  if (files.length === 0) {
    skipped.push({
      vendor: 'codex',
      location: sessionsDir,
      reason: 'absent or no rollouts in window',
    });
  }
  const rollouts: CodexRolloutSummary[] = [];
  for (const file of files) {
    let summary: CodexRolloutSummary;
    try {
      summary = readCodexRollout(file);
    } catch (error) {
      skipped.push({
        vendor: 'codex',
        location: file,
        reason: `unreadable (${error instanceof Error ? error.name : 'error'})`,
      });
      continue;
    }
    if (summary.badLines > 0) {
      skipped.push({
        vendor: 'codex',
        location: file,
        reason: `${summary.badLines} unparseable line(s) skipped`,
      });
    }
    rollouts.push(summary);
  }
  return { sessionsDir, rollouts, skipped };
}

export type ResumedRoleVerdict = 'once' | 'twice' | 'absent' | 'inconclusive';

export interface ResumedRoleResult {
  readonly verdict: ResumedRoleVerdict;
  readonly reason: string;
}

/**
 * AS6: how many copies of the role the history of a resumed request carries.
 * The rollout records every history item once, so its role parts are exactly
 * the ones a later request resends.
 *
 * - `twice`: a role part was recorded in a resumed turn while an earlier copy
 *   was still in the history (the role was re-injected on resume).
 * - `once`: the role was recorded, stayed in the history and was not recorded
 *   again on any resume.
 * - `absent`: the lane had a role, but a resumed turn started with no role in
 *   the history (a compaction dropped it, or the role first appeared later)
 *   and it was not re-injected on top of a surviving copy.
 * - `inconclusive`: the rollout cannot answer. Either it was not resumed, or
 *   no role block is recorded in any message (a lane spawned without a role,
 *   or a role in a shape M does not recognise; the reason says which).
 */
export function resumedRoleVerdict(
  summary: Pick<CodexRolloutSummary, 'turns' | 'role'>,
): ResumedRoleResult {
  const { turns, role } = summary;
  if (turns < 2) return { verdict: 'inconclusive', reason: 'not resumed' };
  if (role.parts === 0) {
    return {
      verdict: 'inconclusive',
      reason:
        role.untaggedDeveloperParts > 0
          ? `no role block found; ${role.untaggedDeveloperParts} unrecognised developer part(s) may hold it`
          : 'no role block in any developer or user message and no unrecognised developer part (spawned without a role)',
    };
  }
  if (role.reinjectedWhileInHistory > 0) {
    return {
      verdict: 'twice',
      reason: `${role.reinjectedWhileInHistory} role part(s) recorded in a resumed turn while still in history`,
    };
  }
  if (role.resumesWithoutRole > 0) {
    return {
      verdict: 'absent',
      reason: `${role.resumesWithoutRole} resumed turn(s) started with no role in history`,
    };
  }
  return {
    verdict: 'once',
    reason:
      role.userChannelParts > 0
        ? 'role in the first-turn user message'
        : 'role in first-turn developer_instructions',
  };
}

/**
 * `2026-10-03T13-26-45` (local time, as Codex names the file) → the UTC
 * instant it denotes, or null when the id is not a timestamp.
 */
export function rolloutStartInstant(id: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})$/.exec(id);
  if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  return isoInstant(new Date(y ?? 0, (mo ?? 1) - 1, d, h, mi, se).getTime());
}

/** The `--lanes` row for one rollout. */
export function codexLaneMetrics(summary: CodexRolloutSummary): LaneMetrics {
  const stats = requestStats(summary.requestInputs);
  return {
    vendor: 'codex',
    id: summary.id,
    startedAt: rolloutStartInstant(summary.id),
    isPtahLane: isPtahCodexLane(summary),
    model: summary.model,
    effort: summary.effort,
    requests: stats.requests,
    firstInput: stats.firstInput,
    peakInput: stats.peakInput,
    // The running total is authoritative; the per-request sum is the fallback
    // for a rollout whose totals are missing.
    totalInput: summary.totals?.input ?? stats.totalInput,
    cached: summary.totals?.cached ?? 0,
    output: summary.totals?.output ?? 0,
    largestToolOutput: summary.largestToolOutput,
    compactions: summary.compactions,
  };
}
