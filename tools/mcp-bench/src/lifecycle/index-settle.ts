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
  readonly elapsedMs: number;
  readonly symbolCount: number | null;
  readonly coverage: string;
  readonly states: readonly string[];
}

export type IndexSettleDeps = Pick<LifecycleDeps, 'sleep' | 'now' | 'log'>;

export interface IndexBackedRun {
  readonly definition: { readonly tool: string };
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
  const settled = await pollUntil(
    deps,
    CODE_INDEX_SETTLE_TIMEOUT_MS,
    () => searchSymbol(caller, root, probe.name, probe.file ?? ''),
    (result) => /"reindexInFlight"\s*:\s*false/.test(result.text),
  );
  const measurement: IndexSettleMeasurement = {
    settled: settled.ok,
    elapsedMs: settled.elapsedMs,
    symbolCount: symbolCountOf(settled.last.text),
    coverage: coverageOf(settled.last.text),
    states: settled.states,
  };
  deps.log(
    measurement.settled
      ? `[index] settled after ${Math.round(measurement.elapsedMs / 1000)} s (${measurement.symbolCount ?? 'unknown'} symbols)`
      : `[index] did not settle within ${CODE_INDEX_SETTLE_TIMEOUT_MS / 1000} s (${measurement.symbolCount ?? 'unknown'} symbols)`,
  );
  return measurement;
}

export function indexSettleFailure(
  measurement: IndexSettleMeasurement,
): string {
  return `the code index did not settle within ${CODE_INDEX_SETTLE_TIMEOUT_MS / 1000} s (symbolCount ${measurement.symbolCount ?? 'unknown'}, reindexInFlight still true); scoring a partial index would measure indexing speed, not search`;
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
  const indexRuns = runs.filter((run) =>
    isIndexBackedTool(run.definition.tool),
  );
  if (indexRuns.length > 0 && listedTools.has('ptah_code_search_symbols')) {
    const measurement = await waitForIndexSettle(caller, root, probe, deps);
    for (const run of indexRuns) {
      run.indexSettle = measurement;
      if (!measurement.settled) run.failure = indexSettleFailure(measurement);
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
