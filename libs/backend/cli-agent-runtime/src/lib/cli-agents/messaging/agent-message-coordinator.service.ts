import { randomUUID } from 'node:crypto';
import type {
  AgentDeliveryReceipt,
  AgentId,
  AgentMessageOutcome,
  AgentMessagePreview,
  AgentMessagePreviewRequest,
  AgentMessageRequest,
  AgentMessageSender,
  AgentProcessInfo,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type { AgentProcessManager } from '../agent-process-manager.service';
import { AgentMessageError } from '../agent-message-router.service';
import type { CliDetectionService } from '../cli-detection.service';
import type { AgentLaneResumeService } from './agent-lane-resume.service';
import type {
  AgentMessageAckRequest,
  AgentMessageAckResult,
  AgentMessageAckService,
} from './agent-message-ack.service';
import type { AgentIdAliasRegistry } from './agent-id-alias.registry';
import type {
  AgentMessageDeliveryScheduler,
  AgentMessageDeliveryTarget,
} from './agent-message-delivery.scheduler';
import { AgentMessageDispatcher } from './agent-message-dispatcher';
import { CAPABILITY_METADATA_UNAVAILABLE, previewAgentMessage } from './agent-message-preview';
import { AgentMessageReconciler, envelopeLane, removeParkedEntry } from './agent-message-reconciler';
import { agentMessageSenderKey, mayActOnEnvelope } from './agent-message-sender';
import type { AgentMessageEnvelope, NewEnvelope } from './envelope/agent-message-envelope.schema';
import {
  AgentMessageBodyUnavailableError,
  AgentMessageStorageError,
  AgentMessageValidationError,
  type AgentMessageEnvelopeStore,
} from './envelope/agent-message-envelope.store';
import { LaneSerialQueue } from './lane-serial-queue';
import {
  planLimitRetry,
  requiresLimitGate,
  type LaneDeliveryLimitGate,
} from './lane-delivery-limit.gate';
import type { ParentSessionPurge } from './parent-session-purge.service';
import type { LaneMessageDenyReason, LaneMessagePolicy, VerifiedLaneSender } from './lane-message.policy';

export { CAPABILITY_METADATA_UNAVAILABLE } from './agent-message-preview';

export type CoordinatorManager = Pick<
  AgentProcessManager,
  'events' | 'findAgentInfo' | 'getMessageRoutableAgent' | 'sendToAgent' | 'getAgentMessageStatus'
>;
export type CoordinatorEnvelopeStore = Pick<
  AgentMessageEnvelopeStore,
  'ready' | 'put' | 'get' | 'getBody' | 'transition' | 'markDispatching' | 'list' | 'toReceipt'
>;
export type CoordinatorScheduler = Pick<
  AgentMessageDeliveryScheduler,
  'start' | 'enqueueCold' | 'schedule' | 'onLaneSettled'
> &
  Partial<Pick<AgentMessageDeliveryScheduler, 'unschedule'>>;

export interface AgentMessageCoordinatorDeps {
  readonly manager: CoordinatorManager;
  readonly detection: Pick<CliDetectionService, 'getAdapter'>;
  readonly store: CoordinatorEnvelopeStore;
  readonly aliases: Pick<AgentIdAliasRegistry, 'record' | 'resolve' | 'rootOf'>;
  readonly resume: Pick<AgentLaneResumeService, 'resume'>;
  readonly scheduler: CoordinatorScheduler;
  /** Semantic acknowledgment (Component 13). */
  readonly ack: Pick<AgentMessageAckService, 'acknowledge'>;
  readonly logger: Logger;
  /** Limit gate checked before starting a cold resume (Component 14). */
  readonly limitGate?: Pick<LaneDeliveryLimitGate, 'check'> | null;
  /** Startup purge recovery; awaited before the scheduler starts. */
  readonly purge?: Pick<ParentSessionPurge, 'resumePendingPurges'>;
  /** True while the parent session's deletion is in progress. */
  readonly isParentFrozen?: (parentSessionId: string) => boolean;
  /** Lane-to-lane authorization (Component 15). Absent: every lane send is refused. */
  readonly lanePolicy?: Pick<LaneMessagePolicy, 'authorize'> | null;
  readonly clock?: () => number;
}

type ReasonCode = NonNullable<AgentMessageOutcome['reasonCode']>;
type RouterDelivery = 'queue' | 'now' | 'steer';

const RETRYABLE = new Set<AgentMessageEnvelope['state']>(['blocked-retryable', 'outcome-unknown', 'failed', 'expired']);
const CANCELLABLE = new Set<AgentMessageEnvelope['state']>([
  'not-started', 'blocked-retryable', 'outcome-unknown', 'failed', 'expired',
]);
const DELIVERABLE = new Set<AgentMessageEnvelope['state']>(['not-started', 'blocked-retryable']);

/**
 * One facade for preview, send, status, list, cancel and retry of lane
 * messages (Component 6). Every message is durable before any adapter call,
 * and all state lives in the envelope store: there is no memory-only id map.
 */
export class AgentMessageCoordinator implements AgentMessageDeliveryTarget {
  private readonly serial = new LaneSerialQueue();
  private readonly dispatcher: AgentMessageDispatcher;
  private readonly reconciler: AgentMessageReconciler;
  private readonly clock: () => number;
  private startup?: Promise<void>;

  constructor(private readonly deps: AgentMessageCoordinatorDeps) {
    this.clock = deps.clock ?? Date.now;
    this.reconciler = new AgentMessageReconciler({
      manager: deps.manager, store: deps.store, aliases: deps.aliases, scheduler: deps.scheduler,
      serial: this.serial, logger: deps.logger, clock: this.clock, bootAt: this.clock(),
    });
    this.dispatcher = new AgentMessageDispatcher({
      manager: deps.manager, store: deps.store, aliases: deps.aliases, resume: deps.resume,
      settleTurn: (info) => this.reconciler.settleTurn(info), logger: deps.logger,
    });
    this.reconciler.attach();
  }

  /** Purge recovery, then restart reconciliation, then the scheduler. Idempotent. */
  start(): Promise<void> {
    this.startup ??= (async () => {
      await this.deps.purge?.resumePendingPurges();
      await this.reconciler.reconcileStartup();
      await this.deps.scheduler.start(this);
    })();
    return this.startup;
  }

  dispose(): void {
    this.reconciler.dispose();
  }

  preview(request: AgentMessagePreviewRequest): AgentMessagePreview {
    return previewAgentMessage(this.deps.manager, this.deps.detection, request);
  }

  /**
   * The sender comes from the transport (renderer, MCP request context), never
   * from arguments. A lane sender also needs `laneSender`, the verified
   * credential binding it came from; the lane policy decides whether it may
   * reach the target, and the recorded sender is rebuilt from its lane record.
   */
  async send(
    request: AgentMessageRequest,
    callerSender: AgentMessageSender,
    laneSender?: VerifiedLaneSender,
  ): Promise<AgentMessageOutcome> {
    if (!request.message.trim()) throw new Error('Message must not be empty.');
    const delivery = request.delivery === 'steer' ? 'now' : request.delivery ?? 'queue';
    if (callerSender.kind === 'parent' && request.idempotencyKey && !callerSender.sessionId) {
      return this.refuse({
        requested: request.agentId, lineage: request.agentId, delivery,
        sender: callerSender, senderKey: agentMessageSenderKey(callerSender),
      }, 'idempotency-key-requires-identity');
    }
    const lineage = await this.deps.aliases.rootOf(request.agentId);
    return this.serial.run(lineage, async () => {
      let sender = callerSender;
      if (callerSender.kind === 'lane') {
        // Authorize before any lookup keyed by the sender, so an unproven
        // caller learns nothing, and persist nothing for a denial.
        const verdict = await this.authorizeLane(request, callerSender, laneSender);
        if (!verdict.allowed) return laneDenied(request.agentId, verdict.reason);
        sender = verdict.sender;
      }
      const senderKey = agentMessageSenderKey(sender);
      const base = { requested: request.agentId, delivery, sender, senderKey };
      if (request.idempotencyKey) {
        const existing = await this.findByKey(senderKey, lineage, request.idempotencyKey);
        if (existing) return this.duplicate(existing, request.agentId);
      }
      const { agentId: laneId } = await this.deps.aliases.resolve(request.agentId);
      const plan = this.preview({ agentId: laneId, delivery });
      const info = this.deps.manager.findAgentInfo(laneId);
      const refusal = refusalFor(request, plan);
      if (refusal || !info) return this.refuse({ ...base, lineage }, refusal ?? 'not_found', plan.reason);
      if (info.parentSessionId && this.deps.isParentFrozen?.(info.parentSessionId))
        return this.refuse({ ...base, lineage }, 'parent-session-deleted');
      const limitDecision = requiresLimitGate(plan) && this.deps.limitGate
        ? await this.deps.limitGate.check(info)
        : { kind: 'proceed' as const };
      const retryPlan = limitDecision.kind === 'blocked'
        ? planLimitRetry(undefined, limitDecision.resetAt)
        : undefined;
      let put: { envelope: AgentMessageEnvelope; deduplicated: boolean };
      try {
        put = await this.deps.store.put({
          targetAgentId: request.agentId, laneLineageId: lineage,
          ...(laneId !== request.agentId ? { actualAgentId: laneId } : {}),
          ...(info.parentSessionId ? { parentSessionId: info.parentSessionId } : {}),
          sender, senderKey,
          ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
          mode: plan.mode, delivery,
          ...(request.allowPartialTurnLoss === true ? { allowPartialTurnLoss: true } : {}),
          ...(info.cliSessionId ? { cliSessionId: info.cliSessionId } : {}),
          route: plan.usesResume ? 'cold' : 'live',
          ...(retryPlan ? {
            state: 'blocked-retryable' as const,
            reason: 'lane-at-limit',
            limit: retryPlan.limit,
            ...(retryPlan.nextRetryAt !== undefined ? { nextRetryAt: retryPlan.nextRetryAt } : {}),
          } : {}),
        }, request.message);
      } catch (error: unknown) {
        return this.storageRefusal(error, request.agentId);
      }
      if (put.deduplicated) return this.duplicate(put.envelope, request.agentId);
      if (retryPlan) {
        if (retryPlan.nextRetryAt !== undefined) {
          this.deps.scheduler.schedule(put.envelope.id, retryPlan.nextRetryAt);
        }
        return this.unsupportedFor(put.envelope, 'lane-at-limit');
      }
      return this.dispatcher.attempt({
        envelope: put.envelope, body: request.message, plan, info, laneId,
        requestedAgentId: request.agentId,
        routerDelivery: request.delivery === 'steer' ? 'steer' : delivery,
      });
    });
  }

  /** Scheduler entry point: cold inbox, due retries and queue-full re-offers. */
  async deliver(envelopeId: string): Promise<void> {
    await this.deliverInternal(envelopeId, false);
  }

  /** Scheduler entry point when the scheduler already checked the limit gate. */
  async deliverAfterLimitGate(envelopeId: string): Promise<void> {
    await this.deliverInternal(envelopeId, true);
  }

  private async deliverInternal(envelopeId: string, limitChecked: boolean): Promise<void> {
    const envelope = await this.deps.store.get(envelopeId);
    if (!envelope || !DELIVERABLE.has(envelope.state)) return;
    await this.serial.run(envelope.laneLineageId, async () => {
      const current = await this.deps.store.get(envelopeId);
      if (!current || !DELIVERABLE.has(current.state)) return;
      const body = await this.deps.store.getBody(envelopeId);
      if (body === undefined) {
        await this.failWithoutBody(current);
        // The scheduler logs this; the receipt already shows the failure.
        throw new AgentMessageBodyUnavailableError(envelopeId);
      }
      await this.routeHeld(current, body, current.delivery, limitChecked);
    });
  }

  async retry(
    agentId: AgentId,
    messageId: string,
    actor: AgentMessageSender,
    opts: { confirmDuplicateRisk?: boolean } = {},
  ): Promise<AgentMessageOutcome> {
    const envelope = await this.owned(agentId, messageId, actor);
    return this.serial.run(envelope.laneLineageId, async () => {
      const current = (await this.deps.store.get(messageId)) ?? envelope;
      if (!RETRYABLE.has(current.state)) throw new Error('Message is not retryable in its current state.');
      if (current.state === 'expired' && !current.cliSessionId)
        return this.unsupportedFor(current, 'not_found');
      if (current.everDispatched === true && opts.confirmDuplicateRisk !== true)
        return this.unsupportedFor(current, 'confirmation-required');
      const body = await this.deps.store.getBody(messageId);
      if (body === undefined) return this.unsupportedFor(await this.failWithoutBody(current), 'body-unavailable');
      this.deps.scheduler.unschedule?.(messageId);
      let committed = false;
      let reopened: AgentMessageEnvelope | undefined;
      try {
        // Persist first: a failed write leaves the parked router entry untouched.
        reopened = await this.deps.store.transition(messageId, {
          state: 'not-started', reason: undefined, nextRetryAt: undefined,
        }, [current.state]);
        if (!reopened) throw new Error('Message receipt not found.');
        if (reopened.state !== 'not-started') {
          if (reopened.state !== current.state) throw new Error('Message is not retryable in its current state.');
          return this.unsupportedFor(reopened, 'storage-unavailable');
        }
        committed = true;
      } finally {
        if (!committed) await this.rearmHeld(messageId);
      }
      // A flush that took the entry meanwhile is gated by `markDispatching`'s from-states.
      removeParkedEntry(this.deps.manager, envelopeLane(current), messageId);
      return this.routeHeld(reopened, body, reopened.delivery, false);
    });
  }

  /**
   * A Retry or Cancel unschedules before it persists. When the write does not
   * commit, re-arm the deadline from the latest stored record (never from the
   * caller's snapshot, which may be stale): a running host must not lose the
   * automatic reset retry the envelope still promises.
   */
  private async rearmHeld(messageId: string): Promise<void> {
    try {
      const latest = await this.deps.store.get(messageId);
      if (latest?.state === 'blocked-retryable' && latest.nextRetryAt !== undefined)
        this.deps.scheduler.schedule(latest.id, latest.nextRetryAt);
    } catch (error: unknown) {
      // Not swallowed: logged; a host restart re-arms every stored hold.
      this.deps.logger.error(
        '[AgentMessageCoordinator] Could not re-arm a reset retry after a failed write',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  async cancel(agentId: AgentId, messageId: string, actor: AgentMessageSender): Promise<AgentDeliveryReceipt> {
    const envelope = await this.owned(agentId, messageId, actor);
    return this.serial.run(envelope.laneLineageId, async () => {
      const current = (await this.deps.store.get(messageId)) ?? envelope;
      if (!CANCELLABLE.has(current.state)) throw new Error('Message is no longer cancellable.');
      this.deps.scheduler.unschedule?.(messageId);
      let committed = false;
      let cancelled: AgentMessageEnvelope | undefined;
      try {
        // Persist first: a failed write leaves the parked router entry untouched.
        cancelled = await this.deps.store.transition(messageId, {
          state: 'cancelled', reason: actor.kind === 'user' ? 'cancelled-by-user' : 'cancelled-by-sender',
          nextRetryAt: undefined,
        }, [current.state]);
        if (!cancelled) throw new Error('Message receipt not found.');
        if (cancelled.state !== 'cancelled') {
          // A concurrent flush journalled it first; otherwise both index writes failed.
          if (cancelled.state !== current.state) throw new Error('Message is no longer cancellable.');
          throw new AgentMessageStorageError('storage-unavailable');
        }
        committed = true;
      } finally {
        if (!committed) await this.rearmHeld(messageId);
      }
      // An entry a flush took meanwhile is dropped by the router as withdrawn.
      removeParkedEntry(this.deps.manager, envelopeLane(current), messageId);
      return this.deps.store.toReceipt(cancelled);
    });
  }

  /**
   * Alias-aware receipt lookup. Without a viewer there is no ownership filter:
   * Phase 1 MCP status reads any receipt by id (URL attribution, no permission
   * change). A viewer limits the lookup to envelopes it may act on.
   */
  async getReceipt(agentId: AgentId, messageId: string, viewer?: AgentMessageSender): Promise<AgentDeliveryReceipt> {
    const envelope = await this.find(agentId, messageId);
    if (!envelope || (viewer !== undefined && !(await this.mayView(viewer, envelope))))
      throw new AgentMessageError('not_found', 'Message receipt not found.');
    return this.deps.store.toReceipt(envelope);
  }

  /**
   * A verified lane viewer sees the envelopes it sent and the ones addressed
   * to it (alias-aware); every other viewer keeps the ownership rule.
   */
  private async mayView(viewer: AgentMessageSender, envelope: AgentMessageEnvelope): Promise<boolean> {
    if (mayActOnEnvelope(viewer, envelope)) return true;
    if (viewer.kind !== 'lane' || viewer.verified !== true) return false;
    if (envelope.targetAgentId === viewer.agentId || envelope.actualAgentId === viewer.agentId) return true;
    return (await this.deps.aliases.rootOf(viewer.agentId)) === envelope.laneLineageId;
  }

  /**
   * Lane-to-lane gate (Component 15). Identity comes only from the verified
   * binding; the recorded sender carries the sender's own lane record.
   */
  private async authorizeLane(
    request: AgentMessageRequest,
    callerSender: Extract<AgentMessageSender, { kind: 'lane' }>,
    laneSender: VerifiedLaneSender | undefined,
  ): Promise<{ allowed: true; sender: AgentMessageSender } | { allowed: false; reason: LaneDenyCode }> {
    const proven = callerSender.verified === true && laneSender?.agentId === callerSender.agentId
      ? laneSender : undefined;
    if (!proven) {
      this.deps.logger.warn('[AgentMessageCoordinator] Lane message without a verified binding', {
        targetAgentId: request.agentId,
      });
      return { allowed: false, reason: 'identity-missing' };
    }
    if (!this.deps.lanePolicy) {
      this.deps.logger.warn('[AgentMessageCoordinator] Lane message refused: no lane policy wired', {
        senderAgentId: proven.agentId,
      });
      return { allowed: false, reason: 'delivery-refused' };
    }
    const { agentId: laneId } = await this.deps.aliases.resolve(request.agentId);
    const target = this.deps.manager.findAgentInfo(laneId);
    if (!target) return { allowed: false, reason: 'not_found' };
    const decision = this.deps.lanePolicy.authorize(proven, target, request.message.length);
    if (!decision.allowed) return decision;
    return { allowed: true, sender: verifiedLaneSender(decision.senderRecord) };
  }

  /**
   * A lane acknowledges a message delivered to it. The caller is the lane the
   * transport proved; the envelope's transport state is never changed.
   */
  acknowledge(request: AgentMessageAckRequest, caller: { readonly agentId: AgentId }): Promise<AgentMessageAckResult> {
    return this.deps.ack.acknowledge(request, caller);
  }

  async listReceipts(filter: { agentId?: AgentId; parentSessionId?: string }): Promise<readonly AgentDeliveryReceipt[]> {
    const lineage = filter.agentId ? await this.deps.aliases.rootOf(filter.agentId) : undefined;
    const envelopes = await this.deps.store.list(filter.parentSessionId ? { parentSessionId: filter.parentSessionId } : {});
    return envelopes
      .filter((envelope) => !lineage || envelope.laneLineageId === lineage)
      .map((envelope) => this.deps.store.toReceipt(envelope));
  }

  /** The stored body of an undelivered message, for Recover text. */
  async getBody(agentId: AgentId, messageId: string, actor: AgentMessageSender): Promise<string> {
    const envelope = await this.owned(agentId, messageId, actor);
    if (!CANCELLABLE.has(envelope.state) && envelope.state !== 'dispatching')
      throw new Error('Message text is only recoverable before delivery.');
    const body = await this.deps.store.getBody(messageId);
    if (body === undefined) throw new Error('Message text is not available.');
    return body;
  }

  /**
   * A held envelope whose body cannot be read is failed visibly, with no retry
   * time and no recoverable body; a failed write throws so the scheduler backs off.
   */
  private async failWithoutBody(envelope: AgentMessageEnvelope): Promise<AgentMessageEnvelope> {
    this.deps.logger.warn('[AgentMessageCoordinator] Held message has no readable body', { envelopeId: envelope.id });
    const failed = await this.deps.store.transition(envelope.id, {
      state: 'failed', reason: 'body-unavailable', nextRetryAt: undefined, bodyBytes: 0,
    }, [envelope.state]);
    if (!failed) throw new Error('Message receipt not found.');
    const written = failed.state === 'failed' && failed.reason === 'body-unavailable';
    // Same state but not written: both index writes failed and the store rolled back.
    if (!written && failed.state === envelope.state) throw new AgentMessageStorageError('storage-unavailable');
    if (written) removeParkedEntry(this.deps.manager, envelopeLane(envelope), envelope.id);
    return failed;
  }

  /** Re-plan a held envelope against the lane's current record and route it. */
  private async routeHeld(
    envelope: AgentMessageEnvelope,
    body: string,
    routerDelivery: RouterDelivery,
    limitChecked = false,
  ): Promise<AgentMessageOutcome> {
    const { agentId: laneId } = await this.deps.aliases.resolve(envelope.targetAgentId);
    const info = this.deps.manager.findAgentInfo(laneId);
    if (!info) {
      // No record in this host run: a resumable lane waits for Retry; otherwise it expires.
      const held = await this.deps.store.transition(envelope.id, envelope.cliSessionId
        ? { state: 'blocked-retryable', reason: 'awaiting-resume', route: 'cold', nextRetryAt: undefined }
        : { state: 'expired', reason: 'agent_expired', nextRetryAt: undefined }, [envelope.state]);
      return this.unsupportedFor(held ?? envelope, envelope.cliSessionId ? 'awaiting-resume' : 'agent_expired');
    }
    if (info.parentSessionId && this.deps.isParentFrozen?.(info.parentSessionId))
      return this.unsupportedFor(envelope, 'parent-session-deleted');
    const plan = this.preview({ agentId: laneId, delivery: envelope.delivery });
    const refusal = refusalFor({ allowPartialTurnLoss: envelope.allowPartialTurnLoss }, plan);
    if (refusal) {
      const failed = await this.deps.store.transition(envelope.id, {
        state: 'failed', reason: plan.reason ?? refusal,
      }, [envelope.state]);
      return this.unsupportedFor(failed ?? envelope, refusal);
    }
    let dispatchable = envelope;
    if (!limitChecked && requiresLimitGate(plan) && this.deps.limitGate) {
      const limitDecision = await this.deps.limitGate.check(info);
      const latest = await this.deps.store.get(envelope.id);
      if (!latest || !sameHeldSnapshot(envelope, latest)) {
        const current = latest ?? envelope;
        return {
          mode: current.mode,
          detail: 'already-decided',
          messageId: current.id,
          receipt: this.deps.store.toReceipt(current),
          requestedAgentId: current.targetAgentId,
          agentId: current.actualAgentId ?? current.targetAgentId,
        };
      }
      if (limitDecision.kind === 'blocked') {
        const retryPlan = planLimitRetry(latest.limit, limitDecision.resetAt);
        const held = await this.deps.store.transition(envelope.id, {
          state: 'blocked-retryable',
          reason: 'lane-at-limit',
          route: plan.usesResume ? 'cold' : 'live',
          limit: retryPlan.limit,
          nextRetryAt: retryPlan.nextRetryAt,
        }, [latest.state]);
        if (retryPlan.nextRetryAt !== undefined && held?.nextRetryAt === retryPlan.nextRetryAt) {
          this.deps.scheduler.schedule(envelope.id, retryPlan.nextRetryAt);
        }
        return this.unsupportedFor(held ?? latest, 'lane-at-limit');
      }
      dispatchable = latest;
    }
    return this.dispatcher.attempt({
      envelope: dispatchable, body, plan, info, laneId, requestedAgentId: envelope.targetAgentId, routerDelivery,
    });
  }

  /** A send-time refusal is never an accepted message: metadata only, no body, no key. */
  private async refuse(
    input: { requested: AgentId; lineage: AgentId; delivery: 'queue' | 'now'; sender: AgentMessageSender; senderKey: string },
    reason: ReasonCode,
    detail?: string,
  ): Promise<AgentMessageOutcome> {
    const record: NewEnvelope = {
      targetAgentId: input.requested, laneLineageId: input.lineage, sender: input.sender,
      senderKey: input.senderKey, state: 'failed', mode: 'unsupported', delivery: input.delivery,
      reason: detail && detail.length <= 200 ? detail : reason,
    };
    let envelope: AgentMessageEnvelope;
    try {
      envelope = (await this.deps.store.put(record, undefined)).envelope;
    } catch (error: unknown) {
      // Degradation: the refusal is still answered; only its audit record is missing.
      this.deps.logger.warn('[AgentMessageCoordinator] Refusal record not persisted', {
        error: error instanceof Error ? error.name : 'unknown',
      });
      const now = this.clock();
      envelope = { ...record, id: randomUUID(), state: 'failed', createdAt: now, updatedAt: now, attemptCount: 0, bodyBytes: 0 };
    }
    return { ...this.unsupportedFor(envelope, reason), detail: envelope.reason ?? reason, requestedAgentId: input.requested };
  }

  /**
   * `put` only validates and writes, so any other failure is a storage write
   * (the store does not wrap a failed body write): fail closed as
   * `storage-unavailable`, with nothing routed. The caller still holds the text.
   */
  private storageRefusal(error: unknown, requested: AgentId): AgentMessageOutcome {
    if (error instanceof AgentMessageStorageError || error instanceof AgentMessageValidationError) {
      this.deps.logger.warn('[AgentMessageCoordinator] Message not accepted', { reason: error.code });
      return { mode: 'unsupported', reasonCode: error.code, detail: error.code, requestedAgentId: requested };
    }
    this.deps.logger.error('[AgentMessageCoordinator] Message not accepted: storage write failed',
      error instanceof Error ? error : new Error('Message storage write failed'));
    return { mode: 'unsupported', reasonCode: 'storage-unavailable', detail: 'storage-unavailable', requestedAgentId: requested };
  }

  private duplicate(envelope: AgentMessageEnvelope, requested: AgentId): AgentMessageOutcome {
    return {
      mode: envelope.mode, messageId: envelope.id, receipt: this.deps.store.toReceipt(envelope),
      requestedAgentId: requested, agentId: envelope.actualAgentId ?? envelope.targetAgentId,
      deduplicated: true,
    };
  }

  private unsupportedFor(envelope: AgentMessageEnvelope, reason: ReasonCode): AgentMessageOutcome {
    return {
      mode: 'unsupported', detail: reason, reasonCode: reason, messageId: envelope.id,
      receipt: this.deps.store.toReceipt(envelope),
      requestedAgentId: envelope.targetAgentId, agentId: envelope.actualAgentId ?? envelope.targetAgentId,
    };
  }

  private async findByKey(senderKey: string, lineage: AgentId, key: string): Promise<AgentMessageEnvelope | undefined> {
    return (await this.deps.store.list({})).find((envelope) =>
      envelope.senderKey === senderKey && envelope.laneLineageId === lineage && envelope.idempotencyKey === key);
  }

  /** Alias-aware: an envelope matches any id of its lane lineage. */
  private async find(agentId: AgentId, messageId: string): Promise<AgentMessageEnvelope | undefined> {
    const envelope = await this.deps.store.get(messageId);
    if (!envelope) return undefined;
    if (envelope.targetAgentId === agentId || envelope.actualAgentId === agentId) return envelope;
    return (await this.deps.aliases.rootOf(agentId)) === envelope.laneLineageId ? envelope : undefined;
  }

  private async owned(agentId: AgentId, messageId: string, actor: AgentMessageSender): Promise<AgentMessageEnvelope> {
    const envelope = await this.find(agentId, messageId);
    if (!envelope || !mayActOnEnvelope(actor, envelope)) throw new Error('Message receipt not found.');
    return envelope;
  }
}

type LaneDenyCode = LaneMessageDenyReason | 'not_found' | 'delivery-refused';

/** The recorded sender of an authorized lane send, from its own lane record. */
function verifiedLaneSender(record: AgentProcessInfo): AgentMessageSender {
  const name = record.ptahCliName ?? record.displayName ?? record.cli;
  return {
    kind: 'lane', agentId: record.agentId, verified: true,
    ...(name ? { name } : {}),
    ...(record.parentSessionId ? { parentSessionId: record.parentSessionId } : {}),
  };
}

/**
 * A lane-policy denial is never an accepted message and persists nothing: a
 * lane retrying a denied send must not grow the envelope store.
 */
function laneDenied(requested: AgentId, reason: LaneDenyCode): AgentMessageOutcome {
  return { mode: 'unsupported', reasonCode: reason, detail: reason, requestedAgentId: requested };
}

/** Preview and explicit-intent refusals (unchanged rules, Preserve 1). */
function refusalFor(
  request: { delivery?: AgentMessageRequest['delivery']; allowPartialTurnLoss?: boolean },
  plan: AgentMessagePreview,
): ReasonCode | undefined {
  if (request.delivery === 'steer' && plan.mode !== 'steer') return 'steer-unavailable';
  if (!plan.supported)
    return plan.reason === 'not_found' || plan.reason === CAPABILITY_METADATA_UNAVAILABLE
      ? plan.reason : 'delivery-refused';
  if (plan.mode === 'interrupt-resume' && request.allowPartialTurnLoss !== true) return 'confirmation-required';
  return undefined;
}

function sameHeldSnapshot(before: AgentMessageEnvelope, current: AgentMessageEnvelope): boolean {
  return (
    current.state === before.state &&
    current.reason === before.reason &&
    current.attemptCount === before.attemptCount &&
    current.updatedAt === before.updatedAt &&
    current.nextRetryAt === before.nextRetryAt
  );
}
