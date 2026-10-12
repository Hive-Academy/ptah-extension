import { countRunningSessions } from './canvas-running-cap';
import type {
  MonitoredAgent,
  SubagentRecord,
} from '@ptah-extension/chat-streaming';

const lane = (sessionId: string, status: MonitoredAgent['status']) =>
  ({ parentSessionId: sessionId, status }) as MonitoredAgent;
const subagent = (sessionId: string, status: SubagentRecord['status']) =>
  ({ parentSessionId: sessionId, status }) as SubagentRecord;

describe('countRunningSessions for canvas tile sessions only', () => {
  it('ignores null, idle, and finished sessions', () => {
    expect(
      countRunningSessions(
        [null, 'idle', 'done'],
        () => false,
        [lane('done', 'completed'), lane('done', 'failed')],
        [subagent('done', 'completed'), subagent('done', 'stopped')],
      ),
    ).toBe(0);
  });

  it('counts CLI and background activity, once per distinct canvas session', () => {
    expect(
      countRunningSessions(
        ['cli', 'background', 'both', 'both', null],
        (id) => id === 'both',
        [
          lane('cli', 'running'),
          lane('both', 'running'),
          lane('outside', 'running'),
        ],
        [subagent('background', 'background'), subagent('both', 'running')],
      ),
    ).toBe(3);
  });

  it('does not count an agent with an unresolved parent for any session', () => {
    const orphanLane = { status: 'running' } as MonitoredAgent;
    const orphanSubagent = { status: 'running' } as SubagentRecord;
    expect(
      countRunningSessions(
        ['one', 'two'],
        () => false,
        [orphanLane],
        [orphanSubagent],
      ),
    ).toBe(0);
  });

  it('treats all nonterminal monitor subagent states as active', () => {
    for (const status of [
      'pending',
      'running',
      'paused',
      'background',
    ] as const) {
      expect(
        countRunningSessions(
          ['one'],
          () => false,
          [],
          [subagent('one', status)],
        ),
      ).toBe(1);
    }
    for (const status of [
      'completed',
      'failed',
      'killed',
      'stopped',
    ] as const) {
      expect(
        countRunningSessions(
          ['one'],
          () => false,
          [],
          [subagent('one', status)],
        ),
      ).toBe(0);
    }
  });
});
