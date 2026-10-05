#!/usr/bin/env node
/**
 * Agent usage report (measurement tool M, TASK_2026_597 component 10) — token
 * cost across the CLI vendors that keep local logs. Offline: it reads
 * existing logs only, never starts a model call and never writes to a store.
 *
 * Where the logs are (R1.2):
 * - Codex: `<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<local time>-<id>.jsonl`,
 *   `CODEX_HOME` defaulting to `~/.codex`. The Ptah spawn lane starts Codex
 *   through `@openai/codex-sdk`, so its rollouts sit here with
 *   `originator=codex_sdk_ts` and `source=exec`. A resumed lane appends to
 *   its own rollout.
 * - OpenCode: `<XDG_DATA_HOME or ~/.local/share>/opencode/opencode.db`
 *   (SQLite; read through a temp copy), config in `<XDG_CONFIG_HOME or
 *   ~/.config>/opencode`.
 * - Claude Code: `<CLAUDE_CONFIG_DIR or ~/.claude>/projects/**\/*.jsonl`,
 *   including `subagents/` transcripts.
 *
 * A Ptah lane is a session whose first request carries the lane completion
 * contract `buildTaskPrompt` appends (its `## Before you exit` heading at a
 * line start); Codex lanes must also match the originator and source above.
 * LIMIT: OpenCode and Claude lanes are identified by that marker alone, and
 * the contract only exists since 2026-09-21 (TASK_2026_515). Lanes started
 * before that date, or spawned by a path that does not append the contract,
 * are invisible. `--lanes` prints the first date the marker is seen per vendor
 * in the window, so a count that starts at 2026-09-21 reads as truncated.
 *
 * Times: every lane's start is a UTC instant (Codex local-time file names are
 * converted); `--lanes` sorts by it and displays it in UTC.
 *
 * AS6 verdicts (`--resumed`), per resumed Ptah Codex lane:
 *   once          role recorded, kept in history, not recorded again on resume
 *   twice         role recorded again in a resumed turn while still in history
 *   absent        role existed, but a resumed turn started without it in history
 *                 (a compaction dropped it) and it was not re-injected on top
 *   inconclusive  no `## Role:` block in any message, or not resumed; the
 *                 reason column says whether an unrecognised part could hold it
 *
 * Every tool call resends the whole thread, so cost tracks requests x context;
 * the default report leads with requests and average context, not a total.
 *
 * Usage:
 *   npm run usage:report -- [days=7] [top=15] [flags]
 *   --lanes            per-lane table: model, effort, first-request input, peak
 *                      per-request input, total input, cached, output,
 *                      requests, largest single tool output, compactions
 *   --all              with --lanes, include sessions that are not Ptah lanes
 *   --resumed          AS6: for each resumed Ptah Codex lane, how many copies of
 *                      the role its resumed requests carry (verdicts above)
 *   --opencode-config  MCP servers and plugins declared in the OpenCode config
 *                      directory, and their tool calls inside Ptah lanes
 *   --date=YYYY-MM-DD  only sessions started on that local date (overrides days)
 *   --subagents        per Claude subagent: agent type (from the transcript's
 *                      `.meta.json`), start prefix (first request's input +
 *                      cache read + cache write), requests, cache read/write,
 *                      output, and every request sent more than 5 min after the
 *                      previous request of the same subagent, with its cache
 *                      write. Summary: prefix min/median/max per agent type and
 *                      the "resume after > 5 min" count, cache-write sum, median
 *   --since=<iso>      with --subagents: subagents started at or after this
 *                      instant (also replaces `days` as the read window)
 *   --until=<iso>      with --subagents: subagents started before this instant
 *   --session=<id,..>  with --subagents: parent session ids (prefix match)
 * Without a mode flag it prints the aggregate views.
 */

import { join } from 'path';

