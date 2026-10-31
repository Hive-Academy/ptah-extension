import type { MonitoredAgent } from '@ptah-extension/chat-streaming';
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
});
