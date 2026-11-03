import type {
  MonitoredAgent,
  SubagentRecord,
} from '@ptah-extension/chat-streaming';
import {
  registerProviderPricing,
  resetPricingMapForTesting,
} from '@ptah-extension/shared';
import type { SessionAgent } from '../../../services/session-agents/session-agent-roster';
import { cliLaneStats, resolveCliLaneUsage } from '../../../utils/lane-stats.adapters';
import { agentListRow } from './inspector-agent-list';
import { laneUsage } from './inspector-agent-usage';

const cli: MonitoredAgent = {
  agentId: 'cli-1',
  cli: 'codex',
  task: 'Inspect files',
  status: 'running',
  startedAt: 1_000,
  stdout: '',
  stderr: '',
  expanded: true,
  segments: [{
    type: 'info',
    content: 'Usage',
    usage: { inputTokens: 1_200, outputTokens: 300, costUsd: 0.25 },
  }],
  streamEvents: [],
  streamRevision: 0,
  permissionQueue: [],
};

const roster: SessionAgent = {
  key: 'cli:cli-1',
  kind: 'cli',
  name: 'Codex',
  cliId: 'codex',
  agentType: null,
  status: 'running',
  startedAt: 1_000,
  endedAt: null,
  activity: null,
  openRequestIds: [],
  usageTotals: { totalTokens: 99, costUsd: 99 },
};

const sources = {
  cli,
  subagent: null,
  trayTokens: null,
  trayModel: null,
};

describe('inspector CLI lane usage', () => {
  it('agrees with the shared header and summary resolver for partial usage', () => {
    const resolved = resolveCliLaneUsage(cli);
    const summary = cliLaneStats(cli);
    const inspector = laneUsage(roster, sources, 2_000);
    const row = agentListRow({
      agent: roster,
      secondary: 'CLI lane',
      secondaryTitle: null,
      usage: inspector.usage,
      durationMs: null,
      requests: [],
      tray: null,
      hasActions: false,
    });

    expect(resolved).toMatchObject({
      partial: true,
      tokens: 1_500,
      tokensExact: false,
      usage: { inputTokens: 1_200, outputTokens: 300, costUsd: 0.25 },
    });
    expect(inspector.usage).toMatchObject({
      tokens: resolved.tokens,
      tokensPartial: summary.tokensPartial,
      cost: resolved.usage?.costUsd,
      costPartial: summary.costPartial,
      input: resolved.usage?.inputTokens,
      output: resolved.usage?.outputTokens,
    });
    expect(row.tokens).toContain('≥');
    expect(row.cost).toContain('≥');
  });

  it('keeps missing usage missing instead of displaying zero', () => {
    const emptyCli = { ...cli, segments: [], usageTotals: undefined };
    const result = laneUsage(roster, { ...sources, cli: emptyCli }, 2_000);
    const row = agentListRow({
      agent: roster,
      secondary: 'CLI lane',
      secondaryTitle: null,
      usage: result.usage,
      durationMs: null,
      requests: [],
      tray: null,
      hasActions: false,
    });
    expect(result.usage.tokens).toBeNull();
    expect(result.usage.cost).toBeNull();
    expect(row.tokens).toBe('—');
    expect(row.cost).toBe('—');
  });

  // What a finished Codex lane folds from its terminal usage segment: input
  // includes the cached part, and Codex reports no cost.
  const codexDone: MonitoredAgent = {
    ...cli,
    status: 'completed',
    model: 'gpt-6-sol',
    segments: [],
    usageTotals: {
      inputTokens: 900,
      outputTokens: 100,
      cacheReadTokens: 800,
      totalTokens: 1_000,
    },
  };

  it('estimates the cost of a Codex lane that reports tokens only', () => {
    const result = laneUsage(roster, { ...sources, cli: codexDone }, 2_000);

    // gpt-6-sol from the bundled Codex rate card: 100 uncached input at
    // $2/M, 100 output at $10/M, 800 cache read at $0.20/M.
    expect(result.usage).toMatchObject({
      tokens: 1_000,
      tokensPartial: false,
      cost: 0.00136,
      costPartial: false,
      costEstimated: true,
    });
  });

  it('keeps a reported lane cost over the estimate', () => {
    const reported = {
      ...codexDone,
      usageTotals: { ...codexDone.usageTotals, costUsd: 0.5 },
    };
    expect(laneUsage(roster, { ...sources, cli: reported }, 2_000).usage.cost).toBe(0.5);
  });

  it('leaves the cost unknown when a Codex lane reports cache writes', () => {
    const lane = {
      ...codexDone,
      usageTotals: { ...codexDone.usageTotals, cacheWriteTokens: 50 },
    };
    const result = laneUsage(roster, { ...sources, cli: lane }, 2_000);
    expect(result.usage.tokens).toBe(1_000);
    expect(result.usage.cost).toBeNull();
  });

  it.each([
    ['a CLI with undocumented token overlap', { cli: 'copilot' as const }],
    ['a model without an exact rate', { model: 'gpt-6-sol-preview' }],
    ['no model', { model: undefined }],
  ])('leaves the cost unknown for %s', (_label, change) => {
    const lane = { ...codexDone, ...change };
    const result = laneUsage(roster, { ...sources, cli: lane }, 2_000);
    expect(result.usage.tokens).toBe(1_000);
    expect(result.usage.cost).toBeNull();
  });
});

describe('inspector sub-agent usage', () => {
  afterEach(() => resetPricingMapForTesting());

  it('prices a dashed Claude model at its dotted OpenRouter catalog rate', () => {
    // What the renderer holds after `config:pricing-get`: OpenRouter's ids.
    registerProviderPricing({
      'anthropic/claude-opus-5.5': {
        inputCostPerToken: 4e-6,
        outputCostPerToken: 20e-6,
        cacheReadCostPerToken: 0.2e-6,
        cacheCreationCostPerToken: 5e-6,
        provider: 'openrouter',
      },
      'claude-opus-5.5': {
        inputCostPerToken: 4e-6,
        outputCostPerToken: 20e-6,
        cacheReadCostPerToken: 0.2e-6,
        cacheCreationCostPerToken: 5e-6,
        provider: 'openrouter',
      },
    });
    const agent: SessionAgent = {
      ...roster,
      key: 'subagent:toolu_1',
      kind: 'subagent',
      name: 'project-manager',
      cliId: null,
      usageTotals: null,
    };
    const subagent: SubagentRecord = {
      parentToolUseId: 'toolu_1',
      status: 'running',
      usage: {
        input: 1_000,
        output: 500,
        cacheRead: 10_000,
        cacheWrite: 2_000,
        model: 'claude-opus-5-5',
      },
    };

    const result = laneUsage(
      agent,
      { subagent, cli: null, trayTokens: null, trayModel: null },
      2_000,
    );

    // 1000*4e-6 + 500*20e-6 + 10000*0.2e-6 + 2000*5e-6
    expect(result.usage.cost).toBeCloseTo(0.026, 6);
    expect(result.usage.costEstimated).toBe(true);
    expect(result.usage.tokens).toBe(13_500);
  });
});
