import type { CommandWorkState } from './command-center.store';

/** Shared mapping for monitored agents and sessions. */
export function workStateForStatus(status: string): CommandWorkState {
  switch (status) {
    case 'streaming':
    case 'resuming':
    case 'running':
    case 'background':
      return 'running';
    case 'pending':
    case 'draft':
      return 'queued';
    case 'fresh':
    case 'switching':
      return 'starting';
    case 'paused':
    case 'awaiting-background':
      return 'awaiting input';
    case 'completed':
      return 'completed';
    case 'failed':
    case 'timeout':
      return 'failed';
    case 'killed':
    case 'stopped':
      return 'cancelled';
    default:
      return 'unknown';
  }
}
