import type { SessionAgent } from '@ptah-extension/chat';
import { agentDurationMs, agentDurationText } from './dock-overflow';

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
