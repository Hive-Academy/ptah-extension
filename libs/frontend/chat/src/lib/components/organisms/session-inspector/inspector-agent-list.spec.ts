import type { SessionAgent } from '../../../services/session-agents/session-agent-roster';
import {
  agentListRow,
  agentListTotal,
  inOutText,
  normalizeAgentKey,
  orderAgentList,
  type AgentUsageFigures,
} from './inspector-agent-list';

const NO_USAGE: AgentUsageFigures = {
  tokens: null,
  tokensPartial: false,
  cost: null,
  costPartial: false,
  costEstimated: true,
  input: null,
  output: null,
};

function row(
  key: string,
  status: SessionAgent['status'],
  kind: SessionAgent['kind'] = 'cli',
  usage: AgentUsageFigures = NO_USAGE,
) {
  return agentListRow({
    agent: {
      key,
      kind,
      name: key,
      cliId: null,
      agentType: null,
      status,
      startedAt: null,
      endedAt: null,
      activity: null,
      openRequestIds: [],
    },
    secondary: '',
    secondaryTitle: null,
    usage,
    durationMs: null,
    requests: [],
    tray: null,
    hasActions: false,
  });
}

describe('inspector agent list', () => {
  it('sums known numeric usage from every row', () => {
    const total = agentListTotal([
      row('orchestrator', 'done', 'orchestrator', { ...NO_USAGE, tokens: 100, cost: 0.1, costEstimated: false }),
      row('cli:one', 'done', 'cli', { ...NO_USAGE, tokens: 200, cost: 0.2, costEstimated: false }),
    ]);
    expect(total.tokens).toBe('300');
    expect(total.cost).toBe('$0.30');
    expect(total.title).toBe('Total of 2 agents · 0 without token data · 0 without cost data');
  });

  it('marks missing or partial values as lower bounds and estimated cost', () => {
    const total = agentListTotal([
      row('a', 'done', 'cli', { ...NO_USAGE, tokens: 100, tokensPartial: true, cost: 0.1 }),
      row('b', 'done'),
    ]);
    expect(total.tokens).toBe('≥ 100');
    expect(total.cost).toBe('≥ ~$0.10');
    expect(total.title).toContain('1 without token data · 1 without cost data');
  });

  it('uses a dash when no agent reports a value', () => {
    const total = agentListTotal([row('a', 'done')]);
    expect(total.tokens).toBe('—');
    expect(total.cost).toBe('—');
  });
  it('uses the role in the visible name and accessible label', () => {
    const result = agentListRow({
      agent: row('a', 'running').agent, name: 'Codex · reviewer',
      secondary: '', secondaryTitle: null, usage: NO_USAGE,
      durationMs: null, requests: [], tray: null, hasActions: false,
    });
    expect(result.name).toBe('Codex · reviewer');
    expect(result.ariaLabel).toContain('Codex · reviewer');
    expect(result.usageLabel).toContain('Codex · reviewer');
  });
  it('shows elapsed time without converting an unknown duration to zero', () => {
    expect(row('a', 'running').time).toBe('—');
    const timed = agentListRow({
      agent: row('b', 'done').agent,
      secondary: '', secondaryTitle: null, usage: NO_USAGE,
      durationMs: 65_000, requests: [], tray: null, hasActions: false,
    });
    expect(timed.time).toBe('1m 05s');
  });
  it('formats in / out compactly and keeps one unknown side as a dash', () => {
    expect(inOutText(1_050_000, 48_000)).toBe('In 1.1M · Out 48.0k');
    expect(inOutText(null, 300)).toBe('In — · Out 300');
    expect(inOutText(null, null)).toBeNull();
  });

  it('orders live agents, then the Orchestrator, then finished ones', () => {
    const ordered = orderAgentList(
      row('orchestrator', 'done', 'orchestrator'),
      [
        row('a', 'done'),
        row('b', 'running'),
        row('c', 'queued'),
        row('d', 'failed'),
      ],
    );
    expect(ordered.map((r) => r.key)).toEqual([
      'b',
      'c',
      'orchestrator',
      'a',
      'd',
    ]);
  });

  it('normalizes a moved sub-agent and falls back to the Orchestrator', () => {
    expect(normalizeAgentKey('sub:x', ['orchestrator', 'bg:x'])).toBe('bg:x');
    expect(normalizeAgentKey('bg:x', ['orchestrator', 'sub:x'])).toBe('sub:x');
    expect(normalizeAgentKey('cli:gone', ['orchestrator'])).toBe(
      'orchestrator',
    );
  });

  it('reports unknown tokens and their in / out tooltip as not reported', () => {
    expect(row('a', 'done').tokens).toBe('—');
    expect(row('a', 'done').tokensTitle).toBe('not reported');
  });
});
