import type { SessionAgent } from '@ptah-extension/chat';
import { agentDurationMs, agentDurationText, planDockOverflow } from './dock-overflow';

const row: SessionAgent = {
  key: 'cli:one', kind: 'cli', name: 'One', cliId: 'codex', agentType: null,
  status: 'done', startedAt: 1_000, endedAt: null, activity: null, openRequestIds: [],
};

describe('dock duration', () => {
  it('does not age a finished lane without end time', () => {
    expect(agentDurationMs(row, 1_000_000)).toBeNull();
    expect(agentDurationText(row, 1_000_000)).toBeNull();
  });

  it('shows elapsed time for a live lane and frozen time for a finished lane', () => {
    expect(agentDurationText({ ...row, status: 'running' }, 3_500)).toBe('2s');
    expect(agentDurationText({ ...row, endedAt: 4_500 }, 1_000_000)).toBe('3s');
  });
});

describe('dock overflow threshold', () => {
  it.each([1, 5, 6])('moves all %i agents to overflow when no chip and trigger fit', (count) => {
    const agents = Array.from({ length: count }, (_, i) => ({ ...row, key: `cli:${i}`, status: 'running' as const }));
    const selected = agents[count - 1];
    const plan = planDockOverflow(agents, selected.key, 0);
    expect(plan).toEqual({ visible: [], hidden: agents });
    expect(plan.hidden).toContain(selected);
  });

  it('shows five of six agents and keeps a late selected agent inline when space permits', () => {
    const agents = Array.from({ length: 6 }, (_, i) => ({ ...row, key: `cli:${i}`, status: 'running' as const }));
    const plan = planDockOverflow(agents, agents[5].key, 5);
    expect(plan.visible).toEqual([agents[0], agents[1], agents[2], agents[3], agents[5]]);
    expect(plan.hidden).toEqual([agents[4]]);
  });
});
