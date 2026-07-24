/**
 * Pure workflow-run grouping for the agent monitor panel.
 *
 * Generic over a minimal STRUCTURAL shape ({@link WorkflowGroupable}) so the
 * same logic groups both CLI `MonitoredAgent`s and SDK `SubagentRecord`s (the
 * two sources of workflow-run agents) — and stays unit-testable WITHOUT
 * importing the panel component and its heavy Angular/markdown component graph.
 */

/**
 * Minimal fields the grouping needs. Both `MonitoredAgent` and `SubagentRecord`
 * (and the panel's tile view-model) satisfy this structurally. Only `status`
 * and the workflow fields are read for aggregation; `agentId`/`displayName` are
 * declared so callers can pass full records without a cast.
 */
export interface WorkflowGroupable {
  readonly agentId?: string;
  /** Lifecycle status (MonitoredAgent `AgentStatus` or SubagentRecord status). */
  readonly status: string;
  readonly workflowRunId?: string;
  readonly workflowName?: string;
  readonly totalTokens?: number;
  readonly displayName?: string;
}

/**
 * Aggregate view of one workflow run — all agents sharing a `workflowRunId`,
 * plus roll-up counts and status for the collapsible run header. Generic so the
 * `agents` array preserves the caller's concrete item type.
 */
export interface WorkflowRunGroup<
  T extends WorkflowGroupable = WorkflowGroupable,
> {
  readonly workflowRunId: string;
  /** Display name, if any agent in the run reported one. */
  readonly workflowName?: string;
  readonly agents: readonly T[];
  readonly total: number;
  readonly running: number;
  readonly completed: number;
  readonly failed: number;
  /** Aggregate lifecycle: running if any agent runs; else failed if any
   *  failed; else completed if all completed; else mixed. */
  readonly status: 'running' | 'completed' | 'failed' | 'mixed';
  /** Summed token usage across the run, when agents carry a token count.
   *  Undefined when no agent reports tokens. */
  readonly totalTokens?: number;
}

/** Whether a status counts as a terminal failure for aggregation. */
function isFailedStatus(status: string): boolean {
  return status === 'failed' || status === 'timeout' || status === 'killed';
}

/**
 * Partition a flat agent list into workflow-run groups (keyed by
 * `workflowRunId`, in first-appearance order) and standalone agents
 * (no `workflowRunId`).
 */
export function groupAgentsByWorkflowRun<T extends WorkflowGroupable>(
  agents: readonly T[],
): { groups: WorkflowRunGroup<T>[]; standalone: T[] } {
  const buckets = new Map<string, T[]>();
  const order: string[] = [];
  const standalone: T[] = [];

  for (const a of agents) {
    const runId = a.workflowRunId;
    if (!runId) {
      standalone.push(a);
      continue;
    }
    let bucket = buckets.get(runId);
    if (!bucket) {
      bucket = [];
      buckets.set(runId, bucket);
      order.push(runId);
    }
    bucket.push(a);
  }

  const groups = order.map((runId): WorkflowRunGroup<T> => {
    const members = buckets.get(runId) ?? [];
    let running = 0;
    let completed = 0;
    let failed = 0;
    let tokens = 0;
    let hasTokens = false;
    let name: string | undefined;

    for (const m of members) {
      if (m.status === 'running') running++;
      else if (m.status === 'completed') completed++;
      else if (isFailedStatus(m.status)) failed++;
      if (!name && m.workflowName) name = m.workflowName;
      if (typeof m.totalTokens === 'number') {
        tokens += m.totalTokens;
        hasTokens = true;
      }
    }

    const status: WorkflowRunGroup['status'] =
      running > 0
        ? 'running'
        : failed > 0
          ? 'failed'
          : members.length > 0 && completed === members.length
            ? 'completed'
            : 'mixed';

    return {
      workflowRunId: runId,
      workflowName: name,
      agents: members,
      total: members.length,
      running,
      completed,
      failed,
      status,
      totalTokens: hasTokens ? tokens : undefined,
    };
  });

  return { groups, standalone };
}
