import type { McpToolCaller, ToolCallOutcome } from '../transport/mcp-client';
import {
  askAfterIndexSettle,
  CODE_INDEX_SETTLE_ABORT_CONSECUTIVE_ERRORS,
  CODE_INDEX_SETTLE_TIMEOUT_MS,
  type IndexBackedRun,
  waitForIndexSettle,
} from './index-settle';
import { RealStateChangedError } from '../transport/real-state-guard';

const ROOT = 'D:/corpus';

function answer(
  reindexInFlight: boolean,
  symbolCount: number,
  coverage: object = { clean: true, indexed: symbolCount },
): ToolCallOutcome {
  return {
    kind: 'result',
    isError: false,
    wallMs: 1,
    text: JSON.stringify({
      index: { reindexInFlight, symbolCount },
      coverage,
      hits: [],
    }),
  };
}

function transportError(code = 'ECONNRESET'): ToolCallOutcome {
  return { kind: 'transport-error', code, detail: 'connection reset', wallMs: 1 };
}

function rpcError(code = -32001): ToolCallOutcome {
  return { kind: 'rpc-error', code, message: 'host busy', wallMs: 1 };
}

function toolError(): ToolCallOutcome {
  return { kind: 'result', isError: true, text: 'tool failed', wallMs: 1 };
}

function unavailable(): ToolCallOutcome {
  return {
    kind: 'result',
    isError: false,
    text: JSON.stringify({ status: 'unavailable', message: 'index unavailable' }),
    wallMs: 1,
  };
}

