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

export const LANE_KEY_PREFIX: Readonly<Record<CompactLaneKind, string>> = {
  cli: 'cli',
  subagent: 'sub',
  background: 'bg',
};

export function laneKey(kind: CompactLaneKind, id: string): string {
  return `${LANE_KEY_PREFIX[kind]}:${id}`;
}

export function parseLaneKey(
  key: string,
): { kind: CompactLaneKind; id: string } | null {
  const colon = key.indexOf(':');
  if (colon < 0 || colon === key.length - 1) return null;
  const prefix = key.slice(0, colon);
  const kind = (Object.keys(LANE_KEY_PREFIX) as CompactLaneKind[]).find(
    (candidate) => LANE_KEY_PREFIX[candidate] === prefix,
  );
  return kind ? { kind, id: key.slice(colon + 1) } : null;
}

function laneStatus(status: string, waiting: boolean): CompactLaneStatus {
  if (waiting || status === 'pending' || status === 'paused') return 'waiting';
  if (status === 'failed' || status === 'timeout') return 'error';
  if (status === 'completed') return 'done';
  if (status === 'stopped' || status === 'killed') return 'stopped';
  return 'running';
}

/** Use strict ownership for canvas-scoped cards; other callers keep tolerant CLI visibility. */
export function buildLaneSummary(
  agents: readonly MonitoredAgent[],
  subagents: readonly SubagentRecord[],
  sessionId: string,
  max = 3,
  strictOwnership = false,
): CompactLaneSummary {
  const rows: CompactLaneRow[] = [
    ...agents
      .filter((agent) =>
        strictOwnership
          ? Boolean(sessionId) && agent.parentSessionId === sessionId
          : agentVisibleInSession(agent.parentSessionId, sessionId),
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
      const status = laneStatus(agent.status, false);
      return {
        id: laneKey(kind, agent.parentToolUseId),
        name:
          agent.teammateName ||
          agent.agentType ||
          agent.description ||
          'Sub-agent',
        kind,
        status,
        startedAt: null,
        endedAt:
          status === 'done' || status === 'error' || status === 'stopped'
            ? (agent.lastEventAt ?? null)
            : null,
      };
    }),
  ];
  rows.sort(
    (a, b) =>
      statusOrder[a.status] - statusOrder[b.status] ||
      (['done', 'error', 'stopped'].includes(a.status) &&
      ['done', 'error', 'stopped'].includes(b.status)
        ? (b.endedAt ?? 0) - (a.endedAt ?? 0)
        : (b.startedAt ?? 0) - (a.startedAt ?? 0)),
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
