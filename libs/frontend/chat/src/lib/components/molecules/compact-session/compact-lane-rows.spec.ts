import type {
  MonitoredAgent,
  SubagentRecord,
} from '@ptah-extension/chat-streaming';
import { buildLaneSummary, laneKey } from './compact-lane-rows';

function cli(
  id: string,
  status: MonitoredAgent['status'],
  startedAt: number,
  parentSessionId = 's',
): MonitoredAgent {
  return {
    agentId: id,
    cli: 'codex',
    task: id,
    status,
    startedAt,
    parentSessionId,
    permissionQueue: [],
  } as unknown as MonitoredAgent;
}

function sub(
  id: string,
  status: SubagentRecord['status'],
  lastEventAt: number,
): SubagentRecord {
  return { parentToolUseId: id, status, lastEventAt, parentSessionId: 's' };
}

describe('compact lane rows', () => {
  it('uses canvas lane key prefixes', () => {
    expect(laneKey('cli', 'a')).toBe('cli:a');
    expect(laneKey('subagent', 'b')).toBe('sub:b');
    expect(laneKey('background', 'c')).toBe('bg:c');
  });

  it('sorts by priority then newest, caps rows and counts hidden lanes', () => {
    const agents = [
      cli('done', 'completed', 100),
      cli('old', 'running', 1),
      cli('new', 'running', 5),
      cli('error', 'failed', 2),
      cli('stop', 'stopped', 10),
    ];
    agents[1].permissionQueue.push({
      requestId: 'p',
    } as MonitoredAgent['permissionQueue'][number]);
    const result = buildLaneSummary(agents, [], 's');
    expect(result.rows.map((row) => row.id)).toEqual([
      'cli:old',
      'cli:error',
      'cli:new',
    ]);
    expect(result.total).toBe(5);
    expect(result.moreCount).toBe(2);
    expect(result.counts).toEqual({
      waiting: 1,
      error: 1,
      running: 1,
      done: 1,
      stopped: 1,
    });
  });

  it('filters CLI lanes to session scope and keeps unknown statuses as running', () => {
    const agents = [
      cli('other', 'running', 20, 'other'),
      cli('unknown', 'new-status' as MonitoredAgent['status'], 3),
    ];
    const result = buildLaneSummary(agents, [sub('sub', 'background', 4)], 's');
    expect(result.rows.map((row) => [row.id, row.status])).toEqual([
      ['bg:sub', 'running'],
      ['cli:unknown', 'running'],
    ]);
    expect(result.moreCount).toBe(0);
  });
});
