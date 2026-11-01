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
  it('shows generic SDK work as a distinct task row', () => {
    const rows = buildSessionAgentRoster({
      sessionId: 'session-1', tabStatus: 'streaming', subagents: [],
      cliAgents: [], backgroundAgents: [], permissions: [], questions: [],
      backgroundTasks: [
        { taskId: 'bash-1', taskType: 'local_bash', description: 'Compile', status: 'running' },
        { taskId: 'agent-1', taskType: 'local_agent', description: 'Research', status: 'running' },
        { taskId: 'agent-2', taskType: 'remote_agent', description: 'Delegate', status: 'running' },
      ],
    });
    expect(rows.map((row) => row.kind)).toEqual(['orchestrator', 'task']);
    expect(rows[1]).toMatchObject({ key: 'task:bash-1', name: 'local_bash: Compile', status: 'running' });
  });
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
