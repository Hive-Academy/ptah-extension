import { randomUUID } from 'node:crypto';
import type {
  AgentDeliveryReceipt,
  AgentId,
  AgentMessageOutcome,
  AgentMessagePreview,
  AgentMessagePreviewRequest,
  AgentMessageRequest,
  AgentMessageSender,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type { AgentProcessManager } from '../agent-process-manager.service';
import type { CliDetectionService } from '../cli-detection.service';
import type { AgentLaneResumeService } from './agent-lane-resume.service';
import type { AgentIdAliasRegistry } from './agent-id-alias.registry';
import type {
  AgentMessageDeliveryScheduler,
  AgentMessageDeliveryTarget,
} from './agent-message-delivery.scheduler';
import { AgentMessageDispatcher } from './agent-message-dispatcher';
import { CAPABILITY_METADATA_UNAVAILABLE, previewAgentMessage } from './agent-message-preview';
import { AgentMessageReconciler, removeParkedEntry } from './agent-message-reconciler';
import { agentMessageSenderKey, mayActOnEnvelope } from './agent-message-sender';
import type { AgentMessageEnvelope, NewEnvelope } from './envelope/agent-message-envelope.schema';
import {
  AgentMessageStorageError,
  AgentMessageValidationError,
  type AgentMessageEnvelopeStore,
} from './envelope/agent-message-envelope.store';
import { LaneSerialQueue } from './lane-serial-queue';
import type { ParentSessionPurge } from './parent-session-purge.service';

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
>;

export interface AgentMessageCoordinatorDeps {
  readonly manager: CoordinatorManager;
  readonly detection: Pick<CliDetectionService, 'getAdapter'>;
  readonly store: CoordinatorEnvelopeStore;
  readonly aliases: Pick<AgentIdAliasRegistry, 'record' | 'resolve' | 'rootOf'>;
  readonly resume: Pick<AgentLaneResumeService, 'resume'>;
  readonly scheduler: CoordinatorScheduler;
  readonly logger: Logger;
  /** Startup purge recovery; awaited before the scheduler starts. */
  readonly purge?: Pick<ParentSessionPurge, 'resumePendingPurges'>;
  /** True while the parent session's deletion is in progress. */
  readonly isParentFrozen?: (parentSessionId: string) => boolean;
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

  /** The sender comes from the transport (renderer, MCP request context), never from arguments. */
  async send(request: AgentMessageRequest, sender: AgentMessageSender): Promise<AgentMessageOutcome> {
    if (!request.message.trim()) throw new Error('Message must not be empty.');
    const senderKey = agentMessageSenderKey(sender);
    const delivery = request.delivery === 'steer' ? 'now' : request.delivery ?? 'queue';
    const base = { requested: request.agentId, delivery, sender, senderKey };
    if (request.idempotencyKey && sender.kind === 'parent' && !sender.sessionId)
      return this.refuse({ ...base, lineage: request.agentId }, 'idempotency-key-requires-identity');
    const lineage = await this.deps.aliases.rootOf(request.agentId);
    return this.serial.run(lineage, async () => {
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
        }, request.message);
      } catch (error: unknown) {
        return this.storageRefusal(error, request.agentId);
      }
      if (put.deduplicated) return this.duplicate(put.envelope, request.agentId);
      return this.dispatcher.attempt({
        envelope: put.envelope, body: request.message, plan, info, laneId,
        requestedAgentId: request.agentId,
        routerDelivery: request.delivery === 'steer' ? 'steer' : delivery,
      });
    });
  }

  /** Scheduler entry point: cold inbox, due retries and queue-full re-offers. */
  async deliver(envelopeId: string): Promise<void> {
    const envelope = await this.deps.store.get(envelopeId);
    if (!envelope || !DELIVERABLE.has(envelope.state)) return;
    await this.serial.run(envelope.laneLineageId, async () => {
      const current = await this.deps.store.get(envelopeId);
      if (!current || !DELIVERABLE.has(current.state)) return;
      const body = await this.deps.store.getBody(envelopeId);
      if (body === undefined) {
        this.deps.logger.warn('[AgentMessageCoordinator] Held message has no recoverable body', { envelopeId });
        return;
      }
      await this.routeHeld(current, body, current.delivery);
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
      if (body === undefined) return this.unsupportedFor(current, 'not_found');
      removeParkedEntry(this.deps.manager, current.actualAgentId ?? current.targetAgentId, messageId);
      const reopened = await this.deps.store.transition(messageId, {
        state: 'not-started', reason: undefined, nextRetryAt: undefined,
      }, [current.state]);
      if (!reopened || reopened.state !== 'not-started') return this.unsupportedFor(reopened ?? current, 'storage-unavailable');
      return this.routeHeld(reopened, body, reopened.delivery);
    });
  }

  async cancel(agentId: AgentId, messageId: string, actor: AgentMessageSender): Promise<AgentDeliveryReceipt> {
    const envelope = await this.owned(agentId, messageId, actor);
    return this.serial.run(envelope.laneLineageId, async () => {
      const current = (await this.deps.store.get(messageId)) ?? envelope;
      if (!CANCELLABLE.has(current.state)) throw new Error('Message is no longer cancellable.');
      removeParkedEntry(this.deps.manager, current.actualAgentId ?? current.targetAgentId, messageId);
      const cancelled = await this.deps.store.transition(messageId, {
        state: 'cancelled', reason: actor.kind === 'user' ? 'cancelled-by-user' : 'cancelled-by-sender',
        nextRetryAt: undefined,
      }, [current.state]);
      if (!cancelled || cancelled.state !== 'cancelled') throw new Error('Message could not be cancelled.');
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
    if (!envelope || (viewer !== undefined && !mayActOnEnvelope(viewer, envelope)))
      throw new Error('Message receipt not found.');
    return this.deps.store.toReceipt(envelope);
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

  /** Re-plan a held envelope against the lane's current record and route it. */
  private async routeHeld(envelope: AgentMessageEnvelope, body: string, routerDelivery: RouterDelivery): Promise<AgentMessageOutcome> {
    const { agentId: laneId } = await this.deps.aliases.resolve(envelope.targetAgentId);
    const info = this.deps.manager.findAgentInfo(laneId);
    if (!info) {
      // No record in this host run: a resumable lane waits for Retry; otherwise it expires.
      const held = await this.deps.store.transition(envelope.id, envelope.cliSessionId
        ? { state: 'blocked-retryable', reason: 'awaiting-resume', route: 'cold', nextRetryAt: undefined }
        : { state: 'expired', reason: 'agent_expired', nextRetryAt: undefined }, ['not-started', 'blocked-retryable']);
      return this.unsupportedFor(held ?? envelope, envelope.cliSessionId ? 'awaiting-resume' : 'agent_expired');
    }
    if (info.parentSessionId && this.deps.isParentFrozen?.(info.parentSessionId))
      return this.unsupportedFor(envelope, 'parent-session-deleted');
    const plan = this.preview({ agentId: laneId, delivery: envelope.delivery });
    const refusal = refusalFor({ allowPartialTurnLoss: envelope.allowPartialTurnLoss }, plan);
    if (refusal) {
      const failed = await this.deps.store.transition(envelope.id, {
        state: 'failed', reason: plan.reason ?? refusal,
      }, ['not-started', 'blocked-retryable']);
      return this.unsupportedFor(failed ?? envelope, refusal);
    }
    return this.dispatcher.attempt({
      envelope, body, plan, info, laneId, requestedAgentId: envelope.targetAgentId, routerDelivery,
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