import {
  claudeLaneMetrics,
  claudeProjectsDir,
  readClaudeStore,
  type ClaudeStoreReport,
} from './agent-usage/claude-transcript.reader';
import {
  codexLaneMetrics,
  codexSessionsDir,
  readCodexStore,
  resumedRoleVerdict,
  type CodexStoreReport,
} from './agent-usage/codex-rollout.reader';
import {
  formatLaneRow,
  formatMillions,
  LANE_TABLE_HEADER,
  localDate,
  percentOf,
  requestStats,
  sortLanesByStart,
  type LaneMetrics,
  type SkippedSource,
  type Vendor,
} from './agent-usage/lane-metrics';
import {
  opencodeConfigDir,
  opencodeDataDir,
  opencodeLaneMetrics,
  readOpencodeConfig,
  readOpencodeDb,
  serverToolCalls,
  type OpencodeDbReport,
} from './agent-usage/opencode-db.reader';
import {
  formatSubagentRow,
  formatSubagentSummary,
  selectSubagents,
  SUBAGENT_TABLE_HEADER,
  summariseSubagents,
  type SubagentFilter,
} from './agent-usage/subagent-metrics';

export interface ReportOptions {
  readonly days: number;
  readonly top: number;
  readonly date: string | null;
  readonly lanes: boolean;
  readonly all: boolean;
  readonly resumed: boolean;
  readonly opencodeConfig: boolean;
  readonly subagents: boolean;
  /** `--since` as epoch-ms, or null. */
  readonly sinceMs: number | null;
  /** `--until` as epoch-ms, or null. */
  readonly untilMs: number | null;
  /** `--session` ids, or null for every session. */
  readonly sessions: readonly string[] | null;
}

const MODE_FLAGS = [
  '--lanes',
  '--all',
  '--resumed',
  '--opencode-config',
  '--subagents',
];

/** Epoch-ms of an ISO-8601 flag value; throws on anything `Date` rejects. */
function isoFlag(name: string, value: string): number {
  const ms = Date.parse(value);
  if (!/^\d{4}-\d{2}-\d{2}/.test(value) || Number.isNaN(ms)) {
    throw new Error(`${name} expects an ISO-8601 instant, got "${value}"`);
  }
  return ms;
}

