/**
 * Probing helpers of the lifecycle scenarios (one `ptah_code_search_symbols`
 * call, the 5 s poll loop) and scenario 6, index age beyond 24 h. Split from
 * `lifecycle-scenarios.ts` (700-line ceiling); the shared types come from
 * there as type-only imports.
 */

import { stat } from 'node:fs/promises';

import { classifyToolResult } from '../transport/call-recorder';
import type { McpToolCaller, ToolCallOutcome } from '../transport/mcp-client';
import { ToolResultParseError } from '../suites/suite-runner';
import { parseSymbolHits } from '../suites/tool-results';
import { coverageOf } from './lifecycle-na';
import type {
  BenchSession,
  LifecycleDeps,
  LifecycleOptions,
  LifecycleResult,
} from './lifecycle-scenarios';

const HOUR_MS = 3_600_000;
const POLL_MS = 5_000;
/** Index age the scenario backdates to: beyond the 24 h staleness rule. */
const BACKDATE_MS = 25 * HOUR_MS;

export interface SymbolProbe {
  readonly found: boolean;
  readonly errored: boolean;
  readonly state: string;
  readonly text: string;
  readonly hits: number;
}

/** One `ptah_code_search_symbols` call: is `name` in a hit of `file`? */
export async function searchSymbol(
  caller: McpToolCaller,
  root: string,
  name: string,
  file: string,
): Promise<SymbolProbe> {
  const outcome = await caller.callTool('ptah_code_search_symbols', {
    query: name,
    maxResults: 10,
  });
  if (outcome.kind !== 'result')
    return {
      found: false,
      errored: true,
      state: describeOutcome(outcome),
      text: '',
      hits: 0,
    };
  const classified = classifyToolResult(outcome.text, outcome.isError, root);
  const index = /"index"\s*:\s*\{([^}]*)\}/.exec(outcome.text)?.[1] ?? '';
  const state = `${classified.errorClass ?? 'ok'}${index ? ` {${index}}` : ''}`;
  if (classified.errorClass !== null)
    return { found: false, errored: true, state, text: outcome.text, hits: 0 };
  try {
    const answer = parseSymbolHits(outcome.text, root, [], true);
    return {
      found: answer.ranked.includes(file),
      errored: false,
      state,
      text: outcome.text,
      hits: answer.ranked.length,
    };
  } catch (error: unknown) {
    if (!(error instanceof ToolResultParseError)) throw error;
    return {
      found: false,
      errored: true,
      state: `parse: ${error.message}`,
      text: outcome.text,
      hits: 0,
    };
  }
}

export function describeOutcome(outcome: ToolCallOutcome): string {
  if (outcome.kind === 'transport-error') return `transport ${outcome.code}`;
  if (outcome.kind === 'rpc-error')
    return `rpc ${outcome.code}: ${outcome.message}`;
  return outcome.isError ? 'tool-error' : 'result';
}

/** Polls `check` every 5 s until it holds or `timeoutMs` passes. */
export async function pollUntil(
  deps: LifecycleDeps,
  timeoutMs: number,
  check: () => Promise<SymbolProbe>,
  want: (probe: SymbolProbe) => boolean,
): Promise<{
  ok: boolean;
  elapsedMs: number;
  states: string[];
  last: SymbolProbe;
  /** Poll time at which `reindexInFlight: false` was first seen (the index time), or `null`. */
  settledAtMs: number | null;
}> {
  const started = deps.now();
  const states: string[] = [];
  let settledAtMs: number | null = null;
  for (;;) {
    const probe = await check();
    if (!states.includes(probe.state)) states.push(probe.state);
    const elapsedMs = deps.now() - started;
    if (
      settledAtMs === null &&
      /"reindexInFlight"\s*:\s*false/.test(probe.text)
    )
      settledAtMs = elapsedMs;
    if (want(probe))
      return { ok: true, elapsedMs, states, last: probe, settledAtMs };
    if (elapsedMs + POLL_MS > timeoutMs)
      return { ok: false, elapsedMs, states, last: probe, settledAtMs };
    await deps.sleep(POLL_MS);
  }
}

export const states = (list: readonly string[]): string =>
  list.slice(0, 4).join(' | ') +
  (list.length > 4 ? ` (+${list.length - 4} more)` : '');

export async function indexAgeScenario(
  session: BenchSession,
  root: string,
  deps: LifecycleDeps,
  options: LifecycleOptions,
  refreshMs: number,
  probeFile: string,
): Promise<LifecycleResult> {
  const tool = 'ptah_code_search_symbols';
  if (session.dbPath === null)
    return {
      scenario: 'index-age-24h',
      tool,
      pass: false,
      detail: 'the host exposes no isolated DB path; rows cannot be backdated',
    };
  // Backdate only a settled index: rows a running reindex is still writing
  // would come back fresh and the scenario would measure a new index.
  const settle = await pollUntil(
    deps,
    refreshMs,
    () => searchSymbol(session.client, root, options.probe.name, probeFile),
    (probe) => /"reindexInFlight"\s*:\s*false/.test(probe.text),
  );
  if (!settle.ok)
    return {
      scenario: 'index-age-24h',
      tool,
      pass: false,
      detail: `the index never settled: reindexInFlight still true after ${refreshMs / 1000} s, so rows were not backdated (a fresh index would be measured instead); states: ${states(settle.states)}`,
    };
  const changed = await deps.backdateCodeSymbols(session.dbPath, BACKDATE_MS);
  const first = await searchSymbol(
    session.client,
    root,
    options.probe.name,
    probeFile,
  );
  const age = Number(
    /"indexAgeMs"\s*:\s*(\d+)/.exec(first.text)?.[1] ?? Number.NaN,
  );
  const started =
    /"reindexStarted"\s*:\s*true/.test(first.text) ||
    /"reindexInFlight"\s*:\s*true/.test(first.text);
  const refresh = await pollUntil(
    deps,
    refreshMs,
    () => searchSymbol(session.client, root, options.probe.name, probeFile),
    (probe) => /"reindexInFlight"\s*:\s*false/.test(probe.text),
  );
  const count = /"symbolCount"\s*:\s*(\d+)/.exec(refresh.last.text)?.[1] ?? '?';
  const dbBytes = await stat(session.dbPath)
    .then((file) => file.size)
    .catch(() => null);
  const pass =
    changed > 0 &&
    age > 24 * HOUR_MS &&
    started &&
    refresh.ok &&
    refresh.last.found;
  return {
    scenario: 'index-age-24h',
    tool,
    pass,
    detail: `index settled after ${settle.elapsedMs} ms (DB ${dbBytes === null ? 'size unknown' : `${(dbBytes / 1_048_576).toFixed(1)} MiB`}, ${/"symbolCount"\s*:\s*(\d+)/.exec(settle.last.text)?.[1] ?? '?'} symbols; coverage ${coverageOf(settle.last.text)}); ${changed} rows backdated 25 h; first answer indexAgeMs ${Number.isNaN(age) ? '?' : age}, refresh ${started ? 'started' : 'not started'}; ${refresh.ok ? `refresh done after ${refresh.elapsedMs} ms, symbolCount ${count}, ${options.probe.name} ${refresh.last.found ? 'found' : 'missing (cap or skip)'}` : `refresh not done within ${refreshMs / 1000} s`}`,
  };
}
