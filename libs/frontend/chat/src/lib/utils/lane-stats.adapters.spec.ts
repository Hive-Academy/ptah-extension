import type {
  MonitoredAgent,
  SubagentRecord,
} from '@ptah-extension/chat-streaming';
import {
  cliLaneStats,
  resolveCliLaneUsage,
  subagentLaneStats,
} from './lane-stats.adapters';

const subagent = (overrides: Partial<SubagentRecord> = {}): SubagentRecord => ({
  parentToolUseId: 'toolu_1',
  status: 'running',
  ...overrides,
});

const cli = (overrides: Partial<MonitoredAgent> = {}): MonitoredAgent => ({
  agentId: 'lane-1',
  cli: 'codex',
  task: 'Inspect files',
  status: 'completed',
  startedAt: 1000,
  stdout: '',
  stderr: '',
  expanded: true,
  segments: [],
  streamEvents: [],
  streamRevision: 0,
  permissionQueue: [],
  ...overrides,
});

describe('subagentLaneStats', () => {
  it('maps a record without usage to unknown figures', () => {
    expect(subagentLaneStats(subagent(), 0)).toEqual({
      model: null,
      contextTokens: null,
      tokens: null,
      tokensPartial: false,
      tokensTitle: null,
      cost: undefined,
      costPartial: false,
      cache: null,
      cacheTitle: null,
    });
  });

  it('prefers the reported total and lists the token classes', () => {
    const stats = subagentLaneStats(
      subagent({
        totalTokens: 9000,
        usage: {
          input: 1200,
          output: 300,
          cacheRead: 4000,
          lastRequestContextTokens: 5200,
          model: 'claude-opus-4-7',
          estimatedCostUsd: null,
        },
      }),
      0,
    );
    expect(stats).toMatchObject({
      model: 'claude-opus-4-7',
      contextTokens: 5200,
      tokens: 9000,
      tokensTitle: 'in 1,200 · out 300 · cache read 4,000',
    });
  });

  it('sums the usage classes when no total is reported', () => {
    const stats = subagentLaneStats(
      subagent({ usage: { input: 100, output: 50, cacheWrite: 25 } }),
      0,
    );
    expect(stats.tokens).toBe(175);
  });

  it('reports a warm cache with its title once the TTL is known', () => {
    const stats = subagentLaneStats(
      subagent({ cacheTtl: '5m', lastEventAt: 1000 }),
      61_000,
    );
    expect(stats.cache).toBe('warm');
    expect(stats.cacheTitle).toContain('Prompt cache warm (TTL 5m');
  });
});

describe('cliLaneStats', () => {
  it('uses structured totals as exact', () => {
    const stats = cliLaneStats(
      cli({
        model: 'gpt-5',
        usageTotals: {
          inputTokens: 1200,
          outputTokens: 80,
          totalTokens: 1280,
          contextTokens: 2000,
          costUsd: 0.12,
        },
      }),
    );
    expect(stats).toMatchObject({
      model: 'gpt-5',
      contextTokens: 2000,
      tokens: 1280,
      tokensPartial: false,
      cost: 0.12,
      costPartial: false,
      cache: null,
    });
  });

  it('marks a summed in/out count as a lower bound', () => {
    const stats = cliLaneStats(
      cli({ usageTotals: { inputTokens: 1200, outputTokens: 80 } }),
    );
    expect(stats).toMatchObject({ tokens: 1280, tokensPartial: true });
    expect(stats.cost).toBeUndefined();
  });

  it('falls back to retained segments as partial, without context', () => {
    const stats = cliLaneStats(
      cli({
        segments: [
          {
            type: 'info',
            content: '',
            usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.01 },
          },
        ],
      }),
    );
    expect(stats).toMatchObject({
      contextTokens: null,
      tokens: 15,
      tokensPartial: true,
      cost: 0.01,
      costPartial: true,
    });
  });

  it('maps a lane without usage to unknown figures', () => {
    expect(cliLaneStats(cli())).toMatchObject({
      model: null,
      tokens: null,
      tokensTitle: null,
      cost: undefined,
      costPartial: false,
    });
  });
});

describe('resolveCliLaneUsage', () => {
  it('prefers host totals even when retained segments disagree', () => {
    const structured = { inputTokens: 3, outputTokens: 4, totalTokens: 7 };
    const lane = cli({
      usageTotals: structured,
      segments: [
        { type: 'info', content: '', usage: { totalTokens: 100 } },
      ],
    });
    expect(resolveCliLaneUsage(lane)).toEqual({
      usage: structured,
      structured,
      partial: false,
      tokens: 7,
      tokensExact: true,
    });
  });

  it('marks a retained segment fold partial even with a reported total', () => {
    const lane = cli({
      segments: [
        { type: 'info', content: '', usage: { totalTokens: 10 } },
        { type: 'info', content: '', usage: { totalTokens: 5 } },
      ],
    });
    expect(resolveCliLaneUsage(lane)).toEqual({
      usage: {
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: 15,
        costUsd: undefined,
        partial: true,
      },
      structured: null,
      partial: true,
      tokens: 15,
      tokensExact: true,
    });
    expect(cliLaneStats(lane).tokensPartial).toBe(true);
  });

  it('distinguishes an inexact host split from absent usage', () => {
    expect(resolveCliLaneUsage(cli({ usageTotals: { inputTokens: 0, outputTokens: 4 } })))
      .toMatchObject({ partial: false, tokens: 4, tokensExact: false });
    expect(resolveCliLaneUsage(cli({ usageTotals: { totalTokens: 0 } })))
      .toMatchObject({ partial: false, tokens: 0, tokensExact: true });
    expect(resolveCliLaneUsage(cli())).toEqual({
      usage: null,
      structured: null,
      partial: false,
      tokens: null,
      tokensExact: false,
    });
    expect(resolveCliLaneUsage(cli({
      usageTotals: {},
      segments: [{ type: 'info', content: '', usage: { totalTokens: 90 } }],
    }))).toEqual({
      usage: {},
      structured: {},
      partial: false,
      tokens: null,
      tokensExact: false,
    });
  });
});
