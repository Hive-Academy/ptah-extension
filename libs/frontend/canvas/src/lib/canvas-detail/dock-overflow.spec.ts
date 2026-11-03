import type { SessionAgent } from '@ptah-extension/chat';
import { dockCapacity, dockGroup, dockMarkerCount, orderDockAgents, planDockOverflow } from './dock-overflow';

function agent(key: string, status: SessionAgent['status'] = 'running', kind: SessionAgent['kind'] = 'cli'): SessionAgent {
  return { key, kind, status, name: key, cliId: null, agentType: null,
    startedAt: null, endedAt: null, activity: null, openRequestIds: [] };
}

const keys = (agents: readonly SessionAgent[]): string[] => agents.map(({ key }) => key);

describe('dock overflow planner', () => {
  it('reserves the width of every marker a frozen order draws', () => {
    const frozen = [agent('o', 'waiting', 'orchestrator'), agent('a'), agent('f', 'done'), agent('b')];
    expect(dockMarkerCount(frozen)).toBe(3);
    expect(dockMarkerCount(orderDockAgents(frozen))).toBe(2);
    expect(dockCapacity(450, 3)).toBeLessThan(dockCapacity(450));
    // Fewer than two markers never gives back reserved width.
    expect(dockCapacity(450, 0)).toBe(dockCapacity(450));
  });

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
    expect(dockCapacity(340)).toBe(2);
    expect(dockCapacity(450)).toBe(5);
    expect(dockCapacity(760)).toBe(5);
    const agents = Array.from({ length: 8 }, (_, index) => agent(`a${index}`));
    expect(keys(planDockOverflow(agents, 'a7', dockCapacity(0)).visible)).toEqual([]);
    expect(keys(planDockOverflow(agents, 'a7', dockCapacity(Number.NaN)).visible)).toEqual(['a7']);
  });

  it('pins the orchestrator first, then active agents in roster order, then finished ones', () => {
    const agents = [agent('done', 'done', 'subagent'), agent('wait', 'waiting', 'subagent'),
      agent('run-cli'), agent('failed', 'failed', 'background'), agent('orchestrator', 'waiting', 'orchestrator'),
      agent('queued', 'queued'), agent('none', null), agent('stopped', 'stopped')];
    expect(keys(orderDockAgents(agents))).toEqual([
      'orchestrator', 'wait', 'run-cli', 'queued', 'none', 'done', 'failed', 'stopped',
    ]);
    expect(agents.map(dockGroup)).toEqual([
      'finished', 'active', 'active', 'finished', 'orchestrator', 'active', 'active', 'finished',
    ]);
    expect(keys(planDockOverflow(agents, 'run-cli', 5).visible)).toEqual([
      'orchestrator', 'wait', 'run-cli', 'queued', 'none',
    ]);
  });

  it('never moves the orchestrator into overflow, even with no room', () => {
    const agents = [agent('a'), agent('orchestrator', 'done', 'orchestrator'), agent('b')];
    expect(keys(planDockOverflow(agents, 'a', 0).visible)).toEqual(['orchestrator']);
    expect(keys(planDockOverflow(agents, 'b', 1).visible)).toEqual(['orchestrator']);
    expect(keys(planDockOverflow(agents, 'b', 2).visible)).toEqual(['orchestrator', 'b']);
    expect(keys(planDockOverflow(agents, 'orchestrator', 2).visible)).toEqual(['orchestrator', 'a']);
    expect(keys(planDockOverflow(agents, 'a', 5, ['b'], 'b').visible)).toEqual(['orchestrator', 'b', 'a']);
  });

  it('never shows more chips than the capacity allows beyond the pinned orchestrator', () => {
    const roster = [agent('orchestrator', 'running', 'orchestrator'), agent('sub', 'running', 'subagent'),
      agent('a'), agent('b', 'done'), agent('c'), agent('d', 'stopped')];
    for (const selected of ['orchestrator', 'sub', 'c', 'd']) {
      for (const capacity of [0, 1, 2, 3, 4, 5]) {
        const limit = Math.max(1, capacity);
        expect(planDockOverflow(roster, selected, capacity).visible.length).toBeLessThanOrEqual(limit);
        const frozen = planDockOverflow(roster, selected, capacity, ['a', 'b', 'c', 'd', 'sub'], 'd');
        expect(frozen.visible.length).toBeLessThanOrEqual(limit);
        expect(frozen.visible[0].key).toBe('orchestrator');
      }
    }
    expect(keys(planDockOverflow(roster, 'sub', 1).visible)).toEqual(['orchestrator']);
    expect(keys(planDockOverflow(roster, 'd', 2).visible)).toEqual(['orchestrator', 'd']);
  });

  it('keeps the active order stable across status changes and selection', () => {
    const roster = [agent('orchestrator', 'running', 'orchestrator'), agent('a', 'queued'),
      agent('b', 'running'), agent('c', 'waiting')];
    const before = keys(planDockOverflow(roster, 'orchestrator', 5).visible);
    const changed = roster.map((item) => item.key === 'c' ? { ...item, status: 'running' as const }
      : item.key === 'b' ? { ...item, status: 'waiting' as const } : item);
    expect(keys(planDockOverflow(changed, 'orchestrator', 5).visible)).toEqual(before);
    expect(keys(planDockOverflow(changed, 'c', 5).visible)).toEqual(before);
    expect(before).toEqual(['orchestrator', 'a', 'b', 'c']);
  });

  it('hides finished agents from the end first and keeps the selection in its group position', () => {
    const roster = [agent('orchestrator', 'waiting', 'orchestrator'), agent('a'), agent('d1', 'done'),
      agent('b'), agent('d2', 'stopped'), agent('d3', 'failed')];
    expect(keys(planDockOverflow(roster, 'orchestrator', 5).visible)).toEqual(['orchestrator', 'a', 'b', 'd1', 'd2']);
    expect(keys(planDockOverflow(roster, 'orchestrator', 3).visible)).toEqual(['orchestrator', 'a', 'b']);
    expect(keys(planDockOverflow(roster, 'orchestrator', 2).visible)).toEqual(['orchestrator', 'a']);
    expect(keys(planDockOverflow(roster, 'd1', 3).visible)).toEqual(['orchestrator', 'a', 'd1']);
    expect(keys(planDockOverflow(roster, 'b', 2).visible)).toEqual(['orchestrator', 'b']);
    expect(keys(planDockOverflow(roster, 'orchestrator', 3).hidden)).toEqual(['d1', 'd2', 'd3']);
  });

  it('freezes membership and order while respecting resize, selection and focus', () => {
    const agents = [agent('selected', 'done'), agent('a'), agent('b'), agent('c'), agent('d'), agent('e')];
    const frozen = ['a', 'selected', 'b', 'c', 'd'];
    const changed = agents.map((item) => item.key === 'e' ? { ...item, status: 'waiting' as const } : item);
    expect(keys(planDockOverflow(changed, 'selected', 5, frozen, 'c').visible)).toEqual(frozen);
    expect(keys(planDockOverflow(changed, 'selected', 2, frozen, 'c').visible)).toEqual(['selected', 'c']);
    expect(keys(planDockOverflow(changed, 'selected', 1, frozen, 'c').visible)).toEqual(['selected']);
    expect(keys(planDockOverflow(changed, 'selected', 5).visible)).toEqual(['a', 'b', 'c', 'd', 'selected']);
  });

  it('keeps a newly selected hidden agent reachable while focus freezes the dock', () => {
    const agents = Array.from({ length: 6 }, (_, index) => agent(`a${index}`));
    const frozen = ['a0', 'a1', 'a2', 'a3', 'a4'];
    const plan = planDockOverflow(agents, 'a5', 5, frozen, 'a1');
    expect(keys(plan.visible)).toEqual(['a0', 'a1', 'a2', 'a3', 'a5']);
    expect(keys(plan.hidden)).toEqual(['a4']);
    expect(keys(planDockOverflow(agents, 'a5', 1, frozen, 'a1').visible)).toEqual(['a5']);
  });

  it('reserves a slot for a late selected running agent without moving it ahead of its peers', () => {
    const agents = Array.from({ length: 8 }, (_, index) => agent(`a${index}`));
    expect(keys(planDockOverflow(agents, 'a7', 5).visible)).toEqual(['a0', 'a1', 'a2', 'a3', 'a7']);
  });

  it('orders the menu in the same group order and includes finished agents', () => {
    const agents = [agent('done-1', 'done'), agent('queued', 'queued'), agent('run-1'),
      agent('stopped', 'stopped'), agent('waiting', 'waiting'), agent('failed', 'failed'),
      agent('run-2', 'running', 'subagent'), agent('done-2', 'done', 'background')];
    expect(keys(orderDockAgents(agents))).toEqual([
      'queued', 'run-1', 'waiting', 'run-2', 'done-1', 'stopped', 'failed', 'done-2',
    ]);
  });
});
