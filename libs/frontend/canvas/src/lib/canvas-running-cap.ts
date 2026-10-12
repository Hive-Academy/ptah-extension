import type {
  MonitoredAgent,
  SubagentRecord,
} from '@ptah-extension/chat-streaming';

export const MAX_RUNNING_SESSIONS = 9;

const TERMINAL_SUBAGENT_STATUSES: readonly SubagentRecord['status'][] = [
  'completed',
  'failed',
  'killed',
  'stopped',
];

/**
 * Count distinct canvas tile sessions with a turn or agent still active.
 *
 * Ownership is strict: an agent whose parent session is not resolved yet
 * counts for no session. `agentVisibleInSession` would count it for every
 * session and could block the cap for no reason.
 */
export function countRunningSessions(
  sessionIds: readonly (string | null)[],
  isTabTurnInFlight: (sessionId: string) => boolean,
  agents: readonly MonitoredAgent[],
  subagents: readonly SubagentRecord[],
): number {
  let count = 0;
  for (const sessionId of new Set(sessionIds)) {
    if (!sessionId) continue;
    if (
      isTabTurnInFlight(sessionId) ||
      agents.some(
        (agent) =>
          agent.status === 'running' && agent.parentSessionId === sessionId,
      ) ||
      subagents.some(
        (agent) =>
          !TERMINAL_SUBAGENT_STATUSES.includes(agent.status) &&
          agent.parentSessionId === sessionId,
      )
    ) {
      count++;
    }
  }
  return count;
}
