import type { SessionAgent } from '@ptah-extension/chat';
import { dockCapacity, orderDockMenuAgents, planDockOverflow } from './dock-overflow';

function agent(key: string, status: SessionAgent['status'] = 'running', kind: SessionAgent['kind'] = 'cli'): SessionAgent {
  return { key, kind, status, name: key, cliId: null, agentType: null,
    startedAt: null, endedAt: null, activity: null, openRequestIds: [] };
}

const keys = (agents: readonly SessionAgent[]): string[] => agents.map(({ key }) => key);

describe('dock overflow planner', () => {
  it.each([0, 1, 5, 6, 20])('partitions a %i-agent roster with a five-chip ceiling', (count) => {
    const agents = Array.from({ length: count }, (_, index) => agent(`a${index}`));
    const plan = planDockOverflow(agents, 'a0', 100);
    expect(plan.visible).toHaveLength(Math.min(count, 5));
    expect([...plan.visible, ...plan.hidden]).toHaveLength(count);
    expect(new Set(keys([...plan.visible, ...plan.hidden])).size).toBe(count);
  });

  it('returns a safe capacity for unknown, narrow, and wide widths', () => {
    expect(dockCapacity(Number.NaN)).toBe(1);
    expect(dockCapacity(Number.POSITIVE_INFINITY)).toBe(1);
    expect(dockCapacity(0)).toBe(0);
    expect(dockCapacity(200)).toBe(0);
    expect(dockCapacity(300)).toBeGreaterThan(0);
    expect(dockCapacity(760)).toBe(5);
    const agents = Array.from({ length: 8 }, (_, index) => agent(`a${index}`));
    expect(keys(planDockOverflow(agents, 'a7', dockCapacity(0)).visible)).toEqual([]);
    expect(keys(planDockOverflow(agents, 'a7', dockCapacity(Number.NaN)).visible)).toEqual(['a7']);
  });

  it('orders running chips across kinds, then waiting, failed, queued, done, stopped', () => {
    const agents = [agent('done', 'done', 'orchestrator'), agent('wait', 'waiting', 'subagent'),
      agent('run-cli'), agent('failed', 'failed', 'background'), agent('run-bg', 'running', 'background'),
      agent('queued', 'queued'), agent('run-sub', 'running', 'subagent'), agent('stopped', 'stopped')];
    expect(keys(planDockOverflow(agents, 'run-bg', 5).visible)).toEqual([
      'run-cli', 'run-bg', 'run-sub', 'wait', 'failed',
    ]);
    expect(keys(planDockOverflow(agents, 'done', 5).visible)).toEqual([
      'done', 'run-cli', 'run-bg', 'run-sub', 'wait',
    ]);
    expect(keys(planDockOverflow(agents, 'done', 1).visible)).toEqual(['done']);
    expect(keys(planDockOverflow(agents, 'done', 0).hidden)).toEqual(keys(agents));
  });

  it('freezes membership and order while respecting resize, selection and focus', () => {
    const agents = [agent('selected', 'done'), agent('a'), agent('b'), agent('c'), agent('d'), agent('e')];
    const frozen = ['a', 'selected', 'b', 'c', 'd'];
    const changed = agents.map((item) => item.key === 'e' ? { ...item, status: 'waiting' as const } : item);
    expect(keys(planDockOverflow(changed, 'selected', 5, frozen, 'c').visible)).toEqual(frozen);
    expect(keys(planDockOverflow(changed, 'selected', 2, frozen, 'c').visible)).toEqual(['selected', 'c']);
    expect(keys(planDockOverflow(changed, 'selected', 1, frozen, 'c').visible)).toEqual(['selected']);
    expect(keys(planDockOverflow(changed, 'selected', 5).visible)).toEqual(['selected', 'a', 'b', 'c', 'd']);
  });

  it('reserves a slot for a late selected running agent without moving it ahead of running peers', () => {
    const agents = Array.from({ length: 8 }, (_, index) => agent(`a${index}`));
    expect(keys(planDockOverflow(agents, 'a7', 5).visible)).toEqual(['a0', 'a1', 'a2', 'a3', 'a7']);
  });

  it('keeps menu sorting stable and includes finished agents', () => {
    const agents = [agent('done-1', 'done'), agent('queued', 'queued'), agent('run-1'),
      agent('stopped', 'stopped'), agent('waiting', 'waiting'), agent('failed', 'failed'),
      agent('run-2', 'running', 'subagent'), agent('done-2', 'done', 'background')];
    expect(keys(orderDockMenuAgents(agents))).toEqual([
      'run-1', 'run-2', 'waiting', 'failed', 'queued', 'done-1', 'done-2', 'stopped',
    ]);
  });
});
