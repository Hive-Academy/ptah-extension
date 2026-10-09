import type { McpToolCaller, ToolCallOutcome } from '../transport/mcp-client';
import {
  askAfterIndexSettle,
  CODE_INDEX_SETTLE_TIMEOUT_MS,
  type IndexBackedRun,
  waitForIndexSettle,
} from './index-settle';

const ROOT = 'D:/corpus';

function answer(
  reindexInFlight: boolean,
  symbolCount: number,
): ToolCallOutcome {
  return {
    kind: 'result',
    isError: false,
    wallMs: 1,
    text: JSON.stringify({
      index: { reindexInFlight, symbolCount },
      coverage: { clean: true, indexed: symbolCount },
      hits: [],
    }),
  };
}

function caller(outcomes: readonly ToolCallOutcome[]): McpToolCaller {
  let index = 0;
  return {
    callTool: async () => outcomes[Math.min(index++, outcomes.length - 1)],
  };
}

function fakeDeps() {
  let now = 0;
  const logs: string[] = [];
  return {
    deps: {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
      log: (line: string) => logs.push(line),
    },
    logs,
  };
}

describe('index settle', () => {
  it('waits for reindexInFlight false and captures the settled measurement', async () => {
    const { deps, logs } = fakeDeps();
    const measurement = await waitForIndexSettle(
      caller([answer(true, 7), answer(false, 12)]),
      ROOT,
      { name: 'probe', file: 'libs/probe.ts' },
      deps,
    );

    expect(measurement).toMatchObject({
      settled: true,
      elapsedMs: 5_000,
      symbolCount: 12,
      coverage: '{"clean":true,"indexed":12}',
    });
    expect(logs.at(-1)).toContain('settled after 5 s (12 symbols)');
  });

  it('marks only index-backed runs failed and does not ask them after timeout', async () => {
    const { deps } = fakeDeps();
    const runs: IndexBackedRun[] = [
      { definition: { tool: 'ptah_code_search_symbols' } },
      { definition: { tool: 'ptah_search_text' } },
    ];
    const asked: string[] = [];
    await askAfterIndexSettle(
      runs,
      new Set(['ptah_code_search_symbols', 'ptah_search_text']),
      caller([answer(true, 99)]),
      ROOT,
      { name: 'probe', file: 'libs/probe.ts' },
      deps,
      async (run) => {
        asked.push(run.definition.tool);
      },
    );

    expect(runs[0].failure).toBe(
      'the code index did not settle within 1200 s (symbolCount 99, reindexInFlight still true); scoring a partial index would measure indexing speed, not search',
    );
    expect(runs[0].indexSettle).toMatchObject({
      settled: false,
      elapsedMs: CODE_INDEX_SETTLE_TIMEOUT_MS,
    });
    expect(asked).toEqual(['ptah_search_text']);
  });

  it('leaves non-index suites untouched and does not poll when none are selected', async () => {
    const { deps } = fakeDeps();
    const runs: IndexBackedRun[] = [
      { definition: { tool: 'ptah_search_text' } },
    ];
    const asked: string[] = [];
    await askAfterIndexSettle(
      runs,
      new Set(['ptah_code_search_symbols', 'ptah_search_text']),
      {
        callTool: async () => {
          throw new Error('should not poll');
        },
      },
      ROOT,
      { name: 'probe' },
      deps,
      async (run) => {
        asked.push(run.definition.tool);
      },
    );

    expect(asked).toEqual(['ptah_search_text']);
    expect(runs[0].indexSettle).toBeUndefined();
  });
});
