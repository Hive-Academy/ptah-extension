/**
 * AgentMonitorPanelComponent grouping tests.
 *
 * Covers the pure `groupAgentsByWorkflowRun` partition that the panel's
 * `workflowGroups()` / `standaloneAgents()` computeds delegate to:
 *   - workflow agents partition into runs keyed by workflowRunId
 *   - standalone (no workflowRunId) agents are unaffected
 *   - aggregate run status / counts roll up correctly
 */

import type {
  MonitoredAgent,
  SubagentRecord,
} from '@ptah-extension/chat-streaming';
import { groupAgentsByWorkflowRun } from './agent-monitor-panel.grouping';

/** Minimal MonitoredAgent factory — the grouping only reads a few fields. */
function agent(overrides: Partial<MonitoredAgent>): MonitoredAgent {
  return {
    agentId: 'a1',
    cli: 'ptah-cli',
    task: 'do work',
    status: 'running',
    startedAt: Date.now(),
    stdout: '',
    stderr: '',
    expanded: false,
    segments: [],
    streamEvents: [],
    streamRevision: 0,
    permissionQueue: [],
    ...overrides,
  } as MonitoredAgent;
}

describe('groupAgentsByWorkflowRun', () => {
  it('partitions workflow agents into runs keyed by workflowRunId', () => {
    const agents = [
      agent({ agentId: 'a', workflowRunId: 'run-1', workflowName: 'Build' }),
      agent({ agentId: 'b', workflowRunId: 'run-1' }),
      agent({ agentId: 'c', workflowRunId: 'run-2', workflowName: 'Deploy' }),
    ];

    const { groups, standalone } = groupAgentsByWorkflowRun(agents);

    expect(standalone).toHaveLength(0);
    expect(groups).toHaveLength(2);

    const run1 = groups.find((g) => g.workflowRunId === 'run-1');
    expect(run1?.agents.map((a) => a.agentId)).toEqual(['a', 'b']);
    expect(run1?.total).toBe(2);
    // Name is taken from the first agent that reported one.
    expect(run1?.workflowName).toBe('Build');

    const run2 = groups.find((g) => g.workflowRunId === 'run-2');
    expect(run2?.total).toBe(1);
    expect(run2?.workflowName).toBe('Deploy');
  });

  it('preserves first-appearance run order', () => {
    const agents = [
      agent({ agentId: 'a', workflowRunId: 'run-b' }),
      agent({ agentId: 'b', workflowRunId: 'run-a' }),
      agent({ agentId: 'c', workflowRunId: 'run-b' }),
    ];

    const { groups } = groupAgentsByWorkflowRun(agents);

    expect(groups.map((g) => g.workflowRunId)).toEqual(['run-b', 'run-a']);
  });

  it('leaves standalone agents (no workflowRunId) ungrouped and unaffected', () => {
    const agents = [
      agent({ agentId: 'plain-1' }),
      agent({ agentId: 'wf-1', workflowRunId: 'run-1' }),
      agent({ agentId: 'plain-2' }),
    ];

    const { groups, standalone } = groupAgentsByWorkflowRun(agents);

    expect(groups).toHaveLength(1);
    expect(standalone.map((a) => a.agentId)).toEqual(['plain-1', 'plain-2']);
  });

  it('returns no groups when every agent is standalone', () => {
    const agents = [agent({ agentId: 'x' }), agent({ agentId: 'y' })];

    const { groups, standalone } = groupAgentsByWorkflowRun(agents);

    expect(groups).toHaveLength(0);
    expect(standalone).toHaveLength(2);
  });

  it('rolls up aggregate status to running when any agent is running', () => {
    const { groups } = groupAgentsByWorkflowRun([
      agent({ agentId: 'a', workflowRunId: 'r', status: 'completed' }),
      agent({ agentId: 'b', workflowRunId: 'r', status: 'running' }),
    ]);

    expect(groups[0].status).toBe('running');
    expect(groups[0].running).toBe(1);
    expect(groups[0].completed).toBe(1);
  });

  it('rolls up aggregate status to completed when all agents completed', () => {
    const { groups } = groupAgentsByWorkflowRun([
      agent({ agentId: 'a', workflowRunId: 'r', status: 'completed' }),
      agent({ agentId: 'b', workflowRunId: 'r', status: 'completed' }),
    ]);

    expect(groups[0].status).toBe('completed');
  });

  it('rolls up aggregate status to failed when a non-running agent failed', () => {
    const { groups } = groupAgentsByWorkflowRun([
      agent({ agentId: 'a', workflowRunId: 'r', status: 'failed' }),
      agent({ agentId: 'b', workflowRunId: 'r', status: 'completed' }),
    ]);

    expect(groups[0].status).toBe('failed');
    expect(groups[0].failed).toBe(1);
  });

  it('sums tokens across a run when agents report a token count', () => {
    const { groups } = groupAgentsByWorkflowRun([
      // MonitoredAgent has no token field today; the grouping reads it
      // structurally so it is forward-compatible.
      agent({ agentId: 'a', workflowRunId: 'r', totalTokens: 100 } as never),
      agent({ agentId: 'b', workflowRunId: 'r', totalTokens: 250 } as never),
    ]);

    expect(groups[0].totalTokens).toBe(350);
  });

  it('leaves totalTokens undefined when no agent reports tokens', () => {
    const { groups } = groupAgentsByWorkflowRun([
      agent({ agentId: 'a', workflowRunId: 'r' }),
    ]);

    expect(groups[0].totalTokens).toBeUndefined();
  });
});

