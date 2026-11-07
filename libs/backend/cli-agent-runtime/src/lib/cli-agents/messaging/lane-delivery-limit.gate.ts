import type {
  AgentMessagePreview,
  AgentProcessInfo,
  LaneStateReason,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type { LaneLimitLookupService } from '../limits/lane-limit-lookup.service';

/** Interactive message-path deadline for `LaneLimitLookupService.lookup`. */
export const LANE_LIMIT_GATE_DEADLINE_MS = 1_500;

/** Buffer added to a known `resetAt` timestamp before scheduling one retry. */
export const LANE_LIMIT_RESET_RETRY_DELAY_MS = 60_000;

/** How long a usage-limit stop with no known reset blocks delivery. */
export const UNKNOWN_RESET_BLOCK_MS = 60 * 60_000;

export type LimitGateDecision =
  | { readonly kind: 'proceed' }
  | { readonly kind: 'blocked'; readonly limitKnown: true; readonly resetAt?: number };

export type LaneDeliveryLimitLookup = Pick<LaneLimitLookupService, 'lookup'>;

export interface LimitRetryPlan {
  readonly limit: {
    readonly known: true;
    readonly resetAt?: number;
  };
  readonly nextRetryAt?: number;
}

/**
 * Computes the envelope `limit` metadata and optional single scheduled retry
 * timestamp for a limit block.
 *
 * Enforces the one-retry-per-reset rule: if the envelope already recorded a
 * limit with the same or later `resetAt` (or no `resetAt` is known), the retry
 * becomes manual (`nextRetryAt: undefined`) so no tight retry loop can occur.
 */
export function planLimitRetry(
  previousLimit: { readonly known: boolean; readonly resetAt?: number } | undefined,
  resetAt: number | undefined,
): LimitRetryPlan {
  const validResetAt = isValidResetAt(resetAt) ? resetAt : undefined;
  const limit = {
    known: true as const,
    ...(validResetAt !== undefined ? { resetAt: validResetAt } : {}),
  };
  const previousResetAt = previousLimit?.resetAt;
  const canScheduleRetry =
    validResetAt !== undefined &&
    (previousResetAt === undefined || validResetAt > previousResetAt);

  return {
    limit,
    ...(canScheduleRetry
      ? { nextRetryAt: validResetAt + LANE_LIMIT_RESET_RETRY_DELAY_MS }
      : {}),
  };
}

/**
 * True when a delivery plan starts or queues a continuation turn (cold resume
 * or live queued continuation) and must pass the limit gate before dispatch.
 */
export function requiresLimitGate(
  plan: Pick<AgentMessagePreview, 'usesResume' | 'delivery' | 'mode'>,
): boolean {
  return (
    plan.usesResume ||
    plan.delivery === 'queue' ||
    plan.mode === 'queue-next-turn' ||
    plan.mode === 'start-turn'
  );
}

/**
 * Checks whether a target lane is known to be at its usage/plan limit before
 * starting a cold resume or offering a queued live continuation.
 *
 * Sources, in order:
 * 1. `info.stopReason === 'usage-limit'`, with `info.stopResetAt` when known
 *    and still in the future (`stopResetAt > clock()`). Once `stopResetAt` has
 *    elapsed, the retained stop record is treated as historical and the gate
 *    consults the current lookup instead.
 * 2. `LaneLimitLookupService.lookup([info], { deadlineMs: 1500 })` when the
 *    returned lane state is `'at-limit'`, taking the earliest `window.resetsAt`
 *    from `window-limit` reasons.
 * 3. Anything else (`unknown`, `no-owner`, `timeout`, `failed`, or non-at-limit
 *    states) proceeds so unowned or slow-lookup lanes are never blocked.
 *
 * Exception: a `usage-limit` stop with no known reset and no valid
 * `completedAt` proceeds only when the lookup returns `confirmed-room`.
 * Every other lookup outcome, `near-limit` included, keeps it blocked.
 */
export class LaneDeliveryLimitGate {
  constructor(
    private readonly lookup: LaneDeliveryLimitLookup | null = null,
    private readonly logger?: Logger,
    private readonly deadlineMs: number = LANE_LIMIT_GATE_DEADLINE_MS,
    private readonly clock: () => number = Date.now,
  ) {}

  async check(info: AgentProcessInfo): Promise<LimitGateDecision> {
    // A usage-limit stop with no known reset and no trustworthy stop time
    // is fresh limit evidence: deliver only when a lookup confirms room.
    let requireConfirmedRoom = false;
    if (info.stopReason === 'usage-limit') {
      const resetAt = isValidResetAt(info.stopResetAt) ? info.stopResetAt : undefined;
      if (resetAt === undefined) {
        // Only completedAt marks the stop; startedAt or lastActivityAt can be
        // far older than the stop and would erase the window at once.
        const stoppedAt = info.completedAt ? Date.parse(info.completedAt) : Number.NaN;
        if (!Number.isFinite(stoppedAt)) {
          requireConfirmedRoom = true;
        } else if (this.clock() < stoppedAt + UNKNOWN_RESET_BLOCK_MS) {
          // Unknown reset: block only for a bounded window, then consult the lookup.
          return {
            kind: 'blocked',
            limitKnown: true,
          };
        }
      } else if (resetAt > this.clock()) {
        return {
          kind: 'blocked',
          limitKnown: true,
          resetAt,
        };
      }
    }

    const unconfirmed = (): LimitGateDecision =>
      requireConfirmedRoom ? { kind: 'blocked', limitKnown: true } : { kind: 'proceed' };

    if (!this.lookup) {
      return unconfirmed();
    }

    try {
      const results = await this.lookup.lookup([info], { deadlineMs: this.deadlineMs });
      const result = results[0];
      if (!result) {
        return unconfirmed();
      }

      if (result.lookup !== 'ok') {
        if (result.lookup === 'timeout' || result.lookup === 'failed') {
          this.logger?.debug(
            '[LaneDeliveryLimitGate] Limit lookup did not resolve',
            { agentId: info.agentId, lookup: result.lookup },
          );
        }
        return unconfirmed();
      }

      if (result.state.state !== 'at-limit') {
        // Only confirmed-room proves room; a partial near-limit snapshot does not.
        return result.state.state === 'confirmed-room' ? { kind: 'proceed' } : unconfirmed();
      }

      const resetAt = earliestResetAt(result.state.reasons);
      return {
        kind: 'blocked',
        limitKnown: true,
        ...(resetAt !== undefined ? { resetAt } : {}),
      };
    } catch (error: unknown) {
      this.logger?.debug(
        '[LaneDeliveryLimitGate] Limit lookup threw',
        {
          agentId: info.agentId,
          error: error instanceof Error ? error.name : typeof error,
        },
      );
      return unconfirmed();
    }
  }
}

function earliestResetAt(reasons: readonly LaneStateReason[]): number | undefined {
  const windowResets: number[] = [];
  for (const reason of reasons) {
    if (reason.kind === 'window-limit') {
      const candidate = reason.window.resetsAt ?? reason.evidence.resetsAt;
      if (isValidResetAt(candidate)) {
        windowResets.push(candidate);
      }
    }
  }
  if (windowResets.length > 0) {
    return Math.min(...windowResets);
  }

  const ownerResets: number[] = [];
  for (const reason of reasons) {
    if (reason.kind === 'owner-limit' && isValidResetAt(reason.evidence.resetsAt)) {
      ownerResets.push(reason.evidence.resetsAt);
    }
  }
  return ownerResets.length > 0 ? Math.min(...ownerResets) : undefined;
}

function isValidResetAt(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
