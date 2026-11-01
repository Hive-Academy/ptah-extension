import type {
  BackgroundAgentEntry,
  MonitoredAgent,
  SubagentRecord,
} from '@ptah-extension/chat-streaming';
import type { SessionStatus } from '@ptah-extension/chat-types';
import {
  backgroundAgentStatusWord,
  cliLaneStatusWord,
  orchestratorStatusWord,
  subagentStatusWord,
} from '@ptah-extension/chat-ui';
import type { AgentKind, AgentStatusWord } from '@ptah-extension/chat-ui';
import type {
  AskUserQuestionRequest,
  BackgroundTaskSnapshotEntry,
  CliOutputSegment,
  PermissionRequest,
} from '@ptah-extension/shared';
import { isAgentTaskType } from '@ptah-extension/shared';
import { laneKey } from '../../components/molecules/compact-session/compact-lane-rows';
import { ownedBySession } from './owned-by-session';
import { isUsageSegment } from '../../components/molecules/agent-card/stats-bar.utils';

/** One agent of a session, as the dock and the inspector AGENTS rows show it. */
export interface SessionAgent {
  /** `'orchestrator'` or a `laneKey(...)` (`sub:`, `cli:`, `bg:`). */
  readonly key: string;
  readonly kind: AgentKind;
  readonly name: string;
  /** The CLI type of a CLI lane; `null` for every other kind. */
  readonly cliId: string | null;
  /** The SDK agent type (role-icon key), when the source carries one. */
  readonly agentType: string | null;
  readonly status: AgentStatusWord | null;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  readonly activity: string | null;
  readonly usageTotals?: MonitoredAgent['usageTotals'];
  readonly segments?: readonly CliOutputSegment[];
  /** Ids of the open permission / question requests this agent waits on. */
  readonly openRequestIds: readonly string[];
}

/** Store snapshots for one session; requests are already targeted at its tab. */
export interface SessionAgentRosterInput {
  readonly sessionId: string | null;
  readonly tabStatus: SessionStatus;
  readonly subagents: readonly SubagentRecord[];
  readonly cliAgents: readonly MonitoredAgent[];
  readonly backgroundAgents: readonly BackgroundAgentEntry[];
  readonly backgroundTasks?: readonly BackgroundTaskSnapshotEntry[];
  readonly permissions: readonly PermissionRequest[];
  readonly questions: readonly AskUserQuestionRequest[];
}

/** The Orchestrator row; `status` is computed by the caller. */
export function orchestratorAgent(
  status: AgentStatusWord | null,
  openRequestIds: readonly string[],
): SessionAgent {
  return {
    key: 'orchestrator',
    kind: 'orchestrator',
    name: 'Orchestrator',
    cliId: null,
    agentType: null,
    status,
    startedAt: null,
    endedAt: null,
    activity: null,
    openRequestIds,
  };
}

/** The last non-empty line of the newest output segment, trimmed. */
export function cliActivity(agent: MonitoredAgent): string | null {
  for (let segmentIndex = agent.segments.length - 1; segmentIndex >= 0; segmentIndex--) {
    const segment = agent.segments[segmentIndex];
    if (isUsageSegment(segment)) continue;
    const lines = segment.content.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.length > 0) return line;
    }
  }
  return null;
}

/**
 * THE agent list of one session, in dock order: Orchestrator, sub-agents,
 * CLI lanes, background. Membership and keys match the canvas lane strip:
 * strict session ownership, and a background-store entry is dropped when a
 * sub-agent already carries its tool call id. No session id -> Orchestrator
 * only.
 */
