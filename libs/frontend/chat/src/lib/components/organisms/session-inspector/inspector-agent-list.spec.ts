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
  input: null,
  output: null,
};

function row(
  key: string,
  status: SessionAgent['status'],
  kind: SessionAgent['kind'] = 'cli',
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
    usage: NO_USAGE,
    durationMs: null,
    requests: [],
    tray: null,
    hasActions: false,
  });
}

describe('inspector agent list', () => {
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
