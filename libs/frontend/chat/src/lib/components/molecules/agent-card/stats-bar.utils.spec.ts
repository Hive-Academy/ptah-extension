import { extractCliAgentStats, isUsageSegment } from './stats-bar.utils';

describe('typed CLI usage statistics', () => {
  it.each(['text', 'tool-result', 'command'] as const)(
    'does not filter a content-bearing %s segment carrying usage',
    (type) => {
      expect(
        isUsageSegment({
          type,
          content: 'Keep this output',
          usage: { outputTokens: 1 },
        }),
      ).toBe(false);
    },
  );
  it('sums per-turn token counts and retains the latest reported model, cost and duration', () => {
    expect(
      extractCliAgentStats([
        {
          type: 'info',
          content: 'first',
          usage: {
            model: 'first-model',
            inputTokens: 100,
            outputTokens: 20,
            costUsd: 0.1,
            durationMs: 500,
          },
        },
        {
          type: 'info',
          content: 'second',
          usage: {
            model: 'latest-model',
            inputTokens: 50,
            outputTokens: 0,
            costUsd: 0,
            durationMs: 0,
          },
        },
        { type: 'info', content: 'third', usage: { outputTokens: 3 } },
      ]),
    ).toEqual({
      model: 'latest-model',
      inputTokens: 150,
      outputTokens: 23,
      costUsd: 0,
      durationMs: 0,
    });
  });

  it('does not infer stats or filter a segment from human-readable text', () => {
    const segment = {
      type: 'info' as const,
      content: 'Usage: model: old, 123 input, 456 output, $1.0000, 3.5s',
    };
    expect(extractCliAgentStats([segment])).toBeNull();
    expect(isUsageSegment(segment)).toBe(false);
    expect(
      isUsageSegment({
        ...segment,
        content: 'Localized usage',
        usage: { inputTokens: 0 },
      }),
    ).toBe(true);
  });

  it('preserves absent fields and accumulates total-only usage', () => {
    expect(
      extractCliAgentStats([
        { type: 'info', content: '', usage: { totalTokens: 100 } },
        { type: 'info', content: '', usage: { totalTokens: 200 } },
      ]),
    ).toEqual({ totalTokens: 300 });
    expect(
      extractCliAgentStats([
        { type: 'info', content: '', usage: { model: 'model-only' } },
      ]),
    ).toEqual({ model: 'model-only' });
    expect(
      extractCliAgentStats([{ type: 'info', content: '', usage: {} }]),
    ).toBeNull();
    expect(extractCliAgentStats([])).toBeNull();
  });
});
