import type { AgentStatus } from '@ptah-extension/shared';
import type {
  BackgroundAgentEntry,
  SubagentRecord,
} from '@ptah-extension/chat-streaming';
import type { SessionStatus } from '@ptah-extension/chat-types';
import type { AgentStatusWord } from './agent-avatar.types';

/*
 * THE status mapping of every agent kind onto `AgentStatusWord`. Each switch
 * is exhaustive at compile time: a new store or SDK status without a case
 * fails the `never` assignment. At runtime a newer backend may still send a
 * status this build does not know; it reads `stopped` (or no word for the
 * Orchestrator), never a thrown error that would blank the view.
 */

/** A CLI lane (`MonitoredAgent`); any open permission request reads `waiting`. */
export function cliLaneStatusWord(
  status: AgentStatus,
  openRequests: number,
): AgentStatusWord {
  if (openRequests > 0) return 'waiting';
  switch (status) {
    case 'running':
      return 'running';
    case 'completed':
      return 'done';
    case 'failed':
    case 'timeout':
      return 'failed';
    case 'stopped':
      return 'stopped';
    default: {
      const _unhandled: never = status;
      return 'stopped';
    }
  }
}

/** A sub-agent (`SubagentRecord`); an open request reads `waiting`. */
export function subagentStatusWord(
  status: SubagentRecord['status'],
  hasOpenRequest: boolean,
): AgentStatusWord {
  if (hasOpenRequest) return 'waiting';
  switch (status) {
    case 'pending':
    case 'paused':
      return 'queued';
    case 'running':
    case 'background':
      return 'running';
    case 'completed':
      return 'done';
    case 'failed':
      return 'failed';
    case 'killed':
    case 'stopped':
      return 'stopped';
    default: {
      const _unhandled: never = status;
      return 'stopped';
    }
  }
}

/** A background agent (`BackgroundAgentEntry`); its `error` reads `failed`. */
export function backgroundAgentStatusWord(
  status: BackgroundAgentEntry['status'],
): AgentStatusWord {
  switch (status) {
    case 'running':
      return 'running';
    case 'completed':
      return 'done';
    case 'error':
      return 'failed';
    case 'stopped':
      return 'stopped';
    default: {
      const _unhandled: never = status;
      return 'stopped';
    }
  }
}

/**
 * The Orchestrator, from its session status. `fresh` and `draft` have run
 * nothing yet, so they have no word (no ring, no badge).
 */
export function orchestratorStatusWord(
  status: SessionStatus,
  hasOpenRequest: boolean,
): AgentStatusWord | null {
  if (hasOpenRequest) return 'waiting';
  switch (status) {
    case 'streaming':
    case 'resuming':
      return 'running';
    case 'loaded':
    case 'awaiting-background':
    case 'sleeping':
    case 'switching':
      return 'done';
    case 'fresh':
    case 'draft':
      return null;
    default: {
      const _unhandled: never = status;
      return null;
    }
  }
}
