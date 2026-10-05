/**
 * Claude rate-limit mapper (TASK_2026_596, Component 4; Req 2.1 as amended by
 * Gate 2 G1).
 *
 * Pure functions that turn the Claude SDK's limit signals into plan-limit
 * evidence. No clock, no I/O, no logging: the caller passes `observedAt`.
 *
 * What is read, and what is deliberately not:
 *
 * - `rate_limit_event` records its window (`rateLimitType`), its `status`
 *   (`rejected` is exhaustion) and its `resetsAt`, with source `stream-event`.
 *   The event's `utilization` is NEVER read: its scale is undocumented
 *   (`sdk.d.ts` `SDKRateLimitInfo`), so a window's used value comes only from
 *   the full-table usage query and stays unknown without it (G1).
 * - `isUsingOverage` / `overageInUse` decide how a success in the same turn was
 *   billed (Decision 4, S1). They are not evidence of a limit.
 * - An assistant `error: 'rate_limit'` and a `system/api_retry` caused by a rate
 *   limit (or HTTP 429) are owner-level evidence with no window and no reset.
 *   `retry_delay_ms` is the client's retry back-off, so it becomes a cooldown —
 *   never a reset.
 */
import {
  normaliseInstant,
  type PlanLimitCooldown,
  type PlanLimitSource,
  type PlanWindowKey,
} from '@ptah-extension/shared';
import type {
  SDKAPIRetryMessage,
  SDKAssistantMessage,
  SDKMessage,
  SDKRateLimitInfo,
} from '../../types/sdk-types/claude-sdk.types';

/** Status a Claude `rate_limit_event` reports for its window. */
export type ClaudeRateLimitStatus = SDKRateLimitInfo['status'];

/**
 * How a Claude turn was billed, as far as the stream says. Only `plan` may
 * clear exhaustion; `unknown` (no event in the turn, or a rejected one) clears
 * nothing.
 */
export type ClaudeTurnBilling = 'plan' | 'overage' | 'unknown';

/** A `rate_limit_event` naming a window this mapper knows. */
export interface ClaudeWindowEvidence {
  readonly kind: 'window';
  readonly windowKey: PlanWindowKey;
  /** Model family the window is limited to (`opus`, `sonnet`). */
  readonly modelScope?: string;
  readonly status: ClaudeRateLimitStatus;
  /** `status === 'rejected'`. */
  readonly exhausted: boolean;
  /** Epoch ms UTC; absent when the event carried none or it did not parse. */
  readonly resetsAt?: number;
  readonly source: 'stream-event';
  readonly observedAt: number;
}

/** Why a limit was attributed to the owner rather than to one window. */
export type ClaudeOwnerEvidenceCause =
  'rejected-unknown-window' | 'assistant-rate-limit' | 'api-retry';

/** A limit hit whose window is unknown. */
export interface ClaudeOwnerEvidence {
  readonly kind: 'owner';
  readonly cause: ClaudeOwnerEvidenceCause;
  readonly source: PlanLimitSource;
  readonly observedAt: number;
  /** Only from a rejected `rate_limit_event` that stated one. */
  readonly resetsAt?: number;
  /** Only from `api_retry.retry_delay_ms`. */
  readonly cooldown?: PlanLimitCooldown;
}

export type ClaudePlanLimitEvidence =
  ClaudeWindowEvidence | ClaudeOwnerEvidence;

/** What one SDK message says about plan limits. */
export interface ClaudePlanLimitMapping {
  /** `null` when the message carries no limit evidence (e.g. `allowed` with no window). */
  readonly evidence: ClaudePlanLimitEvidence | null;
  /** Present only for a `rate_limit_event`: the billing it implies for this turn. */
  readonly billing?: ClaudeTurnBilling;
}

interface WindowTarget {
  readonly windowKey: PlanWindowKey;
  readonly modelScope?: string;
}

function windowFor(
  rateLimitType: SDKRateLimitInfo['rateLimitType'],
): WindowTarget | undefined {
  switch (rateLimitType) {
    case 'five_hour':
      return { windowKey: 'five_hour' };
    case 'seven_day':
      return { windowKey: 'weekly' };
    case 'seven_day_opus':
      return { windowKey: 'weekly_model:opus', modelScope: 'opus' };
    case 'seven_day_sonnet':
      return { windowKey: 'weekly_model:sonnet', modelScope: 'sonnet' };
    case 'seven_day_overage_included':
    case 'overage':
      return { windowKey: 'overage' };
    default:
      // Absent, or a type a newer CLI added: the window is unknown.
      return undefined;
  }
}

/**
 * Billing implied by one event (Decision 4, S1): `overage` when either overage
 * flag is set, `plan` when neither is and the request was not rejected,
 * otherwise `unknown`.
 */
export function billingFromRateLimitInfo(
  info: Pick<SDKRateLimitInfo, 'status' | 'isUsingOverage' | 'overageInUse'>,
): ClaudeTurnBilling {
  if (info.isUsingOverage === true || info.overageInUse === true) {
    return 'overage';
  }
  return info.status === 'rejected' ? 'unknown' : 'plan';
}

