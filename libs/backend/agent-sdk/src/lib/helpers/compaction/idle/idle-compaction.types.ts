import type { SchedulerLike } from 'rxjs';
import type {
  SDKMessageOrigin,
  SDKRateLimitInfo,
} from '../../../types/sdk-types/claude-sdk.types';

export const IDLE_CACHE_TTL_MS = 3_600_000;
export const IDLE_FIRE_FRACTION = 0.9;
export const IDLE_FIRE_LATENESS_MS = 60_000;
export const IDLE_MIN_TOKENS_FLOOR = 100_000;
export const IDLE_MIN_TOKENS_DEFAULT = 200_000;
export const IDLE_CLAIM_TIMEOUT_MS = 120_000;
export const IDLE_ANCHOR_SKEW_MS = 5_000;
export const IDLE_POSTCOMPACT_GRACE_MS = 30_000;
export const IDLE_COMPACT_ORIGIN: Extract<
  SDKMessageOrigin,
  { kind: 'coordinator' }
> = {
  kind: 'coordinator',
};

export type CacheTtlClass = '1h' | 'not-1h';

export interface LastRequestSnapshot {
  readonly requestKey: string;
  readonly anchorAt: number;
  readonly ttl: CacheTtlClass;
}

export type IdleRateLimitStatus = SDKRateLimitInfo['status'];

export type IdleSignal =
  | {
      readonly type: 'session-bound';
      readonly sessionId: string;
      readonly runToken: string;
      readonly codexProxy: boolean;
    }
  | { readonly type: 'request-started'; readonly sessionId: string }
  | {
      readonly type: 'turn-ended';
      readonly sessionId: string;
      readonly turnId: string;
      readonly endedAt: number;
      readonly lastRequest: LastRequestSnapshot | null;
    }
  | {
      readonly type: 'turn-context';
      readonly sessionId: string;
      readonly turnId: string;
      readonly totalTokens: number | null;
    }
  | { readonly type: 'input'; readonly sessionId: string }
  | { readonly type: 'prompt-prefix-changed'; readonly sessionId: string }
  | {
      readonly type: 'rate-limit';
      readonly sessionId: string;
      readonly status: IdleRateLimitStatus;
    }
  | { readonly type: 'pre-compact'; readonly sessionId: string }
  | {
      readonly type: 'compact-boundary';
      readonly sessionId: string;
      readonly preTokens: number | null;
    }
  | { readonly type: 'post-compact'; readonly sessionId: string }
  | {
      readonly type: 'rekey';
      readonly sessionId: string;
      readonly toId: string;
    }
  | { readonly type: 'session-released'; readonly sessionId: string }
  | { readonly type: 'settings-changed'; readonly sessionId: string }
  | {
      readonly type: 'attempt-due';
      readonly sessionId: string;
      readonly attemptId: string;
    }
  | {
      readonly type: 'deadline-elapsed';
      readonly sessionId: string;
      readonly attemptId: string;
      readonly phase: IdleAttemptPhase;
    }
  | {
      readonly type: 'fire-skipped';
      readonly sessionId: string;
      readonly attemptId: string;
      readonly reason: IdleSkipReason;
    }
  | {
      readonly type: 'fire-sent';
      readonly sessionId: string;
      readonly attemptId: string;
    }
  | {
      readonly type: 'fire-failed';
      readonly sessionId: string;
      readonly attemptId: string;
      readonly reason: IdleWarnReason;
    };

export type IdleAttemptPhase =
  | 'sending'
  | 'enqueued'
  | 'precompact'
  | 'boundary'
  | 'boundary-ended'
  | 'postcompacted';

export type IdleTimerSpec = {
  readonly kind: 'due' | 'deadline';
  readonly attemptId: string;
  readonly phase: IdleAttemptPhase;
  readonly at: number;
} | null;

export type IdleNoArmReason =
  | 'not-1h'
  | 'no-reading'
  | 'stale-turn'
  | 'activity-since-turn'
  | 'fire-time-passed'
  | 'disabled'
  | 'codex-proxy'
  | 'in-flight';

