import { agentVisibleInSession } from '@ptah-extension/chat-streaming';
import type {
  MonitoredAgent,
  SubagentRecord,
} from '@ptah-extension/chat-streaming';
import type {
  CompactLaneKind,
  CompactLaneRow,
  CompactLaneStatus,
  CompactLaneSummary,
} from '@ptah-extension/chat-ui';

const statusOrder: Readonly<Record<CompactLaneStatus, number>> = {
  waiting: 0,
  error: 1,
  running: 2,
  done: 3,
  stopped: 4,
};

export function laneKey(kind: CompactLaneKind, id: string): string {
  const prefix =
    kind === 'subagent' ? 'sub' : kind === 'background' ? 'bg' : 'cli';
  return `${prefix}:${id}`;
}

function laneStatus(status: string, waiting: boolean): CompactLaneStatus {
  if (waiting || status === 'pending' || status === 'paused') return 'waiting';
  if (status === 'failed' || status === 'timeout') return 'error';
  if (status === 'completed') return 'done';
  if (status === 'stopped' || status === 'killed') return 'stopped';
  return 'running';
}

export function buildLaneSummary(
  agents: readonly MonitoredAgent[],
  subagents: readonly SubagentRecord[],
  sessionId: string,
  max = 3,
): CompactLaneSummary {
  const rows: CompactLaneRow[] = [
    ...agents
      .filter((agent) =>
        agentVisibleInSession(agent.parentSessionId, sessionId),
      )
      .map((agent): CompactLaneRow => ({
        id: laneKey('cli', agent.agentId),
        name: agent.displayName || agent.cli,
        kind: 'cli',
        status: laneStatus(agent.status, agent.permissionQueue.length > 0),
        startedAt: agent.startedAt,
        endedAt: agent.completedAt ?? null,
      })),
    ...subagents.map((agent): CompactLaneRow => {
      const kind = agent.status === 'background' ? 'background' : 'subagent';
      return {
        id: laneKey(kind, agent.parentToolUseId),
        name:
          agent.teammateName ||
          agent.agentType ||
          agent.description ||
          'Sub-agent',
        kind,
        status: laneStatus(agent.status, false),
        startedAt: agent.lastEventAt ?? null,
        endedAt:
          agent.status === 'completed' ||
          agent.status === 'failed' ||
          agent.status === 'killed' ||
          agent.status === 'stopped'
            ? (agent.lastEventAt ?? null)
            : null,
      };
    }),
  ];
  rows.sort(
    (a, b) =>
      statusOrder[a.status] - statusOrder[b.status] ||
      (b.startedAt ?? 0) - (a.startedAt ?? 0),
  );
  const counts: Record<CompactLaneStatus, number> = {
    waiting: 0,
    error: 0,
    running: 0,
    done: 0,
    stopped: 0,
  };
  for (const row of rows) counts[row.status]++;
  const visible = rows.slice(0, Math.max(0, max));
  return {
    rows: visible,
    moreCount: rows.length - visible.length,
    total: rows.length,
    counts,
  };
}
