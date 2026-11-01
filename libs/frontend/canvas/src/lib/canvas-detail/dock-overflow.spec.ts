import type { SessionAgent } from '@ptah-extension/chat';
import { dockCapacity, orderDockMenuAgents, planDockOverflow } from './dock-overflow';

function agent(
  key: string,
  status: SessionAgent['status'],
  kind: SessionAgent['kind'] = 'cli',
): SessionAgent {
  return {
    key, kind, status, name: key, cliId: null, agentType: null,
    startedAt: null, endedAt: null, activity: null, openRequestIds: [],
  };
}

describe('inspector roster overflow', () => {
  it.each([300, 360, 400, 480, 560])(
    'retains selection and every menu entry at %ipx',
    (width) => {
      const agents: SessionAgent[] = Array.from({ length: 12 }, (_, i) => ({
        key: i === 0 ? 'orchestrator' : `cli:${i}`,
        kind: i === 0 ? 'orchestrator' : 'cli',
        name: `Agent ${i}`,
        status: 'running',
        cliId: null,
        agentType: null,
        startedAt: null,
        endedAt: null,
        activity: null,
        openRequestIds: [],
      }));
      const { visible, hidden } = planDockOverflow(
        agents,
        'cli:11',
        dockCapacity(width),
      );
      expect(visible.some((agent) => agent.key === 'cli:11')).toBe(true);
      expect(
        new Set([...visible, ...hidden].map((agent) => agent.key)).size,
      ).toBe(12);
      expect(hidden.length).toBeGreaterThan(0);
    },
  );

  it('moves done and stopped agents to the menu for a small roster', () => {
    const agents = [
      agent('orchestrator', 'done', 'orchestrator'),
      agent('running', 'running'),
      agent('done', 'done'),
      agent('queued', 'queued'),
      agent('stopped', 'stopped'),
    ];
    const plan = planDockOverflow(agents, 'orchestrator', 0);
    expect(plan.visible.map(({ key }) => key)).toEqual(['orchestrator', 'running', 'queued']);
    expect(plan.hidden.map(({ key }) => key)).toEqual(['done', 'stopped']);
  });

  it('keeps a selected finished agent and the orchestrator inline at zero width', () => {
    const agents = [
      agent('orchestrator', 'done', 'orchestrator'),
      agent('running-1', 'running'),
      agent('selected', 'stopped'),
      agent('running-2', 'running'),
      agent('done', 'done'),
      agent('waiting', 'waiting'),
    ];
    const plan = planDockOverflow(agents, 'selected', 0);
    expect(plan.visible.map(({ key }) => key)).toEqual(['orchestrator', 'selected']);
    expect(plan.hidden.map(({ key }) => key)).toEqual([
      'running-1', 'running-2', 'done', 'waiting',
    ]);
  });

  it('orders the dropdown by status, retaining dock order for ties', () => {
    const agents = [
      agent('done-1', 'done'),
      agent('queued', 'queued'),
      agent('running-1', 'running'),
      agent('stopped', 'stopped'),
      agent('waiting', 'waiting'),
      agent('failed', 'failed'),
      agent('running-2', 'running', 'subagent'),
      agent('done-2', 'done', 'background'),
    ];
    expect(orderDockMenuAgents(agents).map(({ key }) => key)).toEqual([
      'running-1', 'running-2', 'waiting', 'failed', 'queued',
      'done-1', 'done-2', 'stopped',
    ]);
    expect(agents[0].key).toBe('done-1');
  });
});
