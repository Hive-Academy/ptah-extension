import {
  CompactionState,
  type CompactionState as CoordinatorState,
} from '../compaction-state.types';
import {
  IDLE_FIRE_LATENESS_MS,
  type IdleAttempt,
  type IdleSessionState,
  type IdleSkipReason,
} from './idle-compaction.types';

export interface FireGateLookups {
  readonly now: number;
  readonly settings: {
    readonly idleCompactionEnabled: boolean;
    readonly autoCompactEnabled: boolean;
    readonly minTokens: number;
  };
  coordinatorState(sessionId: string): CoordinatorState | undefined;
  coordinatorClaim(sessionId: string): unknown;
  turnPhase(sessionId: string): string | undefined;
}

/** Caller handles lookup failures and maps them to lookup-failed. */
export function evaluateFireGate(
  state: IdleSessionState,
  attempt: Extract<IdleAttempt, { readonly kind: 'pending' }>,
  lookups: FireGateLookups,
): IdleSkipReason | null {
  if (!lookups.settings.idleCompactionEnabled) return 'disabled';
  if (!lookups.settings.autoCompactEnabled) return 'auto-compact-off';
  if (state.lastTurn?.request?.ttl !== '1h') return 'not-1h';
  if (
    lookups.now - attempt.fireAt > IDLE_FIRE_LATENESS_MS ||
    lookups.now >= attempt.expiresAt
  )
    return 'lapsed';
  if (state.reading?.turnId !== attempt.turnId) return 'no-reading';
  if (state.reading.totalTokens < lookups.settings.minTokens)
    return 'below-min-tokens';
  if (state.activitySinceTurnEnd) return 'activity-since-arm';
  if (state.prefixChangedSinceTurnEnd) return 'prompt-prefix-changed';
  const coordinator = lookups.coordinatorState(state.sessionId);
  if (
    coordinator === CompactionState.TRIGGERED ||
    coordinator === CompactionState.COMPACTING ||
    coordinator === CompactionState.COOLDOWN ||
    coordinator === CompactionState.BACKOFF ||
    lookups.coordinatorClaim(state.sessionId) != null ||
    state.compactionOpen
  )
    return 'compaction-state';
  if (state.codexProxy) return 'not-actable';
  if (state.rateLimit === 'allowed_warning' || state.rateLimit === 'rejected')
    return 'rate-limited';
  const phase = lookups.turnPhase(state.sessionId);
  if (phase === 'awaiting-background') return 'background-subagent';
  if (phase !== 'idle') return 'not-idle';
  return null;
}