export function buildSessionAgentRoster(
  input: SessionAgentRosterInput,
): readonly SessionAgent[] {
  const { sessionId } = input;
  const subagents = ownedBySession(
    input.subagents,
    sessionId,
    (a) => a.parentSessionId,
  );
  const cliAgents = ownedBySession(
    input.cliAgents,
    sessionId,
    (a) => a.parentSessionId,
  );
  const backgroundAgents = ownedBySession(
    input.backgroundAgents,
    sessionId,
    (a) => a.sessionId,
  );

  const permissionsByAgent = new Map<string, string[]>();
  const orchestratorRequestIds: string[] = [];
  for (const request of input.permissions) {
    const owner = request.agentToolCallId;
    if (!owner) {
      orchestratorRequestIds.push(request.id);
      continue;
    }
    const ids = permissionsByAgent.get(owner);
    if (ids) ids.push(request.id);
    else permissionsByAgent.set(owner, [request.id]);
  }
  for (const question of input.questions) {
    orchestratorRequestIds.push(question.id);
  }

  const subagentRow = (
    agent: SubagentRecord,
    kind: 'subagent' | 'background',
    fallbackName: string,
    description: string | undefined,
  ): SessionAgent => {
    const openRequestIds = permissionsByAgent.get(agent.parentToolUseId) ?? [];
    return {
      key: laneKey(kind, agent.parentToolUseId),
      kind,
      name: agent.teammateName || agent.agentType || description || fallbackName,
      cliId: null,
      agentType: agent.agentType ?? null,
      status: subagentStatusWord(agent.status, openRequestIds.length > 0),
      startedAt: agent.startedAt ?? null,
      endedAt: agent.completedAt ?? null,
      activity: agent.lastToolName ?? null,
      openRequestIds,
    };
  };

  const subagentToolCallIds = new Set(subagents.map((a) => a.parentToolUseId));

  const agents: SessionAgent[] = [
    ...subagents
      .filter((a) => a.status !== 'background')
      .map((a) => subagentRow(a, 'subagent', 'Sub-agent', a.description)),
    ...cliAgents.map((a): SessionAgent => {
      const openRequestIds = a.permissionQueue.map((p) => p.requestId);
      return {
        key: laneKey('cli', a.agentId),
        kind: 'cli',
        name: a.displayName || a.cli,
        cliId: a.cli,
        agentType: null,
        status: cliLaneStatusWord(a.status, openRequestIds.length),
        startedAt: a.startedAt,
        endedAt: a.completedAt ?? null,
        activity: cliActivity(a),
        usageTotals: a.usageTotals,
        segments: a.segments,
        openRequestIds,
      };
    }),
    ...subagents
      .filter((a) => a.status === 'background')
      .map((a) =>
        subagentRow(a, 'background', 'Background agent', undefined),
      ),
    ...backgroundAgents
      .filter((a) => !subagentToolCallIds.has(a.toolCallId))
      .map(
        (a): SessionAgent => ({
          key: laneKey('background', a.toolCallId),
          kind: 'background',
          name: a.teammateName || a.agentType || 'Background agent',
          cliId: null,
          agentType: a.agentType || null,
          status: backgroundAgentStatusWord(a.status),
          startedAt: a.startedAt,
          endedAt: a.completedAt ?? null,
          activity: a.agentDescription ?? null,
          openRequestIds: [],
        }),
      ),
    ...(input.backgroundTasks ?? [])
      .filter((task) => !isAgentTaskType(task.taskType))
      .map((task): SessionAgent => ({
        key: `task:${task.taskId}`,
        kind: 'task',
        name: `${task.taskType}: ${task.description}`,
        cliId: null,
        agentType: null,
        status: task.status,
        startedAt: null,
        endedAt: null,
        activity: task.description,
        openRequestIds: [],
      })),
  ];
  const hasLiveAgents = agents.some(
    (agent) =>
      agent.status === 'running' ||
      agent.status === 'waiting' ||
      agent.status === 'queued',
  );
  return [
    orchestratorAgent(
      orchestratorStatusWord(
        input.tabStatus,
        orchestratorRequestIds.length > 0,
        hasLiveAgents,
      ),
      orchestratorRequestIds,
    ),
    ...agents,
  ];
}