/** Positional `[days] [top]` plus the flags in the header. */
export function parseArgs(argv: readonly string[]): ReportOptions {
  const positional: string[] = [];
  let date: string | null = null;
  let sinceMs: number | null = null;
  let untilMs: number | null = null;
  let sessions: string[] | null = null;
  const flags = new Set<string>();
  for (const arg of argv) {
    if (arg.startsWith('--date=')) {
      const value = arg.slice('--date='.length);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(`--date expects YYYY-MM-DD, got "${value}"`);
      }
      date = value;
    } else if (arg.startsWith('--since=')) {
      sinceMs = isoFlag('--since', arg.slice('--since='.length));
    } else if (arg.startsWith('--until=')) {
      untilMs = isoFlag('--until', arg.slice('--until='.length));
    } else if (arg.startsWith('--session=')) {
      sessions = arg
        .slice('--session='.length)
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '');
      if (sessions.length === 0) {
        throw new Error('--session expects one or more session ids');
      }
    } else if (arg.startsWith('--')) {
      if (!MODE_FLAGS.includes(arg)) {
        throw new Error(`unknown flag ${arg}`);
      }
      flags.add(arg);
    } else {
      positional.push(arg);
    }
  }
  const subagents = flags.has('--subagents');
  if (
    !subagents &&
    (sinceMs !== null || untilMs !== null || sessions !== null)
  ) {
    throw new Error('--since, --until and --session need --subagents');
  }
  if (sinceMs !== null && date !== null) {
    throw new Error('--since and --date are exclusive');
  }
  const number = (raw: string | undefined, fallback: number, name: string) => {
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be a positive number, got "${raw}"`);
    }
    return value;
  };
  return {
    days: number(positional[0], 7, 'days'),
    top: number(positional[1], 15, 'top'),
    date,
    lanes: flags.has('--lanes'),
    all: flags.has('--all'),
    resumed: flags.has('--resumed'),
    opencodeConfig: flags.has('--opencode-config'),
    subagents,
    sinceMs,
    untilMs,
    sessions,
  };
}

// ---------------------------------------------------------------------------
// aggregate views (kept from the former agent-usage-report.mjs)
// ---------------------------------------------------------------------------

interface AggregateRow {
  readonly id: string;
  readonly originator: string;
  readonly cwd: string;
  readonly model: string;
  readonly effort: string;
  readonly requests: number;
  readonly firstInput: number;
  readonly input: number;
  readonly cached: number;
  readonly output: number;
  readonly reasoning: number;
  readonly total: number;
  /** Weekly-limit percentage moved during the session; negative on reset. */
  readonly pctDelta: number | null;
}

interface VendorStats {
  readonly rows: AggregateRow[];
  readonly requests: number;
  readonly contextSum: number;
  readonly requestsOver200k: number;
  readonly compactions: number | null;
}

function requestTotals(inputsPerSession: readonly (readonly number[])[]) {
  let requests = 0;
  let contextSum = 0;
  let requestsOver200k = 0;
  for (const inputs of inputsPerSession) {
    for (const size of inputs) {
      if (!(size > 0)) continue;
      requests++;
      contextSum += size;
      if (size > 200_000) requestsOver200k++;
    }
  }
  return { requests, contextSum, requestsOver200k };
}

function codexStats(report: CodexStoreReport): VendorStats {
  const withUsage = report.rollouts.flatMap((r) =>
    r.totals === null ? [] : [{ ...r, totals: r.totals }],
  );
  const rows = withUsage.map((r): AggregateRow => {
    const totals = r.totals;
    return {
      id: r.id,
      originator: r.originator ?? '?',
      cwd: r.cwd,
      model: r.model,
      effort: r.effort,
      requests: requestStats(r.requestInputs).requests,
      firstInput: requestStats(r.requestInputs).firstInput,
      input: totals.input,
      cached: totals.cached,
      output: totals.output,
      reasoning: totals.reasoning,
      total: totals.total,
      pctDelta:
        r.rateLimitPctStart === null || r.rateLimitPctEnd === null
          ? null
          : +(r.rateLimitPctEnd - r.rateLimitPctStart).toFixed(1),
    };
  });
  rows.sort((a, b) => b.total - a.total);
  return {
    rows,
    ...requestTotals(withUsage.map((r) => r.requestInputs)),
    compactions: withUsage.reduce((s, r) => s + r.compactions, 0),
  };
}

function claudeStats(report: ClaudeStoreReport): VendorStats {
  const rows = report.transcripts.map((t): AggregateRow => {
    const stats = requestStats(t.requestInputs);
    return {
      id: t.id,
      originator: t.kind,
      cwd: t.cwd,
      model: t.model,
      effort: '',
      requests: stats.requests,
      firstInput: stats.firstInput,
      input: stats.totalInput,
      cached: t.cached,
      output: t.output,
      reasoning: 0,
      total: stats.totalInput + t.output,
      pctDelta: null,
    };
  });
  rows.sort((a, b) => b.total - a.total);
  return {
    rows,
    ...requestTotals(report.transcripts.map((t) => t.requestInputs)),
    compactions: report.transcripts.reduce((s, t) => s + t.compactions, 0),
  };
}

function opencodeStats(report: OpencodeDbReport): VendorStats {
  const sessions = report.sessions.filter((s) => s.requestInputs.length > 0);
  const rows = sessions.map((s): AggregateRow => {
    const stats = requestStats(s.requestInputs);
    return {
      id: s.id,
      originator: s.hasLaneMarker ? 'ptah-lane' : 'session',
      cwd: '',
      model: s.model,
      effort: s.effort,
      requests: stats.requests,
      firstInput: stats.firstInput,
      input: stats.totalInput,
      cached: s.cached,
      output: s.output,
      reasoning: 0,
      total: stats.totalInput + s.output,
      pctDelta: null,
    };
  });
  rows.sort((a, b) => b.total - a.total);
  return {
    rows,
    ...requestTotals(sessions.map((s) => s.requestInputs)),
    compactions: sessions.reduce((s, x) => s + x.compactions, 0),
  };
}

type AggregateKey = 'originator' | 'model' | 'effort' | 'cwd';

function printAggregate(
  rows: readonly AggregateRow[],
  title: string,
  key: AggregateKey,
): void {
  const groups = new Map<
    string,
    {
      n: number;
      input: number;
      cached: number;
      output: number;
      reasoning: number;
      pct: number;
    }
  >();
  for (const row of rows) {
    const k = row[key] || '?';
    const g = groups.get(k) ?? {
      n: 0,
      input: 0,
      cached: 0,
      output: 0,
      reasoning: 0,
      pct: 0,
    };
    g.n++;
    g.input += row.input;
    g.cached += row.cached;
    g.output += row.output;
    g.reasoning += row.reasoning;
    g.pct += Math.max(0, row.pctDelta ?? 0);
    groups.set(k, g);
  }
  console.log(`\n-- by ${title}`);
  for (const [k, v] of [...groups].sort((a, b) => b[1].input - a[1].input)) {
    console.log(
      `${k.padEnd(40).slice(0, 40)} n=${String(v.n).padStart(4)} input=${formatMillions(v.input).padStart(8)} cached=${String(percentOf(v.cached, v.input)).padStart(3)}% output=${formatMillions(v.output).padStart(6)} reasoning=${formatMillions(v.reasoning).padStart(6)} limit%=${v.pct.toFixed(0).padStart(4)}`,
    );
  }
}

function printHeadline(vendor: string, stats: VendorStats): void {
  const { rows, requests, contextSum, requestsOver200k, compactions } = stats;
  const input = rows.reduce((s, r) => s + r.input, 0);
  const cached = rows.reduce((s, r) => s + r.cached, 0);
  const output = rows.reduce((s, r) => s + r.output, 0);
  console.log(`\n=== ${vendor}`);
  if (rows.length === 0) {
    console.log('no sessions in window (no local logs found)');
    return;
  }
  console.log(
    `sessions=${rows.length}  requests=${requests}  avg/session=${(requests / rows.length).toFixed(0)}`,
  );
  console.log(
    `avg context/request=${Math.round(contextSum / Math.max(1, requests) / 1e3)}k  over 200k=${requestsOver200k}` +
      (compactions === null ? '' : `  compactions=${compactions}`),
  );
  console.log(
    `total input=${formatMillions(input)}  cached=${percentOf(cached, input)}%  output=${formatMillions(output)}`,
  );
}

function printTopSessions(
  vendor: string,
  rows: readonly AggregateRow[],
  top: number,
): void {
  console.log(`\n-- top ${top} sessions by tokens (${vendor})`);
  for (const r of rows.slice(0, top)) {
    console.log(
      `${r.id.padEnd(19).slice(0, 19)} ${r.originator.padEnd(13)} ${r.model.padEnd(16).slice(0, 16)} ${r.cwd.padEnd(22).slice(0, 22)} requests=${String(r.requests).padStart(4)} first=${String(r.firstInput).padStart(6)} input=${formatMillions(r.input).padStart(7)} cached=${String(percentOf(r.cached, r.input)).padStart(3)}% output=${String(Math.round(r.output / 1e3)).padStart(4)}k`,
    );
  }
}

function printAggregateViews(
  codex: CodexStoreReport,
  claude: ClaudeStoreReport,
  opencode: OpencodeDbReport,
  top: number,
): void {
  const c = codexStats(codex);
  printHeadline('codex', c);
  if (c.rows.length > 0) {
    printAggregate(c.rows, 'originator', 'originator');
    printAggregate(c.rows, 'model', 'model');
    printAggregate(c.rows, 'reasoning effort', 'effort');
    printAggregate(c.rows, 'working directory', 'cwd');
    const calls: Record<string, number> = {};
    const chars: Record<string, number> = {};
    for (const r of codex.rollouts) {
      for (const [k, v] of Object.entries(r.toolCalls))
        calls[k] = (calls[k] ?? 0) + v;
      for (const [k, v] of Object.entries(r.toolOutputChars))
        chars[k] = (chars[k] ?? 0) + v;
    }
    console.log('\n-- tool calls');
    for (const [k, v] of Object.entries(calls)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)) {
      console.log(
        `${String(v).padStart(6)} ${k}  output=${((chars[k] ?? 0) / 1e6).toFixed(1)}M chars`,
      );
    }
    printTopSessions('codex', c.rows, top);
  }

  const o = opencodeStats(opencode);
  printHeadline('opencode', o);
  if (o.rows.length > 0) {
    printAggregate(o.rows, 'lane kind', 'originator');
    printAggregate(o.rows, 'model', 'model');
    printTopSessions('opencode', o.rows, top);
  }

  const k = claudeStats(claude);
  printHeadline('claude', k);
  if (k.rows.length > 0) {
    printAggregate(k.rows, 'lane kind', 'originator');
    printAggregate(k.rows, 'model', 'model');
    printAggregate(k.rows, 'working directory', 'cwd');
    printTopSessions('claude', k.rows, top);
  }
}

// ---------------------------------------------------------------------------
// --lanes, --resumed, --opencode-config
// ---------------------------------------------------------------------------

/**
 * One line per vendor: Ptah lane count and the first UTC date the contract
 * marker is seen among them (G4). Exported for the spec.
 */
export function laneMarkerSummary(lanes: readonly LaneMetrics[]): string[] {
  const vendors: Vendor[] = ['codex', 'opencode', 'claude'];
  return vendors.map((vendor) => {
    const own = lanes.filter((l) => l.vendor === vendor && l.isPtahLane);
    const first = sortLanesByStart(own)[0]?.startedAt;
    return `  ${vendor.padEnd(8)} Ptah lanes=${own.length}  marker first seen=${first ? first.slice(0, 10) : '-'} (UTC, in window)`;
  });
}

function printLanes(
  codex: CodexStoreReport,
  claude: ClaudeStoreReport,
  opencode: OpencodeDbReport,
  includeAll: boolean,
): void {
  const selected: LaneMetrics[] = [
    ...codex.rollouts.map(codexLaneMetrics),
    ...opencode.sessions.map(opencodeLaneMetrics),
    ...claude.transcripts.map(claudeLaneMetrics),
  ].filter((lane) => lane.requests > 0 && (includeAll || lane.isPtahLane));
  const lanes = sortLanesByStart(selected);

  console.log(
    `\n=== lanes (${includeAll ? 'all sessions' : 'Ptah lanes only'}): ${lanes.length}`,
  );
  console.log(
    'Lane identification: contract marker (exists since 2026-09-21); earlier lanes are invisible.',
  );
  for (const line of laneMarkerSummary(selected)) console.log(line);
  console.log(LANE_TABLE_HEADER);
  for (const lane of lanes) {
    console.log(
      formatLaneRow(lane) +
        (includeAll && !lane.isPtahLane ? '  [not a lane]' : ''),
    );
  }
}

function printResumed(codex: CodexStoreReport): void {
  const resumed = codex.rollouts.filter(
    (r) => codexLaneMetrics(r).isPtahLane && r.turns >= 2,
  );
  const lanes = codex.rollouts.filter(
    (r) => codexLaneMetrics(r).isPtahLane,
  ).length;
  console.log(
    `\n=== AS6: resumed Ptah Codex lanes: ${resumed.length} of ${lanes} lanes`,
  );
  console.log(
    `${'session'.padEnd(20)} turns roleParts inResumedTurns duplicates verdict       reason`,
  );
  const verdicts: Record<string, number> = {};
  for (const r of resumed) {
    const { verdict, reason } = resumedRoleVerdict(r);
    verdicts[verdict] = (verdicts[verdict] ?? 0) + 1;
    console.log(
      `${r.id.padEnd(20)} ${String(r.turns).padStart(5)} ${String(r.role.parts).padStart(9)} ${String(r.role.partsInResumedTurns).padStart(14)} ${String(r.role.duplicateParts).padStart(10)} ${verdict.padEnd(13)} ${reason}`,
    );
  }
  console.log(
    `verdicts: ${
      Object.entries(verdicts)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ') || 'none'
    }`,
  );
}

function printOpencodeConfig(
  configDir: string,
  opencode: OpencodeDbReport,
): SkippedSource[] {
  const config = readOpencodeConfig(configDir);
  console.log(`\n=== OpenCode config: ${configDir}`);
  console.log(`files: ${config.files.join(', ') || 'none'}`);
  const lanes = opencode.sessions.filter((s) => s.hasLaneMarker);
  const calls = serverToolCalls(config.servers, lanes);
  console.log(`MCP servers declared: ${config.servers.length}`);
  for (const s of config.servers) {
    console.log(
      `  ${s.name.padEnd(24)} type=${s.type.padEnd(7)} enabled=${String(s.enabled).padEnd(5)} file=${s.file}  tool calls in Ptah lanes=${calls[s.name] ?? 0}`,
    );
  }
  console.log(`plugins declared: ${config.plugins.length}`);
  for (const p of config.plugins) console.log(`  ${p.name}  (${p.declaredIn})`);

  const toolCalls: Record<string, number> = {};
  for (const lane of lanes) {
    for (const [k, v] of Object.entries(lane.toolCalls))
      toolCalls[k] = (toolCalls[k] ?? 0) + v;
  }
  console.log(`Ptah lanes in window: ${lanes.length}; tool calls by name:`);
  for (const [k, v] of Object.entries(toolCalls).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(6)} ${k}`);
  }
  return config.skipped;
}

