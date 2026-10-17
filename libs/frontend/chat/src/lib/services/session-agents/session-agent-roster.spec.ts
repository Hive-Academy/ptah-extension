import type { MonitoredAgent } from '@ptah-extension/chat-streaming';
import { buildSessionAgentRoster } from './session-agent-roster';
import type { SubagentRecord } from '@ptah-extension/chat-streaming';

function lane(segments: MonitoredAgent['segments']): MonitoredAgent {
  return {
    agentId: 'lane-1', cli: 'codex', task: 'Review', status: 'running',
    startedAt: 1000, parentSessionId: 'session-1', stdout: '', stderr: '',
    expanded: true, segments, streamEvents: [], streamRevision: 0,
    permissionQueue: [],
  };
}

describe('CLI roster activity', () => {
  it('carries subagent start and completion times into its row', () => {
    const subagent: SubagentRecord = {
      parentToolUseId: 'tool-one', parentSessionId: 'session-1', status: 'completed',
      startedAt: 1_000, completedAt: 4_000,
    };
    const rows = buildSessionAgentRoster({
      sessionId: 'session-1', tabStatus: 'active', subagents: [subagent],
      cliAgents: [], backgroundAgents: [], permissions: [], questions: [],
    });
    expect(rows[1].startedAt).toBe(1_000);
    expect(rows[1].endedAt).toBe(4_000);
  });
  it('uses the last non-usage line even when newer segments only report usage', () => {
    const rows = buildSessionAgentRoster({
      sessionId: 'session-1', tabStatus: 'active', subagents: [],
      cliAgents: [lane([
        { type: 'info', content: 'Reading files' },
        { type: 'info', content: 'Usage: 11869 input', usage: { inputTokens: 11869, outputTokens: 30 } },
      ])],
      backgroundAgents: [], permissions: [], questions: [],
    });
    expect(rows[1].activity).toBe('Reading files');
  });
});
