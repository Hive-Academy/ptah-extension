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
  tabs: readonly { id: string; claudeSessionId: string | null }[],
  isTabTurnInFlight: (key: string) => boolean,
  agents: readonly MonitoredAgent[],
  subagents: readonly SubagentRecord[],
): number {
  let count = 0;
  const sessions = new Map(
    tabs.map((tab) => [tab.claudeSessionId ?? tab.id, tab.claudeSessionId]),
  );
  for (const [key, sessionId] of sessions) {
    if (
      isTabTurnInFlight(key) ||
      agents.some(
        (agent) =>
          sessionId !== null &&
          agent.status === 'running' &&
          agent.parentSessionId === sessionId,
      ) ||
      subagents.some(
        (agent) =>
          sessionId !== null &&
          !TERMINAL_SUBAGENT_STATUSES.includes(agent.status) &&
          agent.parentSessionId === sessionId,
      )
    ) {
      count++;
    }
  }
  return count;
}