function printSubagents(
  claude: ClaudeStoreReport,
  filter: SubagentFilter,
): void {
  const rows = selectSubagents(claude.transcripts, filter);
  console.log(`\n=== Claude subagents: ${rows.length}`);
  console.log(SUBAGENT_TABLE_HEADER);
  for (const row of rows) console.log(formatSubagentRow(row));
  console.log('\n-- requests after > 5 min (same subagent)');
  console.log(
    `${'sent (UTC)'.padEnd(16)} ${'subagent'.padEnd(24)} ${'type'.padEnd(24)} ${'gap s'.padStart(7)} ${'cache_write'.padStart(11)} ${'cache_read'.padStart(11)}`,
  );
  for (const row of rows) {
    for (const late of row.lateRequests) {
      const sent = late.at ? late.at.slice(0, 16).replace('T', ' ') : '-';
      console.log(
        `${sent.padEnd(16)} ${row.id.padEnd(24).slice(0, 24)} ${row.agentType.padEnd(24).slice(0, 24)} ${String(late.gapSeconds).padStart(7)} ${String(late.cacheCreation).padStart(11)} ${String(late.cacheRead).padStart(11)}`,
      );
    }
  }
  console.log('\n-- summary');
  for (const line of formatSubagentSummary(summariseSubagents(rows))) {
    console.log(line);
  }
}