/** Minimal SubagentRecord factory — grouping only reads status/workflow fields. */
function subagent(overrides: Partial<SubagentRecord>): SubagentRecord {
  return {
    parentToolUseId: 'toolu_x',
    status: 'running',
    ...overrides,
  } as SubagentRecord;
}

describe('groupAgentsByWorkflowRun — SubagentRecords', () => {
  it('groups workflow SubagentRecords by workflowRunId (structural shape)', () => {
    const records = [
      subagent({
        parentToolUseId: 'toolu_a',
        workflowRunId: 'run-1',
        workflowName: 'Release',
        status: 'running',
      }),
      subagent({
        parentToolUseId: 'toolu_b',
        workflowRunId: 'run-1',
        status: 'completed',
      }),
      subagent({
        parentToolUseId: 'toolu_c',
        workflowRunId: 'run-2',
        status: 'running',
      }),
    ];

    const { groups, standalone } = groupAgentsByWorkflowRun(records);

    expect(standalone).toHaveLength(0);
    expect(groups).toHaveLength(2);

    const run1 = groups.find((g) => g.workflowRunId === 'run-1');
    expect(run1?.total).toBe(2);
    expect(run1?.running).toBe(1);
    expect(run1?.completed).toBe(1);
    expect(run1?.status).toBe('running');
    expect(run1?.workflowName).toBe('Release');
    expect(run1?.agents.map((r) => r.parentToolUseId)).toEqual([
      'toolu_a',
      'toolu_b',
    ]);
  });

  it('sums SubagentRecord totalTokens across a run', () => {
    const { groups } = groupAgentsByWorkflowRun([
      subagent({ parentToolUseId: 't1', workflowRunId: 'r', totalTokens: 500 }),
      subagent({ parentToolUseId: 't2', workflowRunId: 'r', totalTokens: 750 }),
    ]);

    expect(groups[0].totalTokens).toBe(1250);
  });

  it('rolls up killed/failed SubagentRecords to failed status', () => {
    const { groups } = groupAgentsByWorkflowRun([
      subagent({ parentToolUseId: 't1', workflowRunId: 'r', status: 'killed' }),
      subagent({
        parentToolUseId: 't2',
        workflowRunId: 'r',
        status: 'completed',
      }),
    ]);

    expect(groups[0].status).toBe('failed');
    expect(groups[0].failed).toBe(1);
  });

  it('treats SubagentRecords without a workflowRunId as standalone', () => {
    const { groups, standalone } = groupAgentsByWorkflowRun([
      subagent({ parentToolUseId: 't1' }),
      subagent({ parentToolUseId: 't2', workflowRunId: 'r' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(standalone.map((r) => r.parentToolUseId)).toEqual(['t1']);
  });
});