/**
 * Map one `SDKRateLimitInfo`. `utilization` is not read (G1), so no evidence
 * produced here ever carries a used value.
 */
export function mapClaudeRateLimitInfo(
  info: SDKRateLimitInfo,
  observedAt: number,
): ClaudePlanLimitMapping {
  const { status, rateLimitType } = info;
  const billing = billingFromRateLimitInfo(info);
  const resetsAt = normaliseInstant(info.resetsAt);
  const exhausted = status === 'rejected';
  const target = windowFor(rateLimitType);

  if (target) {
    return {
      billing,
      evidence: {
        kind: 'window',
        windowKey: target.windowKey,
        ...(target.modelScope !== undefined && {
          modelScope: target.modelScope,
        }),
        status,
        exhausted,
        ...(resetsAt !== undefined && { resetsAt }),
        source: 'stream-event',
        observedAt,
      },
    };
  }
  if (!exhausted) return { billing, evidence: null };
  return {
    billing,
    evidence: {
      kind: 'owner',
      cause: 'rejected-unknown-window',
      source: 'stream-event',
      observedAt,
      ...(resetsAt !== undefined && { resetsAt }),
    },
  };
}

/** True for an `api_retry` caused by a rate limit (by error code or HTTP 429). */
export function isRateLimitRetry(message: SDKAPIRetryMessage): boolean {
  return message.error === 'rate_limit' || message.error_status === 429;
}

/**
 * Map a rate-limit `api_retry` to owner-level evidence. `retry_delay_ms` is a
 * cooldown from `observedAt`; a missing, negative or non-finite delay gives no
 * cooldown. Returns `null` for a retry with any other cause.
 */
export function mapClaudeApiRetry(
  message: SDKAPIRetryMessage,
  observedAt: number,
): ClaudeOwnerEvidence | null {
  if (!isRateLimitRetry(message)) return null;
  const delay = message.retry_delay_ms;
  const until =
    typeof delay === 'number' && Number.isFinite(delay) && delay >= 0
      ? observedAt + delay
      : undefined;
  return {
    kind: 'owner',
    cause: 'api-retry',
    source: 'error-derived',
    observedAt,
    ...(until !== undefined && {
      cooldown: { until, observedAt, rawUntil: until },
    }),
  };
}

/** Map an assistant message whose `error` is `rate_limit`; `null` otherwise. */
export function mapClaudeAssistantRateLimit(
  message: SDKAssistantMessage,
  observedAt: number,
): ClaudeOwnerEvidence | null {
  if (message.error !== 'rate_limit') return null;
  return {
    kind: 'owner',
    cause: 'assistant-rate-limit',
    source: 'error-derived',
    observedAt,
  };
}

/**
 * The single entry point for a stream loop: maps a `rate_limit_event`, a
 * rate-limit `api_retry`, or an assistant `rate_limit` error. Returns `null`
 * for every other message, so a caller can forward it untouched.
 */
export function mapClaudePlanLimitMessage(
  message: SDKMessage,
  observedAt: number,
): ClaudePlanLimitMapping | null {
  if (message.type === 'rate_limit_event') {
    return mapClaudeRateLimitInfo(message.rate_limit_info, observedAt);
  }
  if (message.type === 'assistant') {
    const evidence = mapClaudeAssistantRateLimit(message, observedAt);
    return evidence ? { evidence } : null;
  }
  if (
    message.type === 'system' &&
    'subtype' in message &&
    message.subtype === 'api_retry'
  ) {
    const evidence = mapClaudeApiRetry(message, observedAt);
    return evidence ? { evidence } : null;
  }
  return null;
}

/**
 * Claude model family of a model id (`claude-opus-4-5[1m]` → `opus`), matching
 * the scope of `weekly_model:<family>` windows. `undefined` for a non-Claude
 * or unrecognised id.
 */
export function claudeModelFamily(
  model: string | null | undefined,
): string | undefined {
  if (typeof model !== 'string') return undefined;
  const match = /(opus|sonnet|haiku)/.exec(model.toLowerCase());
  return match ? match[1] : undefined;
}

/**
 * Whether a message, arriving after a turn's `result`, opens the next turn.
 *
 * The SDK documents that informational messages may still follow a `result`
 * (`sdk.d.ts` `SDKResultMessage`: task notifications, session state changes,
 * prompt suggestions). Those trail the turn that just ended; treating them as
 * the next turn's start would move the turn boundary before the user's next
 * prompt. A `session_state_changed` to `running` does open a turn.
 */
export function opensClaudeTurn(message: SDKMessage): boolean {
  if (message.type === 'result' || message.type === 'prompt_suggestion') {
    return false;
  }
  if (message.type !== 'system' || !('subtype' in message)) return true;
  if (message.subtype === 'task_notification') return false;
  if (message.subtype === 'session_state_changed') {
    return message.state === 'running';
  }
  return true;
}
