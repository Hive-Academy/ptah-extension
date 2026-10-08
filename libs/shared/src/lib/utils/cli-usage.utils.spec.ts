import type { CliOutputSegment } from '../types/agent-process.types';
import {
  addCliUsage,
  hasReportedCliCacheTokens,
  type CliUsageTotals,
} from './cli-usage.utils';

/** Fold a whole segment list, as `extractCliAgentStats` does today. */
function foldAll(
  segments: readonly CliOutputSegment[],
  start: CliUsageTotals | null = null,
): CliUsageTotals | null {
  return segments.reduce<CliUsageTotals | null>(
    (total, segment) => addCliUsage(total, segment.usage),
    start,
  );
}

function info(usage?: CliOutputSegment['usage']): CliOutputSegment {
  return { type: 'info', content: '', usage };
}

/** Codex adapter shape: content and typed usage always carry both counts. */
function codexTurn(input: number, output: number): CliOutputSegment {
  return {
    type: 'info',
    content: `Usage: ${input} input, ${output} output tokens`,
    usage: { inputTokens: input, outputTokens: output },
  };
}

// Oracle: the cases below are ported from the agent-card
// `stats-bar.utils.spec.ts` and `stats-accumulation.spec.ts` for
// `extractCliAgentStats`, whose fold this function now owns.
describe('addCliUsage (stats-bar oracle cases)', () => {
  it('sums per-turn token counts and retains the latest reported model, cost and duration', () => {
    expect(
      foldAll([
        info({
          model: 'first-model',
          inputTokens: 100,
          outputTokens: 20,
          costUsd: 0.1,
          durationMs: 500,
        }),
        info({
          model: 'latest-model',
          inputTokens: 50,
          outputTokens: 0,
          costUsd: 0,
          durationMs: 0,
        }),
        info({ outputTokens: 3 }),
      ]),
    ).toEqual({
      model: 'latest-model',
      inputTokens: 150,
      outputTokens: 23,
      costUsd: 0,
      durationMs: 0,
    });
  });

  it('does not infer stats from human-readable text', () => {
    expect(
      foldAll([
        {
          type: 'info',
          content: 'Usage: model: old, 123 input, 456 output, $1.0000, 3.5s',
        },
      ]),
    ).toBeNull();
  });

  it('preserves absent fields and accumulates total-only usage', () => {
    expect(
      foldAll([info({ totalTokens: 100 }), info({ totalTokens: 200 })]),
    ).toEqual({ totalTokens: 300 });
    expect(foldAll([info({ model: 'model-only' })])).toEqual({
      model: 'model-only',
    });
    expect(foldAll([info({})])).toBeNull();
    expect(foldAll([])).toBeNull();
  });

  it('accumulates adapter-shaped multi-turn token counts', () => {
    expect(foldAll([codexTurn(100, 50), codexTurn(200, 30)])).toEqual({
      inputTokens: 300,
      outputTokens: 80,
    });
  });

  it('preserves accumulated counts when the next turn reports zero', () => {
    expect(foldAll([codexTurn(100, 50), codexTurn(0, 0)])).toEqual({
      inputTokens: 100,
      outputTokens: 50,
    });
  });

  it('keeps the latest reported model, cost and duration', () => {
    expect(
      foldAll([
        info({
          model: 'first-model',
          inputTokens: 100,
          outputTokens: 50,
          costUsd: 0.1,
          durationMs: 1500,
        }),
        info({
          model: 'latest-model',
          inputTokens: 10,
          outputTokens: 5,
          costUsd: 0.02,
          durationMs: 500,
        }),
      ]),
    ).toEqual({
      model: 'latest-model',
      inputTokens: 110,
      outputTokens: 55,
      durationMs: 500,
      costUsd: 0.02,
    });
  });

  it('accumulates one-sided turns without inventing missing values', () => {
    expect(
      foldAll([
        info({ inputTokens: 100, outputTokens: 50, costUsd: 0.1 }),
        info({ outputTokens: 25 }),
      ]),
    ).toEqual({ inputTokens: 100, outputTokens: 75, costUsd: 0.1 });
  });

  it('keeps reported totals separate from split counts', () => {
    expect(
      foldAll([
        info({ totalTokens: 1000 }),
        info({ inputTokens: 400, outputTokens: 100, totalTokens: 500 }),
      ]),
    ).toEqual({ totalTokens: 1500, inputTokens: 400, outputTokens: 100 });
  });

  it('sums reported cache reads and writes while keeping the latest context', () => {
    expect(
      foldAll([
        info({
          inputTokens: 100,
          cacheReadTokens: 80,
          cacheWriteTokens: 20,
          contextTokens: 200,
        }),
        info({ inputTokens: 50, cacheReadTokens: 40, contextTokens: 250 }),
      ]),
    ).toEqual({
      inputTokens: 150,
      cacheReadTokens: 120,
      cacheWriteTokens: 20,
      contextTokens: 250,
    });
  });
});

describe('addCliUsage (incremental fold)', () => {
  const segments: CliOutputSegment[] = [
    info({ model: 'a', inputTokens: 10, outputTokens: 1, costUsd: 0.01 }),
    { type: 'text', content: 'no usage here' },
    info({}),
    info({ totalTokens: 7 }),
    info({ model: 'b', inputTokens: 5, durationMs: 900 }),
    info({ outputTokens: 4, costUsd: 0.03 }),
  ];

  it('returns the running total unchanged for a segment without usage', () => {
    const total: CliUsageTotals = { inputTokens: 3 };
    expect(addCliUsage(total, undefined)).toBe(total);
    expect(addCliUsage(total, {})).toBe(total);
    expect(addCliUsage(null, undefined)).toBeNull();
  });

  it('does not mutate the running total', () => {
    const total: CliUsageTotals = { inputTokens: 3 };
    addCliUsage(total, { inputTokens: 2 });
    expect(total).toEqual({ inputTokens: 3 });
  });

  it.each([1, 2, 3, 4, 5])(
    'folding before a cap at %i segments equals folding the full list',
    (cut) => {
      // A store folds early segments, then drops them; the totals carried
      // forward must match a fold over every segment ever seen.
      const carried = foldAll(segments.slice(0, cut));
      expect(foldAll(segments.slice(cut), carried)).toEqual(foldAll(segments));
    },
  );

  it('is order-sensitive only for the latest-wins fields', () => {
    const forward = foldAll(segments);
    const reversed = foldAll([...segments].reverse());
    expect(forward).toEqual({
      model: 'b',
      inputTokens: 15,
      outputTokens: 5,
      totalTokens: 7,
      costUsd: 0.03,
      durationMs: 900,
    });
    expect(reversed).toEqual({
      model: 'a',
      inputTokens: 15,
      outputTokens: 5,
      totalTokens: 7,
      costUsd: 0.01,
      durationMs: 900,
    });
  });
});

describe('hasReportedCliCacheTokens', () => {
  it('reports only fields a provider actually supplied', () => {
    expect(hasReportedCliCacheTokens(null)).toBe(false);
    expect(hasReportedCliCacheTokens({ inputTokens: 10 })).toBe(false);
    expect(hasReportedCliCacheTokens({ cacheReadTokens: 0 })).toBe(true);
    expect(hasReportedCliCacheTokens({ cacheWriteTokens: 0 })).toBe(true);
  });
});
