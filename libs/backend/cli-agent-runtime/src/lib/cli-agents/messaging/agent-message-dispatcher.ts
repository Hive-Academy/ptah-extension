/**
 * One delivery attempt of a persisted envelope (Component 6, step 8).
 *
 * Every adapter side effect — cold spawn, live `sendToAgent` — is preceded by
 * a durable `dispatching` write. When that write fails nothing is dispatched.
 * The caller runs this inside the lane's serial queue.
 */
import type {
  AgentId,
  AgentMessageOutcome,
  AgentMessagePreview,
  AgentProcessInfo,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type { AgentProcessManager } from '../agent-process-manager.service';
import { AgentInterruptedDeliveryError, AgentMessageError } from '../agent-message-router.service';
import { LaneAccountResumeError } from '../lane-resume-gate';
import type { AgentLaneResumeService } from './agent-lane-resume.service';
import type { AgentIdAliasRegistry } from './agent-id-alias.registry';
import { formatAgentMessageDeliveryText } from './agent-message-delivery-text';
import { AgentMessageDispatchWithdrawnError } from './agent-message-dispatch-journal.port';
import type { AgentMessageEnvelope, EnvelopePatch } from './envelope/agent-message-envelope.schema';
import type { AgentMessageEnvelopeStore } from './envelope/agent-message-envelope.store';
import { LaneResumeError } from './lane-resumers/lane-resumer.port';

export type DispatchManager = Pick<
  AgentProcessManager,
  'findAgentInfo' | 'getMessageRoutableAgent' | 'sendToAgent'
>;
export type DispatchEnvelopeStore = Pick<
  AgentMessageEnvelopeStore,
  'get' | 'transition' | 'markDispatching' | 'toReceipt'
>;
type ReasonCode = NonNullable<AgentMessageOutcome['reasonCode']>;

export interface DispatchAttempt {
  readonly envelope: AgentMessageEnvelope;
  readonly body: string;
  readonly plan: AgentMessagePreview;
  readonly info: AgentProcessInfo;
  /** Current lane after alias resolution. */
  readonly laneId: AgentId;
  readonly requestedAgentId: AgentId;
  readonly routerDelivery: 'queue' | 'now' | 'steer';
}

export interface AgentMessageDispatcherDeps {
  readonly manager: DispatchManager;
  readonly store: DispatchEnvelopeStore;
  readonly aliases: Pick<AgentIdAliasRegistry, 'record'>;
  readonly resume: Pick<AgentLaneResumeService, 'resume'>;
  /** Settles a started envelope whose turn already ended (reconciler). */
  readonly settleTurn: (info: AgentProcessInfo) => Promise<void>;
  readonly logger: Logger;
}

export class AgentMessageDispatcher {
  constructor(private readonly deps: AgentMessageDispatcherDeps) {}

  async attempt(attempt: DispatchAttempt): Promise<AgentMessageOutcome> {
    const { envelope } = attempt;
    let dispatching: AgentMessageEnvelope;
    try {
      dispatching = await this.deps.store.markDispatching(envelope.id);
    } catch (error: unknown) {
      return this.journalFailed(attempt, error);
    }
    const text = formatAgentMessageDeliveryText(envelope.id, envelope.sender, attempt.body);
    return attempt.plan.usesResume
      ? this.cold(attempt, dispatching, text)
      : this.live(attempt, dispatching, text);
  }

  /** Nothing ran: disk keeps the prior state; the hold is written best-effort. */
  private async journalFailed(attempt: DispatchAttempt, error: unknown): Promise<AgentMessageOutcome> {
    if (error instanceof AgentMessageDispatchWithdrawnError) {
      // A concurrent flush or cancel decided this envelope first; report what it decided.
      const latest = (await this.deps.store.get(attempt.envelope.id)) ?? attempt.envelope;
      return this.outcome(attempt, latest.mode, latest, 'already-decided');
    }
    this.deps.logger.error('[AgentMessageCoordinator] Dispatch journal write failed; nothing dispatched',
      asError(error));
    const held = await this.deps.store.transition(attempt.envelope.id, {
      state: 'blocked-retryable', reason: 'storage-unavailable', nextRetryAt: undefined,
    }, ['not-started', 'blocked-retryable']);
    const shown: AgentMessageEnvelope = {
      ...(held ?? attempt.envelope), state: 'blocked-retryable', reason: 'storage-unavailable',
    };
    return this.unsupported(attempt, shown, 'storage-unavailable');
  }

  private async cold(attempt: DispatchAttempt, dispatching: AgentMessageEnvelope, text: string): Promise<AgentMessageOutcome> {
    let spawnedId: AgentId;
    let spawnedSession: string | undefined;
    try {
      const result = await this.deps.resume.resume(attempt.info, text);
      spawnedId = result.agentId;
      spawnedSession = result.cliSessionId;
    } catch (error: unknown) {
      return this.failed(attempt, dispatching, error);
    }
    try {
      await this.deps.aliases.record(attempt.laneId, spawnedId);
    } catch (error: unknown) {
      // Degradation: the message is delivered; a later call to the old id reaches the stopped record.
      this.deps.logger.error('[AgentMessageCoordinator] Alias record failed after cold resume', asError(error));
    }
    const spawned = this.deps.manager.findAgentInfo(spawnedId);
    const started = await this.deps.store.transition(dispatching.id, {
      state: 'started', mode: 'start-turn', route: 'cold', actualAgentId: spawnedId,
      turnSeq: spawned?.turnSeq ?? 1,
      cliSessionId: spawnedSession ?? spawned?.cliSessionId ?? dispatching.cliSessionId,
    }, ['dispatching']);
    await this.settleIfFinished(spawnedId);
    const latest = (await this.deps.store.get(dispatching.id)) ?? started ?? dispatching;
    return {
      mode: 'start-turn', messageId: latest.id, receipt: this.deps.store.toReceipt(latest),
      requestedAgentId: attempt.requestedAgentId, agentId: spawnedId,
    };
  }

  private async live(attempt: DispatchAttempt, dispatching: AgentMessageEnvelope, text: string): Promise<AgentMessageOutcome> {
    const { envelope, laneId } = attempt;
    let result: AgentMessageOutcome;
    try {
      result = await this.deps.manager.sendToAgent(laneId, text, attempt.routerDelivery, envelope.id,
        envelope.allowPartialTurnLoss === true);
    } catch (error: unknown) {
      return this.failed(attempt, dispatching, error);
    }
    if (result.mode === 'unsupported') {
      // The router's contract: `unsupported` means nothing was delivered.
      const queueFull = result.reasonCode === 'queue-full';
      const reason = result.reasonCode ?? 'delivery-refused';
      const next = await this.deps.store.transition(envelope.id, {
        state: queueFull ? 'blocked-retryable' : 'failed',
        ...(queueFull ? {} : { mode: 'unsupported' as const }),
        reason, everDispatched: envelope.everDispatched ?? false,
      }, ['dispatching']);
      return this.unsupported(attempt, next ?? dispatching, reason);
    }
    if (result.mode === 'queue-next-turn') return this.parked(attempt, dispatching, result);
    const current = this.deps.manager.findAgentInfo(laneId);
    const started = await this.deps.store.transition(envelope.id, {
      state: 'started', mode: result.mode, route: 'live',
      turnSeq: current?.turnSeq ?? attempt.info.turnSeq ?? 1,
    }, ['dispatching']);
    await this.settleIfFinished(laneId);
    const latest = (await this.deps.store.get(envelope.id)) ?? started ?? dispatching;
    return this.outcome(attempt, result.mode, latest, result.detail);
  }

  /**
   * Parking has no adapter side effect, so a parked entry goes back to
   * `not-started` with this attempt undone; the router's flush journals it
   * again before `continueConversation`. An entry the flush already took
   * stays `dispatching`.
   */
  private async parked(attempt: DispatchAttempt, dispatching: AgentMessageEnvelope, result: AgentMessageOutcome): Promise<AgentMessageOutcome> {
    const { envelope, laneId } = attempt;
    const parked = this.deps.manager.getMessageRoutableAgent(laneId)?.pendingMessages
      .some((entry) => entry.messageId === envelope.id) ?? false;
    const next = parked
      ? await this.deps.store.transition(envelope.id, {
        state: 'not-started', mode: 'queue-next-turn', route: 'live',
        everDispatched: envelope.everDispatched ?? false, attemptCount: envelope.attemptCount,
      }, ['dispatching'])
      : await this.deps.store.get(envelope.id);
    return this.outcome(attempt, 'queue-next-turn', next ?? dispatching, result.detail);
  }

  private async failed(attempt: DispatchAttempt, dispatching: AgentMessageEnvelope, error: unknown): Promise<AgentMessageOutcome> {
    const { patch, reason } = classifyAttemptFailure(error, attempt.envelope);
    if (patch.state === 'outcome-unknown')
      // Only the error's name: adapter messages can carry paths or tokens.
      this.deps.logger.error('[AgentMessageCoordinator] Delivery outcome unknown',
        new Error(`Delivery outcome unknown after ${error instanceof Error ? error.name : 'a non-Error throw'}`));
    const next = await this.deps.store.transition(dispatching.id, patch, ['dispatching']);
    return this.unsupported(attempt, next ?? dispatching, reason);
  }

  private async settleIfFinished(agentId: AgentId): Promise<void> {
    const info = this.deps.manager.findAgentInfo(agentId);
    if (info && info.status !== 'running') await this.deps.settleTurn(info);
  }

  private outcome(attempt: DispatchAttempt, mode: AgentMessageOutcome['mode'], envelope: AgentMessageEnvelope, detail?: string): AgentMessageOutcome {
    return {
      mode, messageId: envelope.id, receipt: this.deps.store.toReceipt(envelope),
      requestedAgentId: attempt.requestedAgentId, agentId: attempt.laneId,
      ...(detail ? { detail } : {}),
    };
  }

  private unsupported(attempt: DispatchAttempt, envelope: AgentMessageEnvelope, reason: ReasonCode): AgentMessageOutcome {
    return {
      mode: 'unsupported', detail: reason, reasonCode: reason, messageId: envelope.id,
      receipt: this.deps.store.toReceipt(envelope),
      requestedAgentId: attempt.requestedAgentId, agentId: attempt.laneId,
    };
  }
}

/**
 * A classified pre-acceptance refusal undoes this attempt's `everDispatched`;
 * an unclassified throw after `dispatching` may have reached the lane, so it
 * is `outcome-unknown` and a retry needs duplicate confirmation.
 */
export function classifyAttemptFailure(
  error: unknown,
  before: AgentMessageEnvelope,
): { patch: EnvelopePatch; reason: ReasonCode } {
  const undo = { everDispatched: before.everDispatched ?? false };
  if (error instanceof AgentInterruptedDeliveryError)
    return { reason: 'interrupted-undelivered',
      patch: { state: 'failed', reason: 'interrupted-undelivered', partialTurnLost: true } };
  if (error instanceof AgentMessageError) {
    const reason = error.code === 'not_found' ? 'not_found' : 'delivery-refused';
    return { reason, patch: { state: 'failed', reason, ...undo } };
  }
  if (error instanceof LaneAccountResumeError)
    return { reason: 'account_refused', patch: { state: 'failed', reason: 'account_refused', ...undo } };
  if (error instanceof LaneResumeError) {
    return error.code === 'no-session'
      ? { reason: 'resume-failed', patch: { state: 'failed', reason: 'resume-failed', ...undo } }
      : { reason: 'resume-failed', patch: { state: 'blocked-retryable', reason: 'resume-failed', nextRetryAt: undefined } };
  }
  return { reason: 'delivery-failed', patch: { state: 'outcome-unknown', reason: 'delivery-failed' } };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Agent message delivery failed');
}
