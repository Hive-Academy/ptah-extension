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
      sessionId: 'session-1', tabStatus: 'streaming', subagents: [subagent],
      cliAgents: [], backgroundAgents: [], permissions: [], questions: [],
    });
    expect(rows[1].startedAt).toBe(1_000);
    expect(rows[1].endedAt).toBe(4_000);
  });
  it('uses the last non-usage line even when newer segments only report usage', () => {
    const rows = buildSessionAgentRoster({
      sessionId: 'session-1', tabStatus: 'streaming', subagents: [],
      cliAgents: [lane([
        { type: 'info', content: 'Reading files' },
        { type: 'info', content: 'Usage: 11869 input', usage: { inputTokens: 11869, outputTokens: 30 } },
      ])],
      backgroundAgents: [], permissions: [], questions: [],
    });
    expect(rows[1].activity).toBe('Reading files');
  });
});

describe('roster order', () => {
  function laneWith(agentId: string, status: MonitoredAgent['status']): MonitoredAgent {
    return { ...lane([]), agentId, status };
  }

  it('keeps the Orchestrator first and moves failed agents to the end in stable order', () => {
    const rows = buildSessionAgentRoster({
      sessionId: 'session-1', tabStatus: 'streaming', subagents: [],
      cliAgents: [
        laneWith('lane-a', 'failed'),
        laneWith('lane-b', 'completed'),
        laneWith('lane-c', 'failed'),
        laneWith('lane-d', 'running'),
      ],
      backgroundAgents: [], permissions: [], questions: [],
    });
    expect(rows.map((row) => row.key)).toEqual([
      'orchestrator',
      expect.stringContaining('lane-b'),
      expect.stringContaining('lane-d'),
      expect.stringContaining('lane-a'),
      expect.stringContaining('lane-c'),
    ]);
    expect(rows.slice(-2).map((row) => row.status)).toEqual(['failed', 'failed']);
  });
});