export type IdleSkipReason =
  | 'disabled'
  | 'auto-compact-off'
  | 'not-1h'
  | 'lapsed'
  | 'below-min-tokens'
  | 'no-reading'
  | 'activity-since-arm'
  | 'prompt-prefix-changed'
  | 'compaction-state'
  | 'not-actable'
  | 'rate-limited'
  | 'not-idle'
  | 'background-subagent'
  | 'not-idle-at-send'
  | 'lookup-failed'
  | 'manual-compact-reserved';

export type IdleWarnReason =
  | 'send-failed'
  | 'send-timeout'
  | 'signal-failed'
  | 'claim-timeout'
  | 'dwell-timeout'
  | 'postcompact-timeout'
  | 'compaction-failed';

export type IdleLogReason = IdleNoArmReason | IdleSkipReason | IdleWarnReason;

export type IdleAttempt =
  | {
      readonly kind: 'pending';
      readonly attemptId: string;
      readonly turnId: string;
      readonly anchorAt: number;
      readonly fireAt: number;
      readonly expiresAt: number;
      readonly armedAt: number;
      readonly contextTokens: number;
    }
  | {
      readonly kind: 'in-flight';
      readonly attemptId: string;
      readonly phase: IdleAttemptPhase;
      readonly claimId: string;
      readonly claimed: boolean;
      readonly contextTokens: number;
      readonly boundaryPreTokens?: number;
      readonly deadlineAt: number;
      readonly dwellAt?: number;
    };

export interface IdleSessionState {
  readonly sessionId: string;
  readonly runToken: string;
  readonly codexProxy: boolean;
  readonly lastTurn: {
    readonly turnId: string;
    readonly endedAt: number;
    readonly request: LastRequestSnapshot | null;
  } | null;
  readonly reading: {
    readonly turnId: string;
    readonly totalTokens: number;
  } | null;
  readonly activitySinceTurnEnd: boolean;
  readonly prefixChangedSinceTurnEnd: boolean;
  readonly rateLimit: IdleRateLimitStatus | null;
  readonly compactionOpen: boolean;
  readonly idlePeriodClosed: boolean;
  readonly attempt: IdleAttempt | null;
  readonly timer: IdleTimerSpec;
}

export type IdleEffect =
  | {
      readonly type: 'log';
      readonly level: 'debug' | 'info' | 'warn';
      readonly reason: IdleLogReason;
    }
  | {
      readonly type: 'fire';
      readonly attemptId: string;
      readonly claimId: string;
    }
  | {
      readonly type: 'release-claim';
      readonly sessionId: string;
      readonly claimId: string;
    }
  | {
      readonly type: 'set-notice';
      readonly noticeKey: string;
      readonly preTokens: number;
    }
  | { readonly type: 'clear-notice' };

export interface IdleStep {
  readonly signal: IdleSignal;
  readonly state: IdleSessionState;
  readonly effects: readonly IdleEffect[];
}

/** Calls are fire-and-forget and must not throw into event producers. */
export interface IdleCompactionSignals {
  sessionBound(sessionId: string, runToken: string, codexProxy: boolean): void;
  requestStarted(sessionId: string): void;
  turnEnded(
    sessionId: string,
    turnId: string,
    lastRequest: LastRequestSnapshot | null,
  ): void;
  turnContext(
    sessionId: string,
    turnId: string,
    totalTokens: number | null,
  ): void;
  input(sessionId: string): void;
  promptPrefixChanged(sessionId: string): void;
  rateLimit(sessionId: string, status: IdleRateLimitStatus): void;
  compactBoundary(sessionId: string, preTokens: number | null): void;
  sessionReleased(sessionId: string): void;
  rekey(from: string, to: string): void;
}

/** The session facade's idle signals and lifecycle operations. */
export type IdleCompactionFacadePort = IdleCompactionSignals & {
  boundaryNoticeFor(sessionId: string): IdleBoundaryNotice | undefined;
  dispose(): void;
};

export interface IdleCompactSender {
  sendIdleCompact(sessionId: string, beforeEnqueue: () => void): Promise<void>;
}

export interface IdleBoundaryNotice {
  readonly preTokens: number;
}

export interface IdleCompactionTiming {
  readonly scheduler: SchedulerLike;
  now(): number;
}
