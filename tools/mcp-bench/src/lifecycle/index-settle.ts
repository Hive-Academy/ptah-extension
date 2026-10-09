import { coverageOf } from './lifecycle-na';
import { pollUntil, searchSymbol } from './lifecycle-probe';
import type { LifecycleDeps, ProbeSymbol } from './lifecycle-scenarios';
import type { McpToolCaller } from '../transport/mcp-client';

/** Do not score a partial code-symbol index; slow indexing is reported separately. */
export const CODE_INDEX_SETTLE_TIMEOUT_MS = 20 * 60_000;

/** The only suite tool backed by the asynchronously-built code-symbol index. */
export const INDEX_BACKED_TOOLS = new Set(['ptah_code_search_symbols']);

export interface IndexSettleMeasurement {
  readonly settled: boolean;
  /** The poll stopped after repeated transport, RPC, or tool errors. */
  readonly aborted: boolean;
  /** Stable error class for an early-aborted wait, when applicable. */
  readonly abortKind: 'transport' | 'rpc' | 'tool-error' | null;
  readonly elapsedMs: number;
  readonly symbolCount: number | null;
  readonly coverage: string;
  readonly states: readonly string[];
  /** The final raw probe state, retained for diagnosis rather than gating. */
  readonly lastState: string;
}

export type IndexSettleDeps = Pick<LifecycleDeps, 'sleep' | 'now' | 'log'>;

export interface IndexBackedRun {
  readonly definition: { readonly tool: string; readonly naReason?: string };
  failure?: string;
  indexSettle?: IndexSettleMeasurement;
}

export function isIndexBackedTool(tool: string): boolean {
  return INDEX_BACKED_TOOLS.has(tool);
}

/** Poll one real symbol until the code index reports that its reindex is complete. */
export async function waitForIndexSettle(
  caller: McpToolCaller,
  root: string,
  probe: Pick<ProbeSymbol, 'name'> & { readonly file?: string },
  deps: IndexSettleDeps,
): Promise<IndexSettleMeasurement> {
  deps.log('[index] waiting for the code index to settle before scoring');
  let consecutiveErrors = 0;
  let abortKind: IndexSettleMeasurement['abortKind'] = null;
  const settled = await pollUntil(
    deps,
    CODE_INDEX_SETTLE_TIMEOUT_MS,
    () => searchSymbol(caller, root, probe.name, probe.file ?? ''),
    isSettledProbe,
    (result) => {
      const kind = retryableErrorKind(result.state);
      if (kind === null) {
        consecutiveErrors = 0;
        return false;
      }
      consecutiveErrors += 1;
      abortKind = kind;
      return consecutiveErrors >= 3;
    },
  );
  const measurement: IndexSettleMeasurement = {
    settled: settled.ok,
    aborted: settled.aborted,
    abortKind: settled.aborted ? abortKind : null,
    elapsedMs: settled.elapsedMs,
    symbolCount: symbolCountOf(settled.last.text),
    coverage: coverageOf(settled.last.text),
    states: settled.states,
    lastState: settled.last.state,
  };
  deps.log(
    measurement.settled
      ? `[index] settled after ${Math.round(measurement.elapsedMs / 1000)} s (${measurement.symbolCount ?? 'unknown'} symbols)`
      : measurement.aborted
        ? `[index] wait aborted after repeated ${measurement.abortKind} errors (${measurement.lastState})`
        : `[index] did not settle within ${CODE_INDEX_SETTLE_TIMEOUT_MS / 1000} s (${unsettledDescription(measurement)})`,
  );
  return measurement;
}

export function indexSettleFailure(
  measurement: IndexSettleMeasurement,
): string {
  if (measurement.aborted)
    return `the code index wait aborted after repeated transport errors (${measurement.abortKind ?? 'unknown'})`;
  return `the code index did not settle within ${CODE_INDEX_SETTLE_TIMEOUT_MS / 1000} s before scoring`;
}

/**
 * Wait at most once per host, then ask only runs that can be scored fairly.
 * The callback keeps suite transport ownership with the runner while making
 * the settle/skip policy independently testable.
 */
export async function askAfterIndexSettle<R extends IndexBackedRun>(
  runs: readonly R[],
  listedTools: ReadonlySet<string>,
  caller: McpToolCaller,
  root: string,
  probe: Pick<ProbeSymbol, 'name'> & { readonly file?: string },
  deps: IndexSettleDeps,
  ask: (run: R) => Promise<void>,
): Promise<void> {
  const indexRuns = runs.filter(
    (run) =>
      isIndexBackedTool(run.definition.tool) &&
      run.failure === undefined &&
      run.definition.naReason === undefined,
  );
  if (indexRuns.length > 0 && listedTools.has('ptah_code_search_symbols')) {
    const measurement = await waitForIndexSettle(caller, root, probe, deps);
    for (const run of indexRuns) {
      run.indexSettle = measurement;
      if (!measurement.settled) run.failure ??= indexSettleFailure(measurement);
    }
  }
  for (const run of runs)
    if (!(
      isIndexBackedTool(run.definition.tool) &&
      run.indexSettle?.settled === false
    ))
      await ask(run);
}

function symbolCountOf(text: string): number | null {
  const value = /"symbolCount"\s*:\s*(\d+)/.exec(text)?.[1];
  return value === undefined ? null : Number(value);
}

/** A settled index has results, a normal response, and no unresolved coverage. */
function isSettledProbe(probe: Awaited<ReturnType<typeof searchSymbol>>): boolean {
  const symbolCount = symbolCountOf(probe.text);
  const coverage = coverageOf(probe.text);
  return (
    !probe.errored &&
    !probe.underUnknownCoverage &&
    /"reindexInFlight"\s*:\s*false/.test(probe.text) &&
    symbolCount !== null &&
    symbolCount > 0 &&
    !/\b(?:updating|stale)\b/i.test(coverage)
  );
}

function retryableErrorKind(
  state: string,
): IndexSettleMeasurement['abortKind'] {
  if (state.startsWith('transport ')) return 'transport';
  if (state.startsWith('rpc ')) return 'rpc';
  if (state.startsWith('tool-error')) return 'tool-error';
  return null;
}

function unsettledDescription(measurement: IndexSettleMeasurement): string {
  if (/unknown-coverage/.test(measurement.lastState)) return 'coverage unknown';
  if (/\b(?:updating|stale)\b/i.test(measurement.coverage))
    return 'coverage updating or stale';
  if (measurement.symbolCount === null) return 'index did not report a symbol count';
  if (measurement.symbolCount === 0) return 'index reported 0 symbols';
  if (/reindexInFlight\s*:\s*true/.test(measurement.lastState))
    return 'reindex still in flight';
  return `last state ${measurement.lastState}`;
}