function printSkipped(skipped: readonly SkippedSource[]): void {
  if (skipped.length === 0) return;
  console.log('\n-- skipped sources');
  for (const s of skipped)
    console.log(`  [${s.vendor}] ${s.location}: ${s.reason}`);
}

export function main(argv: readonly string[]): void {
  const options = parseArgs(argv);
  const sinceMs = options.sinceMs ?? Date.now() - options.days * 864e5;
  const window = options.date
    ? `on ${options.date}`
    : options.sinceMs !== null
      ? `since ${new Date(options.sinceMs).toISOString()}`
      : `over the last ${options.days} days`;

  const codex = readCodexStore(
    codexSessionsDir(),
    options.date ? { date: options.date } : { modifiedSinceMs: sinceMs },
  );
  const opencode = readOpencodeDb(
    join(opencodeDataDir(), 'opencode.db'),
    options.date ? { date: options.date } : { createdSinceMs: sinceMs },
  );
  // Claude transcripts carry no start date in their path; a date run takes
  // everything modified since that day began and keeps lanes started on it.
  const claudeSince = options.date
    ? new Date(`${options.date}T00:00:00`).getTime()
    : sinceMs;
  const claudeAll = readClaudeStore(claudeProjectsDir(), claudeSince);
  const claude: ClaudeStoreReport = options.date
    ? {
        ...claudeAll,
        transcripts: claudeAll.transcripts.filter(
          (t) =>
            t.startedAt !== null &&
            localDate(Date.parse(t.startedAt)) === options.date,
        ),
      }
    : claudeAll;

  const skipped: SkippedSource[] = [
    ...codex.skipped,
    ...opencode.skipped,
    ...claude.skipped,
  ];
  console.log(`Agent usage ${window}`);

  const anyMode =
    options.lanes ||
    options.resumed ||
    options.opencodeConfig ||
    options.subagents;
  if (!anyMode) {
    console.log(
      'Every tool call resends the thread: cost tracks requests x context, not session count.',
    );
    printAggregateViews(codex, claude, opencode, options.top);
  }
  if (options.lanes) printLanes(codex, claude, opencode, options.all);
  if (options.resumed) printResumed(codex);
  if (options.opencodeConfig)
    skipped.push(...printOpencodeConfig(opencodeConfigDir(), opencode));
  if (options.subagents) {
    printSubagents(claude, {
      sinceMs: options.sinceMs ?? undefined,
      untilMs: options.untilMs ?? undefined,
      sessions: options.sessions ?? undefined,
    });
  }
  printSkipped(skipped);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
