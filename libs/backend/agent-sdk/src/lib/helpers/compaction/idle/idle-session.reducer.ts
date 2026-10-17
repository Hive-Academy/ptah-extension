import { COMPACTION_MAX_DWELL_MS } from '../compaction-state.types';
import {
  IDLE_CACHE_TTL_MS,
  IDLE_CLAIM_TIMEOUT_MS,
  IDLE_FIRE_FRACTION,
  IDLE_POSTCOMPACT_GRACE_MS,
  type IdleAttempt,
  type IdleEffect,
  type IdleNoArmReason,
  type IdleSessionState,
  type IdleSignal,
  type IdleStep,
  type IdleTimerSpec,
} from './idle-compaction.types';

export interface IdleReduceContext {
  readonly now: number;
  readonly settings: {
    readonly enabled: boolean;
    readonly autoCompactEnabled: boolean;
    readonly minTokens: number;
  };
}

function timerFor(attempt: IdleAttempt | null): IdleTimerSpec {
  if (attempt?.kind === 'pending') {
    return {
      kind: 'due',
      attemptId: attempt.attemptId,
      phase: 'sending',
      at: attempt.fireAt,
    };
  }
  if (
    attempt?.kind === 'in-flight' &&
    attempt.phase !== 'sending' &&
    attempt.phase !== 'boundary'
  ) {
    return {
      kind: 'deadline',
      attemptId: attempt.attemptId,
      phase: attempt.phase,
      at: attempt.deadlineAt,
    };
  }
  return null;
}

function noArmReason(
  state: IdleSessionState,
  signal: Extract<IdleSignal, { type: 'turn-context' }>,
  ctx: IdleReduceContext,
): IdleNoArmReason | null {
  if (!ctx.settings.enabled || !ctx.settings.autoCompactEnabled)
    return 'disabled';
  if (state.codexProxy) return 'codex-proxy';
  if (state.attempt?.kind === 'in-flight' || state.compactionOpen)
    return 'in-flight';
  if (
    !state.lastTurn ||
    state.lastTurn.turnId !== signal.turnId ||
    state.idlePeriodClosed
  )
    return 'stale-turn';
  if (state.activitySinceTurnEnd || state.prefixChangedSinceTurnEnd)
    return 'activity-since-turn';
  if (state.lastTurn.request?.ttl !== '1h') return 'not-1h';
  if (signal.totalTokens === null) return 'no-reading';
  if (
    state.lastTurn.request.anchorAt + IDLE_CACHE_TTL_MS * IDLE_FIRE_FRACTION <=
    ctx.now
  ) {
    return 'fire-time-passed';
  }
  return null;
}

