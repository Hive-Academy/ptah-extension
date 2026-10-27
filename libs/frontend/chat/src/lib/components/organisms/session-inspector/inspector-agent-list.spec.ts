import type { SessionAgent } from '../../../services/session-agents/session-agent-roster';
import {
  agentListRow,
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
  contextText: null,
  contextTitle: null,
  input: null,
  output: null,
};

function row(key: string, status: SessionAgent['status'], kind: SessionAgent['kind'] = 'cli') {
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
    usage: NO_USAGE,
    durationMs: null,
    turns: null,
    requests: [],
    tray: null,
    hasActions: false,
  });
}

describe('inspector agent list', () => {
  it('formats in / out compactly and keeps one unknown side as a dash', () => {
    expect(inOutText(1_050_000, 48_000)).toBe('1.1M / 48.0k');
    expect(inOutText(null, 300)).toBe('— / 300');
    expect(inOutText(null, null)).toBeNull();
  });

  it('orders live agents, then the Orchestrator, then finished ones', () => {
    const ordered = orderAgentList(row('orchestrator', 'done', 'orchestrator'), [
      row('a', 'done'),
      row('b', 'running'),
      row('c', 'queued'),
      row('d', 'failed'),
    ]);
    expect(ordered.map((r) => r.key)).toEqual(['b', 'c', 'orchestrator', 'a', 'd']);
  });

  it('normalizes a moved sub-agent and falls back to the Orchestrator', () => {
    expect(normalizeAgentKey('sub:x', ['orchestrator', 'bg:x'])).toBe('bg:x');
    expect(normalizeAgentKey('bg:x', ['orchestrator', 'sub:x'])).toBe('sub:x');
    expect(normalizeAgentKey('cli:gone', ['orchestrator'])).toBe('orchestrator');
  });

  it('drops the third detail cell when no real figure exists', () => {
    expect(row('a', 'done').cells.map((c) => c.label)).toEqual(['Context', 'In / out']);
    expect(row('a', 'done').cells[0]).toEqual({
      label: 'Context',
      value: '—',
      title: 'not reported',
    });
  });
});
