/**
 * SessionPlanLimitCallbackRegistry — fan-out for the plan-limit signals a
 * native Claude session's stream carries (TASK_2026_596, Component 4).
 *
 * `StreamTransformer` is the producer; the plan-limit ledger in
 * `auth-providers` is the consumer. A registry rather than a
 * `StreamTransformConfig` callback for the same reason as
 * `SessionMcpStatusCallbackRegistry`: the consumer lives in another library
 * and no host wires the signal differently, so threading a callback through
 * `IAgentAdapter` would widen a shared port for nothing.
 *
 * ## Signals, per session
 *
 * - `turn-start` — the first turn-opening message of a turn (the stream's
 *   first, or the first after the previous `result`). Consumers that cache
 *   per turn (the session quota probe's `accountInfo()` read, G2) drop it here.
 * - `evidence` — a mapped `rate_limit_event`, rate-limit `api_retry` or
 *   assistant `rate_limit` error. Carries no used value (G1).
 * - `success` — a successful `result` (Decision 4, S1) with the turn's frozen
 *   main-loop model families and its billing. Only `billing: 'plan'` may clear
 *   anything.
 *
 * `notifyAll` dispatches synchronously with a per-subscriber try/catch from
 * {@link CallbackRegistryBase}. It runs on the SDK stream path, so a
 * subscriber must not block.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  CallbackRegistryBase,
  type CallbackRegistryCallback,
} from '../callback-registry.base';
import type {
  ClaudePlanLimitEvidence,
  ClaudeTurnBilling,
} from './claude-rate-limit.mapper';

export interface PlanLimitTurnStartSignal {
  readonly kind: 'turn-start';
  readonly observedAt: number;
}

export interface PlanLimitEvidenceSignal {
  readonly kind: 'evidence';
  readonly evidence: ClaudePlanLimitEvidence;
}

export interface PlanLimitSuccessSignal {
  readonly kind: 'success';
  /** Claude families of this turn's main-loop models; never `result.modelUsage`. */
  readonly turnScopes: readonly string[];
  readonly billing: ClaudeTurnBilling;
  readonly observedAt: number;
}

export type SessionPlanLimitSignal =
  PlanLimitTurnStartSignal | PlanLimitEvidenceSignal | PlanLimitSuccessSignal;

export interface SessionPlanLimitEvent {
  /**
   * The id the session is streaming under. Signals are emitted after session
   * initialization and carry the SDK's real session id.
   */
  readonly sessionId: string;
  readonly signal: SessionPlanLimitSignal;
}

export type SessionPlanLimitRegistryCallback =
  CallbackRegistryCallback<SessionPlanLimitEvent>;

@injectable()
export class SessionPlanLimitCallbackRegistry extends CallbackRegistryBase<SessionPlanLimitEvent> {
  constructor(@inject(TOKENS.LOGGER) logger: Logger) {
    super(logger, 'SessionPlanLimitCallbackRegistry');
  }
}