/** A single pure transition. All time and settings come from the caller. */
export function reduceIdleSession(
  state: IdleSessionState,
  signal: IdleSignal,
  ctx: IdleReduceContext,
): IdleStep {
  const effects: IdleEffect[] = [];
  let next = state;
  const attempt = state.attempt;
  const release = (): void => {
    if (attempt?.kind === 'in-flight') {
      effects.push({
        type: 'release-claim',
        sessionId: state.sessionId,
        claimId: attempt.claimId,
      });
    }
  };
  const close = (): void => {
    next = {
      ...next,
      attempt: null,
      idlePeriodClosed: true,
      compactionOpen: false,
    };
  };

  if (signal.type === 'session-bound') {
    if (signal.runToken !== state.runToken) {
      effects.push({ type: 'clear-notice' });
      if (attempt?.kind === 'in-flight' && attempt.phase !== 'postcompacted')
        release();
      next = {
        ...state,
        sessionId: signal.sessionId,
        runToken: signal.runToken,
        codexProxy: signal.codexProxy,
        lastTurn: null,
        reading: null,
        activitySinceTurnEnd: false,
        prefixChangedSinceTurnEnd: false,
        rateLimit: null,
        compactionOpen: false,
        idlePeriodClosed: false,
        attempt: null,
      };
      if (attempt?.kind === 'in-flight' && attempt.phase === 'postcompacted') {
        next = { ...next, idlePeriodClosed: true };
      }
    }
  } else if (signal.sessionId === state.sessionId) {
    switch (signal.type) {
      case 'request-started':
      case 'input':
        next = {
          ...state,
          activitySinceTurnEnd: true,
          idlePeriodClosed: false,
          attempt: attempt?.kind === 'pending' ? null : attempt,
        };
        if (signal.type === 'input') effects.push({ type: 'clear-notice' });
        break;
      case 'turn-ended':
        if (attempt?.kind === 'in-flight') {
          if (attempt.phase === 'enqueued' || attempt.phase === 'precompact') {
            effects.push({
              type: 'log',
              level: 'warn',
              reason: 'compaction-failed',
            });
            release();
            close();
          } else if (attempt.phase === 'boundary') {
            next = {
              ...state,
              compactionOpen: false,
              attempt: {
                ...attempt,
                phase: 'boundary-ended',
                deadlineAt: Math.min(
                  attempt.dwellAt ?? attempt.deadlineAt,
                  ctx.now + IDLE_POSTCOMPACT_GRACE_MS,
                ),
              },
            };
          } else if (attempt.phase === 'postcompacted') {
            effects.push({ type: 'log', level: 'debug', reason: 'no-reading' });
            close();
          }
        } else if (!state.idlePeriodClosed) {
          next = {
            ...state,
            lastTurn: {
              turnId: signal.turnId,
              endedAt: signal.endedAt,
              request: signal.lastRequest,
            },
            reading: null,
            activitySinceTurnEnd: false,
            prefixChangedSinceTurnEnd: false,
            compactionOpen: false,
            attempt: null,
          };
        } else {
          effects.push({ type: 'clear-notice' });
          next = { ...state, compactionOpen: false };
        }
        break;
      case 'turn-context': {
        const reason = noArmReason(state, signal, ctx);
        if (reason) {
          effects.push({ type: 'log', level: 'debug', reason });
        } else {
          const request = state.lastTurn!.request!;
          const fireAt =
            request.anchorAt + IDLE_CACHE_TTL_MS * IDLE_FIRE_FRACTION;
          const attemptId = `${state.runToken}:${signal.turnId}:${ctx.now}:${attempt?.attemptId ?? ''}`;
          next = {
            ...state,
            reading: {
              turnId: signal.turnId,
              totalTokens: signal.totalTokens!,
            },
            attempt: {
              kind: 'pending',
              attemptId,
              turnId: signal.turnId,
              anchorAt: request.anchorAt,
              fireAt,
              expiresAt: request.anchorAt + IDLE_CACHE_TTL_MS,
              armedAt: ctx.now,
              contextTokens: signal.totalTokens!,
            },
          };
        }
        break;
      }
      case 'prompt-prefix-changed':
        next = {
          ...state,
          prefixChangedSinceTurnEnd: true,
          attempt: attempt?.kind === 'pending' ? null : attempt,
        };
        break;
      case 'rate-limit':
        next = { ...state, rateLimit: signal.status };
        break;
      case 'settings-changed':
        if (!ctx.settings.enabled || !ctx.settings.autoCompactEnabled) {
          next = {
            ...state,
            attempt: attempt?.kind === 'pending' ? null : attempt,
          };
        }
        break;
      case 'pre-compact':
        if (
          attempt?.kind === 'in-flight' &&
          attempt.phase === 'postcompacted'
        ) {
          effects.push({ type: 'clear-notice' });
          close();
        } else if (
          attempt?.kind === 'in-flight' &&
          attempt.phase === 'enqueued'
        ) {
          const dwellAt = ctx.now + COMPACTION_MAX_DWELL_MS;
          next = {
            ...state,
            compactionOpen: true,
            attempt: {
              ...attempt,
              phase: 'precompact',
              dwellAt,
              deadlineAt: dwellAt,
            },
          };
        } else {
          next = {
            ...state,
            compactionOpen: true,
            attempt: attempt?.kind === 'pending' ? null : attempt,
          };
        }
        break;
      case 'compact-boundary':
        if (
          attempt?.kind === 'in-flight' &&
          (attempt.phase === 'precompact' || attempt.phase === 'postcompacted')
        ) {
          effects.push({
            type: 'set-notice',
            noticeKey: signal.sessionId,
            preTokens: signal.preTokens ?? attempt.contextTokens,
          });
          if (attempt.phase === 'postcompacted') close();
          else
            next = {
              ...state,
              compactionOpen: false,
              attempt: {
                ...attempt,
                phase: 'boundary',
                boundaryPreTokens: signal.preTokens ?? undefined,
              },
            };
        } else {
          next = { ...state, compactionOpen: false };
        }
        break;
      case 'post-compact':
        if (
          attempt?.kind === 'in-flight' &&
          (attempt.phase === 'boundary' || attempt.phase === 'boundary-ended')
        ) {
          release();
          close();
        } else if (
          attempt?.kind === 'in-flight' &&
          attempt.phase === 'precompact'
        ) {
          release();
          next = {
            ...state,
            compactionOpen: false,
            attempt: {
              ...attempt,
              phase: 'postcompacted',
              claimed: false,
              deadlineAt: Math.min(
                attempt.dwellAt ?? attempt.deadlineAt,
                ctx.now + IDLE_POSTCOMPACT_GRACE_MS,
              ),
            },
          };
        } else {
          next = { ...state, compactionOpen: false };
        }
        break;
      case 'attempt-due':
        if (
          attempt?.kind === 'pending' &&
          attempt.attemptId === signal.attemptId
        ) {
          const claimId = `${attempt.attemptId}:claim`;
          next = {
            ...state,
            attempt: {
              kind: 'in-flight',
              attemptId: attempt.attemptId,
              phase: 'sending',
              claimId,
              claimed: false,
              contextTokens: attempt.contextTokens,
              deadlineAt: ctx.now + IDLE_CLAIM_TIMEOUT_MS,
            },
          };
          effects.push({ type: 'fire', attemptId: attempt.attemptId, claimId });
        }
        break;
      case 'fire-sent':
        if (
          attempt?.kind === 'in-flight' &&
          attempt.phase === 'sending' &&
          attempt.attemptId === signal.attemptId
        ) {
          next = {
            ...state,
            attempt: {
              ...attempt,
              phase: 'enqueued',
              claimed: true,
              deadlineAt: ctx.now + IDLE_CLAIM_TIMEOUT_MS,
            },
          };
        }
        break;
      case 'fire-skipped':
      case 'fire-failed':
        if (
          attempt?.kind === 'in-flight' &&
          attempt.attemptId === signal.attemptId
        ) {
          effects.push({
            type: 'log',
            level: signal.type === 'fire-skipped' ? 'info' : 'warn',
            reason: signal.reason,
          });
          release();
          if (signal.type === 'fire-failed') close();
          else next = { ...state, attempt: null };
        }
        break;
      case 'deadline-elapsed':
        if (
          attempt?.kind === 'in-flight' &&
          attempt.attemptId === signal.attemptId &&
          attempt.phase === signal.phase &&
          ctx.now >= attempt.deadlineAt
        ) {
          if (attempt.phase === 'postcompacted') {
            effects.push({ type: 'log', level: 'debug', reason: 'no-reading' });
            close();
          } else if (
            attempt.phase === 'enqueued' ||
            attempt.phase === 'precompact' ||
            attempt.phase === 'boundary-ended'
          ) {
            effects.push({
              type: 'log',
              level: 'warn',
              reason:
                attempt.phase === 'enqueued'
                  ? 'claim-timeout'
                  : attempt.phase === 'precompact'
                    ? 'dwell-timeout'
                    : 'postcompact-timeout',
            });
            release();
            close();
          }
        }
        break;
      case 'rekey':
        next = { ...state, sessionId: signal.toId };
        break;
      case 'session-released':
        release();
        next = { ...state, attempt: null, compactionOpen: false };
        break;
    }
  }
  return { signal, state: { ...next, timer: timerFor(next.attempt) }, effects };
}
