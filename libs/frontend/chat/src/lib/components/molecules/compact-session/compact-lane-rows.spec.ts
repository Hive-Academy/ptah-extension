import type {
  MonitoredAgent,
  SubagentRecord,
} from '@ptah-extension/chat-streaming';
import { buildLaneSummary, laneKey, parseLaneKey } from './compact-lane-rows';

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
  it('orders ended lanes by latest end and preserves active start order', () => {
    const result = buildLaneSummary([
      { ...cli('ended-early', 'completed', 900), completedAt: 10 },
      { ...cli('ended-late', 'completed', 100), completedAt: 20 },
      cli('active-early', 'running', 10),
      cli('active-late', 'running', 20),
    ], [], 's', 10);
    expect(result.rows.map((row) => row.id)).toEqual([
      'cli:active-late', 'cli:active-early', 'cli:ended-late', 'cli:ended-early',
    ]);
  });
  it('uses canvas lane key prefixes', () => {
    expect(laneKey('cli', 'a')).toBe('cli:a');
    expect(laneKey('subagent', 'b')).toBe('sub:b');
    expect(laneKey('background', 'c')).toBe('bg:c');
  });

  it('round trips lane keys and rejects unknown or empty IDs', () => {
    expect(parseLaneKey(laneKey('background', 'task:1'))).toEqual({
      kind: 'background',
      id: 'task:1',
    });
    expect(parseLaneKey('unknown:1')).toBeNull();
    expect(parseLaneKey('cli:')).toBeNull();
  });

  it('does not present last activity as a subagent start time', () => {
    const result = buildLaneSummary(
      [],
      [sub('running', 'running', 100), sub('ended', 'completed', 200)],
      's',
    );
    expect(result.rows.every((row) => row.startedAt === null)).toBe(true);
    expect(result.rows.find((row) => row.id === 'sub:ended')?.endedAt).toBe(
      200,
    );
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
    // Kind counts cover the capped lanes too (the rail card's CLI badge).
    expect(result.kinds).toEqual({ cli: 5, subagent: 0, background: 0 });
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
      ['cli:unknown', 'running'],
      ['bg:sub', 'running'],
    ]);
    expect(result.moreCount).toBe(0);
  });

  it('excludes unresolved and foreign CLI owners from rows, counts and overflow', () => {
    const agents = [
      cli('owned', 'running', 1),
      { ...cli('unowned', 'failed', 2), parentSessionId: undefined },
      cli('foreign', 'pending', 3, 'other'),
    ];
    const result = buildLaneSummary(agents, [], 's', 1, true);
    expect(result.rows.map((row) => row.id)).toEqual(['cli:owned']);
    expect(result.total).toBe(1);
    expect(result.moreCount).toBe(0);
    expect(result.counts).toEqual({
      waiting: 0,
      error: 0,
      running: 1,
      done: 0,
      stopped: 0,
    });
    expect(buildLaneSummary(agents, [], 'other', 3, true).rows.map((row) => row.id))
      .toEqual(['cli:foreign']);
  });

  it('keeps unresolved CLI agents visible by default for the main panel', () => {
    const agents = [
      cli('owned', 'running', 1),
      { ...cli('unowned', 'failed', 2), parentSessionId: undefined },
      cli('foreign', 'running', 3, 'other'),
    ];
    const result = buildLaneSummary(agents, [], 's');
    expect(result.rows.map((row) => row.id)).toEqual(['cli:unowned', 'cli:owned']);
    expect(result.counts).toEqual({ waiting: 0, error: 1, running: 1, done: 0, stopped: 0 });
  });
});