function building(): ToolCallOutcome {
  return {
    kind: 'result',
    isError: false,
    text: JSON.stringify({ status: 'building', index: { symbolCount: 12 } }),
    wallMs: 1,
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

  it('does not settle on an idle empty index before accepting a populated one', async () => {
    const { deps } = fakeDeps();
    const measurement = await waitForIndexSettle(
      caller([answer(false, 0), answer(false, 12)]),
      ROOT,
      { name: 'probe', file: 'libs/probe.ts' },
      deps,
    );

    expect(measurement).toMatchObject({
      settled: true,
      symbolCount: 12,
      elapsedMs: 5_000,
    });
  });

  it('does not settle while coverage is unknown', async () => {
    const { deps } = fakeDeps();
    const measurement = await waitForIndexSettle(
      caller([
        answer(false, 12, { census: 'unknown', reasons: ['coverage?'] }),
        answer(false, 12),
      ]),
      ROOT,
      { name: 'probe', file: 'libs/probe.ts' },
      deps,
    );

    expect(measurement).toMatchObject({ settled: true, elapsedMs: 5_000 });
    expect(measurement.states[0]).toContain('unknown-coverage');
  });

  it('keeps waiting while coverage says updating', async () => {
    const { deps } = fakeDeps();
    const measurement = await waitForIndexSettle(
      caller([
        answer(false, 12, { clean: false, reasons: ['updating'] }),
        answer(false, 12),
      ]),
      ROOT,
      { name: 'probe', file: 'libs/probe.ts' },
      deps,
    );

    expect(measurement).toMatchObject({ settled: true, elapsedMs: 5_000 });
  });

  it('settles a finished index with stale coverage', async () => {
    const { deps } = fakeDeps();
    const measurement = await waitForIndexSettle(
      caller([answer(false, 12, { clean: false, reasons: ['stale'] })]),
      ROOT,
      { name: 'probe', file: 'libs/probe.ts' },
      deps,
    );

    expect(measurement).toMatchObject({
      settled: true,
      elapsedMs: 0,
      coverage: '{"clean":false,"reasons":["stale"]}',
    });
  });

  it('settles a finished index with a persistent partial-coverage reason', async () => {
    const { deps } = fakeDeps();
    const measurement = await waitForIndexSettle(
      caller([
        answer(false, 12, {
          census: 'complete',
          clean: false,
          reasons: ['failed?'],
        }),
      ]),
      ROOT,
      { name: 'probe', file: 'libs/probe.ts' },
      deps,
    );

    expect(measurement).toMatchObject({ settled: true, elapsedMs: 0 });
  });

  it.each([
    ['transport', transportError],
    ['rpc', rpcError],
    ['tool-error', toolError],
    ['unavailable', unavailable],
  ] as const)('aborts after six consecutive %s replies', async (kind, reply) => {
    const { deps } = fakeDeps();
    const runs: IndexBackedRun[] = [
      { definition: { tool: 'ptah_code_search_symbols' } },
    ];
    await askAfterIndexSettle(
      runs,
      new Set(['ptah_code_search_symbols']),
      caller(
        Array.from(
          { length: CODE_INDEX_SETTLE_ABORT_CONSECUTIVE_ERRORS },
          () => reply(),
        ),
      ),
      ROOT,
      { name: 'probe', file: 'libs/probe.ts' },
      deps,
      async () => undefined,
    );

    expect(runs[0].indexSettle).toMatchObject({
      settled: false,
      aborted: true,
      abortKind: kind,
    });
    expect(runs[0].failure).toBe(
      'the code index wait aborted after repeated error replies before scoring',
    );
    expect(runs[0].indexSettle?.elapsedMs).toBe(25_000);
  });

  it('resets the error counter after a good reply', async () => {
    const { deps } = fakeDeps();
    const measurement = await waitForIndexSettle(
      caller([
        ...Array.from(
          { length: CODE_INDEX_SETTLE_ABORT_CONSECUTIVE_ERRORS - 1 },
          () => transportError(),
        ),
        answer(true, 12),
        ...Array.from(
          { length: CODE_INDEX_SETTLE_ABORT_CONSECUTIVE_ERRORS - 1 },
          () => transportError(),
        ),
        answer(false, 12),
      ]),
      ROOT,
      { name: 'probe', file: 'libs/probe.ts' },
      deps,
    );

    expect(measurement).toMatchObject({ settled: true, aborted: false });
  });

  it('does not abort for a reply that is still building', async () => {
    const { deps } = fakeDeps();
    const measurement = await waitForIndexSettle(
      caller([
        ...Array.from(
          { length: CODE_INDEX_SETTLE_ABORT_CONSECUTIVE_ERRORS - 1 },
          () => transportError(),
        ),
        building(),
        answer(false, 12),
      ]),
      ROOT,
      { name: 'probe', file: 'libs/probe.ts' },
      deps,
    );

    expect(measurement).toMatchObject({ settled: true, aborted: false });
  });

  it('rethrows a guard error from the settle probe unchanged', async () => {
    const { deps } = fakeDeps();
    const guard = new RealStateChangedError(
      { takenAt: 'before', files: [] },
      { takenAt: 'after', files: [] },
      ['state.db'],
    );
    await expect(
      waitForIndexSettle(
        { callTool: async () => Promise.reject(guard) },
        ROOT,
        { name: 'probe', file: 'libs/probe.ts' },
        deps,
      ),
    ).rejects.toBe(guard);
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
      'the code index did not settle within 1200 s before scoring',
    );
    expect(runs[0].indexSettle).toMatchObject({
      settled: false,
      elapsedMs: expect.any(Number),
    });
    expect(runs[0].indexSettle?.elapsedMs).toBeLessThanOrEqual(
      CODE_INDEX_SETTLE_TIMEOUT_MS,
    );
    expect(asked).toEqual(['ptah_search_text']);
  });

  it('does not poll when the index tool is not listed', async () => {
    const { deps } = fakeDeps();
    const runs: IndexBackedRun[] = [
      { definition: { tool: 'ptah_code_search_symbols' } },
    ];
    const asked: string[] = [];
    await askAfterIndexSettle(
      runs,
      new Set(),
      { callTool: async () => Promise.reject(new Error('should not poll')) },
      ROOT,
      { name: 'probe' },
      deps,
      async (run) => {
        asked.push(run.definition.tool);
      },
    );

    expect(asked).toEqual(['ptah_code_search_symbols']);
    expect(runs[0].indexSettle).toBeUndefined();
  });

  it('preserves an existing failure while settling another index suite', async () => {
    const { deps } = fakeDeps();
    const runs: IndexBackedRun[] = [
      {
        definition: { tool: 'ptah_code_search_symbols' },
        failure: 'native baseline broke',
      },
      { definition: { tool: 'ptah_code_search_symbols' } },
    ];
    await askAfterIndexSettle(
      runs,
      new Set(['ptah_code_search_symbols']),
      caller(
        Array.from(
          { length: CODE_INDEX_SETTLE_ABORT_CONSECUTIVE_ERRORS },
          () => transportError(),
        ),
      ),
      ROOT,
      { name: 'probe' },
      deps,
      async (run) => {
        throw new Error(`should not ask ${run.definition.tool}`);
      },
    );

    expect(runs[0].failure).toBe('native baseline broke');
    expect(runs[0].indexSettle).toBeUndefined();
    expect(runs[1].failure).toBe(
      'the code index wait aborted after repeated error replies before scoring',
    );
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
